import type { Matrix2D } from '../matrix'

/**
 * Compatibility layer for the WICG HTML-in-Canvas API.
 *
 * Chromium 159 ships the API without a flag, under the names in the current
 * spec: `<canvas content="drawable">`, a `drawable` attribute on each child,
 * `GPUQueue.drawElementImageToTexture`, `CanvasRenderingContext2D.drawElementImage`
 * and `HTMLCanvasElement.updateElementGeometry`. Earlier Chrome builds behind
 * `chrome://flags/#canvas-draw-element` used `layoutsubtree` and
 * `GPUQueue.copyElementImageToTexture`. Both are supported here.
 */

type GpuQueueWithElementDraw = GPUQueue & {
  drawElementImageToTexture?: (
    source: { source: Element },
    destination: { texture: GPUTexture; size?: GPUExtent3D },
  ) => void
  copyElementImageToTexture?: (
    source: { source: Element },
    destination: { destination: { texture: GPUTexture }; width: number; height: number },
  ) => void
}

type CanvasWithElementGeometry = HTMLCanvasElement & {
  updateElementGeometry?: (element: Element, options?: { canvasTransform?: DOMMatrixInit }) => void
  requestPaint?: () => void
}

type ContextWithDrawElement = CanvasRenderingContext2D & {
  drawElementImage?: (element: Element, dx: number, dy: number, dw?: number, dh?: number) => void
}

/** Which HTML-in-Canvas variant the current browser exposes, if any. */
export type HtmlInCanvasSupport = {
  /** The browser lays out canvas children and fires paint events. */
  available: boolean
  /** WebGPU can copy a child element straight into a texture. */
  webgpu: boolean
  /** A 2D context can draw a child element (used to feed WebGL2). */
  canvas2d: boolean
}

let cachedSupport: HtmlInCanvasSupport | null = null

/** Detects HTML-in-Canvas support by feature, never by user agent. */
export function detectHtmlInCanvas(): HtmlInCanvasSupport {
  if (cachedSupport) {
    return cachedSupport
  }

  if (typeof HTMLCanvasElement === 'undefined') {
    cachedSupport = { available: false, webgpu: false, canvas2d: false }
    return cachedSupport
  }

  const queueProto = typeof GPUQueue === 'undefined' ? null : (GPUQueue.prototype as GpuQueueWithElementDraw)
  const webgpu = Boolean(
    queueProto && ('drawElementImageToTexture' in queueProto || 'copyElementImageToTexture' in queueProto),
  )
  const canvas2d =
    typeof CanvasRenderingContext2D !== 'undefined' && 'drawElementImage' in CanvasRenderingContext2D.prototype
  const available = 'requestPaint' in HTMLCanvasElement.prototype || webgpu || canvas2d
  cachedSupport = { available, webgpu, canvas2d }
  return cachedSupport
}

/** Test hook: forget the cached detection result. */
export function resetHtmlInCanvasDetection() {
  cachedSupport = null
}

/**
 * Whether drawable children are positioned with `updateElementGeometry`
 * (current spec). In that API the element is drawn with its CSS transform
 * applied, so hosts must not carry one; older builds used CSS transforms.
 */
export function usesElementGeometry() {
  return typeof HTMLCanvasElement !== 'undefined' && 'updateElementGeometry' in HTMLCanvasElement.prototype
}

/** Opts a canvas into laying out (but not painting) its children. */
export function prepareDrawableCanvas(canvas: HTMLCanvasElement) {
  canvas.setAttribute('layoutsubtree', 'true')
  canvas.setAttribute('content', 'drawable')
}

/** Marks a canvas child as drawable. */
export function prepareDrawableChild(element: HTMLElement) {
  element.setAttribute('drawable', '')
}

/** Copies one drawable child into a WebGPU texture with whichever API exists. */
export function drawElementToGpuTexture(
  queue: GPUQueue,
  source: Element,
  width: number,
  height: number,
  texture: GPUTexture,
) {
  const q = queue as GpuQueueWithElementDraw
  if (q.drawElementImageToTexture) {
    q.drawElementImageToTexture({ source }, { texture, size: { width, height } })
    return
  }
  if (q.copyElementImageToTexture) {
    q.copyElementImageToTexture({ source }, { destination: { texture }, width, height })
    return
  }
  throw new DOMException('HTML-in-Canvas is not available', 'InvalidStateError')
}

/** Draws one drawable child into a 2D context at device-pixel size. */
export function drawElementTo2d(
  context: CanvasRenderingContext2D,
  source: Element,
  width: number,
  height: number,
) {
  const c = context as ContextWithDrawElement
  if (!c.drawElementImage) {
    throw new DOMException('HTML-in-Canvas 2D drawing is not available', 'InvalidStateError')
  }
  c.drawElementImage(source, 0, 0, width, height)
}

/**
 * Tells the browser where a drawable child appears on the canvas so hit
 * testing and accessibility follow the rendered position. `transform` maps the
 * element's local CSS pixels to canvas CSS pixels. Chromium 159 reads the
 * canvas transform in CSS pixels of the canvas box (verified at DPR 1 and 2),
 * so the device pixel ratio is not applied.
 */
export function updateDrawableGeometry(canvas: HTMLCanvasElement, element: Element, transform: Matrix2D, _dpr?: number) {
  const c = canvas as CanvasWithElementGeometry
  if (!c.updateElementGeometry) {
    return
  }
  try {
    c.updateElementGeometry(element, {
      canvasTransform: { a: transform.a, b: transform.b, c: transform.c, d: transform.d, e: transform.e, f: transform.f },
    })
  } catch {
    // The element may not have been laid out yet; the next sync retries.
  }
}

/** Asks the browser for a paint event on the next rendering opportunity. */
export function requestCanvasPaint(canvas: HTMLCanvasElement) {
  ;(canvas as CanvasWithElementGeometry).requestPaint?.()
}
