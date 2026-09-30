import { describe, expect, it } from 'vitest'
import { FoldGame } from '@/fold/logic/game'
import { GestureRecognizer, HOLD_FOLD_MS, HOLD_MS, type PagePoint } from '@/fold/input/gestures'
import { spawnEnemy } from '@/fold/logic/entities'
import { HIT_STOP, SLOW_MODE_SCALE } from '@/fold/logic/config'
import { BOOKS } from '@/fold/logic/pages'
import { flapPoint } from '@/fold/logic/folds'
import type { BookId, FoldKind, FoldState, LessonId, PageId } from '@/fold/logic/types'
import { highlightUniforms } from '@/fold/render/compositeShader'
import { HIGHLIGHT_MODES } from '@/fold/logic/types'

// Roadmap #14: hold to fold, slow mode, highlight modes.

const PX = 40
const toScreen = (x: number, z: number): [number, number] => [200 + x * PX, 300 + z * PX]
const host = {
  project: (sx: number, sy: number, out: PagePoint) => {
    out.x = (sx - 200) / PX
    out.z = (sy - 300) / PX
    return true
  },
  minDim: () => 400
}

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

const setup = (page: PageId = 1, book: BookId = 1, hold = true) => {
  const g = new FoldGame({ learned: ALL, book })
  g.startRun(page, 0, book)
  step(g, 1.5)
  const r = new GestureRecognizer(g, host)
  r.holdToFold = hold
  return { g, r }
}

/** Press still at (sx, sy) from t0 for `ms`, driving `frame` on a 16 ms clock; returns the release time. */
const hold = (r: GestureRecognizer, sx: number, sy: number, ms: number, t0 = 0, lift = true): number => {
  r.down(1, sx, sy, t0)
  let t = t0
  while (t < t0 + ms) {
    t += 16
    r.frame(t)
  }
  if (lift) r.up(1, sx, sy, t)
  return t
}

const FULL = HOLD_MS + HOLD_FOLD_MS + 80

/** A page point on the fold's flap (or its centre line, for valleys and ridges). */
const onFlap = (f: FoldState): [number, number] => {
  const k = f.def.kind
  const out = { x: 0, z: 0 }
  flapPoint(f, f.len / 2, k === 'valley' || k === 'ridge' ? 0 : f.def.depth * 0.5, out)
  return toScreen(out.x, out.z)
}

