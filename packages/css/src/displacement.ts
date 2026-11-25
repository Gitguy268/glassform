/**
 * Displacement maps for the SVG refraction filter (Chromium renders
 * `backdrop-filter: url(#filter)`; Firefox and WebKit parse it but do not).
 * The idea comes from shuding/liquid-glass (MIT): encode a per-pixel offset in
 * the red/green channels and let feDisplacementMap move the backdrop. Here the
 * offset follows the same squircle SDF and convex bezel profile as the GPU
 * renderer, so the CSS tier bends light the same way at the edges.
 */

/** Shape and optics used to build one map. */
export type DisplacementMapOptions = {
  width: number
  height: number
  cornerRadius: number
  /** 0 = circular corners, 0.6 = iOS-like squircle. */
  cornerSmoothing: number
  /** Width of the refracting rim in CSS pixels. */
  bezelWidth: number
  /** Device pixel ratio of the generated image (1 keeps it cheap). */
  scale?: number
}

const CIRCULAR_EXPONENT = 2
// Same as @glassform/core corner-smoothing: smoothing 0.6 maps to exponent 4.
const SMOOTHING_EXPONENT_DELTA = (4 - CIRCULAR_EXPONENT) / 0.6

function superellipseLength(x: number, y: number, exponent: number) {
  return (Math.abs(x) ** exponent + Math.abs(y) ** exponent) ** (1 / exponent)
}

/** Signed distance to a (smoothed) rounded rectangle centred on the origin. */
export function roundedRectDistance(
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
  radius: number,
  smoothing: number,
) {
  const limit = Math.min(halfWidth, halfHeight)
  const r = Math.min(Math.max(radius, 0), limit)
  const qx = Math.abs(x) - halfWidth + r
  const qy = Math.abs(y) - halfHeight + r
  const fits = radius > 1e-4 ? Math.max(limit / radius - 1, 0) : 0
  const exponent = CIRCULAR_EXPONENT + Math.min(Math.max(smoothing, 0), 1, fits) * SMOOTHING_EXPONENT_DELTA
  return superellipseLength(Math.max(qx, 0), Math.max(qy, 0), exponent) + Math.min(Math.max(qx, qy), 0) - r
}

/** Slope of the convex squircle bezel at progress `t` (0 = edge, 1 = flat). */
export function bezelSlope(t: number) {
  const u = 1 - Math.min(Math.max(t, 0), 1)
  const inside = Math.max(1 - u ** 4, 1e-4)
  return Math.min((2 * u ** 3) / Math.sqrt(inside), Math.tan(1.4835298))
}

/**
 * Builds RGBA pixels where R/G = 0.5 + offset (x/y) normalised to [-1, 1].
 * Offsets point inward, matching the GPU renderer's refraction. Returns the
 * pixels and the largest |slope| so callers can scale the filter.
 */
export function buildDisplacementPixels(options: DisplacementMapOptions) {
  const scale = options.scale ?? 1
  const width = Math.max(1, Math.round(options.width * scale))
  const height = Math.max(1, Math.round(options.height * scale))
  const halfWidth = options.width / 2
  const halfHeight = options.height / 2
  const bezel = Math.max(options.bezelWidth, 1)
  const data = new Uint8ClampedArray(width * height * 4)
  const vectors = new Float32Array(width * height * 2)
  let maxOffset = 1e-4

  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const x = (px + 0.5) / scale - halfWidth
      const y = (py + 0.5) / scale - halfHeight
      const d = roundedRectDistance(x, y, halfWidth, halfHeight, options.cornerRadius, options.cornerSmoothing)
      let ox = 0
      let oy = 0
      if (d < 0) {
        const inward = -d
        if (inward < bezel) {
          const e = 0.5
          const gx = roundedRectDistance(x + e, y, halfWidth, halfHeight, options.cornerRadius, options.cornerSmoothing) -
            roundedRectDistance(x - e, y, halfWidth, halfHeight, options.cornerRadius, options.cornerSmoothing)
          const gy = roundedRectDistance(x, y + e, halfWidth, halfHeight, options.cornerRadius, options.cornerSmoothing) -
            roundedRectDistance(x, y - e, halfWidth, halfHeight, options.cornerRadius, options.cornerSmoothing)
          const length = Math.hypot(gx, gy) || 1
          const slope = bezelSlope(inward / bezel)
          // Sample from further inside the shape, like the GPU path's refracted
          // ray (refract() bends the view ray against the outward normal).
          ox = -(gx / length) * slope
          oy = -(gy / length) * slope
        }
      }
      const index = py * width + px
      vectors[index * 2] = ox
      vectors[index * 2 + 1] = oy
      maxOffset = Math.max(maxOffset, Math.abs(ox), Math.abs(oy))
    }
  }

  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = Math.round(127.5 + (vectors[index * 2] / maxOffset) * 127.5)
    data[index * 4 + 1] = Math.round(127.5 + (vectors[index * 2 + 1] / maxOffset) * 127.5)
    data[index * 4 + 2] = 128
    data[index * 4 + 3] = 255
  }

  return { width, height, data, maxSlope: maxOffset }
}

/** Renders a displacement map to a PNG data URL (browser only). */
export function displacementMapUrl(options: DisplacementMapOptions) {
  const { width, height, data } = buildDisplacementPixels(options)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    return ''
  }
  context.putImageData(new ImageData(data, width, height), 0, 0)
  return canvas.toDataURL('image/png')
}
