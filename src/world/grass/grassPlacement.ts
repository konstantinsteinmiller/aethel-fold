import { fbm2D, valueNoise2D } from '../geometry/rng'
import {
  groundColorCore,
  heightAtCore,
  type HeightfieldParams,
  TERRAIN_PALETTE_SLOTS
} from '../terrain/heightfieldCore'
import { GRASS_SHORE_FULL, GRASS_SHORE_START, shoreHeightAbove } from '../terrain/waterLevel'
import { PATCH_SIZE } from './config'

/**
 * ─── Where grass grows ──────────────────────────────────────────────────────
 *
 * Pure and **three.js-free**, for the same two reasons `heightfieldCore.ts` is:
 * it can move onto the terrain worker without dragging a second copy of three
 * into that bundle, and it can be unit-tested without a GL context.
 *
 * Placement is a function of `(heightfield params, chunk coordinates)` and
 * nothing else — no walking RNG, no dependence on load order. A chunk that
 * streams out and back in must produce byte-identical grass, or the meadow
 * reshuffles behind the player's back.
 *
 * ── Suitability is a weight, not a test ─────────────────────────────────────
 *
 * The obvious implementation rejects a patch when the slope is too steep or the
 * ground is sand. That draws a **hard line** across a hillside: a full meadow on
 * one side of a contour and bare dirt on the other, following a curve nothing
 * else in the scene follows. Instead every rejection criterion produces a
 * *density* in [0,1], the densities multiply, and the shader collapses blades
 * whose hash exceeds it (`step(aBlade.z, density)` in `grassGlsl.ts`). A meadow
 * therefore thins out into dirt over three or four metres, which is what a real
 * boundary between turf and scree looks like and costs nothing extra — the
 * blades were already going to be evaluated.
 *
 * A patch only disappears entirely once its density reaches zero, and that
 * threshold is what keeps bare rock from paying for an instance it draws nothing
 * with.
 */

/**
 * One patch: origin, four corner heights, ground tint, density.
 *
 * Written into flat arrays rather than returned as objects — this runs for
 * thousands of patches per chunk load and the field copies straight from these
 * into the interleaved instance buffer.
 */
export interface PatchBuffer {
  /** Patch count actually written. */
  count: number
  /** `count × 2` — world x, z of each patch's minimum corner. */
  origin: Float32Array
  /** `count × 4` — absolute heights at (0,0), (1,0), (0,1), (1,1) in patch uv. */
  corners: Float32Array
  /** `count × 3` — linear-RGB ground colour sampled at the patch centre. */
  tint: Float32Array
  /** `count × 2` — hash in [0,1) and density in [0,1]. */
  params: Float32Array
  /** Highest blade top in the chunk, for the cell's bounding sphere. */
  topY: number
  /** Lowest corner height in the chunk. */
  lowY: number
}

export const createPatchBuffer = (capacity: number): PatchBuffer => ({
  count: 0,
  origin: new Float32Array(capacity * 2),
  corners: new Float32Array(capacity * 4),
  tint: new Float32Array(capacity * 3),
  params: new Float32Array(capacity * 2),
  topY: 0,
  lowY: 0
})

