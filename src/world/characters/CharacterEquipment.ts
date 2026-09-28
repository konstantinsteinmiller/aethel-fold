import {
  type Bone,
  BufferAttribute,
  BufferGeometry,
  Color,
  Euler,
  Mesh,
  type Object3D,
  Quaternion,
  SkinnedMesh,
  Vector3
} from 'three'
import { C } from '../art/palette'
import { triangleCount } from '../geometry/budget'
import { createOutlineMaterial, type OutlineMaterial } from '../shading/outlineMaterial'
import { createToonMaterial, type ToonMaterial } from '../shading/toonMaterial'
// The animation layer owns how long a draw takes and when the hand is at the
// grip; this layer only decides when to re-parent. Importing the timings rather
// than restating them is what keeps the two from drifting apart.
import { handoverTime, poseFamilyOf, transitionSeconds } from './combatPoses'
import {
  BODY_SLOTS,
  EQUIPMENT_BUDGET,
  EQUIP_SLOTS,
  GRIP_ROTATION,
  ITEM_SLOT,
  SOCKETS,
  type CharacterAppearance,
  type DrawnState,
  type EquipSlot,
  type EquipmentLoadout,
  type ItemKind,
  type SkinTone,
  type SocketName
} from './equipment'
import type { GearInstancer } from './GearInstancer'
import { canDraw, emptyLoadout, socketFor } from './inventory'
import type { BoneName } from './rig'

/**
 * ─── Hanging gear off a skeleton ────────────────────────────────────────────
 *
 * Owns two things and nothing else: **where an item's mesh is parented**, and
 * **what is currently drawn**. The pose that carries the item is the animation
 * layer's; the meshes themselves are the gear module's; the rules about what may
 * be equipped are `inventory.ts`'s. This is the joint between them.
 *
 * ── Items are parented to a bone, never skinned ─────────────────────────────
 *
 * `equipment.ts` gives the reason and it is worth repeating: a sword has no
 * business deforming, and skinning it would run it through the same joint blend
 * the body uses, so the tip would lag the hilt every time the wrist turned. The
 * mechanical consequence is just as good — a parented item costs **zero
 * per-frame CPU**: the bone matrix the skeleton already computes carries it, so
 * `update()` below touches no transform at all.
 *
 * ── What it costs, measured in the running world ────────────────────────────
 *
 * Nine items across the three demo characters, one parked camera, ablation by
 * hiding the meshes: **draw calls 133 → 163**, about 3.3 per item — a colour
 * pass, an outline hull and one or two shadow cascades. Triangles moved by less
 * than the frame-to-frame noise of the grass (nine placeholder billets are 396
 * triangles against a 168 k scene). At ≤180 draw calls (GDD §5.2) that is the
 * real ceiling on how many geared NPCs fit in a view, and it is the outline and
 * the shadow that dominate it, not the item.
 *
 * **Programs: 19 → 22, and it was worth checking rather than assuming.** The
 * first draft of this comment claimed equipment adds none, on the argument that
 * a plain mesh reuses the props' toon program. It does not: every toon program
 * in this scene is either *instanced* (all the scatter props go through
 * `InstancedLodField`) or *skinned* (the characters), so a plain non-instanced,
 * non-skinned mesh is a permutation nothing else here uses. Priced separately
 * from a clean boot: colour pass +1, shadow depth +1 (`castShadow`), outline
 * hull +1. That is **three for the whole equipment family**, paid once at the
 * first equip — not per item, per kind or per character — and the torso armour
 * below adds **zero**, because it is not a mesh at all: it is built into the
 * body. Compiling three programs mid-play is a hitch (GDD §5.2 calls shader
 * compilation the top cause of first-play jank), so `gearMaterials()` is
 * exported for a boot-time `renderer.compile` warm-up.
 *
 * ── The item's local frame (the gear module authors to this) ────────────────
 *
 * Not stated in `equipment.ts`, but every socket in it assumes one, and the
 * numbers there are what pin it down:
 *
 *   • **Origin = the grip.** The point the socket positions. For a bow, the
 *     riser; for a shield, the boss behind the centre.
 *   • **+Y is up the handle, and a blade extends −Y.** Read it off `hipR`:
 *     `rotation [0.15, 0, −0.35]` on the hips takes −Y to (−0.34, −0.94, −0.15),
 *     i.e. down, out to the character's right and slightly back — a scabbard on
 *     a belt. The same rotation applied to +Y would stand the sword up out of
 *     the waist. `backOver` confirms it independently: +0.55 about Z carries the
 *     blade down across the back to the left while the handle above the origin
 *     rises over the **right** shoulder, which is where a greatsword's grip
 *     goes.
 *   • **+Z is the item's face/front** — the shield's face, the crossbow's aim.
 *   • Hats are authored in the frame of `headTop`; torso armour in the **hips
 *     joint's** frame (y = 0 at the hips, +Y up), because neither is a
 *     hand-held object. Both match `gear/index.ts`.
 *
 * ── Torso armour replaces the torso, and here is the measurement ────────────
 *
 * It is not socketed (`STOW_SOCKET.torsoArmour` and `DRAWN_SOCKET.torsoArmour`
 * are both null) because it is a body swap. Four ways to do it, in the order
 * they were tried:
 *
 *   2. **Rigid, parented to `chest` like every other item.** Measured and
 *      rejected: at a run the chest counter-rotates 0.24 rad against the hips'
 *      −0.108 rad (`poses.ts` RUN), so the two ends of the torso twist 0.348 rad
 *      apart, and the bank adds up to 0.35 rad more at the spine. A rigid shell
 *      follows one end of that; the body under it follows both. The test skins
 *      the real torso vertices both ways over the whole run cycle and takes the
 *      worst gap: **132 mm**, on a torso whose half-width is 196 mm. No
 *      clearance hides two thirds of the body's own half-width.
 *   3. **A second `SkinnedMesh` sharing the body's skeleton, bind matrix and
 *      material.** What this file used to do, and it held: weights derived from
 *      the vertex's position along the hips→chest axis by the body's own rule
 *      keep an 8 mm clearance within **0.20 mm** of 8 mm over the whole run
 *      cycle. What it could not do is remove the torso underneath — **96 of the
 *      body's 692 triangles** were drawn buried — and it cost a second draw
 *      call, a second inverted hull and a second shadow draw.
 *   3b. **Keep the overlay but skip the torso with `geometry.drawRange`.** The
 *      torso is the first part emitted, so its 96 triangles are a contiguous
 *      index prefix (asserted in `equipment.test.ts`) and one `drawRange` on the
 *      body and one on the hull excludes both. Free — no rebuild at all — and it
 *      recovers the buried triangles. Rejected on the resource that is actually
 *      scarce. Measured in the running creation screen: the merged figure draws
 *      in **6 calls**, and putting the armour back as a second `SkinnedMesh`
 *      with its own hull takes it to **8** — `drawRange` changes what a mesh
 *      draws, never how many meshes there are, so it keeps every one of those.
 *      GDD §5.2 caps the scene at 180 draws and this file measures equipment at
 *      ~3.3 draws per item, so `drawRange` spends most of an item's budget, per
 *      armoured character, to save a rebuild that happens on a click.
 *
 *      It is also the more fragile of the two, in three specific ways.
 *      `drawRange` lives on the **geometry**, and the body and the hull are now
 *      *separate* geometries that share attribute buffers and own only their own
 *      index — so it has to be set twice and the two are free to disagree. It
 *      does not survive `CreatorScene`'s appearance rebuild, which hands the
 *      meshes brand-new geometries with a default range. And it encodes "the
 *      torso is the first part" as a live invariant of the *rendering* path
 *      rather than of a test, so reordering `parts()` would draw a hole in the
 *      figure with nothing to catch it. None of those apply to a mesh that was
 *      simply never built.
 *   1. **Rebuild the merged body with an armoured torso part** — what this does
 *      now. `buildChibiGeometry(budget, name, appearance, torsoGarment)` does not
 *      emit the torso `PartSpec` at all and appends the garment in its place,
 *      weighted by `torsoChestWeight` — literally the rule the torso used,
 *      imported rather than restated. The host is asked to rebuild via
 *      `EquipmentHost.rebuildBody`.
 *
 * Measured in Chrome over 40 equip/unequip cycles: a rebuild costs **1.4 ms
 * median, 3.1 ms worst** — the creation screen's own per-click figure, because it
 * is the same call. Equipping is not a per-frame path.
 *
 * It also generalises, which the alternative does not. A profession outfit — a
 * robe, an apron, a tabard — is the same substitution: a builder in `gear/`, a
 * row in `EQUIPMENT_BUDGET`, `ITEM_SLOT[kind] = 'torso'`, and it arrives with no
 * socket and lands here. Every such garment costs its wearer **zero** draw calls;
 * under `drawRange` each one would cost two, per character wearing it.
 *
 * ── What removing the torso put at risk, and what closed it ─────────────────
 *
 * With an overlay the body underneath covered any gap in the armour's coverage.
 * Once the torso is gone a gap is a hole straight through the character, so the
 * armour had to be re-authored to close against the neck above it and the two
 * thighs below it. That work is in `gear/torsoArmour.ts` and the seam is
 * measured over the full run and jump cycles in `equipment.test.ts` — not
 * eyeballed, and not only in bind pose.
 */

