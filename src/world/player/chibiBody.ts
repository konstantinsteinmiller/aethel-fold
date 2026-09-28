import type { Object3D, Vector3 } from 'three'
import { Character } from '../characters/Character'
import { applyPosture, type SeatKind } from '../combat/postures'
import { seatRootLift } from '../interaction/SitController'
import { CharacterEquipment, variantOf } from '../characters/CharacterEquipment'
import { DEFAULT_APPEARANCE, type CharacterAppearance, type EquipmentLoadout } from '../characters/equipment'
import { FIGURE_HEIGHT } from '../characters/rig'

/**
 * ─── The player's body ──────────────────────────────────────────────────────
 *
 * Drives a `Character` from the player controller, so the thing you walk around
 * as is the same rig the NPCs use — same skeleton, same gait curves, same
 * skinned outline.
 *
 * It replaces the capsule placeholder, which `capsuleMesh.ts` always described
 * as temporary ("Phase C's chibi human replaces this outright"). The capsule is
 * still there behind `body: 'capsule'`, because a featureless cylinder is a
 * genuinely better debug view for collision work: it *is* the collision shape,
 * so any disagreement between what you see and what you hit is visible.
 *
 * ── The character is scaled, not re-authored ────────────────────────────────
 *
 * The rig is 1.56 m tall and the player capsule is 1.8 m with a 1.7 m eye. Left
 * unscaled the camera would float above the character's head — first person
 * would show the crown of your own skull from outside. Scaling the group is
 * enough: the skeleton, the gait and the outline all ride along, and nothing in
 * the animation is authored in absolute metres except the pelvis bob, which
 * scales correctly with it.
 *
 * ── It wears the character you made ─────────────────────────────────────────
 *
 * `appearance` and `loadout` come from `roster.ts::playerLook()`, which resolves
 * the roster's active profile, then the standalone appearance key, then the
 * default. Before this the figure was `new Character({ perfTag })` — i.e.
 * `DEFAULT_APPEARANCE` — so `/characters` could save a character that appeared
 * nowhere.
 *
 * The **loadout needs a `CharacterEquipment`**, and that is the whole of why one
 * is built here: a `Character` on its own has a body and a skeleton but no
 * sockets, so a saved sword is a field in storage and nothing else. Attaching
 * one also buys the arm poses for free — `CharacterEquipment` registers itself
 * as the host's combat source, so a player carrying a shield carries it on the
 * forearm rather than clipping it through their hip.
 *
 * It is skipped entirely when the loadout is empty, which is the common case and
 * the one that must stay free: no attachments, no gear models built, no combat
 * pose layer, and the figure is exactly the mesh it was before.
 *
 * ── It can sit down ─────────────────────────────────────────────────────────
 *
 * `setPosture` is the whole of what the sandbox needs from this file to use
 * `world/interaction/`. It exists here rather than in the caller because the
 * bones are here: `world/interaction/SitController` owns *where* a sitter is and
 * *which way they face*, and neither of those is a bone.
 *
 * ── Facing follows motion, not the camera ───────────────────────────────────
 *
 * `Character` derives its own heading from how it actually moved. That is left
 * alone here rather than overridden with the look yaw, because the body's job in
 * first person is to cast an honest shadow: a shadow that pirouettes when you
 * flick the mouse while standing still is worse than no shadow. Third person
 * gets the same treatment, where facing-along-travel is what you want anyway.
 */

export interface PlayerBody {
  readonly object: Object3D
  /** Follows the controller. `dt` drives the gait; the rest is derived. */
  sync(position: Vector3, lookYaw: number, dt: number): void
  /** Third person: fully visible, outline and all. */
  setVisible(visible: boolean): void
  /** First person: visible for its shadow, outline off so it cannot fill the view. */
  setFirstPerson(active: boolean): void
  jump(): void
  /**
   * Holds a seated pose, or lets it go.
   *
   * `blend` is 0 standing, 1 fully seated, and everything between while the
   * figure is on its way into or out of a seat — the same number
   * `Combatant.postureBlend` carries, so the chapter and the sandbox are
   * provably running the same motion.
   *
   * `seatAboveGround` is the seat's top face measured from the ground the
   * figure is standing on, and it is here rather than in the caller because
   * **this** is the object that knows the group scale. The rig is 1.56 m and
   * the player capsule is 1.8, so this figure is scaled to 1.154 — and a scaled
   * figure's solved pose lands its backside `S·(1 − scale)` off the plank.
   * `seatRootLift` is that number; `SitController`'s header derives it.
   *
   * Applied every frame it is non-zero, and safe to be: `applyPosture`
   * re-seats the pelvis before it composes, which is what makes a posture
   * idempotent where a swing is not. `applyClip` *adds* its hip lift, and the
   * one time that ran unchecked on a held pose it put a household's heads
   * between 30 and 52 metres underground.
   */
  setPosture(seat: SeatKind | null, blend: number, seatAboveGround?: number): void
  dispose(): void
}

