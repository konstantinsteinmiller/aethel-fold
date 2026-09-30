/**
 * Star rating per page (roadmap #1): three origami stars.
 *
 *   ★    the page is cleared
 *   ★★   … with at most `STARS.twoStarHits` (1) heart lost
 *   ★★★  … as a Perfect Page (no heart lost) that gathered at least the
 *        page's score par
 *
 * A page finished after an "Almost!" Try-again continue (roadmap #9) is capped
 * at ★. The continue exists because every heart was lost, and it hands them
 * all back; letting it count as "at most one heart lost" would pay the rescue
 * more than a clean clear with two hearts lost. (The continue also costs half
 * the page's points, so ★★★ would be out of reach anyway.) A fresh page —
 * the auto-retry, a spent continue, a pause-menu restart — is a new attempt
 * and can earn all three.
 *
 * Pure: no three.js, no Vue. `parFor` runs once per page at module load.
 */

import { ENEMY, SCORE, STARS } from './config'
import type { BookId, PageDef, PageId, Stars } from './types'

/** Weak points the dragon's page must break (see `createBoss`). */
export const BOSS_WEAK_POINTS = 5

/**
 * The par rule. A Perfect Page always banks:
 *   Σ enemy base scores over every authored spawn (each kill pays at least its base)
 * + Σ tear scores (every tear must be torn to clear)
 * + SCORE.perfectPage
 * + on the dragon's page: SCORE.boss + 5 × SCORE.weakpoint
 * Par asks for a skill share on top of that — `STARS.parSkill` × the enemy
 * base (only multi-kills, stamp crushes and combos pay it), or the flat
 * `STARS.bossSkill` on the dragon's page, whose marchers come from stomps —
 * rounded down to `STARS.parStep`. The finale (a scripted fold that can't be
 * failed) is unrated; its par is simply the frog/crane fold's points.
 */
export const parFor = (def: Omit<PageDef, 'par'>): number => {
  if (def.exit === 'finale') return SCORE.frog
  let enemy = 0
  for (const w of def.waves) for (const s of w.spawns) enemy += ENEMY[s.type].score
  let tears = 0
  for (const t of def.tears) tears += t.score
  const boss = def.exit === 'boss' ? SCORE.boss + BOSS_WEAK_POINTS * SCORE.weakpoint : 0
  const skill = def.exit === 'boss' ? STARS.bossSkill : enemy * STARS.parSkill
  const raw = enemy + tears + SCORE.perfectPage + boss + skill
  return Math.floor(raw / STARS.parStep) * STARS.parStep
}

/** Give a page definition its par. */
export const withPar = (def: Omit<PageDef, 'par'>): PageDef => ({ ...def, par: parFor(def) })

/** Does this page award stars? (The finale is a victory lap, not a test.) */
export const isRated = (def: Pick<PageDef, 'exit'>): boolean => def.exit !== 'finale'

/**
 * Stars for a cleared page. `hits` = hearts lost on it, `pageScore` = points
 * gathered on it (perfect bonus included), `continued` = a Try-again
 * continue was used on this attempt.
 */
export const starsFor = (hits: number, pageScore: number, par: number, continued: boolean): Stars => {
  if (continued || !(hits <= STARS.twoStarHits)) return 1
  if (hits === 0 && Number.isFinite(par) && pageScore >= par) return 3
  return 2
}

/** Clamp anything read back from a save into 0…3 (NaN, strings, junk → 0). */
export const asStars = (v: unknown): Stars => {
  const n = typeof v === 'number' ? v : Number.NaN
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(3, Math.floor(n))) as Stars
}

/** The save key of one page's stars: `b1p3`. */
export const starKey = (book: BookId, page: PageId): string => `b${book}p${page}`

/**
 * Sanitise a stored `fold_stars` record: only `b<1|2>p<1…6>` keys with 1…3
 * stars survive (junk, zeros and unknown keys are dropped). Allocates: save
 * and UI paths only.
 */
export const readStarRecord = (v: unknown): Record<string, Stars> => {
  const out: Record<string, Stars> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!/^b[12]p[1-6]$/.test(k)) continue
    const s = asStars(raw)
    if (s > 0) out[k] = s
  }
  return out
}

/** Per-page maximum of two star records: a merge can only ever raise a page's stars. */
export const mergeStarRecords = (a: unknown, b: unknown): Record<string, Stars> => {
  const out = readStarRecord(a)
  const other = readStarRecord(b)
  for (const k of Object.keys(other)) if ((out[k] ?? 0) < other[k]!) out[k] = other[k]!
  return out
}

/** Total stars in a record. */
export const countStars = (v: unknown): number => {
  let n = 0
  for (const s of Object.values(readStarRecord(v))) n += s
  return n
}
