# @glassform/core

## Description

`@glassform/core` provides the liquid-glass renderer. It includes an imperative scene graph, a `Renderer` that owns a canvas and draws with WebGPU or WebGL2, reusable WebGPU and WebGL2 cores for adapters, SwiftUI-style materials (`resolveMaterial`), and a layout API under `@glassform/core/layout`.

## Install

```sh
pnpm add @glassform/core
```

## Quick Start

```ts
import { Container, Glass, Html, Renderer, Scene } from '@glassform/core'

const scene = new Scene()

const backgroundElement = document.createElement('div')
backgroundElement.className = 'background'

scene.add(new Html({
  width: 800,
  height: 600,
  zIndex: -1,
  element: backgroundElement,
}))

const container = new Container({
  x: 120,
  y: 120,
  blur: 12,
  spacing: 28,
  thickness: 90,
  tint: { r: 0.15, g: 0.15, b: 0.15, a: 0.7 },
})

const glass = new Glass({
  width: 280,
  height: 180,
  cornerRadius: 48,
  cornerSmoothing: 0.6,
  pointerEvents: true,
})

const content = document.createElement('button')
content.textContent = 'Native content'

glass.add(new Html({
  x: 24,
  y: 24,
  width: 180,
  height: 56,
  element: content,
}))

container.add(glass)
scene.add(container)

const renderer = new Renderer({ scene })
document.body.append(renderer.canvas)

function frame() {
  renderer.render()
  requestAnimationFrame(frame)
}
frame()
```

## API Overview

### Scene Graph

```ts
import {
  Container,
  Glass,
  Group,
  Html,
  Scene,
  StackingContext,
} from '@glassform/core'
```

- `Scene` is the root and accepts `Container`, `Html`, and `Group` children.
- `Container` accepts `Glass` and `Group` children. Glass children in the same container are fused into one SDF field and share optical settings.
- `Glass` accepts `Html` and `Group` children. Each `Html` child is sampled through the owning glass.
- `Html` owns a host element and optionally mounts an `HTMLElement` into that host.
- `Group` composes transforms without changing stacking order.
- `StackingContext` groups children under a shared `zIndex`.

Scene children are rendered by `zIndex`, then by entry order. Scene-level `Html` below a container becomes backdrop content for that container; scene-level `Html` above a container covers it and becomes backdrop content for later containers.

All transformable scene nodes accept and expose `x`, `y`, `scaleX`, `scaleY`, `rotation`, and `origin`. `x`, `y`, and `origin` are CSS pixels; `rotation` is radians.

Scene graph classes:

| Class | Constructor options | Public API |
| --- | --- | --- |
| `Scene` | none | `add(child)` |
| `Container` | Transform props plus container options below | `add(child)`, `remove()` |
| `Glass` | Transform props plus `width`, `height`, `cornerRadius`, `cornerSmoothing`, `pointerEvents`, `zIndex` | `add(child)`, `remove()`, typed pointer event listeners |
| `Html` | Transform props plus `width`, `height`, `opacity`, `blur`, `zIndex`, `element` | `host`, `element`, `setElement(element)`, `remove()` |
| `Group` | Transform props | `add(child)`, `remove()` |
| `StackingContext` | Transform props plus `zIndex` | `add(child)`, `remove()`, `zIndex` |

### Html Options

`Html` nodes wrap live DOM content and are copied into GPU textures before compositing. Common options are:

- `element`: DOM element mounted into the `Html.host` element.
- `opacity`: final opacity used when compositing the copied HTML texture.
- `blur`: GPU blur radius in CSS pixels. `blur <= 0` uses the unfiltered fast path.
- `zIndex`: scene draw order among sibling scene or glass HTML nodes.

`Html.blur` is renderer-backed. It does not apply a CSS filter to the DOM element; the renderer keeps the raw DOM-copied texture, applies the adaptive blur pipeline when needed, then composites either the raw or blurred texture. This works for scene-level `Html` and for `Html` rendered inside glass.

