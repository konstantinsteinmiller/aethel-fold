import { BufferAttribute, BufferGeometry, Color, Vector3 } from 'three'
import { C } from '../art/palette'
import { assertTriBudget } from '../geometry/budget'
import { dropDegenerateFaces } from '../geometry/build'
import { blendNormalsToUp } from '../geometry/normals'
import { makeRng, type Rng } from '../geometry/rng'
import { bakeVertexAO } from '../geometry/vertexAO'
import { applyVertexAO, ensureColorAttribute, jitterColor, paintByHeight, paintByUpness } from '../geometry/vertexColor'
import { createOutlineMaterial } from '../shading/outlineMaterial'
import { createToonMaterial } from '../shading/toonMaterial'
import { mergeParts, partRanges } from './common'
import type { WorldAsset } from './types'

/**
 * ─── Plateau, and the cliff family's shared kit ──────────────────────────────
 *
 * The mushroom/anvil island: wide flat grass-capped top, a body that undercuts
 * hard beneath the rim, pinches at the waist, flares back out and tucks into the
 * ground. It is the main level-design building block, so it is the file the rest
 * of the family (cliff, slab, grassRock) reaches into for its primitives.
 *
 * ── Why a loft rather than `blobGeometry` ───────────────────────────────────
 *
 * A lump-displaced spheroid cannot undercut: the lump field is a radius as a
 * function of *direction*, so every surface point is visible from the centre and
 * an overhanging lip is unreachable. This family is defined by its overhang. So
 * the primitive is a surface of revolution with an independent section —
 * `P(u, θ) = (r(u,θ)·cosθ + jog(u), y(u), r(u,θ)·sinθ + jog(u))`.
 *
 * Everything that made `blobGeometry` LOD-safe carries over: `r`, `y` and `jog`
 * are continuous functions of `(u, θ)` and never of vertex index, so all four
 * tiers sample one surface; normals are analytic central differences of that
 * same function; and each tier's section is area-matched to the continuous one.
 *
 * ── The three features that make it read as the reference, not as a cone ────
 *
 * A smooth taper with a gentle cosine ripple renders as a lathe-turned cone. It
 * was, and the fix is that all three of these are *shape*, not decoration:
 *
 *   1. **Fused columns** (`fluteSectionAt`). The section is the union — a
 *      pointwise `max` — of overlapping off-axis circles. A max of smooth
 *      functions has a **corner** wherever the winner changes, so the valleys
 *      between lobes are genuine arrises rather than the soft scallops a sum of
 *      cosines gives. This is what "a bundle of fused vertical columns" means
 *      geometrically, and it costs no triangles at all.
 *   2. **Sampled on the arris** (`segments = 2 × lobes`). The sharpest section
 *      in the world is invisible if the mesh cuts across it, so the lobes are
 *      kept *uniform* — which fixes every arris at a bearing the grid can land
 *      on — and irregularity is applied as a **multiplicative** wobble, which
 *      provably cannot move one. See `makeFlutes`; the first version jittered
 *      the lobes and delivered 37 % of its own flute depth.
 *   3. **Strata** (`strataAt` / `strataOffsetAt`). Narrow smootherstep breaks
 *      that jut the radius in or out *and jog the axis sideways*, so the body is
 *      a stack of offset blocks rather than a continuous profile. Ring lists are
 *      derived from the breaks (`buildRingList`) rather than authored, which is
 *      the only way to guarantee a tier actually resolves the step it is
 *      supposed to show.
 *
 * Budgets (GDD §4.1): 260 / 150 / 80 / 40.
 */

// ─── Small maths shared by the family ───────────────────────────────────────

const TAU = Math.PI * 2

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t)

/** C² smoothstep. C¹ is not enough: the toon band edge traces the normal's
 *  *derivative*, so a C¹ join shows up as a visible ring rather than a crease. */
export const smootherstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-6))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

// ─── Generation-time validation ─────────────────────────────────────────────

const CHECKED_ATTRIBUTES = ['position', 'normal', 'color', 'aWind'] as const

/**
 * Throws if any vertex attribute holds a non-finite float, or if a normal is not
 * unit length.
 *
 * This exists because a NaN shipped all the way to a browser screenshot. The
 * cause was one character of arithmetic — `u ** 0.85` in a profile function,
 * evaluated by the loft's central difference at `u = -0.006`, which is NaN for
 * every non-integer exponent. It flowed into the normal, then into the colour
 * via `paintByUpness` (`Math.max(0, NaN)` is NaN), and rendered as a solid black
 * cap on all eight cliff tiers.
 *
 * What makes this class of bug worth a permanent guard is not the arithmetic —
 * it is that **NaN is invisible to every ordinary check**. Both the unit-normal
 * assertion (`|len - 1| > 1e-3`) and the not-black assertion (`luma < 0.005`)
 * were already running over this exact data and both passed, because every
 * comparison against NaN is false. A test that looks correct silently inverts
 * into a test that can never fail. `Number.isFinite` over the raw arrays is the
 * only formulation that does not have that property, so it is the one that runs
 * here, on every tier, before the triangle budget is even considered.
 */
export const assertFiniteGeometry = (geometry: BufferGeometry, name: string): BufferGeometry => {
  const problems: string[] = []

  for (const key of CHECKED_ATTRIBUTES) {
    const attribute = geometry.getAttribute(key)
    if (!attribute) {
      continue
    }
    const array = attribute.array as ArrayLike<number>
    let bad = 0
    let firstVertex = -1
    for (let i = 0; i < array.length; i++) {
      if (Number.isFinite(array[i]!)) {
        continue
      }
      bad++
      if (firstVertex < 0) {
        firstVertex = Math.floor(i / attribute.itemSize)
      }
    }
    if (bad > 0) {
      const position = geometry.getAttribute('position')
      // Report where it happened in object space. "Vertex 71" is unactionable;
      // "the vertex at y = 10.59" points straight at the top ring.
      const at =
        position && firstVertex < position.count
          ? ` first at vertex ${firstVertex} (${position.getX(firstVertex).toFixed(2)}, ` +
            `${position.getY(firstVertex).toFixed(2)}, ${position.getZ(firstVertex).toFixed(2)})`
          : ''
      problems.push(`${bad}/${array.length} non-finite in "${key}"${at}`)
    }
  }

  const normal = geometry.getAttribute('normal')
  if (normal) {
    let unnormalised = 0
    for (let i = 0; i < normal.count; i++) {
      const x = normal.getX(i)
      const y = normal.getY(i)
      const z = normal.getZ(i)
      const lengthSq = x * x + y * y + z * z
      // Written as a positive test so a NaN falls into the failing branch
      // instead of skipping it, which is the trap described above.
      if (!(Math.abs(lengthSq - 1) < 2e-3)) {
        unnormalised++
      }
    }
    if (unnormalised > 0) {
      problems.push(`${unnormalised}/${normal.count} normals are not unit length`)
    }
  }

  if (problems.length > 0) {
    const message = `[world] ${name}: ${problems.join('; ')}`
    if (import.meta.env.DEV) {
      throw new Error(message)
    }
    console.warn(message)
  }
  return geometry
}

