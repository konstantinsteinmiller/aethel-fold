import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  UnsignedByteType
} from 'three'
import { makeRng, type Rng } from '../geometry/rng'

/**
 * ─── The water atlas ────────────────────────────────────────────────────────
 *
 * One 256² RGBA8 tile, generated at boot, that carries every high-frequency
 * animated signal the water shader needs. GDD §5.2 was amended to allow exactly
 * this and nothing more: it is generated, not downloaded, in the same category
 * as the gradient ramp (`shading/ramp.ts`, which is the precedent this file
 * follows for filtering, colour space, lazy singleton and disposal).
 *
 * It exists because the alternative was costed and rejected: layered cellular
 * noise evaluated per fragment is ~18 samples over a surface that routinely
 * covers half the screen. One tap of this replaces all of them.
 *
 * ══ CHANNEL CONTRACT ════════════════════════════════════════════════════════
 *
 * All four channels are UNORM [0,1] after sampling. All four are normalised
 * across the tile, so each one actually reaches both 0 and 1 — none of them is
 * a squashed mid-grey that needs a `*4.0` in the shader to become visible.
 *
 * ┌───┬─────────────────────────────────────────────────────────────────────┐
 * │ R │ **Worley F1** — distance to the nearest feature point, 10 cells per  │
 * │   │ tile. 0 at a cell *centre*, 1 at the furthest cell corner.           │
 * │   │ Cell *bodies*. Use `1.0 - r` for bright blobs; `waterBand(1.0-r, 3)` │
 * │   │ for the reference's stepped cellular river surface.                  │
 * ├───┼─────────────────────────────────────────────────────────────────────┤
 * │ G │ **Worley F2−F1**, sqrt-lifted — distance to the nearest cell         │
 * │   │ *boundary* of the SAME 10 cells. 0 exactly on a boundary, 1 deep     │
 * │   │ inside a cell. Cell *edges*: the caustic net and the river's short   │
 * │   │ white streaks. Bright net = `1.0 - smoothstep(0.0, w, g)`. Measured  │
 * │   │ coverage of that mask on the shipped tile: w = 0.3 → 6.2 % of the    │
 * │   │ surface, w = 0.45 → 13.5 %, w = 0.6 → 22.8 %, w = 0.7 → 29.7 %.      │
 * ├───┼─────────────────────────────────────────────────────────────────────┤
 * │ B │ **Soft blotch fBm** — 3 octaves, base 3×4 lattice cells per tile.    │
 * │   │ Big organic patches, S-curved for contrast. The waterfall's white    │
 * │   │ blotches; also a slow breakup mask for the sea so the swell is not   │
 * │   │ uniform. Measured mean 146/255, sd 68.                               │
 * ├───┼─────────────────────────────────────────────────────────────────────┤
 * │ A │ **Fine ripple** — 2 octaves, base 17×19 lattice cells per tile.      │
 * │   │ Micro-detail and the *source* for sun glitter. Deliberately NOT      │
 * │   │ pre-thresholded: threshold it yourself (`smoothstep(0.72, 0.95, a)`).│
 * │   │ A sparkle mask baked in here would be ~90 % zero, which mip-averages │
 * │   │ to a flat grey two tiers down and throws the glitter away at exactly │
 * │   │ the distance the sun path is most visible.                           │
 * └───┴─────────────────────────────────────────────────────────────────────┘
 *
 * ── Why G is the cell *edge* and not a second cellular octave ───────────────
 *
 * The brief suggested G be a second cellular field at another scale, so the
 * shader could cross-fade two layers scrolling against each other. Two layers
 * at different *speeds* cannot come from two channels of one tap, though — one
 * tap has one UV and therefore one velocity. Anti-tiling motion has to come
 * from two *taps* (see `WATER_ATLAS_SECOND_TAP` below), and a second tap
 * already gives a second scale for free. A channel spent on it would buy
 * nothing the shader does not already have.
 *
 * So G spends itself on the one thing F1 cannot produce at any scale: the
 * cell-boundary net. F1 alone gives smooth blobs; the reference's caustics and
 * river streaks are thin bright *veins between* cells, which is F2−F1. Taking
 * both from the same point set is also what makes them composable — R is the
 * body and G is the rim of the *same* cell, so one tap draws a complete
 * stylised water cell. Two unrelated fields could never line up that way.
 *
 * A consumer that reads G as "some other cellular layer" still gets a
 * cell-structured [0,1] field and still gets water, so the two files can be
 * written in parallel without a hard dependency on this paragraph.
 *
 * ── Suggested world scale ───────────────────────────────────────────────────
 *
 * `vWaterSurface` is world metres in the surface frame, so the shader's UV is
 * `vWaterSurface / metresPerTile`. See `WATER_ATLAS_TILE_METRES`.
 *
 * ── Why 256² and not 512² ───────────────────────────────────────────────────
 *
 * The finest signal in the atlas is A's 31-cell octave: 256/31 ≈ 8 texels per
 * lattice cell, which quintic-faded value noise resolves smoothly with room to
 * spare. R's cells are 25.6 texels across. At the suggested 6 m sea tile a
 * texel is 2.3 cm — below what a mid-range Android panel resolves at any
 * distance the player stands from water. 512² would take the memory to 1.33 MB
 * with mips to store detail the first mip tier discards.
 *
 * 128² was generated and measured and is the wrong end. The caustic net is the
 * limiting channel: the `w = 0.45` vein mask has the same 13 % coverage at both
 * sizes, but its mean run drops from 11.4 texels to 5.6 — so at 128² the first
 * mip already has it at ~2.8 and the net washes out at the middle distance,
 * which is exactly where the reference shows it most.
 *
 * Build time did **not** turn out to be a reason to go smaller: measured in a
 * cold browser tab, 192² came in at 33–42 ms against 256²'s 29–35 ms. The first
 * call is dominated by V8 tier-up, not by the texel count, so shrinking the
 * tile pays for itself in quality and buys nothing back.
 *
 * Memory: 256² × RGBA8 = 256 KB, + 1/3 for the mip chain ≈ 341 KB.
 *
 * ── Cost, measured ──────────────────────────────────────────────────────────
 *
 * Chrome 256², `performance.now()` around `buildWaterAtlas()`:
 *
 *   steady state (median of 8 back-to-back builds)   9–14 ms
 *   first call, after ~220 k terrain-noise samples   24–27 ms
 *   first call, first JS the page ever runs          29–35 ms
 *
 * The gap between the three is V8 tier-up, not work: the same build is 9–14 ms
 * once the loops are optimised. The middle row is the one that describes boot —
 * water materials are built after terrain generation has already run — and it
 * is the number to hold against a budget. The machine was under concurrent load
 * throughout and individual samples ranged higher; these are the medians.
 */

