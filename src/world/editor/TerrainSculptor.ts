import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LineBasicMaterial,
  LineLoop,
  Raycaster,
  Vector2,
  Vector3
} from 'three'
import { C } from '../art/palette'
import type { World } from '../core/World'
import { heightAtCore, type HeightfieldParams } from '../terrain/heightfieldCore'
import {
  applyDab,
  createBaseGridCache,
  MAX_SCULPT_RADIUS,
  MIN_SCULPT_RADIUS,
  parseSculpt,
  SCULPT_FALLOFFS,
  SCULPT_STORE_KEY,
  SCULPT_TOOLS,
  sculptFalloff,
  SculptField,
  serialiseSculpt,
  type SculptFalloff,
  type SculptTool,
  type SculptUndoRecord
} from '../terrain/SculptField'

/**
 * ─── Terrain sculpting (scene side) ─────────────────────────────────────────
 *
 * Paints height offsets into a `SculptField` and keeps the three consumers of
 * the heightfield in step with it:
 *
 *   1. **This thread's height query.** `field.params.delta` is set to the
 *      `SculptField` itself, so `heightAtCore` — and therefore the player's
 *      collision, the camera's floor clamp and the prop editor's aim march —
 *      sees the new ground the instant a dab lands. Nothing else has to know.
 *   2. **The chunk workers.** Only the tiles that changed are posted, and
 *      always *before* the rebuild request, because `postMessage` is FIFO per
 *      worker and that ordering is the whole synchronisation scheme.
 *   3. **Chunks already on screen.** `Terrain.invalidateRegion` refills their
 *      geometry in place.
 *
 * **Nothing in this file is reactive.** `sculptFacade.ts` mirrors a handful of
 * primitives into `ref`s; the class holds plain fields so no per-frame path
 * ever touches a Vue proxy (GDD §0).
 *
 * ── Bindings ────────────────────────────────────────────────────────────────
 *
 * Chosen against a crowded window. The prop editor owns Ctrl+Click, Shift+
 * Click, G/F/X/Q/E and the wheel (its wheel handler is registered `capture`
 * and does not test modifiers, so **no wheel binding is available here at
 * all**); the water editor owns Alt+everything; `OrbitCameraController` records
 * every `event.code` regardless of modifiers, so WASD and the arrows are
 * unusable; and `toggle.ts` feeds every printable key into the code-word
 * buffer, so C/M/O/N are avoided as a courtesy.
 *
 *   1 2 3 4 5      raise · lower · smooth · flatten · roughen
 *   0              disarm (releases the left mouse button back to the camera)
 *   [ ]            brush radius ∓
 *   - =            strength ∓
 *   V              cycle the falloff curve
 *   H              set the flatten height to the ground under the cursor
 *   Z              undo the last stroke
 *   drag (LMB)     paint, while a tool is armed
 *
 * Left-drag is taken over only while a tool is armed, and only with no
 * modifier held. That is deliberate: `0` is one keystroke away, and the
 * alternative — a modifier chord for painting — collides with both of the
 * other two editors.
 */

/** Milliseconds between mid-stroke chunk rebuilds. */
const REBUILD_INTERVAL_MS = 110
/** Milliseconds of quiet before the delta is written to localStorage. */
const SAVE_DEBOUNCE_MS = 700
/** Stroke-level undo depth. Each entry holds copies of the tiles it touched. */
const UNDO_DEPTH = 32

const AIM_MAX_DISTANCE = 400
const AIM_MIN_STEP = 0.35
const AIM_MAX_STEP = 6
const AIM_REFINE_STEPS = 14

/** Segments in the brush gizmo's rings. */
const RING_SEGMENTS = 72
/** Ring height above the surface, so it is not z-fighting the ground it hugs. */
const RING_LIFT = 0.06

export const DEFAULT_SCULPT_RADIUS = 14
export const DEFAULT_SCULPT_STRENGTH = 2.5
export const MIN_SCULPT_STRENGTH = 0.25
export const MAX_SCULPT_STRENGTH = 12

