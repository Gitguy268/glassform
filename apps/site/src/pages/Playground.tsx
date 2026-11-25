import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Frame,
  Glass,
  GlassContainer,
  Html,
  LiquidCanvas,
  Transform,
  ZStack,
  type GlassProps,
  type LiquidCanvasRef,
} from '@glassform/react'
import { parseColor, resolveMaterial, type GlassAppearance, type GlassVariant, type MaterialParameters } from '@glassform/core'
import ribbonsUrl from '../assets/ribbons.webp'
import meadowUrl from '../assets/meadow.webp'
import stripesUrl from '../assets/stripes.png'
import textUrl from '../assets/text.png'
import photoUrl from '../assets/photo.png'

const BACKDROPS = {
  ribbons: { label: 'Ribbons', url: ribbonsUrl },
  meadow: { label: 'Meadow', url: meadowUrl },
  photo: { label: 'Night', url: photoUrl },
  stripes: { label: 'Stripes', url: stripesUrl },
  text: { label: 'Text image', url: textUrl },
  html: { label: 'Live HTML', url: '' },
} as const
type BackdropId = keyof typeof BACKDROPS

type Tunable = Pick<MaterialParameters,
  'blur' | 'bezelWidth' | 'thickness' | 'displacementFactor' | 'dispersion' | 'saturation' |
  'whiteLevel' | 'blackLevel' | 'specularOpacity' | 'keyLightAmount' | 'reflectionOffset'>

const SLIDERS: Array<[keyof Tunable, string, number, number, number]> = [
  ['blur', 'Blur', 0, 30, 0.5],
  ['bezelWidth', 'Bezel width', 2, 80, 1],
  ['thickness', 'Thickness', 0, 120, 1],
  ['displacementFactor', 'Refraction', 0, 3, 0.05],
  ['dispersion', 'Dispersion', 0, 0.3, 0.005],
  ['saturation', 'Saturation', 0, 2.5, 0.05],
  ['whiteLevel', 'White level', 0.5, 1.6, 0.01],
  ['blackLevel', 'Black level', 0, 0.4, 0.01],
  ['specularOpacity', 'Rim light', 0, 1, 0.01],
  ['keyLightAmount', 'Key light', 0, 1, 0.01],
  ['reflectionOffset', 'Reflection offset', 0, 40, 1],
]

type ShapeState = { id: string; x: number; y: number; w: number; h: number; r: number }

function useDraggable(initial: ShapeState[]) {
  const [shapes, setShapes] = useState(initial)
  const drag = useRef<{ id: string; startX: number; startY: number; x: number; y: number } | null>(null)
  const handlers = (shape: ShapeState): Pick<GlassProps, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'> => ({
    onPointerDown: (event) => {
      drag.current = { id: shape.id, startX: event.canvasX, startY: event.canvasY, x: shape.x, y: shape.y }
    },
    onPointerMove: (event) => {
      const d = drag.current
      if (!d || d.id !== shape.id) return
      setShapes((all) => all.map((s) => (s.id === shape.id ? { ...s, x: d.x + event.canvasX - d.startX, y: d.y + event.canvasY - d.startY } : s)))
    },
    onPointerUp: () => { drag.current = null },
    onPointerCancel: () => { drag.current = null },
  })
  return { shapes, handlers }
}

