import { describe, expect, it } from 'vitest'
import { FoldGame } from '@/fold/logic/game'
import { PAGES, PAGE_COUNT, isPageId, pageEnemyCount } from '@/fold/logic/pages'
import { ENEMY, HERO_HP } from '@/fold/logic/config'
import { spawnEnemy } from '@/fold/logic/entities'
import type { FoldEventType } from '@/fold/logic/events'

const step = (g: FoldGame, seconds: number, collect?: FoldEventType[]): void => {
  for (let t = 0; t < seconds; t += 1 / 60) {
    g.update(1 / 60)
    if (collect) for (let i = 0; i < g.events.count; i++) collect.push(g.events.items[i]!.type)
    g.events.clear()
  }
}

const ALL_LEARNED = { swipe: true, stamp: true, shield: true, launch: true, ridge: true, spread: true, peel: true, crease: true, core: true, frog: true, crush: true, sling: true, leaper: true, ballista: true }

describe('page data', () => {
  it('has six pages with valid exits and at least one fold each', () => {
    expect(PAGE_COUNT).toBe(6)
    for (let id = 1; id <= 6; id++) {
      expect(isPageId(id)).toBe(true)
      const p = PAGES[id as 1]
      expect(p.id).toBe(id)
      expect(p.folds.length).toBeGreaterThan(0)
      for (const f of p.folds) {
        expect(Number.isFinite(f.ax + f.az + f.bx + f.bz + f.depth)).toBe(true)
        expect(Math.hypot(f.sx, f.sz)).toBeCloseTo(1)
      }
    }
    expect(PAGES[4].exit).toBe('peel')
    expect(PAGES[5].exit).toBe('boss')
    expect(PAGES[6].exit).toBe('finale')
    expect(pageEnemyCount(PAGES[1])).toBeGreaterThan(10)
  })

  it('every lane stays on the page', () => {
    for (let id = 1; id <= 6; id++) {
      for (const l of PAGES[id as 1].lanes) {
        for (let i = 0; i < l.points.length; i += 2) expect(Math.abs(l.points[i]!)).toBeLessThan(5)
      }
    }
  })
})