```ts
const panelContent = new Html({
  width: 240,
  height: 160,
  element: contentElement,
  opacity: 0.9,
  blur: 8,
})

glass.add(panelContent)
```

### Glass Shape Options

`Glass` uses a uniform `cornerRadius` and an analytic `cornerSmoothing` approximation for continuous, iOS-like corners:

```ts
const glass = new Glass({
  width: 280,
  height: 180,
  cornerRadius: 32,
  cornerSmoothing: 0.6,
})
```

`cornerSmoothing: 0` produces circular rounded-rectangle corners. Higher values use a fuller p-norm corner curve; the default `0.6` is tuned for an iOS-like squircle. Very constrained corners automatically reduce smoothing back toward a circular shape.

### Node Relationship Rules

Scene graph children must match the nearest non-group parent:

- `Scene` accepts `Container`, `Html`, and `Group` children.
- `Container` accepts `Glass` and `Group` children.
- `Glass` accepts `Html` and `Group` children.
- `Group` and `StackingContext` can be inserted anywhere, but every nested descendant still has to be valid for the nearest non-group parent.

That means a `Glass` must ultimately be nested under a `Container`; it cannot be nested under another `Glass`. Wrapping nodes in `Group`, `StackingContext`, or layout nodes does not make an invalid scene relationship valid. For example, a `Glass` nested under a layout node that is itself nested under a `Glass` is still invalid, because the nearest non-layout glass scene parent only accepts `Html` descendants.

### Container Options

`Container` controls the optical behavior for its glass children. Options can be passed to the constructor or mutated as properties:

| Group | Properties |
| --- | --- |
| Shape and fusion | `spacing`, `normalGating`, `blendSupportGating` |
| Blur and displacement | `blur`, `bezelWidth`, `displacementFactor`, `displacementBlur`, `debugDisplacement` |
| Refraction | `thickness`, `ior`, `contentIor`, `contentDepth`, `dispersion`, `surfaceProfile` |
| Specular and reflection | `lightDirection`, `specularStrength`, `specularWidth`, `specularFalloff`, `oppositeSpecularStrength`, `specularSharpness`, `specularOpacity`, `reflectionOffset` |
| Color and shadow | `tint`, `shadowColor`, `shadowOffsetX`, `shadowOffsetY`, `shadowBlur`, `shadowSpread` |
| Compositing | `opacity`, `zIndex` |

Default values:

| Property | Default |
| --- | --- |
| `opacity` | `1` |
| `spacing` | `12` |
| `blur` | `8` |
| `bezelWidth` | `14` |
| `thickness` | `90` |
| `displacementFactor` | `1` |
| `displacementBlur` | `6` |
| `normalGating` | `{ enabled: true }` |
| `ior` | `1.5` |
| `contentIor` | `1` |
| `contentDepth` | `0` |
| `dispersion` | `0` |
| `surfaceProfile` | `'convex'` |
| `lightDirection` | `-Math.PI / 4` |
| `specularStrength` | `1` |
| `specularWidth` | `1` |
| `specularFalloff` | `1` |
| `oppositeSpecularStrength` | Matches `specularStrength` when omitted. |
| `specularSharpness` | `2` |
| `specularOpacity` | `0.45` |
| `reflectionOffset` | `18` |
| `tint` | `{ r: 1, g: 1, b: 1, a: 0.15 }` |
| `shadowColor` | `{ r: 0, g: 0, b: 0, a: 0.12 }` |
| `shadowOffsetX` | `0` |
| `shadowOffsetY` | `10` |
| `shadowBlur` | `24` |
| `shadowSpread` | `0` |
| `debugDisplacement` | `false` |
| `blendSupportGating` | `{ enabled: true, cellSize: 100 }` |
| `zIndex` | `0` |

`specularWidth` accepts a CSS pixel number or `'hairline'`. Numeric values scale with DPR; `'hairline'` resolves to one device pixel at the active DPR.

