import { describe, expect, it } from 'vitest'
import { FoldGame } from '@/fold/logic/game'
import { BOAT, ENEMY, KRAKEN, PLEAT, RUSH, SCORE, SPAWN_Z } from '@/fold/logic/config'
import { spawnEnemy } from '@/fold/logic/entities'
import {
  boatAlong, boatPoint, boatReaches, createFold, grabLength, inChannel, isSailing, onFootprint, pleatCount, pleatFold,
  pleatSectionAt, pleatShut, snapFold, updateFold
} from '@/fold/logic/folds'
import { BOOKS, asBookId, boatLine, isBookId, pageDef, pleatLine } from '@/fold/logic/pages'
import { bossClock, bossPhaseCode, createBoss, resetBoss } from '@/fold/logic/boss'
import {
  KRAKEN_FLAT, KRAKEN_INK, KRAKEN_PACED, KRAKEN_PHASE, KRAKEN_SLAM, krakenClock, krakenTiming, stepKraken, type KrakenEnv
} from '@/fold/logic/kraken'
import { createRng } from '@/fold/logic/rng'
import { bossPageOf, rushPar } from '@/fold/logic/rush'
import { parFor } from '@/fold/logic/stars'
import { SECRETS, secretOnPage } from '@/fold/logic/secrets'
import { KILL_CAPSIZE, KILL_CRUSH } from '@/fold/logic/events'
import type { BookId, LessonId, PageId } from '@/fold/logic/types'
import { ALL_LESSONS_LEARNED, botStep, run } from './bot'

// Roadmap #3: Book 3 — "The Sea of Paper" (aethel-fold-GDD §13).

const DT = 1 / 60

const step = (g: FoldGame, s: number, each?: () => void): void => {
  for (let t = 0; t < s; t += DT) {
    each?.()
    g.update(DT)
    g.events.clear()
  }
}

/** Tick until `cond` (or `s` seconds). `each` runs after every tick, with that tick's events still in the queue. */
const until = (g: FoldGame, s: number, cond: () => boolean, each?: () => void): boolean => {
  for (let t = 0; t < s; t += DT) {
    if (cond()) return true
    g.update(DT)
    each?.()
    g.events.clear()
  }
  return cond()
}

const game = (page: PageId, learned: Partial<Record<LessonId, boolean>> = ALL_LESSONS_LEARNED, seed = 3): FoldGame => {
  const g = new FoldGame({ seed, learned, book: 3 })
  g.startRun(page, 0, 3)
  return g
}

const foldIndex = (g: FoldGame, id: string): number => g.folds.findIndex((f) => f.def.id === id)

/** A knight standing still (it never walks off its spot) at (x, z). */
const parked = (g: FoldGame, x: number, z: number, type: 'knight' | 'brute' | 'leaper' = 'knight'): number => {
  const slot = spawnEnemy(g.enemies, type, x, z, 0, 0)
  g.enemies[slot]!.speed = 0
  return slot
}

