import type { Matrix2D } from '../../matrix'
import { Container, Html, Scene, type Glass, type TraversedSceneLayer } from '../../scene'
import {
  GL_DISPLACEMENT_FIELD_SHADER,
  GL_GLASS_SHADER,
  GL_HTML_COMPOSITE_SHADER,
  GL_METRICS_SHADER,
  GL_SHADOW_COMPOSITE_SHADER,
  GL_SHADOW_MASK_SHADER,
  GL_TEXTURE_BLIT_SHADER,
} from '../../shaders-glsl'
import type { BackdropMetrics } from '../../types'
import type { GlassContentRange } from '../content-source'
import { BACKDROP_METRICS_SIZE, parseBackdropMetricsBytes, type BoundsRect } from '../metrics'
import { getSortedSceneLayers } from '../scene-order'
import {
  BackdropMetricsBoundsLayout,
  ContentDataLayout,
  GlobalsLayout,
  HtmlCompositeParamsLayout,
  ShapeDataLayout,
  SubmersionCellDataLayout,
} from '../shader-layouts'
import {
  globalsValues,
  htmlCompositeValues,
  packContainerShapes,
  shapeDataValues,
  submersionCellValues,
  type HtmlCompositeSource,
} from '../shape-packing'
import { GlBlurPrograms } from './blur'
import {
  createBlurChain,
  createTarget,
  destroyBlurChain,
  destroyTarget,
  drawFullscreen,
  GlDataTexture,
  GlProgram,
  type GlBlurChain,
  type GlTarget,
} from './gl'

/** Scene-attached HTML texture state for the WebGL2 core. */
export type GlSceneHtmlEntry = HtmlCompositeSource & {
  html: Html
  texture: WebGLTexture | null
  filteredTexture: WebGLTexture | null
}

/** Optional content provider for the WebGL2 core (mirrors WebGpuGlassContentSource). */
export type WebGl2GlassContentSource = {
  readonly atlasTexture?: WebGLTexture | null
  /** RGBA32F data texture of ContentDataLayout rows. */
  readonly contentEntriesTexture?: WebGLTexture | null
  getSceneHtmlEntry?: (html: Html) => GlSceneHtmlEntry | null
  getGlassContentRange?: (glass: Glass) => GlassContentRange | null
}

/** Inputs for one WebGL2 core render. */
export type WebGl2GlassCoreRenderOptions = {
  layers?: TraversedSceneLayer[]
  scene?: Scene
  width: number
  height: number
  dpr: number
  /** Render target to draw into; null presents to the default framebuffer (flipped). */
  output: GlTarget | null
  /** Optional texture composited first (e.g. a Three.js scene). Top-down orientation. */
  backdropTexture?: WebGLTexture | null
  /** Set when the backdrop's first row is the bottom of the image (Three.js render targets). */
  backdropFlipY?: boolean
  contentSource?: WebGl2GlassContentSource | null
}

type GlTargets = {
  backdropBlur: GlBlurChain
  displacementBlur: GlBlurChain
  shadowBlur: GlBlurChain
  sceneA: GlTarget
  sceneB: GlTarget
}

type GlMetricsState = {
  container: Container
  buffer: WebGLBuffer | null
  sync: WebGLSync | null
  metrics: BackdropMetrics | null
  inScene: boolean
}

const TRANSPARENT: [number, number, number, number] = [0, 0, 0, 0]
const OPAQUE_BLACK: [number, number, number, number] = [0, 0, 0, 1]
const METRICS_BYTES_PER_ROW = BACKDROP_METRICS_SIZE * 4

/**
 * WebGL2 port of WebGpuGlassCore: the same passes, shaders (GLSL mirrors of
 * the WGSL) and CPU packing, for browsers without a WebGPU adapter.
 */
export class WebGl2GlassCore {
  private destroyed = false
  private width = 1
  private height = 1
  private currentDpr = 1
  private contentSource: WebGl2GlassContentSource | null = null
  private targets: GlTargets | null = null

