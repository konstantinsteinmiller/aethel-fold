import type { BufferGeometry } from 'three'
import { BufferAttribute, Vector3 } from 'three'

/**
 * ─── Normal authoring ───────────────────────────────────────────────────────
 *
 * The single highest-leverage file in the art pipeline (GDD R2 / R3).
 *
 * Geometrically-correct normals are *correct* and *ugly*: on a 40-triangle leaf
 * clump they shatter the toon bands into per-face steps and the thing reads as
 * cheap facet-art. Every generator in `src/world/assets/` therefore ends with a
 * normal-authoring pass from this file. Nothing calls `computeVertexNormals()`
 * directly.
 *
 * All functions mutate in place and return the geometry, so they chain:
 *
 *   smoothNormalsByAngle(geo, 38)
 *   blendNormalsToSphere(geo, clumpCentre, 0.85)
 */

// Module-level scratch. `src/world/` allocates nothing per-call (GDD §5.2);
// generators run at boot but the same discipline keeps them off the GC.
const _a = new Vector3()
const _b = new Vector3()
const _c = new Vector3()
const _ab = new Vector3()
const _ac = new Vector3()
const _n = new Vector3()
const _target = new Vector3()

/** Position-quantisation step for welding coincident vertices (1/10 mm). */
const WELD_EPSILON = 1e4

const weldKey = (x: number, y: number, z: number): string =>
  `${Math.round(x * WELD_EPSILON)},${Math.round(y * WELD_EPSILON)},${Math.round(z * WELD_EPSILON)}`

/**
 * Angle-threshold ("smoothing group") normals — GDD R2.
 *
 * For every triangle corner, averages the normals of all faces that share that
 * *position* AND sit within `angleDeg` of the corner's own face, weighted by
 * face area. Faces meeting at a sharper angle are excluded, so a genuine corner
 * stays crisp while a curved surface goes smooth.
 *
 * 38° is the project default: an icosphere-derived rock has ~30° between
 * adjacent faces (smooths) while a real corner is ≥60° (stays sharp).
 *
 * The result is per-corner, not per-vertex, so the geometry is converted to
 * non-indexed. At our budgets (≤200 tris) the extra vertices are free, and the
 * alternative — splitting only where needed — is a lot of code for nothing.
 */
export const smoothNormalsByAngle = (geometry: BufferGeometry, angleDeg = 38): BufferGeometry => {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry
  // `toNonIndexed` returns a new object; copy it back over the caller's handle
  // so the mutate-in-place contract holds for the object they already own.
  if (geo !== geometry) {
    geometry.copy(geo)
    geometry.setIndex(null)
  }

  const position = geometry.getAttribute('position')
  const vertexCount = position.count
  const faceCount = vertexCount / 3
  const cosLimit = Math.cos((angleDeg * Math.PI) / 180)

  // Face normals, scaled by area so large faces dominate the average — an
  // unweighted mean lets a sliver triangle swing a whole vertex.
  const faceNormals = new Float32Array(faceCount * 3)

  for (let f = 0; f < faceCount; f++) {
    const i = f * 3
    _a.fromBufferAttribute(position, i)
    _b.fromBufferAttribute(position, i + 1)
    _c.fromBufferAttribute(position, i + 2)
    _ab.subVectors(_b, _a)
    _ac.subVectors(_c, _a)
    // Cross product magnitude is 2× the triangle area — exactly the weight we
    // want, so it's stored un-normalised on purpose.
    _n.crossVectors(_ab, _ac)
    faceNormals[f * 3] = _n.x
    faceNormals[f * 3 + 1] = _n.y
    faceNormals[f * 3 + 2] = _n.z
  }

  // position key -> face indices touching it
  const buckets = new Map<string, number[]>()
  for (let f = 0; f < faceCount; f++) {
    for (let corner = 0; corner < 3; corner++) {
      const vi = f * 3 + corner
      const key = weldKey(position.getX(vi), position.getY(vi), position.getZ(vi))
      const bucket = buckets.get(key)
      if (bucket) {
        bucket.push(f)
      } else {
        buckets.set(key, [f])
      }
    }
  }

  const out = new Float32Array(vertexCount * 3)

  for (let f = 0; f < faceCount; f++) {
    // Unit face normal for the angle comparison.
    _n.set(faceNormals[f * 3]!, faceNormals[f * 3 + 1]!, faceNormals[f * 3 + 2]!)
    const faceLen = _n.length()
    if (faceLen === 0) {
      continue
    }
    _n.divideScalar(faceLen)

    for (let corner = 0; corner < 3; corner++) {
      const vi = f * 3 + corner
      const key = weldKey(position.getX(vi), position.getY(vi), position.getZ(vi))
      const bucket = buckets.get(key)!

      let sx = 0
      let sy = 0
      let sz = 0
      for (let k = 0; k < bucket.length; k++) {
        const g = bucket[k]!
        const gx = faceNormals[g * 3]!
        const gy = faceNormals[g * 3 + 1]!
        const gz = faceNormals[g * 3 + 2]!
        const gLen = Math.sqrt(gx * gx + gy * gy + gz * gz)
        if (gLen === 0) {
          continue
        }
        // Compare unit-to-unit, accumulate area-weighted.
        if ((gx * _n.x + gy * _n.y + gz * _n.z) / gLen >= cosLimit) {
          sx += gx
          sy += gy
          sz += gz
        }
      }

      const len = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1
      out[vi * 3] = sx / len
      out[vi * 3 + 1] = sy / len
      out[vi * 3 + 2] = sz / len
    }
  }

  geometry.setAttribute('normal', new BufferAttribute(out, 3))
  return geometry
}

