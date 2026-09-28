import type { PerspectiveCamera } from 'three'
import {
  DynamicDrawUsage,
  Group,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  Vector3
} from 'three'
import { getLodBias } from '../lod/config'
import type { HeightfieldParams } from '../terrain/heightfieldCore'
import {
  BLADE_HALF_WIDTH,
  bladesForTier,
  buildGrassTier,
  type GrassTierGeometry,
  widthCompensation
} from './bladeGeometry'
import {
  BLADE_WIDTH_SCALE,
  GRASS_LEVELS,
  FADE_FRACTION,
  GRASS_TIER_COUNT,
  type GrassDetailLevel,
  grassCullDistance,
  grassTierAt,
  PATCH_SIZE,
  tierCapacity,
  tierHasWind,
  tierRamp,
  WIND_FADE_END,
  WIND_FADE_START
} from './config'
import { grassUniforms, GrassMaterial } from './grassMaterial'
import {
  buildChunkPatches,
  createPatchBuffer,
  maxPatchesPerChunk,
  type PatchBuffer
} from './grassPlacement'

/**
 * ─── The grass field ────────────────────────────────────────────────────────
 *
 * Six draw calls for the whole meadow, whatever the world is doing.
 *
 * The structure is two levels, and both exist to make the per-frame loop cheap:
 *
 * * A **cell** is one terrain chunk's worth of patches (48 m → up to 144), added
 *   and dropped whole. Every frame a cell is tested once against the view cone
 *   and the cull distance; a cell that fails costs one test for 144 patches.
 * * A **patch** is the instance. It gets a distance, a tier assignment and a
 *   twelve-float copy into that tier's interleaved buffer.
 *
 * ── Directional culling is the headline, not the frustum ────────────────────
 *
 * The dominant cost of a grass field is that grass is *everywhere*, and about
 * three quarters of everywhere is behind you. A horizontal **view cone** —
 * the camera's own horizontal half-FOV plus a margin — removes it for four
 * arithmetic operations per cell.
 *
 * It is a cone rather than the six-plane frustum test the scatter fields use,
 * and that is deliberate on three counts:
 *
 * 1. It is **cheaper**: an exact 2D cone/sphere test is a dot, a cross and a
 *    compare, against six plane evaluations.
 * 2. It admits a **margin** the frustum cannot express. The frustum is exactly
 *    the visible set, so a fast camera turn reveals the frame *after* the cell
 *    entered view — grass would visibly grow in at the screen edge. The margin
 *    is the "rotation gap": at 60 fps and 14°, the camera can spin at 840°/s
 *    before it can outrun its own grass.
 * 3. Grass is ground cover, so the frustum's near, far and horizontal planes are
 *    the only ones doing work anyway. Culling by pitch would drop the sward
 *    under the player's feet the moment they looked up.
 *
 * ── There is no dirty tracking, on purpose ──────────────────────────────────
 *
 * `InstancedLodField` goes to some length to avoid re-uploading instance
 * matrices when membership has not changed, because a matrix is 64 bytes and its
 * fields hold thousands of them. That machinery would be dead weight here:
 * membership churns on **every camera rotation** by construction (that is what
 * the cone cull is *for*), so the dirty flag would be set every frame anyway.
 * Repacking ~900 patches × 48 bytes is ~43 KB — cheaper to just do than to think
 * about.
 */

/** Interleaved floats per patch instance: three `vec4`s. */
const STRIDE = 12

/**
 * Bounds on the global `lodBias`, as grass applies it.
 *
 * `setLodBias` clamps to [0.25, 4] for props, which is right for them: a pebble
 * at 4× is still a pebble. Grass is different in both directions.
 *
 * **Below 0.7** the meadow stops before the terrain does and the world grows a
 * lawn-shaped boundary.
 *
 * **Above 1.15** the bias stops buying anything and starts costing quadratically.
 * Grass covers *area*, so stretching the range by the bias multiplies the patch
 * count by its square — measured on a 412×915 phone at DPR 2, the uncapped 1.69
 * bias took grass from 57 k triangles to 113 k. What it bought was detail at
 * 130–170 m, which at this fog density (exp² 0.0085) is 70–80 % erased. That is
 * the wrong end of the world to spend a doubling on, and the far tiers reach
 * past the streamed terrain into the distant ring, whose 29 m cells sit two
 * metres low by design — so the extra grass would visibly hover.
 *
 * Neither bound is a quality decision, so neither is exposed as one.
 */
const MIN_BIAS = 0.7
const MAX_BIAS = 1.15

