# Changelog

## 0.1.0 (unreleased)

First version.

- WebGPU renderer from liquid-dom, plus a WebGL2 backend with the same passes (Firefox, older Safari, GPU-less Chromium).
- Works with the HTML-in-Canvas API that ships in Chromium 159 (`content="drawable"`, `drawElementImageToTexture`, `updateElementGeometry`).
- Content modes for browsers without HTML-in-Canvas: media sources, DOM snapshots and a live DOM overlay.
- SwiftUI-style materials (`regular`, `clear`, `identity`, tint, light and dark) seeded from the macOS `glassBackground` filter, with a face colour matrix and key light.
- `@glassform/css`: glass over ordinary pages with `glass()` and `<glass-surface>`, SVG refraction on Chromium.
- React: `material` prop, `backend` prop, `Html` media sources, `GlassSurface`.
- Three.js and React Three Fiber on WebGLRenderer as well as WebGPURenderer.
- Fidelity harness: SwiftUI reference app, 41 native captures, SSIM and CIEDE2000 scorer, preset tuner. Presets fitted to macOS 27.2.1: mean SSIM 0.941, mean ΔE2000 2.10 in Chromium, Firefox and WebKit (0.741 / 6.67 before tuning).
- Site with showcase, playground, CSS tier, 3D and docs.
