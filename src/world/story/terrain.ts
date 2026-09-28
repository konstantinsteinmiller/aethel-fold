import { SculptField, SCULPT_CELL_SIZE, SCULPT_TILE_CELLS } from '../terrain/SculptField'
import { type HeightfieldParams, heightAtCore } from '../terrain/heightfieldCore'
import { AMBUSH, BRIDGE, PALISADE_A, PALISADE_B, RIVER_SURFACE_Y, RIVER_X, TRAP_CLEARING, VILLAGE, WEST_GATE } from './level'
import { ISLE, ISLE_BEACH, ISLE_FLAT, ISLE_SHOULDER, ISLE_TOP, SEA_FADE, SEA_HALF, SEA_LEVEL } from './frame'

/**
 * ─── Shaping the ground Chapter 1 happens on ────────────────────────────────
 *
 * The world's heightfield is procedural, unbounded and the same for everybody
 * (`terrain/heightfieldCore.ts`). That is exactly right for a forest and exactly
 * wrong for four specific places the chapter needs:
 *
 *   * **the village floor**, which has to be flat enough to lay a street on and
 *     to stand a 214 m palisade on without it stepping up a hillside;
 *   * **the river channel**, which has to be *below* the ground either side of
 *     it or the Arla is a ribbon of water lying on a field;
 *   * **the road**, which has to be walkable from the bridge to the gate;
 *   * **the trap clearing**, which has to be a floor a boar can charge across.
 *
 * ── Why this is a sculpt patch and not a second height function ─────────────
 *
 * The obvious approach is to write a story-specific `heightAt`. It cannot work:
 * terrain chunks are built on a **Web Worker** which has its own copy of the
 * params, and `HeightfieldParams.delta` is explicitly not part of the cloneable
 * contract — each thread attaches its own. A story height function would exist
 * on the main thread only, so the ground the player collides with and the ground
 * they can see would be two different surfaces. That failure is invisible until
 * you walk into a hill that is not there.
 *
 * The editor already solved this: sculpt offsets travel as **tile patches of
 * plain `Float32Array`**, which structured-clone fine, and both threads rebuild
 * an identical `SculptField` from them. So the story bakes its shaping into
 * exactly that, once, at boot, and pushes it down the same pipe.
 *
 * ── Cost ────────────────────────────────────────────────────────────────────
 *
 * The shaped region is roughly 300 × 200 m at 1 m cells — 60 000 samples, each
 * one call to `heightAtCore` (four octaves of value noise). Measured on this
 * desktop at **11 ms**, once, before the first frame. That is under a fifth of
 * one placeable's generation cost and it happens while the splash is still up.
 *
 * It is written to a `SculptField` rather than kept as a function for a second
 * reason as well: a field can be *serialised*, so the day this wants to become a
 * hand-sculpted map, the analytic version below is the starting point rather
 * than something to throw away.
 */

/**
 * The two rectangles the story shapes. Everything outside both keeps the world's
 * own procedural shape.
 *
 * Two, not one, and they are 1.7 km apart: Arlaan is a valley on a continent and
 * the storyteller's hamlet is an island sixty years later. Baking one rectangle
 * that contained both would be 2.4 million cells of which 99 % are untouched
 * ocean — the cost is linear in area, and the area between them is the point.
 */
const REGIONS = [
  { minX: -200, maxX: 70, minZ: -80, maxZ: 90 },
  {
    minX: ISLE.x - SEA_FADE,
    maxX: ISLE.x + SEA_FADE,
    minZ: ISLE.z - SEA_FADE,
    maxZ: ISLE.z + SEA_FADE
  }
] as const

/** Village floor height, relative to the natural terrain at its centre. */
const VILLAGE_FLATNESS = 0.92

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t)
const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-6))
  return t * t * (3 - 2 * t)
}

/**
 * Distance from a point to a line segment, in the XZ plane.
 *
 * The road and the river are both corridors and both want the same query. One
 * copy, because two would drift and the road would stop following the bridge.
 */
const distanceToSegment = (px: number, pz: number, ax: number, az: number, bx: number, bz: number): number => {
  const dx = bx - ax
  const dz = bz - az
  const lengthSq = dx * dx + dz * dz
  const t = lengthSq <= 1e-9 ? 0 : clamp01(((px - ax) * dx + (pz - az) * dz) / lengthSq)
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t))
}