export const WATER_ATLAS_SIZE = 256

/**
 * Feature-point grid behind R and G, cells per tile. Both channels describe
 * the *same* cells — R their bodies, G their edges — so there is one number.
 */
export const WATER_ATLAS_CELLS = 10

/**
 * Suggested metres of world surface per atlas tile, keyed by `WaterStyle.id`.
 *
 * Derived from the cell count above: at `sea` (6 m) a cell is 0.6 m across,
 * which is the scale caustics run at on a shallow sandy bottom. `river` is
 * tighter because a 3 m channel needs several cells across it or the churn
 * reads as one blob sliding along. `fall` is set by B instead — 3 octaves over
 * a 3 m tile puts the big blotches at about 1 m, matching the reference
 * curtains.
 *
 * These are suggestions for the shader/material layer, not a hard contract.
 */
export const WATER_ATLAS_TILE_METRES: Record<string, number> = {
  pond: 4,
  sea: 6,
  river: 2.5,
  fall: 3
}

/**
 * The second tap, for breaking the repeat.
 *
 * A 6 m tile repeats ~57 times across a 340 m bay. Seamlessness stops the
 * *seam* being visible; it does not stop the *pattern* being visible. The fix
 * is a second tap of the same texture at a different scale and a different
 * scroll velocity, combined multiplicatively or by min().
 *
 * `SCALE` is deliberately irrational-ish rather than 2.0: at exactly 2× the two
 * taps share a common period equal to the larger tile and the repeat comes
 * straight back. `SPEED` is the second tap's velocity multiplier — moving the
 * two layers at different speeds is what stops the combination itself looping.
 */
