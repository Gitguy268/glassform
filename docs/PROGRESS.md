# glassform progress

Plan: `~/.claude/plans/create-the-best-liquid-recursive-engelbart-of-a9615da3-7964-4575-9602-fbea3727bf33.md`

## Decisions (user, 2026-11-25)
- Name glassform, `@glassform/*`, MIT. Sources: liquid-dom@dd342ab, liquid-glass-studio@36e8ef2, shuding/liquid-glass@a2d2e84 (all MIT).
- Fidelity is measured against native SwiftUI captures (SSIM/ΔE), not promised.
- Live DOM on Firefox/WebKit: CSS tier by default, opt-in snapshot.
- Publish: GitHub + Pages + Vercel + rolling release + portfolio card. npm later (packages npm-ready, not published).
- Repo lives at /Volumes/sandisk/pro/glassform (exFAT: symlinks OK, hardlinks not; `.npmrc` package-import-method=copy; core.fileMode=false).

## Engine probe (Playwright 1.65.1, 2026-11-25, `node e2e/probe.mjs`)
| engine | WebGL2 | float RT | WebGPU adapter | HTML-in-Canvas |
|---|---|---|---|---|
| Chromium 159 headless | yes (SwiftShader) | yes | no | yes, shipped by default |
| Chromium 159 + `--enable-unsafe-webgpu --use-angle=metal` | yes (Metal M4) | yes | yes | yes |
| Firefox 159 | yes | EXT_color_buffer_float yes, half_float no | no | no |
| WebKit (Safari 27.2) | yes | yes | yes | no |

- HTML-in-Canvas in Chromium 159 uses the renamed API: canvas `content="drawable"` (not `layoutsubtree`), children need `drawable`, 2D `drawElementImage(el, x, y)`, WebGPU `queue.drawElementImageToTexture({ source: el }, { texture, size })` (not `copyElementImageToTexture`), WebGL `texElementSubImage2D(target, level, x, y, el, { width, height })`. Paint events still carry `changedElements`. liquid-dom@dd342ab uses the old names, so its DOM path does nothing in stock Chromium until updated.
- `CSS.supports`/style parsing says `backdrop-filter: url()` everywhere; only Chromium renders it, so that one sub-feature needs an engine check.
- No float render-target fallback is needed (every engine has EXT_color_buffer_float).

## Native reference (fidelity/)
- `fidelity/native/probe-macos-27.2.1.txt`: liquid-dom's AppKit runtime probe. NSGlassEffectView uses a private `glassBackground` CAFilter (inner refraction -60/20, blur 5, face colour matrix white 1.125 black 0.08 saturation 1.3, key-fill highlight angle π/2 spread 2π/3 amount 0.5, aberration null) plus `vibrantColorMatrix` filters.
- `GlassformReference.app` (swiftc, CLT only) renders `fidelity/scenes.json` (41 scenes) with SwiftUI `.glassEffect()` and captures them with ScreenCaptureKit. It needs Screen Recording permission (asked 2026-11-25, pending). CARenderer and cacheDisplay do not include glass (window-server effect).
- Run: `fidelity/native/capture.sh` (one scene: `GLASSFORM_SCENE=<id>`). Rebuilding the app changes its ad-hoc signature, so the permission may need granting again.

## Done
- [x] Import liquid-dom packages as @glassform/* (96 upstream tests green)
- [x] Fidelity scenes, backgrounds, native capture app (captures pending permission)
- [x] Engine probe

## Next
1. Content sources: media (img/video/canvas) via copyExternalImageToTexture, and the new HTML-in-Canvas names.
2. WebGL2 port of the current WGSL, verbatim, with a webgpu-vs-webgl2 parity test.
3. Native-derived optics in both shader sets, then tuning against captures.
