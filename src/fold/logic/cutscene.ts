/**
 * Cutscenes (C9b): a small, reusable, data-driven runner — a timeline of
 * beats (camera moves, a crowd popping up, firework volleys, cheers, the end)
 * played on the real clock. Both cutscenes run on it: the boss outros
 * (`outros.ts`) and the first-launch intro (`intro.ts`, whose input beats are
 * windowed `cue` beats the intro's director answers).
 *
 * The runner only keeps time and state: which beats have fired, where each
 * paper person stands and when it popped up, and a tiny firework pool. The
 * view reads that state and the events it emits (`outro`, `outroBeat`,
 * `firework`: a = slot, b = 0 launch / 1 burst, c = tint index, x/z) and does the drawing, the sound and the camera. Adding a beat
 * kind or a cast (book 3's dolphins and paper boats) is data plus a view
 * handler; the runner itself stays untouched.
 *
 * Nothing here allocates per frame: the crowd, the fuses and the fireworks
 * are fixed pools filled at `start` / on a beat.
 *
 * Pure: no three.js, no Vue.
 */

import { OUTRO, PAGE_HALF_D, PAGE_HALF_W } from './config'
import type { EventQueue } from './events'
import { createRng, type Rng } from './rng'

/**
 * Who pops up in a crowd beat. The view maps each to its standee frames, its
 * motion (hopping, leaping out of the sea, bobbing on it) and its cheer.
 * Book 3 adds the dolphins and the people waving from paper boats.
 */
export type CutActor = 'villagers' | 'soldiers' | 'farmers' | 'kids' | 'dolphins' | 'boats'
/**
 * Where a crowd beat lines up: along an edge of the page, or (book 3's
 * finale page, which has a sea along its top) out in the sea and along its
 * shoreline.
 */
export type CutEdge = 'left' | 'right' | 'top' | 'bottom' | 'sea' | 'shore'
/** A firework volley's colours (the view maps each to a confetti palette). */
export type FireworkTint = 'festive' | 'gold' | 'cool' | 'warm'
export const FIREWORK_TINTS: readonly FireworkTint[] = ['festive', 'gold', 'cool', 'warm']

/**
 * A camera framing relative to the play pose: distance multiplier, orbit
 * about the vertical (radians, + swings the camera to the right), pitch
 * change (radians, − lowers the camera), and a focus shift on the page.
 */
export interface CutShot {
  zoom: number
  yaw: number
  pitch: number
  fx: number
  fz: number
}

/** The play pose. */
export const SHOT_HOME: Readonly<CutShot> = { zoom: 1, yaw: 0, pitch: 0, fx: 0, fz: 0 }

export type CutBeat =
  /** Glide the camera to `shot` over `dur` real seconds (smooth in and out). */
  | { at: number; kind: 'camera'; shot: CutShot; dur: number }
  /** `count` paper people pop up along `edge`, one every `stagger` seconds. */
  | { at: number; kind: 'crowd'; actor: CutActor; edge: CutEdge; count: number; stagger: number }
  /** `count` fireworks, one every `gap` seconds, bursting over the page rectangle x0…x1 × z0…z1. */
  | { at: number; kind: 'fireworks'; count: number; gap: number; x0: number; x1: number; z0: number; z1: number; tint: FireworkTint }
  /** Everybody cheers: a hop, arms up, hats in the air, and a "yay!". */
  | { at: number; kind: 'cheer' }
  /**
   * A windowed cue for the script's host (the intro's input beats): offered
   * every frame from `at` until the host takes it or `at + dur` has passed
   * (then offered once more as late, and dropped). `cue` is the host's own
   * number for it.
   */
  | { at: number; kind: 'cue'; dur: number; cue: number }
  /** The end: the camera goes home and the victory card may come. Always the last beat. */
  | { at: number; kind: 'end' }

export type CutBeatKind = CutBeat['kind']

export interface CutScript {
  id: string
  /** Beats in time order; the last is `end`. */
  beats: readonly CutBeat[]
}

/** The script's length: its `end` beat's time. */
export const scriptDuration = (s: CutScript): number => {
  const last = s.beats[s.beats.length - 1]
  return last && last.kind === 'end' ? last.at : Infinity
}

/**
 * Is a script well formed? Beats in time order, finite and non-negative
 * times, exactly one `end` and it comes last, crowd counts within the cap.
 * Returns the problems (empty when fine). Tests and DEV only (allocates).
 */
