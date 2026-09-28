import type { PerspectiveCamera, Vector3 } from 'three'
import { Group } from 'three'
import { InstancedLodField, type InstanceTransform } from '../lod/InstancedLodField'
import type { TerrainOcclusion } from '../perf/TerrainOcclusion'
import { getPlaceable } from './catalog'
import type { Placement } from './types'

/**
 * ─── Batched level placements ───────────────────────────────────────────────
 *
 * Hand-placed props are authored one at a time, but there is no reason to
 * *draw* them one at a time.
 *
 * The editor gives every placement its own `DitheredLod`, which is right while
 * you're editing — you have to be able to aim at one, pick it up and move it.
 * It is wrong the rest of the time: each node costs a draw call plus an outline
 * draw, so a 40-prop level was measured at **86 of the scene's 304 draw calls**,
 * more than terrain and trees combined, and past the 180 the GDD budgets for the
 * whole frame. Worse, it scales linearly — a level with 300 props would spend
 * 600 draws before anything else rendered.
 *
 * So placements are batched into one `InstancedLodField` per definition id
 * whenever the editor is closed, and the editor's individual nodes are hidden.
 * Opening the editor tears the batch down and hands the nodes back. Rebuilds are
 * cheap and rare: the batch only ever rebuilds on an editor *toggle*, never on a
 * placement edit, because edits can only happen while the editor is open and the
 * batch isn't in play then.
 *
 * ── Why placements are still spatially celled ───────────────────────────────
 *
 * One cell per definition would defeat `InstancedLodField`'s hierarchy: a single
 * cell spanning the whole level is never fully outside the frustum, so every
 * instance would go back to paying a per-instance plane test. Bucketing by the
 * same 48 m grid the terrain uses keeps cell culling meaningful.
 */

/** Matches the field's own cell size, so batch cells line up with terrain chunks. */
const CELL_SIZE = 48

export interface BatchStats {
  fields: number
  instances: number
  /** Placements whose definition isn't registered — carried by the editor as orphans. */
  unresolved: number
}

export class PlacementBatcher {
  readonly group = new Group()
  readonly stats: BatchStats = { fields: 0, instances: 0, unresolved: 0 }

  private fields: InstancedLodField[] = []
  /**
   * The field per definition id, so a caller can address one prop type.
   *
   * `fields` is enough for everything that applies to the whole batch — the
   * occlusion source, the outline switch — and is useless for the one thing that
   * does not: veiling `hut-roof` and nothing else. Built alongside `fields` in
   * `build` rather than searched, because the alternative is a linear scan by
   * `asset.name`, and an asset's name is not its `defId` (a cottage is
   * `house-cottage-401`).
   */
  private readonly byDefinition = new Map<string, InstancedLodField>()
  /** Veils applied before the field existed, replayed on the next build. */
  private readonly pendingVeils = new Map<string, number>()
  private built = false
  /** Re-applied to every field on rebuild, since fields are recreated. */
  private occlusionSource: TerrainOcclusion | null = null

  constructor() {
    this.group.name = 'level-batch'
    this.group.userData.perfTag = 'level'
  }

  get isBuilt(): boolean {
    return this.built
  }

  /**
   * Rebuilds from scratch. Cheap enough to do wholesale because it only runs on
   * an editor toggle — an incremental diff would be more code and more state for
   * a path that fires perhaps twice a session.
   */
  build(placements: readonly Placement[]): void {
    this.clear()

    // defId → cellKey → transforms
    const byDefinition = new Map<string, Map<string, InstanceTransform[]>>()
    let unresolved = 0

    for (const placement of placements) {
      if (!getPlaceable(placement.defId)) {
        unresolved++
        continue
      }
      let cells = byDefinition.get(placement.defId)
      if (!cells) {
        cells = new Map()
        byDefinition.set(placement.defId, cells)
      }
      const cellKey = `${Math.floor(placement.x / CELL_SIZE)}_${Math.floor(placement.z / CELL_SIZE)}`
      const bucket = cells.get(cellKey)
      const transform: InstanceTransform = {
        x: placement.x,
        y: placement.y,
        z: placement.z,
        rotY: placement.rotY,
        scale: placement.scale
      }
      if (bucket) {
        bucket.push(transform)
      } else {
        cells.set(cellKey, [transform])
      }
    }

    let instances = 0
    for (const [defId, cells] of byDefinition) {
      const definition = getPlaceable(defId)!
      let capacity = 0
      for (const bucket of cells.values()) {
        capacity += bucket.length
      }
      const field = new InstancedLodField(definition.asset, capacity)
      for (const [cellKey, bucket] of cells) {
        field.addCell(cellKey, bucket)
      }
      field.setOcclusion(this.occlusionSource)
      this.byDefinition.set(defId, field)
      const veil = this.pendingVeils.get(defId)
      if (veil !== undefined) {
        field.setVeil(veil)
      }
      this.group.add(field.group)
      this.fields.push(field)
      instances += capacity
    }

    this.stats.fields = this.fields.length
    this.stats.instances = instances
    this.stats.unresolved = unresolved
    this.built = true
  }

  update(camera: PerspectiveCamera, cameraPosition: Vector3): void {
    for (const field of this.fields) {
      field.update(camera, cameraPosition)
    }
  }

  /**
   * Veils every instance of one definition. 1 is solid, 0 invisible.
   *
   * Remembered rather than dropped when the definition has no field yet: a
   * chapter can ask for its roof to be see-through on any frame, and the batch
   * is rebuilt from scratch whenever the level changes — including once at the
   * end of the placeable drain. Without the memo a veil set during a
   * conversation would be silently thrown away by the next rebuild, which is a
   * roof that closes over the player's head mid-sentence.
   */
  setVeil(defId: string, value: number): void {
    this.pendingVeils.set(defId, value)
    this.byDefinition.get(defId)?.setVeil(value)
  }

  setOcclusion(occlusion: TerrainOcclusion | null): void {
    this.occlusionSource = occlusion
    for (const field of this.fields) {
      field.setOcclusion(occlusion)
    }
  }

  setOutlinesEnabled(enabled: boolean): void {
    for (const field of this.fields) {
      field.setOutlinesEnabled(enabled)
    }
  }

  setFrustumCullInstances(enabled: boolean): void {
    for (const field of this.fields) {
      field.setFrustumCullInstances(enabled)
    }
  }

  setHierarchical(enabled: boolean): void {
    for (const field of this.fields) {
      field.setHierarchical(enabled)
    }
  }

  clear(): void {
    for (const field of this.fields) {
      field.dispose()
    }
    this.fields.length = 0
    // The index goes; `pendingVeils` deliberately does not. See `setVeil`.
    this.byDefinition.clear()
    this.group.clear()
    this.stats.fields = 0
    this.stats.instances = 0
    this.stats.unresolved = 0
    this.built = false
  }

  dispose(): void {
    this.clear()
  }
}
