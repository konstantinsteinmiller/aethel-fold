import type { Bone } from 'three'
import type { BoneName } from './rig'
import { BIND_POSE, boneDefinition } from './rig'
import {
  type Curve,
  JUMP_ANKLE,
  JUMP_ELBOW,
  JUMP_HIP,
  JUMP_KNEE,
  JUMP_LEAN,
  JUMP_RISE,
  JUMP_SHOULDER,
  JUMP_WRIST,
  RUN_ANKLE,
  RUN_ELBOW,
  RUN_HIP,
  RUN_KNEE,
  RUN_RISE,
  RUN_SHOULDER,
  RUN_WRIST,
  sampleClip,
  sampleClipRaw,
  sampleCurve,
  sampleCurveRaw,
  WALK_ANKLE,
  WALK_ELBOW,
  WALK_HIP,
  WALK_KNEE,
  WALK_RISE,
  WALK_SHOULDER,
  WALK_WRIST
} from './gaitCurves'

/**
 * ─── Posing the rig ─────────────────────────────────────────────────────────
 *
 * Applies the gait-analysis curves in `gaitCurves.ts` to the skeleton. The
 * curves hold *anatomical* angles — hip flexion, knee flexion, dorsiflexion —
 * and this file is the single place where those become bone rotations.
 *
 * ── The sign convention, which was wrong ────────────────────────────────────
 *
 * Every bone in this rig points **down** (−Y) in bind pose, and the character
 * faces **+Z**. Rotating a downward-pointing bone about +X moves its tip toward
 * **−Z**, i.e. *backwards*. Measured, not assumed:
 *
 *     shin.rotation.x = +0.8  →  foot z = −0.194, y = +0.142
 *     shin.rotation.x = −0.8  →  foot z = +0.194
 *
 * So:
 *
 * * **hip flexion** (thigh forward) = **negative** `rotation.x`
 * * **knee flexion** (heel back and up) = **positive** `rotation.x`
 * * **dorsiflexion** (toes up) = **negative** `rotation.x` on the foot
 *
 * The first version of this file had both leg signs inverted — legs swung
 * backwards and knees bent forwards — and the unit test asserted
 * `shin.rotation.x <= 0`, which enshrined the bug because it was written from
 * the same wrong assumption as the code. The tests now assert **world-space**
 * outcomes: where the foot actually ends up. A test on a raw rotation sign
 * cannot tell a correct rig from its mirror image.
 */

export interface GaitCurves {
  hip: Curve
  knee: Curve
  ankle: Curve
  rise: Curve
  shoulder: Curve
  elbow: Curve
  wrist: Curve
  /** Metres of pelvis travel between the curve's −1 and +1. */
  bob: number
  /** Radians the pelvis lists toward the stance leg. */
  pelvisList: number
  /** Radians the shoulders counter-rotate against the pelvis. */
  counterTwist: number
  /** Forward trunk lean, radians. */
  lean: number
  /** Radians the arms are held out from the body at rest. */
  armSpread: number
  /**
   * How far the arms swing *across* the midline as they come forward.
   *
   * Pronounced in a run and barely there in a walk. Arms that swing in two
   * fixed parallel planes are the other half of why a cycle reads as
   * mechanical — real arms converge in front of the chest.
   */
  armCross: number
}

export const WALK: GaitCurves = {
  hip: WALK_HIP,
  knee: WALK_KNEE,
  ankle: WALK_ANKLE,
  rise: WALK_RISE,
  shoulder: WALK_SHOULDER,
  elbow: WALK_ELBOW,
  wrist: WALK_WRIST,
  bob: 0.026,
  pelvisList: 0.07,
  counterTwist: 0.12,
  lean: 0.03,
  armSpread: 0.06,
  armCross: 0.2
}

export const RUN: GaitCurves = {
  hip: RUN_HIP,
  knee: RUN_KNEE,
  ankle: RUN_ANKLE,
  rise: RUN_RISE,
  shoulder: RUN_SHOULDER,
  elbow: RUN_ELBOW,
  wrist: RUN_WRIST,
  bob: 0.07,
  pelvisList: 0.05,
  counterTwist: 0.24,
  lean: 0.2,
  armSpread: 0.09,
  armCross: 0.5
}

