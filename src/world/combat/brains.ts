import type { Combatant } from './Combatant'

/**
 * ─── What the computer-controlled fighters want ─────────────────────────────
 *
 * Three brains, and the reason there are three rather than one parameterised one
 * is that Chapter 1 asks three genuinely different questions of them.
 *
 *   * **`banditBrain`** — a man with a short sword who is one of five. He has to
 *     *not all arrive at once*, or the fight is a coin toss decided in the first
 *     half-second, and he has to be beatable by a player who blocks and parries.
 *   * **`boarBrain`** — an animal that only knows one attack and cannot steer
 *     during it. Everything interesting about the boar fight is the gap between
 *     its telegraph and its charge.
 *   * **`allyBrain`** — Jester, Gearn and Kareen, who fight *beside* the player.
 *     Their whole job is to be legibly useful without stealing the fight, which
 *     is a design problem rather than an AI one: they are deliberately slower to
 *     commit than the enemies and they never take the last hit off a target the
 *     player is engaged with.
 *
 * ── No pathfinding, and why that is fine here ───────────────────────────────
 *
 * Everything below steers by direct vector and lets `collision.resolveMove`
 * slide it along whatever it walks into — the same treatment `World` already
 * gives its demo characters, and the same argument: the two fights in this
 * chapter happen in a meadow and in a clearing, both of which are convex and
 * empty. A navmesh for two encounters in a field would be a system with no
 * second user, and the failure it prevents (a bandit stuck on a tree for two
 * seconds while sliding around it) does not happen in either arena.
 *
 * ── Intent, not action ──────────────────────────────────────────────────────
 *
 * A brain fills in an `Intent` and nothing else. It does not move the actor, it
 * does not start the attack, it does not know where the walls are. That keeps
 * every brain testable as a pure function of the world state and keeps the
 * director the only thing that can actually change anything.
 */

export interface Intent {
  /** Desired move direction, world space, not normalised. Zero to stand. */
  moveX: number
  moveZ: number
  /** Yaw the actor wants to face. */
  facing: number
  /** Fraction of `moveSpeed` to use. Lets a brain circle at a walk and close at a run. */
  throttle: number
  attackLight: boolean
  attackHeavy: boolean
  guard: boolean
  dodge: boolean
  /** Loose an arrow this frame, if the actor has a bow. */
  shoot: boolean
}

export const emptyIntent = (): Intent => ({
  moveX: 0,
  moveZ: 0,
  facing: 0,
  throttle: 0,
  attackLight: false,
  attackHeavy: false,
  guard: false,
  dodge: false,
  shoot: false
})

const resetIntent = (intent: Intent): void => {
  intent.moveX = 0
  intent.moveZ = 0
  intent.throttle = 0
  intent.attackLight = false
  intent.attackHeavy = false
  intent.guard = false
  intent.dodge = false
  intent.shoot = false
}

/**
 * Per-actor scratch a brain keeps between frames.
 *
 * Deliberately small and deliberately *not* a class: a brain is a function, and
 * everything it remembers is here, so a saved fight is this struct per actor
 * rather than a graph of objects.
 */
export interface BrainState {
  /**
   * Where this ally walks, as `[right, forward]` metres in the leader's own
   * frame. Ignored by the other two brains.
   *
   * Set by whoever creates the actor, because the *set* of stations has to fan
   * out and no individual brain can know that. See `allyBrain`'s follow branch.
   */
  station: readonly [number, number]
  /** Seconds until this actor is allowed to commit to an attack again. */
  cooldown: number
  /** −1 or +1: which way it strafes when circling. Flipped on a timer. */
  circle: number
  /** Seconds until the circle direction flips. */
  circleTimer: number
  /**
   * Whether this actor currently holds the "token" that permits it to attack.
   *
   * The single most important field in the file. See `AGGRO_TOKENS`.
   */
  engaged: boolean
  /** Aim charge for archers, 0..1. */
  aim: number
  /**
   * Where this actor has been told to walk, or null.
   *
   * Read only by `errandBrain`. It is here rather than on `Combatant` because
   * it is a *decision*, and `BrainState` is where decisions live — the same
   * argument `station` is here rather than on the actor.
   */
  errand: Errand | null
}

