// Generates the demo artwork procedurally (no third-party images):
//   node scripts/make-art.mjs
// Writes WebP files used by the site and demos. Deterministic per seed.
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const out = new URL('../apps/site/src/assets/', import.meta.url).pathname
mkdirSync(out, { recursive: true })

const ART = {
  // Layered flowing ribbons, warm/cool split.
  'ribbons.webp': { w: 2400, h: 1400, kind: 'ribbons', seed: 7, palette: ['#14213d', '#3a0ca3', '#7209b7', '#f72585', '#ff8500', '#ffb703', '#4cc9f0', '#80ffdb'] },
  'ribbons-tall.webp': { w: 900, h: 1600, kind: 'ribbons', seed: 19, palette: ['#03045e', '#0077b6', '#00b4d8', '#90e0ef', '#f15bb5', '#fee440', '#ff9e00', '#9b5de5'] },
  'cover.webp': { w: 800, h: 800, kind: 'cover', seed: 3, palette: ['#ff006e', '#fb5607', '#ffbe0b', '#3a86ff', '#8338ec'] },
  'seamless.webp': { w: 1024, h: 1024, kind: 'tile', seed: 11, palette: ['#0b132b', '#1c2541', '#3a506b', '#5bc0be', '#ffbe0b', '#fb5607'] },
  'meadow.webp': { w: 2000, h: 1300, kind: 'blobs', seed: 23, palette: ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51', '#a8dadc'] },
}

const browser = await chromium.launch()
const page = await browser.newPage()
for (const [name, spec] of Object.entries(ART)) {
  const dataUrl = await page.evaluate((s) => {
    let state = s.seed * 9301 + 49297
    const rand = () => { state = (state * 9301 + 49297) % 233280; return state / 233280 }
    const c = document.createElement('canvas'); c.width = s.w; c.height = s.h
    const g = c.getContext('2d')
    const P = s.palette
    if (s.kind === 'ribbons') {
      const bg = g.createLinearGradient(0, 0, s.w, s.h); bg.addColorStop(0, P[0]); bg.addColorStop(1, P[1])
      g.fillStyle = bg; g.fillRect(0, 0, s.w, s.h)
      const bands = 70
      for (let i = 0; i < bands; i++) {
        const t = i / bands
        const color = P[2 + Math.floor(t * (P.length - 2))]
        const next = P[2 + Math.min(P.length - 3, Math.floor(t * (P.length - 2)) + 1)]
        const grad = g.createLinearGradient(0, 0, s.w, 0); grad.addColorStop(0, color); grad.addColorStop(1, next)
        g.fillStyle = grad
        g.globalAlpha = 0.55 + 0.45 * rand()
        g.beginPath()
        const base = s.h * (0.08 + t * 1.1)
        const amp = s.h * (0.08 + 0.12 * rand())
        const freq = 1.2 + rand() * 1.6
        const phase = rand() * Math.PI * 2
        g.moveTo(0, s.h)
        for (let x = 0; x <= s.w; x += 8) {
          const y = base - amp * Math.sin((x / s.w) * Math.PI * freq + phase) - (s.h * 0.35) * Math.sin((x / s.w) * Math.PI) * (1 - t)
          g.lineTo(x, y)
        }
        g.lineTo(s.w, s.h); g.closePath(); g.fill()
        g.globalAlpha = 0.35; g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2; g.stroke()
      }
      g.globalAlpha = 1
    } else if (s.kind === 'cover') {
      g.fillStyle = '#111'; g.fillRect(0, 0, s.w, s.h)
      for (let i = 0; i < 9; i++) {
        const r = s.w * (0.15 + rand() * 0.4)
        const x = rand() * s.w, y = rand() * s.h
        const grad = g.createRadialGradient(x, y, 0, x, y, r)
        grad.addColorStop(0, P[i % P.length]); grad.addColorStop(1, 'rgba(0,0,0,0)')
        g.fillStyle = grad; g.fillRect(0, 0, s.w, s.h)
      }
      g.fillStyle = 'rgba(255,255,255,0.92)'
      g.font = `800 ${s.w * 0.11}px Helvetica, Arial, sans-serif`
      g.fillText('glassform', s.w * 0.07, s.h * 0.88)
      g.font = `500 ${s.w * 0.045}px Helvetica, Arial, sans-serif`
      g.fillText('Refraction Sessions', s.w * 0.075, s.h * 0.95)
    } else if (s.kind === 'tile') {
      // Seamless: draw wrapped circles and stripes on a torus.
      g.fillStyle = P[0]; g.fillRect(0, 0, s.w, s.h)
      for (let i = 0; i < 40; i++) {
        const x = rand() * s.w, y = rand() * s.h, r = 30 + rand() * 160
        const color = P[1 + Math.floor(rand() * (P.length - 1))]
        for (const dx of [-s.w, 0, s.w]) for (const dy of [-s.h, 0, s.h]) {
          const grad = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r)
          grad.addColorStop(0, color); grad.addColorStop(1, 'rgba(0,0,0,0)')
          g.fillStyle = grad; g.beginPath(); g.arc(x + dx, y + dy, r, 0, Math.PI * 2); g.fill()
        }
      }
    } else {
      const bg = g.createLinearGradient(0, 0, 0, s.h); bg.addColorStop(0, P[5]); bg.addColorStop(1, P[0])
      g.fillStyle = bg; g.fillRect(0, 0, s.w, s.h)
      for (let i = 0; i < 26; i++) {
        const x = rand() * s.w, y = rand() * s.h, r = 120 + rand() * 520
        const grad = g.createRadialGradient(x, y, 0, x, y, r)
        grad.addColorStop(0, P[i % 5]); grad.addColorStop(1, 'rgba(0,0,0,0)')
        g.globalAlpha = 0.8; g.fillStyle = grad; g.fillRect(0, 0, s.w, s.h)
      }
      g.globalAlpha = 1
    }
    return c.toDataURL('image/webp', 0.9)
  }, spec)
  writeFileSync(out + name, Buffer.from(dataUrl.split(',')[1], 'base64'))
  console.log('wrote', name)
}
await browser.close()