export interface PoseTargets {
  get(name: BoneName): Bone | undefined
}

/** Resets every bone to its bind transform. Allocation-free. */
export const resetPose = (bones: PoseTargets): void => {
  for (const definition of BIND_POSE) {
    const bone = bones.get(definition.name)
    if (!bone) {
      continue
    }
    bone.rotation.set(0, 0, 0)
    if (definition.parent === null) {
      bone.position.set(definition.head[0], definition.head[1], definition.head[2])
    } else {
      const parent = boneDefinition(definition.parent).head
      bone.position.set(definition.head[0] - parent[0], definition.head[1] - parent[1], definition.head[2] - parent[2])
    }
  }
}

/**
 * Poses one leg and its opposing arm from the curves.
 *
 * `phase` is that leg's own position in the cycle — the caller offsets the right
 * side by half a stride. Keeping the offset at the call site is what makes the
 * two legs provably identical code rather than two hand-mirrored copies that can
 * drift apart.
 */
const lerp = (from: number, to: number, w: number): number => from + (to - from) * w

const poseSide = (
  bones: PoseTargets,
  side: 'L' | 'R',
  phase: number,
  a: GaitCurves,
  b: GaitCurves,
  w: number
): void => {
  const mix = (pick: (c: GaitCurves) => Curve): number =>
    w <= 0
      ? sampleCurve(pick(a), phase)
      : w >= 1
        ? sampleCurve(pick(b), phase)
        : lerp(sampleCurve(pick(a), phase), sampleCurve(pick(b), phase), w)

  const thigh = bones.get(`thigh.${side}` as BoneName)
  if (thigh) {
    // Negated: flexion is forward, +X rotation is backward. See the note above.
    thigh.rotation.x = -mix(c => c.hip)
  }

  const shin = bones.get(`shin.${side}` as BoneName)
  if (shin) {
    // Not negated. Knee flexion folds the shin backwards, which is +X.
    // Clamped at zero because a negative sample from an overshooting
    // Catmull-Rom spline is a knee bending the wrong way — the exact defect
    // this rewrite exists to fix, and it must not come back through the spline.
    shin.rotation.x = Math.max(0, mix(c => c.knee))
  }

  const foot = bones.get(`foot.${side}` as BoneName)
  if (foot) {
    // Dorsiflexion is toes-up, which is −X. The foot bone points forward rather
    // than down, so this is the one joint whose axis is not the general case;
    // the sign still follows from the same measurement.
    foot.rotation.x = -mix(c => c.ankle)
  }

  // The arm opposes its own leg: a half-cycle offset, which is what the
  // shoulder curve already encodes relative to the hip.
  const shoulderFlex = mix(c => c.shoulder)
  const outward = side === 'L' ? 1 : -1

  const arm = bones.get(`upperArm.${side}` as BoneName)
  if (arm) {
    arm.rotation.x = -shoulderFlex
    // Held out from the body at rest, drawn toward the midline as it swings
    // forward. `rotation.y` would do nothing here — a bone pointing along −Y is
    // invariant under rotation about Y — so lateral motion has to be z.
    const cross = Math.max(0, shoulderFlex) * lerp(a.armCross, b.armCross, w)
    arm.rotation.z = outward * (lerp(a.armSpread, b.armSpread, w) - cross)
  }

  const forearm = bones.get(`forearm.${side}` as BoneName)
  if (forearm) {
    // **Negated**, unlike the knee. An elbow folds the hand *forwards*; a knee
    // folds the shin backwards. Writing both the same way is what had the
    // characters running with their forearms behind them.
    forearm.rotation.x = -Math.max(0, mix(c => c.elbow))
  }

  const hand = bones.get(`hand.${side}` as BoneName)
  if (hand) {
    // Same fold direction as the elbow, and small. A hand that continues the
    // line of the forearm exactly is the clearest tell of a puppet.
    hand.rotation.x = -mix(c => c.wrist)
  }

  const shoulder = bones.get(`shoulder.${side}` as BoneName)
  if (shoulder) {
    // The shoulder girdle follows the arm: it protracts as the arm comes
    // forward and retracts behind. Subtle, but its absence is what makes an
    // arm look bolted to a torso rather than slung from it.
    shoulder.rotation.y = -outward * shoulderFlex * 0.22
  }
}

