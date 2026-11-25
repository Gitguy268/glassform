# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Setup

You need Node.js 22 or newer and pnpm 10.

```sh
git clone https://github.com/Gitguy268/glassform.git
cd glassform
pnpm install
pnpm build          # builds every package
pnpm test           # unit tests (vitest)
npx playwright install chromium firefox webkit
pnpm e2e            # browser tests in Chromium, Firefox and WebKit
pnpm --filter @glassform/site dev   # the site on http://127.0.0.1:5199
```

## Rules of thumb

- WGSL (`packages/core/src/shaders.ts`) and GLSL (`packages/core/src/shaders-glsl.ts`) mirror each other function by function. Change both, then run `pnpm e2e`: the parity test compares the two backends.
- CPU-side packing lives in `packages/core/src/renderer/shape-packing.ts` and is shared by both backends. Keep backend files free of shape maths.
- Pick backends and content modes by feature detection, not user agent. The only exception is the CSS tier's SVG refraction check, which cannot be detected.
- Keep `packages/core/src/presets.generated.ts` generated: change it by re-running `node fidelity/tune.mjs`.
- No third-party images. Demo art comes from `scripts/make-art.mjs`.

## Pull requests

Keep them focused, describe what you changed and how you tested it, and add a changeset (`pnpm changeset`) when a package changes.
