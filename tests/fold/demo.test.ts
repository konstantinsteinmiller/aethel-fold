import { describe, expect, it } from 'vitest'
import { FoldGame } from '@/fold/logic/game'
import {
  DEMO_FADE, DEMO_HOLD_FOLD, DEMO_HOLD_WAIT, DEMO_PERIOD, HOLD_DEMO_LESSONS, cancelDemo, createLessonState, sampleDemo,
  startDemo, stepDemo
} from '@/fold/logic/lessons'
import type { LessonId, PageId } from '@/fold/logic/types'

const DT = 1 / 60

const step = (g: FoldGame, s: number, each?: () => void): void => {
  for (let t = 0; t < s; t += DT) {
    each?.()
    g.update(DT)
    g.events.clear()
  }
}

const until = (g: FoldGame, s: number, cond: () => boolean): boolean => {
  for (let t = 0; t < s; t += DT) {
    if (cond()) return true
    g.update(DT)
    g.events.clear()
  }
  return cond()
}

const toLesson = (g: FoldGame, id: LessonId, page: PageId = 1, s = 40): void => {
  g.startRun(page)
  expect(until(g, s, () => g.lesson.id === id), `no ${id} lesson`).toBe(true)
}

/** Everything the demo must never touch, as a comparable snapshot. */
const world = (g: FoldGame) => ({
  enemies: g.enemies.map((e) => [e.state, e.type, e.x.toFixed(5), e.z.toFixed(5)].join()),
  folds: g.folds.map((f) => [f.phase, f.t.toFixed(5), f.drag].join()),
  tears: g.tears.map((t) => [t.t, t.torn].join()),
  stats: { ...g.stats },
  score: g.score,
  hp: g.hero.hp,
  timeScale: g.timeScale.toFixed(6),
  lesson: [g.lesson.id, g.lesson.step, g.lesson.target, g.lesson.timeScale].join()
})

describe('lesson demonstration choreography (pure)', () => {
  it('swipe: the ghost fold rises with the hand, in lockstep, then fades and loops', () => {
    const l = createLessonState()
    l.id = 'swipe'
    startDemo(l, 'swipe', 'fold', 2, false)
    expect(l.demo.phase).toBe('show')
    expect(l.demo.fold).toBe(0)
    let peak = 0
    for (let t = 0; t < DEMO_PERIOD.swipe - DT; t += DT) {
      stepDemo(l, DT)
      expect(l.demo.fold).toBe(l.demo.hand)
      peak = Math.max(peak, l.demo.fold)
      if (l.demo.clock > 0.3 && l.demo.clock < 1.3) expect(l.demo.alpha).toBe(1)
    }
    expect(peak).toBe(1)
    stepDemo(l, 2 * DT)
    // Next loop: back at the start, still showing (it loops until the player acts).
    expect(l.demo.loops).toBe(1)
    expect(l.demo.phase).toBe('show')
    expect(l.demo.fold).toBeLessThan(0.05)
    for (let t = 0; t < DEMO_PERIOD.swipe * 5; t += DT) stepDemo(l, DT)
    expect(l.demo.phase).toBe('show')
  })

  it('swipeTap: up with the hand, glide to the flap, press — and the ghost slams shut', () => {
    const l = createLessonState()
    startDemo(l, 'swipeTap', 'fold', 0, false, 1, 2)
    const d = l.demo
    d.clock = 1.35
    sampleDemo(d)
    expect(d.fold).toBe(1)
    expect(d.press).toBe(0)
    d.clock = 2.0
    sampleDemo(d)
    expect(d.glide).toBe(1)
    expect(d.fold).toBe(1)
    d.clock = 2.35
    sampleDemo(d)
    expect(d.press).toBe(1)
    expect(d.fold).toBe(0)
  })

  it('tap: the raised ghost is closed by the press', () => {
    const l = createLessonState()
    startDemo(l, 'tap', 'fold', 0, false)
    expect(l.demo.fold).toBe(1)
    l.demo.clock = 0.65
    sampleDemo(l.demo)
    expect(l.demo.press).toBe(1)
    expect(l.demo.fold).toBe(0)
  })

  it('pull: held at full draw, then let go and it springs home', () => {
    const l = createLessonState()
    startDemo(l, 'pull', 'sling', -1, false)
    l.demo.clock = 1.45
    sampleDemo(l.demo)
    expect(l.demo.fold).toBe(1)
    l.demo.clock = 1.8
    sampleDemo(l.demo)
    expect(l.demo.fold).toBe(0)
    expect(l.demo.hand).toBe(1)
  })

  it('cancel fades out in DEMO_FADE and ends; reduced motion stops after one loop', () => {
    const l = createLessonState()
    startDemo(l, 'swipe', 'fold', 0, false)
    stepDemo(l, 0.5)
    expect(cancelDemo(l)).toBe(true)
    expect(l.demo.phase).toBe('fade')
    expect(cancelDemo(l)).toBe(false)
    const hand = l.demo.hand
    stepDemo(l, DEMO_FADE / 2)
    expect(l.demo.hand).toBe(hand)
    stepDemo(l, DEMO_FADE)
    expect(l.demo.phase).toBe('off')

    startDemo(l, 'swipe', 'fold', 0, true)
    let ended = false
    for (let t = 0; t < DEMO_PERIOD.swipe * 3 && !ended; t += DT) ended = stepDemo(l, DT)
    expect(ended).toBe(true)
    expect(l.demo.phase).toBe('off')
  })
})

