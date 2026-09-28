import type { Bone } from 'three'
import { BONE_NAMES, type BoneName } from '../characters/rig'
import type { PoseTargets } from '../characters/poses'
import { ATTACKS, type AttackDef, MOVESETS, type MovesetId, scalingFor, type WeaponScaling } from './movesets'
import {
  BLOCK_LEAK,
  BLOCK_STAMINA_PER_DAMAGE,
  COMMITTED,
  type CombatantStats,
  type DamageType,
  GUARD_BREAK_STAGGER,
  PARRY_WINDOW,
  type PoseClip,
  type Stance,
  STAGGER_SECONDS,
  type Team
} from './types'
import type { ItemKind } from '../characters/equipment'
import { type Posture, type SeatKind, SIT_SECONDS } from './postures'

/**
 * ─── One fighter ────────────────────────────────────────────────────────────
 *
 * State, timers, and the rules for changing between them. It owns **no scene
 * objects at all** — not the character, not the mesh, not the position — and
 * that is the whole point of the shape.
 *
 * The director tells it where it is each frame and reads back where it wants to
 * be; the character reads back a pose. Nothing here imports three.js except a
 * `Bone` type for the pose writer, and nothing here allocates.
 *
 * ── Why the timers are three fields and not a queue ─────────────────────────
 *
 * An attack is `windup → active → recovery`, and the obvious implementation is
 * a small state machine with a queue of phases. It is the wrong shape for one
 * reason that matters: **the pose is a function of progress through the whole
 * attack**, not through the current phase, so a queue means every pose lookup
 * has to reconstruct the total elapsed time from the phases already popped.
 * Keeping one `attackTime` against one `AttackDef` makes both the phase test and
 * the pose lookup a comparison.
 *
 * ── Buffering, and why the window is the recovery ───────────────────────────
 *
 * Input during `windup` or `active` is dropped; input during `recovery` is
 * *buffered* and fires the chain's next attack the instant recovery ends. That
 * is the standard rule and it is worth stating why it is not "buffer always":
 * buffering during the windup lets a player queue three attacks on one frame of
 * panic and then watch the character play them out with no further input, which
 * is the feeling of having lost control rather than of having committed.
 */

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

export interface CombatantOptions {
  id: string
  team: Team
  stats: CombatantStats
  moveset: MovesetId
  /** Scales damage, reach, speed and stamina. See `movesets.ts::WeaponScaling`. */
  weapon?: ItemKind | null
  /** Starts the actor already down — for a corpse, or a spawn that waits. */
  dead?: boolean
}

export class Combatant {
  readonly id: string
  readonly team: Team
  readonly stats: CombatantStats

  hp: number
  stamina: number
  poise: number

  stance: Stance = 'idle'
  /** Yaw the actor is facing, radians. The director writes this. */
  facing = 0

  // ── Sitting ───────────────────────────────────────────────────────────────
  //
  // Three plain fields rather than a state machine, and they live on the
  // combatant rather than on the `Character` for the reason the whole layer is
  // built on: `combat/` never touches the scene graph. A posture is a fact about
  // an actor — "this one is in a chair" — and `CombatDirector.settle` is the
  // only thing that turns it into bones, exactly as it is the only thing that
  // turns `attack` into bones.
  //
  // It is also why the boar can be here at all: `TrollBoar` is a seven-bone
  // quadruped that will never sit, and it pays for this in one float it leaves
  // at zero.

  /** Where this actor is sitting, or `'stand'`. Set through `sit` / `stand`. */
  posture: Posture = 'stand'
  /**
   * 0 while standing, 1 when fully seated, and everything between while the
   * figure is on its way into or out of the seat.
   *
   * Advanced by `advancePosture` from the **real** frame delta rather than from
   * the combat `dt`, because sitting down happens during a *dialogue* beat —
   * which is precisely when `CombatDirector.enabled` is false and every other
   * timer in this class is frozen.
   */
  postureBlend = 0
  /**
   * The seat the blend is animating toward, kept while standing back up.
   *
   * Without it, `stand()` would have to clear the posture immediately and the
   * figure would pop upright: the clip that gets it out of the chair is the same
   * clip that got it in, run backwards, and it needs to know which chair.
   */
  seatedAs: SeatKind = 'stool'