/**
 * The tail of every generator in this family: validate, then budget.
 *
 * Ordered that way on purpose — a tier full of NaN still has a perfectly valid
 * triangle count, so budgeting first would report success on a black asset.
 */
export const finishTier = (geometry: BufferGeometry, budget: number, name: string): BufferGeometry => {
  geometry.computeBoundingSphere()
  return assertTriBudget(assertFiniteGeometry(geometry, name), budget, name)
}

// ─── Section: a bundle of fused columns ─────────────────────────────────────

interface Flute {
  /** Bearing of this sub-column's axis. Regular by design — see the header. */
  angle: number
  /** Axis offset from the main axis. */
  offset: number
  /** Sub-column radius. */
  radius: number
}

/**
 * A ring of overlapping off-axis circles — **uniform** ones.
 *
 * The lobes were jittered at first, on the reasoning that identical columns look
 * manufactured. Measured, that jitter destroyed the feature it was decorating:
 * the arris between two lobes sits where their curves cross, which is the
 * midpoint of their bearings *only if the two are the same size*. Uneven lobes
 * slide every crossing off the midpoint, off the mesh's sample grid, and the
 * tiers captured **37 %** of a 24 %-deep section — the flutes were in the shape
 * function and almost none of them reached a triangle.
 *
 * So the bundle is uniform and irregularity comes from `makeWobble` instead,
 * which multiplies. That distinction is the whole trick: scaling both curves by
 * the same positive function leaves the bearing where they cross *exactly*
 * unmoved, so the outline varies while every arris stays nailed to the grid.
 *
 * `offset` near 0.55 makes each sub-column pass close to the main axis, so the
 * bundle fuses into one mass rather than reading as separate pillars, while the
 * crests stand 18–24 % proud of the valleys.
 */
const makeFlutes = (count: number, offset: number): Flute[] => {
  const flutes: Flute[] = []
  // Each lobe must span at least half the gap to its neighbour or the union
  // leaves a hole, and a hole is a zero radius — a spike through the model.
  const radius = Math.max(1 - offset, offset * Math.sin(Math.PI / count) * 1.15)
  for (let i = 0; i < count; i++) {
    flutes.push({ angle: (i / count) * TAU, offset, radius })
  }
  return flutes
}

interface Wobble {
  freq: number
  amp: number
  phase: number
}

/**
 * Low-frequency multiplicative irregularity. Integer harmonics only, so it
 * closes at 2π; frequencies stay well under the lobe count so it re-shapes the
 * bundle's outline without competing with the arrises for the sample grid.
 */
const makeWobble = (rng: Rng, count: number, amp: [number, number]): Wobble[] => {
  const wobble: Wobble[] = []
  for (let i = 0; i < count; i++) {
    wobble.push({ freq: i + 1, amp: rng.range(amp[0], amp[1]), phase: rng.range(0, TAU) })
  }
  return wobble
}

const wobbleAt = (theta: number, wobble: readonly Wobble[]): number => {
  let k = 1
  for (let i = 0; i < wobble.length; i++) {
    const w = wobble[i]!
    k += w.amp * Math.cos(w.freq * theta + w.phase)
  }
  return k
}

/**
 * Section radius at a bearing: the pointwise maximum over the bundle.
 *
 * `r = d·cos∆ + √(ρ² − d²sin²∆)` is the far intersection of the ray with one
 * sub-column. The `max` is what creates the arris, and it is also why this is a
 * `max` and not a sum — a sum of the same circles is smooth everywhere and
 * renders as exactly the lathe-turned surface this replaced.
 */
const fluteSectionAt = (theta: number, flutes: readonly Flute[]): number => {
  let best = 0
  for (let i = 0; i < flutes.length; i++) {
    const flute = flutes[i]!
    const delta = theta - flute.angle
    const across = flute.offset * Math.sin(delta)
    const inside = flute.radius * flute.radius - across * across
    if (inside <= 0) {
      continue
    }
    const r = flute.offset * Math.cos(delta) + Math.sqrt(inside)
    if (r > best) {
      best = r
    }
  }
  return best
}

/**
 * The family's section: a uniform fused bundle, re-shaped by a smooth wobble,
 * normalised so its widest bearing is exactly 1 — which is what lets a
 * generator's `radius` option mean the real maximum radius.
 *
 * Returned as one closure because the two halves are only correct together: the
 * bundle owns the arrises, the wobble owns the outline, and normalising anything
 * but their product would leave `radius` a rough guess.
 */
export const makeSection = (
  rng: Rng,
  lobes: number,
  offset: number,
  wobbleAmp: [number, number]
): ((theta: number) => number) => {
  const flutes = makeFlutes(lobes, offset)
  const wobble = makeWobble(rng, 3, wobbleAmp)
  const raw = (theta: number): number => fluteSectionAt(theta, flutes) * wobbleAt(theta, wobble)

  let peak = 0
  for (let i = 0; i < 512; i++) {
    peak = Math.max(peak, raw((i / 512) * TAU))
  }
  const scale = peak > 1e-6 ? 1 / peak : 1
  return theta => raw(theta) * scale
}

// ─── Profile: stacked, offset strata ────────────────────────────────────────