/**
 * A place somebody has been sent, and how they should stand when they get there.
 *
 * Deliberately geometry and nothing else: no beat id, no cast id, no callback.
 * `combat/` may not know a chapter exists (CLAUDE.md), so the layer that gives
 * the order is the layer that notices it has been carried out — it watches
 * `done` rather than being told.
 */
export interface Errand {
  x: number
  z: number
  /** Inside this many metres the walk is over. */
  radius: number
  /** Yaw to settle on once arrived. */
  facing: number
  /** 1 walks, higher runs. Clamped by the mover's own speed. */
  throttle: number
  /** Set by the brain the frame it arrives, and never cleared by the brain. */
  done: boolean
  /**
   * Seconds spent on this errand, for the caller's own patience.
   *
   * A walk that cannot finish — a doorway blocked by another actor, a mark
   * inside a wall — otherwise leaves a figure grinding against geometry for the
   * rest of the act with nothing on screen to say why. The story layer gives up
   * on this and teleports, which is the behaviour that used to be unconditional.
   */
  elapsed: number
}

export const emptyBrainState = (station: readonly [number, number] = [0, 0]): BrainState => ({
  station,
  cooldown: 0,
  circle: Math.random() < 0.5 ? -1 : 1,
  circleTimer: 0,
  engaged: false,
  aim: 0,
  errand: null
})

/**
 * ─── The attack token ───────────────────────────────────────────────────────
 *
 * At most this many hostiles may be in `engaged` at once; the rest circle,
 * feint and wait. It is the oldest trick in melee AI and it is the difference
 * between an ambush that is a fight and one that is an execution.
 *
 * **Two**, and the number comes from the chapter. Five bandits attack; two are
 * shot before contact; the prose then describes *three* separate one-on-one
 * duels — Athalus against the tall one, Gearn losing ground to a short sword,
 * Jester tangling a blade in his scrantis — which resolve only because Kareen
 * comes round the back. Five men swarming one player would be neither that fight
 * nor a survivable one.
 */
export const AGGRO_TOKENS = 2

/** Chance per second that a waiting bandit steps in when a token frees up. */
const ENGAGE_EAGERNESS = 1.6

const angleTo = (fromX: number, fromZ: number, toX: number, toZ: number): number =>
  Math.atan2(toX - fromX, toZ - fromZ)

const distance = (a: Combatant, b: Combatant): number => Math.hypot(b.x - a.x, b.z - a.z)

/**
 * A bandit.
 *
 * The shape of it: close to `preferred` range, circle at that range, and commit
 * only while holding a token. When it commits it steps in, swings, and steps
 * back out — which is what makes the melee readable, because the player can see
 * a wind-up start from a distance they had a moment ago judged safe.
 *
 * It guards while waiting, which is what makes attacking into a crowd cost
 * something, and it drops its guard during its own attack, which is what makes
 * punishing one worth doing.
 */
