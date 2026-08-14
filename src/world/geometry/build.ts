import { BufferAttribute, BufferGeometry, SphereGeometry, Vector3 } from 'three'
import type { Rng } from './rng'

/**
 * ─── Shape construction ─────────────────────────────────────────────────────
 *
 * Two primitives cover every prop in Phase A: a lumpy spheroid (rocks, foliage
 * clumps, canopy impostors) and a lofted tube (trunks, branches).
 *
 * The rule that makes the LOD crossfade invisible (GDD §4.3): **all four tiers
 * of an object are the same continuous shape function sampled at different
 * resolutions.** Displacement is a function of *direction on the unit sphere*,
 * never of vertex index — so a 140-tri boulder and a 36-tri boulder are the
 * same rock, and the dithered blend between them has nothing to reveal.
 */

const _dir = new Vector3()
const _p = new Vector3()
const _t1 = new Vector3()
const _t2 = new Vector3()
const _probe = new Vector3()
const _pa = new Vector3()
const _pb = new Vector3()
const _pc = new Vector3()
const _pd = new Vector3()
const _du = new Vector3()
const _dv = new Vector3()
const _n = new Vector3()

// ─── Lumps: the shape function ──────────────────────────────────────────────

/**
 * One radial bulge. `axis` is the direction it points, `power` how tight it is
 * (low = broad swelling, high = a distinct knuckle).
 */
export interface Lump {
  axis: Vector3
  amp: number
  power: number
}

export const makeLumps = (
  rng: Rng,
  count: number,
  ampRange: [number, number],
  powerRange: [number, number]
): Lump[] => {
  const lumps: Lump[] = []
  for (let i = 0; i < count; i++) {
    // Uniform on the sphere — a naive (rand angle, rand angle) pair clusters at
    // the poles and every rock ends up with a knuckle on top.
    const z = rng.range(-1, 1)
    const theta = rng.range(0, Math.PI * 2)
    const r = Math.sqrt(Math.max(0, 1 - z * z))
    lumps.push({
      axis: new Vector3(r * Math.cos(theta), z, r * Math.sin(theta)),
      amp: rng.range(ampRange[0], ampRange[1]),
      power: rng.range(powerRange[0], powerRange[1])
    })
  }
  return lumps
}

/** Radius multiplier for a unit direction. Continuous everywhere → LOD-safe. */
export const lumpRadius = (dir: Vector3, lumps: readonly Lump[]): number => {
  let r = 1
  for (let i = 0; i < lumps.length; i++) {
    const lump = lumps[i]!
    const d = dir.dot(lump.axis) * 0.5 + 0.5
    r += lump.amp * d ** lump.power
  }
  return r
}

/**
 * A bevelled half-space cut. `p -= n * smoothMax(0, dot(p,n) - dist)`.
 *
 * This is GDD R2 in one function: hard-clipping gives a crisp facet edge that
 * survives the 38° smoothing pass as a genuine crease, while the `bevel` term
 * rounds the last few millimetres of that edge so the highlight has something
 * to roll across. Zero bevel reads as papercraft; too much reads as melted.
 */
export interface CutPlane {
  normal: Vector3
  dist: number
  /** Bevel radius, in the same units as the geometry. */
  bevel: number
}

export const applyCutPlane = (p: Vector3, plane: CutPlane): void => {
  const over = p.dot(plane.normal) - plane.dist
  const k = plane.bevel
  // Smooth max(0, over): equals 0 at over ≤ -k, equals `over` at over ≫ k, and
  // is C¹ across the join — that continuity is the bevel.
  const sub = k > 0 ? 0.5 * (over + Math.sqrt(over * over + k * k)) - 0.5 * k : Math.max(0, over)
  if (sub > 0) {
    p.addScaledVector(plane.normal, -sub)
  }
}

export const makeCutPlanes = (
  rng: Rng,
  count: number,
  distRange: [number, number],
  bevel: number,
  biasDown = 0
): CutPlane[] => {
  const planes: CutPlane[] = []
  for (let i = 0; i < count; i++) {
    const z = rng.range(-1, 1)
    const theta = rng.range(0, Math.PI * 2)
    const r = Math.sqrt(Math.max(0, 1 - z * z))
    const normal = new Vector3(r * Math.cos(theta), z - biasDown, r * Math.sin(theta)).normalize()
    planes.push({ normal, dist: rng.range(distRange[0], distRange[1]), bevel })
  }
  return planes
}

// ─── Spheroid blob ──────────────────────────────────────────────────────────

export interface BlobOptions {
  radius: number
  /** Longitudinal segments. Triangles = widthSegments × (2·heightSegments − 2). */
  widthSegments: number
  heightSegments: number
  lumps: readonly Lump[]
  cuts?: readonly CutPlane[]
  /** Non-uniform scale applied after displacement — rocks are wider than tall. */
  scale?: Vector3
  /**
   * Object-space Y of a bevelled ground-plane cut. Everything below it is
   * pushed up flush, so the prop sits on the ground instead of hovering on a
   * curve or sinking to hide its underside.
   */
  flatBottom?: number
  flatBottomBevel?: number
}