/** Cone classification, same convention as `InstancedLodField`. */
const OUTSIDE = -1
const INTERSECTS = 0
const INSIDE = 1

/**
 * Radius of one patch for the per-patch cone test: the half-diagonal plus the
 * furthest a blade can lean out of it under wind.
 */
const PATCH_REACH = Math.SQRT2 * (PATCH_SIZE / 2) + 0.5

const _forward = new Vector3()
/** Scratch for `tierRamp`. Module level — GDD §5.2 bans frame allocation. */
const _ramp = [0, 0, 0, 0]

interface Tier {
  mesh: Mesh
  material: GrassMaterial
  geometry: GrassTierGeometry
  buffer: InstancedInterleavedBuffer
  array: Float32Array
  capacity: number
  count: number
  /** Triangles one patch of this tier draws at the current detail level. */
  trianglesPerInstance: number
}

/**
 * One terrain chunk's grass. Slots are a contiguous run in the source arrays —
 * unlike `InstancedLodField`, which uses a free list, because grass cells are
 * uniform in size and a bump allocator with compaction on removal keeps the
 * per-frame walk perfectly sequential.
 */
interface Cell {
  key: string
  /** First slot index. */
  start: number
  count: number
  /** Bounding circle in the XZ plane, plus the vertical span for completeness. */
  centerX: number
  centerZ: number
  centerY: number
  radius: number
}

export interface GrassFieldOptions {
  params: HeightfieldParams
  chunkSize: number
  /** Detail level index into `GRASS_LEVELS`. */
  level?: number
  /** Chunks converted to patches per frame while filling in. */
  buildBudget?: number
}

export class GrassField {
  readonly group = new Group()

  /**
   * Overrides the level's view-cone half-angle margin, in degrees.
   *
   * A measurement knob, not a setting — `≥ 180` disables directional culling
   * outright, which is the only honest way to price it: comparing two builds (or
   * two page loads) measures the browser's mood as much as the code. Same role
   * `Terrain.coldNodeLimit` and the perf panel's `cell cull` toggle play.
   *
   * It has to switch the test *off* rather than open it to 180°, and that cost a
   * wrong measurement to learn. At a 180° half-angle the cone still carries its
   * apex guard — `along < −radius` rejects anything more than a patch-radius
   * behind the camera plane — so "disabled" was really "front hemisphere", and
   * the A/B under-reported the saving by nearly half: 718 patches against a true
   * unculled 1 240.
   */
  coneMarginOverride: number | null = null

  /**
   * Overrides `FADE_FRACTION`, the width of the per-blade density fade.
   *
   * The second measurement knob, and it exists because the question it answers —
   * "is the meadow popping as I walk?" — cannot be answered by looking at a still
   * frame or by a triangle count. Stepping the camera and diffing the framebuffer
   * measures *parallax* far more than it measures popping, so the only honest
   * comparison is the same walk at two fade widths in one build.
   *
   * `≈ 2.5 / live` reproduces the original fixed-window behaviour; `0` flattens
   * the ramp into a hard threshold, which is the worst case and a useful upper
   * bound on what the fade is buying.
   */
  fadeFractionOverride: number | null = null

  /** Diagnostics for the perf panel and for `grass.md`. */
  readonly stats = {
    residentPatches: 0,
    drawnPatches: 0,
    cells: 0,
    culledCells: 0,
    triangles: 0,
    tierCounts: new Int32Array(GRASS_TIER_COUNT),
    pendingChunks: 0
  }

  private readonly tiers: Tier[] = []
  /**
   * Blades actually baked into each tier at the current detail level.
   *
   * Held separately from `tiers[i].geometry.blades` because the density ramp
   * reads it once per patch per frame, and walking six objects to gather six
   * numbers on the hot path is exactly the kind of pointer chase this loop is
   * written to avoid.
   */
  private readonly bakedBlades: number[] = []
  private readonly params: HeightfieldParams
  private readonly chunkSize: number
  private readonly buildBudget: number

  /** Source instance data, `capacity × STRIDE`. Packed by cell, contiguous. */
  private source: Float32Array
  private sourceCapacity: number
  private used = 0

  /** Live cells in slot order, so compaction only ever moves the tail. */
  private cells: Cell[] = []
  private readonly cellByKey = new Map<string, Cell>()