  /** Where the actor is. Written by the director every frame, read by hit tests. */
  x = 0
  y = 0
  z = 0

  /** What the actor wants this frame, in metres per second. The director resolves it. */
  wantX = 0
  wantZ = 0

  moveset: MovesetId
  weapon: ItemKind | null
  scaling: WeaponScaling

  /** The attack in flight, or null. */
  attack: AttackDef | null = null
  attackTime = 0
  /** Set once per attack, when `active` begins, so one swing lands once. */
  private resolved = false
  /** Buffered chain input; consumed when recovery ends. */
  private buffered = false

  /**
   * Seconds since the current stance began.
   *
   * Public because three things outside this class are functions of it and none
   * of them can be derived from anything else: the dodge's speed curve, the
   * stagger's recoil clip, and the HUD's parry flash. Read-only by convention —
   * `setStance` is the only writer, and it is private.
   */
  stanceTime = 0
  private staminaHold = 0
  /** Counts down while invulnerable. Dodges set it. */
  private iFrames = 0
  /**
   * Counts down after an unblocked hit lands. See `HIT_GRACE`.
   *
   * Separate from `iFrames` because they mean different things and one of them
   * is earned: `iFrames` is the reward for a well-timed roll and stops
   * *everything*; this is a floor on how fast damage can arrive at all, and a
   * blocked hit does not set it.
   */
  private grace = 0
  /** Set by a parry, read by the director to stagger the attacker. */
  parriedThisFrame = false

  /**
   * How much of the attack's lunge has already been applied.
   *
   * Tracked as a *distance already spent* rather than derived from progress,
   * because the director may refuse part of a lunge (a wall, another fighter)
   * and the next frame must not try to make it up — an attack that teleports
   * through a tree because it was blocked for two frames is worse than one that
   * falls short.
   */
  lungeSpent = 0

  constructor(options: CombatantOptions) {
    this.id = options.id
    this.team = options.team
    this.stats = options.stats
    this.moveset = options.moveset
    this.weapon = options.weapon ?? null
    this.scaling = scalingFor(this.weapon)
    this.hp = options.dead ? 0 : options.stats.maxHp
    this.stamina = options.stats.maxStamina
    this.poise = options.stats.maxPoise
    if (options.dead) {
      this.stance = 'down'
    }
  }

  get alive(): boolean {
    return this.hp > 0
  }

  get busy(): boolean {
    return COMMITTED.has(this.stance)
  }

  get invulnerable(): boolean {
    return this.iFrames > 0
  }

  get hpFraction(): number {
    return clamp01(this.hp / this.stats.maxHp)
  }

  get staminaFraction(): number {
    return clamp01(this.stamina / this.stats.maxStamina)
  }

  setWeapon(kind: ItemKind | null, moveset: MovesetId): void {
    this.weapon = kind
    this.scaling = scalingFor(kind)
    this.moveset = moveset
  }

  // ── Phase queries ────────────────────────────────────────────────────────

  /** Total length of the attack in flight, after weapon speed scaling. */
  private get attackLength(): number {
    const a = this.attack
    return a === null ? 0 : (a.windup + a.active + a.recovery) * this.scaling.speed
  }

  /** 0..1 through the whole attack. What the pose is sampled at. */
  get attackProgress(): number {
    const length = this.attackLength
    return length <= 0 ? 0 : clamp01(this.attackTime / length)
  }

  /** Poise this actor currently has on top of its own — super-armour. */
  get armour(): number {
    return this.stance === 'active' || this.stance === 'windup' ? (this.attack?.superArmour ?? 0) : 0
  }

  // ── Intent ───────────────────────────────────────────────────────────────