/**
 * The target height for the story's ground, or `null` where the world's own
 * shape should stand.
 *
 * Written as *targets* rather than as offsets, so each feature says what it
 * wants to be rather than how much to move — which is what makes them
 * composable: where two features overlap (the road meeting the gate) the one
 * with the stronger weight wins, and neither has to know about the other.
 */
const shapeAt = (x: number, z: number, natural: (x: number, z: number) => number): number | null => {
  let target = 0
  let weight = 0

  const claim = (height: number, w: number): void => {
    if (w <= 0) {
      return
    }
    // Highest weight wins outright rather than blending, which matters at the
    // river: a channel that is 60 % carved because the road claimed the other
    // 40 % is a channel with water standing above its own banks.
    if (w > weight) {
      target = height
      weight = w
    }
  }

  // ── The village floor ─────────────────────────────────────────────────────
  //
  // An ellipse matching the palisade, plus 14 m of skirt so the wall is not
  // standing on the lip of a shelf. Flattened toward the natural height at the
  // village centre rather than to a constant, so the village still sits in the
  // landscape rather than on a podium.
  const villageGround = natural(VILLAGE.x, VILLAGE.z)
  const ellipse = Math.hypot((x - VILLAGE.x) / (PALISADE_A + 14), (z - VILLAGE.z) / (PALISADE_B + 14))
  if (ellipse < 1.35) {
    const inner = smoothstep(1.05, 0.86, ellipse)
    claim(villageGround, inner * VILLAGE_FLATNESS)
  }

  // ── The road, gate to bridge ──────────────────────────────────────────────
  //
  // A 7 m carriageway with a 9 m verge, graded linearly from the gate's height
  // to the bridge's. Linear rather than following the terrain: a road that
  // undulates with the ground is a road that has a hill in it, and the chapter
  // walks this stretch three times.
  const gateGround = villageGround
  const bridgeGround = RIVER_SURFACE_Y + 1.15
  const roadT = clamp01((x - WEST_GATE.x) / (BRIDGE.x + 8 - WEST_GATE.x))
  const roadHeight = gateGround + (bridgeGround - gateGround) * roadT
  const roadZ = 0.5 + Math.sin(x * 0.045) * 3.5
  const roadDistance = Math.abs(z - roadZ)
  if (x < WEST_GATE.x + 6 && x > BRIDGE.x + 2 && roadDistance < 16) {
    claim(roadHeight, smoothstep(16, 6.5, roadDistance) * 0.85)
  }

  // ── The ambush meadow ─────────────────────────────────────────────────────
  //
  // Wider and flatter than the road, because it is an arena: five men arrive
  // from one side and four teenagers have to be able to move in it without the
  // ground deciding the fight.
  const meadow = Math.hypot(x - AMBUSH.x, z - AMBUSH.z)
  if (meadow < 26) {
    const meadowHeight = gateGround + (bridgeGround - gateGround) * clamp01((AMBUSH.x - WEST_GATE.x) / (BRIDGE.x + 8 - WEST_GATE.x))
    claim(meadowHeight, smoothstep(26, 13, meadow) * 0.8)
  }

  // ── The trap clearing ─────────────────────────────────────────────────────
  const clearing = Math.hypot(x - TRAP_CLEARING.x, z - TRAP_CLEARING.z)
  if (clearing < 30) {
    claim(natural(TRAP_CLEARING.x, TRAP_CLEARING.z), smoothstep(30, 16, clearing) * 0.82)
  }

  // ── The storyteller's island ──────────────────────────────────────────────
  //
  // Claimed first and at full weight, because it is 1.7 km from everything above
  // and cannot overlap any of it — the `claim` ordering only matters where two
  // features meet, and these two never do.
  //
  // Four bands, straight out of `frame.ts` so the shape and the placements on it
  // cannot drift: a flat plateau the hamlet stands on, a shoulder, a beach, and
  // then seabed out to the edge of the water plane.
  const isleX = x - ISLE.x
  const isleZ = z - ISLE.z
  const square = Math.max(Math.abs(isleX), Math.abs(isleZ))
  if (square < SEA_FADE) {
    const r = Math.hypot(isleX, isleZ)
    let height: number
    if (r < ISLE_FLAT) {
      height = ISLE_TOP
    } else if (r < ISLE_SHOULDER) {
      // The shoulder: 3.6 m of fall over 18 m. Smoothstepped rather than linear,
      // so the plateau has a lip and the beach has a toe — a cone reads as a
      // spoil heap.
      height = ISLE_TOP - 3.6 * smoothstep(ISLE_FLAT, ISLE_SHOULDER, r)
    } else if (r < ISLE_BEACH) {
      // Through the waterline. The shore is wherever this crosses `SEA_LEVEL`,
      // which is why neither number is written down twice.
      height = 2.4 - 1.4 * smoothstep(ISLE_SHOULDER, ISLE_BEACH, r)
    } else {
      height = 1.0 - 1.9 * smoothstep(ISLE_BEACH, SEA_HALF, r)
    }

    // Fading on the **square**, not the radius: the water plane is a rectangle
    // and the seabed has to be a rectangle under it, or the sea's corners stand
    // over unshaped hillside and four wedges of land poke up through it.
    const weight = square < SEA_HALF ? 1 : 1 - smoothstep(SEA_HALF, SEA_FADE, square)
    claim(height, weight)
    // Nothing below can reach out here, so the profile is returned directly and
    // the rest of the function is skipped.
    return weight > 0.02 ? target : null
  }

  // ── The Arla ──────────────────────────────────────────────────────────────
  //
  // Cut **last and strongest**, so it wins wherever it meets the road. The bed
  // is 1.5 m below the surface at the centre of the channel and rises to the
  // bank over 9 m; the water surface itself is authored in `level.ts` and the
  // ground is cut to sit under it.
  //
  // The channel follows the same wandering line the water does, sampled from the
  // same expression — if these two ever disagree the river runs through a bank.
  const riverT = clamp01((130 - z) / 260)
  const riverCentreX = RIVER_X + Math.sin(riverT * 5.1) * 5.5
  const riverSurface = RIVER_SURFACE_Y + riverT * -3.4
  const acrossRiver = Math.abs(x - riverCentreX)
  if (acrossRiver < 22 && z > -140 && z < 140) {
    // Bed at the middle, bank at 9 m out, natural ground by 22.
    const bed = riverSurface - 1.5
    const bank = riverSurface + 1.05
    const profile = acrossRiver < 4.2 ? bed : bed + (bank - bed) * smoothstep(4.2, 9.5, acrossRiver)
    claim(profile, smoothstep(22, 11, acrossRiver))
  }

  return weight > 0.02 ? target : null
}

