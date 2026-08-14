import type { PerspectiveCamera } from 'three'
import { BufferAttribute, BufferGeometry, Frustum, Group, Matrix4, Sphere, Vector3 } from 'three'
import type { WorldAsset } from '../assets/types'
import { C } from '../art/palette'
import { DitheredLod } from '../lod/DitheredLod'
import type { ChunkRequest } from './chunkGeometry'
import { vertexCountFor } from './chunkGeometry'
import { ChunkWorkerPool } from './ChunkWorkerPool'
import type { Heightfield } from './heightfield'
import { TERRAIN_PALETTE_SLOTS } from './heightfieldCore'
import { TerrainMaterial } from './TerrainMaterial'

/**
 * ─── Streaming chunked terrain ──────────────────────────────────────────────
 *
 * Chunks are generated on a worker, uploaded under a per-frame time budget, and
 * unloaded behind the player. The world is no longer bounded by what fits in a
 * boot-time build.
 *
 * Four rules keep it from being felt:
 *
 * **Budget, don't burst.** Geometry construction and GPU upload are main-thread
 * work no worker can take. The ready queue is drained against a millisecond
 * budget, so a burst of arrivals spreads over frames. A chunk three frames late
 * is invisible; a 40 ms hitch is not — which is exactly what the profiler's p99
 * and `jankFrames` exist to catch.
 *
 * **Hysteresis.** Unload radius is wider than load radius. Without the gap, a
 * player pacing a boundary loads and unloads the same chunk forever.
 *
 * **Predict.** The load centre leads the camera along its velocity, so chunks
 * arrive before they're needed rather than popping in once they already should
 * have been visible.
 *
 * **Pool.** Nodes and their GPU buffers are reused. Chunk sizes are fixed per
 * tier, so a recycled node's buffers are always the right shape — new data is
 * copied in and re-uploaded rather than allocating a fresh geometry, which
 * would churn both the GC and the driver's buffer pool during traversal.
 */

/** Quads per chunk edge, per tier. Triangles = 2·N² (+ 8·N with a skirt). */
const TIER_SEGMENTS = [24, 12, 6, 3] as const
/** LOD3 is far enough that a seam is sub-pixel; the skirt is pure waste there. */
const SKIRT_TIERS = 3

const _frustum = new Frustum()
const _viewProjection = new Matrix4()
const _sphere = new Sphere()
const _previousCamera = new Vector3()
const _velocity = new Vector3()
const _center = new Vector3()

export interface TerrainOptions {
  /** Edge length of one chunk. */
  chunkSize?: number
  skirtDepth?: number
  /** Chunks within this radius of the (predicted) camera are loaded. */
  loadRadius?: number
  /** Main-thread milliseconds per frame for building and uploading chunks. */
  uploadBudgetMs?: number
  /** Chunk builds allowed in flight at once. */
  maxInFlight?: number
  workerCount?: number
  /**
   * Legacy bound. When set, the world stays finite and chunks outside it are
   * never requested — which is what the level editor's hand-placed starting
   * level assumes. Omit for an unbounded world.
   */
  size?: number
}

interface ChunkNode {
  key: string
  cx: number
  cz: number
  centerX: number
  centerZ: number
  lod: DitheredLod
  asset: WorldAsset
  radius: number
}

interface PooledNode {
  lod: DitheredLod
  asset: WorldAsset
}

export class Terrain {
  readonly group = new Group()
  readonly field: Heightfield

  /** Live chunks. Kept as an array too, because `update` walks it every frame. */
  readonly chunks: DitheredLod[] = []

  /** Diagnostics for the perf panel. */
  readonly streamStats = {
    loaded: 0,
    inFlight: 0,
    queued: 0,
    pooled: 0,
    uploadMsLastFrame: 0,
    usingWorkers: false,
    workerBuildMs: 0
  }

  private readonly chunkSize: number
  private readonly skirtDepth: number
  private readonly loadRadius: number
  private readonly unloadRadius: number
  private readonly uploadBudgetMs: number
  private readonly maxInFlight: number
  private readonly halfExtent: number
  private readonly chunkRadius: number