// ─── Item geometry: a registry, not an import ───────────────────────────────

/**
 * What the wearer contributes to the mesh they are about to wear.
 *
 * See `GearOptions` in `gear/index.ts` for what each field does to a model. It
 * is restated as its own type here rather than imported because the whole point
 * of the registry is that this file does not know `gear/` exists.
 */
export interface ItemVariant {
  seed: number
  skinTone: SkinTone
}

/** What every character wears when nobody has said otherwise. */
export const DEFAULT_VARIANT: ItemVariant = { seed: 1, skinTone: 1 }

/**
 * The variant a character's appearance implies.
 *
 * Both fields already exist on `CharacterAppearance` and this is the one place
 * that reads them as a pair, so the two callers — the creation screen and
 * `Character.setAppearance` — cannot disagree about which is which. A fresh
 * object each time: `setVariant` stores a copy, and handing it a live appearance
 * would be a proxy from Vue reaching into `src/world/` (GDD §0).
 */
export const variantOf = (appearance: CharacterAppearance): ItemVariant => ({
  seed: appearance.gearSeed,
  skinTone: appearance.skinTone
})

export type ItemGeometryFactory = (variant: ItemVariant) => BufferGeometry

const factories = new Map<ItemKind, ItemGeometryFactory>()
const warned = new Set<ItemKind>()
/**
 * Geometries this layer has already budget-checked.
 *
 * A `WeakSet` rather than a keyed cache, because **the factory owns the
 * caching now**. It has to: whether two variants of a kind are the same mesh is
 * a fact about the model — a sword ignores `skinTone`, a rolled trouser does
 * not — and a cache here would have to duplicate that knowledge or waste vertex
 * buffers guessing. So the registry asks for a variant every time and the gear
 * module hands back the same object whenever it can; this only remembers which
 * distinct objects have already been through the budget check.
 */
const checked = new WeakSet<BufferGeometry>()

/**
 * Hands this layer the mesh for an item kind.
 *
 * A registry rather than a direct import so the gear module and this one can be
 * written against `equipment.ts` alone, in either order, without either
 * importing the other. The factory is handed the wearer's `ItemVariant` and is
 * expected to **share** the result between wearers who ask for the same one —
 * the same argument as instancing, minus the instancing: two dozen villagers in
 * the same colourway of the same jerkin upload one jerkin.
 */
export const registerItemGeometry = (kind: ItemKind, build: ItemGeometryFactory): void => {
  factories.set(kind, build)
}

/** Forgets which geometries have been budget-checked. For teardown and tests. */
export const disposeGearCache = (): void => {
  warned.clear()
}

const geometryFor = (kind: ItemKind, variant: ItemVariant): BufferGeometry => {
  const factory = factories.get(kind)
  const geometry = factory ? factory(variant) : placeholderGeometry(kind)
  if (!factory && !warned.has(kind)) {
    warned.add(kind)
    if (import.meta.env.DEV) {
      console.warn(`[equipment] no mesh registered for "${kind}" — using the placeholder billet`)
    }
  }
  if (checked.has(geometry)) {
    return geometry
  }
  checked.add(geometry)
  // The budget is checked here rather than left to the gear module, because
  // this is the one place that sees every kind. Not routed through
  // `assertTriBudget`: that writes a row into the perf panel's ledger, and the
  // generator that built the mesh has already written its own.
  const tris = triangleCount(geometry)
  if (tris > EQUIPMENT_BUDGET[kind]) {
    const message = `[equipment] ${kind} is ${tris} tris, budget is ${EQUIPMENT_BUDGET[kind]} (GDD §4.1)`
    if (import.meta.env.DEV) {
      throw new Error(message)
    }
    console.warn(message)
  }
  return geometry
}

// ─── Materials ─────────────────────────────────────────────────────────────

let gearMaterial: ToonMaterial | null = null
let gearOutline: OutlineMaterial | null = null

/**
 * One toon material and one outline for all gear on all characters.
 *
 * **Created lazily, and that is load-bearing.** `ToonMaterial`'s constructor
 * enrols itself with the cascaded-shadow rig, which does not exist until the
 * world builds its lighting. A module-level `createToonMaterial()` would run at
 * import time, miss the enrolment, and end up with different `CSM_CASCADES`
 * defines from every other toon material in the scene — which is both a second
 * compiled program and, worse, gear lit only by the hemisphere fill while the
 * body it hangs off is lit by the sun (see `core/shadows.ts`).
 */
const materials = (): { toon: ToonMaterial; outline: OutlineMaterial } => {
  if (!gearMaterial) {
    // No wind: gear is rigid. Sharing the props' settings is what keeps this on
    // the props' program rather than forking one for the character family.
    gearMaterial = createToonMaterial({ wind: false, name: 'gear' })
  }
  if (!gearOutline) {
    gearOutline = createOutlineMaterial({ pixelWidth: 1.6, wind: false, name: 'gear-outline' })
  }
  return { toon: gearMaterial, outline: gearOutline }
}

