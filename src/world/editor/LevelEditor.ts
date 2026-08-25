import { Color, Group, Mesh, MeshBasicMaterial, Raycaster, Vector2, Vector3, type Intersection, type Object3D } from 'three'
import { C, OUTLINE_COOL, OUTLINE_COOL_MIX } from '../art/palette'
import type { PickRay, ScatterPick, World } from '../core/World'
import { triangleCount } from '../geometry/budget'
import { getPlaceable } from '../level/catalog'
import type { Placement } from '../level/types'
import { DitheredLod } from '../lod/DitheredLod'
import type { OutlineMaterial } from '../shading/outlineMaterial'

/**
 * ─── In-game level editor (scene side) ──────────────────────────────────────
 *
 * A port of dreamion's `systems/levelEditor.ts`, kept control-for-control
 * identical because that is what the tool is valued for. What changed is only
 * what had to: this world has an orbit camera instead of a first-person one,
 * `DitheredLod` instead of `prop.build()`, and an analytic heightfield instead
 * of a walk-surface list.
 *
 * **Nothing in this file is reactive.** The panel drives it through the façade
 * in `index.ts`, which mirrors a handful of primitives into `ref`s; the class
 * itself holds plain fields so no per-frame path ever touches a Vue proxy
 * (GDD §0). `update()` allocates nothing in its steady state — see the note on
 * `resolveAim` for the one qualified exception.
 *
 * Controls:
 *
 *   Ctrl+Click / G   place the selected palette entry
 *   Shift+Click      remove whatever is aimed at
 *   aim + F          pick up · aim + X   delete
 *   focused + C      duplicate and carry the copy
 *   focused + −/+    scale one step (12 % each, 0.15×–6×)
 *   focused + Q/E    rotate 90°, on the placed prop — no pick-up needed
 *   holding: G drop · X delete · wheel rotate 1°
 *   height:  Ctrl+wheel ±2 cm · Ctrl+Shift+wheel ±10 cm snapped to grid
 *
 * F and X reach **scattered** props too — a tree or stone the generator made.
 * X tombstones it; F tombstones it and hands back the catalogue's equivalent as
 * an ordinary placement. See `level/scatterOverrides.ts`.
 *
 * ── Every one of those is also a button ─────────────────────────────────────
 *
 * The verbs above were reachable *only* as key bindings, which is fine once you
 * know them and useless before: nothing on screen said a placed prop could be
 * rotated, so the feature was invisible to anyone who had not read this comment.
 * The focused prop now carries a billboard listing what can be done to it, with
 * the shortcut printed on each button — see `updateFocus` for the scene side and
 * `components/organisms/EditorFocusCard.vue` for the card.
 *
 * `duplicateFocused` and `scaleFocused` are new here rather than ported: the
 * first because laying a row of anything was otherwise place-select-place, and
 * the second because `Placement.scale` was persisted, exported *and* honoured by
 * the collider builder while being reachable from nowhere in the tool.
 */

const PLACEMENTS_KEY = 'world_editor_placements'

/** How far the aim ray searches before giving up (metres). */
const AIM_MAX_DISTANCE = 400
/**
 * Terrain march bounds. The march sphere-traces on the current clearance, so
 * the minimum keeps it accurate at grazing angles and the maximum keeps it
 * from tunnelling through a ridge on a long shallow ray.
 */
const AIM_MIN_STEP = 0.35
const AIM_MAX_STEP = 6
const AIM_REFINE_STEPS = 14

/**
 * How far the crosshair reaches for a scattered prop, in metres.
 *
 * Far shorter than `AIM_MAX_DISTANCE`, because deleting something is a
 * deliberate act and a 400 m reach turns a glance at the horizon into a pick.
 * At 90 m a tree is still a recognisable silhouette you could mean to point at.
 */
const SCATTER_PICK_RANGE = 90

/** Where the focus card hangs over a scattered prop, in metres above its base. */
const SCATTER_ANCHOR_HEIGHT = 2.2

/** Reused aim ray — a scatter pick runs every frame and must not allocate. */
const _ray: PickRay = {
  originX: 0,
  originY: 0,
  originZ: 0,
  dirX: 0,
  dirY: 0,
  dirZ: 1,
  maxDistance: SCATTER_PICK_RANGE,
  pointX: 0,
  pointZ: 0
}

const DEGREES = Math.PI / 180
const TAU = Math.PI * 2

/** Ctrl + wheel — fine seating, small enough to dial a prop flush by eye. */
const LIFT_FINE = 0.02
/** Ctrl + Shift + wheel — the snap grid the user asked for. */
const LIFT_GRID = 0.1
const LIFT_MIN = -8
const LIFT_MAX = 80

/**
 * Ghost tint. Derived from the palette rather than written as a hex literal —
 * `CLAUDE.md` R2 admits no exceptions, and a gizmo colour that drifts out of
 * the world's gamut is exactly as wrong as a prop colour that does.
 */
const GHOST_COLOR = new Color().copy(C.foliageLit).lerp(C.rim, 0.5)

/**
 * ─── Focus highlight ────────────────────────────────────────────────────────
 *
 * The focused prop's own inverted-hull outline is widened and recoloured, rather
 * than a selection box or a tint being added. Three reasons, in order:
 *
 * * **It costs nothing.** The hull is already being drawn on LOD0/LOD1; this
 *   changes three uniforms on it. A box gizmo would be a new mesh, a new
 *   material and a new draw call per focused prop.
 * * **It traces the actual silhouette**, which is what you are trying to line up
 *   against a slope. A bounding box tells you where the prop's extents are, not
 *   where its edge is.
 * * **It cannot desync.** The outline follows the prop's LOD, rotation and scale
 *   because it *is* the prop's outline.
 *
 * Derived from the palette rather than written as literals — `CLAUDE.md` R2
 * admits no exceptions, and the ghost above already sets the precedent. Cyan for
 * an aimed prop and warm gold for a carried one, so "what I am pointing at" and
 * "what is in my hand" never read as the same state.
 */
const FOCUS_COLOR = new Color().copy(C.waterShallow).lerp(C.rim, 0.25)
const HELD_COLOR = new Color().copy(C.grassDry).lerp(C.rim, 0.3)
/** Screen pixels. GDD R6 ships 1.6; a selection has to be unmistakable. */
const FOCUS_OUTLINE_PX = 4.5
const DEFAULT_OUTLINE_PX = 1.6

/** Multiplicative scale step, and the range a placement may be driven to. */
const SCALE_STEP = 1.12
const SCALE_MIN = 0.15
const SCALE_MAX = 6

/** Metres between the top of the focused prop and its billboard's anchor. */
const FOCUS_ANCHOR_GAP = 0.35

// Module scratch for the focus projection. This runs every frame while the
// editor is open, and GDD §5.2 bans per-frame allocation there as everywhere.
const _anchor = new Vector3()
const _view = new Vector3()

interface PlacedProp {
  placement: Placement
  node: DitheredLod
  /** Own slot in `list`, so removal is a swap-pop rather than a splice. */
  index: number
}

/**
 * One entry of a starting arrangement: a `Placement` minus the id, which the
 * editor mints. `rotY` and `scale` are optional purely for authoring comfort —
 * a full `Omit<Placement, 'id'>` satisfies this type unchanged.
 */
export type LevelSeed = Omit<Placement, 'id' | 'rotY' | 'scale'> &
  Partial<Pick<Placement, 'rotY' | 'scale'>>

/**
 * Is a level already stored in this browser? Deliberately answerable without a
 * `LevelEditor`, so the seeding decision can be taken before one is installed.
 */
export const hasStoredPlacements = (): boolean => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PLACEMENTS_KEY) : null
    if (!raw) {
      return false
    }
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length > 0
  } catch {
    return false
  }
}

/**
 * A tool that borrows the editor's crosshair.
 *
 * See `LevelEditor.setBrush` for why this exists rather than a second editor.
 * Every method is handed the aim point in world space, already lifted by the
 * user's Ctrl+wheel offset, so a brush never touches the raycaster.
 */
