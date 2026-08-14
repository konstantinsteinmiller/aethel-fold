import { type BufferGeometry, Color } from 'three'
import { C } from '../art/palette'
import type { Rng } from '../geometry/rng'
import { ensureColorAttribute, jitterColor, paintByHeight, paintByUpness } from '../geometry/vertexColor'
import { smootherstep } from './plateau'

/**
 * ─── Stone families ─────────────────────────────────────────────────────────
 *
 * `plateau.ts` owns the *geometry* kit the whole cliff family shares — the
 * loft, the fused-column section, the strata, the ring refinement. This file
 * owns the other half: which **stone** a prop is made of.
 *
 * The split exists because the desert props are not a new shape language. A
 * hoodoo and a sea stack are the same lofted surface of revolution with the
 * same arrises; what makes one read as Utah and the other as the Hebrides is
 * three colours and a banding pass. Threading a `StonePalette` through the
 * generators is therefore the whole of "add a desert version", and it means a
 * future family (chalk, obsidian, ice) costs one constant rather than a file.
 *
 * ── Why the palette is passed rather than looked up by name ─────────────────
 *
 * `paintCliffRock` in `plateau.ts` reads `C.cliff*` directly, which was right
 * when there was one stone. A name lookup here (`stoneFor('desert')`) would put
 * a string in every generator's options and a switch in every paint call; a
 * value object puts the decision in `assets/index.ts`, where the placeable
 * catalogue already decides everything else about a prop.
 *
 * `PALE_STONE` is deliberately the *same three colours* `paintCliffRock` uses,
 * so a mesa and a plateau standing together are the same rock — this is a new
 * dial, not a new look.
 */

export interface StonePalette {
  /** Sunlit faces and upward-pointing normals. */
  lit: Color
  /** The mass of the rock. */
  base: Color
  /** Deep shade and the AO resolve target. Never black (GDD R4). */
  shadow: Color
  /**
   * The paler stripe in a sedimentary band. Omit and `paintSedimentaryBands`
   * falls back to `lit`, which still bands but with less of a mineral read.
   */
  band?: Color
}

/** The existing cliff family: cool blue-grey. Plateaus, spires, slabs, mesas. */
export const PALE_STONE: StonePalette = {
  lit: C.cliffLit,
  base: C.cliffBase,
  shadow: C.cliffShadow,
  band: C.grassCapLit
}

/** Warm terracotta. Hoodoos, buttes, banded pillars — the desert reference. */
export const DESERT_STONE: StonePalette = {
  lit: C.sandstoneLit,
  base: C.sandstoneBase,
  shadow: C.sandstoneShadow,
  band: C.sandstoneBand
}

/**
 * Bottom of a body's vertical ramp — the same 55 % lift toward base that
 * `plateau.ts` applies, for the same reason: the raw shadow colour puts a tall
 * prop's foot in the darkest band and it reads as a burnt stump rather than as
 * stone in shade (GDD R4).
 *
 * Computed per palette and cached, because `Color` instances in `C` must never
 * be mutated and a fresh `clone().lerp()` per tier per prop is pure garbage.
 */
const lowCache = new WeakMap<StonePalette, Color>()

const bodyLow = (stone: StonePalette): Color => {
  const cached = lowCache.get(stone)
  if (cached) {
    return cached
  }
  const color = stone.shadow.clone().lerp(stone.base, 0.55)
  lowCache.set(stone, color)
  return color
}

/**
 * The family paint stack, parameterised by stone. Identical in structure to
 * `paintCliffRock` — pale at the top, cooler and duller into the undercut, plus
 * upward-normal bleaching that stands in for a sky bounce.
 *
 * Call this on the **body part before merging**, not on the merged asset: it
 * reads the geometry's own bounding box for the height ramp, and a merged prop's
 * box includes its cap.
 */
export const paintStoneBody = (
  geometry: BufferGeometry,
  rng: Rng,
  stone: StonePalette,
  jitter = 0.03
): BufferGeometry => {
  paintByHeight(geometry, bodyLow(stone), stone.lit, { curve: 0.75 })
  paintByUpness(geometry, stone.lit, 0.45, 2)
  return jitterColor(geometry, rng, jitter)
}

