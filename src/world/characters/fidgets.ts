import type { PoseTargets } from './poses'

/**
 * ─── What a person does while nothing is happening ──────────────────────────
 *
 * Six small gestures and a scheduler, layered on top of `applyIdle`.
 *
 * The problem they solve is not "the idle is boring". It is that this game
 * spends a large fraction of its running time with the player **standing still
 * while somebody talks** — every dialogue beat in the chapter, and there are
 * thirty-odd of them — and a figure holding one pose for forty seconds stops
 * reading as a person and starts reading as a paused video. `applyIdle`'s breath
 * and sway are the right floor for a two-second pause and are not enough for a
 * two-minute one: they are periodic, so after one cycle the eye has seen
 * everything the character is ever going to do.
 *
 * What breaks that is *aperiodic* motion with a beginning and an end. Hence
 * one-shots on a random timer rather than more sine waves.
 *
 * ── How they layer ──────────────────────────────────────────────────────────
 *
 * Additively, on top of a pose that has already been reset this frame. Every
 * pose path in `Character.update` starts from `resetPose` (through `applyGait`
 * or `applyIdle`), so `bone.rotation.x += …` is idempotent — the same trap
 * `combat/postures.ts` documents at length for the hip lift, arrived at from the
 * other side. Nothing here writes `position`, so nothing here can accumulate
 * even if that ever stops being true.
 *
 * They are applied **before** `applyCombat`, which is the file's existing
 * layering rule (`gait → bank → carry → draw → shield`). That ordering is what
 * makes a drawn weapon suppress them for free: `carryArms` returns immediately
 * when `drawn === 'sheathed'`, so a character with nothing in their hands keeps
 * the gesture, and one holding a sword overwrites the arms with the carry — as
 * they should, because nobody scratches their nose with a drawn blade.
 *
 * ── Cost ────────────────────────────────────────────────────────────────────
 *
 * A few trig calls on at most nine bones, on characters that are standing still,
 * and only while a gesture is actually running (about 20 % of idle time).
 * Allocation-free: no closures, no arrays built per frame, and the scheduler is
 * five numbers on the `Character` that owns it.
 */

/** Smooth 0 → 1 → 0 over the clip, so a gesture starts and ends at the idle. */
const envelope = (t: number): number => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t
  // Rises over the first fifth, falls over the last quarter, flat between. A
  // symmetric bell would spend the whole gesture arriving and leaving; a hand
  // that reaches the head has to *stay* there long enough to be seen doing
  // something when it gets there.
  const rise = Math.min(1, x / 0.2)
  const fall = Math.min(1, (1 - x) / 0.25)
  const w = Math.min(rise, fall)
  return w * w * (3 - 2 * w)
}

/** Where in the flat middle of the clip we are, 0 → 1. Drives the rubbing. */
const middle = (t: number): number => {
  const x = (t - 0.2) / 0.55
  return x < 0 ? 0 : x > 1 ? 1 : x
}

export type FidgetKind =
  | 'scratchHead'
  | 'scratchNose'
  | 'rubBelly'
  | 'shiftWeight'
  | 'lookAround'
  | 'rollShoulders'

/** Every gesture, and how long it runs. Seconds. */
export const FIDGET_SECONDS: Record<FidgetKind, number> = {
  // Long enough to raise the arm, rub three or four times and lower it. Under
  // about 2.5 s the rub is a twitch.
  scratchHead: 3.2,
  scratchNose: 1.9,
  rubBelly: 3.6,
  shiftWeight: 2.8,
  lookAround: 3.0,
  rollShoulders: 2.2
}

const KINDS: readonly FidgetKind[] = [
  'scratchHead',
  'scratchNose',
  'rubBelly',
  'shiftWeight',
  'lookAround',
  'rollShoulders'
]

/**
 * ── Signs, because they are not guessable and have been got wrong ───────────
 *
 * From `rig.ts` and `combat/types.ts`, both of which state them:
 *
 *   * the figure faces **+Z** and **+X is its LEFT**;
 *   * a **negative** `rotation.x` on an upper arm raises it *forward*;
 *   * a **negative** `rotation.z` on `upperArm.R` lifts that arm *away* from the
 *     body — the right arm is on −X, so abduction is negative there and positive
 *     on the left. Bringing the right hand *across* to the face is therefore
 *     **positive** z, which is the pair most often written backwards;
 *   * a forearm folds *forwards*, so its flexion is **negative** x, unlike a
 *     knee;
 *   * `head.rotation.x` negative looks **up** (`applyGait` uses it to hold the
 *     eyes level against a forward lean).
 */