/**
 * The two shared materials, built if they do not exist yet.
 *
 * Exported for a boot-time warm-up: they compile three programs between them
 * (see the header), and compiling those the first time a player equips anything
 * is a visible hitch. A caller that has a renderer can put a hidden mesh of each
 * in the scene and `renderer.compile()` it while the loading screen is up.
 */
export const gearMaterials = (): { toon: ToonMaterial; outline: OutlineMaterial } => materials()

/** Drops the shared materials. Teardown and tests. */
export const disposeGearMaterials = (): void => {
  gearMaterial?.dispose()
  gearOutline?.dispose()
  gearMaterial = null
  gearOutline = null
}

// ─── The attachment layer ──────────────────────────────────────────────────

/**
 * What this needs from a character.
 *
 * Structural rather than `Character` itself, for three reasons: `Character.ts`
 * would otherwise have to import this file to be its type, which is a cycle for
 * no gain; a test can drive the whole state machine off a bare skeleton without
 * building a body; and a monster rig that is not a `Character` gets to wear
 * gear by exposing three members. `Character` satisfies it with one added
 * method — see the `bone()` hook there.
 */
/** One worn garment: its mesh, and the kind it is, which the mesh cannot say. */
export interface WornGarment {
  kind: ItemKind
  geometry: BufferGeometry
}

/**
 * Everything currently built *into* the body rather than hung off it.
 *
 * `head` is the odd one out and is here anyway. A hat is a perfectly ordinary
 * socketed attachment — it is not built into the body and this layer still owns
 * its mesh — but the **hair** is body geometry, and hair that is not told there
 * is a hat above it grows straight through the crown: measured at 81 mm for a
 * topknot through the straw hat, 235 mm for a ponytail through a hood. The body
 * builder is the only place that can clip one against the other, so it is handed
 * the shape to clip against. Nothing else about the hat comes through here.
 */
export interface BodyGarments {
  torso: WornGarment | null
  legs: WornGarment | null
  /** The worn headwear's mesh, for clipping hair only. Not a substitution. */
  head: BufferGeometry | null
}

export interface EquipmentHost {
  /** The bone a socket names, or null if this rig does not have it. */
  bone(name: BoneName): Bone | null
  /** Where a parented item's scene object may be added. */
  readonly group: Object3D
  /** The skinned body. Its skeleton, bind matrix and material are shared. */
  readonly body: SkinnedMesh
  /**
   * Registers this equipment as the host's combat-pose state, if the host has
   * arms that react to it. Optional: a monster rig or a bare skeleton simply
   * does not carry, and gets no pose layer.
   */
  setCombatSource?(source: CharacterEquipment | null): void
  /**
   * Rebuilds the body around whatever is currently worn **in place of** part of
   * it, or with its own parts again where a slot is empty.
   *
   * Optional, and that is deliberate: the other four members are satisfied by a
   * bare `SkinnedMesh` on a skeleton, which is what lets a monster rig — or a
   * test with no body at all — wear a sword. A host that cannot rebuild its own
   * geometry simply does not get garments, and says so once in DEV rather than
   * rendering a shell with a tunic inside it.
   *
   * ── Why this takes a whole `BodyGarments` and not one geometry ─────────────
   *
   * It used to take `armour: BufferGeometry | null`, from the days when the
   * torso was the only body slot. `legs` then arrived as a second one and, since
   * `socketFor` returns null for a leg garment exactly as it does for a torso
   * one, both landed on the same single-argument hook — so **putting on trousers
   * removed the cuirass**, and taking either off restored both. There is no
   * version of a one-geometry hook that does not have that bug, because the host
   * has to be told the whole state of the body every time: a rebuild is a
   * rebuild of *all* of it.
   *
   * Each geometry arrives in the **hips-joint frame** (`gear/index.ts`) and
   * unskinned; the host hands them to `buildChibiGeometry`, which owns both the
   * translation into bind-pose world space and the weights.
   */
  rebuildBody?(garments: BodyGarments): void
  /**
   * Swaps a closed fist into the body for each hand that is gripping something.
   *
   * Optional for the same reason `rebuildBody` is: a bare `SkinnedMesh` on a
   * skeleton, or a monster rig, satisfies the rest of this interface and simply
   * does not get hands that close. **Both sides in one call**, because each one
   * is a rebuild of the whole merged geometry and a two-handed weapon would
   * otherwise pay for two.
   */
  setFists?(left: boolean, right: boolean): void
}

export interface CharacterEquipmentOptions {
  /**
   * Seconds a draw or stow takes end to end.
   *
   * Owned here only so the re-parent lands in the middle of the animation
   * layer's clip; set it to that clip's length.
   */
  drawDuration?: number
  /**
   * Where in that window the item changes socket, 0→1. Default 0.45 — about
   * where a hand reaches the hilt.
   */
  handoff?: number
  outline?: boolean
  /**
   * Whether gear casts into the shadow map.
   *
   * Its own switch because it is its own program: measured, `castShadow` on a
   * plain gear mesh compiles a depth permutation the scene has no other use for
   * (see the header). Worth it on the hero, arguably not on the fortieth
   * villager, and a caller that wants neither shadow nor outline pays one
   * program for the whole family instead of three.
   */
  castShadow?: boolean
  /**
   * Which colourway this wearer's clothing is cut from. Defaults to
   * `DEFAULT_VARIANT`, which is what every wardrobe sheet and test was authored
   * against. Changeable afterwards through `setVariant`.
   */
  variant?: ItemVariant
  /**
   * A shared batcher for socketed gear.
   *
   * With one, this character's hats and weapons are drawn by
   * `GearInstancer` — **two draws for every wearer of a given item put
   * together** instead of two each. Without one, each item is its own mesh and
   * its own hull, which is right for a hero standing alone on a creation screen
   * and wrong for a market square. See `GearInstancer` for the measurement.
   *
   * Body-slot garments are unaffected either way: they are substituted into the
   * merged body geometry and were never a draw call to begin with.
   */
  instancer?: GearInstancer | null
}

/**
 * Scratch for composing a socket's rotation with the item's grip. Module level
 * because `place()` runs on every equip and every handover, and the project bans
 * allocation on any path that can run mid-frame (GDD §5).
 */
const _socketEuler = new Euler()
const _gripEuler = new Euler()
const _socketQuaternion = new Quaternion()
const _gripQuaternion = new Quaternion()

interface Attachment {
  kind: ItemKind
  /**
   * The item's scene object — **null for torso armour**, which has no scene
   * object of its own: it is triangles inside the body's geometry.
   */
  object: Mesh | null
  outline: Mesh | null
  /** Where it is parented right now. Null for torso armour. */
  socket: SocketName | null
  /**
   * Handle into the shared `GearInstancer`, or 0 when this character draws its
   * own gear.
   *
   * Zero rather than null so the release path is a plain truthiness check —
   * handles are minted from 1.
   */
  instance: number
}

export class CharacterEquipment {
  /**
   * Called the instant a draw or stow is requested, before anything moves.
   *
   * The animation layer's entry point: it gets `from` and `to` as primitives
   * (no object, so no per-frame allocation if it is ever called from an update
   * path) and owns the pose for the next `drawDuration` seconds. This layer
   * only re-parents, and only at `handoff`.
   */
  onDrawChange: ((from: DrawnState, to: DrawnState) => void) | null = null