export interface PlacementBrush {
  /** Ctrl+Click. Returns a label for the status line, or null if it declined. */
  place(x: number, y: number, z: number, rotationY: number): string | null
  /** Shift+Click / `X`. Returns true if it removed something of its own. */
  removeAt(x: number, y: number, z: number, valid: boolean): boolean
  /** Every frame. `valid` is false when the crosshair is on nothing. */
  preview(x: number, y: number, z: number, valid: boolean, rotationY: number): void
  /** Called when the brush is put away, so it can hide its preview. */
  onDeselect?(): void
}

export interface EditorSnapshot {
  placementCount: number
  holding: boolean
  rotationDeg: number
  /** Vertical offset above the aimed surface, in metres. */
  liftMetres: number
}

/**
 * Identity of the prop the crosshair is on (or the one in hand).
 *
 * Everything here is a primitive and it changes only when the *focus* changes or
 * the focused prop is edited — never per frame. That is what lets the panel hold
 * it in a `ref`: the billboard's **position** is a separate, non-reactive channel
 * (`editorFocusScreen`) precisely so a 60 Hz screen-space update never touches a
 * Vue proxy (GDD §0).
 */
export interface EditorFocus {
  /** Placement id, or `''` when nothing is focused. */
  id: string
  label: string
  defId: string
  /** LOD0 triangles, so the billboard can show what this prop costs. */
  tris: number
  /** True when this is the prop being carried rather than merely aimed at. */
  held: boolean
  scale: number
  rotationDeg: number
  /** Metres above the terrain beneath it. */
  liftMetres: number
  /**
   * True for a *scattered* prop — a tree or stone the generator produced,
   * identified by tombstone key rather than by placement id.
   *
   * The panel needs this because only some verbs apply: a scattered instance
   * can be deleted or moved, but not rotated, scaled or lifted in place, since
   * there is nothing to write those to short of turning it into a placement.
   */
  scatter: boolean
  /**
   * False when the prop can be deleted but not moved — a scattered species with
   * no catalogue equivalent to become. Always true for placements.
   */
  movable: boolean
}

export const EMPTY_FOCUS: EditorFocus = {
  id: '',
  label: '',
  defId: '',
  tris: 0,
  held: false,
  scale: 1,
  rotationDeg: 0,
  liftMetres: 0,
  scatter: false,
  movable: true
}

/**
 * Where the focus billboard should sit, in **normalised device coordinates**.
 *
 * A plain module object, mutated in place every frame and never a `ref`. The
 * panel reads it from its own `requestAnimationFrame` and writes the DOM
 * transform directly, so a HUD that tracks a moving object at 60 Hz costs Vue
 * nothing at all. Handing this through reactivity would put a patch pass on the
 * frame loop — the exact thing GDD §0 keeps three.js and Vue apart to avoid.
 *
 * NDC rather than pixels so the scene side never has to know the canvas's CSS
 * box: the panel is laid out inside the same host element, so `(x*0.5+0.5)` is a
 * percentage it can use directly, and a resize needs no invalidation anywhere.
 */
export const editorFocusScreen = {
  x: 0,
  y: 0,
  /** False when the anchor is behind the camera or off-screen — do not draw. */
  onScreen: false,
  /** Metres from the camera, for the billboard's own distance readout. */
  distance: 0
}

export class LevelEditor {
  /** Root for everything the editor owns. Registered with the profiler. */
  readonly group = new Group()

  /** Fired on mutation only — never per frame. The façade mirrors it into refs. */
  onStateChange: ((snapshot: EditorSnapshot) => void) | null = null

  /**
   * Fired when the focused prop's *identity or transform* changes — never per
   * frame, and never merely because it moved on screen. `editorFocusScreen`
   * carries the position instead.
   */
  onFocusChange: ((focus: EditorFocus) => void) | null = null

  private readonly world: World
  private readonly canvas: HTMLCanvasElement

  private readonly list: PlacedProp[] = []
  private readonly byId = new Map<string, PlacedProp>()
  /**
   * Saved placements whose `defId` is not (yet) in the catalogue. They cannot
   * be spawned, but they must survive a save — silently dropping a prop
   * because an asset module was renamed or hasn't registered yet would eat
   * somebody's level layout with no way back.
   */
  private orphans: Placement[] = []

  private readonly raycaster = new Raycaster()
  /** LOD0 mesh of each placement, the only thing the aim ray tests against. */
  private readonly aimTargets: Object3D[] = []
  private readonly hits: Intersection[] = []
  /** Pointer in NDC. (0,0) — screen centre — until the mouse first moves, so
   *  the tool behaves like dreamion's crosshair before you touch anything. */
  private readonly pointer = new Vector2()

  private readonly aimPoint = new Vector3()
  private aimValid = false
  private aimedId: string | null = null
  /**
   * The scattered prop under the crosshair, when no placement is.
   *
   * A *copy*, not the world's shared pick object — this is read on the next
   * frame and on a key press, both of which happen after `pickScatter` has been
   * called again. Placements always win: a prop you put down on top of a tree is
   * the thing you are working on.
   */
  private readonly aimedScatter: ScatterPick = { key: '', species: '', editorDefId: undefined, x: 0, z: 0, y: 0 }
  private hasAimedScatter = false

  /** The tool that currently owns the crosshair, or null for the prop palette. */
  private brush: PlacementBrush | null = null

  private ghost: Mesh | null = null
  private ghostFor = ''
  private ghostOffset = 0
  private readonly ghostMaterial = new MeshBasicMaterial({
    color: GHOST_COLOR,
    transparent: true,
    opacity: 0.42,
    // Without this the ghost writes depth and punches a hole through whatever
    // it overlaps, which reads as the prop already being placed.
    depthWrite: false,
    fog: false
  })

  /**
   * The prop whose outline is currently widened, and the key that describes how.
   *
   * The key folds in the held flag, because the same prop changes colour when it
   * is picked up — comparing entries alone would leave a carried prop wearing the
   * "aimed" cyan.
   */
  private highlighted: PlacedProp | null = null
  private highlightKey = ''
  /** Last focus payload sent to the panel, as a signature, to suppress repeats. */
  private focusSignature = ''
  /**
   * Object-space top of each definition's tallest tier, cached by `defId`.
   *
   * The billboard hangs above the prop rather than at its origin, and a prop's
   * origin is at its *foot* — anchoring there would bury the card in the grass
   * for anything taller than a stone. Measured across every tier for the reason
   * `assets/common.ts` gives for `measuredRadius`: tiers are size-corrected
   * against each other, so the tallest is not reliably LOD0.
   */
  private readonly topCache = new Map<string, number>()

  private held: PlacedProp | null = null
  /** The held prop's ground correction, cached so the preview costs no lookup. */
  private heldOffset = 0
  private selectedId = ''
  private rotationY = 0
  /**
   * Vertical offset above the aimed surface, in metres.
   *
   * Sticky **across placements** — the common job is a run of props at one
   * height, and re-dialling for each would be miserable — but reset when the
   * selected prop *changes*, since a new prop type is a new intent. The panel
   * shows it and offers a reset, so it can never strand you somewhere invisible.
   */
  private lift = 0
  private active = false
  private seq = 0
  private disposed = false
  /**
   * Monotonic mutation counter. Consumers that need the placement list every
   * frame (the player's collider set) poll this integer and only pay for
   * `snapshot()` when it moves — see `levelRevision()` on the façade.
   */
  private rev = 0
  /** Orphans are retried once, on the first frame — see `retryOrphans`. */
  private hydrated = false

  /**
   * False while `PlacementBatcher` is drawing these props instead.
   *
   * The editor's one-node-per-placement layout is what makes props pickable, and
   * costs a draw call each. When the editor is closed nothing needs picking, so
   * the nodes are hidden and an instanced batch draws them at a fraction of the
   * cost. Their LOD updates are skipped too — invisible nodes still walking
   * their tier logic every frame is exactly the kind of cost that hides.
   */
  private placementsRendered = true

