import { expect, test } from '@playwright/test'
import { canvasPixels, hasWebGpuAdapter, skipWithoutWebGl2, trackErrors } from './helpers'

const expectedBackend: Record<string, string[]> = {
  chromium: ['webgl2'],
  'chromium-webgpu': ['webgpu'],
  firefox: ['webgl2', 'webgpu'],
  webkit: ['webgpu', 'webgl2'],
}

test('picks a backend by feature detection and renders without errors', async ({ page }, info) => {
  await skipWithoutWebGl2(page, test.skip)
  const errors = trackErrors(page)
  await page.goto('/e2e/pages/dom-backdrop.html?backdrop=img')
  await page.waitForFunction(() => (window as unknown as { __tier?: string }).__tier)
  const tier = await page.evaluate(() => (window as unknown as { __tier: string }).__tier)
  const adapter = await hasWebGpuAdapter(page)
  // Without an adapter (CI, blocklisted GPUs) every engine must fall back to WebGL2.
  expect(adapter ? expectedBackend[info.project.name] : ['webgl2']).toContain(tier)
  expect(errors.filter((e) => !/WebGPU is disabled|blocklist/i.test(e))).toEqual([])
})

test('forced WebGL2 works in every engine', async ({ page }) => {
  await skipWithoutWebGl2(page, test.skip)
  await page.goto('/e2e/pages/dom-backdrop.html?backdrop=img&backend=webgl2')
  await page.waitForFunction(() => (window as unknown as { __frames?: number }).__frames! > 3)
  expect(await page.evaluate(() => (window as unknown as { __tier: string }).__tier)).toBe('webgl2')
})

test('glass refracts the backdrop (pixels inside the glass differ from the image)', async ({ page }) => {
  await skipWithoutWebGl2(page, test.skip)
  await page.goto('/e2e/pages/fidelity.html?scene=capsule-regular-light-stripes')
  await page.waitForFunction(() => (window as unknown as { __ready?: unknown }).__ready)
  const rendered = await canvasPixels(page)
  const { PNG } = await import('pngjs')
  const { readFileSync } = await import('node:fs')
  const background = PNG.sync.read(readFileSync(new URL('../../fidelity/backgrounds/stripes.png', import.meta.url)))
  // Compare a horizontal line through the capsule's left bezel (x 150..200 px, y 240).
  let changed = 0
  for (let x = 150; x < 200; x += 1) {
    const i = (240 * rendered.width + x) * 4
    const d = Math.abs(rendered.data[i] - background.data[i]) + Math.abs(rendered.data[i + 1] - background.data[i + 1])
    if (d > 30) changed += 1
  }
  expect(changed).toBeGreaterThan(10)
  // Outside the glass the backdrop is untouched.
  const j = (20 * rendered.width + 20) * 4
  expect(Math.abs(rendered.data[j] - background.data[j])).toBeLessThan(6)
})

test('content modes follow browser support and glass content stays clickable', async ({ page }, info) => {
  await skipWithoutWebGl2(page, test.skip)
  await page.goto('/e2e/pages/dom-backdrop.html')
  await page.waitForFunction(() => (window as unknown as { __modes?: { label?: string } }).__modes?.label)
  const modes = await page.evaluate(() => (window as unknown as { __modes: { backdrop: string; label: string } }).__modes)
  const hasHtmlInCanvas = await page.evaluate(() => 'drawElementImage' in CanvasRenderingContext2D.prototype)
  if (hasHtmlInCanvas && info.project.name !== 'chromium') {
    expect(modes).toEqual({ backdrop: 'element', label: 'element' })
  } else if (!hasHtmlInCanvas) {
    expect(modes).toEqual({ backdrop: 'snapshot', label: 'overlay' })
  }
  await page.waitForTimeout(500)
  await page.mouse.click(180, 120)
  expect(await page.evaluate(() => (window as unknown as { __clicks?: number }).__clicks ?? 0)).toBe(1)
})
