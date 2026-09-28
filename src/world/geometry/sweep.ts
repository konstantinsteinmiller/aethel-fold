import { BufferAttribute, BufferGeometry, type Color, Vector2, Vector3 } from 'three'
import { dropDegenerateFaces } from './build'
import { ensureColorAttribute } from './vertexColor'

/**
 * ─── The swept-section primitive ───────────────────────────────────────────────
 *
 * A **closed section swept along a C² spline**, with analytic normals and a
 * voted winding. It was written for `characters/gear/`, and every argument in
 * that folder's header still holds — it is repeated in short here because two
 * unrelated families now depend on it and the reasoning has to be findable from
 * either.
 *
 * It lives in `geometry/` rather than in `gear/` because the village is built
 * out of the same primitive. A house frame, a palisade stake, a cart shaft and a
 * well's windlass are all "a section swept along a path", exactly as a sword
 * blade is, and the alternative — a second beam builder in `assets/` — would be a
 * second winding convention, a second normal rule and a second place for GDD R2
 * to go quietly missing. `gear/gearKit.ts` re-exports every name below, so
 * nothing that already imported them had to change.
 *
 * ── Why a B-spline profile, and why that *is* the bevel ─────────────────────
 *
 * The surface is
 *
 *     P(u, v) = O(u) + secA(v)·eA(u)·A + secB(v)·eB(u)·B
 *
 * where `O`, `eA`, `eB` come from a **uniform cubic B-spline** over authored
 * control points and `secA`/`secB` from a **closed** one. Uniform cubic
 * B-splines are C² everywhere, which is the requirement `plateau.ts` records
 * from the other direction: the toon band edge traces the normal's *derivative*,
 * so a merely-C¹ join renders as a visible ring rather than as a crease.
 *
 * **Control points are handles, not surface points**, and the radius the curve
 * loses at a tight cluster of them is exactly GDD R2's bevel: there is no hard
 * 90° edge anywhere this primitive can make. A crisp arris is authored by
 * putting two control points close together — a *narrow* bevel — and a soft one
 * by spreading them. Clearances must therefore be **measured on the built mesh**,
 * never derived from the control points.
 *
 * ── Normals, and the winding vote ───────────────────────────────────────────
 *
 * Central-differenced from the shape function, never from the tessellated faces
 * (GDD R2 / R3), with one global sign settled at the surface's true outermost
 * point. Whether the natural quad order comes out clockwise depends on the
 * handedness of `(A, B, path direction)`, which varies per part — so the builder
 * sums `dot(faceNormal, vertexNormal)` over every face and reverses the index
 * buffer if that sum is negative. `assertOutwardWinding` is the check that would
 * have caught the body shipping inside-out, and it is the only one that would:
 * facing is invisible to every attribute-level assertion.
 */

const TAU = Math.PI * 2

// Module-level scratch — nothing in `src/world/` allocates in a loop.
const _sec = new Vector2()
const _center = new Vector3()
const _p = new Vector3()
const _pu0 = new Vector3()
const _pu1 = new Vector3()
const _pv0 = new Vector3()
const _pv1 = new Vector3()
const _du = new Vector3()
const _dv = new Vector3()
const _n = new Vector3()
const _radial = new Vector3()
const _tangent = new Vector3()
const _a = new Vector3()
const _b = new Vector3()
const _c = new Vector3()
const _ab = new Vector3()
const _ac = new Vector3()
const _face = new Vector3()
const _basis: [number, number, number, number] = [0, 0, 0, 0]

/** Uniform cubic B-spline basis at a local parameter. Sums to 1 for all `f`. */
const cubicBasis = (f: number): void => {
  const f2 = f * f
  const f3 = f2 * f
  _basis[0] = (1 - 3 * f + 3 * f2 - f3) / 6
  _basis[1] = (4 - 6 * f2 + 3 * f3) / 6
  _basis[2] = (1 + 3 * f + 3 * f2 - 3 * f3) / 6
  _basis[3] = f3 / 6
}

/**
 * Open uniform cubic B-spline over `values`, parameter clamped to [0, 1].
 *
 * The end control points carry multiplicity 3 (by index clamping), so the curve
 * **interpolates** its first and last values exactly while approximating every
 * interior one. That asymmetry is what lets a part state "the tip is at
 * y = 0.470" and mean it, while the shape in between is free to round off.
 *
 * Total by construction: sampling outside [0, 1] returns the endpoint rather
 * than extrapolating, so the central differences below degrade to one-sided at
 * the ends instead of producing NaN — the failure `assertFiniteGeometry`
 * documents from the cliff family.
 */
