import { describe, expect, it } from 'vitest'
import { FoldGame } from '@/fold/logic/game'
import { pageEnemyCount } from '@/fold/logic/pages'
import { ALMOST, CRUMPLE_TIME, DIFFICULTY, HERO_HP, PAGE_DROP_TIME } from '@/fold/logic/config'
import { spawnEnemy } from '@/fold/logic/entities'
import { createKindMemory, type KindMemory } from '@/fold/logic/difficulty'
import { onFootprint } from '@/fold/logic/folds'
import type { FoldEvent, FoldEventType } from '@/fold/logic/events'
import type { PageId } from '@/fold/logic/types'

const ALL_LEARNED = {
  swipe: true, stamp: true, shield: true, launch: true, ridge: true, spread: true, peel: true, crease: true, core: true,
  frog: true, crush: true, sling: true, leaper: true, ballista: true
}

type Seen = Pick<FoldEvent, 'type' | 'a' | 'b' | 'c'>

const step = (g: FoldGame, seconds: number, seen?: Seen[], each?: () => void): void => {
  for (let t = 0; t < seconds; t += 1 / 60) {
    g.update(1 / 60)
    if (seen) {
      for (let i = 0; i < g.events.count; i++) {
        const e = g.events.items[i]!
        seen.push({ type: e.type, a: e.a, b: e.b, c: e.c })
      }
    }
    g.events.clear()
    each?.()
  }
}

const game = (page: PageId, kind?: KindMemory, seed = 11): FoldGame => {
  const g = new FoldGame({ seed, learned: ALL_LEARNED, kind })
  g.startRun(page)
  return g
}

/** Three knights through the gate: the hero goes down. */
const loseHearts = (g: FoldGame, seen?: Seen[]): void => {
  for (let k = 0; k < HERO_HP * 3 && g.phase !== 'crumple'; k++) {
    // (Slow-mo can stretch the invulnerability after a hit: skip it.)
    g.hero.invuln = 0
    spawnEnemy(g.enemies, 'knight', 0, 4.95, 0, 0)
    step(g, 1.3, seen, () => {
      if (g.phase === 'crumple') throw new StopStep()
    })
  }
}
class StopStep extends Error {}
const crumple = (g: FoldGame, seen?: Seen[]): void => {
  try {
    loseHearts(g, seen)
  } catch (e) {
    if (!(e instanceof StopStep)) throw e
  }
  expect(g.phase).toBe('crumple')
}

const types = (seen: Seen[]): FoldEventType[] => seen.map((e) => e.type)

