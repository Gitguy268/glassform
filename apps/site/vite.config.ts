import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

// The site imports the built packages (pnpm build first). base './' keeps it
// working under any path (GitHub Pages /glassform/, Vercel /).
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    exclude: ['@glassform/core', '@glassform/react', '@glassform/r3f', '@glassform/three', '@glassform/css'],
  },
  build: {
    chunkSizeWarningLimit: 1600,
  },
  server: { port: 5199, host: '127.0.0.1' },
  preview: { port: 5199, host: '127.0.0.1' },
})