export const WATER_ATLAS_SECOND_TAP = {
  SCALE: 1.73,
  SPEED: 0.61
} as const

export interface WaterAtlas {
  texture: DataTexture
  size: number
}

// ── Periodic noise primitives ──────────────────────────────────────────────
//
// `rng.ts`'s `valueNoise2D`/`fbm2D` are used everywhere else in the world and
// are the right tool there, but they cannot be used here: they hash `floor(x)`
// directly, so the field has no period at all and no amount of wrapping the
// *input* makes it tile. A tiling atlas needs the lattice itself to wrap.
//
// So the lattice is a small table filled from `makeRng` — the same RNG, the
// same quintic fade, no new hash function — indexed modulo its own period.
// That is exact toroidal wrapping rather than a mirror or an edge cross-fade,
// both of which stay visible: a mirror puts a bilateral axis of symmetry down
// the tile, and a cross-fade puts a band of half-contrast mush at the seam.

/** Quintic smoothstep — C² continuous, so a derived slope never creases. */
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)

/** `[min, span]` of a generated field, for the stretch before quantisation. */
type Extent = [number, number]

interface Lattice {
  values: Float32Array
  nx: number
  ny: number
}

const makeLattice = (nx: number, ny: number, rng: Rng): Lattice => {
  const values = new Float32Array(nx * ny)
  for (let i = 0; i < values.length; i++) {
    values[i] = rng()
  }
  return { values, nx, ny }
}

/**
 * One fBm octave. Frequencies are **integers and per-axis**, which is doing two
 * jobs: integers are what keeps every octave periodic over the tile, and the
 * x/y pair being unequal (3×4, not 3×3) breaks the square-lattice regularity
 * that a value-noise fBm otherwise shows as faint rows and columns — the same
 * failure the fragment shader's oblique `waterStrands` axes exist to avoid.
 * The offsets shift an octave without disturbing its period.
 */
interface Octave {
  lattice: Lattice
  gain: number
  offsetX: number
  offsetY: number
}

const makeOctaves = (freqs: readonly (readonly [number, number])[], gains: readonly number[], rng: Rng): Octave[] =>
  freqs.map((f, i) => ({
    lattice: makeLattice(f[0], f[1], rng),
    gain: gains[i]!,
    offsetX: rng.range(0, 64),
    offsetY: rng.range(0, 64)
  }))

/**
 * Accumulate every octave into `out`: bilinear value noise with a quintic fade
 * over each octave's wrapping lattice, so every octave — and therefore the sum
 * — is exactly periodic over the tile.
 *
 * Octave-outer, row-hoisted, with the whole x-axis (wrapped indices and fade
 * weight) precomputed once per octave because those are constant down a column.
 */