describe('"Almost!" moment on failure (#9)', () => {
  it('counts the enemies still between the player and a clear', () => {
    const g = game(1)
    // Nothing has spawned yet: the whole page is left.
    expect(g.enemiesLeft()).toBe(pageEnemyCount(g.page))
    const seen: Seen[] = []
    step(g, 2.5, seen)
    crumple(g, seen)
    const spawned = types(seen).filter((t) => t === 'spawn').length
    expect(spawned).toBeGreaterThan(0)
    const ev = seen.find((e) => e.type === 'crumple')!
    // The crumple event carries it: alive now + not spawned yet.
    expect(ev.a).toBe(g.aliveCount() + pageEnemyCount(g.page) - spawned)
    expect(ev.a).toBe(g.enemiesLeft())
    expect(ev.b).toBe(1)
    expect(ev.c).toBe(0)
  })

  it('on the dragon\'s page it counts the weak points left instead', () => {
    const g = game(5)
    const seen: Seen[] = []
    crumple(g, seen)
    const ev = seen.find((e) => e.type === 'crumple')!
    expect(ev.c).toBe(1)
    expect(ev.a).toBe(g.boss.weakPoints.length)
  })

  it('a pause-menu restart is not a defeat: no Almost!, fresh page after the crumple', () => {
    const g = game(1)
    step(g, 1)
    const seen: Seen[] = []
    g.forfeitPage()
    step(g, 0.1, seen)
    const ev = seen.find((e) => e.type === 'crumple')!
    expect(ev.b).toBe(0)
    expect(g.canTryAgain()).toBe(false)
    step(g, CRUMPLE_TIME)
    expect(g.phase).toBe('drop')
    expect(g.kind.crumples).toEqual({})
  })

  it('Try again drops the page back as it was, with full hearts, minus the page penalty', () => {
    const g = game(2, undefined, 21)
    step(g, 3)
    const start = g.pageStartScore
    g.score = start + 1000
    crumple(g)
    const scoreAtCrumple = g.score
    const waveAtCrumple = g.waveIndex
    const alive = g.aliveCount()
    // Not while the ball is still being thrown away.
    expect(g.canTryAgain()).toBe(false)
    expect(g.tryAgain()).toBe(false)
    step(g, CRUMPLE_TIME + 0.05)
    expect(g.canTryAgain()).toBe(true)
    const seen: Seen[] = []
    expect(g.tryAgain()).toBe(true)
    step(g, 1 / 60, seen)
    const gathered = scoreAtCrumple - start
    const penalty = Math.round((gathered * ALMOST.penalty) / 5) * 5
    expect(g.score).toBe(scoreAtCrumple - penalty)
    expect(g.score).toBeGreaterThan(start)
    expect(g.hero.hp).toBe(HERO_HP)
    expect(g.phase).toBe('drop')
    expect(types(seen)).not.toContain('pageIntro')
    const drop = seen.find((e) => e.type === 'pageDrop')!
    expect(drop.b).toBe(1)
    expect(drop.c).toBe(penalty)
    // The same page, the same wave, the same soldiers.
    expect(g.pageId).toBe(2)
    expect(g.waveIndex).toBe(waveAtCrumple)
    expect(g.aliveCount()).toBe(alive)
    step(g, PAGE_DROP_TIME + 0.05)
    expect(g.phase).toBe('play')
    expect(g.continuesLeft).toBe(0)
  })

  it('once the continue is spent, Try again drops a fresh page (score back to the page start)', () => {
    const g = game(1)
    step(g, 2)
    const start = g.pageStartScore
    crumple(g)
    step(g, CRUMPLE_TIME + 0.05)
    expect(g.tryAgain()).toBe(true)
    step(g, PAGE_DROP_TIME + 0.05)
    g.score += 300
    g.hero.invuln = 0
    crumple(g)
    step(g, CRUMPLE_TIME + 0.05)
    const seen: Seen[] = []
    expect(g.tryAgain()).toBe(true)
    step(g, 1 / 60, seen)
    expect(types(seen)).toContain('pageIntro')
    expect(g.score).toBe(start)
    expect(g.waveIndex).toBe(0)
    expect(g.continuesLeft).toBe(ALMOST.continues)
    expect(g.kind.crumples.b1p1).toBe(2)
  })

  it('left alone, a fresh page drops by itself after the Almost! moment', () => {
    const g = game(1)
    step(g, 2)
    g.score += 700
    const start = g.pageStartScore
    crumple(g)
    step(g, ALMOST.autoRetry - 0.3)
    expect(g.phase).toBe('crumple')
    step(g, 0.4)
    expect(g.phase).toBe('drop')
    expect(g.score).toBe(start)
    expect(g.hero.hp).toBe(HERO_HP)
    step(g, PAGE_DROP_TIME + 0.05)
    expect(g.phase).toBe('intro')
  })

  it('the Try-again button comes after the ~2 s count, and before the auto retry', () => {
    expect(ALMOST.show).toBeGreaterThanOrEqual(1.5)
    expect(ALMOST.button).toBeGreaterThanOrEqual(CRUMPLE_TIME)
    expect(ALMOST.autoRetry).toBeGreaterThan(ALMOST.button + 2)
  })
})

