import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FoldGame } from '@/fold/logic/game'
import { KILL_BOLT, KILL_CRUSH, KILL_LAUNCH, KILL_SHOT } from '@/fold/logic/events'
import {
  beatProgress, createDragonPose, createSeaPeekPose, dragonPose, INTRO_BEATS, INTRO_DURATION, INTRO_PAGE, IntroDirector,
  introBeat, introScript, introUrlFlag, SEA_PEEK_SPOT, seaPeekPose, shouldPlayIntro, skipIntro
} from '@/fold/logic/intro'
import { scriptDuration, validateScript } from '@/fold/logic/cutscene'
import { LESSON_IDS } from '@/fold/logic/lessons'
import { PAGE_HALF_D, PAGE_HALF_W } from '@/fold/logic/config'
import type { LessonId } from '@/fold/logic/types'

// Roadmap #12: the first-launch intro — its timeline, the director that plays
// it on a separate demo game, the puppet poses, and when it plays at all.

const DT = 1 / 60
const ALL = Object.fromEntries(LESSON_IDS.map((id) => [id, true])) as Record<LessonId, boolean>

const demoGame = (seed = 0x1a7e0): FoldGame => {
  const g = new FoldGame({ seed, learned: ALL, demos: false, page: INTRO_PAGE })
  g.startRun(1)
  g.events.clear()
  return g
}

interface Moment { t: number; type: string; c: number }

/** Play the whole intro; the events it raised, in order. */
const play = (d: IntroDirector): Moment[] => {
  const out: Moment[] = []
  for (let i = 0; i < 60 * 30 && !d.state.done; i++) {
    d.step(DT)
    const ev = d.game.events
    for (let k = 0; k < ev.count; k++) out.push({ t: d.state.t, type: ev.items[k]!.type, c: ev.items[k]!.c })
    ev.clear()
  }
  return out
}

const first = (m: Moment[], type: string, c?: number): number => {
  const hit = m.find((e) => e.type === type && (c === undefined || e.c === c))
  return hit ? hit.t : Infinity
}

describe('the intro timeline (pure data)', () => {
  it('is a plain beat list in time order, about 15 s long, ending on page 1', () => {
    expect(INTRO_DURATION).toBeGreaterThanOrEqual(14)
    expect(INTRO_DURATION).toBeLessThanOrEqual(16)
    const ids = new Set(INTRO_BEATS.map((b) => b.id))
    expect(ids.size).toBe(INTRO_BEATS.length)
    for (let i = 1; i < INTRO_BEATS.length; i++) expect(INTRO_BEATS[i]!.at).toBeGreaterThanOrEqual(INTRO_BEATS[i - 1]!.at)
    const last = INTRO_BEATS[INTRO_BEATS.length - 1]!
    expect(last.kind).toBe('end')
    expect(last.at).toBe(INTRO_DURATION)
    for (const b of INTRO_BEATS) {
      expect(Number.isFinite(b.at) && Number.isFinite(b.dur)).toBe(true)
      expect(b.at + b.dur).toBeLessThanOrEqual(INTRO_DURATION)
      // Plain data another runner can read: nothing but numbers and strings.
      for (const v of Object.values(b)) expect(['number', 'string']).toContain(typeof v)
    }
  })

  it('shows folds, a ballista, the sling, the dragon, then the sea peek — in that order', () => {
    const order = ['open', 'fold', 'stamp', 'ballistaUp', 'bolt', 'sling', 'dragon', 'seaPeek', 'end'] as const
    const at = (k: (typeof order)[number]): number => INTRO_BEATS.find((b) => b.kind === k)!.at
    for (let i = 1; i < order.length; i++) expect(at(order[i]!), `${order[i]} after ${order[i - 1]}`).toBeGreaterThanOrEqual(at(order[i - 1]!))
    // The input beats all target folds the demo page has.
    for (const b of INTRO_BEATS) if (b.target) expect(INTRO_PAGE.folds.some((f) => f.id === b.target), b.id).toBe(true)
  })

  it('the sea monster peeks for 3 s; the dragon has left before it is gone', () => {
    const sea = introBeat('seaPeek')!
    const dragon = introBeat('dragon')!
    expect(sea.dur).toBeCloseTo(3, 5)
    expect(sea.at + sea.dur).toBeLessThanOrEqual(INTRO_DURATION)
    expect(dragon.at + dragon.dur).toBeLessThan(sea.at + sea.dur)
    expect(beatProgress(sea, sea.at - 0.01)).toBe(-1)
    expect(beatProgress(sea, sea.at + 1.5)).toBeCloseTo(0.5, 5)
  })
})

