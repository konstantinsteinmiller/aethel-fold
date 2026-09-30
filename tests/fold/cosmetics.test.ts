import { describe, expect, it } from 'vitest'
import {
  CONFETTI_SHAPES, COSMETICS, COSMETIC_IDS, DEFAULT_EQUIPPED, HERO_VARIANTS, PAPER_PATTERNS, cosmeticById, cosmeticsOf,
  equip, isCosmeticId, mergeCosmetics, newUnlocks, nextUnlock, owns, readCosmetics, unlockedBy, withUnlocks
} from '@/fold/logic/cosmetics'
import { PAGE_PAPERS } from '@/fold/render/art/pageArt'
import { BOOKS } from '@/fold/logic/pages'
import { isRated } from '@/fold/logic/stars'

// ─── Paper cosmetics (roadmap #6) ──────────────────────────────────────────

/** Stars available over every book (3 per rated page). */
const AVAILABLE = Object.values(BOOKS).reduce((n, b) => n + Object.values(b).filter((p) => isRated(p)).length * 3, 0)

describe('cosmetics: the unlock table', () => {
  it('45 stars are available over books 1–3 (30 of them in books 1 and 2)', () => {
    expect(AVAILABLE).toBe(45)
    const twoBooks = [BOOKS[1], BOOKS[2]].reduce((n, b) => n + Object.values(b).filter((p) => isRated(p)).length * 3, 0)
    expect(twoBooks).toBe(30)
  })

  it('book 3 (roadmap #3) adds its unlocks above the old table without moving it', () => {
    // The old thresholds stand: books 1–2 alone still unlock everything they did.
    const old = COSMETICS.filter((c) => c.stars > 0 && c.stars <= 30).map((c) => `${c.id}@${c.stars}`)
    expect(old).toEqual([
      'paper.graph@3', 'paper.washi@11', 'paper.newsprint@20', 'paper.map@26',
      'hero.scarf@8', 'hero.sash@17', 'hero.crown@30',
      'confetti.stars@5', 'confetti.hearts@14', 'confetti.cranes@23'
    ])
    expect(COSMETICS.filter((c) => c.stars > 30).map((c) => `${c.id}@${c.stars}`)).toEqual([
      'paper.chart@35', 'hero.sailor@40', 'confetti.fish@45'
    ])
  })

  it('ids are unique, well-formed and valid for their kind', () => {
    expect(new Set(COSMETIC_IDS).size).toBe(COSMETICS.length)
    for (const c of COSMETICS) {
      expect(c.id).toBe(`${c.kind}.${c.value}`)
      expect(isCosmeticId(c.id)).toBe(true)
      expect(cosmeticById(c.id)).toBe(c)
      const allowed: readonly string[] = c.kind === 'paper' ? PAPER_PATTERNS : c.kind === 'hero' ? HERO_VARIANTS : CONFETTI_SHAPES
      expect(allowed, c.id).toContain(c.value)
    }
    // Every pattern and shape has an entry, and every paper is one `paintPage` can print.
    expect(cosmeticsOf('paper').map((c) => c.value)).toEqual([...PAPER_PATTERNS])
    expect(cosmeticsOf('hero').map((c) => c.value)).toEqual([...HERO_VARIANTS])
    expect(cosmeticsOf('confetti').map((c) => c.value)).toEqual([...CONFETTI_SHAPES])
    expect([...PAGE_PAPERS]).toEqual([...PAPER_PATTERNS])
  })

  it('each kind has exactly one default (0 stars), and it is the default equipped', () => {
    for (const kind of ['paper', 'hero', 'confetti'] as const) {
      const defaults = cosmeticsOf(kind).filter((c) => c.stars === 0)
      expect(defaults, kind).toHaveLength(1)
      expect(defaults[0]!.value).toBe(DEFAULT_EQUIPPED[kind])
    }
  })

  it('the roadmap asks for 4 papers, 3+ hero variants and 3+ confetti shapes to earn (book 3 adds the sea chart)', () => {
    expect(cosmeticsOf('paper').filter((c) => c.stars > 0).map((c) => c.value).sort()).toEqual(['chart', 'graph', 'map', 'newsprint', 'washi'])
    expect(cosmeticsOf('hero').filter((c) => c.stars > 0).length).toBeGreaterThanOrEqual(3)
    expect(cosmeticsOf('confetti').filter((c) => c.stars > 0).length).toBeGreaterThanOrEqual(3)
  })

  it('thresholds are distinct, reachable, and spread from early to the last star', () => {
    const t = COSMETICS.filter((c) => c.stars > 0).map((c) => c.stars).sort((a, b) => a - b)
    expect(new Set(t).size).toBe(t.length)
    expect(t[0]).toBeLessThanOrEqual(3) // something on the first well-played pages
    expect(t[t.length - 1]).toBe(AVAILABLE) // …and one for every star
    for (const s of t) expect(s).toBeLessThanOrEqual(AVAILABLE)
    // No stretch longer than a book's worth of play without a new unlock.
    for (let i = 1; i < t.length; i++) expect(t[i]! - t[i - 1]!).toBeLessThanOrEqual(6)
    // Within a kind, the order on screen is the unlock order.
    for (const kind of ['paper', 'hero', 'confetti'] as const) {
      const s = cosmeticsOf(kind).map((c) => c.stars)
      expect(s).toEqual([...s].sort((a, b) => a - b))
    }
  })

  it('unlockedBy: exactly the items at or under the total; boundaries inclusive', () => {
    expect(unlockedBy(0)).toEqual([])
    expect(unlockedBy(2)).toEqual([])
    expect(unlockedBy(3)).toEqual(['paper.graph'])
    expect(unlockedBy(4)).toEqual(['paper.graph'])
    expect(unlockedBy(5)).toEqual(['paper.graph', 'confetti.stars'])
    expect(unlockedBy(29)).not.toContain('hero.crown')
    expect(unlockedBy(30)).toContain('hero.crown')
    expect(unlockedBy(30)).toHaveLength(COSMETICS.filter((c) => c.stars > 0 && c.stars <= 30).length)
    expect(unlockedBy(45)).toHaveLength(COSMETICS.filter((c) => c.stars > 0).length)
    expect(unlockedBy(Number.NaN)).toEqual([])
    for (const c of COSMETICS) {
      if (c.stars === 0) continue
      expect(unlockedBy(c.stars), c.id).toContain(c.id)
      expect(unlockedBy(c.stars - 1), c.id).not.toContain(c.id)
    }
  })

  it('nextUnlock names the next thing to chase, and nothing past the last', () => {
    expect(nextUnlock(0)?.id).toBe('paper.graph')
    expect(nextUnlock(3)?.id).toBe('confetti.stars')
    expect(nextUnlock(30)?.id).toBe('paper.chart')
    expect(nextUnlock(44)?.id).toBe('confetti.fish')
    expect(nextUnlock(45)).toBeNull()
  })
})

