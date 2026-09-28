import type { Bone, Object3D } from 'three'
import { Group, Vector3 } from 'three'
import type { BoneName } from '../characters/rig'
import type { CollisionWorld } from '../level/types'
import { applyClip, Combatant, clipWeight, DODGE_SECONDS, DODGE_SPEED } from './Combatant'
import { applyPosture } from './postures'
import { allyBrain, AGGRO_TOKENS, banditBrain, boarBrain, type BrainState, emptyBrainState, emptyIntent, errandBrain, type Errand, type Intent } from './brains'
import { ARROW_SPEED, Projectiles } from './Projectiles'
import { type HitEvent, isHostile, STAGGER_SECONDS, type Team } from './types'

/**
 * ─── The combat director ────────────────────────────────────────────────────
 *
 * One object that owns every fighter in the scene, ticks them in a fixed order,
 * and is the only thing allowed to change anything. Everything else in
 * `combat/` is either data (`movesets.ts`), a pure state machine (`Combatant`)
 * or a pure function (`brains.ts`).
 *
 * ── The frame order, and why each step is where it is ───────────────────────
 *
 *   1. **Brains** decide intent, from last frame's positions. Deciding from
 *      *this* frame's would mean the first actor in the list reacts to a world
 *      the last one has not moved in yet, which makes turn order visible.
 *   2. **Combatants** advance their own timers and report a lunge distance.
 *   3. **Movement** is resolved — walk, lunge and dodge together, once, through
 *      the collision world. One resolve per actor per frame is what keeps a
 *      lunging attacker from tunnelling through a wall a walk would have stopped.
 *   4. **Hits** are tested, on the single frame each attack goes active.
 *   5. **Characters** are posed: gait first (`Character.update`), then the attack
 *      clip blended on top.
 *   6. **Arrows** integrate and test last, because an arrow fired this frame
 *      should not be able to hit somebody who has not moved yet.
 *
 * ── What it does not own ────────────────────────────────────────────────────
 *
 * The terrain, the level, the camera, the player's input, and the story. It is
 * handed a ground sampler and a collision world at construction and it asks
 * questions of them; it never reaches back into the scene. That is what lets the
 * whole chapter's two fights share one director without the director knowing
 * that a chapter exists.
 */

/**
 * What the director needs a fighter's *body* to be.
 *
 * Structural, not `Character`, and the reason is the boar. `creatures/TrollBoar`
 * is a `SkinnedMesh` on a seven-bone quadruped rig with none of `Character`'s
 * LOD ladder, equipment layer or gait blending — and it has to go down exactly
 * the same movement, hit-test and pose path as a bandit, or the two encounters
 * in Chapter 1 are two combat systems.
 *
 * Five members, and every one of them is something the director genuinely does.
 * Widening this interface is how the boar ends up needing a wardrobe.
 */
export interface CombatBody {
  readonly group: Object3D
  readonly bones: Map<BoneName, Bone>
  setPosition(position: Vector3): void
  setFacing(radians: number): void
  update(dt: number, cameraPosition?: Vector3): void
}

/** How a single fighter is wired to the scene. */
export interface ActorOptions {
  id: string
  combatant: Combatant
  character: CombatBody
  /** `bandit`, `boar`, `ally`, or `none` for the player and for scripted extras. */
  brain: BrainKind
  /**
   * Where an ally walks relative to the leader, `[right, forward]` in metres.
   *
   * Assigned here rather than derived inside the brain because the *set* has to
   * fan out and no individual brain can see the others. See `allyBrain`.
   */
  station?: readonly [number, number]
  /** Bow damage, if this actor is an archer. Zero means they never shoot. */
  bowDamage?: number
  /** Uniform scale already applied to the character group; used to lift the bow. */
  eyeHeight?: number
}

export type BrainKind = 'none' | 'bandit' | 'boar' | 'ally' | 'allyArcher' | 'errand'