  constructor(world: World) {
    this.world = world
    this.canvas = world.renderer.domElement
    this.group.name = 'level-editor'
    world.scene.add(this.group)
    world.profiler.registerRoot(this.group, 'editor')

    this.load()

    window.addEventListener('pointerdown', this.onPointerDown, { capture: true })
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('wheel', this.onWheel, { capture: true, passive: false })
    window.addEventListener('keydown', this.onKeyDown)
  }

  // ── mode ──────────────────────────────────────────────────────────────────

  setActive(on: boolean): void {
    if (this.active === on) {
      return
    }
    this.active = on
    if (!on) {
      // Leaving the editor with a prop in hand would strand it: it is not in
      // `list`, so it would not be saved and would vanish on reload. Put it
      // back where it is being previewed instead.
      if (this.held) {
        this.dropHeld()
      }
      this.removeGhost()
      this.aimValid = false
      this.aimedId = null
      // Leaving the editor must also take the highlight off whatever was
      // focused, or a prop keeps a 4.5 px cyan outline for the rest of the
      // session — and it would be persisted nowhere, so nothing would ever
      // clear it.
      this.applyHighlight(null)
      editorFocusScreen.onScreen = false
      this.emitFocus(null)
    }
  }

  isActive(): boolean {
    return this.active
  }

  // ── palette selection / rotation ─────────────────────────────────────────

  setSelected(id: string): void {
    const changed = this.selectedId !== id
    this.selectedId = id
    if (this.ghostFor !== id) {
      this.removeGhost()
    }
    if (changed) {
      // Lift is sticky *within* one prop type — you place a run of platforms at
      // one height — but a different prop is a different intent, and inheriting
      // 3 m of elevation from the last one silently drops the new prop in
      // mid-air. Reset on change only, so re-clicking the same row is a no-op.
      this.lift = 0
      this.emitState()
    }
  }

  /** Rotate the preview (and the held prop) by degrees. Wheel 1°, Q/E 90°. */
  rotateBy(degrees: number): void {
    this.rotationY = (this.rotationY + degrees * DEGREES) % TAU
    this.emitState()
  }

  /**
   * Hands rendering of the placements over to `PlacementBatcher`, or takes it
   * back. The nodes stay in the scene graph either way — they are the editor's
   * working state and rebuilding them on every toggle would be pure waste — they
   * just stop drawing and stop updating.
   */
  setPlacementsRendered(on: boolean): void {
    if (this.placementsRendered === on) {
      return
    }
    this.placementsRendered = on
    for (const entry of this.list) {
      entry.node.visible = on
    }
  }

  rotationDegrees(): number {
    return Math.round((this.rotationY / DEGREES) % 360)
  }

  /**
   * Raise or lower the placement above the aimed surface.
   *
   * Without this the editor can only build on the ground, which rules out every
   * arrangement the platform assets exist for — floating islands, stepped
   * routes, anything with a gap under it.
   *
   * `Ctrl` + wheel nudges by `LIFT_FINE` (2 cm) for seating a prop precisely;
   * `Ctrl`+`Shift` + wheel moves a whole `LIFT_GRID` (10 cm) and **snaps to that
   * grid first**, so a run of platforms placed at "three notches up" all land at
   * exactly the same height instead of accumulating drift.
   */
  liftBy(direction: number, snapToGrid: boolean): void {
    const next = snapToGrid
      ? Math.round(this.lift / LIFT_GRID) * LIFT_GRID + direction * LIFT_GRID
      : this.lift + direction * LIFT_FINE
    // Clamped so a runaway wheel can't park the ghost in orbit.
    this.lift = Math.min(LIFT_MAX, Math.max(LIFT_MIN, next))
    // Kill float dust from repeated addition, or the readout shows 0.30000000004.
    this.lift = Math.round(this.lift * 1e4) / 1e4
    this.emitState()
  }

  resetLift(): void {
    if (this.lift === 0) {
      return
    }
    this.lift = 0
    this.emitState()
  }

  /** Metres above the aimed surface. */
  liftMetres(): number {
    return this.lift
  }

  /**
   * How far a placement already floats above the terrain beneath it.
   *
   * Measured against the terrain rather than against whatever it was originally
   * placed on: the prop it was stacked on may since have been moved or deleted,
   * and the terrain is the one surface guaranteed to still be there.
   */
  private liftOf(placement: Placement): number {
    const ground = this.world.terrain.heightAt(placement.x, placement.z)
    const offset = getPlaceable(placement.defId)?.groundOffset ?? 0
    const value = placement.y - ground - offset
    return Math.min(LIFT_MAX, Math.max(LIFT_MIN, Math.round(value * 1e4) / 1e4))
  }

  // ── per-frame ─────────────────────────────────────────────────────────────

  /**
   * Call once per frame. Allocation-free in the steady state: the placement
   * LOD updates and the terrain march use module scratch only.
   *
   * The one exception is `Raycaster` against the placed props, which allocates
   * an `Intersection` (and a `Vector3`) per hit triangle. That path runs *only
   * while editor mode is on*, i.e. never in a shipped session, and there is no
   * way to make three's raycaster reuse those objects. Everything the player
   * sees — the LOD tick for props already placed — stays clean.
   */
  update(cameraPosition?: Vector3): void {
    if (this.disposed) {
      return
    }
    const camera = cameraPosition ?? this.world.camera.position

    if (!this.hydrated) {
      // One-shot, so install order does not matter: by the first frame every
      // asset module has registered, even if it had not when we were built.
      this.hydrated = true
      this.retryOrphans()
    }

    if (this.placementsRendered) {
      for (let i = 0; i < this.list.length; i++) {
        this.list[i]!.node.update(camera)
      }
    }

    if (!this.active) {
      return
    }

    this.held?.node.update(camera)
    this.resolveAim()
    this.updatePreview()
    // Last, and unconditionally: the billboard has to track a prop whether it is
    // aimed at, carried, or neither (in which case this hides it). Folding it
    // into the branches above is how it would end up stuck on screen after a
    // drop — every early return would need to remember to clear it.
    this.updateFocus()
  }

  /** The ghost, or the carried prop that stands in for it. */
  private updatePreview(): void {
    if (this.brush) {
      // The brush draws its own preview, if it has one. The prop ghost must not
      // also be up: two previews under one crosshair is two answers to what a
      // click will do.
      this.removeGhost()
      this.brush.preview(this.aimPoint.x, this.aimPoint.y + this.lift, this.aimPoint.z, this.aimValid, this.rotationY)
      return
    }
    if (this.held) {
      // A prop in hand replaces the ghost — it *is* the preview, so showing a
      // second translucent copy of it would only be confusing.
      this.removeGhost()
      if (this.aimValid) {
        this.held.node.position.set(this.aimPoint.x, this.aimPoint.y + this.heldOffset + this.lift, this.aimPoint.z)
        this.held.node.rotation.y = this.rotationY
        this.held.node.updateMatrixWorld(true)
      }
      return
    }

    if (!this.selectedId || !this.aimValid) {
      this.removeGhost()
      return
    }
    if (this.ghostFor !== this.selectedId) {
      this.buildGhost(this.selectedId)
    }
    if (this.ghost) {
      // `ghostOffset` is the definition's own ground correction, so the ghost
      // stands exactly where the real prop will. The extra 2 cm is pure
      // z-fight insurance for a flat-bottomed prop sitting on flat ground —
      // and it is dropped once lifted, where there is nothing to z-fight with
      // and it would make the preview 2 cm taller than the placement.
      const zFight = this.lift === 0 ? 0.02 : 0
      this.ghost.position.set(this.aimPoint.x, this.aimPoint.y + this.ghostOffset + this.lift + zFight, this.aimPoint.z)
      this.ghost.rotation.y = this.rotationY
    }
  }

  // ── focus ─────────────────────────────────────────────────────────────────

  /**
   * The prop the action billboard belongs to: the carried one if there is one,
   * otherwise whatever the crosshair is over.
   *
   * A carried prop wins because while you are holding something, that *is* what
   * you are working on — and the aim ray deliberately cannot see it (`grabAimed`
   * takes it out of `aimTargets`, or a drop would immediately re-grab it).
   */
  private focusedEntry(): PlacedProp | null {
    return this.held ?? (this.aimedId ? (this.byId.get(this.aimedId) ?? null) : null)
  }

