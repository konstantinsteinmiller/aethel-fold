import { describe, expect, it } from 'vitest'
import { bladesForTier, buildGrassTier, tierDensity, widthCompensation } from '@/world/grass/bladeGeometry'
import {
  GRASS_DETAIL_SETTINGS,
  GRASS_DISTANCES,
  FADE_FRACTION,
  GRASS_LEVELS,
  GRASS_TIER_COUNT,
  grassCullDistance,
  grassLevelIndex,
  grassTierAt,
  liveBladesAt,
  PATCH_SIZE,
  TIER_BLADES,
  TIER_DENSITY_EXPONENT,
  TIER_TRI_BUDGET,
  tierHasWind,
  tierRamp,
  tierStart,
  WIND_FADE_END
} from '@/world/grass/config'
import {
  buildChunkPatches,
  createPatchBuffer,
  maxPatchesPerChunk,
  setGrassPalette
} from '@/world/grass/grassPlacement'
import { DEFAULT_HEIGHTFIELD_PARAMS, type HeightfieldParams } from '@/world/terrain/heightfieldCore'

/**
 * Six flat greens standing in for the terrain palette. The real one is built
 * from `THREE.Color` in `World`, which this module deliberately cannot import —
 * `grassPlacement.ts` is three.js-free so it can move onto a worker.
 */
const palette = new Float32Array([
  0.35, 0.5, 0.14, 0.19, 0.28, 0.08, 0.06, 0.11, 0.05, 0.38, 0.4, 0.14, 0.28, 0.14, 0.06, 0.58, 0.45, 0.26
])
setGrassPalette(palette)

const params: HeightfieldParams = { ...DEFAULT_HEIGHTFIELD_PARAMS }

