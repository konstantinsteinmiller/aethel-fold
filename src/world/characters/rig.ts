/**
 * ─── The chibi humanoid rig ─────────────────────────────────────────────────
 *
 * Bone names, hierarchy and bind pose for the character family (GDD §6 Phase C).
 * Data only — no three.js — so the bind pose can be reasoned about, tested and
 * shared by the mesh builder, the skinning weights and the animation without any
 * of them owning it.
 *
 * ── Proportions ─────────────────────────────────────────────────────────────
 *
 * Three heads tall, per the GDD. That is the whole silhouette decision: at
 * 1.56 m total the head is 0.52 m across, which is enormous next to a real
 * figure and exactly what makes the style read as *chibi* rather than as a short
 * adult. Everything else follows from it — the limbs are short and thick because
 * a normal limb hung off this head looks like a spider.
 *
 * ── Why the bind pose is A-pose, not T-pose ─────────────────────────────────
 *
 * Arms hang at ~35° from vertical rather than straight out. A T-pose puts the
 * shoulder deltoid at its extreme of rotation, so *every* animation rotates away
 * from it and the skin creases at the one joint the eye is drawn to. An A-pose
 * sits near the middle of the arm's real range, which halves the worst-case
 * deformation in both directions.
 */

/** Bone identifiers. Ordered parents-before-children — `buildSkeleton` relies on it. */
export const BONE_NAMES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'shoulder.L',
  'upperArm.L',
  'forearm.L',
  'hand.L',
  'shoulder.R',
  'upperArm.R',
  'forearm.R',
  'hand.R',
  'thigh.L',
  'shin.L',
  'foot.L',
  'thigh.R',
  'shin.R',
  'foot.R'
] as const

export type BoneName = (typeof BONE_NAMES)[number]

export interface BoneDefinition {
  name: BoneName
  parent: BoneName | null
  /** Head of the bone in **world** space at bind time, metres, feet at y = 0. */
  head: readonly [number, number, number]
}

/**
 * The bind pose, in world space.
 *
 * World rather than parent-relative on purpose: every consumer here reasons in
 * world space — the mesh builder places limbs between joint positions, the
 * weighting measures distance to a bone's *segment*, and the tests check
 * proportions. Parent-relative offsets are derived once in `buildSkeleton`,
 * which is the only place that needs them.
 */
export const BIND_POSE: readonly BoneDefinition[] = [
  { name: 'hips', parent: null, head: [0, 0.62, 0] },
  { name: 'spine', parent: 'hips', head: [0, 0.78, 0] },
  { name: 'chest', parent: 'spine', head: [0, 0.95, 0] },
  { name: 'neck', parent: 'chest', head: [0, 1.06, 0] },
  { name: 'head', parent: 'neck', head: [0, 1.14, 0] },

  // Arms. The A-pose spread is in the x/y offsets — see the note above.
  { name: 'shoulder.L', parent: 'chest', head: [0.09, 1.02, 0] },
  { name: 'upperArm.L', parent: 'shoulder.L', head: [0.17, 1.0, 0] },
  { name: 'forearm.L', parent: 'upperArm.L', head: [0.26, 0.79, 0] },
  { name: 'hand.L', parent: 'forearm.L', head: [0.32, 0.6, 0] },
  { name: 'shoulder.R', parent: 'chest', head: [-0.09, 1.02, 0] },
  { name: 'upperArm.R', parent: 'shoulder.R', head: [-0.17, 1.0, 0] },
  { name: 'forearm.R', parent: 'upperArm.R', head: [-0.26, 0.79, 0] },
  { name: 'hand.R', parent: 'forearm.R', head: [-0.32, 0.6, 0] },

  { name: 'thigh.L', parent: 'hips', head: [0.09, 0.6, 0] },
  { name: 'shin.L', parent: 'thigh.L', head: [0.1, 0.33, 0] },
  { name: 'foot.L', parent: 'shin.L', head: [0.1, 0.06, 0] },
  { name: 'thigh.R', parent: 'hips', head: [-0.09, 0.6, 0] },
  { name: 'shin.R', parent: 'thigh.R', head: [-0.1, 0.33, 0] },
  { name: 'foot.R', parent: 'shin.R', head: [-0.1, 0.06, 0] }
]

/** Crown of the head in bind pose. Total figure height. */
export const FIGURE_HEIGHT = 1.56
/** Half the head's height — a third of the figure. Large by design. */
export const HEAD_HALF_HEIGHT = 0.26

const byName = new Map<BoneName, BoneDefinition>(BIND_POSE.map(bone => [bone.name, bone]))

export const boneDefinition = (name: BoneName): BoneDefinition => {
  const bone = byName.get(name)
  if (!bone) {
    throw new Error(`[rig] unknown bone "${name}"`)
  }
  return bone
}

/**
 * A bone's bind-pose segment: its own head to its child's head.
 *
 * The mesh is built around these, not around the joints alone — a limb is a
 * volume between two joints, and the weighting needs the same segment to measure
 * against. Leaf bones (`hand`, `head`, `foot`) have no child to point at, so the
 * caller supplies a direction and length instead.
 */
export const boneSegment = (name: BoneName): { head: readonly [number, number, number]; tail: readonly [number, number, number] } | null => {
  const child = BIND_POSE.find(bone => bone.parent === name)
  if (!child) {
    return null
  }
  return { head: boneDefinition(name).head, tail: child.head }
}
