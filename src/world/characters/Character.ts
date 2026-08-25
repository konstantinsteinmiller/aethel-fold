import { type Bone, type BufferGeometry, Group, SkinnedMesh, Vector3 } from 'three'
import { deriveOutlineColor } from '../art/palette'
import { createOutlineMaterial, type OutlineMaterial } from '../shading/outlineMaterial'
import { createToonMaterial, type ToonMaterial } from '../shading/toonMaterial'
import { type BodyGarments, type ItemVariant, variantOf } from './CharacterEquipment'
import { CHIBI_BUDGET, buildChibiGeometry, type HandGrips } from './chibiGeometry'
import { type CharacterAppearance, DEFAULT_APPEARANCE } from './equipment'
import { sleeveColourForItem } from './gear/garments'
import { installGear } from './gearRegistry'
import { applyBank, applyGait, applyIdle, applyJump, RUN, WALK } from './poses'
import { applyCarry, applyDraw, applyShield, isDrawable } from './combatPoses'
import type { DrawnState, EquipSlot, ItemKind } from './equipment'
import { buildSkeleton } from './skeleton'
import { BONE_NAMES, type BoneName } from './rig'

/**
 * ─── A character in the scene ───────────────────────────────────────────────
 *
 * Skinned body, skinned outline hull, procedural gait. One object to add to the
 * scene and one `update(dt)` to call.
 *
 * ── Why the outline is a second SkinnedMesh sharing the skeleton ────────────
 *
 * It shares the *geometry* and the *skeleton* — not copies of either. Sharing
 * the skeleton is what guarantees the hull cannot drift out of register with the
 * body: there is one set of bone matrices and both meshes read it, so a pose is
 * either applied to both or to neither. Two skeletons kept in sync by calling
 * code is a bug waiting for the first early-out.
 *
 * `bindMode: 'attached'` on both, with the same bind matrix, for the same
 * reason.
 *
 * ── Cost ────────────────────────────────────────────────────────────────────
 *
 * Two draw calls per character plus one shadow draw, ~650 triangles each, and
 * **two new programs** for the whole character family (`USE_SKINNING` forks both
 * the toon and outline programs). That fork is why characters are not simply
 * more props: it is a fixed cost paid once, and it is why the GDD's ≤13 program
 * budget left headroom.
 */

export type CharacterState = 'idle' | 'walk' | 'run' | 'jump'

/**
 * What the combat pose layer needs to know each frame.
 *
 * Structural, and deliberately read-only: `CharacterEquipment` satisfies it, but
 * so would a replay, a test fixture or a networked ghost. Every member is
 * allocation-free to read — the whole point of `CharacterEquipment` exposing
 * `drawProgress` and `effectiveDrawn` as getters rather than as a snapshot.
 */
export interface CombatSource {
  readonly effectiveDrawn: DrawnState
  readonly drawnFrom: DrawnState
  readonly drawing: boolean
  readonly drawProgress: number
  itemAt(slot: EquipSlot): ItemKind | null
  /**
   * Tells the equipment which colourway this character is wearing.
   *
   * Optional, so a test double or a monster rig satisfies the rest of this
   * interface without it. It is here — rather than left to whoever constructed
   * the `CharacterEquipment` — because `gearSeed` and `skinTone` live in the
   * *appearance*, and an owner who changed the appearance without remembering to
   * forward it would get a figure whose skin, hair and face changed while their
   * coat stayed the colour the last character's was. Pushing it from
   * `setAppearance` makes forgetting impossible.
   */
  setVariant?(variant: ItemVariant): void
}

/** Above this, the blend has reached a full run. Below `WALK_SPEED`, a walk. */
const RUN_SPEED = 3.4
const WALK_SPEED = 1.4
/** Below this the character is standing. Hysteresis-free: idle blends in. */
const STILL_SPEED = 0.12
/** Radians per second the body can turn. A human pivots, it does not snap. */
const TURN_RATE = 7.0
/** How fast measured speed is smoothed, per second. */
const SPEED_SMOOTHING = 6
/** Radians of bank per (rad/s of turn x m/s of speed). */
const BANK_PER_TURN = 0.055

