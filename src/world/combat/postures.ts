import type { PoseTargets } from '../characters/poses'
import { applyClip } from './Combatant'
import type { PoseClip, PoseKey } from './types'

/**
 * ─── Sitting down ───────────────────────────────────────────────────────────
 *
 * Three clips and the arithmetic that produces them. Everything in this file
 * exists because of one beat: the frame act ends with a household sitting down
 * round a table to be told a story, and until now they *stood* round it — five
 * figures in the idle pose, arranged in the shape of people who are sitting,
 * with four stools and a chair passing through their shins.
 *
 * ── Why they are generated rather than authored ─────────────────────────────
 *
 * Every other clip in `combat/` is hand-keyed, because a sword swing is a
 * *performance* and there is no formula for one. A sit is the opposite: it is
 * almost entirely determined by one number, the height of the thing being sat
 * on, and the failure mode of hand-keying it is a figure whose feet hang 25 cm
 * above the boards. So the seated key below is solved from the rig's own bone
 * lengths, and the only authored parts are the ones that carry no constraint —
 * how far the torso leans, where the hands go, where the head looks.
 *
 * ── The arithmetic, and the thing it found ──────────────────────────────────
 *
 * From `rig.ts`: the hip pivot is 0.62 m up, the **thigh sockets sit 0.02 below
 * it** at 0.60, the thigh runs 0.60 → 0.33 and the shin 0.33 → 0.06, and the
 * ankle sits 0.06 above the sole. A figure's hip-to-sole is therefore
 * **0.62 m**, where a real adult's is about 0.90.
 *
 * For the feet to reach the floor from a seat at height `S`, the shin has to
 * span from the knee down to the ankle, so the knee cannot be higher than
 * `0.06 + 0.27 = 0.33`; the hip sits `0.09` above the seat; the thigh socket is
 * `0.02` below the hip; and the thigh has to cover the difference over its 0.27:
 *
 *     sin(decline) = (S + 0.09 − 0.02 − 0.06 − 0.27) / 0.27 = (S − 0.26) / 0.27
 *
 * At `S = 0.5` — the height `hut-stool` was authored at — that is 0.889, i.e.
 * the thigh must hang 63° below horizontal, which is not a sit, it is a crouch
 * against a stool. **The furniture in the storyteller's room was authored at
 * real-human scale for figures whose legs are two thirds of one.** The seats
 * came down to 0.34 m and the table to 0.56 with this file's numbers as the
 * reason; scaled by the same 0.62 / 0.90 those are exactly a 0.49 m chair and a
 * 0.81 m table, which is furniture.
 *
 * At 0.34 the decline is 17°, and the geometry closes: knee at 0.33, shin
 * vertical, sole on the boards.
 *
 * ── Two corrections, both found by measuring a seated figure in a browser ──
 *
 * The sum above used to hang a **0.29 thigh from the hip pivot** rather than a
 * 0.27 one from a socket 0.02 lower. Those have the same reach in the bind pose,
 * which is exactly why it survived, and they stop agreeing the moment the thigh
 * *rotates*: the 0.02 stays in the pelvis and only the 0.27 swings, so the knee
 * lands lower than the sum predicts.
 *
 * The second is the settled `hips.rotation.x`. Every clip below leans the pelvis
 * — forward on a backless seat, back into a chair that has a frame to lean on —
 * and the thighs are children of the pelvis, so that lean adds to the thigh's
 * *world* decline and the solved angle stops meaning what it was solved for.
 *
 * Measured on `SIT_BENCH` (seat 0.34, pelvis leaning 0.05 forward) by reading
 * `foot.L`'s world matrix on a seated player: the ankle came out at **0.0355**
 * against the 0.06 it is meant to hold — **the soles were 2.5 cm underground**,
 * on every figure that has ever sat down in this game. `seatedLeg` now takes the
 * pelvis pitch and cancels it at the hip, and the re-measurement is 0.0600.
 */

