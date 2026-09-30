import { describe, expect, it } from 'vitest'
import { FoldGame } from '@/fold/logic/game'
import type { BookId, PageId } from '@/fold/logic/types'
import { run } from './bot'

describe('Aethel Fold autoplay', () => {
  it('the swipe lesson freezes time until the player folds, then launches the column', () => {
    const g = new FoldGame({ seed: 1 })
    g.startRun(1)
    // No bot: wait for the lesson.
    expect(run(g, 20, () => g.lesson.id === 'swipe', false)).toBe(true)
    // Let the slow-mo settle to a full freeze before the knights reach the hinge.
    run(g, 6, () => false, false)
    expect(g.hero.hp).toBe(3)
    expect(g.timeScale).toBeLessThan(0.05)
    const f = g.folds[g.lesson.target]!
    const zBefore = g.enemies.filter((e) => e.state === 'march').map((e) => e.z)
    run(g, 1, () => false, false)
    const zAfter = g.enemies.filter((e) => e.state === 'march').map((e) => e.z)
    expect(zAfter).toEqual(zBefore)
    // The player swipes.
    expect(g.grab(g.lesson.target)).toBe(true)
    g.drag(g.lesson.target, 1)
    run(g, 0.1, () => false, false)
    expect(g.release(g.lesson.target, 0)).toBe(true)
    let launched = 0
    const dt = 1 / 60
    for (let t = 0; t < 0.5; t += dt) {
      g.update(dt)
      for (let i = 0; i < g.events.count; i++) if (g.events.items[i]!.type === 'foldSnap') launched = g.events.items[i]!.b
      g.events.clear()
    }
    expect(f.phase).toBe('up')
    expect(launched).toBeGreaterThanOrEqual(3)
    expect(g.lesson.id).toBe(null)
    expect(g.learned.swipe).toBe(true)
  })

  it.each([1, 2, 3, 4] as PageId[])('a competent player clears page %i and moves on', (page) => {
    const g = new FoldGame({ seed: 7 + page })
    g.startRun(page)
    const ok = run(g, 240, () => g.pageId !== page)
    expect(ok, `stuck on page ${page} in phase ${g.phase}, wave ${g.waveIndex}, alive ${g.aliveCount()}`).toBe(true)
    expect(g.hero.hp).toBeGreaterThan(0)
    expect(g.score).toBeGreaterThan(0)
  })

  it('the dragon can be beaten and the run ends in victory after the frog fold', () => {
    const g = new FoldGame({ seed: 99 })
    g.startRun(5)
    const phases = new Set<string>()
    const ok = run(g, 400, () => {
      phases.add(g.boss.phase)
      return g.phase === 'victory'
    })
    expect(ok, `ended in ${g.phase} / boss ${g.boss.phase}`).toBe(true)
    for (const p of ['rumble', 'unfold', 'roar', 'breathCharge', 'breath', 'stomp', 'exposed', 'hurt', 'collapse', 'flat']) {
      expect(phases.has(p), p).toBe(true)
    }
    expect(g.boss.weakPoints.every((w) => w.broken)).toBe(true)
  })

  it('a player who does nothing is crumpled and the page restarts with full hearts', () => {
    const g = new FoldGame({ seed: 3, learned: { swipe: true, stamp: true } })
    g.startRun(2)
    let crumpled = false
    const ok = run(g, 120, () => {
      if (g.phase === 'crumple') crumpled = true
      return crumpled && g.phase === 'intro'
    }, false)
    expect(ok).toBe(true)
    expect(g.pageId).toBe(2)
    expect(g.hero.hp).toBe(3)
  })

  it.each([1, 2, 3, 4] as PageId[])('book 2: a competent player clears page %i and moves on', (page) => {
    const g = new FoldGame({ seed: 70 + page, book: 2 })
    g.startRun(page)
    const ok = run(g, 300, () => g.pageId !== page)
    expect(ok, `stuck on book 2 page ${page} in phase ${g.phase}, wave ${g.waveIndex}, alive ${g.aliveCount()}`).toBe(true)
    expect(g.hero.hp).toBeGreaterThan(0)
  })

  it('book 2: the returning dragon can be beaten and the book ends after the crane fold', () => {
    const g = new FoldGame({ seed: 5, book: 2 })
    g.startRun(5)
    const ok = run(g, 400, () => g.phase === 'victory')
    expect(ok, `ended in ${g.phase} / boss ${g.boss.phase}`).toBe(true)
    expect(g.book).toBe(2 as BookId)
  })

  it('plays the whole game from page 1 to victory', () => {
    const g = new FoldGame({ seed: 2024 })
    g.startRun(1)
    const ok = run(g, 1500, () => g.phase === 'victory')
    expect(ok, `ended on page ${g.pageId} phase ${g.phase}`).toBe(true)
    expect(g.pagesCleared).toBeGreaterThanOrEqual(5)
  })

  it('plays the whole of book 2 from page 1 to victory', () => {
    const g = new FoldGame({ seed: 4048, book: 2 })
    g.startRun(1)
    const ok = run(g, 1800, () => g.phase === 'victory')
    expect(ok, `ended on page ${g.pageId} phase ${g.phase}`).toBe(true)
  })
})