describe('the director plays the showcase on its own demo game', () => {
  it.each([0x1a7e0, 1, 7, 42, 999])('seed %i: every beat lands, every knight falls, the castle never does', (seed) => {
    const d = new IntroDirector(demoGame(seed))
    const m = play(d)
    expect(d.state.done).toBe(true)
    expect(d.state.skipped).toBe(false)
    expect(d.state.t).toBeCloseTo(INTRO_DURATION, 1)
    expect(d.counts).toEqual({ open: 1, fold: 2, stamp: 2, ballistaUp: 1, bolt: 2, sling: 1, dragon: 1, seaPeek: 1, end: 1 })
    // Folds crush and launch, a bolt and a sling stone kill: each in its beat's order.
    const launch = first(m, 'kill', KILL_LAUNCH)
    const crush = first(m, 'kill', KILL_CRUSH)
    const bolt = first(m, 'kill', KILL_BOLT)
    const shot = first(m, 'kill', KILL_SHOT)
    expect(launch).toBeLessThan(crush)
    expect(crush).toBeLessThan(bolt)
    expect(bolt).toBeLessThan(shot)
    expect(first(m, 'foldSnap')).toBeLessThan(3.2)
    // The battlefield is clear before the dragon arrives, and nobody reached the castle.
    expect(shot).toBeLessThan(introBeat('dragon')!.at)
    expect(d.game.aliveCount()).toBe(0)
    expect(d.game.hero.hp).toBe(3)
    expect(m.some((e) => e.type === 'heroHit' || e.type === 'crumple' || e.type === 'pageCleared' || e.type === 'pageIntro')).toBe(false)
  })

  it('a skip ends it at once; nothing moves after', () => {
    const d = new IntroDirector(demoGame())
    for (let i = 0; i < 120; i++) d.step(DT)
    const t = d.state.t
    skipIntro(d.state)
    expect(d.state.done).toBe(true)
    expect(d.state.skipped).toBe(true)
    const time = d.game.runTime
    d.step(DT)
    expect(d.state.t).toBe(t)
    expect(d.game.runTime).toBe(time)
    // A second skip changes nothing.
    skipIntro(d.state)
    expect(d.state.skipped).toBe(true)
  })

  it("never touches the player's game (a separate FoldGame drives it)", () => {
    const player = new FoldGame({ seed: 5 })
    player.startRun(1)
    player.events.clear()
    const snap = JSON.stringify({ e: player.enemies, f: player.folds, s: player.score, h: player.hero, t: player.runTime, p: player.phase })
    play(new IntroDirector(demoGame()))
    expect(JSON.stringify({ e: player.enemies, f: player.folds, s: player.score, h: player.hero, t: player.runTime, p: player.phase })).toBe(snap)
    expect(player.page).not.toBe(INTRO_PAGE)
  })

  it('the demo page is its own def, reloaded on a restart, never a book page', () => {
    const g = demoGame()
    expect(g.page).toBe(INTRO_PAGE)
    g.restartPage()
    expect(g.page).toBe(INTRO_PAGE)
    // Knights enter on the page, in front of every fold (nothing walks through paper).
    for (const f of INTRO_PAGE.folds) expect(Math.min(f.az, f.bz) - f.depth).toBeGreaterThan(INTRO_PAGE.spawnZ!)
  })
})

