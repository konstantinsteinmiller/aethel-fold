import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { carryStars, computeMeta, META_KEY, SAVE_KEYS, serializeMeta } from '@/utils/save/SaveMergePolicy'
import { SaveManager } from '@/utils/save/SaveManager'
import { CrazyGamesStrategy } from '@/utils/save/CrazyGamesStrategy'
import { STARS_KEY } from '@/keys'

// ─── Star rating persistence (roadmap #1) ───────────────────────────────────
//
// Best stars per page live in `aethel_state.fold_stars` (never a new
// localStorage key), only ever go up, and a cloud merge — which otherwise
// adopts one side's whole blob — keeps the per-page best of both sides.

const STATE = SAVE_KEYS.STATE
const reader = (state: Record<string, unknown>) => ({
  get: (k: string) => (k === STATE ? JSON.stringify(state) : null)
})

describe('fold_stars through useFoldProgress', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('records the best stars per page inside aethel_state, and never lowers them', async () => {
    vi.useFakeTimers()
    try {
      const prog = await import('@/use/useFoldProgress')
      const { getState, flushPersist } = await import('@/use/useAethelState')
      expect(prog.starsOf(1, 2)).toBe(0)
      expect(prog.recordStars(1, 2, 2)).toBe(true)
      expect(prog.recordStars(1, 2, 1)).toBe(false)
      expect(prog.recordStars(1, 2, 2)).toBe(false)
      expect(prog.recordStars(2, 1, 3)).toBe(true)
      expect(prog.starsOf(1, 2)).toBe(2)
      expect(getState(STARS_KEY)).toEqual({ b1p2: 2, b2p1: 3 })
      expect(prog.recordStars(1, 2, 3)).toBe(true)
      expect(getState(STARS_KEY)).toEqual({ b1p2: 3, b2p1: 3 })
      // Junk never lands.
      expect(prog.recordStars(1, 3, Number.NaN)).toBe(false)
      expect(prog.recordStars(1, 3, 0)).toBe(false)
      flushPersist()
      // One localStorage key, holding the stars.
      const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
      expect(keys).toEqual([STATE])
      expect(JSON.parse(localStorage.getItem(STATE)!)[STARS_KEY]).toEqual({ b1p2: 3, b2p1: 3 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('starsForBook lists the rated pages (the finale is left out) and totals them', async () => {
    const prog = await import('@/use/useFoldProgress')
    prog.recordStars(1, 1, 3)
    prog.recordStars(1, 3, 2)
    prog.recordStars(2, 5, 1)
    expect(prog.starsForBook(1)).toEqual({ pages: [3, 0, 2, 0, 0], earned: 5, max: 15 })
    expect(prog.starsForBook(2)).toEqual({ pages: [0, 0, 0, 0, 1], earned: 1, max: 15 })
    expect(prog.totalStars()).toEqual({ earned: 6, max: 45 })
  })

  it('reads a hand-edited or corrupt fold_stars safely', async () => {
    localStorage.setItem(STATE, JSON.stringify({ [STARS_KEY]: { b1p1: 9, b1p2: 'x', b9p1: 3, b1p3: -2 } }))
    const prog = await import('@/use/useFoldProgress')
    expect(prog.starsOf(1, 1)).toBe(3)
    expect(prog.starsOf(1, 2)).toBe(0)
    expect(prog.starsForBook(1).earned).toBe(3)
  })
})

describe('stars in the merge', () => {
  it('stars break a tie between two saves at the same milestone, but never outrank a cleared page', () => {
    const base = { fold_cleared: 3, fold_page: 4 }
    const few = computeMeta(reader({ ...base, [STARS_KEY]: { b1p1: 1, b1p2: 1, b1p3: 1 } }))
    const many = computeMeta(reader({ ...base, [STARS_KEY]: { b1p1: 3, b1p2: 3, b1p3: 3 } }))
    expect(many.progressScore).toBeGreaterThan(few.progressScore)
    const allStars: Record<string, number> = {}
    for (const b of [1, 2]) for (const p of [1, 2, 3, 4, 5]) allStars[`b${b}p${p}`] = 3
    const starry = computeMeta(reader({ ...base, [STARS_KEY]: allStars }))
    const further = computeMeta(reader({ fold_cleared: 4, fold_page: 4 }))
    expect(further.progressScore).toBeGreaterThan(starry.progressScore)
  })

  it('carryStars folds the other side\'s better stars into the winner, per page', () => {
    const winner = JSON.stringify({ fold_cleared: 4, [STARS_KEY]: { b1p1: 1, b1p2: 3 } })
    const other = JSON.stringify({ fold_cleared: 2, [STARS_KEY]: { b1p1: 3, b1p2: 1, b2p1: 2 } })
    const merged = JSON.parse(carryStars(winner, other)!)
    expect(merged[STARS_KEY]).toEqual({ b1p1: 3, b1p2: 3, b2p1: 2 })
    expect(merged.fold_cleared).toBe(4)
  })

  it('carryStars writes nothing when the winner already has every star, or a side is missing / corrupt', () => {
    const winner = JSON.stringify({ [STARS_KEY]: { b1p1: 3 } })
    expect(carryStars(winner, JSON.stringify({ [STARS_KEY]: { b1p1: 2 } }))).toBeNull()
    expect(carryStars(winner, JSON.stringify({}))).toBeNull()
    expect(carryStars(winner, null)).toBeNull()
    expect(carryStars(null, winner)).toBeNull()
    expect(carryStars('{not json', winner)).toBeNull()
    // A winner without stars adopts the other side's.
    expect(JSON.parse(carryStars(JSON.stringify({ fold_page: 2 }), winner)!)[STARS_KEY]).toEqual({ b1p1: 3 })
  })
})

// End to end through the CrazyGames strategy: whole-blob merge, stars kept.
describe('CrazyGames hydrate never regresses stars', () => {
  const MANIFEST_KEY = '__save_internal__crazy_keys'
  const makeFakeData = (seed: Record<string, string> = {}) => {
    const store = new Map<string, string>(Object.entries(seed))
    return {
      store,
      getItem: vi.fn(async (key: string) => store.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => { store.set(key, value) }),
      removeItem: vi.fn(async (key: string) => { store.delete(key) })
    }
  }
  const metaFor = (state: string, savedAt: string): string =>
    serializeMeta(computeMeta({ get: (k) => (k === STATE ? state : null) }, savedAt))
  const init = async (manager: SaveManager) => {
    const p = manager.init()
    await vi.runAllTimersAsync()
    await p
  }

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('remote wins on progress, but the local 3-star page survives and goes back up to the cloud', async () => {
    const local = JSON.stringify({ fold_cleared: 2, fold_page: 3, [STARS_KEY]: { b1p1: 3, b1p2: 3 } })
    localStorage.setItem(STATE, local)
    localStorage.setItem(META_KEY, metaFor(local, '2026-01-01T00:00:00.000Z'))
    const remote = JSON.stringify({ fold_cleared: 4, fold_page: 5, [STARS_KEY]: { b1p1: 1, b1p2: 2, b1p3: 2, b1p4: 1 } })
    const data = makeFakeData({
      [MANIFEST_KEY]: JSON.stringify([META_KEY, STATE]),
      [STATE]: remote,
      [META_KEY]: metaFor(remote, '2026-01-02T00:00:00.000Z')
    })
    const manager = new SaveManager(new CrazyGamesStrategy(() => data))
    await init(manager)

    const after = JSON.parse(localStorage.getItem(STATE)!)
    expect(after.fold_cleared).toBe(4)
    expect(after[STARS_KEY]).toEqual({ b1p1: 3, b1p2: 3, b1p3: 2, b1p4: 1 })
    await vi.runAllTimersAsync()
    expect(JSON.parse(data.store.get(STATE)!)[STARS_KEY]).toEqual({ b1p1: 3, b1p2: 3, b1p3: 2, b1p4: 1 })
  })

  it('local wins, and the cloud\'s better star on another page joins it', async () => {
    const local = JSON.stringify({ fold_cleared: 5, fold_page: 6, [STARS_KEY]: { b1p1: 2 } })
    localStorage.setItem(STATE, local)
    localStorage.setItem(META_KEY, metaFor(local, '2026-01-02T00:00:00.000Z'))
    const remote = JSON.stringify({ fold_cleared: 1, fold_page: 2, [STARS_KEY]: { b1p1: 3 } })
    const data = makeFakeData({
      [MANIFEST_KEY]: JSON.stringify([META_KEY, STATE]),
      [STATE]: remote,
      [META_KEY]: metaFor(remote, '2026-01-01T00:00:00.000Z')
    })
    const manager = new SaveManager(new CrazyGamesStrategy(() => data))
    await init(manager)

    const after = JSON.parse(localStorage.getItem(STATE)!)
    expect(after.fold_cleared).toBe(5)
    expect(after[STARS_KEY]).toEqual({ b1p1: 3 })
    await vi.runAllTimersAsync()
    expect(JSON.parse(data.store.get(STATE)!)[STARS_KEY]).toEqual({ b1p1: 3 })
  })
})
