import { Color, Group, Mesh, MeshBasicMaterial, Raycaster, Vector2, Vector3, type Intersection, type Object3D } from 'three'
import { C } from '../art/palette'
import type { World } from '../core/World'
import { getPlaceable } from '../level/catalog'
import type { Placement } from '../level/types'
import { DitheredLod } from '../lod/DitheredLod'

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
 * Controls (identical to dreamion):
 *
 *   Ctrl+Click / G   place the selected palette entry
 *   Shift+Click      remove the aimed placement
 *   aim + F          pick up · aim + X   delete
 *   holding: G drop · X delete · wheel rotate 1° · Q/E rotate 90°
 *   height:  Ctrl+wheel ±2 cm · Ctrl+Shift+wheel ±10 cm snapped to grid
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

export interface EditorSnapshot {
  placementCount: number
  holding: boolean
  rotationDeg: number
  /** Vertical offset above the aimed surface, in metres. */
  liftMetres: number
}

export class LevelEditor {
  /** Root for everything the editor owns. Registered with the profiler. */
  readonly group = new Group()

  /** Fired on mutation only — never per frame. The façade mirrors it into refs. */
  onStateChange: ((snapshot: EditorSnapshot) => void) | null = null

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

    for (let i = 0; i < this.list.length; i++) {
      this.list[i]!.node.update(camera)
    }

    if (!this.active) {
      return
    }

    this.held?.node.update(camera)
    this.resolveAim()

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

  /** Place the selected palette entry at the aim point. Returns its label. */
  place(): string | null {
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
    this.group.remove(entry.node)
    entry.node.dispose()
    this.held = null
    this.heldOffset = 0
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
    if (event.shiftKey && this.aimedId) {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.removeAimed()
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
        this.grabAimed()
        return
      case 'KeyX':
        if (event.repeat) {
          return
        }
        event.preventDefault()
        if (!this.deleteHeld()) {
          this.removeAimed()
        }
        return
      // Rotation repeats on purpose — holding Q spins the preview, which is
      // how you line a prop up against a slope.
      case 'KeyQ':
        event.preventDefault()
        this.rotateBy(-90)
        return
      case 'KeyE':
        event.preventDefault()
        this.rotateBy(90)
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