describe('grass tier geometry', () => {
  it('bakes finite data inside every tier budget', () => {
    for (let tier = 0; tier < GRASS_TIER_COUNT; tier++) {
      const built = buildGrassTier(tier, 1)
      const position = built.geometry.getAttribute('position').array as Float32Array
      const blade = built.geometry.getAttribute('aBlade').array as Float32Array
      const shape = built.geometry.getAttribute('aShape').array as Float32Array
      // AAA-graphics §3: a NaN tier has a perfectly valid triangle count and
      // every comparison against NaN is false, so the budget assert alone would
      // pass one straight through.
      for (const array of [position, blade, shape]) {
        expect(array.every(value => Number.isFinite(value))).toBe(true)
      }
      expect(built.triangles).toBeLessThanOrEqual(TIER_TRI_BUDGET[tier]!)
      expect(built.blades).toBe(TIER_BLADES[tier])
    }
  })

  /**
   * The subset property is the load-bearing invariant of the whole LOD scheme:
   * it is what makes "the first N blades" mean the same thing in two different
   * tiers, and therefore what lets the density ramp be continuous across a tier
   * boundary without any crossfade. Break it and grass still renders — it just
   * jumps at every boundary, which is the exact failure R7 exists to prevent.
   */
  it('bakes a strict prefix of tier 0 into every coarser tier', () => {
    const fine = buildGrassTier(0, 1)
    const fineBlade = fine.geometry.getAttribute('aBlade').array as Float32Array
    const fineShape = fine.geometry.getAttribute('aShape').array as Float32Array
    const rootOf = (arr: Float32Array, shape: Float32Array, ordinal: number): number[] | null => {
      for (let v = 0; v < shape.length / 3; v++) {
        if (shape[v * 3 + 2] === ordinal) {
          return [arr[v * 4]!, arr[v * 4 + 1]!, arr[v * 4 + 2]!, arr[v * 4 + 3]!]
        }
      }
      return null
    }

    for (let tier = 1; tier < GRASS_TIER_COUNT; tier++) {
      const coarse = buildGrassTier(tier, 1)
      const coarseBlade = coarse.geometry.getAttribute('aBlade').array as Float32Array
      const coarseShape = coarse.geometry.getAttribute('aShape').array as Float32Array
      expect(coarse.blades).toBeLessThan(fine.blades)
      for (let ordinal = 0; ordinal < coarse.blades; ordinal++) {
        expect(rootOf(coarseBlade, coarseShape, ordinal)).toEqual(rootOf(fineBlade, fineShape, ordinal))
      }
    }
  })

  it('spreads roots across the whole patch', () => {
    const built = buildGrassTier(0, 1)
    const blade = built.geometry.getAttribute('aBlade').array as Float32Array
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (let v = 0; v < blade.length / 4; v++) {
      minX = Math.min(minX, blade[v * 4]!)
      maxX = Math.max(maxX, blade[v * 4]!)
      minZ = Math.min(minZ, blade[v * 4 + 1]!)
      maxZ = Math.max(maxZ, blade[v * 4 + 1]!)
    }
    // A clump grid that leaves its last row empty puts a bare strip along one
    // edge of every patch in the world — which is what happened when the count
    // was rounded to a number rather than to a complete grid.
    expect(maxX - minX).toBeGreaterThan(PATCH_SIZE * 0.8)
    expect(maxZ - minZ).toBeGreaterThan(PATCH_SIZE * 0.8)
  })

  /**
   * `GrassField.setLevel` implements a detail level's density purely with
   * `setDrawRange(0, blades × trianglesPerBlade × 3)`, which is only correct if
   * the index buffer lists blades in ordinal order with no interleaving. Break
   * that and a lowered detail level would drop *arbitrary* blades — including
   * the ones a coarser tier still expects to be there, which is exactly the
   * invariant the continuous density ramp rests on.
   */
  it('lays the index buffer out blade by blade, so a draw range is a blade count', () => {
    for (let tier = 0; tier < GRASS_TIER_COUNT; tier++) {
      const built = buildGrassTier(tier, 1)
      const index = built.geometry.getIndex()!.array as ArrayLike<number>
      const shape = built.geometry.getAttribute('aShape').array as Float32Array
      const perBlade = built.trianglesPerBlade * 3
      expect(index.length).toBe(built.blades * perBlade)
      for (let blade = 0; blade < built.blades; blade++) {
        for (let k = 0; k < perBlade; k++) {
          const vertex = index[blade * perBlade + k]!
          expect(shape[vertex * 3 + 2]).toBe(blade)
        }
      }
    }
  })

  it('bakes the same geometry whatever the density, so a level change is free', () => {
    // Density no longer reaches the vertex buffer at all — the field bakes at 1
    // and narrows with a draw range, and the width correction is a uniform.
    const full = buildGrassTier(0, 1)
    const thin = buildGrassTier(0, 0.5)
    const fullPos = full.geometry.getAttribute('position').array as Float32Array
    const thinPos = thin.geometry.getAttribute('position').array as Float32Array
    expect(thinPos.length).toBeLessThan(fullPos.length)
    // The prefix must be bit-identical: same blades, same widths, same curl.
    expect(Array.from(fullPos.slice(0, thinPos.length))).toEqual(Array.from(thinPos))
  })

  it('widens blades as density falls, so coverage holds', () => {
    expect(widthCompensation(0, 1)).toBe(1)
    expect(widthCompensation(0, 0.45)).toBeGreaterThan(1.3)
    // Capped: past this a blade stops reading as a blade and starts reading as
    // a leaf, which is what `minimum` looked like at 1.75.
    expect(widthCompensation(0, 0.02)).toBeLessThanOrEqual(1.6)
    // Coverage ≈ count × width. Halving density must not halve the sward.
    const full = bladesForTier(0, 1) * widthCompensation(0, 1)
    const half = bladesForTier(0, 0.5) * widthCompensation(0, 0.5)
    expect(half / full).toBeGreaterThan(0.65)
  })

  /**
   * Compensation is per tier because the *thinning* is per tier. A far tier that
   * kept 85 % of its blades must not be widened as if it had kept 22 %, or the
   * horizon fattens while the near field stays honest.
   */
  it('compensates each tier by its own thinning, not the level average', () => {
    const density = 0.22
    expect(widthCompensation(5, density)).toBeLessThan(widthCompensation(0, density))
    expect(widthCompensation(0, 1)).toBe(widthCompensation(5, 1))
  })
})

