import { DataTexture, LinearFilter, RedFormat, UnsignedByteType } from 'three'

/**
 * ─── The toon ramp ──────────────────────────────────────────────────────────
 *
 * three's `MeshToonMaterial` reads a 1D `gradientMap` inside
 * `getGradientIrradiance()`: it looks up `dot(N,L) * 0.5 + 0.5` and multiplies
 * the light colour by the red channel. So this texture defines the entire
 * band structure of the world's lighting (GDD R4).
 *
 * Two decisions worth keeping:
 *
 * • **Linear filtering, not nearest.** With `NearestFilter` the band edge lands
 *   on a texel boundary and crawls with every camera movement. Here the *data*
 *   carries a 3-texel smoothstep at each edge, so the edge is pre-antialiased
 *   at a width we control rather than one the sampler picks.
 *
 * • **A 4th sliver band in the terminator.** Three bands alone put a 0.26-wide
 *   value jump right where the surface curvature is highest, and that step
 *   visibly swims across a rounded boulder. A narrow intermediate step costs
 *   nothing and kills it.
 */

export interface RampStop {
  /** Band value multiplied into the light colour. */
  value: number
  /** Where this band *ends*, in [0,1] over `dot(N,L)*0.5+0.5`. */
  edge: number
}

/** The project default (GDD R4): shadow, terminator sliver, mid, lit. */
export const DEFAULT_RAMP: RampStop[] = [
  { value: 0.3, edge: 0.42 },
  { value: 0.46, edge: 0.5 },
  { value: 0.72, edge: 0.72 },
  { value: 1.0, edge: 1.0 }
]

/**
 * Softer ramp for foliage — leaf masses in reality scatter light, and a hard
 * terminator across a canopy reads as plastic.
 */
export const FOLIAGE_RAMP: RampStop[] = [
  { value: 0.42, edge: 0.44 },
  { value: 0.6, edge: 0.56 },
  { value: 0.82, edge: 0.76 },
  { value: 1.0, edge: 1.0 }
]

const WIDTH = 128

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0 || 1e-6)))
  return t * t * (3 - 2 * t)
}

/**
 * @param stops     band table, ascending by `edge`
 * @param softness  edge width in texels; 3 is a crisp cel edge that still
 *                  antialiases, 8 starts to look like a gradient
 */
export const makeToonRamp = (stops: RampStop[] = DEFAULT_RAMP, softness = 3): DataTexture => {
  const data = new Uint8Array(WIDTH)
  const texelWidth = softness / WIDTH

  for (let i = 0; i < WIDTH; i++) {
    const x = (i + 0.5) / WIDTH
    // Walk the bands and cross-fade across each edge, so the result is one
    // continuous curve rather than a set of hard steps we'd then have to blur.
    let value = stops[0]!.value
    for (let s = 0; s < stops.length - 1; s++) {
      const edge = stops[s]!.edge
      const t = smoothstep(edge - texelWidth, edge + texelWidth, x)
      value = value * (1 - t) + stops[s + 1]!.value * t
    }
    data[i] = Math.round(Math.min(1, Math.max(0, value)) * 255)
  }

  const texture = new DataTexture(data, WIDTH, 1, RedFormat, UnsignedByteType)
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  texture.name = 'toon-ramp'
  return texture
}

// One shared instance per ramp flavour — the ramp is the same for every object
// in a shading family, and a per-material texture would blow the texture-unit
// budget and the program cache for nothing.
let defaultRamp: DataTexture | null = null
let foliageRamp: DataTexture | null = null

export const getDefaultRamp = (): DataTexture => {
  defaultRamp ??= makeToonRamp(DEFAULT_RAMP)
  return defaultRamp
}

export const getFoliageRamp = (): DataTexture => {
  foliageRamp ??= makeToonRamp(FOLIAGE_RAMP, 4)
  return foliageRamp
}

export const disposeRamps = (): void => {
  defaultRamp?.dispose()
  foliageRamp?.dispose()
  defaultRamp = null
  foliageRamp = null
}
