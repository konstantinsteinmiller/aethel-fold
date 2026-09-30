/**
 * Paper cosmetics earned by play (roadmap #6): page papers, hero variants and
 * confetti shapes, unlocked by the total of origami stars (roadmap #1) over
 * every book. Nothing here changes a rule of the game: a cosmetic is only a
 * look the view paints.
 *
 * Saved as `aethel_state.fold_cosmetics = { owned: [...ids], equipped: {
 * paper, hero, confetti } }`. The defaults (plain paper, the classic hero,
 * square confetti) are always owned and never stored. `owned` only grows: a
 * cloud merge keeps the union of both sides, and the winning side's equipped
 * items where they are owned (see `mergeCosmetics`).
 *
 * The thresholds spread over the 30 stars of books 1 and 2 (10 rated pages ×
 * 3): the first unlock comes on the first well-played page, the last asks for
 * every page at ★★★. Book 3 raises the star total; its cosmetics append to
 * `COSMETICS` (ids are stable, order is display order).
 *
 * Pure: no three.js, no Vue. Allocates: save, events and UI paths only.
 */

import type { Season } from './seasons'

export type CosmeticKind = 'paper' | 'hero' | 'confetti'
export type PaperPattern = 'plain' | 'graph' | 'washi' | 'newsprint' | 'map'
export type HeroVariant = 'classic' | 'scarf' | 'sash' | 'crown'
export type ConfettiShape = 'squares' | 'stars' | 'hearts' | 'cranes'

export const PAPER_PATTERNS: readonly PaperPattern[] = ['plain', 'graph', 'washi', 'newsprint', 'map']
export const HERO_VARIANTS: readonly HeroVariant[] = ['classic', 'scarf', 'sash', 'crown']
export const CONFETTI_SHAPES: readonly ConfettiShape[] = ['squares', 'stars', 'hearts', 'cranes']

/** `<kind>.<value>`, e.g. `paper.washi`. */
export type CosmeticId = `paper.${PaperPattern}` | `hero.${HeroVariant}` | `confetti.${ConfettiShape}`

export interface CosmeticDef {
  id: CosmeticId
  kind: CosmeticKind
  value: string
  /** Total stars (over every book) that unlock it; 0 = a default. */
  stars: number
}

const item = (kind: CosmeticKind, value: string, stars: number): CosmeticDef =>
  ({ id: `${kind}.${value}` as CosmeticId, kind, value, stars })

/** Every cosmetic, defaults first, then in unlock order within its kind. */
export const COSMETICS: readonly CosmeticDef[] = [
  item('paper', 'plain', 0),
  item('paper', 'graph', 3),
  item('paper', 'washi', 11),
  item('paper', 'newsprint', 20),
  item('paper', 'map', 26),
  item('hero', 'classic', 0),
  item('hero', 'scarf', 8),
  item('hero', 'sash', 17),
  item('hero', 'crown', 30),
  item('confetti', 'squares', 0),
  item('confetti', 'stars', 5),
  item('confetti', 'hearts', 14),
  item('confetti', 'cranes', 23)
]

export const COSMETIC_IDS: readonly CosmeticId[] = COSMETICS.map((c) => c.id)

export const isCosmeticId = (v: unknown): v is CosmeticId =>
  typeof v === 'string' && (COSMETIC_IDS as readonly string[]).includes(v)

export const cosmeticById = (id: string): CosmeticDef | undefined => COSMETICS.find((c) => c.id === id)

/** The cosmetics of one kind, in display order. */
export const cosmeticsOf = (kind: CosmeticKind): CosmeticDef[] => COSMETICS.filter((c) => c.kind === kind)

export interface Equipped {
  paper: PaperPattern
  hero: HeroVariant
  confetti: ConfettiShape
}

export interface CosmeticsRecord {
  /** Unlocked ids beyond the defaults, in `COSMETICS` order. */
  owned: CosmeticId[]
  equipped: Equipped
}

/** What the view paints: the equipped cosmetics plus the season's skin (roadmaps #6, #17). */
export interface Look extends Equipped {
  season: Season
}

export const DEFAULT_LOOK: Readonly<Look> = { paper: 'plain', hero: 'classic', confetti: 'squares', season: 'none' }

export const DEFAULT_EQUIPPED: Readonly<Equipped> = { paper: 'plain', hero: 'classic', confetti: 'squares' }

