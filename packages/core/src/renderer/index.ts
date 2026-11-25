import { prepareDrawableCanvas } from './html-in-canvas'
import { Container, Html, Scene, type TraversedSceneLayer } from '../scene'
import { DomContentSync } from './dom-content-sync'
import { GPU_TEXTURE_USAGE } from './gpu-constants'
import { clearRenderTarget } from './gpu-pass'
import { copyTextureRegion, createRenderTarget } from './gpu-targets'
import {
  getHtmlHostOrder,
  getLayerContainers,
  getSortedSceneLayers,
} from './scene-order'
import { PointerController } from './pointer-controller'
import {
  WebGpuGlassCore,
  resolveSpecularWidthPx,
  type WebGpuGlassCoreRenderOptions,
  type WebGpuGlassCoreInit,
} from './core'
import { WebGpuDomContentSource, type WebGpuDomContentSourceInit } from './dom-content-source'
import type { WebGpuGlassContentSource } from './content-source'
import type { FlattenedContainer } from './interaction'
import type { HtmlContentMode } from './pixel-sources'
import { WebGl2GlassCore } from './webgl2/core'
import { WebGl2ContentSync } from './webgl2/content-sync'
import { enableGlExtensions, GL_CONTEXT_ATTRIBUTES } from './webgl2/gl'

export {
  WebGpuGlassCore,
  WebGpuDomContentSource,
  resolveSpecularWidthPx,
  type WebGpuGlassCoreInit,
  type WebGpuGlassCoreRenderOptions,
  type WebGpuGlassContentSource,
  type WebGpuDomContentSourceInit,
}

/** GPU backend a {@link Renderer} draws with. */
export type GlassBackend = 'webgpu' | 'webgl2'

/** Backend request: `'auto'` tries WebGPU, then WebGL2. */
export type GlassBackendPreference = 'auto' | GlassBackend

/**
 * Constructor options for {@link Renderer}.
 */
type RendererInit = {
  /** Scene to render. If omitted, a new empty scene is created. */
  scene?: Scene
  /** Maximum device pixel ratio used for internal render targets. Defaults to `2`. */
  maxDpr?: number
  /** Which GPU backend to use. Defaults to `'auto'` (WebGPU, else WebGL2). */
  backend?: GlassBackendPreference
  /**
   * Called when pixels change without a scene mutation (a snapshot finished,
   * an image loaded). Render loops that only draw on demand should schedule a
   * frame here.
   */
  onNeedsFrame?: () => void
}

/** Content synchronizer interface shared by the WebGPU and WebGL2 paths. */
type ContentSync = {
  readonly sceneHtmlHosts: Set<HTMLDivElement>
  readonly glassContentHosts: Set<HTMLDivElement>
  readonly overlayHostElements: Set<HTMLDivElement>
  sync(layers: TraversedSceneLayer[], containers: FlattenedContainer[], hostOrder: Map<Html, number>): void
  copyPending(): void
  handlePaintEvent(event: Event): void
  getContentMode(html: Html): HtmlContentMode | null
  destroy(): void
}

const EMPTY_HOSTS = new Set<HTMLDivElement>()

/**
 * Renderer for a liquid-glass scene graph. It draws with WebGPU where an
 * adapter exists and falls back to WebGL2 (Firefox, older Safari, GPU-less
 * Chromium). Both backends run the same passes and produce the same image.
 *
 * The renderer owns a canvas. Html nodes are drawn from live DOM where the
 * browser supports HTML-in-Canvas, otherwise from media sources, DOM
 * snapshots or a live overlay (see {@link Html.fallback}).
 */
export class Renderer {
  /** Scene currently rendered by this renderer. */
  readonly scene: Scene
  /** Canvas element that presents the rendered output. Mount this element. */
  readonly canvas: HTMLCanvasElement
  /**
   * Layer the renderer places over the canvas (as its next sibling) for Html
   * shown as live DOM, used where the browser cannot draw HTML into a canvas.
   */
  readonly overlay: HTMLDivElement
  /** Resolves with the backend once the GPU is ready; rejects if none works. */
  readonly ready: Promise<GlassBackend>
  /** Maximum device pixel ratio used for internal render targets. */
  maxDpr: number

