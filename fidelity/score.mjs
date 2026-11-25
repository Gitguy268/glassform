// Scores glassform against native SwiftUI captures.
//   node fidelity/score.mjs [--engines chromium-webgpu,chromium-webgl2,firefox,webkit] [--scenes id,id] [--params json]
// Writes fidelity/out/<engine>/<scene>.png, fidelity/out/report.html and
// fidelity/report.json (summary, committed).
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { chromium, firefox, webkit } from '@playwright/test'
import { PNG } from 'pngjs'
import { startServer } from '../e2e/serve.mjs'
import { compare, readPng } from './lib/metrics.mjs'

const root = new URL('.', import.meta.url).pathname
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, value, index, all) => {
  if (value.startsWith('--')) acc.push([value.slice(2), all[index + 1]])
  return acc
}, []))

export const ENGINES = {
  'chromium-webgpu': { type: chromium, args: ['--enable-unsafe-webgpu', '--use-angle=metal'], backend: 'webgpu' },
  'chromium-webgl2': { type: chromium, args: ['--use-angle=metal'], backend: 'webgl2' },
  firefox: { type: firefox, args: [], backend: 'auto' },
  webkit: { type: webkit, args: [], backend: 'auto' },
}

/** Weight mask: glass shapes plus a halo (in capture pixels), 0 elsewhere. */
export function sceneMask(spec, scale = 2, halo = 24) {
  return (x, y) => {
    for (const s of spec.shapes) {
      if (x >= (s.x * scale) - halo && x < (s.x + s.w) * scale + halo && y >= (s.y * scale) - halo && y < (s.y + s.h) * scale + halo) return 1
    }
    return 0
  }
}

/** Opens an engine on the fidelity page. */
export async function openEngine(name, port = 5199) {
  const engine = ENGINES[name]
  const browser = await engine.type.launch({ args: engine.args })
  const page = await browser.newPage({ viewport: { width: 360, height: 240 }, deviceScaleFactor: 2 })
  await page.goto(`http://127.0.0.1:${port}/e2e/pages/fidelity.html?backend=${engine.backend}`)
  await page.waitForFunction(() => window.__ready, null, { timeout: 30000 })
  const backend = await page.evaluate(() => window.__ready.backend)
  return { browser, page, backend }
}

/** Renders a scene and returns its PNG (720x480). */
export async function renderScene(page, id, params = {}, presets = null) {
  await page.evaluate(([sceneId, p, pr]) => window.__show(sceneId, p, pr), [id, params, presets])
  const buffer = await page.locator('canvas').screenshot({ type: 'png' })
  const png = PNG.sync.read(buffer)
  return { buffer, image: { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) } }
}

async function main() {
  const { scenes } = JSON.parse(readFileSync(`${root}scenes.json`, 'utf8'))
  const selected = args.scenes ? scenes.filter((s) => args.scenes.split(',').includes(s.id)) : scenes
  const engines = (args.engines ?? Object.keys(ENGINES).join(',')).split(',')
  const params = args.params ? JSON.parse(args.params) : {}
  const server = await startServer(5199)
  const results = {}
  for (const engineName of engines) {
    const { browser, page, backend } = await openEngine(engineName)
    mkdirSync(`${root}out/${engineName}`, { recursive: true })
    results[engineName] = { backend, scenes: {} }
    for (const spec of selected) {
      const nativePath = `${root}native-captures/${spec.id}.png`
      const { buffer, image } = await renderScene(page, spec.id, params)
      writeFileSync(`${root}out/${engineName}/${spec.id}.png`, buffer)
      if (!existsSync(nativePath)) continue
      const native = readPng(nativePath)
      results[engineName].scenes[spec.id] = compare(image, native, sceneMask(spec))
    }
    await browser.close()
    const values = Object.values(results[engineName].scenes)
    if (values.length) {
      results[engineName].mean = {
        ssim: values.reduce((a, v) => a + v.ssim, 0) / values.length,
        meanDeltaE: values.reduce((a, v) => a + v.meanDeltaE, 0) / values.length,
        under2: values.reduce((a, v) => a + v.under2, 0) / values.length,
      }
    }
    console.log(engineName, backend, results[engineName].mean ?? '(no native captures)')
  }
  server.close()
  writeFileSync(`${root}report.json`, JSON.stringify({ date: new Date().toISOString().slice(0, 10), results }, null, 2) + '\n')
  const rows = selected.map((spec) => `<tr><td>${spec.id}</td><td><img src="../native-captures/${spec.id}.png"></td>${engines.map((e) => {
    const r = results[e].scenes[spec.id]
    return `<td><img src="${e}/${spec.id}.png"><br>${r ? `SSIM ${r.ssim.toFixed(4)} · ΔE ${r.meanDeltaE.toFixed(2)}` : ''}</td>`
  }).join('')}</tr>`).join('\n')
  writeFileSync(`${root}out/report.html`, `<!doctype html><meta charset="utf-8"><title>Fidelity report</title><style>body{font:13px system-ui;background:#111;color:#eee}img{width:240px}td{vertical-align:top;padding:4px}</style><table><tr><th>scene</th><th>native</th>${engines.map((e) => `<th>${e}</th>`).join('')}</tr>${rows}</table>`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
