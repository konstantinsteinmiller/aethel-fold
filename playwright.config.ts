import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests for Aethel Fold. Two dev servers:
 *   :2050 — the plain web build (LocalStorage strategy)
 *   :2051 — the CrazyGames build (cloud-only saves) against a fake SDK the
 *           tests inject, so remote hydration can be verified end to end.
 *
 * Rendering runs on SwiftShader in CI containers, which is slow (~5 fps):
 * tests drive the game through real pointer gestures but fast-forward the
 * simulation through the DEV-only `window.__fold` handle where waiting would
 * only burn time.
 */
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:2050',
    launchOptions: { args: GL_ARGS },
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 412, height: 860 } } }
  ],
  webServer: [
    {
      command: 'pnpm vite --port 2050 --strictPort --host localhost',
      url: 'http://localhost:2050',
      reuseExistingServer: true,
      timeout: 60_000
    },
    {
      command: 'pnpm vite --port 2051 --strictPort --host localhost',
      url: 'http://localhost:2051',
      env: { VITE_APP_CRAZY_WEB: 'true' },
      reuseExistingServer: true,
      timeout: 60_000
    }
  ]
})
