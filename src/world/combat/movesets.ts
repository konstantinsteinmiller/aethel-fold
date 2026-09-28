import type { ItemKind } from '../characters/equipment'
import { poseFamilyOf } from '../characters/combatPoses'
import type { CombatantStats, DamageType, PoseClip } from './types'

/**
 * ─── Movesets ───────────────────────────────────────────────────────────────
 *
 * Five of them: three for people, one for the boar, one for a bow. They are
 * keyed by **pose family** (`combatPoses.POSE_FAMILY`) rather than by item kind,
 * which is the same decision that file makes and for the same reason — a
 * broadsword, a hunting dagger and a scrantis are swung the same way, and giving
 * each its own moveset would be three copies of one set of numbers that then
 * drift.
 *
 * What *does* vary per weapon is `WEAPON_SCALING` at the bottom: reach, damage
 * and speed. That split is the whole design. A dagger and a war axe share a
 * shape of motion and differ in every number attached to it, which is exactly
 * how they feel different to use without either of them needing an animation
 * nobody has authored.
 *
 * ── Reading a row ───────────────────────────────────────────────────────────
 *
 * `windup` / `active` / `recovery` are seconds and they sum to the length of the
 * attack. Only `active` can hit. The ratio between them is what a weapon *is*:
 *
 *   | family     | windup | active | recovery | reads as                       |
 *   |------------|-------:|-------:|---------:|--------------------------------|
 *   | sword      |   0.16 |   0.11 |     0.22 | fast, safe, low reward         |
 *   | greatsword |   0.42 |   0.16 |     0.52 | committed; you *choose* to     |
 *   | boar charge|   0.75 |   0.90 |     1.10 | unmissable telegraph, unstoppable |
 *
 * The boar's numbers are the ones worth defending. Its windup is nearly five
 * times a sword's, which sounds absurd and is the point: the animal is 400 kg,
 * it can only go in a straight line, and the chapter's answer to it is to *not
 * be there*. A boar with a sword's timing would be a boss fight; a boar with
 * this one is a hazard you learn to read, which is what "the trap failed and now
 * it is chasing Athalus" needs to feel like.
 */

export interface AttackDef {
  id: string
  windup: number
  active: number
  recovery: number
  /** Base damage before `WEAPON_SCALING`. */
  damage: number
  /** Poise removed from whoever it lands on. */
  poiseDamage: number
  staminaCost: number
  /** Reach from the actor's own centre, in metres, before scaling. */
  reach: number
  /** Half-angle of the swept arc, radians. π/2 is a full 180° sweep. */
  arc: number
  /** Forward travel over the windup and active windows, metres. */
  lunge: number
  type: DamageType
  /**
   * Poise this attack *grants its owner* while it runs.
   *
   * Trading blows is what separates a heavy weapon from a slow one. Without
   * super-armour the greatsword's 0.42 s windup means any faster weapon
   * interrupts it every time and the whole family is unusable; with it, a heavy
   * swing eats a light hit and lands anyway, which is the trade the player is
   * choosing when they commit.
   */
  superArmour?: number
  /** Chains into this attack when input arrives during `recovery`. */
  next?: string
  pose: PoseClip
}

// ─── Pose clips ─────────────────────────────────────────────────────────────
//
// See `types.ts::PoseKey` for the sign conventions. Every clip is authored in
// the same four beats — guard, wind, strike, settle — so a reader can compare
// two families by reading the same four keys.

/**
 * A one-handed horizontal cut, right to left.
 *
 * The chest carries it and the arm follows, which is the correct order for a
 * cut and is what stops it reading as a slap: at the strike key the chest has
 * already turned +0.42 and the shoulder is only +0.30 past neutral. Authoring
 * the arm as the prime mover was the first attempt and the figure looked like it
 * was throwing a frisbee.
 */
