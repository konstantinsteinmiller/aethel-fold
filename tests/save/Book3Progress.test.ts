import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { carryStars, computeMeta, SAVE_KEYS } from '@/utils/save/SaveMergePolicy'
import { STATE_KEY } from '@/use/useAethelState'
import {
  BEST3_KEY, BOOK_KEY, CLEARED3_KEY, COSMETICS_KEY, PAGE_KEY, RUSH_KEY, SECRETS_KEY, STARS_KEY, WINS3_KEY
} from '@/keys'

// ─── Book 3, "The Sea of Paper" (roadmap #3), through every save path ──────
//
// Its progress lives in `aethel_state` like books 1 and 2 (never a new
// localStorage key): fold_cleared3 / fold_best3 / fold_wins3, the `b3p<n>`
// star keys, the `b3` rush best (the Kraken Rush) and its six secrets.

const STATE = SAVE_KEYS.STATE

const reader = (state: Record<string, unknown>) => ({
  get: (k: string) => (k === STATE_KEY ? JSON.stringify(state) : null)
})

describe('book 3 in the merge score', () => {
  it('a save deep into book 3 beats one that only finished books 1 and 2', () => {
    const two = computeMeta(reader({ fold_cleared: 6, fold_wins: 1, fold_cleared2: 6, fold_wins2: 1, fold_page: 1 }))
    const into3 = computeMeta(reader({
      fold_cleared: 6, fold_wins: 1, fold_cleared2: 6, fold_wins2: 1, fold_cleared3: 3, fold_book: 3, fold_page: 4
    }))
    expect(into3.progressScore).toBeGreaterThan(two.progressScore)
    expect(into3.maxStage).toBe(15)
  })

  it('a book 3 win counts like any other', () => {
    const two = computeMeta(reader({ fold_cleared: 6, fold_wins: 1, fold_cleared2: 6, fold_wins2: 1 }))
    const three = computeMeta(reader({ fold_cleared: 6, fold_wins: 1, fold_cleared2: 6, fold_wins2: 1, fold_cleared3: 6, fold_wins3: 1 }))
    expect(three.progressScore - two.progressScore).toBe(6 * 1000 + 5000)
  })

  it('book 3 stars count too, and never outweigh a cleared page', () => {
    const a = computeMeta(reader({ fold_cleared3: 2, fold_stars: { b3p1: 3, b3p2: 3 } }))
    const b = computeMeta(reader({ fold_cleared3: 3 }))
    expect(a.progressScore).toBeLessThan(b.progressScore)
    const plain = computeMeta(reader({ fold_cleared3: 2 }))
    expect(a.progressScore - plain.progressScore).toBe(6 * 25)
  })
})

describe('book 3 in the field-level merge (carryStars)', () => {
  it('carries book 3 stars, secrets, the kraken rush best and the new cosmetics into the winner', () => {
    const winner = JSON.stringify({
      fold_cleared: 6, [STARS_KEY]: { b1p1: 3, b3p1: 1 }, [SECRETS_KEY]: ['lamp'], [RUSH_KEY]: { b3: 70 },
      [COSMETICS_KEY]: { owned: ['paper.graph'], equipped: { paper: 'graph', hero: 'classic', confetti: 'squares' } }
    })
    const other = JSON.stringify({
      fold_cleared3: 6, [STARS_KEY]: { b3p1: 3, b3p5: 2 }, [SECRETS_KEY]: ['regatta', 'tickle'], [RUSH_KEY]: { b3: 52.5 },
      [COSMETICS_KEY]: { owned: ['paper.chart', 'hero.sailor'], equipped: { paper: 'chart', hero: 'sailor', confetti: 'squares' } }
    })
    const merged = JSON.parse(carryStars(winner, other)!)
    expect(merged[STARS_KEY]).toEqual({ b1p1: 3, b3p1: 3, b3p5: 2 })
    expect(merged[SECRETS_KEY]).toEqual(['lamp', 'regatta', 'tickle'])
    expect(merged[RUSH_KEY]).toEqual({ b3: 52.5 })
    expect(merged[COSMETICS_KEY].owned).toEqual(['paper.graph', 'paper.chart', 'hero.sailor'])
    // The winner keeps what it had equipped.
    expect(merged[COSMETICS_KEY].equipped.paper).toBe('graph')
  })
})