  private readonly pool: ChunkWorkerPool
  private readonly live = new Map<string, ChunkNode>()
  private readonly requested = new Set<string>()
  private readonly ready: { key: string; cx: number; cz: number; tiers: TierData[] }[] = []
  private readonly nodePool: PooledNode[] = []
  private readonly materialTemplate: TerrainMaterial
  private disposed = false

  constructor(field: Heightfield, options: TerrainOptions = {}) {
    const {
      chunkSize = 48,
      skirtDepth = 2.5,
      loadRadius = 190,
      uploadBudgetMs = 2,
      maxInFlight = 6,
      workerCount = 2,
      size
    } = options

    this.field = field
    this.chunkSize = chunkSize
    this.skirtDepth = skirtDepth
    this.loadRadius = loadRadius
    // 25 % wider than load, so pacing a boundary can't thrash.
    this.unloadRadius = loadRadius * 1.25
    this.uploadBudgetMs = uploadBudgetMs
    this.maxInFlight = maxInFlight
    this.halfExtent = size === undefined ? Number.POSITIVE_INFINITY : size / 2
    this.chunkRadius = Math.SQRT2 * chunkSize * 0.5 + 40

    this.group.name = 'terrain'
    this.group.userData.perfTag = 'terrain'

    // One shared template; `DitheredLod` clones it per tier so each gets its own
    // `uFade`, and the clones all hit the same compiled program.
    this.materialTemplate = new TerrainMaterial({
      // Softer than props: at this scale a strong periwinkle push over whole
      // hillsides reads as blue haze on the ground rather than as shadow.
      shadowTintMix: 0.26,
      rimStrength: 0.18
    })

    const palette = new Float32Array(TERRAIN_PALETTE_SLOTS.length * 3)
    TERRAIN_PALETTE_SLOTS.forEach((slot, i) => {
      const color = C[slot]
      palette[i * 3] = color.r
      palette[i * 3 + 1] = color.g
      palette[i * 3 + 2] = color.b
    })

    this.pool = new ChunkWorkerPool(field.params, palette, workerCount)
    this.streamStats.usingWorkers = this.pool.usingWorkers
  }

  heightAt(x: number, z: number): number {
    return this.field.heightAt(x, z)
  }

  /**
   * Per frame: stream, then cull and LOD what's live.
   *
   * Streaming runs first so a chunk that arrives this frame is culled and
   * tier-assigned in the same frame it appears, rather than rendering one frame
   * at whatever tier it was pooled with.
   */
  update(camera: PerspectiveCamera, cameraPosition: Vector3): void {
    this.stream(cameraPosition)

    _viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    _frustum.setFromProjectionMatrix(_viewProjection)

    for (const chunk of this.live.values()) {
      _sphere.center.set(chunk.centerX, 0, chunk.centerZ)
      _sphere.radius = chunk.radius
      if (!_frustum.intersectsSphere(_sphere)) {
        chunk.lod.visible = false
        continue
      }
      chunk.lod.visible = true
      chunk.lod.update(cameraPosition)
    }
  }

  // ── streaming ─────────────────────────────────────────────────────────────

  private stream(cameraPosition: Vector3): void {
    // Lead the camera by a quarter-second of travel, so chunks are requested
    // before they're needed. Clamped: a teleport shouldn't request a whole
    // second's worth of world in one frame.
    _velocity.subVectors(cameraPosition, _previousCamera)
    if (_velocity.lengthSq() > 400) {
      _velocity.set(0, 0, 0)
    }
    _previousCamera.copy(cameraPosition)
    _center.copy(cameraPosition).addScaledVector(_velocity, 15)

    this.requestMissing(_center)
    this.drainReady()
    this.unloadDistant(cameraPosition)

    this.streamStats.loaded = this.live.size
    this.streamStats.inFlight = this.pool.inFlight
    this.streamStats.queued = this.ready.length
    this.streamStats.pooled = this.nodePool.length
  }