export interface StoryTerrain {
  field: SculptField
  /** Wall-clock cost of baking, ms. Reported into `WorldBuildInfo.phases`. */
  ms: number
  cells: number
}

/**
 * Bakes the shaping into a `SculptField`.
 *
 * `params` must be the heightfield's own params **with `delta` unset** — the
 * natural height is what every target is measured against, and sampling a field
 * that already contains this sculpt would make the bake depend on whether it had
 * run before.
 */
export const bakeStoryTerrain = (params: HeightfieldParams): StoryTerrain => {
  const started = performance.now()
  const field = new SculptField(SCULPT_CELL_SIZE, SCULPT_TILE_CELLS)
  const bare: HeightfieldParams = { ...params, delta: null }
  const natural = (x: number, z: number): number => heightAtCore(x, z, bare)

  let cells = 0
  for (const region of REGIONS) {
    const i0 = Math.floor(region.minX / SCULPT_CELL_SIZE)
    const i1 = Math.ceil(region.maxX / SCULPT_CELL_SIZE)
    const j0 = Math.floor(region.minZ / SCULPT_CELL_SIZE)
    const j1 = Math.ceil(region.maxZ / SCULPT_CELL_SIZE)

    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = i * SCULPT_CELL_SIZE
        const z = j * SCULPT_CELL_SIZE
        const target = shapeAt(x, z, natural)
        if (target === null) {
          continue
        }
        const offset = target - natural(x, z)
        // A one-centimetre offset is a cell allocated, a tile allocated and a
        // patch transmitted for something nobody can see. The threshold is what
        // keeps the patch to the tiles that are actually shaped.
        if (Math.abs(offset) < 0.02) {
          continue
        }
        field.addAt(i, j, offset)
        cells++
      }
    }
  }

  return { field, ms: Math.round((performance.now() - started) * 10) / 10, cells }
}