describe('FoldGame mechanics', () => {
  it('a wall snapping under knights launches them toward the lens and scores', () => {
    const g = new FoldGame({ learned: ALL_LEARNED })
    g.startRun(1)
    step(g, 1)
    const f = g.folds[0]!
    for (let k = 0; k < 3; k++) spawnEnemy(g.enemies, 'knight', -0.5 + k * 0.5, f.cz - 1, 0, 0)
    const events: FoldEventType[] = []
    g.foldNow(0)
    step(g, 0.3, events)
    expect(events).toContain('foldSnap')
    expect(events.filter((e) => e === 'kill').length).toBe(3)
    expect(g.stats.launched).toBe(3)
    // Multi-kill bonus: three knights score more than 3 × base.
    expect(g.score).toBeGreaterThan(3 * ENEMY.knight.score)
    step(g, 1.2, events)
    expect(events).toContain('lensHit')
  })

  it('brutes are too heavy to launch: they get blocked, and a stamp crushes them with hit-stop', () => {
    const g = new FoldGame({ learned: ALL_LEARNED })
    g.startRun(1)
    step(g, 1)
    const f = g.folds[0]!
    const slot = spawnEnemy(g.enemies, 'brute', 0, f.cz - 1, 0, 0)
    g.foldNow(0)
    step(g, 0.3)
    expect(g.enemies[slot]!.state).toBe('blocked')
    const events: FoldEventType[] = []
    g.stamp(0)
    step(g, 0.2, events)
    expect(events).toContain('foldStamp')
    expect(g.enemies[slot]!.state === 'crushed' || g.enemies[slot]!.state === 'dead').toBe(true)
    expect(g.stats.crushed).toBe(1)
  })

  it('a tap on a raised wall stamps it (the input API picks it from a page point)', () => {
    const g = new FoldGame({ learned: ALL_LEARNED })
    g.startRun(1)
    step(g, 1)
    g.foldNow(0)
    step(g, 0.3)
    const f = g.folds[0]!
    expect(g.tap(f.cx, f.cz - 0.5)).toBe(true)
    expect(f.phase).toBe('stamping')
  })

  it('knights stop at a raised wall and bash it', () => {
    const g = new FoldGame({ learned: ALL_LEARNED })
    g.startRun(1)
    step(g, 1)
    g.foldNow(0)
    step(g, 0.3)
    const f = g.folds[0]!
    const slot = spawnEnemy(g.enemies, 'knight', 0, f.cz - f.def.depth - 1, 0, 0)
    g.enemies[slot]!.lane = 0
    step(g, 4.5)
    expect(g.enemies[slot]!.state).toBe('blocked')
    expect(f.hp).toBeLessThan(f.def.hp)
  })

  it('a valley traps whoever is in the strip', () => {
    const g = new FoldGame({ learned: ALL_LEARNED })
    g.startRun(2)
    step(g, 1)
    const v = g.folds.find((f) => f.def.kind === 'valley')!
    const slot = spawnEnemy(g.enemies, 'knight', 0, v.cz + 0.3, 0, 0)
    g.foldNow(g.folds.indexOf(v))
    step(g, 0.4)
    expect(g.enemies[slot]!.state).toBe('trapped')
    g.stamp(g.folds.indexOf(v))
    step(g, 0.3)
    expect(['crushed', 'dead']).toContain(g.enemies[slot]!.state)
  })

  it('enemies that reach the player line cost a heart; three hits crumple the page', () => {
    const g = new FoldGame({ learned: ALL_LEARNED })
    g.startRun(1)
    step(g, 1)
    const events: FoldEventType[] = []
    for (let k = 0; k < 3; k++) {
      spawnEnemy(g.enemies, 'knight', 0, 4.9, 0, 0)
      step(g, 1.3, events)
    }
    expect(events.filter((e) => e === 'heroHit').length).toBe(HERO_HP)
    expect(events).toContain('crumple')
    step(g, 3, events)
    expect(g.hero.hp).toBe(HERO_HP)
    expect(g.pageId).toBe(1)
  })

  it('a shield in the arrow path catches it', () => {
    const g = new FoldGame({ learned: ALL_LEARNED })
    g.startRun(3)
    step(g, 0.8)
    const shield = g.folds.findIndex((f) => f.def.structure === 'shield')
    const events: FoldEventType[] = []
    // Raise the shield the moment the first arrow leaves the bow.
    for (let t = 0; t < 10 && !events.includes('shoot'); t += 1 / 60) {
      g.update(1 / 60)
      for (let i = 0; i < g.events.count; i++) events.push(g.events.items[i]!.type)
      g.events.clear()
    }
    expect(events).toContain('shoot')
    g.foldNow(shield)
    step(g, 2.5, events)
    expect(events).toContain('blocked')
    expect(g.hero.hp).toBe(HERO_HP)
  })

  it('flinging a catapult crushes the archers it lands on', () => {
    const g = new FoldGame({ learned: ALL_LEARNED })
    g.startRun(3)
    step(g, 0.8)
    const archersBefore = g.enemies.filter((e) => e.type === 'archer' && e.state === 'stand').length
    const launch = g.folds.findIndex((f) => f.def.kind === 'launch')
    g.foldNow(launch)
    step(g, 2)
    const archersAfter = g.enemies.filter((e) => e.type === 'archer' && e.state === 'stand').length
    expect(archersBefore).toBe(4)
    expect(archersAfter).toBeLessThanOrEqual(2)
    expect(g.stats.flung).toBeGreaterThanOrEqual(1)
  })

  it('tears only become pullable once the wave starts, and the drawbridge needs the gate first', () => {
    const g = new FoldGame({ learned: ALL_LEARNED })
    g.startRun(4)
    step(g, 0.2)
    expect(g.tears.every((t) => !t.active)).toBe(true)
    step(g, 1.5)
    const gate = g.tears.findIndex((t) => t.def.id === 'p4-gate')
    const bridge = g.tears.findIndex((t) => t.def.id === 'p4-bridge')
    expect(g.tears[gate]!.active).toBe(true)
    expect(g.tears[bridge]!.active).toBe(false)
    g.pullTear(gate, 0.5)
    expect(g.tears[gate]!.torn).toBe(false)
    g.pullTear(gate, 1)
    expect(g.tears[gate]!.torn).toBe(true)
    step(g, 0.1)
    expect(g.tears[bridge]!.active).toBe(true)
  })

  it('the peel page waits for the corner to be dragged past the threshold', () => {
    const g = new FoldGame({ learned: ALL_LEARNED })
    g.startRun(4)
    step(g, 1)
    g.debugClearPage()
    step(g, 1.2)
    expect(g.phase).toBe('peel')
    expect(g.pickPeel(4, 6)).toBe(true)
    g.peelDrag(0.3)
    g.peelRelease()
    step(g, 1)
    expect(g.phase).toBe('peel')
    g.peelDrag(0.7)
    g.peelRelease()
    step(g, 1)
    expect(g.pageId).toBe(5)
  })

  it('hit-stop freezes the whole simulation for 0.1 s', () => {
    const g = new FoldGame({ learned: ALL_LEARNED })
    g.startRun(1)
    step(g, 1)
    const slot = spawnEnemy(g.enemies, 'knight', 0, -4, 0, 0)
    g.hitStop = 0.1
    const z0 = g.enemies[slot]!.z
    step(g, 0.08)
    expect(g.enemies[slot]!.z).toBe(z0)
    step(g, 0.2)
    expect(g.enemies[slot]!.z).toBeGreaterThan(z0)
  })

  it('pausing stops everything', () => {
    const g = new FoldGame({ learned: ALL_LEARNED })
    g.startRun(1)
    step(g, 2)
    g.paused = true
    const t = g.runTime
    step(g, 2)
    expect(g.runTime).toBe(t)
    expect(g.acceptsInput()).toBe(false)
  })

  it('restarting a page returns the score to the page start', () => {
    const g = new FoldGame({ learned: ALL_LEARNED })
    g.startRun(2, 1000)
    step(g, 1)
    g.score += 500
    g.forfeitPage()
    step(g, 2.5)
    expect(g.score).toBe(1000)
    expect(g.pageId).toBe(2)
  })

  it('combos build across quick kills', () => {
    const g = new FoldGame({ learned: ALL_LEARNED })
    g.startRun(1)
    step(g, 1)
    const f = g.folds[0]!
    for (let k = 0; k < 4; k++) spawnEnemy(g.enemies, 'knight', -0.6 + k * 0.4, f.cz - 1, 0, 0)
    const events: FoldEventType[] = []
    g.foldNow(0)
    step(g, 0.3, events)
    expect(g.combo).toBeGreaterThanOrEqual(3)
    expect(events).toContain('combo')
  })
})

