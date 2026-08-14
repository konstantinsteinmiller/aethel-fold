import type { WorldAsset } from '../assets/types'
import { PerspectiveCamera, Scene, Vector3, type WebGLRenderer } from 'three'
import { createBoulderAsset, createStoneAsset } from '../assets/rock'
import { createTreeAsset } from '../assets/tree'
import { budgetLedger } from '../geometry/budget'
import { updateLodBiasFromView } from '../lod/config'
import type { InstancedLodField } from '../lod/InstancedLodField'
import { Profiler } from '../perf/Profiler'
import { createScatterField } from '../scatter'
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
  /** 0.6–1.0 quality slider. */
  renderScale: number
}

export interface WorldBuildInfo {
  buildMs: number
  treeInstances: number
  rockInstances: number
  terrainChunks: number
  budgets: { name: string; tris: number; budget: number }[]
}

export interface WorldOptions {
  seed?: number
  /** Square extent of the terrain, in metres. */
  worldSize?: number
}

export class World {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly camera: PerspectiveCamera
  readonly controller: OrbitCameraController
  readonly profiler: Profiler
  readonly terrain: Terrain
  readonly buildInfo: WorldBuildInfo

  readonly settings: WorldSettings = {
    outlines: true,
    shadows: true,
    wind: true,
    frustumCullInstances: true,
    renderScale: 1
  }

  private readonly lights: LightRig
  private readonly fields: InstancedLodField[] = []
  private readonly assets: WorldAsset[] = []
  private rafId: number | null = null
  private lastTime = 0
  private width = 1
  private height = 1
  private running = false

  constructor(canvas: HTMLCanvasElement, options: WorldOptions = {}) {
    const { seed = 1337, worldSize = 384 } = options
    const buildStart = performance.now()

    this.renderer = createRenderer({ canvas })
    this.camera = new PerspectiveCamera(55, 1, 0.5, 1200)
    this.controller = new OrbitCameraController(this.camera)
    this.profiler = new Profiler(this.renderer)

    this.scene.add(createSky())
    this.lights = createLightRig(this.scene)

    const field = new Heightfield({ seed })
    this.terrain = new Terrain(field, { size: worldSize, chunkSize: 48 })
    this.scene.add(this.terrain.group)
    this.profiler.registerRoot(this.terrain.group, 'terrain')

    // ── Scatter ────────────────────────────────────────────────────────────
    //
    // Several seeded variants per species rather than one. Instancing means a
    // variant costs one extra draw call per visible tier, and three visibly
    // different trees is the difference between a forest and a wallpaper.
    const treeSeeds = [11, 29, 47]
    let treeInstances = 0
    for (let i = 0; i < treeSeeds.length; i++) {
      const asset = createTreeAsset({ seed: treeSeeds[i]!, height: 5.0 + i * 0.7 })
      const scatter = createScatterField(field, asset, {
        extent: worldSize - 24,
        spacing: 11 + i * 2,
        seed: 300 + i * 97,
        maxSlope: 0.34,
        clusterSize: 95,
        clusterThreshold: 0.47,
        clearRadius: 16
      })
      this.registerField(asset, scatter, 'trees')
      treeInstances += scatter.count
    }

    let rockInstances = 0
    for (const [i, seed] of [23, 61].entries()) {
      const asset = createBoulderAsset({ seed })
      const scatter = createScatterField(field, asset, {
        extent: worldSize - 24,
        spacing: 26 + i * 7,
        seed: 700 + i * 131,
        maxSlope: 0.5,
        clusterSize: 140,
        clusterThreshold: 0.42,
        sink: 0.28,
        scaleRange: [0.7, 1.5],
        clearRadius: 10
      })
      this.registerField(asset, scatter, 'boulders')
      rockInstances += scatter.count
    }

    for (const [i, seed] of [5, 91].entries()) {
      const asset = createStoneAsset({ seed })
      const scatter = createScatterField(field, asset, {
        extent: worldSize - 24,
        spacing: 7 + i * 3,
        seed: 900 + i * 173,
        maxSlope: 0.55,
        clusterSize: 60,
        clusterThreshold: 0.44,
        sink: 0.1,
        scaleRange: [0.6, 1.4]
      })
      this.registerField(asset, scatter, 'stones')
      rockInstances += scatter.count
    }

    // ── Camera ─────────────────────────────────────────────────────────────
    this.controller.setGroundSampler((x, z) => field.heightAt(x, z))
    // Start off the origin and looking across the valley rather than down at the
    // spawn flat — the opening frame should show the terrain doing something.
    this.controller.setFocus(-38, field.heightAt(-38, 26) + 2.2, 26)

    this.buildInfo = {
      buildMs: performance.now() - buildStart,
      treeInstances,
      rockInstances,
      terrainChunks: this.terrain.chunks.length,
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
    this.controller.attach(element)
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
    this.controller.update(delta)

    // See the class notes — the LOD systems frustum-test against these, and
    // three wouldn't refresh them until inside render().
    this.camera.updateMatrixWorld()
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert()

    this.lights.follow(this.controller.focus)

    this.profiler.beginCpu('terrain')
    this.terrain.update(this.camera, this.camera.position)
    this.profiler.endCpu('terrain')

    for (const scatter of this.fields) {
      const tag = scatter.asset.perfTag
      this.profiler.beginCpu(tag)
      scatter.update(this.camera, this.camera.position)
      this.profiler.endCpu(tag)
    }

    this.renderer.render(this.scene, this.camera)
    this.profiler.endFrame(this.renderer, now)
  }

  dispose(): void {
    this.stop()
    this.controller.detach()
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
