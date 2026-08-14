import { describe, expect, it } from 'vitest'
import type { BufferGeometry } from 'three'
import { registerAllPlaceables } from '@/world/assets'
import { budgetLedger, triangleCount } from '@/world/geometry/budget'
import { PLACEABLE_CATEGORY_ORDER, type PlaceableDefinition } from '@/world/level/types'

/**
 * ─── The placeable catalogue, as a contract ─────────────────────────────────
 *
 * `registerAllPlaceables()` generates every asset in the world — the whole
 * catalogue, all four tiers each — so importing it here is the same work the
 * app does at boot. That makes this suite the cheapest possible full-coverage
 * check: anything that would render as a black prop, blow a triangle budget or
 * pop at an LOD boundary fails here rather than in a screenshot.
 *
 * The generators already assert some of this at build time (`assertFiniteGeometry`,
 * `assertTriBudget`). Re-asserting from outside is not redundant — those guards
 * throw only in `import.meta.env.DEV`, and several of the properties below
 * (monotonic tier reduction, bounding radius honesty, collider sanity) are
 * relationships *between* things no single generator can see.
 */

const definitions = registerAllPlaceables()

/**
 * Everything a tier must carry. There are no textures, so this is all of it.
 *
 * `aWind` is deliberately *not* in this list. It is only meaningful to a
 * material built with `wind: true` — the flora — and the stone family's
 * generators never paint it, so requiring it here would fail eight props over
 * an attribute their shader does not sample. It is still range-checked below
 * wherever it does exist.
 */
const ATTRIBUTES = ['position', 'normal', 'color'] as const

const eachTier = (fn: (definition: PlaceableDefinition, geometry: BufferGeometry, tier: number) => void): void => {
  for (const definition of definitions) {
    definition.asset.tiers.forEach((geometry, tier) => fn(definition, geometry, tier))
  }
}

