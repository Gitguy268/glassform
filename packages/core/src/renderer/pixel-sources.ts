import type { Html, HtmlFit, HtmlPixelSource } from '../scene'

/**
 * How the renderer gets pixels for one {@link Html} node.
 *
 * - `element`: live DOM through HTML-in-Canvas (Chromium).
 * - `media`: an image, video, canvas or bitmap, in every browser.
 * - `snapshot`: the DOM rasterised with modern-screenshot. Not live: it is
 *   redone when the DOM mutates or `html.refresh()` is called.
 * - `overlay`: the DOM is shown as-is on top of the canvas and is not
 *   sampled by the glass.
 */
export type HtmlContentMode = 'element' | 'media' | 'snapshot' | 'overlay'

/** Pixels ready to upload into a backend texture. */
export type PixelFrame = {
  image: HTMLCanvasElement
  width: number
  height: number
  /** Increments every time the pixels change. */
  serial: number
}

/** Returns the media source an Html node displays, if any. */
export function getHtmlMediaSource(html: Html): HtmlPixelSource | null {
  if (html.source) {
    return html.source
  }
  const element = html.element
  if (
    typeof HTMLImageElement !== 'undefined' &&
    (element instanceof HTMLImageElement || element instanceof HTMLVideoElement || element instanceof HTMLCanvasElement)
  ) {
    return element
  }
  return null
}

/** Chooses the content mode for an Html node. */
export function resolveHtmlContentMode(
  html: Html,
  { elementDraw, glassContent }: { elementDraw: boolean; glassContent: boolean },
): HtmlContentMode {
  if (getHtmlMediaSource(html)) {
    return 'media'
  }
  if (elementDraw) {
    return 'element'
  }
  if (html.fallback === 'snapshot') {
    return 'snapshot'
  }
  if (html.fallback === 'overlay') {
    return 'overlay'
  }
  return glassContent ? 'overlay' : 'snapshot'
}

function mediaSize(source: HtmlPixelSource) {
  if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight }
  }
  if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight }
  }
  return { width: source.width, height: source.height }
}

function isMediaReady(source: HtmlPixelSource) {
  if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
    return source.readyState >= 2
  }
  if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
    return source.complete && source.naturalWidth > 0
  }
  const size = mediaSize(source)
  return size.width > 0 && size.height > 0
}

/** Source rectangle that fits `source` into a `width` x `height` box. */
export function fitRect(sourceWidth: number, sourceHeight: number, width: number, height: number, fit: HtmlFit) {
  if (fit === 'fill' || sourceWidth <= 0 || sourceHeight <= 0 || width <= 0 || height <= 0) {
    return { sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight, dx: 0, dy: 0, dw: width, dh: height }
  }
  const sourceAspect = sourceWidth / sourceHeight
  const boxAspect = width / height
  if (fit === 'cover') {
    if (sourceAspect > boxAspect) {
      const sw = sourceHeight * boxAspect
      return { sx: (sourceWidth - sw) / 2, sy: 0, sw, sh: sourceHeight, dx: 0, dy: 0, dw: width, dh: height }
    }
    const sh = sourceWidth / boxAspect
    return { sx: 0, sy: (sourceHeight - sh) / 2, sw: sourceWidth, sh, dx: 0, dy: 0, dw: width, dh: height }
  }
  if (sourceAspect > boxAspect) {
    const dh = width / sourceAspect
    return { sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight, dx: 0, dy: (height - dh) / 2, dw: width, dh }
  }
  const dw = height * sourceAspect
  return { sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight, dx: (width - dw) / 2, dy: 0, dw, dh: height }
}

type CacheEntry = {
  canvas: HTMLCanvasElement
  serial: number
  version: number
  width: number
  height: number
  mediaTime: number
  // snapshot state
  snapshotPending: boolean
  snapshotDirty: boolean
  snapshotReady: boolean
  observer: MutationObserver | null
  loadListener: ((event: Event) => void) | null
  loadTarget: HTMLElement | null
  media: HtmlPixelSource | null
  mediaListener: (() => void) | null
}

type DomToCanvas = (node: Node, options: Record<string, unknown>) => Promise<HTMLCanvasElement>
let domToCanvasPromise: Promise<DomToCanvas> | null = null

function loadDomToCanvas() {
  domToCanvasPromise ??= import('modern-screenshot').then((module) => module.domToCanvas as unknown as DomToCanvas)
  return domToCanvasPromise
}

/**
 * Produces device-pixel canvases for media and snapshot Html nodes. Shared by
 * the WebGPU and WebGL2 backends, which upload `frame().image` when its
 * serial changes.
 */
export class PixelSourceCache {
  private readonly entries = new Map<Html, CacheEntry>()
  private destroyed = false

  /** `onChange` runs when async pixels (snapshots, image loads) become ready. */
  constructor(private readonly onChange: () => void) {}

  /** Whether any cached source can change without a scene mutation. */
  get hasLiveSources() {
    for (const entry of this.entries.values()) {
      const media = entry.media
      if (
        media &&
        ((typeof HTMLVideoElement !== 'undefined' && media instanceof HTMLVideoElement) ||
          (typeof HTMLCanvasElement !== 'undefined' && media instanceof HTMLCanvasElement) ||
          (typeof OffscreenCanvas !== 'undefined' && media instanceof OffscreenCanvas))
      ) {
        return true
      }
    }
    return false
  }

