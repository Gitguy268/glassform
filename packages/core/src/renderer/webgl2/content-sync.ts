import { invertMatrix, multiplyMatrices, scaleOutputMatrix, type Matrix2D } from '../../matrix'
import { Glass, Html, type TraversedSceneLayer } from '../../scene'
import type { GlassContentRange } from '../content-source'
import { CONTENT_ATLAS_PADDING, getTextureBucketSize, packContentAtlas, type GlassContentEntry } from '../content'
import { getCopiedCssSize, getTextureUvScale } from '../dom-content-sync'
import { prepareDrawableChild, updateDrawableGeometry, usesElementGeometry } from '../html-in-canvas'
import { matrixToCssTransform, type FlattenedContainer } from '../interaction'
import { PixelSourceCache, resolveHtmlContentMode, type HtmlContentMode } from '../pixel-sources'
import { getSortedGlassHtmlLayers, getSortedGlassLayers } from '../scene-order'
import { ContentDataLayout } from '../shader-layouts'
import { GlBlurPrograms } from './blur'
import type { GlSceneHtmlEntry, WebGl2GlassContentSource } from './core'
import {
  createBlurChain,
  createColorTexture,
  createTarget,
  destroyBlurChain,
  destroyTarget,
  drawFullscreen,
  GlDataTexture,
  GlProgram,
  uploadImage,
  type GlBlurChain,
  type GlTarget,
} from './gl'

type GlWebglElementDraw = WebGL2RenderingContext & {
  texElementSubImage2D?: (
    target: number,
    level: number,
    x: number,
    y: number,
    element: Element,
    config?: { width?: number; height?: number },
  ) => void
}