const fbmPass = (octaves: readonly Octave[], size: number, out: Float32Array): void => {
  const colIndex0 = new Int32Array(size)
  const colIndex1 = new Int32Array(size)
  const colFade = new Float32Array(size)

  for (let oi = 0; oi < octaves.length; oi++) {
    const { lattice, gain, offsetX, offsetY } = octaves[oi]!
    const { values, nx, ny } = lattice
    const sx = nx / size
    const sy = ny / size

    for (let x = 0; x < size; x++) {
      const fx = (x + 0.5) * sx + offsetX
      const xi = Math.floor(fx)
      const x0 = ((xi % nx) + nx) % nx
      colIndex0[x] = x0
      colIndex1[x] = x0 + 1 === nx ? 0 : x0 + 1
      colFade[x] = fade(fx - xi)
    }

    for (let y = 0; y < size; y++) {
      const fy = (y + 0.5) * sy + offsetY
      const yi = Math.floor(fy)
      const v = fade(fy - yi)
      const y0 = ((yi % ny) + ny) % ny
      const r0 = y0 * nx
      const r1 = (y0 + 1 === ny ? 0 : y0 + 1) * nx
      const base = y * size

      for (let x = 0; x < size; x++) {
        const x0 = colIndex0[x]!
        const x1 = colIndex1[x]!
        const u = colFade[x]!
        const a = values[r0 + x0]!
        const b = values[r0 + x1]!
        const c = values[r1 + x0]!
        const d = values[r1 + x1]!
        const top = a + (b - a) * u
        const bot = c + (d - c) * u
        out[base + x] = out[base + x]! + gain * (top + (bot - top) * v)
      }
    }
  }
}

/**
 * `[min, span]` of two finished fields, scanned together in one walk.
 *
 * Folding this scan into the last fBm octave instead — so the tile is never
 * walked separately — was tried and is slower: it puts a per-texel branch and
 * two extra live floats inside the innermost accumulation loop, and warm build
 * time went from ~12 ms to ~16 ms at 256². The Worley pass keeps its scan
 * inline because there it sits at the end of the texel loop with nothing to
 * branch on.
 */
const extents2 = (a: Float32Array, b: Float32Array): [Extent, Extent] => {
  let aMin = Number.POSITIVE_INFINITY
  let aMax = Number.NEGATIVE_INFINITY
  let bMin = Number.POSITIVE_INFINITY
  let bMax = Number.NEGATIVE_INFINITY
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!
    const bv = b[i]!
    if (av < aMin) aMin = av
    if (av > aMax) aMax = av
    if (bv < bMin) bMin = bv
    if (bv > bMax) bMax = bv
  }
  return [
    [aMin, aMax - aMin || 1],
    [bMin, bMax - bMin || 1]
  ]
}

// ── Toroidal Worley ────────────────────────────────────────────────────────
//
// One jittered feature point per cell, looked up modulo the cell count so the
// grid is a torus. The point's *position* keeps the unwrapped cell coordinate,
// so distances stay continuous across the wrap — that, not any edge treatment,
// is what makes the seam exact.
//
// Jitter is clamped to [0.2, 0.8] rather than the full cell, for two reasons.
// It makes the 3×3 neighbourhood search provably exact for F1 (an in-cell point
// is at most 1.13 cells away, a point outside the block at least 1.2), and
// evenly-ish spaced cells are also the better look: fully random Worley
// produces long thin slivers next to fat cells, and caustics do not do that.

interface Cells {
  points: Float32Array
  n: number
}

const makeCells = (n: number, rng: Rng): Cells => {
  const points = new Float32Array(n * n * 2)
  for (let i = 0; i < n * n; i++) {
    points[i * 2] = rng.range(0.2, 0.8)
    points[i * 2 + 1] = rng.range(0.2, 0.8)
  }
  return { points, n }
}

/**
 * One 3×3 toroidal Worley search, writing **both** cell channels: F1 into
 * `outF1` and F2−F1 into `outNet`.
 *
 * Both channels come out of the same search on purpose, and it is not only a
 * cost decision (though it is that too — see below). F1 and F2−F1 over the same
 * point set are the *body* and the *rim* of the same cells, so one tap of the
 * atlas draws a complete stylised water cell: shaded interior, bright edge.
 * Two independent cellular fields cannot do that at any price.
 *
 * Measured, 256², first call in a cold V8 (Node 24 / jsdom):
 *   two separate passes (F1 pass + ridge pass)  36.4 ms
 *   this fused pass                             17.9 ms
 * Steady state is ~4.3 ms either way; almost all of the difference is V8
 * tier-up, and this halves the work that runs before the loop goes hot. A
 * boot-time generator only ever gets the cold number.
 *
 * The search runs on **squared** distances and takes two square roots at the
 * end rather than eighteen. Row wrapping is hoisted out of the texel loop.
 *
 * Rows are visited centre-first and the two outer rows are **pruned exactly**:
 * with jitter clamped to [0.2, 0.8], every point in row `dj` is at least
 * `minAbsDy` away vertically, so if `minAbsDy² ≥ f2` no point in it can join
 * the two nearest and the whole row is skipped. The centre row always runs, so
 * f1 and f2 are always real by the time a prune is tested. Measured 14.7 →
 * 9.6 ms cold at 256²; the result is bit-identical to the unpruned search.
 */
