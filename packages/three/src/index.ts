import {
  Scene,
  WebGl2GlassCore,
  WebGpuGlassCore,
  type WebGl2GlassContentSource,
  type WebGpuGlassContentSource,
  type WebGpuGlassCoreRenderOptions,
} from '@glassform/core'
import {
  Vector2,
  type Camera,
  type Object3D,
  type RenderTarget,
  type Texture,
} from 'three'

export type ThreeWebGpuBackend = {
  isWebGPUBackend?: boolean
  device?: GPUDevice
  utils?: {
    getPreferredCanvasFormat?: () => GPUTextureFormat
  }
  get?: (object: object) => {
    texture?: GPUTexture
  }
}

export type ThreeWebGpuBackendReady = ThreeWebGpuBackend & {
  isWebGPUBackend: true
  device: GPUDevice
}

export type ThreeWebGpuRenderer = {
  backend?: unknown
  getContext: () => unknown
  getDrawingBufferSize: (target: Vector2) => Vector2
  getPixelRatio: () => number
}

export type ThreeWebGpuRenderTargetRenderer = ThreeWebGpuRenderer & {
  domElement: HTMLCanvasElement
  render: (scene: Object3D, camera: Camera) => void
  setRenderTarget: (target: RenderTarget | null) => void
}

export type ThreeWebGpuRendererValidationOptions = {
  owner?: string
  help?: string
}

type ThreeBackdrop = GPUTexture | WebGLTexture | RenderTarget | Texture

/** Which GPU path a Three renderer gives the glass core. */
export type ThreeGlassBackendKind = 'webgpu' | 'webgl2'

type ThreeGlRendererCandidate = {
  isWebGLRenderer?: boolean
  getContext?: () => unknown
  properties?: { get: (object: object) => { __webglTexture?: WebGLTexture } }
  resetState?: () => void
  backend?: {
    isWebGLBackend?: boolean
    isWebGPUBackend?: boolean
    gl?: WebGL2RenderingContext
    state?: object
    get?: (object: object) => { textureGPU?: WebGLTexture }
  }
}

/**
 * Detects whether a Three renderer runs on WebGPU or on WebGL2: a classic
 * WebGLRenderer, or a WebGPURenderer that fell back to its WebGL backend.
 */
export function detectThreeGlassBackend(renderer: unknown): ThreeGlassBackendKind | null {
  const candidate = renderer as ThreeGlRendererCandidate | null
  if (!candidate || typeof candidate !== 'object') {
    return null
  }
  if (candidate.backend?.isWebGPUBackend) {
    return 'webgpu'
  }
  if (candidate.backend?.isWebGLBackend) {
    return 'webgl2'
  }
  if (candidate.isWebGLRenderer) {
    return 'webgl2'
  }
  return null
}

/** Returns the WebGL2 context of a Three WebGL renderer (classic or fallback). */
export function requireThreeWebGl2Context(renderer: unknown) {
  const candidate = renderer as ThreeGlRendererCandidate
  const context = candidate.backend?.gl ?? candidate.getContext?.()
  if (typeof WebGL2RenderingContext === 'undefined' || !(context instanceof WebGL2RenderingContext)) {
    throw new Error('ThreeGlassRenderer requires a WebGL2 context for the WebGL path.')
  }
  return context
}

export type ThreeGlassRendererInit = {
  renderer: ThreeWebGpuRenderer | object
  scene?: Scene
  format?: GPUTextureFormat
  contentSource?: WebGpuGlassContentSource | WebGl2GlassContentSource | null
}

export type ThreeGlassRenderOptions = {
  scene?: Scene
  backdrop: ThreeBackdrop
  contentSource?: WebGpuGlassContentSource | WebGl2GlassContentSource | null
  outputTexture?: GPUTexture
  width?: number
  height?: number
  dpr?: number
}

function isGpuTexture(value: ThreeBackdrop): value is GPUTexture {
  return typeof (value as GPUTexture).createView === 'function'
}

function isGlTexture(value: ThreeBackdrop): value is WebGLTexture {
  return typeof WebGLTexture !== 'undefined' && value instanceof WebGLTexture
}

function getRenderTargetTexture(renderTarget: RenderTarget) {
  const textures = (renderTarget as RenderTarget & { textures?: Texture[] }).textures
  return textures?.[0] ?? renderTarget.texture
}

function createRendererError(message: string, options: ThreeWebGpuRendererValidationOptions = {}) {
  const owner = options.owner ?? 'ThreeGlassRenderer'
  const suffix = options.help ? ` ${options.help}` : ''
  return new Error(`${owner} ${message}.${suffix}`)
}

