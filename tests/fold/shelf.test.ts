import { describe, expect, it } from 'vitest'
import { FoldGame } from '@/fold/logic/game'
import { SHELF } from '@/fold/logic/config'
import {
  SHELF_DESK, bookUnlockedBy, buildSlots, shelfAvailable, shelfTarget, slotAnchor, type ShelfProgress
} from '@/fold/logic/shelf'
import { lessonCode } from '@/fold/logic/lessons'
import type { FoldEventType } from '@/fold/logic/events'
import type { Stars } from '@/fold/logic/types'
import { ALL_LESSONS_LEARNED } from './bot'

const DT = 1 / 60

type Seen = { type: FoldEventType; a: number; b: number }

/** Step the game, collecting every event. */
const step = (g: FoldGame, s: number, seen: Seen[] = []): Seen[] => {
  for (let t = 0; t < s; t += DT) {
    g.update(DT)
    for (let i = 0; i < g.events.count; i++) {
      const e = g.events.items[i]!
      seen.push({ type: e.type, a: e.a, b: e.b })
    }
    g.events.clear()
  }
  return seen
}

/** Drain what an API call emitted outside `update`. */
const drain = (g: FoldGame): Seen[] => {
  const out: Seen[] = []
  for (let i = 0; i < g.events.count; i++) {
    const e = g.events.items[i]!
    out.push({ type: e.type, a: e.a, b: e.b })
  }
  g.events.clear()
  return out
}

const stars = (...s: Stars[]): Stars[] => s
const progress = (wins: number[], cleared: number[] = [0, 0], st: Stars[][] = [stars(0, 0, 0, 0, 0), stars(0, 0, 0, 0, 0)]): ShelfProgress =>
  ({ wins, cleared, stars: st })

const noShelfLesson = { ...ALL_LESSONS_LEARNED, shelf: false }

/** A game past its first win, on book 1 page `page`. */
const wonGame = (page: 1 | 2 | 3 | 4 | 5 | 6 = 1, learned = ALL_LESSONS_LEARNED): FoldGame => {
  const g = new FoldGame({ learned, demos: false })
  g.startRun(page)
  g.setShelfProgress(progress([1, 0], [6, 0], [stars(3, 2, 1, 0, 0), stars(0, 0, 0, 0, 0)]))
  g.events.clear()
  return g
}

describe('bookshelf rules (pure)', () => {
  it('book 1 is always open; book n opens once book n − 1 is won, or n was played; book 3 is still coming', () => {
    expect(bookUnlockedBy(1, [0, 0], [0, 0])).toBe(true)
    expect(bookUnlockedBy(2, [0, 0], [3, 0])).toBe(false)
    expect(bookUnlockedBy(2, [1, 0], [6, 0])).toBe(true)
    expect(bookUnlockedBy(2, [0, 0], [0, 2])).toBe(true)
    expect(bookUnlockedBy(2, [0, 1], [0, 0])).toBe(true)
    expect(bookUnlockedBy(3, [1, 1], [6, 6])).toBe(false)
  })

  it('the shelf appears only after the first victory', () => {
    expect(shelfAvailable([0, 0])).toBe(false)
    expect(shelfAvailable([0, 1])).toBe(true)
    expect(shelfAvailable([2, 0])).toBe(true)
  })

  it('builds one slot per book plus the coming book, with each book\'s stars', () => {
    const slots = buildSlots(progress([1, 0], [6, 1], [stars(3, 2, 1, 0, 0), stars(1, 0, 0, 0, 0)]), 1, false)
    expect(slots.map((s) => s.state)).toEqual(['current', 'open', 'coming'])
    expect(slots.map((s) => [s.stars, s.max])).toEqual([[6, 15], [1, 15], [0, 0]])
    expect(slots[0]!.pages).toEqual([3, 2, 1, 0, 0])
    expect(slots[0]!.won).toBe(true)
    expect(buildSlots(progress([0, 0]), 1, false).map((s) => s.state)).toEqual(['current', 'locked', 'coming'])
    // A won book isn't "continued": every book starts fresh.
    expect(buildSlots(progress([1, 0]), 1, true).map((s) => s.state)).toEqual(['open', 'open', 'coming'])
  })

  it('highlights the current book mid-run, and the newly unlocked one after a win', () => {
    expect(shelfTarget(buildSlots(progress([1, 0]), 2, false), 2, false)).toBe(1)
    expect(shelfTarget(buildSlots(progress([1, 0]), 1, true), 1, true)).toBe(1)
    // Book 2 won too: nothing new (book 3 is still coming), the finished book glows.
    expect(shelfTarget(buildSlots(progress([1, 1]), 2, true), 2, true)).toBe(1)
    // Book 2 won first (a save from elsewhere): book 1 is the one not yet won.
    expect(shelfTarget(buildSlots(progress([0, 1]), 2, true), 2, true)).toBe(0)
  })

  it('the anchor slides out with the pull and sits right of the book', () => {
    const a = slotAnchor(1, { x: 0, y: 0, z: 0 })
    const b = slotAnchor(1, { x: 0, y: 0, z: 0 }, 1)
    expect(a.x).toBeGreaterThan(SHELF.x - 2)
    expect(a.y).toBeGreaterThan(0)
    expect(b.z).toBeGreaterThan(a.z)
    for (const v of [a.x, a.y, a.z, b.x, b.y, b.z]) expect(Number.isFinite(v)).toBe(true)
  })
})

