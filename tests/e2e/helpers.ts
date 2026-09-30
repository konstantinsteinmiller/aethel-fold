import type { Page } from '@playwright/test'

export interface FoldState {
  book: number
  page: number
  phase: string
  score: number
  hp: number
  lesson: string | null
  timeScale: number
  folds: { id: string; kind: string; phase: string; t: number }[]
  enemies: number
  /** Enemies alive plus still to come (the Almost! count). */
  enemiesLeft: number
  difficulty: number
  boss: string
  sling: { x: number; z: number; cool: number; shots: number } | null
}

declare global {
  interface Window {
    __fold?: {
      state(): FoldState
      jumpTo(p: number, book?: number): void
      clearPage(): void
      fastForward(s: number): void
      screenOf(x: number, z: number, y?: number): { x: number; y: number }
      game: any
      engine: any
    }
  }
}

export const ALL_LESSONS = {
  swipe: true, stamp: true, shield: true, launch: true, ridge: true, spread: true, peel: true, crease: true, core: true, frog: true,
  crush: true, sling: true, leaper: true, ballista: true
}

/** Seed `aethel_state` before the app boots (plain web build). */
export const seedState = async (page: Page, state: Record<string, unknown>): Promise<void> => {
  await page.addInitScript((s) => {
    if (sessionStorage.getItem('__seeded')) return
    sessionStorage.setItem('__seeded', '1')
    localStorage.setItem('aethel_state', JSON.stringify(s))
  }, state)
}

export const waitForGame = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => !!window.__fold && window.__fold.state().phase !== 'boot', null, { timeout: 60_000 })
  // The loading screen stays up until the first frame is on screen (and at
  // least ~1.4 s); a player can't touch the game before it has cleared.
  await page.waitForFunction(() => !document.querySelector('.splash-backdrop, .splash-progress'), null, { timeout: 30_000 })
}

export const state = (page: Page): Promise<FoldState> => page.evaluate(() => window.__fold!.state())

export const ff = (page: Page, seconds: number): Promise<void> => page.evaluate((s) => window.__fold!.fastForward(s), seconds)

export const screenOf = (page: Page, x: number, z: number, y = 0) =>
  page.evaluate(([a, b, c]) => window.__fold!.screenOf(a!, b!, c), [x, z, y] as const)

/** A real pointer swipe between two page points, in steps. */
export const swipe = async (page: Page, from: [number, number], to: [number, number], steps = 10): Promise<void> => {
  const a = await screenOf(page, from[0], from[1])
  const b = await screenOf(page, to[0], to[1])
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps)
  }
  await page.mouse.up()
}

export const readSave = (page: Page): Promise<Record<string, any> | null> =>
  page.evaluate(() => {
    const raw = localStorage.getItem('aethel_state')
    return raw ? JSON.parse(raw) : null
  })

/** Collect console errors / page errors for a clean-console assertion. */
export const collectErrors = (page: Page): string[] => {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}
