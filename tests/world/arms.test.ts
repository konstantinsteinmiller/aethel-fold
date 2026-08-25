import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { buildSkeleton } from '@/world/characters/skeleton'
import { applyGait, applyIdle, applyJump, RUN, WALK } from '@/world/characters/poses'
import type { BoneName } from '@/world/characters/rig'

/**
 * ─── Arms, asserted by fold direction ───────────────────────────────────────
 *
 * The arms were inverted for two revisions: elbows folded *backwards*, so the
 * forearms trailed behind the body through every animation.
 *
 * The test that should have caught it did this:
 *
 *     straightest = Math.min(straightest, Math.abs(flexion))
 *     expect(straightest).toBeGreaterThan(1.0)
 *
 * `Math.abs` threw away the sign, so a fully inverted elbow passed as long as it
 * was bent by *some* amount. Nothing below takes an absolute value of a joint
 * angle, ever.
 *
 * The rule that was missed: **an elbow folds the opposite way to a knee.** A
 * knee folds the shin backwards, heel toward the buttock; an elbow folds the
 * forearm forwards, hand toward the chest. Verified against the rig:
 *
 *     forearm.rotation.x = −1.4  →  hand z = +0.187  (forward, correct)
 *     forearm.rotation.x = +1.4  →  hand z = −0.187  (behind the body)
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

/** Signed sagittal angle: 0 is straight down, positive is rotated forward. */
const sagittal = (from: Vector3, to: Vector3): number => Math.atan2(to.z - from.z, from.y - to.y)

/**
 * Elbow flexion, signed. **Positive means folding forward**, which is the only
 * anatomically possible direction — and the mirror of the knee's convention.
 */
const elbowFlexion = (at: (n: BoneName) => Vector3, side: 'L' | 'R'): number =>
  sagittal(at(`forearm.${side}` as BoneName), at(`hand.${side}` as BoneName)) -
  sagittal(at(`upperArm.${side}` as BoneName), at(`forearm.${side}` as BoneName))

describe('elbows fold forwards', () => {
  it('keeps the hand in front of the elbow, every phase of every animation', () => {
    const { bones, at } = rig()

    for (const [name, pose] of [
      ['walk', (p: number) => applyGait(bones, p, WALK)],
      ['run', (p: number) => applyGait(bones, p, RUN)],
      ['walk→run blend', (p: number) => applyGait(bones, p, WALK, RUN, 0.5)],
      ['jump', (p: number) => applyJump(bones, p)],
      ['idle', (p: number) => applyIdle(bones, p * 4)]
    ] as const) {
      for (let i = 0; i < 64; i++) {
        const p = i / 64
        pose(p)
        for (const side of ['L', 'R'] as const) {
          // Signed, never absolute. A negative value here is a forearm trailing
          // behind the arm — the exact defect this file exists to prevent.
          expect(elbowFlexion(at, side), `${name} ${side} @ ${p.toFixed(2)}`).toBeGreaterThan(-0.02)
        }
      }
    }
  })

  it('actually bends — a permanently straight arm would also pass the above', () => {
    const { bones, at } = rig()
    let peak = -Infinity
    for (let i = 0; i < 64; i++) {
      applyGait(bones, i / 64, WALK)
      peak = Math.max(peak, elbowFlexion(at, 'L'))
    }
    expect(peak).toBeGreaterThan(0.3)
  })

  it('holds a runner’s elbows folded near a right angle', () => {
    const { bones, at } = rig()
    let straightest = Infinity
    for (let i = 0; i < 64; i++) {
      applyGait(bones, i / 64, RUN)
      straightest = Math.min(straightest, elbowFlexion(at, 'L'))
    }
    // Signed minimum, so an inverted arm scores −1.5 rather than +1.5.
    expect(straightest).toBeGreaterThan(1.0)
  })

  it('never hyperextends past straight', () => {
    const { bones, at } = rig()
    for (const curves of [WALK, RUN]) {
      for (let i = 0; i < 64; i++) {
        applyGait(bones, i / 64, curves)
        for (const side of ['L', 'R'] as const) {
          expect(elbowFlexion(at, side)).toBeLessThan(Math.PI * 0.95)
        }
      }
    }
  })
})

describe('arm swing', () => {
  it('swings each arm opposite its own leg', () => {
    const { bones, at } = rig()
    applyGait(bones, 0, WALK)
    const hips = at('hips')
    expect(at('foot.L').z - hips.z).toBeGreaterThan(0)
    expect(at('hand.L').z - hips.z).toBeLessThan(0)
    expect(at('hand.R').z - hips.z).toBeGreaterThan(0)
  })

  it('draws the hands toward the midline as they come forward', () => {
    // Arms swinging in two fixed parallel planes is the other half of what makes
    // a cycle read as mechanical. Real arms converge in front of the chest, and
    // a runner's cross much further than a walker's.
    const { bones, at } = rig()
    const lateralWhenForward = (curves: typeof WALK) => {
      let closest = Infinity
      for (let i = 0; i < 64; i++) {
        const p = i / 64
        applyGait(bones, p, curves)
        const hand = at('hand.L')
        const hips = at('hips')
        if (hand.z - hips.z > 0.05) {
          closest = Math.min(closest, Math.abs(hand.x - hips.x))
        }
      }
      return closest
    }
    expect(lateralWhenForward(RUN)).toBeLessThan(lateralWhenForward(WALK))
  })

  it('keeps the hands out of the torso', () => {
    // Crossing is good; passing through the chest is not.
    const { bones, at } = rig()
    for (const curves of [WALK, RUN]) {
      for (let i = 0; i < 64; i++) {
        applyGait(bones, i / 64, curves)
        for (const side of ['L', 'R'] as const) {
          const hand = at(`hand.${side}` as BoneName)
          const hips = at('hips')
          const inFront = hand.z - hips.z
          const lateral = Math.abs(hand.x - hips.x)
          // Only meaningful where the hand is beside the body, not swung clear.
          if (Math.abs(inFront) < 0.12) {
            expect(lateral, `${side} @ ${i}`).toBeGreaterThan(0.1)
          }
        }
      }
    }
  })

  it('moves the shoulder girdle with the arm', () => {
    // A shoulder that never moves makes the arm look bolted on rather than slung.
    const { bones, at } = rig()
    let spread = 0
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < 64; i++) {
      applyGait(bones, i / 64, RUN)
      const z = at('upperArm.L').z - at('chest').z
      min = Math.min(min, z)
      max = Math.max(max, z)
    }
    spread = max - min
    expect(spread).toBeGreaterThan(0.01)
  })

  it('articulates the wrist rather than welding the hand to the forearm', () => {
    const { bones } = rig()
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < 64; i++) {
      applyGait(bones, i / 64, WALK)
      const wrist = bones.get('hand.L')!.rotation.x
      min = Math.min(min, wrist)
      max = Math.max(max, wrist)
    }
    expect(max - min).toBeGreaterThan(0.05)
    // …but stays inside a human range. A wrist is not a second elbow.
    expect(Math.abs(min)).toBeLessThan(Math.PI * 0.45)
    expect(Math.abs(max)).toBeLessThan(Math.PI * 0.45)
  })
})
