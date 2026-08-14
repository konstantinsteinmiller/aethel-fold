import { CapsuleGeometry, type Color, Group, Mesh } from 'three'
import { C } from '../art/palette'
import { paintByHeight, paintByUpness } from '../geometry/vertexColor'
import { createOutlineMaterial, type OutlineMaterial } from '../shading/outlineMaterial'
import { createToonMaterial, type ToonMaterial } from '../shading/toonMaterial'

/**
 * ─── Player placeholder ─────────────────────────────────────────────────────
 *
 * The collision capsule made visible: same radius, same height, origin at the
 * feet so it can be driven straight from `PlayerController.position` with no
 * offset arithmetic at the call site. Hidden in first person, shown in the
 * third-person/debug view — which is the only way to *see* whether a step-up or
 * a wall slide did what the numbers say it did.
 *
 * It is built from the world's own toon material rather than a
 * `MeshNormalMaterial` debug shim on purpose. A placeholder that shades and
 * outlines like everything else tells you immediately whether the player is
 * lit, fogged and rim-lit correctly in a given spot; a magenta debug capsule
 * tells you nothing and has to be replaced before any of that can be judged.
 *
 * Colours come from the rock family (GDD §3 — no hex literals anywhere in
 * `src/world/`). Phase C's chibi human replaces this outright and brings its
 * own palette entries; spending new palette slots on a placeholder would leave
 * dead colours behind.
 *
 * Cost: 216 triangles plus a 216-triangle outline hull, two draw calls, one
 * material program (the shared toon family — no new compile).
 */

export interface CapsuleMeshOptions {
  radius?: number
  /** Total height, feet to crown. The cylindrical mid-section is `height − 2·radius`. */
  height?: number
  /** Body albedo at the crown; the base darkens toward the rock shadow tone. */
  color?: Color
  /** GDD R6 outline. Off is a hair cheaper; on is what the world actually looks like. */
  outline?: boolean
  perfTag?: string
  /** First person is the default state, so the mesh starts hidden. */
  visible?: boolean
}

export interface PlayerCapsule {
  /** Scene root. Add it once and move it; never re-parent per frame. */
  readonly group: Group
  readonly mesh: Mesh
  readonly perfTag: string
  setVisible(visible: boolean): void
  dispose(): void
}

export const createCapsuleMesh = (options: CapsuleMeshOptions = {}): PlayerCapsule => {
  const {
    radius = 0.35,
    height = 1.8,
    color = C.rockWarm,
    outline = true,
    perfTag = 'player',
    visible = false
  } = options

  // 4 cap segments × 12 radial reads as round at the 2–4 m the third-person
  // camera sits at, and lands at 216 triangles — a third of the Phase C chibi
  // human's LOD0 budget (GDD §4.1), which is where a placeholder belongs.
  const geometry = new CapsuleGeometry(radius, Math.max(0.01, height - radius * 2), 4, 12)
  // Origin at the feet: the controller's position *is* the feet, and an offset
  // applied per frame at the call site is an offset someone eventually forgets.
  geometry.translate(0, height / 2, 0)
  // No prop textures anywhere in this world (GDD §5.2), so UVs are dead weight
  // in the vertex buffer.
  geometry.deleteAttribute('uv')

  // Darker at the feet, lit at the crown — the same "this object sits in a
  // world" gradient every other asset here gets, and enough on its own to keep
  // a featureless capsule from reading as a flat silhouette.
  paintByHeight(geometry, C.rockShadow, color, { curve: 0.8 })
  paintByUpness(geometry, C.rockWarm, 0.35)

  const material: ToonMaterial = createToonMaterial({ name: 'player-capsule' })

  const mesh = new Mesh(geometry, material)
  mesh.name = 'player/capsule'
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.perfTag = perfTag

  let outlineMaterial: OutlineMaterial | null = null
  if (outline) {
    outlineMaterial = createOutlineMaterial({ name: 'player-capsule-outline' })
    const outlineMesh = new Mesh(geometry, outlineMaterial)
    outlineMesh.name = 'player/capsule/outline'
    outlineMesh.castShadow = false
    outlineMesh.receiveShadow = false
    // Drawn after the body so the hull's interior fails the depth test instead
    // of being shaded and then overdrawn.
    outlineMesh.renderOrder = 1
    outlineMesh.userData.perfTag = perfTag
    mesh.add(outlineMesh)
  }

  const group = new Group()
  group.name = 'player'
  group.userData.perfTag = perfTag
  group.visible = visible
  group.add(mesh)

  return {
    group,
    mesh,
    perfTag,
    setVisible: (next: boolean): void => {
      group.visible = next
    },
    dispose: (): void => {
      geometry.dispose()
      material.dispose()
      outlineMaterial?.dispose()
      group.clear()
    }
  }
}