/** Branchless orthonormal basis (Duff et al. 2017). `t1 × t2 = n`. */
const basisFrom = (n: Vector3, t1: Vector3, t2: Vector3): void => {
  const sign = n.z >= 0 ? 1 : -1
  const a = -1 / (sign + n.z)
  const b = n.x * n.y * a
  t1.set(1 + sign * n.x * n.x * a, sign * b, -sign * n.x)
  t2.set(b, sign + n.y * n.y * a, -n.y)
}

/**
 * The workhorse. A UV sphere, displaced by the lump field and cut by planes.
 *
 * UV sphere rather than an icosphere on purpose: it gives *arbitrary* triangle
 * counts (`W × (2H − 2)`), which is what lets each LOD tier land just under its
 * budget instead of jumping 80 → 320 the way icosahedron subdivision does.
 *
 * ── Normals are analytic, and this is the important part ────────────────────
 *
 * Normals come from central-differencing the shape function on the unit sphere,
 * **not** from the tessellated mesh. The first version of this used
 * `smoothNormalsByAngle(38°)` and it was wrong in a way that took a screenshot
 * to see:
 *
 *   at W=10 adjacent faces meet at 36° → they smooth
 *   at W=6  adjacent faces meet at 60° → they don't
 *   at W=4  adjacent faces meet at 90° → nothing smooths at all
 *
 * So the coarse tiers rendered faceted while the fine ones rendered smooth, and
 * the *shading* changed across every LOD boundary. A dithered crossfade can hide
 * a silhouette changing; it cannot hide a whole surface switching from smooth to
 * faceted, because both tiers are visibly wrong at 50 % coverage.
 *
 * Differencing the continuous shape gives the exact normal of the surface the
 * geometry is approximating, identical at every tessellation — so all four tiers
 * shade the same, and a 36-triangle boulder shades like a sculpted one. The
 * bevelled cut planes still read as crisp creases because the bevel is narrow
 * relative to the sample epsilon, not because of any angle threshold.
 */
export const blobGeometry = (options: BlobOptions): BufferGeometry => {
  const {
    radius,
    widthSegments,
    heightSegments,
    lumps,
    cuts,
    scale,
    flatBottom,
    flatBottomBevel = radius * 0.12
  } = options

  const geometry = new SphereGeometry(1, widthSegments, heightSegments)
  const position = geometry.getAttribute('position') as BufferAttribute
  const array = position.array as Float32Array
  const normals = new Float32Array(position.count * 3)

  const bottomPlane: CutPlane | null =
    flatBottom === undefined
      ? null
      : { normal: new Vector3(0, -1, 0), dist: -flatBottom, bevel: flatBottomBevel }

  /**
   * Inscribed-polygon compensation — the fix for visible LOD crossfades.
   *
   * A UV sphere puts its *vertices* on the true surface, so every face bulges
   * inward: the midpoint of an edge spanning `2π/W` sits at `cos(π/W)` of the
   * real radius. At W=10 that's 5 % thin; at W=5 it's 19 %. So a coarse tier is
   * a genuinely smaller object than the fine tier it replaces, and mid-crossfade
   * the dither pattern becomes visible *because the two silhouettes differ* — no
   * amount of blending fixes a size mismatch.
   *
   * Scaling each tier by `1/cos(π/W)^0.6` makes them all approximate the same
   * ideal surface instead of shrinking as they coarsen. The 0.6 exponent splits
   * the difference between matching the vertices (0) and matching the edge
   * midpoints (1), which is where the average silhouette error is smallest.
   */
  const inflate = 1 / Math.cos(Math.PI / widthSegments) ** 0.6

  /** The shape function: unit direction → surface point. Continuous everywhere. */
  const evalShape = (direction: Vector3, out: Vector3): Vector3 => {
    out.copy(direction).multiplyScalar(radius * inflate * lumpRadius(direction, lumps))
    if (scale) {
      out.multiply(scale)
    }
    if (cuts) {
      for (let c = 0; c < cuts.length; c++) {
        applyCutPlane(out, cuts[c]!)
      }
    }
    if (bottomPlane) {
      applyCutPlane(out, bottomPlane)
    }
    return out
  }

  // Small enough to resolve a bevel (which is ~7 % of the radius), large enough
  // that float cancellation in the difference doesn't dominate.
  const epsilon = 0.02

  for (let i = 0; i < position.count; i++) {
    _dir.set(array[i * 3]!, array[i * 3 + 1]!, array[i * 3 + 2]!).normalize()
    evalShape(_dir, _p)

    basisFrom(_dir, _t1, _t2)
    evalShape(_probe.copy(_dir).addScaledVector(_t1, epsilon).normalize(), _pa)
    evalShape(_probe.copy(_dir).addScaledVector(_t1, -epsilon).normalize(), _pb)
    evalShape(_probe.copy(_dir).addScaledVector(_t2, epsilon).normalize(), _pc)
    evalShape(_probe.copy(_dir).addScaledVector(_t2, -epsilon).normalize(), _pd)

    _du.subVectors(_pa, _pb)
    _dv.subVectors(_pc, _pd)
    _n.crossVectors(_du, _dv)

    if (_n.lengthSq() < 1e-16) {
      // Fully degenerate patch (can happen dead-centre on a flat cut); the
      // radial direction is the best available answer.
      _n.copy(_dir)
    } else {
      _n.normalize()
      if (_n.dot(_dir) < 0) {
        _n.negate()
      }
    }

    array[i * 3] = _p.x
    array[i * 3 + 1] = _p.y
    array[i * 3 + 2] = _p.z
    normals[i * 3] = _n.x
    normals[i * 3 + 1] = _n.y
    normals[i * 3 + 2] = _n.z
  }

  position.needsUpdate = true
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  // Geometry stays *indexed*: with analytic normals there's no reason to split
  // vertices, and the shared-vertex form halves the AO bake cost and the vertex
  // buffer. Only zero-area faces are pruned, from the index buffer alone.
  return dropDegenerateFaces(geometry)
}