export interface CharacterOptions {
  /** Stride cycles per second at the state's reference speed. */
  cadence?: number
  outline?: boolean
  perfTag?: string
  /** Head, hair, build and colour. Rebuilt through `setAppearance`. */
  appearance?: CharacterAppearance
  /**
   * Ledger name for `assertTriBudget`.
   *
   * **Stable per screen, not per build.** The ledger replaces its row by name,
   * so a name that varied with the appearance or with what is equipped would
   * grow the perf panel a fresh row per click and turn it into a history.
   */
  geometryName?: string
}

const WALK_REFERENCE = 1.5
const RUN_REFERENCE = 4.5

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value)
const clampAbs = (value: number, limit: number): number =>
  value > limit ? limit : value < -limit ? -limit : value
const lerpNumber = (from: number, to: number, w: number): number => from + (to - from) * w
const approach = (value: number, target: number, step: number): number => {
  const delta = target - value
  return Math.abs(delta) <= step ? target : value + Math.sign(delta) * step
}

/**
 * Scratch for the idle cross-fade: three Euler components per bone plus the
 * hips' vertical offset. Module level because this runs every frame for every
 * character and the project bans per-frame allocation (GDD 5).
 */
const _poseScratch = new Float32Array(BONE_NAMES.length * 3 + 1)

const capturePose = (bones: Map<BoneName, Bone>, out: Float32Array): void => {
  for (let i = 0; i < BONE_NAMES.length; i++) {
    const bone = bones.get(BONE_NAMES[i]!)
    if (!bone) {
      continue
    }
    out[i * 3] = bone.rotation.x
    out[i * 3 + 1] = bone.rotation.y
    out[i * 3 + 2] = bone.rotation.z
  }
  out[BONE_NAMES.length * 3] = bones.get('hips')?.position.y ?? 0
}

/**
 * Blends the bones' current rotations back toward a captured pose.
 *
 * Euler-space rather than quaternion because every joint here is dominated by a
 * single axis and the two poses being blended are close by construction — the
 * gimbal cases a quaternion slerp exists to handle cannot arise, and this costs
 * a multiply per component instead of a normalisation per bone.
 */
const blendPose = (bones: Map<BoneName, Bone>, from: Float32Array, weight: number): void => {
  for (let i = 0; i < BONE_NAMES.length; i++) {
    const bone = bones.get(BONE_NAMES[i]!)
    if (!bone) {
      continue
    }
    bone.rotation.x += (from[i * 3]! - bone.rotation.x) * weight
    bone.rotation.y += (from[i * 3 + 1]! - bone.rotation.y) * weight
    bone.rotation.z += (from[i * 3 + 2]! - bone.rotation.z) * weight
  }
  const hips = bones.get('hips')
  if (hips) {
    hips.position.y += (from[BONE_NAMES.length * 3]! - hips.position.y) * weight
  }
}

export class Character {
  readonly group = new Group()
  readonly body: SkinnedMesh
  readonly outline: SkinnedMesh | null

  /**
   * Metres per second the character is travelling.
   *
   * **Measured, not set.** `update` derives it from how far the group actually
   * moved since the last frame, so the stride can never disagree with the
   * motion. Declaring a speed and moving at a different one is the mechanism
   * behind every foot-slide, and making the number an output removes it.
   */
  speed = 0

  /**
   * Current locomotion state, also derived from measured speed.
   *
   * A caller can still force `jump()`, which owns the body until it completes.
   */
  state: CharacterState = 'idle'

  /** Seconds a jump takes, crouch to recovery. */
  jumpDuration = 0.95

  /**
   * Milliseconds the last body rebuild took.
   *
   * Exposed rather than logged because it is the number that decides whether an
   * appearance change or an equip can rebuild the whole figure at all. Measured
   * in Chrome over 40 equip/unequip cycles: **1.4 ms median, 3.1 ms worst** —
   * click-scale, not frame-scale, which is the only claim it has to support.
   */
  lastRebuildMs = 0

