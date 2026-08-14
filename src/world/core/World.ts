import type { WorldAsset } from '../assets/types'
import { type Mesh, PerspectiveCamera, Scene, Vector3, type WebGLRenderer } from 'three'
import { createBoulderAsset, createStoneAsset } from '../assets/rock'
import { createTreeAsset } from '../assets/tree'
import {
  disposeLevelEditor,
  heldPlacementId,
  installLevelEditor,
  levelPlacements,
  levelRevision,
  seedLevel,
  updateLevelEditor
} from '../editor'
import { registerAllPlaceables } from '../assets'
import { budgetLedger } from '../geometry/budget'
import { buildStartingLevel } from '../level/startingLevel'
import type { Placement } from '../level/types'
import { updateLodBiasFromView } from '../lod/config'
import { InstancedLodField, type InstanceTransform } from '../lod/InstancedLodField'
import { Profiler } from '../perf/Profiler'
import { createPlayer, type Player } from '../player'
import { addChunkScatter, maxInstancesPerChunk, type ScatterOptions } from '../scatter'
import { updateUnitsPerPixel, worldUniforms } from '../shading/globals'
import { Heightfield } from '../terrain/heightfield'
import { Terrain } from '../terrain/Terrain'
import { createLightRig, type LightRig } from './lighting'
import { OrbitCameraController } from './OrbitCameraController'
import { createRenderer, resizeRenderer } from './renderer'
import { createSky } from './sky'

/**
 * ─── World ──────────────────────────────────────────────────────────────────
 *
 * Owns the canvas and everything on it. The Vue layer holds exactly one
 * reference to this object and calls imperative methods on it — no reactive
 * proxy ever reaches a scene node (GDD §0).
 *
 * The frame is deliberately ordered: camera → matrices → LOD assignment →
 * render. LOD assignment needs `matrixWorldInverse` for its frustum tests, and
 * three only refreshes that inside `render()`, so the update is done by hand
 * before the systems run. Getting this backwards produces a one-frame-stale
 * frustum, which shows up as props popping in at the screen edge during fast
 * camera turns — and it is very hard to diagnose after the fact.
 */

export interface WorldSettings {
  outlines: boolean
  shadows: boolean
  wind: boolean
  frustumCullInstances: boolean
  /** Cell-level culling. Off = the original flat per-instance sweep (A/B). */
  hierarchical: boolean
  /** 0.6–1.0 quality slider. */
  renderScale: number
}

export interface WorldBuildInfo {
  buildMs: number
  treeInstances: number
  rockInstances: number
  terrainChunks: number
  /** Editor palette size — how many prop types the level editor can place. */
  placeables: number
  /** Props the starting level seeded. 0 once a saved level exists. */
  seededProps: number
  budgets: { name: string; tris: number; budget: number }[]
}

export interface WorldOptions {
  seed?: number
  /** Square extent of the terrain, in metres. */
  worldSize?: number
  /**
   * Multiplies scatter density. `2` is four times the instances (spacing is a
   * distance, so the count goes as the square).
   *
   * Exists to make culling and streaming work *measurable*: at the shipping
   * density the frame is vsync-bound and a 10× improvement in the instance loop
   * shows up as no change at all. Benchmarks run at 3–4.
   */
  densityScale?: number
}

/**
 * Orbit is the inspection camera the world was built with; first-person is the
 * capsule player. Both stay attached — a disabled controller ignores every
 * event — so switching is a flag, not a teardown.
 */
export type CameraMode = 'orbit' | 'firstPerson'

export class World {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly camera: PerspectiveCamera
  readonly controller: OrbitCameraController
  readonly profiler: Profiler
  readonly terrain: Terrain
  readonly buildInfo: WorldBuildInfo
  readonly player: Player

  readonly settings: WorldSettings = {
    outlines: true,
    shadows: true,
    wind: true,
    frustumCullInstances: true,
    hierarchical: true,
    renderScale: 1
  }

  private readonly sky: Mesh
  private readonly lights: LightRig
  private readonly fields: InstancedLodField[] = []
  /** Per-species scatter config, consulted by the terrain load hook. */
  private readonly scatterSpecies: { field: InstancedLodField; options: ScatterOptions }[] = []
  /** Reused across every chunk load — placement generation must not allocate. */
  private readonly scatterScratch: InstanceTransform[] = []
  private readonly assets: WorldAsset[] = []
  private rafId: number | null = null
  private lastTime = 0
  private width = 1
  private height = 1
  private running = false

  private cameraMode: CameraMode = 'orbit'