// ─── Sedimentary banding ────────────────────────────────────────────────────

/**
 * One horizontal stripe, in object-space Y.
 *
 * Bands are **generated once per shape and reused by every tier**, exactly like
 * `Stratum`. That is not tidiness: a band is a function of Y alone, so sharing
 * the list is what guarantees LOD0 and LOD3 stripe at the same heights. Deriving
 * them per tier from a fresh `Rng` would give each tier its own stripes, and the
 * dithered crossfade would show two different rocks (GDD §4.3).
 */
export interface StoneBand {
  y: number
  /** Half-thickness in metres. */
  halfHeight: number
  /** Peak mix, 0–1. Signed: negative darkens toward `shadow` instead. */
  strength: number
}

/**
 * A stack of stripes across `[minY, maxY]`, thin and uneven.
 *
 * Roughly one in three bands is authored *negative* — a dark seam rather than a
 * pale one. A stack of pale-only stripes reads as a gradient with ripples in it
 * because every band pushes the same direction; alternating gives the eye
 * genuine edges to count, which is what makes a butte look layered from 60 m
 * where no geometry survives to say so.
 */
export const makeStoneBands = (
  rng: Rng,
  count: number,
  minY: number,
  maxY: number,
  thickness: [number, number] = [0.06, 0.16]
): StoneBand[] => {
  const bands: StoneBand[] = []
  const span = maxY - minY
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count + rng.spread(0.3 / count)
    const pale = rng() < 0.66
    bands.push({
      y: minY + span * t,
      halfHeight: span * rng.range(thickness[0], thickness[1]) * 0.5,
      strength: rng.range(0.35, 0.7) * (pale ? 1 : -0.75)
    })
  }
  return bands
}

const _band = new Color()

/**
 * Mixes the band colours into the vertex colours by height — **GDD R1 in its
 * purest form**: this is the single most identifiable feature of the desert
 * reference, and it costs exactly zero triangles.
 *
 * Run it *after* `paintStoneBody` and *before* the AO apply, so the stripes sit
 * on the height ramp and then get occluded along with everything else.
 *
 * The profile is a smootherstep shoulder rather than a cosine: a cosine band has
 * no flat middle, so a thin stripe never actually reaches its own colour and the
 * whole pass mutes itself. `1 − smootherstep` over the outer half gives a stripe
 * with a solid core and a soft edge, which is what sedimentary rock looks like
 * and, more practically, is what survives being sampled by four different ring
 * lists.
 */
export const paintSedimentaryBands = (
  geometry: BufferGeometry,
  stone: StonePalette,
  bands: readonly StoneBand[],
  strength = 1
): BufferGeometry => {
  if (bands.length === 0 || strength <= 0) {
    return geometry
  }
  const pale = stone.band ?? stone.lit
  const position = geometry.getAttribute('position')
  const attribute = ensureColorAttribute(geometry)
  const array = attribute.array as Float32Array

  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i)
    let mix = 0
    for (let b = 0; b < bands.length; b++) {
      const band = bands[b]!
      const d = Math.abs(y - band.y) / (band.halfHeight || 1e-6)
      if (d >= 1) {
        continue
      }
      // Solid to half-thickness, then falling off. `Math.abs` picks the strongest
      // band rather than summing, so overlapping stripes don't stack into a blob.
      const profile = 1 - smootherstep(0.5, 1, d)
      const contribution = band.strength * profile
      if (Math.abs(contribution) > Math.abs(mix)) {
        mix = contribution
      }
    }
    if (mix === 0) {
      continue
    }
    const t = Math.abs(mix) * strength
    _band.copy(mix > 0 ? pale : stone.shadow)
    const r = array[i * 3]!
    const g = array[i * 3 + 1]!
    const b = array[i * 3 + 2]!
    array[i * 3] = r + (_band.r - r) * t
    array[i * 3 + 1] = g + (_band.g - g) * t
    array[i * 3 + 2] = b + (_band.b - b) * t
  }
  attribute.needsUpdate = true
  return geometry
}