const ROW_ORDER = [0, -1, 1] as const

const worleyPass = (cells: Cells, size: number, outF1: Float32Array, outNet: Float32Array): [Extent, Extent] => {
  const { points, n } = cells
  const scale = n / size
  let f1Min = Number.POSITIVE_INFINITY
  let f1Max = Number.NEGATIVE_INFINITY
  let netMin = Number.POSITIVE_INFINITY
  let netMax = Number.NEGATIVE_INFINITY

  for (let y = 0; y < size; y++) {
    const py = (y + 0.5) * scale
    const cj = Math.floor(py)
    const base = y * size

    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) * scale
      const ci = Math.floor(px)
      let f1 = 1e9
      let f2 = 1e9

      for (let r = 0; r < 3; r++) {
        const dj = ROW_ORDER[r]!
        const oy = cj + dj - py

        if (r > 0) {
          const lo = oy + 0.2
          const hi = oy + 0.8
          const minAbsDy = lo > 0 ? lo : hi < 0 ? -hi : 0
          if (minAbsDy * minAbsDy >= f2) continue
        }

        let wj = cj + dj
        if (wj < 0) wj += n
        else if (wj >= n) wj -= n
        const row = wj * n

        for (let di = -1; di <= 1; di++) {
          let wi = ci + di
          if (wi < 0) wi += n
          else if (wi >= n) wi -= n
          const idx = (row + wi) * 2
          const dx = ci + di - px + points[idx]!
          const dy = oy + points[idx + 1]!
          const d = dx * dx + dy * dy
          if (d < f1) {
            f2 = f1
            f1 = d
          } else if (d < f2) {
            f2 = d
          }
        }
      }

      const r1 = Math.sqrt(f1)
      const net = Math.sqrt(f2) - r1
      outF1[base + x] = r1
      outNet[base + x] = net
      if (r1 < f1Min) f1Min = r1
      if (r1 > f1Max) f1Max = r1
      if (net < netMin) netMin = net
      if (net > netMax) netMax = net
    }
  }

  return [
    [f1Min, f1Max - f1Min || 1],
    [netMin, netMax - netMin || 1]
  ]
}

// ── Build ──────────────────────────────────────────────────────────────────

/**
 * Seed for the shipped atlas. Fixed: the tile is part of the art direction, and
 * a reroll changes how every body of water in the world looks.
 */
export const WATER_ATLAS_SEED = 0x5ea11f7

const BLOTCH_FREQS = [
  [3, 4],
  [7, 6],
  [13, 11]
] as const
const BLOTCH_GAINS = [0.56, 0.28, 0.16]

const RIPPLE_FREQS = [
  [17, 19],
  [31, 29]
] as const
const RIPPLE_GAINS = [0.62, 0.38]