  /**
   * Terrain chunks that exist, whether or not grass wants them yet.
   *
   * Grass residency is **narrower than terrain residency** and has to be decided
   * separately: chunks stream to 190 m while grass is culled at 115 m (and at
   * 52 m on `minimum`), so building grass for every loaded chunk would be up to
   * five times the patches, all of them permanently outside the cull distance.
   * This list is the join between the two.
   *
   * A plain array with a key→index map beside it, rather than the `Map` this
   * obviously wants to be, because the residency pass walks it every frame and
   * `for (const [k, v] of map)` allocates a two-element array per entry. GDD §5.2
   * bans per-frame allocation outright, and this is the only place in the field
   * that came close.
   */
  private readonly candidates: { key: string; originX: number; originZ: number }[] = []
  private readonly candidateIndex = new Map<string, number>()

  private scratch: PatchBuffer
  private level: number
  private detail: GrassDetailLevel
  /** `detail.range × clamped lod bias` — the multiplier on every tier boundary. */
  private rangeScale = 1
  private cullDistance: number
  private lastBias = -1
  /** cos and sin of the view-cone half angle, refreshed when the camera changes. */
  private coneCos = 0
  private coneSin = 1
  private lastFov = -1
  private lastAspect = -1
  private lastMargin = -1
  private enabled = true

  constructor(options: GrassFieldOptions) {
    this.params = options.params
    this.chunkSize = options.chunkSize
    this.buildBudget = options.buildBudget ?? 2
    this.level = options.level ?? GRASS_LEVELS.length - 1
    this.detail = GRASS_LEVELS[this.level]!
    this.rangeScale = this.detail.range
    this.cullDistance = grassCullDistance(this.rangeScale)

    this.group.name = 'grass'
    this.group.userData.perfTag = 'grass'
    // Instance data is authored in **world** coordinates — patch origins are
    // world positions, and the shader writes `transformed` in world space. That
    // is only correct while this group's matrix is the identity, so it is frozen
    // rather than merely left at the origin: a future `group.position.set(...)`
    // would slide the entire meadow off the terrain with no other symptom.
    this.group.matrixAutoUpdate = false

    this.scratch = createPatchBuffer(maxPatchesPerChunk(this.chunkSize))

    // Sized for the widest level *at the widest bias*, so neither a detail
    // change nor a resize ever reallocates. Chunk granularity adds a ring.
    const maxRange = GRASS_LEVELS[GRASS_LEVELS.length - 1]!.range * MAX_BIAS
    const reach = grassCullDistance(maxRange) + this.chunkSize
    this.sourceCapacity = Math.ceil((Math.PI * reach * reach) / (PATCH_SIZE * PATCH_SIZE)) + 256
    this.source = new Float32Array(this.sourceCapacity * STRIDE)

    for (let tier = 0; tier < GRASS_TIER_COUNT; tier++) {
      const state = this.createTier(tier, maxRange)
      this.tiers.push(state)
      this.bakedBlades.push(state.geometry.blades)
    }
    this.applyDensity()
    this.applyDetailUniforms()
  }

  private createTier(tier: number, maxRange: number): Tier {
    // Always baked at full density. The detail level narrows it with
    // `setDrawRange` — see `setLevel`.
    const geometry = buildGrassTier(tier, 1)
    const capacity = Math.min(this.sourceCapacity, tierCapacity(tier, maxRange))

    const array = new Float32Array(capacity * STRIDE)
    const buffer = new InstancedInterleavedBuffer(array, STRIDE, 1)
    buffer.setUsage(DynamicDrawUsage)
    geometry.geometry.setAttribute('aGrassA', new InterleavedBufferAttribute(buffer, 4, 0))
    geometry.geometry.setAttribute('aGrassB', new InterleavedBufferAttribute(buffer, 4, 4))
    geometry.geometry.setAttribute('aGrassC', new InterleavedBufferAttribute(buffer, 4, 8))
    geometry.geometry.instanceCount = 0

    const material = new GrassMaterial({
      bladeWidth: BLADE_HALF_WIDTH * BLADE_WIDTH_SCALE[tier]!,
      // Only the far tiers turn toward the viewer. Near tiers have enough blades
      // for random yaw to average out, and their individual orientation is part
      // of the look. Past ~55 m a blade is a few pixels wide and there are few
      // enough of them per patch that one going edge-on is a hole — a tuft that
      // vanishes when you turn your head is far more visible than one that is
      // slightly too flat.
      faceCamera: tier >= 4 ? 0.85 : 0,
      // Derived from the distance tables, so moving a tier boundary or the wind
      // fade range cannot silently leave a swaying tier with its wind off — which
      // would read as a band of frozen grass at a fixed radius.
      bladeWind: tierHasWind(tier) ? 1 : 0,
      name: `grass/LOD${tier}`
    })

    const mesh = new Mesh(geometry.geometry, material)
    mesh.name = `grass/LOD${tier}`
    // Culling is per patch, in `update`. three's whole-mesh test would need a
    // bounding sphere recomputed from the instance stream every frame.
    mesh.frustumCulled = false
    // See the class docs on `GrassMaterial`: the depth material cannot see a
    // blade that is built in the colour shader, so a caster would be the
    // undrawn patch geometry sitting at the world origin.
    mesh.castShadow = false
    mesh.receiveShadow = true
    mesh.visible = false
    mesh.userData.perfTag = 'grass'
    mesh.matrixAutoUpdate = false
    this.group.add(mesh)

    return { mesh, material, geometry, buffer, array, capacity, count: 0, trianglesPerInstance: geometry.triangles }
  }

