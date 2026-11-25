import * as sdfUtilsValues from './sdf-utils'
import type {
  BoundsRect as SdfUtilsBoundsRect,
  ResolvedSmoothUnionOptions as SdfUtilsResolvedSmoothUnionOptions,
  SdfSample as SdfUtilsSdfSample,
  ShapeSubmersionCell as SdfUtilsShapeSubmersionCell,
  ShapeSubmersionEntry as SdfUtilsShapeSubmersionEntry,
  ShapeSubmersionGrid as SdfUtilsShapeSubmersionGrid,
  ShapeSubmersionGridValues as SdfUtilsShapeSubmersionGridValues,
  SmoothUnionOptions as SdfUtilsSmoothUnionOptions,
  TransformedShapeBounds as SdfUtilsTransformedShapeBounds,
} from './sdf-utils'

export { GlassPointerEvent } from './events'
export { Glass, Html, Container, Group, StackingContext, Scene } from './scene'
export { Renderer, WebGpuGlassCore, WebGpuDomContentSource, resolveSpecularWidthPx } from './renderer'
export type { GlassBackend, GlassBackendPreference } from './renderer'
export { WebGl2GlassCore } from './renderer/webgl2/core'
export type { GlSceneHtmlEntry, WebGl2GlassContentSource, WebGl2GlassCoreRenderOptions } from './renderer/webgl2/core'
export { WebGl2ContentSync } from './renderer/webgl2/content-sync'
export { detectHtmlInCanvas } from './renderer/html-in-canvas'
export {
  DEFAULT_MATERIAL_PRESETS,
  parseColor,
  resolveMaterial,
  setMaterialPresets,
} from './materials'
export type { GlassAppearance, GlassMaterial, GlassVariant, MaterialParameters } from './materials'
export type { HtmlContentMode } from './renderer/pixel-sources'
export const sdfUtils = sdfUtilsValues
export namespace sdfUtils {
  export type BoundsRect = SdfUtilsBoundsRect
  export type ResolvedSmoothUnionOptions = SdfUtilsResolvedSmoothUnionOptions
  export type SdfSample = SdfUtilsSdfSample
  export type ShapeSubmersionCell = SdfUtilsShapeSubmersionCell
  export type ShapeSubmersionEntry = SdfUtilsShapeSubmersionEntry
  export type ShapeSubmersionGrid = SdfUtilsShapeSubmersionGrid
  export type ShapeSubmersionGridValues = SdfUtilsShapeSubmersionGridValues
  export type SmoothUnionOptions = SdfUtilsSmoothUnionOptions
  export type TransformedShapeBounds = SdfUtilsTransformedShapeBounds
}
export type { GlassPointerEventInit, GlassPointerEventType } from './events'
export type { ContainerInit, GlassInit, HtmlFallback, HtmlFit, HtmlInit, HtmlPixelSource } from './scene'
export type {
  WebGpuDomContentSourceInit,
  WebGpuGlassContentSource,
  WebGpuGlassCoreInit,
  WebGpuGlassCoreRenderOptions,
} from './renderer'
export type {
  BackdropMetrics,
  Point,
  RgbaColor,
  SpecularWidth,
  SurfaceProfile,
  Transform,
} from './types'
export type {
  BlendSupportGating,
  BlendSupportGatingOptions,
  NormalGating,
  NormalGatingOptions,
  ResolvedBlendSupportGating,
  ResolvedSmoothUnionOptions,
  ResolvedNormalGating,
  SmoothUnionOptions,
} from './sdf'
