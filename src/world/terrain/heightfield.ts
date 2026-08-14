import { Color, Vector3 } from 'three'
import { C } from '../art/palette'
import { fbm2D, valueNoise2D } from '../geometry/rng'

/**
 * ─── The heightfield ────────────────────────────────────────────────────────
 *
 * A pure, continuous function of world XZ. Nothing about it is stored, which is
 * what makes the chunked terrain LOD work at all: every tier samples the *same*
 * function, so a 6×6 chunk and a 24×24 chunk describe the same hill and the
 * dithered crossfade between them has almost nothing to blend.
 *
 * The same reasoning drives `normalAt`: normals are the analytic gradient of
 * the continuous field, **never** `computeVertexNormals()` on the tessellated
 * mesh. Mesh normals depend on tessellation, so a coarse chunk would shade
 * visibly differently from a fine one and the terrain would flash a new
 * lighting solution at every LOD boundary — the one place a crossfade can't
 * save you, because it's the shading and not the silhouette that jumps.
 */

const _sample = new Vector3()

export interface HeightfieldOptions {
  seed?: number
  /** Peak-to-trough range of the large hills, in metres. */
  amplitude?: number
  /** Metres per unit of the primary noise. Larger = broader hills. */
  featureSize?: number
  /** Radius of the flattened starting area. */
  plainRadius?: number
}

export class Heightfield {
  readonly seed: number
  private readonly amplitude: number
  private readonly featureSize: number
  private readonly plainRadius: number

  constructor(options: HeightfieldOptions = {}) {
    this.seed = options.seed ?? 1337
    this.amplitude = options.amplitude ?? 30
    this.featureSize = options.featureSize ?? 170
    this.plainRadius = options.plainRadius ?? 22
  }

  heightAt(x: number, z: number): number {
    const inverseFeature = 1 / this.featureSize

    // Broad rolling hills.
    //
    // The `× 2` on the deviation is not a fudge factor. fbm of value noise is a
    // sum of independent samples, so it clusters hard around 0.5 — in practice
    // it spans roughly [0.25, 0.75], never [0, 1]. Using it raw gave 17 m of
    // relief across a 380 m world: mathematically a landscape, visually a
    // putting green, with no slope anywhere steep enough to trigger the dirt
    // blend or throw an interesting shadow.
    let height = (fbm2D(x * inverseFeature, z * inverseFeature, 4, 2.03, 0.5, this.seed) - 0.5) * 2 * this.amplitude

    // A ridge line: folding the noise around 0.5 turns smooth hills into
    // creases, which is what gives a stylised landscape its readable spine
    // instead of a field of identical bumps. The exponent sharpens the crease;
    // the offset re-centres it so ridges rise *and* valleys drop, instead of the
    // whole term acting as a constant lift.
    const folded = 1 - Math.abs(fbm2D(x * inverseFeature * 0.55, z * inverseFeature * 0.55, 3, 2.11, 0.55, this.seed + 91) * 2 - 1)
    height += (folded ** 2.4 - 0.3) * this.amplitude * 0.55

    // Mid-scale relief, so a hillside has shoulders rather than being one clean
    // sweep from base to crown.
    height +=
      (fbm2D(x * inverseFeature * 3.1, z * inverseFeature * 3.1, 3, 2.05, 0.5, this.seed + 53) - 0.5) *
      2 *
      this.amplitude *
      0.22

    // Fine undulation, so hillsides aren't billiard-smooth.
    height += (valueNoise2D(x * 0.021, z * 0.021, this.seed + 17) - 0.5) * 3.6

    // Flatten the spawn area — an open world that starts the player on a 30°
    // slope reads as broken no matter how good the shading is.
    //
    // It only ever *damps* to 35 %, never to zero, and over a small radius. A
    // full flatten over 55 m (the first attempt) erased every hill inside the
    // opening view and the world read as a putting green.
    const distance = Math.sqrt(x * x + z * z)
    if (distance < this.plainRadius * 2) {
      const t = Math.min(1, Math.max(0, (distance - this.plainRadius) / this.plainRadius))
      height *= 0.35 + 0.65 * (t * t * (3 - 2 * t))
    }

    return height
  }

