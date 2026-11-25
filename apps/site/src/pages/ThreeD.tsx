import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Container, Glass, Scene, resolveMaterial } from '@glassform/core'
import { ThreeGlassRenderer } from '@glassform/three'
import R3FIntegrationDemo from '../demos/R3FIntegrationDemo'
import styles from './Showcase.module.css'

function VanillaThree() {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [backend, setBackend] = useState('')
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    host.append(renderer.domElement)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#0b1020')
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.z = 6
    const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(1.1, 0.34, 220, 32), new THREE.MeshStandardMaterial({ color: '#ff8c42', roughness: 0.25, metalness: 0.2 }))
    scene.add(knot, new THREE.HemisphereLight('#ffffff', '#223', 2.6))
    const bars: THREE.Mesh[] = []
    for (let i = 0; i < 9; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 9, 0.1), new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(i / 9, 0.85, 0.6) }))
      bar.position.set(-6 + i * 1.5, 0, -3)
      scene.add(bar)
      bars.push(bar)
    }
    const glassScene = new Scene()
    const container = new Container({ ...resolveMaterial({ variant: 'regular' }), spacing: 30 })
    const pill = new Glass({ width: 320, height: 92, cornerRadius: 46 })
    const dot = new Glass({ width: 110, height: 110, cornerRadius: 55 })
    container.add(pill)
    container.add(dot)
    glassScene.add(container)
    const glass = new ThreeGlassRenderer({ renderer, scene: glassScene })
    const target = new THREE.WebGLRenderTarget(1, 1)
    target.texture.colorSpace = THREE.SRGBColorSpace
    let frame = 0
    const resize = () => {
      const { width, height } = host.getBoundingClientRect()
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      const size = renderer.getDrawingBufferSize(new THREE.Vector2())
      target.setSize(size.x, size.y)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    const loop = (time: number) => {
      const { width, height } = host.getBoundingClientRect()
      knot.rotation.set(time / 1600, time / 1200, 0)
      pill.x = width / 2 - 160 + Math.sin(time / 1500) * 140
      pill.y = height / 2 - 46
      dot.x = width / 2 - 55 + Math.cos(time / 1100) * 220
      dot.y = height / 2 - 55 + Math.sin(time / 900) * 60
      renderer.setRenderTarget(target)
      renderer.render(scene, camera)
      renderer.setRenderTarget(null)
      glass.render({ backdrop: target })
      setBackend((b) => b || glass.backend)
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      glass.destroy()
      target.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])
  return (
    <>
      <div ref={hostRef} className="three-stage" />
      <p className="status">Three.js WebGLRenderer · glass on {backend === 'webgl2' ? 'WebGL2' : backend || '…'}</p>
    </>
  )
}

export default function ThreeD() {
  return (
    <div className="page">
      <h1>3D scenes</h1>
      <p className="lede">
        <code>@glassform/three</code> composites glass over a Three.js scene on the renderer’s own GPU context: WebGPU with <code>WebGPURenderer</code>,
        WebGL2 with <code>WebGLRenderer</code> or WebGPURenderer’s WebGL fallback. <code>@glassform/r3f</code> does the same for React Three Fiber.
      </p>
      <h2>Three.js (WebGLRenderer)</h2>
      <VanillaThree />
      <pre>{`const glass = new ThreeGlassRenderer({ renderer, scene: glassScene })
renderer.setRenderTarget(target)
renderer.render(scene, camera)
renderer.setRenderTarget(null)
glass.render({ backdrop: target })`}</pre>
      <h2>React Three Fiber</h2>
      <section className={styles.showcaseFrame}>
        <R3FIntegrationDemo />
      </section>
    </div>
  )
}
