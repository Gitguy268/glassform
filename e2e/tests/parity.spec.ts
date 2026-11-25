import { expect, test } from '@playwright/test'
import { canvasPixels, hasWebGpuAdapter, meanDiff } from './helpers'

test('WebGL2 matches WebGPU on the same scene', async ({ browser }, info) => {
  test.skip(info.project.name !== 'chromium-webgpu', 'needs both backends in one engine')
  const probe = await browser.newPage()
  await probe.goto('/e2e/probe.html')
  const adapter = await hasWebGpuAdapter(probe)
  await probe.close()
  test.skip(!adapter, 'no WebGPU adapter on this machine')
  const render = async (backend: string) => {
    const page = await browser.newPage({ viewport: { width: 360, height: 240 }, deviceScaleFactor: 2 })
    await page.goto(`/e2e/pages/fidelity.html?backend=${backend}&scene=merge-two-circles-light-stripes`)
    await page.waitForFunction(() => (window as unknown as { __ready?: unknown }).__ready)
    await page.evaluate(() => (window as unknown as { __show: (id: string, p: object) => Promise<unknown> }).__show('merge-two-circles-light-stripes', { dispersion: 0.04, saturation: 1.4, keyLightAmount: 0.3 }))
    const pixels = await canvasPixels(page)
    await page.close()
    return pixels
  }
  const gpu = await render('webgpu')
  const gl = await render('webgl2')
  expect(meanDiff(gpu.data, gl.data)).toBeLessThan(0.5)
})