describe('book 3 — the pages', () => {
  it('six pages: five fought with the sling and both ballistas, the kraken on page 5, a fish at the end', () => {
    expect(isBookId(3)).toBe(true)
    expect(asBookId(3)).toBe(3)
    expect(asBookId('3')).toBe(3)
    expect(asBookId(4)).toBe(1)
    for (let p = 1; p <= 6; p++) {
      const def = pageDef(3, p as PageId)
      expect(def.book).toBe(3)
      if (def.exit !== 'finale') {
        expect(def.sling, `p${p}`).toBeTruthy()
        expect(def.folds.filter((f) => f.kind === 'ballista'), `p${p}`).toHaveLength(2)
      }
    }
    expect(BOOKS[3][5].exit).toBe('boss')
    expect(BOOKS[3][5].boss).toBe('kraken')
    expect(bossPageOf(3)).toBe(5)
    expect(BOOKS[3][6].finale).toBe('fish')
    // The boat and the pleat are taught on pages 1 and 2 and both return on 3 and 4.
    const kinds = (p: PageId) => BOOKS[3][p].folds.map((f) => f.kind)
    expect(kinds(1)).toContain('boat')
    expect(kinds(2)).toContain('pleat')
    for (const p of [3, 4] as PageId[]) {
      expect(kinds(p)).toContain('boat')
      expect(kinds(p)).toContain('pleat')
    }
    expect(BOOKS[3][1].folds.find((f) => f.kind === 'boat')!.lesson).toBe('boat')
    expect(BOOKS[3][2].folds.find((f) => f.kind === 'pleat')!.lesson).toBe('pleat')
    expect(BOOKS[3][1].waves[0]!.lesson).toBe('boat')
    expect(BOOKS[3][2].waves[0]!.lesson).toBe('pleat')
  })

  it('no two cut flaps overlap, and no page has a structure across the top (walkers enter from the sea)', () => {
    for (let p = 1; p <= 6; p++) {
      const def = pageDef(3, p as PageId)
      // Nothing stands across the top edge, so lanes spawn at the top as on book 1's page 1.
      expect(def.spawnZ ?? SPAWN_Z).toBe(SPAWN_Z)
      const folds = def.folds.filter((f) => f.kind !== 'ballista' && f.kind !== 'frog').map(createFold)
      // Sample each fold's footprint (a boat's is its whole channel; its flap is the dock) against the others.
      for (let i = 0; i < folds.length; i++) {
        for (let j = i + 1; j < folds.length; j++) {
          const a = folds[i]!
          const b = folds[j]!
          let hits = 0
          for (let x = -5; x <= 5; x += 0.1) for (let z = -7; z <= 7; z += 0.1) if (onFootprint(a, x, z) && onFootprint(b, x, z)) hits++
          expect(hits, `p${p}: ${a.def.id} × ${b.def.id}`).toBe(0)
        }
      }
    }
  })

  it('pars are finite and above what a perfect clear banks anyway (the par rule)', () => {
    for (let p = 1; p <= 6; p++) {
      const def = pageDef(3, p as PageId)
      expect(Number.isFinite(def.par)).toBe(true)
      expect(def.par).toBe(parFor(def))
      if (def.exit === 'finale') {
        expect(def.par).toBe(SCORE.frog)
        continue
      }
      let guaranteed = SCORE.perfectPage
      for (const w of def.waves) for (const s of w.spawns) guaranteed += ENEMY[s.type].score
      if (def.exit === 'boss') guaranteed += SCORE.boss + 5 * SCORE.weakpoint
      expect(def.par, `p${p}`).toBeGreaterThan(guaranteed)
    }
  })

  it('the bot clears every page of book 3 perfectly, and earns ★★★ on each rated page', () => {
    for (const seed of [1, 5]) {
      for (let p = 1; p <= 5; p++) {
        const g = game(p as PageId, ALL_LESSONS_LEARNED, seed)
        let crumpled = false
        let stars = -1
        until(g, 240, () => stars >= 0 || crumpled, () => {
          for (let i = 0; i < g.events.count; i++) {
            const e = g.events.items[i]!
            if (e.type === 'crumple') crumpled = true
            if (e.type === 'pageCleared') stars = e.c
          }
          botStep(g)
        })
        expect(crumpled, `seed ${seed} p${p}`).toBe(false)
        expect(stars, `seed ${seed} p${p}`).toBe(3)
      }
    }
  })

  it('the whole book in one run: pages 1–6, the kraken, the fish, VICTORY', () => {
    const g = game(1)
    const pages = new Set<number>()
    const ok = run(g, 900, () => {
      pages.add(g.pageId)
      return g.phase === 'victory'
    })
    expect(ok).toBe(true)
    expect([...pages].sort()).toEqual([1, 2, 3, 4, 5, 6])
    expect(g.book).toBe(3)
  })
})