describe('book 3 through useFoldProgress', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('a book 3 bookmark reads back (and falls back to book 1 while book 3 is locked)', async () => {
    localStorage.setItem(STATE, JSON.stringify({ [BOOK_KEY]: 3, [PAGE_KEY]: 4, fold_wins: 1 }))
    let prog = await import('@/use/useFoldProgress')
    expect(prog.resumeBook.value).toBe(3)
    expect(prog.bookUnlocked(3)).toBe(false)
    expect(prog.savedBook()).toBe(1)
    vi.resetModules()
    localStorage.setItem(STATE, JSON.stringify({ [BOOK_KEY]: 3, [PAGE_KEY]: 4, fold_wins: 1, fold_wins2: 1 }))
    prog = await import('@/use/useFoldProgress')
    expect(prog.bookUnlocked(3)).toBe(true)
    expect(prog.savedBook()).toBe(3)
    expect(prog.resumePage.value).toBe(4)
    expect(prog.hasProgress()).toBe(true)
  })

  it('junk book numbers read as book 1', async () => {
    localStorage.setItem(STATE, JSON.stringify({ [BOOK_KEY]: 7 }))
    const prog = await import('@/use/useFoldProgress')
    expect(prog.resumeBook.value).toBe(1)
  })

  it('checkpoints, stars, a win, the rush and secrets round-trip for book 3 — all inside aethel_state', async () => {
    vi.useFakeTimers()
    try {
      const prog = await import('@/use/useFoldProgress')
      const { getState, flushPersist } = await import('@/use/useAethelState')
      prog.startNewRun(3)
      expect(getState(BOOK_KEY)).toBe(3)
      prog.checkpoint(3, { score: 4200, hits: 1, time: 95.4 }, 2, 3)
      expect(getState(PAGE_KEY)).toBe(3)
      expect(getState(CLEARED3_KEY)).toBe(2)
      // (The refs follow the blob a tick later.)
      await nextTick()
      expect(prog.pagesCleared3.value).toBe(2)
      // Stars on book 3's pages, and the star total now counts 45.
      expect(prog.recordStars(3, 1, 3)).toBe(true)
      expect(prog.recordStars(3, 2, 2)).toBe(true)
      expect(prog.starsOf(3, 1)).toBe(3)
      expect(prog.starsForBook(3)).toEqual({ pages: [3, 2, 0, 0, 0], earned: 5, max: 15 })
      expect(prog.totalStars()).toEqual({ earned: 5, max: 45 })
      // The book is won: its records, and the bookmark stays on the last book.
      const r = prog.recordVictory(31000, 410.2, 3)
      expect(r.newBest).toBe(true)
      expect(getState(WINS3_KEY)).toBe(1)
      expect(getState(CLEARED3_KEY)).toBe(6)
      expect(getState(BEST3_KEY)).toEqual({ score: 31000, time: 410.2 })
      expect(getState(BOOK_KEY)).toBe(3)
      await nextTick()
      expect(prog.recordsFor(3).score).toBe(31000)
      // The Kraken Rush best, and a book 3 secret.
      expect(prog.recordRush(3, 51.27, 60).newBest).toBe(true)
      expect(prog.rushBestOf(3)).toBe(51.2)
      expect(prog.recordSecret('regatta')).toBe(true)
      expect(prog.secretCount(3)).toEqual({ found: 1, total: 6 })
      expect(prog.secretCount()).toEqual({ found: 1, total: 18 })
      // The shelf sees all three books.
      await nextTick()
      const sp = prog.shelfProgress()
      expect(sp.wins).toEqual([0, 0, 1])
      expect(sp.cleared).toEqual([0, 0, 6])
      expect(sp.stars[2]).toEqual([3, 2, 0, 0, 0])
      expect(sp.rush).toEqual([0, 0, 51.2])
      flushPersist()
      const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
      expect(keys).toEqual([STATE])
      // A reload reads all of it back.
      vi.resetModules()
      const again = await import('@/use/useFoldProgress')
      expect(again.wins3.value).toBe(1)
      expect(again.pagesCleared3.value).toBe(6)
      expect(again.starsOf(3, 2)).toBe(2)
      expect(again.rushBestOf(3)).toBe(51.2)
      expect(again.secretsFound.value).toEqual(['regatta'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('winning book 2 moves the bookmark on to book 3, which it unlocks', async () => {
    const prog = await import('@/use/useFoldProgress')
    const { getState } = await import('@/use/useAethelState')
    prog.recordVictory(9000, 300, 1)
    await nextTick()
    expect(getState(BOOK_KEY)).toBe(2)
    expect(prog.bookUnlocked(3)).toBe(false)
    prog.recordVictory(9000, 300, 2)
    await nextTick()
    expect(getState(BOOK_KEY)).toBe(3)
    expect(prog.bookUnlocked(3)).toBe(true)
  })

  it('45 stars unlock book 3\'s cosmetics, and nothing owned is ever taken away', async () => {
    const stars: Record<string, number> = {}
    for (const b of [1, 2, 3]) for (const p of [1, 2, 3, 4, 5]) stars[`b${b}p${p}`] = 3
    localStorage.setItem(STATE, JSON.stringify({
      [STARS_KEY]: stars,
      [COSMETICS_KEY]: { owned: ['paper.graph'], equipped: { paper: 'graph', hero: 'classic', confetti: 'squares' } }
    }))
    const prog = await import('@/use/useFoldProgress')
    expect(prog.totalStars()).toEqual({ earned: 45, max: 45 })
    const fresh = prog.unlockCosmetics()
    expect(fresh).toContain('paper.chart')
    expect(fresh).toContain('hero.sailor')
    expect(fresh).toContain('confetti.fish')
    expect(prog.cosmetics.value.owned).toContain('paper.graph')
    expect(prog.equipCosmetic('hero.sailor')).toBe(true)
    expect(prog.cosmetics.value.equipped.hero).toBe('sailor')
  })
})
