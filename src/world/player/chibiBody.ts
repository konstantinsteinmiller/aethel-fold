import type { Object3D, Vector3 } from 'three'
import { Character } from '../characters/Character'
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
  dispose(): void
}

export interface ChibiBodyOptions {
  /** Player capsule height, so the figure can be scaled to match. */
  height: number
  perfTag?: string
}

export const createChibiBody = (options: ChibiBodyOptions): PlayerBody => {
  const { height, perfTag = 'player' } = options

  const character = new Character({ perfTag })
  const scale = height / FIGURE_HEIGHT
  character.group.scale.setScalar(scale)
  character.group.name = 'player'
  character.group.userData.perfTag = perfTag
  character.group.visible = false

  return {
    object: character.group,
    sync: (position: Vector3, _lookYaw: number, dt: number): void => {
      character.setPosition(position)
      character.update(dt)
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
      character.dispose()
    }
  }
}