  private requestMissing(center: Vector3): void {
    if (this.pool.inFlight >= this.maxInFlight) {
      return
    }
    const reach = Math.ceil(this.loadRadius / this.chunkSize)
    const ccx = Math.floor(center.x / this.chunkSize)
    const ccz = Math.floor(center.z / this.chunkSize)

    // Nearest-first: a ring walk outward, so the chunk under the player's feet
    // is never queued behind one at the horizon.
    for (let ring = 0; ring <= reach; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          // Only the ring's perimeter — the interior was covered by earlier rings.
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) {
            continue
          }
          if (this.pool.inFlight >= this.maxInFlight) {
            return
          }
          const cx = ccx + dx
          const cz = ccz + dz
          const originX = cx * this.chunkSize
          const originZ = cz * this.chunkSize
          if (
            Math.abs(originX + this.chunkSize / 2) > this.halfExtent ||
            Math.abs(originZ + this.chunkSize / 2) > this.halfExtent
          ) {
            continue
          }
          const centerX = originX + this.chunkSize / 2
          const centerZ = originZ + this.chunkSize / 2
          const dxw = centerX - center.x
          const dzw = centerZ - center.z
          if (Math.sqrt(dxw * dxw + dzw * dzw) > this.loadRadius) {
            continue
          }
          const key = `${cx}_${cz}`
          if (this.live.has(key) || this.requested.has(key)) {
            continue
          }
          this.requested.add(key)
          void this.dispatch(key, cx, cz, originX, originZ)
        }
      }
    }
  }

  private async dispatch(key: string, cx: number, cz: number, originX: number, originZ: number): Promise<void> {
    const requests: ChunkRequest[] = TIER_SEGMENTS.map((segments, tier) => ({
      originX,
      originZ,
      size: this.chunkSize,
      segments,
      skirtDepth: this.skirtDepth,
      withSkirt: tier < SKIRT_TIERS
    }))

    const result = await this.pool.build(requests)
    if (this.disposed) {
      return
    }
    this.streamStats.workerBuildMs = Math.round(result.buildMs * 100) / 100
    // Parked, not applied: turning these into meshes is main-thread work and
    // belongs to the frame budget, not to whenever the worker happened to
    // finish.
    this.ready.push({ key, cx, cz, tiers: result.tiers })
  }

  /** Builds queued chunks until the frame budget runs out. */
  private drainReady(): void {
    if (this.ready.length === 0) {
      this.streamStats.uploadMsLastFrame = 0
      return
    }
    const started = performance.now()
    let spent = 0

    while (this.ready.length > 0) {
      const entry = this.ready.shift()!
      this.requested.delete(entry.key)
      this.instantiate(entry.key, entry.cx, entry.cz, entry.tiers)
      spent = performance.now() - started
      if (spent >= this.uploadBudgetMs) {
        break
      }
    }
    this.streamStats.uploadMsLastFrame = Math.round(spent * 100) / 100
  }

  private instantiate(key: string, cx: number, cz: number, tiers: TierData[]): void {
    const originX = cx * this.chunkSize
    const originZ = cz * this.chunkSize
    const pooled = this.nodePool.pop()

    let node: ChunkNode
    if (pooled) {
      // Buffers are the right shape by construction — tier sizes are fixed — so
      // the data is copied in and re-uploaded rather than reallocated.
      for (let tier = 0; tier < tiers.length; tier++) {
        writeTier(pooled.asset.tiers[tier]!, tiers[tier]!)
      }
      node = {
        key,
        cx,
        cz,
        centerX: originX + this.chunkSize / 2,
        centerZ: originZ + this.chunkSize / 2,
        lod: pooled.lod,
        asset: pooled.asset,
        radius: this.chunkRadius
      }
    } else {
      const geometries = tiers.map(tier => createTierGeometry(tier))
      const asset: WorldAsset = {
        name: `terrain-chunk`,
        perfTag: 'terrain',
        tiers: geometries,
        material: this.materialTemplate,
        // Never outlined: an inverted hull on a chunk draws a hard line around
        // the chunk boundary, which is exactly the seam the skirts hide.
        outline: null,
        outlineMaxTier: -1,
        radius: this.chunkRadius,
        // A 48 m chunk is orders of magnitude larger than a pebble, so it holds
        // detail correspondingly further out.
        distanceScale: 3.2
      }
      const lod = new DitheredLod(asset)
      for (const mesh of lod.tierMeshes) {
        // Chunks are the biggest receivers in the scene and never cast — a hill
        // shadowing another hill isn't worth the extra shadow draws.
        mesh.castShadow = false
        mesh.receiveShadow = true
      }
      node = {
        key,
        cx,
        cz,
        centerX: originX + this.chunkSize / 2,
        centerZ: originZ + this.chunkSize / 2,
        lod,
        asset,
        radius: this.chunkRadius
      }
    }

    node.lod.position.set(originX, 0, originZ)
    node.lod.visible = true
    this.group.add(node.lod)
    this.live.set(key, node)
    this.chunks.push(node.lod)
  }

  private unloadDistant(cameraPosition: Vector3): void {
    for (const [key, node] of this.live) {
      const dx = node.centerX - cameraPosition.x
      const dz = node.centerZ - cameraPosition.z
      if (Math.sqrt(dx * dx + dz * dz) <= this.unloadRadius) {
        continue
      }
      this.live.delete(key)
      this.group.remove(node.lod)
      const index = this.chunks.indexOf(node.lod)
      if (index >= 0) {
        this.chunks.splice(index, 1)
      }
      // Recycled whole: the four geometries and their materials are the
      // expensive part, and they are all the right shape for the next chunk.
      this.nodePool.push({ lod: node.lod, asset: node.asset })
    }
  }

  dispose(): void {
    this.disposed = true
    this.pool.dispose()
    for (const node of this.live.values()) {
      node.lod.dispose()
      for (const geometry of node.asset.tiers) {
        geometry.dispose()
      }
    }
    for (const pooled of this.nodePool) {
      pooled.lod.dispose()
      for (const geometry of pooled.asset.tiers) {
        geometry.dispose()
      }
    }
    this.live.clear()
    this.nodePool.length = 0
    this.chunks.length = 0
    this.ready.length = 0
    this.materialTemplate.dispose()
    this.group.clear()
  }
}

