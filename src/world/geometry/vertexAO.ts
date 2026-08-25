import type { BufferGeometry } from 'three'

/**
 * ─── Baked vertex ambient occlusion ─────────────────────────────────────────
 *
 * The other half of "low-poly but AAA" (GDD R1). Interior detail must come from
 * colour, not geometry, and AO is what tells the eye that a crevice is a
 * crevice. Baking it into vertex colours costs zero runtime and zero texture
 * memory — the whole reason the world ships with no prop textures at all.
 *
 * This is a real hemisphere ray-cast, not a fake-AO height gradient. It's
 * affordable because assets are tiny (≤200 tris): 600 verts × 16 rays × 200
 * tris ≈ 2M ray-triangle tests, a few milliseconds with a flat-array
 * Möller–Trumbore. `three.Raycaster` was ~20× slower here purely from Vector3
 * allocation, so this walks the raw Float32Array instead.
 */

export interface VertexAOOptions {
  /** Rays per vertex. 16 is plenty for a low-poly silhouette; 32 for hero props. */
  samples?: number
  /** Rays longer than this don't occlude. Scale it to the object, not the world. */
  maxDistance?: number
  /** Start offset along the normal, to avoid self-hits at t≈0. */
  bias?: number
  /** 1 = full range, <1 lifts the darkest value. */
  strength?: number
  /** Contrast curve on the result. >1 keeps more of the surface bright. */
  power?: number
  /**
   * Tests every triangle for every ray, skipping the reachability cull.
   *
   * Exists so the fast path can be checked against the naive one rather than
   * against a second copy of the sampler written in a test — an "equivalent"
   * reference implementation that drifts is worse than no test. Slower by
   * design; nothing in the app sets it.
   */
  bruteForce?: boolean
}

/** Branchless orthonormal basis from a unit vector (Duff et al. 2017). */
const onb = (nx: number, ny: number, nz: number, out: Float32Array): void => {
  const sign = nz >= 0 ? 1 : -1
  const a = -1 / (sign + nz)
  const b = nx * ny * a
  out[0] = 1 + sign * nx * nx * a
  out[1] = sign * b
  out[2] = -sign * nx
  out[3] = b
  out[4] = sign + ny * ny * a
  out[5] = -ny
}

const _basis = new Float32Array(6)

/**
 * Cumulative bake cost and work done, for attributing catalogue build time.
 *
 * The placeable drain's floor is its most expensive single asset, so "what is
 * slow to generate" is a number with consequences. This is the obvious suspect —
 * `vertices × samples × triangles` ray-triangle tests — but suspicion is not
 * measurement, and this project has already spent a session learning what
 * unmeasured suspicion costs.
 */
export const aoStats = { ms: 0, bakes: 0, rayTriangleTests: 0, rayTriangleTestsBrute: 0 }

/**
 * Returns per-vertex accessibility in [0,1] — 1 = fully open, 0 = fully buried.
 * Does not touch the geometry; feed the result to `applyVertexAO`.
 */