/** Hip pivot height in the bind pose, metres. `rig.ts`. */
const HIP_Y = 0.62
/**
 * How far below the hip pivot the thigh sockets sit. `rig.ts`: 0.62 → 0.60.
 *
 * Two centimetres, and load-bearing. It rides in the *pelvis*, so it does not
 * rotate with the leg — folding it into the thigh's length, which a single 0.29
 * constant did, drops the solved knee by exactly this much as soon as the thigh
 * swings forward.
 */
const PELVIS_DROP = 0.02
/** Thigh socket to knee, and knee to ankle. `rig.ts`: 0.60 → 0.33 → 0.06. */
const THIGH = 0.27
const SHIN = 0.27
/** The ankle bone's height above the sole. */
const ANKLE_Y = 0.06
/** How far the hip pivot sits above whatever is being sat on. */
const BUTTOCK = 0.09

/**
 * The seated leg, solved for a seat height.
 *
 * Returns the two joint angles and the hip drop, in the rig's own sign
 * convention (`combat/types.ts`): a **negative** `thigh.rotation.x` swings the
 * leg forward, a **positive** `shin.rotation.x` folds the knee back, and the
 * two are equal and opposite here because the shin ends up vertical — which is
 * the whole point of solving rather than guessing.
 *
 * `hipsPitch` **must be the settled key's own `hips.rotation.x`**. The call and
 * the key are written within a few lines of each other below for exactly that
 * reason: a pitch that disagrees with its clip puts back the 2.5 cm of sole
 * under the floor this argument exists to remove, and nothing will say so.
 */
const seatedLeg = (seat: number, hipsPitch = 0): { thigh: number; shin: number; drop: number } => {
  const hipY = seat + BUTTOCK
  const socket = hipY - PELVIS_DROP * Math.cos(hipsPitch)
  // Clamped at 0.94 rather than 1: a seat so high the leg cannot reach is a
  // furniture bug, and a figure perched on it with its thigh at 90° reads far
  // worse than one whose toes are a few centimetres short.
  const sine = Math.max(0, Math.min(0.94, (socket - ANKLE_Y - SHIN) / THIGH))
  const decline = Math.asin(sine)
  const swing = Math.PI * 0.5 - decline
  // ── The pelvis lean, cancelled at the hip and left alone at the knee ────
  //
  // Bone rotations compose down the chain, so a thigh's *world* decline is
  // `hipsPitch + thigh.rotation.x` and a shin's is that plus its own. Taking the
  // pitch off the thigh puts the world decline back where it was solved for;
  // leaving `+swing` on the shin then lands the shin exactly vertical, which is
  // the condition the whole solution is built on. Both halves are needed —
  // correcting only the thigh tilts the shin by the pitch instead, and a
  // seated figure with its shins raked back is a figure sliding off its chair.
  return { thigh: -swing - hipsPitch, shin: swing, drop: hipY - HIP_Y }
}

/** Seat heights, matching the props in `assets/interior.ts`. */
export const SEAT_HEIGHT = {
  /** `hut-chair`, the storyteller's. */
  chair: 0.34,
  /** `hut-stool`, six of them round the table. */
  stool: 0.34,
  /**
   * `village-bench`, the split-log plank — four of them round der Treff.
   *
   * The same 0.34 as a stool, and a separate kind anyway, because the height is
   * not what separates two seated poses: `SIT_STOOL`'s arms are angled to land
   * on a table top at 0.56 (`hut-table`), and a bench in a village square has
   * no table in front of it. Sharing the clip would put a figure's forearms on
   * thin air in the one place in the chapter the player can walk all the way
   * round them.
   */
  bench: 0.34,
  /** `hut-bed`'s mattress. */
  bed: 0.42,
  /** The boards. A cross-legged figure's hips clear them by about this much. */
  floor: 0.1
} as const