  private readonly appearance: CharacterAppearance
  private readonly geometryName: string
  /**
   * What is currently built into (or clipped against) the body.
   *
   * One object rather than a field per slot, because it is exactly what
   * `EquipmentHost.rebuildBody` hands over, and splitting it back out here would
   * be a second place to forget a slot — which is how trousers used to delete a
   * cuirass. Replaced whole, never mutated.
   */
  private garments: BodyGarments = { torso: null, legs: null, head: null }
  /**
   * Which hands are built closed. Mutated in place — `buildChibiGeometry` only
   * reads it, and a fresh object per equip would allocate on a click path for
   * nothing.
   */
  private readonly fists: HandGrips = { L: false, R: false }

  private readonly material: ToonMaterial
  private readonly outlineMaterial: OutlineMaterial | null
  private readonly bones: Map<BoneName, Bone>
  private readonly cadence: number
  private phase = 0
  private elapsed = 0
  private jumpTime = -1
  private stateBeforeJump: CharacterState = 'idle'
  private readonly previous = new Vector3()
  private hasPrevious = false
  private facing = 0
  private targetFacing = 0
  private bank = 0
  /** Equipment state for the arms. Null on a bare character — see `setCombatSource`. */
  private combat: CombatSource | null = null
  private moving = 0

  constructor(options: CharacterOptions = {}) {
    // Introduces the gear models to the attachment layer's registry, once per
    // process. Without it every equipped item renders as a placeholder billet —
    // see `gearRegistry.ts` for why the two modules do not import each other.
    installGear()

    const {
      cadence = 0.95,
      outline = true,
      perfTag = 'characters',
      appearance = DEFAULT_APPEARANCE,
      geometryName = 'chibi/LOD0'
    } = options
    this.cadence = cadence
    this.appearance = { ...appearance }
    this.geometryName = geometryName

    const { geometry, outlineGeometry } = buildChibiGeometry(CHIBI_BUDGET, geometryName, this.appearance)
    const { skeleton, root, byName } = buildSkeleton()
    this.bones = byName

    this.material = createToonMaterial({
      // Wind is for foliage. A character bending in the breeze is a bug that
      // looks like a feature until you notice the walk cycle fighting it.
      wind: false,
      name: 'chibi'
    })

    this.body = new SkinnedMesh(geometry, this.material)
    this.body.name = 'chibi/body'
    this.body.castShadow = true
    this.body.receiveShadow = true
    // The skeleton root must be in the scene graph or its world matrices are
    // never updated and every bone matrix stays identity — a character that
    // renders in bind pose forever, with no error anywhere.
    this.body.add(root)
    this.body.bind(skeleton)
    this.group.add(this.body)

    if (outline) {
      this.outlineMaterial = createOutlineMaterial({ wind: false, name: 'chibi-outline' })
      // Body-only: the face decal must not be extruded into the hull, or the
      // outline stands ~18 mm off the head at 10 m and hides the features it is
      // outlining. See `chibiGeometry.ts`.
      this.outline = new SkinnedMesh(outlineGeometry, this.outlineMaterial)
      this.outline.name = 'chibi/outline'
      // The hull never casts: it is a shell a few pixels outside the body, so it
      // would cast a shadow slightly larger than the character's own and the two
      // would fight along every silhouette edge.
      this.outline.castShadow = false
      this.outline.receiveShadow = false
      this.outline.bind(skeleton, this.body.bindMatrix)
      this.group.add(this.outline)
    } else {
      this.outline = null
      this.outlineMaterial = null
    }

    this.group.name = 'character'
    this.group.userData.perfTag = perfTag

    // Outline colour is derived per-fragment from vertex colour (GDD R6), so
    // there is nothing per-character to set here — the same call that keeps a
    // birch pale and a boulder dark keeps skin and tunic outlining differently
    // on the same figure.
    void deriveOutlineColor
  }

  /**
   * A bone by name, for the attachment layer (`CharacterEquipment.ts`).
   *
   * The whole hook: with it, `Character` structurally satisfies `EquipmentHost`
   * (which also wants `group` and `body`, both already public), so equipment can
   * hang off a character without either file importing the other. Read-only by
   * intent — a caller parents to the bone, it does not pose it. Posing is
   * `poses.ts`'s, and a second writer to a bone rotation is a fight that
   * resolves differently depending on update order.
   */
  bone(name: BoneName): Bone | null {
    return this.bones.get(name) ?? null
  }