  /**
   * Placements the player collides with, refreshed only when the editor's
   * revision counter moves.
   *
   * `levelPlacements()` allocates and sorts, so polling it per frame would
   * violate the zero-per-frame-allocation rule (GDD §5.2). The revision compare
   * is one integer. The array identity is also deliberately stable between
   * changes — the player rebuilds its collider pool when the identity changes,
   * so handing it a fresh array every frame would defeat its cache too.
   */
  private cachedPlacements: Placement[] = []
  private lastLevelRevision = -1

  constructor(canvas: HTMLCanvasElement, options: WorldOptions = {}) {
    const { seed = 1337, worldSize = 384, densityScale = 1 } = options
    // Spacing is a distance, so dividing it by the scale squares the count.
    const spacingOf = (base: number): number => base / densityScale
    const buildStart = performance.now()

    this.renderer = createRenderer({ canvas })
    this.camera = new PerspectiveCamera(55, 1, 0.5, 1200)
    this.controller = new OrbitCameraController(this.camera)
    this.profiler = new Profiler(this.renderer)

    // Held, not just added: the dome has to follow the camera. It is a finite
    // sphere, so with a streamed (unbounded) world the player eventually walks
    // out through it and the horizon renders as black wedges — which is exactly
    // what happened at 1 km once terrain stopped being bounded.
    this.sky = createSky()
    this.scene.add(this.sky)
    this.lights = createLightRig(this.scene, { camera: this.camera })

    const field = new Heightfield({ seed })
    // `size` is deliberately NOT passed: with scatter streaming per chunk there
    // is nothing left that assumes a bounded world, so the terrain is infinite.
    // The starting level still sits near the origin; it just no longer defines
    // the edge of everything.
    const loadRadius = 190
    this.terrain = new Terrain(field, { chunkSize: 48, loadRadius })
    this.scene.add(this.terrain.group)
    this.profiler.registerRoot(this.terrain.group, 'terrain')

    // ── Scatter ────────────────────────────────────────────────────────────
    //
    // Several seeded variants per species rather than one. Instancing means a
    // variant costs one extra draw call per visible tier, and three visibly
    // different trees is the difference between a forest and a wallpaper.
    //
    // Fields are now empty shells: instances arrive per chunk from the terrain
    // streamer's load hook, so the world is unbounded and only what's nearby is
    // resident.
    const species: { asset: WorldAsset; tag: string; scatter: ScatterOptions }[] = []

    const treeSeeds = [11, 29, 47]
    for (let i = 0; i < treeSeeds.length; i++) {
      species.push({
        asset: createTreeAsset({ seed: treeSeeds[i]!, height: 5.0 + i * 0.7 }),
        tag: 'trees',
        scatter: {
          spacing: spacingOf(11 + i * 2),
          seed: 300 + i * 97,
          maxSlope: 0.34,
          clusterSize: 95,
          clusterThreshold: 0.47,
          clearRadius: 16
        }
      })
    }

    for (const [i, seed] of [23, 61].entries()) {
      species.push({
        asset: createBoulderAsset({ seed }),
        tag: 'boulders',
        scatter: {
          spacing: spacingOf(26 + i * 7),
          seed: 700 + i * 131,
          maxSlope: 0.5,
          clusterSize: 140,
          clusterThreshold: 0.42,
          sink: 0.28,
          scaleRange: [0.7, 1.5],
          clearRadius: 10
        }
      })
    }

    for (const [i, seed] of [5, 91].entries()) {
      species.push({
        asset: createStoneAsset({ seed }),
        tag: 'stones',
        scatter: {
          spacing: spacingOf(7 + i * 3),
          seed: 900 + i * 173,
          maxSlope: 0.55,
          clusterSize: 60,
          clusterThreshold: 0.44,
          sink: 0.1,
          scaleRange: [0.6, 1.4]
        }
      })
    }

    const chunkSize = this.terrain.size
    // Slots must cover every chunk that can be resident at once — the *unload*
    // radius, not the load radius, since a chunk lingers past the load boundary
    // by design. Over-reserving costs a few hundred KB; running out drops
    // scatter silently in the middle of a traversal.
    const residentChunks = Math.ceil((Math.PI * (loadRadius * 1.25) ** 2) / (chunkSize * chunkSize)) + 8

    for (const entry of species) {
      const capacity = residentChunks * maxInstancesPerChunk(entry.scatter.spacing, chunkSize)
      const scatter = new InstancedLodField(entry.asset, capacity)
      this.registerField(entry.asset, scatter, entry.tag)
      this.scatterSpecies.push({ field: scatter, options: entry.scatter })
    }

    // Scatter rides the terrain's residency decisions rather than running its
    // own — two systems deciding independently what is loaded eventually
    // disagree, and the failure mode is a tree standing on a chunk that no
    // longer exists.
    this.terrain.onChunkLoad = (key, originX, originZ, size) => {
      for (const entry of this.scatterSpecies) {
        addChunkScatter(entry.field, field, entry.options, key, originX, originZ, size, this.scatterScratch)
      }
    }
    this.terrain.onChunkUnload = key => {
      for (const entry of this.scatterSpecies) {
        entry.field.removeCell(key)
      }
    }

    // ── Camera ─────────────────────────────────────────────────────────────
    this.controller.setGroundSampler((x, z) => field.heightAt(x, z))
    // Start off the origin and looking across the valley rather than down at the
    // spawn flat — the opening frame should show the terrain doing something.
    this.controller.setFocus(-38, field.heightAt(-38, 26) + 2.2, 26)

    // ── Player ─────────────────────────────────────────────────────────────
    this.player = createPlayer({
      camera: this.camera,
      heightAt: (x, z) => field.heightAt(x, z),
      spawn: { x: -38, z: 26 },
      // Orbit owns the frame on boot; first-person is opt-in.
      enabled: false
    })
    this.scene.add(this.player.object)
    this.profiler.registerRoot(this.player.object, this.player.perfTag)
    // Stable identity between revisions — see `cachedPlacements`.
    this.player.setColliderSource(() => this.cachedPlacements)

    // ── Level editor ───────────────────────────────────────────────────────
    //
    // Placeables first so the palette is populated before the editor reads it.
    // The editor tolerates the other order (it retries unresolved placements on
    // its first update), but paying for that recovery path on every boot when
    // the ordering is ours to choose would be silly.
    const placeables = registerAllPlaceables()

    // Installed unconditionally: the code-word listener has to be live for
    // "cmonc" to ever be typed, and the editor itself does nothing until it is.
    installLevelEditor(this)

    // Seeded only on a fresh install (`onlyIfEmpty` is the default), so anyone
    // who has edited anything keeps their level untouched across reloads.
    const seeded = seedLevel(buildStartingLevel((x, z) => field.heightAt(x, z)))

    this.buildInfo = {
      buildMs: performance.now() - buildStart,
      treeInstances: 0,
      rockInstances: 0,
      terrainChunks: this.terrain.chunks.length,
      placeables: placeables.length,
      seededProps: seeded,
      budgets: budgetLedger.slice()
    }
  }