describe('hold to fold (roadmap #14)', () => {
  it('is off by default: a long still press on a fold does nothing', () => {
    const { g, r } = setup(1, 1, false)
    const f = g.folds[0]!
    expect(f.phase).toBe('ready')
    hold(r, ...onFlap(f), FULL)
    expect(f.phase).toBe('ready')
  })

  it('a press held on a wall folds it progressively, then snaps it', () => {
    const { g, r } = setup()
    const f = g.folds[0]!
    const [x, y] = onFlap(f)
    const t = hold(r, x, y, HOLD_MS + HOLD_FOLD_MS * 0.4, 0, false)
    expect(r.holding).toBe(true)
    expect(f.phase).toBe('dragging')
    expect(f.drag).toBeGreaterThan(0.2)
    expect(f.drag).toBeLessThan(0.7)
    let now = t
    while (now < t + HOLD_FOLD_MS) {
      now += 16
      r.frame(now)
    }
    expect(['snapping', 'up']).toContain(f.phase)
    r.up(1, x, y, now)
    expect(['snapping', 'up']).toContain(f.phase)
  })

  it('works for every fold kind a swipe folds, in both books', () => {
    const kinds = new Set<FoldKind>()
    for (const book of [1, 2] as BookId[]) {
      for (const def of Object.values(BOOKS[book])) {
        for (let i = 0; i < def.folds.length; i++) {
          const { g, r } = setup(def.id, book)
          // Only this fold is on offer, so the press can only mean it.
          for (let j = 0; j < g.folds.length; j++) g.folds[j]!.phase = j === i ? 'ready' : 'hidden'
          g.tears.forEach((t) => (t.active = false))
          if (g.sling) g.sling.cool = 99
          const f = g.folds[i]!
          hold(r, ...onFlap(f), FULL)
          expect(['snapping', 'up'], `${book}/${def.id} ${f.def.id} (${f.def.kind})`).toContain(f.phase)
          kinds.add(f.def.kind)
        }
      }
    }
    expect([...kinds].sort()).toEqual(['ballista', 'frog', 'launch', 'ridge', 'valley', 'wall'])
  })

  it('lifting early lets go exactly like ending a swipe there (springs back)', () => {
    const { g, r } = setup()
    const f = g.folds[0]!
    hold(r, ...onFlap(f), HOLD_MS + HOLD_FOLD_MS * 0.2)
    expect(f.phase).toBe('ready')
  })

  it('a slow tap on a raised wall still stamps', () => {
    const { g, r } = setup()
    g.foldNow(0)
    step(g, 0.5)
    const f = g.folds[0]!
    expect(f.phase).toBe('up')
    const [x, y] = toScreen(f.cx, f.cz - 0.4)
    hold(r, x, y, 380)
    expect(f.phase).toBe('stamping')
  })

  it('swipes keep working with hold to fold on', () => {
    const { g, r } = setup()
    const f = g.folds[0]!
    const [x, y] = toScreen(f.cx, f.cz - 0.2)
    r.down(1, x, y, 0)
    for (let i = 1; i <= 10; i++) {
      r.move(1, x, y - i * 8, i * 16)
      r.frame(i * 16)
    }
    r.up(1, x, y - 80, 200)
    expect(['snapping', 'up']).toContain(f.phase)
  })

  it('a hold on a glowing crease tears it (the spread, one finger and no movement)', () => {
    const { g, r } = setup(4)
    const t = g.tears.find((o) => o.def.id === 'p4-tower-l')!
    expect(t.active).toBe(true)
    hold(r, ...toScreen(t.px, t.pz), FULL)
    expect(t.torn).toBe(true)
  })

  it('a hold on the boss crease breaks the weak point', () => {
    const g = new FoldGame({ learned: ALL })
    g.startRun(5)
    for (let t = 0; t < 60 && g.boss.phase !== 'exposed'; t += 1 / 60) step(g, 1 / 60)
    expect(g.boss.phase).toBe('exposed')
    const w = g.boss.weakPoints[g.boss.exposed]!
    expect(w.mode).toBe('crease')
    const r = new GestureRecognizer(g, host)
    r.holdToFold = true
    hold(r, ...toScreen(w.x, w.z), FULL)
    expect(w.broken).toBe(true)
  })

  it('a hold on the dog-eared corner peels the page', () => {
    const g = new FoldGame({ learned: ALL })
    g.startRun(4)
    step(g, 1)
    g.debugClearPage()
    step(g, 1.2)
    expect(g.phase).toBe('peel')
    const r = new GestureRecognizer(g, host)
    r.holdToFold = true
    hold(r, ...toScreen(4, 6), FULL)
    step(g, 1)
    expect(g.pageId).toBe(5)
  })

  it('a tap shoots the loaded sling where the stone should land (only with hold to fold)', () => {
    const off = setup(1, 2, false)
    off.r.down(1, ...toScreen(-2, -2), 0)
    off.r.up(1, ...toScreen(-2, -2), 60)
    expect(off.g.sling!.shots).toBe(0)

    const { g, r } = setup(1, 2)
    const slot = spawnEnemy(g.enemies, 'knight', -2, -2, 1, 0)
    g.enemies[slot]!.speed = 0
    r.down(1, ...toScreen(-2, -2), 0)
    r.up(1, ...toScreen(-2, -2), 60)
    expect(g.sling!.shots).toBe(1)
    expect(g.sling!.tx).toBeCloseTo(-2, 1)
    expect(g.sling!.tz).toBeCloseTo(-2, 1)
    step(g, 1.6)
    expect(g.stats.shotKills).toBe(1)
  })

  it('the hold runs on the real clock: a frozen world does not slow the fold', () => {
    const { g, r } = setup()
    g.worldScale = SLOW_MODE_SCALE
    g.timeScale = 0
    const f = g.folds[0]!
    hold(r, ...onFlap(f), FULL)
    expect(['snapping', 'up']).toContain(f.phase)
  })

  it('cancel lets go of a hold', () => {
    const { g, r } = setup()
    const f = g.folds[0]!
    hold(r, ...onFlap(f), HOLD_MS + 100, 0, false)
    expect(f.phase).toBe('dragging')
    r.cancel()
    expect(f.phase).toBe('ready')
    expect(r.holding).toBe(false)
  })
})

