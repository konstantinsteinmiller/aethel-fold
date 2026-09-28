import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import { C } from '@/world/art/palette'
import {
  DEFAULT_HEIGHTFIELD_PARAMS,
  groundColorCore,
  type HeightfieldParams,
  TERRAIN_PALETTE_SLOTS
} from '@/world/terrain/heightfieldCore'
import {
  GRASS_SHORE_FULL,
  GRASS_SHORE_START,
  NO_WATER,
  packWaterBodies,
  setWaterTable,
  SHORE_DAMP_TOP,
  SHORE_DRY_TOP,
  SHORE_JITTER,
  SHORE_SAND_FULL,
  SHORE_SAND_TOP,
  shoreHeightAbove,
  WATER_STRIDE,
  waterLevelAt
} from '@/world/terrain/waterLevel'
import { buildChunkPatches, createPatchBuffer, maxPatchesPerChunk, setGrassPalette } from '@/world/grass/grassPlacement'
import { PATCH_SIZE } from '@/world/grass/config'

/**
 * ─── The shore ──────────────────────────────────────────────────────────────
 *
 * "Near the water shore, there should be no grass growing and the grassy ground
 * should turn into a sandy ground at the water edges."
 *
 * What shipped before this suite: on the storyteller's island the meadow ran
 * down the beach, under the waterline and out the far side, and blades stood in
 * open sea. Nothing caught it, because every criterion in `grassPlacement.ts`
 * was either a slope, a noise mask, or an **absolute** height — and the island's
 * seabed bottoms out at −0.9 m against a sea surface at +2.0, so `minHeight`'s
 * −2.2 was satisfied everywhere under the water.
 *
 * The tests below pin the three things that are invisible when broken:
 *
 *  1. the band is **inert** without a water table, so `/` (Meadowfall, no water)
 *     renders byte-identically to before it existed;
 *  2. no grass patch survives below the waterline or inside the sand;
 *  3. the grass edge and the sand edge are the *same* boundary — they share one
 *     noise term, and a second copy of that expression would let blades cross it
 *     wherever the two wanders disagreed.
 */

/** The real palette, so "closer to sand than to grass" means what it says. */
const palette = new Float32Array(TERRAIN_PALETTE_SLOTS.length * 3)
TERRAIN_PALETTE_SLOTS.forEach((slot, i) => {
  const color = C[slot]
  palette[i * 3] = color.r
  palette[i * 3 + 1] = color.g
  palette[i * 3 + 2] = color.b
})
setGrassPalette(palette)

const params: HeightfieldParams = { ...DEFAULT_HEIGHTFIELD_PARAMS }

/** A 400 m square of water at y = 0, well away from the world's spawn plain. */
const POND_Y = 0
const POND = { minX: 600, minZ: 600, maxX: 1000, maxZ: 1000, y: POND_Y }

const withWater = <T>(bodies: Parameters<typeof packWaterBodies>[0], run: () => T): T => {
  setWaterTable(packWaterBodies(bodies))
  try {
    return run()
  } finally {
    setWaterTable(new Float32Array(0))
  }
}

const out = new Float32Array(3)
const paint = (x: number, z: number, height: number, normalY = 0.99): Color => {
  groundColorCore(x, z, height, normalY, params, palette, out, 0)
  return new Color(out[0]!, out[1]!, out[2]!)
}

/** Distance in linear RGB. Crude, and enough to say which family a colour is in. */
const distance = (a: Color, b: Color): number => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)

