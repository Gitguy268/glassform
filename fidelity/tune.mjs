// Fits material presets to native SwiftUI captures by coordinate descent.
//   node fidelity/tune.mjs [--presets regular-light,clear-dark] [--minutes 12] [--engine chromium-webgpu]
// Objective per preset: mean over its scenes of (1 - SSIM) + 0.02 * mean ΔE2000,
// inside the glass mask. Writes packages/core/src/presets.generated.ts and
// fidelity/tuning.json (history).
import { readFileSync, writeFileSync } from 'node:fs'
import { startServer } from '../e2e/serve.mjs'
import { compare, readPng } from './lib/metrics.mjs'
import { openEngine, renderScene, sceneMask } from './score.mjs'

const root = new URL('.', import.meta.url).pathname
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, value, index, all) => {
  if (value.startsWith('--')) acc.push([value.slice(2), all[index + 1]])
  return acc
}, []))

// name: [min, max, initial step]
const SPACE = {
  blur: [0, 24, 2],
  bezelWidth: [4, 48, 4],
  thickness: [0, 80, 8],
  displacementFactor: [0, 3, 0.25],
  displacementBlur: [0, 8, 1],
  saturation: [0.6, 2.2, 0.15],
  whiteLevel: [0.6, 1.5, 0.05],
  blackLevel: [0, 0.35, 0.03],
  specularOpacity: [0, 1, 0.1],
  specularWidth: [0.5, 4, 0.5],
  oppositeSpecularStrength: [0, 2, 0.2],
  keyLightAmount: [0, 1, 0.08],
  keyLightHeight: [0.05, 1, 0.1],
  reflectionOffset: [0, 40, 4],
  tintAlpha: [0, 0.5, 0.04],
  shadowAlpha: [0, 0.4, 0.04],
  shadowBlur: [0, 40, 4],
  shadowOffsetY: [0, 16, 2],
}

function toParams(vector, base) {
  const { tintAlpha, shadowAlpha, ...rest } = vector
  return {
    ...rest,
    tint: { ...base.tint, a: tintAlpha },
    shadowColor: { ...base.shadowColor, a: shadowAlpha },
  }
}

async function main() {
  const { scenes } = JSON.parse(readFileSync(`${root}scenes.json`, 'utf8'))
  const presetKeys = (args.presets ?? 'regular-light,regular-dark,clear-light,clear-dark').split(',')
  const minutes = Number(args.minutes ?? 12)
  const server = await startServer(5199)
  const { browser, page } = await openEngine(args.engine ?? 'chromium-webgpu')
  const base = await page.evaluate(async () => (await import('@glassform/core')).getMaterialPresets())
  const history = {}
  const tuned = {}

  for (const key of presetKeys) {
    const [variant, appearance] = key.split('-')
    const group = scenes.filter((s) =>
      s.appearance === appearance && s.shapes.length === 1 && s.shapes[0].variant === variant && !s.shapes[0].tint)
    const natives = new Map()
    for (const spec of group) {
      try { natives.set(spec.id, readPng(`${root}native-captures/${spec.id}.png`)) } catch { /* not captured */ }
    }
    const usable = group.filter((s) => natives.has(s.id))
    if (usable.length === 0) {
      console.log(key, 'no native captures, skipped')
      continue
    }
    const preset = base[key]
    const vector = Object.fromEntries(Object.keys(SPACE).map((name) => [
      name,
      name === 'tintAlpha' ? preset.tint.a : name === 'shadowAlpha' ? preset.shadowColor.a : preset[name],
    ]))
    const steps = Object.fromEntries(Object.entries(SPACE).map(([name, [, , step]]) => [name, step]))

    const evaluate = async (candidate) => {
      let total = 0
      for (const spec of usable) {
        const { image } = await renderScene(page, spec.id, toParams(candidate, preset))
        const r = compare(image, natives.get(spec.id), sceneMask(spec))
        total += (1 - r.ssim) + 0.02 * r.meanDeltaE
      }
      return total / usable.length
    }

    let best = await evaluate(vector)
    const start = best
    const deadline = Date.now() + minutes * 60_000
    history[key] = [{ score: best }]
    let improvedInSweep = true
    while (Date.now() < deadline && improvedInSweep) {
      improvedInSweep = false
      for (const name of Object.keys(SPACE)) {
        if (Date.now() > deadline) break
        const [min, max] = SPACE[name]
        for (const direction of [1, -1]) {
          const candidate = { ...vector, [name]: Math.min(max, Math.max(min, vector[name] + direction * steps[name])) }
          if (candidate[name] === vector[name]) continue
          const score = await evaluate(candidate)
          if (score < best - 1e-5) {
            best = score
            vector[name] = candidate[name]
            improvedInSweep = true
            break
          }
        }
      }
      if (!improvedInSweep) {
        let shrunk = false
        for (const name of Object.keys(steps)) {
          if (steps[name] > SPACE[name][2] / 16) { steps[name] /= 2; shrunk = true }
        }
        improvedInSweep = shrunk
      }
      history[key].push({ score: best, vector: { ...vector } })
      console.log(key, 'objective', best.toFixed(5))
    }
    tuned[key] = toParams(vector, preset)
    console.log(key, 'start', start.toFixed(5), 'end', best.toFixed(5))
  }

  await browser.close()
  server.close()
  const meta = JSON.parse(readFileSync(`${root}native-captures/native-filters.json`, 'utf8'))
  const scores = Object.fromEntries(Object.entries(history).map(([k, h]) => [k, Number(h.at(-1).score.toFixed(5))]))
  writeFileSync(`${root}tuning.json`, JSON.stringify({ date: new Date().toISOString().slice(0, 10), history }, null, 2) + '\n')
  const ts = `// Written by fidelity/tune.mjs from native SwiftUI captures (macOS ${meta.macOS}).
// Re-run \`node fidelity/tune.mjs\` after new captures; do not edit by hand.
import type { MaterialParameters } from './materials'

export const GENERATED_PRESETS: Partial<Record<string, Partial<MaterialParameters>>> = ${JSON.stringify(tuned, null, 2)}

export const GENERATED_PRESETS_INFO: { date: string; macOS: string; scores: Record<string, number> } | null = ${JSON.stringify({ date: new Date().toISOString().slice(0, 10), macOS: meta.macOS, scores })}
`
  writeFileSync(new URL('../packages/core/src/presets.generated.ts', import.meta.url), ts)
  console.log('wrote presets.generated.ts')
}

await main()