/**
 * ── The numbers are searched, not guessed, and the search moved the target ──
 *
 * The first draft raised the arm forward and folded the elbow hard, on the
 * reasoning that a hand reaching the head has to close the elbow. Rendered, it
 * put the hand **beside the chin** — a figure thinking, not scratching.
 *
 * So it was solved instead: a grid over (`upperArm.x`, `upperArm.z`,
 * `forearm.x`, `forearm.z`), scoring the world position of `hand.R` against the
 * skull, with the elbow required to sit above the shoulder and below the hand.
 * Distances are from the **head bone** (`rig.ts`, y = 1.14) in the character's
 * own frame, where **+X is its left**.
 *
 * The search found something worth writing down: **this figure cannot reach the
 * top of its own head.** Shoulder to wrist is 0.40 m and the shoulder sits 0.14
 * below the head bone, so a fully extended arm tops out 0.26 above it — while
 * the skull's centre is 0.15 above (`Character.HEAD_CENTRE_OFFSET`) and its
 * crown about 0.32. A chibi has short arms and a very large head. Best reach
 * with the elbow folded was +0.149, which is skull-centre height.
 *
 * The target therefore moved from the crown to the **temple**, which is where a
 * real scratch lands anyway. Measured at the values below: hand at
 * (−0.191, +0.160, −0.012), i.e. 0.192 from the skull centre against a radius of
 * about 0.19 — on the surface, above the ear, a shade behind. Elbow at
 * (−0.177, +0.039), out to the side and 0.18 above the shoulder, which is the
 * half of the silhouette that actually says "scratching" from twenty metres.
 */
const applyScratchHead = (bones: PoseTargets, t: number, w: number): void => {
  const m = middle(t)
  // Four rubs across the clip's middle.
  const rub = Math.sin(m * Math.PI * 8)

  const arm = bones.get('upperArm.R')
  if (arm) {
    // Almost all the way over: 2.8 rad is 160° of forward raise, which is what
    // takes the elbow above the head and lets the hand come *down* onto it.
    arm.rotation.x -= 2.8 * w
  }
  const forearm = bones.get('forearm.R')
  if (forearm) {
    // Barely folded, and that is the counter-intuitive half. With the arm over
    // the head the elbow has to stay *open* or the hand overshoots past the far
    // side of the skull; the fold that a lowered arm needs is exactly wrong here.
    forearm.rotation.x -= (0.8 + 0.1 * rub) * w
    forearm.rotation.z += 0.2 * w
  }
  const hand = bones.get('hand.R')
  if (hand) {
    hand.rotation.x -= 0.2 * w
    hand.rotation.z += 0.16 * rub * w
  }
  const shoulder = bones.get('shoulder.R')
  if (shoulder) {
    // The girdle goes with the arm, or the arm reads as bolted on — the same
    // note `poseSide` makes about a swinging arm. It also buys a little reach.
    shoulder.rotation.y -= 0.2 * w
    shoulder.rotation.x -= 0.14 * w
  }
  const head = bones.get('head')
  if (head) {
    // Tilts away from the hand and dips a little, which is what makes it read as
    // scratching rather than saluting.
    head.rotation.z += 0.11 * w
    head.rotation.x += 0.07 * w
  }
}

/**
 * Solved the same way, against a target at the front of the skull just below its
 * centre. Measured at the values below the hand lands at (−0.042, +0.046,
 * +0.197) from the head bone — dead in front of the face at nose height, 4 cm
 * off the midline, with the elbow 0.08 below it.
 */
const applyScratchNose = (bones: PoseTargets, t: number, w: number): void => {
  const m = middle(t)
  const rub = Math.sin(m * Math.PI * 6)

  const arm = bones.get('upperArm.R')
  if (arm) {
    arm.rotation.x -= 1.7 * w
    // Across the body. The right arm's *adduction* is positive z — this is the
    // pair `combat/types.ts` warns is most often written backwards.
    arm.rotation.z += 0.8 * w
  }
  const forearm = bones.get('forearm.R')
  if (forearm) {
    forearm.rotation.x -= (1.1 + 0.08 * rub) * w
  }
  const hand = bones.get('hand.R')
  if (hand) {
    hand.rotation.x -= (0.35 + 0.12 * rub) * w
  }
  const head = bones.get('head')
  if (head) {
    // A small dip toward the hand. People bring the face down to meet it as
    // much as the other way round.
    head.rotation.x += 0.09 * w
    head.rotation.y -= 0.05 * w
  }
}