  private readonly targetCanvas: HTMLCanvasElement
  private readonly pointerController: PointerController
  private readonly backendPreference: GlassBackendPreference
  private readonly onNeedsFrame: (() => void) | undefined
  private content: ContentSync | null = null
  private activeBackend: GlassBackend | null = null

  private unsubscribeSceneMutations: (() => void) | null = null
  private initError: unknown = null
  private destroyed = false
  private initialized = false
  private pendingSceneContentSync = true
  private sceneContentSyncQueued = false
  private currentDpr = 1
  private resizeObserver: ResizeObserver | null = null

  // WebGPU
  private device: GPUDevice | null = null
  private context: GPUCanvasContext | null = null
  private presentationFormat: GPUTextureFormat | null = null
  private core: WebGpuGlassCore | null = null
  private canvasConfigured = false
  private lastFrameTexture: GPUTexture | null = null

  // WebGL2
  private gl: WebGL2RenderingContext | null = null
  private glCore: WebGl2GlassCore | null = null
  private glContent: WebGl2ContentSync | null = null

  /** Handles canvas paint events by copying managed DOM content into GPU textures. */
  private readonly handlePaintEvent = (event: Event) => {
    if (this.destroyed || !this.content) {
      return
    }

    this.content.handlePaintEvent(event)
  }

  /** Marks scene-derived DOM and interaction state as dirty after scene mutations. */
  private readonly handleSceneMutation = () => {
    this.queueSceneContentSync()
  }

  /**
   * Creates a renderer and begins asynchronous GPU initialization immediately.
   */
  constructor(options: RendererInit = {}) {
    this.scene = options.scene ?? new Scene()
    this.maxDpr = options.maxDpr ?? 2
    this.backendPreference = options.backend ?? 'auto'
    this.onNeedsFrame = options.onNeedsFrame
    this.targetCanvas = document.createElement('canvas')
    prepareDrawableCanvas(this.targetCanvas)
    this.targetCanvas.style.display = 'block'
    this.overlay = document.createElement('div')
    this.overlay.dataset.glassformOverlay = ''
    this.overlay.style.cssText = 'position:absolute;pointer-events:none;overflow:hidden;contain:layout'
    this.pointerController = new PointerController({
      targetCanvas: this.targetCanvas,
      renderer: this,
      isDestroyed: () => this.destroyed,
      flushSceneContentSync: () => this.flushSceneContentSync(),
      getSceneHtmlHosts: () => this.content?.sceneHtmlHosts ?? EMPTY_HOSTS,
      getGlassContentHosts: () =>
        this.content
          ? new Set([...this.content.glassContentHosts, ...this.content.overlayHostElements])
          : EMPTY_HOSTS,
    })

    this.targetCanvas.addEventListener('paint', this.handlePaintEvent as EventListener)
    for (const target of [this.targetCanvas, this.overlay] as HTMLElement[]) {
      target.addEventListener('pointermove', this.pointerController.handlePointerMove, true)
      target.addEventListener('pointerdown', this.pointerController.handlePointerDown, true)
      target.addEventListener('pointerup', this.pointerController.handlePointerUp, true)
      target.addEventListener('pointercancel', this.pointerController.handlePointerCancel, true)
    }
    this.targetCanvas.addEventListener('pointerleave', this.pointerController.handlePointerLeave, true)
    this.unsubscribeSceneMutations = this.scene._subscribe(this.handleSceneMutation)

    this.canvas = this.targetCanvas
    this.ready = this.initialize()
    this.ready.catch((error: unknown) => {
      this.initError = error
      console.error(error)
    })
  }

  /** The backend in use, or null before initialization finishes. */
  get backend() {
    return this.activeBackend
  }