  /**
   * Builds `armour` into the body **in place of its torso**, or restores the
   * torso when given null. The second half of `EquipmentHost`.
   *
   * Every other item is a mesh parented to a bone; torso armour cannot be,
   * because a shell that follows one end of the torso parts company with a body
   * that follows both — 132 mm of it at a run (`CharacterEquipment.ts`). The
   * answer that costs nothing is to make the armour *be* the torso, and that is
   * a decision only the body builder can take, so it is taken here.
   *
   * **The mesh is re-pointed, not rebuilt.** `bindMatrix`, the skeleton and the
   * inverse binds live on the *mesh*, not on the geometry, and the new geometry
   * is skinned against the same `BONE_NAMES` order — so swapping the buffers is
   * complete, and it avoids churning two materials, a skeleton and the outline's
   * bind matrix on every equip. It is also what makes this safe to call mid-pose:
   * nothing about the current animation lives in the geometry.
   */
  rebuildBody(garments: BodyGarments): void {
    this.garments = garments
    this.rebuild()
  }

  /**
   * Builds a closed fist into each hand that is gripping something. The third
   * half of `EquipmentHost`, and the same mechanism as the two above.
   *
   * A fist cannot be posed on this rig — there are no finger bones, and
   * `chibiGeometry.ts` explains why there must not be — so a hand that closes is
   * a hand whose *geometry* is different. Same rebuild, same 1.4 ms, and the
   * pose is untouched by it: nothing about the current animation lives in the
   * geometry.
   */
  setFists(left: boolean, right: boolean): void {
    if (this.fists.L === left && this.fists.R === right) {
      return
    }
    this.fists.L = left
    this.fists.R = right
    this.rebuild()
  }

  /**
   * A new appearance, keeping whatever is built into the body.
   *
   * Armour has to survive a head-shape change, and it only does because both go
   * through one rebuild. Two independent paths — one re-pointing the geometry for
   * appearance and one for armour — is how a player ends up in a tunic the
   * instant they pick a different haircut.
   */
  setAppearance(appearance: CharacterAppearance): void {
    Object.assign(this.appearance, appearance)
    // Before the rebuild, because a garment is *part of* the body: re-pointing
    // the equipment at the new colourway triggers its own rebuild, and doing it
    // afterwards would merge the old cloth and immediately throw it away.
    this.combat?.setVariant?.(variantOf(this.appearance))
    this.rebuild()
  }

  /** A copy. The caller may be Vue, and must not hold the scene's own object. */
  getAppearance(): CharacterAppearance {
    return { ...this.appearance }
  }

  /**
   * Puts the character somewhere without it counting as having walked there.
   *
   * `measureMotion` reads speed off the group's movement between frames, so
   * moving a character 40 m by writing `group.position` reads as 40 m in one
   * frame — a spawn that arrives at a dead sprint and takes a second to settle.
   * Teleporting resets the motion history instead.
   */
  teleport(x: number, y: number, z: number): void {
    this.group.position.set(x, y, z)
    this.previous.set(x, y, z)
    this.hasPrevious = true
    this.speed = 0
    this.moving = 0
    this.state = 'idle'
  }

  private rebuild(): void {
    const started = performance.now()
    const { torso, legs, head } = this.garments
    const { geometry, outlineGeometry } = buildChibiGeometry(
      CHIBI_BUDGET,
      this.geometryName,
      this.appearance,
      torso?.geometry ?? null,
      legs?.geometry ?? null,
      this.fists,
      {
        // The sleeves are the body's, not the garment's — a garment does not own
        // the arms — so a moss-green dress arrives with two woad-blue shoulder
        // caps unless whatever equips it says otherwise. `sleeveColourFor` is
        // the garment's own answer to "what colour are the arms that go with
        // this colourway", and this is the only caller that can apply it without
        // writing into the player's saved appearance.
        sleeveColour: torso ? sleeveColourForItem(torso.kind, this.appearance.gearSeed) : null,
        headwear: head
      }
    )
    const previousBody = this.body.geometry
    const previousOutline = this.outline?.geometry ?? null
    this.body.geometry = geometry
    if (this.outline) {
      this.outline.geometry = outlineGeometry
    }
    // The outline shares every attribute buffer with the body and owns only its
    // own index, so this pair of disposes frees each buffer once — three's
    // attribute table is keyed by attribute, and the second removal of a shared
    // one is a no-op.
    previousBody.dispose()
    previousOutline?.dispose()
    this.lastRebuildMs = performance.now() - started
  }