export const banditBrain = (
  self: Combatant,
  state: BrainState,
  target: Combatant | null,
  tokensFree: number,
  dt: number,
  intent: Intent
): boolean => {
  resetIntent(intent)
  state.cooldown -= dt
  state.circleTimer -= dt
  if (state.circleTimer <= 0) {
    state.circle = -state.circle
    state.circleTimer = 1.4 + Math.random() * 1.6
  }

  if (!target || !target.alive || !self.alive) {
    state.engaged = false
    intent.facing = self.facing
    return false
  }

  const range = distance(self, target)
  const toward = angleTo(self.x, self.z, target.x, target.z)
  intent.facing = toward

  // The token. Taken probabilistically rather than by rank, so the same bandit
  // is not always the one who steps in — a queue that always promotes the
  // nearest reads as scripted the second time you fight it.
  if (!state.engaged && tokensFree > 0 && range < 5.5 && Math.random() < ENGAGE_EAGERNESS * dt) {
    state.engaged = true
  }
  if (state.engaged && (range > 7 || !target.alive)) {
    state.engaged = false
  }

  const reach = 1.5 * self.scaling.reach
  const preferred = state.engaged ? reach * 0.85 : reach * 2.1

  const dx = Math.sin(toward)
  const dz = Math.cos(toward)
  // Strafe component, perpendicular to the approach. Circling rather than
  // standing still is most of what makes a waiting enemy look alive.
  const sx = dz * state.circle
  const sz = -dx * state.circle

  const gap = range - preferred
  if (Math.abs(gap) > 0.25) {
    const closing = gap > 0 ? 1 : -1
    intent.moveX = dx * closing + sx * 0.5
    intent.moveZ = dz * closing + sz * 0.5
    intent.throttle = state.engaged ? 1 : 0.62
  } else {
    intent.moveX = sx
    intent.moveZ = sz
    intent.throttle = 0.5
  }

  if (self.busy) {
    return state.engaged
  }

  if (state.engaged && state.cooldown <= 0 && range < reach * 1.15) {
    // A quarter of commitments are the heavy. Enough that the player cannot
    // stop reading wind-ups; rare enough that the heavy still means something.
    if (Math.random() < 0.25) {
      intent.attackHeavy = true
    } else {
      intent.attackLight = true
    }
    state.cooldown = 0.75 + Math.random() * 0.9
  } else {
    // Guard up whenever not committing. `Combatant.setGuard` only arms the parry
    // window on a *rising* edge, so a bandit that holds guard forever never
    // parries — which is correct: parrying is the player's mechanic, and an
    // enemy that used it would make the light chain unusable.
    intent.guard = range < reach * 1.9
  }
  return state.engaged
}

/**
 * The Trollschwein.
 *
 * One rule and a timer. Below `GORE_RANGE` it slashes with its tusks; above it,
 * and once the wind-up timer allows, it charges — and the charge is a *lunge*,
 * so once it starts the animal travels 6.4 m in a straight line whatever the
 * player does. That is the entire fight: the player reads the scrape, steps
 * sideways, and shoots the flank while it recovers.
 *
 * It never blocks and never dodges (`MOVESETS.beast`), and its poise is high
 * enough that nothing in the chapter interrupts it. All three of those are the
 * same statement: this is not a duel, it is a hazard.
 */
export const boarBrain = (
  self: Combatant,
  state: BrainState,
  target: Combatant | null,
  dt: number,
  intent: Intent
): void => {
  resetIntent(intent)
  state.cooldown -= dt

  if (!target || !target.alive || !self.alive) {
    intent.facing = self.facing
    return
  }

  const range = distance(self, target)
  const toward = angleTo(self.x, self.z, target.x, target.z)
  intent.facing = toward

  // Committed. A charging boar does not steer — that is the whole reason
  // side-stepping works — so the brain says nothing while the attack runs.
  if (self.busy) {
    return
  }

  const dx = Math.sin(toward)
  const dz = Math.cos(toward)

  if (range < GORE_RANGE) {
    if (state.cooldown <= 0) {
      intent.attackLight = true
      state.cooldown = 1.1
    }
    // Shuffles rather than standing: an animal that stops dead at exactly its
    // reach reads as a turret.
    intent.moveX = dx * 0.4
    intent.moveZ = dz * 0.4
    intent.throttle = 0.35
    return
  }

  if (range < CHARGE_RANGE && state.cooldown <= 0) {
    intent.attackHeavy = true
    state.cooldown = 2.6
    return
  }

  // Trot in. Deliberately at 62 % — a boar that sprints between charges never
  // gives the player a moment to nock an arrow, and Chapter 1's answer to this
  // animal is a bow.
  intent.moveX = dx
  intent.moveZ = dz
  intent.throttle = range > CHARGE_RANGE * 1.6 ? 0.85 : 0.62
}

