import { describe, expect, it } from 'vitest'
import { FoldGame } from '@/fold/logic/game'
import { BOSS, RUSH } from '@/fold/logic/config'
import { BOSS_PACED, bossClock, bossTiming, createBoss, resetBoss } from '@/fold/logic/boss'
import {
  bossPageOf, formatRushTime, mergeRushRecords, readRushRecord, rushPar, rushResult, rushRound, rushUnlocked
} from '@/fold/logic/rush'
import { createKindMemory } from '@/fold/logic/difficulty'
import { buildSlots, rushSlotOf, type ShelfProgress } from '@/fold/logic/shelf'
import type { BookId } from '@/fold/logic/types'
import { ALL_LESSONS_LEARNED, botStep } from './bot'

const DT = 1 / 60

/**
 * The boss choreography of one seeded run on a dragon page, as a string: every
 * boss phase change, breath, stomp, heart lost and page clear, with the frame,
 * the boss timer and the aim. `bot` plays (every third frame) or not at all.
 */
const bossTrace = (book: BookId, bot: boolean, setup?: (g: FoldGame) => void): string => {
  const g = new FoldGame({ seed: 77, learned: ALL_LESSONS_LEARNED, book })
  g.startRun(5, 0, book)
  setup?.(g)
  const out: string[] = []
  for (let f = 0; f < 60 * 120; f++) {
    if (bot && f % 3 === 0) botStep(g)
    g.update(DT)
    for (let i = 0; i < g.events.count; i++) {
      const e = g.events.items[i]!
      if (e.type === 'bossPhase' || e.type === 'bossStomp' || e.type === 'bossBreath' || e.type === 'heroHit' ||
        e.type === 'pageCleared' || e.type === 'crumple') {
        out.push(`${f}:${e.type}:${e.a}:${g.boss.timer.toFixed(6)}:${e.x.toFixed(4)}`)
      }
    }
    g.events.clear()
  }
  return out.join('|')
}

const hash = (parts: string[]): number => {
  let h = 0
  for (const t of parts) for (let i = 0; i < t.length; i++) h = (Math.imul(h, 31) + t.charCodeAt(i)) | 0
  return h
}

/**
 * Recorded from the code *before* the timing multiplier existed (the boss FSM
 * read `BOSS` directly): both books' dragons, with the bot and untouched.
 */
const GOLDEN = { hash: 1878511751, lengths: [1910, 1847, 2021, 2112] }

/** Play a rush with the bot until it is over (or `s` seconds pass). */
const playRush = (g: FoldGame, s = 240): void => {
  for (let t = 0; t < s && g.phase !== 'rushOver'; t += DT) {
    botStep(g)
    g.update(DT)
    g.events.clear()
  }
}

describe('boss timing multiplier (roadmap #16)', () => {
  it('multiplier 1 is bit-for-bit the dragon as it was before the multiplier existed', () => {
    const traces = [bossTrace(1, true), bossTrace(2, true), bossTrace(1, false), bossTrace(2, false)]
    expect(traces.map((t) => t.length)).toEqual(GOLDEN.lengths)
    expect(hash(traces)).toBe(GOLDEN.hash)
    // Setting it to 1 explicitly changes nothing either.
    const explicit = [
      bossTrace(1, true, (g) => (g.boss.timing = 1)), bossTrace(2, true, (g) => (g.boss.timing = 1)),
      bossTrace(1, false, (g) => (g.boss.timing = 1)), bossTrace(2, false, (g) => (g.boss.timing = 1))
    ]
    expect(hash(explicit)).toBe(GOLDEN.hash)
  })

  it('story runs always use multiplier 1, even after a rush', () => {
    const g = new FoldGame({ learned: ALL_LESSONS_LEARNED })
    expect(g.boss.timing).toBe(1)
    g.startRun({ mode: 'dragonRush', book: 1 })
    expect(g.boss.timing).toBe(RUSH.timing)
    g.startRun(5, 0, 1)
    expect(g.boss.timing).toBe(1)
    expect(g.mode).toBe('story')
  })

  it('scales exactly the paced timings, and keeps the player\'s windows', () => {
    const b = createBoss()
    for (const k of BOSS_PACED) expect(bossTiming(b, k)).toBe(BOSS[k])
    b.timing = 0.5
    for (const k of BOSS_PACED) expect(bossTiming(b, k)).toBeCloseTo(BOSS[k] * 0.5, 12)
    // resetBoss keeps the run's multiplier.
    resetBoss(b)
    expect(b.timing).toBe(0.5)
    // Animation curves run in authored seconds on paced phases only.
    b.phase = 'breathCharge'
    b.phaseTime = 0.5
    expect(bossClock(b)).toBeCloseTo(1, 12)
    b.phase = 'exposed'
    expect(bossClock(b)).toBe(0.5)
  })

  it('a faster dragon attacks sooner: the first breath comes at the multiplier\'s share of the time', () => {
    const firstBreath = (timing: number): number => {
      const g = new FoldGame({ seed: 5, learned: ALL_LESSONS_LEARNED })
      g.startRun(5, 0, 1)
      g.boss.timing = timing
      for (let f = 0; f < 60 * 60; f++) {
        g.update(DT)
        for (let i = 0; i < g.events.count; i++) if (g.events.items[i]!.type === 'bossBreath') return f
        g.events.clear()
      }
      return -1
    }
    const slow = firstBreath(1)
    const fast = firstBreath(RUSH.timing)
    expect(slow).toBeGreaterThan(0)
    expect(fast).toBeGreaterThan(0)
    expect(fast).toBeLessThan(slow * 0.85)
  })
})

