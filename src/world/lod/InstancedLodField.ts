import type { PerspectiveCamera } from 'three'
import {
  DynamicDrawUsage,
  Frustum,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Sphere,
  Vector3
} from 'three'
import type { WorldAsset } from '../assets/types'
import type { OutlineMaterial } from '../shading/outlineMaterial'
import type { ToonMaterial } from '../shading/toonMaterial'
import type { TerrainOcclusion } from '../perf/TerrainOcclusion'
import { coverageAt, cullDistanceFor, TIER_COUNT } from './config'

/**
 * ─── Instanced scatter with dithered LOD ────────────────────────────────────
 *
 * One field per asset. Instances live in a fixed-capacity slot pool grouped into
 * **cells**; each frame a cell is classified against the frustum once, then its
 * members are assigned to a tier (or two, inside a crossfade band) and the
 * tier's `InstancedMesh` is packed with what it needs.
 *
 * ── Cells are the unit of streaming *and* of culling ────────────────────────
 *
 * A cell is added and removed whole, which is what lets scatter stream with the
 * terrain chunk it belongs to. Slots come from a free list, so a cell's members
 * are *usually* contiguous but never guaranteed to be — correctness does not
 * depend on it, only cache locality does, and bulk adds keep runs long in
 * practice.
 *
 * ── The two costs, and how each is avoided ──────────────────────────────────
 *
 * **Matrix upload (expensive).** 64 bytes per instance per tier. Re-uploading
 * every frame at a few thousand instances is tens of MB/s of PCIe traffic for
 * data that almost never changes. So tier membership is tracked as a per-
 * instance bitmask, and a tier's matrix buffer is rebuilt *only* when its
 * membership actually changed. A stationary camera uploads zero matrices.
 *
 * **Fade upload (cheap).** 4 bytes per instance. Coverage changes continuously
 * for anything inside a band, so this can't be dirty-tracked usefully — but at
 * 12 KB for 3 000 instances it doesn't need to be. It's still skipped entirely
 * when no member of a tier is mid-fade.
 *
 * ── Sharing ─────────────────────────────────────────────────────────────────
 *
 * The outline mesh for a tier shares that tier's geometry *and* its
 * `instanceMatrix` / `aFade` attribute objects. One update feeds both draws;
 * the GPU buffers are bound twice, never duplicated.
 *
 * ── Ownership ───────────────────────────────────────────────────────────────
 *
 * The field clones the asset's tier geometries, because `aFade` is an
 * `InstancedBufferAttribute` living on the geometry — two fields sharing one
 * geometry would write each other's fades. Cloning ≤200-triangle geometry is
 * ~50 KB and happens once.
 */

/** One placed instance. Uniform scale only — see `addCell`. */
export interface InstanceTransform {
  x: number
  y: number
  z: number
  rotY: number
  scale: number
}

export interface InstancedLodFieldOptions {
  /**
   * Per-instance frustum culling. Worth it for wide fields, but note the
   * trade: rotating the camera changes membership, which dirties tiers and
   * forces a matrix re-upload. The perf panel can toggle this so the cost is
   * measurable rather than assumed.
   */
  frustumCullInstances?: boolean
  /** Tiers ≤ this cast shadows. GDD §5.1 keeps the shadow pass at 2 ms. */
  shadowMaxTier?: number
  /**
   * Cell-level culling. Turning it off reproduces the original flat per-instance
   * sweep exactly, which is the only honest way to A/B the two in one build —
   * comparing across commits measures the browser's mood as much as the code.
   */
  hierarchical?: boolean
}

// Module-level scratch — this runs per instance per frame (GDD §5.2).
const _matrix = new Matrix4()
const _position = new Vector3()
const _quaternion = new Quaternion()
const _scale = new Vector3()
const _sphere = new Sphere()
const _frustum = new Frustum()
const _viewProjection = new Matrix4()
const _coverage = new Float32Array(TIER_COUNT)
const _up = new Vector3(0, 1, 0)

