import { describe, expect, it } from 'vitest'
import { FoldGame, IDLE_HINT_AFTER } from '@/fold/logic/game'

const step = (g: FoldGame, s: number) => {
  for (let t = 0; t < s; t += 1 / 60) {
    g.update(1 / 60)
    g.events.clear()
  }
}

describe('wordless lessons', () => {
  it('a new player gets the swipe lesson with a ghost hand on the centre fold', () => {
    const g = new FoldGame()
    g.startRun(1)
    for (let t = 0; t < 30 && g.lesson.id !== 'swipe'; t += 1 / 60) {
      g.update(1 / 60)
      g.events.clear()
    }
    expect(g.lesson.id).toBe('swipe')
    expect(g.lesson.showHand).toBe(true)
    expect(g.lesson.hand.gesture).toBe('swipe')
    // The hand swipes "up the page", like the arrow.
    expect(g.lesson.hand.bz).toBeLessThan(g.lesson.hand.az)
    step(g, 1)
    expect(g.timeScale).toBeLessThan(0.5)
  })

  it('a returning player who learned it gets no slow-motion', () => {
    const g = new FoldGame({ learned: { swipe: true } })
    g.startRun(1)
    step(g, 12)
    expect(g.lesson.id === null || g.lesson.hint).toBe(true)
    expect(g.timeScale).toBeGreaterThan(0.9)
  })

  it('an idle, learned player gets a silent reminder that never slows time', () => {
    const g = new FoldGame({ learned: { swipe: true } })
    g.startRun(1)
    step(g, IDLE_HINT_AFTER + 6)
    if (g.lesson.id) {
      expect(g.lesson.hint).toBe(true)
      expect(g.timeScale).toBeGreaterThan(0.9)
    }
  })

  it('learning a lesson marks it learned', () => {
    const g = new FoldGame()
    g.startRun(1)
    for (let t = 0; t < 30 && g.lesson.id !== 'swipe'; t += 1 / 60) {
      g.update(1 / 60)
      g.events.clear()
    }
    g.foldNow(g.lesson.target)
    step(g, 0.5)
    expect(g.learned.swipe).toBe(true)
    expect(g.lesson.id).toBe(null)
  })
})
