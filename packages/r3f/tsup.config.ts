import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.tsx',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  external: [
    '@react-three/fiber',
    '@glassform/core',
    '@glassform/react',
    '@glassform/three',
    'react',
    'three',
  ],
})
