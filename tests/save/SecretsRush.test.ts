import { beforeEach, describe, expect, it, vi } from 'vitest'
import { carryStars, SAVE_KEYS } from '@/utils/save/SaveMergePolicy'
import { RUSH_KEY, SECRETS_KEY, SETTINGS_KEY, STARS_KEY } from '@/keys'

// ─── Page secrets (roadmap #15) and Dragon Rush bests (roadmap #16) ─────────
//
// Both live inside `aethel_state` (never a new localStorage key), only ever
// get better, and a cloud merge keeps the better of both sides.

const STATE = SAVE_KEYS.STATE

describe('fold_secrets and fold_rush through useFoldProgress', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('records each secret once, in list order, inside aethel_state; counts per book and overall', async () => {
    vi.useFakeTimers()
    try {
      const prog = await import('@/use/useFoldProgress')
      const { getState, flushPersist } = await import('@/use/useAethelState')
      expect(prog.secretCount()).toEqual({ found: 0, total: 12 })
      expect(prog.recordSecret('wave')).toBe(true)
      expect(prog.recordSecret('lamp')).toBe(true)
      expect(prog.recordSecret('wave')).toBe(false)
      expect(getState(SECRETS_KEY)).toEqual(['lamp', 'wave'])
      expect(prog.secretCount()).toEqual({ found: 2, total: 12 })
      expect(prog.secretCount(1)).toEqual({ found: 1, total: 6 })
      expect(prog.secretCount(2)).toEqual({ found: 1, total: 6 })
      flushPersist()
      const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
      expect(keys).toEqual([STATE])
      expect(JSON.parse(localStorage.getItem(STATE)!)[SECRETS_KEY]).toEqual(['lamp', 'wave'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('a reload reads the found secrets back (junk dropped)', async () => {
    localStorage.setItem(STATE, JSON.stringify({ [SECRETS_KEY]: ['boat', 'boat', 'nope', 7, 'flap'] }))
    const prog = await import('@/use/useFoldProgress')
    expect(prog.secretsFound.value).toEqual(['boat', 'flap'])
    expect(prog.secretCount()).toEqual({ found: 2, total: 12 })
  })

  it('keeps the fastest rush per book and reports time vs par and the previous best', async () => {
    vi.useFakeTimers()
    try {
      const prog = await import('@/use/useFoldProgress')
      const { getState, flushPersist } = await import('@/use/useAethelState')
      expect(prog.rushBestOf(1)).toBe(0)
      let r = prog.recordRush(1, 70.26, 65)
      expect(r).toEqual({ time: 70.2, par: 65, best: 0, underPar: false, newBest: true })
      r = prog.recordRush(1, 75, 65)
      expect(r.newBest).toBe(false)
      expect(r.best).toBe(70.2)
      r = prog.recordRush(1, 61.05, 65)
      expect(r).toEqual({ time: 61, par: 65, best: 70.2, underPar: true, newBest: true })
      prog.recordRush(2, 50, 60)
      expect(getState(RUSH_KEY)).toEqual({ b1: 61, b2: 50 })
      expect(prog.shelfProgress().rush).toEqual([61, 50])
      flushPersist()
      const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
      expect(keys).toEqual([STATE])
    } finally {
      vi.useRealTimers()
    }
  })

  it('night mode is a cosmetic setting in fold_settings (default off, junk reads as off)', async () => {
    localStorage.setItem(STATE, JSON.stringify({ [SETTINGS_KEY]: { night: 'yes' } }))
    const prog = await import('@/use/useFoldProgress')
    const { getState } = await import('@/use/useAethelState')
    expect(prog.foldSettings.value.night).toBe(false)
    prog.setFoldSetting('night', true)
    expect((getState(SETTINGS_KEY) as { night: boolean }).night).toBe(true)
  })

  it('a saved night mode reads back on', async () => {
    localStorage.setItem(STATE, JSON.stringify({ [SETTINGS_KEY]: { night: true } }))
    const prog = await import('@/use/useFoldProgress')
    expect(prog.foldSettings.value.night).toBe(true)
  })
})

describe('secrets and rush bests in the merge', () => {
  it('carries the union of secrets and the faster rush per book into the winner', () => {
    const winner = JSON.stringify({ fold_cleared: 4, [SECRETS_KEY]: ['lamp'], [RUSH_KEY]: { b1: 70 } })
    const other = JSON.stringify({ fold_cleared: 2, [SECRETS_KEY]: ['boat', 'lamp'], [RUSH_KEY]: { b1: 62.5, b2: 58 } })
    const merged = JSON.parse(carryStars(winner, other)!)
    expect(merged[SECRETS_KEY]).toEqual(['lamp', 'boat'])
    expect(merged[RUSH_KEY]).toEqual({ b1: 62.5, b2: 58 })
    expect(merged.fold_cleared).toBe(4)
    expect(merged[STARS_KEY]).toBeUndefined()
  })

  it('writes nothing when the winner already has it all', () => {
    const winner = JSON.stringify({ [SECRETS_KEY]: ['lamp', 'boat'], [RUSH_KEY]: { b1: 50 } })
    expect(carryStars(winner, JSON.stringify({ [SECRETS_KEY]: ['boat'], [RUSH_KEY]: { b1: 55 } }))).toBeNull()
    expect(carryStars(winner, JSON.stringify({}))).toBeNull()
  })
})
