import { useEffect, useState } from 'react'

type Score = { ssim: number; meanDeltaE: number; under2: number }
type Report = {
  date: string
  macOS?: string
  engines: Record<string, { backend: string; mean?: Score }>
  scenes: Array<{ id: string; scores: Record<string, Score> }>
}

const ENGINE_LABELS: Record<string, string> = {
  'chromium-webgpu': 'Chromium · WebGPU',
  'chromium-webgl2': 'Chromium · WebGL2',
  firefox: 'Firefox · WebGL2',
  webkit: 'Safari (WebKit)',
}

export default function Fidelity() {
  const [report, setReport] = useState<Report | null | 'missing'>(null)
  useEffect(() => {
    fetch('./fidelity/report.json')
      .then((r) => (r.ok ? r.json() : 'missing'))
      .then(setReport)
      .catch(() => setReport('missing'))
  }, [])

  return (
    <div className="page">
      <h1>How close is it to native?</h1>
      <p className="lede">
        “Identical to Apple’s glass” is a claim you can only make with a measurement, so glassform measures. A small SwiftUI app renders fixed scenes with
        <code>.glassEffect()</code> on macOS and captures them. The web renders the same scenes, and every backend is scored inside the glass area
        (plus a 24 px halo) with SSIM and CIEDE2000 colour difference.
      </p>

      {report === null && <p className="muted">Loading the latest report…</p>}
      {report === 'missing' && (
        <div className="card">
          <h3>No native captures published yet</h3>
          <p>The reference app needs macOS Screen Recording permission to capture native glass. Until captures exist, materials use starting values read from the
            macOS <code>glassBackground</code> filter (below) and are not tuned.</p>
        </div>
      )}
      {report && report !== 'missing' && (
        <>
          <p className="muted">Report from {report.date}{report.macOS ? `, native captures on macOS ${report.macOS}` : ''}.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Engine</th><th>Backend</th><th>Mean SSIM</th><th>Mean ΔE2000</th><th>Pixels under ΔE 2</th></tr></thead>
              <tbody>
                {Object.entries(report.engines).map(([engine, r]) => (
                  <tr key={engine}>
                    <td>{ENGINE_LABELS[engine] ?? engine}</td>
                    <td>{r.backend}</td>
                    <td>{r.mean ? r.mean.ssim.toFixed(4) : '–'}</td>
                    <td>{r.mean ? r.mean.meanDeltaE.toFixed(2) : '–'}</td>
                    <td>{r.mean ? `${(r.mean.under2 * 100).toFixed(1)} %` : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>Scenes</h2>
          <div className="fid-grid">
            {report.scenes.map((scene) => (
              <figure key={scene.id}>
                <img src={`./fidelity/native/${scene.id}.webp`} alt={`Native SwiftUI glass: ${scene.id}`} loading="lazy" />
                <img src={`./fidelity/web/${scene.id}.webp`} alt={`glassform: ${scene.id}`} loading="lazy" />
                <figcaption>{scene.id}<br />{Object.entries(scene.scores).map(([e, s]) => `${ENGINE_LABELS[e] ?? e}: ${s.ssim.toFixed(3)}`).join(' · ')}</figcaption>
              </figure>
            ))}
          </div>
        </>
      )}

      <h2>Native filter values</h2>
      <p>Read at runtime from macOS 27.2.1 (<code>NSGlassEffectView</code>, regular glass) with liquid-dom’s probe tool. These seed the presets:</p>
      <div className="table-wrap">
        <table>
          <tbody>
            <tr><td>Inner refraction amount / height</td><td>−60 / 20</td></tr>
            <tr><td>Blur radius</td><td>5</td></tr>
            <tr><td>Face colour matrix: white / black / saturation</td><td>1.125 / 0.08 / 1.3</td></tr>
            <tr><td>Key-fill highlight: angle / spread / amount / height</td><td>π/2 / 2π/3 / 0.5 / 0.5</td></tr>
            <tr><td>Chromatic aberration</td><td>not set (none)</td></tr>
          </tbody>
        </table>
      </div>
      <details>
        <summary>Method and limits</summary>
        <p>Scores cover 41 scenes: capsule, button, card and circle shapes; regular and clear; light and dark; seven backgrounds; three tints; one merge.
          Native glass adapts to content and to the window’s focus, and Apple can change it between OS releases, so the report states the macOS version.
          Only renderer-owned backdrops (images, canvases, 3D) are scored: the CSS tier works differently and is reviewed by eye.</p>
      </details>
    </div>
  )
}