describe('slow mode (roadmap #14)', () => {
  const march = (slow: boolean, difficulty = 1): number => {
    const g = new FoldGame({ learned: ALL, seed: 7 })
    g.startRun(1)
    step(g, 0.2)
    if (slow) g.worldScale = SLOW_MODE_SCALE
    const slot = spawnEnemy(g.enemies, 'knight', 0, -6, 1, 0)
    const e = g.enemies[slot]!
    e.speed *= difficulty
    const z0 = e.z
    step(g, 1)
    return e.z - z0
  }

  it('the world marches at 0.75×', () => {
    const normal = march(false)
    const slow = march(true)
    expect(normal).toBeGreaterThan(0)
    expect(slow / normal).toBeCloseTo(SLOW_MODE_SCALE, 2)
  })

  it('multiplies with the kind book’s pacing', () => {
    expect(march(true, 1.2) / march(false)).toBeCloseTo(SLOW_MODE_SCALE * 1.2, 2)
  })

  it('multiplies with lesson slow-mo (the combined clock is the product)', () => {
    const g = new FoldGame({ learned: ALL, seed: 7 })
    g.startRun(1)
    step(g, 0.2)
    g.worldScale = SLOW_MODE_SCALE
    const slot = spawnEnemy(g.enemies, 'knight', 0, -6, 1, 0)
    const e = g.enemies[slot]!
    const ref = new FoldGame({ learned: ALL, seed: 7 })
    ref.startRun(1)
    step(ref, 0.2)
    const rs = spawnEnemy(ref.enemies, 'knight', 0, -6, 1, 0)
    const re = ref.enemies[rs]!
    // One frame each at a lesson's crawl (the target is 1 here, so the damp
    // barely moves timeScale within a single 1/60 s frame).
    g.timeScale = 0.14
    ref.timeScale = 0.14
    const z0 = e.z
    const r0 = re.z
    g.update(1 / 60)
    ref.update(1 / 60)
    expect((e.z - z0) / (re.z - r0)).toBeCloseTo(SLOW_MODE_SCALE, 2)
  })

  it('hit-stop stays a real-time freeze: nothing moves, and it lasts as long as without slow mode', () => {
    const frozenFrames = (slow: boolean): number => {
      const g = new FoldGame({ learned: ALL, seed: 7 })
      g.startRun(1)
      step(g, 0.2)
      if (slow) g.worldScale = SLOW_MODE_SCALE
      const slot = spawnEnemy(g.enemies, 'knight', 0, -6, 1, 0)
      const e = g.enemies[slot]!
      g.hitStop = HIT_STOP
      const z0 = e.z
      let n = 0
      while (e.z === z0 && n < 120) {
        g.update(1 / 60)
        n++
      }
      return n
    }
    const slow = frozenFrames(true)
    expect(slow).toBeGreaterThanOrEqual(Math.floor(HIT_STOP * 60))
    expect(slow).toBe(frozenFrames(false))
  })

  it('the player’s fold snaps in the same real time', () => {
    const snapFrames = (slow: boolean): number => {
      const g = new FoldGame({ learned: ALL })
      g.startRun(1)
      step(g, 1.5)
      if (slow) g.worldScale = SLOW_MODE_SCALE
      g.grab(0)
      g.drag(0, 0.9)
      g.release(0, 0)
      let n = 0
      while (g.folds[0]!.phase === 'snapping' && n < 600) {
        g.update(1 / 60)
        n++
      }
      return n
    }
    expect(snapFrames(true)).toBe(snapFrames(false))
  })
})

describe('highlight modes (roadmap #14)', () => {
  it('standard pulses, steady holds still, bold adds the ink-edged halo', () => {
    expect(HIGHLIGHT_MODES).toEqual(['standard', 'steady', 'bold'])
    expect(highlightUniforms('standard')).toEqual({ steady: 0, band: 0 })
    expect(highlightUniforms('steady')).toEqual({ steady: 1, band: 0 })
    const bold = highlightUniforms('bold')
    expect(bold.steady).toBe(1)
    expect(bold.band).toBeGreaterThan(0)
  })
})
