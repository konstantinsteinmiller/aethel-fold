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

export const bootStage = (p: number): void => {
  if (p > bootProgress.value) bootProgress.value = p
  staticBoot()?.set(p)
}

export const markGameReady = (): void => {
  bootStage(100)
  gameReady.value = true
}

/** What the static splash's bar currently shows, so the Vue bar continues from there. */
export const staticBootValue = (): number => staticBoot()?.value ?? 0
