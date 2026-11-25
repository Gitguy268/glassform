import { resolveMaterial, type GlassAppearance, type GlassVariant, type MaterialParameters, type RgbaColor } from '@glassform/core'
import { buildDisplacementPixels, displacementMapUrl } from './displacement'

export { buildDisplacementPixels, displacementMapUrl, roundedRectDistance, bezelSlope } from './displacement'
export type { DisplacementMapOptions } from './displacement'

/** How the CSS tier refracts the page behind the glass. */
export type CssRefraction = 'auto' | 'svg' | 'none'

/** Options for {@link glass}. */
export type CssGlassOptions = {
  variant?: GlassVariant
  tint?: string | RgbaColor | null
  /** `'auto'` follows `prefers-color-scheme`. */
  appearance?: GlassAppearance | 'auto'
  /** Corner radius in CSS pixels; `'auto'` reads the element's border-radius, `'capsule'` uses half the height. */
  cornerRadius?: number | 'auto' | 'capsule'
  /** 0 = circular corners, 0.6 = iOS-like squircle (default). */
  cornerSmoothing?: number
  /**
   * `'auto'` refracts with an SVG displacement filter where the browser renders
   * `backdrop-filter: url()` (Chromium) and uses blur only elsewhere.
   */
  refraction?: CssRefraction
  /** Pointer highlight and press bounce, like `Glass.interactive()`. */
  interactive?: boolean
  /** Overrides for individual material parameters. */
  params?: Partial<MaterialParameters>
}

/** Handle returned by {@link glass}. */
export type CssGlassHandle = {
  readonly element: HTMLElement
  /** Whether SVG refraction is active. */
  readonly refracting: boolean
  update(options: CssGlassOptions): void
  destroy(): void
}

let filterCounter = 0
let svgRoot: SVGSVGElement | null = null
const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Whether `backdrop-filter: url(#svg)` actually renders. Every engine parses
 * it, but only Chromium applies it, and there is no way to detect rendering
 * from script, so this one check looks at the engine.
 */
export function supportsSvgBackdropFilter() {
  if (typeof navigator === 'undefined') {
    return false
  }
  const brands = (navigator as Navigator & { userAgentData?: { brands?: Array<{ brand: string }> } }).userAgentData?.brands
  if (brands?.some((b) => /Chromium|Google Chrome|Microsoft Edge|Brave|Opera/i.test(b.brand))) {
    return true
  }
  return /\bChrom(e|ium)\//.test(navigator.userAgent) && !/\bEdge\//.test(navigator.userAgent)
}

function ensureSvgRoot() {
  if (svgRoot?.isConnected) {
    return svgRoot
  }
  svgRoot = document.createElementNS(SVG_NS, 'svg')
  svgRoot.setAttribute('aria-hidden', 'true')
  svgRoot.setAttribute('width', '0')
  svgRoot.setAttribute('height', '0')
  svgRoot.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'
  document.body.append(svgRoot)
  return svgRoot
}

