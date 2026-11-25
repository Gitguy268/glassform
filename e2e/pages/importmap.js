// Import map so test pages can load the built packages without a bundler.
const map = {
  imports: {
    '@glassform/layout': '/packages/layout/dist/index.js',
    '@glassform/layout/animation': '/packages/layout/dist/animation.js',
    '@glassform/layout/dom': '/packages/layout/dist/dom.js',
    '@glassform/core': '/packages/core/dist/index.js',
    '@glassform/core/layout': '/packages/core/dist/layout.js',
  },
}
const script = document.createElement('script')
script.type = 'importmap'
script.textContent = JSON.stringify(map)
document.currentScript.after(script)
