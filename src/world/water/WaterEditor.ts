import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector2,
  Vector3,
  type Intersection,
  type Object3D,
  type PerspectiveCamera,
  type Scene
} from 'three'
import { C } from '../art/palette'
import { DEFAULT_WATER_STYLE, WATER_STYLES, waterStyle, waterStyleIds } from './styles'
import type { HeightSampler, RiverNode, WaterPlacement } from './types'

/**
 * ─── Water placement editor (scene side) ────────────────────────────────────
 *
 * The prop editor (`editor/LevelEditor.ts`) places points with a yaw and a
 * uniform scale. Water is neither: a sea is *non-uniformly* sized and a river
 * is a polyline with a per-node width, which is why `WaterPlacement` is not a
 * `Placement` (see the note in `types.ts`). So this is a **parallel editor with
 * its own storage key**, not a mode bolted onto that one — sharing
 * `world_editor_placements` between two schemas would corrupt both the first
 * time either saved.
 *
 * The two tools are live at the same time, so **every binding here is
 * `Alt`-modified** and none of them touch the wheel. That is not decoration:
 *
 *   · `LevelEditor.onKeyDown` returns early on `event.altKey`, so Alt+key can
 *     never reach the prop editor — but a *bare* key would collide with its
 *     G/F/X/Q/E, and Alt+wheel would still hit its rotate, because its wheel
 *     handler does not test the Alt modifier.
 *   · `OrbitCameraController` records every `event.code` regardless of
 *     modifiers and acts on WASD/arrows, so W, A, S and D are unusable here
 *     even with Alt held.
 *   · Chrome and Firefox claim Alt+F, Alt+E, Alt+D, Alt+V, Alt+S, Alt+B, Alt+T
 *     and Alt+H for their own menus, and Alt+digit switches tabs in Firefox —
 *     `preventDefault` does not reliably win those back. None are used below.
 *
 * Bindings, and the panel's legend, in one place:
 *
 *   Alt+P / Alt+R / Alt+O    pool mode · river mode · off
 *   Alt+Click / Alt+G        place a pool · append a river node
 *   Alt+drag                 scale the new pool in X and Z independently
 *   Alt+Shift+Click / Alt+X  delete the aimed body of water
 *   Alt+J / Alt+L            half-X − / +   (river: active node's half-width)
 *   Alt+K / Alt+I            half-Z − / +   (river: unused, a channel has none)
 *   Alt+[ / Alt+]            rotate ∓15°    (+Shift 90°)
 *   Alt+− / Alt+=            surface height ∓10 cm (+Shift 1 m)
 *   Alt+Backspace            undo the last river node
 *   Alt+Enter                finish the run (+Shift closes it into a loop)
 *   Alt+, / Alt+.            step which river node the width/height keys edit
 *   Alt+Y                    cycle style (+Shift backwards)
 *   +Shift on J/K/L/I        coarse step, 5 m instead of 0.5 m
 *
 * **Nothing in this file is reactive.** The panel drives it through
 * `editorFacade.ts`, which mirrors primitives into `ref`s; a `BufferGeometry`
 * reaching a Vue `ref` would have the whole world deep-proxied (GDD §0).
 *
 * The class does not know how to *build* water. It renders each placement
 * through a `WaterViewFactory` and ships a deliberately cheap proxy (a flat
 * translucent sheet in the style's own palette colour) so the tool is usable
 * before the surface generator exists. Hand it the real one with
 * `setViewFactory` and every body rebuilds through it.
 */

/**
 * Its own key. The prop editor's `world_editor_placements` holds `Placement[]`,
 * a different schema — sharing the key would have each tool's save destroy the
 * other's layout on the next load.
 */
export const WATER_PLACEMENTS_KEY = 'world_water_placements'
/** Live style tuning, kept out of the placement array so that stays a clean `WaterPlacement[]`. */
export const WATER_STYLE_KEY = 'world_water_style_tuning'

/** How far the aim ray searches before giving up (metres). */
const AIM_MAX_DISTANCE = 400
/** Terrain march bounds — see `LevelEditor.marchTerrain`, the same sphere-trace. */
const AIM_MIN_STEP = 0.35
const AIM_MAX_STEP = 6
const AIM_REFINE_STEPS = 14
/** A body this much further away than the terrain is still what the crosshair is over. */
const AIM_BIAS = 0.35

const DEGREES = Math.PI / 180
const TAU = Math.PI * 2

/** A pool smaller than this is a puddle the foam band alone would cover. */
const MIN_HALF = 0.5
const MAX_HALF = 400
const HALF_STEP = 0.5
const HALF_STEP_COARSE = 5

const MIN_NODE_HALF_WIDTH = 0.4
const MAX_NODE_HALF_WIDTH = 60

const HEIGHT_STEP = 0.1
const HEIGHT_STEP_COARSE = 1
const HEIGHT_MIN = -200
const HEIGHT_MAX = 400

const ROT_STEP = 15
const ROT_STEP_COARSE = 90

const DEFAULT_HALF_X = 6
const DEFAULT_HALF_Z = 6
const DEFAULT_NODE_HALF_WIDTH = 2.5

/**
 * Spline capacity. Fixed, because the ghost's line buffers are allocated once
 * at this size and then written in place — a river that grew past a
 * `BufferAttribute` would have to reallocate one from the frame loop.
 */
const MAX_RIVER_NODES = 64

/**
 * How far the pointer must travel from a new pool's centre before the click
 * becomes a resize drag. Without it every plain Alt+Click would collapse the
 * pool it just placed to `MIN_HALF`, because the drag starts with the pointer
 * exactly on the centre.
 */
const DRAG_ARM_METRES = 1.5

/** Gizmo tint, derived from the palette — `CLAUDE.md` R2 admits no hex literals. */
const GHOST_COLOR = new Color().copy(C.waterFoam).lerp(C.rim, 0.35)

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))
/**
 * Kills float dust from repeated addition, or the readout shows 6.500000000001.
 * The `|| 0` is not decoration: a marched aim point lands a hair below zero, and
 * `-0` survives in memory but comes back from `JSON.parse` as `0` — so a saved
 * layout would compare unequal to the one that wrote it.
 */
const tidy = (value: number): number => Math.round(value * 1e4) / 1e4 || 0

export type WaterEditMode = 'off' | 'pool' | 'river'

/** The `WaterStyle` fields a live slider may drive. Colours are not tunable here. */
export type WaterStyleNumberKey =
  | 'waveAmplitude'
  | 'waveLength'
  | 'waveSpeed'
  | 'flowSpeed'
  | 'depthFalloff'
  | 'foamWidth'
  | 'crestFoam'
  | 'opacity'
  | 'sparkle'
  | 'rimStrength'

export const STYLE_NUMBER_KEYS: readonly WaterStyleNumberKey[] = [
  'waveAmplitude',
  'waveLength',
  'waveSpeed',
  'flowSpeed',
  'depthFalloff',
  'foamWidth',
  'crestFoam',
  'opacity',
  'sparkle',
  'rimStrength'
]

/**
 * What the editor needs from the world. A structural interface rather than
 * `World` itself: it keeps the unit tests free of a `WebGLRenderer` (there is
 * no WebGL in jsdom) and it documents the four things this tool actually
 * touches. `World` satisfies it as it stands.
 */
export interface WaterEditorHost {
  scene: Scene
  camera: PerspectiveCamera
  renderer: { domElement: HTMLCanvasElement }
  terrain: { heightAt: (x: number, z: number) => number }
  profiler?: { registerRoot: (object: Object3D, tag: string) => void }
}

/** One rendered body of water. The editor owns parenting; `dispose` frees the view's own resources. */
export interface WaterBodyView {
  object: Object3D
  dispose(): void
}

/**
 * Builds the drawable for a placement — the seam where the real surface
 * generator arrives. Returning `null` (for an incomplete river, say) is legal
 * and leaves the body invisible but still editable.
 */
