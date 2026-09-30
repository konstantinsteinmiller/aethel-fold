import { describe, expect, it } from 'vitest'
import { FoldGame } from '@/fold/logic/game'
import { OUTRO, PAGE_HALF_D, PAGE_HALF_W, SHELF } from '@/fold/logic/config'
import {
  CutsceneRunner, FW_FREE, FireworkPool, SHOT_HOME, crowdSpot, fireworkParticleCap, onCrowdLine, scriptDuration, sparksPerBurst,
  trailChips, validateScript, type CutEdge, type CutScript
} from '@/fold/logic/cutscene'
import { OUTROS, OUTRO_BOOK1, OUTRO_BOOK2, OUTRO_BOOK3, outroFor } from '@/fold/logic/outros'
import { EventQueue, type FoldEventType } from '@/fold/logic/events'
import type { BookId } from '@/fold/logic/types'
import { ALL_LESSONS_LEARNED } from './bot'

const DT = 1 / 60

interface Seen { type: FoldEventType; a: number; b: number; c: number; t: number }

/** Step a runner alone, collecting its events with the runner time they came at. */
const run = (r: CutsceneRunner, ev: EventQueue, s: number, out: Seen[] = []): Seen[] => {
  for (let t = 0; t < s; t += DT) {
    r.update(DT, ev)
    for (let i = 0; i < ev.count; i++) {
      const e = ev.items[i]!
      out.push({ type: e.type, a: e.a, b: e.b, c: e.c, t: r.time })
    }
    ev.clear()
  }
  return out
}

const drain = (ev: EventQueue, t = 0): Seen[] => {
  const out: Seen[] = []
  for (let i = 0; i < ev.count; i++) {
    const e = ev.items[i]!
    out.push({ type: e.type, a: e.a, b: e.b, c: e.c, t })
  }
  ev.clear()
  return out
}

/** Step the game, collecting every event (in queue order). */
const step = (g: FoldGame, s: number, out: Seen[] = []): Seen[] => {
  for (let t = 0; t < s; t += DT) {
    g.update(DT)
    for (let i = 0; i < g.events.count; i++) {
      const e = g.events.items[i]!
      out.push({ type: e.type, a: e.a, b: e.b, c: e.c, t: g.outro.time })
    }
    g.events.clear()
  }
  return out
}

/** A story game on its finale page, folded, stepped until the victory. */
const toVictory = (book: BookId = 1, seen: Seen[] = []): FoldGame => {
  const g = new FoldGame({ learned: ALL_LESSONS_LEARNED, demos: false, book })
  g.startRun(6, 0, book)
  step(g, 1, seen)
  expect(g.foldNow(0)).toBe(true)
  for (let t = 0; t < 8 && g.phase !== 'victory'; t += DT) step(g, DT, seen)
  expect(g.phase).toBe('victory')
  return g
}

const crowdOf = (s: CutScript): number => s.beats.reduce((n, b) => n + (b.kind === 'crowd' ? b.count : 0), 0)

