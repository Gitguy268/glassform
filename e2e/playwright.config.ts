import { defineConfig, devices } from '@playwright/test'

// Port 5199 on purpose: 4173 is taken by a cached service worker on the
// maintainer's machine. Packages must be built first (pnpm build).
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://127.0.0.1:5199', viewport: { width: 400, height: 280 }, deviceScaleFactor: 2 },
  webServer: {
    command: 'node serve.mjs',
    url: 'http://127.0.0.1:5199/e2e/probe.html',
    reuseExistingServer: !process.env.CI,
  },
  // The WebGPU project needs a real GPU; GitHub's runners only have a software
  // adapter that cannot render, so CI runs it only when GLASSFORM_GPU=1.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 400, height: 280 }, deviceScaleFactor: 2 } },
    ...(process.env.CI && !process.env.GLASSFORM_GPU ? [] : [{
      name: 'chromium-webgpu',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 400, height: 280 },
        deviceScaleFactor: 2,
        launchOptions: { args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--enable-features=Vulkan'] },
      },
    }]),
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 400, height: 280 },
        deviceScaleFactor: 2,
        // GPU-less Linux runners only get WebGL from Firefox's software path when forced.
        launchOptions: { firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.disabled': false } },
      },
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 400, height: 280 }, deviceScaleFactor: 2 } },
  ],
})
