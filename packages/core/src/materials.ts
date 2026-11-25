import type { ContainerInit } from './scene'
import type { RgbaColor } from './types'
import { GENERATED_PRESETS } from './presets.generated'

/** Glass variants, named after SwiftUI's `Glass.regular`, `.clear` and `.identity`. */
export type GlassVariant = 'regular' | 'clear' | 'identity'

/** Light or dark system appearance. */
export type GlassAppearance = 'light' | 'dark'

/** A SwiftUI-style glass description. */
export type GlassMaterial = {
  variant?: GlassVariant
  /** Tint colour (`'#0a84ff'`, `'#34c75980'` or an RGBA object), like `Glass.tint(_:)`. */
  tint?: string | RgbaColor | null
  appearance?: GlassAppearance
}

/** Parameters a material sets on a Container. */
export type MaterialParameters = Required<
  Pick<
    ContainerInit,
    | 'blur'
    | 'bezelWidth'
    | 'thickness'
    | 'displacementFactor'
    | 'displacementBlur'
    | 'ior'
    | 'dispersion'
    | 'surfaceProfile'
    | 'lightDirection'
    | 'specularStrength'
    | 'specularWidth'
    | 'specularFalloff'
    | 'oppositeSpecularStrength'
    | 'specularSharpness'
    | 'specularOpacity'
    | 'reflectionOffset'
    | 'tint'
    | 'shadowColor'
    | 'shadowOffsetX'
    | 'shadowOffsetY'
    | 'shadowBlur'
    | 'shadowSpread'
    | 'saturation'
    | 'whiteLevel'
    | 'blackLevel'
    | 'keyLightAmount'
    | 'keyLightAngle'
    | 'keyLightSpread'
    | 'keyLightHeight'
    | 'keyLightColorBias'
    | 'faceMaxLuma'
    | 'adaptiveBezel'
  >
>

/**
 * Starting points read from the `glassBackground` Core Animation filter that
 * SwiftUI's `.glassEffect()` uses on macOS 27.2.1, per variant and appearance
 * (fidelity/native-captures/native-filters.json):
 *
 * | preset        | blur | face white / black | saturation | max luma |
 * | regular light | 5    | 0.96 / 0.40        | 1.2        | 1        |
 * | regular dark  | 5    | 1.125 / 0.08       | 1.3        | 0.575    |
 * | clear light   | 6.39 | 0.95 / 0.20        | 1.0        | 1        |
 * | clear dark    | 6.39 | 0.80 / 0.05        | 1.0        | 1        |
 *
 * Refraction height follows the shape (a quarter of its short side, capped at
 * 20 pt), which `adaptiveBezel` reproduces. No chromatic aberration is set.
 * Values the filter does not expose directly (rim light, key light depth,
 * thickness, shadow) are fitted by fidelity/tune.mjs into
 * presets.generated.ts, which takes precedence when present.
 */
const BASE: MaterialParameters = {
  // Core Animation's blur radius 5 is a much wider kernel than a 5 px
  // Gaussian: 6 pt stripes vanish entirely under native glass.
  blur: 14,
  bezelWidth: 20,
  thickness: 20,
  displacementFactor: 1,
  displacementBlur: 2,
  ior: 1.5,
  dispersion: 0,
  surfaceProfile: 'convex',
  lightDirection: -Math.PI / 4,
  specularStrength: 1,
  specularWidth: 1.5,
  specularFalloff: 1,
  oppositeSpecularStrength: 0.6,
  specularSharpness: 2,
  specularOpacity: 0.5,
  reflectionOffset: 12,
  tint: { r: 1, g: 1, b: 1, a: 0 },
  // The native filter's shadow opacity is 0 for plain glass.
  shadowColor: { r: 0, g: 0, b: 0, a: 0 },
  shadowOffsetX: 0,
  shadowOffsetY: 4,
  shadowBlur: 12,
  shadowSpread: 0,
  saturation: 1.2,
  whiteLevel: 0.96,
  blackLevel: 0.4,
  faceMaxLuma: 1,
  adaptiveBezel: true,
  keyLightAmount: 0.18,
  keyLightAngle: Math.PI / 2,
  keyLightSpread: (Math.PI * 2) / 3,
  keyLightHeight: 0.5,
  keyLightColorBias: -0.1875,
}

