import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { buildSkeleton } from '@/world/characters/skeleton'
import { applyGait, applyIdle, applyJump, RUN, WALK } from '@/world/characters/poses'
import type { BoneName } from '@/world/characters/rig'

/**
 * ─── Gait, asserted in world space ──────────────────────────────────────────
 *
 * Every assertion here reads a **bone's world position after posing**, never a
 * rotation value. That is a deliberate correction, not a style preference.
 *
 * The first version of the walk cycle had the leg signs inverted: legs swung
 * backwards, knees bent forwards. The unit test that was supposed to catch it
 * asserted `shin.rotation.x <= 0` — and passed, because it had been written from
 * the same wrong assumption as the code. A test on a raw rotation sign cannot
 * distinguish a correct rig from its mirror image; a test on where the foot
 * ends up can, and would have failed on the first run.
 *
 * The rig faces **+Z**, so "forward" is +Z throughout.
 */

const rig = () => {
  const { byName, root } = buildSkeleton()
  const world = new Vector3()
  const at = (name: BoneName): Vector3 => {
    root.updateMatrixWorld(true)
    return world.setFromMatrixPosition(byName.get(name)!.matrixWorld).clone()
  }
  return { bones: byName, at }
}

/**
 * Signed sagittal angle of a limb segment: 0 is straight down, positive is
 * rotated forward (+Z). Comparing two of these gives a joint's flexion in a way
 * that no mirror error can survive.
 */
const sagittal = (from: Vector3, to: Vector3): number => Math.atan2(to.z - from.z, from.y - to.y)

describe('walk cycle', () => {
  it('puts the leading foot in front of the body at heel strike', () => {
    const { bones, at } = rig()
    applyGait(bones, 0, WALK)
    const hips = at('hips')
    const foot = at('foot.L')
    // Heel strike is the definition of phase 0: that foot is reaching forward.
    // With the sign error this read −0.19 — the leg swung backwards.
    expect(foot.z - hips.z).toBeGreaterThan(0.1)
  })

  it('drives the same foot behind the body at toe-off', () => {
    const { bones, at } = rig()
    applyGait(bones, 0.55, WALK)
    const hips = at('hips')
    const foot = at('foot.L')
    expect(foot.z - hips.z).toBeLessThan(-0.05)
  })

  it('alternates: the right foot leads half a stride later', () => {
    const { bones, at } = rig()
    applyGait(bones, 0.5, WALK)
    expect(at('foot.R').z - at('hips').z).toBeGreaterThan(0.1)
    expect(at('foot.L').z - at('hips').z).toBeLessThan(0)
  })

  it('never bends a knee forwards, at any phase of any gait', () => {
    // The defect that prompted the rewrite. Measured as the signed angle between
    // the thigh and the shin, so it holds however the hip is rotated.
    for (const [name, curves] of [
      ['walk', WALK],
      ['run', RUN]
    ] as const) {
      const { bones, at } = rig()
      for (let i = 0; i < 96; i++) {
        const phase = i / 96
        applyGait(bones, phase, curves)
        for (const side of ['L', 'R'] as const) {
          const hip = at(`thigh.${side}` as BoneName)
          const knee = at(`shin.${side}` as BoneName)
          const ankle = at(`foot.${side}` as BoneName)
          const flexion = sagittal(hip, knee) - sagittal(knee, ankle)
          expect(flexion, `${name} ${side} @ ${phase.toFixed(2)}`).toBeGreaterThan(-0.02)
        }
      }
    }
  })

  it('lifts the swing foot clear of the ground', () => {
    const { bones, at } = rig()
    applyGait(bones, 0, WALK)
    const planted = at('foot.L').y
    applyGait(bones, 0.72, WALK)
    const swinging = at('foot.L').y
    // Mid-swing, the foot has to be meaningfully higher than at contact or the
    // character scuffs the ground for half the cycle.
    expect(swinging - planted).toBeGreaterThan(0.05)
  })

  it('keeps both feet out of the ground all cycle', () => {
    const { bones, at } = rig()
    let lowest = Infinity
    for (let i = 0; i < 96; i++) {
      applyGait(bones, i / 96, WALK)
      lowest = Math.min(lowest, at('foot.L').y, at('foot.R').y)
    }
    // The ankle joint sits 0.06 m up in bind pose; the sole is below it. A
    // cycle that drives this negative has the character wading.
    expect(lowest).toBeGreaterThan(-0.01)
  })

  it('has a loading-response knee dip, not a single smooth swing', () => {
    // The feature that makes a walk look heavy: the knee flexes shortly after
    // heel strike to absorb bodyweight, then straightens again before the big
    // swing flexion. A one-sine curve cannot produce this second peak.
    const { bones, at } = rig()
    const flexionAt = (phase: number) => {
      applyGait(bones, phase, WALK)
      return sagittal(at('thigh.L'), at('shin.L')) - sagittal(at('shin.L'), at('foot.L'))
    }
    const strike = flexionAt(0.0)
    const loading = flexionAt(0.12)
    const midStance = flexionAt(0.32)
    expect(loading).toBeGreaterThan(strike + 0.1)
    expect(loading).toBeGreaterThan(midStance + 0.1)
  })

  it('swings each arm opposite its own leg', () => {
    const { bones, at } = rig()
    applyGait(bones, 0, WALK)
    const hips = at('hips')
    // Left leg forward at phase 0, so the left hand must be back.
    expect(at('foot.L').z - hips.z).toBeGreaterThan(0)
    expect(at('hand.L').z - hips.z).toBeLessThan(0)
    expect(at('hand.R').z - hips.z).toBeGreaterThan(0)
  })

  it('rises over the planted leg and falls into the handover', () => {
    const { bones, at } = rig()
    const hipY = (phase: number) => {
      applyGait(bones, phase, WALK)
      return at('hips').y
    }
    // Walking vaults over a straight stance leg: highest at mid-stance.
    expect(hipY(0.3)).toBeGreaterThan(hipY(0.0))
    expect(hipY(0.8)).toBeGreaterThan(hipY(0.5))
  })
})