export interface GrassPlacementOptions {
  /** Below this height grass gives way to sand and water. */
  minHeight?: number
  /** `normalY` at which grass has fully given way to dirt. */
  slopeCutoff?: number
  /** `normalY` at which grass is still at full density. */
  slopeFull?: number
  /** Feature size of the meadow/clearing mask, in metres. */
  clearingSize?: number
  /** Mask value below which the ground is bare. */
  clearingThreshold?: number
  /** Nominal blade height, for the cell's bounding sphere. */
  bladeHeight?: number
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Scratch for the shared corner-height grid. Sized for the largest chunk. */
let heightGrid = new Float32Array(0)
const groundOut = new Float32Array(3)

/**
 * Slight brightening of the sampled ground colour.
 *
 * A multiplier rather than a palette entry because it is not a colour: it is a
 * value relationship between two surfaces, and it has to hold whatever the
 * ground underneath happens to be. A blade standing in front of the soil it grew
 * from, at the identical colour, is invisible — this is what separates the sward
 * from the ground plane before the lighting has done anything.
 */
const GRASS_LIFT = 1.13

/** Extra lift on green alone — see the call site. */
const GRASS_GREEN_BIAS = 1.06

/**
 * The palette slice `groundColorCore` needs, in its slot order.
 *
 * Filled by `setGrassPalette` from `art/palette.ts` at boot rather than built
 * here, because this module must not import three (see the header) and
 * `THREE.Color` is what performs the sRGB → linear conversion the rest of the
 * world's colours already went through. Building it from hex here would give
 * grass a colour space of its own — and would put hex literals outside the
 * palette, which the project bans outright.
 */
let TERRAIN_PALETTE: Float32Array<ArrayBufferLike> = new Float32Array(TERRAIN_PALETTE_SLOTS.length * 3)

export const setGrassPalette = (palette: Float32Array<ArrayBufferLike>): void => {
  TERRAIN_PALETTE = palette
}

/**
 * ─── Where grass must not grow ──────────────────────────────────────────────
 *
 * Flat triples — `[x, z, radius, x, z, radius, …]` — of places a building
 * stands.
 *
 * A `Float32Array` rather than an array of objects, and that is the same
 * decision `setGrassPalette` above makes for the same reason: this module is
 * deliberately three-free and worker-ready, so everything that crosses into it
 * has to survive a structured clone without turning into a graph of objects.
 *
 * ── Why grass needs this at all ─────────────────────────────────────────────
 *
 * Grass is placed from the *terrain*, and the terrain has no idea a house is
 * standing on it. So blades grow through floorboards, up through a hearth, and
 * out of the middle of a market stall — and because a blade is built in the
 * vertex shader there is nothing to depth-sort against, it simply intersects.
 *
 * The alternative was to test grass against the placement list, which is the
 * obvious fix and the wrong layer: placements live in `level/`, they are a
 * `Map` of objects, and grass would have had to import the level to grow.
 */
let EXCLUSIONS: Float32Array<ArrayBufferLike> = new Float32Array(0)

export const setGrassExclusions = (zones: Float32Array<ArrayBufferLike>): void => {
  EXCLUSIONS = zones
}

/**
 * How much grass survives at a point, 0 inside a building and 1 well clear.
 *
 * Feathered over `EXCLUSION_FEATHER` rather than cut hard, because everything
 * else in this function is a *density* and a hard edge would be the one place
 * in the meadow where grass stops at a contour — which is exactly the tell the
 * header says the density model exists to avoid.
 */
const exclusionDensity = (x: number, z: number): number => {
  let lowest = 1
  for (let i = 0; i + 2 < EXCLUSIONS.length; i += 3) {
    const dx = x - EXCLUSIONS[i]!
    const dz = z - EXCLUSIONS[i + 1]!
    const radius = EXCLUSIONS[i + 2]!
    const distance = Math.sqrt(dx * dx + dz * dz)
    if (distance >= radius + EXCLUSION_FEATHER) {
      continue
    }
    const weight = clamp01((distance - radius) / EXCLUSION_FEATHER)
    if (weight < lowest) {
      lowest = weight
      if (lowest <= 0) {
        return 0
      }
    }
  }
  return lowest
}

/** Metres over which grass returns to full density outside a building. */
const EXCLUSION_FEATHER = 1.6

/**
 * Fills `out` with the patches of one terrain chunk.
 *
 * ── Corner heights come from a shared grid, and that is the whole cost story ─
 *
 * A 48 m chunk holds 12 × 12 patches, and the naive version samples four corners
 * per patch — 576 `heightAtCore` calls, each of which is four fbm evaluations of
 * four octaves. Sampling a **13 × 13 grid once** and indexing it gives every
 * patch its four corners for 169 calls, a 3.4× reduction, and it makes adjacent
 * patches share their corners *exactly* so no seam can open between them.
 *
 * The surface gradient falls out of the same grid by central difference, so the
 * slope test is free. That matters: `normalAtCore` is four more `heightAtCore`
 * calls per sample, which would have been the single most expensive line here.
 */
export const buildChunkPatches = (
  params: HeightfieldParams,
  originX: number,
  originZ: number,
  chunkSize: number,
  out: PatchBuffer,
  options: GrassPlacementOptions = {}
): PatchBuffer => {
  const {
    minHeight = -2.2,
    slopeCutoff = 0.62,
    slopeFull = 0.9,
    clearingSize = 62,
    clearingThreshold = 0.34,
    bladeHeight = 0.55
  } = options

  const cells = Math.max(1, Math.round(chunkSize / PATCH_SIZE))
  const step = chunkSize / cells
  const gridSize = cells + 1

  if (heightGrid.length < gridSize * gridSize) {
    heightGrid = new Float32Array(gridSize * gridSize)
  }
  for (let gz = 0; gz < gridSize; gz++) {
    for (let gx = 0; gx < gridSize; gx++) {
      heightGrid[gz * gridSize + gx] = heightAtCore(originX + gx * step, originZ + gz * step, params)
    }
  }

  out.count = 0
  let topY = Number.NEGATIVE_INFINITY
  let lowY = Number.POSITIVE_INFINITY
  const inverseClearing = 1 / clearingSize
  const seed = params.seed

  for (let gz = 0; gz < cells; gz++) {
    for (let gx = 0; gx < cells; gx++) {
      const h00 = heightGrid[gz * gridSize + gx]!
      const h10 = heightGrid[gz * gridSize + gx + 1]!
      const h01 = heightGrid[(gz + 1) * gridSize + gx]!
      const h11 = heightGrid[(gz + 1) * gridSize + gx + 1]!

      const centerHeight = (h00 + h10 + h01 + h11) * 0.25
      const x = originX + (gx + 0.5) * step
      const z = originZ + (gz + 0.5) * step

      // Gradient from the corners we already have. `normalY` then matches what
      // `groundColorCore` is about to be told, so the grass thins out over
      // exactly the band where the terrain is turning to dirt rather than over a
      // band of its own that happens to sit a metre away.
      const dhx = (h10 + h11 - h00 - h01) / (2 * step)
      const dhz = (h01 + h11 - h00 - h10) / (2 * step)
      const normalY = 1 / Math.sqrt(dhx * dhx + dhz * dhz + 1)

      // ── Suitability, as a product of weights ──────────────────────────────
      let density = clamp01((normalY - slopeCutoff) / (slopeFull - slopeCutoff))
      if (density <= 0) {
        continue
      }
      // Wet hollows and the sand flats below them. Grass fades out over ~3 m
      // rather than stopping at a contour.
      density *= clamp01((centerHeight - minHeight) / 3)
      if (density <= 0) {
        continue
      }

      // ── The shore ────────────────────────────────────────────────────────
      //
      // `minHeight` above is an *absolute* height and therefore says nothing
      // about a chapter's water: the storyteller's seabed bottoms out at −0.9 m
      // against a sea surface at +2.0, so every criterion above it passed and
      // the meadow grew straight down into the water and out of it again — a
      // lawn somebody had flooded.
      //
      // The fix is the same quantity the terrain's sand band is painted from
      // and, deliberately, the **same function** including its noise, so the
      // blades stop inside the sand rather than crossing it wherever the two
      // wanders disagreed. Below the waterline this is negative and the patch
      // is dropped outright; through the beach it is a ramp, because `grass.md`
      // §7 is explicit that suitability is a weight and never a test.
      density *= clamp01(
        (shoreHeightAbove(x, z, centerHeight, seed) - GRASS_SHORE_START) / (GRASS_SHORE_FULL - GRASS_SHORE_START)
      )
      if (density <= 0) {
        continue
      }

      // Meadows and clearings. Without this the world is uniformly carpeted,
      // which reads as procedural instantly — the same trick and the same reason
      // `scatter.ts` gives for its grove mask, one octave cheaper because grass
      // is dense enough that the noise itself is legible.
      const clearing = fbm2D(x * inverseClearing, z * inverseClearing, 3, 2.09, 0.55, seed + 6101)
      density *= clamp01((clearing - clearingThreshold) * 4.4)
      if (density <= 0) {
        continue
      }

      // Buildings. Last of the geometric criteria and cheapest to reject on,
      // because the list is almost always empty away from a settlement.
      if (EXCLUSIONS.length > 0) {
        density *= exclusionDensity(x, z)
        if (density <= 0) {
          continue
        }
      }

      // A little high-frequency thinning so a meadow is not one flat density.
      density *= 0.62 + 0.38 * valueNoise2D(x * 0.13, z * 0.13, seed + 733)
      // Below this a patch is drawing one blade in twenty and is not worth an
      // instance — the field would still pay its cull, its packing and its
      // vertex load for ~10 visible blades.
      if (density < 0.06) {
        continue
      }

      // ── Ground colour ─────────────────────────────────────────────────────
      //
      // The same function the terrain mesh itself is coloured with, sampled at
      // the patch centre. This is the single art decision that keeps grass from
      // reading as a green carpet laid over a differently-green hill: whatever
      // the macro noise is doing to the ground — the dry warm patches, the cool
      // damp hollows, the dirt creeping up a slope — the blades do too, because
      // it is literally the same call.
      groundColorCore(x, z, centerHeight, normalY, params, TERRAIN_PALETTE, groundOut, 0)

      const index = out.count
      if ((index + 1) * 4 > out.corners.length) {
        // Soft failure, like `InstancedLodField.addCell`: dropping the tail of a
        // chunk's grass is survivable, throwing mid-traversal is not.
        break
      }
      out.origin[index * 2] = originX + gx * step
      out.origin[index * 2 + 1] = originZ + gz * step
      out.corners[index * 4] = h00
      out.corners[index * 4 + 1] = h10
      out.corners[index * 4 + 2] = h01
      out.corners[index * 4 + 3] = h11
      // Lit slightly above the ground it was sampled from. A blade standing in
      // front of the soil it grew from at the identical colour is invisible; the
      // lift is what separates the sward from the ground plane before the
      // lighting has done anything.
      out.tint[index * 3] = groundOut[0]! * GRASS_LIFT
      // Green is lifted a touch further than red and blue. The ground colour
      // this was sampled from carries the dirt and sand blends, so a patch on
      // the edge of a scree slope inherits a brown — and grass growing at the
      // edge of a dirt patch is still grass. The bias pulls it back toward the
      // family without discarding the macro variation that made it worth
      // sampling.
      out.tint[index * 3 + 1] = groundOut[1]! * GRASS_LIFT * GRASS_GREEN_BIAS
      out.tint[index * 3 + 2] = groundOut[2]! * GRASS_LIFT
      // Hash from position, not from a counter: a counter would depend on how
      // many patches were rejected before this one, so editing terrain two cells
      // away would re-roll this patch's rotation.
      out.params[index * 2] = valueNoise2D(x * 0.977, z * 1.113, seed + 991)
      out.params[index * 2 + 1] = density
      out.count++

      const patchTop = Math.max(h00, h10, h01, h11) + bladeHeight
      if (patchTop > topY) {
        topY = patchTop
      }
      const patchLow = Math.min(h00, h10, h01, h11)
      if (patchLow < lowY) {
        lowY = patchLow
      }
    }
  }

  out.topY = Number.isFinite(topY) ? topY : 0
  out.lowY = Number.isFinite(lowY) ? lowY : 0
  return out
}

/** Worst-case patches in one chunk, for sizing the scratch buffer. */
export const maxPatchesPerChunk = (chunkSize: number): number => {
  const cells = Math.max(1, Math.round(chunkSize / PATCH_SIZE))
  return cells * cells
}
