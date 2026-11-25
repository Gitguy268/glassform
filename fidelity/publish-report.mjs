// Copies the latest scoring run into the site:
//   node fidelity/score.mjs && node fidelity/publish-report.mjs
// Writes apps/site/public/fidelity/report.json plus WebP images of the native
// capture and the chromium-webgpu render for each scene.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const root = new URL('.', import.meta.url).pathname
const out = new URL('../apps/site/public/fidelity/', import.meta.url).pathname
const report = JSON.parse(readFileSync(`${root}report.json`, 'utf8'))
const meta = existsSync(`${root}native-captures/native-filters.json`)
  ? JSON.parse(readFileSync(`${root}native-captures/native-filters.json`, 'utf8'))
  : {}
const engines = Object.fromEntries(Object.entries(report.results).map(([name, r]) => [name, { backend: r.backend, mean: r.mean }]))
const sceneIds = Object.keys(Object.values(report.results)[0]?.scenes ?? {})
mkdirSync(`${out}native`, { recursive: true })
mkdirSync(`${out}web`, { recursive: true })
const scenes = []
for (const id of sceneIds) {
  const scores = Object.fromEntries(Object.entries(report.results).map(([name, r]) => [name, r.scenes[id]]).filter(([, v]) => v))
  scenes.push({ id, scores })
  execFileSync('cwebp', ['-quiet', '-q', '80', '-resize', '480', '320', `${root}native-captures/${id}.png`, '-o', `${out}native/${id}.webp`])
  const web = `${root}out/chromium-webgpu/${id}.png`
  if (existsSync(web)) {
    execFileSync('cwebp', ['-quiet', '-q', '80', '-resize', '480', '320', web, '-o', `${out}web/${id}.webp`])
  }
}
writeFileSync(`${out}report.json`, JSON.stringify({ date: report.date, macOS: meta.macOS, engines, scenes }, null, 2) + '\n')
console.log(`published ${scenes.length} scenes`)