describe('outro scripts (data)', () => {
  it('every book has a well-formed script: in order, one end last, crowd within the cap, camera home before the end', () => {
    for (const [book, s] of Object.entries(OUTROS)) {
      expect(validateScript(s!), `book ${book}`).toEqual([])
      const d = scriptDuration(s!)
      expect(d).toBeGreaterThanOrEqual(6)
      expect(d).toBeLessThanOrEqual(8)
      const cams = s!.beats.filter((b) => b.kind === 'camera')
      const last = cams[cams.length - 1]!
      expect(last.kind === 'camera' && last.shot).toEqual(SHOT_HOME)
      expect(last.at + (last.kind === 'camera' ? last.dur : 0)).toBeLessThanOrEqual(d)
      expect(crowdOf(s!)).toBeLessThanOrEqual(OUTRO.crowdCap)
    }
  })

  it('looks a script up per book; a book without one gets none', () => {
    expect(outroFor(1)).toBe(OUTRO_BOOK1)
    expect(outroFor(2)).toBe(OUTRO_BOOK2)
    expect(outroFor(3)).toBe(OUTRO_BOOK3)
    expect(outroFor(4 as BookId)).toBeNull()
  })

  it('book 3: dolphins in the sea and paper boats along its shore, then the banks cheer', () => {
    const cast = (actor: string) => OUTRO_BOOK3.beats.filter((b) => b.kind === 'crowd' && b.actor === actor)
    const dolphins = cast('dolphins')
    const boats = cast('boats')
    expect(dolphins).toHaveLength(1)
    expect(boats).toHaveLength(1)
    expect(dolphins[0]!.kind === 'crowd' && dolphins[0]!.edge).toBe('sea')
    expect(boats[0]!.kind === 'crowd' && boats[0]!.edge).toBe('shore')
    // Nobody lines up along the top edge in book 3: that is the sea.
    expect(OUTRO_BOOK3.beats.some((b) => b.kind === 'crowd' && b.edge === 'top')).toBe(false)
    // The dolphins' spray fits the particle budget on top of the fireworks.
    const n = dolphins.reduce((k, b) => k + (b.kind === 'crowd' ? b.count : 0), 0)
    expect(fireworkParticleCap(false) + n * OUTRO.splashChips).toBeLessThanOrEqual(OUTRO.maxParticles)
  })

  it('validation catches a missing end, an out-of-order beat and an oversized crowd', () => {
    expect(validateScript({ id: 'x', beats: [{ at: 0, kind: 'cheer' }] })).toContain('no end beat')
    expect(validateScript({ id: 'x', beats: [{ at: 2, kind: 'cheer' }, { at: 1, kind: 'end' }] })[0]).toMatch(/out of order/)
    expect(validateScript({
      id: 'x', beats: [{ at: 0, kind: 'crowd', actor: 'kids', edge: 'top', count: OUTRO.crowdCap + 1, stagger: 0 }, { at: 1, kind: 'end' }]
    }).some((p) => p.startsWith('crowd'))).toBe(true)
  })

  it('crowd spots are finite, on the page, and the bottom row stays clear of the keep and towers', () => {
    const out = { x: 0, z: 0 }
    for (const edge of ['left', 'right', 'top', 'bottom', 'sea', 'shore'] as CutEdge[]) {
      for (let n = 1; n <= 8; n++) {
        for (let j = 0; j < n; j++) {
          for (const jitter of [-1, 0, 1]) {
            crowdSpot(edge, j, n, jitter, out)
            expect(Number.isFinite(out.x) && Number.isFinite(out.z)).toBe(true)
            expect(Math.abs(out.x)).toBeLessThan(PAGE_HALF_W)
            expect(Math.abs(out.z)).toBeLessThan(PAGE_HALF_D)
            if (edge === 'bottom') expect(Math.abs(out.x)).toBeGreaterThan(2.9)
            // Book 3: the dolphins out in the sea, the boats in it too, the side lines on the beach below it.
            if (edge === 'sea' || edge === 'shore') expect(out.z).toBeLessThan(OUTRO.seaZ)
            if (edge === 'sea') expect(out.z).toBeLessThan(OUTRO.seaZ - 0.9)
            if (edge === 'left' || edge === 'right') expect(out.z).toBeGreaterThan(OUTRO.seaZ)
          }
        }
      }
    }
  })

  it('the finale pages keep their trees off every land crowd line (onCrowdLine)', () => {
    const out = { x: 0, z: 0 }
    for (const edge of ['left', 'right', 'top', 'bottom'] as CutEdge[]) {
      for (let n = 1; n <= 6; n++) {
        for (let j = 0; j < n; j++) {
          for (const jitter of [-1, 0, 1]) {
            crowdSpot(edge, j, n, jitter, out)
            // The spot itself, and just in front of it (toward the camera: a tree there would hide it).
            expect(onCrowdLine(out.x, out.z), `${edge} ${j}/${n}`).toBe(true)
            expect(onCrowdLine(out.x, out.z + 0.5), `${edge} ${j}/${n} front`).toBe(true)
          }
        }
      }
    }
    // The middle of the page (where the finale's flap and the laurel ring are) stays free.
    expect(onCrowdLine(0, 0)).toBe(false)
    expect(onCrowdLine(2, -1)).toBe(false)
  })
})

