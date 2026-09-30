import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import {
  createKindMemory, crumplesOn, difficultyFor, extraPerWave, foldSlowmoOn, lossesUpTo, noteCrumple, notePageWon,
  pageKey, readKindMemory, resetRunMemory, retryPenalty, shouldEaseBoss
} from '@/fold/logic/difficulty'
import { ALMOST, DIFFICULTY } from '@/fold/logic/config'

describe('the book is kind — difficulty math', () => {
  it('a fresh memory plays every page as authored', () => {
    const m = createKindMemory()
    for (let p = 1; p <= 6; p++) expect(difficultyFor(m, 1, p, p === 5)).toBe(1)
    expect(extraPerWave(m)).toBe(0)
    expect(foldSlowmoOn(m, 1, 3)).toBe(false)
  })

  it('the first crumple on a page slows its march by 10 % and arms the fold slow-mo there only', () => {
    const m = createKindMemory()
    noteCrumple(m, 1, 3)
    expect(crumplesOn(m, 1, 3)).toBe(1)
    expect(difficultyFor(m, 1, 3, false)).toBeCloseTo(DIFFICULTY.crumpleSlow)
    expect(DIFFICULTY.crumpleSlow).toBeCloseTo(0.9)
    expect(foldSlowmoOn(m, 1, 3)).toBe(true)
    // Other pages and the other book are untouched.
    expect(difficultyFor(m, 1, 2, false)).toBe(1)
    expect(difficultyFor(m, 2, 3, false)).toBe(1)
    // More crumples don't stack the slow march.
    noteCrumple(m, 1, 3)
    expect(difficultyFor(m, 1, 3, false)).toBeCloseTo(DIFFICULTY.crumpleSlow)
  })

  it('three perfect first-try pages in a row add one enemy per wave; a crumple or a hit resets it', () => {
    const m = createKindMemory()
    for (let p = 1; p <= 2; p++) notePageWon(m, 1, p, true, false)
    expect(extraPerWave(m)).toBe(0)
    notePageWon(m, 1, 3, true, false)
    expect(m.streak).toBe(3)
    expect(extraPerWave(m)).toBe(1)
    notePageWon(m, 1, 4, false, false)
    expect(extraPerWave(m)).toBe(0)
    for (let p = 1; p <= 3; p++) notePageWon(m, 1, p, true, false)
    noteCrumple(m, 1, 4)
    expect(m.streak).toBe(0)
    // A perfect clear on a page crumpled before is not first try.
    notePageWon(m, 1, 4, true, false)
    expect(m.streak).toBe(0)
  })

  it('losing twice before beating the boss page eases the dragon\'s mass units by 20 %', () => {
    const m = createKindMemory()
    noteCrumple(m, 1, 2)
    expect(shouldEaseBoss(m, 1, 5)).toBe(false)
    expect(difficultyFor(m, 1, 5, true)).toBe(1)
    noteCrumple(m, 1, 4)
    expect(lossesUpTo(m, 1, 5)).toBe(2)
    expect(shouldEaseBoss(m, 1, 5)).toBe(true)
    expect(difficultyFor(m, 1, 5, true)).toBeCloseTo(DIFFICULTY.bossEase)
    expect(DIFFICULTY.bossEase).toBeCloseTo(0.8)
    // Losses on the boss page itself count, and stack with its own slow march.
    const b = createKindMemory()
    noteCrumple(b, 1, 5)
    noteCrumple(b, 1, 5)
    expect(difficultyFor(b, 1, 5, true)).toBeCloseTo(Math.max(DIFFICULTY.min, DIFFICULTY.crumpleSlow * DIFFICULTY.bossEase))
    // The ease is only for the boss page.
    expect(difficultyFor(m, 1, 6, false)).toBe(1)
  })

  it('the boss ease is sticky after a struggle and resets on a first-try boss win', () => {
    const m = createKindMemory()
    noteCrumple(m, 1, 5)
    noteCrumple(m, 1, 5)
    notePageWon(m, 1, 5, false, true)
    expect(m.bossEase).toBe(true)
    // A new run forgets the crumples, but the dragon stays kind…
    resetRunMemory(m)
    expect(lossesUpTo(m, 1, 5)).toBe(0)
    expect(difficultyFor(m, 1, 5, true)).toBeCloseTo(DIFFICULTY.bossEase)
    // …until it is beaten on the first try.
    notePageWon(m, 1, 5, true, true)
    expect(m.bossEase).toBe(false)
    expect(difficultyFor(m, 1, 5, true)).toBe(1)
  })

  it('the scalar is clamped and always finite', () => {
    const m = createKindMemory()
    m.bossEase = true
    noteCrumple(m, 1, 5)
    const d = difficultyFor(m, 1, 5, true)
    expect(Number.isFinite(d)).toBe(true)
    expect(d).toBeGreaterThanOrEqual(DIFFICULTY.min)
    expect(d).toBeLessThanOrEqual(DIFFICULTY.max)
  })

  it('the Try-again penalty takes a share of the page\'s points, on the score grid', () => {
    expect(retryPenalty(0, ALMOST.penalty)).toBe(0)
    expect(retryPenalty(-50, ALMOST.penalty)).toBe(0)
    expect(retryPenalty(1000, 0.5)).toBe(500)
    expect(retryPenalty(1230, 0.5)).toBe(615)
    expect(retryPenalty(1235, 0.5) % 5).toBe(0)
    expect(retryPenalty(800, 2)).toBe(800)
    expect(ALMOST.penalty).toBeGreaterThan(0)
    expect(ALMOST.penalty).toBeLessThan(1)
  })

  it('reads a persisted memory defensively', () => {
    expect(readKindMemory(null)).toEqual(createKindMemory())
    expect(readKindMemory('nope')).toEqual(createKindMemory())
    const m = readKindMemory({
      score: 10, crumples: { b1p3: 2, b2p5: 1, junk: 4, b1p9: 1, b1p2: -1, b1p4: 'x', b1p1: NaN }, streak: 4.7, bossEase: true
    })
    expect(m.crumples).toEqual({ b1p3: 2, b2p5: 1 })
    expect(m.streak).toBe(4)
    expect(m.bossEase).toBe(true)
    expect(readKindMemory({ crumples: [1, 2], streak: -3, bossEase: 'yes' })).toEqual(createKindMemory())
    expect(pageKey(2, 4)).toBe('b2p4')
  })
})