const applyRubBelly = (bones: PoseTargets, t: number, w: number): void => {
  const m = middle(t)
  // Slow circles — two and a bit over the gesture, which at this arm length is
  // a hand travelling about 12 cm a second.
  const circle = m * Math.PI * 4.5

  // Searched against a target just above the hips and a little forward of the
  // spine: the hand lands at (0.047, 0.749, 0.187) in the character's own frame,
  // 7 cm from the mark. Note the upper arm barely lifts — the fold at the elbow
  // is what brings the hand up to the belly, and raising the shoulder as well
  // puts it on the chest.
  const arm = bones.get('upperArm.L')
  if (arm) {
    arm.rotation.x -= 0.1 * Math.sin(circle) * w
    // Inward, across the stomach: the left arm's *adduction* is negative z.
    arm.rotation.z -= 1.0 * w
  }
  const forearm = bones.get('forearm.L')
  if (forearm) {
    forearm.rotation.x -= (1.4 + 0.14 * Math.cos(circle)) * w
    forearm.rotation.y += 0.10 * Math.sin(circle) * w
  }
  const hand = bones.get('hand.L')
  if (hand) {
    hand.rotation.x -= 0.2 * w
    hand.rotation.z += 0.14 * Math.cos(circle) * w
  }
  const chest = bones.get('chest')
  if (chest) {
    chest.rotation.x += 0.035 * w
  }
}

/**
 * The one gesture with no arms in it, and the reason it exists.
 *
 * Three of the six above put a hand somewhere, and a character who only ever
 * fidgets with their hands reads as fussy. Shifting weight is what a person
 * standing still actually does most of the time, it is legible in silhouette
 * from any angle, and it survives being suppressed by a drawn weapon — which
 * makes it the only gesture an armed character still gets.
 */
const applyShiftWeight = (bones: PoseTargets, t: number, w: number): void => {
  // A single lean out and back, not a wobble.
  const lean = Math.sin(Math.min(1, t) * Math.PI)

  const hips = bones.get('hips')
  if (hips) {
    // Positive z-roll lifts the left hip (`applyGait`), so this drops onto the
    // left leg and pushes the right hip out.
    hips.rotation.z += 0.075 * lean * w
    hips.rotation.y += 0.05 * lean * w
  }
  const chest = bones.get('chest')
  if (chest) {
    // Counter-roll, or the whole figure tips like a bottle.
    chest.rotation.z -= 0.045 * lean * w
  }
  const head = bones.get('head')
  if (head) {
    head.rotation.z += 0.03 * lean * w
  }
  const shinL = bones.get('shin.L')
  if (shinL) {
    // The loaded knee straightens, the free one softens. `applyIdle` already
    // leaves them asymmetric; this swaps which one is carrying.
    shinL.rotation.x -= 0.05 * lean * w
  }
  const shinR = bones.get('shin.R')
  if (shinR) {
    shinR.rotation.x += 0.09 * lean * w
  }
}

const applyLookAround = (bones: PoseTargets, t: number, w: number): void => {
  // Left, hold, right, hold, back. Three dwells rather than a smooth sweep —
  // eyes move in saccades and a head that pans at constant speed reads as a
  // security camera.
  const x = Math.min(1, t)
  const swing = Math.sin(x * Math.PI * 2) * (1 - 0.35 * Math.cos(x * Math.PI * 4))

  const head = bones.get('head')
  if (head) {
    head.rotation.y += 0.62 * swing * w
    head.rotation.x -= 0.05 * Math.abs(swing) * w
  }
  const chest = bones.get('chest')
  if (chest) {
    // The torso follows a quarter of the way, which is what keeps the neck from
    // looking rubbery at the extremes.
    chest.rotation.y += 0.16 * swing * w
  }
}