interface Actor {
  id: string
  combatant: Combatant
  character: CombatBody
  brain: BrainKind
  state: BrainState
  intent: Intent
  bowDamage: number
  eyeHeight: number
  /** Direction the dodge is travelling, frozen when it starts. */
  dodgeX: number
  dodgeZ: number
  /** Facing smoothed toward the intent's, so nobody snaps round. */
  yaw: number
}

const _at = new Vector3()
/** Scratch for the allies' formation anchor. See `update`. */
const _leaderAt = { x: 0, z: 0, facing: 0 }
const _from = new Vector3()
const _dir = new Vector3()

/** Radians per second a fighter can turn. Faster than a walk's `TURN_RATE`. */
const COMBAT_TURN_RATE = 9.5

/** The most any actor may ask for, as a multiple of their own `moveSpeed`. */
const MAX_THROTTLE = 1.6

/** How far above the feet an arrow leaves the bow, before scale. */
const BOW_HEIGHT = 1.1

export class CombatDirector {
  readonly group = new Group()
  readonly projectiles = new Projectiles()

  private readonly actors: Actor[] = []
  private readonly byId = new Map<string, Actor>()

  /** Written on every hit. The story layer and the HUD both read it. */
  onHit: ((event: HitEvent) => void) | null = null
  onDeath: ((id: string) => void) | null = null

  /** Whose position the allies follow when there is nothing to fight. */
  leaderId: string | null = null

  /** Set false during dialogue: timers freeze and nobody swings. */
  enabled = true

  constructor(
    private readonly groundAt: (x: number, z: number) => number,
    private readonly collision: () => CollisionWorld | null
  ) {
    this.group.name = 'combat'
    this.group.userData.perfTag = 'combat'
    this.group.add(this.projectiles.group)
  }

  add(options: ActorOptions): Actor {
    const actor: Actor = {
      id: options.id,
      combatant: options.combatant,
      character: options.character,
      brain: options.brain,
      state: emptyBrainState(options.station ?? [0, 0]),
      intent: emptyIntent(),
      bowDamage: options.bowDamage ?? 0,
      eyeHeight: options.eyeHeight ?? BOW_HEIGHT,
      dodgeX: 0,
      dodgeZ: 1,
      yaw: options.combatant.facing
    }
    this.actors.push(actor)
    this.byId.set(options.id, actor)
    return actor
  }

  /**
   * Swaps an actor's brain at runtime.
   *
   * Exists for exactly one moment in Chapter 1 and is worth the method for it:
   * when the boar comes through the net *everyone runs*, in all directions, and
   * the prose is explicit that Athalus is treed before anyone shoots. Left on
   * their `ally` brains the three companions simply stand their ground and kill
   * the animal in about eight seconds, which deletes the chase — measured, by
   * standing still and watching them do it.
   *
   * Setting a brain to `none` is therefore a *story* instruction, not an AI
   * tuning: it says "these three are not fighting right now".
   */
  setBrain(id: string, brain: BrainKind): void {
    const actor = this.byId.get(id)
    if (actor) {
      actor.brain = brain
      actor.state.engaged = false
      actor.state.aim = 0
    }
  }