export const bakeVertexAO = (geometry: BufferGeometry, options: VertexAOOptions = {}): Float32Array => {
  const { samples = 16, maxDistance = 1, bias = 1e-3, strength = 1, power = 1, bruteForce = false } = options
  const startedAt = performance.now()

  const positionAttr = geometry.getAttribute('position')
  const normalAttr = geometry.getAttribute('normal')
  if (!normalAttr) {
    throw new Error('bakeVertexAO: geometry has no normals — author them first')
  }

  // Flat copies: attribute getters go through a class with bounds checks, and
  // this is the hot loop.
  const pos = positionAttr.array as Float32Array
  const nor = normalAttr.array as Float32Array
  const vertexCount = positionAttr.count

  // Triangle soup to test against — the geometry's own faces.
  const index = geometry.index
  const triCount = index ? index.count / 3 : vertexCount / 3
  const tri = new Float32Array(triCount * 9)
  for (let f = 0; f < triCount; f++) {
    for (let corner = 0; corner < 3; corner++) {
      const vi = index ? index.getX(f * 3 + corner) : f * 3 + corner
      tri[f * 9 + corner * 3] = pos[vi * 3]!
      tri[f * 9 + corner * 3 + 1] = pos[vi * 3 + 1]!
      tri[f * 9 + corner * 3 + 2] = pos[vi * 3 + 2]!
    }
  }

  // ── Per-triangle bounding spheres, for the reachability cull below ─────────
  //
  // Centroid plus the distance to its furthest corner. Cheap to build (one pass
  // over the soup) and it is what lets a vertex skip the triangles it provably
  // cannot reach.
  const centroid = new Float32Array(triCount * 3)
  const triRadius = new Float32Array(triCount)
  for (let f = 0; f < triCount; f++) {
    const o = f * 9
    const cx = (tri[o]! + tri[o + 3]! + tri[o + 6]!) / 3
    const cy = (tri[o + 1]! + tri[o + 4]! + tri[o + 7]!) / 3
    const cz = (tri[o + 2]! + tri[o + 5]! + tri[o + 8]!) / 3
    centroid[f * 3] = cx
    centroid[f * 3 + 1] = cy
    centroid[f * 3 + 2] = cz
    let worst = 0
    for (let corner = 0; corner < 3; corner++) {
      const ex = tri[o + corner * 3]! - cx
      const ey = tri[o + corner * 3 + 1]! - cy
      const ez = tri[o + corner * 3 + 2]! - cz
      const d2 = ex * ex + ey * ey + ez * ez
      if (d2 > worst) {
        worst = d2
      }
    }
    triRadius[f] = Math.sqrt(worst)
  }

  const candidates = new Int32Array(triCount)

  const ao = new Float32Array(vertexCount)
  const invSamples = 1 / samples
  let tests = 0

  for (let v = 0; v < vertexCount; v++) {
    const nx = nor[v * 3]!
    const ny = nor[v * 3 + 1]!
    const nz = nor[v * 3 + 2]!
    const ox = pos[v * 3]! + nx * bias
    const oy = pos[v * 3 + 1]! + ny * bias
    const oz = pos[v * 3 + 2]! + nz * bias

    // ── Reachability cull ────────────────────────────────────────────────────
    //
    // Every ray from this vertex stops at `maxDistance` — `nearest` starts there
    // and only shrinks — so a triangle whose bounding sphere lies further than
    // that from the origin cannot be hit by *any* of this vertex's rays. Testing
    // it once per vertex replaces testing it once per vertex **per sample**.
    //
    // The output is bit-identical: this removes only triangles that could not
    // have produced a hit, and the surviving order is unchanged (the loop takes
    // a minimum, so order would not matter anyway).
    let candidateCount = 0
    for (let f = 0; f < triCount; f++) {
      if (bruteForce) {
        candidates[candidateCount++] = f
        continue
      }
      const cx = ox - centroid[f * 3]!
      const cy = oy - centroid[f * 3 + 1]!
      const cz = oz - centroid[f * 3 + 2]!
      const reach = maxDistance + triRadius[f]!
      if (cx * cx + cy * cy + cz * cz <= reach * reach) {
        candidates[candidateCount++] = f
      }
    }
    tests += candidateCount * samples

    onb(nx, ny, nz, _basis)

    // Per-vertex rotation of the sample set. Without it every vertex shoots the
    // same directions and the AO shows a repeating pattern across flat areas.
    const jitter = (v * 0.6180339887498949) % 1

    let occlusion = 0
    for (let s = 0; s < samples; s++) {
      // Cosine-weighted hemisphere via Hammersley — the cosine weighting means
      // the sample density already matches the N·L falloff, so no per-ray dot.
      const u1 = (s + 0.5) * invSamples
      // Radical inverse base 2, rotated by the per-vertex jitter.
      let bits = s
      bits = ((bits >>> 16) | (bits << 16)) >>> 0
      bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0
      bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0
      bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0
      bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0
      const u2 = ((bits >>> 0) / 4294967296 + jitter) % 1

      const r = Math.sqrt(u1)
      const theta = 2 * Math.PI * u2
      const tx = r * Math.cos(theta)
      const ty = r * Math.sin(theta)
      const tz = Math.sqrt(Math.max(0, 1 - u1))

      const dx = _basis[0]! * tx + _basis[3]! * ty + nx * tz
      const dy = _basis[1]! * tx + _basis[4]! * ty + ny * tz
      const dz = _basis[2]! * tx + _basis[5]! * ty + nz * tz

      // Nearest hit along this ray, so falloff uses the closest blocker.
      let nearest = maxDistance
      for (let c = 0; c < candidateCount; c++) {
        const o = candidates[c]! * 9
        const ax = tri[o]!
        const ay = tri[o + 1]!
        const az = tri[o + 2]!
        const e1x = tri[o + 3]! - ax
        const e1y = tri[o + 4]! - ay
        const e1z = tri[o + 5]! - az
        const e2x = tri[o + 6]! - ax
        const e2y = tri[o + 7]! - ay
        const e2z = tri[o + 8]! - az

        // Möller–Trumbore, double-sided (a stylised rock's shell is thin and
        // back-face culling here would leak light through it).
        const px = dy * e2z - dz * e2y
        const py = dz * e2x - dx * e2z
        const pz = dx * e2y - dy * e2x
        const det = e1x * px + e1y * py + e1z * pz
        if (det > -1e-9 && det < 1e-9) {
          continue
        }
        const invDet = 1 / det
        const sx = ox - ax
        const sy = oy - ay
        const sz = oz - az
        const u = (sx * px + sy * py + sz * pz) * invDet
        if (u < 0 || u > 1) {
          continue
        }
        const qx = sy * e1z - sz * e1y
        const qy = sz * e1x - sx * e1z
        const qz = sx * e1y - sy * e1x
        const vv = (dx * qx + dy * qy + dz * qz) * invDet
        if (vv < 0 || u + vv > 1) {
          continue
        }
        const t = (e2x * qx + e2y * qy + e2z * qz) * invDet
        if (t > 1e-4 && t < nearest) {
          nearest = t
        }
      }

      if (nearest < maxDistance) {
        // Linear falloff: a blocker at arm's length shades far less than one
        // pressed against the surface. Constant occlusion looks like dirt.
        occlusion += 1 - nearest / maxDistance
      }
    }

    let value = 1 - (occlusion * invSamples) * strength
    if (power !== 1) {
      value = value ** power
    }
    ao[v] = value < 0 ? 0 : value > 1 ? 1 : value
  }

  aoStats.ms += performance.now() - startedAt
  aoStats.bakes++
  aoStats.rayTriangleTests += tests
  aoStats.rayTriangleTestsBrute += vertexCount * samples * triCount

  return ao
}
