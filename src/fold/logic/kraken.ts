/**
 * The paper kraken (book 3, page 5; aethel-fold-GDD §13): its own state
 * machine, pure and headless like the fold rules.
 *
 *   dormant → surface → roar → idle ⇄ (inkCharge → ink | slam)
 *                                 └─► exposed ─(broken)─► hurt ─► idle … ─► collapse → flat
 *                                        └─(timeout)─► inkCharge
 *
 * It shares the dragon's `Boss` record (weak points, exposure, sling hits,
 * the Dragon Rush timing multiplier) so every input path — swiping a crease,
 * spreading the core, a sling stone on an exposed weak point — works on it
 * unchanged. What differs is choreography, so it lives here: `stepKraken`
 * advances the machine by sim seconds and returns what happened as bit flags
 * (like `updateFold`'s moments); the game carries out the moves that touch
 * the hero, the shields and the enemy pool (`KRAKEN_INK`, `KRAKEN_SLAM`) and
 * the page clear (`KRAKEN_FLAT`).
 *
 * Timing: the paced timings are `KRAKEN[key] × b.timing` (`krakenTiming`), so
 * a Kraken Rush (book 3's rematch, roadmap #16's reserved slot) is the same
 * fight, faster; normal play runs at 1. Nothing here allocates.
 */

import { KRAKEN } from './config'
import { clamp01 } from './math'
import { nextWeakPoint, brokenCount } from './boss'
import type { Rng } from './rng'
import type { Boss, BossPhase } from './types'

/** The `KRAKEN` timings a rush speeds up (the player's windows keep their length). */
export type KrakenPacedTiming = 'surface' | 'roar' | 'idleMin' | 'idleMax' | 'inkCharge' | 'ink' | 'slam'
export const KRAKEN_PACED: readonly KrakenPacedTiming[] = ['surface', 'roar', 'idleMin', 'idleMax', 'inkCharge', 'ink', 'slam']

/** A paced kraken timing: `KRAKEN[key] × b.timing` (× 1 in the story: exactly the authored number). */
export const krakenTiming = (b: Boss, key: KrakenPacedTiming): number => KRAKEN[key] * b.timing

/** `stepKraken` results (bit flags). */
export const KRAKEN_NONE = 0
/** The phase changed this step (the game emits `bossPhase`). */
export const KRAKEN_PHASE = 1
/** The ink jet strikes at (aimX, aimZ): a raised shield on its path stops it, else the hero is hit. */
export const KRAKEN_INK = 2
/** A tentacle slams down at (aimX, KRAKEN.slamZ): boarders tumble off it. */
export const KRAKEN_SLAM = 4
/** Folded flat after the collapse: the page is won. */
export const KRAKEN_FLAT = 8

/** What the machine needs to know about the page. */
export interface KrakenEnv {
  rng: Rng
  /** Page intro delay (seconds asleep before it surfaces). */
  introDelay: number
  /** The page's `bossPace` (< 1 = faster), 1 by default. */
  pace: number
  /** The hero's x (the ink tracks him while charging). */
  heroX: number
}

const setPhase = (b: Boss, p: BossPhase, timer: number): number => {
  b.phase = p
  b.timer = timer
  b.phaseTime = 0
  b.acted = false
  b.rev++
  return KRAKEN_PHASE
}

/** The kraken quickens as it loses tentacles. */
export const krakenPace = (b: Boss, pagePace: number): number => (1 - brokenCount(b) * 0.1) * pagePace

const idleBeat = (b: Boss, env: KrakenEnv): number =>
  env.rng.range(krakenTiming(b, 'idleMin'), krakenTiming(b, 'idleMax')) * krakenPace(b, env.pace)

const inkCharge = (b: Boss, env: KrakenEnv): number =>
  krakenTiming(b, 'inkCharge') * (1 - brokenCount(b) * 0.08) * env.pace

/** The lane a slam aims at: one of the three lane columns, never the same twice running. */
const SLAM_X = [-2.8, 0, 2.8] as const

/** Open the next unbroken weak point for `KRAKEN.exposed` seconds. Returns the flags. */
export const exposeKraken = (b: Boss): number => {
  const i = nextWeakPoint(b)
  if (i < 0) return KRAKEN_NONE
  b.exposed = i
  b.slingHits = 0
  b.weakPoints[i]!.t = 0
  return setPhase(b, 'exposed', KRAKEN.exposed)
}