describe('cutscene runner', () => {
  it('fires every beat once, in order, in the frame its time comes, then ends', () => {
    const r = new CutsceneRunner()
    const ev = new EventQueue()
    r.start(OUTRO_BOOK1, ev)
    const start = drain(ev)
    expect(start).toEqual([{ type: 'outro', a: 1, b: 0, c: 0, t: 0 }])
    expect(r.active).toBe(true)
    const seen = run(r, ev, 10)
    const beats = seen.filter((e) => e.type === 'outroBeat')
    expect(beats.map((e) => e.a)).toEqual(OUTRO_BOOK1.beats.map((_, i) => i))
    for (const e of beats) {
      const at = OUTRO_BOOK1.beats[e.a]!.at
      expect(e.t).toBeGreaterThanOrEqual(at)
      expect(e.t).toBeLessThan(at + DT + 1e-9)
      expect(e.b).toBe(0)
    }
    const end = seen.filter((e) => e.type === 'outro')
    expect(end).toHaveLength(1)
    expect(end[0]).toMatchObject({ a: 0, b: 0 })
    expect(end[0]!.t).toBeGreaterThanOrEqual(scriptDuration(OUTRO_BOOK1))
    expect(r.active).toBe(false)
    expect(r.crowdCount).toBe(crowdOf(OUTRO_BOOK1))
    // Nothing more after the end.
    expect(run(r, ev, 2)).toEqual([])
  })

  it('lays the crowd out the same for the same seed, and pops each person up on its stagger', () => {
    const a = new CutsceneRunner()
    const b = new CutsceneRunner()
    const ev = new EventQueue()
    a.start(OUTRO_BOOK1, ev, 42)
    b.start(OUTRO_BOOK1, ev, 42)
    run(a, ev, 8)
    run(b, ev, 8)
    for (let i = 0; i < a.crowdCount; i++) expect(a.crowd[i]).toEqual(b.crowd[i])
    const first = OUTRO_BOOK1.beats.find((x) => x.kind === 'crowd')!
    expect(a.crowd[0]!.popAt).toBeCloseTo(first.at)
    expect(a.crowd[1]!.popAt).toBeCloseTo(first.at + (first.kind === 'crowd' ? first.stagger : 0))
  })

  it('a skip waits out the first half second, then jumps to the end: the whole crowd up at once, no fireworks left', () => {
    const r = new CutsceneRunner()
    const ev = new EventQueue()
    r.start(OUTRO_BOOK1, ev)
    ev.clear()
    run(r, ev, OUTRO.skipAfter * 0.5)
    expect(r.skip(ev)).toBe(false)
    expect(r.active).toBe(true)
    run(r, ev, 1.2)
    expect(r.fireworks.busy).toBeGreaterThan(0)
    expect(r.skip(ev)).toBe(true)
    const out = drain(ev, r.time)
    expect(out[out.length - 1]).toMatchObject({ type: 'outro', a: 0, b: 1 })
    // The crowd beats still to come were fired by the skip (b = 1); nothing else was.
    const skippedBeats = out.filter((e) => e.type === 'outroBeat')
    expect(skippedBeats.length).toBeGreaterThan(0)
    for (const e of skippedBeats) {
      expect(e.b).toBe(1)
      expect(OUTRO_BOOK1.beats[e.a]!.kind).toBe('crowd')
    }
    expect(r.active).toBe(false)
    expect(r.skipped).toBe(true)
    expect(r.crowdCount).toBe(crowdOf(OUTRO_BOOK1))
    for (let i = 0; i < r.crowdCount; i++) expect(r.crowd[i]!.popAt).toBeLessThanOrEqual(r.time - OUTRO.popTime + 1e-9)
    expect(r.fireworks.busy).toBe(0)
    // A second skip does nothing; later updates emit nothing.
    expect(r.skip(ev)).toBe(false)
    expect(run(r, ev, 3)).toEqual([])
  })

  it('runs on the real clock: at 10 fps (dt 0.1, twice the game clamp) a script still ends on time', () => {
    const r = new CutsceneRunner()
    const ev = new EventQueue()
    r.start(OUTRO_BOOK1, ev)
    let frames = 0
    while (r.active && frames < 1000) {
      r.update(0.1, ev)
      ev.clear()
      frames++
    }
    // 7.2 s of script in ~72 frames of 0.1 s (not ~144: the 0.05 s clamp would double it).
    expect(frames * 0.1).toBeGreaterThanOrEqual(scriptDuration(OUTRO_BOOK1) - 1e-6)
    expect(frames * 0.1).toBeLessThan(scriptDuration(OUTRO_BOOK1) + 0.1 + 1e-6)
    // A tab switch (a huge dt) is capped: one frame never jumps the whole script.
    const s = new CutsceneRunner()
    s.start(OUTRO_BOOK1, ev)
    s.update(30, ev)
    expect(s.time).toBeCloseTo(OUTRO.maxDt, 9)
    expect(s.active).toBe(true)
  })

  it('cue beats: offered to the host every frame of their window, in order, until taken; late ones once more', () => {
    const r = new CutsceneRunner()
    const ev = new EventQueue()
    const script: CutScript = {
      id: 'cues',
      beats: [
        { at: 0.1, kind: 'cue', dur: 0.3, cue: 7 },
        { at: 0.2, kind: 'cue', dur: 0.1, cue: 8 },
        { at: 1, kind: 'end' }
      ]
    }
    expect(validateScript(script)).toEqual([])
    const calls: [number, boolean, number][] = []
    let take7 = false
    r.start(script, ev, 1, {
      cue: (c, late) => {
        calls.push([c, late, r.time])
        return c === 7 ? take7 : false
      }
    })
    run(r, ev, 0.35)
    // Both offered, 7 before 8 in every frame, 8 dropped after its late offer.
    expect(calls.every(([c, , t]) => (c === 7 ? t >= 0.1 : t >= 0.2))).toBe(true)
    const eights = calls.filter(([c]) => c === 8)
    expect(eights[eights.length - 1]![1]).toBe(true)
    expect(eights.filter(([, late]) => late)).toHaveLength(1)
    take7 = true
    const seen = run(r, ev, 0.1)
    expect(seen.filter((e) => e.type === 'outroBeat')).toEqual([expect.objectContaining({ a: 0, b: 0 })])
    const n = calls.length
    run(r, ev, 1)
    expect(calls.length).toBe(n)
    expect(r.active).toBe(false)
  })

  it('stop forgets everything without a word', () => {
    const r = new CutsceneRunner()
    const ev = new EventQueue()
    r.start(OUTRO_BOOK2, ev)
    run(r, ev, 2)
    ev.clear()
    r.stop()
    expect(r.active).toBe(false)
    expect(r.script).toBeNull()
    expect(r.crowdCount).toBe(0)
    expect(r.fireworks.busy).toBe(0)
    expect(ev.count).toBe(0)
  })
})

