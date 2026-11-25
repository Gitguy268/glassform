// Captures README and social images from the built site:
//   pnpm build && pnpm --filter @glassform/site build && node scripts/capture-media.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { startServer } from '../e2e/serve.mjs'

const media = new URL('../docs/media/', import.meta.url).pathname
const frames = new URL('../docs/media/.frames/', import.meta.url).pathname
mkdirSync(media, { recursive: true })
rmSync(frames, { recursive: true, force: true })
mkdirSync(frames, { recursive: true })
const server = await startServer(5199)
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const site = 'http://127.0.0.1:5199/apps/site/dist/index.html'

// Hero still (1440 wide) and the social card (1200x630).
let page = await browser.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 })
await page.goto(`${site}#/`)
await page.waitForTimeout(3500)
writeFileSync(`${media}hero.png`, await page.screenshot())
await page.setViewportSize({ width: 1200, height: 630 })
await page.waitForTimeout(800)
writeFileSync(new URL('../apps/site/public/social.png', import.meta.url).pathname, await page.screenshot())
await page.close()

// Animated hero: 48 frames, 90 ms apart.
page = await browser.newPage({ viewport: { width: 960, height: 560 }, deviceScaleFactor: 1 })
await page.goto(`${site}#/`)
await page.waitForTimeout(3000)
const names = []
for (let i = 0; i < 48; i += 1) {
  const name = `${frames}f${String(i).padStart(3, '0')}.png`
  writeFileSync(name, await page.screenshot())
  names.push(name)
  await page.waitForTimeout(90)
}
await page.close()
execFileSync('img2webp', ['-loop', '0', '-lossy', '-q', '72', '-m', '6', '-d', '90', ...names, '-o', `${media}demo.webp`])

// Playground and web-page tier stills.
page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await page.goto(`${site}#/playground`)
await page.waitForTimeout(3000)
writeFileSync(`${media}playground.png`, await page.screenshot())
await page.goto(`${site}#/showcase`)
await page.waitForTimeout(3500)
writeFileSync(`${media}showcase.png`, await page.screenshot())
await page.close()

await browser.close()
server.close()
for (const name of ['hero', 'playground', 'showcase']) {
  execFileSync('cwebp', ['-q', '82', '-quiet', `${media}${name}.png`, '-o', `${media}${name}.webp`])
  rmSync(`${media}${name}.png`)
}
rmSync(frames, { recursive: true, force: true })
console.log('media written to docs/media')
