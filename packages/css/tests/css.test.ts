import { describe, expect, it } from 'vitest'
import { bezelSlope, buildDisplacementPixels, levelsToCss, roundedRectDistance } from '../src/index'

describe('levelsToCss', () => {
  it('maps black/white levels onto contrast and brightness exactly', () => {
    const { contrast, brightness } = levelsToCss(1.125, 0.08)
    const css = (x: number) => brightness * ((x - 0.5) * contrast + 0.5)
    for (const x of [0, 0.25, 0.5, 1]) {
      expect(css(x)).toBeCloseTo(0.08 + x * (1.125 - 0.08), 10)
    }
  })

  it('is the identity for neutral levels', () => {
    expect(levelsToCss(1, 0)).toEqual({ contrast: 1, brightness: 1 })
  })
})

describe('displacement map', () => {
  it('uses the same SDF sign convention as the GPU renderer', () => {
    expect(roundedRectDistance(0, 0, 50, 20, 20, 0)).toBeCloseTo(-20)
    expect(roundedRectDistance(60, 0, 50, 20, 20, 0)).toBeCloseTo(10)
  })

  it('has the steepest slope at the edge and none in the flat interior', () => {
    expect(bezelSlope(0)).toBeGreaterThan(bezelSlope(0.5))
    expect(bezelSlope(1)).toBe(0)
  })

  it('is neutral (128) in the middle and points inward near the edges', () => {
    const { width, height, data } = buildDisplacementPixels({
      width: 200, height: 80, cornerRadius: 40, cornerSmoothing: 0, bezelWidth: 20,
    })
    const at = (x: number, y: number) => data.subarray((y * width + x) * 4, (y * width + x) * 4 + 2)
    expect(Array.from(at(100, 40))).toEqual([128, 128])
    // Near the left edge the offset points right (into the shape): R > 128.
    expect(at(41, 40)[0]).toBe(128)
    expect(at(2, 40)[0]).toBeGreaterThan(128)
    // Near the top edge the offset points down: G > 128.
    expect(at(100, 2)[1]).toBeGreaterThan(128)
    expect(height).toBe(80)
  })
})
