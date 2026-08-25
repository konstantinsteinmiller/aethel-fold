import { Vector3 } from 'three'

/**
 * ─── Limbs as surfaces of revolution ────────────────────────────────────────
 *
 * The one primitive the chibi body is built from: a rounded, tapered tube
 * between two joints. Torsos, arms, legs, necks and the head are all this shape
 * with different radii — which is what keeps a whole character inside one
 * triangle budget and one shading solution.
 *
 * ── Normals come from the profile, not the mesh ─────────────────────────────
 *
 * GDD R3: normals are taken from the shape function, never from the tessellated
 * faces. Here the shape function is the radius profile `r(s)` along the axis, so
 * the surface normal at any point is
 *
 *     N ∝ radial − axis · r'(s)
 *
 * with `r'` central-differenced exactly as `blobGeometry` differences its own
 * shape function. A cylinder (`r' = 0`) gives a purely radial normal; a taper
 * tilts it toward the narrow end; a cap rolls it over smoothly. Angle-threshold
 * smoothing would give a different answer at every LOD tier — the trap
 * documented in `AAA-graphics.md` §3.
 *
 * ── Why the caps are part of the profile ────────────────────────────────────
 *
 * Spherical end caps are not appended as separate geometry; they *are* the
 * profile, extended past each joint by the end radius. One surface, one normal
 * rule, no seam to bevel — which is the cheapest possible way to satisfy "bevel
 * every cut" (GDD R1): there is no cut.
 */

export interface LimbOptions {
  /** Start joint, world space. */
  from: Vector3
  /** End joint, world space. */
  to: Vector3
  radiusStart: number
  radiusEnd: number
  /** Segments around the axis. */
  radial: number
  /** Segments along the lateral (non-cap) span. */
  rings: number
  /** Rings devoted to each spherical cap. 0 leaves the end open and flat. */
  capRings?: number
  /**
   * Scales the profile across the axis, before the axial squash below.
   * `[1, 1]` is circular; a torso wants to be wider than it is deep.
   */
  crossSection?: readonly [number, number]
}

export interface LimbMesh {
  position: Float32Array
  normal: Float32Array
  /**
   * Parametric position along the bone for every vertex: 0 at `from`, 1 at
   * `to`, negative inside the start cap and >1 inside the end cap.
   *
   * This is what the skinning weights are computed from — a vertex knows which
   * part of which bone it belongs to by construction, so nothing has to search
   * for a nearest bone afterwards and guess at a blend.
   */
  along: Float32Array
  index: Uint16Array
}

const _axis = new Vector3()
const _u = new Vector3()
const _v = new Vector3()
const _tmp = new Vector3()

/** Radius profile. `s` is arc position along the axis in metres from `from`. */
const profileAt = (s: number, length: number, radiusStart: number, radiusEnd: number): number => {
  if (s <= 0) {
    // Start cap: a sphere of `radiusStart` centred on the start joint.
    const k = Math.max(0, radiusStart * radiusStart - s * s)
    return Math.sqrt(k)
  }
  if (s >= length) {
    const d = s - length
    const k = Math.max(0, radiusEnd * radiusEnd - d * d)
    return Math.sqrt(k)
  }
  return radiusStart + (radiusEnd - radiusStart) * (s / length)
}

