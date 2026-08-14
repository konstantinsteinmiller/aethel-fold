import type { BufferGeometry } from 'three'
import { describe, expect, it } from 'vitest'
import { createPineAsset, type PineOptions, pineMetrics } from '@/world/assets/pine'
import { triangleCount } from '@/world/geometry/budget'

const BUDGETS = [200, 110, 56, 16]
const ATTRIBUTES = ['position', 'normal', 'color', 'aWind'] as const

const VARIANTS: { label: string; options: PineOptions }[] = [
  { label: 'spruce default', options: {} },
  { label: 'spruce seed 7', options: { seed: 7 } },
  { label: 'spruce snow', options: { seed: 7, snow: true } },
  { label: 'fir', options: { seed: 13, form: 'fir' } },
  { label: 'fir snow', options: { seed: 13, form: 'fir', snow: true } },
  { label: 'tall spruce', options: { seed: 29, height: 9 } }
]

const lumaOf = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b

const checkGeometry = (geometry: BufferGeometry, label: string): void => {
  for (const key of ATTRIBUTES) {
    const attribute = geometry.getAttribute(key)
    expect(attribute, `${label} missing "${key}"`).toBeTruthy()
    const array = attribute.array as ArrayLike<number>
    let bad = 0
    for (let i = 0; i < array.length; i++) {
      if (!Number.isFinite(array[i]!)) {
        bad++
      }
    }
    expect(bad, `${label} non-finite in "${key}"`).toBe(0)
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
  expect(unnormalised, `${label} normals not unit length`).toBe(0)

  const color = geometry.getAttribute('color')
  let darkest = Number.POSITIVE_INFINITY
  let brightest = 0
  for (let i = 0; i < color.count; i++) {
    const luma = lumaOf(color.getX(i), color.getY(i), color.getZ(i))
    darkest = Math.min(darkest, luma)
    brightest = Math.max(brightest, luma)
  }
  expect(darkest, `${label} has a near-black vertex`).toBeGreaterThan(0.02)
  // Nothing may clip to paper white either — see the palette note on `snowLit`.
  expect(brightest, `${label} has a blown-out vertex`).toBeLessThan(0.95)

  const wind = geometry.getAttribute('aWind')
  for (let i = 0; i < wind.count; i++) {
    expect(wind.getX(i)).toBeGreaterThanOrEqual(0)
    expect(wind.getX(i)).toBeLessThanOrEqual(0.61)
  }
}

describe('pine', () => {
  for (const { label, options } of VARIANTS) {
    it(`${label}: four tiers, finite, in budget`, () => {
      const asset = createPineAsset(options)
      expect(asset.tiers).toHaveLength(4)
      expect(asset.perfTag).toBe('pines')
      expect(asset.distanceScale).toBe(2)
      expect(asset.outlineMaxTier).toBe(1)

      let previous = Number.POSITIVE_INFINITY
      const counts: number[] = []
      for (const [tier, geometry] of asset.tiers.entries()) {
        checkGeometry(geometry, `${label}/LOD${tier}`)
        const tris = triangleCount(geometry)
        counts.push(tris)
        expect(tris, `${label}/LOD${tier} over budget`).toBeLessThanOrEqual(BUDGETS[tier]!)
        expect(tris, `${label}/LOD${tier} not smaller than LOD${tier - 1}`).toBeLessThan(previous)
        previous = tris
      }
      console.log(`${label}: ${counts.join(' / ')}`)
    })
  }

  it('snow changes paint only, never geometry', () => {
    const bare = createPineAsset({ seed: 7 })
    const snowy = createPineAsset({ seed: 7, snow: true })

    for (const [tier, geometry] of bare.tiers.entries()) {
      const other = snowy.tiers[tier]!
      expect(triangleCount(other)).toBe(triangleCount(geometry))
      const a = geometry.getAttribute('position').array as Float32Array
      const b = other.getAttribute('position').array as Float32Array
      expect(b.length).toBe(a.length)
      for (let i = 0; i < a.length; i++) {
        expect(b[i]).toBe(a[i])
      }
      const na = geometry.getAttribute('normal').array as Float32Array
      const nb = other.getAttribute('normal').array as Float32Array
      for (let i = 0; i < na.length; i++) {
        expect(nb[i]).toBe(na[i])
      }
      // ...and it must actually do something.
      const ca = geometry.getAttribute('color').array as Float32Array
      const cb = other.getAttribute('color').array as Float32Array
      let changed = 0
      let brightened = 0
      for (let i = 0; i < ca.length; i += 3) {
        if (cb[i] !== ca[i] || cb[i + 1] !== ca[i + 1] || cb[i + 2] !== ca[i + 2]) {
          changed++
        }
        if (lumaOf(cb[i]!, cb[i + 1]!, cb[i + 2]!) > lumaOf(ca[i]!, ca[i + 1]!, ca[i + 2]!) + 0.05) {
          brightened++
        }
      }
      expect(changed, `LOD${tier} snow painted nothing`).toBeGreaterThan(0)
      if (tier < 3) {
        expect(brightened, `LOD${tier} snow never got bright`).toBeGreaterThan(0)
      }
    }
  })

  it('is deterministic for a seed', () => {
    const a = createPineAsset({ seed: 41, form: 'fir' })
    const b = createPineAsset({ seed: 41, form: 'fir' })
    for (const [tier, geometry] of a.tiers.entries()) {
      const pa = geometry.getAttribute('position').array as Float32Array
      const pb = b.tiers[tier]!.getAttribute('position').array as Float32Array
      expect(pb.length).toBe(pa.length)
      for (let i = 0; i < pa.length; i++) {
        expect(pb[i]).toBe(pa[i])
      }
      const ca = geometry.getAttribute('color').array as Float32Array
      const cb = b.tiers[tier]!.getAttribute('color').array as Float32Array
      for (let i = 0; i < ca.length; i++) {
        expect(cb[i]).toBe(ca[i])
      }
    }
  })

  it('reports a trunk-sized collider', () => {
    const metrics = pineMetrics({ seed: 7 })
    const asset = createPineAsset({ seed: 7 })
    // Roughly a third of a metre of trunk, and a collider that stops well short
    // of the canopy the player has to be able to walk under.
    expect(metrics.radius).toBeGreaterThan(0.2)
    expect(metrics.radius).toBeLessThan(0.42)
    expect(metrics.height).toBeGreaterThan(2.5)
    expect(metrics.height).toBeLessThan(4)
    expect(metrics.height).toBeLessThan(asset.radius)

    const fir = pineMetrics({ seed: 13, form: 'fir' })
    expect(fir.radius).toBeGreaterThan(0.2)
    expect(pineMetrics({ seed: 7 }).radius).toBe(metrics.radius)
  })

  it('is tall and narrow', () => {
    for (const form of ['spruce', 'fir'] as const) {
      const asset = createPineAsset({ seed: 3, form, height: 7.5 })
      const geometry = asset.tiers[0]!
      geometry.computeBoundingBox()
      const box = geometry.boundingBox!
      const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z)
      const height = box.max.y - box.min.y
      console.log(`${form}: ${width.toFixed(2)} m across, ${height.toFixed(2)} m tall`)
      expect(height).toBeGreaterThan(7.3)
      expect(width).toBeGreaterThan(2.0)
      expect(width).toBeLessThan(2.9)
      expect(box.min.y).toBeCloseTo(0, 5)
    }
  })
})
