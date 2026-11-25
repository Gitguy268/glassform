import { useState } from 'react'
import { GlassSurface } from '@glassform/react'
import { supportsSvgBackdropFilter } from '@glassform/css'

export default function WebPages() {
  const [count, setCount] = useState(0)
  const refracts = supportsSvgBackdropFilter()
  return (
    <div className="page">
      <h1>Glass over a normal web page</h1>
      <p className="lede">
        No canvas here. <code>GlassSurface</code> (or <code>&lt;glass-surface&gt;</code>) puts glass over whatever the page shows: text you can select,
        scrolling content, video. It uses the same material presets as the GPU renderer.
        {refracts ? ' This browser also bends the content at the rim through an SVG displacement filter.' : ' This browser gets blur, colour and rim light; refraction over live HTML needs Chromium, or the GPU renderer with a snapshot.'}
      </p>
      <div className="webdemo">
        <div className="scroller">
          <h3>Scroll this page</h3>
          <p>Everything you see here is ordinary HTML. The bar at the bottom and the card on the right are glass surfaces that blur, tint and light the content scrolling beneath them, live, at full frame rate.</p>
          <div className="swatches">{['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93'].map((c) => <span key={c} style={{ background: c }} />)}</div>
          {Array.from({ length: 8 }, (_, i) => (
            <p key={i}>Paragraph {i + 1}. Glass on the web used to mean a flat blur. Liquid glass adds a bright rim facing the light, a softer one facing away, a gentle lift of the colours behind it and, where the browser allows it, a lens that bends the content toward the edge.</p>
          ))}
        </div>
        <GlassSurface className="side" cornerRadius={24}>
          <strong>Side card</strong>
          <p style={{ margin: '6px 0 0', lineHeight: 1.45 }}>Regular glass, 24 px continuous corners.</p>
        </GlassSurface>
        <GlassSurface className="floating" cornerRadius="capsule" interactive>
          <button type="button" onClick={() => setCount((c) => c + 1)}>Like {count > 0 ? `· ${count}` : ''}</button>
          <GlassSurface as="span" cornerRadius="capsule" tint="#0a84ff" interactive style={{ display: 'inline-block' }}>
            <button type="button" style={{ color: '#fff' }}>Share</button>
          </GlassSurface>
          <button type="button">More</button>
        </GlassSurface>
      </div>

      <h2>Use it</h2>
      <pre>{`<script type="module">import '@glassform/css/element'</script>

<glass-surface corner-radius="capsule" interactive>Play</glass-surface>
<glass-surface variant="clear" tint="#0a84ff" corner-radius="24">…</glass-surface>`}</pre>
      <pre>{`import { glass } from '@glassform/css'

const handle = glass(document.querySelector('.toolbar'), {
  variant: 'regular',      // 'regular' | 'clear' | 'identity'
  appearance: 'auto',      // follows prefers-color-scheme
  cornerRadius: 'capsule',
  interactive: true,
})
handle.update({ tint: '#ff3b30' })
handle.destroy()`}</pre>
    </div>
  )
}