export const validateScript = (s: CutScript): string[] => {
  const out: string[] = []
  let prev = 0
  let crowd = 0
  s.beats.forEach((b, i) => {
    if (!Number.isFinite(b.at) || b.at < 0) out.push(`beat ${i}: bad time`)
    if (b.at < prev) out.push(`beat ${i}: out of order`)
    prev = b.at
    if (b.kind === 'end' && i !== s.beats.length - 1) out.push(`beat ${i}: end is not last`)
    if (b.kind === 'crowd') crowd += b.count
    if (b.kind === 'camera' && !(b.dur > 0 && b.shot.zoom > 0)) out.push(`beat ${i}: bad camera`)
    if (b.kind === 'fireworks' && (b.count < 1 || b.gap < 0)) out.push(`beat ${i}: bad fireworks`)
    if (b.kind === 'cue' && !(b.dur >= 0)) out.push(`beat ${i}: bad cue`)
  })
  if (s.beats[s.beats.length - 1]?.kind !== 'end') out.push('no end beat')
  if (crowd > OUTRO.crowdCap) out.push(`crowd ${crowd} > cap ${OUTRO.crowdCap}`)
  return out
}

// ─── Crowd ─────────────────────────────────────────────────────────────────

export interface CrowdMember {
  actor: CutActor
  /** Page position it stands on. */
  x: number
  z: number
  /** Runner time it starts to pop up (it is flat on the page before). */
  popAt: number
  /** 0…1, a per-person offset for its cheer loop (hop rhythm, which frame first). */
  seed: number
}

/** Page inset of the crowd lines from the page edges. */
const EDGE_IN = 0.55
/** The side lines run from just below the top row (and book 3's beach) down to beside the castle. */
const SIDE_Z0 = -2.7
const SIDE_Z1 = 3.4
/** The top row, just under the printed story line. */
const TOP_Z = -PAGE_HALF_D + 2.1

/**
 * Where the `j`-th of `n` paper people along `edge` stands (page space).
 * Left and right run down the long edges between the top border and the
 * castle; the top row, under the printed story line, is where the marchers
 * came from; the bottom flanks the player's castle, clear of its keep and
 * towers. Book 3's finale page has a sea along its top (`OUTRO.seaZ`): the
 * dolphins swim out in it (`sea`, staggered in two rows so no one hides
 * another) and the paper boats bob just off the beach (`shore`).
 * Deterministic; `jitter` (−1…1) nudges it off the line so a row doesn't
 * look ruled. Nothing on these lines is hidden by the finale page's trees:
 * the page keeps its props off them (`onCrowdLine`).
 */
export const crowdSpot = (edge: CutEdge, j: number, n: number, jitter: number, out: { x: number; z: number }): void => {
  const k = n <= 1 ? 0.5 : j / (n - 1)
  switch (edge) {
    case 'left':
    case 'right': {
      const s = edge === 'left' ? -1 : 1
      out.x = s * (PAGE_HALF_W - EDGE_IN) + jitter * 0.18
      out.z = SIDE_Z0 + k * (SIDE_Z1 - SIDE_Z0) + jitter * 0.2
      return
    }
    case 'top':
      // Just under the printed story line, never on it.
      out.x = -PAGE_HALF_W + 1.4 + k * (PAGE_HALF_W * 2 - 2.8) + jitter * 0.2
      out.z = TOP_Z + jitter * 0.15
      return
    case 'sea':
      // Out in the water, in two staggered rows (the far one a little further out).
      out.x = -PAGE_HALF_W + 1.3 + k * (PAGE_HALF_W * 2 - 2.6) + jitter * 0.25
      out.z = OUTRO.seaZ - 1.15 - (j % 2) * 0.55 + jitter * 0.12
      return
    case 'shore':
      // Just off the beach, in front of the dolphins' rows.
      out.x = -PAGE_HALF_W + 1.0 + k * (PAGE_HALF_W * 2 - 2.0) + jitter * 0.2
      out.z = OUTRO.seaZ - 0.5 + jitter * 0.08
      return
    case 'bottom': {
      // Alternate sides, outward from beside the towers, three to a row.
      const side = j % 2 === 0 ? -1 : 1
      const rank = Math.floor(j / 2)
      out.x = side * (3.1 + (rank % 3) * 0.62) + jitter * 0.1
      out.z = 5.05 - (rank % 2) * 0.35 - Math.floor(rank / 3) * 0.7 + jitter * 0.12
      return
    }
  }
}

/**
 * Is (x, z) on or just in front of a crowd line (the finale pages keep their
 * trees off it)? A tree a little down the page from a paper person stands
 * between it and the steep play camera, so the band reaches further toward
 * the camera (+z) than away from it. Covers every land edge `crowdSpot`
 * uses; the sea has no trees anyway.
 */