export const buildWaterAtlas = (size = WATER_ATLAS_SIZE, seed = WATER_ATLAS_SEED): DataTexture => {
  const rng = makeRng(seed)

  const cells = makeCells(WATER_ATLAS_CELLS, rng)
  const blotch = makeOctaves(BLOTCH_FREQS, BLOTCH_GAINS, rng)
  const ripple = makeOctaves(RIPPLE_FREQS, RIPPLE_GAINS, rng)

  const count = size * size
  const fieldR = new Float32Array(count)
  const fieldG = new Float32Array(count)
  const fieldB = new Float32Array(count)
  const fieldA = new Float32Array(count)

  // Every pass samples at texel *centres*, so the field is sampled
  // symmetrically about the tile and the wrap lands between texels rather than
  // on one — sampling at texel corners duplicates the edge row.
  const [[rMin, rSpan], [gMin, gSpan]] = worleyPass(cells, size, fieldR, fieldG)
  fbmPass(blotch, size, fieldB)
  fbmPass(ripple, size, fieldA)
  const [[bMin, bSpan], [aMin, aSpan]] = extents2(fieldB, fieldA)

  // ── Stretch, shape, quantise ─────────────────────────────────────────────
  //
  // Every channel is stretched to exactly [0,1] over the tile before
  // quantisation. Fixed divisors were tried first and are worse: the useful
  // range of F2−F1 depends on the cell count, so every retune of the grid
  // silently re-clipped or re-squashed the channel. Stretching over the tile is
  // just as deterministic (same seed → same extremes) and spends all 8 bits, so
  // the shader never has to multiply a dead range back up.
  //
  // One pass, not eight. Each channel's range scan and each shaping curve
  // started as its own 65 k loop, which cost 6.1 ms of a 34 ms cold build — the
  // work is trivial, but every loop pays its own V8 tier-up. The scans now ride
  // along inside the generating passes and the curves fold into quantisation,
  // so the tile is walked exactly once after it is generated.
  const data = new Uint8Array(count * 4)
  for (let i = 0; i < count; i++) {
    const o = i * 4
    data[o] = Math.round(((fieldR[i]! - rMin) / rSpan) * 255)
    // F2−F1 piles up near 0 (most of a cell is nowhere near a boundary), which
    // leaves the vein a sub-texel hairline the first mip erases completely.
    // sqrt lifts the low end so the boundary has a gradient wide enough for the
    // sampler to filter and for a shader smoothstep to land on. sqrt of a
    // [0,1] field is still exactly [0,1], so this needs no second stretch.
    data[o + 1] = Math.round(Math.sqrt((fieldG[i]! - gMin) / gSpan) * 255)
    // Blotches want contrast — the reference's patches are patches, not a haze.
    // One S-curve, not two: two put 2.0 % of the channel at 0 and 2.0 % at 255,
    // which is a clipped population the shader can never recover detail from.
    const b0 = (fieldB[i]! - bMin) / bSpan
    data[o + 2] = Math.round(b0 * b0 * (3 - 2 * b0) * 255)
    // A stays linear — the shader thresholds it itself (see the contract).
    data[o + 3] = Math.round(((fieldA[i]! - aMin) / aSpan) * 255)
  }

  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.magFilter = LinearFilter
  // Trilinear, not plain linear. Water stretches to the horizon and the A
  // channel is deliberately high-frequency; un-mipmapped it aliases into a
  // crawling shimmer that reads as noise rather than as glitter.
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  // A little anisotropy on top: water is nearly always seen at a grazing angle,
  // where trilinear alone picks a mip off the minor axis and over-blurs the
  // whole surface into flat colour. three clamps this to the device maximum,
  // so 4 is safe on hardware that has none.
  texture.anisotropy = 4
  // Data, not colour. sRGB would apply the EOTF on every fetch and warp the
  // Worley distances non-linearly — the veins would sit at the wrong width and
  // no shader constant could put them back, because the warp is not affine.
  texture.colorSpace = NoColorSpace
  texture.needsUpdate = true
  texture.name = 'water-atlas'
  return texture
}

// One shared instance. Every body of water samples the same tile — a per-body
// texture would multiply the memory by the number of placements and buy
// nothing, since variation comes from UV scale and scroll velocity.
let atlas: WaterAtlas | null = null

export const getWaterAtlas = (): WaterAtlas => {
  atlas ??= { texture: buildWaterAtlas(), size: WATER_ATLAS_SIZE }
  return atlas
}

export const disposeWaterAtlas = (): void => {
  atlas?.texture.dispose()
  atlas = null
}