/**
 * Per-tool gizmo tint. From the palette, never a hex literal — `CLAUDE.md` R2
 * admits no exceptions, and a gizmo outside the world's gamut is exactly as
 * wrong as a prop outside it.
 */
const TOOL_COLORS: Record<SculptTool, Color> = {
  raise: new Color().copy(C.grassLit),
  lower: new Color().copy(C.dirt),
  smooth: new Color().copy(C.cliffLit),
  flatten: new Color().copy(C.sand),
  noise: new Color().copy(C.rockWarm)
}
const DISARMED_COLOR = new Color().copy(C.rim)

export interface SculptSnapshot {
  tool: SculptTool | 'off'
  radius: number
  strength: number
  falloff: SculptFalloff
  /** Absolute world Y the flatten tool converges on. */
  flattenTarget: number
  tiles: number
  bytes: number
  undoDepth: number
  painting: boolean
}

export class TerrainSculptor {
  /** Root for the brush gizmo. Registered with the profiler (GDD §5.4 R10). */
  readonly group = new Group()

  /** Fired on mutation only — never per frame. The façade mirrors it into refs. */
  onStateChange: ((snapshot: SculptSnapshot) => void) | null = null

  private readonly world: World
  private readonly canvas: HTMLCanvasElement
  private readonly field: SculptField
  /** Unsculpted height on the delta lattice, memoised — see `createBaseGridCache`. */
  private readonly baseAt: (i: number, j: number) => number

  private tool: SculptTool | 'off' = 'off'
  private radius = DEFAULT_SCULPT_RADIUS
  private strength = DEFAULT_SCULPT_STRENGTH
  private falloff: SculptFalloff = 'smooth'
  private flattenTarget = 0
  private seed = 5471

  private active = false
  private painting = false
  private disposed = false

  private readonly raycaster = new Raycaster()
  /** Pointer in NDC. (0,0) — screen centre — until the mouse first moves, which
   *  is also what first-person mode leaves it at under pointer lock. */
  private readonly pointer = new Vector2()
  private readonly aimPoint = new Vector3()
  private aimValid = false

  /** World bounds touched since the last rebuild flush. */
  private pendingMinX = Number.POSITIVE_INFINITY
  private pendingMinZ = Number.POSITIVE_INFINITY
  private pendingMaxX = Number.NEGATIVE_INFINITY
  private pendingMaxZ = Number.NEGATIVE_INFINITY
  /** World bounds touched by the whole stroke. */
  private strokeMinX = Number.POSITIVE_INFINITY
  private strokeMinZ = Number.POSITIVE_INFINITY
  private strokeMaxX = Number.NEGATIVE_INFINITY
  private strokeMaxZ = Number.NEGATIVE_INFINITY

  private lastRebuildMs = 0
  private lastFrameMs = 0
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  private readonly undoStack: SculptUndoRecord[] = []

  private readonly ringMaterial: LineBasicMaterial
  private readonly outerRing: LineLoop
  private readonly innerRing: LineLoop
  private readonly outerPositions: Float32Array
  private readonly innerPositions: Float32Array
  /** Normalised radius at which the falloff has fallen to a half. */
  private halfWeightT = 0.5

