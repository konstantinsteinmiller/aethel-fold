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
  /** The desk bookshelf (roadmap #2). */
  shelf: {
    available: boolean
    inView: boolean
    open: boolean
    selected: number
    highlight: number
    slots: string[]
    /** Camera blend toward the shelf pose, 0…1. */
    camera: number
    /** Dragon Rush figurines, one per book: 'open' once the book is won, else 'hidden'. */
    rush: string[]
  }
  /** 'story' or 'dragonRush' (roadmap #16). */
  mode: string
  rush: { time: number; par: number; done: boolean; attempts: number }
  /** Page secrets (roadmap #15): ids found, night mode, this page's secret. */
  secrets: { found: string[]; night: boolean; page: string | null }
  /** The first-launch intro (roadmap #12) is on screen. */
  intro: boolean
}

declare global {
  interface Window {
    __fold?: {
      state(): FoldState
      jumpTo(p: number, book?: number): void
      clearPage(): void
      fastForward(s: number): void
      screenOf(x: number, z: number, y?: number): { x: number; y: number }
      shelfScreen(slot: number): { x: number; y: number }
      toggleShelf(): boolean
      startRush(book: number): void
      lampScreen(): { x: number; y: number }
      secretScreen(): { x: number; y: number }
      /** The first-launch intro (roadmap #12). */
      intro(): { playing: boolean; t: number; duration: number }
      skipIntro(): boolean
      replayIntro(): void
      boot(): {
        boot_ms: number; first_input_ms: number; precompile_ms: number; precompile_parallel: boolean; stages: Record<number, number>
        /** The first-launch intro (roadmap #12): none / playing / skipped / watched, and when page 1 took over. */
        intro: string; intro_end_ms: number
        /** Standee atlas paint times (ms): at boot, the deferred frames, the season's bats, a hero repaint. */
        paint: { atlasBoot: number; atlasDeferred: number; atlasSeason: number; atlasHero: number }
      }
      /** Looks (roadmaps #6, #17). */
      setSeason(s: string | null): string
      equip(id: string): boolean
      look(): {
        want: { paper: string; hero: string; confetti: string; season: string }
        page: { paper: string; season: string } | null
        bats: boolean
        confetti: string
      }
      game: any
      engine: any
    }
  }
}

export const ALL_LESSONS = {
  swipe: true, stamp: true, shield: true, launch: true, ridge: true, spread: true, peel: true, crease: true, core: true, frog: true,
  crush: true, sling: true, leaper: true, ballista: true, shelf: true
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

/** Tap a book on the desk bookshelf where it is drawn now. */
export const tapShelf = async (page: Page, slot: number): Promise<void> => {
  const p = await page.evaluate((i) => window.__fold!.shelfScreen(i), slot)
  await page.mouse.click(p.x, p.y)
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

/**
 * Freeze the star ribbon (roadmap #1) in its settled hang: the band half-way
 * through its hang (between the drop and the lift) and every star folded in.
 * Measuring after a fixed wait was flaky on SwiftShader, whose frame rate
 * decides how far the CSS animation has got.
 */
export const settleRibbon = async (page: Page): Promise<void> => {
  await page.locator('.star-ribbon.is-on').waitFor({ state: 'attached' })
  await page.evaluate(() => {
    const root = document.querySelector('.star-ribbon.is-on')!
    for (const a of root.getAnimations({ subtree: true })) {
      const t = a.effect!.getComputedTiming()
      const delay = Number(t.delay ?? 0)
      const active = Number(t.activeDuration)
      const band = (a.effect as KeyframeEffect).target === root
      a.pause()
      a.currentTime = band ? delay + active * 0.5 : delay + active
    }
  })
  // Two frames for the paused styles to land.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}