export const onCrowdLine = (x: number, z: number): boolean => {
  const ax = Math.abs(x)
  // The long sides.
  if (ax > PAGE_HALF_W - EDGE_IN - 0.8 && z > SIDE_Z0 - 0.7 && z < SIDE_Z1 + 1.3) return true
  // The top row.
  if (z > TOP_Z - 0.5 && z < TOP_Z + 1.4) return true
  // Beside the castle (the bottom rows).
  if (ax > 2.5 && z > 3.6) return true
  return false
}

// ─── Fireworks ─────────────────────────────────────────────────────────────

/** A firework slot: free, a rocket rising, or a burst fading (its chips still flying). */
export const FW_FREE = 0
export const FW_RISE = 1
export const FW_BURST = 2

/**
 * A fixed pool of fireworks (struct of arrays). At most `limit` are in flight
 * or bursting at once — the hard cap on concurrent bursts; a launch past it
 * is dropped. The view draws each rocket's trail and each burst's chips with
 * the one shared confetti mesh.
 */
export class FireworkPool {
  readonly capacity = OUTRO.fireworkSlots
  readonly state = new Uint8Array(OUTRO.fireworkSlots)
  readonly x = new Float32Array(OUTRO.fireworkSlots)
  readonly z = new Float32Array(OUTRO.fireworkSlots)
  /** Burst height. */
  readonly y = new Float32Array(OUTRO.fireworkSlots)
  /** Seconds in the current state. */
  readonly t = new Float32Array(OUTRO.fireworkSlots)
  readonly tint = new Uint8Array(OUTRO.fireworkSlots)
  /** Slots that may be busy at once (lowered in lite mode). */
  limit: number = OUTRO.fireworkSlots
  /** Launches refused because the pool was full (tests, telemetry). */
  dropped = 0

  get busy(): number {
    let n = 0
    for (let i = 0; i < this.capacity; i++) if (this.state[i] !== FW_FREE) n++
    return n
  }

  /** Launch from the page at (x, z), bursting at height y. Returns the slot, or −1 when the cap is reached. */
  launch(x: number, z: number, y: number, tint: number): number {
    if (this.busy >= Math.min(this.limit, this.capacity)) {
      this.dropped++
      return -1
    }
    for (let i = 0; i < this.capacity; i++) {
      if (this.state[i] !== FW_FREE) continue
      this.state[i] = FW_RISE
      this.x[i] = x
      this.z[i] = z
      this.y[i] = y
      this.t[i] = 0
      this.tint[i] = tint
      return i
    }
    return -1
  }

  /** Rise → burst (emits `firework` b = 1) → free after the chips' life. */
  update(dt: number, ev: EventQueue): void {
    for (let i = 0; i < this.capacity; i++) {
      const s = this.state[i]
      if (s === FW_FREE) continue
      this.t[i]! += dt
      if (s === FW_RISE && this.t[i]! >= OUTRO.rise) {
        this.state[i] = FW_BURST
        this.t[i] = 0
        ev.emit('firework', i, 1, this.tint[i]!, this.x[i]!, this.z[i]!)
      } else if (s === FW_BURST && this.t[i]! >= OUTRO.linger) {
        this.state[i] = FW_FREE
      }
    }
  }

  /** Rocket height 0…1 of the way to its burst (for the view's trail). */
  riseK(i: number): number {
    return this.state[i] === FW_RISE ? Math.min(1, this.t[i]! / OUTRO.rise) : 0
  }

  clear(): void {
    this.state.fill(FW_FREE)
  }
}

/** Chips one burst throws (lite: low quality or reduced motion). */
export const sparksPerBurst = (lite: boolean): number => (lite ? OUTRO.sparksLite : OUTRO.sparks)

/** Live trail chips one rising rocket keeps at most. */
export const trailChips = (): number => Math.ceil(OUTRO.trailRate * OUTRO.trailLife)

/** Worst-case live firework chips for a mode: every slot bursting while as many rockets trail. */
export const fireworkParticleCap = (lite: boolean): number => {
  const slots = lite ? OUTRO.fireworkSlotsLite : OUTRO.fireworkSlots
  return slots * (sparksPerBurst(lite) + trailChips())
}

// ─── Runner ────────────────────────────────────────────────────────────────

/** The host of a script's `cue` beats (the intro's director): acts on a cue, true when it did. */
export interface CutCueHost {
  cue(cue: number, late: boolean): boolean
}

