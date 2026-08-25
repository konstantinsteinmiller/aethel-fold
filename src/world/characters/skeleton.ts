import { Bone, Matrix4, Skeleton, Vector3 } from 'three'
import { BIND_POSE, BONE_NAMES, type BoneName } from './rig'

/**
 * ─── Skeleton from the bind pose ────────────────────────────────────────────
 *
 * Turns `rig.ts`'s world-space joint table into a three `Skeleton`, in
 * `BONE_NAMES` order so the geometry's `skinIndex` attribute lines up with
 * `skeleton.bones` by construction rather than by convention.
 *
 * The rig stores world positions because that is how every consumer thinks about
 * it; three needs parent-relative ones. Converting here — once, in the only
 * place that has both — is what keeps a "why is the forearm at the origin"
 * class of bug from ever existing.
 *
 * ── Inverse binds are computed, not assumed ─────────────────────────────────
 *
 * `skeleton.calculateInverses()` requires every bone's world matrix to be
 * current, and a freshly built `Bone` has an identity world matrix until
 * something updates it. Calling `updateMatrixWorld(true)` on the root first is
 * the whole difference between a character that skins correctly and one that
 * collapses to a point at the origin — with no error, because an all-zero
 * inverse bind is a perfectly valid matrix.
 */

export interface BuiltSkeleton {
  skeleton: Skeleton
  root: Bone
  byName: Map<BoneName, Bone>
}

export const buildSkeleton = (): BuiltSkeleton => {
  const byName = new Map<BoneName, Bone>()
  const bones: Bone[] = []
  const world = new Map<BoneName, Vector3>()

  for (const definition of BIND_POSE) {
    const bone = new Bone()
    bone.name = definition.name
    byName.set(definition.name, bone)
    world.set(definition.name, new Vector3(...definition.head))
  }

  let root: Bone | null = null
  for (const definition of BIND_POSE) {
    const bone = byName.get(definition.name)!
    if (definition.parent === null) {
      bone.position.copy(world.get(definition.name)!)
      root = bone
      continue
    }
    const parent = byName.get(definition.parent)!
    bone.position.copy(world.get(definition.name)!).sub(world.get(definition.parent)!)
    parent.add(bone)
  }

  if (!root) {
    throw new Error('[skeleton] rig has no root bone')
  }

  // `BONE_NAMES` order, not traversal order — the geometry indexes into this.
  for (const name of BONE_NAMES) {
    bones.push(byName.get(name)!)
  }

  root.updateMatrixWorld(true)

  // Bind matrix is identity: the geometry is authored in the same world space
  // the bind pose is, so no extra transform stands between them.
  const skeleton = new Skeleton(bones)
  skeleton.calculateInverses()
  skeleton.pose()

  return { skeleton, root, byName }
}

/** Identity bind matrix — see the note above. Exported so the mesh binds the same one. */
export const BIND_MATRIX = new Matrix4()
