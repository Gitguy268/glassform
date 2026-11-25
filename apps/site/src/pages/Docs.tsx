export default function Docs() {
  return (
    <div className="page">
      <h1>Docs</h1>
      <p className="lede">Six packages, one look. Pick the layer that matches what is behind your glass.</p>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Package</th><th>Use it when</th></tr></thead>
          <tbody>
            <tr><td><code>@glassform/react</code></td><td>You write React. <code>LiquidCanvas</code> for GPU glass, <code>GlassSurface</code> for glass over page content.</td></tr>
            <tr><td><code>@glassform/css</code></td><td>Glass over an ordinary page, no framework: <code>glass(el)</code> or <code>&lt;glass-surface&gt;</code>.</td></tr>
            <tr><td><code>@glassform/core</code></td><td>Imperative scene graph and renderer (WebGPU and WebGL2), materials, content sources.</td></tr>
            <tr><td><code>@glassform/three</code></td><td>You render a Three.js scene and want glass composited over it.</td></tr>
            <tr><td><code>@glassform/r3f</code></td><td>React Three Fiber.</td></tr>
            <tr><td><code>@glassform/layout</code></td><td>SwiftUI-style layout without any renderer.</td></tr>
          </tbody>
        </table>
      </div>

      <h2>Which backend runs where</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Browser</th><th>Renderer</th><th>Live HTML behind glass</th><th>CSS tier refraction</th></tr></thead>
          <tbody>
            <tr><td>Chrome, Edge, Brave, Opera (159+)</td><td>WebGPU, else WebGL2</td><td>Yes (HTML-in-Canvas)</td><td>Yes</td></tr>
            <tr><td>Safari 26+</td><td>WebGPU, else WebGL2</td><td>Snapshot, or live overlay on top</td><td>Blur and colour only</td></tr>
            <tr><td>Firefox</td><td>WebGPU where enabled, else WebGL2</td><td>Snapshot, or live overlay on top</td><td>Blur and colour only</td></tr>
          </tbody>
        </table>
      </div>
      <p className="muted">The renderer picks a backend by feature detection. Images, video, canvases and 3D scenes refract in every browser.</p>

      <h2>React</h2>
      <pre>{`import { LiquidCanvas, ZStack, Html, Frame, GlassContainer, Glass } from '@glassform/react'

export function Player({ cover }) {
  return (
    <LiquidCanvas style={{ width: 420, height: 280 }}>
      <ZStack>
        <Html zIndex={-1} sizing="fill" source={cover} fit="cover" />
        <GlassContainer material={{ variant: 'regular' }} spacing={24}>
          <Frame width={260} height={64}>
            <Glass cornerRadius={32} onClick={() => play()} />
          </Frame>
        </GlassContainer>
      </ZStack>
    </LiquidCanvas>
  )
}`}</pre>
      <details>
        <summary>LiquidCanvas props</summary>
        <p><code>backend</code> (<code>'auto' | 'webgpu' | 'webgl2'</code>), <code>maxDpr</code> (default 2), <code>frameloop</code> (<code>'always' | 'demand'</code>),
          <code>className</code>, <code>style</code>, <code>canvasClassName</code>, <code>canvasStyle</code>, <code>onError</code>.</p>
      </details>
      <details>
        <summary>GlassContainer props</summary>
        <p><code>material</code> sets SwiftUI-style defaults: <code>{`{ variant: 'regular' | 'clear' | 'identity', tint: '#0a84ff', appearance: 'light' | 'dark' }`}</code>.
          Any prop you pass wins over the material.</p>
        <p>Shape and merging: <code>spacing</code>, <code>bezelWidth</code>, <code>surfaceProfile</code> (<code>'convex' | 'concave' | 'lip'</code>).
          Optics: <code>blur</code>, <code>thickness</code>, <code>displacementFactor</code>, <code>displacementBlur</code>, <code>ior</code>, <code>dispersion</code>.
          Colour: <code>tint</code>, <code>saturation</code>, <code>whiteLevel</code>, <code>blackLevel</code>.
          Light: <code>lightDirection</code>, <code>specularStrength</code>, <code>specularWidth</code>, <code>specularOpacity</code>, <code>oppositeSpecularStrength</code>,
          <code>reflectionOffset</code>, <code>keyLightAmount</code>, <code>keyLightAngle</code>, <code>keyLightSpread</code>, <code>keyLightHeight</code>.
          Shadow: <code>shadowColor</code>, <code>shadowOffsetX</code>, <code>shadowOffsetY</code>, <code>shadowBlur</code>, <code>shadowSpread</code>.</p>
      </details>
      <details>
        <summary>Html props</summary>
        <p><code>source</code> (image, video, canvas or bitmap shown instead of the DOM), <code>fit</code> (<code>'cover' | 'contain' | 'fill'</code>),
          <code>fallback</code> (<code>'auto' | 'snapshot' | 'overlay'</code>), <code>opacity</code>, <code>blur</code>, <code>zIndex</code>, <code>sizing</code>.
          With <code>fallback="auto"</code>, backdrop Html is snapshotted and Html on glass is shown as live DOM above the canvas where the browser cannot draw HTML into a canvas.</p>
      </details>

      <h2>Plain JavaScript</h2>
      <pre>{`import { Renderer, Scene, Html, Container, Glass, resolveMaterial } from '@glassform/core'

const scene = new Scene()
scene.add(new Html({ width: 800, height: 600, zIndex: -1, source: videoElement }))
const container = new Container({ ...resolveMaterial({ variant: 'clear' }), x: 120, y: 120, spacing: 28 })
container.add(new Glass({ width: 280, height: 96, cornerRadius: 48 }))
scene.add(container)

const renderer = new Renderer({ scene })      // backend: 'auto' | 'webgpu' | 'webgl2'
document.body.append(renderer.canvas)
console.log(await renderer.ready)               // 'webgpu' or 'webgl2'
requestAnimationFrame(function frame() { renderer.render(); requestAnimationFrame(frame) })`}</pre>

      <h2>Three.js</h2>
      <pre>{`import { ThreeGlassRenderer } from '@glassform/three'

const glass = new ThreeGlassRenderer({ renderer, scene: glassScene }) // WebGLRenderer or WebGPURenderer
renderer.setRenderTarget(target); renderer.render(scene, camera); renderer.setRenderTarget(null)
glass.render({ backdrop: target })`}</pre>

      <h2>React Three Fiber</h2>
      <pre>{`<LiquidGlassR3F.Root>
  <Canvas>                      {/* default WebGLRenderer works; WebGPURenderer too */}
    <Scene3D />
    <LiquidGlassR3F.Render />
  </Canvas>
  <LiquidGlassR3F.Scene>
    <GlassContainer material={{ variant: 'regular' }}>…</GlassContainer>
  </LiquidGlassR3F.Scene>
</LiquidGlassR3F.Root>`}</pre>

      <h2>CSS tier</h2>
      <pre>{`<glass-surface variant="regular" corner-radius="capsule" interactive>Play</glass-surface>`}</pre>
      <p>Attributes: <code>variant</code>, <code>tint</code>, <code>appearance</code> (<code>light | dark | auto</code>), <code>corner-radius</code> (px or <code>capsule</code>),
        <code>corner-smoothing</code>, <code>refraction</code> (<code>auto | svg | none</code>), <code>interactive</code>.</p>

      <h2>Limits</h2>
      <ul>
        <li>Live DOM behind GPU glass needs HTML-in-Canvas (Chromium 159+). Elsewhere it is a snapshot that refreshes when the DOM changes, not every frame.</li>
        <li>CSS-tier refraction relies on <code>backdrop-filter: url()</code>, which only Chromium renders.</li>
        <li>Each <code>LiquidCanvas</code> is one GPU context; browsers cap how many can be alive at once (often 16).</li>
        <li>Fidelity is measured against macOS captures; iOS and future OS versions may differ.</li>
      </ul>
    </div>
  )
}
