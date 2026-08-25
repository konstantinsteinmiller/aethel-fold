import { BufferAttribute, InstancedBufferGeometry, Sphere, Vector3 } from 'three'
import { assertTriBudget } from '../geometry/budget'
import { makeRng } from '../geometry/rng'
import {
  BLADE_HEIGHT_SCALE,
  BLADE_WIDTH_SCALE,
  GRASS_TIER_COUNT,
  PATCH_SIZE,
  TIER_BLADES,
  TIER_DENSITY_EXPONENT,
  TIER_SEGMENTS,
  TIER_TRI_BUDGET
} from './config'

/**
 * ─── One patch of blades, baked once, drawn everywhere ──────────────────────
 *
 * This is the geometry that makes the whole system cheap. A patch is a 4 m × 4 m
 * cluster of blades **baked into a single shared geometry**; the field then
 * instances *the patch*, not the blade. So 3 800 resident patches at 192 blades
 * each — ~730 000 blades — cost 3 800 instances of 48 bytes, and the blade layout
 * is uploaded to the GPU exactly once at boot.
 *
 * Everything that must differ between two patches standing next to each other
 * (yaw, root offset, blade height, colour) is applied **per patch in the vertex
 * shader** from a single hash, so no two patches read as the same stamp even
 * though they share every byte of geometry. See `grassGlsl.ts`.
 *
 * ── The subset property, and why the tiers depend on it ─────────────────────
 *
 * Tier N+1 draws the **first** `TIER_BLADES[N+1]` blades of the same seeded
 * sequence tier N draws. That is not a convenience — it is what makes the
 * dithered crossfade work for grass.
 *
 * A prop's tiers differ in tessellation, so a crossfade blends two silhouettes of
 * one object. Grass tiers differ in *population*, and blending two independently
 * scattered fields would show the dither as a shimmer across the whole sward,
 * because no blade in one tier lines up with any blade in the other. With the
 * subset property, blade *k* is at the identical root, yaw and height in both
 * tiers: the shared blades reconstruct **exactly** under complementary dither
 * (their two half-coverages are the same pixels), and only the blades tier N+1
 * drops actually fade. That is why `GRASS_BANDS` can be 8 % of the switch
 * distance where props need 15 %.
 *
 * ── Blades are clumped, and thinning walks the clumps round-robin ───────────
 *
 * Uniform scatter reads as a bristle brush. Real grass grows in tufts, so blades
 * are assigned to clump centres and given a shared lean.
 *
 * Blade *i* goes to clump `i % clumpCount`, and its distance from the clump
 * centre grows with `floor(i / clumpCount)`. Two things fall out of that ordering
 * for free: a thinned tier still touches **every** clump rather than keeping the
 * first few whole and dropping the rest, and the coarsest tiers — which take
 * fewer blades than there are clumps — land exactly on clump *centres*, which is
 * precisely where a single wide impostor triangle should stand.
 */

/**
 * Nominal blade height in metres, before per-blade and per-patch variation.
 *
 * Shorter and broader than the first pass (0.42 × 0.021), which rendered as a
 * field of wire spikes. The ratio is what matters: at 20:1 a blade reads as a
 * bristle, at 10:1 it reads as a leaf, and the silhouette rule (GDD R1) applies
 * to a blade exactly as it does to a boulder — the width is the only thing here
 * that changes the outline.
 */
const BLADE_HEIGHT = 0.36

/** Half-width at the root, in metres. */
const BLADE_HALF_WIDTH = 0.034

/**
 * How far the tip curls away from vertical, in metres.
 *
 * Roughly half the blade height, which is a lot — and it is the difference
 * between grass and a lawn of needles. A straight blade has no silhouette from
 * above and reads as a line; an arc catches the light along its length and gives
 * the toon ramp something to band across.
 */
const BLADE_CURL = 0.19

/** Blades per clump at full density. */
const BLADES_PER_CLUMP = 9