const SWORD_LIGHT_A: PoseClip = [
  { t: 0.0, bones: { chest: [0.05, -0.2, 0], 'upperArm.R': [-0.5, 0, -0.35], 'forearm.R': [-0.75, 0, 0], 'shoulder.R': [0, -0.12, 0] } },
  // Wind: torso right, elbow high and back. Hips counter-rotate a third of the
  // chest's turn, so the figure coils instead of pivoting as one block.
  { t: 0.34, bones: { hips: [0, -0.16, 0], chest: [-0.06, -0.62, 0.05], 'upperArm.R': [-0.95, -0.35, -0.6], 'forearm.R': [-1.5, 0, 0], 'shoulder.R': [0, -0.3, -0.15], head: [0, 0.2, 0] } },
  // Strike: through the target. The arm extends as the chest passes neutral.
  { t: 0.58, bones: { hips: [0, 0.1, 0], chest: [0.1, 0.42, -0.05], 'upperArm.R': [-1.15, 0.5, -0.15], 'forearm.R': [-0.3, 0, 0], 'shoulder.R': [0, 0.22, 0], head: [0, -0.12, 0] } },
  // Overshoot, then settle. The overshoot is 12 % past the strike and is what
  // gives the cut weight — a swing that stops exactly on contact reads as a
  // parry, not as a hit.
  { t: 0.74, bones: { hips: [0, 0.14, 0], chest: [0.06, 0.54, -0.06], 'upperArm.R': [-0.95, 0.66, -0.1], 'forearm.R': [-0.5, 0, 0], 'shoulder.R': [0, 0.28, 0] } },
  { t: 1.0, bones: { chest: [0.05, -0.2, 0], 'upperArm.R': [-0.5, 0, -0.35], 'forearm.R': [-0.75, 0, 0], 'shoulder.R': [0, -0.12, 0] } }
]

/** The return cut, left to right. Mirrors the first, so a chain reads as a rhythm. */
const SWORD_LIGHT_B: PoseClip = [
  { t: 0.0, bones: { chest: [0.06, 0.42, -0.05], 'upperArm.R': [-1.1, 0.5, -0.15], 'forearm.R': [-0.4, 0, 0], 'shoulder.R': [0, 0.22, 0] } },
  { t: 0.3, bones: { hips: [0, 0.14, 0], chest: [-0.05, 0.6, -0.08], 'upperArm.R': [-1.35, 0.75, -0.2], 'forearm.R': [-1.25, 0, 0], 'shoulder.R': [0, 0.32, 0], head: [0, -0.16, 0] } },
  { t: 0.56, bones: { hips: [0, -0.12, 0], chest: [0.12, -0.48, 0.05], 'upperArm.R': [-0.85, -0.5, -0.5], 'forearm.R': [-0.35, 0, 0], 'shoulder.R': [0, -0.24, -0.1], head: [0, 0.16, 0] } },
  { t: 0.72, bones: { hips: [0, -0.14, 0], chest: [0.08, -0.58, 0.06], 'upperArm.R': [-0.7, -0.62, -0.55], 'forearm.R': [-0.6, 0, 0], 'shoulder.R': [0, -0.3, -0.12] } },
  { t: 1.0, bones: { chest: [0.05, -0.2, 0], 'upperArm.R': [-0.5, 0, -0.35], 'forearm.R': [-0.75, 0, 0], 'shoulder.R': [0, -0.12, 0] } }
]

/** The finisher: a descending diagonal with the whole body behind it. */
const SWORD_LIGHT_C: PoseClip = [
  { t: 0.0, bones: { chest: [0.05, -0.2, 0], 'upperArm.R': [-0.5, 0, -0.35], 'forearm.R': [-0.75, 0, 0] } },
  { t: 0.36, hips: 0.04, bones: { hips: [0, -0.2, 0], chest: [-0.34, -0.5, 0.08], 'upperArm.R': [-2.15, -0.2, -0.5], 'forearm.R': [-1.1, 0, 0], 'shoulder.R': [0, -0.2, -0.3], head: [-0.2, 0.16, 0] } },
  { t: 0.6, hips: -0.09, bones: { hips: [0.1, 0.14, 0], chest: [0.42, 0.3, -0.06], 'upperArm.R': [-0.45, 0.3, -0.1], 'forearm.R': [-0.2, 0, 0], 'shoulder.R': [0, 0.16, 0.1], head: [0.24, -0.12, 0], 'thigh.R': [-0.35, 0, 0], 'shin.R': [0.5, 0, 0] } },
  { t: 0.78, hips: -0.06, bones: { hips: [0.06, 0.12, 0], chest: [0.34, 0.34, -0.05], 'upperArm.R': [-0.35, 0.32, -0.15], 'forearm.R': [-0.4, 0, 0] } },
  { t: 1.0, bones: { chest: [0.05, -0.2, 0], 'upperArm.R': [-0.5, 0, -0.35], 'forearm.R': [-0.75, 0, 0] } }
]