const isDefault = (c: CosmeticDef): boolean => c.stars === 0

/** Is an id owned in a record (the defaults always are)? */
export const owns = (r: Pick<CosmeticsRecord, 'owned'>, id: string): boolean => {
  const c = cosmeticById(id)
  if (!c) return false
  return isDefault(c) || r.owned.includes(c.id)
}

/** Known, non-default ids, each once, in `COSMETICS` order. */
const cleanOwned = (v: unknown): CosmeticId[] => {
  if (!Array.isArray(v)) return []
  const have = new Set(v.filter(isCosmeticId))
  return COSMETICS.filter((c) => !isDefault(c) && have.has(c.id)).map((c) => c.id)
}

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback

/**
 * Sanitise a stored `fold_cosmetics` value: unknown ids are dropped, and an
 * equipped item that isn't owned (a hand-edited save, a merge) falls back to
 * its default.
 */
export const readCosmetics = (v: unknown): CosmeticsRecord => {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  const owned = cleanOwned(o.owned)
  const e = o.equipped && typeof o.equipped === 'object' && !Array.isArray(o.equipped) ? (o.equipped as Record<string, unknown>) : {}
  const rec: CosmeticsRecord = {
    owned,
    equipped: {
      paper: pick(e.paper, PAPER_PATTERNS, DEFAULT_EQUIPPED.paper),
      hero: pick(e.hero, HERO_VARIANTS, DEFAULT_EQUIPPED.hero),
      confetti: pick(e.confetti, CONFETTI_SHAPES, DEFAULT_EQUIPPED.confetti)
    }
  }
  if (!owns(rec, `paper.${rec.equipped.paper}`)) rec.equipped.paper = DEFAULT_EQUIPPED.paper
  if (!owns(rec, `hero.${rec.equipped.hero}`)) rec.equipped.hero = DEFAULT_EQUIPPED.hero
  if (!owns(rec, `confetti.${rec.equipped.confetti}`)) rec.equipped.confetti = DEFAULT_EQUIPPED.confetti
  return rec
}

/** Ids a star total unlocks (defaults left out), in `COSMETICS` order. */
export const unlockedBy = (stars: number): CosmeticId[] => {
  const n = Number.isFinite(stars) ? stars : 0
  return COSMETICS.filter((c) => !isDefault(c) && c.stars <= n).map((c) => c.id)
}

/** Ids a star total unlocks that the record doesn't own yet. */
export const newUnlocks = (r: Pick<CosmeticsRecord, 'owned'>, stars: number): CosmeticId[] =>
  unlockedBy(stars).filter((id) => !r.owned.includes(id))

/** The record with everything a star total unlocks added (a new object; the input is untouched). */
export const withUnlocks = (r: CosmeticsRecord, stars: number): CosmeticsRecord =>
  readCosmetics({ owned: [...r.owned, ...unlockedBy(stars)], equipped: r.equipped })

/** The record with one item equipped, or null when it isn't owned (or unknown). */
export const equip = (r: CosmeticsRecord, id: string): CosmeticsRecord | null => {
  const c = cosmeticById(id)
  if (!c || !owns(r, c.id)) return null
  return readCosmetics({ owned: r.owned, equipped: { ...r.equipped, [c.kind]: c.value } })
}

/**
 * A cloud merge: the union of what either side owns (a merge never takes a
 * cosmetic away), and the winning side's equipped items — each where it is
 * owned in the union (always, for a sane save), else its default.
 */
export const mergeCosmetics = (winner: unknown, other: unknown): CosmeticsRecord => {
  const w = readCosmetics(winner)
  const o = readCosmetics(other)
  // The winner's picks as stored: one it didn't own itself may be owned in the union.
  const raw = winner && typeof winner === 'object' && !Array.isArray(winner) ? (winner as Record<string, unknown>).equipped : undefined
  return readCosmetics({ owned: [...w.owned, ...o.owned], equipped: raw ?? w.equipped })
}

/** The next locked cosmetic to chase (the smallest threshold above `stars`), or null. */
export const nextUnlock = (stars: number): CosmeticDef | null => {
  let best: CosmeticDef | null = null
  for (const c of COSMETICS) if (c.stars > stars && (!best || c.stars < best.stars)) best = c
  return best
}
