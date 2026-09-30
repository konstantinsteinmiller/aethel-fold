/**
 * The first-launch intro (roadmap #12): a ~15 s in-engine showcase, played
 * once, skippable with a tap anywhere.
 *
 * Pure logic, like the rest of `src/fold/logic`: no three.js, no Vue.
 *
 *   INTRO_BEATS   the timeline, as plain data: `{ id, at, dur, kind, target }`:
 *                 a beat is "at `at` seconds, for `dur` seconds, do `kind` to
 *                 `target`". `introScript` turns it into a `CutScript` for the
 *                 one cutscene runner the boss outros use too
 *                 (`CutsceneRunner`, `cutscene.ts`): every beat but the end is a
 *                 windowed `cue` beat, the end is the script's `end`.
 *   INTRO_PAGE    the demo page it plays on (its own def: never a page of a
 *                 book, never saved).
 *   IntroDirector the runner's cue host: it drives a *separate* `FoldGame` (the
 *                 demo game) through the public input API — `foldNow`, `stamp`,
 *                 `fireBallista`, `slingAt` — on the beats' cues. Each input
 *                 beat has a window: it fires on the first frame its condition
 *                 holds (enough knights on the flap, a crowd to crush), or at the
 *                 window's end regardless, so the show never waits on the
 *                 simulation. The timeline runs on the real clock (the runner's);
 *                 the demo game sub-steps it, so a slow phone neither stretches
 *                 the 15 s nor lets the show fall behind it.
 *   dragonPose / seaPeekPose
 *                 the two puppet beats (the dragon's fly-over and the sea
 *                 monster's peek) as pure functions of time: the view just
 *                 poses its models from them.
 *   shouldPlayIntro / introUrlFlag
 *                 when the intro plays at all (see below).
 *
 * When it plays (the "boot straight into page 1" contract, GDD §6):
 *   - only on the very first launch: no progress of any kind in `aethel_state`
 *     and the `fold_intro` flag unset. Returning players, and anyone with any
 *     progress, boot straight into their page as before;
 *   - it *is* the boot's first picture: page 1 is built and compiled behind it
 *     (frozen), so a tap anywhere drops the player onto page 1 at once, with
 *     no load; left alone it ends into page 1 by itself after `INTRO_DURATION`;
 *   - it ends once, for good (`fold_intro` is written on skip or end); the
 *     pause menu's settings can replay it.
 * The player's own game is never touched: the demo game is a separate
 * `FoldGame` whose events feed only the intro's view and the audio.
 */

import { BREACH_Z, OUTRO, PAGE_HALF_D } from './config'
import { CutsceneRunner, type CutBeat, type CutCueHost, type CutScript } from './cutscene'
import { EventQueue } from './events'
import type { FoldGame } from './game'
import { isGrabbable, isStampable, onFootprint } from './folds'
import { clamp01, easeInOutCubic, lerp, smoothstep } from './math'
import { ballistaLine, lane, valleyLine, wallLine } from './pages'
import type { EnemyType, PageDef, SpawnDef } from './types'

// ─── The timeline ──────────────────────────────────────────────────────────

export type IntroBeatKind =
  | 'open'       // the demo page pops up, the first knights march on
  | 'fold'       // snap a fold (a wall launches, a valley traps)
  | 'stamp'      // slam a raised fold down on whoever it holds (crush)
  | 'ballistaUp' // flip a tower ballista open
  | 'bolt'       // loose a ballista bolt at the lead of a column
  | 'sling'      // a sling stone into the thickest crowd
  | 'dragon'     // the origami dragon flies over, breathes paper fire, flies off
  | 'seaPeek'    // a sea monster peeks up behind the page, does nothing, sinks
  | 'end'        // the intro is over: page 1

export interface IntroBeat {
  /** Stable name (tests, debugging, another runner). */
  readonly id: string
  /** Seconds from the start of the intro. */
  readonly at: number
  /** Seconds the beat lasts (an input beat: its window). */
  readonly dur: number
  readonly kind: IntroBeatKind
  /** The fold id an input beat acts on. */
  readonly target?: string
  /** Input beats: act as soon as at least this many enemies are in reach (else at the window's end). */
  readonly min?: number
}