export const splineAt = (values: readonly number[], t: number): number => {
  const n = values.length
  if (n === 1) {
    return values[0]!
  }
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t
  const spans = n + 1
  let i = Math.floor(clamped * spans)
  if (i > spans - 1) {
    i = spans - 1
  }
  cubicBasis(clamped * spans - i)
  let sum = 0
  for (let k = 0; k < 4; k++) {
    const index = i + k - 2
    sum += _basis[k]! * values[index < 0 ? 0 : index >= n ? n - 1 : index]!
  }
  return sum
}

/** Closed uniform cubic B-spline. C² across the seam, so a section has no join. */
export const splineLoopAt = (values: readonly number[], t: number): number => {
  const n = values.length
  const wrapped = t - Math.floor(t)
  let i = Math.floor(wrapped * n)
  if (i > n - 1) {
    i = n - 1
  }
  cubicBasis(wrapped * n - i)
  let sum = 0
  for (let k = 0; k < 4; k++) {
    sum += _basis[k]! * values[(i + k - 1 + 2 * n) % n]!
  }
  return sum
}

// ─── Sections ───────────────────────────────────────────────────────────────

/** Unit closed section: `v ∈ [0,1)` → a point in the (A, B) plane. */
export type Section = (v: number, out: Vector2) => void

/** Exact circle. Radially symmetric parts (hat, grips, string) want this. */
export const circleSection: Section = (v, out) => {
  const angle = v * TAU
  out.set(Math.cos(angle), Math.sin(angle))
}

/**
 * A closed B-spline through an authored control polygon.
 *
 * The curve sits *inside* the polygon, so a section's authored extremes are
 * upper bounds: the blade's `(1, 0)` ridge control point lands at 0.96, which is
 * the bevel on the ridge and is why the ridge shades as a crease rather than as
 * an arris the toon ramp has to resolve at one pixel.
 */
export const splineSection = (points: readonly (readonly [number, number])[]): Section => {
  const a = points.map(point => point[0])
  const b = points.map(point => point[1])
  return (v, out) => {
    out.set(splineLoopAt(a, v), splineLoopAt(b, v))
  }
}

const _probe = new Vector2()

/**
 * Scales a section so its **smallest** radius is exactly 1.
 *
 * For any part that has to clear something. A point `(eA·a, eB·b)` lies outside
 * the ellipse with semi-axes `(eA, eB)` exactly when `a² + b² > 1`, so a section
 * normalised this way guarantees the swept surface is nowhere inside the ellipse
 * its extents describe — whatever shape the section is.
 *
 * Normalising to the *minimum* rather than to the peak is the whole point, and
 * it is the opposite of what `plateau.ts` does: a plateau normalises its section
 * to peak = 1 so `radius` means the widest bearing, because nothing has to fit
 * inside a plateau. The torso armour is the other case — it is authored against
 * a body's ellipse, so the bearing that matters is the *tightest* one. Measured
 * before this existed: three body vertices outside a keeled cuirass, all of them
 * where the section dipped under 1.
 */
export const clearingSection = (section: Section): Section => {
  let smallest = Number.POSITIVE_INFINITY
  for (let i = 0; i < 256; i++) {
    section(i / 256, _probe)
    smallest = Math.min(smallest, _probe.length())
  }
  const scale = smallest > 1e-6 ? 1 / smallest : 1
  return (v, out) => {
    section(v, out)
    out.multiplyScalar(scale)
  }
}

// ─── The sweep ──────────────────────────────────────────────────────────────