  /**
   * Places the character with its feet on the ground at `position`.
   *
   * Move it every frame and the animation follows: speed, gait, facing and bank
   * are all derived from the resulting velocity in `update`.
   */
  setPosition(position: Vector3): void {
    this.group.position.copy(position)
  }

  /**
   * Overrides the facing directly.
   *
   * Only useful while stationary — as soon as the character moves, `update`
   * turns it to face its own velocity, because a character that walks in one
   * direction while pointing in another is the single most obvious animation
   * fault there is. That is exactly what happened when the demo computed a
   * facing by hand and got the formula a quarter turn out.
   */
  setFacing(radians: number): void {
    this.facing = radians
    this.targetFacing = radians
    this.group.rotation.y = radians
  }

  /**
   * Advances the animation.
   *
   * Stride phase is driven by **distance travelled**, not by wall time: a
   * character whose cycle runs on a clock slides its feet the moment its speed
   * changes, and foot-slide is the single most legible animation error there is.
   * Tying phase to speed means the contact pose lands where the foot actually
   * is at any pace, including during acceleration.
   */
  /**
   * Hands the character the equipment state its arms should react to.
   *
   * Until this is called the combat layer does nothing, which is exactly what a
   * bare `Character` (the player capsule, a test fixture) wants. It is also how
   * this shipped broken: `applyCarry` / `applyShield` / `applyDraw` existed,
   * were tested, and had **no caller anywhere in `src/`** — so a shield hung off
   * `hand.L` under the gait's own arm swing, which is what a shield looks like
   * when nothing is carrying it.
   */
  setCombatSource(source: CombatSource | null): void {
    this.combat = source
  }

  /**
   * The arms, after the legs.
   *
   * Order is `gait → bank → carry → draw → shield`, which is the order the pose
   * layer was written for: carriage overrides the gait's arm swing, a draw
   * overrides the carriage for the length of its clip, and the shield arm is
   * solved last because its roll is the only one solved rather than authored.
   */
  private applyCombat(brace: number): void {
    const combat = this.combat
    if (!combat) {
      return
    }
    // Effort tracks pace, which is what tightens a carry and tucks a shield.
    const effort = clamp01(this.speed / RUN_SPEED)

    applyCarry(this.bones, combat.effectiveDrawn, effort)

    if (combat.drawing) {
      const drawing = combat.drawnFrom === 'sheathed'
      const state = drawing ? this.combatTarget(combat) : combat.drawnFrom
      const kind = state === 'mainHand' ? combat.itemAt('mainHand') : combat.itemAt('back')
      if (kind !== null && isDrawable(kind)) {
        applyDraw(this.bones, kind, combat.drawProgress, drawing ? 'draw' : 'sheathe', effort)
      }
    }

    if (combat.itemAt('offHand') === 'shield') {
      applyShield(this.bones, effort, brace)
    }
  }

  /** The state a running draw is heading *to*. */
  private combatTarget(combat: CombatSource): DrawnState {
    return combat.effectiveDrawn === 'sheathed' ? combat.drawnFrom : combat.effectiveDrawn
  }