  /**
   * Requests a light attack.
   *
   * Returns whether anything happened, so a player controller can decide not to
   * play a swing sound. It refuses when committed *unless* the actor is in
   * recovery and the current attack chains — in which case the input is
   * buffered, which is the whole reason this returns true there.
   */
  requestLight(): boolean {
    if (this.stance === 'recovery' && this.attack?.next) {
      this.buffered = true
      return true
    }
    if (this.busy) {
      return false
    }
    return this.startAttack(MOVESETS[this.moveset].light)
  }

  requestHeavy(): boolean {
    if (this.busy) {
      return false
    }
    return this.startAttack(MOVESETS[this.moveset].heavy)
  }

  /** Starts a named attack, if there is stamina for it. */
  startAttack(id: string): boolean {
    const def = ATTACKS[id]
    if (!def) {
      return false
    }
    const cost = def.staminaCost * this.scaling.effort
    if (this.stamina < cost) {
      return false
    }
    this.spendStamina(cost)
    this.attack = def
    this.attackTime = 0
    this.resolved = false
    this.buffered = false
    this.lungeSpent = 0
    this.setStance('windup')
    return true
  }

  /**
   * Holds or drops the guard.
   *
   * Raising it from idle enters `parry` for `PARRY_WINDOW` seconds and then
   * falls through to `block`. Holding the button does **not** re-arm the parry —
   * that is what makes it a timing input rather than a state.
   */
  setGuard(up: boolean): void {
    if (!MOVESETS[this.moveset].canBlock) {
      return
    }
    if (up) {
      if (this.stance === 'idle') {
        this.setStance('parry')
      }
      return
    }
    if (this.stance === 'block' || this.stance === 'parry') {
      this.setStance('idle')
    }
  }

  get guarding(): boolean {
    return this.stance === 'block' || this.stance === 'parry'
  }

  /**
   * Rolls.
   *
   * The i-frames start 0.09 s in and last 0.25 s, over a 0.55 s roll. Both ends
   * matter: a roll that is invulnerable from frame one lets a player dodge
   * *reactively* with no risk, and one that is invulnerable to the end lets them
   * dodge through a second attack on the recovery. The gap at each end is what
   * makes the timing a skill.
   */
  requestDodge(): boolean {
    if (this.busy || !MOVESETS[this.moveset].canDodge) {
      return false
    }
    if (this.stamina < DODGE_STAMINA) {
      return false
    }
    this.spendStamina(DODGE_STAMINA)
    this.setStance('dodge')
    return true
  }

  private setStance(next: Stance): void {
    this.stance = next
    this.stanceTime = 0
    if (next !== 'windup' && next !== 'active' && next !== 'recovery') {
      this.attack = null
      this.attackTime = 0
    }
  }

  private spendStamina(amount: number): void {
    this.stamina = Math.max(0, this.stamina - amount)
    this.staminaHold = this.stats.staminaDelay
  }

  // ── Per-frame ────────────────────────────────────────────────────────────