describe('grass LOD ramp', () => {
  const baked = TIER_BLADES.map(n => n)

  it('assigns a single tier per distance and culls past the last', () => {
    expect(grassTierAt(0, 1)).toBe(0)
    expect(grassTierAt(GRASS_DISTANCES[0]! - 0.01, 1)).toBe(0)
    expect(grassTierAt(GRASS_DISTANCES[0]! + 0.01, 1)).toBe(1)
    expect(grassTierAt(grassCullDistance(1) + 1, 1)).toBe(-1)
  })

  /**
   * The reason grass needs no dithered crossfade. Both sides of a boundary must
   * ask for the *same* number of blades, or the population steps and the tier
   * swap becomes exactly the pop GDD R7 forbids.
   */
  it('is continuous in blade count across every tier boundary', () => {
    for (let tier = 0; tier < GRASS_TIER_COUNT - 1; tier++) {
      const boundary = GRASS_DISTANCES[tier]!
      const outgoing = liveBladesAt(tier, boundary, 1, baked)
      const incoming = liveBladesAt(tier + 1, boundary, 1, baked)
      expect(Math.abs(outgoing - incoming)).toBeLessThan(1e-6)
    }
  })

  /**
   * The regression this pins is the one a reader will not see in the code: the
   * fade window is measured in *blades*, but what the eye judges is how much
   * **camera travel** a blade takes to grow. Divide one by the other and the
   * first implementation — a fixed 2.5-blade window — came out at **4.6 cm, or
   * twelve milliseconds at walking pace**, which is under one frame. Every blade
   * popped, fifty-four of them per metre walked, and it got three times worse
   * when the near-field density was tripled.
   *
   * A window proportional to `live` holds the duration roughly constant instead,
   * because the same `live` is what sets the slope.
   */
  it('takes at least half a metre of camera travel to grow a blade, at every distance', () => {
    const fadeMetres = (distance: number): number => {
      const tier = grassTierAt(distance, 1)
      const live = liveBladesAt(tier, distance, 1, baked)
      const window = Math.max(1, live * FADE_FRACTION)
      // Blades per metre shed at this distance, from the ramp's own slope.
      const step = 0.05
      const slope = Math.abs(liveBladesAt(tier, distance + step, 1, baked) - live) / step
      return slope > 1e-6 ? window / slope : Infinity
    }

    for (let d = 0.5; d < grassCullDistance(1) - 1; d += 0.5) {
      const metres = fadeMetres(d)
      expect(metres).toBeGreaterThan(0.5)
      // And not so slow that half the meadow is permanently half-height.
      expect(metres).toBeLessThan(8)
    }
  })

  /**
   * The window has to be continuous across a tier boundary for the same reason
   * `live` does. A per-tier window derived from that tier's slope is not: at
   * LOD1→LOD2 the slope jumps ~4×, which would swap ~39 blades of 240 between
   * "fading" and "full" in a single step — trading the near-field pop for a
   * smaller one at 18 m.
   */
  it('keeps the fade window continuous across every tier boundary', () => {
    for (let tier = 0; tier < GRASS_TIER_COUNT - 1; tier++) {
      const boundary = GRASS_DISTANCES[tier]!
      const before = liveBladesAt(tier, boundary, 1, baked) * FADE_FRACTION
      const after = liveBladesAt(tier + 1, boundary, 1, baked) * FADE_FRACTION
      expect(Math.abs(before - after)).toBeLessThan(1e-6)
    }
  })

  /**
   * The ramp is evaluated per blade in the shader, from `tierRamp`'s four
   * numbers. If those disagree with the CPU reference the meadow thins at the
   * wrong radius, which is invisible in a still frame and obvious in motion.
   */
  it('hands the shader a ramp that matches the reference implementation', () => {
    for (let tier = 0; tier < GRASS_TIER_COUNT; tier++) {
      const [start, end, here, far] = tierRamp(tier, 1, baked) as [number, number, number, number]
      expect(start).toBe(tierStart(tier, 1))
      expect(end).toBe(GRASS_DISTANCES[tier]!)
      expect(liveBladesAt(tier, start, 1, baked)).toBeCloseTo(here)
      expect(liveBladesAt(tier, end, 1, baked)).toBeCloseTo(far)
      // Monotonic: a tier must never gain blades as it recedes.
      expect(far).toBeLessThanOrEqual(here)
    }
  })

  it('never increases blade count with distance', () => {
    let previous = Infinity
    for (let d = 0; d < grassCullDistance(1); d += 0.5) {
      const tier = grassTierAt(d, 1)
      expect(tier).toBeGreaterThanOrEqual(0)
      const live = liveBladesAt(tier, d, 1, baked)
      expect(live).toBeLessThanOrEqual(previous + 1e-6)
      previous = live
    }
  })

  /**
   * Distant grass does not sway — that is an art decision (sub-pixel motion reads
   * as sparkle, not as wind) that also skips two `sin` calls on 75 % of drawn
   * patches. The failure mode if `tierHasWind` and the fade range disagree is a
   * band of visibly frozen grass at a fixed radius, so the two are pinned
   * together rather than hard-coded apart.
   */
  it('switches wind off only for tiers that are entirely past the fade', () => {
    for (let tier = 0; tier < GRASS_TIER_COUNT; tier++) {
      const start = tierStart(tier, 1)
      expect(tierHasWind(tier)).toBe(start < WIND_FADE_END)
    }
    // The near tiers must sway and the far ones must not, or one of the two
    // halves of this feature is missing.
    expect(tierHasWind(0)).toBe(true)
    expect(tierHasWind(GRASS_TIER_COUNT - 1)).toBe(false)
    // The fade has to finish before the first windless tier begins, or there is
    // a stretch of grass whose wind is switched off mid-sway.
    const firstStill = [0, 1, 2, 3, 4, 5].find(tier => !tierHasWind(tier))!
    expect(tierStart(firstStill, 1)).toBeGreaterThanOrEqual(WIND_FADE_END)
  })

  it('scales the whole table with the range multiplier', () => {
    expect(grassTierAt(GRASS_DISTANCES[0]! * 0.5, 0.4)).toBe(1)
    expect(tierStart(2, 0.5)).toBeCloseTo(GRASS_DISTANCES[1]! * 0.5)
    expect(grassCullDistance(0.4)).toBeCloseTo(GRASS_DISTANCES[5]! * 0.4)
  })
})

