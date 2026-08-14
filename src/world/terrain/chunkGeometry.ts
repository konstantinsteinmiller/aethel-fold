import { groundColorCore, type HeightfieldParams, heightAtCore, normalAtCore } from './heightfieldCore'

/**
 * ─── Chunk geometry, as plain typed arrays ──────────────────────────────────
 *
 * Deliberately three.js-free so the **worker and the main thread run the exact
 * same code**. A streaming system where the background path and the fallback
 * path are two different implementations is one where they drift, and the bug
 * only ever shows up on the machine that took the other branch.
 *
 * Everything returned is transferable: the worker hands these straight across
 * the wire with zero copies, and the main thread wraps them in a
 * `BufferGeometry` without touching the contents.
 */

export interface ChunkRequest {
  originX: number
  originZ: number
  /** Edge length in metres. */
  size: number
  /** Quads per edge. Triangles = 2·N² (+ 8·N with a skirt). */
  segments: number
  skirtDepth: number
  withSkirt: boolean
}

export interface ChunkBuffers {
  position: Float32Array
  normal: Float32Array
  color: Float32Array
  index: Uint16Array | Uint32Array
  /** Bounding sphere, so the main thread never has to walk the positions. */
  boundsY: [min: number, max: number]
}

/** Scratch, module-level: chunk building is hot and must not churn the GC. */
const _normal = new Float32Array(3)
const _color = new Float32Array(3)

export const vertexCountFor = (segments: number, withSkirt: boolean): number => {
  const side = segments + 1
  return side * side + (withSkirt ? side * 4 : 0)
}

/**
 * Builds one terrain chunk.
 *
 * Positions are **chunk-local** — the world offset lives on the node's
 * transform. At 384 m that is cosmetic; at the multi-kilometre extents
 * streaming makes possible it is the difference between smooth ground and
 * visible float-precision stair-stepping.
 */
export const buildChunkBuffers = (request: ChunkRequest, params: HeightfieldParams, palette: Float32Array): ChunkBuffers => {
  const { originX, originZ, size, segments, skirtDepth, withSkirt } = request
  const side = segments + 1
  const gridVertexCount = side * side
  const vertexCount = vertexCountFor(segments, withSkirt)

  const position = new Float32Array(vertexCount * 3)
  const normal = new Float32Array(vertexCount * 3)
  const color = new Float32Array(vertexCount * 3)
  const step = size / segments

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

      position[index * 3] = localX
      position[index * 3 + 1] = height
      position[index * 3 + 2] = localZ
      normal[index * 3] = _normal[0]!
      normal[index * 3 + 1] = _normal[1]!
      normal[index * 3 + 2] = _normal[2]!
      color[index * 3] = _color[0]!
      color[index * 3 + 1] = _color[1]!
      color[index * 3 + 2] = _color[2]!

      if (height < minY) {
        minY = height
      }
      if (height > maxY) {
        maxY = height
      }
    }
  }

  const triangleCount = segments * segments * 2 + (withSkirt ? segments * 8 : 0)
  // Uint16 tops out at 65 535 vertices; every tier here is far under that, but
  // the check is cheap and a silent wraparound would be a nightmare to trace.
  const index = vertexCount > 65535 ? new Uint32Array(triangleCount * 3) : new Uint16Array(triangleCount * 3)
  let cursor = 0

  for (let row = 0; row < segments; row++) {
    for (let column = 0; column < segments; column++) {
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

  if (withSkirt) {
    // Neighbouring chunks at different tiers don't share edge vertices, so a
    // hairline of sky shows through the seam. The border ring is duplicated and
    // dropped, forming a curtain that plugs the gap from any angle. Twins share
    // the top vertex's normal and colour, so on the frames they do show they are
    // indistinguishable from the surface.
    let vertexCursor = gridVertexCount

    const addEdge = (topIndices: number[]): void => {
      const bottomStart = vertexCursor
      for (const top of topIndices) {
        position[vertexCursor * 3] = position[top * 3]!
        position[vertexCursor * 3 + 1] = position[top * 3 + 1]! - skirtDepth
        position[vertexCursor * 3 + 2] = position[top * 3 + 2]!
        normal[vertexCursor * 3] = normal[top * 3]!
        normal[vertexCursor * 3 + 1] = normal[top * 3 + 1]!
        normal[vertexCursor * 3 + 2] = normal[top * 3 + 2]!
        color[vertexCursor * 3] = color[top * 3]!
        color[vertexCursor * 3 + 1] = color[top * 3 + 1]!
        color[vertexCursor * 3 + 2] = color[top * 3 + 2]!
        vertexCursor++
      }
      for (let i = 0; i < topIndices.length - 1; i++) {
        const topA = topIndices[i]!
        const topB = topIndices[i + 1]!
        const bottomA = bottomStart + i
        const bottomB = bottomStart + i + 1
        index[cursor++] = topA
        index[cursor++] = bottomA
        index[cursor++] = topB
        index[cursor++] = topB
        index[cursor++] = bottomA
        index[cursor++] = bottomB
      }
    }

    const north: number[] = []
    const south: number[] = []
    const west: number[] = []
    const east: number[] = []
    for (let i = 0; i < side; i++) {
      north.push(i)
      south.push((side - 1) * side + i)
      west.push(i * side)
      east.push(i * side + side - 1)
    }
    // Two edges are reversed so every skirt quad faces outward — a back-facing
    // skirt is culled and plugs nothing.
    addEdge(north.slice().reverse())
    addEdge(south)
    addEdge(west)
    addEdge(east.slice().reverse())

    minY -= skirtDepth
  }

  return { position, normal, color, index, boundsY: [minY, maxY] }
}
