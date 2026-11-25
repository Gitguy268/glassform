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
- [x] HTML-in-Canvas compat (new names; drawable hosts carry no CSS transform under the geometry API)
- [x] Content modes: element / media / snapshot (modern-screenshot) / overlay; Renderer.overlay sibling
- [x] WebGL2 backend (shaders-glsl.ts, webgl2/*), shared CPU packing; Chromium WebGL2 vs WebGPU SSIM 0.99999999
- [x] Face colour matrix + key light in both shader sets; materials.ts presets (seeded from probe, untuned)
- [x] fidelity/score.mjs (SSIM + CIEDE2000, mask = shapes + 24px halo)
- [x] @glassform/css (backdrop-filter tier + Chromium SVG refraction) and React GlassSurface
- [x] React: material prop, backend prop, Html source/fit/fallback
- [x] Three/R3F: WebGL2 path (classic WebGLRenderer + WebGPURenderer WebGL fallback), verified in 3 engines

## Gotchas
- Playwright WebKit/Firefox screenshots (headless and headed) do not include backdrop-filter; CSS tier is checked visually in Chromium and by computed style elsewhere.
- isolation:isolate is a backdrop root in WebKit/Firefox; the CSS tier uses z-index:0 instead.
- Three leaves CULL_FACE on; the attribute-less fullscreen triangle is clockwise, so GL passes disable culling.
- Three render targets are bottom-up: WebGl2GlassCore.render({ backdropFlipY: true }).
- GlassformReference needs its own Removable Volumes access, so it stages in ~/Library/Caches/glassform-fidelity.

## Status 2026-11-25 evening
- Done: site (apps/site), e2e (25 pass), repo files, README, CI + Pages workflows, history purged of third-party demo images.
- 41 native captures + per-scene filter dumps committed (fidelity/native/capture-all.sh, one launch per scene: the app segfaults after 2 scenes because windows are released on close; fix `win.isReleasedWhenClosed = false` in main.swift AFTER captures, since a rebuild loses the Screen Recording grant).
- Native values differ by variant (see materials.ts table). Added faceMaxLuma + adaptiveBezel (both shader sets).
- Baseline before tuning (chromium-webgpu): mean SSIM 0.741, ΔE 6.67. Native blur is much wider than CA radius 5 suggests; presets start at blur 14/16, no shadow.
- tune.mjs was started in the background (log: session scratchpad tune.log); it writes packages/core/src/presets.generated.ts and fidelity/tuning.json when done. If it did not finish, rerun `node fidelity/tune.mjs --minutes 11`.

## Tuned 2026-11-25
All engines: SSIM 0.941, ΔE 2.10, 70.5 % under ΔE 2 (before: 0.741 / 6.67). TINT_STRENGTH fitted to 0.08. Swift crash fixed in source (rebuild needs the permission again).

## Next (done unless noted)
1. Check presets.generated.ts, rebuild core, `node fidelity/score.mjs`, `node fidelity/publish-report.mjs`; put the real scores in README (How close to native / Tested tables) and drop the "pending" text.
2. Run `pnpm e2e`, rebuild site, recapture media (scripts/capture-media.mjs).
3. Publish: gh repo create Gitguy268/glassform --public (topics, description, homepage), push (gh credential helper), enable Pages (workflow), Vercel deploy (--archive=tgz), rolling release via ~/rolling-release (kind web, pages ["Pages","pages.yml"]), portfolio card (check.mjs count +1).
