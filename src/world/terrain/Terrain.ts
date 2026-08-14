import type { PerspectiveCamera } from 'three'
import { BufferAttribute, BufferGeometry, Color, Frustum, Group, Matrix4, Sphere, Vector3 } from 'three'
import type { WorldAsset } from '../assets/types'
import { assertTriBudget } from '../geometry/budget'
import { DitheredLod } from '../lod/DitheredLod'
import { groundColorAt, type Heightfield } from './heightfield'
import { TerrainMaterial } from './TerrainMaterial'

/**
 * ─── Chunked cel-shaded terrain ─────────────────────────────────────────────
 *
 * The ground is an object like any other, so it obeys the same contract: four
 * LOD tiers, dithered crossfade, no textures, colour baked to vertices.
 *
 * Two terrain-specific problems, and how each is handled:
 *
 * **Cracks.** Neighbouring chunks at different tiers don't share edge vertices,
 * so a hairline of sky shows through the seam. Solved with **skirts** — the
 * border ring is duplicated and dropped 2.5 m, forming a vertical curtain that
 * plugs the gap from any viewing angle. Skirts cost 8·N triangles per chunk and
 * are omitted at LOD3, where the seam is sub-pixel.
 *
 * **Shading pop.** Normals come from the heightfield's analytic gradient, not
 * from the mesh, so every tier shades identically. Without this the terrain
 * would flash a new lighting solution at each LOD boundary — and unlike a
 * silhouette change, a shading change across a whole hillside is not something
 * a dither crossfade can hide.
 */

export interface TerrainOptions {
  /** Total square extent in metres. */
  size?: number
  /** Edge length of one chunk. `size / chunkSize` must be a whole number. */
  chunkSize?: number
  /** How far the border skirt hangs below the surface. */
  skirtDepth?: number
}

/** Quads per chunk edge, per tier. Triangles = 2·N² (+ 8·N with a skirt). */
const TIER_SEGMENTS = [24, 12, 6, 3] as const
const TIER_BUDGETS = [1400, 400, 128, 24] as const
/** LOD3 is far enough that a seam is sub-pixel; the skirt is pure waste there. */
const SKIRT_TIERS = 3

const _scratchNormal = new Vector3()
const _scratchColor = new Color()
const _frustum = new Frustum()
const _viewProjection = new Matrix4()
const _sphere = new Sphere()

/**
 * Builds one chunk at one tier. Positions are chunk-local (the chunk's
 * `DitheredLod` carries the world offset) so vertex precision stays high far
 * from the origin.
 */