describe('fireworks pool (caps)', () => {
  it('refuses a launch past its limit and counts it; frees a slot after rise + linger', () => {
    const p = new FireworkPool()
    const ev = new EventQueue()
    p.limit = 2
    expect(p.launch(0, 0, 4, 0)).toBe(0)
    expect(p.launch(1, 0, 4, 0)).toBe(1)
    expect(p.launch(2, 0, 4, 0)).toBe(-1)
    expect(p.dropped).toBe(1)
    expect(p.busy).toBe(2)
    // The limit never exceeds the pool itself.
    p.limit = 99
    for (let i = 0; i < 10; i++) p.launch(0, 0, 4, 0)
    expect(p.busy).toBe(p.capacity)
    let bursts = 0
    for (let t = 0; t < OUTRO.rise + OUTRO.linger + 0.1; t += DT) {
      p.update(DT, ev)
      for (let i = 0; i < ev.count; i++) if (ev.items[i]!.type === 'firework' && ev.items[i]!.b === 1) bursts++
      ev.clear()
    }
    expect(bursts).toBe(p.capacity)
    expect(p.busy).toBe(0)
    for (let i = 0; i < p.capacity; i++) expect(p.state[i]).toBe(FW_FREE)
  })

  it('the particle budget holds in both modes, and lite is lighter', () => {
    expect(fireworkParticleCap(false)).toBeLessThanOrEqual(OUTRO.maxParticles)
    expect(fireworkParticleCap(true)).toBeLessThan(fireworkParticleCap(false))
    expect(sparksPerBurst(true)).toBeLessThan(sparksPerBurst(false))
    expect(trailChips()).toBeGreaterThan(0)
    expect(OUTRO.fireworkSlotsLite).toBeLessThan(OUTRO.fireworkSlots)
  })

  it('the authored scripts never hit the cap: nothing dropped, concurrency within the limit, in normal and lite mode', () => {
    for (const s of Object.values(OUTROS)) {
      for (const lite of [false, true]) {
        const r = new CutsceneRunner()
        const ev = new EventQueue()
        r.lite = lite
        r.start(s!, ev)
        let launches = 0
        let most = 0
        for (let t = 0; t < 9; t += DT) {
          r.update(DT, ev)
          for (let i = 0; i < ev.count; i++) if (ev.items[i]!.type === 'firework' && ev.items[i]!.b === 0) launches++
          ev.clear()
          most = Math.max(most, r.fireworks.busy)
        }
        const volley = s!.beats.reduce((n, b) => n + (b.kind === 'fireworks' ? (lite ? Math.ceil(b.count / 2) : b.count) : 0), 0)
        expect(r.fireworks.dropped, `${s!.id} lite=${lite}`).toBe(0)
        expect(launches).toBe(volley)
        expect(most).toBeLessThanOrEqual(lite ? OUTRO.fireworkSlotsLite : OUTRO.fireworkSlots)
        if (lite) expect(launches).toBeLessThan(s!.beats.reduce((n, b) => n + (b.kind === 'fireworks' ? b.count : 0), 0))
      }
    }
  })
})