// ─── geometry plumbing ──────────────────────────────────────────────────────

interface TierData {
  position: Float32Array
  normal: Float32Array
  color: Float32Array
  index: Uint16Array | Uint32Array
  boundsY: [number, number]
}

/**
 * Wraps transferred buffers directly — no copy. The arrays arrived by transfer,
 * so this thread already owns them and three can hand them straight to the GPU.
 */
const createTierGeometry = (tier: TierData): BufferGeometry => {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(tier.position, 3))
  geometry.setAttribute('normal', new BufferAttribute(tier.normal, 3))
  geometry.setAttribute('color', new BufferAttribute(tier.color, 3))
  geometry.setIndex(new BufferAttribute(tier.index, 1))
  geometry.computeBoundingSphere()
  return geometry
}

/** Refills a pooled geometry in place, keeping its GPU buffers. */
const writeTier = (geometry: BufferGeometry, tier: TierData): void => {
  const position = geometry.getAttribute('position') as BufferAttribute
  const normal = geometry.getAttribute('normal') as BufferAttribute
  const color = geometry.getAttribute('color') as BufferAttribute
  ;(position.array as Float32Array).set(tier.position)
  ;(normal.array as Float32Array).set(tier.normal)
  ;(color.array as Float32Array).set(tier.color)
  position.needsUpdate = true
  normal.needsUpdate = true
  color.needsUpdate = true
  // The index never changes between chunks of the same tier — topology is a
  // function of the segment count alone — so it is deliberately not re-uploaded.
  geometry.computeBoundingSphere()
}

export { TIER_SEGMENTS, vertexCountFor }