/** A thrust. Short arc, long reach — the answer to something out of cutting range. */
const SWORD_HEAVY: PoseClip = [
  { t: 0.0, bones: { chest: [0.05, -0.2, 0], 'upperArm.R': [-0.5, 0, -0.35], 'forearm.R': [-0.75, 0, 0] } },
  { t: 0.4, hips: 0.02, bones: { hips: [0, -0.28, 0], chest: [-0.1, -0.55, 0], 'upperArm.R': [-0.55, -0.45, -0.25], 'forearm.R': [-2.1, 0, 0], 'shoulder.R': [0, -0.34, 0], head: [0, 0.24, 0] } },
  { t: 0.6, hips: -0.05, bones: { hips: [0, 0.08, 0], chest: [0.08, 0.18, 0], 'upperArm.R': [-1.45, 0.14, -0.06], 'forearm.R': [-0.05, 0, 0], 'shoulder.R': [0, 0.3, 0], head: [0, -0.06, 0], 'thigh.L': [-0.6, 0, 0], 'shin.L': [0.75, 0, 0] } },
  { t: 0.8, hips: -0.03, bones: { chest: [0.06, 0.12, 0], 'upperArm.R': [-1.3, 0.1, -0.12], 'forearm.R': [-0.3, 0, 0] } },
  { t: 1.0, bones: { chest: [0.05, -0.2, 0], 'upperArm.R': [-0.5, 0, -0.35], 'forearm.R': [-0.75, 0, 0] } }
]

/**
 * The two-handed diagonal. Both arms travel; the left one leads at the top.
 *
 * The 0.06 m hip drop at the strike is not decoration — a heavy weapon is landed
 * by dropping into it, and the drop is what visually separates this from a fast
 * cut played slowly.
 */
const HEAVY_LIGHT_A: PoseClip = [
  { t: 0.0, bones: { chest: [0.04, -0.34, 0], 'upperArm.R': [-0.75, -0.2, -0.35], 'forearm.R': [-1.05, 0, 0], 'upperArm.L': [-0.85, 0.3, 0.4], 'forearm.L': [-1.15, 0, 0] } },
  { t: 0.4, hips: 0.05, bones: { hips: [0, -0.22, 0], chest: [-0.3, -0.72, 0.06], 'upperArm.R': [-2.0, -0.4, -0.55], 'forearm.R': [-1.35, 0, 0], 'upperArm.L': [-1.95, 0.2, 0.6], 'forearm.L': [-1.4, 0, 0], head: [-0.16, 0.24, 0] } },
  { t: 0.62, hips: -0.11, bones: { hips: [0.12, 0.2, 0], chest: [0.46, 0.46, -0.08], 'upperArm.R': [-0.4, 0.4, -0.12], 'forearm.R': [-0.15, 0, 0], 'upperArm.L': [-0.5, -0.2, 0.2], 'forearm.L': [-0.3, 0, 0], head: [0.26, -0.16, 0], 'thigh.R': [-0.4, 0, 0], 'shin.R': [0.62, 0, 0] } },
  { t: 0.8, hips: -0.07, bones: { hips: [0.08, 0.18, 0], chest: [0.36, 0.5, -0.06], 'upperArm.R': [-0.3, 0.44, -0.2], 'forearm.R': [-0.45, 0, 0], 'upperArm.L': [-0.45, -0.24, 0.25], 'forearm.L': [-0.6, 0, 0] } },
  { t: 1.0, bones: { chest: [0.04, -0.34, 0], 'upperArm.R': [-0.75, -0.2, -0.35], 'forearm.R': [-1.05, 0, 0], 'upperArm.L': [-0.85, 0.3, 0.4], 'forearm.L': [-1.15, 0, 0] } }
]