describe('Dragon Rush (roadmap #16)', () => {
  it('each book has a dragon page, and both dragons get a par', () => {
    expect(bossPageOf(1)).toBe(5)
    expect(bossPageOf(2)).toBe(5)
    expect(rushPar(1)).toBe(RUSH.par[0])
    expect(rushPar(2)).toBe(RUSH.par[1])
  })

  it('startRun({ mode: dragonRush }) starts on the boss phase of that book, with the clock at zero', () => {
    const g = new FoldGame({ learned: ALL_LESSONS_LEARNED })
    g.startRun(3, 1200, 1)
    g.startRun({ mode: 'dragonRush', book: 2 })
    expect(g.mode).toBe('dragonRush')
    expect(g.rushing).toBe(true)
    expect(g.book).toBe(2)
    expect(g.pageId).toBe(5)
    expect(g.phase).toBe('boss')
    expect(g.boss.phase).toBe('dormant')
    expect(g.score).toBe(0)
    expect(g.rush.time).toBe(0)
    expect(g.rush.running).toBe(true)
    expect(g.rush.par).toBe(rushPar(2))
    expect(g.events.types()).toContain('rushStart')
    const ev = g.events.items.find((e) => e.type === 'rushStart')!
    expect([ev.a, ev.b, ev.c]).toEqual([2, rushPar(2), 1])
  })

  it('the clock runs in real time on the dragon page, stops for the shelf and pauses', () => {
    const g = new FoldGame({ learned: ALL_LESSONS_LEARNED })
    g.setShelfProgress({ wins: [1, 0], cleared: [6, 0], stars: [[], []] })
    g.startRun({ mode: 'dragonRush', book: 1 })
    for (let i = 0; i < 60; i++) g.update(DT)
    expect(g.rush.time).toBeCloseTo(1, 5)
    // Slow mode slows the world, not the clock.
    g.worldScale = 0.75
    for (let i = 0; i < 60; i++) g.update(DT)
    expect(g.rush.time).toBeCloseTo(2, 5)
    g.paused = true
    for (let i = 0; i < 60; i++) g.update(DT)
    expect(g.rush.time).toBeCloseTo(2, 5)
    g.paused = false
    expect(g.openShelf('button')).toBe(true)
    for (let i = 0; i < 60; i++) g.update(DT)
    expect(g.rush.time).toBeCloseTo(2, 5)
  })

  it('the bot beats both rush dragons under par; the clock stops when the dragon folds down', () => {
    for (const book of [1, 2] as const) {
      const g = new FoldGame({ seed: 11, learned: ALL_LESSONS_LEARNED })
      g.startRun({ mode: 'dragonRush', book })
      let done: { b: number; c: number } | null = null
      let collapseAt = -1
      for (let t = 0; t < 240 && !done; t += DT) {
        botStep(g)
        g.update(DT)
        for (let i = 0; i < g.events.count; i++) {
          const e = g.events.items[i]!
          if (e.type === 'bossPhase' && g.boss.phase === 'collapse') collapseAt = g.rush.time
          if (e.type === 'rushDone') done = { b: e.b, c: e.c }
          // A rush never rates a page or turns to the finale.
          expect(e.type).not.toBe('pageCleared')
          expect(e.type).not.toBe('victory')
        }
        g.events.clear()
      }
      expect(done, `book ${book} rush not finished`).not.toBeNull()
      expect(g.phase).toBe('rushOver')
      expect(g.pageId).toBe(5)
      expect(g.rush.done).toBe(true)
      expect(g.rush.running).toBe(false)
      expect(done!.b).toBe(g.rush.time)
      expect(g.rush.time).toBeCloseTo(collapseAt, 6)
      expect(done!.c).toBe(rushPar(book))
      // Par leaves a human room over the frame-perfect bot (see RUSH.par).
      expect(g.rush.time).toBeLessThan(rushPar(book))
      expect(g.rush.time * 1.2).toBeLessThan(rushPar(book))
      expect(g.stats.stars).toBe(0)
    }
  })

  it('never touches the kind book: no crumple memory, no boss ease, as-authored pace', () => {
    const kind = createKindMemory()
    kind.streak = 3
    const g = new FoldGame({ learned: ALL_LESSONS_LEARNED, kind })
    g.startRun({ mode: 'dragonRush', book: 1 })
    const before = JSON.stringify(kind)
    expect(g.difficulty).toBe(1)
    expect(g.extraPerWave).toBe(0)
    // Lose on purpose (no bot): the dragon wins.
    for (let t = 0; t < 200 && g.phase !== 'crumple'; t += DT) {
      g.update(DT)
      g.events.clear()
    }
    expect(g.phase).toBe('crumple')
    expect(g.defeated).toBe(true)
    expect(JSON.stringify(kind)).toBe(before)
    expect(g.difficulty).toBe(1)
  })

  it('a defeat offers a quick retry: a fresh dragon and a fresh clock (never a continue)', () => {
    const g = new FoldGame({ learned: ALL_LESSONS_LEARNED })
    g.startRun({ mode: 'dragonRush', book: 1 })
    for (let t = 0; t < 200 && g.phase !== 'crumple'; t += DT) {
      g.update(DT)
      g.events.clear()
    }
    const clock = g.rush.time
    expect(clock).toBeGreaterThan(5)
    // The clock stopped with the crumple.
    for (let i = 0; i < 30; i++) g.update(DT)
    expect(g.rush.time).toBe(clock)
    g.events.clear()
    for (let t = 0; t < 2 && !g.canTryAgain(); t += DT) g.update(DT)
    expect(g.tryAgain()).toBe(true)
    expect(g.continuedThisPage).toBe(false)
    expect(g.events.types()).toContain('rushStart')
    expect(g.rush.time).toBe(0)
    expect(g.rush.attempts).toBe(2)
    expect(g.boss.phase).toBe('dormant')
    expect(g.boss.weakPoints.every((w) => !w.broken)).toBe(true)
    expect(g.hero.hp).toBe(g.hero.maxHp)
    // Left alone, a defeat drops a fresh dragon by itself too.
    const h = new FoldGame({ learned: ALL_LESSONS_LEARNED })
    h.startRun({ mode: 'dragonRush', book: 2 })
    for (let t = 0; t < 200 && h.phase !== 'crumple'; t += DT) {
      h.update(DT)
      h.events.clear()
    }
    for (let t = 0; t < RUSH.autoRetry + 1.5 && h.rush.attempts < 2; t += DT) {
      h.update(DT)
      h.events.clear()
    }
    expect(h.rush.attempts).toBe(2)
  })

  it('restartRush starts over; a story run afterwards is the story again', () => {
    const g = new FoldGame({ seed: 3, learned: ALL_LESSONS_LEARNED })
    g.startRun({ mode: 'dragonRush', book: 1 })
    playRush(g)
    expect(g.phase).toBe('rushOver')
    expect(g.restartRush()).toBe(true)
    expect(g.phase).toBe('boss')
    expect(g.rush.time).toBe(0)
    expect(g.rush.done).toBe(false)
    g.startRun(2, 500, 1)
    expect(g.rushing).toBe(false)
    expect(g.rush.active).toBe(false)
    expect(g.restartRush()).toBe(false)
    expect(g.pageId).toBe(2)
    expect(g.score).toBe(500)
  })

  it('results: time vs par and the previous best; records are sanitised and merge to the faster', () => {
    expect(rushResult(51.27, 60, 0)).toEqual({ time: 51.2, par: 60, best: 0, underPar: true, newBest: true })
    expect(rushResult(61, 60, 55)).toEqual({ time: 61, par: 60, best: 55, underPar: false, newBest: false })
    expect(rushResult(54.99, 60, 55).newBest).toBe(true)
    expect(rushResult(55.04, 60, 55).newBest).toBe(false)
    expect(rushRound(12.99)).toBe(12.9)
    expect(formatRushTime(0)).toBe('0:00.0')
    expect(formatRushTime(65.43)).toBe('1:05.4')
    expect(readRushRecord({ b1: 50.5, b2: 'x', b3: 40, b9: 1, bad: 2, b2x: 3 })).toEqual({ b1: 50.5 })
    expect(readRushRecord({ b1: -1, b2: NaN, })).toEqual({})
    expect(readRushRecord(null)).toEqual({})
    expect(readRushRecord([1, 2])).toEqual({})
    expect(mergeRushRecords({ b1: 50, b2: 70 }, { b1: 45, b2: 80 })).toEqual({ b1: 45, b2: 70 })
    expect(mergeRushRecords({}, { b2: 80 })).toEqual({ b2: 80 })
  })

  it('the shelf grows a rush figurine per won book; tapping it twice starts that rush', () => {
    const p: ShelfProgress = { wins: [1, 1], cleared: [6, 6], stars: [[], []], rush: [48.5, 0] }
    expect(rushUnlocked(1, p.wins)).toBe(true)
    expect(rushUnlocked(2, [1, 0])).toBe(false)
    const slots = buildSlots(p, 1, true)
    const r1 = slots[rushSlotOf(1)]!
    expect([r1.kind, r1.book, r1.state, r1.best, r1.par]).toEqual(['rush', 1, 'open', 48.5, rushPar(1)])
    expect(slots[rushSlotOf(2)]!.state).toBe('open')

    const g = new FoldGame({ learned: ALL_LESSONS_LEARNED })
    g.setShelfProgress(p)
    g.startRun(2, 0, 1)
    g.update(DT)
    expect(g.openShelf('button')).toBe(true)
    g.shelfTap(rushSlotOf(2))
    expect(g.shelf.selected).toBe(rushSlotOf(2))
    expect(g.rushing).toBe(false)
    g.shelfTap(rushSlotOf(2))
    expect(g.shelf.open).toBe(false)
    expect(g.rushing).toBe(true)
    expect(g.book).toBe(2)
    expect(g.pageId).toBe(5)
    expect(g.events.types()).toContain('rushStart')
    expect(g.events.types()).not.toContain('shelfBook')
  })

  it('a hidden rush figurine (book not won) only shakes', () => {
    const g = new FoldGame({ learned: ALL_LESSONS_LEARNED })
    g.setShelfProgress({ wins: [1, 0], cleared: [6, 0], stars: [[], []] })
    g.startRun(1, 0, 1)
    g.update(DT)
    g.openShelf('button')
    g.events.clear()
    g.shelfTap(rushSlotOf(2))
    g.shelfTap(rushSlotOf(2))
    expect(g.rushing).toBe(false)
    expect(g.events.types()).toEqual(['shelfSelect', 'shelfSelect'])
  })

  it('a rush page hides no page secret, and a story page after it has its own again', () => {
    const g = new FoldGame({ learned: ALL_LESSONS_LEARNED })
    g.startRun({ mode: 'dragonRush', book: 1 })
    expect(g.secrets.def).toBeNull()
    g.startRun(5, 0, 1)
    expect(g.secrets.def?.id).toBe('nap')
  })
})
