import { createElement, useEffect, useRef, type CSSProperties, type ReactNode, type Ref } from 'react'
import { glass, type CssGlassHandle, type CssGlassOptions } from '@glassform/css'

/** Props for {@link GlassSurface}. */
export type GlassSurfaceProps = CssGlassOptions & {
  /** Element to render. Defaults to `div`. */
  as?: keyof HTMLElementTagNameMap
  className?: string
  style?: CSSProperties
  children?: ReactNode
  ref?: Ref<HTMLElement>
} & Omit<React.HTMLAttributes<HTMLElement>, 'style' | 'className' | 'children'>

/**
 * Liquid glass over ordinary page content (the CSS tier). Works in every
 * browser without a canvas; refracts on Chromium. Use LiquidCanvas instead
 * when the backdrop is an image, video, canvas or 3D scene.
 */
export function GlassSurface({
  as = 'div',
  variant,
  tint,
  appearance,
  cornerRadius,
  cornerSmoothing,
  refraction,
  interactive,
  params,
  className,
  style,
  children,
  ref,
  ...rest
}: GlassSurfaceProps) {
  const elementRef = useRef<HTMLElement | null>(null)
  const handleRef = useRef<CssGlassHandle | null>(null)
  const options: CssGlassOptions = { variant, tint, appearance, cornerRadius, cornerSmoothing, refraction, interactive, params }
  const optionsKey = JSON.stringify(options)

  useEffect(() => {
    const element = elementRef.current
    if (!element) {
      return
    }
    handleRef.current = glass(element, JSON.parse(optionsKey) as CssGlassOptions)
    return () => {
      handleRef.current?.destroy()
      handleRef.current = null
    }
    // Recreated only on mount; option changes go through update() below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    handleRef.current?.update(JSON.parse(optionsKey) as CssGlassOptions)
  }, [optionsKey])

  return createElement(
    as,
    {
      ...rest,
      className,
      style,
      ref: (node: HTMLElement | null) => {
        elementRef.current = node
        if (typeof ref === 'function') {
          ref(node)
        } else if (ref) {
          ;(ref as { current: HTMLElement | null }).current = node
        }
      },
    },
    children,
  )
}