  /** Object-space height of a definition's tallest tier. Cached; see `topCache`. */
  private topOf(defId: string): number {
    const cached = this.topCache.get(defId)
    if (cached !== undefined) {
      return cached
    }
    let top = 0
    const definition = getPlaceable(defId)
    for (const geometry of definition?.asset.tiers ?? []) {
      geometry.boundingBox ?? geometry.computeBoundingBox()
      const box = geometry.boundingBox
      if (box && Number.isFinite(box.max.y) && box.max.y > top) {
        top = box.max.y
      }
    }
    this.topCache.set(defId, top)
    return top
  }

  /**
   * Publishes where the billboard goes and, when it changed, what it says.
   *
   * Runs every frame and must stay allocation-free: the projection uses module
   * scratch, and the identity payload is only built on the frames where the
   * signature actually moved.
   */
  private updateFocus(): void {
    const entry = this.focusedEntry()
    this.applyHighlight(entry)

    if (!entry) {
      if (this.hasAimedScatter) {
        this.focusScatter()
        return
      }
      editorFocusScreen.onScreen = false
      this.emitFocus(null)
      return
    }

    const camera = this.world.camera
    const node = entry.node
    // Anchored at the prop's *top*, not its origin, and offset a little further
    // for breathing room. A prop's origin is at its foot, so an origin-anchored
    // card sits in the grass — and for anything the size of a plateau it would
    // be behind the prop entirely.
    const top = this.topOf(entry.placement.defId) * entry.placement.scale
    _anchor.set(node.position.x, node.position.y + top + FOCUS_ANCHOR_GAP, node.position.z)

    // View space first, because `Vector3.project` divides by w and therefore
    // reports a mirrored on-screen position for anything *behind* the camera.
    // A billboard that appears on the opposite edge when you turn away from a
    // prop is the classic version of this bug.
    _view.copy(_anchor).applyMatrix4(camera.matrixWorldInverse)
    editorFocusScreen.distance = _anchor.distanceTo(camera.position)
    if (_view.z > -camera.near) {
      editorFocusScreen.onScreen = false
    } else {
      _anchor.project(camera)
      editorFocusScreen.x = _anchor.x
      editorFocusScreen.y = _anchor.y
      // A margin rather than a hard [-1,1]: a card anchored just off screen is
      // still mostly readable, and clipping it the instant the anchor crosses
      // the edge makes the billboard blink while you orbit.
      editorFocusScreen.onScreen = Math.abs(_anchor.x) < 1.35 && Math.abs(_anchor.y) < 1.35
    }

    this.emitFocus(entry)
  }

  /**
   * The billboard for a scattered prop.
   *
   * Deliberately the same card as a placement's, because from the user's side it
   * is the same object: a thing in the world with a name that X deletes and F
   * moves. That the tree is a function of a seed and the platform is a row in a
   * save file is an implementation detail the tool should not leak.
   *
   * No outline highlight — the prop is one instance inside an `InstancedMesh`
   * shared by thousands, so there is no per-prop material to widen. The card
   * appearing over it is the feedback.
   */
  private focusScatter(): void {
    const camera = this.world.camera
    // No `topOf` to consult: a scattered instance has no `defId` and no node.
    // A fixed lift keeps the card clear of the stone it names and low enough on
    // a tree to read as belonging to it.
    _anchor.set(this.aimedScatter.x, this.aimedScatter.y + SCATTER_ANCHOR_HEIGHT, this.aimedScatter.z)
    _view.copy(_anchor).applyMatrix4(camera.matrixWorldInverse)
    editorFocusScreen.distance = _anchor.distanceTo(camera.position)
    if (_view.z > -camera.near) {
      editorFocusScreen.onScreen = false
    } else {
      _anchor.project(camera)
      editorFocusScreen.x = _anchor.x
      editorFocusScreen.y = _anchor.y
      editorFocusScreen.onScreen = Math.abs(_anchor.x) < 1.35 && Math.abs(_anchor.y) < 1.35
    }

    const signature = `s:${this.aimedScatter.key}`
    if (signature === this.focusSignature) {
      return
    }
    this.focusSignature = signature
    const definition = this.aimedScatter.editorDefId ? getPlaceable(this.aimedScatter.editorDefId) : undefined
    this.onFocusChange?.({
      id: this.aimedScatter.key,
      label: definition?.label ?? this.aimedScatter.species,
      defId: this.aimedScatter.species,
      // Zero rather than the definition's count: the number on the card is what
      // *this* prop costs, and a scattered instance's real cost is a slot in an
      // instanced draw that is already being made. Quoting the placeable's LOD0
      // would be quoting a different object.
      tris: 0,
      held: false,
      scale: 1,
      rotationDeg: 0,
      liftMetres: 0,
      scatter: true,
      // Moving one needs somewhere for it to land in the catalogue. Without an
      // equivalent it can still be deleted, and the card says so.
      movable: definition !== undefined
    })
  }

  private emitFocus(entry: PlacedProp | null): void {
    if (!entry) {
      if (this.focusSignature !== '') {
        this.focusSignature = ''
        this.onFocusChange?.(EMPTY_FOCUS)
      }
      return
    }
    const placement = entry.placement
    const held = this.held === entry
    const lift = this.liftOf(placement)
    // Rounded before it becomes the signature, so a prop drifting by a
    // micrometre under a held preview cannot fire a Vue update every frame.
    const rotationDeg = Math.round((placement.rotY / DEGREES) % 360)
    const scale = Math.round(placement.scale * 1000) / 1000
    const liftRounded = Math.round(lift * 100) / 100
    const signature = `${placement.id}|${held ? 1 : 0}|${rotationDeg}|${scale}|${liftRounded}`
    if (signature === this.focusSignature) {
      return
    }
    this.focusSignature = signature

    const definition = getPlaceable(placement.defId)
    const geometry = definition?.asset.tiers[0]
    this.onFocusChange?.({
      id: placement.id,
      label: definition?.label ?? placement.defId,
      defId: placement.defId,
      tris: geometry ? triangleCount(geometry) : 0,
      held,
      scale,
      // While carried the prop follows the live rotation, which is not written
      // back into the placement until it is dropped.
      rotationDeg: held ? this.rotationDegrees() : rotationDeg,
      liftMetres: held ? this.lift : liftRounded,
      scatter: false,
      movable: true
    })
  }

  /**
   * Widens and recolours the focused prop's own outline hull. See the notes on
   * `FOCUS_COLOR` for why it is the hull rather than a gizmo.
   */
  private applyHighlight(entry: PlacedProp | null): void {
    const key = entry ? `${entry.placement.id}|${this.held === entry ? 'h' : 'a'}` : ''
    if (key === this.highlightKey) {
      return
    }
    if (this.highlighted) {
      this.paintOutline(this.highlighted, null)
    }
    this.highlighted = entry
    this.highlightKey = key
    if (entry) {
      this.paintOutline(entry, this.held === entry ? HELD_COLOR : FOCUS_COLOR)
    }
  }

  /**
   * Drops the highlight *without* repainting, for a node that is about to be
   * disposed.
   *
   * The ordinary path restores the shipped outline before letting go, which is
   * exactly wrong here: the materials are on their way out, and the next frame's
   * `applyHighlight(null)` would otherwise reach into a disposed `DitheredLod` to
   * politely reset uniforms nobody will ever read.
   */
  private forgetHighlight(entry: PlacedProp): void {
    if (this.highlighted === entry) {
      this.highlighted = null
      this.highlightKey = ''
    }
  }

  /** `null` restores the shipped outline (GDD R6). */
  private paintOutline(entry: PlacedProp, color: Color | null): void {
    for (const mesh of entry.node.outlineMeshes) {
      if (!mesh) {
        continue
      }
      const material = mesh.material as OutlineMaterial
      material.pixelWidth = color ? FOCUS_OUTLINE_PX : DEFAULT_OUTLINE_PX
      const cool = material.uniforms.uCool?.value as Color | undefined
      cool?.copy(color ?? OUTLINE_COOL)
      const coolMix = material.uniforms.uCoolMix
      if (coolMix) {
        // Fully to the highlight colour, so the outline reads as a selection
        // rather than as a slightly bluer version of the prop's own edge.
        coolMix.value = color ? 1 : OUTLINE_COOL_MIX
      }
    }
  }