/** Radius a clump's blades spread over, in metres. */
const CLUMP_RADIUS = 0.38

export interface GrassTierGeometry {
  geometry: InstancedBufferGeometry
  /** Blades actually baked, after the detail level's density multiplier. */
  blades: number
  triangles: number
  /** Triangles per blade — `2·segments − 1`. What `setDrawRange` counts in. */
  trianglesPerBlade: number
}

/**
 * How much of its full blade count a tier keeps at a given detail density.
 *
 * Not `density` itself — `density ** TIER_DENSITY_EXPONENT[tier]`, which thins
 * the near tiers hard and the far ones barely at all. The reasoning is in
 * `config.ts`; the short version is that the near tiers hold 63 % of the
 * triangles and the far tiers go bald if you scale them the same way.
 */
export const tierDensity = (tier: number, density: number): number =>
  Math.max(0.02, density) ** TIER_DENSITY_EXPONENT[tier]!

/**
 * Width compensation for a thinned tier.
 *
 * Halving the blade count without touching the blade halves ground *coverage*,
 * and the result is not "less grass" — it is bald ground with grass standing in
 * it, which reads as broken rather than as a lower setting. Coverage goes as
 * count × width, so widening by `1/√density` holds it roughly constant and the
 * levels differ in the *resolution* of the sward instead of in whether there is
 * one.
 *
 * Per **tier**, because the thinning is per tier — a far tier that kept 85 % of
 * its blades must not be widened as if it had kept 22 %, or the horizon fattens
 * while the near field stays honest.
 *
 * Capped at 1.6 because past that a blade stops reading as a blade and starts
 * reading as a leaf — which is exactly what `minimum` looked like at 1.75.
 *
 * Applied as a **uniform**, not baked into the vertices. That is what lets a
 * detail change be free: see `GrassField.setLevel`.
 */
export const widthCompensation = (tier: number, density: number): number =>
  Math.min(1.6, 1 / Math.sqrt(tierDensity(tier, density)))

/** Blades baked for a tier at a given density. Always ≥ 1 so no tier is empty. */
export const bladesForTier = (tier: number, density: number): number =>
  Math.max(1, Math.round(TIER_BLADES[tier]! * tierDensity(tier, density)))

/**
 * Builds one tier's patch geometry.
 *
 * `seed` is fixed across tiers by the caller, so the blade sequence is identical
 * and the subset property holds.
 */
