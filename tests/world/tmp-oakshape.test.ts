import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { buildShape } from '../../src/world/assets/oldOak'
import { lumpRadius } from '../../src/world/geometry/build'

const INFLATE = 1 / Math.cos(Math.PI / 5) ** 0.6

/** The surface `blobGeometry` actually renders, along a unit direction. */
const effRadius = (
  c: { radius: number; squash: number; lumps: Parameters<typeof lumpRadius>[1] },
  dir: Vector3
): number => {
  const r = c.radius * INFLATE * lumpRadius(dir, c.lumps)
  return 1 / Math.hypot(dir.x / r, dir.y / (r * c.squash), dir.z / r)
}

describe('old oak shape', () => {
  it('canopy is one connected mass and every limb tip is buried', () => {
    let worstGap = Number.POSITIVE_INFINITY
    let worstTip = 0
    for (const seed of [1, 2, 3, 4, 5, 7, 9, 12, 41, 100, 777, 2024]) {
      const shape = buildShape({ seed })
      const n = shape.clumps.length

      for (let i = 0; i < n; i++) {
        let best = Number.NEGATIVE_INFINITY
        for (let j = 0; j < n; j++) {
          if (i === j) continue
          const a = shape.clumps[i]!
          const b = shape.clumps[j]!
          const d = new Vector3().subVectors(b.center, a.center)
          const dist = d.length()
          d.normalize()
          const reach = effRadius(a, d) + effRadius(b, d.clone().negate())
          best = Math.max(best, reach - dist)
        }
        worstGap = Math.min(worstGap, best)
        expect(best, `seed ${seed} clump ${i} floats free (gap ${(-best).toFixed(2)} m)`).toBeGreaterThan(0.15)
      }

      for (let i = 0; i < shape.limbs.length; i++) {
        const limb = shape.limbs[i]!
        const clump = shape.clumps[i]!
        const tip = new Vector3(limb.bend, limb.length, limb.twist).applyMatrix4(limb.frame)
        const d = new Vector3().subVectors(tip, clump.center)
        const dist = d.length()
        d.normalize()
        const norm = dist / effRadius(clump, d)
        worstTip = Math.max(worstTip, norm)
        expect(norm, `seed ${seed} limb ${i} tip pokes out (${norm.toFixed(2)})`).toBeLessThan(0.8)
      }

      const widest = Math.max(...shape.clumps.map(c => Math.hypot(c.center.x, c.center.z) + c.radius * INFLATE))
      console.log(
        `seed ${seed}: limbs ${shape.limbs.length} clumps ${n} canopy ${(widest * 2).toFixed(2)} m ` +
          `split ${shape.splitY.toFixed(2)} trunkTop ${shape.trunkTop.toFixed(2)} flare ${(shape.flareRadius * 2).toFixed(2)}`
      )
    }
    console.log(`worst clump overlap margin ${worstGap.toFixed(2)} m; worst tip depth ${worstTip.toFixed(2)}`)
  })
})