  // ── streaming ─────────────────────────────────────────────────────────────

  /**
   * A terrain chunk exists. Grass may or may not want it yet — see `candidates`.
   */
  noteChunk(key: string, originX: number, originZ: number): void {
    const existing = this.candidateIndex.get(key)
    if (existing !== undefined) {
      this.candidates[existing]!.originX = originX
      this.candidates[existing]!.originZ = originZ
      return
    }
    this.candidateIndex.set(key, this.candidates.length)
    this.candidates.push({ key, originX, originZ })
  }

  /** A terrain chunk is gone. Grass must go with it, resident or not. */
  dropChunk(key: string): void {
    const index = this.candidateIndex.get(key)
    if (index !== undefined) {
      // Swap with the last and pop: order is irrelevant here (unlike `cells`,
      // where slot order is what makes compaction a single `copyWithin`).
      const last = this.candidates.length - 1
      const moved = this.candidates[last]!
      this.candidates[index] = moved
      this.candidateIndex.set(moved.key, index)
      this.candidates.pop()
      this.candidateIndex.delete(key)
    }
    this.removeCell(key)
  }

  private buildCell(key: string, originX: number, originZ: number): void {
    if (this.cellByKey.has(key)) {
      return
    }
    buildChunkPatches(this.params, originX, originZ, this.chunkSize, this.scratch)
    const count = this.scratch.count
    if (count === 0) {
      // Recorded anyway, with zero patches: without a cell here the residency
      // pass would re-run the placement for a bare rock chunk every single
      // frame, which is ~170 heightfield samples for a guaranteed empty result.
      const empty: Cell = {
        key,
        start: this.used,
        count: 0,
        centerX: originX + this.chunkSize / 2,
        centerZ: originZ + this.chunkSize / 2,
        centerY: 0,
        radius: 0
      }
      this.cells.push(empty)
      this.cellByKey.set(key, empty)
      return
    }
    if (this.used + count > this.sourceCapacity) {
      // Soft failure, like `InstancedLodField.addCell`: dropping a chunk's grass
      // is survivable and self-corrects when a nearer chunk unloads. Throwing
      // mid-traversal is not.
      return
    }

    const start = this.used
    const source = this.source
    for (let i = 0; i < count; i++) {
      const at = (start + i) * STRIDE
      source[at] = this.scratch.origin[i * 2]!
      source[at + 1] = this.scratch.origin[i * 2 + 1]!
      source[at + 2] = this.scratch.corners[i * 4]!
      source[at + 3] = this.scratch.corners[i * 4 + 1]!
      source[at + 4] = this.scratch.corners[i * 4 + 2]!
      source[at + 5] = this.scratch.corners[i * 4 + 3]!
      source[at + 6] = this.scratch.params[i * 2]!
      source[at + 7] = this.scratch.params[i * 2 + 1]!
      source[at + 8] = this.scratch.tint[i * 3]!
      source[at + 9] = this.scratch.tint[i * 3 + 1]!
      source[at + 10] = this.scratch.tint[i * 3 + 2]!
      // Slot 11 is the signed LOD coverage, written per frame in `update`.
      source[at + 11] = 1
    }
    this.used += count

    const centerX = originX + this.chunkSize / 2
    const centerZ = originZ + this.chunkSize / 2
    const centerY = (this.scratch.topY + this.scratch.lowY) / 2
    const halfSpan = (this.scratch.topY - this.scratch.lowY) / 2
    const half = this.chunkSize / 2
    const cell: Cell = {
      key,
      start,
      count,
      centerX,
      centerZ,
      centerY,
      // Horizontal half-diagonal of the chunk plus its vertical half-span: the
      // cone test is 2D, so the vertical term only has to keep the sphere from
      // under-reporting when a chunk spans a cliff.
      radius: Math.sqrt(half * half * 2 + halfSpan * halfSpan)
    }
    this.cells.push(cell)
    this.cellByKey.set(key, cell)
  }