export const buildGrassTier = (tier: number, density: number, seed = 20260815): GrassTierGeometry => {
  const bladeCount = bladesForTier(tier, density)
  const segments = TIER_SEGMENTS[tier]!
  // Deliberately *not* multiplied by `widthCompensation` — the detail level's
  // width correction is a uniform, so that changing level never touches a vertex
  // buffer. See `GrassField.setLevel`.
  const widthScale = BLADE_WIDTH_SCALE[tier]!
  const heightScale = BLADE_HEIGHT_SCALE[tier]!

  // Clump count is derived from the *full* density blade count, not from this
  // tier's, so every tier of every detail level lands on the same clump centres.
  // Derive it once from tier 0 at full density and hold it constant — otherwise
  // a coarse tier would invent its own tufts and the crossfade would slide the
  // whole sward sideways at the boundary.
  //
  // Rounded to a **complete** grid rather than to the nearest count: a 32-clump
  // target over a 6×6 grid leaves the last four cells empty, which is a bare
  // strip along one edge of every single patch in the world.
  const clumpTarget = Math.max(1, Math.round(TIER_BLADES[0]! / BLADES_PER_CLUMP))
  const clumpCols = Math.max(1, Math.round(Math.sqrt(clumpTarget)))
  const clumpRows = Math.max(1, Math.round(clumpTarget / clumpCols))
  const clumpCount = clumpCols * clumpRows

  const vertsPerBlade = 2 * segments + 1
  const trisPerBlade = 2 * segments - 1
  const vertexCount = bladeCount * vertsPerBlade
  const indexCount = bladeCount * trisPerBlade * 3

  const position = new Float32Array(vertexCount * 3)
  const blade = new Float32Array(vertexCount * 4)
  // (t along the blade, dz/dy of the curve, ordinal in the baked sequence)
  const shape = new Float32Array(vertexCount * 3)
  const index = new Uint16Array(indexCount)

  // ── Clump centres: a jittered grid over the patch ─────────────────────────
  //
  // Jittered rather than Poisson for the same reason `scatter.ts` gives — at
  // this count the visual difference is nil and a grid guarantees minimum
  // spacing for free. Seeded separately from the blades so changing blade count
  // never moves a tuft.
  const clumpRng = makeRng(seed ^ 0x5bf03635)
  const clumpX = new Float32Array(clumpCount)
  const clumpZ = new Float32Array(clumpCount)
  const clumpYaw = new Float32Array(clumpCount)
  for (let c = 0; c < clumpCount; c++) {
    const gx = c % clumpCols
    const gz = Math.floor(c / clumpCols)
    const cellW = PATCH_SIZE / clumpCols
    const cellD = PATCH_SIZE / clumpRows
    clumpX[c] = (gx + 0.5) * cellW + clumpRng.spread(cellW * 0.42)
    clumpZ[c] = (gz + 0.5) * cellD + clumpRng.spread(cellD * 0.42)
    clumpYaw[c] = clumpRng.range(0, Math.PI * 2)
  }

  // Blades. One walking RNG, consumed in a fixed order — a coarse tier stops
  // early and therefore gets a prefix of the same sequence.
  const rng = makeRng(seed)
  let vertexCursor = 0
  let indexCursor = 0

  for (let i = 0; i < bladeCount; i++) {
    const clump = i % clumpCount
    const ring = Math.floor(i / clumpCount)

    // Ring 0 sits on the clump centre, later rings spread outward. This is what
    // puts the impostor tiers on tuft centres — see the class notes.
    const spread = ring === 0 ? 0 : Math.min(1, ring / 4) * CLUMP_RADIUS
    const angle = rng.range(0, Math.PI * 2)
    const rootX = clumpX[clump]! + Math.cos(angle) * spread * rng.range(0.4, 1)
    const rootZ = clumpZ[clump]! + Math.sin(angle) * spread * rng.range(0.4, 1)

    // Blades in one tuft lean together — that shared lean is most of what makes
    // a clump read as a clump rather than as blades that happen to be close.
    const yaw = clumpYaw[clump]! + rng.spread(0.55)
    const hash = rng()

    const height = BLADE_HEIGHT * heightScale * rng.range(0.74, 1.28)
    const halfWidth = BLADE_HALF_WIDTH * widthScale * rng.range(0.82, 1.2)
    const curl = BLADE_CURL * rng.range(0.35, 1.35) * heightScale

    const base = vertexCursor

    for (let s = 0; s <= segments; s++) {
      const t = s / segments
      // Width tapers to nothing at the tip. The exponent keeps the blade broad
      // through its lower half and pinches only near the top — a linear taper
      // gives a triangle, which reads as a spike rather than as a leaf.
      const half = halfWidth * (1 - t) ** 0.62
      const y = height * t
      const z = curl * t * t
      // dz/dy of the curve above, which is all the blade-local normal needs:
      // the surface tangents are (1,0,0) across the width and (0,1,dz/dy) along
      // the length, so the normal is normalize(0, -dz/dy, 1). Four bytes instead
      // of a twelve-byte normal attribute, and it is exact rather than smoothed.
      const bendSlope = height > 0 ? (2 * curl * t) / height : 0

      if (s === segments) {
        // Tip: one vertex, so the last quad collapses into a triangle.
        // `position` is **blade-local** (x across the width, y up, z along the
        // curl) with the root at the origin — the shader rotates it by the
        // blade's yaw and only then adds the root from `aBlade.xy`. Baking the
        // root into `position` would mean un-adding it before every rotation.
        position[vertexCursor * 3] = 0
        position[vertexCursor * 3 + 1] = y
        position[vertexCursor * 3 + 2] = z
        blade[vertexCursor * 4] = rootX
        blade[vertexCursor * 4 + 1] = rootZ
        blade[vertexCursor * 4 + 2] = hash
        blade[vertexCursor * 4 + 3] = yaw
        shape[vertexCursor * 3] = t
        shape[vertexCursor * 3 + 1] = bendSlope
        // The blade's ordinal, which is what the density ramp thresholds
        // against — see the notes on `liveBladesAt` in `config.ts`.
        shape[vertexCursor * 3 + 2] = i
        vertexCursor++
        continue
      }

      for (let side = 0; side < 2; side++) {
        const x = (side === 0 ? -1 : 1) * half
        position[vertexCursor * 3] = x
        position[vertexCursor * 3 + 1] = y
        position[vertexCursor * 3 + 2] = z
        blade[vertexCursor * 4] = rootX
        blade[vertexCursor * 4 + 1] = rootZ
        blade[vertexCursor * 4 + 2] = hash
        blade[vertexCursor * 4 + 3] = yaw
        shape[vertexCursor * 3] = t
        shape[vertexCursor * 3 + 1] = bendSlope
        shape[vertexCursor * 3 + 2] = i
        vertexCursor++
      }
    }

    // Quads for every segment but the last, then the tip triangle.
    for (let s = 0; s < segments - 1; s++) {
      const a = base + s * 2
      index[indexCursor++] = a
      index[indexCursor++] = a + 1
      index[indexCursor++] = a + 3
      index[indexCursor++] = a
      index[indexCursor++] = a + 3
      index[indexCursor++] = a + 2
    }
    const last = base + (segments - 1) * 2
    index[indexCursor++] = last
    index[indexCursor++] = last + 1
    index[indexCursor++] = last + 2
  }

  const geometry = new InstancedBufferGeometry()
  geometry.name = `grass/LOD${tier}`
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('aBlade', new BufferAttribute(blade, 4))
  geometry.setAttribute('aShape', new BufferAttribute(shape, 3))
  geometry.setIndex(new BufferAttribute(index, 1))

  // Set by hand rather than computed: the vertices above are patch-local, while
  // the drawn positions come from the instance stream, so a computed sphere
  // would describe a patch sitting at the world origin. Nothing culls against it
  // (the meshes set `frustumCulled = false` and never cast a shadow), but three
  // will compute one lazily if it is null, and a wrong one that *looks* computed
  // is worse than an honest placeholder.
  const reach = Math.SQRT2 * PATCH_SIZE
  geometry.boundingSphere = new Sphere(new Vector3(PATCH_SIZE / 2, BLADE_HEIGHT, PATCH_SIZE / 2), reach)

  // Non-finite floats are checked before the budget assertion, per
  // AAA-graphics §3: a NaN tier has a perfectly valid triangle count, and every
  // comparison against NaN is false, so the obvious guards all pass silently.
  for (const array of [position, blade, shape]) {
    for (let i = 0; i < array.length; i++) {
      if (!Number.isFinite(array[i]!)) {
        throw new Error(`[world] grass LOD${tier}: non-finite vertex data at ${i}`)
      }
    }
  }

  assertTriBudget(geometry, TIER_TRI_BUDGET[tier]!, `grass/LOD${tier}`)

  return { geometry, blades: bladeCount, triangles: bladeCount * trisPerBlade, trianglesPerBlade: trisPerBlade }
}

/** All six tiers at one detail level. */
export const buildGrassTiers = (density: number, seed?: number): GrassTierGeometry[] => {
  const tiers: GrassTierGeometry[] = []
  for (let tier = 0; tier < GRASS_TIER_COUNT; tier++) {
    tiers.push(buildGrassTier(tier, density, seed))
  }
  return tiers
}

export { BLADE_HEIGHT, BLADE_HALF_WIDTH }