describe('book 3 — the boat fold (snap and capsize rules)', () => {
  const def = boatLine('b', -4.7, 4.7, -1.5, 0.75)

  it('the channel is the strip either side of the line; the finger takes hold at the dock only', () => {
    const f = createFold(def)
    expect(inChannel(f, 0, -1.5)).toBe(true)
    expect(inChannel(f, 0, -2.2)).toBe(true)
    expect(inChannel(f, 0, -2.4)).toBe(false)
    expect(inChannel(f, 0, -0.6)).toBe(false)
    expect(grabLength(f)).toBe(BOAT.dock)
    const g = game(1)
    const i = foldIndex(g, 's1-boat')
    // On the dock flap: its own fold. Out in the middle of the channel: not a grab.
    expect(g.pickFold(-4.7 + BOAT.dock / 2, -1.5)).toBe(i)
    expect(g.pickFold(0, -1.5)).not.toBe(i)
    // The player's side is +n whichever bank the dock is on.
    const right = createFold(boatLine('r', 4.7, -4.7, -1.5, 0.75))
    expect(right.nz).toBeGreaterThan(0)
    expect(f.nz).toBeGreaterThan(0)
  })

  it('folded, it sails the channel out and back over the voyage, then unfolds at the dock and cools down', () => {
    const f = createFold(def)
    f.phase = 'ready'
    expect(snapFold(f)).toBe(true)
    let t = 0
    while (f.phase === 'snapping' && t < 1) {
      updateFold(f, DT)
      t += DT
    }
    expect(f.phase).toBe('up')
    expect(isSailing(f)).toBe(true)
    const home = boatAlong(f, 0)
    expect(boatAlong(f, 0.5)).toBeGreaterThan(f.len - 1)
    expect(boatAlong(f, 1)).toBeCloseTo(home, 6)
    let far = 0
    let s = 0
    while (f.phase === 'up' && s < BOAT.voyage + 1) {
      updateFold(f, DT)
      far = Math.max(far, boatAlong(f, f.sail))
      s += DT
    }
    expect(s).toBeGreaterThan(BOAT.voyage - 0.1)
    expect(s).toBeLessThan(BOAT.voyage + 0.1)
    expect(far).toBeGreaterThan(f.len - 1)
    expect(f.phase).toBe('lowering')
    while (f.phase === 'lowering') updateFold(f, DT)
    expect(f.phase).toBe('cooldown')
    expect(f.sail).toBe(0)
    while (f.phase === 'cooldown') updateFold(f, DT)
    expect(f.phase).toBe('ready')
  })

  it('it capsizes only the waders within reach of its bow — not the dry-land marchers, not one far off', () => {
    const f = createFold(def)
    f.phase = 'up'
    f.t = 1
    f.sail = 0.25
    const out = { x: 0, z: 0 }
    boatPoint(f, out)
    expect(boatReaches(f, out.x, out.z)).toBe(true)
    expect(boatReaches(f, out.x + BOAT.reach * 0.9, -1.2)).toBe(true)
    expect(boatReaches(f, out.x + BOAT.reach + 0.5, -1.5)).toBe(false)
    expect(boatReaches(f, out.x, 0.5)).toBe(false)
    // Not sailing: nobody is capsized.
    f.phase = 'ready'
    expect(boatReaches(f, out.x, out.z)).toBe(false)
  })

  it('in the game: waders are slowed, the sailing boat capsizes them (a kill each, a growing chain), a leaper in the air sails over', () => {
    const g = game(1)
    step(g, 0.05)
    const i = foldIndex(g, 's1-boat')
    // Wading pace: half a knight's march.
    const wader = spawnEnemy(g.enemies, 'knight', 1.9, -1.8, 0, 0)
    const dry = spawnEnemy(g.enemies, 'knight', -1.9, 1.5, 1, 0)
    g.enemies[wader]!.lane = 0
    const z0 = g.enemies[wader]!.z
    const zd0 = g.enemies[dry]!.z
    step(g, 0.2)
    const wadeV = (g.enemies[wader]!.z - z0) / 0.2
    const dryV = (g.enemies[dry]!.z - zd0) / 0.2
    expect(wadeV).toBeGreaterThan(0)
    expect(wadeV / dryV).toBeCloseTo(BOAT.wade, 1)
    g.enemies[dry]!.state = 'dead'
    g.enemies[wader]!.state = 'dead'
    // Three waders strung along the channel, one on the far bank, a leaper high in the air over the water.
    const a = parked(g, -2, -1.5)
    const b = parked(g, 0.5, -1.3)
    const c = parked(g, 3, -1.7)
    const bank = parked(g, 3, -0.2)
    const flyer = parked(g, 1, -1.5, 'leaper')
    g.enemies[flyer]!.state = 'leap'
    g.enemies[flyer]!.y = 2.5
    g.enemies[flyer]!.vy = 0.001
    expect(g.foldNow(i)).toBe(true)
    const caps: number[] = []
    const chain: number[] = []
    until(g, BOAT.voyage + 1, () => g.folds[i]!.phase === 'lowering', () => {
      for (let k = 0; k < g.events.count; k++) {
        const e = g.events.items[k]!
        if (e.type === 'capsize') caps.push(e.a)
        if (e.type === 'kill' && e.c === KILL_CAPSIZE) chain.push(e.b)
      }
      // Keep the leaper aloft for the whole voyage.
      const fl = g.enemies[flyer]!
      fl.y = 2.5
      fl.vy = 0.001
    })
    expect(caps).toEqual([a, b, c])
    expect(g.stats.capsized).toBe(3)
    // The multi-kill chain grows along the voyage.
    expect(chain[2]!).toBeGreaterThan(chain[0]!)
    expect(g.enemies[bank]!.state).toBe('march')
    expect(g.enemies[flyer]!.state).toBe('leap')
  })

  it('it teaches itself wordlessly: the boat lesson starts when a column wades in, demonstrates on the dock flap, ends on the fold', () => {
    const learned = { ...ALL_LESSONS_LEARNED, boat: false }
    const g = game(1, learned)
    expect(until(g, 20, () => g.lesson.id === 'boat')).toBe(true)
    const i = foldIndex(g, 's1-boat')
    expect(g.lesson.target).toBe(i)
    expect(g.lesson.demo.phase).toBe('show')
    expect(g.lesson.demo.on).toBe('fold')
    expect(g.lesson.demo.target).toBe(i)
    expect(g.lesson.demo.kind).toBe('swipe')
    expect(g.lesson.showHand).toBe(true)
    // The hand sweeps along the channel from the dock.
    expect(g.lesson.hand.bx).toBeGreaterThan(g.lesson.hand.ax)
    expect(Math.abs(g.lesson.hand.az - -1.5)).toBeLessThan(0.01)
    // The world slows to a crawl (and freezes as the column reaches the middle); the fold stays live.
    step(g, 2)
    expect(g.timeScale).toBeLessThan(0.2)
    expect(g.foldNow(i)).toBe(true)
    step(g, 0.3)
    expect(g.lesson.id).toBeNull()
    expect(g.learned.boat).toBe(true)
  })

  it('with hold to fold, the boat lesson demonstrates the press and hold', () => {
    const g = new FoldGame({ seed: 3, learned: { ...ALL_LESSONS_LEARNED, boat: false }, book: 3 })
    g.holdToFold = true
    g.startRun(1, 0, 3)
    expect(until(g, 20, () => g.lesson.id === 'boat')).toBe(true)
    expect(g.lesson.demo.kind).toBe('hold')
  })
})