/** The horizontal return, at hip height. Wide arc — this is the crowd-clearer. */
const HEAVY_LIGHT_B: PoseClip = [
  { t: 0.0, bones: { chest: [0.06, 0.46, 0], 'upperArm.R': [-0.4, 0.4, -0.12], 'forearm.R': [-0.3, 0, 0], 'upperArm.L': [-0.5, -0.2, 0.2], 'forearm.L': [-0.45, 0, 0] } },
  { t: 0.38, bones: { hips: [0, 0.2, 0], chest: [0.1, 0.8, -0.05], 'upperArm.R': [-0.6, 0.85, -0.2], 'forearm.R': [-1.1, 0, 0], 'upperArm.L': [-0.75, 0.1, 0.45], 'forearm.L': [-1.2, 0, 0], head: [0, -0.22, 0] } },
  { t: 0.66, yaw: -0.22, bones: { hips: [0, -0.26, 0], chest: [0.12, -0.72, 0.06], 'upperArm.R': [-0.7, -0.7, -0.6], 'forearm.R': [-0.25, 0, 0], 'upperArm.L': [-0.6, -0.5, 0.3], 'forearm.L': [-0.35, 0, 0], head: [0, 0.24, 0] } },
  { t: 0.84, yaw: -0.14, bones: { hips: [0, -0.24, 0], chest: [0.08, -0.78, 0.06], 'upperArm.R': [-0.6, -0.8, -0.62], 'forearm.R': [-0.5, 0, 0], 'upperArm.L': [-0.55, -0.55, 0.32], 'forearm.L': [-0.6, 0, 0] } },
  { t: 1.0, bones: { chest: [0.04, -0.34, 0], 'upperArm.R': [-0.75, -0.2, -0.35], 'forearm.R': [-1.05, 0, 0], 'upperArm.L': [-0.85, 0.3, 0.4], 'forearm.L': [-1.15, 0, 0] } }
]

/** The overhead. Slowest thing a person does in this chapter, and it breaks guards. */
const HEAVY_HEAVY: PoseClip = [
  { t: 0.0, bones: { chest: [0.04, -0.34, 0], 'upperArm.R': [-0.75, -0.2, -0.35], 'forearm.R': [-1.05, 0, 0], 'upperArm.L': [-0.85, 0.3, 0.4], 'forearm.L': [-1.15, 0, 0] } },
  { t: 0.46, hips: 0.09, bones: { hips: [-0.1, 0, 0], chest: [-0.52, -0.1, 0], 'upperArm.R': [-2.55, -0.1, -0.3], 'forearm.R': [-1.0, 0, 0], 'upperArm.L': [-2.6, 0.1, 0.32], 'forearm.L': [-1.05, 0, 0], head: [-0.3, 0, 0] } },
  { t: 0.66, hips: -0.16, bones: { hips: [0.2, 0, 0], chest: [0.62, 0.02, 0], 'upperArm.R': [-0.2, 0, -0.1], 'forearm.R': [-0.05, 0, 0], 'upperArm.L': [-0.22, 0, 0.12], 'forearm.L': [-0.05, 0, 0], head: [0.34, 0, 0], 'thigh.R': [-0.55, 0, 0], 'shin.R': [0.85, 0, 0], 'thigh.L': [-0.5, 0, 0], 'shin.L': [0.8, 0, 0] } },
  { t: 0.86, hips: -0.1, bones: { hips: [0.14, 0, 0], chest: [0.5, 0, 0], 'upperArm.R': [-0.3, 0, -0.18], 'forearm.R': [-0.35, 0, 0], 'upperArm.L': [-0.32, 0, 0.2], 'forearm.L': [-0.35, 0, 0] } },
  { t: 1.0, bones: { chest: [0.04, -0.34, 0], 'upperArm.R': [-0.75, -0.2, -0.35], 'forearm.R': [-1.05, 0, 0], 'upperArm.L': [-0.85, 0.3, 0.4], 'forearm.L': [-1.15, 0, 0] } }
]

/**
 * The scrantis crack.
 *
 * The chain is a rigid mesh (`arlaanArms.ts` says why), so the whip is carried
 * entirely by the *arm*: a long circular sweep over the head and down, which is
 * how a showman actually throws one and which is the only motion that makes a
 * hanging chain look like it is being driven rather than dragged. It reaches
 * further than any other one-hander and has the longest recovery of the three.
 */
