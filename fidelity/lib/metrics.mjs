// Image comparison used by the fidelity and parity checks.
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import ssimModule from 'ssim.js'

const ssim = ssimModule.ssim ?? ssimModule.default ?? ssimModule

/** Reads a PNG into { width, height, data: Uint8ClampedArray RGBA }. */
export function readPng(path) {
  const png = PNG.sync.read(readFileSync(path))
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }
}

/** Crops an RGBA image. */
export function crop(image, x, y, width, height) {
  const out = new Uint8ClampedArray(width * height * 4)
  for (let row = 0; row < height; row += 1) {
    const from = ((y + row) * image.width + x) * 4
    out.set(image.data.subarray(from, from + width * 4), row * width * 4)
  }
  return { width, height, data: out }
}

function srgbToLinear(c) {
  c /= 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function toLab(r, g, b) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b)
  let x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047
  let y = R * 0.2126729 + G * 0.7151522 + B * 0.072175
  let z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
  x = f(x); y = f(y); z = f(z)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

/** CIEDE2000 colour difference. */
export function deltaE2000([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2)
  const Cb = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)))
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2)
  const h = (b, a) => { if (a === 0 && b === 0) return 0; const v = Math.atan2(b, a) / rad; return v < 0 ? v + 360 : v }
  const h1p = h(b1, a1p), h2p = h(b2, a2p)
  const dLp = L2 - L1, dCp = C2p - C1p
  let dhp = 0
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360 }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad)
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2
  let hbp = h1p + h2p
  if (C1p * C2p !== 0) { hbp = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + (h1p + h2p < 360 ? 360 : -360)) / 2 : (h1p + h2p) / 2 }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad)
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2))
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7))
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2)
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T
  const Rt = -Math.sin(2 * dTheta * rad) * Rc
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))
}

/**
 * Compares two same-size images. `mask(x, y)` returns a weight in [0, 1]
 * (default: every pixel). Returns SSIM (over the mask's bounding box),
 * mean/p95 ΔE2000 and the share of pixels with ΔE < 2 (barely noticeable).
 */
export function compare(a, b, mask = () => 1) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`)
  }
  let minX = a.width, minY = a.height, maxX = -1, maxY = -1
  const deltas = []
  let weightSum = 0, deltaSum = 0, under2 = 0
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const w = mask(x, y)
      if (w <= 0) continue
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
      const i = (y * a.width + x) * 4
      const d = deltaE2000(toLab(a.data[i], a.data[i + 1], a.data[i + 2]), toLab(b.data[i], b.data[i + 1], b.data[i + 2]))
      deltas.push(d)
      deltaSum += d * w
      weightSum += w
      if (d < 2) under2 += w
    }
  }
  if (maxX < 0) return { ssim: 1, meanDeltaE: 0, p95DeltaE: 0, under2: 1, pixels: 0 }
  const box = (img) => crop(img, minX, minY, maxX - minX + 1, maxY - minY + 1)
  const { mssim } = ssim(box(a), box(b))
  deltas.sort((p, q) => p - q)
  return {
    ssim: mssim,
    meanDeltaE: deltaSum / weightSum,
    p95DeltaE: deltas[Math.floor(deltas.length * 0.95)] ?? 0,
    under2: under2 / weightSum,
    pixels: deltas.length,
  }
}