  private registerField(asset: WorldAsset, scatter: InstancedLodField, tag: string): void {
    this.assets.push(asset)
    this.fields.push(scatter)
    this.scene.add(scatter.group)
    this.profiler.registerRoot(scatter.group, tag)
  }

  attach(element: HTMLElement): void {
    // Both attach. Each ignores input while the other owns the frame, so a mode
    // switch never has to re-bind listeners — and can't lose a pointer capture
    // mid-drag.
    this.controller.attach(element)
    this.player.attach(element)
  }

  /**
   * Switches who drives the camera. The player is spawned at the orbit focus so
   * the view doesn't teleport, which also means you drop into first-person
   * exactly where you were looking.
   */
  setCameraMode(mode: CameraMode): void {
    if (this.cameraMode === mode) {
      return
    }
    this.cameraMode = mode

    if (mode === 'firstPerson') {
      const focus = this.controller.focus
      this.player.teleport(focus.x, this.terrain.heightAt(focus.x, focus.z), focus.z)
      this.player.setEnabled(true)
    } else {
      this.player.setEnabled(false)
      // Hand the orbit rig the player's last position, or the camera snaps back
      // to wherever it was parked before the switch.
      const position = this.player.position
      this.controller.setFocus(position.x, position.y, position.z)
    }
  }

  getCameraMode(): CameraMode {
    return this.cameraMode
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)

    const changed = resizeRenderer(this.renderer, this.width, this.height, this.settings.renderScale)
    this.camera.aspect = this.width / this.height
    this.camera.updateProjectionMatrix()

