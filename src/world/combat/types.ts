import type { BoneName } from '../characters/rig'

/**
 * ─── The combat contract ────────────────────────────────────────────────────
 *
 * One file, no three.js, no Vue, so the rules can be reasoned about and tested
 * without a scene — the same split `level/types.ts` makes for placement and
 * `characters/equipment.ts` makes for gear.
 *
 * ── What this is for ────────────────────────────────────────────────────────
 *
 * Chapter 1 has two fights and they want opposite things from a combat system.
 *
 *   * **The boar.** One animal, four times the player's mass, that has already
 *     broken out of a net. It charges in a straight line, it cannot be blocked,
 *     and the correct answer is to get out of the way and shoot it. It is a
 *     *spacing* fight.
 *   * **The bandits.** Five men with short swords who arrive together at four
 *     paces. Two of them are shot before they land, the other three are a melee
 *     the group wins because they are outnumbered rather than outfought — the
 *     prose says so. It is a *crowd* fight.
 *
 * A system that only does one of those makes the other unreadable. So the model
 * below is deliberately the small standard action-RPG one — stamina, poise,
 * guard, parry, i-frames — rather than anything novel, because every one of
 * those five exists to make exactly this pair of situations legible:
 *
 *   | mechanic  | what it is for                                              |
 *   |-----------|-------------------------------------------------------------|
 *   | stamina   | you cannot solve the crowd by holding block                 |
 *   | poise     | a big attack goes through a small one; a boar goes through   |
 *   |           | everything                                                   |
 *   | guard     | the answer to a sword, and no answer at all to 400 kg        |
 *   | parry     | the *skilled* answer to a sword, on a 0.16 s window          |
 *   | i-frames  | the only answer to the boar                                  |
 *
 * ── Everything here is per-second and per-metre ─────────────────────────────
 *
 * No abstract "attack power". Damage is in hit points, reach is in metres,
 * timings are in seconds, and the numbers in `movesets.ts` are chosen against a
 * 1.56 m figure that walks at 1.5 m/s. That is what makes them tunable by
 * someone who has not read this file: a reach of 1.9 is a reach you can pace
 * out.
 */

/**
 * Who may hit whom.
 *
 * Three, not two, and the third is doing real work. A `beast` is hostile to the
 * party *and* has no interest in the bandits — Chapter 1 never puts them on
 * screen together, but the trap sequence and the ambush share one director, and
 * a boar that helpfully mauls the bandits would be a comedy. It also lets the
 * boar ignore every rule that exists for people: it cannot be parried, it does
 * not block, and its poise is high enough that nothing in the chapter staggers
 * it.
 */
export type Team = 'party' | 'foe' | 'beast'

export const isHostile = (a: Team, b: Team): boolean => a !== b && !(a === 'foe' && b === 'beast') && !(a === 'beast' && b === 'foe')

/**
 * Damage types.
 *
 * They are not a rock-paper-scissors table and must not become one. What they
 * actually select is the *hit reaction* and the sound of it — a pierce staggers
 * less and bleeds more, blunt staggers most — plus one real rule: **pierce is
 * what a bow does, and a bow is the only thing in the chapter that reaches the
 * boar safely.** Resistances would make the chapter's one tactical fact into a
 * lookup table.
 */
export type DamageType = 'slash' | 'pierce' | 'blunt'

/**
 * What a combatant is doing right now.
 *
 * A single enum for the whole actor rather than a set of booleans, for the same
 * reason `DrawnState` is one: two independent booleans have four states, two of
 * which are nonsense, and both of which are reachable. A character cannot be
 * mid-swing and mid-dodge.
 */
export type Stance =
  | 'idle'
  /** Committed, not yet dangerous. The window in which you can still be hit first. */
  | 'windup'
  /** The blade is live. Hit volumes are only tested during this. */
  | 'active'
  /** Committed, no longer dangerous. Where a chain input is buffered. */
  | 'recovery'
  /** Guard up. Costs stamina per blow, not per second. */
  | 'block'
  /** The first fraction of a block. See `PARRY_WINDOW`. */
  | 'parry'
  /** Rolling. Carries invulnerability over part of its length. */
  | 'dodge'
  /** Hit through your poise. You cannot act. */
  | 'stagger'
  /** Dead, or on the ground and out of the fight. */
  | 'down'

/** Stances during which input is ignored. */
export const COMMITTED: ReadonlySet<Stance> = new Set<Stance>(['windup', 'active', 'recovery', 'dodge', 'stagger', 'down'])

