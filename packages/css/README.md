# @glassform/css

Liquid glass over ordinary page content: text, scrolling lists, video. No canvas and no GPU context, so you can use as many surfaces as you like.

It applies the same material presets as the GPU renderer through `backdrop-filter` (blur, saturation and black/white levels), a tint layer, a gradient rim facing the light, a key light and a shadow. On Chromium it also refracts: an SVG `feDisplacementMap` bends the content at the rim, using a map built from the renderer's squircle SDF and bezel profile. Firefox and Safari parse `backdrop-filter: url()` but do not render it, so they get blur, colour and light without the lens.

## Install

From a clone of the repository (the packages are not on npm yet):

```sh
pnpm install && pnpm build
```

## Use

```html
<script type="module">import '@glassform/css/element'</script>

<glass-surface corner-radius="capsule" interactive>Play</glass-surface>
<glass-surface variant="clear" tint="#0a84ff" corner-radius="24">Tinted</glass-surface>
```

```js
import { glass } from '@glassform/css'

const handle = glass(document.querySelector('.toolbar'), {
  variant: 'regular',     // 'regular' | 'clear' | 'identity'
  appearance: 'auto',     // 'light' | 'dark' | 'auto' (prefers-color-scheme)
  cornerRadius: 'capsule',// px, 'capsule' or 'auto' (reads border-radius)
  cornerSmoothing: 0.6,   // 0 circular, 0.6 iOS-like
  refraction: 'auto',     // 'auto' | 'svg' | 'none'
  interactive: true,      // pointer highlight and press bounce
  params: { blur: 8 },    // override any material parameter
})
handle.update({ tint: '#ff3b30' })
handle.refracting         // true where SVG refraction is active
handle.destroy()
```

In React, use `GlassSurface` from `@glassform/react`.

## Notes

- The element gets `position: relative` (if static) and `z-index: 0` so its layers sit under its content. `isolation: isolate` is avoided on purpose: WebKit and Firefox treat it as a backdrop root, and the blur would see nothing.
- The engine check for SVG refraction (`supportsSvgBackdropFilter()`) is the only place glassform looks at the browser brand. Rendering support for `backdrop-filter: url()` cannot be detected from script.
- For glass over images, video, canvases or 3D scenes, the GPU renderer in `@glassform/core` refracts in every browser.

## License

MIT. The refraction idea comes from [shuding/liquid-glass](https://github.com/shuding/liquid-glass) (MIT); see NOTICE.