  /**
   * Analytic gradient by central difference. `epsilon` is deliberately
   * tessellation-independent — see the class notes.
   */
  normalAt(x: number, z: number, out: Vector3, epsilon = 0.75): Vector3 {
    const dx = this.heightAt(x + epsilon, z) - this.heightAt(x - epsilon, z)
    const dz = this.heightAt(x, z + epsilon) - this.heightAt(x, z - epsilon)
    return out.set(-dx, 2 * epsilon, -dz).normalize()
  }

  /** 0 = flat, 1 = vertical. */
  slopeAt(x: number, z: number): number {
    this.normalAt(x, z, _sample)
    return 1 - Math.max(0, _sample.y)
  }
}

/**
 * ─── Ground colour ──────────────────────────────────────────────────────────
 *
 * BotW's ground reads as ground because of *macro* colour variation, not
 * because of texture detail: broad patches of warmer and cooler green, dirt
 * showing wherever the slope is too steep for soil to hold, sand in the
 * hollows. All three are cheap here — they're functions of height, slope and
 * one extra noise octave, evaluated once at chunk build and baked to vertex
 * colours (GDD §5.2: no terrain textures either).
 */
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

export const groundColorAt = (
  field: Heightfield,
  x: number,
  z: number,
  height: number,
  normalY: number,
  out: Color
): Color => {
  // Three octaves at ~150 m / ~50 m / ~16 m. The first pass used two octaves
  // that only swung between two nearby greens, and the ground rendered as one
  // flat colour — the variation has to move along *hue* as well as value or the
  // lighting flattens it straight back out.
  const macro = valueNoise2D(x * 0.0065, z * 0.0065, field.seed + 501)
  const mid = valueNoise2D(x * 0.019, z * 0.019, field.seed + 733)
  const fine = valueNoise2D(x * 0.062, z * 0.062, field.seed + 977)

  out.copy(C.grassBase)
  // Large scale swings the whole hillside between damp-cool and sun-dried-warm.
  out.lerp(C.grassShadow, clamp01((0.48 - macro) * 2.2) * 0.6)
  out.lerp(C.grassDry, clamp01((macro - 0.52) * 2.2) * 0.7)
  // Mid scale is the readable patchwork.
  out.lerp(C.grassLit, mid * 0.45)
  // Fine scale only breaks up the surface; pure value, no hue shift.
  out.multiplyScalar(0.93 + fine * 0.14)

  // Hollows stay cooler and darker — moisture reads as depth.
  if (height < 2) {
    out.lerp(C.grassShadow, Math.min(1, (2 - height) / 9) * 0.5)
  }

  // Dirt wherever the slope starts to matter. The ramp deliberately begins at a
  // *gentle* incline (normalY 0.94) rather than at a cliff, so hillsides pick up
  // a wash of earth long before they go bare — that gradient is a lot of what
  // makes stylised terrain read as ground rather than as a painted mesh.
  const steep = 1 - clamp01((normalY - 0.7) / 0.24)
  if (steep > 0) {
    // Break the dirt/grass boundary with noise, or every hillside gets a
    // suspiciously smooth contour line across it.
    const edge = valueNoise2D(x * 0.09, z * 0.09, field.seed + 211) * 0.3
    out.lerp(C.dirt, clamp01(steep * 1.15 + edge - 0.16))
  }

  // Sand in the low, flat hollows only — sand on a slope looks like a mistake.
  if (height < -3.5 && normalY > 0.9) {
    out.lerp(C.sand, Math.min(1, (-3.5 - height) / 4) * 0.8)
  }

  return out
}