export type WaterViewFactory = (placement: Readonly<WaterPlacement>, ground: HeightSampler) => WaterBodyView | null

export interface WaterEditorSnapshot {
  mode: WaterEditMode
  /** Style applied to the next body placed, and to the one under the crosshair. */
  styleId: string
  bodyCount: number
  /** Extent of the aimed pool, or of the ghost that previews the next one. */
  halfX: number
  halfZ: number
  /**
   * Absolute surface Y when a pool or a river node is being edited; otherwise
   * the pending offset above the aimed ground. `surfaceRelative` says which,
   * because "12.4" and "+0.4" mean very different things in a readout.
   */
  surfaceY: number
  surfaceRelative: boolean
  rotationDeg: number
  /** Nodes in the run being laid, the one-node draft included. */
  riverNodes: number
  /** Index of the node the width/height keys edit, or -1. */
  activeNode: number
  nodeHalfWidth: number
  /** True while a run is open — a draft or a river still being extended. */
  building: boolean
}

interface WaterBody {
  placement: WaterPlacement
  view: WaterBodyView | null
  /** Own slot in `list`, so removal is a swap-pop rather than a splice. */
  index: number
  /** Rebuild pending. Coalesced to at most one rebuild per frame — see `flushDirty`. */
  dirty: boolean
}

const EMPTY_NODES: readonly RiverNode[] = []

/** Is a water layout already stored in this browser? Answerable without an editor. */
export const hasStoredWater = (): boolean => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(WATER_PLACEMENTS_KEY) : null
    if (!raw) {
      return false
    }
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length > 0
  } catch {
    return false
  }
}

export class WaterEditor {
  /** Root for every body of water and every gizmo. Registered with the profiler. */
  readonly group = new Group()

  /** Fired on mutation and on mode change — never per frame, bar a live drag. */
  onStateChange: ((snapshot: WaterEditorSnapshot) => void) | null = null
  /**
   * Fired when the crosshair moves onto or off a body. Separate from
   * `onStateChange` because aiming is not a mutation and must not advance the
   * revision — a collider consumer polling it would rebuild every frame.
   */
  onAimChange: ((id: string, kind: string) => void) | null = null

  private readonly host: WaterEditorHost
  private readonly canvas: HTMLCanvasElement
  private readonly ground: HeightSampler

  private readonly list: WaterBody[] = []
  private readonly byId = new Map<string, WaterBody>()

  private readonly raycaster = new Raycaster()
  private readonly aimTargets: Object3D[] = []
  private readonly hits: Intersection[] = []
  /** Pointer in NDC. Screen centre until the mouse first moves. */
  private readonly pointer = new Vector2()

  private readonly aimPoint = new Vector3()
  private aimValid = false
  private aimedId = ''

  private mode: WaterEditMode = 'off'
  private styleId = DEFAULT_WATER_STYLE
  private seq = 0
  private rev = 0
  private disposed = false
  private dirtyCount = 0

  /** Pending pool extent: what the ghost shows and what the next Alt+Click places. */
  private halfX = DEFAULT_HALF_X
  private halfZ = DEFAULT_HALF_Z
  private rotY = 0
  /**
   * Metres above the aimed ground for a new surface. Sticky across placements —
   * the common job is a chain of pools at one height — and shown in the panel so
   * it can never strand you somewhere invisible.
   */
  private lift = 0

  /**
   * The pool the extent keys edit: whatever the crosshair is over. With nothing
   * aimed they edit the pending extent instead, so a size can be dialled in
   * before the first click and re-dialled without a selection step.
   */
  private editingId = ''

  /**
   * A river needs two nodes to be a river, so a **one-node run is not a
   * placement** — it is held here and never saved. The second node promotes it
   * into `list`, where it renders and persists immediately (a crash mid-run
   * costs at most the last click), and undoing back below two nodes demotes it
   * to a draft again rather than leaving a one-node body no generator can
   * tessellate.
   */
  private draft: RiverNode | null = null
  private buildingId = ''
  private activeNode = -1
  private nodeHalfWidth = DEFAULT_NODE_HALF_WIDTH

  private dragId = ''
  private dragArmed = false
  /** Last extent pushed to the panel, in tenths of a metre — see `updateDrag`. */
  private lastEmitX = -1
  private lastEmitZ = -1

  /** Live style tuning, applied on top of `WATER_STYLES` at construction. */
  private readonly tuning = new Map<string, Partial<Record<WaterStyleNumberKey, number>>>()

  private viewFactory: WaterViewFactory

  // ── gizmos ────────────────────────────────────────────────────────────────
  private readonly ghostMaterial = new LineBasicMaterial({
    color: GHOST_COLOR,
    transparent: true,
    opacity: 0.9,
    // An editor outline a hill can hide is an outline you cannot line up
    // against the hill.
    depthTest: false,
    fog: false
  })
  private readonly poolGhost: LineLoop
  private readonly riverGhost: Line
  private readonly riverTicks: LineSegments
  private readonly ghostLine: Float32Array
  private readonly ghostTicks: Float32Array
  private readonly ghostWidths: Float32Array

  // ── proxy view resources ──────────────────────────────────────────────────
  /** Unit quad in the XZ plane, shared by every proxy pool. Scaled, never rebuilt. */
  private readonly proxyQuad: BufferGeometry
  private readonly proxyMaterials = new Map<string, MeshBasicMaterial>()

