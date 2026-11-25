import { Scene, type Glass, type Html } from '../../scene'
import { prepareDrawableCanvas } from '../html-in-canvas'
import { createOverlay, placeOverlay } from '../overlay'
import { getHtmlHostOrder, getLayerContainers, getSortedSceneLayers } from '../scene-order'
import { WebGl2ContentSync } from './content-sync'
import type { WebGl2GlassContentSource } from './core'

/** Constructor options for {@link WebGl2DomContentSource}. */
export type WebGl2DomContentSourceInit = {
  gl: WebGL2RenderingContext
  targetCanvas: HTMLCanvasElement
  getCurrentDpr: () => number
  scene?: Scene
  onPixelsChanged?: () => void
}

/**
 * Content source for hosts that run {@link WebGl2GlassCore} on their own
 * WebGL2 context (Three.js WebGLRenderer, R3F). Mirrors WebGpuDomContentSource.
 */
export class WebGl2DomContentSource implements WebGl2GlassContentSource {
  readonly scene: Scene | null
  readonly overlay: HTMLDivElement
  private readonly targetCanvas: HTMLCanvasElement
  private readonly content: WebGl2ContentSync
  private destroyed = false

  private readonly handlePaintEvent = () => {
    if (!this.destroyed) {
      this.content.handlePaintEvent()
    }
  }

  constructor({ gl, targetCanvas, getCurrentDpr, scene, onPixelsChanged }: WebGl2DomContentSourceInit) {
    this.targetCanvas = targetCanvas
    this.scene = scene ?? null
    this.overlay = createOverlay()
    this.content = new WebGl2ContentSync({
      gl,
      targetCanvas,
      overlayRoot: this.overlay,
      getCurrentDpr,
      onPixelsChanged: () => onPixelsChanged?.(),
    })
    prepareDrawableCanvas(targetCanvas)
    targetCanvas.addEventListener('paint', this.handlePaintEvent)
  }

  get atlasTexture() {
    return this.content.atlasTexture
  }

  get contentEntriesTexture() {
    return this.content.contentEntriesTexture
  }

  /** Synchronizes DOM hosts and uploads pending pixels. */
  sync(scene = this.scene) {
    if (!scene) {
      throw new Error('WebGl2DomContentSource.sync requires a scene.')
    }
    const layers = getSortedSceneLayers(scene)
    this.content.sync(layers, getLayerContainers(layers), getHtmlHostOrder(layers))
    this.content.copyPending()
    placeOverlay(this.targetCanvas, this.overlay)
    return layers
  }

  getSceneHtmlEntry(html: Html) {
    return this.content.getSceneHtmlEntry(html)
  }

  getGlassContentRange(glass: Glass) {
    return this.content.getGlassContentRange(glass)
  }

  getContentMode(html: Html) {
    return this.content.getContentMode(html)
  }

  destroy() {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    this.targetCanvas.removeEventListener('paint', this.handlePaintEvent)
    this.content.destroy()
    this.overlay.remove()
  }
}