  /**
   * Drops a cell and compacts the source array.
   *
   * Cells are kept in slot order, so compaction is one `copyWithin` of the tail
   * and a fixed-up `start` on the cells that moved — no free list, no
   * fragmentation, and the per-frame walk stays sequential in memory. Removals
   * happen a couple of times a second at walking speed; the walk happens 60
   * times a second.
   */
  private removeCell(key: string): void {
    const cell = this.cellByKey.get(key)
    if (!cell) {
      return
    }
    this.cellByKey.delete(key)
    const index = this.cells.indexOf(cell)
    if (index < 0) {
      return
    }
    this.cells.splice(index, 1)

    if (cell.count > 0) {
      const from = (cell.start + cell.count) * STRIDE
      const to = cell.start * STRIDE
      this.source.copyWithin(to, from, this.used * STRIDE)
      for (let i = index; i < this.cells.length; i++) {
        this.cells[i]!.start -= cell.count
      }
      this.used -= cell.count
    }
  }

  /**
   * Brings grass residency in line with the cull distance, a couple of chunks
   * per frame.
   *
   * Budgeted for the same reason terrain uploads are (AAA-graphics §7): building
   * a chunk's patches is ~170 heightfield samples plus 144 ground-colour
   * evaluations, and a teleport or a detail-level change would otherwise queue
   * fifty of them onto one frame.
   */
  private updateResidency(cameraX: number, cameraZ: number): void {
    const keep = this.cullDistance + this.chunkSize
    // Hysteresis, exactly as the terrain streamer uses: without the gap, pacing
    // a boundary rebuilds the same chunk's grass forever.
    const drop = keep * 1.25
    let built = 0
    let pending = 0

    for (let i = 0; i < this.candidates.length; i++) {
      const candidate = this.candidates[i]!
      const dx = candidate.originX + this.chunkSize / 2 - cameraX
      const dz = candidate.originZ + this.chunkSize / 2 - cameraZ
      const distance = Math.sqrt(dx * dx + dz * dz)
      const resident = this.cellByKey.has(candidate.key)

      if (distance <= keep) {
        if (!resident) {
          if (built < this.buildBudget) {
            this.buildCell(candidate.key, candidate.originX, candidate.originZ)
            built++
          } else {
            pending++
          }
        }
      } else if (resident && distance > drop) {
        this.removeCell(candidate.key)
      }
    }

    this.stats.pendingChunks = pending
    this.stats.cells = this.cells.length
    this.stats.residentPatches = this.used
  }

  // ── per frame ─────────────────────────────────────────────────────────────