  constructor(world: World) {
    this.world = world
    this.canvas = world.renderer.domElement
    this.group.name = 'terrain-sculpt'
    this.group.userData.perfTag = 'sculpt'
    world.scene.add(this.group)
    world.profiler.registerRoot(this.group, 'sculpt')

    this.field = loadField()
    // The one line that makes every existing consumer sculpt-aware: the
    // heightfield's params object is shared with `ChunkWorkerPool`, so the
    // synchronous chunk fallback picks this up too.
    world.terrain.field.params.delta = this.field
    // A params copy with the delta detached, not a flag on the live one: this
    // is what `smooth` and `flatten` measure against, and if it ever saw the
    // sculpt layer they would chase their own output and converge on nothing.
    const baseParams: HeightfieldParams = { ...world.terrain.field.params, delta: null }
    this.baseAt = createBaseGridCache((x, z) => heightAtCore(x, z, baseParams), this.field.cellSize)

    this.ringMaterial = new LineBasicMaterial({
      color: DISARMED_COLOR,
      transparent: true,
      opacity: 0.85,
      // Always visible: the brush is a cursor, and a cursor that disappears
      // behind the hill you are trying to carve is not one.
      depthTest: false,
      fog: false
    })
    this.outerPositions = new Float32Array(RING_SEGMENTS * 3)
    this.innerPositions = new Float32Array(RING_SEGMENTS * 3)
    this.outerRing = makeRing(this.outerPositions, this.ringMaterial)
    this.innerRing = makeRing(this.innerPositions, this.ringMaterial)
    this.group.add(this.outerRing, this.innerRing)
    this.group.visible = false
    this.refreshHalfWeight()

    // Only when there is something to say. A worker that never receives a patch
    // never allocates a `SculptField` and never adds a call to its inner loop,
    // so a session that opens the editor and sculpts nothing costs the chunk
    // builder exactly what it cost before this file existed.
    if (!this.field.isEmpty) {
      world.terrain.setSculptDelta(this.field.fullPatch())
    }

    window.addEventListener('pointerdown', this.onPointerDown, { capture: true })
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.onPointerUp)
    window.addEventListener('blur', this.onBlur)
    window.addEventListener('keydown', this.onKeyDown)
  }

  // ── mode ──────────────────────────────────────────────────────────────────

  setActive(on: boolean): void {
    if (this.active === on) {
      return
    }
    this.active = on
    if (!on) {
      this.endStroke()
      this.setTool('off')
    }
    this.group.visible = on && this.tool !== 'off'
  }

  isActive(): boolean {
    return this.active
  }

  setTool(tool: SculptTool | 'off'): void {
    if (this.tool === tool) {
      return
    }
    if (this.painting) {
      this.endStroke()
    }
    this.tool = tool
    this.group.visible = this.active && tool !== 'off'
    this.ringMaterial.color.copy(tool === 'off' ? DISARMED_COLOR : TOOL_COLORS[tool])
    this.emitState()
  }

  cycleTool(direction: number): void {
    const index = this.tool === 'off' ? -1 : SCULPT_TOOLS.indexOf(this.tool)
    const next = (index + direction + SCULPT_TOOLS.length + 1) % (SCULPT_TOOLS.length + 1)
    this.setTool(next === SCULPT_TOOLS.length ? 'off' : SCULPT_TOOLS[next]!)
  }

  /** Multiplicative, so one notch feels the same at 3 m and at 40 m. */
  scaleRadius(factor: number): void {
    this.setRadius(this.radius * factor)
  }

  setRadius(metres: number): void {
    const next = Math.round(Math.min(MAX_SCULPT_RADIUS, Math.max(MIN_SCULPT_RADIUS, metres)) * 10) / 10
    if (next === this.radius) {
      return
    }
    this.radius = next
    this.emitState()
  }

  setStrength(value: number): void {
    const next = Math.round(Math.min(MAX_SCULPT_STRENGTH, Math.max(MIN_SCULPT_STRENGTH, value)) * 100) / 100
    if (next === this.strength) {
      return
    }
    this.strength = next
    this.emitState()
  }

  setFalloff(curve: SculptFalloff): void {
    if (this.falloff === curve) {
      return
    }
    this.falloff = curve
    this.refreshHalfWeight()
    this.emitState()
  }

  cycleFalloff(): void {
    const index = SCULPT_FALLOFFS.indexOf(this.falloff)
    this.setFalloff(SCULPT_FALLOFFS[(index + 1) % SCULPT_FALLOFFS.length]!)
  }

  /** Pins the flatten height to the ground under the crosshair. */
  sampleFlattenTarget(): boolean {
    if (!this.aimValid) {
      return false
    }
    this.flattenTarget = Math.round(this.aimPoint.y * 1e3) / 1e3
    this.emitState()
    return true
  }

  setFlattenTarget(y: number): void {
    if (!Number.isFinite(y) || y === this.flattenTarget) {
      return
    }
    this.flattenTarget = y
    this.emitState()
  }

  snapshot(): SculptSnapshot {
    return {
      tool: this.tool,
      radius: this.radius,
      strength: this.strength,
      falloff: this.falloff,
      flattenTarget: this.flattenTarget,
      tiles: this.field.tileCount,
      bytes: this.field.byteLength,
      undoDepth: this.undoStack.length,
      painting: this.painting
    }
  }

  // ── per-frame ─────────────────────────────────────────────────────────────

  /**
   * Call once per frame. Allocation-free in the steady state: the aim march,
   * the dab and the gizmo all write into module or instance scratch.
   *
   * `delta` is derived here rather than taken as an argument so this can hang
   * off the existing `updateLevelEditor()` hook without changing its signature.
   */
  update(): void {
    if (this.disposed) {
      return
    }
    const now = performance.now()
    // Clamped like the world's own frame delta: a backgrounded tab returns a
    // multi-second gap, and a dab scaled by that would gouge a crater.
    const delta = this.lastFrameMs === 0 ? 0 : Math.min(0.05, (now - this.lastFrameMs) / 1000)
    this.lastFrameMs = now

    if (!this.active || this.tool === 'off') {
      return
    }

    this.resolveAim()
    this.updateGizmo()

    if (!this.painting || !this.aimValid || delta <= 0) {
      return
    }

    const moved = applyDab(
      this.field,
      { tool: this.tool, radius: this.radius, strength: this.strength, falloff: this.falloff, seed: this.seed },
      { x: this.aimPoint.x, z: this.aimPoint.z, dt: delta, target: this.flattenTarget },
      this.baseAt
    )
    if (!moved) {
      return
    }
    this.growBounds(this.aimPoint.x, this.aimPoint.z)

    if (now - this.lastRebuildMs >= REBUILD_INTERVAL_MS) {
      this.lastRebuildMs = now
      this.flush(false)
    }
  }

  // ── strokes ───────────────────────────────────────────────────────────────

  private beginStroke(): void {
    if (this.painting || this.tool === 'off' || !this.aimValid) {
      return
    }
    this.painting = true
    this.field.beginStroke()
    // Captured at button-down, not per dab: "flatten to the height I clicked"
    // is the only definition that lets you drag a terrace out from one point.
    if (this.tool === 'flatten') {
      this.flattenTarget = Math.round(this.aimPoint.y * 1e3) / 1e3
    }
    this.strokeMinX = Number.POSITIVE_INFINITY
    this.strokeMinZ = Number.POSITIVE_INFINITY
    this.strokeMaxX = Number.NEGATIVE_INFINITY
    this.strokeMaxZ = Number.NEGATIVE_INFINITY
    this.lastRebuildMs = performance.now()
    this.emitState()
  }

  private endStroke(): void {
    if (!this.painting) {
      return
    }
    this.painting = false
    const record = this.field.endStroke()
    if (record) {
      this.undoStack.push(record)
      if (this.undoStack.length > UNDO_DEPTH) {
        this.undoStack.shift()
      }
    }
    // The whole stroke, and with a scatter refresh this time: trees placed
    // against the old ground are now floating or buried.
    if (this.strokeMinX <= this.strokeMaxX) {
      this.pendingMinX = Math.min(this.pendingMinX, this.strokeMinX)
      this.pendingMinZ = Math.min(this.pendingMinZ, this.strokeMinZ)
      this.pendingMaxX = Math.max(this.pendingMaxX, this.strokeMaxX)
      this.pendingMaxZ = Math.max(this.pendingMaxZ, this.strokeMaxZ)
    }
    this.flush(true)
    this.scheduleSave()
    this.emitState()
  }

  /** Reverts the last stroke exactly. Returns whether there was one. */
  undo(): boolean {
    if (this.painting) {
      this.endStroke()
    }
    const record = this.undoStack.pop()
    if (!record) {
      return false
    }
    this.field.restore(record)
    this.pendingMinX = Math.min(this.pendingMinX, record.minX)
    this.pendingMinZ = Math.min(this.pendingMinZ, record.minZ)
    this.pendingMaxX = Math.max(this.pendingMaxX, record.maxX)
    this.pendingMaxZ = Math.max(this.pendingMaxZ, record.maxZ)
    this.flush(true)
    this.scheduleSave()
    this.emitState()
    return true
  }

  /** Drops every offset. Undoable as one entry. */
  clearAll(): number {
    if (this.painting) {
      this.endStroke()
    }
    const tiles = this.field.tileCount
    const record = this.field.clear()
    if (!record) {
      return 0
    }
    this.undoStack.push(record)
    if (this.undoStack.length > UNDO_DEPTH) {
      this.undoStack.shift()
    }
    this.pendingMinX = Math.min(this.pendingMinX, record.minX)
    this.pendingMinZ = Math.min(this.pendingMinZ, record.minZ)
    this.pendingMaxX = Math.max(this.pendingMaxX, record.maxX)
    this.pendingMaxZ = Math.max(this.pendingMaxZ, record.maxZ)
    this.flush(true)
    this.scheduleSave()
    this.emitState()
    return tiles
  }

  private growBounds(x: number, z: number): void {
    // A cell of margin past the brush rim: the interpolant reads the lattice
    // point *outside* the last one written, so a chunk one cell beyond the
    // footprint can still change.
    const reach = this.radius + this.field.cellSize * 2
    this.pendingMinX = Math.min(this.pendingMinX, x - reach)
    this.pendingMinZ = Math.min(this.pendingMinZ, z - reach)
    this.pendingMaxX = Math.max(this.pendingMaxX, x + reach)
    this.pendingMaxZ = Math.max(this.pendingMaxZ, z + reach)
    this.strokeMinX = Math.min(this.strokeMinX, x - reach)
    this.strokeMinZ = Math.min(this.strokeMinZ, z - reach)
    this.strokeMaxX = Math.max(this.strokeMaxX, x + reach)
    this.strokeMaxZ = Math.max(this.strokeMaxZ, z + reach)
  }

  /**
   * Ships the changed tiles and rebuilds what they touch.
   *
   * Patch **before** invalidate, always: `postMessage` is FIFO per worker, so a
   * build queued after the patch is guaranteed to see it. Reverse the two and
   * the rebuilt chunk is built from the previous offsets and the edit appears
   * to have been ignored.
   */
  private flush(rescatter: boolean): void {
    const patch = this.field.takePatch()
    if (patch) {
      this.world.terrain.setSculptDelta(patch)
    }
    if (this.pendingMinX > this.pendingMaxX) {
      return
    }
    this.world.terrain.invalidateRegion(
      this.pendingMinX,
      this.pendingMinZ,
      this.pendingMaxX,
      this.pendingMaxZ,
      rescatter
    )
    this.pendingMinX = Number.POSITIVE_INFINITY
    this.pendingMinZ = Number.POSITIVE_INFINITY
    this.pendingMaxX = Number.NEGATIVE_INFINITY
    this.pendingMaxZ = Number.NEGATIVE_INFINITY
  }

  // ── aim ───────────────────────────────────────────────────────────────────

  /**
   * Marches the heightfield rather than raycasting the chunk meshes. The chunks
   * carry all four LOD tiers at once and `Raycaster` ignores `visible`, so a
   * ray test would happily land on the LOD3 silhouette or on a skirt hanging
   * 2.5 m below the seam. The march hits the same continuous surface every tier
   * approximates — and, because `heightAt` already includes the delta, it hits
   * the ground as it is *now*, mid-stroke.
   */
  private resolveAim(): void {
    this.raycaster.setFromCamera(this.pointer, this.world.camera)
    this.raycaster.far = AIM_MAX_DISTANCE
    const { origin, direction } = this.raycaster.ray
    const terrain = this.world.terrain

    let distance = 0
    let clearance = origin.y - terrain.heightAt(origin.x, origin.z)
    if (clearance <= 0) {
      this.aimValid = true
      this.aimPoint.copy(origin)
      return
    }

    while (distance < AIM_MAX_DISTANCE) {
      const step = Math.min(Math.max(clearance * 0.6, AIM_MIN_STEP), AIM_MAX_STEP)
      const next = distance + step
      const nextClearance =
        origin.y + direction.y * next - terrain.heightAt(origin.x + direction.x * next, origin.z + direction.z * next)

      if (nextClearance <= 0) {
        let low = distance
        let high = next
        for (let i = 0; i < AIM_REFINE_STEPS; i++) {
          const mid = (low + high) * 0.5
          const gap =
            origin.y + direction.y * mid - terrain.heightAt(origin.x + direction.x * mid, origin.z + direction.z * mid)
          if (gap <= 0) {
            high = mid
          } else {
            low = mid
          }
        }
        this.aimValid = true
        this.aimPoint.copy(direction).multiplyScalar(high).add(origin)
        return
      }

      distance = next
      clearance = nextClearance
    }
    this.aimValid = false
  }

  // ── gizmo ─────────────────────────────────────────────────────────────────

  /** Where the falloff has halved. Found by scan — it runs on a setting change,
   *  never per frame, and a closed form per curve would be four more things to
   *  keep in step with `sculptFalloff`. */
  private refreshHalfWeight(): void {
    let found = 0.5
    for (let i = 1; i <= 64; i++) {
      const t = i / 64
      if (sculptFalloff(this.falloff, t) <= 0.5) {
        found = t
        break
      }
    }
    this.halfWeightT = found
  }

  private updateGizmo(): void {
    if (!this.aimValid) {
      this.group.visible = false
      return
    }
    this.group.visible = true
    writeRing(this.outerPositions, this.outerRing, this.world, this.aimPoint, this.radius)
    writeRing(this.innerPositions, this.innerRing, this.world, this.aimPoint, this.radius * this.halfWeightT)
  }

  // ── persistence ───────────────────────────────────────────────────────────

  /**
   * Debounced: a stroke ends every time the button comes up, and serialising
   * ~16 KB per touched tile on each of those would stutter a long sketching
   * session for no benefit.
   */
  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.save()
    }, SAVE_DEBOUNCE_MS)
  }

  save(): void {
    try {
      const text = serialiseSculpt(this.field)
      if (text === null) {
        localStorage.removeItem(SCULPT_STORE_KEY)
      } else {
        localStorage.setItem(SCULPT_STORE_KEY, text)
      }
    } catch {
      console.warn('[sculpt] could not persist the terrain delta (storage full or disabled)')
    }
  }

  // ── input ─────────────────────────────────────────────────────────────────

  private isCanvasEvent(event: Event): boolean {
    return event.target === this.canvas
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.active) {
      return
    }
    const rect = this.canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return
    }
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  }

  /**
   * Left button, no modifier, tool armed — anything else is somebody else's.
   *
   * Registered in the **capture** phase on `window`, which runs before
   * `OrbitCameraController`'s listener on the canvas, so `stopPropagation`
   * keeps the camera from orbiting under the brush. The prop editor's capture
   * listener is registered earlier and runs first, but it only acts on Ctrl or
   * Shift, so the two never both claim a click.
   */
  private onPointerDown = (event: PointerEvent): void => {
    if (!this.active || this.tool === 'off' || event.button !== 0 || !event.isPrimary) {
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !this.isCanvasEvent(event)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    // The aim is a frame stale at worst; resolving it here means the first dab
    // and the flatten target come from where the click actually landed.
    this.resolveAim()
    this.beginStroke()
  }

  private onPointerUp = (): void => {
    this.endStroke()
  }

  private onBlur = (): void => {
    this.endStroke()
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.active || event.ctrlKey || event.metaKey || event.altKey) {
      return
    }
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return
    }
    // `code`, not `key`: positional, so the bindings survive a non-QWERTY
    // layout exactly the way the prop editor's and the camera's do.
    switch (event.code) {
      case 'Digit1':
        this.setTool('raise')
        break
      case 'Digit2':
        this.setTool('lower')
        break
      case 'Digit3':
        this.setTool('smooth')
        break
      case 'Digit4':
        this.setTool('flatten')
        break
      case 'Digit5':
        this.setTool('noise')
        break
      case 'Digit0':
        this.setTool('off')
        break
      case 'BracketLeft':
        if (this.tool === 'off') {
          return
        }
        this.scaleRadius(1 / 1.25)
        break
      case 'BracketRight':
        if (this.tool === 'off') {
          return
        }
        this.scaleRadius(1.25)
        break
      case 'Minus':
        if (this.tool === 'off') {
          return
        }
        this.setStrength(this.strength / 1.3)
        break
      case 'Equal':
        if (this.tool === 'off') {
          return
        }
        this.setStrength(this.strength * 1.3)
        break
      case 'KeyV':
        if (this.tool === 'off') {
          return
        }
        this.cycleFalloff()
        break
      case 'KeyH':
        if (this.tool === 'off') {
          return
        }
        this.sampleFlattenTarget()
        break
      case 'KeyZ':
        if (event.repeat) {
          return
        }
        this.undo()
        break
      default:
        return
    }
    event.preventDefault()
  }

  private emitState(): void {
    this.onStateChange?.(this.snapshot())
  }

  // ── teardown ──────────────────────────────────────────────────────────────

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    if (this.painting) {
      this.field.abortStroke()
      this.painting = false
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
      this.save()
    }

    window.removeEventListener('pointerdown', this.onPointerDown, { capture: true } as EventListenerOptions)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.onPointerUp)
    window.removeEventListener('blur', this.onBlur)
    window.removeEventListener('keydown', this.onKeyDown)

    // The delta is detached but NOT cleared: the chunks still on screen were
    // built with it, and dropping it would leave the player's collision
    // disagreeing with the mesh they are standing on.
    this.outerRing.geometry.dispose()
    this.innerRing.geometry.dispose()
    this.ringMaterial.dispose()
    this.group.clear()
    this.world.scene.remove(this.group)
    this.undoStack.length = 0
    this.onStateChange = null
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

