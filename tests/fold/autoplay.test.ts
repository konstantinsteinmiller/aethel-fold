import { describe, expect, it } from 'vitest'
import { FoldGame } from '@/fold/logic/game'
import { isGrabbable, isStampable, onFootprint } from '@/fold/logic/folds'
import { SLING_GAIN } from '@/fold/logic/config'
import type { BookId, PageId } from '@/fold/logic/types'

/**
 * A scripted "perfect-ish" player: it does what the wordless lessons teach,
 * on the frame it becomes useful. If this bot can't finish a page, a human
 * can't either — so this is the balance/flow smoke test for all six pages.
 */
const botStep = (g: FoldGame): void => {
  // Folds.
  for (let i = 0; i < g.folds.length; i++) {
    const f = g.folds[i]!
    const k = f.def.kind
    if (isStampable(f)) {
      const holding = g.enemies.some((e) => (e.state === 'blocked' || e.state === 'trapped') && e.fold === i)
      if (holding) g.stamp(i)
      continue
    }
    if (!isGrabbable(f)) continue
    const on = g.enemies.filter((e) => (e.state === 'march' || e.state === 'stand') && onFootprint(f, e.x, e.z, 0)).length
    if (k === 'wall' && f.def.structure === 'shield') {
      const incoming = g.projectiles.some((p) => p.alive && !p.stuck) || g.enemies.some((e) => e.state === 'stand' && e.windup > 0.3) ||
        g.boss.phase === 'breathCharge'
      if (incoming) g.foldNow(i)
    } else if (k === 'wall' || k === 'valley') {
      if (on >= 1) g.foldNow(i)
    } else if (k === 'launch') {
      if (g.enemies.some((e) => e.type === 'catapult' && e.state === 'stand' && onFootprint(f, e.x, e.z, 0.2))) g.foldNow(i)
    } else if (k === 'ridge' || k === 'frog') {
      g.foldNow(i)
    } else if (k === 'ballista') {
      if (g.enemies.some((e) => e.state === 'march' && e.z > 0.5)) g.foldNow(i)
    }
  }
  // Tears.
  for (let i = 0; i < g.tears.length; i++) {
    const t = g.tears[i]!
    if (t.active && !t.torn) g.pullTear(i, 1)
  }
  // Boss weak points.
  const b = g.boss
  if (b.exposed >= 0) {
    const w = b.weakPoints[b.exposed]!
    g.pullWeak(1)
    if (w.mode === 'crease') g.releaseWeak()
  }
  // Peel.
  if (g.phase === 'peel') g.peelDrag(1)
  // Ballistas: shoot the enemy closest to the castle.
  for (let n = 0; n < 2; n++) {
    let lead = -1
    let lz = -Infinity
    for (let j = 0; j < g.enemies.length; j++) {
      const e = g.enemies[j]!
      if ((e.state === 'march' || e.state === 'blocked') && e.z > lz && e.z < 4.5) {
        lz = e.z
        lead = j
      }
    }
    if (lead < 0 || g.armedBallista(g.enemies[lead]!.x) < 0) break
    if (!g.fireBallista(g.enemies[lead]!.x, g.enemies[lead]!.z)) break
  }
  // Sling (book 2): leapers first, then whoever is closest to the keep.
  const s = g.sling
  if (s && s.cool <= 0 && g.acceptsInput()) {
    let best = -1
    let bestScore = -Infinity
    for (let j = 0; j < g.enemies.length; j++) {
      const e = g.enemies[j]!
      if (e.state !== 'march' && e.state !== 'stand' && e.state !== 'blocked') continue
      const sc = e.z + (e.type === 'leaper' ? 6 : e.type === 'runner' ? 2 : 0)
      if (e.z > -5.5 && sc > bestScore) {
        bestScore = sc
        best = j
      }
    }
    if (best >= 0) {
      const e = g.enemies[best]!
      const tz = e.state === 'march' ? e.z + e.speed * 0.8 : e.z
      g.grabSling()
      g.aimSling(-(e.x - s.def.x) / SLING_GAIN, -(tz - s.def.z) / SLING_GAIN)
      g.releaseSling()
    }
  }
}

const run = (g: FoldGame, seconds: number, until: () => boolean, bot = true): boolean => {
  const dt = 1 / 60
  for (let t = 0; t < seconds; t += dt) {
    if (bot) botStep(g)
    g.update(dt)
    g.events.clear()
    if (until()) return true
  }
  return false
}

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