  /**
   * Advances timers. Returns the distance the actor should lunge this frame,
   * which the director applies through the collision world.
   *
   * The lunge is *returned* rather than applied because this class does not know
   * where walls are, and an attack that moves an actor into a tree is a bug the
   * collision world already knows how to prevent. See `lungeSpent`.
   */
  update(dt: number): number {
    this.parriedThisFrame = false
    this.stanceTime += dt
    if (this.iFrames > 0) {
      this.iFrames -= dt
    }
    if (this.grace > 0) {
      this.grace -= dt
    }

    if (this.stance === 'down') {
      return 0
    }

    // Stamina. Held off for `staminaDelay` after any spend, so a player who
    // attacks continuously never regenerates — which is what makes the crowd
    // fight a resource problem rather than a button-mash.
    if (this.staminaHold > 0) {
      this.staminaHold -= dt
    } else if (!this.guarding) {
      this.stamina = Math.min(this.stats.maxStamina, this.stamina + this.stats.staminaRegen * dt)
    }
    if (this.poise < this.stats.maxPoise) {
      this.poise = Math.min(this.stats.maxPoise, this.poise + this.stats.poiseRegen * dt)
    }

    switch (this.stance) {
      case 'stagger':
        if (this.stanceTime >= STAGGER_SECONDS) {
          this.setStance('idle')
        }
        return 0
      case 'dodge': {
        if (this.stanceTime >= DODGE_SECONDS) {
          this.setStance('idle')
        } else if (this.stanceTime >= DODGE_IFRAME_START && this.stanceTime < DODGE_IFRAME_END) {
          this.iFrames = 0.05
        }
        return 0
      }
      case 'parry':
        if (this.stanceTime >= PARRY_WINDOW) {
          this.stance = 'block'
        }
        return 0
      default:
        break
    }

    const attack = this.attack
    if (!attack) {
      return 0
    }

    this.attackTime += dt
    const speed = this.scaling.speed
    const windup = attack.windup * speed
    const active = attack.active * speed
    const total = windup + active + attack.recovery * speed

    if (this.attackTime < windup) {
      this.stance = 'windup'
    } else if (this.attackTime < windup + active) {
      if (this.stance !== 'active') {
        this.stance = 'active'
        this.resolved = false
      }
    } else if (this.attackTime < total) {
      this.stance = 'recovery'
    } else {
      // Chain, or drop out. The buffered flag is consumed either way — a
      // buffered input that finds no chain is discarded rather than fired as a
      // fresh opener, so mashing during a finisher does not restart the chain.
      const next = this.buffered ? attack.next : undefined
      this.buffered = false
      if (next) {
        this.startAttack(next)
      } else {
        this.setStance('idle')
      }
      return 0
    }

    // The lunge is spread over the windup and active windows only — an attack
    // that keeps sliding through its recovery reads as ice.
    const lungeWindow = windup + active
    const wanted = attack.lunge * clamp01(this.attackTime / lungeWindow)
    const step = Math.max(0, wanted - this.lungeSpent)
    this.lungeSpent = wanted
    return step
  }

  /** True on the frames this attack's hit test should run. */
  shouldResolve(): boolean {
    if (this.stance !== 'active' || this.resolved) {
      return false
    }
    this.resolved = true
    return true
  }

  // ── Taking a hit ─────────────────────────────────────────────────────────

