/**
 * The origami dragon (GDD §8, Page 5): data and the pure bits of its
 * choreography. The state machine itself runs inside `FoldGame` because every
 * attack touches the hero, the shield folds and the enemy pool.
 *
 *   dormant → rumble → unfold → roar → idle ⇄ (breathCharge → breath | stomp)
 *                                        └─► exposed ─(broken)─► hurt ─► idle … ─► collapse → flat
 *                                               └─(timeout)─► idle
 */

import type { Boss, BossLimb, BossPhase, BossWeakPoint } from './types'

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
  rev: 0
})

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