describe('book 3 — the pleat (sequential crease rules)', () => {
  const def = pleatLine('p', 0, -4.6, 0.6, 0.95)

  it('sections shut top to bottom, one after another, as t rises', () => {
    const f = createFold(def)
    const n = pleatCount(f)
    expect(n).toBe(PLEAT.creases)
    expect(pleatShut(f, 0)).toBe(0)
    expect(pleatShut(f, 0.24)).toBe(0)
    expect(pleatShut(f, 0.25)).toBe(1)
    expect(pleatShut(f, 0.6)).toBe(2)
    expect(pleatShut(f, 1)).toBe(4)
    expect(pleatFold(f, 0, 0.125)).toBeCloseTo(0.5, 6)
    expect(pleatFold(f, 1, 0.125)).toBe(0)
    expect(pleatFold(f, 3, 1)).toBe(1)
    // Which section a point stands on (top = 0), and off the strip.
    expect(pleatSectionAt(f, 0, -4.4)).toBe(0)
    expect(pleatSectionAt(f, 0.5, -1.0)).toBe(2)
    expect(pleatSectionAt(f, 0, 0.5)).toBe(3)
    expect(pleatSectionAt(f, 1.5, -1.0)).toBe(-1)
  })

  it('released, the rest shut at a steady beat — never two in one frame', () => {
    const f = createFold(def)
    f.phase = 'ready'
    snapFold(f)
    let frames = 0
    let last = 0
    const at: number[] = []
    while (f.phase === 'snapping' && frames < 200) {
      updateFold(f, DT)
      frames++
      const s = pleatShut(f)
      expect(s - last).toBeLessThanOrEqual(1)
      if (s > last) at.push(frames)
      last = s
    }
    expect(f.phase).toBe('up')
    expect(at).toHaveLength(4)
    const gap = PLEAT.sectionTime / DT
    for (let k = 1; k < at.length; k++) expect(at[k]! - at[k - 1]!).toBeGreaterThanOrEqual(Math.floor(gap) - 1)
  })

  it('following the finger: a half drag crushes the column\'s head sections only; springing back crushes nothing more', () => {
    const g = game(2)
    step(g, 0.05)
    const i = foldIndex(g, 's2-pleat')
    const f = g.folds[i]!
    const s0 = parked(g, 0, -4.2)
    const s1 = parked(g, 0.3, -3.0)
    const s3 = parked(g, -0.2, 0.2)
    expect(g.grab(i)).toBe(true)
    const order: number[] = []
    const sections: number[] = []
    const watch = () => {
      for (let k = 0; k < g.events.count; k++) {
        const e = g.events.items[k]!
        if (e.type === 'kill' && e.c === KILL_CRUSH) order.push(e.a)
        if (e.type === 'pleat') sections.push(e.c)
      }
    }
    // The finger drags half way down: sections 0 and 1 shut under it.
    for (let t = 0; t < 0.5; t += DT) {
      g.drag(i, Math.min(0.55, t * 2))
      g.update(DT)
      watch()
      g.events.clear()
    }
    expect(sections).toEqual([0, 1])
    expect(order).toEqual([s0, s1])
    expect(g.enemies[s3]!.state).toBe('march')
    // Let go before the threshold? This far in it snaps: the rest shut in sequence.
    g.release(i, 0)
    until(g, 1, () => f.phase === 'up', () => {
      watch()
    })
    expect(sections).toEqual([0, 1, 2, 3])
    expect(order).toEqual([s0, s1, s3])
    expect(g.stats.crushed).toBe(3)
  })

  it('let go early, it springs open again and crushes nothing on the way back', () => {
    const g = game(2)
    step(g, 0.05)
    const i = foldIndex(g, 's2-pleat')
    const f = g.folds[i]!
    const victim = parked(g, 0, -4.3)
    g.grab(i)
    for (let t = 0; t < 0.4; t += DT) {
      g.drag(i, 0.3)
      g.update(DT)
      g.events.clear()
    }
    expect(f.sections).toBe(1)
    expect(g.enemies[victim]!.state).toBe('crushed')
    g.release(i, 0)
    step(g, 1)
    expect(f.phase).toBe('ready')
    expect(f.sections).toBe(0)
    expect(g.stats.crushed).toBe(1)
  })

  it('the pleat lesson starts when two walk onto it, runs its ghost down the strip, and ends on the fold', () => {
    const g = game(2, { ...ALL_LESSONS_LEARNED, pleat: false })
    expect(until(g, 25, () => g.lesson.id === 'pleat')).toBe(true)
    const i = foldIndex(g, 's2-pleat')
    expect(g.lesson.target).toBe(i)
    expect(g.lesson.demo.on).toBe('fold')
    expect(g.lesson.demo.target).toBe(i)
    // The hand runs down the strip.
    expect(g.lesson.hand.bz).toBeGreaterThan(g.lesson.hand.az + 2)
    expect(g.foldNow(i)).toBe(true)
    step(g, 0.6)
    expect(g.learned.pleat).toBe(true)
  })
})