  // ── aim ───────────────────────────────────────────────────────────────────

  /**
   * Where the player is looking: the nearer of the terrain surface and any
   * placed prop, along the ray through the pointer.
   *
   * The prop test is a real `THREE.Raycaster`. The terrain test is **not**:
   * the chunk meshes carry all four LOD tiers at once and `Raycaster` ignores
   * `visible`, so raycasting `terrain.group` would happily return a hit on the
   * LOD3 silhouette (or on a chunk skirt — a curtain hanging 2.5 m below the
   * surface at every seam) and the ghost would sink into the ground at chunk
   * borders. Marching the heightfield instead hits the *same continuous
   * surface* every tier approximates, costs a few dozen `heightAt` calls, and
   * allocates nothing.
   */
  private resolveAim(): void {
    this.raycaster.setFromCamera(this.pointer, this.world.camera)
    this.raycaster.far = AIM_MAX_DISTANCE

    let bestDistance = this.marchTerrain()
    this.aimedId = null

    if (this.aimTargets.length > 0) {
      this.hits.length = 0
      this.raycaster.intersectObjects(this.aimTargets, false, this.hits)
      const hit = this.hits[0]
      if (hit && (bestDistance < 0 || hit.distance < bestDistance)) {
        bestDistance = hit.distance
        this.aimedId = (hit.object.userData.placementId as string | undefined) ?? null
      } else if (hit) {
        // Terrain is nearer, but the prop is still what the crosshair is over
        // when the two are within a hand's breadth — otherwise a prop sitting
        // flush on the ground is impossible to pick up at a shallow angle.
        if (hit.distance - bestDistance < 0.35) {
          this.aimedId = (hit.object.userData.placementId as string | undefined) ?? null
        }
      }
      this.hits.length = 0
    }

    this.aimValid = bestDistance >= 0
    if (this.aimValid) {
      this.aimPoint
        .copy(this.raycaster.ray.direction)
        .multiplyScalar(bestDistance)
        .add(this.raycaster.ray.origin)
    }

    this.resolveScatterAim(bestDistance)
  }

  /**
   * What scattered prop, if any, the crosshair is on.
   *
   * Only asked when no *placement* is aimed at. A placed prop wins outright:
   * it is the thing the editor can move, rotate and scale, and having a tree
   * behind it steal the focus would make props placed in a forest unusable.
   *
   * Skipped entirely while carrying something, since the answer could only be
   * used to swap what is in hand for something else.
   */
  private resolveScatterAim(terrainDistance: number): void {
    if (this.held || this.aimedId) {
      this.hasAimedScatter = false
      return
    }
    const { origin, direction } = this.raycaster.ray
    // Stop the search at the ground. Without this the ray keeps going under the
    // terrain and picks trees on the next hillside, which is both wrong and the
    // kind of wrong that only shows up on sloped ground.
    _ray.maxDistance = terrainDistance >= 0 ? Math.min(terrainDistance + 1, SCATTER_PICK_RANGE) : SCATTER_PICK_RANGE
    _ray.originX = origin.x
    _ray.originY = origin.y
    _ray.originZ = origin.z
    _ray.dirX = direction.x
    _ray.dirY = direction.y
    _ray.dirZ = direction.z
    _ray.pointX = this.aimValid ? this.aimPoint.x : origin.x
    _ray.pointZ = this.aimValid ? this.aimPoint.z : origin.z

    const pick = this.world.pickScatter(_ray)
    if (!pick) {
      this.hasAimedScatter = false
      return
    }
    // Copied out: `pickScatter` hands back a shared object, and this is read
    // next frame and on key presses, long after it has been overwritten.
    this.aimedScatter.key = pick.key
    this.aimedScatter.species = pick.species
    this.aimedScatter.editorDefId = pick.editorDefId
    this.aimedScatter.x = pick.x
    this.aimedScatter.z = pick.z
    this.aimedScatter.y = pick.y
    this.hasAimedScatter = true
  }