/**
 * The intro, second by second. Input beats act inside their window on the
 * frame their condition holds; the rest are timed exactly.
 */
export const INTRO_BEATS: readonly IntroBeat[] = [
  { id: 'open', at: 0, dur: 1.4, kind: 'open' },
  { id: 'tower', at: 2.0, dur: 1.0, kind: 'fold', target: 'intro-tower', min: 2 },
  { id: 'ditch', at: 3.0, dur: 1.0, kind: 'fold', target: 'intro-ditch', min: 2 },
  { id: 'crushDitch', at: 3.9, dur: 0.8, kind: 'stamp', target: 'intro-ditch', min: 1 },
  { id: 'ballista', at: 4.4, dur: 0.4, kind: 'ballistaUp', target: 'ballista-r' },
  { id: 'bolt1', at: 5.2, dur: 0.6, kind: 'bolt', target: 'ballista-r', min: 1 },
  { id: 'crushTower', at: 5.7, dur: 1.2, kind: 'stamp', target: 'intro-tower', min: 2 },
  { id: 'bolt2', at: 6.4, dur: 0.6, kind: 'bolt', target: 'ballista-r', min: 1 },
  { id: 'sling', at: 6.9, dur: 0.9, kind: 'sling', min: 2 },
  { id: 'dragon', at: 8.0, dur: 4.6, kind: 'dragon' },
  { id: 'seaPeek', at: 11.4, dur: 3.0, kind: 'seaPeek' },
  { id: 'end', at: 15.0, dur: 0, kind: 'end' }
]

/** Seconds from the first frame to page 1 when nobody taps. */
export const INTRO_DURATION = INTRO_BEATS[INTRO_BEATS.length - 1]!.at

/** The first beat of a kind (the puppet beats appear once). */
export const introBeat = (kind: IntroBeatKind, beats: readonly IntroBeat[] = INTRO_BEATS): IntroBeat | null => {
  for (const b of beats) if (b.kind === kind) return b
  return null
}

/**
 * The timeline as a script for the cutscene runner: each beat a `cue` beat
 * (its index in `beats` is the cue number), the last one the `end`.
 * Built once per director (allocates).
 */
export const introScript = (beats: readonly IntroBeat[] = INTRO_BEATS): CutScript => ({
  id: 'intro',
  beats: beats.map((b, i): CutBeat => (b.kind === 'end' ? { at: b.at, kind: 'end' } : { at: b.at, kind: 'cue', dur: b.dur, cue: i }))
})

/** 0…1 through a beat at time `t`, or −1 outside it. */
export const beatProgress = (b: IntroBeat | null, t: number): number => {
  if (!b || t < b.at || t > b.at + b.dur) return -1
  return b.dur > 0 ? (t - b.at) / b.dur : 1
}

// ─── The demo page ─────────────────────────────────────────────────────────

const k = (type: EnemyType, laneIdx: number, at: number): SpawnDef => ({ type, lane: laneIdx, at })

/**
 * The page the intro plays on: page 1's border country with a tower line on
 * the centre road, a ditch on the left road, both castle ballistas and the
 * keep's sling. Knights enter already on the page (`spawnZ`), in front of
 * every fold, so the show starts at once; a lone straggler at 60 s keeps the
 * page from ever clearing (and turning) while the intro runs.
 */