// ─── Lofted tube ────────────────────────────────────────────────────────────

export interface Ring {
  center: Vector3
  radius: number
  /** Per-ring radial squash, for root flare and oval branches. */
  squash?: number
}

/**
 * Lofts an open-ended tube through a list of rings. Used for trunks and
 * branches — three's `CylinderGeometry` can't bend, taper non-linearly or flare
 * at the root, and caps we never see would eat 20 % of the tree's budget.
 *
 * Triangles = radialSegments × (rings − 1) × 2.
 */
export const tubeGeometry = (rings: readonly Ring[], radialSegments: number): BufferGeometry => {
  const ringCount = rings.length
  const positions = new Float32Array(ringCount * (radialSegments + 1) * 3)
  const uvs = new Float32Array(ringCount * (radialSegments + 1) * 2)

  for (let r = 0; r < ringCount; r++) {
    const ring = rings[r]!
    const squash = ring.squash ?? 1
    for (let s = 0; s <= radialSegments; s++) {
      const t = (s / radialSegments) * Math.PI * 2
      const i = (r * (radialSegments + 1) + s) * 3
      positions[i] = ring.center.x + Math.cos(t) * ring.radius
      positions[i + 1] = ring.center.y
      positions[i + 2] = ring.center.z + Math.sin(t) * ring.radius * squash
      const j = (r * (radialSegments + 1) + s) * 2
      uvs[j] = s / radialSegments
      uvs[j + 1] = r / (ringCount - 1)
    }
  }

  const indices: number[] = []
  for (let r = 0; r < ringCount - 1; r++) {
    for (let s = 0; s < radialSegments; s++) {
      const a = r * (radialSegments + 1) + s
      const b = a + 1
      const c = a + radialSegments + 1
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

// ─── Utilities ──────────────────────────────────────────────────────────────

/**
 * Prunes zero-area faces from the *index buffer*, leaving vertices and every
 * attribute untouched.
 *
 * A cut plane can collapse a triangle flat against the plane it clips to. Those
 * faces rasterise nothing but still count against the triangle budget, so they'd
 * quietly steal a few triangles from every rock's allowance.
 */
export const dropDegenerateFaces = (geometry: BufferGeometry, epsilon = 1e-10): BufferGeometry => {
  const index = geometry.index
  if (!index) {
    return geometry
  }
  const array = geometry.getAttribute('position').array as Float32Array
  const faceCount = index.count / 3
  const keep: number[] = []

  for (let f = 0; f < faceCount; f++) {
    const ia = index.getX(f * 3)
    const ib = index.getX(f * 3 + 1)
    const ic = index.getX(f * 3 + 2)
    const abx = array[ib * 3]! - array[ia * 3]!
    const aby = array[ib * 3 + 1]! - array[ia * 3 + 1]!
    const abz = array[ib * 3 + 2]! - array[ia * 3 + 2]!
    const acx = array[ic * 3]! - array[ia * 3]!
    const acy = array[ic * 3 + 1]! - array[ia * 3 + 1]!
    const acz = array[ic * 3 + 2]! - array[ia * 3 + 2]!
    const cx = aby * acz - abz * acy
    const cy = abz * acx - abx * acz
    const cz = abx * acy - aby * acx
    if (cx * cx + cy * cy + cz * cz > epsilon) {
      keep.push(ia, ib, ic)
    }
  }

  if (keep.length !== index.count) {
    geometry.setIndex(keep)
  }
  return geometry
}

/**
 * Per-vertex wind weight into `aWind`, consumed by the foliage wind vertex
 * shader. Keeping it an attribute rather than deriving it from height in the
 * shader means a trunk and its canopy can share one material and one draw call
 * while only the canopy moves.
 */
export const paintWindWeight = (
  geometry: BufferGeometry,
  weight: number | ((x: number, y: number, z: number) => number)
): BufferGeometry => {
  const position = geometry.getAttribute('position')
  const array = new Float32Array(position.count)
  if (typeof weight === 'number') {
    array.fill(weight)
  } else {
    for (let i = 0; i < position.count; i++) {
      array[i] = weight(position.getX(i), position.getY(i), position.getZ(i))
    }
  }
  geometry.setAttribute('aWind', new BufferAttribute(array, 1))
  return geometry
}
