// Import map so test pages can load the built packages without a bundler.
const map = {
  imports: {
    '@glassform/layout': '/packages/layout/dist/index.js',
    '@glassform/layout/animation': '/packages/layout/dist/animation.js',
    '@glassform/layout/dom': '/packages/layout/dist/dom.js',
    '@glassform/core': '/packages/core/dist/index.js',
    '@glassform/core/layout': '/packages/core/dist/layout.js',
    '@glassform/css': '/packages/css/dist/index.js',
    '@glassform/css/element': '/packages/css/dist/element.js',
    '@glassform/three': '/packages/three/dist/index.js',
    three: '/node_modules/.pnpm/three@0.184.0/node_modules/three/build/three.module.js',
    'modern-screenshot': '/node_modules/.pnpm/modern-screenshot@4.7.0/node_modules/modern-screenshot/dist/index.mjs',
  },
}
const script = document.createElement('script')
script.type = 'importmap'
script.textContent = JSON.stringify(map)
document.currentScript.after(script)