export type SeatKind = keyof typeof SEAT_HEIGHT
export type Posture = 'stand' | SeatKind

/**
 * A clip that starts standing, passes through a crouch and ends seated.
 *
 * Three keys, and the middle one is the whole animation: without it a sit is a
 * cross-fade between two static poses, and the figure sinks through the seat
 * with its legs already folded. The mid key is at t = 0.55 rather than 0.5
 * because sitting is not symmetric — a person drops most of the way quickly and
 * settles the last few centimetres slowly, and the late crest is what reads as
 * weight.
 *
 * `t = 0` is empty on purpose. `applyClip` interpolates a bone the neighbouring
 * key does not name **against the bind pose**, so an empty first key is exactly
 * "standing", and the clip can be blended in from a walk or an idle without
 * naming a single bone it does not intend to move.
 */
const sitClip = (seat: number, settled: PoseKey['bones'], hipsExtra = 0): PoseClip => {
  const leg = seatedLeg(seat)
  return [
    { t: 0, bones: {}, hips: 0 },
    {
      // The crouch. Knees over the toes, weight forward, hands starting toward
      // the seat — a person reaching back for a stool leans *into* the room, not
      // away from it, and getting that backwards is what makes a sit look like a
      // fall.
      t: 0.55,
      bones: {
        hips: [0.16, 0, 0],
        chest: [0.1, 0, 0],
        head: [-0.14, 0, 0],
        'thigh.L': [leg.thigh * 0.62, 0, 0.05],
        'thigh.R': [leg.thigh * 0.62, 0, -0.05],
        'shin.L': [leg.shin * 0.78, 0, 0],
        'shin.R': [leg.shin * 0.78, 0, 0],
        'foot.L': [-0.16, 0, 0],
        'foot.R': [-0.16, 0, 0],
        'upperArm.L': [-0.34, 0, 0.16],
        'upperArm.R': [-0.34, 0, -0.16],
        'forearm.L': [-0.5, 0, 0],
        'forearm.R': [-0.5, 0, 0]
      },
      hips: (leg.drop + hipsExtra) * 0.55
    },
    { t: 1, bones: settled, hips: leg.drop + hipsExtra }
  ]
}

/**
 * The storyteller's chair: back against the slats, hands on the thighs.
 *
 * The one seat in the room with a back, so it is the one pose that can lean
 * *into* something — `hips.rotation.x` is negative here where every other
 * posture is upright or forward. That is the read the dialogue camera holds on
 * for the whole act.
 */
const CHAIR_LEG = seatedLeg(SEAT_HEIGHT.chair, -0.15)
export const SIT_CHAIR: PoseClip = sitClip(SEAT_HEIGHT.chair, {
  hips: [-0.15, 0, 0],
  spine: [-0.04, 0, 0],
  chest: [0.02, 0, 0],
  // Eyes back on the level. A leaning torso with a head that leans with it is a
  // figure asleep, and this one is about to talk for an hour.
  head: [0.13, 0, 0],
  'thigh.L': [CHAIR_LEG.thigh, 0, 0.07],
  'thigh.R': [CHAIR_LEG.thigh, 0, -0.07],
  'shin.L': [CHAIR_LEG.shin, 0, 0],
  'shin.R': [CHAIR_LEG.shin, 0, 0],
  'foot.L': [0, 0, 0],
  'foot.R': [0, 0, 0],
  // Forearms along the thighs, hands over the knees.
  'upperArm.L': [-0.36, 0, 0.2],
  'upperArm.R': [-0.36, 0, -0.2],
  'forearm.L': [-0.78, 0, 0],
  'forearm.R': [-0.78, 0, 0],
  'hand.L': [-0.3, 0, 0],
  'hand.R': [-0.3, 0, 0]
})

/**
 * A stool at the table: upright, forearms on the board.
 *
 * No back to lean on, so the spine carries a little forward lean instead — a
 * person on a backless stool at a table props themselves on the table, and the
 * arms below are angled to land on a top at 0.56 m.
 */