  drawDuration: number
  handoff: number
  /**
   * The timings actually in flight, resolved per transition from `combatPoses`.
   *
   * `drawDuration` / `handoff` above are the fallbacks, and the first pass used
   * them for everything — one 0.45 s clip with the swap at 45 %. Measured against
   * the real animation that is wrong for every weapon: a sword draws in 0.78 s
   * and sheathes in 0.95, a greatsword in 1.9 / 2.15, and the hand reaches the
   * grip at 0.39 of a sword draw but 0.34 of the three over-shoulder ones. A
   * fixed pair either reparents while the hand is still travelling — the sword
   * teleports into the fist — or leaves it gripping air.
   */
  private activeDuration: number
  private activeHandoff: number
  /**
   * True when the caller pinned the timing at construction.
   *
   * The derived clip lengths are what production wants — nobody calling
   * `setDrawn` from a game knows or should know that a greatsword takes 1.9 s.
   * But `drawDuration: 0` is a documented escape hatch meaning "no transition"
   * (a load, a respawn, a test), and a caller who names a number has by
   * definition overridden the animation. So an explicit option wins for the life
   * of the object, and the public fields stay live for runtime tuning.
   */
  private readonly pinnedTiming: boolean

  private readonly host: EquipmentHost
  private readonly outlineEnabled: boolean
  private readonly shadowEnabled: boolean
  private readonly attachments = new Map<EquipSlot, Attachment>()
  /** Which hands are currently built closed. Mutated in place; never reallocated. */
  private readonly fists = { L: false, R: false }
  private readonly current: EquipmentLoadout = emptyLoadout()
  private from: DrawnState = 'sheathed'
  /** 1 when settled. Below 1 a draw or stow is in flight. */
  private progress = 1
  private swapped = true
  /** This wearer's colourway. Mutated only through `setVariant`. */
  private variant: ItemVariant = { ...DEFAULT_VARIANT }
  /** Shared batcher for socketed gear, or null when this draws its own. */
  private readonly instancer: GearInstancer | null
  /** Set while a batch of `equip` calls is in flight — see `setLoadout`. */
  private deferBody = false
  private bodyDirty = false

  constructor(host: EquipmentHost, options: CharacterEquipmentOptions = {}) {
    const {
      drawDuration = 0.45,
      handoff = 0.45,
      outline = true,
      castShadow = true,
      variant,
      instancer = null
    } = options
    this.instancer = instancer
    if (variant) {
      this.variant = { seed: variant.seed, skinTone: variant.skinTone }
    }
    this.pinnedTiming = options.drawDuration !== undefined || options.handoff !== undefined
    this.host = host
    this.drawDuration = drawDuration
    this.handoff = handoff
    this.activeDuration = drawDuration
    this.activeHandoff = handoff
    this.outlineEnabled = outline
    // Without this the carry, draw and shield poses have no caller and the arms
    // keep swinging as if empty-handed.
    host.setCombatSource?.(this)
    this.shadowEnabled = castShadow
  }

  // ── State ────────────────────────────────────────────────────────────────

  /** The state being drawn *to*. During a transition this is the destination. */
  get drawn(): DrawnState {
    return this.current.drawn
  }

  /** Where the transition started. Equal to `drawn` when settled. */
  get drawnFrom(): DrawnState {
    return this.from
  }

  /** 0→1 across the transition, 1 when settled. The animation layer reads this. */
  get drawProgress(): number {
    return this.progress
  }

  get drawing(): boolean {
    return this.progress < 1
  }

  /**
   * The state the *meshes* are currently parented for.
   *
   * Not the same as `drawn` mid-transition: the sword is still on the hip until
   * the hand reaches it. Exposed because an animation that wants to know whether
   * the hand is already carrying something has to ask this, not `drawn`.
   */
  get effectiveDrawn(): DrawnState {
    return this.swapped ? this.current.drawn : this.from
  }

  itemAt(slot: EquipSlot): ItemKind | null {
    return this.current[slot]
  }

  /** Where the item in `slot` is parented right now. Allocation-free. */
  socketAt(slot: EquipSlot): SocketName | null {
    return this.attachments.get(slot)?.socket ?? null
  }

  /**
   * The item's scene object, for a caller that needs to measure or highlight it.
   *
   * **Null for torso armour even when it is equipped** — there is no object; the
   * armour is part of `host.body`'s geometry. Ask `itemAt('torso')` for whether
   * it is worn.
   */
  objectAt(slot: EquipSlot): Object3D | null {
    return this.attachments.get(slot)?.object ?? null
  }

  /**
   * A copy of the loadout.
   *
   * **Allocates.** For the UI and for saving, never for an update path — the
   * per-frame questions have their own accessors above.
   */
  loadout(): EquipmentLoadout {
    return { ...this.current }
  }

  // ── Mutation ─────────────────────────────────────────────────────────────

  /**
   * Puts an item in a slot, or empties it with `null`.
   *
   * An item that `ITEM_SLOT` does not allow in that slot is ignored: the slot is
   * a *role*, and a sword in the `back` slot would resolve to a socket that
   * makes no sense for it. Callers that need to know why should ask
   * `inventory.ts::equipFault` first.
   */
  equip(slot: EquipSlot, kind: ItemKind | null): void {
    if (kind !== null && ITEM_SLOT[kind] !== slot) {
      if (import.meta.env.DEV) {
        console.warn(`[equipment] "${kind}" cannot go in the ${slot} slot — it belongs in ${ITEM_SLOT[kind]}`)
      }
      return
    }
    if (this.current[slot] === kind) {
      return
    }

    this.detach(slot)
    this.current[slot] = kind

    // Losing the weapon a drawn state depends on settles it immediately rather
    // than transitioning: there is nothing left to animate putting away.
    if (!canDraw(this.current, this.current.drawn)) {
      const previous = this.current.drawn
      this.current.drawn = 'sheathed'
      this.from = 'sheathed'
      this.progress = 1
      this.swapped = true
      this.onDrawChange?.(previous, 'sheathed')
      this.resocket()
    }

    if (kind !== null) {
      this.attach(slot, kind)
    }
    // ── The one place the body is rebuilt, and why it is here ────────────────
    //
    // Not in `attach`/`detach`, which is where it used to be and which cannot
    // work: `detach` runs *before* `current[slot]` is updated, so a rebuild
    // fired from there reads the garment that is being taken off as still worn.
    // Removing a robe rebuilt the body wearing the robe, and then nothing
    // rebuilt again — so it never came off.
    //
    // Three slots reach the body, and only two are obvious. `torso` and `legs`
    // are substitutions with no socket. `head` is an ordinary parented mesh —
    // but the hair underneath it is body geometry, and it has to be clipped
    // against whatever is now above it. Emptying that slot is equally a rebuild,
    // or the hair stays clipped to a hat that is no longer there.
    if (slot === 'torso' || slot === 'legs' || slot === 'head') {
      this.rebuildBody()
    }
    // A shield arriving in — or leaving — the off hand changes whether that hand
    // is a fist, without changing a socket, so `resocket` above cannot see it.
    this.updateFists()
  }