  /**
   * Sends an actor to a point, on foot.
   *
   * Switches them to the `errand` brain and gives it somewhere to go. The caller
   * polls `errandDone` (or reads `errandFor`) to find out when they get there —
   * there is no callback, because `combat/` may not know what the arrival is
   * *for* (CLAUDE.md), and a callback would be the story reaching back in.
   *
   * A second call replaces the errand in flight, which is what a scene changing
   * its mind looks like. `clearErrand` puts the actor back to `none`.
   */
  sendTo(
    id: string,
    x: number,
    z: number,
    facing: number,
    options: { radius?: number; throttle?: number } = {}
  ): void {
    const actor = this.byId.get(id)
    if (!actor) {
      return
    }
    // A non-finite mark is a figure walking to an undefined place, which the
    // mover resolves to NaN and three then declines to draw — silently, and for
    // the rest of the act (CLAUDE.md on `Number.isFinite`).
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(facing)) {
      return
    }
    actor.brain = 'errand'
    actor.state.engaged = false
    actor.state.aim = 0
    actor.state.errand = {
      x,
      z,
      facing,
      radius: Math.max(0.25, options.radius ?? 0.55),
      throttle: Math.max(0.1, Math.min(2, options.throttle ?? 1)),
      done: false,
      elapsed: 0
    }
  }

  /** The errand an actor is on, or null. */
  errandFor(id: string): Errand | null {
    return this.byId.get(id)?.state.errand ?? null
  }

  /** True once they have arrived. False while walking, and for anyone not sent. */
  errandDone(id: string): boolean {
    return this.byId.get(id)?.state.errand?.done === true
  }

  /** Drops the errand and puts the actor back to standing about. */
  clearErrand(id: string): void {
    const actor = this.byId.get(id)
    if (!actor) {
      return
    }
    actor.state.errand = null
    if (actor.brain === 'errand') {
      actor.brain = 'none'
    }
  }

  remove(id: string): void {
    const index = this.actors.findIndex(actor => actor.id === id)
    if (index >= 0) {
      this.actors.splice(index, 1)
    }
    this.byId.delete(id)
  }

  clear(): void {
    this.actors.length = 0
    this.byId.clear()
    this.projectiles.clear()
  }

  get(id: string): Combatant | null {
    return this.byId.get(id)?.combatant ?? null
  }

  /** Every fighter, for the HUD and for the story's win conditions. */
  each(fn: (combatant: Combatant, id: string) => void): void {
    for (const actor of this.actors) {
      fn(actor.combatant, actor.id)
    }
  }

  /** How many hostiles to `team` are still standing. */
  /**
   * Hostiles to `team` that are **near enough to be a fight**.
   *
   * `aliveAgainst` counts every hostile in the world, which is the right answer
   * for "is the ambush over" and the wrong one for anything a player looks at.
   * Chapter 2 is played as a bandit, so the plain count reported **nine** — the
   * whole hunting party, alive and asleep in a village 120 m away — over a HUD
   * that says "3 more" next to it, during a conversation round a fire.
   *
   * 45 m is a little past the far end of the ambush's own spread, so nothing
   * that is actually in a fight is ever outside it.
   */
  engagedAgainst(team: Team, x: number, z: number, radius = 45): number {
    const reach = radius * radius
    let count = 0
    for (const actor of this.actors) {
      const c = actor.combatant
      if (!c.alive || !isHostile(team, c.team)) {
        continue
      }
      const dx = c.x - x
      const dz = c.z - z
      if (dx * dx + dz * dz <= reach) {
        count++
      }
    }
    return count
  }

  aliveAgainst(team: Team): number {
    let count = 0
    for (const actor of this.actors) {
      if (actor.combatant.alive && isHostile(team, actor.combatant.team)) {
        count++
      }
    }
    return count
  }

  /**
   * The player's own intent, pushed in each frame before `update`.
   *
   * The player has no brain — their `Intent` is filled by the controller — but
   * they go through exactly the same movement, attack and hit resolution as
   * everybody else. That symmetry is worth more than it costs: it means a bug in
   * lunging or in guard arcs is a bug the player can see happening to a bandit,
   * rather than one that only manifests on the one actor nobody can watch from
   * outside.
   */
  setPlayerIntent(id: string, fill: (intent: Intent) => void): void {
    const actor = this.byId.get(id)
    if (actor) {
      fill(actor.intent)
    }
  }

  /**
   * The nearest living hostile to `actor`, or null.
   *
   * Linear over the actor list, which is fine and will stay fine: the largest
   * encounter in Chapter 1 is nine fighters, so this is 81 distance tests per
   * frame in the worst case — under a microsecond, against the 1.6 ms the
   * profiler already bills eight NPCs for pose evaluation alone.
   */
  private findTarget(actor: Actor): Combatant | null {
    let best: Combatant | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const other of this.actors) {
      if (other === actor || !other.combatant.alive) {
        continue
      }
      if (!isHostile(actor.combatant.team, other.combatant.team)) {
        continue
      }
      const d = Math.hypot(other.combatant.x - actor.combatant.x, other.combatant.z - actor.combatant.z)
      if (d < bestDistance) {
        bestDistance = d
        best = other.combatant
      }
    }
    return best
  }

  update(dt: number, cameraPosition?: Vector3): void {
    // ── Postures advance whether or not combat is running ──────────────────
    //
    // Before the `enabled` gate, and that is the whole point of putting it here
    // rather than inside `settle`: the household sits down during a *dialogue*
    // beat, which is exactly when the director is frozen and `settle` is called
    // with `dt = 0`. Every other timer in this layer is supposed to stop there;
    // this one is supposed not to.
    for (const actor of this.actors) {
      actor.combatant.advancePosture(dt)
    }

    if (!this.enabled) {
      // ── Frozen, not absent — and not *stopped* either ───────────────────
      //
      // `settle`, not `character.update`. The first version called only the
      // latter and it was wrong in a way that took a screenshot to find: a
      // character's *transform* is written by `settle`, so a scene that opens on
      // a dialogue beat — which Chapter 1 does — left the entire cast at the
      // position they were constructed at, 400 m below the terrain, for as long
      // as anybody was talking. Nothing errored; the world simply had no people
      // in it.
      //
      // ── And the real `dt`, which this used to pass as 0 ─────────────────
      //
      // The old comment here claimed that a zero delta left everyone "in their
      // idle pose". It does not: `Character.update` returns before `resetPose`
      // when `dt <= 0`, so the figure keeps whatever pose the last *moving*
      // frame left on it. The player runs up to somebody, presses the key, and
      // stands through the whole conversation frozen mid-stride with one foot in
      // the air — which is what it looked like, and it is the one thing on
      // screen for the length of every dialogue beat in the chapter.
      //
      // Passing the real delta costs nothing this branch is trying to prevent.
      // The combat clocks live in `Combatant.tick`, which is in the *enabled*
      // path below and still does not run; all `settle` advances is the pose.
      // With the actor standing still `measureMotion` sees no travel, `moving`
      // decays to zero, and the gait cross-fades into the breathing idle — plus
      // the occasional one-shot from `characters/fidgets.ts`, which is the whole
      // reason a person waiting still reads as a person.
      for (const actor of this.actors) {
        this.settle(actor, dt, cameraPosition)
      }
      return
    }

    // ── 1. Brains ──────────────────────────────────────────────────────────
    let tokensHeld = 0
    for (const actor of this.actors) {
      if (actor.brain === 'bandit' && actor.state.engaged) {
        tokensHeld++
      }
    }
    const leader = this.leaderId ? this.byId.get(this.leaderId) : null
    // Reused, not rebuilt: this is read by every ally every frame and the whole
    // layer is written to allocate nothing.
    if (leader) {
      _leaderAt.x = leader.combatant.x
      _leaderAt.z = leader.combatant.z
      _leaderAt.facing = leader.yaw
    }
    const leaderAt = leader ? _leaderAt : null

    for (const actor of this.actors) {
      const target = actor.brain === 'none' || actor.brain === 'errand' ? null : this.findTarget(actor)
      switch (actor.brain) {
        case 'bandit': {
          const wasEngaged = actor.state.engaged
          const engaged = banditBrain(
            actor.combatant,
            actor.state,
            target,
            Math.max(0, AGGRO_TOKENS - tokensHeld),
            dt,
            actor.intent
          )
          if (engaged && !wasEngaged) {
            tokensHeld++
          } else if (!engaged && wasEngaged) {
            tokensHeld--
          }
          break
        }
        case 'boar':
          boarBrain(actor.combatant, actor.state, target, dt, actor.intent)
          break
        case 'ally':
          allyBrain(actor.combatant, actor.state, target, leaderAt, false, dt, actor.intent)
          break
        case 'allyArcher':
          allyBrain(actor.combatant, actor.state, target, leaderAt, true, dt, actor.intent)
          break
        case 'errand':
          // No target lookup and no aggro token: somebody walking across a room
          // is not in the fight, and giving them a target would have them turn
          // and square up to whoever walked past.
          errandBrain(actor.combatant, actor.state, dt, actor.intent)
          break
        default:
          break
      }
    }

    // ── 2 & 3. Timers, then one movement resolve each ──────────────────────
    for (const actor of this.actors) {
      const c = actor.combatant
      const intent = actor.intent

      if (!c.alive) {
        this.settle(actor, dt, cameraPosition)
        continue
      }

      // Requests are made before the timer advances, so an attack started this
      // frame gets this frame's windup rather than starting a frame late.
      if (intent.dodge) {
        if (c.requestDodge()) {
          const len = Math.hypot(intent.moveX, intent.moveZ)
          if (len > 1e-4) {
            actor.dodgeX = intent.moveX / len
            actor.dodgeZ = intent.moveZ / len
          } else {
            // A standing dodge goes backwards, which is the only direction that
            // is never wrong: rolling forward into an attack you dodged is how a
            // roll gets blamed for a hit it prevented.
            actor.dodgeX = -Math.sin(actor.yaw)
            actor.dodgeZ = -Math.cos(actor.yaw)
          }
        }
      } else if (intent.attackHeavy) {
        c.requestHeavy()
      } else if (intent.attackLight) {
        c.requestLight()
      }
      c.setGuard(intent.guard)

      if (intent.shoot && actor.bowDamage > 0) {
        this.loose(actor)
      }

      const lunge = c.update(dt)

      // Facing. Smoothed toward the intent rather than assigned, so nobody
      // pivots on the spot — and frozen during an attack, because a swing that
      // tracks its target is a swing the player cannot side-step, which would
      // undo the entire point of the boar's charge.
      if (!c.busy || c.stance === 'dodge') {
        let delta = intent.facing - actor.yaw
        while (delta > Math.PI) delta -= Math.PI * 2
        while (delta < -Math.PI) delta += Math.PI * 2
        const step = COMBAT_TURN_RATE * dt
        actor.yaw += Math.abs(delta) <= step ? delta : Math.sign(delta) * step
      }
      c.facing = actor.yaw

      let dx = 0
      let dz = 0
      if (c.stance === 'dodge') {
        // A roll's speed is a curve, not a constant: fast at the start, gone by
        // the end. A constant-speed roll that stops dead reads as a slide.
        const t = 1 - Math.min(1, c.stanceTime / DODGE_SECONDS)
        const speed = DODGE_SPEED * (0.35 + 0.65 * t)
        dx = actor.dodgeX * speed * dt
        dz = actor.dodgeZ * speed * dt
      } else if (!c.busy && intent.throttle > 0) {
        const len = Math.hypot(intent.moveX, intent.moveZ)
        if (len > 1e-4) {
          // ── The ceiling is 1.6, not 1 ─────────────────────────────────
          //
          // It was 1, and that silently deleted two features that were already
          // written: the player's sprint, and `allyBrain`'s 1.25 "overspeed
          // when out of station" that is supposed to let a companion left
          // behind by a sprint catch up. Both set a throttle above 1 and both
          // were clamped straight back to a walk, so a sprint did nothing and
          // companions trailed one step short forever.
          //
          // 1.6 is the ceiling rather than `Infinity` because a throttle is an
          // *intent*, and an intent is exactly the kind of number that acquires
          // a stray multiply. A cap turns that into a visibly-too-fast actor
          // instead of one that teleports through the collision world.
          const speed = c.stats.moveSpeed * Math.min(MAX_THROTTLE, intent.throttle) * (c.guarding ? 0.5 : 1)
          dx = (intent.moveX / len) * speed * dt
          dz = (intent.moveZ / len) * speed * dt
        }
      }
      if (lunge > 0) {
        dx += Math.sin(actor.yaw) * lunge
        dz += Math.cos(actor.yaw) * lunge
      }

      if (dx !== 0 || dz !== 0) {
        const world = this.collision()
        if (world) {
          const moved = world.resolveMove(c.x, c.z, c.x + dx, c.z + dz, c.stats.radius, c.y + 0.3)
          c.x = moved.x
          c.z = moved.z
        } else {
          c.x += dx
          c.z += dz
        }
      }
      c.y = this.groundAt(c.x, c.z)

      // Fighters push each other apart. Without this a crowd of bandits stacks
      // into one silhouette the instant two of them pick the same approach
      // vector, and the fight becomes unreadable — which is the failure mode a
      // token system alone does not prevent.
      this.separate(actor)
    }

    // ── 4. Hits ────────────────────────────────────────────────────────────
    for (const actor of this.actors) {
      if (actor.combatant.shouldResolve()) {
        this.resolveSwing(actor)
      }
    }

    // ── 5. Pose ────────────────────────────────────────────────────────────
    for (const actor of this.actors) {
      this.settle(actor, dt, cameraPosition)
    }

    // ── 6. Arrows ──────────────────────────────────────────────────────────
    this.projectiles.update(
      dt,
      (x, y, z, team, ownerId, damage, poiseDamage, dirX, dirZ) => this.arrowHit(x, y, z, team, ownerId, damage, poiseDamage, dirX, dirZ),
      this.groundAt
    )
  }

  /**
   * Pushes an actor out of anyone they are standing inside.
   *
   * Half the overlap each, applied only to `actor` — the other half arrives when
   * the other actor is separated in its own turn, so the pair converges without
   * either of them being moved twice in one frame.
   */
  private separate(actor: Actor): void {
    const a = actor.combatant
    for (const other of this.actors) {
      if (other === actor || !other.combatant.alive) {
        continue
      }
      const b = other.combatant
      const dx = a.x - b.x
      const dz = a.z - b.z
      const minimum = a.stats.radius + b.stats.radius
      const d2 = dx * dx + dz * dz
      if (d2 >= minimum * minimum || d2 < 1e-8) {
        continue
      }
      const d = Math.sqrt(d2)
      const push = (minimum - d) * 0.5
      a.x += (dx / d) * push
      a.z += (dz / d) * push
    }
  }

  /** Writes the character's transform and runs the gait, then the attack clip. */
  private settle(actor: Actor, dt: number, cameraPosition?: Vector3): void {
    const c = actor.combatant
    _at.set(c.x, c.y, c.z)
    actor.character.setPosition(_at)
    actor.character.setFacing(actor.yaw)
    actor.character.update(dt, cameraPosition)

    if (!c.alive) {
      // Death is a pose, not a ragdoll. One clip's worth of collapse would be
      // better and is out of scope; sinking the figure and tipping it is what
      // the budget allows and it reads correctly at any distance the chapter
      // fights at.
      actor.character.group.rotation.x = -1.35
      actor.character.group.position.y = c.y + 0.18
      return
    }
    // ── And standing back up ────────────────────────────────────────────────
    //
    // `Combatant.revive` resets hit points, stamina, poise and stance — every
    // number a fight reads — and cannot touch the scene graph, which it has no
    // reference to. So the tip above outlived every revival: a player who died
    // and pressed Retry got up at 77 degrees and played the rest of the chapter
    // lying down, and Chapter 2 opened on five bandits conversing on their
    // backs, because Chapter 1 ends by killing all of them and Chapter 2 revives
    // them a few hours later.
    //
    // Guarded rather than assigned unconditionally: this runs for every actor
    // every frame, and writing zero over zero dirties the matrix of fourteen
    // figures who are simply standing there.
    if (actor.character.group.rotation.x !== 0) {
      actor.character.group.rotation.x = 0
    }

    const attack = c.attack
    if (attack) {
      const yaw = applyClip(actor.character.bones, attack.pose, c.attackProgress, clipWeight(c.attackProgress))
      if (yaw !== 0) {
        actor.character.setFacing(actor.yaw + yaw)
      }
    } else if (c.guarding) {
      applyClip(actor.character.bones, GUARD_POSE, 0.5, 0.8)
    } else if (c.stance === 'stagger') {
      applyClip(actor.character.bones, STAGGER_POSE, Math.min(1, c.stanceTime / STAGGER_SECONDS), 0.85)
    }

    // ── The seat, last ─────────────────────────────────────────────────────
    //
    // After the attack block, so a posture beats a swing rather than the other
    // way round. That ordering only matters in one situation and it is a
    // situation worth being decided about: somebody who is attacked while
    // sitting. Letting the swing win would have them stand up out of a chair for
    // one clip and drop back into it, which reads as a bug; letting the seat win
    // has them flinch in it, which reads as a person who has not got up yet.
    //
    // `postureBlend` is both the clip's own time and the source of its weight —
    // one number, so a sit and a stand are provably the same motion reversed and
    // cannot drift apart.
    if (c.postureBlend > 0) {
      applyPosture(actor.character.bones, c.seatedAs, c.postureBlend)
    }
  }

  /**
   * Tests one swing against everything hostile in its arc.
   *
   * A cone test, not a swept capsule. The swept version is more correct and
   * measurably worse to play against: a cone hits everything the *animation*
   * appears to cover for the whole active window, which is what a player judges
   * a hit by, while a swept volume follows the blade and misses targets that
   * were plainly inside the arc when the swing started.
   */
  private resolveSwing(actor: Actor): void {
    const c = actor.combatant
    const attack = c.attack
    if (!attack) {
      return
    }
    const reach = attack.reach * c.scaling.reach
    const damage = attack.damage * c.scaling.damage * (c.stats.might ?? 1)
    const forwardX = Math.sin(c.facing)
    const forwardZ = Math.cos(c.facing)

    for (const other of this.actors) {
      if (other === actor || !other.combatant.alive) {
        continue
      }
      const target = other.combatant
      if (!isHostile(c.team, target.team)) {
        continue
      }
      const dx = target.x - c.x
      const dz = target.z - c.z
      const d = Math.hypot(dx, dz)
      if (d > reach + target.stats.radius) {
        continue
      }
      if (d > 1e-4) {
        const cos = (dx * forwardX + dz * forwardZ) / d
        if (cos < Math.cos(attack.arc)) {
          continue
        }
      }

      const result = target.receive(damage, attack.poiseDamage, attack.type, Math.atan2(-dx, -dz))
      if (result.parried) {
        // The parry's reward, and it is deliberately severe: the attacker is
        // staggered outright, which opens the full 0.62 s punish window. A parry
        // that only stopped damage would be strictly worse than a block.
        c.receive(0, 999, attack.type, 0)
      }
      this.onHit?.({
        attackerId: actor.id,
        targetId: other.id,
        damage: result.damage,
        type: attack.type,
        blocked: result.blocked,
        parried: result.parried,
        staggered: result.staggered,
        killed: result.killed,
        x: c.x + forwardX * reach * 0.6,
        y: c.y + target.stats.height * 0.6,
        z: c.z + forwardZ * reach * 0.6
      })
      if (result.killed) {
        this.onDeath?.(other.id)
      }
    }
  }

  /** Looses an arrow from `actor` toward whatever it is facing. */
  private loose(actor: Actor): void {
    const c = actor.combatant
    _from.set(c.x, c.y + actor.eyeHeight, c.z)
    // Aimed with a small upward bias so the drop lands the shot on a body rather
    // than on a shin. 3.2° at 42 m/s puts the apex about 12 m out, which is the
    // middle of the archer band in `brains.ts`.
    _dir.set(Math.sin(c.facing), 0.056, Math.cos(c.facing)).normalize()
    this.projectiles.fire(actor.id, c.team, _from, _dir, actor.bowDamage, ARROW_POISE, ARROW_SPEED)
  }

  /** Fires an arrow at an explicit direction — the player's aim. */
  shoot(id: string, direction: Vector3, damage: number): void {
    const actor = this.byId.get(id)
    if (!actor) {
      return
    }
    const c = actor.combatant
    _from.set(c.x, c.y + actor.eyeHeight, c.z)
    this.projectiles.fire(actor.id, c.team, _from, direction, damage, ARROW_POISE, ARROW_SPEED)
  }

  /**
   * Whether an arrow at this point has hit a body.
   *
   * A cylinder test against every living hostile. The arrow is a point rather
   * than a segment, which under-reports at very high speed — a 42 m/s arrow
   * moves 0.7 m per frame at 60 fps against a 0.3 m body radius, so a shot can
   * step past a target. That is a real limitation and the mitigation is the
   * cheap one: the test radius is the body's plus a 0.25 m margin, which closes
   * the gap for every speed this chapter uses. A swept test is the correct fix
   * the day something moves faster.
   */
  private arrowHit(
    x: number,
    y: number,
    z: number,
    team: Team,
    ownerId: string,
    damage: number,
    poiseDamage: number,
    dirX: number,
    dirZ: number
  ): boolean {
    for (const actor of this.actors) {
      const c = actor.combatant
      if (!c.alive || actor.id === ownerId || !isHostile(team, c.team)) {
        continue
      }
      if (y < c.y + 0.15 || y > c.y + c.stats.height + 0.25) {
        continue
      }
      const dx = x - c.x
      const dz = z - c.z
      const r = c.stats.radius + 0.25
      if (dx * dx + dz * dz > r * r) {
        continue
      }
      const result = c.receive(damage, poiseDamage, 'pierce', Math.atan2(-dirX, -dirZ))
      this.onHit?.({
        attackerId: ownerId,
        targetId: actor.id,
        damage: result.damage,
        type: 'pierce',
        blocked: result.blocked,
        parried: result.parried,
        staggered: result.staggered,
        killed: result.killed,
        x,
        y,
        z
      })
      if (result.killed) {
        this.onDeath?.(actor.id)
      }
      return true
    }
    return false
  }

  dispose(): void {
    this.projectiles.dispose()
    this.clear()
    this.group.clear()
  }
}