// ─── The kraken ──────────────────────────────────────────────────────────────

const env = (seed = 9): KrakenEnv => ({ rng: createRng(seed), introDelay: 0.5, pace: 1, heroX: 0 })

/** Step the pure machine until `phase` (or `max` seconds). Returns the accumulated flags. */
const runTo = (b: ReturnType<typeof createBoss>, e: KrakenEnv, phase: string, max = 30): number => {
  let flags = 0
  for (let t = 0; t < max && b.phase !== phase; t += DT) flags |= stepKraken(b, DT, e)
  return flags
}

describe('the kraken\'s state machine (pure)', () => {
  it('asleep → surfaces → roars → attacks, alternating ink and slam, then bares a tentacle', () => {
    const b = createBoss('kraken')
    const e = env()
    expect(b.kind).toBe('kraken')
    expect(b.weakPoints.map((w) => [w.limb, w.mode])).toEqual([
      ['tentacleL', 'crease'], ['tentacleR', 'crease'], ['tentacleL2', 'crease'], ['tentacleR2', 'crease'], ['mantle', 'core']
    ])
    expect(runTo(b, e, 'surface') & KRAKEN_PHASE).toBeTruthy()
    runTo(b, e, 'roar')
    runTo(b, e, 'idle')
    runTo(b, e, 'inkCharge')
    const ink = runTo(b, e, 'idle')
    expect(ink & KRAKEN_INK).toBeTruthy()
    expect(b.attacks).toBe(1)
    runTo(b, e, 'slam')
    // It slams one of the lane columns, in front of itself.
    expect([-2.8, 0, 2.8]).toContain(b.aimX)
    expect(b.aimZ).toBe(KRAKEN.slamZ)
    expect(KRAKEN.slamZ).toBeGreaterThan(KRAKEN.bodyZ + KRAKEN.bodyRadius)
    const slam = runTo(b, e, 'idle')
    expect(slam & KRAKEN_SLAM).toBeTruthy()
    expect(slam & KRAKEN_INK).toBeFalsy()
    runTo(b, e, 'exposed')
    expect(b.exposed).toBe(0)
    // Left alone, it covers the tentacle and comes back with the ink.
    runTo(b, e, 'inkCharge')
    expect(b.exposed).toBe(-1)
  })

  it('each strike fires once per attack', () => {
    const b = createBoss('kraken')
    const e = env()
    runTo(b, e, 'ink')
    let inks = 0
    for (let t = 0; t < 5 && b.phase === 'ink'; t += DT) if (stepKraken(b, DT, e) & KRAKEN_INK) inks++
    expect(inks).toBe(1)
  })

  it('four broken tentacles and the mantle fold it flat', () => {
    const b = createBoss('kraken')
    const e = env()
    for (let k = 0; k < 5; k++) {
      runTo(b, e, 'exposed', 60)
      const w = b.weakPoints[b.exposed]!
      w.broken = true
      b.exposed = -1
      b.attacks = 0
      b.phase = 'hurt'
      b.timer = KRAKEN.hurt
      b.phaseTime = 0
    }
    const flags = runTo(b, e, 'flat', 20)
    expect(flags & KRAKEN_FLAT).toBeTruthy()
    expect(b.collapse).toBe(1)
  })

  it('the timing multiplier scales the paced timings only; × 1 is exactly the authored number', () => {
    const b = createBoss('kraken')
    for (const k of KRAKEN_PACED) expect(krakenTiming(b, k)).toBe(KRAKEN[k])
    b.timing = RUSH.timing
    for (const k of KRAKEN_PACED) expect(krakenTiming(b, k)).toBeCloseTo(KRAKEN[k] * RUSH.timing, 12)
    // The views read authored seconds.
    b.phase = 'inkCharge'
    b.phaseTime = 0.7
    expect(krakenClock(b)).toBeCloseTo(1, 12)
    expect(bossClock(b)).toBeCloseTo(1, 12)
    b.phase = 'exposed'
    expect(krakenClock(b)).toBe(0.7)
  })

  it('a machine at timing 1 runs bit-for-bit like one that never heard of the multiplier', () => {
    const trace = (setTiming: boolean): string => {
      const b = createBoss('kraken')
      if (setTiming) b.timing = 1
      const e = env(4)
      const out: string[] = []
      for (let f = 0; f < 60 * 40; f++) {
        const r = stepKraken(b, DT, e)
        if (r) out.push(`${f}:${r}:${b.phase}:${b.timer.toFixed(6)}:${b.aimX.toFixed(5)}`)
        if (b.phase === 'exposed' && b.phaseTime > 1) {
          b.weakPoints[b.exposed]!.broken = true
          b.exposed = -1
          b.attacks = 0
          b.phase = 'hurt'
          b.timer = KRAKEN.hurt
          b.phaseTime = 0
        }
      }
      return out.join('|')
    }
    expect(trace(true)).toBe(trace(false))
    expect(trace(true).length).toBeGreaterThan(100)
  })

  it('resetBoss swaps the dragon and the kraken in place, and back', () => {
    const b = createBoss()
    const wps = b.weakPoints
    resetBoss(b, 'kraken')
    expect(b.kind).toBe('kraken')
    expect(b.weakPoints).toBe(wps)
    expect(b.weakPoints[0]!.limb).toBe('tentacleL')
    resetBoss(b, 'dragon')
    expect(b.weakPoints[0]!.limb).toBe('legFL')
    expect(b.weakPoints.map((w) => [w.x, w.z])).toEqual(createBoss().weakPoints.map((w) => [w.x, w.z]))
    expect(bossPhaseCode('surface')).toBe(12)
  })
})

