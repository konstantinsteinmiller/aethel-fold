/**
 * The origami dragon (GDD §8, Page 5): data and the pure bits of its
 * choreography. The state machine itself runs inside `FoldGame` because every
 * attack touches the hero, the shield folds and the enemy pool.
 *
 *   dormant → rumble → unfold → roar → idle ⇄ (breathCharge → breath | stomp)
 *                                        └─► exposed ─(broken)─► hurt ─► idle … ─► collapse → flat
 *                                               └─(timeout)─► idle
 */

import { BOSS } from './config'
import type { Boss, BossLimb, BossPhase, BossWeakPoint } from './types'

/**
 * The `BOSS` timings a Dragon Rush speeds up (roadmap #16): the intro, the
 * attack cadence (idle beats, breath charge, breath, stomp). The player's
 * windows — an exposed weak point, the hurt beat, the collapse — keep their
 * authored length.
 */
export type BossPacedTiming = 'rumble' | 'unfold' | 'roar' | 'idleMin' | 'idleMax' | 'breathCharge' | 'breath' | 'stomp'
export const BOSS_PACED: readonly BossPacedTiming[] = [
  'rumble', 'unfold', 'roar', 'idleMin', 'idleMax', 'breathCharge', 'breath', 'stomp'
]

/**
 * A paced boss timing: `BOSS[key] × b.timing`. With the default multiplier of
 * 1 this is exactly the authored number (x × 1 === x), so normal play is
 * bit-for-bit the dragon it always was.
 */
export const bossTiming = (b: Boss, key: BossPacedTiming): number => BOSS[key] * b.timing

/**
 * Seconds into the current phase in *authored* time: the views' animation
 * curves read this, so a faster rush dragon plays the same moves faster
 * instead of cutting them short.
 */
export const bossClock = (b: Boss): number => {
  const p = b.phase
  const paced = p === 'rumble' || p === 'unfold' || p === 'roar' || p === 'idle' || p === 'breathCharge' || p === 'breath' || p === 'stomp'
  return paced && b.timing > 0 ? b.phaseTime / b.timing : b.phaseTime
}

const wp = (limb: BossLimb, mode: 'crease' | 'core', x: number, z: number, sx = 0, sz = -1): BossWeakPoint => ({
  limb, mode, x, z, sx, sz, broken: false, t: 0
})

/**
 * Order matters: legs first (the dragon kneels), then wings (it can no longer
 * rear up), then the neck — which folds the whole thing down.
 */
export const createBoss = (): Boss => ({
  phase: 'dormant',
  timer: 0,
  phaseTime: 0,
  weakPoints: [
    wp('legFL', 'crease', -1.75, -1.85, 0, -1),
    wp('legFR', 'crease', 1.75, -1.85, 0, -1),
    wp('wingL', 'core', -3.45, -4.05),
    wp('wingR', 'core', 3.45, -4.05),
    wp('neck', 'core', 0, -3.2)
  ],
  exposed: -1,
  aimX: 0,
  aimZ: 5.4,
  attacks: 0,
  slingHits: 0,
  collapse: 0,
  timing: 1,
  rev: 0
})

/** Back to dormant with every weak point whole. The timing multiplier is the run's, and stays. */
export const resetBoss = (b: Boss): void => {
  const fresh = createBoss()
  b.phase = fresh.phase
  b.timer = 0
  b.phaseTime = 0
  b.exposed = -1
  b.attacks = 0
  b.slingHits = 0
  b.collapse = 0
  b.rev++
  for (let i = 0; i < b.weakPoints.length; i++) {
    const w = b.weakPoints[i]!
    w.broken = false
    w.t = 0
  }
}

export const BOSS_PHASE_CODES: readonly BossPhase[] = [
  'dormant', 'rumble', 'unfold', 'roar', 'idle', 'breathCharge', 'breath', 'stomp', 'exposed', 'hurt', 'collapse', 'flat'
]

export const bossPhaseCode = (p: BossPhase): number => BOSS_PHASE_CODES.indexOf(p)

/** Index of the next unbroken weak point, or -1 when the dragon is beaten. */
export const nextWeakPoint = (b: Boss): number => {
  for (let i = 0; i < b.weakPoints.length; i++) if (!b.weakPoints[i]!.broken) return i
  return -1
}

export const brokenCount = (b: Boss): number => {
  let n = 0
  for (const w of b.weakPoints) if (w.broken) n++
  return n
}

/** Is the dragon on the page and able to be hurt / to attack? */
export const bossAwake = (b: Boss): boolean =>
  b.phase === 'idle' || b.phase === 'breathCharge' || b.phase === 'breath' ||
  b.phase === 'stomp' || b.phase === 'exposed' || b.phase === 'hurt'
