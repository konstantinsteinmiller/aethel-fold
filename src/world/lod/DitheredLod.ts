import { Mesh, Object3D, Vector3 } from 'three'
import type { WorldAsset } from '../assets/types'
import type { OutlineMaterial } from '../shading/outlineMaterial'
import type { ToonMaterial } from '../shading/toonMaterial'
import { coverageAt, cullDistanceFor, TIER_COUNT } from './config'

/**
 * ─── Single-object dithered LOD ─────────────────────────────────────────────
 *
 * For hero props, placed set-dressing and terrain chunks — anything that exists
 * once rather than ten thousand times. Scatter goes through `InstancedLodField`.
 *
 * This replaces `THREE.LOD`, which hard-swaps children at threshold distances.
 * A hard swap is exactly the pop GDD R7 forbids: the eye is extremely good at
 * catching a silhouette changing in a single frame, even when the two
 * silhouettes are 95 % identical. Here both tiers render across a transition
 * band with complementary dither patterns, so the change is distributed over
 * ~15 % of the switch distance and over hundreds of frames.
 *
 * Each tier owns a *cloned* material purely so it can hold its own `uFade`;
 * the clone shares the compiled program, so this costs no extra shader
 * compilation and no extra program switches.
 */

const _worldPosition = new Vector3()
const _coverage = new Float32Array(TIER_COUNT)

export class DitheredLod extends Object3D {
  readonly asset: WorldAsset
  readonly tierMeshes: Mesh[] = []
  readonly outlineMeshes: (Mesh | null)[] = []

  private readonly materials: ToonMaterial[] = []
  private readonly outlineMaterials: (OutlineMaterial | null)[] = []
  private readonly cullDistance: number

  /** Set false to freeze the current tier — used by the ablation profiler. */
  autoUpdate = true

  constructor(asset: WorldAsset) {
    super()
    this.asset = asset
    this.name = `lod:${asset.name}`
    this.userData.perfTag = asset.perfTag
    this.cullDistance = cullDistanceFor(asset.distanceScale)

    for (let tier = 0; tier < asset.tiers.length; tier++) {
      const material = asset.material.clone()
      const mesh = new Mesh(asset.tiers[tier]!, material)
      mesh.name = `${asset.name}/LOD${tier}`
      // Tiers are positioned by this container; three's own frustum culling
      // would test each tier separately against a bounding sphere we already
      // know is identical, so it's turned off and handled once here.
      mesh.frustumCulled = false
      mesh.castShadow = tier <= 1
      mesh.receiveShadow = true
      mesh.visible = false
      mesh.userData.perfTag = asset.perfTag
      this.add(mesh)
      this.tierMeshes.push(mesh)
      this.materials.push(material)

      if (asset.outline && tier <= asset.outlineMaxTier) {
        const outlineMaterial = asset.outline.clone() as OutlineMaterial
        const outlineMesh = new Mesh(asset.tiers[tier]!, outlineMaterial)
        outlineMesh.name = `${asset.name}/LOD${tier}/outline`
        outlineMesh.frustumCulled = false
        outlineMesh.castShadow = false
        outlineMesh.receiveShadow = false
        // Drawn *after* the object so the hull's interior pixels fail the depth
        // test instead of being shaded and then overdrawn.
        outlineMesh.renderOrder = 1
        outlineMesh.userData.perfTag = asset.perfTag
        mesh.add(outlineMesh)
        this.outlineMeshes.push(outlineMesh)
        this.outlineMaterials.push(outlineMaterial)
      } else {
        this.outlineMeshes.push(null)
        this.outlineMaterials.push(null)
      }
    }
  }

  /** Call once per frame with the camera's world position. Allocation-free. */
  update(cameraPosition: Vector3): void {
    if (!this.autoUpdate) {
      return
    }

    this.getWorldPosition(_worldPosition)
    const distance = _worldPosition.distanceTo(cameraPosition)

    if (distance > this.cullDistance) {
      for (let tier = 0; tier < this.tierMeshes.length; tier++) {
        this.tierMeshes[tier]!.visible = false
      }
      return
    }

    coverageAt(distance, this.asset.distanceScale, _coverage)

    for (let tier = 0; tier < this.tierMeshes.length; tier++) {
      const coverage = _coverage[tier]!
      const visible = Math.abs(coverage) > 0.002
      const mesh = this.tierMeshes[tier]!
      mesh.visible = visible
      if (!visible) {
        continue
      }
      this.materials[tier]!.setFade(coverage)
      this.outlineMaterials[tier]?.setFade(coverage)
      // Only the dominant tier casts, so a crossfade can't double-darken the
      // shadow map (GDD §4.3).
      mesh.castShadow = tier <= 1 && Math.abs(coverage) >= 0.5
    }
  }

  /** Which tier is currently dominant. For the perf panel and for tests. */
  currentTier(): number {
    let best = -1
    let bestCoverage = 0
    for (let tier = 0; tier < this.tierMeshes.length; tier++) {
      if (!this.tierMeshes[tier]!.visible) {
        continue
      }
      const coverage = Math.abs(this.materials[tier]!.uFade.value)
      if (coverage > bestCoverage) {
        bestCoverage = coverage
        best = tier
      }
    }
    return best
  }

  dispose(): void {
    for (const material of this.materials) {
      material.dispose()
    }
    for (const material of this.outlineMaterials) {
      material?.dispose()
    }
  }
}