  /**
   * Starts a draw or a stow.
   *
   * Illegal requests are **ignored**, not thrown: the caller is usually a click
   * on a panel rendered a frame before the loadout changed under it. Ask
   * `inventory.ts::drawFault` for the reason.
   */
  setDrawn(state: DrawnState): void {
    if (state === this.current.drawn || !canDraw(this.current, state)) {
      return
    }
    const previous = this.current.drawn
    this.from = previous
    this.current.drawn = state
    this.resolveTiming(previous, state)
    if (this.activeDuration <= 0) {
      this.progress = 1
      this.swapped = true
      this.resocket()
    } else {
      this.progress = 0
      this.swapped = false
    }
    this.onDrawChange?.(previous, state)
  }

  /**
   * Applies a whole loadout at once — a load, a creation-screen "apply", a
   * respawn.
   *
   * Immediate by construction: no transition, because nothing was drawn *from*.
   * Animating a load produces a character who spends half a second sheathing a
   * sword they were never holding.
   */
  setLoadout(loadout: EquipmentLoadout): void {
    // Three of these slots each want a body rebuild, and a rebuild is ~1.4 ms of
    // merging the whole figure. Applying a full outfit one slot at a time would
    // pay for it three times — 4 ms per character, 0.4 s to dress a hundred
    // NPCs — for three intermediate figures nobody ever sees. So they are
    // collapsed into one.
    this.deferBody = true
    try {
      for (const slot of EQUIP_SLOTS) {
        this.equip(slot, loadout[slot])
      }
    } finally {
      this.deferBody = false
    }
    if (this.bodyDirty) {
      this.bodyDirty = false
      this.rebuildBody()
    }
    const target = canDraw(this.current, loadout.drawn) ? loadout.drawn : 'sheathed'
    this.current.drawn = target
    this.from = target
    this.progress = 1
    this.swapped = true
    this.resocket()
  }

  /**
   * Which colourway this wearer's clothing is cut from, and what skin shows
   * through it.
   *
   * Changing it re-fetches every worn mesh: the attachments are re-pointed at
   * the new variant's geometry and the body is rebuilt around it. Cheap when
   * nothing is worn, and it is only called when a character's appearance
   * changes, never per frame.
   */
  setVariant(variant: ItemVariant): void {
    if (variant.seed === this.variant.seed && variant.skinTone === this.variant.skinTone) {
      return
    }
    this.variant = { seed: variant.seed, skinTone: variant.skinTone }
    let body = false
    for (const slot of EQUIP_SLOTS) {
      const attachment = this.attachments.get(slot)
      if (!attachment) {
        continue
      }
      if (attachment.object === null) {
        body = true
        continue
      }
      const geometry = geometryFor(attachment.kind, this.variant)
      attachment.object.geometry = geometry
      if (attachment.outline) {
        attachment.outline.geometry = geometry
      }
      if (attachment.instance) {
        // A batch is keyed by geometry, so a re-pointed item belongs to a
        // *different* batch. Re-registering is the whole move — without it the
        // instancer keeps drawing the old colourway at the new wearer's
        // position, which reads as the variant change silently not working.
        this.instancer?.release(attachment.instance)
        attachment.instance = this.instancer?.register(attachment.object) ?? 0
      }
      // A hat's own mesh is re-pointed above, but the hair clipped against it
      // is body geometry and has to be rebuilt with it.
      if (slot === 'head') {
        body = true
      }
    }
    if (body) {
      this.rebuildBody()
    }
  }

  /** A copy — the caller may be a UI and must not hold this object. */
  getVariant(): ItemVariant {
    return { ...this.variant }
  }

  /**
   * Advances the draw/stow clock, and re-parents at the handoff.
   *
   * This is the *only* per-frame work equipment does, and when nothing is in
   * flight it is one comparison. There is deliberately no transform update here:
   * an item is a child of a bone, so the skeleton's own matrix pass carries it
   * for free — writing a position every frame would be strictly worse and would
   * fight the pose.
   */
  update(dt: number): void {
    if (this.progress >= 1 || dt <= 0) {
      return
    }
    this.progress += dt / this.activeDuration
    if (this.progress > 1) {
      this.progress = 1
    }
    if (!this.swapped && this.progress >= this.activeHandoff) {
      this.swapped = true
      this.resocket()
    }
  }

  /**
   * Picks the clip length and swap point for the transition about to run.
   *
   * The kind comes from the loadout rather than from the state name, because
   * `DrawnState` says *how* the character is holding something, not *what*:
   * `twoHand`, `bow` and `crossbow` all draw from the back slot, and `mainHand`
   * from the main hand. A state that names no drawable — or a kind the animation
   * has no clip for — falls back to the constructor's fixed pair.
   */
  private resolveTiming(previous: DrawnState, next: DrawnState): void {
    if (this.pinnedTiming) {
      this.activeDuration = this.drawDuration
      this.activeHandoff = this.handoff
      return
    }
    const drawing = previous === 'sheathed'
    const active = drawing ? next : previous
    const kind = active === 'mainHand' ? this.current.mainHand : this.current.back
    // The *pose family*, not the kind. A war axe has no clip of its own and does
    // not need one — it comes off the back on the greatsword's timing, which is
    // the same 2.15 s of blind reach behind the shoulder. See `POSE_FAMILY`.
    const drawable = kind === null ? null : poseFamilyOf(kind)
    if (drawable === null) {
      this.activeDuration = this.drawDuration
      this.activeHandoff = this.handoff
      return
    }
    const direction = drawing ? 'draw' : 'sheathe'
    this.activeDuration = transitionSeconds(drawable, direction)
    this.activeHandoff = handoverTime(drawable, direction)
  }

  dispose(): void {
    this.host.setCombatSource?.(null)
    for (const slot of EQUIP_SLOTS) {
      this.detach(slot)
      this.current[slot] = null
    }
    this.attachments.clear()
    // The host outlives this: disposing the equipment gives the character their
    // own torso, legs and untucked hair back. **After `current` is emptied**,
    // because that is what the rebuild reads — clearing it afterwards would
    // rebuild the figure still wearing everything it had just taken off, which
    // is exactly the shape of the bug that made `rebuildBody` take the whole
    // state instead of one slot.
    this.rebuildBody()
    this.onDrawChange = null
  }

  // ── Scene work ───────────────────────────────────────────────────────────

