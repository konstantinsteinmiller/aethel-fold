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
import { coverageAt, cullDistanceFor, TIER_COUNT } from './config'

/**
 * ─── Instanced scatter with dithered LOD ────────────────────────────────────
 *
 * One field per asset. Every instance lives in a single source-of-truth matrix
 * buffer; each frame it is assigned to one tier (or two, inside a crossfade
 * band) and the tier's `InstancedMesh` is packed with the members it needs.
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

  /** Per-tier visible instance counts, for the perf panel. */
  readonly tierCounts = new Int32Array(TIER_COUNT)

  constructor(asset: WorldAsset, capacity: number, options: InstancedLodFieldOptions = {}) {
    this.asset = asset
    this.capacity = capacity
    this.options = {
      frustumCullInstances: options.frustumCullInstances ?? true,
      shadowMaxTier: options.shadowMaxTier ?? 1
    }
    this.group.name = `field:${asset.name}`
    this.group.userData.perfTag = asset.perfTag
    this.cullDistance = cullDistanceFor(asset.distanceScale)

    this.sourceMatrices = new Float32Array(capacity * 16)
    this.sourcePositions = new Float32Array(capacity * 3)
    this.sourceRadii = new Float32Array(capacity)
    this.masks = new Uint8Array(capacity)

    const sourceSphere = asset.tiers[0]!.boundingSphere
    this.sphereOffsetY = sourceSphere ? sourceSphere.center.y : asset.radius * 0.5
    this.sphereRadius = sourceSphere ? sourceSphere.radius : asset.radius

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
   * Adds one instance. Uniform scale only — the outline shader treats the
   * instance matrix's rotation block as orthogonal (see `outlineMaterial.ts`),
   * and non-uniform scale would thin the outline on the squashed axis.
   */
  add(position: Vector3, rotationY: number, scale: number): number {
    if (this.instanceCount >= this.capacity) {
      throw new Error(`[world] ${this.asset.name}: field is full at ${this.capacity} instances`)
    }
    const index = this.instanceCount++

    _quaternion.setFromAxisAngle(_up, rotationY)
    _scale.setScalar(scale)
    _matrix.compose(position, _quaternion, _scale)
    _matrix.toArray(this.sourceMatrices, index * 16)

    this.sourcePositions[index * 3] = position.x
    this.sourcePositions[index * 3 + 1] = position.y
    this.sourcePositions[index * 3 + 2] = position.z
    this.sourceRadii[index] = this.sphereRadius * scale
    // Force a rebuild of whichever tier claims it on the first update.
    this.masks[index] = 0xff

    return index
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

    let dirty = 0

    // ── Pass 1: assign tiers, write fades, detect membership changes ────────
    for (let i = 0; i < this.instanceCount; i++) {
      const dx = this.sourcePositions[i * 3]! - cameraPosition.x
      const dy = this.sourcePositions[i * 3 + 1]! - cameraPosition.y
      const dz = this.sourcePositions[i * 3 + 2]! - cameraPosition.z
      const distanceSquared = dx * dx + dy * dy + dz * dz

      let mask = 0
      if (distanceSquared <= cullSquared) {
        let visible = true
        if (this.options.frustumCullInstances) {
          _sphere.center.set(
            this.sourcePositions[i * 3]!,
            this.sourcePositions[i * 3 + 1]! + this.sphereOffsetY,
            this.sourcePositions[i * 3 + 2]!
          )
          _sphere.radius = this.sourceRadii[i]!
          visible = _frustum.intersectsSphere(_sphere)
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
      for (let i = 0; i < this.instanceCount; i++) {
        if ((this.masks[i]! & bit) === 0) {
          continue
        }
        const from = i * 16
        const to = write * 16
        // Unrolled rather than `set(subarray(...))`: a subarray view is a fresh
        // object per call, and this loop can run thousands of times a frame.
        for (let k = 0; k < 16; k++) {
          target[to + k] = source[from + k]!
        }
        write++
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

  setFrustumCullInstances(enabled: boolean): void {
    if (this.options.frustumCullInstances === enabled) {
      return
    }
    this.options.frustumCullInstances = enabled
    // Membership is about to change wholesale; force a full repack.
    this.masks.fill(0xff)
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