export const INTRO_PAGE: PageDef = {
  id: 1,
  book: 1,
  nameKey: 'border',
  theme: 'border',
  exit: 'turn',
  introDelay: 0.15,
  par: 0,
  sling: { x: 3.95, z: 5.75 },
  spawnZ: -4.4,
  lanes: [lane(0, 0.2, 0.4), lane(-2.9, 0.25, 1.3), lane(2.9, 0.25, 2.2)],
  folds: [
    wallLine('intro-tower', -1.55, 1.55, -0.9, 2.0, { structure: 'tower' }),
    valleyLine('intro-ditch', -4.6, -1.75, -2.0, 0.85),
    ballistaLine('ballista-l', -2.2),
    ballistaLine('ballista-r', 2.2)
  ],
  tears: [],
  waves: [
    {
      delay: 0,
      spawns: [
        // Centre road: launched by the tower line.
        k('knight', 0, 0), k('knight', 0, 0.4), k('knight', 0, 0.8),
        // Left road: into the ditch, then crushed.
        k('knight', 1, 0.5), k('knight', 1, 0.9), k('knight', 1, 1.3),
        // Right road: a column the ballista's bolts pierce.
        k('knight', 2, 1.5), k('knight', 2, 1.85), k('knight', 2, 2.2),
        // Centre again: they bash the standing tower until it is slammed down on them.
        k('knight', 0, 2.2), k('knight', 0, 2.5), k('knight', 0, 2.8),
        // Left road again: a huddle in the ditch for the sling stone.
        k('knight', 1, 3.9), k('knight', 1, 4.15), k('knight', 1, 4.4),
        // Right road again, once the first bolt has flown: the second bolt's.
        k('knight', 2, 5.65), k('knight', 2, 5.95)
      ]
    },
    // Never reached while the intro runs: the page never clears.
    { delay: 60, spawns: [k('knight', 0, 60)] }
  ]
}

// ─── When it plays ─────────────────────────────────────────────────────────

/** What the save says about the player, as far as the intro cares. */
export interface IntroProfile {
  /** `fold_intro` is set: the intro was watched or skipped (on any device). */
  seen: boolean
  /** Any progress at all: a page past 1, a book past 1, a page cleared, a win, a lesson, a star, a secret, a run started. */
  progress: boolean
}

/** A URL / automation override: `policy` (the rule above), `never`, or `always` (debug builds). */
export type IntroFlag = 'policy' | 'never' | 'always'

/** Does the intro play for this player? Only a true first launch, unless a flag says otherwise. */
export const shouldPlayIntro = (p: IntroProfile, flag: IntroFlag = 'policy'): boolean => {
  if (flag === 'never') return false
  if (flag === 'always') return true
  return !p.seen && !p.progress
}

/**
 * The intro flag from the page URL (`?intro=0|1|force`, before or inside the
 * hash). An automated browser (`navigator.webdriver`: the e2e suite) never
 * sees the intro unless it asks with `?intro=1`, so every spec that expects
 * "boot straight into page 1" keeps booting there. `force` (debug builds
 * only) plays it even for a returning player.
 */
export const introUrlFlag = (search: string, hash: string, webdriver: boolean, debug: boolean): IntroFlag => {
  const read = (q: string): string | null => {
    const i = q.indexOf('?')
    if (i < 0) return null
    for (const part of q.slice(i + 1).split('&')) {
      const [key, value] = part.split('=')
      if (key === 'intro') return value ?? ''
    }
    return null
  }
  const v = read(search) ?? read(hash)
  if (v === '0' || v === 'off' || v === 'false') return 'never'
  if (v === 'force' && debug) return 'always'
  if (v === '1' || v === 'on' || v === 'true' || v === 'force') return 'policy'
  return webdriver ? 'never' : 'policy'
}

// ─── Puppet poses (the view reads these) ───────────────────────────────────

export interface DragonPose {
  /** The dragon is in the air (inside its beat). */
  on: boolean
  x: number
  y: number
  z: number
  /** Heading about y (radians; the model faces +z at 0). */
  yaw: number
  /** Nose up (+) / down. */
  pitch: number
  /** Bank into the turn. */
  roll: number
  /** Breathing paper fire now, and where it lands on the page. */
  fire: boolean
  aimX: number
  aimZ: number
  /** Wing beat speed (× the rig's idle flap). */
  flap: number
}

export const createDragonPose = (): DragonPose => ({
  on: false, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fire: false, aimX: 0, aimZ: 0, flap: 1
})

/**
 * The dragon's flight (page units). It swoops in from beyond the page's top
 * edge, glides *down* the page toward the player breathing fire on the roads
 * ahead of it — facing the camera, so its wings read as on the dragon's page —
 * then banks off to the right and climbs away. Each leg is a straight line
 * with its own easing; the heading follows the path's tangent.
 */