  private attach(slot: EquipSlot, kind: ItemKind): void {
    const socket = socketFor(this.current, slot, this.effectiveDrawn)
    const geometry = geometryFor(kind, this.variant)

    if (socket === null) {
      // No socket: a body swap — a torso garment or a leg garment. It gets no
      // scene object at all; the host builds it into the body's own geometry,
      // which is what removes the part underneath it, the second draw call, the
      // second hull and the second shadow draw all at once.
      //
      // **Before `materials()`**, deliberately: that call compiles the three
      // programs of the gear family (see the header), and a character wearing
      // nothing but a cuirass has no gear mesh to put them on.
      //
      // The rebuild itself is `equip`'s — see the note there.
      this.attachments.set(slot, { kind, object: null, outline: null, socket: null, instance: 0 })
      return
    }

    const { toon, outline } = materials()
    const object = new Mesh(geometry, toon)
    object.name = `gear/${kind}`
    object.castShadow = this.shadowEnabled
    object.receiveShadow = true

    let hull: Mesh | null = null
    let instance = 0
    if (this.instancer) {
      // Batched. The object stays parented to its bone and keeps every bit of
      // the socket and grip logic — it is hidden, and the instancer copies its
      // world matrix. **No hull is built**: the batch draws its own, once for
      // every wearer of this item together.
      instance = this.instancer.register(object)
    } else if (this.outlineEnabled) {
      // A child of the item, so the socket transform is written once. The hull
      // never casts: it is a shell a few pixels outside the item, so its shadow
      // would fight the item's own along every silhouette edge.
      hull = new Mesh(geometry, outline)
      hull.name = `gear/${kind}/outline`
      hull.castShadow = false
      hull.receiveShadow = false
      object.add(hull)
    }

    this.attachments.set(slot, { kind, object, outline: hull, socket, instance })
    this.place(slot, socket)
  }

  /**
   * Asks the host to rebuild its body around everything currently worn into it.
   *
   * The one place this layer does *not* own the mesh it equips. It cannot: a
   * garment is not an object hung off a bone, it is part of a merged skinned
   * geometry, and merging is `chibiGeometry.ts`'s job. So the hook is the whole
   * of the interface — hand over unskinned, hips-framed geometry and let the body
   * builder place, weight and budget it.
   *
   * **Always the full state, never a delta.** See `rebuildBody` on
   * `EquipmentHost` for the bug that came of sending one slot at a time.
   */
  private rebuildBody(): void {
    if (this.deferBody) {
      this.bodyDirty = true
      return
    }
    if (!this.host.rebuildBody) {
      if (import.meta.env.DEV && BODY_SLOTS.some(slot => this.current[slot] !== null)) {
        console.warn('[equipment] this host cannot rebuild its body, so garments are not worn')
      }
      return
    }
    this.host.rebuildBody(this.bodyGarments())
  }

  /**
   * What is built into the body right now.
   *
   * Read off `current` rather than off `attachments`, so it is correct while a
   * slot is mid-swap — `equip` detaches before it attaches, and a snapshot taken
   * from the attachment map in between would be missing the slot that is about
   * to be filled.
   */
  private bodyGarments(): BodyGarments {
    const worn = (slot: EquipSlot): WornGarment | null => {
      const kind = this.current[slot]
      return kind === null ? null : { kind, geometry: geometryFor(kind, this.variant) }
    }
    const head = this.current.head
    return {
      torso: worn('torso'),
      legs: worn('legs'),
      // Only the mesh: the body builder clips hair against it and does not own
      // it. A head slot that is empty leaves hair exactly as it was authored.
      head: head === null ? null : geometryFor(head, this.variant)
    }
  }

  /** Parents an attachment to its socket's bone and offsets it there. */
  private place(slot: EquipSlot, socket: SocketName | null): void {
    const attachment = this.attachments.get(slot)
    if (!attachment) {
      return
    }
    attachment.socket = socket

    if (socket === null || !attachment.object) {
      return
    }

    const definition = SOCKETS[socket]
    const bone = this.host.bone(definition.bone)
    if (!bone) {
      if (import.meta.env.DEV) {
        console.warn(`[equipment] rig has no bone "${definition.bone}" for socket "${socket}"`)
      }
      return
    }
    // Under the **bone**, not under the character's group: a child of the group
    // stands in the bind pose while the character walks out from under it.
    bone.add(attachment.object)
    attachment.object.position.set(definition.position[0], definition.position[1], definition.position[2])
    // ── The grip rotation, and why only in a hand ────────────────────────────
    //
    // `GRIP_ROTATION` is a property of the *item in a fist*: how a sword sits
    // between the fingers. The stow sockets are the opposite — `hipR`,
    // `backOver` and `backFlat` are frozen numbers searched against the item's
    // own −Y frame (`equipment.ts` records the 324-combination search that set
    // `hipR`), and turning a sheathed sword a quarter turn about X would stand
    // it out of its scabbard sideways and throw away the +8.3 mm of hilt
    // clearance that search bought. So the grip applies where a hand is holding
    // the thing and nowhere else.
    //
    // Composed as quaternions rather than added as Eulers: two XYZ Eulers do not
    // add, and both of these are quarter turns about different axes.
    if (socket === 'handR' || socket === 'handL') {
      const grip = GRIP_ROTATION[attachment.kind]
      _socketEuler.set(definition.rotation[0], definition.rotation[1], definition.rotation[2], 'XYZ')
      _socketQuaternion.setFromEuler(_socketEuler)
      _gripEuler.set(grip[0], grip[1], grip[2], 'XYZ')
      _gripQuaternion.setFromEuler(_gripEuler)
      attachment.object.quaternion.copy(_socketQuaternion).multiply(_gripQuaternion)
      return
    }
    attachment.object.rotation.set(definition.rotation[0], definition.rotation[1], definition.rotation[2])
  }

  /** Re-parents every attachment whose socket the current condition changed. */
  private resocket(): void {
    const drawn = this.effectiveDrawn
    for (let i = 0; i < EQUIP_SLOTS.length; i++) {
      const slot = EQUIP_SLOTS[i]!
      const attachment = this.attachments.get(slot)
      if (!attachment) {
        continue
      }
      const socket = socketFor(this.current, slot, drawn)
      if (socket === attachment.socket) {
        continue
      }
      attachment.object?.removeFromParent()
      this.place(slot, socket)
    }
    this.updateFists()
  }

  /**
   * Closes or opens each fist to match what is currently *in* it.
   *
   * ── Why this is a body rebuild and not a pose ───────────────────────────────
   *
   * The hand has **no finger bones** — `chibiGeometry.ts` weights the fingers and
   * the thumb 1.0 to `hand` with `blendToParent: false`, precisely so a fingertip
   * does not follow the wrist through half of every wrist turn. Nothing about the
   * skeleton can curl them, so a closed fist is a different *shape*, swapped into
   * the merged mesh exactly the way a torso or a leg garment is.
   *
   * ── Which hands close, and why it is not simply "both" ─────────────────────
   *
   * A fist closes around the hand's own grip axis (hand-local Z, the axis
   * `GRIP_ROTATION` puts a handle on), so a hand only closes when what it holds
   * actually lies along it:
   *
   *   * **sword** — right closes; the left is empty or on a shield.
   *   * **greatsword** — both close: `linkOffHand` gives the support hand the
   *     leading hand's own orientation, so the same haft runs down both bores.
   *   * **bow** — the bow hand closes on the riser; the draw hand is empty and
   *     only touches the string, so it stays open.
   *   * **crossbow** — neither. The tiller lies *along* the forearm in
   *     `CROSSBOW_MAIN` (identity grip, held like a torch), so it crosses no
   *     bore, and the support hand cups the fore-end from underneath.
   *   * **a shield** keeps its hand open whatever else is drawn: it is strapped
   *     to the forearm rather than gripped, and the fingers lie on a strap.
   *
   * Only called on a change: a rebuild is 1.4 ms median and this runs on every
   * resocket, which includes the mid-draw handover.
   */
  private updateFists(): void {
    if (!this.host.setFists) {
      return
    }
    const drawn = this.effectiveDrawn
    let left = drawn === 'twoHand' || drawn === 'bow'
    const right = drawn === 'mainHand' || drawn === 'twoHand'
    if (this.current.offHand === 'shield') {
      left = false
    }
    if (left === this.fists.L && right === this.fists.R) {
      return
    }
    this.fists.L = left
    this.fists.R = right
    this.host.setFists(left, right)
  }

