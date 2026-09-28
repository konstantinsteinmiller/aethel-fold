import type { Rng } from '../geometry/rng'

/**
 * ─── Grazing, as a state machine that has never heard of three.js ───────────
 *
 * Everything an animal *decides* lives here; everything it *is* lives in
 * `Sheep.ts`. The split is the one `combat/brains.ts` already makes and it buys
 * the same thing: the behaviour is a pure function of a few numbers, so "does a
 * sheep ever end up inside the storyteller's kitchen" is a question a test can
 * answer in a millisecond instead of one you answer by standing in a browser
 * for ten minutes hoping to catch it.
 *
 * ── The read is the specification ───────────────────────────────────────────
 *
 * The brief was *"walking around **and eating grass**"*, from a player who will
 * mostly see this from the storyteller's doorway — call it twenty metres. That
 * distance is what fixes every constant below. The chapter's camera is 55°, so
 * at 20 m on a 1080-line frame there are 51.9 vertical pixels to the metre, and:
 *
 * * a sheep is 0.87 m tall, i.e. **45 px** — the whole animal is the size of a
 *   line of text;
 * * the muzzle's trip from head-up to the grass is **0.73 m**, i.e. **38 px** —
 *   84 % of the animal's own height, and the single largest motion it can make.
 *   That is why the graze is a *neck* motion and not a body bob: a bob big
 *   enough to see at 20 m is a bob that looks broken at 3 m.
 * * over `GRAZE_DIP` the head travels ~33 px/s. Below about 5 px/s a motion stops
 *   reading as motion and starts reading as drift, so there is a factor of six
 *   of margin — deliberately, because the *dwell* is what the read actually
 *   depends on and the dip is only its punctuation.
 *
 * ── Why the dwell is seconds and not a beat ─────────────────────────────────
 *
 * A head that dips and immediately lifts reads as a nod. The player has to be
 * able to notice the sheep, look away at something else, look back, and find it
 * *still* eating — otherwise "they eat grass" is a claim only somebody watching
 * one animal continuously can verify. `GRAZE_MIN`/`GRAZE_MAX` are therefore
 * 7–13 s, which is also roughly what a real ewe does between steps.
 */

/** An axis-aligned rectangle in world XZ. `frame.ts::HUT_ROOM` is one. */
export interface Rect {
  x: number
  z: number
  halfX: number
  halfZ: number
}

export type GrazeState = 'walk' | 'graze' | 'alert'

/**
 * One animal's mind, as plain numbers.
 *
 * Mutated in place, never replaced — five of these are stepped sixty times a
 * second and GDD §5.2 forbids allocation on that path.
 */
export interface Grazer {
  x: number
  z: number
  /** Radians, `atan2(dx, dz)` — the same convention as every character. */
  facing: number
  /** Where this animal was put down. It never strays more than `ROAM` from it. */
  homeX: number
  homeZ: number
  targetX: number
  targetZ: number
  state: GrazeState
  /** Seconds left before the state is reconsidered. */
  timer: number
  /**
   * 0 = head up, 1 = muzzle in the grass. Ramped linearly at `1 / GRAZE_DIP`.
   *
   * Linear here and eased in the *pose* (`Sheep.ts` smoothsteps it), so this
   * number stays something a test can reason about: "after 0.6 s of grazing it
   * is 0.52" is checkable, "it is 0.61 because of an exponential" is not.
   */
  graze: number
  /** Metres walked since spawn. The gait phase is read off this, never off a clock. */
  travelled: number
  /** Measured, not commanded — same rule `Character.speed` follows. */
  speed: number
  /** Per-animal phase offset, so five sheep never crop in unison. */
  phase: number
}

/**
 * Everything the flock is stepped against. One struct, held for the life of the
 * flock and written in place each frame.
 */
