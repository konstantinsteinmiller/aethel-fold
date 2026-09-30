import { beforeEach, describe, expect, it, vi } from 'vitest'
import { carryStars, SAVE_KEYS } from '@/utils/save/SaveMergePolicy'
import { COSMETICS_KEY, SETTINGS_KEY, STARS_KEY } from '@/keys'

// ─── Paper cosmetics (roadmap #6) and the seasonal switch (roadmap #17) ─────
//
// Inside `aethel_state` (never a new localStorage key); owned only grows, and
// a cloud merge keeps the union of owned and the winner's equipped items.

const STATE = SAVE_KEYS.STATE

/** A star record worth `n` stars (3 per page, in page order). */
const starsWorth = (n: number): Record<string, number> => {
  const keys = ['b1p1', 'b1p2', 'b1p3', 'b1p4', 'b1p5', 'b2p1', 'b2p2', 'b2p3', 'b2p4', 'b2p5']
  const out: Record<string, number> = {}
  for (const k of keys) {
    if (n <= 0) break
    out[k] = Math.min(3, n)
    n -= 3
  }
  return out
}

describe('fold_cosmetics through useFoldProgress', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('a fresh player owns only the defaults and nothing is stored', async () => {
    const prog = await import('@/use/useFoldProgress')
    expect(prog.cosmetics.value).toEqual({ owned: [], equipped: { paper: 'plain', hero: 'classic', confetti: 'squares' } })
    expect(prog.unlockCosmetics()).toEqual([])
    const { getState } = await import('@/use/useAethelState')
    expect(getState(COSMETICS_KEY)).toBeUndefined()
  })

  it('stars unlock cosmetics once, inside aethel_state, and they survive a reload', async () => {
    vi.useFakeTimers()
    try {
      const prog = await import('@/use/useFoldProgress')
      const { getState, flushPersist } = await import('@/use/useAethelState')
      prog.recordStars(1, 1, 3)
      expect(prog.unlockCosmetics()).toEqual(['paper.graph'])
      expect(prog.unlockCosmetics()).toEqual([])
      prog.recordStars(1, 2, 2)
      expect(prog.unlockCosmetics()).toEqual(['confetti.stars'])
      expect(getState(COSMETICS_KEY)).toEqual({
        owned: ['paper.graph', 'confetti.stars'], equipped: { paper: 'plain', hero: 'classic', confetti: 'squares' }
      })
      expect(prog.equipCosmetic('paper.graph')).toBe(true)
      expect(prog.equipCosmetic('hero.crown')).toBe(false)
      expect(prog.cosmetics.value.equipped.paper).toBe('graph')
      flushPersist()
      const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
      expect(keys).toEqual([STATE])
      vi.resetModules()
      const again = await import('@/use/useFoldProgress')
      expect(again.cosmetics.value.owned).toEqual(['paper.graph', 'confetti.stars'])
      expect(again.cosmetics.value.equipped.paper).toBe('graph')
    } finally {
      vi.useRealTimers()
    }
  })

  it('stars from another device unlock quietly at boot (a catch-up, no loss)', async () => {
    localStorage.setItem(STATE, JSON.stringify({ [STARS_KEY]: starsWorth(12) }))
    const prog = await import('@/use/useFoldProgress')
    expect(prog.totalStars().earned).toBe(12)
    expect(prog.unlockCosmetics()).toEqual(['paper.graph', 'paper.washi', 'hero.scarf', 'confetti.stars'])
  })

  it('a hand-edited save is sanitised: unknown ids dropped, an unowned pick falls back', async () => {
    localStorage.setItem(STATE, JSON.stringify({
      [COSMETICS_KEY]: { owned: ['paper.map', 'paper.bogus'], equipped: { paper: 'map', hero: 'crown', confetti: 'hearts' } }
    }))
    const prog = await import('@/use/useFoldProgress')
    expect(prog.cosmetics.value).toEqual({ owned: ['paper.map'], equipped: { paper: 'map', hero: 'classic', confetti: 'squares' } })
  })

  it('seasonal decorations default on; old saves read it on; off sticks', async () => {
    localStorage.setItem(STATE, JSON.stringify({ [SETTINGS_KEY]: { haptics: false } }))
    const prog = await import('@/use/useFoldProgress')
    expect(prog.foldSettings.value.seasonal).toBe(true)
    prog.setFoldSetting('seasonal', false)
    const { getState } = await import('@/use/useAethelState')
    expect((getState(SETTINGS_KEY) as { seasonal: boolean }).seasonal).toBe(false)
  })
})

describe('cloud merge keeps every owned cosmetic', () => {
  const blob = (o: Record<string, unknown>): string => JSON.stringify(o)

  it('the winner gains the loser\'s owned (union) and keeps its own equipped', () => {
    const winner = blob({ [COSMETICS_KEY]: { owned: ['paper.graph'], equipped: { paper: 'graph', hero: 'classic', confetti: 'squares' } } })
    const loser = blob({ [COSMETICS_KEY]: { owned: ['paper.map', 'hero.crown'], equipped: { paper: 'map', hero: 'crown', confetti: 'squares' } } })
    const out = JSON.parse(carryStars(winner, loser)!)
    expect(out[COSMETICS_KEY]).toEqual({
      owned: ['paper.graph', 'paper.map', 'hero.crown'], equipped: { paper: 'graph', hero: 'classic', confetti: 'squares' }
    })
  })

  it('a winner without cosmetics still receives the other side\'s', () => {
    const out = JSON.parse(carryStars(blob({ fold_cleared: 6 }), blob({ [COSMETICS_KEY]: { owned: ['confetti.cranes'] } }))!)
    expect(out[COSMETICS_KEY].owned).toEqual(['confetti.cranes'])
    expect(out.fold_cleared).toBe(6)
  })

  it('nothing to carry: no write', () => {
    const same = blob({ [COSMETICS_KEY]: { owned: ['paper.graph'] } })
    expect(carryStars(same, same)).toBeNull()
    expect(carryStars(blob({ [COSMETICS_KEY]: { owned: ['paper.graph', 'paper.map'] } }), blob({ [COSMETICS_KEY]: { owned: ['paper.map'] } }))).toBeNull()
  })
})
