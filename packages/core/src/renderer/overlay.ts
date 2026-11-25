/**
 * Live-DOM overlay used where the browser cannot draw HTML into a canvas:
 * a positioned sibling of the canvas that holds `overlay` mode Html hosts.
 */

/** Creates an empty overlay element. */
export function createOverlay() {
  const overlay = document.createElement('div')
  overlay.dataset.glassformOverlay = ''
  overlay.style.cssText = 'position:absolute;pointer-events:none;overflow:hidden;contain:layout'
  return overlay
}

/** Keeps the overlay next to the canvas and over its box (removed when empty). */
export function placeOverlay(canvas: HTMLCanvasElement, overlay: HTMLElement) {
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