export interface Pasture {
  /** The animals are clamped inside this. It is the paddock, hard. */
  paddock: Rect
  /**
   * Rectangles they must never enter, on top of whatever the collision world
   * blocks.
   *
   * The storyteller's room is the case this exists for, and it is not
   * theoretical: the room's walls are colliders but its **doorway is a 2 m hole
   * in the south wall**, so a sheep steered by `resolveMove` alone can walk
   * straight into the kitchen and stand next to the man telling the story.
   */
  keepOut: readonly Rect[]
  /**
   * The world's blocking props, or null (tests, and the frames before the
   * player's collision world exists).
   *
   * Typed structurally rather than as `CollisionWorld` so this module stays free
   * of `level/`; the one method it wants is the one method it names. The return
   * value is a shared object — `player/collision.ts` says so explicitly — which
   * is why it is read immediately below and never stored.
   */
  collision: { resolveMove(fromX: number, fromZ: number, toX: number, toZ: number, radius: number, y: number): { x: number; z: number } } | null
  /** Ground height at the animals, for the collision sweep's vertical span. */
  y: number
  /** Where the player is standing. The flock gets out of the way. */
  playerX: number
  playerZ: number
  /** True while there is a player worth avoiding. */
  hasPlayer: boolean
  rng: Rng
}

// ─── The numbers ────────────────────────────────────────────────────────────

/**
 * Walking speed, m/s.
 *
 * The paddock's long axis is 18.5 m, so at this speed an animal takes 44 s to
 * cross it. That is the point: a sheep that crosses its field in eight seconds
 * reads as one that is *going* somewhere, and this flock is scenery — it has to
 * look like it lives there.
 */
const WALK_SPEED = 0.42
/** Getting out of the player's way. Faster, and it is meant to look startled. */
const FLEE_SPEED = 0.95
/** Radians per second the body turns toward its heading. */
const TURN_RATE = 2.4
/** Seconds from head-up to muzzle-down. See the header on the 33 px/s. */
export const GRAZE_DIP = 1.15
/**
 * The dwell. The whole read depends on this being long. See the header.
 *
 * Measured against the resulting behaviour rather than chosen: with these
 * numbers an animal spends **57 %** of its life with its muzzle at or near the
 * grass (`tests/world/sheep.test.ts` asserts the floor), and a 32-second sample
 * of the running chapter came out at 69 % grazing / 21 % walking / 10 % looking
 * up across all five. That is both what a real ewe does and what makes "they are
 * eating" true of the flock at any instant a screenshot is taken rather than
 * only on average.
 */
const GRAZE_MIN = 7
const GRAZE_MAX = 13
/** Head up, looking around. Short — it is punctuation between two long states. */
const ALERT_MIN = 1.4
const ALERT_MAX = 2.8
/**
 * How long an animal is willing to walk before it stops to eat again.
 *
 * A ceiling rather than a quota: a walk that reaches its target early ends
 * early, so the *effective* walk is shorter than the mean of this range.
 */
const WALK_MIN = 2.2
const WALK_MAX = 5.5
/** Close enough to a target to call it arrived, metres. */
const ARRIVE = 0.4
/** How far from home an animal will wander. */
const ROAM = 6.5
/** Collision radius, metres. The built mesh is 0.52 m across the fleece. */
export const SHEEP_RADIUS = 0.34
/** Flockmates push each other apart below this centre distance. */
const PERSONAL_SPACE = 1.1
/** The player at this range brings every head up. */
const PLAYER_NOTICE = 3.2
/** And at this range they step away rather than let themselves be walked through. */
const PLAYER_FLEE = 2.0
/**
 * How likely a walk is followed by eating rather than by looking around.
 *
 * 0.82, which is what makes the flock read as *grazing* rather than as milling:
 * at any instant about three of five animals have their heads down, so there is
 * essentially never a frame with nothing eating in it.
 */
const GRAZE_AFTER_WALK = 0.82

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/** Shortest signed angle from `from` to `to`, in (−π, π]. */
const angleDelta = (from: number, to: number): number => {
  let d = (to - from) % (Math.PI * 2)
  if (d > Math.PI) {
    d -= Math.PI * 2
  }
  if (d < -Math.PI) {
    d += Math.PI * 2
  }
  return d
}