  /**
   * Cull, assign tiers, pack, upload. Allocation-free.
   *
   * @param camera         needs `fov`, `aspect` and a current world matrix
   * @param cameraPosition the camera's world position
   */
  update(camera: PerspectiveCamera, cameraPosition: Vector3): void {
    if (!this.enabled) {
      return
    }

    this.refreshScale()
    grassUniforms.uFadeFraction.value = this.fadeFractionOverride ?? FADE_FRACTION
    this.updateResidency(cameraPosition.x, cameraPosition.z)
    this.refreshCone(camera)

    // Horizontal forward. Taken from the camera's world matrix rather than from
    // a stored yaw, so it is correct whichever controller is driving and however
    // the camera got there.
    _forward.set(-camera.matrixWorld.elements[8]!, 0, -camera.matrixWorld.elements[10]!)
    const forwardLength = Math.hypot(_forward.x, _forward.z)
    if (forwardLength < 1e-5) {
      // Looking straight up or straight down: there is no horizontal direction
      // to cone against, so cull by distance alone rather than by an arbitrary
      // axis. Rare, brief, and the alternative is the meadow vanishing.
      _forward.set(0, 0, 0)
    } else {
      _forward.x /= forwardLength
      _forward.z /= forwardLength
    }
    const coneActive =
      forwardLength >= 1e-5 && (this.coneMarginOverride === null || this.coneMarginOverride < 180)

    for (let t = 0; t < GRASS_TIER_COUNT; t++) {
      this.tiers[t]!.count = 0
    }

    const scale = this.rangeScale
    const cullSquared = this.cullDistance * this.cullDistance
    let culledCells = 0
    let drawn = 0

    for (let c = 0; c < this.cells.length; c++) {
      const cell = this.cells[c]!
      if (cell.count === 0) {
        continue
      }

      const cdx = cell.centerX - cameraPosition.x
      const cdz = cell.centerZ - cameraPosition.z
      const cdy = cell.centerY - cameraPosition.y
      const cellDistance = Math.sqrt(cdx * cdx + cdy * cdy + cdz * cdz)
      if (cellDistance - cell.radius > this.cullDistance) {
        culledCells++
        continue
      }

      // ── Two-level cone test ───────────────────────────────────────────────
      //
      // A cell is 48 m across, so its bounding circle has a ~35 m radius. At
      // 60 m that circle subtends 35°, against a cone half-angle of ~54° — so a
      // *straddling* cell is accepted whenever its centre lands anywhere in a
      // 176° arc, and half of what it contains is behind the camera. Measured on
      // the first version, which tested cells only: 15 of 27 cells culled where
      // the cone's share of the circle is 22 %.
      //
      // So a cell that is **fully** inside the cone accepts its patches with no
      // further test (the common case, and the cheap one), and only a straddling
      // cell pays a per-patch cone test. This is the same INSIDE / INTERSECTS
      // split `InstancedLodField` makes against the frustum, for the same
      // reason.
      let coneCell = INSIDE
      if (coneActive) {
        coneCell = this.classifyCone(cdx, cdz, cell.radius)
        if (coneCell === OUTSIDE) {
          culledCells++
          continue
        }
      }
      const perPatchCone = coneActive && coneCell === INTERSECTS

      const end = cell.start + cell.count
      for (let i = cell.start; i < end; i++) {
        const at = i * STRIDE
        const dx = this.source[at]! + PATCH_SIZE / 2 - cameraPosition.x
        const dz = this.source[at + 1]! + PATCH_SIZE / 2 - cameraPosition.z
        // Vertical distance is included, and it has to be: a blade's tier is a
        // decision about the *screen area* it will cover, which is set by true
        // depth. The orbit camera sits 30–90 m above its focus, so a horizontal
        // measure would hand LOD0 — 192 blades a patch — to ground that is
        // ninety metres away and a few pixels tall.
        //
        // Cheaper than it looks: the patch's four corner heights are already in
        // the stream, and their mean is the centre height by construction.
        const patchY = (this.source[at + 2]! + this.source[at + 3]! + this.source[at + 4]! + this.source[at + 5]!) * 0.25
        const dy = patchY - cameraPosition.y
        const distanceSquared = dx * dx + dy * dy + dz * dz
        if (distanceSquared > cullSquared) {
          continue
        }
        if (perPatchCone && this.classifyCone(dx, dz, PATCH_REACH) === OUTSIDE) {
          continue
        }

        // Which tier draws this patch. The *ramp within* that tier is evaluated
        // per blade in the shader — see `tierRamp` — so this only decides which
        // of the six draw calls the patch joins.
        const t = grassTierAt(Math.sqrt(distanceSquared), scale)
        if (t < 0) {
          continue
        }
        const tier = this.tiers[t]!
        if (tier.count >= tier.capacity) {
          continue
        }
        drawn++

        const target = tier.array
        const to = tier.count * STRIDE
        // Unrolled rather than `set(subarray(...))`: a subarray view is a fresh
        // object per call and this runs thousands of times a frame.
        target[to] = this.source[at]!
        target[to + 1] = this.source[at + 1]!
        target[to + 2] = this.source[at + 2]!
        target[to + 3] = this.source[at + 3]!
        target[to + 4] = this.source[at + 4]!
        target[to + 5] = this.source[at + 5]!
        target[to + 6] = this.source[at + 6]!
        target[to + 7] = this.source[at + 7]!
        target[to + 8] = this.source[at + 8]!
        target[to + 9] = this.source[at + 9]!
        target[to + 10] = this.source[at + 10]!
        // Slot 11 is spare. It carried the live blade count until the density
        // ramp moved into the shader, where it can be evaluated per *blade*
        // rather than per patch; the slot stays so the stream remains three
        // vec4s and can interleave as one buffer.
        target[to + 11] = this.source[at + 11]!
        tier.count++
      }
    }

    let triangles = 0
    for (let t = 0; t < GRASS_TIER_COUNT; t++) {
      const tier = this.tiers[t]!
      tier.geometry.geometry.instanceCount = tier.count
      tier.mesh.visible = tier.count > 0
      this.stats.tierCounts[t] = tier.count
      triangles += tier.count * tier.trianglesPerInstance
      if (tier.count > 0) {
        // Upload only the range actually written. `updateRanges` is what keeps a
        // near-empty LOD0 from re-sending the whole tier buffer every frame.
        tier.buffer.clearUpdateRanges()
        tier.buffer.addUpdateRange(0, tier.count * STRIDE)
        tier.buffer.needsUpdate = true
      }
    }

    this.stats.drawnPatches = drawn
    this.stats.culledCells = culledCells
    this.stats.triangles = triangles
  }