    if (changed) {
      const bufferHeight = this.renderer.getContext().drawingBufferHeight
      // Both of these are functions of the drawing buffer, so they'd silently
      // drift if only recomputed on construction: outlines would change
      // thickness with the window and LOD would coarsen on a resize.
      updateUnitsPerPixel(this.camera.fov, bufferHeight)
      updateLodBiasFromView(bufferHeight, this.camera.fov)
      // Cascade splits are derived from the projection, and CSM only refreshes
      // their uniforms here — `update()` re-fits the lights but not the splits.
      this.lights.onProjectionChanged()
    }
  }

  applySettings(partial: Partial<WorldSettings>): void {
    Object.assign(this.settings, partial)

    this.renderer.shadowMap.enabled = this.settings.shadows
    // Materials compiled against a shadow-enabled renderer need recompiling
    // when it flips, or they keep sampling a shadow map that's no longer bound.
    this.scene.traverse(object => {
      const material = (object as { material?: { needsUpdate: boolean } | { needsUpdate: boolean }[] }).material
      if (Array.isArray(material)) {
        for (const entry of material) {
          entry.needsUpdate = true
        }
      } else if (material) {
        material.needsUpdate = true
      }
    })

    worldUniforms.uWindSpeed.value = this.settings.wind ? 1.15 : 0

    for (const scatter of this.fields) {
      scatter.setFrustumCullInstances(this.settings.frustumCullInstances)
      scatter.setHierarchical(this.settings.hierarchical)
      scatter.setOutlinesEnabled(this.settings.outlines)
    }

    this.setSize(this.width, this.height)
  }

  start(): void {
    if (this.running) {
      return
    }
    this.running = true
    this.lastTime = performance.now()
    const tick = (now: number): void => {
      this.rafId = requestAnimationFrame(tick)
      this.frame(now)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  stop(): void {
    this.running = false
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  private frame(now: number): void {
    // Clamped: a backgrounded tab returns a multi-second delta, which would
    // teleport the camera and snap every LOD in one frame.
    const delta = Math.min(0.05, (now - this.lastTime) / 1000)
    this.lastTime = now

    this.profiler.beginFrame(this.renderer)

    worldUniforms.uTime.value += delta

    // Collider refresh first: the player is about to move against these, and a
    // one-frame-stale set means walking through a platform the frame after it
    // was placed. One integer compare on the quiet path.
    this.syncColliders()

    if (this.cameraMode === 'firstPerson') {
      this.profiler.beginCpu('player')
      this.player.update(delta)
      this.profiler.endCpu('player')
    } else {
      this.controller.update(delta)
    }

    // See the class notes — the LOD systems frustum-test against these, and
    // three wouldn't refresh them until inside render().
    this.camera.updateMatrixWorld()
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert()

    // The shadow frustum follows whoever is driving. Following the orbit focus
    // while in first-person would leave the player standing outside their own
    // shadow map at any real traversal speed.
    this.lights.follow(this.cameraMode === 'firstPerson' ? this.player.position : this.controller.focus)

    // After the camera matrices, because the editor's aim ray starts from them.
    this.profiler.beginCpu('editor')
    updateLevelEditor(this.camera.position)
    this.profiler.endCpu('editor')

    this.profiler.beginCpu('terrain')
    this.terrain.update(this.camera, this.camera.position)
    this.profiler.endCpu('terrain')

    for (const scatter of this.fields) {
      const tag = scatter.asset.perfTag
      this.profiler.beginCpu(tag)
      scatter.update(this.camera, this.camera.position)
      this.profiler.endCpu(tag)
    }

    // Recentre the sky on the viewer. Depth write is off and it renders first,
    // so moving it costs nothing and keeps the horizon closed at any distance
    // from the origin.
    this.sky.position.copy(this.camera.position)

    this.renderer.render(this.scene, this.camera)
    this.profiler.endFrame(this.renderer, now)
  }

  /**
   * Re-reads the level only when the editor says something changed.
   *
   * The held prop is excluded: while carried, its *stored* transform stays at
   * the pre-grab position (so a reload mid-carry can't lose it), and colliding
   * with that would leave a phantom platform hanging in the air where you
   * picked it up.
   */
  private syncColliders(): void {
    const revision = levelRevision()
    if (revision === this.lastLevelRevision) {
      return
    }
    this.lastLevelRevision = revision

    const held = heldPlacementId()
    const placements = levelPlacements()
    this.cachedPlacements = held === null ? placements : placements.filter(entry => entry.id !== held)
    this.player.invalidateColliders()
  }

  dispose(): void {
    this.stop()
    disposeLevelEditor()
    this.controller.detach()
    this.player.detach()
    this.player.dispose()
    for (const scatter of this.fields) {
      scatter.dispose()
    }
    this.fields.length = 0
    for (const asset of this.assets) {
      for (const geometry of asset.tiers) {
        geometry.dispose()
      }
      asset.material.dispose()
      asset.outline?.dispose()
    }
    this.assets.length = 0
    this.terrain.dispose()
    this.lights.dispose()
    this.profiler.dispose()
    this.renderer.dispose()
  }
}

/** Convenience for the `DitheredLod` path — hero props placed by hand. */
export const groundedPosition = (field: Heightfield, x: number, z: number, out = new Vector3()): Vector3 =>
  out.set(x, field.heightAt(x, z), z)
