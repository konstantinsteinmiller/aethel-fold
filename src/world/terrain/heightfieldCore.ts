import { fbm2D, valueNoise2D } from '../geometry/rng'

/**
 * ─── Worker-safe heightfield core ───────────────────────────────────────────
 *
 * The same maths as `heightfield.ts`, with **no three.js import anywhere**.
 *
 * That constraint is the entire point of this file. Terrain chunks are built on
 * a Web Worker, and a worker is its own bundle — importing three there would
 * ship a second ~150 KB copy of it that the main thread already has. For a web
 * game where time-to-first-frame is the metric that matters, that is not a
 * trade worth making for the convenience of `Color` and `Vector3`.
 *
 * So the palette crosses the wire as a plain `Float32Array` of linear RGB
 * triples (the main thread does the sRGB→linear conversion once, where
 * `THREE.Color` already lives), and vectors are written into caller-supplied
 * arrays instead of being returned.
 */

/** Everything the shape of the terrain depends on. Structured-cloneable. */
export interface HeightfieldParams {
  seed: number
  amplitude: number
  featureSize: number
  plainRadius: number
}

export const DEFAULT_HEIGHTFIELD_PARAMS: HeightfieldParams = {
  seed: 1337,
  amplitude: 30,
  featureSize: 170,
  plainRadius: 22
}

export const heightAtCore = (x: number, z: number, params: HeightfieldParams): number => {
  const { seed, amplitude, featureSize, plainRadius } = params
  const inverseFeature = 1 / featureSize

  // The `× 2` on the deviation is not a fudge factor. fbm of value noise is a
  // sum of independent samples, so it clusters hard around 0.5 — in practice it
  // spans roughly [0.25, 0.75], never [0, 1]. Using it raw gave 17 m of relief
  // across a 380 m world: mathematically a landscape, visually a putting green.
  let height = (fbm2D(x * inverseFeature, z * inverseFeature, 4, 2.03, 0.5, seed) - 0.5) * 2 * amplitude

  // Folding the noise around its midpoint turns smooth hills into creases, which
  // is what gives a stylised landscape a readable spine. The exponent sharpens
  // the crease; the offset re-centres it so ridges rise *and* valleys drop,
  // instead of the whole term acting as a constant lift.
  const folded =
    1 - Math.abs(fbm2D(x * inverseFeature * 0.55, z * inverseFeature * 0.55, 3, 2.11, 0.55, seed + 91) * 2 - 1)
  height += (folded ** 2.4 - 0.3) * amplitude * 0.55

  // Mid-scale relief, so a hillside has shoulders rather than one clean sweep.
  height +=
    (fbm2D(x * inverseFeature * 3.1, z * inverseFeature * 3.1, 3, 2.05, 0.5, seed + 53) - 0.5) * 2 * amplitude * 0.22

  // Fine undulation, so hillsides aren't billiard-smooth.
  height += (valueNoise2D(x * 0.021, z * 0.021, seed + 17) - 0.5) * 3.6

  // Damp — never flatten — the spawn area. A full flatten over a wide radius
  // erased every hill inside the opening view.
  const distance = Math.sqrt(x * x + z * z)
  if (distance < plainRadius * 2) {
    const t = Math.min(1, Math.max(0, (distance - plainRadius) / plainRadius))
    height *= 0.35 + 0.65 * (t * t * (3 - 2 * t))
  }

  return height
}

/**
 * Analytic gradient by central difference, written into `out` at `offset`.
 *
 * `epsilon` is deliberately tessellation-independent: every LOD tier samples the
 * same continuous field, so all four shade identically. Normals taken from the
 * tessellated mesh would change with resolution and make the terrain flash a new
 * lighting solution at every LOD boundary — which, unlike a silhouette change, a
 * dithered crossfade cannot hide.
 */
export const normalAtCore = (
  x: number,
  z: number,
  params: HeightfieldParams,
  out: Float32Array,
  offset = 0,
  epsilon = 0.75
): void => {
  const dx = heightAtCore(x + epsilon, z, params) - heightAtCore(x - epsilon, z, params)
  const dz = heightAtCore(x, z + epsilon, params) - heightAtCore(x, z - epsilon, params)
  const nx = -dx
  const ny = 2 * epsilon
  const nz = -dz
  const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
  out[offset] = nx / length
  out[offset + 1] = ny / length
  out[offset + 2] = nz / length
}