const loadField = (): SculptField => {
  try {
    return parseSculpt(typeof localStorage !== 'undefined' ? localStorage.getItem(SCULPT_STORE_KEY) : null)
  } catch {
    return new SculptField()
  }
}

const makeRing = (positions: Float32Array, material: LineBasicMaterial): LineLoop => {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  const ring = new LineLoop(geometry, material)
  ring.frustumCulled = false
  // Drawn after the world so `depthTest: false` reads as "on top" rather than
  // as "behind whatever is drawn next".
  ring.renderOrder = 900
  return ring
}

/** Re-projects a ring onto the surface. 72 `heightAt` calls, editor-only. */
const writeRing = (
  positions: Float32Array,
  ring: LineLoop,
  world: World,
  centre: Vector3,
  radius: number
): void => {
  const terrain = world.terrain
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const angle = (i / RING_SEGMENTS) * Math.PI * 2
    const x = centre.x + Math.cos(angle) * radius
    const z = centre.z + Math.sin(angle) * radius
    positions[i * 3] = x
    positions[i * 3 + 1] = terrain.heightAt(x, z) + RING_LIFT
    positions[i * 3 + 2] = z
  }
  const attribute = ring.geometry.getAttribute('position') as BufferAttribute
  attribute.needsUpdate = true
}