describe('the water table', () => {
  it('packs a body per stride and answers NO_WATER outside every one', () => {
    const table = packWaterBodies([POND, { minX: -10, minZ: -10, maxX: 10, maxZ: 10, y: 5 }])
    expect(table.length).toBe(2 * WATER_STRIDE)
    withWater([POND], () => {
      expect(waterLevelAt(800, 800)).toBe(POND_Y)
      expect(waterLevelAt(599, 800)).toBe(NO_WATER)
      expect(waterLevelAt(800, 1001)).toBe(NO_WATER)
    })
  })

  /**
   * The Arla falls 3.4 m over 260 m. Packed as one sloped rect it is exact;
   * packed as ten flat per-node rects it steps 0.34 m at every node, which on
   * that river's 0.7 m/m cut bank is half a metre of shoreline notch every 26 m.
   */
  it('carries a linear surface slope, so a running river needs one rectangle', () => {
    withWater([{ minX: -110, minZ: -130, maxX: -80, maxZ: 130, y: 0, slopeZ: -3.4 / 260 }], () => {
      expect(waterLevelAt(-96, 0)).toBeCloseTo(0, 6)
      expect(waterLevelAt(-96, -130)).toBeCloseTo(1.7, 5)
      expect(waterLevelAt(-96, 130)).toBeCloseTo(-1.7, 5)
    })
  })

  it('takes the highest surface where two bodies overlap', () => {
    withWater([POND, { minX: 700, minZ: 700, maxX: 900, maxZ: 900, y: 4 }], () => {
      expect(waterLevelAt(800, 800)).toBe(4)
      expect(waterLevelAt(650, 650)).toBe(POND_Y)
    })
  })
})

describe('shoreHeightAbove', () => {
  it('is +Infinity on ground with no water under it, so every ramp clamps off', () => {
    withWater([POND], () => {
      expect(shoreHeightAbove(0, 0, 12, params.seed)).toBe(Number.POSITIVE_INFINITY)
    })
    expect(shoreHeightAbove(800, 800, 12, params.seed)).toBe(Number.POSITIVE_INFINITY)
  })

  it('tracks height above the surface to within the jitter, and wanders inside it', () => {
    withWater([POND], () => {
      const seen = new Set<number>()
      for (let x = 620; x < 980; x += 3) {
        for (let z = 620; z < 980; z += 37) {
          const above = shoreHeightAbove(x, z, 0.5, params.seed)
          expect(Number.isFinite(above)).toBe(true)
          expect(Math.abs(above - 0.5)).toBeLessThanOrEqual(SHORE_JITTER + 1e-6)
          seen.add(Math.round(above * 200))
        }
      }
      // If the noise were dead this would be one value and the beach would be a
      // perfect circle — which is the tell the jitter exists to remove.
      expect(seen.size).toBeGreaterThan(20)
    })
  })

  it('is one function, so the sand edge and the grass edge cannot drift apart', () => {
    // Not a stylistic assertion: `GRASS_SHORE_START` *is* `SHORE_SAND_FULL`, so
    // a blade can only exist where the sand has already begun to give way.
    expect(GRASS_SHORE_START).toBe(SHORE_SAND_FULL)
    expect(SHORE_DAMP_TOP).toBeLessThan(SHORE_SAND_FULL)
    expect(SHORE_SAND_FULL).toBeLessThan(SHORE_SAND_TOP)
    expect(SHORE_SAND_TOP).toBeLessThan(SHORE_DRY_TOP)
    expect(GRASS_SHORE_FULL).toBeLessThanOrEqual(SHORE_DRY_TOP)
  })
})

