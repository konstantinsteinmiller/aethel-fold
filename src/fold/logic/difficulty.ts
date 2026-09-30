/**
 * "The book is kind" — invisible adaptive difficulty (roadmap #8).
 *
 * A small memory of how the run is going (crumples per page, a streak of
 * perfect pages, a sticky boss ease) turns into three knobs on `FoldGame`:
 *
 *   difficulty   — multiplies enemy march speed and wave spawn pacing (sim time)
 *   extraPerWave — extra marchers appended to every wave
 *   fold slow-mo — a short lesson-style slow-down when a column walks onto a
 *                  fold (the fold itself keeps running in real time)
 *
 * Pure data and functions: no three.js, no Vue. The memory is persisted in
 * `aethel_state.fold_run` by `useFoldProgress`; the game only reads and
 * mutates the plain object it was handed.
 */

import { DIFFICULTY } from './config'
import type { BookId, PageId } from './types'

export interface KindMemory {
  /** Crumples (hero down) this run, keyed by `pageKey(book, page)`. */
  crumples: Record<string, number>
  /** Pages cleared perfectly (no heart lost, no crumple) in a row. */
  streak: number
  /** Sticky: the dragon's mass units march slower until a first-try boss win. */
  bossEase: boolean
}

export const createKindMemory = (): KindMemory => ({ crumples: {}, streak: 0, bossEase: false })

export const pageKey = (book: BookId, page: PageId | number): string => `b${book}p${page}`

export const crumplesOn = (mem: KindMemory, book: BookId, page: PageId | number): number =>
  mem.crumples[pageKey(book, page)] ?? 0

/** Crumples this run on pages 1…`page` of `book`. */
export const lossesUpTo = (mem: KindMemory, book: BookId, page: PageId | number): number => {
  let n = 0
  for (let p = 1; p <= page; p++) n += crumplesOn(mem, book, p)
  return n
}

/** Lost often enough before beating the boss page that the dragon eases off. */
export const shouldEaseBoss = (mem: KindMemory, book: BookId, bossPage: PageId | number): boolean =>
  mem.bossEase || lossesUpTo(mem, book, bossPage) >= DIFFICULTY.bossEaseLosses

/**
 * The pacing scalar for a page: 1 is the authored pace, below 1 is kinder.
 * Stacks the "crumpled here before" slow march with the boss ease.
 */
export const difficultyFor = (mem: KindMemory, book: BookId, page: PageId | number, bossPage: boolean): number => {
  let d = 1
  if (crumplesOn(mem, book, page) > 0) d *= DIFFICULTY.crumpleSlow
  if (bossPage && shouldEaseBoss(mem, book, page)) d *= DIFFICULTY.bossEase
  return Math.min(DIFFICULTY.max, Math.max(DIFFICULTY.min, d))
}

/** Extra marchers per wave for a player on a perfect streak. */
export const extraPerWave = (mem: KindMemory): number =>
  mem.streak >= DIFFICULTY.perfectStreak ? DIFFICULTY.extraPerWave : 0

/** Should a column walking onto a fold get the extra slow-mo on this page? */
export const foldSlowmoOn = (mem: KindMemory, book: BookId, page: PageId | number): boolean =>
  crumplesOn(mem, book, page) > 0

/** Record a crumple: it counts against the page and breaks the perfect streak. */
export const noteCrumple = (mem: KindMemory, book: BookId, page: PageId | number): void => {
  const k = pageKey(book, page)
  mem.crumples[k] = (mem.crumples[k] ?? 0) + 1
  mem.streak = 0
}

/**
 * Record a cleared page. A perfect first-try page extends the streak; anything
 * else resets it. A first-try boss win lifts the sticky boss ease.
 */
export const notePageWon = (
  mem: KindMemory, book: BookId, page: PageId | number, perfect: boolean, bossPage: boolean
): void => {
  const firstTry = crumplesOn(mem, book, page) === 0
  mem.streak = perfect && firstTry ? mem.streak + 1 : 0
  // Beaten after a struggle: stay kind next time too. Beaten first try: reset.
  if (bossPage) mem.bossEase = !firstTry && shouldEaseBoss(mem, book, page)
}

/** A new run forgets the crumples but keeps the streak and the sticky boss ease. */
export const resetRunMemory = (mem: KindMemory): void => {
  for (const k of Object.keys(mem.crumples)) delete mem.crumples[k]
}

/** Parse a persisted memory (hand-edited or torn saves fall back to defaults). */
export const readKindMemory = (v: unknown): KindMemory => {
  const out = createKindMemory()
  if (!v || typeof v !== 'object') return out
  const r = v as { crumples?: unknown; streak?: unknown; bossEase?: unknown }
  if (r.crumples && typeof r.crumples === 'object' && !Array.isArray(r.crumples)) {
    for (const [k, n] of Object.entries(r.crumples as Record<string, unknown>)) {
      const c = typeof n === 'number' ? Math.floor(n) : NaN
      if (/^b[12]p[1-6]$/.test(k) && Number.isFinite(c) && c > 0) out.crumples[k] = Math.min(c, 999)
    }
  }
  const s = typeof r.streak === 'number' ? Math.floor(r.streak) : 0
  out.streak = Number.isFinite(s) && s > 0 ? Math.min(s, 999) : 0
  out.bossEase = r.bossEase === true
  return out
}

/** Points a Try-again costs: a share of what was gathered on this page, on the score grid (5). */
export const retryPenalty = (gathered: number, share: number): number =>
  gathered <= 0 ? 0 : Math.round((gathered * Math.min(1, Math.max(0, share))) / 5) * 5
