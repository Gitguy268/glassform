import { expect, test } from '@playwright/test'
import { canvasPixels, skipWithoutWebGl2, trackErrors } from './helpers'

test('Three.js WebGLRenderer: glass composites over the 3D scene', async ({ page }) => {
  await skipWithoutWebGl2(page, test.skip)
  const errors = trackErrors(page)
  await page.goto('/e2e/pages/three.html')
  await page.waitForFunction(() => (window as unknown as { __frames?: number }).__frames! > 5)
  expect(await page.evaluate(() => (window as unknown as { __tier: string }).__tier)).toBe('webgl2')
  const { width, data } = await canvasPixels(page)
  // The glass interior (centre of the capsule) is not the black clear colour.
  const i = (240 * width + 360) * 4
  expect(data[i] + data[i + 1] + data[i + 2]).toBeGreaterThan(30)
  expect(errors).toEqual([])
})

test('CSS tier applies the material and refracts only where the engine renders it', async ({ page }, info) => {
  await page.goto('/e2e/pages/css.html')
  await page.waitForFunction(() => (window as unknown as { __frames?: number }).__frames)
  const state = await page.evaluate(async () => {
    const { resolveMaterial } = await import('@glassform/core')
    const material = resolveMaterial({ variant: 'regular', appearance: 'light' })
    const layer = document.querySelector('#pill [data-glassform-layer="backdrop"]')!
    const style = getComputedStyle(layer)
    return {
      filter: style.backdropFilter || (style as unknown as { webkitBackdropFilter: string }).webkitBackdropFilter,
      blur: material.blur,
      saturation: material.saturation,
      refracting: (document.querySelector('#pill') as unknown as { refracting: boolean }).refracting,
    }
  })
  // The CSS tier uses the same (tuned) material presets as the GPU renderer.
  expect(state.filter).toContain(`blur(${Number(state.blur.toFixed(2))}px)`)
  expect(state.filter).toContain(`saturate(${Number(state.saturation.toFixed(3))})`)
  expect(state.refracting).toBe(info.project.name.startsWith('chromium'))
})