const WHIP_CRACK: PoseClip = [
  { t: 0.0, bones: { chest: [0.05, -0.2, 0], 'upperArm.R': [-0.5, 0, -0.35], 'forearm.R': [-0.75, 0, 0] } },
  { t: 0.3, bones: { hips: [0, -0.14, 0], chest: [-0.24, -0.5, 0.05], 'upperArm.R': [-2.3, -0.5, -0.45], 'forearm.R': [-0.5, 0, 0], 'shoulder.R': [0, -0.24, -0.24], head: [-0.16, 0.18, 0] } },
  { t: 0.48, bones: { hips: [0, 0, 0], chest: [0.16, 0.1, -0.02], 'upperArm.R': [-2.5, 0.4, 0.1], 'forearm.R': [-0.15, 0, 0], 'shoulder.R': [0, 0.1, 0.1] } },
  { t: 0.62, bones: { hips: [0, 0.12, 0], chest: [0.34, 0.44, -0.06], 'upperArm.R': [-0.9, 0.7, -0.05], 'forearm.R': [-0.1, 0, 0], 'shoulder.R': [0, 0.26, 0], head: [0.12, -0.14, 0] } },
  { t: 0.8, bones: { chest: [0.16, 0.34, -0.04], 'upperArm.R': [-0.75, 0.5, -0.2], 'forearm.R': [-0.5, 0, 0] } },
  { t: 1.0, bones: { chest: [0.05, -0.2, 0], 'upperArm.R': [-0.5, 0, -0.35], 'forearm.R': [-0.75, 0, 0] } }
]

/**
 * The boar's charge and its gore.
 *
 * These drive a **quadruped rig built on the same humanoid skeleton** (see
 * `creatures/trollBoar.ts`), so the names below mean something different from
 * everywhere else in this file: `thigh.*` are the hind legs, `upperArm.*` are the
 * forelegs, and `chest`/`head` are the shoulder hump and the snout. That reuse is
 * deliberate and its cost is exactly this paragraph — one skeleton, one skinning
 * path, one pose evaluator, and a comment wherever the names lie.
 */
const BOAR_CHARGE: PoseClip = [
  { t: 0.0, bones: { chest: [0.1, 0, 0], head: [0.1, 0, 0], 'thigh.L': [0.2, 0, 0], 'thigh.R': [0.2, 0, 0], 'upperArm.L': [-0.1, 0, 0], 'upperArm.R': [-0.1, 0, 0] } },
  // The scrape: head down, hindquarters up, both front feet back. This is the
  // read, and it is 0.75 s long because the player has to have time to move.
  { t: 0.3, hips: 0.05, bones: { chest: [0.42, 0, 0], head: [0.3, 0.16, 0], 'thigh.L': [-0.5, 0, 0], 'thigh.R': [-0.45, 0, 0], 'upperArm.L': [0.55, 0, 0], 'upperArm.R': [0.5, 0, 0] } },
  // Launch.
  { t: 0.42, hips: -0.04, bones: { chest: [-0.1, 0, 0], head: [-0.05, 0, 0], 'thigh.L': [0.6, 0, 0], 'thigh.R': [0.55, 0, 0], 'upperArm.L': [-0.7, 0, 0], 'upperArm.R': [-0.65, 0, 0] } },
  { t: 0.72, hips: 0.03, bones: { chest: [0.16, 0, 0], head: [0.12, -0.1, 0], 'thigh.L': [-0.2, 0, 0], 'thigh.R': [-0.25, 0, 0], 'upperArm.L': [0.3, 0, 0], 'upperArm.R': [0.35, 0, 0] } },
  { t: 1.0, bones: { chest: [0.1, 0, 0], head: [0.1, 0, 0], 'thigh.L': [0.2, 0, 0], 'thigh.R': [0.2, 0, 0], 'upperArm.L': [-0.1, 0, 0], 'upperArm.R': [-0.1, 0, 0] } }
]