function getRendererCandidate(renderer: unknown, options?: ThreeWebGpuRendererValidationOptions) {
  if (!renderer || typeof renderer !== 'object') {
    throw createRendererError('requires a Three renderer instance', options)
  }

  return renderer as Partial<ThreeWebGpuRenderTargetRenderer>
}

/** Returns the initialized WebGPU backend from a Three WebGPU renderer. */
export function requireThreeWebGpuBackend(
  renderer: unknown,
  options?: ThreeWebGpuRendererValidationOptions,
): ThreeWebGpuBackendReady {
  const candidate = getRendererCandidate(renderer, options)
  const backend = candidate.backend as ThreeWebGpuBackend | undefined
  if (!backend?.isWebGPUBackend || !backend.device) {
    throw createRendererError('requires Three.WebGPURenderer with the WebGPU backend', options)
  }

  return backend as ThreeWebGpuBackendReady
}

/** Validates the base methods needed to host liquid glass in a Three WebGPU renderer. */
export function requireThreeWebGpuRenderer(
  renderer: unknown,
  options?: ThreeWebGpuRendererValidationOptions,
): ThreeWebGpuRenderer {
  const candidate = getRendererCandidate(renderer, options)
  requireThreeWebGpuBackend(candidate, options)

  if (
    typeof candidate.getContext !== 'function' ||
    typeof candidate.getDrawingBufferSize !== 'function' ||
    typeof candidate.getPixelRatio !== 'function'
  ) {
    throw createRendererError('received a renderer that is missing required Three renderer methods', options)
  }

  return candidate as ThreeWebGpuRenderer
}

/** Returns the configured canvas context from a Three WebGPU renderer. */
export function requireThreeWebGpuCanvasContext(
  renderer: unknown,
  options?: ThreeWebGpuRendererValidationOptions,
) {
  const candidate = requireThreeWebGpuRenderer(renderer, options)
  const context = candidate.getContext()
  if (!context || typeof (context as GPUCanvasContext).getCurrentTexture !== 'function') {
    throw createRendererError('requires a renderer backed by a configured GPUCanvasContext', options)
  }

  return context as GPUCanvasContext
}

/** Validates the renderer methods needed to capture and composite an R3F scene. */
export function requireThreeWebGpuRenderTargetRenderer(
  renderer: unknown,
  options?: ThreeWebGpuRendererValidationOptions,
): ThreeWebGpuRenderTargetRenderer {
  const candidate = requireThreeWebGpuRenderer(renderer, options) as Partial<ThreeWebGpuRenderTargetRenderer>
  requireThreeWebGpuCanvasContext(candidate, options)

  if (
    !candidate.domElement ||
    typeof candidate.render !== 'function' ||
    typeof candidate.setRenderTarget !== 'function'
  ) {
    throw createRendererError('received a renderer that is missing required render-target methods', options)
  }

  return candidate as ThreeWebGpuRenderTargetRenderer
}

/**
 * Hosts the liquid-glass core inside a Three renderer: the WebGPU core for
 * WebGPURenderer, the WebGL2 core for WebGLRenderer or WebGPURenderer's
 * WebGL fallback. Both draw the same image.
 */
export class ThreeGlassRenderer {
  readonly scene: Scene

  private readonly renderer: ThreeWebGpuRenderer
  private readonly formatOverride: GPUTextureFormat | null
  private readonly contentSource: WebGpuGlassContentSource | WebGl2GlassContentSource | null
  private core: WebGpuGlassCore | null = null
  private glCore: WebGl2GlassCore | null = null
  private readonly drawingSize = new Vector2()

  constructor({ renderer, scene, format, contentSource }: ThreeGlassRendererInit) {
    this.renderer = renderer as ThreeWebGpuRenderer
    this.scene = scene ?? new Scene()
    this.formatOverride = format ?? null
    this.contentSource = contentSource ?? null
  }

  /** Raw WebGPU device owned by Three's WebGPU backend. */
  get device() {
    return requireThreeWebGpuBackend(this.renderer).device
  }

  /** Preferred output format used by Three's WebGPU backend. */
  get format() {
    const backend = requireThreeWebGpuBackend(this.renderer)
    return (
      this.formatOverride ??
      backend?.utils?.getPreferredCanvasFormat?.() ??
      navigator.gpu.getPreferredCanvasFormat()
    )
  }

  /** Returns Three's raw GPU texture for a render target, texture, or GPU texture. */
  getGpuTexture(backdrop: ThreeBackdrop) {
    if (isGpuTexture(backdrop)) {
      return backdrop
    }

    const backend = requireThreeWebGpuBackend(this.renderer)
    const texture = 'isRenderTarget' in backdrop && backdrop.isRenderTarget
      ? getRenderTargetTexture(backdrop)
      : backdrop
    const gpuTexture = backend.get?.(texture)?.texture
    if (!gpuTexture) {
      throw new Error('Unable to resolve a GPUTexture from the provided Three texture. Render or initialize it first.')
    }
    return gpuTexture
  }

