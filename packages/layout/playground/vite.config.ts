import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
      },
    },
  },
  resolve: {
    alias: [
      {
        find: '@glassform/layout/dom',
        replacement: fileURLToPath(new URL('../src/dom.ts', import.meta.url)),
      },
      {
        find: '@glassform/layout',
        replacement: fileURLToPath(new URL('../src/index.ts', import.meta.url)),
      },
    ],
  },
})