interface Tier {
  mesh: InstancedMesh
  outline: InstancedMesh | null
  matrixArray: Float32Array
  fadeAttribute: InstancedBufferAttribute
  fadeArray: Float32Array
  count: number
  /** True when at least one member is mid-crossfade, so fades need uploading. */
  fading: boolean
  wasFading: boolean
}

/**
 * A spatial bucket of instances — the unit of both culling and streaming, so
 * the per-frame loop can skip a whole neighbourhood with one test and the
 * streamer can add or drop one with a terrain chunk.
 */
interface Cell {
  /** Stream key, normally the terrain chunk's. */
  key: string
  /** Bounding sphere in world space, sized to include instance extents. */
  centerX: number
  centerY: number
  centerZ: number
  radius: number
  /** Slot indices owned by this cell. Not required to be contiguous. */
  slots: Int32Array
  count: number
  /**
   * Terrain-occlusion cache. `version` of 0 means "not yet tested since the
   * camera last moved", which is treated as **visible** — see the notes in
   * `TerrainOcclusion`, unknown must never mean hidden.
   */
  occluded: boolean
  occludedVersion: number
  /**
   * Height of the tallest instance in the cell, and the cell's *horizontal*
   * half-extent. Kept apart from `radius` because occlusion needs to probe just
   * over the treetops, and a bounding-sphere radius is dominated by horizontal
   * spread — see `TerrainOcclusion.isRegionOccluded`.
   */
  topY: number
  spread: number
  /**
   * True while every instance in the cell is already masked off. Lets a cell
   * that is off-screen and *stays* off-screen cost literally nothing — without
   * it, hiding a cell would still mean walking its instances every frame just
   * to write zeroes they already hold.
   */
  dormant: boolean
}

/** Edge length of a culling cell. Matches the terrain chunk size on purpose. */
const CELL_SIZE = 48

export const OUTSIDE = -1
export const INTERSECTS = 0
export const INSIDE = 1

/**
 * Classifies a sphere against the frustum: outside, straddling, or fully
 * inside. `Frustum.intersectsSphere` only answers the first two, and the third
 * is the one worth having — a fully-inside cell can accept every instance
 * without a single per-instance plane test.
 */
export const classifySphere = (frustum: Frustum, x: number, y: number, z: number, radius: number): number => {
  let inside = true
  for (let i = 0; i < 6; i++) {
    const plane = frustum.planes[i]!
    const distance = plane.normal.x * x + plane.normal.y * y + plane.normal.z * z + plane.constant
    if (distance < -radius) {
      return OUTSIDE
    }
    if (distance < radius) {
      inside = false
    }
  }
  return inside ? INSIDE : INTERSECTS
}

export class InstancedLodField {
  readonly group = new Group()
  readonly asset: WorldAsset
  readonly capacity: number

  /** Live instance count. */
  get count(): number {
    return this.instanceCount
  }

  private instanceCount = 0
  private outlinesEnabled = true
  private readonly tiers: Tier[] = []
  private readonly sourceMatrices: Float32Array
  private readonly sourcePositions: Float32Array
  private readonly sourceRadii: Float32Array
  private readonly masks: Uint8Array
  private readonly cullDistance: number
  private readonly options: Required<InstancedLodFieldOptions>

  /** Bounding-sphere offset of the asset above its origin (a canopy is high). */
  private readonly sphereOffsetY: number
  private readonly sphereRadius: number
  /** Object-space top of the asset, for the occlusion probe height. */
  private readonly assetTopLocal: number = 0
  /** Object-space horizontal reach, added to a cell's spread. */
  private readonly assetReach: number = 0

  /** Per-tier visible instance counts, for the perf panel. */
  readonly tierCounts = new Int32Array(TIER_COUNT)

  /**
   * Live cells, in a stable order. Pass 1 and pass 2 walk this in the *same*
   * order — the fade array is filled in pass 1 and the matrices in pass 2, so a
   * mismatch would pair every instance with someone else's fade.
   */
  private cells: Cell[] = []
  private readonly cellByKey = new Map<string, Cell>()
  /** Slots not currently owned by any cell. */
  private readonly freeSlots: number[] = []
  /** Set when cell order changed, forcing every tier to repack. */
  private dirtyAll = false

