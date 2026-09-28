import { describe, expect, it } from 'vitest'
import { waterBodiesOf } from '@/world/core/World'
import type { RiverNode, WaterPlacement } from '@/world/water/types'
import { NO_WATER, packWaterBodies, setWaterTable, waterLevelAt } from '@/world/terrain/waterLevel'

/**
 * ─── The beach, the treeline and the water have to agree ────────────────────
 *
 * Three systems now ask `waterLevelAt` how high the water is at a point: the
 * terrain, which paints a beach; the grass placer, which stops short of one; and
 * the scatter, which refuses to grow a tree in the sea. All three read one table,
 * and `World.waterBodiesOf` is the single place that builds it — from the same
 * `WaterPlacement`s the water *mesh* is built from, so the geometry cannot be
 * stated twice and drift.
 *
 * This is worth pinning because the failure is silent in every way this project
 * normally catches things: nothing throws, no budget moves, no typecheck
 * complains. The only symptom is a forest standing in open water — which is
 * precisely the defect the table was added to remove.
 */
// ── Fixtures: a sloped river and a flat sea, far enough apart not to touch ──

const RIVER_X = -96

/** Eleven nodes over 260 m, 3.4 m of fall, a wandering channel. */
const riverNodes = (): RiverNode[] => {
  const nodes: RiverNode[] = []
  for (let i = 0; i <= 10; i++) {
    const t = i / 10
    nodes.push({
      x: RIVER_X + Math.sin(t * 5.1) * 5.5,
      z: 130 - t * 260,
      y: 1.7 + t * -3.4,
      halfWidth: 3.4 + Math.sin(t * 3.3) * 0.6
    })
  }
  return nodes
}

const riverPlacement = (): WaterPlacement => ({
  id: 'test-river',
  kind: 'river',
  styleId: 'river',
  x: RIVER_X,
  y: 1.7,
  z: 0,
  rotY: 0,
  halfX: 0,
  halfZ: 0,
  nodes: riverNodes()
})

const seaPlacement = (): WaterPlacement => ({
  id: 'test-sea',
  kind: 'pool',
  styleId: 'sea',
  x: 1400,
  y: 2.0,
  z: 900,
  rotY: 0,
  halfX: 172,
  halfZ: 172,
  nodes: []
})

describe('the water table', () => {
  const placements = [riverPlacement(), seaPlacement()]
  const bodies = waterBodiesOf(placements)
  const river = bodies.find(body => body.slopeZ !== undefined && body.slopeZ !== 0)
  const sea = bodies.find(body => body !== river)

  it('derives one rectangle per body', () => {
    expect(bodies).toHaveLength(2)
    expect(river, 'no sloped body — the river lost its fall').toBeDefined()
    expect(sea, 'no flat body — the sea lost its surface').toBeDefined()
  })

  it('covers the sea exactly as the water view draws it', () => {
    const placement = seaPlacement()
    expect(sea!.y).toBeCloseTo(placement.y, 6)
    expect(sea!.minX).toBeLessThanOrEqual(placement.x - placement.halfX)
    expect(sea!.maxX).toBeGreaterThanOrEqual(placement.x + placement.halfX)
    expect(sea!.minZ).toBeLessThanOrEqual(placement.z - placement.halfZ)
    expect(sea!.maxZ).toBeGreaterThanOrEqual(placement.z + placement.halfZ)
    // Flat. A pool with a slope is a mistake, not a river.
    expect(sea!.slopeX ?? 0).toBe(0)
    expect(sea!.slopeZ ?? 0).toBe(0)
  })

  /**
   * The river is one sloped rectangle standing in for eleven nodes, so what has
   * to be asserted is that the *plane* passes through every node — not that some
   * constant was copied across correctly. A rect-per-node would pass a
   * copied-constant test and still notch the bank 0.34 m every 26 m.
   */
  it('reproduces every one of the river’s node heights to a centimetre', () => {
    const centreZ = (river!.minZ + river!.maxZ) * 0.5
    for (const node of riverNodes()) {
      const modelled = river!.y + (node.z - centreZ) * (river!.slopeZ ?? 0)
      expect(modelled, `river surface at z = ${node.z}`).toBeCloseTo(node.y, 2)
    }
  })

  it('spans the river’s whole length and reaches both banks', () => {
    for (const node of riverNodes()) {
      expect(node.z).toBeGreaterThanOrEqual(river!.minZ)
      expect(node.z).toBeLessThanOrEqual(river!.maxZ)
      // The channel at its widest wander, plus room either side for the shore
      // band the terrain paints — a rectangle that stopped at the water's edge
      // would give the river a beach on the inside only.
      expect(node.x - node.halfWidth - river!.minX, 'no west bank').toBeGreaterThan(8)
      expect(river!.maxX - (node.x + node.halfWidth), 'no east bank').toBeGreaterThan(8)
    }
  })

  /**
   * And the end-to-end question the three consumers actually ask, through the
   * packed table rather than the rectangles: standing in the sea and in the
   * river's own channel, is the water where the meshes put it?
   *
   * Note the river is sampled at its **nodes**, not at `riverPlacement().y`. That
   * field is the river's *datum* — the surface at the top of its fall, which
   * `riverNodes` then carries down 3.4 m — so at the placement's own z the real
   * surface is 0, not 1.7. Asserting the placement's `y` there is the mistake
   * this comment exists to stop the next reader repeating; it is what the first
   * draft of this test did.
   */
  it('answers `waterLevelAt` with the surface the placements were authored at', () => {
    setWaterTable(packWaterBodies(bodies))
    try {
      const pool = seaPlacement()
      expect(waterLevelAt(pool.x, pool.z)).toBeCloseTo(pool.y, 3)

      for (const node of riverNodes()) {
        expect(waterLevelAt(node.x, node.z), `river at z = ${node.z}`).toBeCloseTo(node.y, 2)
      }

      // Far from either body there is no water, and every ramp that reads this
      // relies on an out-of-range sentinel rather than on a plausible height.
      expect(waterLevelAt(pool.x, pool.z + 4000)).toBe(NO_WATER)
    } finally {
      setWaterTable(null)
    }
  })
})