/** Poise removed by an arrow. Low — a shaft hurts, it does not knock people down. */
const ARROW_POISE = 7

/**
 * The guard, as a one-key clip.
 *
 * A single key, sampled at 0.5, which is the cheapest way to express "hold this
 * pose" in a format built for motion. Weight 0.8 rather than 1 so the walk still
 * shows underneath — a character who blocks while backing away should still be
 * visibly backing away.
 */
const GUARD_POSE = [
  {
    t: 0,
    bones: {
      chest: [0.08, 0.26, 0] as const,
      'upperArm.R': [-1.05, 0.35, -0.45] as const,
      'forearm.R': [-1.35, 0, 0] as const,
      'upperArm.L': [-0.95, -0.3, 0.5] as const,
      'forearm.L': [-1.4, 0, 0] as const,
      head: [0.1, 0.12, 0] as const
    }
  },
  {
    t: 1,
    bones: {
      chest: [0.08, 0.26, 0] as const,
      'upperArm.R': [-1.05, 0.35, -0.45] as const,
      'forearm.R': [-1.35, 0, 0] as const,
      'upperArm.L': [-0.95, -0.3, 0.5] as const,
      'forearm.L': [-1.4, 0, 0] as const,
      head: [0.1, 0.12, 0] as const
    }
  }
]

/** Hit reaction: a recoil that decays. Read at the stagger's own elapsed time. */
const STAGGER_POSE = [
  { t: 0, hips: -0.04, bones: { chest: [-0.3, 0.16, 0] as const, head: [-0.34, 0.2, 0] as const, 'upperArm.R': [0.3, 0.2, -0.5] as const, 'upperArm.L': [0.25, -0.2, 0.55] as const } },
  { t: 0.35, hips: -0.02, bones: { chest: [-0.12, 0.06, 0] as const, head: [-0.16, 0.08, 0] as const, 'upperArm.R': [0.05, 0.06, -0.4] as const, 'upperArm.L': [0.05, -0.06, 0.42] as const } },
  { t: 1, bones: { chest: [0, 0, 0] as const, head: [0, 0, 0] as const } }
]
