import { describe, expect, it } from 'vitest'
import { FoldGame } from '@/fold/logic/game'
import { ENEMY, SLING_GAIN } from '@/fold/logic/config'
import { spawnEnemy } from '@/fold/logic/entities'
import { isBarrier } from '@/fold/logic/folds'
import { BOOKS, pageDef } from '@/fold/logic/pages'
import type { LessonId } from '@/fold/logic/types'

const ALL: Partial<Record<LessonId, boolean>> = {
  swipe: true, stamp: true, shield: true, launch: true, ridge: true, spread: true, peel: true,
  crease: true, core: true, frog: true, crush: true, sling: true, leaper: true, ballista: true
}

const step = (g: FoldGame, s: number, each?: () => void): void => {
  for (let t = 0; t < s; t += 1 / 60) {
    each?.()
    g.update(1 / 60)
    g.events.clear()
  }
}

/** Fire the sling so the stone lands on (x, z). */
const shootAt = (g: FoldGame, x: number, z: number): boolean => {
  const s = g.sling!
  if (!g.grabSling()) return false
  g.aimSling(-(x - s.def.x) / SLING_GAIN, -(z - s.def.z) / SLING_GAIN)
  return g.releaseSling()
}

describe('book 2 — the homefront', () => {
  it('has six pages, each (except the finale) with a sling and tower ballistas', () => {
    for (let p = 1; p <= 6; p++) {
      const def = pageDef(2, p as 1)
      expect(def.book).toBe(2)
      if (def.exit !== 'finale') {
        expect(def.sling).toBeTruthy()
        expect(def.folds.filter((f) => f.kind === 'ballista')).toHaveLength(2)
      }
    }
    expect(BOOKS[2][5].exit).toBe('boss')
    expect(BOOKS[2][6].finale).toBe('crane')
    // Book 1 only previews the sling, on page 4.
    for (let p = 1; p <= 6; p++) expect(!!pageDef(1, p as 1).sling).toBe(p === 4)
  })

  it('runners are twice as fast as knights', () => {
    expect(ENEMY.runner.speed).toBeGreaterThan(ENEMY.knight.speed * 1.9)
  })

  it('a leaper vaults a raised wall instead of stopping at it', () => {
    const g = new FoldGame({ seed: 11, learned: ALL, book: 2 })
    g.startRun(2)
    g.update(1 / 60)
    const wallIdx = g.folds.findIndex((f) => f.def.id === 'o2-centre')
    const wall = g.folds[wallIdx]!
    expect(g.foldNow(wallIdx)).toBe(true)
    step(g, 0.3)
    expect(isBarrier(wall)).toBe(true)
    // Park a leaper just above the raised tower, walking straight down lane 0.
    const slot = spawnEnemy(g.enemies, 'leaper', 0, -1.4, 0, 0)
    const e = g.enemies[slot]!
    e.cool = 99
    let leapt = false
    step(g, 4.5, () => {
      if (e.state === 'leap') leapt = true
    })
    expect(leapt).toBe(true)
    expect(e.state).not.toBe('blocked')
    // It landed on the player's side of the wall.
    expect(e.z).toBeGreaterThan(wall.cz)
  })

  it('a knight at the same wall is blocked', () => {
    const g = new FoldGame({ seed: 11, learned: ALL, book: 2 })
    g.startRun(2)
    g.update(1 / 60)
    const wallIdx = g.folds.findIndex((f) => f.def.id === 'o2-centre')
    g.foldNow(wallIdx)
    step(g, 0.3)
    const slot = spawnEnemy(g.enemies, 'knight', 0, -1.4, 0, 0)
    step(g, 3)
    expect(g.enemies[slot]!.state).toBe('blocked')
  })

  it('the sling stone lands where it was aimed and tears up whoever stands there', () => {
    const g = new FoldGame({ seed: 3, learned: ALL, book: 2 })
    g.startRun(1)
    g.update(1 / 60)
    const slot = spawnEnemy(g.enemies, 'knight', -2, -2, 1, 0)
    const e = g.enemies[slot]!
    e.speed = 0
    expect(shootAt(g, e.x, e.z)).toBe(true)
    expect(g.sling!.cool).toBeGreaterThan(0)
    // Reloading: a second shot is refused.
    expect(g.grabSling()).toBe(false)
    step(g, 1.6)
    // (The slot may already hold a fresh recruit from the first wave.)
    expect(g.stats.shotKills).toBe(1)
    // Reloaded.
    expect(g.grabSling()).toBe(true)
  })

  it('a feeble tug does not shoot', () => {
    const g = new FoldGame({ seed: 3, learned: ALL, book: 2 })
    g.startRun(1)
    g.update(1 / 60)
    expect(g.grabSling()).toBe(true)
    g.aimSling(0, 0.1)
    expect(g.releaseSling()).toBe(false)
    expect(g.sling!.cool).toBe(0)
  })

  it('a leaper high in the air is out of the sling\'s reach', () => {
    const g = new FoldGame({ seed: 3, learned: ALL, book: 2 })
    g.startRun(1)
    g.update(1 / 60)
    const slot = spawnEnemy(g.enemies, 'leaper', 0, -1, 0, 0)
    const e = g.enemies[slot]!
    shootAt(g, 0, -1)
    // Throw it high just before the stone lands.
    step(g, 0.2)
    e.state = 'leap'
    e.y = 3
    e.vy = 20
    e.vx = e.vz = 0
    step(g, 0.9)
    expect(g.stats.shotKills).toBe(0)
  })
})