const BLIT_REGION_SHADER = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D inputTexture;
uniform vec4 u_region[1];
void main() {
  fragColor = textureLod(inputTexture, v_uv * u_region[0].xy, 0.0);
}
`

type Entry = GlSceneHtmlEntry & {
  mode: HtmlContentMode
  pixelSerial: number
  elementVersion: number
  blur: number
  chain: GlBlurChain | null
  dirty: boolean
}

type ContentEntry = Entry & {
  glass: Glass
  atlasX: number
  atlasY: number
  contentInverse: Matrix2D
}

/** Options for {@link WebGl2ContentSync}. */
export type WebGl2ContentSyncOptions = {
  gl: WebGL2RenderingContext
  targetCanvas: HTMLCanvasElement
  overlayRoot: HTMLElement
  getCurrentDpr: () => number
  onPixelsChanged: () => void
}

function syncHost(host: HTMLDivElement, parent: HTMLElement, matrix: Matrix2D, zIndex: string, cssTransform: boolean) {
  if (host.parentElement !== parent) {
    parent.append(host)
  }
  const transform = cssTransform ? matrixToCssTransform(matrix) : ''
  if (host.style.transform !== transform) {
    host.style.transform = transform
  }
  if (host.style.zIndex !== zIndex) {
    host.style.zIndex = zIndex
  }
}

/**
 * WebGL2 counterpart of DomContentSync. Pixels come from media, DOM snapshots
 * or (where `texElementSubImage2D` exists) live DOM; glass content that cannot
 * be drawn into the canvas is shown as a live overlay.
 */
export class WebGl2ContentSync implements WebGl2GlassContentSource {
  readonly sceneHtmlHosts = new Set<HTMLDivElement>()
  readonly glassContentHosts = new Set<HTMLDivElement>()
  private readonly gl: WebGL2RenderingContext
  private readonly sceneEntries = new Map<Html, Entry>()
  private readonly contentEntries = new Map<Html, ContentEntry>()
  private readonly ranges = new Map<Glass, GlassContentRange>()
  private readonly overlayHosts = new Set<Html>()
  private readonly modes = new Map<Html, HtmlContentMode>()
  private contentOrder: ContentEntry[] = []
  private atlas: GlTarget | null = null
  private readonly entriesTexture: GlDataTexture
  private entriesData = ContentDataLayout.createArray()
  private readonly pixels: PixelSourceCache
  private readonly blur: GlBlurPrograms
  private readonly blitRegion: GlProgram
  private readonly regionUniform = new Float32Array(4)
  private readonly maxTextureSize: number
  private readonly elementDraw: boolean

  constructor(private readonly options: WebGl2ContentSyncOptions) {
    const gl = options.gl
    this.gl = gl
    this.entriesTexture = new GlDataTexture(gl, ContentDataLayout.laneCount)
    this.pixels = new PixelSourceCache(() => {
      for (const entry of [...this.sceneEntries.values(), ...this.contentEntries.values()]) {
        entry.dirty = true
      }
      options.onPixelsChanged()
    })
    this.blur = new GlBlurPrograms(gl)
    this.blitRegion = new GlProgram(gl, BLIT_REGION_SHADER)
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    this.elementDraw = typeof (gl as GlWebglElementDraw).texElementSubImage2D === 'function'
  }

  get atlasTexture() {
    return this.atlas?.texture ?? null
  }

  get contentEntriesTexture() {
    return this.contentOrder.length > 0 ? this.entriesTexture.texture : null
  }

  get overlayHostElements() {
    return new Set([...this.overlayHosts].map((html) => html.host))
  }

  getContentMode(html: Html) {
    return this.modes.get(html) ?? null
  }

  getSceneHtmlEntry(html: Html) {
    return this.sceneEntries.get(html) ?? null
  }

  getGlassContentRange(glass: Glass) {
    return this.ranges.get(glass) ?? null
  }

  /** Paint events from HTML-in-Canvas mark live DOM entries for re-copy. */
  handlePaintEvent() {
    for (const entry of [...this.sceneEntries.values(), ...this.contentEntries.values()]) {
      if (entry.mode === 'element') {
        entry.dirty = true
      }
    }
  }

  /** Synchronizes hosts, textures and atlas layout with the scene. */
  sync(layers: TraversedSceneLayer[], containers: FlattenedContainer[], hostOrder: Map<Html, number>) {
    const dpr = this.options.getCurrentDpr()
    const activeOverlay = new Set<Html>()
    const activeScene = new Set<Html>()
    const canvas = this.options.targetCanvas
    const geometryApi = usesElementGeometry()

    for (const layer of layers) {
      if (!(layer.child instanceof Html) || layer.child.width <= 0 || layer.child.height <= 0) {
        continue
      }
      const html = layer.child
      const mode = this.resolveMode(html, false)
      const zIndex = String(hostOrder.get(html) ?? 0)
      if (mode === 'overlay') {
        this.mountOverlay(html, layer.transform, zIndex, activeOverlay)
        continue
      }
      activeScene.add(html)
      const entry = this.ensureEntry(this.sceneEntries, html, mode, dpr) as Entry
      entry.inverseTransform = invertMatrix(scaleOutputMatrix(layer.transform, dpr))
      this.mountCanvasHost(html, canvas, layer.transform, zIndex, mode, dpr, geometryApi)
      this.sceneHtmlHosts.add(html.host)
    }

    for (const [html, entry] of [...this.sceneEntries]) {
      if (!activeScene.has(html)) {
        this.releaseEntry(entry)
        this.sceneEntries.delete(html)
        this.sceneHtmlHosts.delete(html.host)
        if (!hostOrder.has(html)) {
          html.host.remove()
        }
      }
    }

    const order: ContentEntry[] = []
    const activeContent = new Set<Html>()
    this.ranges.clear()
    for (const containerEntry of containers) {
      for (const glassLayer of getSortedGlassLayers(containerEntry.container)) {
        const glass = glassLayer.glass
        if (glass.width <= 0 || glass.height <= 0) {
          continue
        }
        const glassTransform = multiplyMatrices(containerEntry.transform, glassLayer.transform)
        const start = order.length
        for (const htmlLayer of getSortedGlassHtmlLayers(glass)) {
          const html = htmlLayer.html
          if (html.width <= 0 || html.height <= 0) {
            continue
          }
          const world = multiplyMatrices(glassTransform, htmlLayer.transform)
          const zIndex = String(hostOrder.get(html) ?? 0)
          const mode = this.resolveMode(html, true)
          if (mode === 'overlay') {
            this.mountOverlay(html, world, zIndex, activeOverlay)
            continue
          }
          const inverse = invertMatrix(htmlLayer.transform)
          if (!inverse) {
            continue
          }
          activeContent.add(html)
          const entry = this.ensureEntry(this.contentEntries, html, mode, dpr) as ContentEntry
          entry.glass = glass
          entry.contentInverse = inverse
          this.mountCanvasHost(html, canvas, world, zIndex, mode, dpr, geometryApi)
          this.glassContentHosts.add(html.host)
          order.push(entry)
        }
        if (order.length > start) {
          this.ranges.set(glass, { start, count: order.length - start })
        }
      }
    }

    for (const [html, entry] of [...this.contentEntries]) {
      if (!activeContent.has(html)) {
        this.releaseEntry(entry)
        this.contentEntries.delete(html)
        this.glassContentHosts.delete(html.host)
        if (!hostOrder.has(html)) {
          html.host.remove()
        }
      }
    }

    for (const html of [...this.overlayHosts]) {
      if (!activeOverlay.has(html)) {
        this.overlayHosts.delete(html)
        if (html.host.parentElement === this.options.overlayRoot) {
          html.host.remove()
        }
      }
    }

    this.contentOrder = order
    this.syncAtlas()
  }

  /** Uploads any changed pixels and refreshes blur and the atlas. */
  copyPending() {
    const live = this.pixels.hasLiveSources
    for (const entry of this.sceneEntries.values()) {
      if (entry.dirty || live || entry.mode === 'snapshot') {
        this.copyEntry(entry)
      }
    }
    let atlasChanged = false
    for (const entry of this.contentOrder) {
      if (entry.dirty || live || entry.mode === 'snapshot') {
        atlasChanged = this.copyEntry(entry) || atlasChanged
      }
    }
    if (atlasChanged) {
      this.writeContentEntries()
    }
  }

  destroy() {
    for (const entry of [...this.sceneEntries.values(), ...this.contentEntries.values()]) {
      this.releaseEntry(entry)
      entry.html.host.remove()
    }
    for (const html of this.overlayHosts) {
      html.host.remove()
    }
    this.sceneEntries.clear()
    this.contentEntries.clear()
    this.overlayHosts.clear()
    destroyTarget(this.gl, this.atlas)
    this.atlas = null
    this.entriesTexture.destroy()
    this.pixels.destroy()
    this.blur.destroy()
    this.blitRegion.destroy()
  }

  private resolveMode(html: Html, glassContent: boolean) {
    const mode = resolveHtmlContentMode(html, { elementDraw: this.elementDraw, glassContent })
    this.modes.set(html, mode)
    return mode
  }

  private mountOverlay(html: Html, matrix: Matrix2D, zIndex: string, active: Set<Html>) {
    active.add(html)
    this.overlayHosts.add(html)
    html.host.removeAttribute('drawable')
    syncHost(html.host, this.options.overlayRoot, matrix, zIndex, true)
    if (html.host.style.pointerEvents !== 'auto') {
      html.host.style.pointerEvents = 'auto'
    }
  }

  private mountCanvasHost(
    html: Html,
    canvas: HTMLCanvasElement,
    matrix: Matrix2D,
    zIndex: string,
    mode: HtmlContentMode,
    dpr: number,
    geometryApi: boolean,
  ) {
    const drawable = mode === 'element'
    syncHost(html.host, canvas, matrix, zIndex, !(drawable && geometryApi))
    if (drawable) {
      if (!html.host.hasAttribute('drawable')) {
        prepareDrawableChild(html.host)
      }
      updateDrawableGeometry(canvas, html.host, matrix, dpr)
    } else if (html.host.hasAttribute('drawable')) {
      html.host.removeAttribute('drawable')
    }
  }

  private ensureEntry(map: Map<Html, Entry>, html: Html, mode: HtmlContentMode, dpr: number) {
    let entry = map.get(html)
    if (!entry) {
      entry = {
        html,
        mode,
        texture: null,
        filteredTexture: null,
        width: 0,
        height: 0,
        deviceWidth: 0,
        deviceHeight: 0,
        copiedDeviceWidth: 0,
        copiedDeviceHeight: 0,
        textureWidth: 0,
        textureHeight: 0,
        inverseTransform: null,
        pixelSerial: -1,
        elementVersion: -1,
        blur: -1,
        chain: null,
        dirty: true,
        glass: null as unknown as Glass,
        atlasX: 0,
        atlasY: 0,
        contentInverse: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      } as ContentEntry
      map.set(html, entry)
    }
    if (entry.mode !== mode) {
      entry.mode = mode
      entry.pixelSerial = -1
      entry.dirty = true
    }
    if (entry.elementVersion !== html._elementVersion || entry.blur !== html.blur) {
      entry.elementVersion = html._elementVersion
      entry.blur = html.blur
      entry.dirty = true
    }
    const deviceWidth = Math.max(1, Math.round(html.width * dpr))
    const deviceHeight = Math.max(1, Math.round(html.height * dpr))
    entry.width = html.width
    entry.height = html.height
    if (deviceWidth !== entry.deviceWidth || deviceHeight !== entry.deviceHeight) {
      entry.deviceWidth = deviceWidth
      entry.deviceHeight = deviceHeight
      entry.dirty = true
      entry.pixelSerial = -1
      const textureWidth = getTextureBucketSize(deviceWidth, this.maxTextureSize)
      const textureHeight = getTextureBucketSize(deviceHeight, this.maxTextureSize)
      if (textureWidth !== entry.textureWidth || textureHeight !== entry.textureHeight || !entry.texture) {
        if (entry.texture) {
          this.gl.deleteTexture(entry.texture)
        }
        destroyBlurChain(this.gl, entry.chain)
        entry.chain = null
        entry.texture = createColorTexture(this.gl, textureWidth, textureHeight)
        entry.textureWidth = textureWidth
        entry.textureHeight = textureHeight
        entry.copiedDeviceWidth = 0
        entry.copiedDeviceHeight = 0
        entry.filteredTexture = null
      }
    }
    return entry
  }

  private releaseEntry(entry: Entry) {
    if (entry.texture) {
      this.gl.deleteTexture(entry.texture)
    }
    destroyBlurChain(this.gl, entry.chain)
    entry.texture = null
    entry.filteredTexture = null
    entry.chain = null
    this.pixels.release(entry.html)
  }

  /** Copies one entry's pixels; returns whether its texture changed. */
  private copyEntry(entry: Entry) {
    const gl = this.gl
    if (!entry.texture) {
      return false
    }
    let changed = false
    if (entry.mode === 'element') {
      try {
        gl.bindTexture(gl.TEXTURE_2D, entry.texture)
        ;(gl as GlWebglElementDraw).texElementSubImage2D!.call(gl, gl.TEXTURE_2D, 0, 0, 0, entry.html.host, {
          width: entry.deviceWidth,
          height: entry.deviceHeight,
        })
        changed = true
      } catch {
        return false
      }
    } else if (entry.mode === 'media' || entry.mode === 'snapshot') {
      const frame = this.pixels.frame(entry.html, entry.mode, entry.deviceWidth, entry.deviceHeight)
      if (!frame) {
        return false
      }
      if (frame.serial !== entry.pixelSerial) {
        uploadImage(gl, entry.texture, frame.image)
        entry.pixelSerial = frame.serial
        changed = true
      }
    }
    entry.dirty = false
    if (!changed && entry.copiedDeviceWidth > 0) {
      return false
    }
    entry.copiedDeviceWidth = entry.deviceWidth
    entry.copiedDeviceHeight = entry.deviceHeight
    this.filterEntry(entry)
    if ('atlasX' in entry && this.contentEntries.get(entry.html) === entry) {
      this.blitToAtlas(entry as ContentEntry)
    }
    return true
  }

  private filterEntry(entry: Entry) {
    entry.filteredTexture = null
    const radius = entry.html.blur * this.options.getCurrentDpr()
    if (radius <= 0 || !entry.texture) {
      return
    }
    if (!entry.chain || entry.chain.levels[0].width !== entry.textureWidth || entry.chain.levels[0].height !== entry.textureHeight) {
      destroyBlurChain(this.gl, entry.chain)
      entry.chain = createBlurChain(this.gl, 'rgba8', entry.textureWidth, entry.textureHeight)
    }
    entry.filteredTexture = this.blur.render(entry.texture, radius, entry.chain)
  }

  private syncAtlas() {
    const entries = this.contentOrder
    if (entries.length === 0) {
      destroyTarget(this.gl, this.atlas)
      this.atlas = null
      return
    }
    const layout = packContentAtlas(entries as unknown as GlassContentEntry[], this.maxTextureSize)
    let moved = !this.atlas || this.atlas.width !== layout.width || this.atlas.height !== layout.height
    for (const entry of entries) {
      const rect = layout.rects.get(entry.html)!
      if (entry.atlasX !== rect.x || entry.atlasY !== rect.y) {
        entry.atlasX = rect.x
        entry.atlasY = rect.y
        moved = true
      }
    }
    if (moved) {
      destroyTarget(this.gl, this.atlas)
      this.atlas = createTarget(this.gl, layout.width, layout.height, 'rgba8')
      const gl = this.gl
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.atlas.framebuffer)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      for (const entry of entries) {
        if (entry.copiedDeviceWidth > 0) {
          this.blitToAtlas(entry)
        }
      }
    }
    this.writeContentEntries()
  }

  private blitToAtlas(entry: ContentEntry) {
    const source = entry.filteredTexture ?? entry.texture
    if (!this.atlas || !source) {
      return
    }
    this.regionUniform[0] = entry.deviceWidth / entry.textureWidth
    this.regionUniform[1] = entry.deviceHeight / entry.textureHeight
    drawFullscreen(
      this.gl,
      this.blitRegion,
      this.atlas,
      { textures: { inputTexture: source }, vec4Arrays: { u_region: this.regionUniform } },
      {
        x: entry.atlasX + CONTENT_ATLAS_PADDING,
        y: entry.atlasY + CONTENT_ATLAS_PADDING,
        width: entry.deviceWidth,
        height: entry.deviceHeight,
      },
    )
  }

  private writeContentEntries() {
    const entries = this.contentOrder
    if (!this.atlas || entries.length === 0) {
      return
    }
    if (this.entriesData.length < entries.length * ContentDataLayout.floatCount) {
      this.entriesData = ContentDataLayout.createArray(entries.length)
    }
    entries.forEach((entry, index) => {
      const inverse = entry.contentInverse
      ContentDataLayout.writeAt(this.entriesData, index, {
        inverse0: {
          a: inverse.a,
          c: inverse.c,
          e: inverse.e,
          copiedWidth: getCopiedCssSize(entry.copiedDeviceWidth, entry.deviceWidth, entry.width),
        },
        inverse1: {
          b: inverse.b,
          d: inverse.d,
          f: inverse.f,
          copiedHeight: getCopiedCssSize(entry.copiedDeviceHeight, entry.deviceHeight, entry.height),
        },
        atlasRect: {
          u: (entry.atlasX + CONTENT_ATLAS_PADDING) / this.atlas!.width,
          v: (entry.atlasY + CONTENT_ATLAS_PADDING) / this.atlas!.height,
          uScale: getTextureUvScale(entry.deviceWidth, entry.width, this.atlas!.width),
          vScale: getTextureUvScale(entry.deviceHeight, entry.height, this.atlas!.height),
        },
        opacity: { value: entry.html.opacity },
      })
    })
    this.entriesTexture.upload(this.entriesData, entries.length)
  }
}