describe('lesson demonstrations in the game', () => {
  it('the first swipe lesson demonstrates the centre fold with a ghost', () => {
    const g = new FoldGame({ seed: 1 })
    toLesson(g, 'swipe')
    const d = g.lesson.demo
    expect(d.phase).toBe('show')
    expect(d.kind).toBe('swipe')
    expect(d.on).toBe('fold')
    expect(d.target).toBe(g.lesson.target)
    step(g, 1)
    expect(d.fold).toBeGreaterThan(0)
    // The hand is still the lesson's swipe cue, now posed by the demo.
    expect(g.lesson.showHand).toBe(true)
    expect(g.lesson.hand.gesture).toBe('swipe')
    // It keeps demonstrating until the player acts.
    step(g, DEMO_PERIOD.swipe * 3)
    expect(g.lesson.id).toBe('swipe')
    expect(d.phase).toBe('show')
    expect(d.loops).toBeGreaterThanOrEqual(3)
  })

  it('never changes gameplay: the same seed runs identically with and without demos', () => {
    const a = new FoldGame({ seed: 3 })
    const b = new FoldGame({ seed: 3, demos: false })
    a.startRun(1)
    b.startRun(1)
    let snaps = 0
    for (let t = 0; t < 20; t += DT) {
      a.update(DT)
      b.update(DT)
      for (let i = 0; i < a.events.count; i++) {
        const ty = a.events.items[i]!.type
        if (ty === 'foldSnap' || ty === 'foldStamp') snaps++
      }
      a.events.clear()
      b.events.clear()
      expect(world(a)).toEqual(world(b))
    }
    expect(a.lesson.id).toBe('swipe')
    expect(a.lesson.demo.phase).toBe('show')
    expect(b.lesson.demo.phase).toBe('off')
    // The ghost folded dozens of times; the real flap never moved, nobody was crushed.
    expect(snaps).toBe(0)
    expect(a.folds[a.lesson.target]!.phase).toBe('ready')
    expect(a.folds[a.lesson.target]!.t).toBe(0)
  })

  it('a grab cancels the demo at once and the real fold follows the finger at full speed', () => {
    const a = new FoldGame({ seed: 1 })
    const b = new FoldGame({ seed: 1, demos: false })
    toLesson(a, 'swipe')
    toLesson(b, 'swipe')
    step(a, 0.7)
    step(b, 0.7)
    const i = a.lesson.target
    expect(a.lesson.demo.phase).toBe('show')
    expect(a.grab(i)).toBe(true)
    expect(b.grab(i)).toBe(true)
    expect(a.lesson.demo.phase).toBe('fade')
    for (let k = 1; k <= 16; k++) {
      a.drag(i, k / 16)
      b.drag(i, k / 16)
      a.update(DT)
      b.update(DT)
      a.events.clear()
      b.events.clear()
      expect(a.folds[i]!.t).toBe(b.folds[i]!.t)
      expect(a.folds[i]!.drag).toBe(k / 16)
    }
    expect(a.lesson.demo.phase).toBe('off')
    expect(a.release(i, 0)).toBe(true)
    step(a, 0.5)
    expect(a.learned.swipe).toBe(true)
  })

  it('once seen through, the lesson shows just the hand (this session) — and never demos once learned', () => {
    const g = new FoldGame({ seed: 1 })
    toLesson(g, 'swipe')
    const i = g.lesson.target
    g.grab(i)
    g.drag(i, 0.2)
    g.abandon(i)
    step(g, 0.5)
    // Lesson still running (not learned yet), but no second demonstration.
    expect(g.lesson.id).toBe('swipe')
    expect(g.lesson.demo.phase).toBe('off')
    step(g, DEMO_PERIOD.swipe * 2)
    expect(g.lesson.demo.phase).toBe('off')
    expect(g.lesson.showHand).toBe(true)
    // Restarting the same lesson this session: hand only.
    ;(g as unknown as { startLesson(id: LessonId, t: number): void }).startLesson('swipe', i)
    expect(g.lesson.demo.phase).toBe('off')

    // A returning player (learned is what persists) never sees it: idle hints carry no demo.
    const r = new FoldGame({ seed: 1, learned: { swipe: true } })
    r.startRun(1)
    step(r, 30, () => {
      expect(r.lesson.demo.phase).toBe('off')
    })
  })

  it('a lesson that passes by itself replays its demo next time (it was never seen through)', () => {
    const g = new FoldGame({ seed: 1 })
    toLesson(g, 'swipe')
    const i = g.lesson.target
    const inner = g as unknown as { abortLesson(): void; startLesson(id: LessonId, t: number): void }
    inner.abortLesson()
    expect(g.lesson.demo.phase).toBe('off')
    inner.startLesson('swipe', i)
    expect(g.lesson.demo.phase).toBe('show')
  })

  it('reduced motion: one demonstration, then the plain hand with the usual freeze', () => {
    const g = new FoldGame({ seed: 1 })
    g.reducedMotion = true
    toLesson(g, 'swipe')
    expect(g.lesson.demo.phase).toBe('show')
    step(g, DEMO_PERIOD.swipe + 0.1)
    expect(g.lesson.demo.phase).toBe('off')
    expect(g.lesson.id).toBe('swipe')
    expect(g.lesson.showHand).toBe(true)
    step(g, 4)
    expect(g.timeScale).toBeLessThan(0.05)
  })

  it('stamp: the demo swipes the ravine shut and taps it; after the snap the tap step is demonstrated', () => {
    const g = new FoldGame({ seed: 2, learned: { swipe: true } })
    toLesson(g, 'stamp', 2, 60)
    const d = g.lesson.demo
    expect(d.kind).toBe('swipeTap')
    expect(d.on).toBe('fold')
    const f = g.folds[g.lesson.target]!
    expect(d.tx).toBe(f.cx)
    expect(d.tz).toBe(f.cz)
    // The player folds it.
    expect(g.foldNow(g.lesson.target)).toBe(true)
    expect(until(g, 2, () => g.lesson.step === 1)).toBe(true)
    expect(d.phase).toBe('show')
    expect(d.kind).toBe('tap')
    expect(d.fold).toBe(1)
    const crushedBefore = g.stats.crushed
    step(g, DEMO_PERIOD.tap * 2)
    // Ghost taps don't stamp anything.
    expect(g.stats.crushed).toBe(crushedBefore)
    expect(g.stats.stamps).toBe(0)
    expect(g.stamp(g.lesson.target)).toBe(true)
    expect(d.phase === 'fade' || d.phase === 'off').toBe(true)
    step(g, 0.5)
    expect(g.learned.stamp).toBe(true)
  })

  it('the book-2 sling lesson demonstrates the pull on the cup', () => {
    const g = new FoldGame({ seed: 4, learned: { swipe: true, crush: true, ballista: true }, book: 2 })
    toLesson(g, 'sling', 1, 30)
    const d = g.lesson.demo
    expect(d.kind).toBe('pull')
    expect(d.on).toBe('sling')
    const shots = g.stats.shots
    step(g, DEMO_PERIOD.pull * 2)
    expect(g.stats.shots).toBe(shots)
    expect(g.sling!.aiming).toBe(false)
    expect(g.grabSling()).toBe(true)
    expect(d.phase).toBe('fade')
  })
})

