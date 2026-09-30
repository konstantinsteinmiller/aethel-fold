/**
 * Dragon Rush (roadmap #16): after a book is won, its dragon can be fought
 * again on its own, faster, against the clock.
 *
 * The rematch reuses the whole boss state machine in `game.ts`; the only new
 * rules are here and in `RUSH` (config.ts): the timing multiplier the boss
 * reads (`Boss.timing`, via `bossTiming`), a timer, a par per book and the
 * best time kept in the save (`aethel_state.fold_rush`).
 *
 * A rush never touches the story: no stars, no checkpoint, no kindness memory
 * (the kind book's crumple count and boss ease), no page-clear score banking.
 *
 * Pure: no three.js, no Vue.
 */

import { RUSH } from './config'
import { BOOKS, PAGE_COUNT } from './pages'
import type { BookId, PageId } from './types'

export interface RushState {
  /** A rush is the current run. */
  active: boolean
  book: BookId
  /** Real seconds on the clock (page drop → the last weak point breaks). */
  time: number
  /** The clock is running. */
  running: boolean
  /** The dragon is beaten: `time` is final. */
  done: boolean
  /** This book's par, seconds. */
  par: number
  /** Fresh dragons dropped (1 = the first attempt). */
  attempts: number
}

export const createRushState = (): RushState => ({
  active: false, book: 1, time: 0, running: false, done: false, par: 0, attempts: 0
})

/** Par time of a book's rush, seconds. */
export const rushPar = (book: BookId): number => RUSH.par[book - 1] ?? RUSH.par[RUSH.par.length - 1]!

/** The page a book's dragon lives on (its `exit: 'boss'` page). */
export const bossPageOf = (book: BookId): PageId => {
  const pages = BOOKS[book]
  for (let p = 1; p <= PAGE_COUNT; p++) if (pages[p as PageId].exit === 'boss') return p as PageId
  throw new Error(`book ${book} has no dragon`)
}

/** The rush slot on the shelf appears once its book has been won. */
export const rushUnlocked = (book: number, wins: readonly number[]): boolean => (wins[book - 1] ?? 0) > 0

/** Best times, keyed `b<book>` → seconds (only finished rushes are stored). */
export type RushRecord = Record<string, number>

export const rushKey = (book: number): string => `b${book}`

/** Sanitise a stored `fold_rush` record: `b<book>` keys of playable books, finite positive seconds. */
export const readRushRecord = (v: unknown): RushRecord => {
  const out: RushRecord = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [k, t] of Object.entries(v as Record<string, unknown>)) {
    const m = /^b(\d+)$/.exec(k)
    if (!m || !Object.prototype.hasOwnProperty.call(BOOKS, Number(m[1]))) continue
    if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) continue
    out[k] = t
  }
  return out
}

/** Keep the faster time per book (a save merge must never lose a best). */
export const mergeRushRecords = (a: RushRecord, b: RushRecord): RushRecord => {
  const out: RushRecord = { ...a }
  for (const [k, t] of Object.entries(b)) if (!(out[k]! > 0) || t < out[k]!) out[k] = t
  return out
}

/** Round a rush time the way it is shown and stored (tenths of a second, never rounding up past a par). */
export const rushRound = (t: number): number => Math.floor(Math.max(0, t) * 10) / 10

export interface RushResult {
  time: number
  par: number
  /** The previous best (0 = none). */
  best: number
  /** At or under par. */
  underPar: boolean
  /** Faster than the previous best (or the first finish). */
  newBest: boolean
}

/** A finished rush against the par and the previous best. */
export const rushResult = (time: number, par: number, best: number): RushResult => {
  const t = rushRound(time)
  return { time: t, par, best, underPar: t <= par, newBest: !(best > 0) || t < best }
}

/** `m:ss.t` — the rush clock and the result card. */
export const formatRushTime = (t: number): string => {
  const tenths = Math.floor(Math.max(0, t) * 10)
  const m = Math.floor(tenths / 600)
  const s = Math.floor((tenths % 600) / 10)
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`
}