function cssColor(color: RgbaColor) {
  return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${color.a.toFixed(3)})`
}

/**
 * Converts the face level remap (black + x * (white - black)) into CSS
 * `contrast(c) brightness(k)`, which computes k * ((x - 0.5) * c + 0.5).
 */
export function levelsToCss(whiteLevel: number, blackLevel: number) {
  const k = whiteLevel + blackLevel
  const c = k > 0 ? (whiteLevel - blackLevel) / k : 1
  return { contrast: c, brightness: k }
}

function resolveAppearance(appearance: CssGlassOptions['appearance']): GlassAppearance {
  if (appearance === 'light' || appearance === 'dark') {
    return appearance
  }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function makeLayer(name: string) {
  const layer = document.createElement('span')
  layer.dataset.glassformLayer = name
  layer.setAttribute('aria-hidden', 'true')
  layer.style.cssText =
    'position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-sizing:border-box;z-index:-1'
  return layer
}

/**
 * Turns an element into liquid glass over whatever page content is behind
 * it, in every browser. Returns a handle to update or remove the effect.
 */
export function glass(element: HTMLElement, options: CssGlassOptions = {}): CssGlassHandle {
  let current: CssGlassOptions = { ...options }
  const id = `glassform-refract-${++filterCounter}`
  const previous = {
    position: element.style.position,
    zIndex: element.style.zIndex,
    boxShadow: element.style.boxShadow,
    transition: element.style.transition,
    transform: element.style.transform,
  }
  if (getComputedStyle(element).position === 'static') {
    element.style.position = 'relative'
  }
  // A stacking context keeps the z-index:-1 layers under the content. WebKit
  // and Firefox treat isolation:isolate as a backdrop root (the blur would see
  // nothing), but z-index on a positioned box is not one.
  if (getComputedStyle(element).zIndex === 'auto') {
    element.style.zIndex = '0'
  }
  element.dataset.glassform = ''

  const backdrop = makeLayer('backdrop')
  const tint = makeLayer('tint')
  const rim = makeLayer('rim')
  const light = makeLayer('light')
  element.prepend(backdrop, tint, light, rim)

  let filter: SVGFilterElement | null = null
  let feImage: SVGFEImageElement | null = null
  let feMap: SVGFEDisplacementMapElement | null = null
  let lastMapKey = ''
  let refracting = false

  const ensureFilter = () => {
    if (filter) {
      return
    }
    const root = ensureSvgRoot()
    filter = document.createElementNS(SVG_NS, 'filter')
    filter.id = id
    filter.setAttribute('color-interpolation-filters', 'sRGB')
    filter.setAttribute('filterUnits', 'userSpaceOnUse')
    filter.setAttribute('x', '0')
    filter.setAttribute('y', '0')
    feImage = document.createElementNS(SVG_NS, 'feImage')
    feImage.setAttribute('x', '0')
    feImage.setAttribute('y', '0')
    feImage.setAttribute('result', 'map')
    feImage.setAttribute('preserveAspectRatio', 'none')
    feMap = document.createElementNS(SVG_NS, 'feDisplacementMap')
    feMap.setAttribute('in', 'SourceGraphic')
    feMap.setAttribute('in2', 'map')
    feMap.setAttribute('xChannelSelector', 'R')
    feMap.setAttribute('yChannelSelector', 'G')
    filter.append(feImage, feMap)
    root.append(filter)
  }

  const radiusFor = (width: number, height: number) => {
    const value = current.cornerRadius ?? 'auto'
    if (value === 'capsule') {
      return Math.min(width, height) / 2
    }
    if (typeof value === 'number') {
      return value
    }
    const parsed = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius)
    return Number.isFinite(parsed) ? Math.min(parsed, Math.min(width, height) / 2) : 0
  }

  const apply = () => {
    const appearance = resolveAppearance(current.appearance)
    const material = { ...resolveMaterial({ variant: current.variant, tint: current.tint, appearance }), ...current.params }
    const rect = element.getBoundingClientRect()
    const width = Math.max(1, Math.round(rect.width))
    const height = Math.max(1, Math.round(rect.height))
    const radius = radiusFor(width, height)
    if (current.cornerRadius !== 'auto' && current.cornerRadius !== undefined) {
      element.style.borderRadius = `${radius}px`
    }

    const levels = levelsToCss(material.whiteLevel, material.blackLevel)
    const wantsSvg = (current.refraction ?? 'auto') !== 'none' &&
      (current.refraction === 'svg' || supportsSvgBackdropFilter()) &&
      material.displacementFactor > 0
    refracting = wantsSvg
    let urlPart = ''
    if (wantsSvg) {
      ensureFilter()
      const key = `${width}x${height}r${radius}s${current.cornerSmoothing ?? 0.6}b${material.bezelWidth}`
      if (key !== lastMapKey && feImage && filter && feMap) {
        lastMapKey = key
        const options = {
          width,
          height,
          cornerRadius: radius,
          cornerSmoothing: current.cornerSmoothing ?? 0.6,
          bezelWidth: material.bezelWidth,
        }
        const { maxSlope } = buildDisplacementPixels({ ...options, scale: 0.25 })
        feImage.setAttribute('href', displacementMapUrl(options))
        feImage.setAttribute('width', String(width))
        feImage.setAttribute('height', String(height))
        filter.setAttribute('width', String(width))
        filter.setAttribute('height', String(height))
        const strength =
          2 * maxSlope * (1 - 1 / Math.max(material.ior, 1.0001)) * (material.thickness + material.bezelWidth) *
          material.displacementFactor
        feMap.setAttribute('scale', strength.toFixed(2))
      }
      urlPart = `url(#${id}) `
    }

    const backdropFilter =
      `${urlPart}blur(${material.blur.toFixed(2)}px) saturate(${material.saturation.toFixed(3)}) ` +
      `contrast(${levels.contrast.toFixed(3)}) brightness(${levels.brightness.toFixed(3)})`
    backdrop.style.backdropFilter = backdropFilter
    backdrop.style.setProperty('-webkit-backdrop-filter', backdropFilter.replace(urlPart, ''))
    tint.style.background = material.tint.a > 0 ? cssColor(material.tint) : 'transparent'

    // Rim: a thin gradient ring, brightest toward the light and its opposite.
    const angle = (material.lightDirection * 180) / Math.PI
    const specular = Math.min(1, material.specularOpacity * material.specularStrength)
    const opposite = Math.min(1, material.specularOpacity * material.oppositeSpecularStrength)
    const ringWidth = typeof material.specularWidth === 'number' ? material.specularWidth : 1
    rim.style.padding = `${ringWidth}px`
    rim.style.background =
      `linear-gradient(${angle}deg, rgba(255,255,255,${specular.toFixed(3)}) 0%, rgba(255,255,255,0) 38%, ` +
      `rgba(255,255,255,0) 62%, rgba(255,255,255,${opposite.toFixed(3)}) 100%)`
    rim.style.setProperty('mask', 'linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)')
    rim.style.setProperty('-webkit-mask', 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)')
    rim.style.setProperty('-webkit-mask-composite', 'xor')

    // Key light: broad inner glow on the lit side, plus the interactive highlight.
    const keyAngle = 90 - (material.keyLightAngle * 180) / Math.PI
    const keyAlpha = Math.max(0, material.keyLightAmount * (1 + material.keyLightColorBias))
    const keyDepth = Math.max(4, material.bezelWidth * material.keyLightHeight)
    const layers = [
      `linear-gradient(${keyAngle}deg, rgba(255,255,255,${keyAlpha.toFixed(3)}) 0px, rgba(255,255,255,0) ${keyDepth.toFixed(1)}px)`,
    ]
    if (current.interactive) {
      layers.unshift(
        'radial-gradient(circle at var(--glassform-x, 50%) var(--glassform-y, 50%), ' +
          'rgba(255,255,255,var(--glassform-glow, 0)) 0%, rgba(255,255,255,0) 60%)',
      )
    }
    light.style.background = layers.join(', ')

    const shadow = material.shadowColor.a > 0
      ? `${material.shadowOffsetX}px ${material.shadowOffsetY}px ${material.shadowBlur}px ${material.shadowSpread}px ${cssColor(material.shadowColor)}`
      : ''
    element.style.boxShadow = [shadow, previous.boxShadow].filter(Boolean).join(', ')
  }

  const onPointerMove = (event: PointerEvent) => {
    const rect = element.getBoundingClientRect()
    element.style.setProperty('--glassform-x', `${event.clientX - rect.left}px`)
    element.style.setProperty('--glassform-y', `${event.clientY - rect.top}px`)
  }
  const onPointerEnter = () => element.style.setProperty('--glassform-glow', '0.18')
  const onPointerLeave = () => {
    element.style.setProperty('--glassform-glow', '0')
    element.style.transform = previous.transform
  }
  const onPointerDown = () => {
    element.style.setProperty('--glassform-glow', '0.32')
    element.style.transform = `${previous.transform} scale(1.04)`.trim()
  }
  const onPointerUp = () => {
    element.style.setProperty('--glassform-glow', '0.18')
    element.style.transform = previous.transform
  }
  let interactiveBound = false
  const syncInteractive = () => {
    if (current.interactive && !interactiveBound) {
      element.style.transition = [previous.transition, 'transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1)']
        .filter(Boolean)
        .join(', ')
      element.addEventListener('pointermove', onPointerMove)
      element.addEventListener('pointerenter', onPointerEnter)
      element.addEventListener('pointerleave', onPointerLeave)
      element.addEventListener('pointerdown', onPointerDown)
      element.addEventListener('pointerup', onPointerUp)
      element.addEventListener('pointercancel', onPointerUp)
      interactiveBound = true
    } else if (!current.interactive && interactiveBound) {
      unbindInteractive()
    }
  }
  const unbindInteractive = () => {
    element.removeEventListener('pointermove', onPointerMove)
    element.removeEventListener('pointerenter', onPointerEnter)
    element.removeEventListener('pointerleave', onPointerLeave)
    element.removeEventListener('pointerdown', onPointerDown)
    element.removeEventListener('pointerup', onPointerUp)
    element.removeEventListener('pointercancel', onPointerUp)
    element.style.transition = previous.transition
    interactiveBound = false
  }

  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => apply()) : null
  resizeObserver?.observe(element)
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
  const onScheme = () => {
    if ((current.appearance ?? 'auto') === 'auto') {
      apply()
    }
  }
  media?.addEventListener?.('change', onScheme)

  apply()
  syncInteractive()

  return {
    element,
    get refracting() {
      return refracting
    },
    update(next: CssGlassOptions) {
      current = { ...current, ...next }
      apply()
      syncInteractive()
    },
    destroy() {
      resizeObserver?.disconnect()
      media?.removeEventListener?.('change', onScheme)
      unbindInteractive()
      backdrop.remove()
      tint.remove()
      rim.remove()
      light.remove()
      filter?.remove()
      element.style.position = previous.position
      element.style.zIndex = previous.zIndex
      element.style.boxShadow = previous.boxShadow
      element.style.transform = previous.transform
      delete element.dataset.glassform
    },
  }
}