describe('adaptive difficulty, "the book is kind" (#8)', () => {
  it('a crumple slows the march 10 % for the rest of the page, live marchers included', () => {
    const g = game(1)
    step(g, 2.5)
    const before = g.enemies.filter((e) => e.state === 'march').map((e) => e.speed)
    expect(before.length).toBeGreaterThan(0)
    crumple(g)
    expect(g.difficulty).toBeCloseTo(DIFFICULTY.crumpleSlow)
    expect(g.kind.crumples.b1p1).toBe(1)
    const after = g.enemies.filter((e) => e.state === 'march').map((e) => e.speed)
    for (let i = 0; i < after.length; i++) expect(after[i]).toBeCloseTo(before[i]! * DIFFICULTY.crumpleSlow)
    // A fresh page keeps the slower pace.
    step(g, ALMOST.autoRetry + PAGE_DROP_TIME + 0.1)
    expect(g.difficulty).toBeCloseTo(DIFFICULTY.crumpleSlow)
  })

  it('the scalar multiplies spawn speed and stretches the spawn intervals', () => {
    // (Page 1 would start a new run and forget the crumples: use page 2.)
    const kind = createKindMemory()
    kind.crumples.b1p2 = 1
    const a = game(2, undefined, 5)
    const b = game(2, kind, 5)
    expect(a.difficulty).toBe(1)
    expect(b.difficulty).toBeCloseTo(0.9)
    const firstSpeed = (g: FoldGame): number => g.enemies.find((e) => e.state === 'march')!.speed
    const count = (g: FoldGame): number => g.enemies.filter((e) => e.state !== 'dead').length
    step(a, 1.2)
    step(b, 1.2)
    expect(firstSpeed(b) / firstSpeed(a)).toBeCloseTo(0.9, 5)
    // Over the first wave the kinder page has spawned no more, and at some point fewer.
    let fewer = false
    for (let k = 0; k < 120; k++) {
      step(a, 1 / 60)
      step(b, 1 / 60)
      expect(count(b)).toBeLessThanOrEqual(count(a))
      if (count(b) < count(a)) fewer = true
    }
    expect(fewer).toBe(true)
  })

  /** Real seconds until the first marcher stands on a ready fold, and the lowest time scale seen within `window` s after. */
  const slowmoProbe = (g: FoldGame, window: number): { onFold: number; minScale: number; scaleAfter: number } => {
    const dt = 1 / 60
    let onFold = -1
    let minScale = 1
    for (let t = 0; t < 20; t += dt) {
      g.update(dt)
      g.events.clear()
      if (onFold < 0 && g.enemies.some((e) => e.state === 'march' && g.folds.some((f) => f.phase === 'ready' && onFootprint(f, e.x, e.z, 0)))) {
        onFold = t
      }
      if (onFold >= 0) {
        minScale = Math.min(minScale, g.timeScale)
        if (t - onFold > window) break
      }
    }
    step(g, 1)
    return { onFold, minScale, scaleAfter: g.timeScale }
  }

  it('after a crumple, the next column onto a fold gets ~0.5 s of lesson slow-mo, then time runs again', () => {
    const kind = createKindMemory()
    kind.crumples.b1p2 = 1
    const kinder = slowmoProbe(game(2, kind), DIFFICULTY.foldSlowmo + 0.1)
    expect(kinder.onFold).toBeGreaterThan(0)
    expect(kinder.minScale).toBeLessThan(0.3)
    expect(kinder.scaleAfter).toBeGreaterThan(0.9)
    // Without a crumple on this page: no slow-mo (every lesson learned).
    const plain = slowmoProbe(game(2), DIFFICULTY.foldSlowmo + 0.1)
    expect(plain.minScale).toBeGreaterThan(0.99)
  })

  it('the player\'s fold still snaps in real time while the kind slow-mo holds the world', () => {
    const kind = createKindMemory()
    kind.crumples.b1p2 = 1
    const g = game(2, kind)
    const dt = 1 / 60
    for (let t = 0; t < 20 && g.timeScale > 0.3; t += dt) {
      g.update(dt)
      g.events.clear()
    }
    expect(g.timeScale).toBeLessThan(0.3)
    const i = g.folds.findIndex((f) => f.phase === 'ready')
    expect(g.grab(i)).toBe(true)
    g.drag(i, 1)
    expect(g.release(i, 0)).toBe(true)
    step(g, 0.25)
    expect(['up', 'lowering', 'cooldown']).toContain(g.folds[i]!.phase)
  })

  it('three perfect pages in a row add one enemy per wave', () => {
    const kind = createKindMemory()
    kind.streak = DIFFICULTY.perfectStreak
    const g = game(1, kind)
    expect(g.extraPerWave).toBe(1)
    expect(g.enemiesLeft()).toBe(pageEnemyCount(g.page) + g.page.waves.length)
    expect(game(1).enemiesLeft()).toBe(pageEnemyCount(game(1).page))
  })

  it('a perfect page grows the streak; a crumple breaks it', () => {
    const g = game(1)
    step(g, 1)
    g.debugClearPage()
    step(g, 0.5)
    expect(g.kind.streak).toBe(1)
    const h = game(1)
    h.kind.streak = 2
    step(h, 2)
    crumple(h)
    expect(h.kind.streak).toBe(0)
  })

  it('losing twice before beating the boss page slows the dragon\'s mass units by 20 % from the start', () => {
    const kind = createKindMemory()
    kind.crumples.b1p2 = 1
    kind.crumples.b1p4 = 1
    const eased = game(5, kind, 9)
    const plain = game(5, undefined, 9)
    expect(eased.difficulty).toBeCloseTo(DIFFICULTY.bossEase)
    expect(eased.kind.bossEase).toBe(true)
    expect(plain.difficulty).toBe(1)
    const firstStomp = (g: FoldGame): number => {
      for (let t = 0; t < 30; t += 1 / 60) {
        g.update(1 / 60)
        g.events.clear()
        const e = g.enemies.find((x) => x.state === 'march')
        if (e) return e.speed
      }
      return NaN
    }
    const se = firstStomp(eased)
    const sp = firstStomp(plain)
    expect(Number.isFinite(se) && Number.isFinite(sp)).toBe(true)
    expect(se / sp).toBeCloseTo(DIFFICULTY.bossEase, 5)
  })

  it('a first-try boss win resets the boss ease', () => {
    const kind = createKindMemory()
    kind.bossEase = true
    const g = game(5, kind)
    expect(g.difficulty).toBeCloseTo(DIFFICULTY.bossEase)
    step(g, 1)
    g.debugClearPage()
    step(g, 1)
    expect(g.pageId).toBe(6)
    expect(g.kind.bossEase).toBe(false)
  })

  it('a new run forgets the crumples', () => {
    const kind = createKindMemory()
    kind.crumples.b1p3 = 2
    kind.streak = 1
    const g = new FoldGame({ learned: ALL_LEARNED, kind })
    g.startRun(3)
    expect(g.kind.crumples.b1p3).toBe(2)
    g.startRun(1)
    expect(g.kind.crumples).toEqual({})
    expect(g.kind.streak).toBe(1)
  })
})
