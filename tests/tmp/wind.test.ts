import { describe, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { Triangle, Vector3 } from 'three'
import { buildChibiGeometry } from '@/world/characters/chibiGeometry'
import { FACE_VERTICES } from '@/world/characters/face'

describe('winding', () => {
  it('compares geometric winding against authored normals', () => {
    const { geometry } = buildChibiGeometry()
    const pos = geometry.getAttribute('position')
    const nrm = geometry.getAttribute('normal')
    const idx = geometry.index!
    const faceStart = pos.count - FACE_VERTICES
    const a = new Vector3(), b = new Vector3(), c = new Vector3()
    const tri = new Triangle(), gn = new Vector3(), an = new Vector3()
    let bodyAgree = 0, bodyTotal = 0, faceAgree = 0, faceTotal = 0
    for (let t = 0; t < idx.count; t += 3) {
      const i0 = idx.getX(t), i1 = idx.getX(t + 1), i2 = idx.getX(t + 2)
      a.set(pos.getX(i0), pos.getY(i0), pos.getZ(i0))
      b.set(pos.getX(i1), pos.getY(i1), pos.getZ(i1))
      c.set(pos.getX(i2), pos.getY(i2), pos.getZ(i2))
      tri.set(a, b, c); tri.getNormal(gn)
      if (gn.lengthSq() < 1e-12) continue
      an.set(
        (nrm.getX(i0) + nrm.getX(i1) + nrm.getX(i2)) / 3,
        (nrm.getY(i0) + nrm.getY(i1) + nrm.getY(i2)) / 3,
        (nrm.getZ(i0) + nrm.getZ(i1) + nrm.getZ(i2)) / 3
      )
      const agree = gn.dot(an) > 0
      if (i0 >= faceStart) { faceTotal++; if (agree) faceAgree++ }
      else { bodyTotal++; if (agree) bodyAgree++ }
    }
    writeFileSync('tests/tmp/wind.txt',
      `body: ${bodyAgree}/${bodyTotal} agree (${(100*bodyAgree/bodyTotal).toFixed(1)}%)\n` +
      `face: ${faceAgree}/${faceTotal} agree (${(100*faceAgree/faceTotal).toFixed(1)}%)\n`)
  })
})