describe('the outro in the game', () => {
  it('plays after the finale, in the same frame as the victory — which comes first, so the win is saved before it', () => {
    const seen: Seen[] = []
    const g = toVictory(1, seen)
    const v = seen.findIndex((e) => e.type === 'victory')
    const o = seen.findIndex((e) => e.type === 'outro' && e.a === 1)
    expect(v).toBeGreaterThanOrEqual(0)
    expect(o).toBeGreaterThan(v)
    expect(g.outro.active).toBe(true)
    expect(g.outro.script).toBe(OUTRO_BOOK1)
    // A host that saves on `victory` has saved by the time the outro starts.
    let saved = false
    let savedFirst = false
    for (const e of seen) {
      if (e.type === 'victory') saved = true
      if (e.type === 'outro' && e.a === 1) savedFirst = saved
    }
    expect(savedFirst).toBe(true)
  })

  it('book 2 plays its own script', () => {
    const g = toVictory(2)
    expect(g.outro.script).toBe(OUTRO_BOOK2)
  })

  it('book 3: after the kraken, the fish is folded, the win is saved first, then the dolphins and boats', () => {
    const seen: Seen[] = []
    const g = toVictory(3, seen)
    expect(g.outro.script).toBe(OUTRO_BOOK3)
    expect(seen.findIndex((e) => e.type === 'victory')).toBeLessThan(seen.findIndex((e) => e.type === 'outro' && e.a === 1))
    step(g, 1.2)
    const actors = new Set(g.outro.crowd.slice(0, g.outro.crowdCount).map((m) => m.actor))
    expect(actors.has('dolphins')).toBe(true)
    expect(actors.has('boats')).toBe(true)
    // The skip works as in the other books: straight to the card.
    expect(g.skipOutro()).toBe(true)
    expect(g.outro.active).toBe(false)
    expect(g.outro.crowdCount).toBe(crowdOf(OUTRO_BOOK3))
    expect(g.phase).toBe('victory')
  })

  it('the game feeds the outro its real dt, not the 0.05 s clamp (no stretch below 20 fps)', () => {
    const g = toVictory(1)
    const t0 = g.outro.time
    g.update(0.2)
    expect(g.outro.time - t0).toBeCloseTo(0.2, 9)
  })

  it('holds the shelf back while it plays; its end starts the shelf clock', () => {
    const g = toVictory(1)
    g.setShelfProgress({ wins: [1, 0], cleared: [6, 0], stars: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]] })
    expect(g.canOpenShelf()).toBe(false)
    expect(g.openShelf('button')).toBe(false)
    expect(g.foldShut()).toBe(false)
    const seen = step(g, scriptDuration(OUTRO_BOOK1) + 0.1)
    expect(seen.some((e) => e.type === 'outro' && e.a === 0 && e.b === 0)).toBe(true)
    expect(g.outro.active).toBe(false)
    expect(g.phase).toBe('victory')
    expect(g.canOpenShelf()).toBe(true)
    // The shelf comes by itself `afterVictory` after the card, not after the victory.
    step(g, SHELF.afterVictory - 0.5)
    expect(g.shelf.open).toBe(false)
    step(g, 0.6)
    expect(g.shelf.open).toBe(true)
  })

  it('skipOutro: not in the first half second, then at once; paused, never', () => {
    const g = toVictory(1)
    g.events.clear()
    // `toVictory` stops on the victory frame: the outro has just begun.
    expect(g.outro.time).toBeLessThan(OUTRO.skipAfter)
    expect(g.skipOutro()).toBe(false)
    step(g, OUTRO.skipAfter)
    g.paused = true
    expect(g.skipOutro()).toBe(false)
    g.paused = false
    expect(g.skipOutro()).toBe(true)
    expect(g.outro.active).toBe(false)
    expect(g.outro.skipped).toBe(true)
    expect(g.phaseTime).toBe(0)
    expect(g.outro.crowdCount).toBe(crowdOf(OUTRO_BOOK1))
    // Paused mid-outro, the clock stops.
    const h = toVictory(1)
    step(h, 1)
    const t = h.outro.time
    h.paused = true
    step(h, 2)
    expect(h.outro.time).toBe(t)
  })

  it('is never played in Dragon (or Kraken) Rush', () => {
    for (const book of [1, 2, 3] as const) {
      const g = new FoldGame({ learned: ALL_LESSONS_LEARNED, demos: false })
      g.startRun({ mode: 'dragonRush', book })
      step(g, 1)
      g.debugClearPage()
      const seen = step(g, 6)
      expect(g.phase).toBe('rushOver')
      expect(seen.some((e) => e.type === 'rushDone')).toBe(true)
      expect(seen.some((e) => e.type === 'outro' || e.type === 'outroBeat' || e.type === 'firework')).toBe(false)
      expect(g.outro.active).toBe(false)
      expect(g.outro.script).toBeNull()
      expect(g.skipOutro()).toBe(false)
    }
  })

  it('a new run (or any page load) drops the outro and its crowd', () => {
    const g = toVictory(1)
    step(g, 2)
    expect(g.outro.crowdCount).toBeGreaterThan(0)
    g.startRun(1, 0, 2)
    expect(g.outro.active).toBe(false)
    expect(g.outro.crowdCount).toBe(0)
    expect(g.outro.script).toBeNull()
  })

  it('lite mode (low quality / reduced motion) launches fewer fireworks', () => {
    const count = (lite: boolean): number => {
      const g = new FoldGame({ learned: ALL_LESSONS_LEARNED, demos: false })
      g.outro.lite = lite
      g.startRun(6)
      step(g, 1)
      g.foldNow(0)
      const seen = step(g, 12)
      return seen.filter((e) => e.type === 'firework' && e.b === 1).length
    }
    const full = count(false)
    const lite = count(true)
    expect(full).toBeGreaterThan(0)
    expect(lite).toBeGreaterThan(0)
    expect(lite).toBeLessThan(full)
  })
})
