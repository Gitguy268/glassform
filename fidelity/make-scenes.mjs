// Writes fidelity/scenes.json: the fixed scenes rendered natively (SwiftUI)
// and on the web, so the two can be compared pixel for pixel.
// Units are points (CSS px); captures are taken at 2x.
import { writeFileSync } from 'node:fs'

const W = 360
const H = 240

const shapes = {
  capsule: { x: 70, y: 86, w: 220, h: 68, shape: 'capsule' },
  button: { x: 132, y: 98, w: 96, h: 44, shape: 'capsule' },
  card: { x: 40, y: 40, w: 280, h: 160, shape: 'rect', radius: 28 },
  circle: { x: 148, y: 88, w: 64, h: 64, shape: 'circle' },
}

const scenes = []
const add = (id, scene) => scenes.push({ id, size: [W, H], appearance: 'light', spacing: null, ...scene })

for (const appearance of ['light', 'dark']) {
  for (const variant of ['regular', 'clear']) {
    for (const [shapeName, shape] of Object.entries(shapes)) {
      for (const background of ['stripes', 'photo']) {
        add(`${shapeName}-${variant}-${appearance}-${background}`, {
          appearance,
          background,
          shapes: [{ ...shape, variant }],
        })
      }
    }
  }
}

for (const background of ['white', 'black', 'text', 'checker', 'gradient']) {
  add(`capsule-regular-light-${background}`, {
    background,
    shapes: [{ ...shapes.capsule, variant: 'regular' }],
  })
}

for (const [name, tint] of [
  ['blue', '#0a84ff'],
  ['red', '#ff3b30'],
  ['green-soft', '#34c75980'],
]) {
  add(`capsule-tint-${name}-light-photo`, {
    background: 'photo',
    shapes: [{ ...shapes.capsule, variant: 'regular', tint }],
  })
}

// Two shapes inside a GlassEffectContainer close enough to merge.
add('merge-two-circles-light-stripes', {
  background: 'stripes',
  spacing: 24,
  shapes: [
    { x: 110, y: 88, w: 64, h: 64, shape: 'circle', variant: 'regular' },
    { x: 186, y: 88, w: 64, h: 64, shape: 'circle', variant: 'regular' },
  ],
})

writeFileSync(new URL('./scenes.json', import.meta.url), JSON.stringify({ version: 1, scale: 2, scenes }, null, 2) + '\n')
console.log(`${scenes.length} scenes`)