// ─── Ground colour ──────────────────────────────────────────────────────────

/**
 * Index of each palette entry in the flat linear-RGB array. The worker receives
 * the array, not the names, so this layout is the contract between the two
 * sides — change it in one place and both follow.
 */
export const TERRAIN_PALETTE_SLOTS = [
  'grassLit',
  'grassBase',
  'grassShadow',
  'grassDry',
  'dirt',
  'sand'
] as const

export type TerrainPaletteSlot = (typeof TERRAIN_PALETTE_SLOTS)[number]

const SLOT = Object.fromEntries(TERRAIN_PALETTE_SLOTS.map((name, i) => [name, i * 3])) as Record<
  TerrainPaletteSlot,
  number
>

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** `out[o..o+2] = lerp(out[o..o+2], palette[slot], t)` — in place, no allocation. */
const lerpTowards = (out: Float32Array, o: number, palette: Float32Array, slot: number, t: number): void => {
  if (t <= 0) {
    return
  }
  const k = t > 1 ? 1 : t
  const r = out[o]!
  const g = out[o + 1]!
  const b = out[o + 2]!
  out[o] = r + (palette[slot]! - r) * k
  out[o + 1] = g + (palette[slot + 1]! - g) * k
  out[o + 2] = b + (palette[slot + 2]! - b) * k
}

/**
 * Writes a linear-RGB ground colour into `out` at `offset`.
 *
 * BotW's ground reads as ground because of *macro* colour variation, not texture
 * detail: broad patches of warmer and cooler green, dirt wherever the slope is
 * too steep for soil, sand in the hollows. Three octaves spanning ~150 m / ~50 m
 * / ~16 m, and the variation moves along **hue** as well as value — two nearby
 * greens only ever produce one flat colour once the lighting is applied.
 */
export const groundColorCore = (
  x: number,
  z: number,
  height: number,
  normalY: number,
  params: HeightfieldParams,
  palette: Float32Array,
  out: Float32Array,
  offset = 0
): void => {
  const seed = params.seed
  const macro = valueNoise2D(x * 0.0065, z * 0.0065, seed + 501)
  const mid = valueNoise2D(x * 0.019, z * 0.019, seed + 733)
  const fine = valueNoise2D(x * 0.062, z * 0.062, seed + 977)

  out[offset] = palette[SLOT.grassBase]!
  out[offset + 1] = palette[SLOT.grassBase + 1]!
  out[offset + 2] = palette[SLOT.grassBase + 2]!

  // Large scale swings the whole hillside between damp-cool and sun-dried-warm.
  lerpTowards(out, offset, palette, SLOT.grassShadow, clamp01((0.48 - macro) * 2.2) * 0.6)
  lerpTowards(out, offset, palette, SLOT.grassDry, clamp01((macro - 0.52) * 2.2) * 0.7)
  // Mid scale is the readable patchwork.
  lerpTowards(out, offset, palette, SLOT.grassLit, mid * 0.45)
  // Fine scale only breaks up the surface; pure value, no hue shift.
  const value = 0.93 + fine * 0.14
  out[offset] = out[offset]! * value
  out[offset + 1] = out[offset + 1]! * value
  out[offset + 2] = out[offset + 2]! * value

  // Hollows stay cooler and darker — moisture reads as depth.
  if (height < 2) {
    lerpTowards(out, offset, palette, SLOT.grassShadow, Math.min(1, (2 - height) / 9) * 0.5)
  }

  // Dirt from a *gentle* incline upward, not from a cliff: that gradient is a
  // lot of what makes stylised terrain read as ground rather than as a mesh.
  const steep = 1 - clamp01((normalY - 0.7) / 0.24)
  if (steep > 0) {
    // Noise on the boundary, or every hillside gets a suspiciously smooth
    // contour line across it.
    const edge = valueNoise2D(x * 0.09, z * 0.09, seed + 211) * 0.3
    lerpTowards(out, offset, palette, SLOT.dirt, clamp01(steep * 1.15 + edge - 0.16))
  }

  // Sand in the low, flat hollows only — sand on a slope looks like a mistake.
  if (height < -3.5 && normalY > 0.9) {
    lerpTowards(out, offset, palette, SLOT.sand, Math.min(1, (-3.5 - height) / 4) * 0.8)
  }
}