describe('run cycle', () => {
  it('inverts the vertical rhythm — lowest at mid-stance, not highest', () => {
    // The structural difference between a run and a fast walk. Running, the
    // knee collapses to absorb landing so the pelvis is at its *lowest* over
    // the planted foot, and at its highest in mid-flight.
    const { bones, at } = rig()
    const hipY = (phase: number) => {
      applyGait(bones, phase, RUN)
      return at('hips').y
    }
    expect(hipY(0.15)).toBeLessThan(hipY(0.42))
    expect(hipY(0.65)).toBeLessThan(hipY(0.92))
  })

  it('folds the knee far harder than a walk', () => {
    const { bones, at } = rig()
    const peak = (curves: typeof WALK) => {
      let best = -Infinity
      for (let i = 0; i < 96; i++) {
        applyGait(bones, i / 96, curves)
        best = Math.max(best, sagittal(at('thigh.L'), at('shin.L')) - sagittal(at('shin.L'), at('foot.L')))
      }
      return best
    }
    expect(peak(RUN)).toBeGreaterThan(peak(WALK) * 1.5)
  })

  // The elbow test that used to live here took `Math.abs` of the flexion, so it
  // passed on arms that folded entirely the wrong way. Replaced by the signed
  // assertions in `arms.test.ts`.

  it('leans the trunk forward, unlike a walk', () => {
    const { bones, at } = rig()
    const leanOf = (curves: typeof WALK) => {
      applyGait(bones, 0.25, curves)
      return at('head').z - at('hips').z
    }
    expect(leanOf(RUN)).toBeGreaterThan(leanOf(WALK) + 0.05)
  })
})

describe('jump', () => {
  const hipYAt = (t: number) => {
    const { bones, at } = rig()
    applyJump(bones, t)
    return at('hips').y
  }

  it('crouches before it leaves the ground', () => {
    // Anticipation. Without it a jump reads as a vertical translation with legs
    // attached, however the physics is tuned.
    expect(hipYAt(0.18)).toBeLessThan(hipYAt(0) - 0.05)
  })

  it('reaches an apex well above standing', () => {
    expect(hipYAt(0.5)).toBeGreaterThan(hipYAt(0) + 0.2)
  })

  it('absorbs the landing instead of snapping upright', () => {
    expect(hipYAt(0.86)).toBeLessThan(hipYAt(0) - 0.05)
    expect(hipYAt(1)).toBeCloseTo(hipYAt(0), 2)
  })

  it('tucks the legs at the apex', () => {
    const { bones, at } = rig()
    applyJump(bones, 0)
    const standing = at('foot.L').y - at('hips').y
    applyJump(bones, 0.5)
    const airborne = at('foot.L').y - at('hips').y
    expect(airborne).toBeGreaterThan(standing)
  })

  it('never bends a knee forwards', () => {
    const { bones, at } = rig()
    for (let i = 0; i <= 60; i++) {
      applyJump(bones, i / 60)
      const flexion = sagittal(at('thigh.L'), at('shin.L')) - sagittal(at('shin.L'), at('foot.L'))
      expect(flexion, `t=${(i / 60).toFixed(2)}`).toBeGreaterThan(-0.02)
    }
  })
})

describe('pose hygiene', () => {
  it('does not accumulate across frames', () => {
    const { bones, at } = rig()
    applyGait(bones, 0.3, WALK)
    const once = at('foot.L').clone()
    for (let i = 0; i < 200; i++) {
      applyGait(bones, 0.3, WALK)
    }
    expect(at('foot.L').distanceTo(once)).toBeLessThan(1e-9)
  })

  it('returns to a clean stance from any other pose', () => {
    const { bones, at } = rig()
    applyJump(bones, 0.5)
    applyIdle(bones, 0)
    const idle = at('foot.L').clone()
    applyGait(bones, 0.7, RUN)
    applyIdle(bones, 0)
    expect(at('foot.L').distanceTo(idle)).toBeLessThan(1e-9)
  })
})