describe('bookshelf in the game', () => {
  it('stays shut before the first win', () => {
    const g = new FoldGame({ learned: ALL_LESSONS_LEARNED })
    g.startRun(1)
    g.setShelfProgress(progress([0, 0]))
    expect(g.shelf.available).toBe(false)
    expect(g.canOpenShelf()).toBe(false)
    expect(g.toggleShelf()).toBe(false)
  })

  it('out at the shelf the world stands still, but a fold already moving finishes in real time', () => {
    const g = wonGame(1)
    step(g, 3.5)
    const i = g.folds.findIndex((f) => f.phase === 'ready')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(g.enemies.some((e) => e.state === 'march')).toBe(true)
    expect(g.foldNow(i)).toBe(true)
    expect(g.openShelf('button')).toBe(true)
    expect(g.acceptsInput()).toBe(false)
    step(g, 1)
    // The flap snapped up while the world slowed to a stop.
    expect(['up', 'snapping']).toContain(g.folds[i]!.phase)
    expect(g.timeScale).toBeLessThan(0.02)
    const marchers = g.enemies.filter((e) => e.state === 'march').map((e) => e.z.toFixed(5)).join()
    const run = g.runTime
    step(g, 2)
    expect(g.enemies.filter((e) => e.state === 'march').map((e) => e.z.toFixed(5)).join()).toBe(marchers)
    expect(g.runTime).toBe(run)
    // Back to the book: time returns.
    expect(g.toggleShelf()).toBe(true)
    expect(g.shelf.open).toBe(false)
    step(g, 1)
    expect(g.timeScale).toBeGreaterThan(0.9)
  })

  it('mid-run the current book comes out ready: one tap goes back to it and play continues', () => {
    const g = wonGame(2)
    expect(g.openShelf('button')).toBe(true)
    expect(g.shelf.selected).toBe(0)
    expect(g.shelf.highlight).toBe(0)
    drain(g)
    g.shelfTap(0)
    const ev = drain(g)
    expect(g.shelf.open).toBe(false)
    expect(ev).toContainEqual({ type: 'shelfBook', a: 1, b: 1 })
    expect(ev).toContainEqual({ type: 'shelf', a: 0, b: 0 })
    expect(g.pageId).toBe(2)
  })

  it('another book: the first tap pulls it out, the second opens it; locked books only shake', () => {
    const g = wonGame(3)
    g.openShelf('button')
    drain(g)
    g.shelfTap(2)
    expect(drain(g)).toContainEqual({ type: 'shelfSelect', a: 2, b: 0 })
    expect(g.shelf.selected).toBe(0)
    g.shelfTap(1)
    expect(drain(g)).toContainEqual({ type: 'shelfSelect', a: 1, b: 1 })
    expect(g.shelf.selected).toBe(1)
    expect(g.shelf.open).toBe(true)
    g.shelfTap(1)
    expect(drain(g)).toContainEqual({ type: 'shelfBook', a: 2, b: 0 })
    expect(g.shelf.open).toBe(false)
  })

  it('tapping the open book on the desk goes back to it', () => {
    const g = wonGame(1)
    g.openShelf('button')
    g.shelfTap(SHELF_DESK)
    expect(g.shelf.open).toBe(false)
  })

  it('after a win the camera turns to the shelf by itself, the next book glowing; folding the book shut gets there too', () => {
    const g = wonGame(6)
    g.setShelfProgress(progress([0, 0], [5, 0]))
    expect(g.shelf.available).toBe(false)
    step(g, 1)
    expect(g.foldShut()).toBe(false)
    g.foldNow(0)
    const seen = step(g, 4)
    expect(g.phase).toBe('victory')
    expect(seen.some((e) => e.type === 'victory')).toBe(true)
    // The win counts at once (before the save round-trip).
    expect(g.shelf.available).toBe(true)
    expect(g.shelf.slots[1]!.state).toBe('open')
    expect(g.shelf.open).toBe(false)
    // A sweep across the won book folds it shut: out to the shelf.
    const h = new FoldGame({ learned: ALL_LESSONS_LEARNED })
    h.startRun(6)
    h.setShelfProgress(progress([1, 0], [6, 0]))
    step(h, 1)
    h.foldNow(0)
    step(h, 4)
    expect(h.foldShut()).toBe(true)
    expect(h.shelf.open).toBe(true)
    expect(h.shelf.reason).toBe('shut')
    // Left alone, the first game turns to the shelf by itself.
    step(g, SHELF.afterVictory)
    expect(g.shelf.open).toBe(true)
    expect(g.shelf.reason).toBe('victory')
    expect(g.shelf.finished).toBe(true)
    expect(g.shelf.selected).toBe(-1)
    expect(g.shelf.highlight).toBe(1)
    expect(g.shelf.slots.map((s) => s.state)).toEqual(['open', 'open', 'coming'])
    // Closing it doesn't make it come back by itself.
    g.closeShelf()
    step(g, SHELF.afterVictory + 1)
    expect(g.shelf.open).toBe(false)
  })

  it('a new run from the shelf closes it and knows the new current book', () => {
    const g = wonGame(6)
    g.openShelf('button')
    g.startRun(1, 0, 2)
    expect(g.shelf.open).toBe(false)
    expect(g.shelf.slots.map((s) => s.state)).toEqual(['open', 'current', 'coming'])
    expect(g.shelf.highlight).toBe(1)
  })
})