  /** Returns current pixels for a node, or null while they are not ready. */
  frame(html: Html, mode: 'media' | 'snapshot', width: number, height: number): PixelFrame | null {
    if (this.destroyed || width <= 0 || height <= 0) {
      return null
    }
    const entry = this.getEntry(html)
    const resized = entry.width !== width || entry.height !== height
    if (resized) {
      entry.width = width
      entry.height = height
      entry.canvas.width = width
      entry.canvas.height = height
    }

    if (mode === 'media') {
      this.detachSnapshot(entry)
      return this.mediaFrame(html, entry, resized)
    }

    this.detachMedia(entry)
    return this.snapshotFrame(html, entry, resized)
  }

  /** Forgets one node and stops observing it. */
  release(html: Html) {
    const entry = this.entries.get(html)
    if (!entry) {
      return
    }
    this.detachSnapshot(entry)
    this.detachMedia(entry)
    entry.canvas.width = 0
    entry.canvas.height = 0
    this.entries.delete(html)
  }

  /** Releases every node. */
  destroy() {
    this.destroyed = true
    for (const html of [...this.entries.keys()]) {
      this.release(html)
    }
  }

  private getEntry(html: Html) {
    let entry = this.entries.get(html)
    if (!entry) {
      entry = {
        canvas: document.createElement('canvas'),
        serial: 0,
        version: -1,
        width: 0,
        height: 0,
        mediaTime: -1,
        snapshotPending: false,
        snapshotDirty: true,
        snapshotReady: false,
        observer: null,
        loadListener: null,
        loadTarget: null,
        media: null,
        mediaListener: null,
      }
      this.entries.set(html, entry)
    }
    return entry
  }

  private mediaFrame(html: Html, entry: CacheEntry, resized: boolean): PixelFrame | null {
    const source = getHtmlMediaSource(html)
    if (!source) {
      return null
    }
    if (entry.media !== source) {
      this.detachMedia(entry)
      entry.media = source
      entry.mediaTime = -1
      if (typeof HTMLImageElement !== 'undefined' && (source instanceof HTMLImageElement || source instanceof HTMLVideoElement)) {
        const listener = () => {
          entry.version = -1
          this.onChange()
        }
        source.addEventListener(source instanceof HTMLImageElement ? 'load' : 'loadeddata', listener)
        entry.mediaListener = listener
      }
    }
    if (!isMediaReady(source)) {
      return entry.serial > 0 ? this.toFrame(entry) : null
    }

    let changed = resized || entry.version !== html._elementVersion
    if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
      if (source.currentTime !== entry.mediaTime) {
        entry.mediaTime = source.currentTime
        changed = true
      }
    } else if (
      (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) ||
      (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas)
    ) {
      // Canvases have no change signal, so redraw them every frame.
      changed = true
    }

    if (changed) {
      entry.version = html._elementVersion
      const context = entry.canvas.getContext('2d')
      if (!context) {
        return null
      }
      const size = mediaSize(source)
      const rect = fitRect(size.width, size.height, entry.width, entry.height, html.fit)
      context.clearRect(0, 0, entry.width, entry.height)
      context.imageSmoothingQuality = 'high'
      context.drawImage(source as CanvasImageSource, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh)
      entry.serial += 1
    }
    return this.toFrame(entry)
  }

  private snapshotFrame(html: Html, entry: CacheEntry, resized: boolean): PixelFrame | null {
    if (!entry.observer && typeof MutationObserver !== 'undefined') {
      const markDirty = () => {
        entry.snapshotDirty = true
        this.onChange()
      }
      entry.observer = new MutationObserver(markDirty)
      entry.observer.observe(html.host, { subtree: true, childList: true, attributes: true, characterData: true })
      entry.loadListener = markDirty
      entry.loadTarget = html.host
      html.host.addEventListener('load', markDirty, true)
    }
    if (resized || entry.version !== html._elementVersion) {
      entry.version = html._elementVersion
      entry.snapshotDirty = true
    }
    if (entry.snapshotDirty && !entry.snapshotPending) {
      entry.snapshotDirty = false
      entry.snapshotPending = true
      const width = entry.width
      const height = entry.height
      void loadDomToCanvas()
        .then((domToCanvas) =>
          domToCanvas(html.host, {
            width: html.width,
            height: html.height,
            scale: width / Math.max(html.width, 1e-3),
            backgroundColor: null,
            style: { transform: 'none', left: '0', top: '0' },
          }),
        )
        .then((rendered) => {
          if (this.destroyed || !this.entries.has(html) || entry.width !== width || entry.height !== height) {
            return
          }
          const context = entry.canvas.getContext('2d')
          if (!context) {
            return
          }
          context.clearRect(0, 0, width, height)
          context.drawImage(rendered, 0, 0, width, height)
          entry.serial += 1
          entry.snapshotReady = true
        })
        .catch((error: unknown) => {
          console.warn('glassform: DOM snapshot failed', error)
        })
        .finally(() => {
          entry.snapshotPending = false
          this.onChange()
        })
    }
    return entry.snapshotReady ? this.toFrame(entry) : null
  }

  private toFrame(entry: CacheEntry): PixelFrame {
    return { image: entry.canvas, width: entry.width, height: entry.height, serial: entry.serial }
  }

  private detachSnapshot(entry: CacheEntry) {
    entry.observer?.disconnect()
    entry.observer = null
    if (entry.loadTarget && entry.loadListener) {
      entry.loadTarget.removeEventListener('load', entry.loadListener, true)
    }
    entry.loadTarget = null
    entry.loadListener = null
    entry.snapshotReady = false
    entry.snapshotDirty = true
  }

  private detachMedia(entry: CacheEntry) {
    const media = entry.media
    if (media && entry.mediaListener && typeof HTMLElement !== 'undefined' && media instanceof HTMLElement) {
      media.removeEventListener('load', entry.mediaListener)
      media.removeEventListener('loadeddata', entry.mediaListener)
    }
    entry.media = null
    entry.mediaListener = null
  }
}