  /** Cells touched last frame, split by classification — diagnostics only. */
  readonly cellStats = { total: 0, outside: 0, inside: 0, partial: 0, instancesTested: 0, occluded: 0 }

  /**
   * Terrain horizon culling. Applied *after* the frustum test, because a cell
   * that is already off-screen shouldn't spend a ray march to also learn it is
   * behind a hill.
   */
  private occlusion: TerrainOcclusion | null = null

  constructor(asset: WorldAsset, capacity: number, options: InstancedLodFieldOptions = {}) {
    this.asset = asset
    this.capacity = capacity
    this.options = {
      frustumCullInstances: options.frustumCullInstances ?? true,
      shadowMaxTier: options.shadowMaxTier ?? 1,
      hierarchical: options.hierarchical ?? true
    }
    this.group.name = `field:${asset.name}`
    this.group.userData.perfTag = asset.perfTag
    this.cullDistance = cullDistanceFor(asset.distanceScale)

    this.sourceMatrices = new Float32Array(capacity * 16)
    this.sourcePositions = new Float32Array(capacity * 3)
    this.sourceRadii = new Float32Array(capacity)
    this.masks = new Uint8Array(capacity)
    // Descending, so `pop()` hands out ascending slots and a bulk `addCell`
    // lands on a contiguous run — correctness doesn't need it, cache locality
    // in the per-frame walk does.
    for (let slot = capacity - 1; slot >= 0; slot--) {
      this.freeSlots.push(slot)
    }

    // ── Culling sphere, measured across EVERY tier ─────────────────────────
    //
    // Deliberately not `asset.radius`, and deliberately not LOD0's bounding
    // sphere either. Both under-report: a published radius is hand-derived from
    // the shape description and misses whatever the generator adds afterwards
    // (area inflation, a lump peak, a grass cap's rim lap), and tiers are
    // size-corrected against *each other* rather than against LOD0, so the tier
    // that pokes out furthest is routinely a coarse one.
    //
    // An undersized sphere doesn't look like a culling bug — the prop vanishes
    // at the screen edge while part of it is still visible, which reads as a
    // streaming failure. Measuring the real geometry costs one pass at build.
    let reach = 0
    let lowest = Number.POSITIVE_INFINITY
    let highest = Number.NEGATIVE_INFINITY
    for (const geometry of asset.tiers) {
      const position = geometry.getAttribute('position')
      const array = position.array as ArrayLike<number>
      for (let i = 0; i < position.count; i++) {
        const x = array[i * 3]!
        const y = array[i * 3 + 1]!
        const z = array[i * 3 + 2]!
        const horizontal = Math.sqrt(x * x + z * z)
        if (y < lowest) {
          lowest = y
        }
        if (y > highest) {
          highest = y
        }
        if (horizontal > reach) {
          reach = horizontal
        }
      }
    }
    if (!Number.isFinite(lowest)) {
      lowest = 0
      highest = asset.radius
    }
    // Centre the sphere on the mesh's vertical midpoint rather than its origin:
    // a tree's origin is at its foot, so an origin-centred sphere has to be
    // twice as large to contain the canopy.
    this.sphereOffsetY = (lowest + highest) / 2
    const halfHeight = (highest - lowest) / 2
    this.sphereRadius = Math.sqrt(reach * reach + halfHeight * halfHeight)
    // Object-space top and horizontal reach, kept for the occlusion probe.
    this.assetTopLocal = Number.isFinite(highest) ? highest : asset.radius
    this.assetReach = reach > 0 ? reach : asset.radius

    for (let tier = 0; tier < asset.tiers.length; tier++) {
      this.tiers.push(this.createTier(asset, tier, capacity))
    }
  }

