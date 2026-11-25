import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Frame,
  Glass,
  GlassContainer,
  GlassSurface,
  Html,
  LiquidCanvas,
  Transform,
  ZStack,
  useFrame,
  type LiquidCanvasRef,
  type TransformRef,
} from '@glassform/react'
import { detectHtmlInCanvas } from '@glassform/core'
import { supportsSvgBackdropFilter } from '@glassform/css'
import ribbonsUrl from '../assets/ribbons.webp'

/** Animated backdrop drawn into a canvas that the renderer refracts every frame. */
function useBackdropCanvas() {
  return useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1600
    canvas.height = 900
    const image = new Image()
    image.src = ribbonsUrl
    return { canvas, image }
  }, [])
}

function Floating({ phase, children }: { phase: number; children: React.ReactNode }) {
  const ref = useRef<TransformRef | null>(null)
  useFrame(({ time }) => {
    const t = time / 1000
    if (ref.current) {
      ref.current.x = Math.sin(t * 0.45 + phase) * 120 + Math.sin(t * 0.21 + phase * 2) * 40
      ref.current.y = Math.cos(t * 0.38 + phase) * 46 - 40
    }
  })
  return <Transform ref={ref}>{children}</Transform>
}

function Backdrop({ canvas, image }: { canvas: HTMLCanvasElement; image: HTMLImageElement }) {
  useFrame(({ time }) => {
    const g = canvas.getContext('2d')
    if (!g || !image.complete) return
    const t = time / 1000
    // Cover-crop a window of the image and pan it slowly sideways.
    const sw = Math.min(image.width, (image.height * canvas.width) / canvas.height) * 0.85
    const sh = (sw * canvas.height) / canvas.width
    const pan = (Math.sin(t * 0.08) * 0.5 + 0.5) * (image.width - sw)
    g.drawImage(image, pan, (image.height - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height)
    for (let i = 0; i < 5; i++) {
      const x = canvas.width * (0.5 + 0.42 * Math.sin(t * (0.17 + i * 0.05) + i * 1.7))
      const y = canvas.height * (0.5 + 0.38 * Math.cos(t * (0.13 + i * 0.04) + i))
      const r = 120 + i * 30
      const grad = g.createRadialGradient(x, y, 0, x, y, r)
      grad.addColorStop(0, ['#ffffff', '#4cc9f0', '#f72585', '#ffb703', '#80ffdb'][i] + 'cc')
      grad.addColorStop(1, '#ffffff00')
      g.fillStyle = grad
      g.fillRect(x - r, y - r, r * 2, r * 2)
    }
  }, -1)
  return null
}

export default function Home() {
  const { canvas, image } = useBackdropCanvas()
  const canvasRef = useRef<LiquidCanvasRef | null>(null)
  const [backend, setBackend] = useState<string>('…')
  useEffect(() => {
    let cancelled = false
    const tick = () => {
      const renderer = canvasRef.current?.renderer
      if (renderer) {
        renderer.ready.then((b) => !cancelled && setBackend(b)).catch(() => !cancelled && setBackend('none'))
      } else {
        setTimeout(tick, 100)
      }
    }
    tick()
    return () => { cancelled = true }
  }, [])
  const hic = detectHtmlInCanvas()

  return (
    <>
      <section className="hero" aria-label="Live demo">
        <LiquidCanvas ref={canvasRef} className="hero-canvas" frameloop="always">
          <ZStack alignment="center">
            <Html zIndex={-1} sizing="fill" source={canvas} fit="cover" />
            <Frame maxWidth={Infinity} maxHeight={Infinity}>
              <GlassContainer material={{ variant: 'regular' }} spacing={36} shadowColor={{ r: 0, g: 0, b: 0, a: 0.18 }} shadowBlur={24} shadowOffsetY={10}>
                <ZStack alignment="center">
                  <Floating phase={0}>
                    <Frame width={300} height={96}>
                      <Glass cornerRadius={48} />
                    </Frame>
                  </Floating>
                  <Floating phase={2.1}>
                    <Frame width={120} height={120}>
                      <Glass cornerRadius={60} />
                    </Frame>
                  </Floating>
                  <Floating phase={4.2}>
                    <Frame width={200} height={140}>
                      <Glass cornerRadius={36} cornerSmoothing={0.6} />
                    </Frame>
                  </Floating>
                </ZStack>
              </GlassContainer>
            </Frame>
          </ZStack>
          <Backdrop canvas={canvas} image={image} />
        </LiquidCanvas>
        <div className="hero-copy">
          <h1>Liquid glass, everywhere.</h1>
          <p>Refraction, specular light and soft edges, measured against native SwiftUI glass. WebGPU, WebGL2 and CSS, in every modern browser.</p>
          <div className="hero-actions">
            <GlassSurface as="a" href="#/playground" cornerRadius="capsule" interactive variant="clear" appearance="dark">Open the playground</GlassSurface>
            <GlassSurface as="a" href="#/docs" cornerRadius="capsule" interactive variant="clear" appearance="dark">Read the docs</GlassSurface>
          </div>
        </div>
      </section>

      <div className="page">
        <h2>This browser</h2>
        <div className="support">
          <span className={`pill ${backend === 'none' ? 'no' : 'ok'}`}>Renderer: {backend === 'webgpu' ? 'WebGPU' : backend === 'webgl2' ? 'WebGL2' : backend}</span>
          <span className={`pill ${hic.available ? 'ok' : 'no'}`}>Live HTML in canvas: {hic.available ? 'yes' : 'no (snapshot + overlay)'}</span>
          <span className={`pill ${supportsSvgBackdropFilter() ? 'ok' : 'no'}`}>CSS refraction: {supportsSvgBackdropFilter() ? 'yes' : 'blur only'}</span>
        </div>

        <h2>Three ways to render, one look</h2>
        <div className="grid">
          <div className="card"><h3>WebGPU</h3><p>The full renderer: refraction, chromatic dispersion, fused shapes, adaptive blur and shadows, from liquid-dom’s pipeline.</p></div>
          <div className="card"><h3>WebGL2</h3><p>The same passes ported to GLSL. Firefox, older Safari and GPU-less Chromium get the same image (SSIM 0.99999999 against WebGPU).</p></div>
          <div className="card"><h3>CSS</h3><p>For glass over an ordinary page: backdrop blur and colour from the same presets, rim light, and SVG refraction on Chromium.</p></div>
        </div>

        <h2>What it does</h2>
        <div className="grid">
          <div className="card"><h3>SwiftUI-style materials</h3><p><code>regular</code>, <code>clear</code> and <code>identity</code> glass, tints and light/dark, seeded from the parameters macOS itself uses.</p></div>
          <div className="card"><h3>GlassEffectContainer</h3><p>Shapes in one container melt into each other when they come close, with continuous corners.</p></div>
          <div className="card"><h3>Any backdrop</h3><p>Live DOM (Chromium), images, video, canvases, DOM snapshots, Three.js and React Three Fiber scenes.</p></div>
          <div className="card"><h3>Interactive</h3><p>Glass shapes are hit-tested and fire pointer events; content on the glass stays real, clickable DOM.</p></div>
          <div className="card"><h3>Layout engine</h3><p>SwiftUI-like stacks, frames and padding with springs, renderer-agnostic.</p></div>
          <div className="card"><h3>Measured</h3><p>A SwiftUI reference app renders the same scenes natively; every backend is scored with SSIM and ΔE.</p></div>
        </div>

        <h2>Install</h2>
        <p className="muted">The packages are not on npm yet. Install from GitHub:</p>
        <div className="install">
          <pre>{`git clone https://github.com/Gitguy268/glassform
cd glassform
pnpm install
pnpm build`}</pre>
          <pre>{`import { GlassSurface } from '@glassform/react'

<GlassSurface cornerRadius="capsule" interactive>
  Play
</GlassSurface>`}</pre>
        </div>
      </div>
    </>
  )
}