type PresetKey = `${GlassVariant}-${GlassAppearance}`

const IDENTITY: Partial<MaterialParameters> = {
  blur: 0,
  thickness: 0,
  displacementFactor: 0,
  saturation: 1,
  whiteLevel: 1,
  blackLevel: 0,
  faceMaxLuma: 1,
  keyLightAmount: 0,
  specularOpacity: 0,
  specularStrength: 0,
  oppositeSpecularStrength: 0,
  shadowColor: { r: 0, g: 0, b: 0, a: 0 },
}

/** Presets per variant and appearance, before tuning. */
export const DEFAULT_MATERIAL_PRESETS: Record<PresetKey, MaterialParameters> = {
  'regular-light': BASE,
  'regular-dark': {
    ...BASE,
    saturation: 1.3,
    whiteLevel: 1.125,
    blackLevel: 0.08,
    faceMaxLuma: 0.575,
    specularOpacity: 0.35,
    keyLightAmount: 0.12,
  },
  'clear-light': {
    ...BASE,
    blur: 16,
    saturation: 1,
    whiteLevel: 0.95,
    blackLevel: 0.2,
    keyLightAmount: 0.14,
  },
  'clear-dark': {
    ...BASE,
    blur: 16,
    saturation: 1,
    whiteLevel: 0.8,
    blackLevel: 0.05,
    specularOpacity: 0.3,
    keyLightAmount: 0.1,
  },
  'identity-light': { ...BASE, ...IDENTITY } as MaterialParameters,
  'identity-dark': { ...BASE, ...IDENTITY } as MaterialParameters,
}

function mergePresets(presets: Partial<Record<string, Partial<MaterialParameters>>>) {
  const next = { ...DEFAULT_MATERIAL_PRESETS }
  for (const [key, value] of Object.entries(presets)) {
    if (key in next && value) {
      next[key as PresetKey] = { ...DEFAULT_MATERIAL_PRESETS[key as PresetKey], ...value }
    }
  }
  return next
}

let activePresets: Record<PresetKey, MaterialParameters> = mergePresets(GENERATED_PRESETS)

/** Replaces the presets used by {@link resolveMaterial} (the tuner output uses this). */
export function setMaterialPresets(presets: Partial<Record<PresetKey, Partial<MaterialParameters>>>) {
  activePresets = mergePresets({ ...GENERATED_PRESETS, ...presets })
}

/** The presets currently in use (hand presets merged with tuned ones). */
export function getMaterialPresets() {
  return activePresets
}

/** Parses `#rgb`, `#rrggbb` or `#rrggbbaa` into a 0..1 RGBA colour. */
export function parseColor(color: string | RgbaColor): RgbaColor {
  if (typeof color !== 'string') {
    return { ...color }
  }
  let hex = color.trim().replace(/^#/, '')
  if (hex.length === 3 || hex.length === 4) {
    hex = hex.split('').map((c) => c + c).join('')
  }
  const value = Number.parseInt(hex, 16)
  if (Number.isNaN(value) || (hex.length !== 6 && hex.length !== 8)) {
    throw new Error(`Unsupported colour: ${color}`)
  }
  const has = hex.length === 8
  return {
    r: ((value >>> (has ? 24 : 16)) & 0xff) / 255,
    g: ((value >>> (has ? 16 : 8)) & 0xff) / 255,
    b: ((value >>> (has ? 8 : 0)) & 0xff) / 255,
    a: has ? (value & 0xff) / 255 : 1,
  }
}

/** Strength a SwiftUI-style tint is applied with (alpha scales it). */
const TINT_STRENGTH = 0.55

/** Resolves a material description into Container parameters. */
export function resolveMaterial(material: GlassMaterial = {}): MaterialParameters {
  const variant = material.variant ?? 'regular'
  const appearance = material.appearance ?? 'light'
  const preset = activePresets[`${variant}-${appearance}`]
  if (!material.tint) {
    return { ...preset, tint: { ...preset.tint }, shadowColor: { ...preset.shadowColor } }
  }
  const tint = parseColor(material.tint)
  return {
    ...preset,
    tint: { r: tint.r, g: tint.g, b: tint.b, a: Math.min(1, TINT_STRENGTH * tint.a) },
    shadowColor: { ...preset.shadowColor },
  }
}