/**
 * Poses the rig for a locomotion cycle.
 *
 * `phase` is the stride position in `[0,1)`; 0 is left heel strike, 0.5 is
 * right. Allocation-free — this runs once per character per frame.
 */
export const applyGait = (
  bones: PoseTargets,
  phase: number,
  curves: GaitCurves,
  /**
   * Optional second curve set and a 0-to-1 weight toward it.
   *
   * Blending happens at the *sample* level, not by cross-fading two finished
   * poses, because walk and run share a structure: both are heel-strike-at-zero
   * cycles over the same joints. Interpolating the angles leaves the result a
   * valid gait at every weight, where cross-fading two poses taken at different
   * points in their cycles produces a leg that is briefly in neither.
   */
  toward: GaitCurves = curves,
  weight = 0
): void => {
  resetPose(bones)

  const p = phase - Math.floor(phase)
  const w = weight <= 0 ? 0 : weight >= 1 ? 1 : weight
  const bob = lerp(curves.bob, toward.bob, w)
  const pelvisList = lerp(curves.pelvisList, toward.pelvisList, w)
  const counterTwist = lerp(curves.counterTwist, toward.counterTwist, w)
  const lean = lerp(curves.lean, toward.lean, w)
  const rise = lerp(sampleCurveRaw(curves.rise, p), sampleCurveRaw(toward.rise, p), w)

  const hips = bones.get('hips')
  if (hips) {
    // `rise` is normalised to ±1, so the metre amplitude lives here — and it is
    // sampled raw, because that curve is not in degrees.
    hips.position.y += bob * 0.5 * rise
    // Pelvic list: the swing-side hip drops. Positive z-roll lifts the left.
    hips.rotation.z = pelvisList * Math.cos(Math.PI * 2 * p)
    // Transverse rotation — the pelvis leads with the swinging leg.
    hips.rotation.y = -counterTwist * 0.45 * Math.sin(Math.PI * 2 * p)
    hips.rotation.x = lean
  }

  const chest = bones.get('chest')
  if (chest) {
    // Counter-rotation against the pelvis. Without it the torso rides the hips
    // and the whole figure swivels like a wind-up toy.
    chest.rotation.y = counterTwist * Math.sin(Math.PI * 2 * p)
    chest.rotation.x = lean * 0.5
  }

  const head = bones.get('head')
  if (head) {
    // The head stabilises while everything under it rolls — a real reflex, and
    // the cheapest single thing that makes a gait look intentional.
    head.rotation.z = -pelvisList * 0.8 * Math.cos(Math.PI * 2 * p)
    head.rotation.x = -lean * 1.2
  }

  poseSide(bones, 'L', p, curves, toward, w)
  poseSide(bones, 'R', p + 0.5, curves, toward, w)
}

/**
 * Leans the upper body into a turn.
 *
 * Applied on top of a finished pose rather than inside it: banking is a function
 * of where the character is *going*, which a gait cycle knows nothing about.
 * Split across spine and head so the lean reads as the body committing to the
 * turn while the eyes stay level, which is what people actually do.
 */
export const applyBank = (bones: PoseTargets, radians: number): void => {
  const spine = bones.get('spine')
  if (spine) {
    spine.rotation.z += radians
  }
  const head = bones.get('head')
  if (head) {
    head.rotation.z -= radians * 0.6
  }
}

/**
 * Poses a one-shot jump.
 *
 * `t` runs 0→1 across the whole jump: crouch, drive, rise, fall, land. Both
 * legs move together — this is a two-footed jump, so unlike a gait there is no
 * half-cycle offset between the sides.
 */
