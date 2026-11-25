import { chromium, firefox, webkit } from '@playwright/test'
import { startServer } from './serve.mjs'
const [,, url, out, engine = 'chromium-gpu'] = process.argv
const s = await startServer(5199)
const types = { 'chromium-gpu': [chromium, ['--enable-unsafe-webgpu', '--use-angle=metal']], chromium: [chromium, []], firefox: [firefox, []], webkit: [webkit, []] }
const [t, args] = types[engine]
const b = await t.launch({ args }); const p = await b.newPage({ viewport: { width: 400, height: 280 }, deviceScaleFactor: 2 })
p.on('console', m => console.log('console:', m.type(), m.text()))
p.on('pageerror', e => console.log('pageerror:', e.message))
await p.goto('http://127.0.0.1:5199' + url)
await p.waitForTimeout(2000)
console.log('state', await p.evaluate(() => ({ frames: window.__frames, error: window.__error, tier: window.__tier, modes: window.__modes })))
await p.screenshot({ path: out })
await b.close(); s.close()
