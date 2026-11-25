import type { Page } from '@playwright/test'

/** Collects page errors and console errors for a test. */
export function trackErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

/** Reads RGBA pixels of the first canvas via a screenshot (works for WebGPU and WebGL). */
export async function canvasPixels(page: Page) {
  const buffer = await page.locator('canvas').first().screenshot()
  const { PNG } = await import('pngjs')
  const png = PNG.sync.read(buffer)
  return { width: png.width, height: png.height, data: png.data }
}

/** Mean absolute RGB difference between two equally sized regions. */
export function meanDiff(a: Uint8Array, b: Uint8Array) {
  let sum = 0
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
  }
  return sum / ((a.length / 4) * 3)
}

/** Whether this browser exposes a WebGPU adapter (CI runners often do not). */
export async function hasWebGpuAdapter(page: Page) {
  return page.evaluate(async () => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu
    return Boolean(gpu && (await gpu.requestAdapter()))
  })
}

/** Skips GPU tests where the browser has no WebGL2 (e.g. Firefox on GPU-less CI runners). */
export async function skipWithoutWebGl2(page: Page, skip: (condition: boolean, reason: string) => void) {
  await page.goto('/e2e/probe.html')
  const webgl2 = await page.evaluate(() => Boolean(document.createElement('canvas').getContext('webgl2')))
  skip(!webgl2, 'this browser has no WebGL2 here (no GPU); the renderer correctly reports no backend')
}