describe('the ground turns to sand at the water edge', () => {
  it('paints wet sand at and below the waterline, dry sand above it', () => {
    withWater([POND], () => {
      const submerged = paint(800, 800, POND_Y - 1.2)
      const waterline = paint(800, 800, POND_Y + 0.05)
      const drySand = paint(800, 800, POND_Y + SHORE_SAND_FULL - 0.05)

      expect(distance(submerged, C.sandWet)).toBeLessThan(distance(submerged, C.grassBase))
      expect(distance(waterline, C.sandWet)).toBeLessThan(distance(waterline, C.grassBase))
      // Above the damp band the strip is sand, not wet sand — the two have to be
      // distinguishable or the "darker strip right at the edge" is not there.
      expect(distance(drySand, C.sand)).toBeLessThan(distance(drySand, C.sandWet))
      expect(drySand.r).toBeGreaterThan(waterline.r)
    })
  })

  it('reaches the meadow through a dry-grass collar rather than a hard line', () => {
    withWater([POND], () => {
      // Sampled up the band at a fixed (x, z) so the macro noise is constant and
      // the only thing moving is height above the water.
      const steps = []
      for (let above = -0.4; above <= SHORE_DRY_TOP + 0.4; above += 0.05) {
        steps.push(paint(800, 800, POND_Y + above))
      }
      let worst = 0
      for (let i = 1; i < steps.length; i++) {
        worst = Math.max(worst, distance(steps[i]!, steps[i - 1]!))
      }
      // Calibrated against the transition itself rather than against a number
      // typed in here: no 5 cm of climb — about 50 cm of walking on the island's
      // beach — may cross more than 40 % of the whole meadow-to-wet-sand
      // distance. A hard line crosses 100 % of it in one step, whatever the
      // palette happens to be. Measured worst: 0.045 against a span of 0.15.
      const span = distance(steps[0]!, steps[steps.length - 1]!)
      expect(worst).toBeLessThan(span * 0.4)

      // And the collar is genuinely warmer than both its neighbours, or it is
      // not a collar, it is a crossfade nobody can see.
      const collar = paint(800, 800, POND_Y + (SHORE_SAND_TOP + SHORE_DRY_TOP) * 0.5)
      const meadow = paint(800, 800, POND_Y + SHORE_DRY_TOP + 2)
      expect(distance(collar, C.grassDry)).toBeLessThan(distance(meadow, C.grassDry))
    })
  })

  it('leaves a cliff shore as rock rather than painting sand up a wall', () => {
    withWater([POND], () => {
      // `normalY` 0.45 is well past the dirt cutoff. Painted after the shore band
      // on purpose — sand on a vertical face is the failure this ordering avoids.
      const cliff = paint(800, 800, POND_Y + 0.2, 0.45)
      expect(distance(cliff, C.dirt)).toBeLessThan(distance(cliff, C.sand))
    })
  })

  it('is inert with no water table — Meadowfall renders exactly as before', () => {
    const dry: number[] = []
    for (let i = 0; i < 40; i++) {
      const x = 800 + i * 7
      const z = 800 - i * 11
      groundColorCore(x, z, i * 0.3 - 4, 0.97, params, palette, out, 0)
      dry.push(out[0]!, out[1]!, out[2]!)
    }
    // Same points, with a water table installed 900 m away.
    const withDistantWater = withWater([{ minX: -1000, minZ: -1000, maxX: -600, maxZ: -600, y: 0 }], () => {
      const got: number[] = []
      for (let i = 0; i < 40; i++) {
        groundColorCore(800 + i * 7, 800 - i * 11, i * 0.3 - 4, 0.97, params, palette, out, 0)
        got.push(out[0]!, out[1]!, out[2]!)
      }
      return got
    })
    expect(withDistantWater).toEqual(dry)
  })

  it('never produces a non-finite channel anywhere in the band', () => {
    withWater([POND], () => {
      for (let above = -6; above <= 6; above += 0.13) {
        for (const normalY of [1, 0.95, 0.8, 0.6, 0.3]) {
          groundColorCore(777, 833, POND_Y + above, normalY, params, palette, out, 0)
          expect(Number.isFinite(out[0]!) && Number.isFinite(out[1]!) && Number.isFinite(out[2]!)).toBe(true)
        }
      }
    })
  })
})