describe('the dragon', () => {
  it('transforms from the castle through rumble → unfold → roar before attacking', () => {
    const g = new FoldGame({ learned: ALL_LEARNED })
    g.startRun(5)
    const seen: string[] = []
    for (let t = 0; t < 12; t += 1 / 60) {
      g.update(1 / 60)
      g.events.clear()
      if (seen[seen.length - 1] !== g.boss.phase) seen.push(g.boss.phase)
    }
    expect(seen.slice(0, 5)).toEqual(['dormant', 'rumble', 'unfold', 'roar', 'idle'])
  })

  it('an unblocked breath costs a heart; a raised shield blocks it', () => {
    const g = new FoldGame({ learned: ALL_LEARNED })
    g.startRun(5)
    for (let t = 0; t < 30 && g.boss.phase !== 'breathCharge'; t += 1 / 60) { g.update(1 / 60); g.events.clear() }
    expect(g.boss.phase).toBe('breathCharge')
    const shield = g.folds.findIndex((f) => f.def.structure === 'shield')
    g.foldNow(shield)
    const events: FoldEventType[] = []
    step(g, 3.5, events)
    expect(events).toContain('bossBreath')
    expect(events).toContain('blocked')
    expect(g.hero.hp).toBe(HERO_HP)
  })

  it('a creased leg or a spread wing breaks the exposed weak point', () => {
    const g = new FoldGame({ learned: ALL_LEARNED })
    g.startRun(5)
    for (let t = 0; t < 60 && g.boss.phase !== 'exposed'; t += 1 / 60) { g.update(1 / 60); g.events.clear() }
    expect(g.boss.phase).toBe('exposed')
    const w = g.boss.weakPoints[g.boss.exposed]!
    expect(w.mode).toBe('crease')
    expect(g.pickCrease(w.x, w.z)).toBe(g.boss.exposed)
    g.pullWeak(0.9)
    g.releaseWeak()
    expect(w.broken).toBe(true)
    expect(g.boss.phase).toBe('hurt')
  })
})