`SurfaceProfile` is `'convex'`, `'concave'`, or `'lip'`. `RgbaColor` channels use normalized `0..1` values.

### Glass Pointer Events

Enable renderer-side SDF hit testing per glass with `pointerEvents: true`.

```ts
glass.addEventListener('click', (event) => {
  console.log(event.localX, event.localY)
})
```

Supported event names are `click`, `pointerenter`, `pointerleave`, `pointermove`, `pointerdown`, `pointerup`, and `pointercancel`. `GlassPointerEvent` exposes the source `glass`, `renderer`, native pointer event, canvas coordinates, glass-local coordinates, and whether the pointer is inside the shape.

Glass pointer hits are based on the individual glass shape, not fused bridge regions between neighboring glass nodes. Hosted DOM elements can still receive normal browser pointer events.

### Renderer

```ts
const renderer = new Renderer({
  scene,
  maxDpr: 2,
})

renderer.render()
renderer.destroy()
```

`Renderer` creates a `<canvas content="drawable">`. Append `renderer.canvas` to the page, size it with CSS, and call `render()` from your own frame loop. Use `destroy()` to release GPU and DOM resources. Constructor options are `scene?: Scene`, `maxDpr?: number` (default `2`, mutable), `backend?: 'auto' | 'webgpu' | 'webgl2'` (default `'auto'`: WebGPU, else WebGL2) and `onNeedsFrame?: () => void`. `await renderer.ready` resolves with the backend in use; `renderer.backend` reports it afterwards. `renderer.overlay` is the live-DOM layer the renderer inserts next to the canvas when it needs one.

Backdrop metrics can be enabled per container:

```ts
renderer.setBackdropMetricsTracking(container, true)
const metrics = renderer.getBackdropMetrics(container)
```

`BackdropMetrics` contains `averageLinearColor`, `averageLuminance`, `luminanceP10`, `luminanceP50`, and `luminanceP90`.

### Layout Subpath

`@glassform/core/layout` wraps the imperative scene graph in layout nodes powered by `@glassform/layout`.

```ts
import {
  Frame,
  Glass,
  GlassContainer,
  HStack,
  Html,
  LayoutScene,
} from '@glassform/core/layout'
```

Use this subpath when building a non-React layout UI. `LayoutScene.layout(proposal)` measures and places layout nodes, then synchronizes their scene graph nodes. The React package builds on the same classes.

Layout subpath public API:

| Class or type | Options/properties |
| --- | --- |
| `LayoutScene` | `root`, `scene`, `engine`, `add(child)`, `layout(proposal)`, `getDebugStats()`, `addInvalidationListener(listener)`, `dispose()` |
| `HStack`, `VStack` | `spacing`, `alignment` |
| `ZStack` | `alignment` |
| `Frame` | `width`, `height`, `minWidth`, `minHeight`, `idealWidth`, `idealHeight`, `maxWidth`, `maxHeight`, `alignment` |
| `Padding` | `insets` |
| `Background`, `Overlay` | `alignment`, `setContent(child)`, `setDecoration(child)` |
| `Transform` | `x`, `y`, `scaleX`, `scaleY`, `rotation`, `origin` |
| `GlassContainer` | Same optical properties as `Container`, except transform props are layout-owned. |
| `Glass` | `cornerRadius`, `cornerSmoothing`, `pointerEvents`, `zIndex` |
| `Html` | `sizing`, `opacity`, `blur`, `zIndex`, `element`, `setElement(element)` |
| `Spacer` | `minLength` |

Every layout UI class exposes `layoutNode`, `sceneNode`, `children`, `add(child)`, and `remove()`, except `Html` and `Spacer` are leaves and reject children.

The `Html` layout node exposes the same compositing options as scene `Html`, including `opacity`, `blur`, and `zIndex`.