export default function Playground() {
  const [backend, setBackend] = useState<'auto' | 'webgpu' | 'webgl2'>('auto')
  const [variant, setVariant] = useState<GlassVariant>('regular')
  const [appearance, setAppearance] = useState<GlassAppearance>('light')
  const [tint, setTint] = useState('#0a84ff')
  const [tintOn, setTintOn] = useState(false)
  const [spacing, setSpacing] = useState(30)
  const [backdrop, setBackdrop] = useState<BackdropId>('ribbons')
  const base = useMemo(
    () => resolveMaterial({ variant, appearance, tint: tintOn ? tint : null }),
    [variant, appearance, tint, tintOn],
  )
  const [overrides, setOverrides] = useState<Partial<Tunable>>({})
  const params = { ...base, ...overrides }
  const canvasRef = useRef<LiquidCanvasRef | null>(null)
  const [status, setStatus] = useState('starting…')
  const { shapes, handlers } = useDraggable([
    { id: 'pill', x: -150, y: -90, w: 260, h: 84, r: 42 },
    { id: 'circle', x: 150, y: -60, w: 120, h: 120, r: 60 },
    { id: 'card', x: 0, y: 110, w: 320, h: 160, r: 36 },
  ])
  const image = useMemo(() => {
    const url = BACKDROPS[backdrop].url
    if (!url) return null
    const img = new Image()
    img.src = url
    return img
  }, [backdrop])

  useEffect(() => {
    const id = window.setInterval(() => {
      const renderer = canvasRef.current?.renderer
      setStatus(renderer?.backend ? `Rendering with ${renderer.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'}` : 'starting…')
    }, 500)
    return () => window.clearInterval(id)
  }, [])

  const tintColor = parseColor(tint)

  return (
    <div className="page">
      <h1>Playground</h1>
      <p className="lede">Drag the glass. Change the material, the backdrop and the backend. Shapes in one container melt together when they come within the spacing distance.</p>
      <div className="play">
        <div className="stage">
          <LiquidCanvas key={backend} ref={canvasRef} backend={backend} className="stage-canvas" canvasStyle={{ width: '100%', height: '100%' }} style={{ position: 'absolute', inset: 0 }}>
            <ZStack alignment="center">
              {image ? (
                <Html zIndex={-1} sizing="fill" source={image} fit="cover" />
              ) : (
                <Html zIndex={-1} sizing="fill">
                  <article style={{ width: '100%', height: '100%', padding: 28, background: 'linear-gradient(140deg,#fff7e6,#ffe0ef 45%,#d9ecff)', color: '#1b1d22', font: '17px/1.6 system-ui, sans-serif', boxSizing: 'border-box' }}>
                    <h2 style={{ fontSize: 34, margin: '0 0 8px' }}>Live HTML backdrop</h2>
                    <p>On Chromium this text is drawn live into the canvas through HTML-in-Canvas. Elsewhere it is snapshotted and refreshed when it changes.</p>
                    <div style={{ display: 'flex', gap: 10, margin: '18px 0' }}>
                      {['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93'].map((c) => <span key={c} style={{ width: 56, height: 56, borderRadius: 14, background: c, display: 'inline-block' }} />)}
                    </div>
                    <p>The quick brown fox jumps over the lazy dog. 0123456789. Glass bends the light behind it toward the rim.</p>
                  </article>
                </Html>
              )}
              <Frame maxWidth={Infinity} maxHeight={Infinity}>
                <GlassContainer {...params} spacing={spacing}>
                  <ZStack alignment="center">
                    {shapes.map((shape) => (
                      <Transform key={shape.id} x={shape.x} y={shape.y}>
                        <Frame width={shape.w} height={shape.h}>
                          <Glass cornerRadius={shape.r} cornerSmoothing={shape.id === 'card' ? 0.6 : 0} pointerEvents {...handlers(shape)} />
                        </Frame>
                      </Transform>
                    ))}
                  </ZStack>
                </GlassContainer>
              </Frame>
            </ZStack>
          </LiquidCanvas>
        </div>
        <aside className="controls" aria-label="Glass controls">
          <h3>Material</h3>
          <div className="row">
            {(['regular', 'clear', 'identity'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={variant === v} onClick={() => { setVariant(v); setOverrides({}) }}>{v}</button>
            ))}
          </div>
          <div className="row">
            {(['light', 'dark'] as const).map((a) => (
              <button key={a} type="button" aria-pressed={appearance === a} onClick={() => { setAppearance(a); setOverrides({}) }}>{a}</button>
            ))}
          </div>
          <label>
            <span><input type="checkbox" checked={tintOn} onChange={(e) => setTintOn(e.target.checked)} /> Tint</span>
            <input type="color" value={tint} onChange={(e) => setTint(e.target.value)} aria-label="Tint colour" />
          </label>
          <label>Spacing (merge) <output>{spacing}</output>
            <input type="range" min={0} max={80} step={1} value={spacing} onChange={(e) => setSpacing(Number(e.target.value))} />
          </label>
          {SLIDERS.map(([key, label, min, max, step]) => (
            <label key={key}>{label} <output>{Number(params[key]).toFixed(step < 0.1 ? 2 : 1)}</output>
              <input type="range" min={min} max={max} step={step} value={Number(params[key])}
                onChange={(e) => setOverrides((o) => ({ ...o, [key]: Number(e.target.value) }))} />
            </label>
          ))}
          <div className="row"><button type="button" onClick={() => setOverrides({})}>Reset to preset</button></div>
          <h3>Backdrop</h3>
          <div className="row">
            {(Object.keys(BACKDROPS) as BackdropId[]).map((id) => (
              <button key={id} type="button" aria-pressed={backdrop === id} onClick={() => setBackdrop(id)}>{BACKDROPS[id].label}</button>
            ))}
          </div>
          <h3>Backend</h3>
          <div className="row">
            {(['auto', 'webgpu', 'webgl2'] as const).map((b) => (
              <button key={b} type="button" aria-pressed={backend === b} onClick={() => setBackend(b)}>{b}</button>
            ))}
          </div>
          <p className="status" role="status">{status}{tintOn ? ` · tint rgb(${Math.round(tintColor.r * 255)}, ${Math.round(tintColor.g * 255)}, ${Math.round(tintColor.b * 255)})` : ''}</p>
        </aside>
      </div>
    </div>
  )
}