const applyRollShoulders = (bones: PoseTargets, t: number, w: number): void => {
  const x = Math.min(1, t)
  const roll = Math.sin(x * Math.PI)

  for (const side of ['L', 'R'] as const) {
    const outward = side === 'L' ? 1 : -1
    const shoulder = bones.get(`shoulder.${side}` as 'shoulder.L')
    if (shoulder) {
      shoulder.rotation.y += outward * 0.2 * roll * w
      shoulder.rotation.x -= 0.12 * roll * w
    }
    const arm = bones.get(`upperArm.${side}` as 'upperArm.L')
    if (arm) {
      // Back and slightly out: the chest opens.
      arm.rotation.x += 0.22 * roll * w
      arm.rotation.z += outward * 0.12 * roll * w
    }
  }
  const chest = bones.get('chest')
  if (chest) {
    chest.rotation.x -= 0.09 * roll * w
  }
  const head = bones.get('head')
  if (head) {
    head.rotation.x -= 0.07 * roll * w
  }
}

const APPLY: Record<FidgetKind, (bones: PoseTargets, t: number, w: number) => void> = {
  scratchHead: applyScratchHead,
  scratchNose: applyScratchNose,
  rubBelly: applyRubBelly,
  shiftWeight: applyShiftWeight,
  lookAround: applyLookAround,
  rollShoulders: applyRollShoulders
}

/** Applies one gesture at its own point in time. `t` runs 0 → 1 across the clip. */
export const applyFidget = (bones: PoseTargets, kind: FidgetKind, t: number, weight = 1): void => {
  const w = envelope(t) * (weight < 0 ? 0 : weight > 1 ? 1 : weight)
  if (w <= 0.001) {
    return
  }
  APPLY[kind](bones, t, w)
}

/**
 * ─── When to do one ─────────────────────────────────────────────────────────
 *
 * A gap of 5–13 s between gestures, measured from the end of the last one, and
 * the first one comes 2–6 s after the character stops moving. Those numbers are
 * set by the thing this exists for: a dialogue beat runs about 6 s a line, so a
 * gap much longer than this means a whole conversation goes by with the listener
 * doing nothing, and much shorter reads as fidgeting rather than waiting.
 *
 * The scheduler is deliberately not shared between characters. Five people
 * standing round a table all scratching their heads on the same frame is worse
 * than five people standing still, so each `Character` owns one seeded from its
 * own construction order.
 */
export class Fidgets {
  /** The gesture running now, or null between them. */
  private kind: FidgetKind | null = null
  /** Seconds into the current gesture. */
  private elapsed = 0
  /** Seconds until the next one starts. */
  private wait: number
  private seed: number

  constructor(seed: number) {
    // Odd multiplier and a non-zero offset, so a seed of 0 is not a fixed point.
    this.seed = (seed * 2654435761 + 1013904223) >>> 0
    this.wait = 2 + this.random() * 4
  }

  /** xorshift32. One integer of state, no allocation, and stable across reloads. */
  private random(): number {
    let x = this.seed
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.seed = x >>> 0
    return this.seed / 4294967296
  }

  /**
   * Advances the scheduler.
   *
   * `stillness` is 1 when the character is completely at rest and 0 when they
   * are walking — `Character.moving`, inverted. A gesture in progress is
   * *abandoned* rather than paused when the character starts moving, because a
   * hand that resumes scratching a head two seconds after you stop walking, from
   * exactly where it left off, is the thing that looks broken.
   */
  update(dt: number, stillness: number): void {
    if (dt <= 0) {
      return
    }
    if (stillness < 0.6) {
      this.kind = null
      this.elapsed = 0
      // Not the full delay: somebody who has just stopped walking and is about
      // to be spoken to should not stand to attention for six seconds first.
      this.wait = 1.2 + this.random() * 2.5
      return
    }

    if (this.kind !== null) {
      this.elapsed += dt
      if (this.elapsed >= FIDGET_SECONDS[this.kind]) {
        this.kind = null
        this.elapsed = 0
        this.wait = 5 + this.random() * 8
      }
      return
    }

    this.wait -= dt
    if (this.wait <= 0) {
      this.kind = KINDS[Math.min(KINDS.length - 1, Math.floor(this.random() * KINDS.length))]!
      this.elapsed = 0
    }
  }

  /** Blends the running gesture onto the pose. A no-op between gestures. */
  apply(bones: PoseTargets, weight = 1): void {
    const kind = this.kind
    if (kind === null) {
      return
    }
    applyFidget(bones, kind, this.elapsed / FIDGET_SECONDS[kind], weight)
  }

  /** What is playing, for tests and for the perf panel. */
  get playing(): FidgetKind | null {
    return this.kind
  }
}