  /**
   * Applies an incoming hit and returns what actually happened.
   *
   * Ordering matters and is the reason this is one function rather than a
   * pipeline the director assembles:
   *
   *   1. i-frames win over everything, including a guard break;
   *   2. a **parry** consumes the hit entirely and flags the attacker;
   *   3. a **block** leaks `BLOCK_LEAK` of the damage and spends stamina — and
   *      if the stamina is not there, the guard *breaks* and the full blow lands
   *      on a staggered target;
   *   4. poise is spent last, so a blocked hit still contributes to a guard
   *      being broken over several blows.
   */
  receive(
    damage: number,
    poiseDamage: number,
    _type: DamageType,
    fromFacing: number
  ): { damage: number; blocked: boolean; parried: boolean; staggered: boolean; killed: boolean } {
    if (!this.alive || this.iFrames > 0) {
      return { damage: 0, blocked: false, parried: false, staggered: false, killed: false }
    }

    // ── Mercy, and why a crowd needs it ────────────────────────────────────
    //
    // `AGGRO_TOKENS` caps the ambush at two attackers, and that is *not* enough
    // on its own: two men with 0.16 s wind-ups and no rule against overlapping
    // took a standing player from 76 to 0 in **2.4 seconds** — measured, in the
    // browser, on the meadow this chapter is fought in. There is no counterplay
    // to that; there is not even time to see it happen.
    //
    // So an unblocked hit opens a short window in which the next one cannot
    // land. It is not invulnerability: a *blocked* hit does not set it (blocking
    // has its own cost, in stamina) and neither does an arrow, so a guard is
    // still worth holding and an archer is still worth avoiding. What it removes
    // is the specific failure of being hit twice by two people in one tenth of a
    // second, which reads as a bug rather than as being outnumbered.
    if (this.grace > 0) {
      return { damage: 0, blocked: false, parried: false, staggered: false, killed: false }
    }

    let blocked = false
    let parried = false

    if (this.guarding) {
      // A guard only covers the front. `fromFacing` is the direction from the
      // target to the attacker; anything more than ~70° off the facing goes
      // straight through, which is the reason flanking is worth doing and why
      // the bandit brain (`brains.ts`) tries to.
      let delta = fromFacing - this.facing
      while (delta > Math.PI) delta -= Math.PI * 2
      while (delta < -Math.PI) delta += Math.PI * 2
      if (Math.abs(delta) < GUARD_ARC) {
        if (this.stance === 'parry') {
          this.parriedThisFrame = true
          this.stamina = Math.min(this.stats.maxStamina, this.stamina + PARRY_STAMINA_REFUND)
          return { damage: 0, blocked: true, parried: true, staggered: false, killed: false }
        }
        const cost = damage * BLOCK_STAMINA_PER_DAMAGE
        if (this.stamina >= cost) {
          this.spendStamina(cost)
          blocked = true
          damage *= BLOCK_LEAK
          poiseDamage *= 0.35
        } else {
          // Guard break. Full damage, and a stagger long enough to be punished.
          this.spendStamina(this.stamina)
          this.setStance('stagger')
          this.stanceTime = STAGGER_SECONDS - GUARD_BREAK_STAGGER
          this.poise = this.stats.maxPoise
          this.hp = Math.max(0, this.hp - damage)
          const killed = this.hp <= 0
          if (killed) {
            this.setStance('down')
          }
          return { damage, blocked: false, parried: false, staggered: true, killed }
        }
      }
    }

    this.hp = Math.max(0, this.hp - damage)
    if (!blocked) {
      this.grace = HIT_GRACE
    }
    const killed = this.hp <= 0
    if (killed) {
      this.setStance('down')
      return { damage, blocked, parried, staggered: false, killed }
    }

    // Poise is spent against the *total* resistance — the actor's own plus any
    // super-armour the attack they are mid-way through grants them. That is what
    // lets a committed heavy swing trade through a light hit and still land.
    this.poise -= Math.max(0, poiseDamage - this.armour)
    let staggered = false
    if (this.poise <= 0) {
      this.poise = this.stats.maxPoise
      this.setStance('stagger')
      staggered = true
    }
    return { damage, blocked, parried, staggered, killed }
  }

  /** Kills outright, for scripted deaths. */
  /** Takes a seat. Idempotent — asking for the seat you are already in is a no-op. */
  sit(seat: SeatKind): void {
    this.posture = seat
    this.seatedAs = seat
  }

  /** Gets up. The clip plays backwards from wherever the blend is. */
  stand(): void {
    this.posture = 'stand'
  }

  /**
   * Moves the sit/stand blend one frame.
   *
   * Called for every actor before `CombatDirector` decides whether combat is
   * running, so a household can sit down in the middle of a conversation.
   */
  advancePosture(dt: number): void {
    const target = this.posture === 'stand' ? 0 : 1
    if (this.postureBlend === target || dt <= 0) {
      return
    }
    const step = dt / SIT_SECONDS
    this.postureBlend =
      this.postureBlend < target
        ? Math.min(target, this.postureBlend + step)
        : Math.max(target, this.postureBlend - step)
  }

  kill(): void {
    this.hp = 0
    this.setStance('down')
    // A dead actor is not sitting. `settle` returns before the posture clip on
    // the death path anyway, but leaving the blend up would have anybody who is
    // killed in a chair — Chapter 2 revives five bandits who died in Chapter 1 —
    // stand back up into a sit.
    this.posture = 'stand'
    this.postureBlend = 0
  }

  revive(): void {
    this.hp = this.stats.maxHp
    this.stamina = this.stats.maxStamina
    this.poise = this.stats.maxPoise
    this.setStance('idle')
  }
}

/**
 * Seconds after an unblocked hit during which the next one cannot land.
 *
 * 0.34, which is a little over the 0.27 s a bandit's whole light attack takes.
 * That is the number it is set from: at anything under one attack's length two
 * attackers can still interleave perfectly and the mercy window buys nothing.
 */
const HIT_GRACE = 0.34