export interface ChibiBodyOptions {
  /** Player capsule height, so the figure can be scaled to match. */
  height: number
  perfTag?: string
  /** Who the player is. Defaults to the shipped figure. */
  appearance?: CharacterAppearance
  /**
   * What they are wearing. Omitted or all-null builds no equipment layer at all
   * — see the note in the header on why that path has to stay free.
   */
  loadout?: EquipmentLoadout
}

const wearsSomething = (loadout: EquipmentLoadout | undefined): loadout is EquipmentLoadout =>
  loadout !== undefined &&
  (loadout.mainHand !== null ||
    loadout.offHand !== null ||
    loadout.back !== null ||
    loadout.head !== null ||
    loadout.torso !== null ||
    loadout.legs !== null)

export const createChibiBody = (options: ChibiBodyOptions): PlayerBody => {
  const { height, perfTag = 'player', appearance = DEFAULT_APPEARANCE, loadout } = options

  const character = new Character({ perfTag, appearance })
  const scale = height / FIGURE_HEIGHT
  character.group.scale.setScalar(scale)
  character.group.name = 'player'
  character.group.userData.perfTag = perfTag
  character.group.visible = false

  // ── The equipment layer, only when there is equipment ────────────────────
  //
  // `setVariant` before `setLoadout`, the same ordering `Crowd.dress` uses and
  // for the same reason: the variant carries the colourway, and applying the
  // loadout first dresses the figure in the previous one and then rebuilds the
  // whole body a second time to correct it.
  let equipment: CharacterEquipment | null = null
  if (wearsSomething(loadout)) {
    equipment = new CharacterEquipment(character, { outline: true, castShadow: true })
    equipment.setVariant(variantOf(appearance))
    equipment.setLoadout(loadout)
  }

  /** The seat being held, how far into it, and how high it stands. `setPosture`. */
  let posture: SeatKind | null = null
  let postureBlend = 0
  let postureSeatHeight = 0

  return {
    object: character.group,
    sync: (position: Vector3, _lookYaw: number, dt: number): void => {
      character.setPosition(position)
      // The root lift, before the pose rather than after: `Character.update`
      // reads nothing from the group's position, and doing it here means the
      // one write to `group.position.y` in this function is the final one.
      if (posture && postureBlend > 0) {
        character.group.position.y += seatRootLift(postureSeatHeight, scale, postureBlend)
      }
      character.update(dt)
      // Between the gait and the equipment, and it has to be both: after
      // `character.update`, which resets the pose and runs the walk cycle, so
      // the seat wins; before `equipment.update`, which reads the bones it is
      // parented to and would otherwise carry a sword through a chair on last
      // frame's matrix.
      if (posture && postureBlend > 0) {
        applyPosture(character.bones, posture, postureBlend)
      }
      // After the character, not before: the draw/stow animation re-parents an
      // item to a bone, and a bone that has not been posed this frame hands it
      // last frame's matrix.
      equipment?.update(dt)
    },
    setPosture: (seat: SeatKind | null, blend: number, seatAboveGround = 0): void => {
      posture = seat
      postureBlend = blend
      postureSeatHeight = seatAboveGround
    },
    setVisible: (visible: boolean): void => {
      character.group.visible = visible
      if (character.outline) {
        character.outline.visible = true
      }
    },
    setFirstPerson: (active: boolean): void => {
      character.group.visible = true
      if (character.outline) {
        // The body's own material is front-facing, so from a camera inside the
        // head nothing is drawn. The outline hull is back-facing by
        // construction — it is the one thing that *would* fill the view.
        character.outline.visible = !active
      }
    },
    jump: (): void => {
      // `Character.jump` already ignores a repeat while one is running, so a
      // held key cannot restart the clip and pin the character in its crouch.
      character.jump()
    },
    dispose: (): void => {
      // Equipment first: disposing it hands the character back their own torso,
      // legs and untucked hair, and doing that to an already-disposed body is a
      // rebuild of geometry nobody will ever draw.
      equipment?.dispose()
      character.dispose()
    }
  }
}