  /** Enables or disables cached backdrop metrics for a container. */
  setBackdropMetricsTracking(container: Container, enabled: boolean) {
    this.core?.setBackdropMetricsTracking(container, enabled)
    this.glCore?.setBackdropMetricsTracking(container, enabled)
  }

  /** Returns the latest completed cached backdrop metrics for a tracked container. */
  getBackdropMetrics(container: Container) {
    return this.core?.getBackdropMetrics(container) ?? this.glCore?.getBackdropMetrics(container) ?? null
  }

  /** How an Html node's pixels are produced: live DOM, media, snapshot or overlay. */
  getContentMode(html: Html) {
    return this.content?.getContentMode(html) ?? null
  }

  /** Renders one frame if the renderer is initialized. */
  render() {
    if (this.destroyed) {
      return
    }

    if (this.initError) {
      throw this.initError
    }

    const layers = this.syncSceneNow()
    if (!this.initialized) {
      return
    }

    this.drawFrame(layers)
  }

  /** Tears down observers, event listeners, and GPU resources owned by this renderer. */
  destroy() {
    if (this.destroyed) {
      return
    }

    this.destroyed = true
    this.targetCanvas.removeEventListener('paint', this.handlePaintEvent as EventListener)
    for (const target of [this.targetCanvas, this.overlay] as HTMLElement[]) {
      target.removeEventListener('pointermove', this.pointerController.handlePointerMove, true)
      target.removeEventListener('pointerdown', this.pointerController.handlePointerDown, true)
      target.removeEventListener('pointerup', this.pointerController.handlePointerUp, true)
      target.removeEventListener('pointercancel', this.pointerController.handlePointerCancel, true)
    }
    this.targetCanvas.removeEventListener('pointerleave', this.pointerController.handlePointerLeave, true)
    this.unsubscribeSceneMutations?.()
    this.unsubscribeSceneMutations = null
    this.resizeObserver?.disconnect()
    this.overlay.remove()
    this.core?.destroy()
    this.core = null
    this.lastFrameTexture?.destroy()
    this.lastFrameTexture = null
    this.glCore?.destroy()
    this.glCore = null
    this.content?.destroy()
    this.content = null
    this.glContent = null
    this.pointerController.clear()
  }

  /** Picks a backend and creates its resources. */
  private async initialize(): Promise<GlassBackend> {
    const errors: string[] = []
    if (this.backendPreference !== 'webgl2') {
      try {
        if (await this.initializeWebGpu()) {
          return this.finishInitialization('webgpu')
        }
        errors.push('WebGPU: no adapter')
      } catch (error) {
        errors.push(`WebGPU: ${String(error)}`)
      }
    }
    if (this.destroyed) {
      throw new Error('Renderer destroyed during initialization.')
    }
    if (this.backendPreference !== 'webgpu') {
      try {
        this.initializeWebGl2()
        return this.finishInitialization('webgl2')
      } catch (error) {
        errors.push(`WebGL2: ${String(error)}`)
      }
    }
    throw new Error(`No glass backend is available (${errors.join('; ')}).`)
  }

  private async initializeWebGpu() {
    const gpuNavigator = navigator as Navigator & { gpu?: GPU }
    if (!gpuNavigator.gpu) {
      return false
    }

    const adapter = await gpuNavigator.gpu.requestAdapter()
    if (!adapter) {
      return false
    }

    const device = await adapter.requestDevice()
    const context = this.targetCanvas.getContext('webgpu') as GPUCanvasContext | null
    if (!context) {
      throw new Error('Unable to acquire a WebGPU canvas context.')
    }

    const presentationFormat = gpuNavigator.gpu.getPreferredCanvasFormat()
    this.device = device
    this.context = context
    this.presentationFormat = presentationFormat
    this.core = new WebGpuGlassCore({ device, format: presentationFormat })
    const domContent = new DomContentSync({
      targetCanvas: this.targetCanvas,
      getCurrentDpr: () => this.currentDpr,
      overlayRoot: this.overlay,
      onPixelsChanged: () => {
        this.queueSceneContentSync()
        this.onNeedsFrame?.()
      },
    })
    domContent.setDevice(device, presentationFormat)
    this.content = domContent
    return true
  }

