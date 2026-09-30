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
/** Private ports (E2E_PORT / E2E_CG_PORT) keep a run off a dev server another checkout may have on 2050/2051. */
const PORT = Number(process.env.E2E_PORT) || 2050
const CG_PORT = Number(process.env.E2E_CG_PORT) || 2051
/** E2E_PLAIN_ONLY=1: only the plain server (every spec but cloud-hydration), for memory-tight containers. */
const PLAIN_ONLY = !!process.env.E2E_PLAIN_ONLY
/** The ad build (roadmaps #9, #17, #19: CrazyGames full release with both ad flags, fake SDK) on E2E_ADS_PORT; E2E_ADS=1 adds it to a plain-only run. */
const ADS_PORT = Number(process.env.E2E_ADS_PORT) || 2052
const ADS = !PLAIN_ONLY || !!process.env.E2E_ADS

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: { args: GL_ARGS },
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 412, height: 860 } } }
  ],
  webServer: [
    {
      command: `pnpm vite --port ${PORT} --strictPort --host localhost`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: true,
      timeout: 60_000
    },
    ...(PLAIN_ONLY ? [] : [{
      command: `pnpm vite --port ${CG_PORT} --strictPort --host localhost`,
      url: `http://localhost:${CG_PORT}`,
      env: { VITE_APP_CRAZY_WEB: 'true' },
      reuseExistingServer: true,
      timeout: 60_000
    }]),
    ...(ADS ? [{
      command: `pnpm vite --port ${ADS_PORT} --strictPort --host localhost`,
      url: `http://localhost:${ADS_PORT}`,
      env: { VITE_APP_CRAZY_WEB: 'true', VITE_APP_CRAZY_GAMES_FULL_RELEASE: 'true', VITE_APP_INTERSTITIALS: 'true', VITE_APP_REWARDED: 'true' },
      reuseExistingServer: true,
      timeout: 60_000
    }] : [])
  ]
})
