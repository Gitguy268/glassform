# @glassform/three

## Description

`@glassform/three` hosts the liquid-glass core inside a Three renderer: the WebGPU core for `WebGPURenderer`, the WebGL2 core for `WebGLRenderer` or WebGPURenderer's WebGL fallback. It lets you render a Three scene into a backdrop texture, then composite liquid glass over that backdrop into the canvas or another output texture.

## Install

```sh
pnpm add @glassform/three @glassform/core three
```

## Quick Start

```ts
import * as THREE from 'three/webgpu'
import { Container, Glass, Scene } from '@glassform/core'
import { ThreeGlassRenderer } from '@glassform/three'

const canvas = document.querySelector('canvas')!
const renderer = new THREE.WebGPURenderer({ canvas })
await renderer.init()

const threeScene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
const backdrop = new THREE.RenderTarget(1, 1, {
  colorSpace: THREE.SRGBColorSpace,
})

const glassScene = new Scene()
const container = new Container({ blur: 12, spacing: 28 })
container.add(new Glass({
  x: 120,
  y: 120,
  width: 280,
  height: 160,
  cornerRadius: 44,
}))
glassScene.add(container)

const glassRenderer = new ThreeGlassRenderer({
  renderer,
  scene: glassScene,
})

const drawingSize = new THREE.Vector2()

function frame() {
  renderer.getDrawingBufferSize(drawingSize)
  backdrop.setSize(drawingSize.x, drawingSize.y)

  renderer.setRenderTarget(backdrop)
  renderer.render(threeScene, camera)
  renderer.setRenderTarget(null)

  glassRenderer.render({
    backdrop,
    width: drawingSize.x,
    height: drawingSize.y,
  })

  requestAnimationFrame(frame)
}
frame()
```

## API Overview

### `ThreeGlassRenderer`

```ts
const glass = new ThreeGlassRenderer({
  renderer,
  scene,
  format,
  contentSource,
})

glass.render({
  scene,
  backdrop,
  contentSource,
  outputTexture,
  width,
  height,
  dpr,
})

glass.destroy()
```

Constructor options:

- `renderer`: initialized Three WebGPU renderer.
- `scene`: optional `@glassform/core` scene. Defaults to a new empty scene.
- `format`: optional output `GPUTextureFormat` override.
- `contentSource`: optional DOM or custom content source for glass HTML.

Instance API:

| API | Description |
| --- | --- |
| `scene` | The default `@glassform/core` scene used by `render()`. |
| `device` | Three WebGPU backend device. |
| `format` | Output format override, Three backend preferred format, or `navigator.gpu.getPreferredCanvasFormat()`. |
| `getGpuTexture(backdrop)` | Resolves a `GPUTexture` from a `GPUTexture`, Three `RenderTarget`, or Three `Texture`. |
| `render(options)` | Composites liquid glass over a backdrop. |
| `destroy()` | Releases GPU resources owned by the adapter. |

Render options:

- `backdrop`: `GPUTexture`, Three `RenderTarget`, or Three `Texture` containing the already-rendered background.
- `scene`: optional scene override for this render call.
- `contentSource`: optional content source override.
- `outputTexture`: optional output `GPUTexture`. Defaults to the current canvas texture.
- `width`, `height`: output dimensions in device pixels. Defaults to Three's drawing buffer size.
- `dpr`: CSS-to-device pixel ratio. Defaults to Three's pixel ratio.

Public types:

| Type | Fields |
| --- | --- |
| `ThreeWebGpuBackend` | `isWebGPUBackend`, `device`, `utils.getPreferredCanvasFormat`, `get(object)` |
| `ThreeWebGpuBackendReady` | `ThreeWebGpuBackend` with `isWebGPUBackend: true` and `device` |
| `ThreeWebGpuRenderer` | `backend`, `getContext()`, `getDrawingBufferSize(target)`, `getPixelRatio()` |
| `ThreeWebGpuRenderTargetRenderer` | `ThreeWebGpuRenderer` plus `domElement`, `render(scene, camera)`, `setRenderTarget(target)` |
| `ThreeWebGpuRendererValidationOptions` | `owner?: string`, `help?: string` |
| `ThreeGlassRendererInit` | Constructor options listed above. |
| `ThreeGlassRenderOptions` | Render options listed above. |

### Validation Helpers

```ts
import {
  requireThreeWebGpuBackend,
  requireThreeWebGpuCanvasContext,
  requireThreeWebGpuRenderer,
  requireThreeWebGpuRenderTargetRenderer,
} from '@glassform/three'
```

These helpers validate that a renderer is backed by Three's WebGPU backend and exposes the methods needed by each integration layer. They throw explicit errors with optional `owner` and `help` text.

| Helper | Returns |
| --- | --- |
| `requireThreeWebGpuBackend(renderer, options?)` | `ThreeWebGpuBackendReady` |
| `requireThreeWebGpuRenderer(renderer, options?)` | `ThreeWebGpuRenderer` |
| `requireThreeWebGpuCanvasContext(renderer, options?)` | `GPUCanvasContext` |
| `requireThreeWebGpuRenderTargetRenderer(renderer, options?)` | `ThreeWebGpuRenderTargetRenderer` |

### Backdrop And Output Flow

The adapter does not render your Three scene for you. Render the Three scene into a target, then pass that target as `backdrop`. The liquid-glass pass samples the backdrop and writes the composited result to `outputTexture` or the canvas current texture.

Call `destroy()` when the adapter is no longer needed so GPU resources owned by the liquid-glass core are released.

## Integration Notes

- `ThreeGlassRenderer.backend` reports `'webgpu'` or `'webgl2'`. On WebGL2 the adapter draws to the default framebuffer, flips Three's bottom-up render targets and resets Three's GL state cache afterwards.
- On WebGL2, use `WebGl2DomContentSource` instead of `WebGpuDomContentSource`.
- A Three `Texture` or `RenderTarget` must have an initialized backend GPU texture before it can be used as `backdrop`; render to it first if needed.
- Use `WebGpuDomContentSource` from `@glassform/core` when the liquid-glass scene includes DOM-backed `Html` content.
- `Html` content is drawn live with HTML-in-Canvas where the browser ships it (Chromium 159+, no flag). Elsewhere, set `source` to an image, video or canvas (refracts in every browser), or let `fallback: 'auto'` snapshot backdrop DOM and show DOM on glass as a live overlay above the canvas.
- Reference: [WICG HTML-in-Canvas](https://wicg.github.io/html-in-canvas/).

## Local Development

```sh
pnpm --filter @glassform/three build
pnpm --filter @glassform/three watch
```