const STOOL_LEG = seatedLeg(SEAT_HEIGHT.stool, 0.06)
export const SIT_STOOL: PoseClip = sitClip(SEAT_HEIGHT.stool, {
  hips: [0.06, 0, 0],
  chest: [0.06, 0, 0],
  head: [-0.08, 0, 0],
  'thigh.L': [STOOL_LEG.thigh, 0, 0.06],
  'thigh.R': [STOOL_LEG.thigh, 0, -0.06],
  'shin.L': [STOOL_LEG.shin, 0, 0],
  'shin.R': [STOOL_LEG.shin, 0, 0],
  'foot.L': [0, 0, 0],
  'foot.R': [0, 0, 0],
  'upperArm.L': [-0.62, 0, 0.14],
  'upperArm.R': [-0.62, 0, -0.14],
  'forearm.L': [-0.62, 0, 0],
  'forearm.R': [-0.62, 0, 0],
  'hand.L': [0.1, 0, 0],
  'hand.R': [0.1, 0, 0]
})

/**
 * A bench in the open: upright, hands on the knees.
 *
 * The same solved leg as the stool — both seats are 0.34 — and a different
 * upper body, which is the whole reason it is a fourth clip. `SIT_STOOL` is a
 * person *at a table*: its `upperArm`/`forearm` pair swings the hands forward
 * and up onto a top at 0.56, and that pose only reads because the table is
 * there to catch them. Der Treff has a fire pit in the middle and nothing at
 * elbow height at all, so the arms come down instead and the hands land on the
 * thighs.
 *
 * `-0.30` at the shoulder against the chair's `-0.36`, and `-0.88` at the
 * elbow against its `-0.78`: the chair's torso leans back 0.15 rad and carries
 * the shoulders with it, so an upright figure needs a little less shoulder and
 * a little more elbow to put the hands in the same place relative to its own
 * knees. A backless seat is upright by definition — there is nothing to lean
 * on — so `hips` carries a small *forward* lean instead, which is what a
 * person on a bench actually does.
 */
const BENCH_LEG = seatedLeg(SEAT_HEIGHT.bench, 0.05)
export const SIT_BENCH: PoseClip = sitClip(SEAT_HEIGHT.bench, {
  hips: [0.05, 0, 0],
  chest: [0.04, 0, 0],
  head: [-0.07, 0, 0],
  'thigh.L': [BENCH_LEG.thigh, 0, 0.07],
  'thigh.R': [BENCH_LEG.thigh, 0, -0.07],
  'shin.L': [BENCH_LEG.shin, 0, 0],
  'shin.R': [BENCH_LEG.shin, 0, 0],
  'foot.L': [0, 0, 0],
  'foot.R': [0, 0, 0],
  'upperArm.L': [-0.3, 0, 0.19],
  'upperArm.R': [-0.3, 0, -0.19],
  'forearm.L': [-0.88, 0, 0],
  'forearm.R': [-0.88, 0, 0],
  'hand.L': [-0.24, 0, 0],
  'hand.R': [-0.24, 0, 0]
})

/**
 * Sitting on the edge of a bed.
 *
 * Higher than a stool, so the thighs decline further and the knees come down —
 * `seatedLeg` does that on its own from the mattress height, which is the
 * reason it is solved and not keyed.
 */
const BED_LEG = seatedLeg(SEAT_HEIGHT.bed, 0.04)
export const SIT_BED: PoseClip = sitClip(SEAT_HEIGHT.bed, {
  hips: [0.04, 0, 0],
  chest: [0.09, 0, 0],
  head: [-0.1, 0, 0],
  'thigh.L': [BED_LEG.thigh, 0, 0.09],
  'thigh.R': [BED_LEG.thigh, 0, -0.09],
  'shin.L': [BED_LEG.shin, 0, 0],
  'shin.R': [BED_LEG.shin, 0, 0],
  'foot.L': [-0.06, 0, 0],
  'foot.R': [-0.06, 0, 0],
  // Hands on the mattress either side, taking some of the weight — which is how
  // anybody sits on a bed and is the only thing that separates this pose from
  // the stool at a glance.
  'upperArm.L': [0.28, 0, 0.24],
  'upperArm.R': [0.28, 0, -0.24],
  'forearm.L': [-0.24, 0, 0],
  'forearm.R': [-0.24, 0, 0]
})