export const DRAGON_PATH = {
  /** Beyond the top edge, high: out of every framing. */
  from: { x: -7, y: 8, z: -17 },
  /** The glide over the battlefield, while it breathes fire. */
  glideFrom: { x: -1.5, y: 3.7, z: -4.6 },
  glideTo: { x: 1.1, y: 3.3, z: 0.4 },
  /** Off past the right edge, climbing. */
  to: { x: 17, y: 7, z: 2.6 },
  /** Fraction of the beat spent arriving and gliding (the rest: leaving). */
  arrive: 0.3,
  glide: 0.42,
  /** Where the fire lands, ahead of the head (along the heading, page units). */
  reach: 3.2
} as const

interface PathPoint {
  x: number
  y: number
  z: number
}

const PT: PathPoint = { x: 0, y: 0, z: 0 }
const PT2: PathPoint = { x: 0, y: 0, z: 0 }

/** A point on the flight at beat progress `p` (0…1). */
const flightAt = (p: number, out: PathPoint): PathPoint => {
  const P = DRAGON_PATH
  const a = P.arrive
  const g = a + P.glide
  let A: PathPoint = P.from
  let B: PathPoint = P.glideFrom
  let k: number
  if (p < a) {
    const q = clamp01(p / a)
    // Fast in, levelling out.
    k = 1 - (1 - q) * (1 - q)
  } else if (p < g) {
    A = P.glideFrom
    B = P.glideTo
    k = (p - a) / P.glide
  } else {
    A = P.glideTo
    B = P.to
    const q = clamp01((p - g) / (1 - g))
    // Slow out of the glide, then away.
    k = q * q
  }
  out.x = lerp(A.x, B.x, k)
  out.y = lerp(A.y, B.y, k)
  out.z = lerp(A.z, B.z, k)
  return out
}

/** The dragon's fly-over at intro time `t` (allocation-free). */
export const dragonPose = (t: number, out: DragonPose, beat: IntroBeat | null = introBeat('dragon')): DragonPose => {
  const p = beatProgress(beat, t)
  out.on = p >= 0
  out.fire = false
  if (!out.on) return out
  const P = DRAGON_PATH
  const here = flightAt(p, PT)
  // The heading from the path's tangent (a small step ahead, or behind at the very end).
  const ahead = p < 0.995 ? flightAt(p + 0.005, PT2) : here
  let dx = ahead.x - here.x
  let dy = ahead.y - here.y
  let dz = ahead.z - here.z
  if (p >= 0.995) {
    flightAt(p - 0.005, PT2)
    dx = here.x - PT2.x
    dy = here.y - PT2.y
    dz = here.z - PT2.z
  }
  const flat = Math.hypot(dx, dz)
  out.x = here.x
  out.y = here.y
  out.z = here.z
  out.yaw = flat > 1e-6 ? Math.atan2(dx, dz) : 0
  out.pitch = flat > 1e-6 ? Math.atan2(dy, flat) : 0
  // Bank into the turn off to the right.
  const g = P.arrive + P.glide
  out.roll = p > g ? -0.35 * smoothstep(g, g + 0.15, p) : 0
  if (p >= P.arrive && p < g) {
    const q = (p - P.arrive) / P.glide
    // Paper fire through the middle of the glide, raking the roads ahead of it.
    out.fire = q > 0.1 && q < 0.9
    const s = flat > 1e-6 ? P.reach / flat : 0
    out.aimX = here.x + dx * s + Math.sin(q * Math.PI * 2) * 0.8
    out.aimZ = here.z + dz * s
  }
  out.flap = out.fire ? 1.4 : 2.6
  return out
}

export interface SeaPeekPose {
  /** Inside the beat (the actor is shown at all). */
  on: boolean
  /** 0…1: the paper sea pops up behind the page (and folds away at the end). */
  sea: number
  /** 0…1: how far the monster has risen out of it. */
  rise: number
  /** Where it surfaces (page units: behind the page's top edge). */
  x: number
  z: number
  /** A slow idle sway (radians), and the beat's own clock (s). */
  sway: number
  time: number
}

export const createSeaPeekPose = (): SeaPeekPose => ({ on: false, sea: 0, rise: 0, x: 0, z: 0, sway: 0, time: 0 })

/** Where the sea monster peeks up: left of centre (the desk lamp stands to the right), behind the page's top edge. */
export const SEA_PEEK_SPOT = { x: -2.2, z: -PAGE_HALF_D - 2.4 } as const