const GORE_RANGE = 2.0
const CHARGE_RANGE = 9.0

/**
 * An ally: Jester, Gearn, Kareen, and later Theodor.
 *
 * Two rules that are both restraint rather than capability:
 *
 *   1. **They hang back further than an enemy does** and commit a beat later, so
 *      the player's own duel is not resolved by somebody else walking into it.
 *   2. **Archers keep their distance and shoot**, which is what Kareen does in
 *      the prose — she is behind the melee for the whole ambush and ends it by
 *      cutting a bandit's hamstring from behind, not by duelling anyone.
 *
 * They are also given a `follow` mode with no target, because most of Chapter 1
 * is a walk and an ally who idles in a field while the player leaves is the most
 * obvious possible bug.
 */
export const allyBrain = (
  self: Combatant,
  state: BrainState,
  target: Combatant | null,
  leader: { x: number; z: number; facing: number } | null,
  isArcher: boolean,
  dt: number,
  intent: Intent
): void => {
  resetIntent(intent)
  state.cooldown -= dt

  if (!self.alive) {
    intent.facing = self.facing
    return
  }

  if (target && target.alive) {
    const range = distance(self, target)
    const toward = angleTo(self.x, self.z, target.x, target.z)
    intent.facing = toward
    const dx = Math.sin(toward)
    const dz = Math.cos(toward)

    if (isArcher) {
      state.aim = Math.min(1, state.aim + dt / ARCHER_DRAW_SECONDS)
      // Holds station in a band rather than at a point, so two archers do not
      // grind against each other trying to occupy the same metre.
      if (range < ARCHER_MIN) {
        intent.moveX = -dx
        intent.moveZ = -dz
        intent.throttle = 0.9
      } else if (range > ARCHER_MAX) {
        intent.moveX = dx
        intent.moveZ = dz
        intent.throttle = 0.8
      }
      if (state.aim >= 1 && state.cooldown <= 0 && range < ARCHER_MAX * 1.4) {
        intent.shoot = true
        state.aim = 0
        state.cooldown = 0.55 + Math.random() * 0.5
      }
      return
    }

    const reach = 1.5 * self.scaling.reach
    if (range > reach) {
      intent.moveX = dx
      intent.moveZ = dz
      intent.throttle = 1
    } else if (range < reach * 0.55) {
      intent.moveX = -dx
      intent.moveZ = -dz
      intent.throttle = 0.6
    }
    if (!self.busy && state.cooldown <= 0 && range < reach * 1.05) {
      intent.attackLight = true
      // Slower than a bandit's 0.75–1.65. An ally who out-DPSes the player in
      // their own duel is an ally the player resents.
      state.cooldown = 1.15 + Math.random() * 0.8
    } else if (!self.busy) {
      intent.guard = range < reach * 2
    }
    return
  }

  // ── Follow, in formation ────────────────────────────────────────────────
  //
  // Not "walk to within N metres of the leader", which is the obvious version
  // and is what shipped first. It fails for a reason that is only visible on
  // screen: a third-person camera sits 5.4 m *behind* the player, so a companion
  // closing on the player from any direction spends half its time between the
  // player and the lens. Three of them did it at once and the first screenshot of
  // the walk home was two thirds companion.
  //
  // So each ally holds a **station** — a fixed offset in the leader's own frame,
  // out to the side and slightly ahead — and walks to that point rather than to
  // the leader. Ahead rather than behind is the half that matters: it puts them
  // in shot, in front of the camera, which is also where a friend walking with
  // you actually is.
  state.aim = 0
  if (!leader) {
    intent.facing = self.facing
    return
  }
  const forwardX = Math.sin(leader.facing)
  const forwardZ = Math.cos(leader.facing)
  const stationX = leader.x + forwardX * state.station[1] + forwardZ * state.station[0]
  const stationZ = leader.z + forwardZ * state.station[1] - forwardX * state.station[0]

  const range = Math.hypot(stationX - self.x, stationZ - self.z)
  const toward = angleTo(self.x, self.z, stationX, stationZ)
  // Facing the *leader's* heading rather than the station keeps a companion
  // walking alongside instead of side-stepping toward a moving point, which at
  // any real walking speed reads as crabbing.
  intent.facing = range > FOLLOW_FAR ? toward : leader.facing
  if (range > FOLLOW_NEAR) {
    intent.moveX = Math.sin(toward)
    intent.moveZ = Math.cos(toward)
    // Overspeed when out of station, so a companion who was left behind by a
    // sprint catches up instead of trailing forever one step short.
    intent.throttle = range > FOLLOW_FAR ? 1.25 : 0.6
  }
}