  private detach(slot: EquipSlot): void {
    const attachment = this.attachments.get(slot)
    if (!attachment) {
      return
    }
    if (attachment.instance) {
      this.instancer?.release(attachment.instance)
    }
    attachment.outline?.removeFromParent()
    attachment.object?.removeFromParent()
    // Geometry and materials are shared across every character wearing this
    // kind — `disposeGearCache()` owns them, not an individual character.
    //
    // A garment leaves nothing to unparent, because nothing was ever parented;
    // the body rebuild that puts the part underneath back is `equip`'s, once
    // `current` says the slot is empty.
    this.attachments.delete(slot)
  }
}

// ─── The placeholder billet ────────────────────────────────────────────────

/**
 * A chamfered box, used only for a kind the gear module has not registered.
 *
 * It exists so the attachment layer is verifiable — sockets, sides, transitions
 * and the torso overlay can all be checked in a browser before a single real
 * weapon exists — and so a missing registration reads as an obvious grey billet
 * rather than as an invisible sword. It is deliberately not a weapon: every
 * silhouette decision belongs to the gear module.
 *
 * It still obeys the art contract, because a placeholder that breaks the rules
 * teaches you nothing about whether the rules are met: bevelled on all twelve
 * edges (GDD R2), normals taken from the shape rather than the mesh (R3),
 * palette colour only (§3), outward winding, 44 triangles.
 */
interface Billet {
  size: readonly [number, number, number]
  /** Centre, relative to the socket origin. */
  offset: readonly [number, number, number]
  chamfer: number
  top: Color
  bottom: Color
}

const BILLETS: Record<ItemKind, Billet> = {
  // Grip at the origin, blade down −Y — the frame described at the top.
  sword: { size: [0.055, 0.62, 0.018], offset: [0, -0.27, 0], chamfer: 0.008, top: C.steelLit, bottom: C.steelShadow },
  greatsword: {
    size: [0.085, 0.95, 0.026],
    offset: [0, -0.4, 0],
    chamfer: 0.011,
    top: C.steelLit,
    bottom: C.steelShadow
  },
  // A bow's limbs run both ways from the riser, so it straddles the origin.
  bow: { size: [0.035, 0.82, 0.02], offset: [0, 0, 0], chamfer: 0.008, top: C.woodLit, bottom: C.woodShadow },
  crossbow: {
    size: [0.3, 0.075, 0.34],
    offset: [0, -0.02, 0.06],
    chamfer: 0.012,
    top: C.woodLit,
    bottom: C.woodShadow
  },
  shield: { size: [0.32, 0.4, 0.045], offset: [0, 0, 0.05], chamfer: 0.016, top: C.woodLit, bottom: C.leatherShadow },
  // Hats are authored in `headTop`'s frame, which sits inside the skull — the
  // brim has to clear the built surface, not the ideal ellipsoid (HAT_CLEARANCE).
  hat: { size: [0.46, 0.13, 0.46], offset: [0, 0.16, 0], chamfer: 0.03, top: C.strawLit, bottom: C.strawShadow },
  // Hips-joint frame, per `gear/index.ts`: y = 0 is the hips joint at 0.62. The
  // torso part runs from there to the chest at 0.95, so its middle is 0.165 up.
  // Sized 8 mm proud of the built torso on every axis.
  torsoArmour: {
    size: [0.408, 0.42, 0.306],
    offset: [0, 0.165, 0],
    chamfer: 0.03,
    top: C.steelLit,
    bottom: C.steelShadow
  },
  // Garments share the cuirass's billet — same hips-joint frame, same torso to
  // stand 8 mm proud of. Head items share the hat's. A billet is only ever the
  // grey stand-in shown before `gearRegistry` introduces the real model.
  robe: {
    size: [0.408, 0.42, 0.306],
    offset: [0, 0.165, 0],
    chamfer: 0.03,
    top: C.leatherLit,
    bottom: C.leatherShadow
  },
  hoodedRobe: {
    size: [0.408, 0.42, 0.306],
    offset: [0, 0.165, 0],
    chamfer: 0.03,
    top: C.leatherLit,
    bottom: C.leatherShadow
  },
  tabard: {
    size: [0.408, 0.42, 0.306],
    offset: [0, 0.165, 0],
    chamfer: 0.03,
    top: C.leatherLit,
    bottom: C.leatherShadow
  },
  apronSmock: {
    size: [0.408, 0.42, 0.306],
    offset: [0, 0.165, 0],
    chamfer: 0.03,
    top: C.leatherLit,
    bottom: C.leatherShadow
  },
  dress: {
    size: [0.408, 0.42, 0.306],
    offset: [0, 0.165, 0],
    chamfer: 0.03,
    top: C.leatherLit,
    bottom: C.leatherShadow
  },
  pinafore: {
    size: [0.408, 0.42, 0.306],
    offset: [0, 0.165, 0],
    chamfer: 0.03,
    top: C.leatherLit,
    bottom: C.leatherShadow
  },
  jerkin: {
    size: [0.408, 0.42, 0.306],
    offset: [0, 0.165, 0],
    chamfer: 0.03,
    top: C.leatherLit,
    bottom: C.leatherShadow
  },
  roughTunic: {
    size: [0.408, 0.42, 0.306],
    offset: [0, 0.165, 0],
    chamfer: 0.03,
    top: C.leatherLit,
    bottom: C.leatherShadow
  },
  mantle: {
    size: [0.408, 0.42, 0.306],
    offset: [0, 0.165, 0],
    chamfer: 0.03,
    top: C.leatherLit,
    bottom: C.leatherShadow
  },
  wanderersCoat: {
    size: [0.408, 0.42, 0.306],
    offset: [0, 0.165, 0],
    chamfer: 0.03,
    top: C.leatherLit,
    bottom: C.leatherShadow
  },
  coif: { size: [0.4, 0.16, 0.4], offset: [0, 0.14, 0], chamfer: 0.026, top: C.leatherLit, bottom: C.leatherShadow },
  hood: { size: [0.4, 0.16, 0.4], offset: [0, 0.14, 0], chamfer: 0.026, top: C.leatherLit, bottom: C.leatherShadow },
  flatCap: { size: [0.4, 0.16, 0.4], offset: [0, 0.14, 0], chamfer: 0.026, top: C.leatherLit, bottom: C.leatherShadow },
  officialCap: { size: [0.4, 0.16, 0.4], offset: [0, 0.14, 0], chamfer: 0.026, top: C.leatherLit, bottom: C.leatherShadow },
  helmet: { size: [0.4, 0.16, 0.4], offset: [0, 0.14, 0], chamfer: 0.026, top: C.leatherLit, bottom: C.leatherShadow },
  // Leg garments are authored in bind-pose world coordinates like the torso's,
  // so the billet spans hips-down rather than sitting at the origin.
  hose: { size: [0.26, 0.6, 0.2], offset: [0, -0.32, 0], chamfer: 0.024, top: C.clothBase, bottom: C.clothShadow },
  looseTrousers: { size: [0.26, 0.6, 0.2], offset: [0, -0.32, 0], chamfer: 0.024, top: C.clothBase, bottom: C.clothShadow },
  plateLegs: { size: [0.26, 0.6, 0.2], offset: [0, -0.32, 0], chamfer: 0.024, top: C.clothBase, bottom: C.clothShadow },
  rolledTrousers: { size: [0.26, 0.6, 0.2], offset: [0, -0.32, 0], chamfer: 0.024, top: C.clothBase, bottom: C.clothShadow },
  tallBoots: { size: [0.26, 0.6, 0.2], offset: [0, -0.32, 0], chamfer: 0.024, top: C.clothBase, bottom: C.clothShadow }
}