// ─── Persistence round-trip through `aethel_state.fold_run` ────────────────

describe('the kindness memory persists inside fold_run', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  const blob = (): Record<string, any> => JSON.parse(localStorage.getItem('aethel_state') || '{}')
  const storageKeys = (): string[] => {
    const out: string[] = []
    for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i)!)
    return out
  }

  it('round-trips through aethel_state without adding a localStorage key', async () => {
    const prog = await import('@/use/useFoldProgress')
    const { flushPersist } = await import('@/use/useAethelState')
    prog.checkpoint(3, { score: 1200, hits: 1, time: 40 }, 2)
    const m = createKindMemory()
    noteCrumple(m, 1, 3)
    noteCrumple(m, 1, 3)
    m.streak = 2
    m.bossEase = true
    prog.saveKindness(m)
    flushPersist()

    expect(storageKeys().filter((k) => k !== '__save_meta__')).toEqual(['aethel_state'])
    const run = blob().fold_run
    expect(run).toEqual({ score: 1200, hits: 1, time: 40, crumples: { b1p3: 2 }, streak: 2, bossEase: true })

    // A reload reads it back.
    vi.resetModules()
    const again = await import('@/use/useFoldProgress')
    expect(again.readKindness()).toEqual({ crumples: { b1p3: 2 }, streak: 2, bossEase: true })
    expect(again.runCheckpoint.value?.score).toBe(1200)
  })

  it('a page checkpoint keeps the memory; a new run keeps only the streak and the boss ease', async () => {
    const prog = await import('@/use/useFoldProgress')
    const m = createKindMemory()
    noteCrumple(m, 1, 2)
    m.streak = 1
    m.bossEase = true
    prog.saveKindness(m)
    prog.checkpoint(3, { score: 500, hits: 0, time: 20 }, 2)
    expect(prog.readKindness()).toEqual({ crumples: { b1p2: 1 }, streak: 1, bossEase: true })
    prog.startNewRun(1)
    expect(prog.readKindness()).toEqual({ crumples: {}, streak: 1, bossEase: true })
  })

  it('plain checkpoints stay { score, hits, time } while the memory is empty', async () => {
    const prog = await import('@/use/useFoldProgress')
    prog.checkpoint(2, { score: 100, hits: 0, time: 5 }, 1)
    await nextTick()
    expect(prog.runCheckpoint.value).toEqual({ score: 100, hits: 0, time: 5 })
  })
})