export const insideRect = (r: Rect, x: number, z: number, margin = 0): boolean =>
  Math.abs(x - r.x) <= r.halfX + margin && Math.abs(z - r.z) <= r.halfZ + margin

/**
 * Shoves a point to the nearest outside face of a rectangle.
 *
 * The *nearest* face rather than a push along the centre-to-point vector,
 * because near a corner the two are 45° apart and the centre rule can walk an
 * animal the long way round the building it is standing against.
 */
const ejectFromRect = (r: Rect, g: Grazer, margin: number): void => {
  const dx = g.x - r.x
  const dz = g.z - r.z
  const outX = r.halfX + margin - Math.abs(dx)
  const outZ = r.halfZ + margin - Math.abs(dz)
  if (outX <= 0 || outZ <= 0) {
    return
  }
  if (outX < outZ) {
    g.x = r.x + (dx >= 0 ? r.halfX + margin : -(r.halfX + margin))
  } else {
    g.z = r.z + (dz >= 0 ? r.halfZ + margin : -(r.halfZ + margin))
  }
}

/** True when a point is somewhere an animal is allowed to stand. */
export const isPasture = (p: Pasture, x: number, z: number, margin: number): boolean => {
  if (!insideRect(p.paddock, x, z, -margin)) {
    return false
  }
  for (const rect of p.keepOut) {
    if (insideRect(rect, x, z, margin)) {
      return false
    }
  }
  return true
}

/**
 * Picks somewhere to walk to: inside the paddock, within `ROAM` of home, and
 * out of every keep-out.
 *
 * Rejection sampling with a hard cap of eight tries, and the fallback on failure
 * is **stand still** rather than "walk somewhere illegal". A paddock so full of
 * keep-outs that eight samples all miss is a paddock that should be re-authored,
 * and an animal quietly refusing to move is a far better symptom of that than
 * one walking through a wall.
 */
const retarget = (g: Grazer, p: Pasture): void => {
  for (let attempt = 0; attempt < 8; attempt++) {
    const angle = p.rng() * Math.PI * 2
    // `sqrt` so the samples are uniform over the disc rather than piled at the
    // centre — without it the flock slowly converges on five points.
    const radius = Math.sqrt(p.rng()) * ROAM
    const x = g.homeX + Math.cos(angle) * radius
    const z = g.homeZ + Math.sin(angle) * radius
    if (isPasture(p, x, z, SHEEP_RADIUS + 0.2)) {
      g.targetX = x
      g.targetZ = z
      return
    }
  }
  g.targetX = g.x
  g.targetZ = g.z
}

/** Enters a state and rolls its dwell. Kept in one place so no caller forgets one. */
const enter = (g: Grazer, state: GrazeState, p: Pasture): void => {
  g.state = state
  if (state === 'graze') {
    g.timer = p.rng.range(GRAZE_MIN, GRAZE_MAX)
  } else if (state === 'alert') {
    g.timer = p.rng.range(ALERT_MIN, ALERT_MAX)
  } else {
    g.timer = p.rng.range(WALK_MIN, WALK_MAX)
    retarget(g, p)
  }
}

/**
 * One animal, one frame.
 *
 * Order matters and is worth stating: the *decision* runs before the move, the
 * move runs before the world gets to veto it, and the vetoes run outermost to
 * innermost — collision, then paddock, then keep-outs. A keep-out that ran
 * before `resolveMove` could be undone by the slide.
 */
