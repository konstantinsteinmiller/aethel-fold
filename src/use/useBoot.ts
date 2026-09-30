import { ref } from 'vue'

/**
 * Boot progress, from the first byte of HTML to the game's first frame.
 *
 * `index.html` paints the static splash (logo + paper progress bar) before any
 * JS runs and keeps its bar creeping forward on its own (`window.__boot`).
 * Each boot stage then pushes the bar to its milestone; `FLogoProgress` takes
 * the same number over when Vue mounts and only lets the splash go when the
 * game reports its first rendered frame — so the loading screen covers the
 * real work (the renderer chunk, building page 1) instead of vanishing the
 * moment the tiny image preload finishes.
 */

export const BOOT = {
  /** main.ts started (JS parsed). */
  js: 25,
  /** The save strategy hydrated (the cloud save is in). */
  save: 45,
  /** Vue mounted the app shell. */
  app: 55,
  /** The game view's chunk (three.js + the game) loaded and mounted. */
  scene: 75,
  /** The engine built the first page. */
  engine: 90
} as const

interface StaticBoot {
  set(p: number): void
  value: number
  target: number
}

const staticBoot = (): StaticBoot | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { __boot?: StaticBoot }).__boot

/** Highest milestone reached (0…100). */
export const bootProgress = ref(staticBoot()?.target ?? 0)
/** The game rendered its first frame: the splash may go. */
export const gameReady = ref(false)

// ─── Boot telemetry (roadmap #13) ────────────────────────────────────────────
//
// `performance.now()` counts from the navigation start, so every number here is
// "ms since the player asked for the page". Kept in memory only: no storage
// key, no network (there is no generic analytics hook to feed). The DEV handle
// (`window.__fold.boot()`) and the DEV console report it; `tests/fold/bootTelemetry`
// and the gameplay e2e check it is filled in.

export interface BootTelemetry {
  /** Navigation start → the first frame rendered with input attached (−1 until then). */
  boot_ms: number
  /** Navigation start → the player's first press on the page (−1 until then). */
  first_input_ms: number
  /** Time spent precompiling the paper programs during the splash (−1 = not run). */
  precompile_ms: number
  /** Whether that precompile could wait on the GPU in parallel (`KHR_parallel_shader_compile`). */
  precompile_parallel: boolean
  /** When each boot milestone was reached (`BOOT` value → ms). */
  stages: Record<number, number>
}

export const bootTelemetry: BootTelemetry = {
  boot_ms: -1,
  first_input_ms: -1,
  precompile_ms: -1,
  precompile_parallel: false,
  stages: {}
}

const nowMs = (): number => (typeof performance === 'undefined' ? 0 : Math.round(performance.now()))

const report = (name: string, ms: number): void => {
  if (import.meta.env.DEV && import.meta.env.MODE !== 'test') console.info(`[boot] ${name}=${ms}`)
}

export const bootStage = (p: number): void => {
  if (p > bootProgress.value) bootProgress.value = p
  if (bootTelemetry.stages[p] === undefined) bootTelemetry.stages[p] = nowMs()
  staticBoot()?.set(p)
}

export const markGameReady = (): void => {
  bootStage(100)
  gameReady.value = true
}

/** The game rendered its first frame and takes input. Only the first call counts. */
export const markInteractive = (): void => {
  if (bootTelemetry.boot_ms >= 0) return
  bootTelemetry.boot_ms = nowMs()
  report('boot_ms', bootTelemetry.boot_ms)
}

/** The player's first press on the page. Only the first call counts. */
export const markFirstInput = (): void => {
  if (bootTelemetry.first_input_ms >= 0) return
  bootTelemetry.first_input_ms = nowMs()
  report('first_input_ms', bootTelemetry.first_input_ms)
}

/** The splash-time shader precompile finished (or gave up) after `ms`. */
export const markPrecompiled = (ms: number, parallel: boolean): void => {
  bootTelemetry.precompile_ms = Math.round(ms)
  bootTelemetry.precompile_parallel = parallel
  report('precompile_ms', bootTelemetry.precompile_ms)
}

/** A copy for the DEV handle and tests. */
export const bootSnapshot = (): BootTelemetry => ({ ...bootTelemetry, stages: { ...bootTelemetry.stages } })

/** What the static splash's bar currently shows, so the Vue bar continues from there. */
export const staticBootValue = (): number => staticBoot()?.value ?? 0