describe('placeable catalogue', () => {
  it('registers a non-trivial catalogue with unique ids', () => {
    expect(definitions.length).toBeGreaterThanOrEqual(20)
    const ids = definitions.map(definition => definition.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('puts every placeable in a known category', () => {
    for (const definition of definitions) {
      expect(PLACEABLE_CATEGORY_ORDER).toContain(definition.category)
    }
  })

  it('gives every placeable a profiler bucket (GDD §5.3)', () => {
    for (const definition of definitions) {
      expect(definition.asset.perfTag.length).toBeGreaterThan(0)
    }
  })

  it('ships exactly four LOD tiers per asset (GDD §4)', () => {
    for (const definition of definitions) {
      expect(definition.asset.tiers).toHaveLength(4)
    }
  })

  it('outlines LOD0 and LOD1 only (GDD R6)', () => {
    for (const definition of definitions) {
      expect(definition.asset.outline).not.toBeNull()
      expect(definition.asset.outlineMaxTier).toBe(1)
    }
  })

  /**
   * A `distanceScale` above 2.6 pushes the LOD2→LOD3 switch past the 320 m
   * global cull clamp, so LOD3 is generated, budgeted, asserted — and never
   * drawn. `plateau.ts` and `cliff.ts` both carry the note; this is the check.
   */
  it('keeps distance scales inside the global cull clamp', () => {
    for (const definition of definitions) {
      expect(definition.asset.distanceScale).toBeGreaterThan(0)
      expect(definition.asset.distanceScale).toBeLessThanOrEqual(2.6)
    }
  })
})

describe('tier geometry', () => {
  it('carries every attribute, all finite', () => {
    const problems: string[] = []
    eachTier((definition, geometry, tier) => {
      for (const key of [...ATTRIBUTES, 'aWind']) {
        const attribute = geometry.getAttribute(key)
        if (!attribute) {
          if (ATTRIBUTES.includes(key as (typeof ATTRIBUTES)[number])) {
            problems.push(`${definition.id}/LOD${tier}: missing "${key}"`)
          }
          continue
        }
        const array = attribute.array as ArrayLike<number>
        let bad = 0
        for (let i = 0; i < array.length; i++) {
          // Written as a positive test: every comparison against NaN is false,
          // so `if (array[i] > 1e9) bad++` would silently pass on the exact bug
          // this exists to catch (see `assertFiniteGeometry` in plateau.ts).
          if (!Number.isFinite(array[i]!)) {
            bad++
          }
        }
        if (bad > 0) {
          problems.push(`${definition.id}/LOD${tier}: ${bad} non-finite in "${key}"`)
        }
      }
    })
    expect(problems).toEqual([])
  })

  it('carries unit-length normals', () => {
    eachTier((definition, geometry, tier) => {
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
      expect(unnormalised, `${definition.id}/LOD${tier}`).toBe(0)
    })
  })

  /**
   * The NaN that shipped a solid black cliff cap flowed through the *colour*
   * attribute, and both the finiteness and the unit-normal guards passed on it.
   * A luma floor is the check that would have caught it from the outside, and
   * it doubles as the enforcement of GDD R4: nothing in this world is black.
   */
  it('has no near-black vertex colours (GDD R4)', () => {
    eachTier((definition, geometry, tier) => {
      const color = geometry.getAttribute('color')
      let black = 0
      for (let i = 0; i < color.count; i++) {
        const luma = 0.2126 * color.getX(i) + 0.7152 * color.getY(i) + 0.0722 * color.getZ(i)
        if (!(luma > 0.02)) {
          black++
        }
      }
      expect(black, `${definition.id}/LOD${tier} has black vertices`).toBe(0)
    })
  })

  it('reduces monotonically across the tier ladder', () => {
    for (const definition of definitions) {
      const counts = definition.asset.tiers.map(triangleCount)
      for (let tier = 1; tier < counts.length; tier++) {
        expect(
          counts[tier]!,
          `${definition.id}: LOD${tier} (${counts[tier]}) is not smaller than LOD${tier - 1} (${counts[tier - 1]})`
        ).toBeLessThan(counts[tier - 1]!)
      }
    }
  })

  /**
   * The bounding radius drives instance frustum culling, so a radius that
   * misses the far corner of the mesh pops the whole prop out of view when the
   * player is standing on it — `plateau.ts` carries that exact note.
   */
  it('publishes a bounding radius that actually bounds the mesh', () => {
    const problems: string[] = []
    for (const definition of definitions) {
      // Every tier, not just LOD0: the tiers are size-corrected against each
      // other rather than against the published radius, so a coarse tier can be
      // the one that pokes out.
      let furthest = 0
      for (const geometry of definition.asset.tiers) {
        const position = geometry.getAttribute('position')
        for (let i = 0; i < position.count; i++) {
          furthest = Math.max(furthest, Math.hypot(position.getX(i), position.getY(i), position.getZ(i)))
        }
      }
      // Relative tolerance, because this recomputes the reach with `Math.hypot`
      // while `measuredRadius` uses `sqrt(x²+y²+z²)`; the two disagree in the
      // last ulp and an exact `<` would fail on a 0.00 %-short prop.
      if (definition.asset.radius < furthest * (1 - 1e-9)) {
        const short = ((1 - definition.asset.radius / furthest) * 100).toFixed(2)
        problems.push(`${definition.id}: radius ${definition.asset.radius.toFixed(3)} < reach ${furthest.toFixed(3)} (${short}% short)`)
      }
    }
    expect(problems).toEqual([])
  })
})

describe('triangle budgets (GDD §4.1)', () => {
  it('leaves no tier over its ceiling', () => {
    const over = budgetLedger.filter(entry => entry.tris > entry.budget)
    expect(over.map(entry => `${entry.name}: ${entry.tris}/${entry.budget}`)).toEqual([])
  })

  it('records a ledger entry for every generated tier', () => {
    expect(budgetLedger.length).toBeGreaterThanOrEqual(definitions.length * 4)
  })
})

describe('colliders', () => {
  it('gives every walkable prop something to stand on', () => {
    for (const definition of definitions) {
      if (!definition.walkable) {
        continue
      }
      expect(definition.collider.kind, `${definition.id} is walkable`).not.toBe('none')
    }
  })

  it('sizes every collider positively and inside its own silhouette', () => {
    for (const definition of definitions) {
      const collider = definition.collider
      if (collider.kind === 'none') {
        continue
      }
      expect(collider.height, `${definition.id} height`).toBeGreaterThan(0)
      if (collider.kind === 'cylinder') {
        expect(collider.radius, `${definition.id} radius`).toBeGreaterThan(0)
        // A collider wider than the mesh's own bounding radius puts the player
        // into an invisible wall; the honest proxy is always the inscribed one.
        expect(collider.radius, `${definition.id} radius`).toBeLessThanOrEqual(definition.asset.radius)
      } else {
        expect(collider.halfX, `${definition.id} halfX`).toBeGreaterThan(0)
        expect(collider.halfZ, `${definition.id} halfZ`).toBeGreaterThan(0)
      }
    }
  })

  it('keeps ground offsets to a nudge, not a teleport', () => {
    for (const definition of definitions) {
      expect(Math.abs(definition.groundOffset ?? 0), `${definition.id}`).toBeLessThan(1)
    }
  })

  it('gives every placeable a usable scale range', () => {
    for (const definition of definitions) {
      const [min, max] = definition.scaleRange ?? [1, 1]
      expect(min, `${definition.id}`).toBeGreaterThan(0)
      expect(max, `${definition.id}`).toBeGreaterThanOrEqual(min)
    }
  })
})