describe('one cutscene runner for the intro and the outros', () => {
  it('the timeline is a valid runner script: a windowed cue per beat, the end last', () => {
    const s = introScript()
    expect(validateScript(s)).toEqual([])
    expect(scriptDuration(s)).toBe(INTRO_DURATION)
    expect(s.beats).toHaveLength(INTRO_BEATS.length)
    INTRO_BEATS.forEach((b, i) => {
      const c = s.beats[i]!
      expect(c.at).toBe(b.at)
      if (b.kind === 'end') expect(c.kind).toBe('end')
      else expect(c).toEqual({ at: b.at, kind: 'cue', dur: b.dur, cue: i })
    })
  })

  it('the director plays it on the shared CutsceneRunner (its clock is the intro clock)', () => {
    const d = new IntroDirector(demoGame())
    expect(d.runner.active).toBe(true)
    expect(d.runner.script?.id).toBe('intro')
    for (let i = 0; i < 90; i++) d.step(DT)
    expect(d.state.t).toBe(d.runner.time)
    skipIntro(d.state)
    d.step(DT)
    expect(d.runner.active).toBe(false)
  })

  it('real time: at 10 fps the intro still lasts 15 s, and every beat still lands (the demo game sub-steps)', () => {
    const d = new IntroDirector(demoGame())
    let frames = 0
    while (!d.state.done && frames < 1000) {
      d.step(0.1)
      d.game.events.clear()
      frames++
    }
    expect(d.state.done).toBe(true)
    expect(d.state.t).toBeGreaterThanOrEqual(INTRO_DURATION - 1e-6)
    expect(d.state.t).toBeLessThan(INTRO_DURATION + 0.1 + 1e-6)
    expect(d.counts).toEqual({ open: 1, fold: 2, stamp: 2, ballistaUp: 1, bolt: 2, sling: 1, dragon: 1, seaPeek: 1, end: 1 })
    expect(d.game.hero.hp).toBe(3)
  })
})

describe('puppet poses', () => {
  it('the dragon arrives from beyond the page, breathes fire only over it, and leaves off-screen', () => {
    const b = introBeat('dragon')!
    const p = createDragonPose()
    expect(dragonPose(b.at - 0.1, p).on).toBe(false)
    dragonPose(b.at, p)
    expect(p.on).toBe(true)
    expect(p.z).toBeLessThan(-PAGE_HALF_D - 5)
    let fired = 0
    for (let t = b.at; t <= b.at + b.dur; t += 0.05) {
      const q = dragonPose(t, p)
      expect(q).toBe(p)
      for (const v of [q.x, q.y, q.z, q.yaw, q.pitch, q.roll, q.flap]) expect(Number.isFinite(v)).toBe(true)
      expect(q.y).toBeGreaterThan(2.5)
      if (q.fire) {
        fired += 0.05
        expect(Math.abs(q.aimX)).toBeLessThan(PAGE_HALF_W)
        expect(Math.abs(q.aimZ)).toBeLessThan(PAGE_HALF_D)
      }
    }
    expect(fired).toBeGreaterThan(1)
    dragonPose(b.at + b.dur, p)
    expect(p.x).toBeGreaterThan(PAGE_HALF_W + 8)
    expect(dragonPose(b.at + b.dur + 0.1, p).on).toBe(false)
  })

  it('the sea monster rises behind the page, idles, and sinks away within its 3 s', () => {
    const b = introBeat('seaPeek')!
    const p = createSeaPeekPose()
    expect(seaPeekPose(b.at - 0.1, p).on).toBe(false)
    expect(seaPeekPose(b.at + 0.01, p).rise).toBeLessThan(0.05)
    expect(seaPeekPose(b.at + b.dur * 0.5, p).rise).toBeCloseTo(1, 2)
    expect(p.sea).toBeCloseTo(1, 2)
    expect(seaPeekPose(b.at + b.dur, p).rise).toBeLessThan(0.01)
    expect(p.sea).toBeLessThan(0.01)
    expect(p.z).toBe(SEA_PEEK_SPOT.z)
    expect(p.z).toBeLessThan(-PAGE_HALF_D)
  })
})