const buildChunkGeometry = (
  field: Heightfield,
  originX: number,
  originZ: number,
  size: number,
  segments: number,
  skirtDepth: number,
  withSkirt: boolean
): BufferGeometry => {
  const side = segments + 1
  const gridVertexCount = side * side
  const skirtVertexCount = withSkirt ? side * 4 : 0
  const vertexCount = gridVertexCount + skirtVertexCount

  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const colors = new Float32Array(vertexCount * 3)
  const step = size / segments

  for (let row = 0; row < side; row++) {
    for (let column = 0; column < side; column++) {
      const index = row * side + column
      const localX = column * step
      const localZ = row * step
      const worldX = originX + localX
      const worldZ = originZ + localZ

      const height = field.heightAt(worldX, worldZ)
      field.normalAt(worldX, worldZ, _scratchNormal)
      groundColorAt(field, worldX, worldZ, height, _scratchNormal.y, _scratchColor)

      positions[index * 3] = localX
      positions[index * 3 + 1] = height
      positions[index * 3 + 2] = localZ
      normals[index * 3] = _scratchNormal.x
      normals[index * 3 + 1] = _scratchNormal.y
      normals[index * 3 + 2] = _scratchNormal.z
      colors[index * 3] = _scratchColor.r
      colors[index * 3 + 1] = _scratchColor.g
      colors[index * 3 + 2] = _scratchColor.b
    }
  }

  const indices: number[] = []
  for (let row = 0; row < segments; row++) {
    for (let column = 0; column < segments; column++) {
      const a = row * side + column
      const b = a + 1
      const c = a + side
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }

  if (withSkirt) {
    // Each border vertex gets a twin dropped by `skirtDepth`, sharing its normal
    // and colour so the curtain is invisible in the frames where it does show.
    let cursor = gridVertexCount
    const addSkirtEdge = (topIndices: number[]): void => {
      const bottomStart = cursor
      for (const top of topIndices) {
        positions[cursor * 3] = positions[top * 3]!
        positions[cursor * 3 + 1] = positions[top * 3 + 1]! - skirtDepth
        positions[cursor * 3 + 2] = positions[top * 3 + 2]!
        normals[cursor * 3] = normals[top * 3]!
        normals[cursor * 3 + 1] = normals[top * 3 + 1]!
        normals[cursor * 3 + 2] = normals[top * 3 + 2]!
        colors[cursor * 3] = colors[top * 3]!
        colors[cursor * 3 + 1] = colors[top * 3 + 1]!
        colors[cursor * 3 + 2] = colors[top * 3 + 2]!
        cursor++
      }
      for (let i = 0; i < topIndices.length - 1; i++) {
        const topA = topIndices[i]!
        const topB = topIndices[i + 1]!
        const bottomA = bottomStart + i
        const bottomB = bottomStart + i + 1
        indices.push(topA, bottomA, topB, topB, bottomA, bottomB)
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
    // Winding is reversed on two of the four edges so every skirt quad faces
    // outward — a back-facing skirt is culled and plugs nothing.
    addSkirtEdge(north.slice().reverse())
    addSkirtEdge(south)
    addSkirtEdge(west)
    addSkirtEdge(east.slice().reverse())
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

export class Terrain {
  readonly group = new Group()
  readonly field: Heightfield
  readonly chunks: DitheredLod[] = []

  private readonly chunkCenters: Vector3[] = []
  private readonly chunkRadius: number

  constructor(field: Heightfield, options: TerrainOptions = {}) {
    const { size = 384, chunkSize = 48, skirtDepth = 2.5 } = options
    this.field = field
    this.group.name = 'terrain'
    this.group.userData.perfTag = 'terrain'

    const chunksPerSide = Math.round(size / chunkSize)
    const half = size / 2
    // Diagonal half-extent plus the tallest plausible height swing, for the
    // per-chunk frustum test.
    this.chunkRadius = Math.sqrt(2) * chunkSize * 0.5 + 34

    // One shared material template. `DitheredLod` clones it per tier so each
    // gets its own `uFade`, and the clones all hit the same compiled program.
    const materialTemplate = new TerrainMaterial({
      // Terrain gets a softer shadow tint than props: at this scale a strong
      // periwinkle push over whole hillsides reads as blue haze on the ground
      // rather than as shadow.
      shadowTintMix: 0.26,
      rimStrength: 0.18
    })

    for (let cz = 0; cz < chunksPerSide; cz++) {
      for (let cx = 0; cx < chunksPerSide; cx++) {
        const originX = -half + cx * chunkSize
        const originZ = -half + cz * chunkSize

        const tiers: BufferGeometry[] = TIER_SEGMENTS.map((segments, tier) =>
          assertTriBudget(
            buildChunkGeometry(field, originX, originZ, chunkSize, segments, skirtDepth, tier < SKIRT_TIERS),
            TIER_BUDGETS[tier]!,
            `terrain/${cx}_${cz}/LOD${tier}`
          )
        )

        const asset: WorldAsset = {
          name: `terrain-${cx}-${cz}`,
          perfTag: 'terrain',
          tiers,
          material: materialTemplate,
          // Never outlined: an inverted hull on a chunk draws a hard line
          // around the chunk boundary, which is exactly the seam the skirts
          // exist to hide.
          outline: null,
          outlineMaxTier: -1,
          radius: this.chunkRadius,
          // A 48 m chunk is two orders of magnitude larger than a pebble, so it
          // holds detail correspondingly further out.
          distanceScale: 3.2
        }

        const chunk = new DitheredLod(asset)
        chunk.position.set(originX, 0, originZ)
        // Chunks are the biggest receivers in the scene and never cast — a
        // hill shadowing another hill isn't worth 64 extra shadow draws.
        for (const mesh of chunk.tierMeshes) {
          mesh.castShadow = false
          mesh.receiveShadow = true
        }
        this.group.add(chunk)
        this.chunks.push(chunk)
        this.chunkCenters.push(new Vector3(originX + chunkSize / 2, 0, originZ + chunkSize / 2))
      }
    }
  }

  /**
   * Frustum-culls whole chunks before running their LOD update. Unlike scatter
   * props, chunks are few and huge, so a per-chunk test is nearly free and
   * removes ~70 % of the terrain's draw calls in a typical view.
   */
  update(camera: PerspectiveCamera, cameraPosition: Vector3): void {
    _viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    _frustum.setFromProjectionMatrix(_viewProjection)

    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i]!
      _sphere.center.copy(this.chunkCenters[i]!)
      _sphere.radius = this.chunkRadius

      if (!_frustum.intersectsSphere(_sphere)) {
        chunk.visible = false
        continue
      }
      chunk.visible = true
      chunk.update(cameraPosition)
    }
  }

  /** Convenience for placing props and the camera on the ground. */
  heightAt(x: number, z: number): number {
    return this.field.heightAt(x, z)
  }

  dispose(): void {
    for (const chunk of this.chunks) {
      chunk.dispose()
      for (const geometry of chunk.asset.tiers) {
        geometry.dispose()
      }
    }
    this.chunks.length = 0
    this.group.clear()
  }
}