/**
 * ─── Cross-legged on the boards ─────────────────────────────────────────────
 *
 * The children's posture, and the only one here that is not solved: there is no
 * seat height to solve against, and a cross-legged fold is a *shape* rather than
 * a constraint. Every number below is authored.
 *
 * It is also the only one that does not go through `sitClip`. A person sitting
 * down on the floor does not pass through the same crouch as a person sitting on
 * a stool — they go down considerably further, put a hand out behind them on the
 * way, and fold the legs at the bottom rather than on the way. That is four
 * keys, and it is worth them: this is the pose the frame act ends holding, with
 * two children in it, in shot, for the length of a chapter.
 *
 * ── The knees go out, not the shins in ──────────────────────────────────────
 *
 * A cross-legged fold really crosses the shins, and this rig cannot: a shin bone
 * points down its own axis, so `rotation.y` on it is a spin about that axis and
 * moves the foot nowhere. What carries the read instead is the **abduction of
 * the thigh** — `rotation.z`, outward, which is `+z` on the left leg and `−z` on
 * the right (`combat/types.ts` states this convention and it has been got
 * backwards once) — plus a knee folded past 120°. Knees wide and low is the
 * silhouette; whether the ankles actually overlap is not something anybody can
 * see from the dialogue camera.
 */
export const SIT_FLOOR: PoseClip = [
  { t: 0, bones: {}, hips: 0 },
  {
    // Half way down, hands going back.
    t: 0.5,
    bones: {
      hips: [0.22, 0, 0],
      chest: [0.14, 0, 0],
      head: [-0.2, 0, 0],
      'thigh.L': [-0.9, 0, 0.22],
      'thigh.R': [-0.9, 0, -0.22],
      'shin.L': [1.5, 0, 0],
      'shin.R': [1.5, 0, 0],
      'foot.L': [-0.24, 0, 0],
      'foot.R': [-0.24, 0, 0],
      'upperArm.L': [0.5, 0, 0.2],
      'upperArm.R': [0.5, 0, -0.2],
      'forearm.L': [-0.2, 0, 0],
      'forearm.R': [-0.2, 0, 0]
    },
    hips: -0.3
  },
  {
    // Down, weight still on the hands behind.
    t: 0.82,
    bones: {
      hips: [-0.08, 0, 0],
      chest: [0.08, 0, 0],
      head: [-0.24, 0, 0],
      'thigh.L': [-1.24, 0, 0.42],
      'thigh.R': [-1.24, 0, -0.42],
      'shin.L': [1.95, 0, 0],
      'shin.R': [1.95, 0, 0],
      'foot.L': [-0.3, 0, 0],
      'foot.R': [-0.3, 0, 0],
      'upperArm.L': [0.72, 0, 0.28],
      'upperArm.R': [0.72, 0, -0.28],
      'forearm.L': [-0.12, 0, 0],
      'forearm.R': [-0.12, 0, 0]
    },
    hips: -0.47
  },
  {
    // Settled: knees wide, hands in the lap, chin up.
    t: 1,
    bones: {
      hips: [-0.02, 0, 0],
      spine: [0.05, 0, 0],
      chest: [0.06, 0, 0],
      // Looking up at whoever is in the chair. The one line in this file that is
      // pure blocking: the children are the audience, and an audience that is
      // not looking at the storyteller is furniture.
      head: [-0.26, 0, 0],
      'thigh.L': [-1.32, 0, 0.62],
      'thigh.R': [-1.32, 0, -0.62],
      'shin.L': [2.24, 0, 0],
      'shin.R': [2.24, 0, 0],
      'foot.L': [-0.34, 0, 0],
      'foot.R': [-0.34, 0, 0],
      'upperArm.L': [-0.34, 0, 0.34],
      'upperArm.R': [-0.34, 0, -0.34],
      'forearm.L': [-1.05, 0, 0],
      'forearm.R': [-1.05, 0, 0],
      'hand.L': [-0.2, 0, 0],
      'hand.R': [-0.2, 0, 0]
    },
    // The hip pivot ends about 0.16 above the boards against its 0.62 standing
    // height. A cross-legged pelvis does not sit *on* the floor — the folded
    // thighs are under it — which is the difference between sitting and lying.
    hips: SEAT_HEIGHT.floor + BUTTOCK - HIP_Y
  }
]