/** The sea monster's peek at intro time `t`: up, a look around, and down again (allocation-free). */
export const seaPeekPose = (t: number, out: SeaPeekPose, beat: IntroBeat | null = introBeat('seaPeek')): SeaPeekPose => {
  const p = beatProgress(beat, t)
  out.on = p >= 0
  out.x = SEA_PEEK_SPOT.x
  out.z = SEA_PEEK_SPOT.z
  if (!out.on || !beat) {
    out.sea = 0
    out.rise = 0
    out.sway = 0
    out.time = 0
    return out
  }
  const s = p * beat.dur
  out.time = s
  // The sea pops up first and folds away last; the monster rises inside that.
  out.sea = smoothstep(0, 0.14, p) * (1 - smoothstep(0.88, 1, p))
  out.rise = easeInOutCubic(clamp01((p - 0.08) / 0.3)) * (1 - easeInOutCubic(clamp01((p - 0.66) / 0.26)))
  out.sway = Math.sin(s * 2.1) * 0.12
  return out
}

// ─── The director ──────────────────────────────────────────────────────────

export interface IntroState {
  /** Seconds since the intro started (the real clock: the runner's time). */
  t: number
  /** The intro is over (ended by itself, or skipped). */
  done: boolean
  /** It ended by a tap, not by itself. */
  skipped: boolean
}

export const createIntroState = (): IntroState => ({ t: 0, done: false, skipped: false })

/** Skip: done at once (the host drops the player onto page 1). */
export const skipIntro = (s: IntroState): void => {
  if (s.done) return
  s.done = true
  s.skipped = true
}

/** Enemies that can still be hit (walking, bashing, trapped). */
const alive = (state: string): boolean => state === 'march' || state === 'blocked' || state === 'trapped' || state === 'stand'

/** The demo game's longest step: the frame's real time is cut into steps no longer (the game's own clamp). */
const DEMO_STEP = 0.05

/**
 * Plays the timeline on a demo `FoldGame` through its public input API only.
 * `step` runs the timeline on the shared `CutsceneRunner` — which offers each
 * due beat to `cue` — then advances the demo game; the caller drains
 * `game.events` (the intro's view and the audio react to them).
 * Allocation-free after construction.
 */
export class IntroDirector implements CutCueHost {
  readonly state = createIntroState()
  /** The shared cutscene runner, playing `introScript(beats)`. */
  readonly runner = new CutsceneRunner()
  /** The runner's own events (beats taken, the end): kept off the demo game's queue. */
  private readonly runnerEvents = new EventQueue(32)
  /** Per beat: index of its target fold in the demo game (−1 none). */
  private readonly fold: Int16Array
  /** How many beats of each kind acted (tests and debugging). */
  readonly counts: Record<IntroBeatKind, number> = {
    open: 0, fold: 0, stamp: 0, ballistaUp: 0, bolt: 0, sling: 0, dragon: 0, seaPeek: 0, end: 0
  }
  readonly duration: number

  constructor(readonly game: FoldGame, readonly beats: readonly IntroBeat[] = INTRO_BEATS) {
    this.fold = new Int16Array(beats.length)
    for (let i = 0; i < beats.length; i++) {
      const id = beats[i]!.target
      this.fold[i] = id ? game.folds.findIndex((f) => f.def.id === id) : -1
    }
    let end = 0
    for (const b of beats) end = Math.max(end, b.kind === 'end' ? b.at : b.at + b.dur)
    this.duration = end
    this.runner.start(introScript(beats), this.runnerEvents, 1, this)
    this.runnerEvents.clear()
  }

  /** Advance the intro by `dt` seconds of real time (the runner caps it at `OUTRO.maxDt`). */
  step(dt: number): void {
    const s = this.state
    const r = this.runner
    if (s.done) {
      // Skipped (`skipIntro`): the runner stops with it.
      if (r.active) r.stop()
      return
    }
    r.update(dt, this.runnerEvents)
    this.runnerEvents.clear()
    s.t = r.time
    if (!r.active) {
      this.counts.end++
      s.done = true
      return
    }
    this.guard()
    // The demo game in steps of at most its own clamp, so the show keeps up with the timeline.
    let left = Math.min(Math.max(dt, 0), OUTRO.maxDt)
    while (left > 1e-6) {
      const h = Math.min(DEMO_STEP, left)
      this.game.update(h)
      left -= h
    }
  }