export const stepGrazer = (g: Grazer, dt: number, p: Pasture): void => {
  if (dt <= 0) {
    return
  }

  // ── Is the player on top of us ──────────────────────────────────────────
  //
  // Two radii, and the inner one is the interesting half: a sheep that only
  // stops eating is a sheep the player walks through. This one steps aside, and
  // it does it by *retargeting away* rather than by a one-frame shove, so the
  // motion is the same walk the animal does the rest of the time.
  let fleeing = false
  if (p.hasPlayer) {
    const dx = g.x - p.playerX
    const dz = g.z - p.playerZ
    const near = dx * dx + dz * dz
    if (near < PLAYER_NOTICE * PLAYER_NOTICE && g.state === 'graze') {
      enter(g, 'alert', p)
    }
    if (near < PLAYER_FLEE * PLAYER_FLEE) {
      fleeing = true
      const distance = Math.sqrt(near) || 1e-4
      // Straight away from the player, a body length and a half. Recomputed
      // every frame while they are close, so backing the player up herds them.
      g.targetX = g.x + (dx / distance) * 2.4
      g.targetZ = g.z + (dz / distance) * 2.4
      g.state = 'walk'
      g.timer = Math.max(g.timer, 0.6)
    }
  }

  // ── The state machine ───────────────────────────────────────────────────
  g.timer -= dt
  if (!fleeing && g.timer <= 0) {
    if (g.state === 'walk') {
      enter(g, p.rng() < GRAZE_AFTER_WALK ? 'graze' : 'alert', p)
    } else if (g.state === 'graze') {
      enter(g, 'alert', p)
    } else {
      enter(g, 'walk', p)
    }
  }

  // ── The head ────────────────────────────────────────────────────────────
  const wanted = g.state === 'graze' ? 1 : 0
  const ramp = dt / GRAZE_DIP
  g.graze = wanted > g.graze ? Math.min(wanted, g.graze + ramp) : Math.max(wanted, g.graze - ramp)

  // ── The feet ────────────────────────────────────────────────────────────
  //
  // **Nothing walks with its face in the grass.** The gate is the single line
  // that separates an animal that grazes from one that slides along the ground
  // muzzle-first, and it costs a comparison.
  let moved = 0
  if (g.state === 'walk' && g.graze < 0.12) {
    const dx = g.targetX - g.x
    const dz = g.targetZ - g.z
    const distance = Math.hypot(dx, dz)
    if (distance > ARRIVE) {
      const heading = Math.atan2(dx, dz)
      const turn = angleDelta(g.facing, heading)
      const maxTurn = TURN_RATE * dt
      g.facing += clamp(turn, -maxTurn, maxTurn)
      // Walk along the *body*, not along the target — so a turning sheep swings
      // round rather than crabbing sideways toward where it is going.
      const step = (fleeing ? FLEE_SPEED : WALK_SPEED) * dt
      const toX = g.x + Math.sin(g.facing) * step
      const toZ = g.z + Math.cos(g.facing) * step
      const before = g.x
      const beforeZ = g.z
      if (p.collision) {
        const resolved = p.collision.resolveMove(g.x, g.z, toX, toZ, SHEEP_RADIUS, p.y)
        g.x = resolved.x
        g.z = resolved.z
      } else {
        g.x = toX
        g.z = toZ
      }
      moved = Math.hypot(g.x - before, g.z - beforeZ)
    } else if (!fleeing) {
      // Arrived early. Start eating rather than standing on the spot waiting for
      // a timer to expire — the timer is a ceiling on a walk, not a quota.
      enter(g, 'graze', p)
    }
  }

  // ── What the world does not allow ───────────────────────────────────────
  g.x = clamp(g.x, p.paddock.x - p.paddock.halfX, p.paddock.x + p.paddock.halfX)
  g.z = clamp(g.z, p.paddock.z - p.paddock.halfZ, p.paddock.z + p.paddock.halfZ)
  for (const rect of p.keepOut) {
    ejectFromRect(rect, g, SHEEP_RADIUS)
  }

  g.travelled += moved
  // Measured speed, smoothed the way `TrollBoar` smooths its own — the gait
  // reads off `travelled` but the stride *amplitude* reads off this, and an
  // unsmoothed value flickers to zero on any frame the collision slide eats.
  g.speed += (moved / dt - g.speed) * Math.min(1, dt * 6)
}