  update(dt: number): void {
    this.elapsed += dt
    if (dt <= 0) {
      return
    }

    this.measureMotion(dt)

    // A jump owns the body until it finishes. It is a one-shot clip with
    // anticipation and recovery, so cutting out of it early would drop exactly
    // the frames that make it read as effort.
    if (this.jumpTime >= 0) {
      this.jumpTime += dt
      const t = this.jumpTime / this.jumpDuration
      if (t >= 1) {
        this.jumpTime = -1
        this.state = this.stateBeforeJump
      } else {
        applyJump(this.bones, t)
        applyBank(this.bones, this.bank)
        // Braced through a jump: the shield comes up and the elbow comes in.
        this.applyCombat(1)
        return
      }
    }

    // Walk-to-run is one continuous blend rather than a switch. A person does
    // not step from a walk into a run between two frames, and the discontinuity
    // is plainly visible when they do.
    const runWeight = clamp01((this.speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED))
    this.state = this.moving < 0.5 ? 'idle' : runWeight > 0.5 ? 'run' : 'walk'

    // Stride phase advances with *distance covered*, against the reference pace
    // each curve set was authored at, so any speed produces a cadence whose
    // contact pose lands where the foot actually is.
    const reference = lerpNumber(WALK_REFERENCE, RUN_REFERENCE, runWeight)
    this.phase += dt * this.cadence * (this.speed / reference)
    this.phase -= Math.floor(this.phase)

    applyGait(this.bones, this.phase, WALK, RUN, runWeight)

    // Standing is a blend target too: below a walking pace the gait fades out
    // into the breathing idle instead of freezing mid-stride.
    if (this.moving < 1) {
      this.blendTowardIdle(1 - this.moving)
    }

    applyBank(this.bones, this.bank)
    this.applyCombat(0)
  }

  /**
   * Derives speed, facing and bank from how far the character actually moved.
   *
   * Everything the animation needs is an *observation* of the motion, never a
   * declaration alongside it. That is what makes it impossible for the stride to
   * disagree with the travel, or for the body to point somewhere other than
   * where it is going.
   */
  private measureMotion(dt: number): void {
    const position = this.group.position
    if (!this.hasPrevious) {
      this.previous.copy(position)
      this.hasPrevious = true
      return
    }

    const dx = position.x - this.previous.x
    const dz = position.z - this.previous.z
    this.previous.copy(position)

    const travelled = Math.hypot(dx, dz)
    const measured = travelled / dt
    // Smoothed, because a single frame's delta is noisy and an unfiltered speed
    // makes the gait cadence flutter.
    this.speed += (measured - this.speed) * Math.min(1, dt * SPEED_SMOOTHING)
    // Ramped rather than switched, so starting and stopping fade through the
    // idle instead of snapping into it mid-stride.
    this.moving = approach(this.moving, this.speed > STILL_SPEED ? 1 : 0, dt * 4)

    if (travelled > 1e-5) {
      // `atan2(x, z)` — not `(z, x)` — because the rig faces +Z, so a local
      // forward vector rotated by `rotation.y` lands at `(sin y, cos y)`.
      this.targetFacing = Math.atan2(dx, dz)
    }

    // Turn toward the target at a bounded rate, taking the short way round.
    let delta = this.targetFacing - this.facing
    delta = Math.atan2(Math.sin(delta), Math.cos(delta))
    const step = TURN_RATE * dt
    const applied = Math.abs(delta) <= step ? delta : Math.sign(delta) * step
    this.facing += applied
    this.group.rotation.y = this.facing

    // Bank into the turn in proportion to how hard it is being taken. A runner
    // leans; a walker barely does, and this falls out of the speed term.
    const targetBank = -clampAbs((applied / dt) * this.speed * BANK_PER_TURN, 0.35)
    this.bank += (targetBank - this.bank) * Math.min(1, dt * 5)
  }

  /** Cross-fades the current pose toward the idle pose by `weight`. */
  private blendTowardIdle(weight: number): void {
    if (weight <= 0) {
      return
    }
    capturePose(this.bones, _poseScratch)
    applyIdle(this.bones, this.elapsed)
    blendPose(this.bones, _poseScratch, 1 - weight)
  }

  /** Starts a jump. Ignored if one is already running. */
  jump(): void {
    if (this.jumpTime >= 0) {
      return
    }
    this.stateBeforeJump = this.state
    this.state = 'jump'
    this.jumpTime = 0
  }

  get airborne(): boolean {
    // The window between drive and landing, per `JUMP_RISE`.
    if (this.jumpTime < 0) {
      return false
    }
    const t = this.jumpTime / this.jumpDuration
    return t > 0.26 && t < 0.8
  }

  dispose(): void {
    this.body.geometry.dispose()
    this.material.dispose()
    this.outlineMaterial?.dispose()
    this.group.clear()
  }
}