  private createTier(asset: WorldAsset, tier: number, capacity: number): Tier {
    // Cloned so this field owns the `aFade` attribute — see class docs.
    const geometry = asset.tiers[tier]!.clone()

    const fadeArray = new Float32Array(capacity)
    const fadeAttribute = new InstancedBufferAttribute(fadeArray, 1)
    fadeAttribute.setUsage(DynamicDrawUsage)
    geometry.setAttribute('aFade', fadeAttribute)

    const material = asset.material.clone() as ToonMaterial
    const mesh = new InstancedMesh(geometry, material, capacity)
    mesh.name = `${asset.name}/LOD${tier}/instances`
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.count = 0
    mesh.visible = false
    mesh.castShadow = tier <= this.options.shadowMaxTier
    mesh.receiveShadow = true
    // Culling is per instance here; three's whole-mesh test would need a
    // bounding sphere recomputed from instanceMatrix every time we repack.
    mesh.frustumCulled = false
    mesh.userData.perfTag = asset.perfTag
    this.group.add(mesh)

    let outline: InstancedMesh | null = null
    if (asset.outline && tier <= asset.outlineMaxTier) {
      const outlineMaterial = asset.outline.clone() as OutlineMaterial
      outline = new InstancedMesh(geometry, outlineMaterial, capacity)
      outline.name = `${asset.name}/LOD${tier}/outline`
      // Share the buffers rather than maintaining a second copy: same GPU
      // memory, bound twice, and one update feeds both draws.
      outline.instanceMatrix = mesh.instanceMatrix
      outline.count = 0
      outline.visible = false
      outline.castShadow = false
      outline.receiveShadow = false
      outline.frustumCulled = false
      outline.renderOrder = 1
      outline.userData.perfTag = asset.perfTag
      this.group.add(outline)
    }

    return {
      mesh,
      outline,
      matrixArray: mesh.instanceMatrix.array as Float32Array,
      fadeAttribute,
      fadeArray,
      count: 0,
      fading: false,
      wasFading: false
    }
  }

  /**
   * Adds a whole cell of instances.
   *
   * Bulk, not one-at-a-time, because a cell is the unit that streams: it is
   * added when its terrain chunk loads and dropped when the chunk unloads, and
   * its bounding sphere has to be computed from the finished set anyway.
   *
   * Uniform scale only — the outline shader treats the instance matrix's
   * rotation block as orthogonal (see `outlineMaterial.ts`), and non-uniform
   * scale would thin the outline on the squashed axis.
   *
   * Returns false when the field is full. That is a soft failure on purpose:
   * dropping some scatter is survivable, throwing mid-traversal is not.
   */
  addCell(key: string, transforms: readonly InstanceTransform[]): boolean {
    if (this.cellByKey.has(key)) {
      return true
    }
    const count = transforms.length
    if (count === 0) {
      return true
    }
    if (this.freeSlots.length < count) {
      return false
    }

    const slots = new Int32Array(count)
    let sumX = 0
    let sumY = 0
    let sumZ = 0
    let maxRadius = 0

    for (let n = 0; n < count; n++) {
      const transform = transforms[n]!
      const slot = this.freeSlots.pop()!
      slots[n] = slot

      _position.set(transform.x, transform.y, transform.z)
      _quaternion.setFromAxisAngle(_up, transform.rotY)
      _scale.setScalar(transform.scale)
      _matrix.compose(_position, _quaternion, _scale)
      _matrix.toArray(this.sourceMatrices, slot * 16)

      this.sourcePositions[slot * 3] = transform.x
      this.sourcePositions[slot * 3 + 1] = transform.y
      this.sourcePositions[slot * 3 + 2] = transform.z
      const radius = this.sphereRadius * transform.scale
      this.sourceRadii[slot] = radius
      // Force a rebuild of whichever tier claims it on the first update.
      this.masks[slot] = 0xff

      sumX += transform.x
      sumY += transform.y
      sumZ += transform.z
      if (radius > maxRadius) {
        maxRadius = radius
      }
    }

    // Sphere around the cell's actual members, not the nominal grid square — a
    // sparsely-populated cell gets a tight sphere and culls better.
    const centerX = sumX / count
    const centerY = sumY / count + this.sphereOffsetY
    const centerZ = sumZ / count
    let extent = 0
    let horizontalExtent = 0
    let topY = Number.NEGATIVE_INFINITY
    for (let n = 0; n < count; n++) {
      const slot = slots[n]!
      const dx = this.sourcePositions[slot * 3]! - centerX
      const dy = this.sourcePositions[slot * 3 + 1]! + this.sphereOffsetY - centerY
      const dz = this.sourcePositions[slot * 3 + 2]! - centerZ
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (distance > extent) {
        extent = distance
      }
      const horizontal = Math.sqrt(dx * dx + dz * dz)
      if (horizontal > horizontalExtent) {
        horizontalExtent = horizontal
      }
      // Instance scale is uniform by contract, so the asset's object-space top
      // scales with the radius already stored for this slot.
      const scale = this.sphereRadius > 0 ? this.sourceRadii[slot]! / this.sphereRadius : 1
      const instanceTop = this.sourcePositions[slot * 3 + 1]! + this.assetTopLocal * scale
      if (instanceTop > topY) {
        topY = instanceTop
      }
    }

    const cell: Cell = {
      key,
      centerX,
      centerY,
      centerZ,
      radius: extent + maxRadius,
      slots,
      count,
      occluded: false,
      occludedVersion: 0,
      topY: Number.isFinite(topY) ? topY : centerY,
      spread: horizontalExtent + this.assetReach,
      dormant: false
    }
    this.cells.push(cell)
    this.cellByKey.set(key, cell)
    this.instanceCount += count
    return true
  }

