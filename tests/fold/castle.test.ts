import { describe, expect, it } from 'vitest'
import { FoldGame } from '@/fold/logic/game'
import { BALLISTA_COOLDOWN, BALLISTA_SHOTS, SPAWN_Z } from '@/fold/logic/config'
import { spawnEnemy } from '@/fold/logic/entities'
import { pageDef } from '@/fold/logic/pages'
import type { LessonId } from '@/fold/logic/types'

const ALL: Partial<Record<LessonId, boolean>> = {
  swipe: true, stamp: true, shield: true, launch: true, ridge: true, spread: true, peel: true,
  crease: true, core: true, frog: true, crush: true, sling: true, leaper: true, ballista: true
}

const step = (g: FoldGame, s: number): void => {
  for (let t = 0; t < s; t += 1 / 60) {
    g.update(1 / 60)
    g.events.clear()
  }
}

const ballistaIndex = (g: FoldGame, side: 'l' | 'r'): number => g.folds.findIndex((f) => f.def.id === `ballista-${side}`)

describe('the castle ballistas', () => {
  it('appear from book 1 page 3 on, and on every fighting page of book 2', () => {
    const count = (b: 1 | 2, p: number) => pageDef(b, p as 1).folds.filter((f) => f.kind === 'ballista').length
    expect(count(1, 1)).toBe(0)
    expect(count(1, 2)).toBe(0)
    for (const p of [3, 4, 5]) expect(count(1, p)).toBe(2)
    for (const p of [1, 2, 3, 4, 5]) expect(count(2, p)).toBe(2)
  })

  it('flip open for two tap-aimed shots, fold back, and re-arm after the cooldown', () => {
    const g = new FoldGame({ seed: 1, learned: ALL })
    g.startRun(3)
    g.update(1 / 60)
    const i = ballistaIndex(g, 'r')
    const f = g.folds[i]!
    expect(f.phase).toBe('ready')
    // Tapping the page with no ballista open does nothing.
    expect(g.fireBallista(1, -2)).toBe(false)
    expect(g.foldNow(i)).toBe(true)
    step(g, 0.3)
    expect(f.phase).toBe('up')
    expect(f.ammo).toBe(BALLISTA_SHOTS)
    // A plain tap on the page shoots (there is nothing raised to stamp).
    expect(g.tap(2, -1)).toBe(true)
    expect(f.ammo).toBe(1)
    expect(g.tap(2.5, -3)).toBe(true)
    expect(f.ammo).toBe(0)
    expect(g.stats.bolts).toBe(2)
    // Out of bolts: folds back on its own.
    step(g, 1.2)
    expect(f.phase).toBe('cooldown')
    step(g, BALLISTA_COOLDOWN - 0.4)
    expect(f.phase).toBe('cooldown')
    step(g, 0.8)
    expect(f.phase).toBe('ready')
  })

  it('a bolt pierces everyone on its line (up to its limit)', () => {
    const g = new FoldGame({ seed: 1, learned: ALL })
    g.startRun(3)
    g.update(1 / 60)
    const i = ballistaIndex(g, 'l')
    g.foldNow(i)
    step(g, 0.3)
    const x = g.folds[i]!.cx
    for (const z of [-1, 0, 1]) {
      const s = spawnEnemy(g.enemies, 'knight', x, z, 1, 0)
      g.enemies[s]!.speed = 0
    }
    expect(g.fireBallista(x, -4)).toBe(true)
    step(g, 1)
    // (A wave recruit on the same line may be pierced too.)
    expect(g.stats.boltKills).toBeGreaterThanOrEqual(3)
  })

  it('never shoots backwards at the castle', () => {
    const g = new FoldGame({ seed: 1, learned: ALL })
    g.startRun(3)
    g.update(1 / 60)
    const i = ballistaIndex(g, 'l')
    g.foldNow(i)
    step(g, 0.3)
    expect(g.fireBallista(-2.2, 6.5)).toBe(false)
    expect(g.folds[i]!.ammo).toBe(BALLISTA_SHOTS)
  })

  it('is taught wordlessly: swipe it open, then tap the enemy', () => {
    const learned = { ...ALL, ballista: false }
    const g = new FoldGame({ seed: 2, learned })
    g.startRun(3)
    for (let t = 0; t < 40 && g.lesson.id !== 'ballista'; t += 1 / 60) {
      // Keep the page otherwise quiet: raise shields, never lose a heart.
      g.update(1 / 60)
      g.events.clear()
    }
    expect(g.lesson.id).toBe('ballista')
    expect(g.lesson.hand.gesture).toBe('swipe')
    const f = g.folds[g.lesson.target]!
    expect(f.def.kind).toBe('ballista')
    g.foldNow(g.lesson.target)
    step(g, 0.5)
    expect(g.lesson.step).toBe(1)
    expect(g.lesson.hand.gesture).toBe('tap')
    g.tap(g.lesson.hand.ax, g.lesson.hand.az)
    step(g, 0.2)
    expect(g.learned.ballista).toBe(true)
  })
})

describe('spawning in front of the structures', () => {
  it('page 3 knights appear in front of the battlement, page 4 in front of the castle', () => {
    for (const [p, maxZ] of [[3, -5.4], [4, -2.15]] as const) {
      const g = new FoldGame({ seed: 3, learned: ALL })
      g.startRun(p)
      let first: number | null = null
      for (let t = 0; t < 30 && first === null; t += 1 / 60) {
        g.update(1 / 60)
        for (let k = 0; k < g.events.count; k++) {
          const ev = g.events.items[k]!
          const e = g.enemies[ev.a]!
          if (ev.type === 'spawn' && e.lane >= 0 && first === null) first = e.z
        }
        g.events.clear()
      }
      expect(first, `page ${p}`).not.toBeNull()
      expect(first!, `page ${p}`).toBeGreaterThanOrEqual(maxZ - 0.01)
      expect(first!).toBeGreaterThan(SPAWN_Z)
    }
  })
})
