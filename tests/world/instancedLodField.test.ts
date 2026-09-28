import { BufferAttribute, BufferGeometry, PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { InstancedLodField } from '@/world/lod/InstancedLodField'
import type { WorldAsset } from '@/world/assets/types'
import { createToonMaterial } from '@/world/shading/toonMaterial'

/**
 * ─── The instance matrix has to reach the GPU ───────────────────────────────
 *
 * One test, and it exists because of one bug that shipped and was invisible to
 * everything except a screenshot.
 *
 * `InstancedLodField` repacks a tier's matrix buffer only on a frame where some
 * instance's tier *membership changed*, which is right — a repack walks every
 * cell and every slot, and camera rotation alone must not trigger it. The dirty
 * set was computed as `mask ^ masks[i]`: the tiers whose membership differs.
 *
 * `addCell` seeds a new slot at `0xff` on purpose ("force a rebuild of whichever
 * tier claims it on the first update"). So on the first update after a build the
 * mask goes `0xff → 1`, and `1 ^ 0xff` is `0xfe` — **bit 0 clear**, because tier
 * 0 is set in both. The one tier that actually claimed the instance is the one
 * tier the repack skipped, and the instance kept the identity matrix it was
 * constructed with. It was therefore drawn at the world origin while every
 * counter in the perf panel reported it as visible, in the right cell, at the
 * right tier.
 *
 * It self-heals the instant a prop crosses a LOD boundary, which is why it
 * survived: walk toward anything and it snaps into place. What never crosses one
 * is a building the player spawns beside and looks at — which is every building
 * in the storyteller's hamlet, from the mark Chapter 1 starts on. The room was
 * there, and it was 1.7 km away.
 *
 * The fix is `|` instead of `^`. This test pins it from the outside: it asks the
 * field only for what a renderer asks it for — where is this instance — and
 * would have failed before the fix on the very first update.
 */

/** The smallest thing the field will accept: four tiers of one triangle. */
const stubAsset = (name: string): WorldAsset => {
  const tiers = [0, 1, 2, 3].map(() => {
    const geometry = new BufferGeometry()
    // A 2 m triangle, so the field's measured culling sphere is not degenerate.
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 0, 2, 0]), 3)
    )
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3))
    geometry.setIndex([0, 1, 2])
    return geometry
  })
  return {
    name,
    perfTag: 'test',
    tiers,
    material: createToonMaterial({ name: `${name}-material` }),
    outline: null,
    outlineMaxTier: 0,
    radius: 2,
    distanceScale: 1
  }
}

/** A camera looking down −Z from the origin, with its matrices settled. */
const cameraAt = (x: number, y: number, z: number): PerspectiveCamera => {
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 1000)
  camera.position.set(x, y, z)
  camera.lookAt(x, y, z - 1)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
  return camera
}

/** Translation of instance `i` in a tier's packed buffer. */
const translationOf = (field: InstancedLodField, tier: number, i = 0): [number, number, number] => {
  const array = field.group.children[tier]!.children[0]
  // The tier's instanced mesh is the field's own child chain; read it through
  // the public group rather than reaching into private state, so this test
  // fails for the reason a renderer would fail rather than for a refactor.
  const mesh = (array ?? field.group.children[tier]) as unknown as {
    instanceMatrix: { array: ArrayLike<number> }
  }
  const m = mesh.instanceMatrix.array
  return [m[i * 16 + 12]!, m[i * 16 + 13]!, m[i * 16 + 14]!]
}

describe('InstancedLodField', () => {
  it('packs an instance at its authored position on the very first update', () => {
    const field = new InstancedLodField(stubAsset('first-update'), 4)
    field.addCell('0_0', [{ x: 12, y: 3, z: -20, rotY: 0, scale: 1 }])

    // Ten metres behind it, looking at it: comfortably inside LOD0's 18 m band,
    // so the instance is claimed by tier 0 and by no other.
    const camera = cameraAt(12, 3, -10)
    field.update(camera, camera.position)

    expect(Array.from(field.tierCounts).slice(0, 1)).toEqual([1])
    expect(translationOf(field, 0)).toEqual([12, 3, -20])

    field.dispose()
  })

  /**
   * And it must stay correct when the instance changes tier and changes back,
   * which is the path that used to paper over the bug.
   */
  it('keeps the matrix through a tier change and back', () => {
    const field = new InstancedLodField(stubAsset('tier-change'), 4)
    field.addCell('0_0', [{ x: 0, y: 0, z: -30, rotY: 0, scale: 1 }])

    const near = cameraAt(0, 0, -20)
    field.update(near, near.position)
    expect(translationOf(field, 0)).toEqual([0, 0, -30])

    // Far enough out to leave LOD0 entirely.
    const far = cameraAt(0, 0, 90)
    field.update(far, far.position)
    expect(field.tierCounts[0]).toBe(0)

    field.update(near, near.position)
    expect(field.tierCounts[0]).toBe(1)
    expect(translationOf(field, 0)).toEqual([0, 0, -30])

    field.dispose()
  })
})