  /** GPU path used for this renderer. */
  get backend(): ThreeGlassBackendKind {
    const kind = detectThreeGlassBackend(this.renderer)
    if (!kind) {
      throw new Error('ThreeGlassRenderer requires a Three WebGLRenderer or WebGPURenderer.')
    }
    return kind
  }

  /** Resolves the raw WebGLTexture behind a Three render target or texture. */
  getGlTexture(backdrop: ThreeBackdrop): WebGLTexture {
    if (isGlTexture(backdrop)) {
      return backdrop
    }
    if (isGpuTexture(backdrop)) {
      throw new Error('A GPUTexture cannot be used as a backdrop on the WebGL path.')
    }
    // WebGLTexture is an empty interface in TypeScript, so narrowing collapses; cast back.
    const threeObject = backdrop as unknown as RenderTarget | Texture
    const texture = 'isRenderTarget' in threeObject && threeObject.isRenderTarget
      ? getRenderTargetTexture(threeObject)
      : (threeObject as Texture)
    const candidate = this.renderer as unknown as ThreeGlRendererCandidate
    const glTexture = candidate.properties?.get(texture).__webglTexture ?? candidate.backend?.get?.(texture)?.textureGPU
    if (!glTexture) {
      throw new Error('Unable to resolve a WebGLTexture from the provided Three texture. Render it first.')
    }
    return glTexture
  }

  /** Renders liquid glass over a Three-rendered backdrop texture. */
  render(options: ThreeGlassRenderOptions) {
    if (this.backend === 'webgl2') {
      this.renderWebGl2(options)
      return
    }
    const backend = requireThreeWebGpuBackend(this.renderer)
    const core = this.ensureCore(backend)
    const size = this.getOutputSize(options)

    core.render({
      scene: options.scene ?? this.scene,
      backdropTexture: this.getGpuTexture(options.backdrop),
      contentSource: (options.contentSource ?? this.contentSource) as WebGpuGlassContentSource | null,
      outputTexture: options.outputTexture ?? requireThreeWebGpuCanvasContext(this.renderer).getCurrentTexture(),
      width: size.width,
      height: size.height,
      dpr: options.dpr ?? this.renderer.getPixelRatio(),
    } satisfies WebGpuGlassCoreRenderOptions)
  }

  /** Releases GPU resources owned by the adapter. */
  destroy() {
    this.core?.destroy()
    this.core = null
    this.glCore?.destroy()
    this.glCore = null
  }

  private renderWebGl2(options: ThreeGlassRenderOptions) {
    const gl = requireThreeWebGl2Context(this.renderer)
    this.glCore ??= new WebGl2GlassCore(gl)
    const size = this.getOutputSize(options)
    const backdrop = this.getGlTexture(options.backdrop)
    try {
      this.glCore.render({
        scene: options.scene ?? this.scene,
        width: size.width,
        height: size.height,
        dpr: options.dpr ?? this.renderer.getPixelRatio(),
        output: null,
        backdropTexture: backdrop,
        // Three renders targets with the first row at the bottom.
        backdropFlipY: true,
        contentSource: (options.contentSource ?? this.contentSource) as WebGl2GlassContentSource | null,
      })
    } finally {
      this.resetThreeState()
    }
  }

  /** Tells Three that the GL state changed behind its back. */
  private resetThreeState() {
    const candidate = this.renderer as unknown as ThreeGlRendererCandidate
    if (candidate.isWebGLRenderer) {
      candidate.resetState?.()
      return
    }
    const backend = candidate.backend
    if (backend?.isWebGLBackend && backend.state) {
      // The WebGPURenderer WebGL backend has no reset(); a fresh state object
      // re-reads the viewport and clears every cached binding.
      const State = backend.state.constructor as new (owner: unknown) => object
      backend.state = new State(backend)
    }
  }

  private ensureCore(backend: ThreeWebGpuBackendReady) {
    if (!this.core) {
      this.core = new WebGpuGlassCore({
        device: backend.device,
        format: this.format,
      })
    }
    return this.core
  }

  private getOutputSize(options: ThreeGlassRenderOptions) {
    if (options.width && options.height) {
      return {
        width: Math.max(1, Math.floor(options.width)),
        height: Math.max(1, Math.floor(options.height)),
      }
    }

    const size = this.renderer.getDrawingBufferSize(this.drawingSize)
    return {
      width: Math.max(1, Math.floor(size.x)),
      height: Math.max(1, Math.floor(size.y)),
    }
  }
}