  /**
   * Exact 2D cone/circle classification: `OUTSIDE`, `INTERSECTS` or `INSIDE`.
   *
   * The quantity is `d = p·cos θ − a·sin θ`, the signed distance from the
   * circle's centre to the cone's edge, where `a` is the distance along the cone
   * axis and `p` the perpendicular distance. `d > r` is entirely outside,
   * `d < −r` entirely inside, and anything between straddles.
   *
   * `INSIDE` is the answer worth having, and it is the reason this returns three
   * states rather than a boolean: a cell that is fully inside can hand over all
   * 144 of its patches without a single further test, exactly as
   * `classifySphere` does for the scatter fields.
   *
   * The `a < −r` early out covers the apex. A patch the camera is standing *in*
   * is behind the apex on every measure and must never be culled — which is also
   * why anything closer than its own radius always straddles rather than failing.
   */
  private classifyCone(dx: number, dz: number, radius: number): number {
    const along = dx * _forward.x + dz * _forward.z
    if (along < -radius) {
      return OUTSIDE
    }
    // |cross| in 2D — the perpendicular distance to the axis.
    const perpendicular = Math.abs(dx * _forward.z - dz * _forward.x)
    const edge = perpendicular * this.coneCos - along * this.coneSin
    if (edge > radius) {
      return OUTSIDE
    }
    return edge < -radius ? INSIDE : INTERSECTS
  }

  /**
   * Recomputes the cone half-angle from the camera's *horizontal* FOV.
   *
   * three stores the vertical FOV, so the horizontal one has to be derived
   * through the aspect ratio — using the vertical angle directly would cull grass
   * inside the view on any landscape window, which is every window.
   */
  private refreshCone(camera: PerspectiveCamera): void {
    const margin = this.coneMarginOverride ?? this.detail.coneMarginDeg
    if (camera.fov === this.lastFov && camera.aspect === this.lastAspect && margin === this.lastMargin) {
      return
    }
    this.lastFov = camera.fov
    this.lastAspect = camera.aspect
    this.lastMargin = margin
    const halfVertical = (camera.fov * Math.PI) / 360
    const halfHorizontal = Math.atan(Math.tan(halfVertical) * camera.aspect)
    const half = Math.min(Math.PI - 0.01, halfHorizontal + (margin * Math.PI) / 180)
    this.coneCos = Math.cos(half)
    this.coneSin = Math.sin(half)
  }

  // ── settings ──────────────────────────────────────────────────────────────

