import type { PerspectiveCamera } from 'three'
import { BufferAttribute, BufferGeometry, Frustum, Group, Matrix4, Sphere, Vector3 } from 'three'
import type { WorldAsset } from '../assets/types'
import { C } from '../art/palette'
import { DitheredLod } from '../lod/DitheredLod'
import type { ChunkRequest } from './chunkGeometry'
import { vertexCountFor } from './chunkGeometry'
import { ChunkWorkerPool } from './ChunkWorkerPool'
import { DistantTerrain } from './DistantTerrain'
import type { Heightfield } from './heightfield'
import { TERRAIN_PALETTE_SLOTS } from './heightfieldCore'
import type { SculptPatch } from './SculptField'
import type { TerrainWorkerResult } from './terrainWorker'
import { TerrainMaterial } from './TerrainMaterial'
import { packWaterBodies, setWaterTable, SHORE_DRY_TOP, type WaterBody } from './waterLevel'

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

  /**
   * The ground past the streamer's reach — one coarse mesh, one draw call.
   *
   * Owned here rather than by `World` because it needs the same heightfield
   * params, the same palette and the same material instance as the streamed
   * chunks. A second copy of any of those is a visible seam at the hole edge.
   */
  readonly distant: DistantTerrain

  /** Live chunks. Kept as an array too, because `update` walks it every frame. */
  readonly chunks: DitheredLod[] = []

  /**
   * Cold (non-recycled) chunk nodes allowed per frame.
   *
   * `Infinity` is the original behaviour and the default: the upload budget
   * alone decides, and because it can only stop *between* units a single cold
   * node overruns it. A small number rations the expensive unit while recycled
   * nodes keep filling the budget.
   *
   * ── Measured, and left off ──────────────────────────────────────────────────
   *
   * Setting it to 1 does exactly what it claims to its own metric — worst upload
   * frame **9.8 → 7.6 ms**, the same work spread over 32 frames instead of 20 —
   * and **does not move frame time at all**. Four interleaved rounds inside one
   * build, with the cold path re-armed each round by emptying the pool and
   * teleporting to virgin terrain: p95 identical, worst frame ~50 ms in both.
   *
   * The reason is the useful part. A cold node costs ~3.7 ms against a 2 ms
   * budget, so rationing can only ever save single-digit milliseconds — while
   * the frames it was meant to rescue are 50–100 ms, of which `renderMs` (draw
   * submission) is **83 %**. Terrain upload peaks at 13.4 ms and scatter
   * population at 5.1 ms; neither is what makes those frames slow.
   *
   * Kept as a live knob rather than deleted, because the mechanism is real and
   * a device where upload dominates would benefit. Default unchanged, since a
   * slower fill is a real cost and the benefit was not observable.
   */
  coldNodeLimit = Number.POSITIVE_INFINITY

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
  /** Chunks with a sculpt rebuild in flight, so a held brush can't queue a
   *  hundred builds for the same chunk. */
  private readonly rebuilding = new Set<string>()
  /** Chunks that changed again while their rebuild was in flight; the value is
   *  whether that follow-up pass also owes a scatter refresh. */
  private readonly rebuildQueue = new Map<string, boolean>()
  private readonly materialTemplate: TerrainMaterial
  private disposed = false

  /**
   * Chunk lifecycle hooks. Scatter streams on the back of terrain rather than
   * running its own residency logic — two systems deciding independently what
   * is loaded is two systems that can disagree, and a tree standing on a chunk
   * that has been unloaded is a tree floating in the sky.
   */
  onChunkLoad: ((key: string, originX: number, originZ: number, chunkSize: number) => void) | null = null
  onChunkUnload: ((key: string) => void) | null = null

  /** Chunk edge length, in metres. Scatter needs it to match its cells. */
  get size(): number {
    return this.chunkSize
  }

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

    this.distant = new DistantTerrain(this.pool, this.materialTemplate, {
      // The hole must stay inside the streamer's reach or the two surfaces leave
      // a gap; `loadRadius` is the number that decides it.
      holeRadius: loadRadius * 0.9
    })
    this.group.add(this.distant.group)
  }

  /**
   * Drops every pooled node so the next fill takes the cold path.
   *
   * Exists for the `coldNodeLimit` A/B: pool growth is a once-per-session event,
   * so without a way to re-arm it the expensive path can be measured exactly
   * once and never compared against itself.
   *
   * **Deliberately does not dispose.** `DitheredLod.dispose()` releases the tier
   * materials, and those are clones of one shared template — disposing a pooled
   * node therefore reaches into every *live* chunk's shading. Doing that here
   * degraded the terrain after the first call and stopped streaming altogether
   * two rounds later, which looked exactly like a result until the streaming
   * counters showed zero chunk loads. Dropping the references is enough to force
   * the cold path; the handful of orphaned geometries is a fair price in a
   * measurement helper, and nothing calls this in normal play.
   */
  dropPooledNodes(): number {
    const dropped = this.nodePool.length
    this.nodePool.length = 0
    this.streamStats.pooled = 0
    return dropped
  }

  /**
   * Keys of the chunks currently resident.
   *
   * For the editor, which has to rebuild scatter across everything loaded when
   * an override changes globally. Returns a fresh array — this is an editor
   * action, not a frame path.
   */
  liveChunkKeys(): string[] {
    return [...this.live.keys()]
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
    this.distant.update(cameraPosition)
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

  /** All four tier requests for one chunk. Shared by the load and rebuild paths. */
  private tierRequests(originX: number, originZ: number): ChunkRequest[] {
    return TIER_SEGMENTS.map((segments, tier) => ({
      originX,
      originZ,
      size: this.chunkSize,
      segments,
      skirtDepth: this.skirtDepth,
      withSkirt: tier < SKIRT_TIERS
    }))
  }

  // ── editor sculpting ──────────────────────────────────────────────────────

  /**
   * Hands an editor sculpt patch to the chunk workers. Call this **before**
   * `invalidateRegion`, or the rebuilt chunks are built from the old offsets.
   */
  setSculptDelta(patch: SculptPatch): void {
    this.pool.setSculptDelta(patch)
  }

  // ── water ─────────────────────────────────────────────────────────────────

  /**
   * Tells the ground where the water is, so it can grow a shore.
   *
   * The engine holds **no** opinion about which bodies of water exist — that is
   * content, and `src/world/terrain/` may not import a chapter to find out. This
   * is the whole of the contract in the other direction: hand over a list of
   * rectangles with surface heights (`waterLevel.ts::WaterBody`) and every
   * terrain chunk built from here on paints sand at the waterline; hand over an
   * empty list and the world is exactly what it was before this existed.
   *
   * Three things have to happen and the order is not negotiable:
   *
   * 1. **this** module graph's table, for the inline no-worker fallback and for
   *    `grassPlacement.ts`, which runs on the main thread;
   * 2. the workers', broadcast ahead of any build that has not been queued yet;
   * 3. a rebuild of the chunks already standing. Without it the ring of ground
   *    the player is looking at keeps its old paint until they walk far enough
   *    to unload it — the identical trap `GrassField.rebuild()` exists for, and
   *    grass has to be rebuilt too (see the note there; `World` owns that call
   *    because it owns the field).
   *
   * Returns the number of live chunks queued for rebuild, like
   * `invalidateRegion`, so a caller can log that the shoreline actually landed.
   *
   * ── TODO(shore-wiring): nothing calls this yet ─────────────────────────────
   *
   * The chapter's two bodies of water are created in `views/StoryScene.vue`
   * (`seaPlacement()` and `arlaPlacement()`), and the engine cannot reach them
   * from here without importing the story — which `CLAUDE.md` forbids. So the
   * call belongs one level up, wherever `World` learns about water:
   *
   * ```ts
   * world.terrain.setWaterBodies([
   *   // frame.ts: a square pool, SEA_HALF either side of ISLE, surface SEA_LEVEL
   *   { minX: ISLE.x - SEA_HALF, minZ: ISLE.z - SEA_HALF,
   *     maxX: ISLE.x + SEA_HALF, maxZ: ISLE.z + SEA_HALF, y: SEA_LEVEL },
   *   // level.ts: the Arla, one sloped rect — see `waterLevel.ts` on why one
   *   { minX: RIVER_X - 20, minZ: -130, maxX: RIVER_X + 20, maxZ: 130,
   *     y: 0, slopeZ: 3.4 / 260 }
   * ])
   * world.grass.rebuild()
   * ```
   *
   * Verified by hand over CDP with exactly that call: 49–56 live chunks
   * rebuilt, the island grew a 13 m beach and the grass stopped 9 m short of the
   * water. Both lines belong wherever `setGrassExclusions` + `grass.rebuild()`
   * already run, i.e. inside `onPlaceablesReady`, so the shore lands on the same
   * frame the village footprints do.
   *
   * The scatter's water-awareness can ride on the same table rather than a
   * second one: once this has been called, `waterLevel.ts::waterLevelAt(x, z)`
   * *is* the main thread's water-height sampler.
   */
  setWaterBodies(bodies: readonly WaterBody[]): number {
    const table = packWaterBodies(bodies)
    setWaterTable(table)
    this.pool.setWaterTable(table)

    if (bodies.length === 0) {
      return 0
    }

    // The affected ground is the union of the bodies' rectangles, grown by the
    // widest the band can reach. It is a *height*, not a distance, so the
    // horizontal reach depends on the slope — on a 1 % mudflat `SHORE_DRY_TOP`
    // would be 230 m away. `SHORE_DRY_TOP * 100` is that mudflat's worth of
    // margin and costs nothing: `invalidateRegion` walks live chunks only, and
    // there are never more than a few hundred of those.
    let minX = Number.POSITIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY
    for (const body of bodies) {
      minX = Math.min(minX, body.minX, body.maxX)
      maxX = Math.max(maxX, body.minX, body.maxX)
      minZ = Math.min(minZ, body.minZ, body.maxZ)
      maxZ = Math.max(maxZ, body.minZ, body.maxZ)
    }
    const margin = SHORE_DRY_TOP * 100
    return this.invalidateRegion(minX - margin, minZ - margin, maxX + margin, maxZ + margin)
  }

  /**
   * Rebuilds every live chunk overlapping a world-space rectangle.
   *
   * Deliberately **not** an unload/reload: those go through the pool and the
   * node recycler, so the ground under the brush would blink out for however
   * many frames the round trip takes. The node stays exactly where it is, its
   * geometry is refilled in place by `writeTier`, and until the new buffers
   * land the player keeps walking on the old mesh — which is a couple of
   * millimetres out of date rather than absent.
   *
   * `rescatter` replays the chunk lifecycle hooks so trees and rocks re-seat on
   * the new surface. It is off during a drag (re-placing a forest 30 times a
   * second is pure churn) and on when the stroke ends.
   */
  invalidateRegion(minX: number, minZ: number, maxX: number, maxZ: number, rescatter = false): number {
    // The ring samples the same heightfield, sculpt delta and all, but only
    // rebuilds on a snap boundary — so without this an edited hill would be
    // missing from the horizon until the player walked 192 m away from it.
    this.distant.invalidate()
    let count = 0
    for (const [key, node] of this.live) {
      const originX = node.cx * this.chunkSize
      const originZ = node.cz * this.chunkSize
      if (originX > maxX || originX + this.chunkSize < minX) {
        continue
      }
      if (originZ > maxZ || originZ + this.chunkSize < minZ) {
        continue
      }
      if (this.rebuilding.has(key)) {
        // Already in flight. Queued rather than dropped: a held brush issues a
        // request every few frames, and dropping the last one loses the final
        // dab of the stroke — permanently, since nothing else will ask again.
        this.rebuildQueue.set(key, (this.rebuildQueue.get(key) ?? false) || rescatter)
        continue
      }
      this.rebuilding.add(key)
      void this.rebuildChunk(key, originX, originZ, rescatter)
      count++
    }
    return count
  }

  private async rebuildChunk(key: string, originX: number, originZ: number, rescatter: boolean): Promise<void> {
    let result: TerrainWorkerResult | null = null
    try {
      result = await this.pool.build(this.tierRequests(originX, originZ))
    } finally {
      this.rebuilding.delete(key)
    }
    if (this.disposed) {
      this.rebuildQueue.delete(key)
      return
    }

    // The chunk may have been unloaded while the worker was busy — a rebuild is
    // not a reason to keep a chunk the player has walked away from.
    const node = this.live.get(key)
    if (node && result) {
      for (let tier = 0; tier < result.tiers.length; tier++) {
        const geometry = node.asset.tiers[tier]
        const data = result.tiers[tier]
        if (geometry && data) {
          writeTier(geometry, data)
        }
      }
      if (rescatter) {
        this.onChunkUnload?.(key)
        this.onChunkLoad?.(key, originX, originZ, this.chunkSize)
      }
    }

    const queued = this.rebuildQueue.get(key)
    if (queued === undefined || !node) {
      this.rebuildQueue.delete(key)
      return
    }
    this.rebuildQueue.delete(key)
    this.rebuilding.add(key)
    void this.rebuildChunk(key, originX, originZ, queued)
  }

  private async dispatch(key: string, cx: number, cz: number, originX: number, originZ: number): Promise<void> {
    const requests = this.tierRequests(originX, originZ)

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

    let coldThisFrame = 0

    while (this.ready.length > 0) {
      const entry = this.ready.shift()!
      this.requested.delete(entry.key)
      if (this.instantiate(entry.key, entry.cx, entry.cz, entry.tiers)) {
        coldThisFrame++
      }
      spent = performance.now() - started
      // ── Two units, two costs ────────────────────────────────────────────────
      //
      // A recycled node copies into buffers that already exist; a **cold** one
      // allocates four `BufferGeometry` objects, a `DitheredLod` with its tier
      // meshes and outline hull, and fresh GPU buffers. One cold node exceeds
      // this budget on its own, and a budget can only stop *between* units — the
      // same shape of problem as the placeable drain.
      //
      // `coldNodeLimit` rations the expensive unit while letting recycled nodes
      // keep filling the budget. It is a live setting rather than a constant so
      // the two behaviours can be compared **inside one build** (rule 9): the
      // first attempt at this was judged across commits against a single
      // baseline sample, which is not a measurement.
      if (spent >= this.uploadBudgetMs || coldThisFrame >= this.coldNodeLimit) {
        break
      }
    }
    this.streamStats.uploadMsLastFrame = Math.round(spent * 100) / 100
  }

  /** True when the node had to be built from scratch — see `drainReady`. */
  private instantiate(key: string, cx: number, cz: number, tiers: TierData[]): boolean {
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
        distanceScale: 3.2,
        // Chunks are the biggest receivers in the scene and never cast — a hill
        // shadowing another hill is not worth the shadow draws.
        //
        // Declared on the *asset*, not by assigning `mesh.castShadow = false`
        // below. That is how this was written and it did nothing: `DitheredLod`
        // re-assigns `castShadow` from `asset.castsShadow ?? true` on every
        // frame as tiers cross fade thresholds, so the constructor's intent was
        // overwritten one frame later and 20 chunks were casting into every
        // cascade — 16.3k of the 20.9k caster triangles in the scene.
        castsShadow: false
      }
      const lod = new DitheredLod(asset)
      for (const mesh of lod.tierMeshes) {
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
    this.onChunkLoad?.(key, originX, originZ, this.chunkSize)
    return !pooled
  }

  private unloadDistant(cameraPosition: Vector3): void {
    for (const [key, node] of this.live) {
      const dx = node.centerX - cameraPosition.x
      const dz = node.centerZ - cameraPosition.z
      if (Math.sqrt(dx * dx + dz * dz) <= this.unloadRadius) {
        continue
      }
      this.live.delete(key)
      this.onChunkUnload?.(key)
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
    this.rebuilding.clear()
    this.rebuildQueue.clear()
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
  /** Int16, normalized — see `chunkGeometry`'s compression notes. */
  normal: Int16Array
  /** Uint16, normalized. */
  color: Uint16Array
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
  // `normalized: true` is the whole compression scheme: WebGL expands the
  // integers back to floats in fixed-function hardware, so nothing downstream —
  // no shader, no chunk, no material — has to know they aren't Float32.
  geometry.setAttribute('normal', new BufferAttribute(tier.normal, 3, true))
  geometry.setAttribute('color', new BufferAttribute(tier.color, 3, true))
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
  ;(normal.array as Int16Array).set(tier.normal)
  ;(color.array as Uint16Array).set(tier.color)
  position.needsUpdate = true
  normal.needsUpdate = true
  color.needsUpdate = true
  // The index never changes between chunks of the same tier — topology is a
  // function of the segment count alone — so it is deliberately not re-uploaded.
  geometry.computeBoundingSphere()
}

export { TIER_SEGMENTS, vertexCountFor }