const BOAR_GORE: PoseClip = [
  { t: 0.0, bones: { chest: [0.1, 0, 0], head: [0.1, 0, 0] } },
  { t: 0.4, bones: { chest: [0.34, -0.3, 0], head: [0.4, -0.36, 0], 'upperArm.L': [0.3, 0, 0] } },
  // The toss: the head comes up and across, which is how a boar actually kills.
  { t: 0.58, bones: { chest: [-0.3, 0.34, 0], head: [-0.55, 0.42, 0], 'upperArm.L': [-0.2, 0, 0] } },
  { t: 0.78, bones: { chest: [-0.12, 0.2, 0], head: [-0.25, 0.24, 0] } },
  { t: 1.0, bones: { chest: [0.1, 0, 0], head: [0.1, 0, 0] } }
]

// ─── The tables ─────────────────────────────────────────────────────────────

export type MovesetId = 'blade' | 'heavy' | 'whip' | 'beast'

export const ATTACKS: Record<string, AttackDef> = {
  // ── One-handed blades: three-hit chain plus a thrust ──────────────────────
  bladeA: {
    id: 'bladeA',
    windup: 0.16,
    active: 0.11,
    recovery: 0.22,
    damage: 11,
    poiseDamage: 9,
    staminaCost: 9,
    reach: 1.55,
    arc: 1.25,
    lunge: 0.42,
    type: 'slash',
    next: 'bladeB',
    pose: SWORD_LIGHT_A
  },
  bladeB: {
    id: 'bladeB',
    windup: 0.14,
    active: 0.11,
    recovery: 0.24,
    damage: 12,
    poiseDamage: 10,
    staminaCost: 10,
    reach: 1.55,
    arc: 1.25,
    lunge: 0.36,
    type: 'slash',
    next: 'bladeC',
    pose: SWORD_LIGHT_B
  },
  bladeC: {
    id: 'bladeC',
    windup: 0.24,
    active: 0.13,
    recovery: 0.42,
    // The finisher pays for the two before it. Half again the damage of the
    // opener and enough poise to stagger any person in the chapter outright,
    // which is what makes finishing a chain the correct thing to want.
    damage: 19,
    poiseDamage: 24,
    staminaCost: 15,
    reach: 1.7,
    arc: 1.0,
    lunge: 0.75,
    type: 'slash',
    superArmour: 8,
    pose: SWORD_LIGHT_C
  },
  bladeThrust: {
    id: 'bladeThrust',
    windup: 0.3,
    active: 0.1,
    recovery: 0.38,
    damage: 16,
    poiseDamage: 13,
    staminaCost: 14,
    // A third again the cutting reach, over a *sixth* of the arc. That trade is
    // the whole of what a thrust is for, and it is the only one-handed attack
    // that will reach a boar without stepping inside its own reach.
    reach: 2.15,
    arc: 0.32,
    lunge: 1.05,
    type: 'pierce',
    pose: SWORD_HEAVY
  },

  // ── Two-handed: axe and greatsword ───────────────────────────────────────
  heavyA: {
    id: 'heavyA',
    windup: 0.42,
    active: 0.16,
    recovery: 0.52,
    damage: 26,
    poiseDamage: 30,
    staminaCost: 22,
    reach: 1.95,
    arc: 1.15,
    lunge: 0.6,
    type: 'slash',
    superArmour: 14,
    next: 'heavyB',
    pose: HEAVY_LIGHT_A
  },
  heavyB: {
    id: 'heavyB',
    windup: 0.34,
    active: 0.2,
    recovery: 0.6,
    damage: 24,
    poiseDamage: 28,
    staminaCost: 24,
    reach: 2.05,
    // A full half-circle. The one attack in the chapter that hits three bandits
    // at once, which is why the ambush is winnable at all with four people.
    arc: 1.85,
    lunge: 0.3,
    type: 'slash',
    superArmour: 14,
    pose: HEAVY_LIGHT_B
  },
  heavySmash: {
    id: 'heavySmash',
    windup: 0.62,
    active: 0.16,
    recovery: 0.74,
    damage: 38,
    // Above every guard's stamina pool at this tier, so it *is* the guard-break.
    poiseDamage: 55,
    staminaCost: 32,
    reach: 1.9,
    arc: 0.7,
    lunge: 0.85,
    type: 'blunt',
    superArmour: 26,
    pose: HEAVY_HEAVY
  },

  // ── The scrantis ─────────────────────────────────────────────────────────
  whipCrack: {
    id: 'whipCrack',
    windup: 0.3,
    active: 0.18,
    recovery: 0.46,
    damage: 14,
    poiseDamage: 11,
    staminaCost: 13,
    // The longest reach of any melee attack, at the widest arc, for the least
    // damage per hit and the worst recovery. That is a whip, and it is what
    // makes Jester's fight in the ambush look different from Athalus's.
    reach: 2.6,
    arc: 1.6,
    lunge: 0.2,
    type: 'slash',
    next: 'whipCrack',
    pose: WHIP_CRACK
  },

  // ── The Trollschwein ─────────────────────────────────────────────────────
  boarCharge: {
    id: 'boarCharge',
    windup: 0.75,
    active: 0.9,
    recovery: 1.1,
    damage: 34,
    poiseDamage: 70,
    staminaCost: 0,
    reach: 1.9,
    arc: 0.55,
    // Six metres of travel. The charge *is* the movement — the brain does not
    // steer during it, which is what makes side-stepping the correct answer and
    // backing away the wrong one.
    lunge: 6.4,
    type: 'blunt',
    superArmour: 999,
    pose: BOAR_CHARGE
  },
  boarGore: {
    id: 'boarGore',
    windup: 0.34,
    active: 0.22,
    recovery: 0.66,
    damage: 19,
    poiseDamage: 40,
    staminaCost: 0,
    reach: 1.75,
    arc: 0.9,
    lunge: 0.55,
    type: 'pierce',
    superArmour: 40,
    pose: BOAR_GORE
  }
}