export interface Stratum {
  u: number
  /** Full width of the break in `u`. Narrow gives an arris, wide gives a ramp. */
  width: number
  /** Radius change across the break, as a fraction of the section radius. */
  jut: number
  jogX: number
  jogZ: number
  /** The break's upward face is broad enough to hold turf. */
  shelf: boolean
}

/**
 * Breaks are generated **prominence-first** (largest jut at index 0), because
 * that is the order the tiers drop them in. Placement is spread across the span
 * with jitter, and roughly two in three jut outward — a stack that only ever
 * widens downward is a staircase, while one that also tucks back in is a rock.
 */
export const makeStrata = (
  rng: Rng,
  count: number,
  span: [number, number],
  width: [number, number],
  jut: [number, number],
  jog: number
): Stratum[] => {
  const strata: Stratum[] = []
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count
    const u = span[0] + (span[1] - span[0]) * (t + rng.spread(0.16 / count))
    const outward = rng() < 0.68
    const size = rng.range(jut[0], jut[1]) * (outward ? 1 : -0.7)
    const jogAngle = rng.range(0, TAU)
    const jogAmount = jog * rng.range(0.35, 1)
    strata.push({
      u,
      width: rng.range(width[0], width[1]),
      jut: size,
      jogX: Math.cos(jogAngle) * jogAmount,
      jogZ: Math.sin(jogAngle) * jogAmount,
      // Only an outward step has an upward face for turf to sit on. An inward
      // one makes an overhang, and grass hanging off a ceiling reads as a bug.
      shelf: outward
    })
  }
  // Turf-bearing breaks outrank the rest at equal size. Sorting on `|jut|` alone
  // let a big overhang win a tier's only pin, and since an overhang grows no
  // turf the whole prop's green vanished at that LOD boundary — a colour pop,
  // which is worse than the silhouette pop the ordering was protecting.
  return strata.sort((a, b) => Math.abs(b.jut) * (b.shelf ? 1.6 : 1) - Math.abs(a.jut) * (a.shelf ? 1.6 : 1))
}

export const strataAt = (u: number, strata: readonly Stratum[]): number => {
  let sum = 0
  for (let i = 0; i < strata.length; i++) {
    const s = strata[i]!
    sum += s.jut * smootherstep(s.u - s.width * 0.5, s.u + s.width * 0.5, u)
  }
  return sum
}

export const strataOffsetAt = (u: number, strata: readonly Stratum[], out: Vector3): Vector3 => {
  out.set(0, 0, 0)
  for (let i = 0; i < strata.length; i++) {
    const s = strata[i]!
    const t = smootherstep(s.u - s.width * 0.5, s.u + s.width * 0.5, u)
    out.x += s.jogX * t
    out.z += s.jogZ * t
  }
  return out
}

/** Seed rings that pin a break's two edges, so the tier renders it as a step. */
export const strataSeeds = (strata: readonly Stratum[], resolved: number): number[] => {
  const seeds: number[] = []
  for (let i = 0; i < Math.min(resolved, strata.length); i++) {
    const s = strata[i]!
    // `u ± width/4`, not the band's true edges: a smootherstep's derivative is
    // zero at its ends, so rings placed there would both get horizontal normals
    // and the shelf between them would shade as wall. At the quartiles the
    // derivative is 56 % of peak and 79 % of the jut falls between the two
    // rings — a real ledge, with normals that know it.
    seeds.push(s.u - s.width * 0.25, s.u + s.width * 0.25)
  }
  return seeds
}

const _s0 = new Vector3()
const _s1 = new Vector3()
const _sm = new Vector3()
const _slerp = new Vector3()

/**
 * Ring parameters for one tier, by **greedy error refinement**.
 *
 * Hand-authored ring lists do not survive a stepped profile, and the failure is
 * not subtle. A tier is a piecewise-linear approximation of the profile through
 * its rings; put those rings in plausible-looking places and a tier that happens
 * to straddle a jut cuts the chord *outside* the true silhouette while one that
 * misses it cuts *inside*. Measured across the family, hand-placed rings put
 * LOD2 anywhere from 62 % under to 31 % over its LOD0 volume — far worse than
 * the inscribed-polygon error the whole `sectionAreaInflate` machinery exists to
 * remove, and in the one place the crossfade cannot hide it.
 *
 * So rings are placed where they do the most good: repeatedly insert the `u`
 * whose true signature deviates furthest from the chord currently spanning it.
 * The result adapts to whatever profile it is given — it finds the plateau's
 * undercut, the spire's ledges and the waist on its own — and, because every
 * tier is refining the *same* curve, coarse tiers become subsets of fine ones
 * rather than differently-wrong guesses.
 *
 * The signature is a 3-vector of `(radius, jogX, jogZ)`, not just radius: an
 * axis jog moves the silhouette exactly as much as a radius change does, and a
 * metric blind to it would spend every ring on width and none on the lean.
 */
export const buildRingList = (
  seeds: readonly number[],
  count: number,
  signatureAt: (u: number, out: Vector3) => Vector3,
  probes = 12
): number[] => {
  const us = [...new Set(seeds)].sort((a, b) => a - b)

  while (us.length < count) {
    let worst = -1
    let span = 0
    let pick = 0
    for (let i = 0; i < us.length - 1; i++) {
      const u0 = us[i]!
      const u1 = us[i + 1]!
      signatureAt(u0, _s0)
      signatureAt(u1, _s1)
      for (let p = 1; p < probes; p++) {
        const t = p / probes
        const u = u0 + (u1 - u0) * t
        signatureAt(u, _sm)
        _slerp.copy(_s0).lerp(_s1, t)
        const error = _sm.distanceTo(_slerp)
        if (error > worst) {
          worst = error
          span = i
          pick = u
        }
      }
    }
    if (worst <= 1e-9) {
      // Already linear everywhere between the rings it has. Split the widest
      // gap so the tier still lands on its budgeted triangle count.
      let widest = 0
      for (let i = 0; i < us.length - 1; i++) {
        const gap = us[i + 1]! - us[i]!
        if (gap > widest) {
          widest = gap
          span = i
        }
      }
      pick = (us[span]! + us[span + 1]!) * 0.5
    }
    us.splice(span + 1, 0, pick)
  }
  return us
}