  constructor(host: WaterEditorHost) {
    this.host = host
    this.canvas = host.renderer.domElement
    this.ground = (x, z) => host.terrain.heightAt(x, z)
    this.group.name = 'water-editor'
    host.scene.add(this.group)
    host.profiler?.registerRoot(this.group, 'water')

    this.viewFactory = placement => this.buildProxyView(placement)

    this.proxyQuad = new BufferGeometry()
    this.proxyQuad.setAttribute(
      'position',
      new Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3)
    )
    this.proxyQuad.setAttribute('normal', new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3))
    this.proxyQuad.setIndex([0, 1, 2, 0, 2, 3])

    const rect = new BufferGeometry()
    rect.setAttribute('position', new Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3))
    this.poolGhost = new LineLoop(rect, this.ghostMaterial)
    this.poolGhost.renderOrder = 999
    this.poolGhost.visible = false
    this.poolGhost.frustumCulled = false
    this.group.add(this.poolGhost)

    // Capacity for the whole run plus the segment that trails the crosshair.
    this.ghostLine = new Float32Array((MAX_RIVER_NODES + 1) * 3)
    this.ghostWidths = new Float32Array(MAX_RIVER_NODES + 1)
    const centre = new BufferGeometry()
    centre.setAttribute('position', new Float32BufferAttribute(this.ghostLine, 3))
    this.riverGhost = new Line(centre, this.ghostMaterial)
    this.riverGhost.renderOrder = 999
    this.riverGhost.visible = false
    this.riverGhost.frustumCulled = false
    this.group.add(this.riverGhost)

    // Two endpoints per node: the cross-tick that shows that node's own
    // half-width, which is the only way to see a per-node width edit before the
    // ribbon exists.
    this.ghostTicks = new Float32Array((MAX_RIVER_NODES + 1) * 2 * 3)
    const ticks = new BufferGeometry()
    ticks.setAttribute('position', new Float32BufferAttribute(this.ghostTicks, 3))
    this.riverTicks = new LineSegments(ticks, this.ghostMaterial)
    this.riverTicks.renderOrder = 999
    this.riverTicks.visible = false
    this.riverTicks.frustumCulled = false
    this.group.add(this.riverTicks)

    this.loadTuning()
    this.load()

    window.addEventListener('pointerdown', this.onPointerDown, { capture: true })
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp, { capture: true })
    window.addEventListener('keydown', this.onKeyDown)
  }

  // ── mode ──────────────────────────────────────────────────────────────────

  setMode(mode: WaterEditMode): void {
    if (this.mode === mode) {
      return
    }
    this.mode = mode
    if (mode !== 'river') {
      // Leaving river mode with a run open would leave the ghost trailing the
      // crosshair for a run nothing can add to any more.
      this.finishRun()
    }
    if (mode === 'off') {
      this.aimValid = false
      this.endDrag()
      this.setAimed('')
    }
    this.poolGhost.visible = false
    this.riverGhost.visible = false
    this.riverTicks.visible = false
    this.notify()
  }

  currentMode(): WaterEditMode {
    return this.mode
  }

  isActive(): boolean {
    return this.mode !== 'off'
  }

  // ── style ─────────────────────────────────────────────────────────────────

  /**
   * Select the style for the next body — and, live, for the one under the
   * crosshair, so cycling styles with a pond aimed shows the change instead of
   * only promising it on the next placement.
   */
  setStyle(id: string): void {
    const resolved = waterStyle(id).id
    const changed = this.styleId !== resolved
    this.styleId = resolved
    const target = this.byId.get(this.aimedId) ?? this.byId.get(this.buildingId)
    if (target && target.placement.styleId !== resolved) {
      target.placement.styleId = resolved
      this.markDirty(target)
      this.mutate()
      return
    }
    if (changed) {
      this.notify()
    }
  }

  cycleStyle(direction: number): void {
    const ids = waterStyleIds()
    if (ids.length === 0) {
      return
    }
    const at = ids.indexOf(this.styleId)
    const next = ids[((((at < 0 ? 0 : at) + direction) % ids.length) + ids.length) % ids.length]
    if (next) {
      this.setStyle(next)
    }
  }

  currentStyleId(): string {
    return this.styleId
  }

  /**
   * Live-tune one number of a preset.
   *
   * This mutates the shared `WATER_STYLES` entry, so every body wearing that
   * style follows immediately — which is the point: the presets *are* the art
   * direction, and tuning them against the actual scene is the only way to
   * judge them. The override is persisted under its own key so a reload does
   * not discard an evening of dialling; `styles.ts` stays the committed source
   * of truth, and the export logs the tuned values so they can be folded back
   * into it by hand.
   */
  setStyleParam(styleId: string, key: WaterStyleNumberKey, value: number): void {
    const style = WATER_STYLES[styleId]
    if (!style || !Number.isFinite(value) || style[key] === value) {
      return
    }
    style[key] = value
    const overrides = this.tuning.get(styleId) ?? {}
    overrides[key] = value
    this.tuning.set(styleId, overrides)
    this.saveTuning()
    // The wave and foam dials feed the shader, not the tessellation — but a
    // generator is free to bake either into a vertex attribute, so a rebuild is
    // the honest answer. It is coalesced to one per frame regardless.
    for (const body of this.list) {
      if (body.placement.styleId === styleId) {
        this.markDirty(body)
      }
    }
    this.notify()
  }

  /** The tuned numbers of a preset, as plain numbers — never the `WaterStyle` itself. */
  styleValues(styleId: string): Record<WaterStyleNumberKey, number> {
    const style = waterStyle(styleId)
    return {
      waveAmplitude: style.waveAmplitude,
      waveLength: style.waveLength,
      waveSpeed: style.waveSpeed,
      flowSpeed: style.flowSpeed,
      depthFalloff: style.depthFalloff,
      foamWidth: style.foamWidth,
      crestFoam: style.crestFoam,
      opacity: style.opacity,
      sparkle: style.sparkle,
      rimStrength: style.rimStrength
    }
  }

  /** Tuned values only, for the export note. Empty when nothing was touched. */
  styleOverrides(): Record<string, Partial<Record<WaterStyleNumberKey, number>>> {
    const out: Record<string, Partial<Record<WaterStyleNumberKey, number>>> = {}
    for (const [id, values] of this.tuning) {
      out[id] = { ...values }
    }
    return out
  }

  // ── the view factory seam ────────────────────────────────────────────────

  /**
   * Swap the drawable builder — this is where the real surface generator lands.
   * Every existing body is rebuilt through it, so it may be called at any time.
   * Passing `null` restores the built-in proxy.
   */
  setViewFactory(factory: WaterViewFactory | null): void {
    this.viewFactory = factory ?? (placement => this.buildProxyView(placement))
    for (const body of this.list) {
      this.markDirty(body)
    }
  }

  // ── per-frame ─────────────────────────────────────────────────────────────

  /**
   * Call once per frame. No camera argument: unlike the prop editor this owns
   * no LOD nodes to tick, and taking one would only imply it did.
   *
   * Allocation-free in the steady state — the ghost writes into buffers sized
   * in the constructor. The two exceptions both run *only while a water mode is
   * on*, i.e. never in a shipped session: `Raycaster` allocates an
   * `Intersection` per hit triangle (three offers no way to pool them), and a
   * resize drag emits a snapshot object, quantised to 10 cm so a slow drag
   * emits a handful of times a second rather than sixty.
   */
  update(): void {
    if (this.disposed) {
      return
    }
    this.flushDirty()
    if (this.mode === 'off') {
      return
    }
    this.resolveAim()
    this.updateDrag()
    this.updateGhosts()
  }

  /**
   * At most one rebuild per frame. Key repeat and a resize drag can dirty the
   * same body many times between frames, and the real generator tessellates —
   * paying for that once per frame instead of once per event is the difference
   * between a smooth drag and a stutter.
   */
  private flushDirty(): void {
    if (this.dirtyCount === 0) {
      return
    }
    for (let i = 0; i < this.list.length; i++) {
      const body = this.list[i]!
      if (body.dirty) {
        body.dirty = false
        this.dirtyCount--
        this.rebuildView(body)
        return
      }
    }
    // Every flag was already cleared (a dirty body was removed).
    this.dirtyCount = 0
  }

  // ── aim ───────────────────────────────────────────────────────────────────

  /**
   * Two independent answers, deliberately:
   *
   *   `aimPoint` — always the **terrain**, never a water surface. A pool covers
   *                the ground it sits on, and if the aim point snapped to it you
   *                could not run a river through a pond or overlap two pools.
   *   `aimedId`  — the body under the crosshair, for delete and for the
   *                style-and-extent-follow-the-aim behaviour.
   *
   * The terrain test marches the heightfield rather than raycasting
   * `terrain.group`, for the reason spelled out in `LevelEditor.resolveAim`:
   * the chunk meshes carry all four LOD tiers at once and `Raycaster` ignores
   * `visible`, so a ray would happily return a hit on the LOD3 silhouette or on
   * a chunk skirt hanging below the seam.
   */
  private resolveAim(): void {
    this.raycaster.setFromCamera(this.pointer, this.host.camera)
    this.raycaster.far = AIM_MAX_DISTANCE

    const terrainDistance = this.marchTerrain()
    this.aimValid = terrainDistance >= 0
    if (this.aimValid) {
      this.aimPoint
        .copy(this.raycaster.ray.direction)
        .multiplyScalar(terrainDistance)
        .add(this.raycaster.ray.origin)
    }

    let hitId = ''
    if (this.aimTargets.length > 0) {
      this.hits.length = 0
      this.raycaster.intersectObjects(this.aimTargets, false, this.hits)
      const hit = this.hits[0]
      if (hit && (terrainDistance < 0 || hit.distance - terrainDistance < AIM_BIAS)) {
        hitId = (hit.object.userData.waterId as string | undefined) ?? ''
      }
      this.hits.length = 0
    }
    this.setAimed(hitId)
  }

  private setAimed(id: string): void {
    if (this.aimedId === id) {
      return
    }
    this.aimedId = id
    const body = id ? this.byId.get(id) : undefined
    // A drag owns the extent for its whole duration: the pointer sits on the
    // pool's own corner, so the aim flickering on and off it must not hand the
    // keys to something else halfway through.
    if (!this.dragId) {
      if (body && body.placement.kind === 'pool') {
        this.adoptPool(body)
      } else {
        this.editingId = ''
      }
    }
    this.onAimChange?.(id, body?.placement.kind ?? '')
  }

  /** Distance along the aim ray to the terrain, or -1 if it never hits. */
  private marchTerrain(): number {
    const { origin, direction } = this.raycaster.ray

    let distance = 0
    let clearance = origin.y - this.ground(origin.x, origin.z)
    if (clearance <= 0) {
      // Camera under the surface — a one-frame transient at most. Aiming at zero
      // is harmless and avoids a march that would report a hit behind the near
      // plane.
      return 0
    }

    while (distance < AIM_MAX_DISTANCE) {
      const step = Math.min(Math.max(clearance * 0.6, AIM_MIN_STEP), AIM_MAX_STEP)
      const next = distance + step
      const nextClearance =
        origin.y + direction.y * next - this.ground(origin.x + direction.x * next, origin.z + direction.z * next)

      if (nextClearance <= 0) {
        // Bisect the bracketing interval. Fourteen halvings of a ≤6 m step lands
        // well inside a millimetre.
        let low = distance
        let high = next
        for (let i = 0; i < AIM_REFINE_STEPS; i++) {
          const mid = (low + high) * 0.5
          const gap =
            origin.y + direction.y * mid - this.ground(origin.x + direction.x * mid, origin.z + direction.z * mid)
          if (gap <= 0) {
            high = mid
          } else {
            low = mid
          }
        }
        return high
      }
      distance = next
      clearance = nextClearance
    }
    return -1
  }

  // ── ghosts ────────────────────────────────────────────────────────────────

  private updateGhosts(): void {
    this.poolGhost.visible = false
    this.riverGhost.visible = false
    this.riverTicks.visible = false

    if (this.mode === 'pool') {
      if (!this.aimValid) {
        return
      }
      const target = this.byId.get(this.dragId) ?? this.byId.get(this.editingId)
      const pool = target && target.placement.kind === 'pool' ? target.placement : null
      if (pool) {
        this.poolGhost.position.set(pool.x, pool.y, pool.z)
        this.poolGhost.rotation.y = pool.rotY
        this.poolGhost.scale.set(pool.halfX, 1, pool.halfZ)
      } else {
        this.poolGhost.position.set(this.aimPoint.x, this.aimPoint.y + this.lift, this.aimPoint.z)
        this.poolGhost.rotation.y = this.rotY
        this.poolGhost.scale.set(this.halfX, 1, this.halfZ)
      }
      this.poolGhost.visible = true
      return
    }
    if (this.mode === 'river') {
      this.drawRiverGhost()
    }
  }

  /**
   * Centreline through the run plus a segment trailing the crosshair, and a
   * cross-tick per node at that node's half-width. Written into buffers sized
   * once in the constructor: a river gains nodes one click at a time, and
   * reallocating an attribute per click would orphan a GPU buffer every time.
   */
  private drawRiverGhost(): void {
    const nodes = this.currentNodes()
    let count = 0
    if (this.draft) {
      this.writeGhostPoint(count++, this.draft.x, this.draft.y, this.draft.z, this.draft.halfWidth)
    }
    for (let i = 0; i < nodes.length && count <= MAX_RIVER_NODES; i++) {
      const node = nodes[i]!
      this.writeGhostPoint(count++, node.x, node.y, node.z, node.halfWidth)
    }
    if (this.aimValid && count <= MAX_RIVER_NODES) {
      this.writeGhostPoint(count++, this.aimPoint.x, this.aimPoint.y + this.lift, this.aimPoint.z, this.nodeHalfWidth)
    }
    if (count < 2) {
      return
    }

    this.riverGhost.geometry.getAttribute('position').needsUpdate = true
    this.riverGhost.geometry.setDrawRange(0, count)
    this.riverGhost.visible = true

    for (let i = 0; i < count; i++) {
      const at = i * 3
      const x = this.ghostLine[at]!
      const y = this.ghostLine[at + 1]!
      const z = this.ghostLine[at + 2]!
      const prev = (i > 0 ? i - 1 : i) * 3
      const next = (i + 1 < count ? i + 1 : i) * 3
      let tx = this.ghostLine[next]! - this.ghostLine[prev]!
      let tz = this.ghostLine[next + 2]! - this.ghostLine[prev + 2]!
      const length = Math.hypot(tx, tz)
      if (length < 1e-5) {
        tx = 0
        tz = 1
      } else {
        tx /= length
        tz /= length
      }
      // Perpendicular in XZ.
      const half = this.ghostWidths[i]!
      const ox = tz * half
      const oz = -tx * half
      const base = i * 6
      this.ghostTicks[base] = x + ox
      this.ghostTicks[base + 1] = y
      this.ghostTicks[base + 2] = z + oz
      this.ghostTicks[base + 3] = x - ox
      this.ghostTicks[base + 4] = y
      this.ghostTicks[base + 5] = z - oz
    }
    this.riverTicks.geometry.getAttribute('position').needsUpdate = true
    this.riverTicks.geometry.setDrawRange(0, count * 2)
    this.riverTicks.visible = true
  }

  private writeGhostPoint(index: number, x: number, y: number, z: number, halfWidth: number): void {
    const at = index * 3
    this.ghostLine[at] = x
    this.ghostLine[at + 1] = y
    this.ghostLine[at + 2] = z
    this.ghostWidths[index] = halfWidth
  }

  private currentNodes(): readonly RiverNode[] {
    const body = this.byId.get(this.buildingId)
    return body ? body.placement.nodes : EMPTY_NODES
  }

  // ── pools ─────────────────────────────────────────────────────────────────

  /**
   * Place a pool at the aim point with the pending extent. Returns its id.
   *
   * The extent survives placement, because the common job is a run of pools at
   * one size — and it is dialled independently in X and Z, which is the whole
   * reason water does not go through the prop schema: a uniform scale cannot
   * make a sea wider than it is deep.
   */
  placePool(): string | null {
    if (this.mode !== 'pool' || !this.aimValid) {
      return null
    }
    const placement: WaterPlacement = {
      id: `w${++this.seq}`,
      kind: 'pool',
      styleId: this.styleId,
      x: tidy(this.aimPoint.x),
      y: tidy(this.aimPoint.y + this.lift),
      z: tidy(this.aimPoint.z),
      rotY: this.rotY,
      halfX: this.halfX,
      halfZ: this.halfZ,
      nodes: []
    }
    this.attach(placement)
    this.editingId = placement.id
    this.mutate()
    return placement.id
  }

  /** Adopt an existing pool's numbers as the pending ones, so the keys edit *it*. */
  private adoptPool(body: WaterBody): void {
    this.editingId = body.placement.id
    this.halfX = body.placement.halfX
    this.halfZ = body.placement.halfZ
    this.rotY = body.placement.rotY
  }

  /**
   * Resize along one axis — **independently**, which is the requirement a
   * uniform scale cannot meet. In river mode the X axis maps to the active
   * node's half-width (a channel has no second horizontal extent) and the Z
   * axis does nothing.
   */
  resizeBy(axis: 'x' | 'z', direction: number, coarse: boolean): void {
    const step = (coarse ? HALF_STEP_COARSE : HALF_STEP) * direction

    if (this.mode === 'river') {
      if (axis === 'z') {
        return
      }
      this.nodeWidthBy(step)
      return
    }

    const body = this.byId.get(this.editingId)
    const target = body && body.placement.kind === 'pool' ? body.placement : null
    if (axis === 'x') {
      this.halfX = tidy(clamp((target?.halfX ?? this.halfX) + step, MIN_HALF, MAX_HALF))
      if (target) {
        target.halfX = this.halfX
      }
    } else {
      this.halfZ = tidy(clamp((target?.halfZ ?? this.halfZ) + step, MIN_HALF, MAX_HALF))
      if (target) {
        target.halfZ = this.halfZ
      }
    }
    if (body && target) {
      this.markDirty(body)
      this.mutate()
      return
    }
    this.notify()
  }

  rotateBy(degrees: number): void {
    const body = this.byId.get(this.editingId)
    const target = body && body.placement.kind === 'pool' ? body.placement : null
    this.rotY = ((target?.rotY ?? this.rotY) + degrees * DEGREES) % TAU
    if (body && target) {
      target.rotY = this.rotY
      this.markDirty(body)
      this.mutate()
      return
    }
    this.notify()
  }

  /**
   * Raise or lower the surface. On a pool that is its whole surface Y; on a
   * river it is the active node's height only, because the nodes are what make
   * a river run downhill and moving them together would flatten it.
   */
  heightBy(direction: number, coarse: boolean): void {
    const step = (coarse ? HEIGHT_STEP_COARSE : HEIGHT_STEP) * direction

    if (this.mode === 'river') {
      const body = this.byId.get(this.buildingId)
      const node = body?.placement.nodes[this.activeNode]
      if (body && node) {
        node.y = tidy(clamp(node.y + step, HEIGHT_MIN, HEIGHT_MAX))
        this.markDirty(body)
        this.mutate()
        return
      }
      if (this.draft) {
        this.draft.y = tidy(clamp(this.draft.y + step, HEIGHT_MIN, HEIGHT_MAX))
        this.notify()
        return
      }
      this.lift = tidy(clamp(this.lift + step, HEIGHT_MIN, HEIGHT_MAX))
      this.notify()
      return
    }

    const body = this.byId.get(this.editingId)
    if (body && body.placement.kind === 'pool') {
      body.placement.y = tidy(clamp(body.placement.y + step, HEIGHT_MIN, HEIGHT_MAX))
      this.markDirty(body)
      this.mutate()
      return
    }
    this.lift = tidy(clamp(this.lift + step, HEIGHT_MIN, HEIGHT_MAX))
    this.notify()
  }

  // ── rivers ────────────────────────────────────────────────────────────────

  /**
   * Append one spline node at the aim point. The first is a draft — see the
   * field comment. Returns the node count afterwards (the draft counted), or 0.
   */
  appendNode(): number {
    if (this.mode !== 'river' || !this.aimValid) {
      return 0
    }
    const node: RiverNode = {
      x: tidy(this.aimPoint.x),
      y: tidy(this.aimPoint.y + this.lift),
      z: tidy(this.aimPoint.z),
      halfWidth: this.nodeHalfWidth
    }

    const building = this.byId.get(this.buildingId)
    if (building) {
      if (building.placement.nodes.length >= MAX_RIVER_NODES) {
        return building.placement.nodes.length
      }
      building.placement.nodes.push(node)
      this.activeNode = building.placement.nodes.length - 1
      this.markDirty(building)
      this.mutate()
      return building.placement.nodes.length
    }

    if (this.draft) {
      const placement: WaterPlacement = {
        id: `w${++this.seq}`,
        kind: 'river',
        styleId: this.styleId,
        // A river's transform lives in its nodes; the centre is carried only so
        // a consumer has something to sort and cull by.
        x: this.draft.x,
        y: this.draft.y,
        z: this.draft.z,
        rotY: 0,
        halfX: 0,
        halfZ: 0,
        nodes: [this.draft, node]
      }
      this.draft = null
      this.attach(placement)
      this.buildingId = placement.id
      this.activeNode = 1
      this.mutate()
      return 2
    }

    this.draft = node
    this.activeNode = -1
    this.notify()
    return 1
  }

  /** Remove the last node. Demotes a 2-node river back to a draft. Returns the new count. */
  undoNode(): number {
    const building = this.byId.get(this.buildingId)
    if (!building) {
      if (this.draft) {
        this.draft = null
        this.notify()
      }
      return 0
    }
    const nodes = building.placement.nodes
    nodes.pop()
    if (nodes.length < 2) {
      const first = nodes[0] ?? null
      this.detach(building)
      building.view?.dispose()
      this.refreshAimTargets()
      this.buildingId = ''
      this.draft = first
      this.activeNode = -1
      this.mutate()
      return first ? 1 : 0
    }
    this.activeNode = Math.min(this.activeNode, nodes.length - 1)
    this.markDirty(building)
    this.mutate()
    return nodes.length
  }

  /** Step which node the width and height keys edit. */
  stepActiveNode(direction: number): void {
    const building = this.byId.get(this.buildingId)
    if (!building) {
      return
    }
    const count = building.placement.nodes.length
    if (count === 0) {
      return
    }
    const next = (((this.activeNode + direction) % count) + count) % count
    if (next === this.activeNode) {
      return
    }
    this.activeNode = next
    this.nodeHalfWidth = building.placement.nodes[next]?.halfWidth ?? this.nodeHalfWidth
    this.notify()
  }

  /** Widen or narrow the active node — or the pending width when no run is open. */
  private nodeWidthBy(step: number): void {
    const building = this.byId.get(this.buildingId)
    const node = building?.placement.nodes[this.activeNode] ?? this.draft
    const next = tidy(clamp((node?.halfWidth ?? this.nodeHalfWidth) + step, MIN_NODE_HALF_WIDTH, MAX_NODE_HALF_WIDTH))
    this.nodeHalfWidth = next
    if (node) {
      node.halfWidth = next
    }
    if (building && node && node !== this.draft) {
      this.markDirty(building)
      this.mutate()
      return
    }
    this.notify()
  }

  /** Close the run into a loop: repeat the first node at the end, then finish. */
  closeRun(): boolean {
    const building = this.byId.get(this.buildingId)
    const nodes = building?.placement.nodes
    if (!building || !nodes || nodes.length < 3 || nodes.length >= MAX_RIVER_NODES) {
      return false
    }
    const first = nodes[0]!
    nodes.push({ x: first.x, y: first.y, z: first.z, halfWidth: first.halfWidth })
    this.markDirty(building)
    this.buildingId = ''
    this.draft = null
    this.activeNode = -1
    this.mutate()
    return true
  }

  /**
   * End the run. A one-node draft is **discarded**: it is not a river, it was
   * never a placement, and there is nothing to keep. Returns true if a run was
   * open.
   */
  finishRun(): boolean {
    const had = this.buildingId !== '' || this.draft !== null
    this.buildingId = ''
    this.draft = null
    this.activeNode = -1
    if (had) {
      this.notify()
    }
    return had
  }

  // ── delete / clear ────────────────────────────────────────────────────────

  /** Remove the body under the crosshair. Returns its kind, or null. */
  deleteAimed(): string | null {
    const body = this.byId.get(this.aimedId)
    if (!body) {
      return null
    }
    const kind = body.placement.kind
    this.deleteById(body.placement.id)
    return kind
  }

  /** Remove a body by id. Returns true if it existed. */
  deleteById(id: string): boolean {
    const body = this.byId.get(id)
    if (!body) {
      return false
    }
    if (id === this.buildingId) {
      this.buildingId = ''
      this.activeNode = -1
    }
    if (id === this.editingId) {
      this.editingId = ''
    }
    if (id === this.dragId) {
      this.dragId = ''
      this.dragArmed = false
    }
    this.detach(body)
    body.view?.dispose()
    this.refreshAimTargets()
    if (id === this.aimedId) {
      this.setAimed('')
    }
    this.mutate()
    return true
  }

  clearAll(): number {
    const removed = this.list.length + (this.draft ? 1 : 0)
    if (removed === 0) {
      return 0
    }
    for (const body of this.list) {
      if (body.view) {
        this.group.remove(body.view.object)
        body.view.dispose()
      }
    }
    this.list.length = 0
    this.byId.clear()
    this.aimTargets.length = 0
    this.dirtyCount = 0
    this.draft = null
    this.buildingId = ''
    this.editingId = ''
    this.dragId = ''
    this.activeNode = -1
    this.setAimed('')
    this.mutate()
    return removed
  }

  // ── list plumbing ─────────────────────────────────────────────────────────

  private attach(placement: WaterPlacement): WaterBody {
    const body: WaterBody = { placement, view: null, index: this.list.length, dirty: false }
    this.list.push(body)
    this.byId.set(placement.id, body)
    this.rebuildView(body)
    return body
  }

  private detach(body: WaterBody): void {
    if (body.view) {
      this.group.remove(body.view.object)
    }
    if (body.dirty) {
      body.dirty = false
      this.dirtyCount--
    }
    // Swap-pop: draw order between bodies of water is irrelevant, so there is no
    // reason to pay a splice for every deletion.
    const last = this.list.pop()!
    if (last !== body) {
      this.list[body.index] = last
      last.index = body.index
    }
    this.byId.delete(body.placement.id)
  }

  private markDirty(body: WaterBody): void {
    if (body.dirty) {
      return
    }
    body.dirty = true
    this.dirtyCount++
  }

  private rebuildView(body: WaterBody): void {
    if (body.view) {
      this.group.remove(body.view.object)
      body.view.dispose()
      body.view = null
    }
    const view = this.viewFactory(body.placement, this.ground)
    if (view) {
      view.object.name = `water:${body.placement.id}`
      tagMeshes(view.object, body.placement.id)
      this.group.add(view.object)
      // Parented, then updated by hand: the aim ray reads `matrixWorld`, and
      // three only refreshes it inside `render()` — without this the body is
      // un-aimable for the frame it appears in.
      view.object.updateMatrixWorld(true)
      body.view = view
    }
    this.refreshAimTargets()
  }

  /**
   * Rebuilt wholesale rather than spliced. A view may contribute any number of
   * meshes, so removing "its" entries would mean tracking them per body — for a
   * list that only changes when a body is added, removed or re-tessellated.
   */
  private refreshAimTargets(): void {
    this.aimTargets.length = 0
    for (const body of this.list) {
      if (body.view) {
        collectMeshes(body.view.object, this.aimTargets)
      }
    }
  }

  // ── proxy views ───────────────────────────────────────────────────────────

  /**
   * The stand-in drawable: a flat, unlit, translucent sheet in the style's own
   * mid colour. Deliberately not an attempt at water — it exists so the editor
   * is visible and aimable before the surface generator is wired in, and it is
   * dropped the moment `setViewFactory` receives the real one. One
   * `MeshBasicMaterial` per style, four at most, all the same program.
   */
  private buildProxyView(placement: Readonly<WaterPlacement>): WaterBodyView | null {
    const material = this.proxyMaterial(placement.styleId)
    if (placement.kind === 'pool') {
      const mesh = new Mesh(this.proxyQuad, material)
      mesh.position.set(placement.x, placement.y, placement.z)
      mesh.rotation.y = placement.rotY
      mesh.scale.set(placement.halfX, 1, placement.halfZ)
      mesh.castShadow = false
      mesh.receiveShadow = false
      // Geometry and material are shared and owned by the editor — nothing to
      // free per body.
      return { object: mesh, dispose: () => {} }
    }
    const geometry = riverRibbon(placement.nodes)
    if (!geometry) {
      return null
    }
    const mesh = new Mesh(geometry, material)
    mesh.castShadow = false
    mesh.receiveShadow = false
    return {
      object: mesh,
      dispose: () => {
        geometry.dispose()
      }
    }
  }

  private proxyMaterial(styleId: string): MeshBasicMaterial {
    const existing = this.proxyMaterials.get(styleId)
    if (existing) {
      return existing
    }
    const style = waterStyle(styleId)
    const material = new MeshBasicMaterial({
      color: style.mid,
      transparent: true,
      opacity: 0.55,
      // Without this the sheet writes depth and punches a hole through whatever
      // it overlaps, which reads as a bug rather than as a preview.
      depthWrite: false,
      side: DoubleSide,
      fog: false
    })
    this.proxyMaterials.set(styleId, material)
    return material
  }

  // ── drag ──────────────────────────────────────────────────────────────────

  /**
   * A pool placed with Alt+drag scales as the pointer moves, in **X and Z
   * independently**: the pointer's offset from the centre, taken in the pool's
   * own rotated frame, *is* the half-extent. Dragging out a 90 × 20 m sea is one
   * gesture rather than forty keypresses.
   *
   * Only the outline follows the drag. The surface is re-tessellated on release,
   * because a real generator's rebuild is not something to run sixty times a
   * second on a gesture that is still being aimed.
   */
  private updateDrag(): void {
    if (!this.dragId || !this.aimValid) {
      return
    }
    const body = this.byId.get(this.dragId)
    if (!body || body.placement.kind !== 'pool') {
      return
    }
    const placement = body.placement
    const dx = this.aimPoint.x - placement.x
    const dz = this.aimPoint.z - placement.z
    const cos = Math.cos(placement.rotY)
    const sin = Math.sin(placement.rotY)
    // World → the pool's local frame, i.e. the inverse of a Y rotation.
    const localX = Math.abs(dx * cos - dz * sin)
    const localZ = Math.abs(dx * sin + dz * cos)

    if (!this.dragArmed) {
      if (Math.max(localX, localZ) < DRAG_ARM_METRES) {
        return
      }
      this.dragArmed = true
    }
    const nextX = tidy(clamp(localX, MIN_HALF, MAX_HALF))
    const nextZ = tidy(clamp(localZ, MIN_HALF, MAX_HALF))
    if (nextX === placement.halfX && nextZ === placement.halfZ) {
      return
    }
    placement.halfX = nextX
    placement.halfZ = nextZ
    this.halfX = nextX
    this.halfZ = nextZ
    // Quantised to tenths of a metre, which is the readout's own resolution: a
    // drag emits a handful of snapshots a second instead of one per frame.
    if (Math.round(nextX * 10) !== this.lastEmitX || Math.round(nextZ * 10) !== this.lastEmitZ) {
      this.notify()
    }
  }

  private endDrag(): void {
    if (!this.dragId) {
      return
    }
    const body = this.byId.get(this.dragId)
    const armed = this.dragArmed
    this.dragId = ''
    this.dragArmed = false
    if (body && armed) {
      this.markDirty(body)
      this.mutate()
    }
  }

  // ── state ─────────────────────────────────────────────────────────────────

  /**
   * Monotonic mutation counter for the water list. Consumers that need the
   * layout every frame poll this integer and only pay for `snapshot()` when it
   * moves.
   *
   * It advances on placement changes **only** — place, append, undo, resize,
   * rotate, height, style, delete, clear, and the load from storage. It
   * deliberately does *not* advance on a mode change, on aiming, on finishing a
   * run, or per frame during a resize drag; the drag's final extent is
   * committed once, on release.
   */
  revision(): number {
    return this.rev
  }

  bodyCount(): number {
    return this.list.length
  }

  /**
   * Lay down a shipped layout — the water half of `worldPatch.generated.ts`.
   *
   * **Only when there is none.** Same rule as `seedLevel`, and for the same
   * reason: somebody who has spent an hour cutting a river must not find the
   * shipped lake injected on top of it, or their work replaced by a reload. The
   * caller decides *when*; this decides *whether*, because only this knows
   * whether the browser already has water in it.
   *
   * Every candidate goes through `normaliseWaterPlacement`, so a hand-edited
   * patch or one written by an older build yields fewer bodies rather than a
   * throw. Ids are re-based exactly as `load` does them, or a fresh body placed
   * afterwards would be handed one that is already taken.
   */
  seed(placements: readonly unknown[]): number {
    if (this.list.length > 0 || this.draft) {
      return 0
    }
    let seeded = 0
    for (const candidate of placements) {
      const placement = normaliseWaterPlacement(candidate)
      if (!placement) {
        continue
      }
      const numeric = Number.parseInt(placement.id.slice(1), 10)
      if (placement.id.startsWith('w') && Number.isFinite(numeric)) {
        this.seq = Math.max(this.seq, numeric)
      }
      this.attach(placement)
      seeded++
    }
    if (seeded > 0) {
      // Through `mutate`, not a bare `rev++`: seeding is an edit like any other
      // and has to persist, or the next reload seeds it again on top of nothing
      // and the "only when empty" guard never gets a chance to fire.
      this.mutate()
    }
    return seeded
  }

  aimedWaterId(): string {
    return this.aimedId
  }

  /** Nodes in the run being laid, the one-node draft included. */
  riverNodeCount(): number {
    const building = this.byId.get(this.buildingId)
    if (building) {
      return building.placement.nodes.length
    }
    return this.draft ? 1 : 0
  }

  /**
   * Plain deep copies of every placement, sorted for a stable diff. Copies
   * because this is what crosses into Vue and into a clipboard — handing out
   * the live descriptors would let the panel mutate the scene, and `nodes` in
   * particular is an array a shallow copy would still share.
   */
  snapshot(): WaterPlacement[] {
    const all: WaterPlacement[] = []
    for (const body of this.list) {
      all.push(copyPlacement(body.placement))
    }
    all.sort(
      (a, b) => a.kind.localeCompare(b.kind) || a.styleId.localeCompare(b.styleId) || a.x - b.x || a.z - b.z
    )
    return all
  }

  state(): WaterEditorSnapshot {
    const editing = this.byId.get(this.editingId)
    const pool = editing && editing.placement.kind === 'pool' ? editing.placement : null
    const building = this.byId.get(this.buildingId)
    const node = building?.placement.nodes[this.activeNode] ?? this.draft
    const absolute = this.mode === 'river' ? (node ? node.y : null) : (pool ? pool.y : null)
    return {
      mode: this.mode,
      styleId: this.styleId,
      bodyCount: this.list.length,
      halfX: pool?.halfX ?? this.halfX,
      halfZ: pool?.halfZ ?? this.halfZ,
      surfaceY: absolute ?? this.lift,
      surfaceRelative: absolute === null,
      rotationDeg: Math.round(((pool?.rotY ?? this.rotY) / DEGREES) % 360),
      riverNodes: this.riverNodeCount(),
      activeNode: this.activeNode,
      nodeHalfWidth: node?.halfWidth ?? this.nodeHalfWidth,
      building: this.buildingId !== '' || this.draft !== null
    }
  }

  /** Notify without advancing the revision. Mode changes and drag previews only. */
  private notify(): void {
    const snapshot = this.state()
    this.lastEmitX = Math.round(snapshot.halfX * 10)
    this.lastEmitZ = Math.round(snapshot.halfZ * 10)
    this.onStateChange?.(snapshot)
  }

  /**
   * The mutation seam. The revision bumps here rather than at each call site,
   * because every mutation already has to persist and tell the panel — so this
   * is the one place that cannot be forgotten when a new edit is added.
   */
  private mutate(): void {
    this.rev++
    this.save()
    this.notify()
  }

  // ── persistence ───────────────────────────────────────────────────────────

  private load(): void {
    let raw: string | null = null
    try {
      raw = typeof localStorage !== 'undefined' ? localStorage.getItem(WATER_PLACEMENTS_KEY) : null
    } catch {
      return
    }
    if (!raw) {
      return
    }
    let parsed: unknown = null
    try {
      parsed = JSON.parse(raw)
    } catch {
      console.warn('[water] saved layout is not valid JSON — starting empty')
      return
    }
    if (!Array.isArray(parsed)) {
      return
    }
    let loaded = 0
    for (const candidate of parsed) {
      const placement = normaliseWaterPlacement(candidate)
      if (!placement) {
        continue
      }
      // Ids are minted `w<n>`; resume past the highest so a reload cannot hand a
      // fresh body an id that is already taken.
      const numeric = Number.parseInt(placement.id.slice(1), 10)
      if (placement.id.startsWith('w') && Number.isFinite(numeric)) {
        this.seq = Math.max(this.seq, numeric)
      }
      this.attach(placement)
      loaded++
    }
    if (loaded > 0) {
      this.rev++
      this.notify()
    }
  }

  private save(): void {
    try {
      localStorage.setItem(WATER_PLACEMENTS_KEY, JSON.stringify(this.snapshot()))
    } catch {
      console.warn('[water] could not persist the layout (storage full or disabled)')
    }
  }

  private loadTuning(): void {
    let raw: string | null = null
    try {
      raw = typeof localStorage !== 'undefined' ? localStorage.getItem(WATER_STYLE_KEY) : null
    } catch {
      return
    }
    if (!raw) {
      return
    }
    let parsed: unknown = null
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return
    }
    for (const [styleId, values] of Object.entries(parsed as Record<string, unknown>)) {
      const style = WATER_STYLES[styleId]
      if (!style || typeof values !== 'object' || values === null) {
        continue
      }
      const overrides: Partial<Record<WaterStyleNumberKey, number>> = {}
      for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
        if (!STYLE_NUMBER_KEYS.includes(key as WaterStyleNumberKey)) {
          continue
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          continue
        }
        style[key as WaterStyleNumberKey] = value
        overrides[key as WaterStyleNumberKey] = value
      }
      if (Object.keys(overrides).length > 0) {
        this.tuning.set(styleId, overrides)
      }
    }
  }

  private saveTuning(): void {
    try {
      localStorage.setItem(WATER_STYLE_KEY, JSON.stringify(this.styleOverrides()))
    } catch {
      // Private mode / storage disabled. The tuning still applies this session.
    }
  }

  // ── input ─────────────────────────────────────────────────────────────────

  /**
   * Only pointer events that land on the canvas are the editor's. The panel is
   * a sibling DOM node and its `@pointerdown.stop` cannot help here: this
   * listener is in the *capture* phase, which has already run by the time a
   * bubble-phase handler could stop anything.
   */
  private isCanvasEvent(event: Event): boolean {
    return event.target === this.canvas
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (this.mode === 'off') {
      return
    }
    // `getBoundingClientRect` per move rather than a cached rect: the canvas is
    // laid out by CSS inside whatever shell the game uses, so a cache would need
    // invalidating on resize, scroll and safe-area change. This is a dev tool.
    const rect = this.canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return
    }
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  }

  /**
   * `pointerdown`, not `mousedown`, and in the capture phase: the orbit camera
   * starts its drag on `pointerdown` on the canvas and `pointerdown` fires
   * first — without swallowing it here the camera would spin under every edit.
   */
  private onPointerDown = (event: PointerEvent): void => {
    if (this.mode === 'off' || event.button !== 0 || !event.isPrimary || !this.isCanvasEvent(event)) {
      return
    }
    if (!event.altKey || event.ctrlKey || event.metaKey) {
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    // The aim is otherwise resolved once per frame, and a click can land before
    // the first frame in this mode — resolve now so it uses the pointer's
    // position rather than the last frame's.
    this.resolveAim()

    if (event.shiftKey) {
      this.deleteAimed()
      return
    }
    if (this.mode === 'river') {
      this.appendNode()
      return
    }
    const id = this.placePool()
    if (id) {
      this.dragId = id
      this.dragArmed = false
    }
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.dragId || !event.isPrimary) {
      return
    }
    this.endDrag()
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    // Alt is the water editor's namespace. The prop editor ignores every
    // Alt-modified key, so both tools can be live at once.
    if (!event.altKey || event.ctrlKey || event.metaKey) {
      return
    }
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return
    }
    const shift = event.shiftKey
    // `code`, not `key`: the bindings are positional, so they survive a
    // non-QWERTY layout — and Alt+key reports an entirely different `key` on
    // macOS.
    switch (event.code) {
      case 'KeyP':
        event.preventDefault()
        this.setMode(this.mode === 'pool' ? 'off' : 'pool')
        return
      case 'KeyR':
        event.preventDefault()
        this.setMode(this.mode === 'river' ? 'off' : 'river')
        return
      case 'KeyO':
        event.preventDefault()
        this.setMode('off')
        return
      default:
        break
    }
    if (this.mode === 'off') {
      return
    }
    switch (event.code) {
      case 'KeyG':
        if (event.repeat) {
          return
        }
        event.preventDefault()
        if (this.mode === 'river') {
          this.appendNode()
        } else {
          this.placePool()
        }
        return
      case 'KeyX':
        if (event.repeat) {
          return
        }
        event.preventDefault()
        this.deleteAimed()
        return
      case 'Backspace':
        if (event.repeat) {
          return
        }
        event.preventDefault()
        this.undoNode()
        return
      case 'Enter':
      case 'NumpadEnter':
        if (event.repeat) {
          return
        }
        event.preventDefault()
        if (shift) {
          this.closeRun()
        } else {
          this.finishRun()
        }
        return
      // The extent and height keys repeat on purpose — holding one grows the
      // pool, which is how a sea gets dialled without forty separate presses.
      case 'KeyJ':
        event.preventDefault()
        this.resizeBy('x', -1, shift)
        return
      case 'KeyL':
        event.preventDefault()
        this.resizeBy('x', 1, shift)
        return
      case 'KeyI':
        event.preventDefault()
        this.resizeBy('z', 1, shift)
        return
      case 'KeyK':
        event.preventDefault()
        this.resizeBy('z', -1, shift)
        return
      case 'BracketLeft':
        event.preventDefault()
        this.rotateBy(shift ? -ROT_STEP_COARSE : -ROT_STEP)
        return
      case 'BracketRight':
        event.preventDefault()
        this.rotateBy(shift ? ROT_STEP_COARSE : ROT_STEP)
        return
      case 'Minus':
        event.preventDefault()
        this.heightBy(-1, shift)
        return
      case 'Equal':
        event.preventDefault()
        this.heightBy(1, shift)
        return
      case 'KeyY':
        if (event.repeat) {
          return
        }
        event.preventDefault()
        this.cycleStyle(shift ? -1 : 1)
        return
      case 'Comma':
        if (event.repeat) {
          return
        }
        event.preventDefault()
        this.stepActiveNode(-1)
        return
      case 'Period':
        if (event.repeat) {
          return
        }
        event.preventDefault()
        this.stepActiveNode(1)
    }
  }

  // ── teardown ──────────────────────────────────────────────────────────────

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    window.removeEventListener('pointerdown', this.onPointerDown, { capture: true })
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp, { capture: true } as EventListenerOptions)
    window.removeEventListener('keydown', this.onKeyDown)

    for (const body of this.list) {
      body.view?.dispose()
    }
    this.list.length = 0
    this.byId.clear()
    this.aimTargets.length = 0

    this.poolGhost.geometry.dispose()
    this.riverGhost.geometry.dispose()
    this.riverTicks.geometry.dispose()
    this.ghostMaterial.dispose()
    this.proxyQuad.dispose()
    for (const material of this.proxyMaterials.values()) {
      material.dispose()
    }
    this.proxyMaterials.clear()

    this.group.clear()
    this.host.scene.remove(this.group)
    this.onStateChange = null
    this.onAimChange = null
  }
}

