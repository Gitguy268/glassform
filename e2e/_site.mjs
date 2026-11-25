import { chromium, firefox, webkit } from '@playwright/test'
import { startServer } from './serve.mjs'
const [,, url, outPrefix, ...engines] = process.argv
const s = await startServer(5199)
const all = { 'chromium-gpu': [chromium, ['--enable-unsafe-webgpu', '--use-angle=metal']], chromium: [chromium, []], firefox: [firefox, []], webkit: [webkit, []] }
for (const name of engines.length ? engines : Object.keys(all)) {
  const [t, args] = all[name]
  const b = await t.launch({ args }); const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
  await p.goto('http://127.0.0.1:5199' + url); await p.waitForTimeout(4000)
  await p.screenshot({ path: `${outPrefix}-${name}.png` })
  console.log(name, errors.length ? errors.slice(0, 4) : 'no errors', await p.evaluate(() => document.querySelector('canvas')?.dataset.glassformBackend ?? 'no canvas'))
  await b.close()
}
s.close()