describe('grass detail levels', () => {
  it('exposes exactly five detail levels plus auto and off', () => {
    expect(GRASS_LEVELS).toHaveLength(5)
    expect(GRASS_DETAIL_SETTINGS).toHaveLength(7)
    for (const level of GRASS_LEVELS) {
      expect(GRASS_DETAIL_SETTINGS).toContain(level.name)
    }
    expect(GRASS_DETAIL_SETTINGS).toContain('auto')
    expect(GRASS_DETAIL_SETTINGS).toContain('off')
  })

  it('orders the ladder worst-first and monotonically', () => {
    for (let i = 1; i < GRASS_LEVELS.length; i++) {
      expect(GRASS_LEVELS[i]!.density).toBeGreaterThan(GRASS_LEVELS[i - 1]!.density)
      expect(GRASS_LEVELS[i]!.range).toBeGreaterThan(GRASS_LEVELS[i - 1]!.range)
    }
    expect(GRASS_LEVELS[GRASS_LEVELS.length - 1]!.density).toBe(1)
    expect(GRASS_LEVELS[GRASS_LEVELS.length - 1]!.range).toBe(1)
  })

  /**
   * Every level below `ultra` gives up reach — GDD §11c's rule that a struggling
   * machine loses the horizon first. `range` is the only knob that does that;
   * `density` is about blades per patch and is handled by the two tests below.
   */
  it('gives up reach at every step down the ladder', () => {
    for (const level of GRASS_LEVELS) {
      expect(level.range).toBeLessThanOrEqual(1)
      expect(level.range).toBeGreaterThan(0.3)
    }
    expect(GRASS_LEVELS[GRASS_LEVELS.length - 1]!.range).toBe(1)
  })

  /**
   * Density is spent on the **near** tiers, not spread evenly — they hold ~63 %
   * of the triangles, and a flat multiplier would take most of its saving from
   * tiers that were nearly free while leaving the horizon bald.
   */
  it('thins the near tiers harder than the far ones', () => {
    for (let tier = 1; tier < GRASS_TIER_COUNT; tier++) {
      expect(TIER_DENSITY_EXPONENT[tier]!).toBeLessThanOrEqual(TIER_DENSITY_EXPONENT[tier - 1]!)
    }
    // At the bottom of the ladder the far tier must keep a clearly larger share
    // of its blades than the near one.
    const bottom = GRASS_LEVELS[0]!.density
    expect(tierDensity(5, bottom)).toBeGreaterThan(tierDensity(0, bottom) * 1.5)
    // …and at the top nothing is thinned at all.
    for (let tier = 0; tier < GRASS_TIER_COUNT; tier++) {
      expect(tierDensity(tier, 1)).toBe(1)
    }
  })

  /**
   * Two floors, because the ladder is only useful if its bottom rung still reads
   * as grass: the near field must stay a meadow you can stand in, and the far
   * field must not thin to nothing and leave a visibly bald horizon.
   */
  it('keeps a meadow underfoot and cover at the horizon on every level', () => {
    for (const level of GRASS_LEVELS) {
      const nearPerSquareMetre = bladesForTier(0, level.density) / (PATCH_SIZE * PATCH_SIZE)
      expect(nearPerSquareMetre).toBeGreaterThanOrEqual(12)
      expect(bladesForTier(GRASS_TIER_COUNT - 1, level.density)).toBeGreaterThanOrEqual(8)
    }
    // And the top of the ladder is genuinely lush — this is the whole point of
    // front-loading `TIER_BLADES`.
    expect(bladesForTier(0, 1) / (PATCH_SIZE * PATCH_SIZE)).toBeGreaterThanOrEqual(50)
  })

  it('resolves level names, and falls back to the top rather than to -1', () => {
    expect(grassLevelIndex('minimum')).toBe(0)
    expect(grassLevelIndex('ultra')).toBe(GRASS_LEVELS.length - 1)
    expect(grassLevelIndex('nonsense')).toBe(GRASS_LEVELS.length - 1)
  })

  it('draws fewer triangles per patch at every step down the ladder', () => {
    let previous = 0
    for (const level of GRASS_LEVELS) {
      let triangles = 0
      for (let tier = 0; tier < GRASS_TIER_COUNT; tier++) {
        // What the field actually draws: the tier is baked once at full density
        // and narrowed with a draw range.
        const built = buildGrassTier(tier, 1)
        triangles += bladesForTier(tier, level.density) * built.trianglesPerBlade
      }
      expect(triangles).toBeGreaterThan(previous)
      previous = triangles
    }
  })
})

