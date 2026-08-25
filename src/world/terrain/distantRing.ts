import { COLOR_SCALE, type ChunkBuffers, NORMAL_SCALE } from './chunkGeometry'
import { groundColorCore, type HeightfieldParams, heightAtCore, normalAtCore } from './heightfieldCore'

/**
 * ─── The distant ring ───────────────────────────────────────────────────────
 *
 * One coarse mesh covering the ground the streamer does not reach.
 *
 * Streaming gives an unbounded world but a *bounded horizon*: chunks load to
 * 190 m and everything past that is empty sky the fog happens to be the same
 * colour as. On a hilltop that reads as standing on a small floating island,
 * which is exactly the "smallness" GDD §3 says aerial perspective exists to
 * defeat. This closes the gap out to kilometres for **one draw call**.
 *
 * ── Why a ring and not more chunks ──────────────────────────────────────────
 *
 * Extending `loadRadius` instead would cost quadratically: chunk count goes as
 * the square of the radius, each chunk is a draw call, and the frame is
 * **CPU-bound on draw submission** (measured: `renderMs` is 83–87 % of frame
 * CPU). Reaching 1.5 km with 48 m chunks would be ~3 000 chunks. This is one
 * mesh of a few thousand triangles.
 *
 * ── Why it has a hole ───────────────────────────────────────────────────────
 *
 * The alternative — a solid sheet under the streamed chunks — needs a downward
 * offset to lose the depth fight, and coarse sampling means the ring sits
 * *above* real ground wherever it cuts a corner off a valley. Then it pokes
 * through the detailed terrain, and no fixed offset removes that on steep
 * ground. Omitting the quads the streamer covers makes the question moot: the
 * two surfaces never overlap, and the seam sits at 190 m where exp² fog at
 * 0.0085 has already removed most of the contrast.
 *
 * Deliberately three.js-free, like `chunkGeometry` and for the same reason: the
 * same height, normal and colour functions must produce this mesh and the
 * detailed chunks, or the seam becomes a visible material change.
 */

export interface DistantRingRequest {
  /** Centre of the ring, snapped by the caller. */
  centerX: number
  centerZ: number
  /** Half-extent of the covered square, in metres. */
  outerRadius: number
  /**
   * Quads inside this radius are omitted — the streamer draws that ground.
   * Measured against the quad's *nearest* corner, so a quad is only dropped
   * when the whole of it is covered.
   */
  holeRadius: number
  /** Quads per edge across the full square. */
  segments: number
}

const _normal = new Float32Array(3)
const _color = new Float32Array(3)

/**
 * Builds the ring as transferable typed arrays.
 *
 * Vertices are emitted for the whole grid and the *index* buffer skips the
 * covered quads. Dropping vertices instead would need an index remap for a
 * saving of a few thousand floats on a mesh built a handful of times per
 * session — the unreferenced vertices cost upload bandwidth once and nothing
 * per frame, since the GPU never sees a vertex no triangle names.
 */
export const buildDistantRing = (
  request: DistantRingRequest,
  params: HeightfieldParams,
  palette: Float32Array
): ChunkBuffers => {
  const { centerX, centerZ, outerRadius, holeRadius, segments } = request
  const side = segments + 1
  const vertexCount = side * side
  const step = (outerRadius * 2) / segments
  const originX = centerX - outerRadius
  const originZ = centerZ - outerRadius

  const position = new Float32Array(vertexCount * 3)
  const normal = new Int16Array(vertexCount * 3)
  const color = new Uint16Array(vertexCount * 3)

  let minY = Infinity
  let maxY = -Infinity

  for (let row = 0; row < side; row++) {
    for (let column = 0; column < side; column++) {
      const index = row * side + column
      const localX = column * step
      const localZ = row * step
      const worldX = originX + localX
      const worldZ = originZ + localZ

      const height = heightAtCore(worldX, worldZ, params)
      normalAtCore(worldX, worldZ, params, _normal, 0)
      groundColorCore(worldX, worldZ, height, _normal[1]!, params, palette, _color, 0)

      // Local to the ring's own origin, so the mesh can sit at `originX/Z` and
      // keep float precision at kilometre distances from the world origin.
      position[index * 3] = localX
      position[index * 3 + 1] = height
      position[index * 3 + 2] = localZ
      normal[index * 3] = _normal[0]! * NORMAL_SCALE
      normal[index * 3 + 1] = _normal[1]! * NORMAL_SCALE
      normal[index * 3 + 2] = _normal[2]! * NORMAL_SCALE
      color[index * 3] = _color[0]! * COLOR_SCALE
      color[index * 3 + 1] = _color[1]! * COLOR_SCALE
      color[index * 3 + 2] = _color[2]! * COLOR_SCALE

      if (height < minY) {
        minY = height
      }
      if (height > maxY) {
        maxY = height
      }
    }
  }

  // Two passes over the quads: count, then fill. One `Uint32Array` allocated at
  // the right size beats growing an array of numbers and converting it.
  const holeSquared = holeRadius * holeRadius
  const covered = (row: number, column: number): boolean => {
    const x0 = originX + column * step
    const z0 = originZ + row * step
    const x1 = x0 + step
    const z1 = z0 + step
    // The **furthest** corner decides. A quad is skipped only when all of it is
    // inside the hole — testing the nearest corner instead would drop quads that
    // straddle the boundary and tear a gap in the ring at exactly the radius
    // where the streamer stops.
    const dx = Math.max(Math.abs(x0 - centerX), Math.abs(x1 - centerX))
    const dz = Math.max(Math.abs(z0 - centerZ), Math.abs(z1 - centerZ))
    return dx * dx + dz * dz <= holeSquared
  }

  let quads = 0
  for (let row = 0; row < segments; row++) {
    for (let column = 0; column < segments; column++) {
      if (!covered(row, column)) {
        quads++
      }
    }
  }

  const index = vertexCount > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6)
  let cursor = 0
  for (let row = 0; row < segments; row++) {
    for (let column = 0; column < segments; column++) {
      if (covered(row, column)) {
        continue
      }
      const a = row * side + column
      const b = a + 1
      const c = a + side
      const d = c + 1
      index[cursor++] = a
      index[cursor++] = c
      index[cursor++] = b
      index[cursor++] = b
      index[cursor++] = c
      index[cursor++] = d
    }
  }

  return {
    position,
    normal,
    color,
    index,
    boundsY: [minY === Infinity ? 0 : minY, maxY === -Infinity ? 0 : maxY]
  }
}

/** Triangles the request will produce. For budget assertions and tests. */
export const distantRingTriangleCount = (buffers: ChunkBuffers): number => buffers.index.length / 3