// ─── Section area matching ──────────────────────────────────────────────────

/**
 * Inscribed-polygon compensation (GDD §4.3), by **area match**.
 *
 * A polygonal section puts its vertices on the true surface, so every edge
 * bulges inward and a coarse tier is a genuinely *smaller* object than the one
 * it crossfades with. No amount of dither blending hides a size mismatch.
 *
 * `blobGeometry` corrects it with `1/cos(π/W)^0.6`, exactly right for the shape
 * it makes — a sphere. It is wrong here. That formula knows only the segment
 * count, so it claims a 4-gon is 23 % thin whatever is being sampled; for the
 * slab's rectangular section the real error is a different number entirely, and
 * for a fluted bundle sampled on its crests it is close to zero.
 *
 * Matching the sampled polygon's **area** to the continuous section's is the
 * general statement of the same idea: every tier encloses the same
 * cross-section whatever its shape, and on a circle it reproduces the cosine
 * form to within a thousandth. One rule, no per-asset exponent to tune.
 */
const AREA_REFERENCE_SAMPLES = 512

export const sectionAreaInflate = (
  segments: number,
  thetaOffset: number,
  sectionAt: (theta: number) => number
): number => {
  // ½∮r²dθ — the continuous section this tier approximates.
  let ideal = 0
  for (let i = 0; i < AREA_REFERENCE_SAMPLES; i++) {
    const r = sectionAt((i / AREA_REFERENCE_SAMPLES) * TAU)
    ideal += r * r
  }
  ideal *= Math.PI / AREA_REFERENCE_SAMPLES

  // ½·sin(∆θ)·Σ rᵢrᵢ₊₁ — the polygon the tier actually renders.
  let sampled = 0
  for (let s = 0; s < segments; s++) {
    const r0 = sectionAt(thetaOffset + (s / segments) * TAU)
    const r1 = sectionAt(thetaOffset + ((s + 1) / segments) * TAU)
    sampled += r0 * r1
  }
  sampled *= 0.5 * Math.sin(TAU / segments)

  return sampled > 1e-9 ? Math.sqrt(ideal / sampled) : 1
}

/**
 * The same rule again, for the *other* axis: match the tier's solid-of-revolution
 * volume to the continuous profile's.
 *
 * `sectionAreaInflate` corrects the polygon that approximates the section;
 * nothing was correcting the chords that approximate the profile, and those have
 * exactly the same bias with exactly the same cause. Every chord across a
 * concave stretch — the plateau's waist, the taper under a spire's ledge — lies
 * *outside* the true curve, so a tier with fewer rings is systematically **too
 * fat**. Measured, the coarse tiers ran 12–24 % over LOD0's volume, always in
 * the same direction, which is the signature of a bias rather than of noise.
 *
 * The two corrections are orthogonal — one is about `θ`, the other about `u` —
 * so they simply multiply, and together they pin every tier to the same solid.
 */
export const profileVolumeInflate = (
  us: readonly number[],
  profileAt: (u: number) => number,
  yAt: (u: number) => number,
  samples = 512
): number => {
  const first = us[0]!
  const last = us[us.length - 1]!

  let ideal = 0
  for (let i = 0; i < samples; i++) {
    const ua = first + ((last - first) * i) / samples
    const ub = first + ((last - first) * (i + 1)) / samples
    const r = profileAt((ua + ub) * 0.5)
    ideal += r * r * Math.abs(yAt(ua) - yAt(ub))
  }

  // Conical frusta between consecutive rings — what the tier actually encloses.
  let mesh = 0
  for (let i = 0; i < us.length - 1; i++) {
    const r0 = profileAt(us[i]!)
    const r1 = profileAt(us[i + 1]!)
    mesh += ((r0 * r0 + r0 * r1 + r1 * r1) * Math.abs(yAt(us[i]!) - yAt(us[i + 1]!))) / 3
  }

  return mesh > 1e-9 ? Math.sqrt(ideal / mesh) : 1
}

// ─── The loft primitive ─────────────────────────────────────────────────────

export interface LoftOptions {
  /** Profile parameters to place rings at, **top first**. */
  us: readonly number[]
  segments: number
  /** Angle of the first sample. `π/segments` chamfers a prismatic section. */
  thetaOffset?: number
  /** Height at a profile parameter. Must be monotonically decreasing in `u`. */
  yAt: (u: number) => number
  /**
   * Horizontal radius at `(u, θ)`. Must be **total** — the central differences
   * sample slightly outside the ring range, including `u < 0` at the crown, and
   * a partial function there is where the NaN cap came from.
   */
  radiusAt: (u: number, theta: number) => number
  /** Horizontal displacement of the axis at `u` (only `x`/`z` are read). */
  offsetAt?: (u: number, out: Vector3) => Vector3
  capTop?: boolean
  capBottom?: boolean
}

const _p = new Vector3()
const _pa = new Vector3()
const _pb = new Vector3()
const _pc = new Vector3()
const _pd = new Vector3()
const _du = new Vector3()
const _dv = new Vector3()
const _n = new Vector3()
const _offset = new Vector3()

// Fine enough to keep a stratum break (~0.03 of `u`) and a flute arris crisp,
// coarse enough that the difference doesn't cancel into noise. These set the
// bevel width on every crease in the family (GDD R2), so they are art dials as
// much as numerical ones: doubling them visibly softens every arris.
const THETA_EPSILON = 0.01
const U_EPSILON = 0.0025

/**
 * Lofts a closed surface of revolution with a per-angle section.
 *
 * Rings are **not** seam-duplicated. `tubeGeometry` duplicates its seam because
 * it carries UVs; nothing here has UVs (GDD §5.2), so wrapping the index modulo
 * `segments` is cheaper and strictly better — the seam vertex is shared, its
 * analytic normal is written once, and there is no hairline down the model.
 *
 * A final ring of radius 0 closes the shape into a point for free: the second
 * triangle of each quad in that band is degenerate and gets pruned, so a tip
 * costs `segments` triangles rather than `2 × segments`.
 */