const copyPlacement = (placement: WaterPlacement): WaterPlacement => ({
  ...placement,
  nodes: placement.nodes.map(node => ({ ...node }))
})

const tagMeshes = (root: Object3D, id: string): void => {
  root.traverse(child => {
    child.userData.waterId = id
  })
}

const collectMeshes = (root: Object3D, out: Object3D[]): void => {
  root.traverse(child => {
    if ((child as Mesh).isMesh) {
      out.push(child)
    }
  })
}

/**
 * Flat ribbon through the spline, two vertices per node at that node's own
 * half-width. The proxy only — the real generator bakes `aDepth`, `aShore` and
 * `aFlow`, which this deliberately does not pretend to.
 */
const riverRibbon = (nodes: readonly RiverNode[]): BufferGeometry | null => {
  if (nodes.length < 2) {
    return null
  }
  const count = nodes.length
  const positions = new Float32Array(count * 2 * 3)
  const normals = new Float32Array(count * 2 * 3)
  const indices: number[] = []

  for (let i = 0; i < count; i++) {
    const node = nodes[i]!
    const prev = nodes[i > 0 ? i - 1 : i]!
    const next = nodes[i + 1 < count ? i + 1 : i]!
    let tx = next.x - prev.x
    let tz = next.z - prev.z
    const length = Math.hypot(tx, tz)
    if (length < 1e-5) {
      tx = 0
      tz = 1
    } else {
      tx /= length
      tz /= length
    }
    const ox = tz * node.halfWidth
    const oz = -tx * node.halfWidth
    const at = i * 6
    positions[at] = node.x + ox
    positions[at + 1] = node.y
    positions[at + 2] = node.z + oz
    positions[at + 3] = node.x - ox
    positions[at + 4] = node.y
    positions[at + 5] = node.z - oz
    normals[at + 1] = 1
    normals[at + 4] = 1
    if (i + 1 < count) {
      const a = i * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * Accepts a parsed entry only if every field a `WaterPlacement` needs is a
 * finite number / non-empty string, **and** only if the shape is one a
 * generator can actually tessellate: a pool needs a positive extent, a river
 * needs two nodes. A half-written save is worse than none.
 */
export const normaliseWaterPlacement = (candidate: unknown): WaterPlacement | null => {
  if (typeof candidate !== 'object' || candidate === null) {
    return null
  }
  const entry = candidate as Record<string, unknown>
  const id = typeof entry.id === 'string' ? entry.id : ''
  const kind = entry.kind === 'river' ? 'river' : entry.kind === 'pool' ? 'pool' : null
  if (!id || !kind) {
    return null
  }
  const number = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback

  const nodes: RiverNode[] = []
  if (Array.isArray(entry.nodes)) {
    for (const raw of entry.nodes) {
      if (typeof raw !== 'object' || raw === null) {
        return null
      }
      const node = raw as Record<string, unknown>
      if (
        typeof node.x !== 'number' ||
        typeof node.y !== 'number' ||
        typeof node.z !== 'number' ||
        !Number.isFinite(node.x) ||
        !Number.isFinite(node.y) ||
        !Number.isFinite(node.z)
      ) {
        // One bad node would bend the spline through the origin. Drop the whole
        // river rather than silently rerouting it.
        return null
      }
      nodes.push({
        x: node.x,
        y: node.y,
        z: node.z,
        halfWidth: clamp(number(node.halfWidth, DEFAULT_NODE_HALF_WIDTH), MIN_NODE_HALF_WIDTH, MAX_NODE_HALF_WIDTH)
      })
    }
  }
  if (kind === 'river' && nodes.length < 2) {
    return null
  }

  return {
    id,
    kind,
    styleId: typeof entry.styleId === 'string' ? waterStyle(entry.styleId).id : DEFAULT_WATER_STYLE,
    x: number(entry.x, 0),
    y: number(entry.y, 0),
    z: number(entry.z, 0),
    rotY: number(entry.rotY, 0),
    halfX: kind === 'pool' ? clamp(number(entry.halfX, DEFAULT_HALF_X), MIN_HALF, MAX_HALF) : 0,
    halfZ: kind === 'pool' ? clamp(number(entry.halfZ, DEFAULT_HALF_Z), MIN_HALF, MAX_HALF) : 0,
    nodes: kind === 'river' ? nodes : []
  }
}