/** Seconds a roll lasts, and the window inside it that is invulnerable. */
export const DODGE_SECONDS = 0.55
const DODGE_IFRAME_START = 0.09
const DODGE_IFRAME_END = 0.34
export const DODGE_STAMINA = 18
export const DODGE_SPEED = 7.2
const PARRY_STAMINA_REFUND = 12

/**
 * Half-angle of a guard, radians.
 *
 * 1.22 rad is 70°, so a guard covers 140° of the front. Wider and there is no
 * point flanking; narrower and blocking a crowd is impossible even when done
 * correctly, which would make the ambush unwinnable rather than hard.
 */
const GUARD_ARC = 1.22

// ─── Pose evaluation ────────────────────────────────────────────────────────

const _euler = new Float32Array(3)

/**
 * Samples a clip at `t` and blends it onto whatever the bones already hold.
 *
 * **Blended, not assigned.** The gait has already run by the time this is
 * called, so assigning would freeze the legs mid-stride every time somebody
 * swung while walking — and every fight in Chapter 1 is fought while moving.
 * Blending means an attack that names only the arms leaves the walk running
 * underneath it, which is what "swing while walking" has to mean without a
 * second set of clips.
 *
 * Allocation-free: the keys are read in place and the three Euler components go
 * through a module-level `Float32Array`.
 */
export const applyClip = (bones: PoseTargets, clip: PoseClip, t: number, weight: number): number => {
  if (weight <= 0 || clip.length === 0) {
    return 0
  }
  let hi = 1
  while (hi < clip.length - 1 && clip[hi]!.t < t) {
    hi++
  }
  const a = clip[hi - 1]!
  const b = clip[hi]!
  const span = b.t - a.t
  const f = span <= 1e-6 ? 0 : clamp01((t - a.t) / span)

  for (let i = 0; i < BONE_NAMES.length; i++) {
    const name = BONE_NAMES[i]!
    const from = a.bones[name]
    const to = b.bones[name]
    if (!from && !to) {
      continue
    }
    const bone = bones.get(name) as Bone | undefined
    if (!bone) {
      continue
    }
    // A key that names a bone the neighbouring key does not is interpolated
    // against **zero**, i.e. against the bind pose, rather than against the
    // bone's current rotation. That is what makes a clip readable: a key means
    // "this is the whole of what I say about this bone", so a swing that stops
    // mentioning the legs releases them rather than holding them wherever the
    // last key happened to leave them.
    _euler[0] = ((from?.[0] ?? 0) + ((to?.[0] ?? 0) - (from?.[0] ?? 0)) * f) as number
    _euler[1] = ((from?.[1] ?? 0) + ((to?.[1] ?? 0) - (from?.[1] ?? 0)) * f) as number
    _euler[2] = ((from?.[2] ?? 0) + ((to?.[2] ?? 0) - (from?.[2] ?? 0)) * f) as number
    bone.rotation.x += (_euler[0]! - bone.rotation.x) * weight
    bone.rotation.y += (_euler[1]! - bone.rotation.y) * weight
    bone.rotation.z += (_euler[2]! - bone.rotation.z) * weight
  }

  const hips = bones.get('hips' as BoneName) as Bone | undefined
  if (hips) {
    const lift = (a.hips ?? 0) + ((b.hips ?? 0) - (a.hips ?? 0)) * f
    hips.position.y += lift * weight
  }
  return ((a.yaw ?? 0) + ((b.yaw ?? 0) - (a.yaw ?? 0)) * f) * weight
}

/**
 * How strongly an attack's clip should override the gait, given its progress.
 *
 * Not a constant 1. An attack ramps in over its first 12 % and out over its last
 * 18 %, so a swing *joins* the walk and leaves it rather than snapping. The
 * asymmetry is deliberate: the entry has to be quick or the attack feels
 * unresponsive, while the exit has to be slow or the character pops back to a
 * stride the instant the recovery ends.
 */
export const clipWeight = (progress: number): number => {
  const inWeight = clamp01(progress / 0.12)
  const outWeight = clamp01((1 - progress) / 0.18)
  return Math.min(inWeight, outWeight)
}