describe('hold to fold demonstrations (roadmap #14 follow-up)', () => {
  it('hold: the finger stays put and presses; the ghost folds up progressively after the hold delay', () => {
    const l = createLessonState()
    l.id = 'swipe'
    startDemo(l, 'hold', 'fold', 0, false)
    let last = 0
    let pressedAt = -1
    let risingAt = -1
    let fullAt = -1
    for (let t = 0; t < DEMO_PERIOD.hold - DT; t += DT) {
      stepDemo(l, DT)
      const d = l.demo
      expect(d.hand).toBe(0)
      expect(d.glide).toBe(0)
      // Progressive and never backwards within a loop.
      expect(d.fold).toBeGreaterThanOrEqual(last - 1e-9)
      last = d.fold
      if (pressedAt < 0 && d.press >= 0.99) pressedAt = d.clock
      if (risingAt < 0 && d.fold > 0.01) risingAt = d.clock
      if (fullAt < 0 && d.fold >= 1) fullAt = d.clock
      // The paper only moves under a pressed finger.
      if (d.fold > 0 && d.fold < 1) expect(d.press).toBeGreaterThan(0.99)
    }
    expect(pressedAt).toBeGreaterThan(0)
    // It waits for the hold to be recognised, then takes about HOLD_FOLD_MS to fold through.
    expect(risingAt - pressedAt).toBeGreaterThan(DEMO_HOLD_WAIT - 2 * DT)
    expect(fullAt - risingAt).toBeGreaterThan(DEMO_HOLD_FOLD * 0.9)
    expect(fullAt - risingAt).toBeLessThan(DEMO_HOLD_FOLD * 1.1)
  })

  it('with hold to fold on, the first fold lessons demonstrate a press and hold instead of a swipe', () => {
    const g = new FoldGame({ seed: 1 })
    g.holdToFold = true
    toLesson(g, 'swipe')
    expect(g.lesson.demo.phase).toBe('show')
    expect(g.lesson.demo.kind).toBe('hold')
    expect(g.lesson.demo.on).toBe('fold')
    // Off, the same lesson swipes.
    const h = new FoldGame({ seed: 1 })
    toLesson(h, 'swipe')
    expect(h.lesson.demo.kind).toBe('swipe')
    // Hold-demo lessons match the ghost hand's hold hints (the sling's is a tap and not demonstrated as a hold).
    expect(HOLD_DEMO_LESSONS).not.toContain('sling')
    expect(HOLD_DEMO_LESSONS).toContain('peel')
  })
})