export interface SweepOptions {
  name: string
  /** Section-centre control points. The path may fold; it must never stall. */
  path: readonly (readonly [number, number, number])[]
  /** Half-extent along `axisA` at each control point. 0 collapses the ring. */
  extentA: readonly number[]
  /** Half-extent along `axisB`. */
  extentB: readonly number[]
  axisA: Vector3
  axisB: Vector3
  section: Section
  /** Rings sampled along the path, spread evenly in `u` unless `us` says else. */
  stations: number
  /**
   * Explicit path parameters for the rings, overriding the even spread.
   *
   * Needed wherever the profile turns faster than one station gap. The hat's
   * brim rolls through 180° in 8 % of `u`; sampled evenly, one band chorded
   * straight across the roll and its two rings' normals came out **opposed**,
   * which `assertOutwardWinding` reported as exactly `segments` bad faces. That
   * is the mesh telling the truth: a band whose ends face opposite ways is not a
   * coarse approximation of a rim, it is a hole in the description of one.
   *
   * `plateau.ts` solves the same problem by deriving ring lists from the
   * profile's own error (`buildRingList`). These props are hand-authored and few,
   * so the rings are hand-placed — but the failure mode is identical and so is
   * the fix: rings where the curve needs them, not where the loop puts them.
   */
  us?: readonly number[]
  /** Samples around the section. */
  segments: number
  /**
   * Rotates the section's sample grid.
   *
   * `plateau.ts` measured what happens when a sample grid misses a section's
   * features: a 24 %-deep flute delivered 37 % of its own depth because the
   * arrises fell between samples. Here it is used to put a vertex on the blade's
   * edge and on the crossbow's rail, and to align the hat's 9-gon with the
   * head's — see `hat.ts`.
   */
  vOffset?: number
  /**
   * Inscribed-polygon compensation (GDD §4.3). A sampled polygon's edges bulge
   * inward, so a section sampled at `segments` points encloses less than the
   * curve it approximates. `1 / cos(π/segments)` puts the *edge midpoints* on
   * the curve instead of the vertices, which is what a clearance check needs.
   */
  inflate?: number
}

export interface SweptPart {
  geometry: BufferGeometry
  /** Path parameter of each vertex, 0 at the first station and 1 at the last. */
  u: Float32Array
  /** Section parameter of each vertex. */
  v: Float32Array
}

const pathAt = (path: SweepOptions['path'], t: number, out: Vector3): Vector3 => {
  // Three independent splines rather than one vector spline: identical result,
  // and it keeps `splineAt` scalar so the extents can share it.
  const n = path.length
  let x = 0
  let y = 0
  let z = 0
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t
  const spans = n + 1
  let i = Math.floor(clamped * spans)
  if (i > spans - 1) {
    i = spans - 1
  }
  cubicBasis(clamped * spans - i)
  for (let k = 0; k < 4; k++) {
    const index = i + k - 2
    const point = path[index < 0 ? 0 : index >= n ? n - 1 : index]!
    x += _basis[k]! * point[0]
    y += _basis[k]! * point[1]
    z += _basis[k]! * point[2]
  }
  return out.set(x, y, z)
}