describe('grass placement', () => {
  const chunkSize = 48
  const buffer = createPatchBuffer(maxPatchesPerChunk(chunkSize))

  it('is a pure function of chunk coordinates', () => {
    const first = buildChunkPatches(params, 96, -48, chunkSize, createPatchBuffer(maxPatchesPerChunk(chunkSize)))
    const firstOrigin = first.origin.slice(0, first.count * 2)
    const firstParams = first.params.slice(0, first.count * 2)
    const firstTint = first.tint.slice(0, first.count * 3)

    // A different chunk in between, to prove no walking state leaks across.
    buildChunkPatches(params, 0, 0, chunkSize, buffer)
    const again = buildChunkPatches(params, 96, -48, chunkSize, buffer)

    expect(again.count).toBe(first.count)
    expect(again.origin.slice(0, again.count * 2)).toEqual(firstOrigin)
    expect(again.params.slice(0, again.count * 2)).toEqual(firstParams)
    expect(again.tint.slice(0, again.count * 3)).toEqual(firstTint)
  })

  it('produces only finite data', () => {
    const out = buildChunkPatches(params, -144, 96, chunkSize, buffer)
    expect(out.count).toBeGreaterThan(0)
    for (const array of [
      out.origin.slice(0, out.count * 2),
      out.corners.slice(0, out.count * 4),
      out.tint.slice(0, out.count * 3),
      out.params.slice(0, out.count * 2)
    ]) {
      expect(array.every(value => Number.isFinite(value))).toBe(true)
    }
    expect(Number.isFinite(out.topY)).toBe(true)
    expect(Number.isFinite(out.lowY)).toBe(true)
  })

  it('keeps every patch inside its chunk and its density in (0,1]', () => {
    const out = buildChunkPatches(params, 48, 48, chunkSize, buffer)
    for (let i = 0; i < out.count; i++) {
      expect(out.origin[i * 2]!).toBeGreaterThanOrEqual(48)
      expect(out.origin[i * 2]!).toBeLessThan(48 + chunkSize)
      expect(out.origin[i * 2 + 1]!).toBeGreaterThanOrEqual(48)
      expect(out.origin[i * 2 + 1]!).toBeLessThan(48 + chunkSize)
      expect(out.params[i * 2]!).toBeGreaterThanOrEqual(0)
      expect(out.params[i * 2]!).toBeLessThanOrEqual(1)
      expect(out.params[i * 2 + 1]!).toBeGreaterThan(0)
      expect(out.params[i * 2 + 1]!).toBeLessThanOrEqual(1)
    }
  })

  /**
   * Suitability is a weight, not a test — a hard reject draws a contour line
   * across a hillside that nothing else in the scene follows. What proves the
   * weight is doing its job is that some patches survive at *partial* density
   * rather than every survivor sitting at 1.
   */
  it('thins patches at the edges instead of cutting them', () => {
    let partial = 0
    let total = 0
    for (let cx = -2; cx <= 2; cx++) {
      for (let cz = -2; cz <= 2; cz++) {
        const out = buildChunkPatches(params, cx * chunkSize, cz * chunkSize, chunkSize, buffer)
        for (let i = 0; i < out.count; i++) {
          total++
          if (out.params[i * 2 + 1]! < 0.85) {
            partial++
          }
        }
      }
    }
    expect(total).toBeGreaterThan(200)
    expect(partial / total).toBeGreaterThan(0.15)
  })

  it('refuses steep ground', () => {
    // A near-vertical field: grass must find nothing to grow on.
    const cliff: HeightfieldParams = { ...params, amplitude: 900, featureSize: 22 }
    const out = buildChunkPatches(cliff, 0, 0, chunkSize, buffer)
    expect(out.count).toBe(0)
  })

  it('sizes the scratch buffer for the worst case', () => {
    expect(maxPatchesPerChunk(48)).toBe((48 / PATCH_SIZE) ** 2)
    const out = buildChunkPatches(params, 0, 0, chunkSize, buffer)
    expect(out.count).toBeLessThanOrEqual(maxPatchesPerChunk(chunkSize))
  })
})
