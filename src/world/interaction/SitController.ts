import type { SeatKind } from '../combat/postures'
import { resolveSeatFacing, type WorldSeat } from './seats'

/**
 * ─── Sitting down, as five states ───────────────────────────────────────────
 *
 * `idle → walking → sitting → seated → standing → idle`, and the whole of the
 * difficulty is in the two words "and release cleanly".
 *
 * ── What this owns, and what it refuses to own ──────────────────────────────
 *
 * It owns **where the sitter is and which way they face**, because those are
 * the two things a seat determines. It does not own the posture blend: that
 * lives on the actor (`Combatant.postureBlend`, advanced by
 * `CombatDirector.update` *before* the `enabled` gate so a figure can sit down
 * during a dialogue beat) and this reads it. One number, driving both the clip
 * and the slide onto the seat, is the same discipline `CombatDirector.settle`
 * states for the clip alone: a sit and a stand are then provably the same
 * motion reversed and cannot drift apart.
 *
 * It also does not touch the scene graph, a camera, an input device or a
 * chapter. It is handed an actor with five members and a seat, and the host
 * decides what any of that means.
 *
 * ── Why the walk is an intent and not a teleport ────────────────────────────
 *
 * The player is steered to the seat by filling in the same movement fields
 * their own keys fill in, which is the symmetry the whole combat layer is built
 * on (`CLAUDE.md`: "the player fills the same `Intent` struct a brain does").
 * So the walk-up obeys collision, separation and the speed clamp for free, and
 * a bug in it is a bug that can be watched happening to somebody else.
 *
 * The last half metre is **not** steered, and that is the one deliberate
 * exception. A sitter's pelvis has to end up over the seat to within a couple
 * of centimetres or the pose is a figure hovering beside its chair, and a
 * throttle-limited steer cannot promise that — it stops within whatever
 * tolerance it is given. So the walk ends at the *approach* point, a body
 * radius in front of the seat, and the remaining slide is interpolated by the
 * posture blend: the figure settles back onto the seat over the same 0.85 s the
 * clip takes to fold it, which is what the clip's crouch is depicting anyway.
 *
 * ── Interruption ────────────────────────────────────────────────────────────
 *
 * Two exits, and the difference between them is whether there is time to get
 * up. `release()` is the player asking — E, Esc, a beat starting — and plays
 * the clip backwards, walking the figure back out to the approach point.
 * `cancel()` is the world insisting — a hit landing, a fight starting, an actor
 * switch, a load — and drops the posture on the spot, putting the figure on the
 * approach point in one write rather than leaving it standing inside the
 * furniture. Both end at `idle` with `stand()` called, which is the invariant
 * that matters: **there is no exit from this class that leaves an actor mid-
 * blend or bound to a seat.**
 */

export type SitPhase = 'idle' | 'walking' | 'sitting' | 'seated' | 'standing'

/**
 * ─── How far a sitter's root has to rise, and why it is not zero ────────────
 *
 * `combat/postures.ts` solves the seated leg from **the rig's bind-pose bone
 * lengths** — hip 0.62, thigh 0.27, shin 0.27 — and every figure in the game is
 * that rig under a **uniform group scale**. `cast.ts` spends 0.94 to 1.07 of it
 * on making adults tell each other apart, and two much larger numbers on the
 * two children: Arthus is **0.68** and Lena is **0.62**.
 *
 * The clip does not know that. It lowers the pelvis to `seat + 0.09` in *rig*
 * units, which the group scale then multiplies — so a figure at 0.68 puts its
 * hips 0.29 m above its own feet on a stool whose top is 0.34 m above the
 * floor. Measured in the browser, on the boy the frame act is played as: he sat
 * **10 cm inside the stool**, with his feet flat on the boards. It is the same
 * class of defect as a figure whose feet hang 25 cm above the floor, which is
 * the failure `postures.ts` was written to end, and it is invisible to every
 * test that does not render.
 *
 * The fix is a lift on the root rather than a change to the clip, and the
 * reason is what a child on an adult's stool actually looks like: their
 * backside is on the seat and **their feet do not reach the floor**. A clip
 * change would keep the feet down and fold the legs further, which is a
 * different, shorter person rather than the same person on tall furniture.
 *
 *     hips now  = ground + s·(S + B)          the clip, scaled
 *     hips want = seatY  + s·B  =  ground + S + s·B
 *     lift      = S·(1 − s)
 *
 * — where `S` is the seat's height above the ground the figure is standing on
 * and `B` is `BUTTOCK`, which cancels. So the lift needs neither the buttock
 * offset nor the bone lengths, only the seat and the scale, and it is exactly
 * zero for an unscaled figure. It goes *negative* for a figure scaled above 1,
 * which is right and is not hypothetical: the sandbox player is scaled to a
 * 1.8 m capsule, i.e. 1.154, and would otherwise hover 5 cm over the plank.
 *
 * Ramped by the posture blend for the same reason everything else here is: at
 * blend 0 the figure is standing on the floor and the lift must be nothing.
 */