describe('the shelf lesson (wordless)', () => {
  it('out at the shelf the hand taps the glowing book, then taps it again; opening it learns the lesson', () => {
    const g = new FoldGame({ learned: noShelfLesson, demos: false })
    g.startRun(6)
    g.setShelfProgress(progress([0, 0], [5, 0]))
    step(g, 1)
    g.foldNow(0)
    step(g, 4 + SHELF.afterVictory)
    expect(g.shelf.open).toBe(true)
    expect(g.lesson.id).toBe('shelf')
    expect(g.lesson.step).toBe(1)
    expect(g.lesson.hand.anchor).toBe('world')
    expect(g.lesson.hand.gesture).toBe('tap')
    const a = slotAnchor(1, { x: 0, y: 0, z: 0 }, 0, 0.6)
    expect(g.lesson.hand.ax).toBeCloseTo(a.x)
    expect(g.lesson.hand.az).toBeCloseTo(a.z)
    expect(g.lesson.hand.y).toBeCloseTo(a.y)
    g.shelfTap(1)
    step(g, DT)
    expect(g.lesson.step).toBe(2)
    // The pulled-out book: the hand follows it out.
    expect(g.lesson.hand.az).toBeGreaterThan(a.z)
    drain(g)
    g.shelfTap(1)
    const ev = drain(g)
    expect(ev).toContainEqual({ type: 'lesson', a: lessonCode('shelf'), b: 0 })
    expect(g.learned.shelf).toBe(true)
    expect(g.lesson.id).toBe(null)
  })

  it('on a page intro it points at the zoom button once (no slow-mo), or at the shelf where it is in view', () => {
    const g = new FoldGame({ learned: noShelfLesson, demos: false })
    g.setShelfProgress(progress([1, 0], [6, 0]))
    g.startRun(1)
    step(g, DT)
    expect(g.lesson.id).toBe('shelf')
    expect(g.lesson.step).toBe(0)
    expect(g.lesson.hand.anchor).toBe('zoom')
    expect(g.lesson.timeScale).toBe(1)
    step(g, 0.5)
    expect(g.timeScale).toBeGreaterThan(0.99)
    // It runs its course and does not come back on the same page.
    step(g, SHELF.cueTime + 0.5)
    expect(g.lesson.id).not.toBe('shelf')
    // Where the camera already shows the shelf, it points at the current book on it.
    const h = new FoldGame({ learned: noShelfLesson, demos: false })
    h.setShelfProgress(progress([1, 0], [6, 0]))
    h.setShelfInView(true)
    h.startRun(2)
    step(h, DT)
    expect(h.lesson.id).toBe('shelf')
    expect(h.lesson.hand.anchor).toBe('world')
  })

  it('never shows once learned, or before the shelf exists', () => {
    const g = new FoldGame({ learned: ALL_LESSONS_LEARNED, demos: false })
    g.setShelfProgress(progress([1, 0], [6, 0]))
    g.startRun(1)
    step(g, 1)
    expect(g.lesson.id).not.toBe('shelf')
    const h = new FoldGame({ learned: noShelfLesson, demos: false })
    h.setShelfProgress(progress([0, 0]))
    h.startRun(1)
    step(h, 1)
    expect(h.lesson.id).not.toBe('shelf')
  })
})