  private readonly blur: GlBlurPrograms
  private readonly programs: {
    displacement: GlProgram
    glass: GlProgram
    shadowMask: GlProgram
    shadowComposite: GlProgram
    htmlComposite: GlProgram
    metrics: GlProgram
    blit: GlProgram
  }
  private readonly globals = GlobalsLayout.createArray()
  private readonly metricsBounds = BackdropMetricsBoundsLayout.createArray()
  private readonly htmlParams = HtmlCompositeParamsLayout.createArray()
  private readonly shapes: GlDataTexture
  private readonly submersionCells: GlDataTexture
  private readonly emptyContentEntries: GlDataTexture
  private shapeData = ShapeDataLayout.createArray()
  private cellData = SubmersionCellDataLayout.createArray()
  private readonly metricsTarget: GlTarget
  private readonly metricsStates = new Map<Container, GlMetricsState>()
  private readonly emptyTexture: WebGLTexture

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.blur = new GlBlurPrograms(gl)
    this.programs = {
      displacement: new GlProgram(gl, GL_DISPLACEMENT_FIELD_SHADER),
      glass: new GlProgram(gl, GL_GLASS_SHADER),
      shadowMask: new GlProgram(gl, GL_SHADOW_MASK_SHADER),
      shadowComposite: new GlProgram(gl, GL_SHADOW_COMPOSITE_SHADER),
      htmlComposite: new GlProgram(gl, GL_HTML_COMPOSITE_SHADER),
      metrics: new GlProgram(gl, GL_METRICS_SHADER),
      blit: new GlProgram(gl, GL_TEXTURE_BLIT_SHADER),
    }
    this.shapes = new GlDataTexture(gl, ShapeDataLayout.laneCount)
    this.submersionCells = new GlDataTexture(gl, SubmersionCellDataLayout.laneCount)
    this.emptyContentEntries = new GlDataTexture(gl, ContentDataLayout.laneCount)
    this.metricsTarget = createTarget(gl, BACKDROP_METRICS_SIZE, BACKDROP_METRICS_SIZE, 'rgba8')
    this.emptyTexture = createTarget(gl, 1, 1, 'rgba8').texture
  }

  /** Enables or disables cached backdrop metrics for a container. */
  setBackdropMetricsTracking(container: Container, enabled: boolean) {
    if (enabled) {
      if (!this.metricsStates.has(container)) {
        this.metricsStates.set(container, { container, buffer: null, sync: null, metrics: null, inScene: false })
      }
      return
    }
    const state = this.metricsStates.get(container)
    if (state) {
      this.releaseMetricsState(state)
      this.metricsStates.delete(container)
    }
  }

  /** Returns the latest completed metrics for a tracked container. */
  getBackdropMetrics(container: Container) {
    const state = this.metricsStates.get(container)
    return state?.inScene ? state.metrics : null
  }

  /** Draws one frame. */
  render(options: WebGl2GlassCoreRenderOptions) {
    if (this.destroyed) {
      return
    }
    this.width = Math.max(1, Math.floor(options.width))
    this.height = Math.max(1, Math.floor(options.height))
    this.currentDpr = Math.max(options.dpr, 0.0001)
    this.contentSource = options.contentSource ?? null
    this.syncTargets()
    this.pollMetrics()
    const layers = options.layers ?? (options.scene ? getSortedSceneLayers(options.scene) : [])
    try {
      this.drawFrame(layers, options.output, options.backdropTexture ?? null, options.backdropFlipY ?? false)
    } finally {
      this.contentSource = null
    }
  }

  /** Releases GL resources owned by the core. */
  destroy() {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    const gl = this.gl
    this.destroyTargets()
    this.blur.destroy()
    for (const program of Object.values(this.programs)) {
      program.destroy()
    }
    this.shapes.destroy()
    this.submersionCells.destroy()
    this.emptyContentEntries.destroy()
    destroyTarget(gl, this.metricsTarget)
    gl.deleteTexture(this.emptyTexture)
    for (const state of this.metricsStates.values()) {
      this.releaseMetricsState(state)
    }
    this.metricsStates.clear()
  }

  private syncTargets() {
    if (this.targets && this.targets.sceneA.width === this.width && this.targets.sceneA.height === this.height) {
      return
    }
    this.destroyTargets()
    const gl = this.gl
    this.targets = {
      backdropBlur: createBlurChain(gl, 'rgba8', this.width, this.height),
      displacementBlur: createBlurChain(gl, 'rgba16f', this.width, this.height),
      shadowBlur: createBlurChain(gl, 'rgba8', this.width, this.height),
      sceneA: createTarget(gl, this.width, this.height, 'rgba8'),
      sceneB: createTarget(gl, this.width, this.height, 'rgba8'),
    }
  }

  private destroyTargets() {
    const gl = this.gl
    if (!this.targets) {
      return
    }
    destroyBlurChain(gl, this.targets.backdropBlur)
    destroyBlurChain(gl, this.targets.displacementBlur)
    destroyBlurChain(gl, this.targets.shadowBlur)
    destroyTarget(gl, this.targets.sceneA)
    destroyTarget(gl, this.targets.sceneB)
    this.targets = null
  }

  private packShapes(container: Container, containerTransform: Matrix2D) {
    const packed = packContainerShapes(
      container,
      containerTransform,
      this.currentDpr,
      (glass) => this.contentSource?.getGlassContentRange?.(glass),
    )
    const count = packed.shapes.length
    if (this.shapeData.length < Math.max(count, 1) * ShapeDataLayout.floatCount) {
      this.shapeData = ShapeDataLayout.createArray(count)
    }
    packed.shapes.forEach((shape, index) => ShapeDataLayout.writeAt(this.shapeData, index, shapeDataValues(shape)))
    this.shapes.upload(this.shapeData, count)

    const { packedCount, cells } = submersionCellValues(packed.submersionValues)
    if (this.cellData.length < Math.max(packedCount, 1) * SubmersionCellDataLayout.floatCount) {
      this.cellData = SubmersionCellDataLayout.createArray(packedCount)
    }
    cells.forEach((cell, index) => SubmersionCellDataLayout.writeAt(this.cellData, index, cell))
    this.submersionCells.upload(this.cellData, packedCount)

    return { shapeCount: count, bounds: packed.bounds }
  }

  private sdfTextures() {
    return {
      u_shapes: this.shapes.texture,
      u_submersionCells: this.submersionCells.texture,
    }
  }

  private renderDisplacementField(container: Container) {
    const targets = this.targets!
    const raw = targets.displacementBlur.levels[0].ping
    drawFullscreen(this.gl, this.programs.displacement, raw, {
      textures: this.sdfTextures(),
      vec4Arrays: { u_globals: this.globals },
      clear: TRANSPARENT,
    })
    return this.blur.render(raw.texture, container.displacementBlur * this.currentDpr, targets.displacementBlur)
  }

  private shouldRenderShadow(container: Container) {
    return container.opacity > 0 && container.shadowColor.a > 0 && Boolean(this.targets)
  }

  private renderShadow(source: GlTarget, target: GlTarget, container: Container) {
    if (!this.shouldRenderShadow(container)) {
      return false
    }
    const targets = this.targets!
    const raw = targets.shadowBlur.levels[0].ping
    drawFullscreen(this.gl, this.programs.shadowMask, raw, {
      textures: this.sdfTextures(),
      vec4Arrays: { u_globals: this.globals },
      clear: TRANSPARENT,
    })
    const blurredMask = this.blur.render(raw.texture, container.shadowBlur * this.currentDpr, targets.shadowBlur)
    drawFullscreen(this.gl, this.programs.shadowComposite, target, {
      textures: { sceneTexture: source.texture, shadowMaskTexture: blurredMask },
      vec4Arrays: { u_globals: this.globals },
      clear: OPAQUE_BLACK,
    })
    return true
  }

  private renderContainer(sharp: GlTarget, blurredBackdrop: WebGLTexture, displacementField: WebGLTexture, target: GlTarget) {
    const contentTexture = this.contentSource?.atlasTexture ?? this.emptyTexture
    const contentEntries = this.contentSource?.contentEntriesTexture ?? this.emptyContentEntries.texture
    drawFullscreen(this.gl, this.programs.glass, target, {
      textures: {
        ...this.sdfTextures(),
        backgroundTextureSharp: sharp.texture,
        backgroundTextureBlurred: blurredBackdrop,
        glassContentTexture: contentTexture,
        displacementFieldTexture: displacementField,
        u_contentEntries: contentEntries,
      },
      vec4Arrays: { u_globals: this.globals },
      clear: OPAQUE_BLACK,
    })
  }

  private compositeHtmlLayer(sharp: GlTarget, target: GlTarget, entry: GlSceneHtmlEntry) {
    const texture = entry.filteredTexture ?? entry.texture
    if (!texture || !entry.inverseTransform) {
      return false
    }
    HtmlCompositeParamsLayout.write(this.htmlParams, htmlCompositeValues(entry, this.width, this.height))
    drawFullscreen(this.gl, this.programs.htmlComposite, target, {
      textures: { sceneTexture: sharp.texture, htmlTexture: texture },
      vec4Arrays: { u_params: this.htmlParams },
      clear: OPAQUE_BLACK,
    })
    return true
  }

  private renderBackdropMetrics(state: GlMetricsState, bounds: BoundsRect | null, blurredBackdrop: WebGLTexture) {
    const gl = this.gl
    if (!bounds) {
      state.metrics = null
      return
    }
    if (state.sync) {
      return
    }
    BackdropMetricsBoundsLayout.write(this.metricsBounds, {
      bounds: { minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY },
    })
    drawFullscreen(gl, this.programs.metrics, this.metricsTarget, {
      textures: { ...this.sdfTextures(), blurredBackdrop },
      vec4Arrays: { u_globals: this.globals, u_metricsBounds: this.metricsBounds },
      clear: TRANSPARENT,
    })
    if (!state.buffer) {
      state.buffer = gl.createBuffer()
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, state.buffer)
      gl.bufferData(gl.PIXEL_PACK_BUFFER, METRICS_BYTES_PER_ROW * BACKDROP_METRICS_SIZE, gl.STREAM_READ)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.metricsTarget.framebuffer)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, state.buffer)
    gl.readPixels(0, 0, BACKDROP_METRICS_SIZE, BACKDROP_METRICS_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, 0)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    state.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    gl.flush()
  }

  /** Reads back finished metrics without stalling the pipeline. */
  private pollMetrics() {
    const gl = this.gl
    for (const state of this.metricsStates.values()) {
      if (!state.sync || !state.buffer) {
        continue
      }
      const status = gl.clientWaitSync(state.sync, 0, 0)
      if (status === gl.TIMEOUT_EXPIRED) {
        continue
      }
      gl.deleteSync(state.sync)
      state.sync = null
      if (status === gl.WAIT_FAILED) {
        continue
      }
      const bytes = new Uint8Array(METRICS_BYTES_PER_ROW * BACKDROP_METRICS_SIZE)
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, state.buffer)
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, bytes)
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
      state.metrics = parseBackdropMetricsBytes(bytes, METRICS_BYTES_PER_ROW)
    }
  }

  private releaseMetricsState(state: GlMetricsState) {
    if (state.sync) {
      this.gl.deleteSync(state.sync)
    }
    if (state.buffer) {
      this.gl.deleteBuffer(state.buffer)
    }
    state.sync = null
    state.buffer = null
    state.metrics = null
  }

  private drawFrame(
    layers: TraversedSceneLayer[],
    output: GlTarget | null,
    backdropTexture: WebGLTexture | null,
    backdropFlipY: boolean,
  ) {
    const gl = this.gl
    const targets = this.targets
    if (this.destroyed || !targets) {
      return
    }

    let current = targets.sceneA
    let next = targets.sceneB
    const swap = () => {
      const previous = current
      current = next
      next = previous
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, current.framebuffer)
    gl.viewport(0, 0, current.width, current.height)
    gl.clearColor(...OPAQUE_BLACK)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (backdropTexture) {
      drawFullscreen(gl, this.programs.blit, current, { textures: { inputTexture: backdropTexture }, flipY: backdropFlipY })
    }

    const seen = new Set<Container>()
    for (const entry of layers) {
      if (entry.child instanceof Html) {
        if (entry.child.opacity <= 0) {
          continue
        }
        const htmlEntry = this.contentSource?.getSceneHtmlEntry?.(entry.child)
        if (!htmlEntry || !htmlEntry.texture || !htmlEntry.inverseTransform) {
          continue
        }
        if (this.compositeHtmlLayer(current, next, htmlEntry)) {
          swap()
        }
        continue
      }

      const container = entry.child
      if (container.opacity <= 0) {
        continue
      }
      const packed = this.packShapes(container, entry.transform)
      GlobalsLayout.write(this.globals, globalsValues(container, packed.shapeCount, this.width, this.height, this.currentDpr))
      const blurRadiusPx = container.blur * this.currentDpr
      let blurredBackdrop = this.blur.render(current.texture, blurRadiusPx, targets.backdropBlur)
      if (blurRadiusPx <= 0 && this.shouldRenderShadow(container)) {
        // Same as the WebGPU core: snapshot the sharp scene so the glass pass
        // never samples the texture it renders into after the shadow swap.
        const snapshot = targets.backdropBlur.levels[0].pong
        drawFullscreen(gl, this.programs.blit, snapshot, { textures: { inputTexture: current.texture } })
        blurredBackdrop = snapshot.texture
      }
      const displacementField = this.renderDisplacementField(container)

      const metricsState = this.metricsStates.get(container)
      if (metricsState) {
        seen.add(container)
        this.renderBackdropMetrics(metricsState, packed.bounds, blurredBackdrop)
      }

      if (this.renderShadow(current, next, container)) {
        swap()
      }
      this.renderContainer(current, blurredBackdrop, displacementField, next)
      swap()
    }

    for (const state of this.metricsStates.values()) {
      state.inScene = seen.has(state.container)
      if (!state.inScene) {
        state.metrics = null
      }
    }

    drawFullscreen(gl, this.programs.blit, output, {
      textures: { inputTexture: current.texture },
      flipY: output === null,
    })
  }
}