  removeCell(key: string): void {
    const cell = this.cellByKey.get(key)
    if (!cell) {
      return
    }
    this.cellByKey.delete(key)
    const index = this.cells.indexOf(cell)
    if (index >= 0) {
      this.cells.splice(index, 1)
    }
    for (let n = 0; n < cell.count; n++) {
      const slot = cell.slots[n]!
      this.masks[slot] = 0
      this.freeSlots.push(slot)
    }
    this.instanceCount -= cell.count
    // Removing a cell reorders the ones after it, so every tier's packing is
    // stale — not just the tiers this cell was in.
    this.dirtyAll = true
  }

  hasCell(key: string): boolean {
    return this.cellByKey.has(key)
  }

  /** Slots available for new cells. The streamer uses this to avoid overfilling. */
  get freeCapacity(): number {
    return this.freeSlots.length
  }

  /**
   * Per-frame LOD assignment. Allocation-free; the only work proportional to
   * instance count is a distance test and, for tiers whose membership changed,
   * one matrix copy.
   */
  update(camera: PerspectiveCamera, cameraPosition: Vector3): void {
    const tiers = this.tiers
    const tierCount = tiers.length
    const scale = this.asset.distanceScale
    const cullSquared = this.cullDistance * this.cullDistance

    for (let t = 0; t < tierCount; t++) {
      tiers[t]!.count = 0
      tiers[t]!.fading = false
    }

    if (this.options.frustumCullInstances) {
      _viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      _frustum.setFromProjectionMatrix(_viewProjection)
    }

    let dirty = this.dirtyAll ? 0xff : 0
    this.dirtyAll = false
    const stats = this.cellStats
    stats.total = this.cells.length
    stats.outside = 0
    stats.inside = 0
    stats.partial = 0
    stats.instancesTested = 0
    stats.occluded = 0

    // ── Pass 1: walk cells, then only the instances a cell can't answer for ─
    //
    // The hierarchy is the whole point. Previously every instance paid a
    // 6-plane frustum test every frame, and — worse — membership churned on
    // every camera *rotation*, which dirtied the instanced matrix buffers and
    // re-uploaded them. Classifying a cell once resolves both: an off-screen
    // cell is skipped wholesale and then goes dormant, and a fully-inside cell
    // accepts its instances without any plane test at all.
    for (let c = 0; c < this.cells.length; c++) {
      const cell = this.cells[c]!

      const cdx = cell.centerX - cameraPosition.x
      const cdy = cell.centerY - cameraPosition.y
      const cdz = cell.centerZ - cameraPosition.z
      const cellDistance = Math.sqrt(cdx * cdx + cdy * cdy + cdz * cdz)

      let classification = INSIDE
      if (!this.options.hierarchical) {
        // A/B control: forces the per-instance path and disables dormancy, so
        // this branch behaves exactly like the pre-hierarchy sweep.
        classification = INTERSECTS
      } else if (cellDistance - cell.radius > this.cullDistance) {
        classification = OUTSIDE
      } else if (this.options.frustumCullInstances) {
        classification = classifySphere(_frustum, cell.centerX, cell.centerY, cell.centerZ, cell.radius)
      }

      // Behind a ridge counts as outside. Tested only for cells that survived
      // the frustum, and only while the occluder's per-frame budget lasts —
      // anything untested this frame keeps its previous answer, which starts at
      // "visible" whenever the camera has moved.
      const occlusion = this.occlusion
      if (occlusion && !occlusion.enabled) {
        // Disabled: drop any cached verdict rather than letting it keep culling.
        cell.occluded = false
      } else if (classification !== OUTSIDE && occlusion) {
        if (cell.occludedVersion !== occlusion.version) {
          if (occlusion.canTest()) {
            cell.occluded = occlusion.isRegionOccluded(cell.centerX, cell.topY, cell.centerZ, cell.spread)
            cell.occludedVersion = occlusion.version
          } else {
            cell.occluded = false
          }
        }
        if (cell.occluded) {
          classification = OUTSIDE
          stats.occluded++
        }
      }

      if (classification === OUTSIDE) {
        stats.outside++
        // Already all-zero from a previous frame: nothing to write, nothing to
        // dirty. This is where the saving actually lands, since most cells in a
        // large world are behind you.
        if (cell.dormant) {
          continue
        }
        for (let n = 0; n < cell.count; n++) {
          const i = cell.slots[n]!
          if (this.masks[i] !== 0) {
            dirty |= this.masks[i]!
            this.masks[i] = 0
          }
        }
        cell.dormant = true
        continue
      }

      cell.dormant = false
      // The `frustumCullInstances` clause matters for the A/B control path: it
      // forces INTERSECTS, which would otherwise re-enable per-instance frustum
      // tests the user had explicitly switched off.
      const skipPerInstanceFrustum = classification === INSIDE || !this.options.frustumCullInstances
      if (skipPerInstanceFrustum) {
        stats.inside++
      } else {
        stats.partial++
      }

      for (let n = 0; n < cell.count; n++) {
        const i = cell.slots[n]!
        const dx = this.sourcePositions[i * 3]! - cameraPosition.x
        const dy = this.sourcePositions[i * 3 + 1]! - cameraPosition.y
        const dz = this.sourcePositions[i * 3 + 2]! - cameraPosition.z
        const distanceSquared = dx * dx + dy * dy + dz * dz

        let mask = 0
        if (distanceSquared <= cullSquared) {
          let visible = true
          if (!skipPerInstanceFrustum) {
            _sphere.center.set(
              this.sourcePositions[i * 3]!,
              this.sourcePositions[i * 3 + 1]! + this.sphereOffsetY,
              this.sourcePositions[i * 3 + 2]!
            )
            _sphere.radius = this.sourceRadii[i]!
            visible = _frustum.intersectsSphere(_sphere)
            stats.instancesTested++
          }
          if (visible) {
            mask = coverageAt(Math.sqrt(distanceSquared), scale, _coverage)
          }
        }

        if (mask !== this.masks[i]) {
          // Every tier that gained or lost this instance needs a matrix rebuild.
          dirty |= mask ^ this.masks[i]!
          this.masks[i] = mask
        }

        if (mask === 0) {
          continue
        }

        for (let t = 0; t < tierCount; t++) {
          if ((mask & (1 << t)) === 0) {
            continue
          }
          const tierState = tiers[t]!
          const coverage = _coverage[t]!
          tierState.fadeArray[tierState.count] = coverage
          tierState.count++
          if (coverage !== 1) {
            tierState.fading = true
          }
        }
      }
    }

    // ── Pass 2: repack matrices, but only for tiers that actually changed ───
    for (let t = 0; t < tierCount; t++) {
      if ((dirty & (1 << t)) === 0) {
        continue
      }
      const tierState = tiers[t]!
      const target = tierState.matrixArray
      const source = this.sourceMatrices
      const bit = 1 << t
      let write = 0
      // Same cell order as pass 1 — the fade array was filled in that order and
      // the two are indexed together.
      for (let c = 0; c < this.cells.length; c++) {
        const cell = this.cells[c]!
        for (let n = 0; n < cell.count; n++) {
          const i = cell.slots[n]!
          if ((this.masks[i]! & bit) === 0) {
            continue
          }
          const from = i * 16
          const to = write * 16
          // Unrolled rather than `set(subarray(...))`: a subarray view is a
          // fresh object per call, and this runs thousands of times a frame.
          for (let k = 0; k < 16; k++) {
            target[to + k] = source[from + k]!
          }
          write++
        }
      }
      tierState.mesh.instanceMatrix.needsUpdate = true
    }

    // ── Commit ─────────────────────────────────────────────────────────────
    for (let t = 0; t < tierCount; t++) {
      const tierState = tiers[t]!
      const count = tierState.count
      this.tierCounts[t] = count

      tierState.mesh.count = count
      tierState.mesh.visible = count > 0
      if (tierState.outline) {
        tierState.outline.count = count
        tierState.outline.visible = count > 0 && this.outlinesEnabled
      }

      // Upload fades while anything is mid-transition, plus one final frame
      // after the last one lands so the buffer isn't left holding stale values.
      if (tierState.fading || tierState.wasFading) {
        tierState.fadeAttribute.needsUpdate = true
      }
      tierState.wasFading = tierState.fading
    }
  }