const _normal = new Vector3()
const _edgeA = new Vector3()
const _edgeB = new Vector3()
const _face = new Vector3()

const placeholderGeometry = (kind: ItemKind): BufferGeometry => {
  const spec = BILLETS[kind]
  const [sx, sy, sz] = spec.size
  const [ox, oy, oz] = spec.offset
  const hx = sx * 0.5
  const hy = sy * 0.5
  const hz = sz * 0.5
  const c = Math.min(spec.chamfer, hx * 0.8, hy * 0.8, hz * 0.8)
  const ax = hx - c
  const ay = hy - c
  const az = hz - c

  const positions: number[] = []
  const normals: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const colour = new Color()

  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number): number => {
    const index = positions.length / 3
    positions.push(x + ox, y + oy, z + oz)
    _normal.set(nx, ny, nz).normalize()
    normals.push(_normal.x, _normal.y, _normal.z)
    // Vertical gradient, so a flat facet still reads as lit-above. `hy` rather
    // than the offset centre: the gradient belongs to the billet, not to where
    // it happens to hang.
    colour.copy(spec.bottom).lerp(spec.top, hy === 0 ? 0.5 : (y + hy) / (hy * 2))
    colors.push(colour.r, colour.g, colour.b)
    return index
  }

  /**
   * Emits a triangle wound **outward**.
   *
   * The winding is derived from the face normal rather than trusted to the order
   * the corners were listed in: `limbMesh` winds inward and `chibiGeometry` has
   * to reverse it, which is exactly the bug this avoids having a second time.
   */
  const triangle = (a: number, b: number, cIndex: number, nx: number, ny: number, nz: number): void => {
    _edgeA.set(
      positions[b * 3]! - positions[a * 3]!,
      positions[b * 3 + 1]! - positions[a * 3 + 1]!,
      positions[b * 3 + 2]! - positions[a * 3 + 2]!
    )
    _edgeB.set(
      positions[cIndex * 3]! - positions[a * 3]!,
      positions[cIndex * 3 + 1]! - positions[a * 3 + 1]!,
      positions[cIndex * 3 + 2]! - positions[a * 3 + 2]!
    )
    _face.copy(_edgeA).cross(_edgeB)
    if (_face.dot(_normal.set(nx, ny, nz)) >= 0) {
      indices.push(a, b, cIndex)
    } else {
      indices.push(a, cIndex, b)
    }
  }

  const quad = (a: number, b: number, cIndex: number, d: number, nx: number, ny: number, nz: number): void => {
    triangle(a, b, cIndex, nx, ny, nz)
    triangle(a, cIndex, d, nx, ny, nz)
  }

  // Six faces, inset by the chamfer.
  const faceAxes: [number, number, number][] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1]
  ]
  for (const [nx, ny, nz] of faceAxes) {
    // Two in-plane axes, whichever the normal is not on.
    const u: [number, number, number] = nx !== 0 ? [0, 1, 0] : [1, 0, 0]
    const v: [number, number, number] = nz !== 0 ? [0, 1, 0] : [0, 0, 1]
    const centre: [number, number, number] = [nx * hx, ny * hy, nz * hz]
    const eu: [number, number, number] = [u[0] * ax, u[1] * ay, u[2] * az]
    const ev: [number, number, number] = [v[0] * ax, v[1] * ay, v[2] * az]
    const corner = (su: number, sv: number): number =>
      push(
        centre[0] + eu[0] * su + ev[0] * sv,
        centre[1] + eu[1] * su + ev[1] * sv,
        centre[2] + eu[2] * su + ev[2] * sv,
        nx,
        ny,
        nz
      )
    quad(corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1), nx, ny, nz)
  }

  // Twelve edge bevels. One facet each: at this scale a second ring buys no
  // silhouette, and R2 asks for the edge to be broken, not rounded.
  const edges: { axis: 0 | 1 | 2; s1: number; s2: number }[] = []
  for (const s1 of [-1, 1]) {
    for (const s2 of [-1, 1]) {
      edges.push({ axis: 0, s1, s2 }, { axis: 1, s1, s2 }, { axis: 2, s1, s2 })
    }
  }
  for (const edge of edges) {
    // For an edge along `axis`, the two chamfer rails sit on the other two axes.
    const along: [number, number, number] = [0, 0, 0]
    along[edge.axis] = 1
    const half = [ax, ay, az][edge.axis]!
    const other = [0, 1, 2].filter(i => i !== edge.axis) as [number, number]
    const nOther: [number, number, number] = [0, 0, 0]
    nOther[other[0]] = edge.s1
    nOther[other[1]] = edge.s2

    const point = (rail: 0 | 1, end: number): number => {
      const p: [number, number, number] = [0, 0, 0]
      p[edge.axis] = along[edge.axis]! * half * end
      // Rail 0 sits on the first face, rail 1 on the second.
      const outer = [hx, hy, hz]
      const inner = [ax, ay, az]
      p[other[0]] = (rail === 0 ? outer[other[0]]! : inner[other[0]]!) * edge.s1
      p[other[1]] = (rail === 0 ? inner[other[1]]! : outer[other[1]]!) * edge.s2
      return push(p[0], p[1], p[2], nOther[0], nOther[1], nOther[2])
    }
    quad(point(0, -1), point(0, 1), point(1, 1), point(1, -1), nOther[0], nOther[1], nOther[2])
  }

  // Eight corner facets.
  for (const sxSign of [-1, 1]) {
    for (const sySign of [-1, 1]) {
      for (const szSign of [-1, 1]) {
        const a = push(hx * sxSign, ay * sySign, az * szSign, sxSign, sySign, szSign)
        const b = push(ax * sxSign, hy * sySign, az * szSign, sxSign, sySign, szSign)
        const d = push(ax * sxSign, ay * sySign, hz * szSign, sxSign, sySign, szSign)
        triangle(a, b, d, sxSign, sySign, szSign)
      }
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  geometry.setIndex(new BufferAttribute(new Uint16Array(indices), 1))
  geometry.computeBoundingSphere()
  return geometry
}

/** Exposed for the tests and for a gear module that wants a stand-in tier. */
export const buildPlaceholderItem = (kind: ItemKind): BufferGeometry => placeholderGeometry(kind)