export interface Moveset {
  /** First attack of the light chain. */
  light: string
  /** The committed one. */
  heavy: string
  /** Can this actor put a guard up at all? */
  canBlock: boolean
  canDodge: boolean
}

export const MOVESETS: Record<MovesetId, Moveset> = {
  blade: { light: 'bladeA', heavy: 'bladeThrust', canBlock: true, canDodge: true },
  heavy: { light: 'heavyA', heavy: 'heavySmash', canBlock: true, canDodge: true },
  whip: { light: 'whipCrack', heavy: 'bladeThrust', canBlock: true, canDodge: true },
  // A boar has no guard and does not roll. Its defence is that it weighs as much
  // as the four of them together.
  beast: { light: 'boarGore', heavy: 'boarCharge', canBlock: false, canDodge: false }
}

/**
 * Per-weapon numbers, multiplied onto whatever the moveset says.
 *
 * This is the axis the moveset deliberately does *not* carry. Every one-handed
 * blade swings along `SWORD_LIGHT_A`; a dagger does 55 % of the damage over 70 %
 * of the reach and 30 % faster, and a broadsword does 115 % over 105 % and 8 %
 * slower. Three numbers, and they are the entire difference between the two in
 * the hand.
 */
export interface WeaponScaling {
  damage: number
  reach: number
  /** Multiplies every phase duration. Below 1 is faster. */
  speed: number
  /** Multiplies stamina cost. */
  effort: number
}

const SCALING: Partial<Record<ItemKind, WeaponScaling>> = {
  sword: { damage: 1, reach: 1, speed: 1, effort: 1 },
  broadsword: { damage: 1.15, reach: 1.05, speed: 1.08, effort: 1.1 },
  // A skinning knife, used by somebody the book says does not know how to fight
  // with one. Fast and nearly harmless — which is exactly the situation Chapter 1
  // puts Athalus in, and the player should feel it.
  dagger: { damage: 0.55, reach: 0.7, speed: 0.7, effort: 0.6 },
  scrantis: { damage: 1, reach: 1, speed: 1, effort: 1 },
  greatsword: { damage: 1.1, reach: 1.05, speed: 1, effort: 1 },
  warAxe: { damage: 1.2, reach: 0.95, speed: 1.05, effort: 1.15 }
}

const UNARMED: WeaponScaling = { damage: 0.35, reach: 0.75, speed: 0.85, effort: 0.7 }

export const scalingFor = (kind: ItemKind | null): WeaponScaling =>
  (kind && SCALING[kind]) || UNARMED

/**
 * Which moveset a weapon uses.
 *
 * Routed through `POSE_FAMILY` so it cannot disagree with the draw animation:
 * anything that draws like a greatsword swings like one. `bow` and `crossbow`
 * map to null because they are not melee at all — the projectile path in
 * `Projectiles.ts` owns them.
 */