/**
 * ─── Pose clips ─────────────────────────────────────────────────────────────
 *
 * An attack is a list of keyframes over normalised time, each naming a few bone
 * rotations. Between keys the components are lerped and the result is *blended*
 * onto whatever the gait already produced, which is what lets a character swing
 * while walking without a second animation for "walking swing".
 *
 * ── Euler, not quaternion, and why that is safe here ────────────────────────
 *
 * `Character.blendPose` makes the same choice and gives the same reason: every
 * joint in this rig is dominated by a single axis and consecutive keys are close
 * by construction, so the gimbal cases a slerp exists to handle cannot arise.
 * What it buys is that a key is three readable numbers per bone — a swing can be
 * *authored* rather than captured — and that evaluation is a multiply per
 * component with no normalisation and no allocation.
 *
 * ── Sign conventions, because they are not guessable ────────────────────────
 *
 * From `rig.ts` and `equipment.ts`, both of which say so and both of which have
 * been got backwards once:
 *
 *   * The character faces **+Z**, and **+X is its LEFT**.
 *   * A **positive** `rotation.y` on the chest therefore turns the torso toward
 *     the character's *left*; a right-handed swing winds up **negative** and
 *     follows through positive.
 *   * A **negative** `rotation.x` on an upper arm raises it *forward*. (The arm
 *     hangs roughly −Y in bind; rotating about X sends −Y toward +Z when the
 *     angle is negative.)
 *   * A **negative** `rotation.z` on `upperArm.R` lifts that arm *away from the
 *     body* — the right arm is on −X, so abduction is the negative direction and
 *     the left arm's is the positive one. This pair is the single most common
 *     source of a mirrored-looking pose.
 */
export type BonePose = Partial<Record<BoneName, readonly [number, number, number]>>

export interface PoseKey {
  /** Normalised time within the clip, 0..1, ascending. First must be 0, last 1. */
  t: number
  bones: BonePose
  /** Vertical offset of the hips, metres. Crouches and lunges use it. */
  hips?: number
  /**
   * Yaw applied to the **whole figure**, radians.
   *
   * Separate from the chest's own twist because they are different things: a
   * spinning axe swing turns the character on the spot and their feet have to go
   * with them, while a sword's cut turns the torso *against* planted feet. The
   * director applies this to the group and the chest twist to a bone.
   */
  yaw?: number
}

export type PoseClip = readonly PoseKey[]

/** How a hit lands, handed to whatever wants to react to it. */
export interface HitEvent {
  attackerId: string
  targetId: string
  /** After guard, resistances and criticals. What actually came off the bar. */
  damage: number
  type: DamageType
  /** True when the target had guard up and ate it. */
  blocked: boolean
  /** True when the target's guard was inside its parry window. */
  parried: boolean
  /** True when this hit took the target's poise to zero. */
  staggered: boolean
  /** True when this hit took the target's last hit point. */
  killed: boolean
  /** World position of the contact, for a spark or a decal. */
  x: number
  y: number
  z: number
}

/**
 * How long a block counts as a parry, in seconds.
 *
 * 0.16, and the number is chosen from the *animation*, not from feel: a bandit's
 * light attack has a 0.28 s windup (`movesets.ts`), so a parry window of 0.16
 * means the defender has to react inside the first 57 % of a swing they can see
 * starting. Any wider and holding block on reflex parries everything; any
 * narrower and the window is under four frames at 30 fps, which is a mechanic
 * only a frame counter can use.
 */
export const PARRY_WINDOW = 0.16

/** Seconds a staggered actor cannot act for. */
export const STAGGER_SECONDS = 0.62

/** Fraction of an unblocked hit that gets through a raised guard. */
export const BLOCK_LEAK = 0.18

/** Stamina spent per point of damage absorbed by a guard. */
export const BLOCK_STAMINA_PER_DAMAGE = 0.9

/**
 * What happens when a guard runs out of stamina.
 *
 * The guard *breaks* — the actor is staggered and the whole blow lands — rather
 * than the guard simply failing to come up. That asymmetry is the entire reason
 * stamina exists in this design: without a break, running out of stamina is a
 * mild inconvenience you notice a second later, and blocking stays the correct
 * answer to five men. With it, the crowd fight has a losing line you can walk
 * into and see yourself walking into.
 */
export const GUARD_BREAK_STAGGER = 0.95

export interface CombatantStats {
  maxHp: number
  maxStamina: number
  /** Stamina regained per second while not blocking or attacking. */
  staminaRegen: number
  /** Delay after spending stamina before regeneration resumes, seconds. */
  staminaDelay: number
  /**
   * Resistance to being interrupted. Poise is spent by incoming hits and
   * refills; at zero the actor staggers and poise resets to full.
   *
   * The boar's is 100 against a bandit's 22 for a reason the chapter states: the
   * thing has already chewed through a net.
   */
  maxPoise: number
  poiseRegen: number
  /** Metres per second on the ground. */
  moveSpeed: number
  /**
   * Multiplies everything this fighter deals.
   *
   * On the *wielder*, never on the attack, because attacks are shared: `bladeA`
   * is what Athalus, Theodor and five bandits all throw, so tuning it down to
   * make the ambush survivable would tune the player's own chain down by exactly
   * as much.
   *
   * Set from a measurement rather than from taste. With every fighter at 1.0 the
   * ambush took a standing player from 76 hit points to 0 in **2.4 seconds** —
   * two attackers, no gaps, no time to read a wind-up. `HIT_GRACE` in
   * `Combatant.ts` fixed the gaps; this fixes the arithmetic. Together they
   * leave a fight a player who blocks and rolls wins and one who stands still
   * loses, which is the fight Chapter 1 describes.
   *
   * Optional, defaulting to 1: the four leads and the boar are all 1, and only
   * the bandits are not.
   */
  might?: number
  /** Body radius for hit tests, metres. */
  radius: number
  /** Chest height for hit tests, metres. */
  height: number
}