export const loftGeometry = (options: LoftOptions): BufferGeometry => {
  const { us, segments, thetaOffset = 0, yAt, radiusAt, offsetAt, capTop = false, capBottom = false } = options
  const ringCount = us.length
  const lastRing = ringCount - 1

  const evalAt = (u: number, theta: number, out: Vector3): Vector3 => {
    const r = radiusAt(u, theta)
    out.set(Math.cos(theta) * r, yAt(u), Math.sin(theta) * r)
    if (offsetAt) {
      offsetAt(u, _offset)
      out.x += _offset.x
      out.z += _offset.z
    }
    return out
  }

  // Caps duplicate their ring so the flat face gets flat normals. Sharing the
  // side ring would shade a plateau's top with the wall's normals, and the one
  // thing a walkable top must look like is flat.
  const capVertices = (capTop ? segments + 1 : 0) + (capBottom ? segments + 1 : 0)
  const vertexCount = ringCount * segments + capVertices
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)

  for (let r = 0; r < ringCount; r++) {
    const u = us[r]!
    for (let s = 0; s < segments; s++) {
      const theta = thetaOffset + (s / segments) * TAU
      const i = r * segments + s
      evalAt(u, theta, _p)

      // Analytic normal: ∂P/∂θ × ∂P/∂u. With `y` decreasing in `u` this faces
      // away from the axis, including across an undercut, where the radial term
      // stays positive and only the vertical term flips.
      evalAt(u, theta + THETA_EPSILON, _pa)
      evalAt(u, theta - THETA_EPSILON, _pb)
      evalAt(u + U_EPSILON, theta, _pc)
      evalAt(u - U_EPSILON, theta, _pd)
      _du.subVectors(_pa, _pb)
      _dv.subVectors(_pc, _pd)
      _n.crossVectors(_du, _dv)

      // Positive test, so a non-finite component lands in the fallback rather
      // than sliding past into `normalize()` and out as NaN.
      if (_n.lengthSq() > 1e-16 === false) {
        _n.set(0, r === lastRing ? -1 : 1, 0)
      } else {
        _n.normalize()
      }

      positions[i * 3] = _p.x
      positions[i * 3 + 1] = _p.y
      positions[i * 3 + 2] = _p.z
      normals[i * 3] = _n.x
      normals[i * 3 + 1] = _n.y
      normals[i * 3 + 2] = _n.z
    }
  }

  const indices: number[] = []
  for (let r = 0; r < lastRing; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * segments + s
      const b = r * segments + ((s + 1) % segments)
      const c = (r + 1) * segments + s
      const d = (r + 1) * segments + ((s + 1) % segments)
      indices.push(a, b, c, b, d, c)
    }
  }

  let cursor = ringCount * segments

  if (capTop) {
    const center = cursor++
    const y = yAt(us[0]!)
    if (offsetAt) {
      offsetAt(us[0]!, _offset)
      positions[center * 3] = _offset.x
      positions[center * 3 + 2] = _offset.z
    }
    positions[center * 3 + 1] = y
    normals[center * 3 + 1] = 1
    const rim = cursor
    for (let s = 0; s < segments; s++) {
      const source = s
      const target = cursor++
      positions[target * 3] = positions[source * 3]!
      positions[target * 3 + 1] = y
      positions[target * 3 + 2] = positions[source * 3 + 2]!
      normals[target * 3 + 1] = 1
      indices.push(center, rim + ((s + 1) % segments), rim + s)
    }
  }

  if (capBottom) {
    const center = cursor++
    const y = yAt(us[lastRing]!)
    if (offsetAt) {
      offsetAt(us[lastRing]!, _offset)
      positions[center * 3] = _offset.x
      positions[center * 3 + 2] = _offset.z
    }
    positions[center * 3 + 1] = y
    normals[center * 3 + 1] = -1
    const rim = cursor
    for (let s = 0; s < segments; s++) {
      const source = lastRing * segments + s
      const target = cursor++
      positions[target * 3] = positions[source * 3]!
      positions[target * 3 + 1] = y
      positions[target * 3 + 2] = positions[source * 3 + 2]!
      normals[target * 3 + 1] = -1
      indices.push(center, rim + s, rim + ((s + 1) % segments))
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setIndex(indices)
  return dropDegenerateFaces(geometry)
}

// ─── The grass cap ──────────────────────────────────────────────────────────

/** Per-bearing drape depth. 2π-periodic on integer harmonics → tier-identical. */
export const makeDrape = (rng: Rng, depth: number): ((theta: number) => number) => {
  const f1 = rng.int(2, 3)
  const f2 = rng.int(5, 7)
  const p1 = rng.range(0, TAU)
  const p2 = rng.range(0, TAU)
  return theta =>
    depth * (0.34 + 0.44 * (0.5 + 0.5 * Math.cos(f1 * theta + p1)) + 0.22 * (0.5 + 0.5 * Math.cos(f2 * theta + p2)))
}

export interface GrassCapOptions {
  segments: number
  thetaOffset: number
  /** Height of the flat top. */
  topY: number
  /** Outline of the body's flat top at a bearing, in metres from the axis. */
  rimRadius: (theta: number) => number
  /**
   * Where the draped edge lands — a point on the *body's own surface*, so the
   * lip conforms to the rock instead of floating off it. Null drops the skirt.
   */
  skirtPoint: ((theta: number, out: Vector3) => Vector3) | null
  /** Where the body's axis sits at the top, for leaning and jogged bodies. */
  centerX?: number
  centerZ?: number
}

/**
 * The signature of the reference art: a crisp, almost painted-on flat green top
 * with an irregular edge that rolls over the rim and hangs down the side.
 *
 * Four decisions carry that read:
 *
 *   • the disc is **exactly planar** with normals of exactly `+Y`, so the whole
 *     top lands in one toon band and reads as painted rather than shaded
 *   • it laps `RIM_LAP` past the stone, so the green *covers* the edge. The
 *     first version stopped flush and the cap read as a decal pasted onto the
 *     silhouette — the overhang is what makes turf look like it grew there
 *   • the skirt drops to a per-bearing depth from `makeDrape` and bulges out
 *     past the rock as it goes, so the hem is irregular in both depth and plan
 *   • the whole cap's normals roll toward world up, so the hem stays green
 *     instead of falling into the shadow band and reading as a black line
 *
 * The skirt is dropped on coarse tiers. At LOD2 the lip is a few centimetres
 * seen from 100 m+; spending a fifth of that tier's budget on it is the same bad
 * trade as outlining past LOD1 (GDD R6).
 */
const RIM_LAP = 1.03

export const buildGrassCap = (options: GrassCapOptions): BufferGeometry => {
  const { segments, thetaOffset, topY, rimRadius, skirtPoint, centerX = 0, centerZ = 0 } = options

  const ringCount = skirtPoint ? 2 : 1
  const vertexCount = 1 + ringCount * segments
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)

  positions[0] = centerX
  positions[1] = topY
  positions[2] = centerZ
  normals[1] = 1

  for (let s = 0; s < segments; s++) {
    const theta = thetaOffset + (s / segments) * TAU
    const radius = rimRadius(theta) * RIM_LAP
    const i = 1 + s
    positions[i * 3] = centerX + Math.cos(theta) * radius
    positions[i * 3 + 1] = topY
    positions[i * 3 + 2] = centerZ + Math.sin(theta) * radius
    normals[i * 3 + 1] = 1
  }

  const indices: number[] = []
  for (let s = 0; s < segments; s++) {
    indices.push(0, 1 + ((s + 1) % segments), 1 + s)
  }

  if (skirtPoint) {
    const base = 1 + segments
    for (let s = 0; s < segments; s++) {
      const theta = thetaOffset + (s / segments) * TAU
      const i = base + s
      skirtPoint(theta, _p)
      positions[i * 3] = _p.x
      positions[i * 3 + 1] = _p.y
      positions[i * 3 + 2] = _p.z
      _n.set(_p.x - centerX, 0, _p.z - centerZ)
      if (_n.lengthSq() > 1e-12) {
        _n.normalize()
      } else {
        _n.set(0, 1, 0)
      }
      normals[i * 3] = _n.x
      normals[i * 3 + 2] = _n.z
    }

    for (let s = 0; s < segments; s++) {
      const a = 1 + s
      const b = 1 + ((s + 1) % segments)
      const c = base + s
      const d = base + ((s + 1) % segments)
      indices.push(a, b, c, b, d, c)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setIndex(indices)
  dropDegenerateFaces(geometry)

  // GDD R3 puts ground scatter at 0.6 toward world up. A cap is grass, but it is
  // also a silhouette edge: at 0.6 the hem loses its own shading and the cap
  // flattens into a decal. 0.45 keeps the roll readable and still stops the
  // skirt self-shading into a dark ring.
  return blendNormalsToUp(geometry, 0.45)
}

// ─── Paint stacks, shared by the whole family ───────────────────────────────

/**
 * Bottom of the body's vertical ramp. `cliffShadow` alone put a 9 m plateau's
 * foot in the darkest band and it read as a burnt stump — this family's undercut
 * is *shaded*, not black (GDD R4).
 */
const BODY_LOW = C.cliffShadow.clone().lerp(C.cliffBase, 0.55)

export const paintCliffRock = (geometry: BufferGeometry, rng: Rng, jitter = 0.03): BufferGeometry => {
  // Pale at the top, cooler and duller into the undercut. A stand-in for a sky
  // bounce, and what stops a 6 m wall reading as one flat swatch at these
  // budgets (GDD R1 — colour, not geometry).
  paintByHeight(geometry, BODY_LOW, C.cliffLit, { curve: 0.75 })
  paintByUpness(geometry, C.cliffLit, 0.45, 2)
  return jitterColor(geometry, rng, jitter)
}

export interface GrassShelf {
  y: number
  halfHeight: number
}

const _shelfColor = new Color()

/**
 * Turf on the horizontal breaks partway up the rock.
 *
 * This is the detail that separates the reference from generic stylised stone,
 * and it costs **zero triangles** — the ledges already exist as geometry, so
 * this is purely GDD R1: interior detail from colour.
 *
 * Gated on the vertex normal's upness rather than on height alone, which does
 * two useful things at once. It keeps green off the vertical wall a few
 * centimetres above the same ledge, and it makes the pass self-correcting
 * across LODs: a tier that resolved a given break has up-facing normals there
 * and grows turf, while a tier that smoothed the same break into a ramp has
 * near-horizontal normals and quietly grows almost none — no per-tier list of
 * which shelves to paint, and no green smear on a wall that has no ledge.
 */
export const paintGrassShelves = (
  geometry: BufferGeometry,
  shelves: readonly GrassShelf[],
  strength = 1
): BufferGeometry => {
  if (shelves.length === 0) {
    return geometry
  }
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const attribute = ensureColorAttribute(geometry)
  const array = attribute.array as Float32Array

  for (let i = 0; i < position.count; i++) {
    const up = Math.max(0, normal.getY(i))
    if (up < 0.12) {
      continue
    }
    const y = position.getY(i)
    let band = 0
    for (let s = 0; s < shelves.length; s++) {
      const shelf = shelves[s]!
      const d = Math.abs(y - shelf.y) / shelf.halfHeight
      if (d < 1) {
        band = Math.max(band, 1 - d * d)
      }
    }
    if (band <= 0) {
      continue
    }
    const t = band * up ** 1.5 * strength
    // Shelf turf resolves toward `grassCapBase`, not `grassCapLit`: a ledge sits
    // under the wall above it and is genuinely shadowed. Matching the crown's
    // brightness here makes the shelves look stuck on.
    _shelfColor.copy(C.grassCapBase).lerp(C.grassCapLit, up * 0.45)
    const r = array[i * 3]!
    const g = array[i * 3 + 1]!
    const b = array[i * 3 + 2]!
    array[i * 3] = r + (_shelfColor.r - r) * t
    array[i * 3 + 1] = g + (_shelfColor.g - g) * t
    array[i * 3 + 2] = b + (_shelfColor.b - b) * t
  }
  attribute.needsUpdate = true
  return geometry
}

export const paintGrassCap = (geometry: BufferGeometry, topY: number, dipDepth: number): BufferGeometry => {
  // The range is passed explicitly rather than taken from the bounding box: a
  // skirtless tier's cap is a single plane, its box has zero height, and the
  // whole disc would resolve to the *dark* end of the ramp.
  //
  // Curve 1.6 makes the fall-off fast, so the top stays one flat green and only
  // the last centimetres of the hem go dark — a crisp lip, not a gradient.
  paintByHeight(geometry, C.grassCapDeep, C.grassCapLit, {
    min: topY - dipDepth,
    max: topY,
    curve: 1.6
  })
  return paintByUpness(geometry, C.grassCapLit, 0.4, 2)
}

/** One material for the whole family, so a plateau and a slab batch together. */
export const createCliffMaterial = (name: string): ReturnType<typeof createToonMaterial> =>
  createToonMaterial({
    name,
    // The default hard-edged ramp, not the foliage one, even though a third of
    // the surface is grass: the cap wants the *crispest* terminator available,
    // and softening it is what would make it read as foliage rather than turf.
    rimStrength: 0.55,
    shadowTintMix: 0.3
  })

// ─── Plateau ────────────────────────────────────────────────────────────────

export type PlateauForm = 'wide' | 'tall'

export interface PlateauOptions {
  seed?: number
  form?: PlateauForm
  /** Radius of the flat top in metres. Defaults per form. */
  radius?: number
  height?: number
}

interface FormSpec {
  radius: number
  height: number
  distanceScale: number
}

/**
 * Distance scales are held at or under 2.5 deliberately. Cull is clamped to
 * 320 m globally (`lod/config.ts`), so a scale of 2.8 pushes the LOD2→LOD3
 * switch out to 308 m and LOD3 never reaches full coverage before the prop is
 * culled — a tier generated, budgeted, asserted and never drawn.
 */
const FORMS: Record<PlateauForm, FormSpec> = {
  // A landing pad — the player crosses it, so the top has to be wide enough to
  // stand still on without the camera clipping the rim.
  wide: { radius: 4.6, height: 5.2, distanceScale: 2.4 },
  // A pillar to climb or jump between. Same profile, so the two read as one
  // family rather than as two props.
  tall: { radius: 3.1, height: 8.6, distanceScale: 2.5 }
}

/** Where the body's tip lands. `plateauBase` is exactly 0 here. */
const PROFILE_BOTTOM = 1.15

/** Lobes in the section. Every tier's segment count is 2× or 1× this. */
const LOBES = 6

/**
 * The anvil. `u` runs 0 at the flat top to 1.15 at the buried tip.
 *
 * Four multiplied smootherstep terms rather than a piecewise curve, because a
 * product of them is C² everywhere by construction — and, just as importantly,
 * **total**: every term is clamped, so the loft's central differences can sample
 * `u = -0.0025` at the crown without producing NaN. A fractional power of `u`
 * reads more naturally here and is exactly the trap that shipped a black cap.
 *
 *   1.00 at the rim → 0.51 at the waist → 0.63 at the flare → 0 at the tip
 *
 * The rim-to-waist half is the undercut, and it is the shape's whole identity:
 * the top overhangs by twice the waist radius, which is what makes a plateau
 * read as *floating* even planted in a hillside.
 */
const plateauBase = (u: number): number => {
  const lip = 1 - 0.3 * smootherstep(0, 0.2, u)
  const waist = 1 - 0.28 * smootherstep(0.16, 0.64, u)
  const flare = 1 + 0.26 * smootherstep(0.6, 0.9, u)
  const foot = 1 - smootherstep(0.88, PROFILE_BOTTOM, u)
  return lip * waist * flare * foot
}

interface PlateauShape {
  radius: number
  height: number
  sectionAt: (theta: number) => number
  strata: Stratum[]
  /** Normalises the profile so `radius` is the true maximum radius. */
  profileScale: number
  drapeAt: (theta: number) => number
  maxDrape: number
  extent: number
  rng: Rng
}

interface PlateauTier {
  /** How many strata (prominence-first) this tier pins as real steps. */
  resolved: number
  rings: number
  segments: number
  skirt: boolean
  budget: number
  aoSamples: number
}

/**
 * Segment counts are `2 × LOBES` down to LOD2 and `LOBES` at LOD3 — never a
 * number coprime with the bundle. That is the whole reason the flutes survive
 * to distance: at 12 the mesh puts a vertex on all six crests *and* all six
 * valley arrises, and at 6 it still lands on every crest. A tier at 7 or 9
 * segments renders the same section as a smooth polygon.
 *
 * Rings are what gets spent instead, which is the right way round: the section
 * is this family's identity and the profile is its pose.
 *
 * Triangles = segments × (rings − 1) × 2 − segments (the tip band is half
 * degenerate) + segments (cap fan) + 2 × segments (skirt, fine tiers).
 */
const TIERS: PlateauTier[] = [
  { resolved: 2, rings: 9, segments: LOBES * 2, skirt: true, budget: 260, aoSamples: 12 },
  { resolved: 1, rings: 6, segments: LOBES * 2, skirt: true, budget: 150, aoSamples: 10 },
  { resolved: 0, rings: 4, segments: LOBES * 2, skirt: false, budget: 80, aoSamples: 8 },
  // Four rings, not three. Three cannot describe an anvil: the only chord
  // available runs from the crown straight to the flare, passing outside the
  // waist, and the tier measured 45 % over LOD0's volume — a 13 % linear
  // mismatch, right in a crossfade band. The fourth ring costs 12 triangles.
  { resolved: 0, rings: 4, segments: LOBES, skirt: false, budget: 40, aoSamples: 6 }
]

const buildShape = (options: PlateauOptions): PlateauShape => {
  const form = options.form ?? 'wide'
  const spec = FORMS[form]
  const rng = makeRng(options.seed ?? 1)

  const radius = options.radius ?? spec.radius * rng.range(0.92, 1.1)
  const height = options.height ?? spec.height * rng.range(0.9, 1.14)

  const sectionAt = makeSection(rng, LOBES, 0.56, [0.03, 0.07])

  // One prominent break, low on the flank where the profile is flaring anyway,
  // so it lands as a knee-high shelf the player can actually see turf on. Jogs
  // stay small: the plateau's identity is the undercut, not the stacking, and a
  // big jog would swing the walkable crown off its collider.
  const strata = makeStrata(rng, 2, [0.62, 0.86], [0.04, 0.07], [0.09, 0.15], radius * 0.05)

  let peak = 0
  for (let i = 0; i <= 128; i++) {
    const u = (i / 128) * PROFILE_BOTTOM
    peak = Math.max(peak, plateauBase(u) + strataAt(u, strata) * (1 - smootherstep(0.88, PROFILE_BOTTOM, u)))
  }
  const profileScale = peak > 1e-6 ? 1 / peak : 1

  const maxDrape = Math.min(radius * 0.3, height * 0.14)

  let jog = 0
  for (const stratum of strata) {
    jog += Math.hypot(stratum.jogX, stratum.jogZ)
  }

  return {
    radius,
    height,
    sectionAt,
    strata,
    profileScale,
    drapeAt: makeDrape(rng, maxDrape),
    maxDrape,
    extent: radius + jog,
    rng
  }
}

const _jog = new Vector3()

const buildTier = (shape: PlateauShape, tier: PlateauTier, name: string): BufferGeometry => {
  const { segments } = tier
  const inflate = sectionAreaInflate(segments, 0, shape.sectionAt)

  const yAt = (u: number): number => shape.height * (1 - u)
  // The foot term is reapplied over the strata so a break near the bottom can
  // still jut without stopping the tip from closing to a point.
  const profileAt = (u: number): number =>
    (plateauBase(u) + strataAt(u, shape.strata) * (1 - smootherstep(0.88, PROFILE_BOTTOM, u))) * shape.profileScale
  // Anchored at the crown, so the walkable top stays over the placement point
  // and the stack leans away below it.
  const offsetAt = (u: number, out: Vector3): Vector3 => strataOffsetAt(u, shape.strata, out)

  const us = buildRingList(
    [0, PROFILE_BOTTOM, ...strataSeeds(shape.strata, tier.resolved)],
    tier.rings,
    (u, out) => {
      offsetAt(u, out)
      const jogX = out.x
      const jogZ = out.z
      return out.set(shape.radius * profileAt(u), jogX, jogZ)
    }
  )

  // Both corrections, applied together: one for the section polygon, one for the
  // ring chords. Neither is optional — each fixes a bias the other cannot see.
  const scale = shape.radius * inflate * profileVolumeInflate(us, profileAt, yAt)
  const radiusAt = (u: number, theta: number): number => scale * profileAt(u) * shape.sectionAt(theta)

  const body = loftGeometry({ us, segments, yAt, radiusAt, offsetAt })
  paintCliffRock(body, shape.rng)

  const shelves: GrassShelf[] = shape.strata
    .filter(stratum => stratum.shelf)
    .map(stratum => ({
      y: yAt(stratum.u),
      halfHeight: shape.height * stratum.width * 0.9
    }))
  paintGrassShelves(body, shelves, 0.95)

  const cap = buildGrassCap({
    segments,
    thetaOffset: 0,
    topY: shape.height,
    rimRadius: theta => radiusAt(0, theta),
    skirtPoint: tier.skirt
      ? (theta, out) => {
          // `yAt` is linear, so a drape depth converts straight to a profile
          // parameter and the hem lands on the body's real surface. The 1.05
          // then pushes it back *out* past the rock, so the lip overhangs
          // rather than tucking under the undercut and disappearing.
          const drape = shape.drapeAt(theta)
          const u = drape / shape.height
          const r = radiusAt(u, theta) * 1.05
          strataOffsetAt(u, shape.strata, _jog)
          return out.set(_jog.x + Math.cos(theta) * r, shape.height - drape, _jog.z + Math.sin(theta) * r)
        }
      : null
  })
  paintGrassCap(cap, shape.height, shape.maxDrape)

  const parts = [body, cap]
  const ranges = partRanges(parts)
  const merged = mergeParts(parts, name)

  // Baked on the merged asset so the cap's drape occludes the stone under it —
  // that dark line beneath the lip is AO doing the modelling work the triangle
  // budget cannot (GDD R1).
  const ao = bakeVertexAO(merged, {
    samples: tier.aoSamples,
    maxDistance: shape.radius * 0.55,
    strength: 0.9,
    power: 1.15
  })
  applyVertexAO(merged, ao, C.cliffShadow, 0.85, ranges[0])
  // Weak on the cap on purpose: the top must read as flat paint, and AO strong
  // enough to model stone is strong enough to make turf look mottled.
  applyVertexAO(merged, ao, C.grassCapDeep, 0.45, ranges[1])

  return finishTier(merged, tier.budget, name)
}

export const createPlateauAsset = (options: PlateauOptions = {}): WorldAsset => {
  const form = options.form ?? 'wide'
  const shape = buildShape(options)
  const name = `plateau-${form}-${options.seed ?? 1}`

  const tiers = TIERS.map((tier, i) => buildTier(shape, tier, `${name}/LOD${i}`))

  return {
    name,
    perfTag: 'plateaus',
    tiers,
    material: createCliffMaterial('plateau'),
    outline: createOutlineMaterial({ pixelWidth: 1.6, name: 'plateau-outline' }),
    outlineMaxTier: 1,
    // Corner of the bounding box, not the top radius: the rim is the farthest
    // point from the origin, and a radius that misses it pops the whole prop out
    // of the frustum when the player is standing on it.
    radius: Math.hypot(shape.extent, shape.height),
    distanceScale: FORMS[form].distanceScale
  }
}

/** Top radius and height of a generated plateau, for collider sizing. */
export const plateauMetrics = (options: PlateauOptions = {}): { radius: number; height: number } => {
  const shape = buildShape(options)
  // The narrowest bearing of the fluted crown, not the widest: the valleys are
  // ~13 % in from the crests, and a collider on the crests leaves arcs of thin
  // air over the flutes for the player to stand on.
  let narrowest = Number.POSITIVE_INFINITY
  for (let i = 0; i < 128; i++) {
    narrowest = Math.min(narrowest, shape.sectionAt((i / 128) * TAU))
  }
  return { radius: shape.radius * shape.profileScale * plateauBase(0) * narrowest, height: shape.height }
}