  /** Distance along the aim ray to the terrain, or -1 if it never hits. */
  private marchTerrain(): number {
    const { origin, direction } = this.raycaster.ray
    const terrain = this.world.terrain

    let distance = 0
    let clearance = origin.y - terrain.heightAt(origin.x, origin.z)
    if (clearance <= 0) {
      // Camera is under the surface (it is clamped above ground, so this is a
      // one-frame transient at most). Aiming at zero is harmless and avoids a
      // march that would immediately report a bogus hit behind the near plane.
      return 0
    }

    while (distance < AIM_MAX_DISTANCE) {
      const step = Math.min(Math.max(clearance * 0.6, AIM_MIN_STEP), AIM_MAX_STEP)
      const next = distance + step
      const nextClearance =
        origin.y +
        direction.y * next -
        terrain.heightAt(origin.x + direction.x * next, origin.z + direction.z * next)

      if (nextClearance <= 0) {
        // Bisect the bracketing interval. Fourteen halvings of a ≤6 m step
        // lands well inside a millimetre, which is far finer than the export
        // rounds to anyway.
        let low = distance
        let high = next
        for (let i = 0; i < AIM_REFINE_STEPS; i++) {
          const mid = (low + high) * 0.5
          const gap =
            origin.y +
            direction.y * mid -
            terrain.heightAt(origin.x + direction.x * mid, origin.z + direction.z * mid)
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

  // ── ghost preview ─────────────────────────────────────────────────────────

  private buildGhost(defId: string): void {
    this.removeGhost()
    const definition = getPlaceable(defId)
    if (!definition) {
      return
    }
    // LOD0 geometry, shared with the real asset — the ghost is a second draw
    // of a mesh that already exists, not a second copy of it.
    const geometry = definition.asset.tiers[0]
    if (!geometry) {
      return
    }
    const ghost = new Mesh(geometry, this.ghostMaterial)
    ghost.name = `editor-ghost:${defId}`
    ghost.castShadow = false
    ghost.receiveShadow = false
    ghost.scale.setScalar(definition.defaultScale ?? 1)
    this.group.add(ghost)
    this.ghost = ghost
    this.ghostFor = defId
    this.ghostOffset = definition.groundOffset ?? 0
  }

  private removeGhost(): void {
    if (this.ghost) {
      this.group.remove(this.ghost)
      this.ghost = null
    }
    this.ghostFor = ''
    this.ghostOffset = 0
  }

  // ── placements ────────────────────────────────────────────────────────────

  private spawn(placement: Placement): PlacedProp | null {
    const definition = getPlaceable(placement.defId)
    if (!definition) {
      this.orphans.push(placement)
      return null
    }
    const node = new DitheredLod(definition.asset)
    const lod0 = node.tierMeshes[0]
    if (lod0) {
      lod0.userData.placementId = placement.id
    }
    const entry: PlacedProp = { placement, node, index: -1 }
    this.attach(entry)
    return entry
  }

  /** Put an entry into the live scene at its descriptor's transform. */
  private attach(entry: PlacedProp): void {
    const { placement, node } = entry
    node.position.set(placement.x, placement.y, placement.z)
    node.rotation.y = placement.rotY
    node.scale.setScalar(placement.scale)
    this.group.add(node)
    // Parented first, then updated: the aim ray reads `matrixWorld`, and three
    // only refreshes it inside `render()`, so without this the prop is
    // un-aimable for the frame it is placed in.
    node.updateMatrixWorld(true)

    const lod0 = node.tierMeshes[0]
    if (lod0) {
      this.aimTargets.push(lod0)
    }
    entry.index = this.list.length
    this.list.push(entry)
    this.byId.set(placement.id, entry)
  }

  /** Take an entry back out of the live scene. Shared by remove and pick-up. */
  private detach(entry: PlacedProp): void {
    this.group.remove(entry.node)
    const lod0 = entry.node.tierMeshes[0]
    if (lod0) {
      const index = this.aimTargets.indexOf(lod0)
      if (index >= 0) {
        this.aimTargets.splice(index, 1)
      }
    }
    // Swap-pop: the render order of placements is irrelevant, so there is no
    // reason to pay a splice for every deletion.
    const last = this.list.pop()!
    if (last !== entry) {
      this.list[entry.index] = last
      last.index = entry.index
    }
    this.byId.delete(entry.placement.id)
  }

  /**
   * Hands the crosshair to another tool.
   *
   * ── Why a hook and not a second editor ──────────────────────────────────────
   *
   * Everything a placing tool needs is the aim point, and computing one means a
   * raycaster, a list of aim targets kept in step with the scene, a terrain
   * fallback, an NDC pointer tracked across resizes and a `pointerdown` that
   * fires *before* the orbit controller's. All of that is here already and none
   * of it is about props. A second tool that grew its own copy would be a second
   * thing to keep correct, and the two would fight over the same click.
   *
   * So a brush borrows this one. While one is set it receives the placement
   * verbs instead of the palette, the prop ghost is hidden, and everything
   * else — aiming, the focus billboard, the camera — carries on unchanged.
   */
  setBrush(brush: PlacementBrush | null): void {
    if (this.brush === brush) {
      return
    }
    this.brush?.onDeselect?.()
    this.brush = brush
    if (brush) {
      // A palette selection and a brush are two answers to "what does a click
      // do", so taking one drops the other rather than leaving a ghost prop
      // following the crosshair that no click will ever place.
      this.setSelected('')
    }
    this.removeGhost()
  }

  hasBrush(): boolean {
    return this.brush !== null
  }

  /** Place the selected palette entry at the aim point. Returns its label. */
  place(): string | null {
    if (this.brush) {
      return this.aimValid && this.active
        ? this.brush.place(this.aimPoint.x, this.aimPoint.y + this.lift, this.aimPoint.z, this.rotationY)
        : null
    }
    const definition = getPlaceable(this.selectedId)
    if (!this.active || !definition || !this.aimValid) {
      return null
    }
    const placement: Placement = {
      id: `p${++this.seq}`,
      defId: definition.id,
      x: this.aimPoint.x,
      // The aim point sits on the surface; `groundOffset` is the definition's
      // own correction for a pivot that is not at the prop's base; `lift` is
      // the user's Ctrl+wheel elevation above it.
      y: this.aimPoint.y + (definition.groundOffset ?? 0) + this.lift,
      z: this.aimPoint.z,
      rotY: this.rotationY,
      scale: definition.defaultScale ?? 1
    }
    if (!this.spawn(placement)) {
      return null
    }
    this.save()
    return definition.label
  }

  /** Pick up the aimed placement so it follows the aim point until dropped. */
  grabAimed(): boolean {
    if (!this.active || this.held || !this.aimedId) {
      return false
    }
    const entry = this.byId.get(this.aimedId)
    if (!entry) {
      return false
    }
    this.detach(entry)
    // Keep it rendering, just outside the aim targets — you cannot aim at the
    // thing you are carrying, or a drop would immediately re-grab it.
    this.group.add(entry.node)
    this.held = entry
    this.heldOffset = getPlaceable(entry.placement.defId)?.groundOffset ?? 0
    this.rotationY = entry.placement.rotY
    // Adopt the prop's own elevation, so picking up a floating platform to nudge
    // it sideways doesn't slam it back onto the ground.
    this.lift = this.liftOf(entry.placement)
    this.aimedId = null
    this.save()
    return true
  }

  /** Drop the held prop at the aim point. */
  dropHeld(): boolean {
    const entry = this.held
    if (!entry) {
      return false
    }
    if (this.aimValid) {
      entry.placement.x = this.aimPoint.x
      entry.placement.y = this.aimPoint.y + this.heldOffset + this.lift
      entry.placement.z = this.aimPoint.z
    }
    entry.placement.rotY = this.rotationY
    this.held = null
    this.heldOffset = 0
    // The same node goes back in — rebuilding a `DitheredLod` would clone four
    // more materials for a prop that only moved.
    this.attach(entry)
    this.save()
    return true
  }

  /** Delete the held prop outright. */
  deleteHeld(): boolean {
    const entry = this.held
    if (!entry) {
      return false
    }
    this.forgetHighlight(entry)
    this.group.remove(entry.node)
    entry.node.dispose()
    this.held = null
    this.heldOffset = 0
    this.save()
    return true
  }

  /**
   * Copy the focused prop and pick the copy up.
   *
   * Picking it up rather than dropping it beside the original is the whole
   * design: "where does the duplicate go" has no good default — offset it by a
   * metre and it lands inside a wall as often as not, offset it by zero and it
   * z-fights its own original — whereas handing it to the cursor lets the answer
   * be "wherever you were about to put it". It is also the same gesture every
   * DCC tool uses for duplicate-and-move.
   *
   * Works on a carried prop too, which is how you lay a row: duplicate, place,
   * duplicate, place.
   */
  duplicateFocused(): boolean {
    if (!this.active) {
      return false
    }
    const source = this.focusedEntry()
    if (!source) {
      return false
    }
    // The carried prop's stored transform is frozen where it was picked up, so
    // a copy of it must take the *live* preview transform instead — otherwise
    // duplicating mid-carry silently clones the prop's old position.
    const live = this.held === source
    const placement: Placement = {
      ...source.placement,
      id: `p${++this.seq}`,
      rotY: live ? this.rotationY : source.placement.rotY
    }
    if (live && this.aimValid) {
      placement.x = this.aimPoint.x
      placement.y = this.aimPoint.y + this.heldOffset + this.lift
      placement.z = this.aimPoint.z
    }
    // Drop whatever is in hand first, so the copy can be picked up. Ordered this
    // way round rather than the reverse because `dropHeld` writes the original's
    // transform from the aim point, which is exactly where the user left it.
    if (this.held) {
      this.dropHeld()
    }
    const entry = this.spawn(placement)
    if (!entry) {
      return false
    }
    this.detach(entry)
    this.group.add(entry.node)
    this.held = entry
    this.heldOffset = getPlaceable(placement.defId)?.groundOffset ?? 0
    this.rotationY = placement.rotY
    this.lift = this.liftOf(placement)
    this.aimedId = null
    this.save()
    return true
  }

  /**
   * Grow or shrink the focused prop by one multiplicative step.
   *
   * Multiplicative rather than additive so a step feels the same on a 0.4 m
   * stone and a 12 m plateau; `Placement.scale` is already persisted, exported
   * *and* honoured by the collider builder (`player/collision.ts` multiplies
   * every collider extent by it), so this needed no new plumbing anywhere — it
   * was simply a value the editor had no way to reach.
   */
  scaleFocused(direction: number): boolean {
    if (!this.active || direction === 0) {
      return false
    }
    const entry = this.focusedEntry()
    if (!entry) {
      return false
    }
    const factor = direction > 0 ? SCALE_STEP : 1 / SCALE_STEP
    const next = Math.min(SCALE_MAX, Math.max(SCALE_MIN, entry.placement.scale * factor))
    // Float dust otherwise shows up in the export as 1.0000000000000002.
    const rounded = Math.round(next * 1e4) / 1e4
    if (rounded === entry.placement.scale) {
      return false
    }
    entry.placement.scale = rounded
    entry.node.scale.setScalar(rounded)
    entry.node.updateMatrixWorld(true)
    this.save()
    return true
  }

  /** Rotate the focused prop, whether it is carried or merely aimed at. */
  rotateFocused(degrees: number): boolean {
    if (!this.active) {
      return false
    }
    if (this.held) {
      // The carried prop reads `rotationY` every frame in `updatePreview`, so
      // moving the shared value is the whole operation.
      this.rotateBy(degrees)
      return true
    }
    const entry = this.focusedEntry()
    if (!entry) {
      return false
    }
    entry.placement.rotY = (entry.placement.rotY + degrees * DEGREES) % TAU
    entry.node.rotation.y = entry.placement.rotY
    entry.node.updateMatrixWorld(true)
    this.save()
    return true
  }

  /** Remove the focused prop — carried, aimed at, or scattered. */
  deleteFocused(): boolean {
    // The brush gets first refusal. It owns the crosshair, so whatever it has
    // put down under it is what "delete this" means — and it is asked *before*
    // the placement list so a spawn standing on a platform is not a click that
    // deletes the platform.
    if (this.brush?.removeAt(this.aimPoint.x, this.aimPoint.y, this.aimPoint.z, this.aimValid)) {
      return true
    }
    return this.deleteHeld() || this.removeAimed() || this.removeAimedScatter()
  }

  /** Pick up the aimed prop, or drop the carried one. The billboard's Move. */
  toggleGrab(): boolean {
    return this.dropHeld() || this.grabAimed() || this.grabAimedScatter()
  }

  /**
   * Delete the scattered prop under the crosshair.
   *
   * Nothing is removed from a list here — the instance is a function of the
   * seed, and will be generated again the next time its chunk streams in. What
   * this writes is a *tombstone*, which the chunk loader filters against. See
   * `level/scatterOverrides.ts`.
   */
  removeAimedScatter(): boolean {
    if (!this.active || !this.hasAimedScatter) {
      return false
    }
    const removed = this.world.removeScatter(this.aimedScatter.key, this.aimedScatter.x, this.aimedScatter.z)
    if (!removed) {
      return false
    }
    this.hasAimedScatter = false
    // The card named a prop that no longer exists. Clearing the signature makes
    // the next frame re-emit rather than compare equal and leave it on screen.
    this.focusSignature = ''
    this.onFocusChange?.(EMPTY_FOCUS)
    editorFocusScreen.onScreen = false
    return true
  }

  /**
   * Pick up a scattered prop — delete it and hand back its catalogue equivalent.
   *
   * This is the whole trick that makes a procedural world *movable*. A scatter
   * instance cannot be dragged: it has no node, no transform of its own and no
   * row anywhere to rewrite. So moving one is a tombstone plus an ordinary
   * placement, and from that point on it is an ordinary placement in every
   * respect — rotatable, scalable, persisted, exported.
   *
   * The swap is not perfectly like-for-like. A scattered tree is one of three
   * seeded variants and the catalogue holds one authored tree, so what lands in
   * your hand is the same *kind* of prop rather than the same mesh.
   */
  grabAimedScatter(): boolean {
    if (!this.active || this.held || !this.hasAimedScatter) {
      return false
    }
    const defId = this.aimedScatter.editorDefId
    if (!defId || !getPlaceable(defId)) {
      return false
    }
    const { key, x, z, y } = this.aimedScatter
    if (!this.world.removeScatter(key, x, z)) {
      return false
    }
    this.hasAimedScatter = false

    const definition = getPlaceable(defId)
    const placement: Placement = {
      id: `p${++this.seq}`,
      defId,
      x,
      y: y + (definition?.groundOffset ?? 0),
      z,
      rotY: this.rotationY,
      scale: definition?.defaultScale ?? 1
    }
    const entry = this.spawn(placement)
    if (!entry) {
      // The catalogue entry checked out a moment ago, so this is close to
      // impossible — but leaving the world short one tree because a spawn failed
      // would be a silent deletion, so put it back.
      this.world.restoreScatter(key, x, z)
      return false
    }
    this.detach(entry)
    this.group.add(entry.node)
    this.held = entry
    this.heldOffset = definition?.groundOffset ?? 0
    this.lift = 0
    this.save()
    return true
  }

  /** Remove the aimed placement. */
  removeAimed(): boolean {
    if (!this.active || !this.aimedId) {
      return false
    }
    const entry = this.byId.get(this.aimedId)
    if (!entry) {
      return false
    }
    this.forgetHighlight(entry)
    this.detach(entry)
    entry.node.dispose()
    this.aimedId = null
    this.save()
    return true
  }

  isHolding(): boolean {
    return this.held !== null
  }

  /** The carried placement's id, or null. A consumer building colliders should
   *  skip it: its stored transform is frozen where it was picked up, so its
   *  collider would otherwise sit as a phantom under the empty ground. */
  heldId(): string | null {
    return this.held?.placement.id ?? null
  }

  /** Monotonic mutation counter. Integer-compare it before calling `snapshot()`. */
  revision(): number {
    return this.rev
  }

  /** Does this browser already have a level, stored or live? */
  hasLevel(): boolean {
    return this.placementCount() > 0 || hasStoredPlacements()
  }

  /**
   * Seed a starting arrangement. The result is *ordinary placements* — the
   * caller's guard decides whether they happen at all, and once they exist
   * nothing distinguishes them from hand-placed props: they are editable,
   * removable, persisted and exported like any other. There is deliberately no
   * tombstone or defaults-diff layer, because there is no committed base
   * layout to reconcile against.
   *
   * Returns how many were seeded. A `defId` that is not registered yet is
   * still seeded — it parks in `orphans` and hydrates on the first frame — so
   * this may be called before the placeables register.
   */
  seed(seeds: readonly LevelSeed[]): number {
    if (seeds.length === 0) {
      return 0
    }
    const unresolved: string[] = []
    for (const entry of seeds) {
      const definition = getPlaceable(entry.defId)
      const placement: Placement = {
        id: `p${++this.seq}`,
        defId: entry.defId,
        x: entry.x,
        y: entry.y,
        z: entry.z,
        rotY: entry.rotY ?? 0,
        scale: entry.scale ?? definition?.defaultScale ?? 1
      }
      if (!this.spawn(placement)) {
        unresolved.push(entry.defId)
      }
    }
    if (unresolved.length > 0) {
      // Not an error — seeding before registration is supported — but a typo'd
      // defId looks exactly the same from here, so it must be visible.
      console.warn(`[editor] seeded ${unresolved.length} placement(s) with no registered definition yet:`, [
        ...new Set(unresolved)
      ])
    }
    this.save()
    return seeds.length
  }

  /**
   * Re-spawn saved placements whose definition was missing at load time.
   *
   * This is what lets `installLevelEditor` be called *before* the placeables
   * register: the constructor's `load()` parks anything unknown in `orphans`,
   * and the first frame — by which point every asset module has run — tries
   * again. Also exposed on the façade for a genuinely lazy registration.
   */
  retryOrphans(): number {
    if (this.orphans.length === 0) {
      return 0
    }
    // Swapped out first: `spawn` pushes back into `orphans` for ids that are
    // still unknown, which would otherwise re-enter the list being iterated.
    const pending = this.orphans
    this.orphans = []
    let spawned = 0
    for (const placement of pending) {
      if (this.spawn(placement)) {
        spawned++
      }
    }
    if (spawned > 0) {
      this.emitState()
    }
    return spawned
  }

  placementCount(): number {
    return this.list.length + this.orphans.length + (this.held ? 1 : 0)
  }

  /**
   * Plain copies of every placement, orphans included, sorted for a stable
   * diff. Copies because this is what crosses into Vue and into a clipboard —
   * handing out the live descriptors would let the panel mutate the scene.
   */
  snapshot(): Placement[] {
    const all: Placement[] = this.orphans.map(placement => ({ ...placement }))
    for (const entry of this.list) {
      all.push({ ...entry.placement })
    }
    if (this.held) {
      all.push({ ...this.held.placement })
    }
    all.sort((a, b) => a.defId.localeCompare(b.defId) || a.x - b.x || a.z - b.z)
    return all
  }

  // ── persistence ───────────────────────────────────────────────────────────

  private load(): void {
    let raw: string | null = null
    try {
      raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PLACEMENTS_KEY) : null
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
      console.warn('[editor] saved placements are not valid JSON — starting empty')
      return
    }
    if (!Array.isArray(parsed)) {
      return
    }
    for (const candidate of parsed) {
      const placement = normalisePlacement(candidate)
      if (!placement) {
        continue
      }
      // Ids are minted `p<n>`; resume past the highest so a reload cannot
      // hand a fresh placement an id that is already taken.
      const numeric = Number.parseInt(placement.id.slice(1), 10)
      if (placement.id.startsWith('p') && Number.isFinite(numeric)) {
        this.seq = Math.max(this.seq, numeric)
      }
      this.spawn(placement)
    }
    this.emitState()
  }

  private save(): void {
    try {
      localStorage.setItem(PLACEMENTS_KEY, JSON.stringify(this.snapshot()))
    } catch {
      console.warn('[editor] could not persist placements (storage full or disabled)')
    }
    this.emitState()
  }

  clearAll(): number {
    const removed = this.placementCount()
    // Every node here is about to be disposed, so the highlight has nothing left
    // to restore itself onto.
    this.highlighted = null
    this.highlightKey = ''
    editorFocusScreen.onScreen = false
    for (const entry of this.list) {
      this.group.remove(entry.node)
      entry.node.dispose()
    }
    this.list.length = 0
    this.aimTargets.length = 0
    this.byId.clear()
    this.orphans = []
    if (this.held) {
      this.group.remove(this.held.node)
      this.held.node.dispose()
      this.held = null
    }
    this.save()
    return removed
  }

  /**
   * The mutation seam. The revision bumps *here* rather than at each call site
   * because every mutation already has to tell the panel, so this is the one
   * place that cannot be forgotten when a new edit operation is added. It is
   * never reached from `update()` — a held prop's *stored* transform does not
   * move while it is carried (see `dropHeld`), so the frame loop has nothing
   * to report.
   */
  private emitState(): void {
    this.rev++
    this.onStateChange?.({
      placementCount: this.placementCount(),
      holding: this.held !== null,
      rotationDeg: this.rotationDegrees(),
      liftMetres: this.lift
    })
  }

  // ── input ─────────────────────────────────────────────────────────────────

  /**
   * Only pointer events that land on the canvas are the editor's. The panel is
   * a sibling DOM node, and its `@pointerdown.stop` cannot help here: this
   * listener is in the *capture* phase, which has already run by the time the
   * panel's bubble-phase handler could stop anything.
   */
  private isCanvasEvent(event: Event): boolean {
    return event.target === this.canvas
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.active) {
      return
    }
    // Only the canvas moves the aim. Without this the crosshair follows the
    // pointer onto the panels — and, once the focus billboard existed, into a
    // feedback loop: moving toward a button changes what is aimed at, which
    // moves the billboard out from under the pointer. Leaving the canvas now
    // freezes the aim where it was, which is also what makes the palette usable
    // without the ghost wandering off.
    if (!this.isCanvasEvent(event)) {
      return
    }
    // `getBoundingClientRect` per move rather than a cached rect: the canvas is
    // laid out by CSS inside whatever shell the game uses (see WorldScene), so
    // a cache would need invalidating on resize, scroll and safe-area change.
    // This is a dev tool; the DOMRect is cheaper than that bookkeeping.
    const rect = this.canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return
    }
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  }

  /**
   * Ctrl+Click drops a held prop / picks up the aimed one / places from the
   * palette; Shift+Click removes. This is `pointerdown`, not dreamion's
   * `mousedown`, because `OrbitCameraController` starts its orbit drag on
   * `pointerdown` — and `pointerdown` fires *first*. Stopping the mouse event
   * would leave the camera spinning under every edit.
   */
  private onPointerDown = (event: PointerEvent): void => {
    if (!this.active || event.button !== 0 || !event.isPrimary || !this.isCanvasEvent(event)) {
      return
    }
    if (event.ctrlKey) {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (this.held) {
        this.dropHeld()
        return
      }
      if (this.grabAimed()) {
        return
      }
      this.place()
      return
    }
    if (event.shiftKey && (this.aimedId || this.hasAimedScatter)) {
      event.preventDefault()
      event.stopImmediatePropagation()
      // Same fall-through as X: whatever the crosshair is on, Shift+Click
      // removes it, placement or tree.
      this.deleteFocused()
    }
  }

  /** Wheel rotates the preview 1° per notch — and must not also zoom. */
  private onWheel = (event: WheelEvent): void => {
    if (!this.active || !this.isCanvasEvent(event)) {
      return
    }
    if (!this.held && !this.selectedId) {
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()

    const direction = event.deltaY > 0 ? -1 : 1
    if (event.ctrlKey) {
      // Ctrl → vertical offset; + Shift → snapped to the 10 cm grid.
      //
      // `preventDefault` above is what makes this usable at all: Ctrl+wheel is
      // the browser's own page-zoom gesture, and without swallowing it the
      // whole canvas would scale while you tried to lift a platform.
      this.liftBy(direction, event.shiftKey)
      return
    }
    this.rotateBy(direction)
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.active || event.ctrlKey || event.metaKey || event.altKey) {
      return
    }
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return
    }
    // `code`, not `key`: the bindings are positional, so they survive a
    // non-QWERTY layout the same way WASD does on the camera.
    switch (event.code) {
      case 'KeyG':
        if (event.repeat) {
          return
        }
        event.preventDefault()
        if (!this.dropHeld()) {
          this.place()
        }
        return
      case 'KeyF':
        if (event.repeat) {
          return
        }
        event.preventDefault()
        // Falls through to scatter, so aiming at a tree and pressing F picks it
        // up the same way aiming at a platform does. Routing the keys through
        // the same verbs the focus billboard calls is what keeps the two from
        // drifting — the card offering a Move the key binding does not do is
        // exactly the kind of split a tool should never have.
        if (!this.grabAimed()) {
          this.grabAimedScatter()
        }
        return
      case 'KeyX':
        if (event.repeat) {
          return
        }
        event.preventDefault()
        this.deleteFocused()
        return
      case 'KeyC':
        if (event.repeat) {
          return
        }
        event.preventDefault()
        this.duplicateFocused()
        return
      // Rotation repeats on purpose — holding Q spins the preview, which is
      // how you line a prop up against a slope. Now applied to the *focused*
      // prop rather than only to the preview, so an already-placed prop can be
      // turned without picking it up first.
      case 'KeyQ':
        event.preventDefault()
        if (!this.rotateFocused(-90)) {
          this.rotateBy(-90)
        }
        return
      case 'KeyE':
        event.preventDefault()
        if (!this.rotateFocused(90)) {
          this.rotateBy(90)
        }
        return
      // Scale repeats too: holding `+` grows a prop smoothly, which is the only
      // way this is usable at 12 % a step.
      case 'Minus':
      case 'NumpadSubtract':
        event.preventDefault()
        this.scaleFocused(-1)
        return
      case 'Equal':
      case 'NumpadAdd':
        event.preventDefault()
        this.scaleFocused(1)
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
    window.removeEventListener('wheel', this.onWheel, { capture: true } as EventListenerOptions)
    window.removeEventListener('keydown', this.onKeyDown)

    this.removeGhost()
    this.ghostMaterial.dispose()
    // Before the nodes go: `paintOutline` touches their materials, and this is
    // the last moment they are guaranteed to exist.
    this.applyHighlight(null)
    editorFocusScreen.onScreen = false
    this.onFocusChange = null
    for (const entry of this.list) {
      entry.node.dispose()
    }
    this.held?.node.dispose()
    this.held = null
    this.list.length = 0
    this.aimTargets.length = 0
    this.byId.clear()
    // Tier geometries and the source material belong to the asset, not to us —
    // disposing them here would blank every instanced copy in the scene.
    this.group.clear()
    this.world.scene.remove(this.group)
    this.onStateChange = null
  }
}

/** Accepts a parsed JSON entry only if every field a `Placement` needs is a
 *  finite number / non-empty string. A half-written save is worse than none. */
const normalisePlacement = (candidate: unknown): Placement | null => {
  if (typeof candidate !== 'object' || candidate === null) {
    return null
  }
  const entry = candidate as Record<string, unknown>
  const id = typeof entry.id === 'string' ? entry.id : ''
  const defId = typeof entry.defId === 'string' ? entry.defId : ''
  if (!id || !defId) {
    return null
  }
  const number = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return {
    id,
    defId,
    x: number(entry.x, 0),
    y: number(entry.y, 0),
    z: number(entry.z, 0),
    rotY: number(entry.rotY, 0),
    scale: number(entry.scale, 1)
  }
}