  get currentLevel(): number {
    return this.level
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Switches detail level. **Allocates nothing and touches no vertex buffer.**
   *
   * ── Two mechanisms, both free ──────────────────────────────────────────────
   *
   * *Density* is `setDrawRange`. Every tier is baked once at full density, and
   * blades are written into the index buffer in sequence — so drawing the first
   * `N` blades of a tier is exactly `setDrawRange(0, N × trianglesPerBlade × 3)`.
   * The vertices past the range are never fetched.
   *
   * *Width* is a uniform (`uWidthScale`), applied in the vertex shader rather
   * than baked into `position.x`.
   *
   * The first version regenerated all six patch geometries here instead, and it
   * measured as a **34 ms frame on the click**. That is tolerable for a menu and
   * unacceptable for `auto`, where the level moves because `AdaptiveQuality` has
   * just decided the machine is struggling — spending 34 ms to prove it is the
   * one thing a quality controller must never do.
   */
  setLevel(level: number): void {
    const next = Math.max(0, Math.min(GRASS_LEVELS.length - 1, level))
    if (next === this.level) {
      return
    }
    this.level = next
    this.detail = GRASS_LEVELS[next]!
    // Force both derived values to recompute — the cone margin and the range
    // multiplier are both properties of the level.
    this.lastFov = -1
    this.lastBias = -1
    this.refreshScale()
    this.applyDensity()
    // Residency reach moved with the level too. Cells outside the new distance
    // are dropped by the next residency pass; cells inside it are built there.
  }

  private applyDensity(): void {
    const density = this.detail.density
    for (let tier = 0; tier < GRASS_TIER_COUNT; tier++) {
      const state = this.tiers[tier]!
      const blades = bladesForTier(tier, density)
      const compensation = widthCompensation(tier, density)
      this.bakedBlades[tier] = blades
      state.geometry.geometry.setDrawRange(0, blades * state.geometry.trianglesPerBlade * 3)
      state.trianglesPerInstance = blades * state.geometry.trianglesPerBlade
      state.material.setWidthScale(compensation)
      // The screen-width floor is expressed relative to the blade's *drawn*
      // width, so it has to follow the compensation or a thinned level would
      // widen twice.
      state.material.setBladeWidth(BLADE_HALF_WIDTH * BLADE_WIDTH_SCALE[tier]! * compensation)
    }
    // The ramp interpolates between the counts just written, so it follows them.
    this.applyTierRamps()
  }

  /**
   * Folds the global LOD bias into the range scale.
   *
   * Grass rides `lodBias` for the same reason everything else does: a 1.6× taller
   * framebuffer resolves 1.6× more detail at the same distance, so without it the
   * meadow visibly coarsens on a phone at the spot where it looked right on a
   * desktop — which players read as "low quality", not as "smaller screen".
   * Clamped harder than the props' table; see `MIN_BIAS`.
   */
  private refreshScale(): void {
    const bias = Math.max(MIN_BIAS, Math.min(MAX_BIAS, getLodBias()))
    if (bias === this.lastBias) {
      return
    }
    this.lastBias = bias
    this.rangeScale = this.detail.range * bias
    this.cullDistance = grassCullDistance(this.rangeScale)
    this.applyDetailUniforms()
    this.applyTierRamps()
  }

  /**
   * Pushes each tier's `(start, end, bladesAtStart, bladesAtEnd)` to its material.
   *
   * Depends on both the range scale and the baked blade counts, so it has to run
   * after either moves — a stale ramp would evaluate the density against the
   * previous level's distances and thin the meadow at the wrong radius.
   */
  private applyTierRamps(): void {
    for (let tier = 0; tier < GRASS_TIER_COUNT; tier++) {
      tierRamp(tier, this.rangeScale, this.bakedBlades, _ramp)
      this.tiers[tier]!.material.setTierRamp(_ramp)
    }
  }

  private applyDetailUniforms(): void {
    grassUniforms.uCullFar.value = this.cullDistance
    // The last 14 % of the range is where blades sink into the ground. Wide
    // enough to be gradual, narrow enough that the far tier is still grass for
    // most of its life.
    grassUniforms.uCullNear.value = this.cullDistance * 0.86
    // The wind fade scales with the tier table, so a level that pulls the whole
    // meadow in keeps the same *proportion* of it moving. Without this a
    // `minimum` field (52 m of grass) would be entirely inside a fade authored
    // for a 115 m one, and none of it would sway at all.
    grassUniforms.uWindNear.value = WIND_FADE_START * this.rangeScale
    grassUniforms.uWindFar.value = WIND_FADE_END * this.rangeScale
  }

  /** `false` frees nothing but stops all work and drawing — the `off` setting. */
  /**
   * Throws away every built patch so the residency pass places them again.
   *
   * The candidate list is untouched — the *chunks* have not changed, only the
   * rules for what may grow on them. That distinction is why this is not
   * `dropChunk` in a loop: dropping a candidate would leave grass permanently
   * absent from a chunk the terrain still has, and it would only come back if
   * the player walked far enough away to unload and reload the terrain.
   *
   * Called once, when the story hands the placer its building footprints. Grass
   * is placed per chunk and the chunks standing at that moment were built before
   * the exclusions existed, so without this the first ring of village around the
   * player keeps its blades coming up through the floorboards until they walk
   * away and back.
   */
  rebuild(): void {
    for (const key of [...this.cellByKey.keys()]) {
      this.removeCell(key)
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.group.visible = enabled
    if (!enabled) {
      for (const tier of this.tiers) {
        tier.mesh.visible = false
        tier.count = 0
        tier.geometry.geometry.instanceCount = 0
      }
      this.stats.drawnPatches = 0
      this.stats.triangles = 0
      this.stats.tierCounts.fill(0)
    }
  }

  /** Wind strength, so the world's `wind` toggle reaches grass too. */
  setWind(enabled: boolean): void {
    grassUniforms.uGrassWind.value = enabled ? 0.42 : 0
    grassUniforms.uTipLift.value = enabled ? 0.035 : 0
  }

  /** Hides the whole field. Used by the ablation profiler (GDD §5.3). */
  setVisible(visible: boolean): void {
    this.group.visible = visible && this.enabled
  }

  dispose(): void {
    for (const tier of this.tiers) {
      tier.geometry.geometry.dispose()
      tier.material.dispose()
    }
    this.tiers.length = 0
    this.cells.length = 0
    this.cellByKey.clear()
    this.candidates.length = 0
    this.candidateIndex.clear()
    this.group.clear()
  }
}
