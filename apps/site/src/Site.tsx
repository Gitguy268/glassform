import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react'
import { GlassSurface } from '@glassform/react'
import Home from './pages/Home'

const pages: Array<{ id: string; label: string; Component: ComponentType }> = [
  { id: '', label: 'Home', Component: Home },
  { id: 'showcase', label: 'Showcase', Component: lazy(() => import('./pages/Showcase')) },
  { id: 'playground', label: 'Playground', Component: lazy(() => import('./pages/Playground')) },
  { id: 'web', label: 'Web pages', Component: lazy(() => import('./pages/WebPages')) },
  { id: '3d', label: '3D', Component: lazy(() => import('./pages/ThreeD')) },
  { id: 'fidelity', label: 'Fidelity', Component: lazy(() => import('./pages/Fidelity')) },
  { id: 'docs', label: 'Docs', Component: lazy(() => import('./pages/Docs')) },
]

function currentRoute() {
  return window.location.hash.replace(/^#\/?/, '').split('/')[0] ?? ''
}

export default function Site() {
  const [route, setRoute] = useState(currentRoute)
  useEffect(() => {
    const onHash = () => {
      setRoute(currentRoute())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const page = pages.find((p) => p.id === route) ?? pages[0]
  useEffect(() => {
    document.title = page.id ? `${page.label} · glassform` : 'glassform: liquid glass for the web'
  }, [page])

  return (
    <div className="site">
      <a className="skip" href="#main">Skip to content</a>
      <header className="nav-wrap">
        <GlassSurface as="nav" className="nav" cornerRadius="capsule" variant="regular" aria-label="Main">
          <a className="brand" href="#/">
            <span className="brand-mark" aria-hidden="true" />
            glassform
          </a>
          <ul>
            {pages.slice(1).map((p) => (
              <li key={p.id}>
                <a href={`#/${p.id}`} aria-current={p.id === page.id ? 'page' : undefined}>{p.label}</a>
              </li>
            ))}
          </ul>
          <a className="nav-gh" href="https://github.com/Gitguy268/glassform" aria-label="glassform on GitHub">GitHub</a>
        </GlassSurface>
      </header>
      <main id="main">
        <Suspense fallback={<div className="loading">Loading…</div>}>
          <page.Component />
        </Suspense>
      </main>
      <footer className="footer">
        <p>
          MIT licensed. Built on <a href="https://github.com/AndrewPrifer/liquid-dom">liquid-dom</a> by Andras Prifer,
          with ideas from <a href="https://github.com/iyinchao/liquid-glass-studio">liquid-glass-studio</a> by Charles Yin
          and <a href="https://github.com/shuding/liquid-glass">liquid-glass</a> by Shu Ding.
        </p>
        <p>Not affiliated with Apple. “Liquid Glass” is Apple’s name for its design material.</p>
      </footer>
    </div>
  )
}