export const seatRootLift = (seatAboveGround: number, figureScale: number, blend: number): number =>
  seatAboveGround * (1 - figureScale) * Math.max(0, Math.min(1, blend))

/**
 * The five members a sitter has to have.
 *
 * `Combatant` satisfies it structurally and so does a six-line adapter over
 * `PlayerController` — which is the point, because the sandbox route's player
 * is not a combatant and the same state machine has to drive both.
 *
 * `postureBlend` is read-only here on purpose: whoever advances it owns the
 * clock, and in the chapter that is `CombatDirector`, which keeps running it
 * through a frozen dialogue beat.
 */
export interface SitActor {
  x: number
  z: number
  /** 0 standing, 1 fully seated. Advanced by the host, never by this class. */
  readonly postureBlend: number
  sit(seat: SeatKind): void
  stand(): void
}

/**
 * How near the approach point counts as arrived, in metres.
 *
 * 0.12, against the ~5.8 cm a 3.5 m/s walk covers in a 60 Hz frame — so the
 * arrival test cannot be stepped over, and the residual error is folded into
 * the settle slide anyway.
 */
const ARRIVE = 0.12

/**
 * Seconds before a walk-up gives up.
 *
 * A seat is at most `SIT_RANGE` (3.4 m) away and the walk covers that in about
 * a second, so four is not a tuning number — it is "something is wrong". The
 * something is real: the storyteller's room has a hearth 2.3 m tall between
 * parts of it, and a player who asks for a stool from the wrong side of it
 * would otherwise stand pressed against the stonework with their controls
 * taken away, permanently, with no way to say no.
 */
const WALK_TIMEOUT = 4

/**
 * Seconds of no progress before a walk-up gives up.
 *
 * The timeout above catches a route that is blocked outright; this catches one
 * that is blocked *after* some progress — walking round a table and stalling on
 * its far leg. 1 cm over three quarters of a second is well under what a walk
 * that is actually working produces.
 */
const STALL_SECONDS = 0.75
const STALL_PROGRESS = 0.01

export class SitController {
  private state: SitPhase = 'idle'
  private target: WorldSeat | null = null

  /** The yaw the sitter ends up at. Resolved once, when the seat is asked for. */
  private seatYaw = 0
  /** A body radius in front of the seat: where the walk ends and the stand exits. */
  private exitX = 0
  private exitZ = 0
  /** Where the settle slide starts from, i.e. where the walk actually stopped. */
  private entryX = 0
  private entryZ = 0

  private walkTime = 0
  private stallTime = 0
  private lastDistance = Infinity

  // ── What the host reads to drive the actor ─────────────────────────────────
  //
  // Plain fields, rewritten in place every frame. A struct returned from
  // `update` would be one allocation a frame for the whole time somebody is
  // sitting down, which GDD §5.2 rules out and which is exactly the shape of
  // garbage that never shows up in a profile as anything but "GC".

  /** Unnormalised steer, world space. Zero unless the walk is running. */
  moveX = 0
  moveZ = 0
  /** Fraction of the actor's own move speed. Zero unless the walk is running. */
  throttle = 0
  /** The yaw the actor should be turning toward this frame. */
  facing = 0

  get phase(): SitPhase {
    return this.state
  }

  /** The seat being used or walked to, or null. */
  get seat(): WorldSeat | null {
    return this.target
  }

  /** True whenever the machine has taken the controls. */
  get active(): boolean {
    return this.state !== 'idle'
  }

  /** True while the player is in a seat, or on their way into one. */
  get holding(): boolean {
    return this.state === 'walking' || this.state === 'sitting' || this.state === 'seated'
  }

  /** True once the figure is all the way down. The HUD's "press … to stand". */
  get seated(): boolean {
    return this.state === 'seated'
  }

  /**
   * Asks for a seat.
   *
   * `fromX/fromZ` is where the player was standing when they pressed the key,
   * and it decides the facing — see `resolveSeatFacing`. Refused while the
   * machine is doing anything else, so a held key cannot restart the walk every
   * frame.
   */
  request(seat: WorldSeat, fromX: number, fromZ: number): boolean {
    if (this.state !== 'idle') {
      return false
    }
    this.target = seat
    this.seatYaw = resolveSeatFacing(seat, fromX, fromZ)
    this.exitX = seat.x + Math.sin(this.seatYaw) * seat.approach
    this.exitZ = seat.z + Math.cos(this.seatYaw) * seat.approach
    this.state = 'walking'
    this.walkTime = 0
    this.stallTime = 0
    this.lastDistance = Infinity
    this.facing = this.seatYaw
    return true
  }