Some layout nodes accept exactly one direct child: `Frame`, `Padding`, `Transform`, `GlassContainer`, and `Glass`. If you need multiple children inside one of these nodes, put those children inside a multi-child layout node such as `HStack`, `VStack`, or `ZStack`, then use that layout node as the single child.

`Transform.origin` is a unit point in the measured layout bounds, where `{ x: 0, y: 0 }` is top-left and `{ x: 0.5, y: 0.5 }` is center. The layout node resolves that unit point to the CSS-pixel scene graph origin after measurement.

The synchronized scene graph still follows the scene node relationship rules above. All nested children have to conform to the parent rules, even when they pass through layout-only nodes.

Exported layout types include `LayoutUiNode`, `LayoutSceneOptions`, `LayoutSceneInvalidationKind`, `LayoutSceneInvalidation`, `LayoutSceneInvalidationListener`, `GlassContainerOptions`, `GlassOptions`, `HtmlOptions`, `TransformOptions`, and `UnitPoint`.

### WebGPU Core For Adapters

```ts
import {
  WebGpuDomContentSource,
  WebGpuGlassCore,
  type WebGpuGlassContentSource,
} from '@glassform/core'
```

`WebGpuGlassCore` renders a `Scene` into a supplied output `GPUTexture` using an already-created `GPUDevice` and format. It is intended for renderer adapters that already own a WebGPU context.

`WebGpuGlassCore` accepts `{ device, format }`, then exposes `render(options)`, `setBackdropMetricsTracking(container, enabled)`, `getBackdropMetrics(container)`, and `destroy()`. `render(options)` accepts `scene` or pre-flattened `layers`, `width`, `height`, `dpr`, `outputTexture`, optional `backdropTexture`, and optional `contentSource`.

`WebGpuDomContentSource` copies DOM-backed `Html` content into textures for the core renderer. It accepts `targetCanvas`, `getCurrentDpr`, and optional `scene`, then exposes `setDevice(device, format)`, `sync(scene?)`, `getSceneHtmlEntry(html)`, `getGlassContentRange(glass)`, `atlasTexture`, `contentEntriesBindingResource`, and `destroy()`.

Adapters can provide their own `WebGpuGlassContentSource` with optional `atlasTexture`, `contentEntriesBindingResource`, `getSceneHtmlEntry(html)`, and `getGlassContentRange(glass)`. `resolveSpecularWidthPx(specularWidth, dpr)` resolves public specular width semantics into device pixels.

### Exported Types

The root package exports `GlassPointerEvent`, `GlassPointerEventType`, `GlassPointerEventInit`, `Point`, `Transform`, `RgbaColor`, `SpecularWidth`, `SurfaceProfile`, `BackdropMetrics`, `WebGpuGlassCoreInit`, `WebGpuGlassCoreRenderOptions`, `WebGpuDomContentSourceInit`, and `WebGpuGlassContentSource`.

## Integration Notes

- Rendering uses WebGPU where an adapter exists and WebGL2 otherwise. Both backends run the same passes.
- `Html` content is drawn live with HTML-in-Canvas where the browser ships it (Chromium 159+, no flag). Elsewhere, set `source` to an image, video or canvas (refracts in every browser), or let `fallback: 'auto'` snapshot backdrop DOM and show DOM on glass as a live overlay above the canvas.
- `Renderer` owns its canvas; adapter packages should use `WebGpuGlassCore` or `WebGl2GlassCore` with `WebGpuDomContentSource` or `WebGl2DomContentSource`.
- DOM content is copied into GPU textures before glass rendering, so call the content source sync path before rendering when writing an adapter.
- A container's glass nodes share one fused SDF field. Use separate containers for independently composited glass layers.
- Reference: [WICG HTML-in-Canvas](https://wicg.github.io/html-in-canvas/).

## Local Development

```sh
pnpm --filter @glassform/core build
pnpm --filter @glassform/core test
pnpm --filter @glassform/core watch
```