describe('the kraken in the game', () => {
  it('its page loads the kraken; book 1 and 2 still load the dragon', () => {
    const g = game(5)
    expect(g.boss.kind).toBe('kraken')
    expect(g.phase).toBe('boss')
    g.startRun(5, 0, 2)
    expect(g.boss.kind).toBe('dragon')
    g.startRun(5, 0, 3)
    expect(g.boss.kind).toBe('kraken')
  })

  it('a raised shield catches the ink jet; without it the hero is hit', () => {
    const run1 = (shield: boolean): { hits: number; blocked: number } => {
      const g = game(5)
      const si = foldIndex(g, 'd5-shield')
      let hits = 0
      let blocked = 0
      until(g, 30, () => g.boss.attacks >= 1, () => {
        for (let k = 0; k < g.events.count; k++) {
          const e = g.events.items[k]!
          if (e.type === 'heroHit') hits++
          if (e.type === 'blocked' && e.c === 5) blocked++
        }
        if (shield && g.boss.phase === 'inkCharge' && g.folds[si]!.phase === 'ready') g.foldNow(si)
      })
      return { hits, blocked }
    }
    expect(run1(false)).toEqual({ hits: 1, blocked: 0 })
    expect(run1(true)).toEqual({ hits: 0, blocked: 1 })
  })

  it('a slam spills boarders in front of the kraken, on the lane under it', () => {
    const g = game(5)
    let spawned: number[] = []
    until(g, 40, () => spawned.length > 0, () => {
      for (let k = 0; k < g.events.count; k++) if (g.events.items[k]!.type === 'spawn') spawned.push(g.events.items[k]!.a)
    })
    spawned = spawned.slice()
    expect(spawned.length).toBeGreaterThanOrEqual(2)
    for (const s of spawned) {
      const e = g.enemies[s]!
      expect(e.z).toBeGreaterThan(KRAKEN.bodyZ + KRAKEN.bodyRadius)
      expect(Math.abs(e.x - g.boss.aimX)).toBeLessThan(1.5)
    }
  })

  it('sling stones on its mantle make it flinch; three bare its next weak point', () => {
    const g = game(5)
    until(g, 20, () => g.boss.phase === 'idle')
    const s = g.sling!
    let hits = 0
    until(g, 20, () => g.boss.phase === 'exposed', () => {
      for (let k = 0; k < g.events.count; k++) if (g.events.items[k]!.type === 'bossHit') hits++
      if (s.cool <= 0 && g.boss.phase !== 'exposed') {
        g.grabSling()
        g.aimSling(-(KRAKEN.bodyX - s.def.x) / 5.5, -(KRAKEN.bodyZ - s.def.z) / 5.5)
        g.releaseSling()
      }
    })
    expect(g.boss.phase).toBe('exposed')
    expect(hits).toBeGreaterThanOrEqual(3)
  })

  it('tentacles break by a swipe along their crease, the mantle by a spread; then it folds flat and the fish page follows', () => {
    const g = game(5)
    const broken: number[] = []
    until(g, 120, () => g.pageId === 6, () => {
      const b = g.boss
      if (b.phase === 'exposed' && b.exposed >= 0) {
        const w = b.weakPoints[b.exposed]!
        broken.push(b.exposed)
        if (w.mode === 'crease') {
          expect(g.pickCrease(w.x, w.z)).toBe(b.exposed)
          g.pullWeak(0.8)
          g.releaseWeak()
        } else {
          expect(g.pickTear(w.x, w.z)).toBe(-2)
          g.pullTear(-2, 1)
        }
      }
      if (b.phase === 'inkCharge') {
        const si = foldIndex(g, 'd5-shield')
        if (g.folds[si]!.phase === 'ready') g.foldNow(si)
      }
      // (The boarders are not this test's business.)
      for (const e of g.enemies) if (e.state === 'march') e.state = 'dead'
    })
    expect(broken).toEqual([0, 1, 2, 3, 4])
    expect(g.boss.weakPoints.every((w) => w.broken)).toBe(true)
    expect(g.pageId).toBe(6)
    expect(g.page.finale).toBe('fish')
  })

  it('a Kraken Rush: the bot beats it under par (≥ 20 % to spare), no stars, no page clear', () => {
    const g = new FoldGame({ seed: 11, learned: ALL_LESSONS_LEARNED })
    g.startRun({ mode: 'dragonRush', book: 3 })
    expect(g.boss.kind).toBe('kraken')
    expect(g.boss.timing).toBe(RUSH.timing)
    expect(g.rush.par).toBe(rushPar(3))
    let done = false
    for (let t = 0; t < 240 && !done; t += DT) {
      botStep(g)
      g.update(DT)
      for (let i = 0; i < g.events.count; i++) {
        const e = g.events.items[i]!
        if (e.type === 'rushDone') done = true
        expect(e.type).not.toBe('pageCleared')
      }
      g.events.clear()
    }
    expect(done).toBe(true)
    expect(g.phase).toBe('rushOver')
    expect(g.rush.time * 1.2).toBeLessThan(rushPar(3))
  })

  it('a faster kraken attacks sooner', () => {
    const firstInk = (timing: number): number => {
      const g = game(5)
      g.boss.timing = timing
      for (let f = 0; f < 60 * 60; f++) {
        g.update(DT)
        for (let i = 0; i < g.events.count; i++) if (g.events.items[i]!.type === 'bossBreath') return f
        g.events.clear()
      }
      return -1
    }
    const slow = firstInk(1)
    const fast = firstInk(RUSH.timing)
    expect(slow).toBeGreaterThan(0)
    expect(fast).toBeLessThan(slow * 0.85)
  })
})