/**
 * Pushes flockmates apart.
 *
 * Ten pair tests for five animals, run after everyone has moved. Without it two
 * sheep whose targets happen to coincide end up occupying the same 0.5 m of
 * grass, which at this stylisation looks like one sheep with eight legs.
 *
 * Positional rather than steering: a steering separation needs tuning against
 * the walk speed and can oscillate, and this is scenery — being *exactly* right
 * is worth less than being unconditionally right.
 */
export const separate = (flock: readonly Grazer[], p: Pasture): void => {
  for (let i = 0; i < flock.length; i++) {
    const a = flock[i]!
    for (let j = i + 1; j < flock.length; j++) {
      const b = flock[j]!
      const dx = b.x - a.x
      const dz = b.z - a.z
      const squared = dx * dx + dz * dz
      if (squared >= PERSONAL_SPACE * PERSONAL_SPACE) {
        continue
      }
      const distance = Math.sqrt(squared)
      // Exactly coincident: nudge along X. Any axis will do, and a degenerate
      // normalise here is a NaN that spreads to the whole flock in one frame.
      const nx = distance > 1e-4 ? dx / distance : 1
      const nz = distance > 1e-4 ? dz / distance : 0
      const push = (PERSONAL_SPACE - distance) * 0.5
      a.x -= nx * push
      a.z -= nz * push
      b.x += nx * push
      b.z += nz * push
    }
  }
  for (const g of flock) {
    g.x = clamp(g.x, p.paddock.x - p.paddock.halfX, p.paddock.x + p.paddock.halfX)
    g.z = clamp(g.z, p.paddock.z - p.paddock.halfZ, p.paddock.z + p.paddock.halfZ)
    for (const rect of p.keepOut) {
      ejectFromRect(rect, g, SHEEP_RADIUS)
    }
  }
}

/**
 * Puts one animal down somewhere legal and gives it a mind.
 *
 * Spread on a **Vogel spiral** rather than on a grid or at random: five random
 * points in a 9 × 18 m paddock cluster visibly about a third of the time, and a
 * grid reads as a grid. The spiral is the standard even-but-not-regular
 * placement, and it costs one `sqrt` per animal at load.
 */
export const makeGrazer = (index: number, count: number, p: Pasture): Grazer => {
  const GOLDEN = Math.PI * (3 - Math.sqrt(5))
  const radius = Math.sqrt((index + 0.5) / count)
  const angle = index * GOLDEN
  // Filled to the paddock's own aspect, so a long thin paddock gets a long thin
  // spread rather than a disc with two animals jammed against the fence.
  let x = p.paddock.x + Math.cos(angle) * radius * (p.paddock.halfX - SHEEP_RADIUS - 0.6)
  let z = p.paddock.z + Math.sin(angle) * radius * (p.paddock.halfZ - SHEEP_RADIUS - 0.6)
  if (!isPasture(p, x, z, SHEEP_RADIUS + 0.2)) {
    // A home inside a keep-out is a sheep that spends the chapter being ejected.
    // Walk it back toward the paddock centre until it is somewhere it can live.
    for (let back = 0.85; back > 0.05; back -= 0.1) {
      const tx = p.paddock.x + (x - p.paddock.x) * back
      const tz = p.paddock.z + (z - p.paddock.z) * back
      if (isPasture(p, tx, tz, SHEEP_RADIUS + 0.2)) {
        x = tx
        z = tz
        break
      }
    }
  }
  const g: Grazer = {
    x,
    z,
    facing: p.rng() * Math.PI * 2,
    homeX: x,
    homeZ: z,
    targetX: x,
    targetZ: z,
    state: 'graze',
    timer: 0,
    graze: 0,
    travelled: p.rng() * 4,
    speed: 0,
    phase: p.rng() * Math.PI * 2
  }
  // Staggered starts. Five animals all beginning a 7 s graze on frame one lift
  // their heads together seven seconds later, which reads as a cut.
  enter(g, index % 3 === 1 ? 'walk' : 'graze', p)
  g.timer *= 0.25 + p.rng() * 0.75
  g.graze = g.state === 'graze' ? p.rng() : 0
  return g
}