/** The clip for each seat. */
export const POSTURE_CLIP: Record<SeatKind, PoseClip> = {
  chair: SIT_CHAIR,
  stool: SIT_STOOL,
  bench: SIT_BENCH,
  bed: SIT_BED,
  floor: SIT_FLOOR
}

/**
 * Seconds to sit down, and to stand back up again.
 *
 * 0.85 rather than the ~0.55 a `DODGE` takes: sitting is the one motion in this
 * game nobody is in a hurry to finish, and an old man dropping into a chair in
 * half a second is a man falling into it. Standing runs the same clip backwards
 * at the same rate, which is not quite true of a real person and is invisible.
 */
export const SIT_SECONDS = 0.85

/**
 * How hard the posture overrides whatever the gait left behind.
 *
 * Ramped over the first third of the sit rather than held at 1, because the
 * clip's first key is empty — i.e. the bind pose — and blending straight to it
 * at full weight would snap a breathing idle to attention on the frame the sit
 * begins. By a third of the way in the clip is saying something of its own and
 * can be trusted with the whole body.
 */
const postureWeight = (blend: number): number => (blend <= 0 ? 0 : Math.min(1, blend * 3))

/**
 * ─── Poses a seated figure, and re-seats its pelvis first ───────────────────
 *
 * The reset is not tidiness. `applyClip` blends every *rotation* toward its key
 * — `bone.rotation.x += (target − current) × weight`, which converges and is
 * stable however often it runs — but it **adds** the hip lift:
 * `hips.position.y += lift × weight`. That is right for a clip composed on top
 * of a freshly reset pose, and it is right for a jump, which is where the field
 * came from.
 *
 * It is catastrophic on a *frozen* frame. `CombatDirector.update` calls `settle`
 * with `dt = 0` while a conversation is up — deliberately, so the cast stands
 * where the story put them instead of at the origin — and `Character.update`
 * returns before `resetPose` when `dt <= 0`. So the pelvis is never put back,
 * and a −0.19 m lift lands on it again every frame for as long as anybody is
 * talking. Measured, in the frame act, after about two hundred frames of
 * dialogue: **the household's heads were between 30 and 52 metres underground**,
 * and the dialogue camera was framing a shot from inside the hill.
 *
 * Setting the pelvis back to its bind height first makes the lift idempotent,
 * which is what a *posture* has to be: unlike a swing, it is a state the actor
 * holds for minutes, and every frame of it re-evaluates the same pose.
 *
 * The cost is the gait's 6 mm bob and the idle's breath on a seated figure,
 * which is not a loss — neither belongs on somebody sitting in a chair.
 */
export const applyPosture = (bones: PoseTargets, seat: SeatKind, blend: number): void => {
  if (blend <= 0) {
    return
  }
  const hips = bones.get('hips')
  if (hips) {
    hips.position.y = HIP_Y
  }
  applyClip(bones, POSTURE_CLIP[seat], blend, postureWeight(blend))
}