/** Cue beats waiting for their host at once, at most (the intro's windows overlap by two or three). */
const CUE_CAP = 16

/**
 * Plays one script at a time. `update(realDt, events)` advances the clock and
 * fires every beat whose time has come, in order, emitting `outroBeat`
 * (a = beat index, b = 1 when the skip fired it). `start` emits `outro`
 * a = 1; the end (reached or skipped) emits `outro` a = 0, b = 1 if skipped.
 *
 * The clock is the real one: callers pass the frame's real dt, capped only
 * at `OUTRO.maxDt` (a tab switch), never the game's 0.05 s clamp — so a
 * script takes as long on a 12 fps phone as on a desktop.
 */
export class CutsceneRunner {
  script: CutScript | null = null
  active = false
  /** Real seconds since `start`. */
  time = 0
  /** The end was reached by a skip. */
  skipped = false
  /** Low quality or reduced motion: half the fireworks, and fewer at once. */
  lite = false
  /** Script time of the last `cheer` beat (−∞ before any). */
  cheerAt = -Infinity
  readonly fireworks = new FireworkPool()
  readonly crowd: CrowdMember[] = []
  crowdCount = 0
  private cursor = 0
  private readonly rng: Rng = createRng(0x51a7)
  private readonly spot = { x: 0, z: 0 }
  // Fuses: fireworks of a volley waiting their turn.
  private readonly fuseAt = new Float32Array(OUTRO.fuseCap)
  private readonly fuseX = new Float32Array(OUTRO.fuseCap)
  private readonly fuseZ = new Float32Array(OUTRO.fuseCap)
  private readonly fuseY = new Float32Array(OUTRO.fuseCap)
  private readonly fuseTint = new Uint8Array(OUTRO.fuseCap)
  private fuses = 0
  // Cue beats offered to the host until taken or late (beat indices, in script order).
  private host: CutCueHost | null = null
  private readonly pending = new Int16Array(CUE_CAP)
  private pendingN = 0

  constructor() {
    for (let i = 0; i < OUTRO.crowdCap; i++) this.crowd.push({ actor: 'villagers', x: 0, z: 0, popAt: 0, seed: 0 })
  }

  /** Begin `script` (seeded, so a replay lays the crowd out the same); `host` answers its `cue` beats. */
  start(script: CutScript, ev: EventQueue, seed = 1, host: CutCueHost | null = null): void {
    this.script = script
    this.host = host
    this.pendingN = 0
    this.active = true
    this.time = 0
    this.skipped = false
    this.cursor = 0
    this.cheerAt = -Infinity
    this.crowdCount = 0
    this.fuses = 0
    this.fireworks.clear()
    this.fireworks.limit = this.lite ? OUTRO.fireworkSlotsLite : OUTRO.fireworkSlots
    this.rng.seed(seed)
    ev.emit('outro', 1, 0)
  }

  /** Forget everything (a new run or page): the crowd goes, nothing is emitted. */
  stop(): void {
    this.script = null
    this.host = null
    this.pendingN = 0
    this.active = false
    this.time = 0
    this.skipped = false
    this.cursor = 0
    this.crowdCount = 0
    this.fuses = 0
    this.cheerAt = -Infinity
    this.fireworks.clear()
  }

  /** Can a tap skip now? Not in the first `OUTRO.skipAfter` (that tap was still the finale's). */
  get skippable(): boolean {
    return this.active && this.time >= OUTRO.skipAfter
  }

  /**
   * Jump to the end: the rest of the crowd stands up at once, pending and
   * rising fireworks are dropped (chips already flying fade by themselves),
   * cheers and camera moves still to come are left out. Returns true if it
   * skipped.
   */
  skip(ev: EventQueue): boolean {
    if (!this.skippable) return false
    const s = this.script!
    this.skipped = true
    this.fuses = 0
    this.fireworks.clear()
    // Whoever is still popping up stands at once…
    for (let i = 0; i < this.crowdCount; i++) {
      const m = this.crowd[i]!
      m.popAt = Math.min(m.popAt, this.time - OUTRO.popTime)
    }
    // …and so does the rest of the crowd.
    for (; this.cursor < s.beats.length; this.cursor++) {
      const b = s.beats[this.cursor]!
      if (b.kind === 'crowd') {
        this.spawnCrowd(b, this.time - OUTRO.popTime, 0)
        ev.emit('outroBeat', this.cursor, 1)
      }
    }
    this.finish(ev)
    return true
  }

