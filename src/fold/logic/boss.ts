/**
 * The origami dragon (GDD §8, Page 5): data and the pure bits of its
 * choreography. The state machine itself runs inside `FoldGame` because every
 * attack touches the hero, the shield folds and the enemy pool.
 *
 *   dormant → rumble → unfold → roar → idle ⇄ (breathCharge → breath | stomp)
 *                                        └─► exposed ─(broken)─► hurt ─► idle … ─► collapse → flat
 *                                               └─(timeout)─► idle
 */

import { BOSS, KRAKEN } from './config'
import type { Boss, BossKind, BossLimb, BossPhase, BossWeakPoint } from './types'

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
  const paced = p === 'rumble' || p === 'unfold' || p === 'roar' || p === 'idle' || p === 'breathCharge' || p === 'breath' || p === 'stomp' ||
    // The kraken's paced moves (logic/kraken.ts).
    p === 'surface' || p === 'inkCharge' || p === 'ink' || p === 'slam'
  return paced && b.timing > 0 ? b.phaseTime / b.timing : b.phaseTime
}

const wp = (limb: BossLimb, mode: 'crease' | 'core', x: number, z: number, sx = 0, sz = -1): BossWeakPoint => ({
  limb, mode, x, z, sx, sz, broken: false, t: 0
})

/**
 * The dragon's weak points. Order matters: legs first (the dragon kneels),
 * then wings (it can no longer rear up), then the neck — which folds the
 * whole thing down.
 */
const dragonWeakPoints = (): BossWeakPoint[] => [
  wp('legFL', 'crease', -1.75, -1.85, 0, -1),
  wp('legFR', 'crease', 1.75, -1.85, 0, -1),
  wp('wingL', 'core', -3.45, -4.05),
  wp('wingR', 'core', 3.45, -4.05),
  wp('neck', 'core', 0, -3.2)
]

/**
 * The kraken's (book 3): four tentacles laid across the page, each with a
 * crease to swipe along it (toward the kraken, folding it back), then the
 * mantle's core to spread. Positions are the headless defaults; the view
 * moves them to where the tentacles appear, like the dragon's.
 */
const krakenWeakPoints = (): BossWeakPoint[] => [
  // The swipe runs from the tip back toward the mantle (along the arm, which lies straight).
  wp('tentacleL', 'crease', -2.3, -1.6, 0.64, -0.77),
  wp('tentacleR', 'crease', 2.3, -1.6, -0.64, -0.77),
  wp('tentacleL2', 'crease', -3.6, -2.5, 0.88, -0.47),
  wp('tentacleR2', 'crease', 3.6, -2.5, -0.88, -0.47),
  wp('mantle', 'core', KRAKEN.bodyX, KRAKEN.bodyZ + 0.6)
]

export const createBoss = (kind: BossKind = 'dragon'): Boss => ({
  kind,
  phase: 'dormant',
  timer: 0,
  phaseTime: 0,
  weakPoints: kind === 'kraken' ? krakenWeakPoints() : dragonWeakPoints(),
  exposed: -1,
  aimX: 0,
  aimZ: kind === 'kraken' ? KRAKEN.inkZ : 5.4,
  attacks: 0,
  slingHits: 0,
  collapse: 0,
  timing: 1,
  acted: false,
  rev: 0
})

/**
 * Back to dormant with every weak point whole. The timing multiplier is the
 * run's, and stays. A different `kind` (a boss page of another book) swaps
 * the weak points' layout in place — the array and its objects are kept.
 */
export const resetBoss = (b: Boss, kind: BossKind = b.kind): void => {
  const fresh = createBoss(kind)
  if (kind !== b.kind) {
    b.kind = kind
    for (let i = 0; i < b.weakPoints.length; i++) {
      const w = b.weakPoints[i]!
      const f = fresh.weakPoints[i]!
      w.limb = f.limb
      w.mode = f.mode
      w.x = f.x
      w.z = f.z
      w.sx = f.sx
      w.sz = f.sz
    }
    b.aimX = fresh.aimX
    b.aimZ = fresh.aimZ
  }
  b.acted = false
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
  'dormant', 'rumble', 'unfold', 'roar', 'idle', 'breathCharge', 'breath', 'stomp', 'exposed', 'hurt', 'collapse', 'flat',
  // The kraken's own (appended: the codes are stable).
  'surface', 'inkCharge', 'ink', 'slam'
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

/** Is the dragon (or the kraken) on the page and able to be hurt / to attack? */
export const bossAwake = (b: Boss): boolean =>
  b.phase === 'idle' || b.phase === 'breathCharge' || b.phase === 'breath' ||
  b.phase === 'stomp' || b.phase === 'exposed' || b.phase === 'hurt' ||
  b.phase === 'inkCharge' || b.phase === 'ink' || b.phase === 'slam'

/** Winding up the shot a raised shield stops (the dragon's breath, the kraken's ink): a sling stone chokes it. */
export const bossCharging = (b: Boss): boolean => b.phase === 'breathCharge' || b.phase === 'inkCharge'

/** Before the boss wakes (a page secret's `asleep`). */
export const bossAsleep = (b: Boss): boolean =>
  b.phase === 'dormant' || b.phase === 'rumble' || b.phase === 'unfold' || b.phase === 'surface'

/** Where the boss's body is on the page, and how big (sling hits). */
export const bossBody = (b: Boss): { x: number; z: number; r: number } =>
  b.kind === 'kraken' ? KRAKEN_BODY : DRAGON_BODY

const DRAGON_BODY = { x: BOSS.bodyX, z: BOSS.bodyZ, r: BOSS.bodyRadius } as const
const KRAKEN_BODY = { x: KRAKEN.bodyX, z: KRAKEN.bodyZ, r: KRAKEN.bodyRadius } as const