const ARCHER_MIN = 6
const ARCHER_MAX = 15
const ARCHER_DRAW_SECONDS = 1.1
/** Inside this, the station is close enough and the ally stops. */
const FOLLOW_NEAR = 1.1
/** Past this, they break into a run to close it. */
const FOLLOW_FAR = 5.5

/**
 * ─── Walking somewhere because you were told to ─────────────────────────────
 *
 * The one brain that is not about a fight. It steers its actor at a point,
 * stops inside `radius`, turns to the errand's facing and sets `done`.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The frame act assembles a household: the smith comes in from the forge, the
 * mother and the daughter come up the road, and everybody sits down. All three
 * of those used to be **teleports** — the comment at the call site said so and
 * called a scripted-path brain "the right next thing to build" — and the result
 * was that the father did not walk in through the door, he simply *appeared* at
 * the chest beside it. Nothing in the act read as people arriving; it read as
 * the scene rebuilding itself between beats.
 *
 * ── It is a steer, not a path ───────────────────────────────────────────────
 *
 * There is no navmesh here and this does not pretend to have one. It walks the
 * straight line and lets `CombatDirector`'s mover resolve the collision, which
 * slides along a wall rather than stopping dead — enough for a room with a door
 * in the wall the walker is already facing, and not enough to get anybody round
 * a building. Every errand in the chapter is authored with that in mind: the
 * marks are placed so the straight line to them is walkable, and the story layer
 * gives up after a few seconds and places the actor rather than leaving them
 * grinding on a corner. A real path would be the next thing again, and it would
 * change none of this signature.
 *
 * ── The arc it turns through ────────────────────────────────────────────────
 *
 * Facing follows the *direction of travel* while walking and only swings to the
 * errand's own facing once inside the radius. Turning to the final facing early
 * makes a figure walk sideways into the room, which is worse than the teleport
 * it replaced — a teleport at least never looked like a mistake in the
 * animation.
 */
export const errandBrain = (self: Combatant, state: BrainState, dt: number, intent: Intent): void => {
  resetIntent(intent)
  state.cooldown -= dt
  const errand = state.errand
  if (!errand || !self.alive) {
    intent.facing = self.facing
    return
  }

  errand.elapsed += dt
  const dx = errand.x - self.x
  const dz = errand.z - self.z
  const range = Math.hypot(dx, dz)

  if (range <= errand.radius) {
    // Arrived. Hold the mark and turn to face the way the scene wants.
    intent.facing = errand.facing
    errand.done = true
    return
  }

  const toward = angleTo(self.x, self.z, errand.x, errand.z)
  intent.facing = toward
  intent.moveX = Math.sin(toward)
  intent.moveZ = Math.cos(toward)
  // Eased over the last stride, so an errand ends with somebody slowing to a
  // stop rather than hitting the mark at a walk and snapping to standing.
  const closing = Math.min(1, range / Math.max(errand.radius * 2.5, 0.6))
  intent.throttle = errand.throttle * (0.35 + 0.65 * closing)
}