  private initializeWebGl2() {
    const gl = this.targetCanvas.getContext('webgl2', GL_CONTEXT_ATTRIBUTES) as WebGL2RenderingContext | null
    if (!gl) {
      throw new Error('WebGL2 is not available.')
    }
    enableGlExtensions(gl)
    this.gl = gl
    this.glCore = new WebGl2GlassCore(gl)
    this.glContent = new WebGl2ContentSync({
      gl,
      targetCanvas: this.targetCanvas,
      overlayRoot: this.overlay,
      getCurrentDpr: () => this.currentDpr,
      onPixelsChanged: () => {
        this.queueSceneContentSync()
        this.onNeedsFrame?.()
      },
    })
    this.content = this.glContent
  }

  private finishInitialization(backend: GlassBackend) {
    this.activeBackend = backend
    this.targetCanvas.dataset.glassformBackend = backend
    this.initialized = true
    this.syncCanvasSize()

    this.resizeObserver = new ResizeObserver(() => {
      this.syncCanvasSize()
    })
    this.resizeObserver.observe(this.targetCanvas)
    this.queueSceneContentSync()
    return backend
  }

  /** Synchronizes canvas/backing texture dimensions with CSS size and DPR. */
  private syncCanvasSize() {
    const bounds = this.targetCanvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr)
    const nextWidth = Math.max(1, Math.round(bounds.width * dpr))
    const nextHeight = Math.max(1, Math.round(bounds.height * dpr))

    this.currentDpr = dpr

    if (this.gl) {
      if (this.targetCanvas.width !== nextWidth || this.targetCanvas.height !== nextHeight) {
        this.targetCanvas.width = nextWidth
        this.targetCanvas.height = nextHeight
      }
      this.syncSceneNow()
      return
    }

    if (!this.device || !this.context || !this.presentationFormat) {
      return
    }

    if (
      !this.canvasConfigured ||
      this.targetCanvas.width !== nextWidth ||
      this.targetCanvas.height !== nextHeight
    ) {
      const previousLastFrame = this.lastFrameTexture
      const previousWidth = this.targetCanvas.width
      const previousHeight = this.targetCanvas.height
      this.targetCanvas.width = nextWidth
      this.targetCanvas.height = nextHeight
      this.context.configure({
        device: this.device,
        format: this.presentationFormat,
        usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.COPY_SRC | GPU_TEXTURE_USAGE.COPY_DST,
        alphaMode: 'opaque',
      })
      this.canvasConfigured = true
      this.lastFrameTexture = createRenderTarget(this.device, this.presentationFormat, nextWidth, nextHeight)
      this.preservePreviousFrameAfterResize(previousLastFrame, previousWidth, previousHeight)
      previousLastFrame?.destroy()
    }

