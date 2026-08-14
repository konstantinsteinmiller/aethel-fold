import type { BufferGeometry } from 'three'
import { describe, expect, it } from 'vitest'
import { createOldOakAsset, oldOakMetrics } from '../../src/world/assets/oldOak'

const BUDGETS = [340, 190, 95, 26]

const triCount = (geometry: BufferGeometry): number =>
  geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3

const checkFinite = (geometry: BufferGeometry, label: string): void => {
  for (const key of ['position', 'normal', 'color', 'aWind'] as const) {
    const attribute = geometry.getAttribute(key)
    expect(attribute, `${label}: missing ${key}`).toBeTruthy()
    const array = attribute.array as ArrayLike<number>
    for (let i = 0; i < array.length; i++) {
      if (!Number.isFinite(array[i]!)) {
        throw new Error(`${label}: non-finite in ${key} at ${i}`)
      }
    }
  }

  const normal = geometry.getAttribute('normal')
  for (let i = 0; i < normal.count; i++) {
    const lengthSq = normal.getX(i) ** 2 + normal.getY(i) ** 2 + normal.getZ(i) ** 2
    if (!(Math.abs(lengthSq - 1) < 2e-3)) {
      throw new Error(`${label}: normal ${i} is not unit (${Math.sqrt(lengthSq)})`)
    }
  }

  const color = geometry.getAttribute('color')
  let darkest = Number.POSITIVE_INFINITY
  for (let i = 0; i < color.count; i++) {
    const luma = 0.2126 * color.getX(i) + 0.7152 * color.getY(i) + 0.0722 * color.getZ(i)
    darkest = Math.min(darkest, luma)
  }
  if (!(darkest > 0.02)) {
    throw new Error(`${label}: vertex colour luma ${darkest.toFixed(4)} is near-black`)
  }
  // biome-ignore lint/suspicious/noConsole: temporary measurement harness
  console.log(`  ${label}: darkest luma ${darkest.toFixed(4)}`)
}

describe('old oak', () => {
  for (const seed of [1, 2, 3, 7, 12, 41]) {
    it(`seed ${seed} ships four budgeted tiers`, () => {
      const asset = createOldOakAsset({ seed })
      expect(asset.tiers).toHaveLength(4)
      expect(asset.perfTag).toBe('oaks')
      expect(asset.distanceScale).toBeLessThanOrEqual(2.6)

      const counts = asset.tiers.map(triCount)
      // biome-ignore lint/suspicious/noConsole: temporary measurement harness
      console.log(`seed ${seed}: tris ${counts.join(' / ')}  radius ${asset.radius.toFixed(2)}`)

      asset.tiers.forEach((tier, i) => {
        checkFinite(tier, `seed ${seed} LOD${i}`)
        expect(counts[i]!, `LOD${i} over budget`).toBeLessThanOrEqual(BUDGETS[i]!)
        if (i > 0) {
          expect(counts[i]!, `LOD${i} not smaller than LOD${i - 1}`).toBeLessThan(counts[i - 1]!)
        }
      })
    })
  }

  it('reports a sane bole collider', () => {
    for (const seed of [1, 2, 3, 7, 12, 41]) {
      const metrics = oldOakMetrics({ seed })
      // biome-ignore lint/suspicious/noConsole: temporary measurement harness
      console.log(`seed ${seed}: collider r=${metrics.radius.toFixed(3)} h=${metrics.height.toFixed(3)}`)
      expect(metrics.radius).toBeGreaterThan(0.3)
      expect(metrics.radius).toBeLessThan(0.9)
      expect(metrics.height).toBeGreaterThan(2.4)
      expect(metrics.height).toBeLessThan(4)
    }
  })

  it('honours the height option and stays inside its canopy envelope', () => {
    for (const height of [9, 11, 13]) {
      for (const seed of [1, 5, 9]) {
        const asset = createOldOakAsset({ seed, height })
        const lod0 = asset.tiers[0]!
        lod0.computeBoundingBox()
        const box = lod0.boundingBox!
        const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z)
        // biome-ignore lint/suspicious/noConsole: temporary measurement harness
        console.log(
          `h=${height} seed ${seed}: top ${box.max.y.toFixed(2)} width ${width.toFixed(2)} ` +
            `flare ${(oldOakMetrics({ seed, height }).radius * 2).toFixed(2)}`
        )
        expect(box.min.y).toBeCloseTo(0, 1)
        expect(box.max.y / height).toBeGreaterThan(0.94)
        expect(box.max.y / height).toBeLessThan(1.1)
        expect(width / height).toBeGreaterThan(0.68)
        expect(width / height).toBeLessThan(1.06)
      }
    }
  })

  it('is deterministic', () => {
    const a = createOldOakAsset({ seed: 4 })
    const b = createOldOakAsset({ seed: 4 })
    for (let i = 0; i < 4; i++) {
      const pa = a.tiers[i]!.getAttribute('position').array as Float32Array
      const pb = b.tiers[i]!.getAttribute('position').array as Float32Array
      expect(pa.length).toBe(pb.length)
      for (let v = 0; v < pa.length; v++) {
        expect(pa[v]).toBe(pb[v])
      }
    }
  })
})
