import { describe, expect, it } from 'vitest'
import { BoxGeometry, BufferAttribute, BufferGeometry, SphereGeometry, TorusKnotGeometry } from 'three'
import { aoStats, bakeVertexAO } from '@/world/geometry/vertexAO'

/**
 * ─── The reachability cull must change nothing ──────────────────────────────
 *
 * AO baking is **90 % of the placeable catalogue's build time** (633 ms of
 * 705 ms across 137 bakes), which makes it the floor on how long a slice of the
 * frame-budgeted drain can block. The cull that speeds it up skips triangles
 * whose bounding sphere lies further from the vertex than `maxDistance` — and
 * since every ray stops at `maxDistance`, those triangles could not have been
 * hit.
 *
 * "Could not have been hit" is an argument, not a guarantee, and a wrong cull
 * here does not throw: it silently lightens a crevice that should be dark, on
 * one asset, at one LOD tier. So the fast path is checked against the naive one
 * with `bruteForce: true` — the same sampler, the same rays, only the cull
 * differs. A hand-written reference implementation would be a second thing to
 * keep in sync, and the drift would be invisible in exactly the same way.
 */

const withNormals = (geometry: BufferGeometry): BufferGeometry => {
  if (!geometry.getAttribute('normal')) {
    geometry.computeVertexNormals()
  }
  return geometry
}

const cases: { name: string; geometry: BufferGeometry; maxDistance: number; samples: number }[] = [
  // Convex and closed: almost nothing is culled, so this is the case where the
  // cull must not be *wrong* rather than where it pays.
  { name: 'box', geometry: withNormals(new BoxGeometry(1, 1, 1, 2, 2, 2)), maxDistance: 0.6, samples: 16 },
  // Curved, many small faces — the shape most of the rock family reduces to.
  { name: 'sphere', geometry: withNormals(new SphereGeometry(1, 12, 8)), maxDistance: 0.8, samples: 16 },
  // Deeply self-occluding, and wide relative to `maxDistance`: the case the cull
  // exists for, where most of the mesh is out of reach of any given vertex.
  { name: 'torus knot', geometry: withNormals(new TorusKnotGeometry(1, 0.3, 48, 8)), maxDistance: 0.5, samples: 24 },
  // A sample count that is not a power of two, since the Hammersley sequence is
  // built from bit twiddling and 16/32 would hide an off-by-one.
  { name: 'sphere, 7 samples', geometry: withNormals(new SphereGeometry(1, 10, 6)), maxDistance: 1.2, samples: 7 }
]

describe('vertex AO reachability cull', () => {
  for (const { name, geometry, maxDistance, samples } of cases) {
    it(`matches brute force exactly — ${name}`, () => {
      const fast = bakeVertexAO(geometry, { maxDistance, samples })
      const brute = bakeVertexAO(geometry, { maxDistance, samples, bruteForce: true })
      expect(fast.length).toBe(brute.length)
      // Exact equality, not a tolerance: the cull removes candidates that cannot
      // contribute, so the arithmetic that remains is bit-for-bit the same. A
      // tolerance here would quietly accept a cull that was slightly wrong.
      let mismatches = 0
      for (let i = 0; i < fast.length; i++) {
        if (fast[i] !== brute[i]) {
          mismatches++
        }
      }
      expect(mismatches).toBe(0)
    })
  }

  it('actually occludes something, or the comparison above proves nothing', () => {
    // A knot, not a box: a *convex* mesh with outward normals occludes nothing
    // at all — every hemisphere ray escapes — so all-ones is its correct answer
    // and a box would let a bake that always returned 1 pass every test here.
    const geometry = withNormals(new TorusKnotGeometry(1, 0.3, 48, 8))
    const ao = bakeVertexAO(geometry, { maxDistance: 1, samples: 16 })
    let min = 1
    let occluded = 0
    for (const value of ao) {
      min = Math.min(min, value)
      if (value < 0.99) {
        occluded++
      }
    }
    expect(min).toBeLessThan(0.9)
    expect(occluded).toBeGreaterThan(ao.length * 0.1)
  })

  it('leaves an isolated triangle fully open', () => {
    // Nothing to occlude against, so every ray escapes.
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), 3))
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3))
    const ao = bakeVertexAO(geometry, { maxDistance: 1, samples: 8 })
    for (const value of ao) {
      expect(value).toBe(1)
    }
  })

  it('does less work than brute force on a wide, self-occluding mesh', () => {
    // The point of the change. Counted rather than timed, because a wall-clock
    // assertion on a shared CI machine is a flake generator.
    const geometry = withNormals(new TorusKnotGeometry(1, 0.3, 64, 8))
    const before = { ...aoStats }
    bakeVertexAO(geometry, { maxDistance: 0.4, samples: 16 })
    const tested = aoStats.rayTriangleTests - before.rayTriangleTests
    const brute = aoStats.rayTriangleTestsBrute - before.rayTriangleTestsBrute
    expect(tested).toBeLessThan(brute * 0.25)
  })
})
