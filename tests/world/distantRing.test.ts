import { describe, expect, it } from 'vitest'
import { buildDistantRing } from '@/world/terrain/distantRing'
import { DEFAULT_HEIGHTFIELD_PARAMS, TERRAIN_PALETTE_SLOTS, heightAtCore } from '@/world/terrain/heightfieldCore'

/**
 * ─── The ring must agree with the chunks it borders ─────────────────────────
 *
 * The distant ring closes the horizon past the streamer's reach for one draw
 * call. Its whole safety argument is that it samples the *same* height, normal
 * and colour functions as the streamed chunks, and that it never overlaps them —
 * so the seam at the hole edge is a resolution change, not a material change or
 * a z-fight.
 *
 * Neither property is visible in a screenshot at 190 m through fog, which is
 * exactly why they are asserted here.
 */

const params = DEFAULT_HEIGHTFIELD_PARAMS
const palette = new Float32Array(TERRAIN_PALETTE_SLOTS.length * 3).fill(0.4)

const build = (overrides: Partial<Parameters<typeof buildDistantRing>[0]> = {}) =>
  buildDistantRing(
    { centerX: 0, centerZ: 0, outerRadius: 800, holeRadius: 170, segments: 32, ...overrides },
    params,
    palette
  )

describe('distant ring geometry', () => {
  it('emits only finite floats', () => {
    const ring = build()
    // Written as a positive test: every comparison against NaN is false, so a
    // range check would silently pass on the exact bug it exists to catch.
    for (const value of ring.position) {
      expect(Number.isFinite(value)).toBe(true)
    }
    expect(Number.isFinite(ring.boundsY[0])).toBe(true)
    expect(Number.isFinite(ring.boundsY[1])).toBe(true)
  })

  it('samples the same height function as the streamed chunks', () => {
    // The seam argument in one assertion: a vertex of the ring must sit exactly
    // where a chunk vertex at the same world position would.
    const centerX = 512
    const centerZ = -256
    const outerRadius = 800
    const segments = 32
    const ring = buildDistantRing({ centerX, centerZ, outerRadius, holeRadius: 170, segments }, params, palette)
    const step = (outerRadius * 2) / segments
    const originX = centerX - outerRadius
    const originZ = centerZ - outerRadius
    const side = segments + 1

    for (const [row, column] of [
      [0, 0],
      [7, 19],
      [segments, segments]
    ]) {
      const index = row! * side + column!
      const worldX = originX + column! * step
      const worldZ = originZ + row! * step
      expect(ring.position[index * 3 + 1]).toBeCloseTo(heightAtCore(worldX, worldZ, params), 5)
    }
  })

  /**
   * The overlap is **bounded, not zero**, and that distinction is the design.
   *
   * A quad straddling the hole boundary is kept — dropping it would tear a gap
   * at exactly the radius where the streamer stops — and two of its corners can
   * lie inside the hole, so one of its triangles does too. The ring therefore
   * overlaps the streamed chunks by at most one cell, which is why
   * `DistantTerrain` drops the mesh below true ground: coincident surfaces
   * shimmer, a lower one simply loses.
   *
   * What must never happen is overlap *deep* inside the hole, where the ring
   * would be fighting detailed terrain far from any boundary.
   */
  it('overlaps the streamed terrain by at most one cell', () => {
    const holeRadius = 170
    const outerRadius = 800
    const segments = 32
    const ring = build({ holeRadius })
    const step = (outerRadius * 2) / segments
    const side = segments + 1

    let deepest = holeRadius
    for (let i = 0; i < ring.index.length; i += 3) {
      let furthestCorner = 0
      for (let corner = 0; corner < 3; corner++) {
        const vertex = ring.index[i + corner]!
        const row = Math.floor(vertex / side)
        const column = vertex % side
        const distance = Math.hypot(-outerRadius + column * step, -outerRadius + row * step)
        furthestCorner = Math.max(furthestCorner, distance)
      }
      // A triangle whose furthest corner is still inside the hole is one that
      // overlaps; record how far in it reaches.
      if (furthestCorner < holeRadius) {
        deepest = Math.min(deepest, furthestCorner)
      }
    }
    // Anything overlapping sits within a cell and a half of the boundary. A
    // regression that dropped the straddle rule would push this far lower.
    expect(deepest).toBeGreaterThan(holeRadius - step * 1.5)
  })

  it('still covers the ground immediately outside the hole', () => {
    // The complementary failure: a coverage test that skipped quads straddling
    // the boundary would tear a gap at exactly the radius where the streamer
    // stops, which is the one place a gap is visible.
    const ring = build()
    const outerRadius = 800
    const segments = 32
    const step = (outerRadius * 2) / segments
    const side = segments + 1
    let justOutside = 0
    for (let i = 0; i < ring.index.length; i += 3) {
      for (let corner = 0; corner < 3; corner++) {
        const vertex = ring.index[i + corner]!
        const row = Math.floor(vertex / side)
        const column = vertex % side
        const distance = Math.hypot(-outerRadius + column * step, -outerRadius + row * step)
        if (distance > 170 && distance < 170 + step * 2) {
          justOutside++
        }
      }
    }
    expect(justOutside).toBeGreaterThan(0)
  })

  it('stays cheap enough to be worth one draw call', () => {
    const ring = build()
    const triangles = ring.index.length / 3
    // 32² quads minus the hole. The point of the ring is that a kilometre of
    // horizon costs less than a single hero prop's LOD0 does per instance.
    expect(triangles).toBeGreaterThan(500)
    expect(triangles).toBeLessThan(2 * 32 * 32)
  })

  it('scales its triangle count with the hole, not with the world', () => {
    const small = build({ holeRadius: 100 })
    const large = build({ holeRadius: 400 })
    expect(large.index.length).toBeLessThan(small.index.length)
  })

  it('indexes only vertices it emitted', () => {
    const ring = build()
    const vertexCount = ring.position.length / 3
    for (const vertex of ring.index) {
      expect(vertex).toBeLessThan(vertexCount)
    }
  })
})