  /** The runner offers a due beat (`CutCueHost`): true when it acted. */
  cue(i: number, late: boolean): boolean {
    const b = this.beats[i]
    return !!b && this.act(i, b, late)
  }

  /** Run a beat's action; true when it happened (or needs nothing). */
  private act(i: number, b: IntroBeat, late: boolean): boolean {
    const g = this.game
    const fi = this.fold[i]!
    const f = fi >= 0 ? g.folds[fi] : undefined
    let ok = false
    switch (b.kind) {
      case 'open':
      case 'dragon':
      case 'seaPeek':
      case 'end':
        ok = true
        break
      case 'fold':
        if (f && isGrabbable(f) && (late || this.onFold(fi, false) >= (b.min ?? 1))) ok = g.foldNow(fi)
        break
      case 'ballistaUp':
        if (f && isGrabbable(f)) ok = g.foldNow(fi)
        break
      case 'stamp':
        if (f && isStampable(f) && (late || this.onFold(fi, true) >= (b.min ?? 1))) ok = g.stamp(fi)
        break
      case 'bolt': {
        const e = this.lead(f ? f.cx : 0)
        if (e >= 0) ok = g.fireBallista(g.enemies[e]!.x, g.enemies[e]!.z)
        else if (late && f) ok = g.fireBallista(f.cx, -2)
        break
      }
      case 'sling': {
        const e = this.crowd(b.min ?? 1, late)
        if (e >= 0) ok = g.slingAt(g.enemies[e]!.x, g.enemies[e]!.z)
        break
      }
    }
    if (ok) this.counts[b.kind]++
    return ok
  }

  /** Enemies on fold `fi`: walking onto it, or (held) blocked by or trapped in it. */
  private onFold(fi: number, held: boolean): number {
    const g = this.game
    const f = g.folds[fi]!
    let n = 0
    for (let j = 0; j < g.enemies.length; j++) {
      const e = g.enemies[j]!
      if (held) {
        // Who a stamp would crush: trapped in it, or bashing it from its footprint.
        if (e.state === 'trapped' ? e.fold === fi : (e.state === 'blocked' || e.state === 'march') && onFootprint(f, e.x, e.z, 0.25)) n++
      } else if (e.state === 'march' && onFootprint(f, e.x, e.z, 0)) n++
    }
    return n
  }

  /** The live enemy furthest down the page on the road in front of `x` (a ballista's mark), or −1. */
  private lead(x: number): number {
    const g = this.game
    let best = -1
    let bz = -Infinity
    for (let j = 0; j < g.enemies.length; j++) {
      const e = g.enemies[j]!
      if (!alive(e.state) || e.z > BREACH_Z - 0.2 || Math.abs(e.x - x) > 1.3) continue
      if (e.z > bz) {
        bz = e.z
        best = j
      }
    }
    return best
  }

  /** The live enemy with the most others within a sling stone's reach, if at least `min` (or any, late). */
  private crowd(min: number, late: boolean): number {
    const g = this.game
    let best = -1
    let bn = 0
    for (let j = 0; j < g.enemies.length; j++) {
      const e = g.enemies[j]!
      if (!alive(e.state) || e.z < -PAGE_HALF_D + 1) continue
      let n = 0
      for (let m = 0; m < g.enemies.length; m++) {
        const o = g.enemies[m]!
        if (alive(o.state) && Math.abs(o.x - e.x) < 1 && Math.abs(o.z - e.z) < 1) n++
      }
      if (n > bn) {
        bn = n
        best = j
      }
    }
    return bn >= min || (late && bn > 0) ? best : -1
  }

  /**
   * The castle never falls in its own advert: anyone who slips past the
   * show's beats and gets close is shot down by whatever is loaded.
   */
  private guard(): void {
    const g = this.game
    for (let j = 0; j < g.enemies.length; j++) {
      const e = g.enemies[j]!
      if (!alive(e.state) || e.z < 2.4) continue
      if (!g.slingAt(e.x, e.z)) g.fireBallista(e.x, e.z)
      return
    }
  }
}