export const movesetFor = (kind: ItemKind | null): MovesetId => {
  if (kind === 'scrantis') {
    return 'whip'
  }
  const family = kind === null ? null : poseFamilyOf(kind)
  if (family === 'greatsword') {
    return 'heavy'
  }
  return 'blade'
}

// ─── Stat blocks ────────────────────────────────────────────────────────────

/**
 * Everyone in Chapter 1, by the numbers.
 *
 * The four leads are deliberately *not* identical, and the differences come
 * straight out of the prose rather than out of class design:
 *
 *   * Athalus has the most health and the most stamina — a smith's son who has
 *     trained with a sword daily — and the worst weapon.
 *   * Jester is the most fragile and has the longest reach.
 *   * Gearn is the fastest on his feet, which the book states outright twice.
 *   * Kareen is slower than the others (also stated: "the somewhat slower
 *     Kareen") and is the best shot in the village.
 *   * Theodor has the largest health pool and the smallest stamina pool: the
 *     book says he is the weakest fighter of the group and "loses his wind
 *     quickly". That is a stamina bar, exactly.
 */
export const STATS: Record<string, CombatantStats> = {
  athalus: { maxHp: 120, maxStamina: 110, staminaRegen: 26, staminaDelay: 0.5, maxPoise: 34, poiseRegen: 14, moveSpeed: 3.5, radius: 0.32, height: 1.35 },
  jester: { maxHp: 92, maxStamina: 100, staminaRegen: 28, staminaDelay: 0.45, maxPoise: 24, poiseRegen: 16, moveSpeed: 3.7, radius: 0.29, height: 1.28 },
  gearn: { maxHp: 105, maxStamina: 96, staminaRegen: 25, staminaDelay: 0.5, maxPoise: 30, poiseRegen: 13, moveSpeed: 4.0, radius: 0.31, height: 1.3 },
  kareen: { maxHp: 88, maxStamina: 92, staminaRegen: 30, staminaDelay: 0.4, maxPoise: 22, poiseRegen: 15, moveSpeed: 3.2, radius: 0.28, height: 1.24 },
  theodor: { maxHp: 132, maxStamina: 72, staminaRegen: 18, staminaDelay: 0.75, maxPoise: 36, poiseRegen: 10, moveSpeed: 3.0, radius: 0.33, height: 1.36 },
  bandit: { maxHp: 58, maxStamina: 70, staminaRegen: 18, staminaDelay: 0.7, maxPoise: 22, poiseRegen: 10, moveSpeed: 3.4, might: 0.62, radius: 0.3, height: 1.3 },
  banditLeader: { maxHp: 86, maxStamina: 88, staminaRegen: 20, staminaDelay: 0.6, maxPoise: 30, poiseRegen: 11, moveSpeed: 3.5, might: 0.78, radius: 0.32, height: 1.35 },
  /**
   * The Trollschwein.
   *
   * "About four feet tall and a good eight feet long", it chewed through an
   * eight-by-eight-pace net in seconds, and four teenagers with bows only put it
   * down because three of them shot it in the flank at once. So: two and a half
   * times the health of a bandit leader, poise nothing in the chapter can break,
   * and a top speed faster than any of them can run — the prose is explicit that
   * it nearly catches Athalus, who is running for his life in a straight line.
   */
  /**
   * Anybody who is not in this chapter to fight: the storyteller, his son and
   * daughter-in-law, two children, and Athalus's mother.
   *
   * A real block rather than a shared default, because a default is a claim
   * nobody made. `might` at 0 is the operative field — a villager who somehow
   * ended up swinging at something would do nothing, which is the correct
   * outcome and is checked rather than assumed.
   */
  villager: { maxHp: 40, maxStamina: 40, staminaRegen: 12, staminaDelay: 1, maxPoise: 10, poiseRegen: 6, moveSpeed: 2.6, might: 0, radius: 0.28, height: 1.2 },
  boar: { maxHp: 220, maxStamina: 100, staminaRegen: 12, staminaDelay: 1, maxPoise: 100, poiseRegen: 8, moveSpeed: 5.6, radius: 0.62, height: 1.1 }
}