export const limbMesh = (options: LimbOptions): LimbMesh => {
  const { from, to, radiusStart, radiusEnd, radial, rings, capRings = 3, crossSection = [1, 1] } = options

  _axis.subVectors(to, from)
  const length = _axis.length()
  if (!(length > 1e-6)) {
    throw new Error('[limb] degenerate segment — from and to coincide')
  }
  _axis.multiplyScalar(1 / length)

  // Any perpendicular pair will do; picking the one furthest from the axis
  // avoids a degenerate cross product on vertical limbs, which is most of them.
  _u.set(0, 0, 1)
  if (Math.abs(_axis.dot(_u)) > 0.9) {
    _u.set(1, 0, 0)
  }
  _v.crossVectors(_axis, _u).normalize()
  _u.crossVectors(_v, _axis).normalize()

  // Sample positions along the axis: cap, lateral span, cap. Caps are sampled
  // with a cosine spacing so rings bunch toward the pole, where curvature is
  // highest — uniform spacing there is what makes a rounded end look faceted.
  const samples: number[] = []
  for (let i = 0; i <= capRings; i++) {
    const t = i / Math.max(1, capRings)
    samples.push(-radiusStart * Math.cos((t * Math.PI) / 2))
  }
  for (let i = 1; i <= rings; i++) {
    samples.push((i / rings) * length)
  }
  for (let i = 1; i <= capRings; i++) {
    const t = i / Math.max(1, capRings)
    samples.push(length + radiusEnd * Math.sin((t * Math.PI) / 2))
  }

  const ringCount = samples.length
  const vertexCount = ringCount * (radial + 1)
  const position = new Float32Array(vertexCount * 3)
  const normal = new Float32Array(vertexCount * 3)
  const along = new Float32Array(vertexCount)

  // Central-difference step for the profile derivative. Scaled to the limb so a
  // 0.02 m arm and a 0.4 m torso both differentiate over a comparable fraction.
  const epsilon = Math.max(1e-4, length * 0.01)

  let cursor = 0
  for (let ring = 0; ring < ringCount; ring++) {
    const s = samples[ring]!
    const r = profileAt(s, length, radiusStart, radiusEnd)
    const dr = (profileAt(s + epsilon, length, radiusStart, radiusEnd) - profileAt(s - epsilon, length, radiusStart, radiusEnd)) / (2 * epsilon)

    for (let step = 0; step <= radial; step++) {
      const angle = (step / radial) * Math.PI * 2
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)

      // Radial direction, squashed by the cross-section. The normal has to be
      // squashed by the *reciprocal* or an elliptical torso would shade like a
      // circular one — the classic non-uniform-scale normal error.
      const rx = cos * crossSection[0]
      const rz = sin * crossSection[1]

      _tmp
        .copy(from)
        .addScaledVector(_axis, s)
        .addScaledVector(_u, rx * r)
        .addScaledVector(_v, rz * r)
      position[cursor * 3] = _tmp.x
      position[cursor * 3 + 1] = _tmp.y
      position[cursor * 3 + 2] = _tmp.z

      const nu = (cos / crossSection[0]) * 1
      const nv = (sin / crossSection[1]) * 1
      _tmp
        .set(0, 0, 0)
        .addScaledVector(_u, nu)
        .addScaledVector(_v, nv)
        .addScaledVector(_axis, -dr)
      // A pole ring has r = 0, so the radial part vanishes and only the axial
      // term survives — which is the correct pole normal, but it arrives as a
      // zero-length vector when `dr` is also small. Fall back to the axis.
      if (_tmp.lengthSq() < 1e-12) {
        _tmp.copy(_axis).multiplyScalar(s < 0 ? -1 : 1)
      }
      _tmp.normalize()
      normal[cursor * 3] = _tmp.x
      normal[cursor * 3 + 1] = _tmp.y
      normal[cursor * 3 + 2] = _tmp.z

      along[cursor] = s / length
      cursor++
    }
  }

  const quads = (ringCount - 1) * radial
  const index = new Uint16Array(quads * 6)
  let write = 0
  for (let ring = 0; ring < ringCount - 1; ring++) {
    for (let step = 0; step < radial; step++) {
      const a = ring * (radial + 1) + step
      const b = a + 1
      const c = a + (radial + 1)
      const d = c + 1
      index[write++] = a
      index[write++] = c
      index[write++] = b
      index[write++] = b
      index[write++] = c
      index[write++] = d
    }
  }

  return { position, normal, along, index }
}
