import type { BufferGeometry } from 'three'
import { describe, expect, it } from 'vitest'
import { createShardWallAsset, type ShardWallOptions, shardWallMetrics } from '@/world/assets/shardWall'
import { DESERT_STONE } from '@/world/assets/stone'

const BUDGETS = [260, 150, 78, 30]

const CASES: { label: string; options: ShardWallOptions }[] = [
  { label: 'wall/1', options: { seed: 1 } },
  { label: 'wall/7', options: { seed: 7 } },
  { label: 'wall/desert', options: { seed: 12, stone: DESERT_STONE, banding: 1 } },
  { label: 'cluster/3', options: { seed: 3, form: 'cluster' } },
  { label: 'cluster/desert', options: { seed: 21, form: 'cluster', stone: DESERT_STONE, banding: 1 } }
]

const triangles = (geometry: BufferGeometry): number =>
  geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3

const assertFinite = (geometry: BufferGeometry, label: string): void => {
  for (const key of ['position', 'normal', 'color', 'aWind'] as const) {
    const attribute = geometry.getAttribute(key)
    expect(attribute, `${label}: missing ${key}`).toBeTruthy()
    const array = attribute.array as ArrayLike<number>
    let bad = 0
    for (let i = 0; i < array.length; i++) {
      if (!Number.isFinite(array[i]!)) {
        bad++
      }
    }
    expect(bad, `${label}: non-finite in ${key}`).toBe(0)
  }

  const normal = geometry.getAttribute('normal')
  let unnormalised = 0
  for (let i = 0; i < normal.count; i++) {
    const x = normal.getX(i)
    const y = normal.getY(i)
    const z = normal.getZ(i)
    if (!(Math.abs(x * x + y * y + z * z - 1) < 2e-3)) {
      unnormalised++
    }
  }
  expect(unnormalised, `${label}: normals not unit length`).toBe(0)

  const color = geometry.getAttribute('color')
  let darkest = 1
  for (let i = 0; i < color.count; i++) {
    darkest = Math.min(darkest, 0.2126 * color.getX(i) + 0.7152 * color.getY(i) + 0.0722 * color.getZ(i))
  }
  expect(darkest, `${label}: near-black vertex colour`).toBeGreaterThan(0.02)
}

describe('shard wall', () => {
  for (const { label, options } of CASES) {
    it(`${label} ships four sane tiers`, () => {
      const asset = createShardWallAsset(options)
      expect(asset.tiers).toHaveLength(4)
      expect(asset.perfTag).toBe('shards')
      expect(asset.distanceScale).toBeLessThanOrEqual(2.6)

      const counts = asset.tiers.map(triangles)
      console.log(`${label}: ${counts.join(' / ')}`)

      asset.tiers.forEach((tier, i) => {
        assertFinite(tier, `${label}/LOD${i}`)
        expect(counts[i]!, `${label}/LOD${i} budget`).toBeLessThanOrEqual(BUDGETS[i]!)
        if (i > 0) {
          expect(counts[i]!, `${label}/LOD${i} smaller than LOD${i - 1}`).toBeLessThan(counts[i - 1]!)
        }
      })
    })

    it(`${label} agrees on its silhouette across tiers`, () => {
      const asset = createShardWallAsset(options)
      const boxes = asset.tiers.map(tier => {
        tier.computeBoundingBox()
        return tier.boundingBox!
      })
      const reference = boxes[0]!
      // Every tier is the same shape function sampled differently, so the extremes
      // must line up — LOD3 is allowed to shrink in X because it drops fins.
      for (let i = 1; i < boxes.length; i++) {
        const box = boxes[i]!
        expect(box.max.y / reference.max.y, `LOD${i} height`).toBeGreaterThan(0.94)
        expect(box.max.y / reference.max.y, `LOD${i} height`).toBeLessThan(1.06)
        const width = (box.max.x - box.min.x) / (reference.max.x - reference.min.x)
        expect(width, `LOD${i} width`).toBeGreaterThan(i === 3 ? 0.5 : 0.94)
        expect(width, `LOD${i} width`).toBeLessThan(1.06)
      }
    })

    it(`${label} reports a box collider inside its own footprint`, () => {
      const metrics = shardWallMetrics(options)
      const asset = createShardWallAsset(options)
      asset.tiers[0]!.computeBoundingBox()
      const box = asset.tiers[0]!.boundingBox!

      expect(metrics.height).toBeGreaterThan(2)
      expect(metrics.height).toBeCloseTo(box.max.y, 2)
      expect(metrics.halfX).toBeGreaterThan(0.2)
      expect(metrics.halfZ).toBeGreaterThan(0.1)
      // Inside the visual, never around it.
      expect(metrics.halfX).toBeLessThan(Math.max(Math.abs(box.max.x), Math.abs(box.min.x)))
      expect(metrics.halfZ).toBeLessThan(Math.max(Math.abs(box.max.z), Math.abs(box.min.z)))
      expect(asset.radius).toBeGreaterThan(metrics.height)
    })
  }

  it('is deterministic and stone-independent in shape', () => {
    const a = createShardWallAsset({ seed: 5 })
    const b = createShardWallAsset({ seed: 5 })
    const pale = a.tiers[0]!.getAttribute('position').array as Float32Array
    const same = b.tiers[0]!.getAttribute('position').array as Float32Array
    expect(Array.from(pale)).toEqual(Array.from(same))

    // The band draw happens whatever `banding` is, so a stone swap changes the
    // colours and nothing else.
    const desert = createShardWallAsset({ seed: 5, stone: DESERT_STONE, banding: 1 })
    const shifted = desert.tiers[0]!.getAttribute('position').array as Float32Array
    expect(Array.from(shifted)).toEqual(Array.from(pale))

    const paleColor = a.tiers[0]!.getAttribute('color').getX(0)
    const desertColor = desert.tiers[0]!.getAttribute('color').getX(0)
    expect(desertColor).not.toBeCloseTo(paleColor, 3)
  })

  it('fin heights fall off toward the ends of a wall', () => {
    const metrics = shardWallMetrics({ seed: 2 })
    // A row, not a puddle: long in X, thin in Z.
    expect(metrics.halfX).toBeGreaterThan(metrics.halfZ * 2.5)
  })
})
