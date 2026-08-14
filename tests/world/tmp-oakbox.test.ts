import { Vector3 } from 'three'
import { describe, it } from 'vitest'
import { createOldOakAsset } from '../../src/world/assets/oldOak'

describe('old oak tier silhouettes', () => {
  it('reports per-tier extents', () => {
    for (const seed of [1, 2, 3, 7, 12, 41]) {
      const asset = createOldOakAsset({ seed })
      const line: string[] = []
      asset.tiers.forEach(tier => {
        const p = tier.getAttribute('position')
        let top = 0
        let reach = 0
        const v = new Vector3()
        for (let i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p, i)
          top = Math.max(top, v.y)
          reach = Math.max(reach, Math.hypot(v.x, v.z))
        }
        line.push(`${(reach * 2).toFixed(2)}w/${top.toFixed(2)}h`)
      })
      console.log(`seed ${seed}: ${line.join('  ')}`)
    }
  })
})