describe('book 2 lessons', () => {
  it('teaches the sling with a ghost hand that pulls the cup back', () => {
    const g = new FoldGame({ seed: 4, learned: { swipe: true, crush: true, ballista: true }, book: 2 })
    g.startRun(1)
    for (let t = 0; t < 30 && g.lesson.id !== 'sling'; t += 1 / 60) {
      g.update(1 / 60)
      g.events.clear()
    }
    expect(g.lesson.id).toBe('sling')
    expect(g.lesson.showHand).toBe(true)
    expect(g.lesson.hand.gesture).toBe('drag')
    // The pull goes toward the player (+z), the shot away from them.
    expect(g.lesson.hand.bz).toBeGreaterThan(g.lesson.hand.az)
    step(g, 4)
    expect(g.timeScale).toBeLessThan(0.05)
    const target = g.enemies[g.lesson.target]!
    expect(shootAt(g, target.x, target.z + 0.3)).toBe(true)
    step(g, 0.2)
    expect(g.learned.sling).toBe(true)
    expect(g.lesson.id).toBe(null)
  })

  it('teaches leapers once the sling is known', () => {
    const g = new FoldGame({ seed: 8, learned: { swipe: true, crush: true, sling: true, stamp: true, ballista: true }, book: 2 })
    g.startRun(2)
    for (let t = 0; t < 40 && g.lesson.id !== 'leaper'; t += 1 / 60) {
      g.update(1 / 60)
      g.events.clear()
    }
    expect(g.lesson.id).toBe('leaper')
    expect(g.enemies[g.lesson.target]!.type).toBe('leaper')
  })
})