export const applyJump = (bones: PoseTargets, t: number): void => {
  resetPose(bones)

  const clamped = t < 0 ? 0 : t > 1 ? 1 : t
  const lean = sampleClip(JUMP_LEAN, clamped)

  const hips = bones.get('hips')
  if (hips) {
    // Metres, straight from the curve — a jump's vertical travel is the point,
    // not a normalised shape scaled afterwards.
    // Metres, sampled raw — `JUMP_RISE` is a height, not an angle.
    hips.position.y += sampleClipRaw(JUMP_RISE, clamped)
    hips.rotation.x = lean
  }

  const chest = bones.get('chest')
  if (chest) {
    chest.rotation.x = lean * 0.5
  }
  const head = bones.get('head')
  if (head) {
    // Eyes stay on the horizon through the crouch, which is what makes the
    // anticipation read as *aiming* rather than as flinching.
    head.rotation.x = -lean * 1.4
  }

  const hip = sampleClip(JUMP_HIP, clamped)
  const knee = Math.max(0, sampleClip(JUMP_KNEE, clamped))
  const ankle = sampleClip(JUMP_ANKLE, clamped)
  const shoulder = sampleClip(JUMP_SHOULDER, clamped)
  const elbow = Math.max(0, sampleClip(JUMP_ELBOW, clamped))
  const wrist = sampleClip(JUMP_WRIST, clamped)

  for (const side of ['L', 'R'] as const) {
    const thigh = bones.get(`thigh.${side}` as BoneName)
    if (thigh) {
      thigh.rotation.x = -hip
    }
    const shin = bones.get(`shin.${side}` as BoneName)
    if (shin) {
      shin.rotation.x = knee
    }
    const foot = bones.get(`foot.${side}` as BoneName)
    if (foot) {
      foot.rotation.x = -ankle
    }
    const arm = bones.get(`upperArm.${side}` as BoneName)
    if (arm) {
      arm.rotation.x = -shoulder
      arm.rotation.z = (side === 'L' ? 1 : -1) * 0.06
    }
    const forearm = bones.get(`forearm.${side}` as BoneName)
    if (forearm) {
      // Forwards, like every other elbow here. See `poseSide`.
      forearm.rotation.x = -elbow
    }
    const hand = bones.get(`hand.${side}` as BoneName)
    if (hand) {
      hand.rotation.x = -wrist
    }
    const shoulderBone = bones.get(`shoulder.${side}` as BoneName)
    if (shoulderBone) {
      shoulderBone.rotation.y = -(side === 'L' ? 1 : -1) * shoulder * 0.22
    }
  }
}

/**
 * Standing idle: a slow breath and a barely-there sway.
 *
 * A character frozen in bind pose reads as broken, and a walk starting from an
 * already-asymmetric pose is far more convincing than one starting from
 * attention. `time` is seconds.
 */
export const applyIdle = (bones: PoseTargets, time: number): void => {
  resetPose(bones)

  const breath = Math.sin(time * 1.6)
  const sway = Math.sin(time * 0.7)

  const hips = bones.get('hips')
  if (hips) {
    hips.position.y += breath * 0.006
    hips.rotation.z = sway * 0.02
  }
  const chest = bones.get('chest')
  if (chest) {
    chest.rotation.x = -breath * 0.03
  }
  const head = bones.get('head')
  if (head) {
    head.rotation.y = sway * 0.08
    head.rotation.z = -sway * 0.02
  }
  for (const side of ['L', 'R'] as const) {
    // A relaxed stance is never symmetric: one knee stays slightly softer than
    // the other, which is most of the difference between standing and posing.
    const shin = bones.get(`shin.${side}` as BoneName)
    if (shin) {
      shin.rotation.x = side === 'L' ? 0.07 : 0.03
    }
    const arm = bones.get(`upperArm.${side}` as BoneName)
    if (arm) {
      arm.rotation.x = -0.04 + breath * 0.02
      arm.rotation.z = (side === 'L' ? 1 : -1) * 0.07
    }
    const forearm = bones.get(`forearm.${side}` as BoneName)
    if (forearm) {
      // Negative folds it forward. A resting arm is never straight — the elbow
      // carries a few degrees even hanging, and a perfectly straight one reads
      // as a mannequin.
      forearm.rotation.x = -0.16 - breath * 0.01
    }
    const hand = bones.get(`hand.${side}` as BoneName)
    if (hand) {
      hand.rotation.x = -0.12
    }
  }
}