describe('cosmetics: the record', () => {
  it('reads junk as the defaults; unknown ids and defaults are not stored as owned', () => {
    for (const junk of [undefined, null, 7, 'x', [], { owned: 'paper.map' }]) {
      expect(readCosmetics(junk)).toEqual({ owned: [], equipped: { ...DEFAULT_EQUIPPED } })
    }
    const r = readCosmetics({ owned: ['paper.map', 'paper.map', 'paper.plain', 'nope', 4, 'hero.crown'], equipped: {} })
    expect(r.owned).toEqual(['paper.map', 'hero.crown'])
    expect(owns(r, 'paper.plain')).toBe(true)
    expect(owns(r, 'paper.washi')).toBe(false)
    expect(owns(r, 'nope')).toBe(false)
  })

  it('an equipped item that is not owned falls back to its default', () => {
    const r = readCosmetics({ owned: ['paper.washi'], equipped: { paper: 'map', hero: 'crown', confetti: 'bogus' } })
    expect(r.equipped).toEqual({ paper: 'plain', hero: 'classic', confetti: 'squares' })
    const ok = readCosmetics({ owned: ['paper.washi'], equipped: { paper: 'washi' } })
    expect(ok.equipped.paper).toBe('washi')
  })

  it('new unlocks from a star total; withUnlocks adds them without touching the input', () => {
    const r = readCosmetics({ owned: ['paper.graph'] })
    expect(newUnlocks(r, 3)).toEqual([])
    expect(newUnlocks(r, 11)).toEqual(['paper.washi', 'hero.scarf', 'confetti.stars'])
    const next = withUnlocks(r, 11)
    expect(next.owned).toEqual(['paper.graph', 'paper.washi', 'hero.scarf', 'confetti.stars'])
    expect(r.owned).toEqual(['paper.graph'])
    // Stars never take one away (a lower total keeps what is owned).
    expect(withUnlocks(next, 0).owned).toEqual(next.owned)
  })

  it('equip: only owned items, per kind', () => {
    const r = withUnlocks(readCosmetics(undefined), 14)
    const a = equip(r, 'paper.washi')
    expect(a?.equipped).toEqual({ paper: 'washi', hero: 'classic', confetti: 'squares' })
    const b = equip(a!, 'confetti.hearts')
    expect(b?.equipped).toEqual({ paper: 'washi', hero: 'classic', confetti: 'hearts' })
    expect(equip(b!, 'hero.crown')).toBeNull()
    expect(equip(b!, 'paper.nope')).toBeNull()
    // Back to a default is always allowed.
    expect(equip(b!, 'paper.plain')?.equipped.paper).toBe('plain')
  })

  it('merge: the union of owned, the winning side equipped (where owned)', () => {
    const winner = { owned: ['paper.graph', 'hero.scarf'], equipped: { paper: 'graph', hero: 'scarf', confetti: 'squares' } }
    const other = { owned: ['paper.map', 'confetti.hearts'], equipped: { paper: 'map', hero: 'classic', confetti: 'hearts' } }
    const m = mergeCosmetics(winner, other)
    expect(m.owned).toEqual(['paper.graph', 'paper.map', 'hero.scarf', 'confetti.hearts'])
    expect(m.equipped).toEqual({ paper: 'graph', hero: 'scarf', confetti: 'squares' })
    // The other way round keeps the other side's picks.
    expect(mergeCosmetics(other, winner).equipped).toEqual({ paper: 'map', hero: 'classic', confetti: 'hearts' })
    // A winner without cosmetics keeps the defaults equipped but gains what the other owned.
    const bare = mergeCosmetics(undefined, other)
    expect(bare.owned).toEqual(['paper.map', 'confetti.hearts'])
    expect(bare.equipped).toEqual({ ...DEFAULT_EQUIPPED })
    // A winner equipping something it doesn't own (a torn save) falls back — unless the union owns it.
    expect(mergeCosmetics({ owned: [], equipped: { paper: 'map' } }, other).equipped.paper).toBe('map')
    expect(mergeCosmetics({ owned: [], equipped: { paper: 'washi' } }, other).equipped.paper).toBe('plain')
  })
})