/**
 * Blend normals toward "outward from a point" — the foliage law (GDD R3).
 *
 * A leaf clump is *conceptually* a sphere. Shading it as one — regardless of the
 * angular polyhedron actually rendered — makes the toon bands wrap in a single
 * clean arc across the clump. At strength 0.85 the geometric normal survives
 * just enough to keep the silhouette lobes from looking painted on.
 *
 * `radiusBias` > 0 pushes the virtual centre *below* the sample, flattening the
 * shading toward the top of the clump; useful for wide, shallow canopies.
 */
export const blendNormalsToSphere = (
  geometry: BufferGeometry,
  center: Vector3,
  strength = 0.85,
  radiusBias = 0
): BufferGeometry => {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  if (!normal) {
    throw new Error('blendNormalsToSphere: geometry has no normals — run smoothNormalsByAngle first')
  }

  for (let i = 0; i < position.count; i++) {
    _a.fromBufferAttribute(position, i)
    _target.set(_a.x - center.x, _a.y - center.y - radiusBias, _a.z - center.z)
    if (_target.lengthSq() < 1e-12) {
      continue
    }
    _target.normalize()
    _n.fromBufferAttribute(normal, i).lerp(_target, strength).normalize()
    normal.setXYZ(i, _n.x, _n.y, _n.z)
  }
  normal.needsUpdate = true
  return geometry
}

/**
 * Blend normals toward world up. For ground scatter (grass, small plants) —
 * a blade lit by its true normal self-shades into a dark speck and the field
 * reads as litter; lit as if it were the ground plane it sits on, the field
 * reads as one surface with texture. Strength 0.6 per GDD R3.
 */
export const blendNormalsToUp = (geometry: BufferGeometry, strength = 0.6): BufferGeometry => {
  const normal = geometry.getAttribute('normal')
  if (!normal) {
    throw new Error('blendNormalsToUp: geometry has no normals')
  }
  for (let i = 0; i < normal.count; i++) {
    _n.fromBufferAttribute(normal, i)
    _n.x *= 1 - strength
    _n.z *= 1 - strength
    _n.y = _n.y * (1 - strength) + strength
    _n.normalize()
    normal.setXYZ(i, _n.x, _n.y, _n.z)
  }
  normal.needsUpdate = true
  return geometry
}

/**
 * Blend normals toward "radially outward from an axis" — trunks and branches.
 *
 * A 6-sided trunk shaded cylindrically is indistinguishable from a 16-sided one
 * at any distance the player will ever see it from, which is where a third of
 * the tree's triangle budget comes from.
 */
export const blendNormalsToCylinder = (
  geometry: BufferGeometry,
  origin: Vector3,
  axis: Vector3,
  strength = 0.9
): BufferGeometry => {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  if (!normal) {
    throw new Error('blendNormalsToCylinder: geometry has no normals')
  }
  _b.copy(axis).normalize()

  for (let i = 0; i < position.count; i++) {
    _a.fromBufferAttribute(position, i).sub(origin)
    // Reject the axial component to get the radial direction.
    const along = _a.dot(_b)
    _target.copy(_a).addScaledVector(_b, -along)
    if (_target.lengthSq() < 1e-10) {
      continue
    }
    _target.normalize()
    _n.fromBufferAttribute(normal, i).lerp(_target, strength).normalize()
    normal.setXYZ(i, _n.x, _n.y, _n.z)
  }
  normal.needsUpdate = true
  return geometry
}