    this.syncSceneNow()
  }

  /** Paints the previous completed frame into the newly configured canvas target. */
  private preservePreviousFrameAfterResize(previousFrame: GPUTexture | null, previousWidth: number, previousHeight: number) {
    if (
      !previousFrame ||
      !this.device ||
      !this.context ||
      !this.lastFrameTexture ||
      previousWidth <= 0 ||
      previousHeight <= 0
    ) {
      return
    }

    const copyWidth = Math.min(previousWidth, this.targetCanvas.width)
    const copyHeight = Math.min(previousHeight, this.targetCanvas.height)
    const encoder = this.device.createCommandEncoder()
    const currentTexture = this.context.getCurrentTexture()
    const region = {
      sourceX: 0,
      sourceY: 0,
      destinationX: 0,
      destinationY: 0,
      width: copyWidth,
      height: copyHeight,
    }

    clearRenderTarget(encoder, this.lastFrameTexture)
    clearRenderTarget(encoder, currentTexture)
    copyTextureRegion(encoder, previousFrame, this.lastFrameTexture, region)
    copyTextureRegion(encoder, previousFrame, currentTexture, region)
    this.device.queue.submit([encoder.finish()])
  }

  /** Queues scene-derived DOM and pointer state synchronization on a microtask. */
  private queueSceneContentSync() {
    this.pendingSceneContentSync = true

    if (this.sceneContentSyncQueued || this.destroyed) {
      return
    }

    this.sceneContentSyncQueued = true
    queueMicrotask(() => {
      this.sceneContentSyncQueued = false

      if (this.destroyed || !this.pendingSceneContentSync) {
        return
      }

      this.syncSceneNow()
    })
  }

  /** Immediately synchronizes scene-derived DOM, content, and pointer caches. */
  private syncSceneNow() {
    const layers = getSortedSceneLayers(this.scene)
    const containers = getLayerContainers(layers)
    const hostOrder = getHtmlHostOrder(layers)

    this.pointerController.syncInteractions(containers)
    if (this.content) {
      this.content.sync(layers, containers, hostOrder)
      this.content.copyPending()
      this.syncOverlayPlacement()
    }

    this.pendingSceneContentSync = false
    return layers
  }

  /** Keeps the live-DOM overlay next to the canvas and over its box. */
  private syncOverlayPlacement() {
    const canvas = this.targetCanvas
    const overlay = this.overlay
    if (overlay.childElementCount === 0) {
      if (overlay.isConnected) {
        overlay.remove()
      }
      return
    }
    const parent = canvas.parentNode
    if (!parent) {
      return
    }
    if (overlay.previousSibling !== canvas || overlay.parentNode !== parent) {
      parent.insertBefore(overlay, canvas.nextSibling)
    }
    const left = `${canvas.offsetLeft + canvas.clientLeft}px`
    const top = `${canvas.offsetTop + canvas.clientTop}px`
    const width = `${canvas.clientWidth}px`
    const height = `${canvas.clientHeight}px`
    if (overlay.style.left !== left) overlay.style.left = left
    if (overlay.style.top !== top) overlay.style.top = top
    if (overlay.style.width !== width) overlay.style.width = width
    if (overlay.style.height !== height) overlay.style.height = height
    const zIndex = getComputedStyle(canvas).zIndex
    if (zIndex !== 'auto' && overlay.style.zIndex !== zIndex) overlay.style.zIndex = zIndex
  }

  /** Flushes any queued scene content synchronization before pointer work. */
  private flushSceneContentSync() {
    if (this.pendingSceneContentSync) {
      this.syncSceneNow()
    }
  }

  /** Draws a complete frame for the provided sorted scene layers. */
  private drawFrame(layers = getSortedSceneLayers(this.scene)) {
    if (this.destroyed || this.targetCanvas.width <= 0 || this.targetCanvas.height <= 0) {
      return
    }

    if (this.glCore && this.gl) {
      this.glCore.render({
        layers,
        width: this.targetCanvas.width,
        height: this.targetCanvas.height,
        dpr: this.currentDpr,
        output: null,
        contentSource: this.glContent,
      })
      return
    }

    if (!this.context || !this.core || !this.device || !this.lastFrameTexture) {
      return
    }

    this.core.render({
      layers,
      width: this.targetCanvas.width,
      height: this.targetCanvas.height,
      dpr: this.currentDpr,
      outputTexture: this.lastFrameTexture,
      contentSource: this.content as DomContentSync,
    })

    const encoder = this.device.createCommandEncoder()
    copyTextureRegion(encoder, this.lastFrameTexture, this.context.getCurrentTexture(), {
      sourceX: 0,
      sourceY: 0,
      destinationX: 0,
      destinationY: 0,
      width: this.targetCanvas.width,
      height: this.targetCanvas.height,
    })
    this.device.queue.submit([encoder.finish()])
  }
}