describe('book 1 additions', () => {
  it('teaches folding a wall back down onto the knights bashing it', () => {
    const g = new FoldGame({ seed: 5, learned: { swipe: true } })
    g.startRun(1)
    // Raise every wall as soon as it is offered, never stamp.
    let seen = false
    step(g, 60, () => {
      for (let i = 0; i < g.folds.length; i++) if (g.folds[i]!.phase === 'ready' && g.folds[i]!.def.kind === 'wall') g.foldNow(i)
      if (g.lesson.id === 'crush') seen = true
    })
    expect(seen).toBe(true)
  })

  it('the crush lesson is learned by stamping the wall', () => {
    const g = new FoldGame({ seed: 5, learned: { swipe: true } })
    g.startRun(1)
    for (let t = 0; t < 60 && g.lesson.id !== 'crush'; t += 1 / 60) {
      for (let i = 0; i < g.folds.length; i++) if (g.folds[i]!.phase === 'ready' && g.folds[i]!.def.kind === 'wall') g.foldNow(i)
      g.update(1 / 60)
      g.events.clear()
    }
    expect(g.lesson.id).toBe('crush')
    expect(g.lesson.hand.gesture).toBe('tap')
    step(g, 1)
    expect(g.timeScale).toBeLessThan(0.05)
    expect(g.stamp(g.lesson.target)).toBe(true)
    step(g, 0.3)
    expect(g.learned.crush).toBe(true)
    expect(g.stats.crushed).toBeGreaterThanOrEqual(2)
  })

  it('pages 2 and 4 bring catapults that can be flung back', () => {
    for (const id of [2, 4] as const) {
      const def = pageDef(1, id)
      expect(def.folds.some((f) => f.kind === 'launch')).toBe(true)
      expect(def.waves.some((w) => w.spawns.some((s) => s.type === 'catapult'))).toBe(true)
    }
  })

  it('a re-arming launch flap folds back and can fling again', () => {
    const g = new FoldGame({ seed: 5, learned: ALL, book: 2 })
    g.startRun(3)
    g.update(1 / 60)
    const i = g.folds.findIndex((f) => f.def.id === 'm3-launch-l')
    const f = g.folds[i]!
    expect(f.phase).toBe('ready')
    g.foldNow(i)
    step(g, 0.5)
    expect(f.phase).not.toBe('spent')
    step(g, 7)
    expect(f.phase).toBe('ready')
  })

  it('a manned catapult post is not manned twice', () => {
    const g = new FoldGame({ seed: 5, learned: ALL, book: 2 })
    g.startRun(3)
    step(g, 25)
    const cats = g.enemies.filter((e) => e.type === 'catapult' && e.state === 'stand')
    for (let a = 0; a < cats.length; a++) {
      for (let b = a + 1; b < cats.length; b++) {
        expect(Math.hypot(cats[a]!.x - cats[b]!.x, cats[a]!.z - cats[b]!.z)).toBeGreaterThan(0.8)
      }
    }
  })
})

describe('the sling against the dragon (book 2)', () => {
  const awake = (g: FoldGame): void => {
    for (let t = 0; t < 20 && g.boss.phase !== 'idle'; t += 1 / 60) {
      g.update(1 / 60)
      g.events.clear()
    }
  }

  it('three body hits make it flinch and bare a weak point', () => {
    const g = new FoldGame({ seed: 9, learned: ALL, book: 2 })
    g.startRun(5)
    awake(g)
    expect(g.boss.phase).toBe('idle')
    let hits = 0
    for (let n = 0; n < 12 && g.boss.phase !== 'exposed'; n++) {
      // Wait out the reload, keep the dragon from being exposed by its own routine.
      g.boss.attacks = 0
      step(g, 1.5)
      if (g.boss.phase === 'exposed') break
      if (shootAt(g, 0, -3)) {
        step(g, 1)
        hits++
      }
    }
    expect(g.boss.phase).toBe('exposed')
    expect(hits).toBeLessThanOrEqual(3)
  })

  it('a stone mid fire-breath charge makes it choke on it', () => {
    const g = new FoldGame({ seed: 9, learned: ALL, book: 2 })
    g.startRun(5)
    awake(g)
    for (let t = 0; t < 20 && g.boss.phase !== 'breathCharge'; t += 1 / 60) {
      g.update(1 / 60)
      g.events.clear()
    }
    expect(g.boss.phase).toBe('breathCharge')
    g.boss.timer = 5
    expect(shootAt(g, 0, -3)).toBe(true)
    step(g, 1)
    expect(g.boss.phase).not.toBe('breath')
    expect(g.boss.slingHits).toBe(1)
  })
})

describe('book 1 page 4 previews the sling', () => {
  it('teaches it on the last wave, and a drag at the peel corner is still the peel', () => {
    const g = new FoldGame({ seed: 6, learned: { ...ALL, sling: false } })
    g.startRun(4)
    expect(g.sling).not.toBeNull()
    expect(pageDef(1, 4).waves[2]!.lesson).toBe('sling')
    g.phase = 'peel'
    expect(g.pickSling(g.sling!.def.x, g.sling!.def.z)).toBe(false)
  })
})