  update(realDt: number, ev: EventQueue): void {
    if (!this.active) return
    const s = this.script!
    const dt = Math.min(Math.max(realDt, 0), OUTRO.maxDt)
    this.time += dt
    // Beats whose time has come, in order (a cue waits in line for its host).
    let ended = -1
    while (this.cursor < s.beats.length && s.beats[this.cursor]!.at <= this.time) {
      const i = this.cursor++
      const b = s.beats[i]!
      if (b.kind === 'end') {
        ended = i
        break
      }
      if (b.kind === 'cue') {
        if (this.pendingN < CUE_CAP) this.pending[this.pendingN++] = i
        else this.offer(i, true, ev)
      } else this.fire(b, i, ev)
    }
    this.offerCues(ev)
    if (ended >= 0) {
      this.fire(s.beats[ended]!, ended, ev)
      this.finish(ev)
      return
    }
    // Fuses.
    for (let i = 0; i < this.fuses; ) {
      if (this.fuseAt[i]! > this.time) {
        i++
        continue
      }
      // Past the cap the launch is dropped.
      const slot = this.fireworks.launch(this.fuseX[i]!, this.fuseZ[i]!, this.fuseY[i]!, this.fuseTint[i]!)
      if (slot >= 0) ev.emit('firework', slot, 0, this.fuseTint[i]!, this.fuseX[i]!, this.fuseZ[i]!)
      // Swap-remove.
      const last = --this.fuses
      this.fuseAt[i] = this.fuseAt[last]!
      this.fuseX[i] = this.fuseX[last]!
      this.fuseZ[i] = this.fuseZ[last]!
      this.fuseY[i] = this.fuseY[last]!
      this.fuseTint[i] = this.fuseTint[last]!
    }
    this.fireworks.update(dt, ev)
  }

  /** Offer every waiting cue to the host, in script order; drop those taken or late. */
  private offerCues(ev: EventQueue): void {
    const beats = this.script!.beats
    let keep = 0
    for (let k = 0; k < this.pendingN; k++) {
      const i = this.pending[k]!
      const b = beats[i]!
      const late = b.kind === 'cue' && this.time >= b.at + b.dur
      if (!this.offer(i, late, ev) && !late) this.pending[keep++] = i
    }
    this.pendingN = keep
  }

  /** One cue to the host: true when it acted (emits `outroBeat` then). */
  private offer(i: number, late: boolean, ev: EventQueue): boolean {
    const b = this.script!.beats[i]!
    if (b.kind !== 'cue' || !this.host?.cue(b.cue, late)) return false
    ev.emit('outroBeat', i, 0)
    return true
  }

  private fire(b: CutBeat, i: number, ev: EventQueue): void {
    switch (b.kind) {
      case 'crowd':
        this.spawnCrowd(b, b.at, b.stagger)
        break
      case 'fireworks': {
        // Lite: half the volley (at least one), spaced out for its two slots.
        const n = this.lite ? Math.max(1, Math.ceil(b.count / 2)) : b.count
        const gap = this.lite ? Math.max(b.gap * 2, 0.8) : b.gap
        for (let k = 0; k < n && this.fuses < OUTRO.fuseCap; k++) {
          const f = this.fuses++
          this.fuseAt[f] = b.at + k * gap
          this.fuseX[f] = this.rng.range(b.x0, b.x1)
          this.fuseZ[f] = this.rng.range(b.z0, b.z1)
          this.fuseY[f] = this.rng.range(OUTRO.burstLow, OUTRO.burstHigh)
          this.fuseTint[f] = FIREWORK_TINTS.indexOf(b.tint)
        }
        break
      }
      case 'cheer':
        this.cheerAt = b.at
        break
      case 'camera':
      case 'cue':
      case 'end':
        break
    }
    ev.emit('outroBeat', i, 0)
  }

  private spawnCrowd(b: Extract<CutBeat, { kind: 'crowd' }>, at: number, stagger: number): void {
    for (let j = 0; j < b.count && this.crowdCount < OUTRO.crowdCap; j++) {
      const m = this.crowd[this.crowdCount++]!
      crowdSpot(b.edge, j, b.count, this.rng.range(-1, 1), this.spot)
      m.actor = b.actor
      m.x = this.spot.x
      m.z = this.spot.z
      m.popAt = at + j * stagger
      m.seed = this.rng.next()
    }
  }

  private finish(ev: EventQueue): void {
    this.active = false
    this.fuses = 0
    this.pendingN = 0
    // Rockets still rising never burst (scripts end after their last burst; a skip drops them).
    this.fireworks.clear()
    ev.emit('outro', 0, this.skipped ? 1 : 0)
  }
}