  /**
   * Outline visibility is re-derived every frame during tier commit, so it has
   * to live as a flag consulted there — setting `.visible = false` from outside
   * would be overwritten on the very next update.
   */
  setOutlinesEnabled(enabled: boolean): void {
    this.outlinesEnabled = enabled
    if (!enabled) {
      for (const tier of this.tiers) {
        if (tier.outline) {
          tier.outline.visible = false
        }
      }
    }
  }

  /** A/B control for the culling hierarchy. See `InstancedLodFieldOptions`. */
  setHierarchical(enabled: boolean): void {
    if (this.options.hierarchical === enabled) {
      return
    }
    this.options.hierarchical = enabled
    this.dirtyAll = true
    for (const cell of this.cells) {
      cell.dormant = false
    }
  }

  setOcclusion(occlusion: TerrainOcclusion | null): void {
    this.occlusion = occlusion
  }

  setFrustumCullInstances(enabled: boolean): void {
    if (this.options.frustumCullInstances === enabled) {
      return
    }
    this.options.frustumCullInstances = enabled
    // Membership is about to change wholesale; force a full repack, and wake
    // every cell — a dormant one would otherwise never re-evaluate.
    this.dirtyAll = true
    for (const cell of this.cells) {
      cell.dormant = false
    }
  }

  /** Hides the whole field. Used by the ablation profiler (GDD §5.3). */
  setVisible(visible: boolean): void {
    this.group.visible = visible
  }

  dispose(): void {
    for (const tier of this.tiers) {
      tier.mesh.geometry.dispose()
      ;(tier.mesh.material as ToonMaterial).dispose()
      tier.mesh.dispose()
      if (tier.outline) {
        ;(tier.outline.material as OutlineMaterial).dispose()
        tier.outline.dispose()
      }
    }
    this.tiers.length = 0
    this.group.clear()
  }
}