describe('when the intro plays', () => {
  it('only on a true first launch', () => {
    expect(shouldPlayIntro({ seen: false, progress: false })).toBe(true)
    expect(shouldPlayIntro({ seen: true, progress: false })).toBe(false)
    expect(shouldPlayIntro({ seen: false, progress: true })).toBe(false)
    expect(shouldPlayIntro({ seen: true, progress: true })).toBe(false)
    expect(shouldPlayIntro({ seen: false, progress: false }, 'never')).toBe(false)
    expect(shouldPlayIntro({ seen: true, progress: true }, 'always')).toBe(true)
  })

  it('reads the URL flag; automation never sees it unless it asks', () => {
    expect(introUrlFlag('', '#/', false, false)).toBe('policy')
    expect(introUrlFlag('', '#/', true, true)).toBe('never')
    expect(introUrlFlag('?intro=1', '', true, true)).toBe('policy')
    expect(introUrlFlag('', '#/?intro=1', true, true)).toBe('policy')
    expect(introUrlFlag('?season=none&intro=0', '', false, false)).toBe('never')
    expect(introUrlFlag('?intro=force', '', true, true)).toBe('always')
    // `force` is a debug switch: a player's build treats it as the policy.
    expect(introUrlFlag('?intro=force', '', false, false)).toBe('policy')
  })
})

describe('"intro seen" lives in aethel_state (useFoldProgress)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('a fresh player: no progress, not seen; marking it seen saves once and survives a reload', async () => {
    vi.useFakeTimers()
    try {
      const prog = await import('@/use/useFoldProgress')
      expect(prog.introProfile()).toEqual({ seen: false, progress: false })
      prog.markIntroSeen()
      prog.markIntroSeen()
      expect(prog.introProfile().seen).toBe(true)
      const { getState, flushPersist } = await import('@/use/useAethelState')
      const { INTRO_KEY } = await import('@/keys')
      expect(INTRO_KEY).toBe('fold_intro')
      expect(getState(INTRO_KEY)).toBe(true)
      flushPersist()
      const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
      expect(keys).toEqual(['aethel_state'])
      vi.resetModules()
      const again = await import('@/use/useFoldProgress')
      expect(again.introSeen.value).toBe(true)
      expect(shouldPlayIntro(again.introProfile())).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['a run started', { fold_runs: 1 }],
    ['a lesson learned', { fold_lessons: { swipe: true } }],
    ['a page cleared', { fold_cleared: 1 }],
    ['a bookmark past page 1', { fold_page: 3 }],
    ['a star', { fold_stars: { b1p1: 2 } }],
    ['a secret', { fold_secrets: ['lamp'] }],
    ['a win', { fold_wins: 1 }]
  ])('a returning player (%s) never gets it', async (_name, state) => {
    localStorage.setItem('aethel_state', JSON.stringify(state))
    const prog = await import('@/use/useFoldProgress')
    expect(prog.introProfile().progress).toBe(true)
    expect(shouldPlayIntro(prog.introProfile())).toBe(false)
  })

  it('mid-intro, the run this very boot started does not count (a late hydrate brings the real progress)', async () => {
    localStorage.setItem('aethel_state', JSON.stringify({ fold_runs: 1, fold_page: 1 }))
    const prog = await import('@/use/useFoldProgress')
    expect(prog.introProfile(false).progress).toBe(false)
    expect(prog.introProfile(true).progress).toBe(true)
  })
})

describe('boot telemetry for the intro (roadmap #13)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('none by default; playing, then skipped or watched once, with the moment page 1 took over', async () => {
    const b = await import('@/use/useBoot')
    expect(b.bootSnapshot().intro).toBe('none')
    expect(b.bootSnapshot().intro_end_ms).toBe(-1)
    b.markIntroEnd(true)
    expect(b.bootSnapshot().intro).toBe('none')
    b.markIntroStart()
    expect(b.bootSnapshot().intro).toBe('playing')
    b.markIntroEnd(true)
    expect(b.bootSnapshot().intro).toBe('skipped')
    expect(b.bootSnapshot().intro_end_ms).toBeGreaterThanOrEqual(0)
    b.markIntroEnd(false)
    b.markIntroStart()
    expect(b.bootSnapshot().intro).toBe('skipped')
  })
})
