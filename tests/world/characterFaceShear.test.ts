import { expect, it } from 'vitest'
import { Matrix4, Vector3 } from 'three'
import { buildChibiGeometry } from '@/world/characters/chibiGeometry'
import { FACE_TRIANGLES } from '@/world/characters/face'
import { buildSkeleton } from '@/world/characters/skeleton'

/**
 * Head-turn shear: does the face stay welded to the skull when the neck bends?
 *
 * The face is weight 1 on `head`. The skull under it is NOT — `chibiGeometry`
 * ramps the head part's weight toward `neck` over the first 30 % of the part,
 * and the head's lower cap (which is where the face sits) is in that ramp. If
 * the two disagree, a neck rotation slides the eyes across the skull.
 */
it('keeps the face welded to the skull when the head turns', () => {
  const { geometry } = buildChibiGeometry()
  const { skeleton, byName, root } = buildSkeleton()

  const index = geometry.index!
  const position = geometry.getAttribute('position')
  const skinIndex = geometry.getAttribute('skinIndex')
  const skinWeight = geometry.getAttribute('skinWeight')

  // The face is appended last, so it owns the tail of the index buffer.
  const faceStart = index.count - FACE_TRIANGLES * 3
  const faceVerts = new Set<number>()
  for (let i = faceStart; i < index.count; i++) {
    faceVerts.add(index.getX(i))
  }
  const bodyVerts: number[] = []
  for (let v = 0; v < position.count; v++) {
    if (!faceVerts.has(v)) {
      bodyVerts.push(v)
    }
  }

  const bindInverses = skeleton.boneInverses
  const rest: Matrix4[] = skeleton.bones.map((b, i) => b.matrixWorld.clone().multiply(bindInverses[i]!))

  // Rotate the HEAD bone, not the neck. Head is neck's child, so rotating the
  // neck carries both bones through the same world transform and a 50/50
  // head/neck vertex moves identically to a 100 % head one — the test could not
  // fail. Turning the head is what makes the two bones disagree.
  byName.get('head')!.rotation.y = (25 * Math.PI) / 180
  root.updateMatrixWorld(true)
  const posed: Matrix4[] = skeleton.bones.map((b, i) => b.matrixWorld.clone().multiply(bindInverses[i]!))

  const skin = (v: number, mats: Matrix4[], out: Vector3): Vector3 => {
    const p = new Vector3().fromBufferAttribute(position, v)
    const acc = new Vector3()
    const tmp = new Vector3()
    for (let k = 0; k < 4; k++) {
      const w = skinWeight.getComponent(v, k)
      if (w === 0) continue
      const b = skinIndex.getComponent(v, k)
      acc.addScaledVector(tmp.copy(p).applyMatrix4(mats[b]!), w)
    }
    return out.copy(acc)
  }

  const a = new Vector3()
  const b = new Vector3()
  let worst = 0
  let worstAt = ''

  for (const fv of faceVerts) {
    // Nearest skull vertex in bind pose.
    const fp = new Vector3().fromBufferAttribute(position, fv)
    let near = -1
    let nearD = Infinity
    for (const bv of bodyVerts) {
      const d = fp.distanceToSquared(new Vector3().fromBufferAttribute(position, bv))
      if (d < nearD) { nearD = d; near = bv }
    }
    const restGap = skin(fv, rest, a).distanceTo(skin(near, rest, b))
    const posedGap = skin(fv, posed, a).distanceTo(skin(near, posed, b))
    const drift = Math.abs(posedGap - restGap)
    if (drift > worst) { worst = drift; worstAt = `v${fv} y=${fp.y.toFixed(3)}` }
  }

  // Control: how much do two *adjacent skull* vertices in the same region move
  // relative to each other? The skull is itself blended, so some relative motion
  // is normal skinning, not a defect. Without this the face's number is
  // unanchored — "small" proves nothing.
  let control = 0
  for (const bv of bodyVerts) {
    const bp = new Vector3().fromBufferAttribute(position, bv)
    if (bp.y < 1.15 || bp.y > 1.35 || bp.z < 0.1) continue
    let near = -1
    let nearD = Infinity
    for (const ov of bodyVerts) {
      if (ov === bv) continue
      const d = bp.distanceToSquared(new Vector3().fromBufferAttribute(position, ov))
      if (d < nearD) { nearD = d; near = ov }
    }
    if (near < 0) continue
    const restGap = skin(bv, rest, a).distanceTo(skin(near, rest, b))
    const posedGap = skin(bv, posed, a).distanceTo(skin(near, posed, b))
    control = Math.max(control, Math.abs(posedGap - restGap))
  }

  console.log(`face-vs-skull drift at 25° head yaw: ${(worst * 1000).toFixed(2)} mm (${worstAt})`)
  console.log(`skull-vs-skull control in the same band: ${(control * 1000).toFixed(2)} mm`)

  // An absolute ceiling, deliberately **not** a multiple of the control.
  //
  // The control comes out at ~36 mm — the skull's own neighbours genuinely move
  // that much relative to each other, because the head part's blend ramp spans
  // this band. So "no worse than the skull" would permit ~49 mm, which is
  // precisely the broken value this test exists to catch: the tolerance would
  // have been wide enough to pass the bug. The control is worth measuring and
  // printing, because it is what makes 1.7 mm meaningful, but it is the wrong
  // thing to assert against.
  //
  // Measured: 1.70 mm with the face riding the skull's blend, 49.58 mm with the
  // rigid weight-1 binding. 5 mm sits an order of magnitude clear of both.
  expect(worst).toBeLessThan(0.005)
})
