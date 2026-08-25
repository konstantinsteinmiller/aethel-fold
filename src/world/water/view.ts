import { Mesh } from 'three'
import { waterStyle } from './styles'
import { createWaterPool, createWaterRiver } from './surface'
import type { HeightSampler, WaterPlacement } from './types'
import type { WaterBodyView } from './WaterEditor'
import { createWaterMaterial } from './waterMaterial'

/**
 * ─── The drawable behind an edited body of water ────────────────────────────
 *
 * `WaterEditor` owns *where* water is and *what style* it has; it deliberately
 * does not know how to build a surface. `surface.ts` owns that and knows nothing
 * about editing. This is the seam between them — the `WaterViewFactory` the
 * editor is handed once, at install.
 *
 * ── Why the seam exists at all ──────────────────────────────────────────────
 *
 * Without it the editor would import `surface.ts`, `waterMaterial.ts` and the
 * style table, and every test that wanted to check that a river node moves would
 * drag a full mesh generator and a shader compile in behind it. With it, the
 * editor is testable against a stub factory and the real generator arrives at
 * runtime — which is also what lets the tool stay usable before the factory is
 * set, drawing a flat proxy instead of nothing.
 *
 * ── The three rules a water mesh has to obey ────────────────────────────────
 *
 *   1. **Never casts a shadow.** The sheet is displaced in the material's own
 *      vertex stage and three's depth material knows nothing about that, so a
 *      casting water mesh drops the shadow of a flat plane it does not have.
 *      This is the same rule `WorldAsset.castsShadow` exists for on the props.
 *   2. **Pools are origin-centred and positioned; rivers are not.** A pool's
 *      geometry is built around (0,0) and the mesh is moved to the placement;
 *      a river's is built in world space directly from world-space nodes, so its
 *      mesh stays at the origin. Getting either the other way round puts the
 *      water somewhere else entirely.
 *   3. **`depthAt` is called in world space by both.** The pool takes
 *      `centerX`/`centerZ` to reach that contract from origin-centred geometry.
 *      They disagreed once — pool-local against world — and the cost of finding
 *      it is one silently misplaced shoreline.
 */

/**
 * A river needs two nodes before there is a channel to build.
 *
 * Returning `null` rather than throwing is the contract `WaterViewFactory`
 * states: a one-node draft is a legal, editable placement that simply has
 * nothing to draw yet, and the editor keeps its own ghost up over it.
 */
const MIN_RIVER_NODES = 2

export const createWaterView = (placement: Readonly<WaterPlacement>, ground: HeightSampler): WaterBodyView | null => {
  const style = waterStyle(placement.styleId)

  if (placement.kind === 'river') {
    if (placement.nodes.length < MIN_RIVER_NODES) {
      return null
    }
    const river = createWaterRiver({ nodes: placement.nodes, style, depthAt: ground })
    const material = createWaterMaterial({ style, name: `water-${placement.id}` })
    const mesh = new Mesh(river.geometry, material)
    mesh.name = `water/${placement.id}`
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.userData.perfTag = 'water'
    return {
      object: mesh,
      dispose: () => {
        mesh.geometry.dispose()
        material.dispose()
      }
    }
  }

  const pool = createWaterPool({
    halfX: placement.halfX,
    halfZ: placement.halfZ,
    surfaceY: placement.y,
    style,
    centerX: placement.x,
    centerZ: placement.z,
    depthAt: ground
  })
  const material = createWaterMaterial({ style, name: `water-${placement.id}` })
  const mesh = new Mesh(pool.geometry, material)
  mesh.name = `water/${placement.id}`
  // Rule 2: the geometry is centred on the origin, so the *mesh* carries the
  // placement. Yaw as well — a rectangular pool cut into a valley is the whole
  // reason `rotY` is on the placement.
  mesh.position.set(placement.x, 0, placement.z)
  mesh.rotation.y = placement.rotY
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.userData.perfTag = 'water'
  return {
    object: mesh,
    dispose: () => {
      mesh.geometry.dispose()
      material.dispose()
    }
  }
}