/** Sweeps a closed section along the spline. Positions and analytic normals. */
export const sweep = (options: SweepOptions): SweptPart => {
  const { path, extentA, extentB, axisA, axisB, section, stations, segments, vOffset = 0, inflate = 1 } = options

  if (path.length !== extentA.length || path.length !== extentB.length) {
    throw new Error(`[gear] ${options.name}: path and extent control polygons differ in length`)
  }
  if (stations < 2 || segments < 3) {
    throw new Error(`[gear] ${options.name}: a sweep needs at least 2 stations and 3 segments`)
  }
  if (options.us && options.us.length !== stations) {
    throw new Error(`[gear] ${options.name}: ${options.us.length} explicit stations but stations = ${stations}`)
  }
  const us = options.us ?? Array.from({ length: stations }, (_, i) => i / (stations - 1))

  const evalAt = (u: number, v: number, out: Vector3): Vector3 => {
    section(v, _sec)
    pathAt(path, u, out)
    const a = splineAt(extentA, u) * inflate
    const b = splineAt(extentB, u) * inflate
    return out.addScaledVector(axisA, _sec.x * a).addScaledVector(axisB, _sec.y * b)
  }

  const vertexCount = stations * segments
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uOf = new Float32Array(vertexCount)
  const vOf = new Float32Array(vertexCount)

  // Small enough to resolve a bevel authored as two nearby control points,
  // large enough that the difference doesn't cancel into float noise.
  const uEpsilon = 0.5 / ((path.length + 1) * 8)
  const vEpsilon = 0.5 / (segments * 8)

  /**
   * `∂P/∂v × ∂P/∂u`, with a **fixed** sign.
   *
   * Not "oriented away from the section's centre", which is the obvious rule and
   * is wrong the moment a profile folds back on itself: the hat's inner crown
   * and the armour's rolled collar are surfaces whose material lies *toward* the
   * axis, so a radial rule flips them and the mesh ends up with two opposite
   * orientations stitched together. Measured on the hat: 81 of 162 faces.
   *
   * A cross product of the parameterisation's own tangents has no such
   * discontinuity — it is continuous over the whole (u, v) sheet, fold and all.
   * Only its *global* sign is unknown, and that is settled once below.
   */
  const normalAt = (u: number, v: number, out: Vector3): boolean => {
    evalAt(Math.max(0, u - uEpsilon), v, _pu0)
    evalAt(Math.min(1, u + uEpsilon), v, _pu1)
    evalAt(u, v - vEpsilon, _pv0)
    evalAt(u, v + vEpsilon, _pv1)
    _du.subVectors(_pu1, _pu0)
    _dv.subVectors(_pv1, _pv0)
    out.crossVectors(_dv, _du)
    // Positive test, so a non-finite component fails rather than sliding past
    // `normalize()` and shipping as NaN.
    return out.lengthSq() > 1e-24
  }

  for (let station = 0; station < stations; station++) {
    const u = us[station]!
    // A quarter of *this* station's own band — the gaps are not uniform once a
    // caller places rings by hand.
    const neighbour = station === stations - 1 ? us[station - 1]! : us[station + 1]!
    const poleShift = (neighbour - u) * 0.25

    for (let step = 0; step < segments; step++) {
      const v = vOffset + step / segments
      const index = station * segments + step

      evalAt(u, v, _p)
      if (!normalAt(u, v, _n)) {
        // A collapsed ring: `∂P/∂v` is exactly zero. Differencing a quarter of a
        // band inside the parameter range gives the tip's own normal, with the
        // same orientation as every other vertex, which the alternative — the
        // path tangent — does not: at a *second* pole (the hat's inner apex) the
        // path is still advancing forward while the material is behind it.
        if (!normalAt(u + poleShift, v, _n)) {
          _n.copy(axisA)
        }
      }
      _n.normalize()

      positions[index * 3] = _p.x
      positions[index * 3 + 1] = _p.y
      positions[index * 3 + 2] = _p.z
      normals[index * 3] = _n.x
      normals[index * 3 + 1] = _n.y
      normals[index * 3 + 2] = _n.z
      uOf[index] = u
      vOf[index] = step / segments
    }
  }

  // ── The one global sign ───────────────────────────────────────────────────
  //
  // Settled at the surface's **outermost point**, found by a fine scan of `u`
  // rather than by picking the widest *sampled station*.
  //
  // That distinction is not pedantry — it was a bug. The hat's widest sampled
  // station (u = 0.5) sits 5 % past the brim's actual turn, where the profile
  // has already started back inward and the normal is 32° off radial in the
  // wrong direction. The whole model came out inside-out but for one band, and
  // `assertOutwardWinding` reported exactly `segments` faces.
  //
  // At the true extremum `dρ/du = 0`, so the tangent plane is orthogonal to the
  // radial direction and the normal is **exactly** ±ρ̂. There is no shape this
  // primitive can make for which that test is ambiguous.
  let widest = -1
  let widestU = 0
  for (let i = 0; i <= 256; i++) {
    const u = i / 256
    evalAt(u, vOffset, _p)
    pathAt(path, u, _center)
    const size = _p.distanceToSquared(_center)
    if (size > widest) {
      widest = size
      widestU = u
    }
  }
  evalAt(widestU, vOffset, _p)
  pathAt(path, widestU, _center)
  _radial.subVectors(_p, _center)
  normalAt(widestU, vOffset, _n)
  if (_radial.lengthSq() > 1e-14 && _n.dot(_radial) < 0) {
    for (let i = 0; i < normals.length; i++) {
      normals[i] = -normals[i]!
    }
  }

  // The seam vertex is *shared*, not duplicated. `tubeGeometry` duplicates its
  // seam because it carries UVs; there are no UVs anywhere in this world (GDD
  // §5.2), so wrapping modulo `segments` is strictly better — one analytic
  // normal at the seam, and no hairline down the model.
  const indices: number[] = []
  for (let station = 0; station < stations - 1; station++) {
    for (let step = 0; step < segments; step++) {
      const a = station * segments + step
      const b = station * segments + ((step + 1) % segments)
      const c = (station + 1) * segments + step
      const d = (station + 1) * segments + ((step + 1) % segments)
      indices.push(a, b, c, b, d, c)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setIndex(indices)
  // A collapsed ring makes one triangle of every quad in its band degenerate.
  // Pruning them from the index buffer alone is what makes a rounded tip cost
  // `segments` triangles rather than `2 × segments`.
  dropDegenerateFaces(geometry)
  orientWinding(geometry)

  return { geometry, u: uOf, v: vOf }
}

// ─── Winding ────────────────────────────────────────────────────────────────

/**
 * Faces whose geometric normal disagrees with their own vertex normals.
 *
 * This is the check that would have caught the body's inward winding, and it is
 * the *only* one that would: the body's normals were analytic and outward, its
 * budget was fine, its floats were finite, and it still rendered its own far
 * surface. Facing is not visible to any attribute-level assertion.
 *
 * Degenerate slivers are skipped — their geometric normal is float noise, and
 * counting them would make the check report failures that have no rendering
 * consequence.
 */
export const windingDisagreements = (geometry: BufferGeometry, minArea = 1e-9): number => {
  const index = geometry.index
  if (!index) {
    throw new Error('[gear] winding check needs an indexed geometry')
  }
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  let bad = 0

  for (let f = 0; f < index.count; f += 3) {
    const ia = index.getX(f)
    const ib = index.getX(f + 1)
    const ic = index.getX(f + 2)
    _a.fromBufferAttribute(position, ia)
    _b.fromBufferAttribute(position, ib)
    _c.fromBufferAttribute(position, ic)
    _ab.subVectors(_b, _a)
    _ac.subVectors(_c, _a)
    _face.crossVectors(_ab, _ac)
    if (_face.length() * 0.5 < minArea) {
      continue
    }
    _n.set(0, 0, 0)
    for (const vertex of [ia, ib, ic]) {
      _n.x += normal.getX(vertex)
      _n.y += normal.getY(vertex)
      _n.z += normal.getZ(vertex)
    }
    if (_face.dot(_n) <= 0) {
      bad++
    }
  }
  return bad
}

/** Reverses the index buffer if the majority of faces wind against their normals. */
const orientWinding = (geometry: BufferGeometry): BufferGeometry => {
  const index = geometry.index!
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  let vote = 0

  for (let f = 0; f < index.count; f += 3) {
    const ia = index.getX(f)
    const ib = index.getX(f + 1)
    const ic = index.getX(f + 2)
    _a.fromBufferAttribute(position, ia)
    _b.fromBufferAttribute(position, ib)
    _c.fromBufferAttribute(position, ic)
    _ab.subVectors(_b, _a)
    _ac.subVectors(_c, _a)
    _face.crossVectors(_ab, _ac)
    _n.set(0, 0, 0)
    for (const vertex of [ia, ib, ic]) {
      _n.x += normal.getX(vertex)
      _n.y += normal.getY(vertex)
      _n.z += normal.getZ(vertex)
    }
    // Area-weighted: `_face` is un-normalised on purpose, so a big face outvotes
    // a sliver rather than the other way round.
    vote += _face.dot(_n)
  }

  if (vote < 0) {
    const flipped = new Uint32Array(index.count)
    for (let f = 0; f < index.count; f += 3) {
      flipped[f] = index.getX(f)
      flipped[f + 1] = index.getX(f + 2)
      flipped[f + 2] = index.getX(f + 1)
    }
    geometry.setIndex(new BufferAttribute(flipped, 1))
  }
  return geometry
}

export const assertOutwardWinding = (geometry: BufferGeometry, name: string): BufferGeometry => {
  const bad = windingDisagreements(geometry)
  if (bad > 0) {
    const message = `[gear] ${name}: ${bad} faces wind against their own normals`
    if (import.meta.env.DEV) {
      throw new Error(message)
    }
    console.warn(message)
  }
  return geometry
}

// ─── Paint ──────────────────────────────────────────────────────────────────

/**
 * Paints by the surface's own `(u, v)` rather than by world position.
 *
 * The parametric form is strictly more expressive here than `paintByHeight` and
 * friends: a grip wrap is a function of `u` alone, a blade's ridge highlight is
 * a function of `v` alone, and neither survives being expressed as a bounding-box
 * gradient once the part is rotated into its own frame.
 */
export const paintPart = (part: SweptPart, paint: (u: number, v: number, out: Color) => void, out: Color): SweptPart => {
  const attribute = ensureColorAttribute(part.geometry)
  const array = attribute.array as Float32Array
  for (let i = 0; i < part.u.length; i++) {
    paint(part.u[i]!, part.v[i]!, out)
    array[i * 3] = out.r
    array[i * 3 + 1] = out.g
    array[i * 3 + 2] = out.b
  }
  attribute.needsUpdate = true
  return part
}
