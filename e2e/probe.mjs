import { chromium, firefox, webkit } from '@playwright/test'
import { startServer } from './serve.mjs'
const server = await startServer(5199)
const runs = [
  ['chromium', chromium, {}],
  ['chromium+webgpu', chromium, { args: ['--enable-unsafe-webgpu', '--use-angle=metal'] }],
  ['firefox', firefox, {}],
  ['webkit', webkit, {}],
]
for (const [name, type, opts] of runs) {
  const browser = await type.launch(opts)
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:5199/e2e/probe.html')
  await page.waitForFunction(() => window.__caps)
  console.log(name, JSON.stringify(await page.evaluate(() => window.__caps), null, 0))
  await browser.close()
}
server.close()