describe('no grass in the water or on the beach', () => {
  const CHUNK = 48
  const buffer = createPatchBuffer(maxPatchesPerChunk(CHUNK))

  /** Every patch a chunk emits, as (centre x, centre z, mean corner height). */
  const patchesIn = (originX: number, originZ: number) => {
    buildChunkPatches(params, originX, originZ, CHUNK, buffer)
    const list = []
    for (let i = 0; i < buffer.count; i++) {
      const corners = [
        buffer.corners[i * 4]!,
        buffer.corners[i * 4 + 1]!,
        buffer.corners[i * 4 + 2]!,
        buffer.corners[i * 4 + 3]!
      ]
      list.push({
        x: buffer.origin[i * 2]! + PATCH_SIZE * 0.5,
        z: buffer.origin[i * 2 + 1]! + PATCH_SIZE * 0.5,
        height: (corners[0]! + corners[1]! + corners[2]! + corners[3]!) * 0.25,
        low: Math.min(...corners),
        density: buffer.params[i * 2 + 1]!
      })
    }
    return list
  }

  /**
   * Water at the chunk's own median height, so roughly half of it is submerged
   * and the shore runs across the middle. Picking the level from the terrain
   * rather than the other way round is what makes this a real shoreline test on
   * the procedural field instead of a test that the chunk happens to be high.
   */
  const chunkOrigin = { x: 864, z: 768 }
  const patchesInBare = patchesIn(chunkOrigin.x, chunkOrigin.z)
  const medianHeight = (() => {
    const heights = patchesInBare.map(p => p.height)
    heights.sort((a, b) => a - b)
    return heights[Math.floor(heights.length / 2)] ?? 0
  })()

  const body = () => ({
    minX: chunkOrigin.x - 200,
    minZ: chunkOrigin.z - 200,
    maxX: chunkOrigin.x + 200,
    maxZ: chunkOrigin.z + 200,
    y: medianHeight
  })

  it('drops every patch below the waterline and inside the sand', () => {
    // Asserted **inside** `withWater`. `shoreHeightAbove` reads module state, so
    // the same loop run after the table is torn down returns `+Infinity` for
    // every patch and passes vacuously — which is exactly what the first draft
    // of this test did, and it reported a green tick on a chunk it had never
    // actually checked.
    withWater([body()], () => {
      const kept = patchesIn(chunkOrigin.x, chunkOrigin.z)
      expect(kept.length).toBeGreaterThan(0)
      for (const patch of kept) {
        // The exact invariant, not an approximation: a surviving patch must
        // clear the same jittered threshold the sand is painted from.
        const above = shoreHeightAbove(patch.x, patch.z, patch.height, params.seed)
        expect(above).toBeGreaterThan(GRASS_SHORE_START)
        // And no blade may stand in open water. `GRASS_SHORE_START` is 0.45 and
        // the jitter reaches 0.16, so a surviving patch centre clears the
        // surface by at least 0.29 m — arithmetic, not a tolerance by eye.
        expect(patch.height).toBeGreaterThan(medianHeight + GRASS_SHORE_START - SHORE_JITTER)
        expect(patch.low).toBeGreaterThan(medianHeight - PATCH_SIZE)
      }
    })
  })

  it('ramps rather than cutting — patches survive part-strength through the band', () => {
    withWater([body()], () => {
      const kept = patchesIn(chunkOrigin.x, chunkOrigin.z)
      const inBand = kept.filter(p => {
        const above = shoreHeightAbove(p.x, p.z, p.height, params.seed)
        return above > GRASS_SHORE_START && above < GRASS_SHORE_FULL
      })
      // `grass.md` §7: suitability is a weight, never a test. If the band only
      // ever held full-density patches the boundary would be a hard line one
      // patch wide. Measured on this chunk: 19 of 47 survivors sit in the ramp.
      expect(inBand.length).toBeGreaterThan(4)
      expect(Math.min(...inBand.map(p => p.density))).toBeLessThan(0.75)
      // And the meadow is genuinely thinned, not merely clipped: this chunk
      // drops from 112 patches to 47 once the water is under half of it.
      expect(kept.length).toBeLessThan(patchesInBare.length * 0.8)
    })
  })

  it('leaves a chunk with no water over it byte-identical', () => {
    const bare = patchesIn(chunkOrigin.x, chunkOrigin.z)
    const far = withWater([{ minX: -2000, minZ: -2000, maxX: -1600, maxZ: -1600, y: 0 }], () =>
      patchesIn(chunkOrigin.x, chunkOrigin.z)
    )
    expect(far).toEqual(bare)
  })

  it('restores full meadow above the band, so a lake does not thin its own hillside', () => {
    // Water 40 m below the chunk: every patch is far clear of `GRASS_SHORE_FULL`.
    const bare = patchesIn(chunkOrigin.x, chunkOrigin.z)
    const deep = withWater(
      [
        {
          minX: chunkOrigin.x - 200,
          minZ: chunkOrigin.z - 200,
          maxX: chunkOrigin.x + 200,
          maxZ: chunkOrigin.z + 200,
          y: medianHeight - 40
        }
      ],
      () => patchesIn(chunkOrigin.x, chunkOrigin.z)
    )
    expect(deep).toEqual(bare)
  })
})