/**
 * Advance the kraken by `dt` sim seconds. Returns `KRAKEN_*` flags. A broken
 * weak point is the game's (`breakWeak` puts it in `hurt`); everything else
 * moves here.
 */
export const stepKraken = (b: Boss, dt: number, env: KrakenEnv): number => {
  b.phaseTime += dt
  b.timer -= dt
  switch (b.phase) {
    case 'dormant':
      return b.phaseTime > env.introDelay + 0.9 ? setPhase(b, 'surface', krakenTiming(b, 'surface')) : KRAKEN_NONE
    case 'surface':
      return b.timer <= 0 ? setPhase(b, 'roar', krakenTiming(b, 'roar')) : KRAKEN_NONE
    case 'roar':
      return b.timer <= 0 ? setPhase(b, 'idle', idleBeat(b, env)) : KRAKEN_NONE
    case 'idle':
      if (b.timer > 0) return KRAKEN_NONE
      if (b.attacks >= KRAKEN.attacksPerExposure) return exposeKraken(b)
      if (b.attacks % 2 === 0) {
        b.aimX = env.heroX
        b.aimZ = KRAKEN.inkZ
        return setPhase(b, 'inkCharge', inkCharge(b, env))
      }
      {
        // Slam a lane column; pick among the other two when it slammed this one last.
        let k = Math.floor(env.rng.next() * 3)
        if (SLAM_X[k] === b.aimX) k = (k + 1 + Math.floor(env.rng.next() * 2)) % 3
        b.aimX = SLAM_X[k]!
        b.aimZ = KRAKEN.slamZ
      }
      return setPhase(b, 'slam', krakenTiming(b, 'slam'))
    case 'inkCharge': {
      // The siphon tracks the hero while it glows.
      const k = 1 - Math.exp(-3 * dt)
      b.aimX += (env.heroX - b.aimX) * k
      b.aimZ = KRAKEN.inkZ
      return b.timer <= 0 ? setPhase(b, 'ink', krakenTiming(b, 'ink')) : KRAKEN_NONE
    }
    case 'ink': {
      let r = KRAKEN_NONE
      if (!b.acted && b.phaseTime >= KRAKEN.inkAt * b.timing) {
        b.acted = true
        r |= KRAKEN_INK
      }
      if (b.timer <= 0) {
        b.attacks++
        r |= setPhase(b, 'idle', idleBeat(b, env))
      }
      return r
    }
    case 'slam': {
      let r = KRAKEN_NONE
      if (!b.acted && b.phaseTime >= KRAKEN.slamAt * b.timing) {
        b.acted = true
        r |= KRAKEN_SLAM
      }
      if (b.timer <= 0) {
        b.attacks++
        r |= setPhase(b, 'idle', idleBeat(b, env))
      }
      return r
    }
    case 'exposed':
      if (b.timer > 0) return KRAKEN_NONE
      {
        // Covered again before it was folded: it comes back swinging.
        const w = b.weakPoints[b.exposed]
        if (w) w.t = 0
        b.exposed = -1
        b.attacks = KRAKEN.attacksPerExposure - 1
        b.aimX = env.heroX
        b.aimZ = KRAKEN.inkZ
      }
      return setPhase(b, 'inkCharge', inkCharge(b, env))
    case 'hurt':
      if (b.timer > 0) return KRAKEN_NONE
      return nextWeakPoint(b) < 0 ? setPhase(b, 'collapse', KRAKEN.collapse) : setPhase(b, 'idle', 0.8)
    case 'collapse':
      b.collapse = clamp01(1 - b.timer / KRAKEN.collapse)
      if (b.timer > 0) return KRAKEN_NONE
      b.collapse = 1
      return setPhase(b, 'flat', 0) | KRAKEN_FLAT
    default:
      return KRAKEN_NONE
  }
}

/** Seconds into the current phase in authored time (the view's animation clock; see `bossClock`). */
export const krakenClock = (b: Boss): number => {
  const p = b.phase
  const paced = p === 'surface' || p === 'roar' || p === 'idle' || p === 'inkCharge' || p === 'ink' || p === 'slam'
  return paced && b.timing > 0 ? b.phaseTime / b.timing : b.phaseTime
}

/** Boarders a slam spills: more as it is hurt. */
export const slamCount = (b: Boss): number => 2 + Math.min(2, brokenCount(b))