describe('book 3 — secrets', () => {
  it('six secrets, one per page, each on a page that has what it names', () => {
    const mine = SECRETS.filter((s) => s.book === 3)
    expect(mine.map((s) => s.id)).toEqual(['regatta', 'tidepool', 'beacon', 'shipshape', 'tickle', 'jump'])
    for (let p = 1; p <= 6; p++) expect(secretOnPage(3, p), `p${p}`).not.toBeNull()
  })

  const found = (g: FoldGame, id: string, each: () => void, s = 20): boolean => {
    let hit = false
    until(g, s, () => hit, () => {
      each()
      for (let k = 0; k < g.events.count; k++) if (g.events.items[k]!.type === 'secret') hit = true
    })
    return hit && !!g.secrets.found[id]
  }

  it('Harbour: sail the boat three times → regatta', () => {
    const g = game(1)
    const i = foldIndex(g, 's1-boat')
    expect(found(g, 'regatta', () => {
      if (g.folds[i]!.phase === 'ready') g.foldNow(i)
    }, 40)).toBe(true)
  })

  it('Tide Flats: a sling stone into the tide pool → splash', () => {
    const g = game(2)
    const s = g.sling!
    const d = secretOnPage(3, 2)!
    expect(found(g, 'tidepool', () => {
      if (s.cool <= 0 && !g.projectiles.some((p) => p.alive && p.type === 'shot')) {
        g.grabSling()
        g.aimSling(-(d.x - s.def.x) / 5.5, -(d.z - s.def.z) / 5.5)
        g.releaseSling()
      }
    })).toBe(true)
  })

  it('Lighthouse: three taps on the lighthouse → the beacon', () => {
    const g = game(3)
    step(g, 0.5)
    const d = secretOnPage(3, 3)!
    let n = 0
    expect(found(g, 'beacon', () => {
      if (n++ % 10 === 0) g.tap(g.secrets.spotX, g.secrets.spotZ)
    })).toBe(true)
    expect(d.x).toBeGreaterThan(3)
  })

  it('Shipyard: the boat and the pleat folded together → shipshape', () => {
    const g = game(4)
    step(g, 0.5)
    const b = foldIndex(g, 's4-boat')
    const p = foldIndex(g, 's4-pleat')
    expect(found(g, 'shipshape', () => {
      if (g.folds[b]!.phase === 'ready' && g.folds[p]!.phase === 'ready') {
        g.foldNow(b)
        g.foldNow(p)
      }
    })).toBe(true)
  })

  it('The Deep: three taps on the sleeping kraken → it giggles; once it is up, taps do nothing', () => {
    const g = game(5)
    step(g, 0.2)
    let n = 0
    expect(found(g, 'tickle', () => {
      if (n++ % 10 === 0) g.tap(g.secrets.spotX, g.secrets.spotZ)
    }, 1)).toBe(true)
    const late = game(5)
    until(late, 20, () => late.boss.phase === 'idle')
    for (let k = 0; k < 3; k++) late.tap(late.secrets.spotX, late.secrets.spotZ)
    expect(late.secrets.found.tickle).toBeFalsy()
  })

  it('Calm Water: fold the fish, then tap it three times → a big leap', () => {
    const g = game(6)
    step(g, 0.5)
    g.foldNow(0)
    until(g, 5, () => g.phase === 'victory' || g.finaleTime > 2)
    let n = 0
    expect(found(g, 'jump', () => {
      if (n++ % 10 === 0) g.tap(g.secrets.spotX, g.secrets.spotZ)
    }, 5)).toBe(true)
  })
})

describe('book 3 — the other books are untouched', () => {
  it('book 1 and 2 pages have no boat or pleat, and their dragons stay dragons', () => {
    for (const book of [1, 2] as BookId[]) {
      for (const def of Object.values(BOOKS[book])) {
        for (const f of def.folds) expect(['boat', 'pleat']).not.toContain(f.kind)
        if (def.exit === 'boss') expect(def.boss ?? 'dragon').toBe('dragon')
      }
    }
  })

  it('no wading on a page without a channel: a knight marches at its full pace', () => {
    const g = new FoldGame({ seed: 3, learned: ALL_LESSONS_LEARNED, book: 1 })
    g.startRun(1, 0, 1)
    const slot = spawnEnemy(g.enemies, 'knight', 0, -6, 0, 0)
    const e = g.enemies[slot]!
    const v = e.speed
    const z0 = e.z
    g.update(DT)
    expect(e.z - z0).toBeCloseTo(v * DT, 9)
  })
})
