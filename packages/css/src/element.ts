import { glass, type CssGlassHandle, type CssGlassOptions, type CssRefraction } from './index'

const OBSERVED = ['variant', 'tint', 'appearance', 'corner-radius', 'corner-smoothing', 'refraction', 'interactive'] as const

function readOptions(element: HTMLElement): CssGlassOptions {
  const radius = element.getAttribute('corner-radius')
  const smoothing = element.getAttribute('corner-smoothing')
  return {
    variant: (element.getAttribute('variant') as CssGlassOptions['variant']) ?? 'regular',
    tint: element.getAttribute('tint'),
    appearance: (element.getAttribute('appearance') as CssGlassOptions['appearance']) ?? 'auto',
    cornerRadius: radius === null ? 'auto' : radius === 'capsule' ? 'capsule' : Number(radius),
    cornerSmoothing: smoothing === null ? undefined : Number(smoothing),
    refraction: (element.getAttribute('refraction') as CssRefraction | null) ?? 'auto',
    interactive: element.hasAttribute('interactive'),
  }
}

/**
 * `<glass-surface>`: a block that renders as liquid glass over the page.
 *
 * ```html
 * <glass-surface variant="regular" corner-radius="capsule" interactive>Play</glass-surface>
 * ```
 * Attributes: `variant` (regular | clear | identity), `tint` (#rrggbb[aa]),
 * `appearance` (light | dark | auto), `corner-radius` (px | capsule),
 * `corner-smoothing` (0-1), `refraction` (auto | svg | none), `interactive`.
 */
export class GlassSurfaceElement extends HTMLElement {
  static readonly observedAttributes = OBSERVED
  private handle: CssGlassHandle | null = null

  connectedCallback() {
    if (!this.style.display) {
      this.style.display = 'block'
    }
    this.handle ??= glass(this, readOptions(this))
  }

  disconnectedCallback() {
    this.handle?.destroy()
    this.handle = null
  }

  attributeChangedCallback() {
    this.handle?.update(readOptions(this))
  }

  /** Whether SVG refraction is active for this surface. */
  get refracting() {
    return this.handle?.refracting ?? false
  }
}

/** Registers `<glass-surface>` (safe to call more than once). */
export function defineGlassSurface(name = 'glass-surface') {
  if (typeof customElements !== 'undefined' && !customElements.get(name)) {
    customElements.define(name, class extends GlassSurfaceElement {})
  }
}

defineGlassSurface()

declare global {
  interface HTMLElementTagNameMap {
    'glass-surface': GlassSurfaceElement
  }
}
