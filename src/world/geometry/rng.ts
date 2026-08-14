/**
 * Seeded RNG for procedural asset generation.
 *
 * Every generator in `src/world/assets/` takes a seed, so a given seed always
 * produces the same tree — that matters more than it sounds: LOD tiers of the
 * same object MUST be generated from the same seed or their silhouettes won't
 * match and the dithered crossfade (GDD §4.3) becomes visible.
 *
 * mulberry32: 32-bit state, ~2^32 period, passes gjrand — far better
 * distribution than the usual `sin(seed) * 43758.5453` hack, and just as cheap.
 */
export interface Rng {
  /** [0, 1) */
  (): number
  /** [min, max) */
  range(min: number, max: number): number
  /** integer in [min, max] inclusive */
  int(min: number, max: number): number
  /** signed [-amount, amount) */
  spread(amount: number): number
  pick<T>(items: readonly T[]): T
  /** Approximately gaussian (sum of 3 uniforms), clamped to [-1, 1]. */
  gauss(): number
}

export const makeRng = (seed: number): Rng => {
  let a = seed >>> 0
  // Guard against seed 0, which would make mulberry32 emit a degenerate run.
  if (a === 0) {
    a = 0x9e3779b9
  }

  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const rng = next as Rng
  rng.range = (min, max) => min + next() * (max - min)
  rng.int = (min, max) => Math.floor(min + next() * (max - min + 1))
  rng.spread = amount => (next() * 2 - 1) * amount
  rng.pick = items => items[Math.floor(next() * items.length)]!
  rng.gauss = () => {
    const v = (next() + next() + next()) / 1.5 - 1
    return v < -1 ? -1 : v > 1 ? 1 : v
  }
  return rng
}

/**
 * Deterministic 2D value noise, used by the terrain heightfield and by scatter
 * placement. Not simplex — value noise with a quintic fade is smooth enough for
 * a stylised world and is ~3× cheaper, which matters because the terrain
 * evaluates it a few hundred thousand times at chunk build.
 */
const hash2 = (x: number, y: number, seed: number): number => {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Quintic smoothstep — C² continuous, so derived normals don't crease. */
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)

export const valueNoise2D = (x: number, y: number, seed = 0): number => {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi

  const a = hash2(xi, yi, seed)
  const b = hash2(xi + 1, yi, seed)
  const c = hash2(xi, yi + 1, seed)
  const d = hash2(xi + 1, yi + 1, seed)

  const u = fade(xf)
  const v = fade(yf)

  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

/** Fractal brownian motion over `valueNoise2D`. Returns roughly [0, 1]. */
export const fbm2D = (x: number, y: number, octaves = 4, lacunarity = 2.03, gain = 0.5, seed = 0): number => {
  let amplitude = 0.5
  let frequency = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * valueNoise2D(x * frequency, y * frequency, seed + i * 1013)
    norm += amplitude
    amplitude *= gain
    frequency *= lacunarity
  }
  return sum / norm
}