  /**
   * Gets up, playing the sit backwards.
   *
   * A no-op unless there is something to get out of, so the caller can wire it
   * to Escape without asking first — and `escape()` in the chapter's director
   * needs the boolean to decide whether the pause menu should open instead.
   */
  release(actor: SitActor): boolean {
    if (this.state === 'walking') {
      // Nothing has been committed yet: no posture, no slide. Hand the controls
      // straight back.
      this.reset()
      return true
    }
    if (this.state === 'sitting' || this.state === 'seated') {
      actor.stand()
      this.state = 'standing'
      return true
    }
    return false
  }

  /**
   * Drops everything, now.
   *
   * The world's exit rather than the player's: a blow landing, a fight starting,
   * a beat cutting to another actor, a save being loaded. The posture is cleared
   * rather than played out, and the actor is put on the approach point in one
   * write — a figure left standing inside a chair when five bandits arrive is
   * the sort of thing that reads as the game having broken.
   */
  cancel(actor: SitActor): void {
    if (this.state === 'idle' || !this.target) {
      return
    }
    actor.stand()
    // ── Only if they are still on the seat this machine put them on ────────
    //
    // A load, a retry and the cut between the two timeframes all cancel a sit
    // and all three place the player themselves, before or after — and two of
    // them place them 1.7 km away. Writing the approach point unconditionally
    // would teleport a restored save back to a bench in a village the beat has
    // just left. A metre of tolerance is far more than the settle slide can
    // have produced and far less than any of those moves.
    const dx = actor.x - this.target.x
    const dz = actor.z - this.target.z
    if (this.state !== 'walking' && dx * dx + dz * dz <= 1) {
      actor.x = this.exitX
      actor.z = this.exitZ
    }
    this.reset()
  }

  private reset(): void {
    this.state = 'idle'
    this.target = null
    this.moveX = 0
    this.moveZ = 0
    this.throttle = 0
  }

  /**
   * One frame.
   *
   * Runs **before** whatever advances `postureBlend`, so every decision it
   * makes is against last frame's blend. That is one frame of lag on two state
   * changes a chapter apart and it buys the thing that matters: the actor's
   * position for this frame is written before the mover reads it, so the
   * transform the character is drawn at is this frame's rather than last.
   */
  update(dt: number, actor: SitActor): void {
    const seat = this.target
    if (!seat) {
      return
    }
    this.moveX = 0
    this.moveZ = 0
    this.throttle = 0

    switch (this.state) {
      case 'walking': {
        const dx = this.exitX - actor.x
        const dz = this.exitZ - actor.z
        const distance = Math.hypot(dx, dz)
        if (distance < ARRIVE) {
          this.entryX = actor.x
          this.entryZ = actor.z
          this.state = 'sitting'
          this.facing = this.seatYaw
          actor.sit(seat.kind)
          return
        }
        this.walkTime += dt
        // Progress, or the lack of it. Both give up rather than pinning a
        // player against whatever is in the way — see the constants.
        if (distance > this.lastDistance - STALL_PROGRESS) {
          this.stallTime += dt
        } else {
          this.stallTime = 0
        }
        this.lastDistance = distance
        if (this.walkTime > WALK_TIMEOUT || this.stallTime > STALL_SECONDS) {
          this.reset()
          return
        }
        this.moveX = dx
        this.moveZ = dz
        // Eased down over the last half metre so the walk lands on the mark
        // instead of arriving at a run and being stopped by the tolerance.
        this.throttle = Math.min(1, distance / 0.5)
        this.facing = Math.atan2(dx, dz)
        return
      }

      case 'sitting': {
        this.facing = this.seatYaw
        const blend = actor.postureBlend
        actor.x = this.entryX + (seat.x - this.entryX) * blend
        actor.z = this.entryZ + (seat.z - this.entryZ) * blend
        if (blend >= 1) {
          this.state = 'seated'
        }
        return
      }

      case 'seated': {
        this.facing = this.seatYaw
        actor.x = seat.x
        actor.z = seat.z
        return
      }

      case 'standing': {
        this.facing = this.seatYaw
        // The blend runs 1 → 0, so the same interpolation that put the figure on
        // the seat takes it back off — ending exactly on the approach point.
        const blend = actor.postureBlend
        actor.x = this.exitX + (seat.x - this.exitX) * blend
        actor.z = this.exitZ + (seat.z - this.exitZ) * blend
        if (blend <= 0) {
          this.reset()
        }
        return
      }

      default:
        return
    }
  }
}
