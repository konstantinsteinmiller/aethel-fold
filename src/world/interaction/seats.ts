import { SEAT_HEIGHT, type SeatKind } from '../combat/postures'
import type { Placement } from '../level/types'

/**
 * ─── What can be sat on, and where exactly ──────────────────────────────────
 *
 * The catalogue half of `world/interaction/`. `combat/postures.ts` knows how a
 * figure folds onto a seat at height `S`; this knows which props *are* seats,
 * where on each of them the buttocks go, and which way the sitter ends up
 * looking. Nothing here knows about a chapter, a player or a camera — a seat is
 * a fact about a placed prop, exactly as a collider is.
 *
 * ── The anchor is the top face, not the model origin ────────────────────────
 *
 * `applyPosture` lowers the pelvis to `seat + 0.09` **above the character's own
 * root**, and the root stands on the ground. So the number this file has to get
 * right is the height of the surface the buttocks rest on, measured from the
 * placement's origin — and the placement's origin sits on the terrain, because
 * every seat in the catalogue has `groundOffset: 0` (asserted in
 * `tests/world/seats.test.ts`, which is the only thing stopping a
 * catalogue edit from silently sinking every sitter in the game).
 *
 * Every `y` below was measured off the built tier-0 mesh rather than read off
 * the generator's arguments, because those two disagree more often than they
 * look like they could: `hut-chair`'s seat plank passed its half-extents in the
 * wrong order and rendered as a 0.57 m vertical fin, and `village-bench`'s
 * plank puts its *centre* at the number in the source and its top face 5.5 cm
 * higher. Both are fixed in the generators now; the derivations are written
 * against the fixed geometry and each one names the member it came from.
 *
 * ── Facing: three modes, because three kinds of seat exist ──────────────────
 *
 * A bench sat on backwards is worse than no feature, and a stool has no
 * backwards. So a seat says how much freedom a sitter has:
 *
 *   `fixed`   one legal facing. A chair has a back; a bed has a wall behind it.
 *   `either`  two, 180° apart. A bench's plank runs along its local X, so the
 *             sitter faces ±Z and nothing else — but either of those is a
 *             perfectly good bench.
 *   `free`    any. A three-legged stool is a surface of revolution; its own
 *             `rotY` is decorative jitter (`frame.ts` gives the six round the
 *             table yaws of 0.1, 0.0, −0.2, π+0.15, π, π−0.1) and obeying it
 *             would sit three of the household with their backs to the table.
 *
 * Within whatever the mode allows, the rule is **face back the way you came**:
 * a person walking up to a bench turns round and sits looking at where they
 * walked from. `resolveSeatFacing` below is that rule, and it is the whole of
 * why the catalogue does not need a per-placement facing.
 *
 * ── One occupant per seat, and the shape says so ────────────────────────────
 *
 * `anchors` is an array and every entry in it today has exactly one element,
 * including `village-bench`, whose plank is 1.84 m long and would comfortably
 * take two. That is a v1 decision, not a limit of the data: seating a second
 * person needs an occupancy set (who is in which slot) and a finder that can
 * score the slots of one placement separately, and neither exists yet. What the
 * array buys is that adding them is a data edit plus a scan change, rather than
 * a change to every consumer's idea of what a seat is.
 */

/** How a sitter's yaw is decided once they reach the seat. See the header. */
export type SeatFacingMode = 'fixed' | 'either' | 'free'

/** One place one person can sit, in the placement's own local space. */
export interface SeatAnchor {
  /** Metres along the prop's local X from its origin. */
  x: number
  /** Height of the surface the buttocks rest on, above the prop's origin. */
  y: number
  /** Metres along the prop's local Z from its origin. */
  z: number
  /**
   * Yaw a sitter faces, as an offset added to the placement's own `rotY`.
   *
   * Ignored entirely when `facing` is `'free'`, and taken as one of a pair
   * (`this`, `this + π`) when it is `'either'`.
   */
  yaw: number
  facing: SeatFacingMode
  /**
   * Metres in front of the anchor the walk-up stops at, along the sit facing.
   *
   * Derived, not chosen: it is the seat's own front edge plus the sitter's
   * body radius (`STATS.athalus.radius`, 0.32), so the figure ends the walk
   * standing clear of the furniture and then settles back onto it over
   * `SIT_SECONDS`. Each entry shows the sum.
   */
  approach: number
}

export interface SeatDefinition {
  /** Which clip in `combat/postures.ts` this seat is sat on with. */
  kind: SeatKind
  /** One per occupant. See the header: every seat is single-occupancy in v1. */
  anchors: readonly SeatAnchor[]
}

/** The sitter's body radius, from `combat/movesets.ts::STATS.athalus`. */
const SITTER_RADIUS = 0.32

/**
 * Every placeable id a figure can sit on, and where.
 *
 * A literal, deliberately, rather than a field on `PlaceableDefinition`: the
 * catalogue drains over the ~30 frames after the first render (see
 * `level/catalog.ts`), and a seat index built against it on frame one comes out
 * empty and stays empty — which is exactly how the whole hamlet once failed to
 * draw. Nothing in this file reads `getPlaceable`, so the index can be built the
 * moment the placements exist.
 *
 * ── What is deliberately not in here ────────────────────────────────────────
 *
 * `tree-stump` and `tree-log`, the two things the bandits' camp uses as seats
 * (`story/camp.ts` even calls the log "long side to the fire so it reads as a
 * bench"). Measured on their tier-0 meshes: the stump's top is a shallow dome
 * at **0.74 m** and the log's is a round, tapered back running **0.55 → 0.68 m**
 * over half a metre of its length, both before a `scaleRange` that stretches to
 * 1.35. `seatedLeg` clamps above 0.63 and hands back a figure with its feet in
 * the air, which is precisely the failure `combat/postures.ts` exists to
 * prevent. A camp seat needs a prop with a flat top at 0.34; until there is
 * one, the bandits keep standing, which `camp.ts` argues for on its own terms.
 *
 * `hut-table`, `village-crates`, `village-barrel` and the rest of the yard: all
 * of them are things you *could* perch on and none of them is a seat, and a
 * world where every box takes an [E] prompt is a world where the prompt means
 * nothing.
 */
export const SEAT_CATALOGUE: Readonly<Record<string, SeatDefinition>> = {
  /**
   * The storyteller's chair. `assets/interior.ts::createHutChairAsset`.
   *
   * Top face of `chair/seat` — a plank centred at 0.305 with a 0.035
   * half-thickness — so 0.34, which is `SEAT_HEIGHT.chair`.
   *
   * `z: +0.08` is not new: `story/frame.ts::FRAME_MARKS.storyteller` already
   * stands the old man at the chair's placement + 0.08 in Z, and that mark was
   * set by somebody looking at the result. The plank spans z ∈ [−0.24, 0.26]
   * with the back stiles behind it at −0.2 → −0.31, so +0.08 puts the hip pivot
   * a little forward of the plank's centre — where a sitter's is, because the
   * buttocks are behind the pivot and the back is behind them.
   *
   * `fixed`: the one seat in the room with a back. The front legs are at
   * z = +0.21 and the ladder-back at z ≈ −0.3, so +Z is out of the chair.
   *
   * approach = (plank front 0.26 + half 0.035 − anchor 0.08) + 0.32 = 0.535.
   */
  'hut-chair': {
    kind: 'chair',
    anchors: [{ x: 0, y: SEAT_HEIGHT.chair, z: 0.08, yaw: 0, facing: 'fixed', approach: 0.535 }]
  },

  /**
   * A stool at the table. `assets/interior.ts::createHutStoolAsset`.
   *
   * `stool/seat` is a vertical beam from 0.28 to 0.34 with a 0.21 radius; a
   * beam's extents taper to zero at its path ends, so 0.34 *is* the top face
   * with nothing to add. That is where `SEAT_HEIGHT.stool` came from.
   *
   * `free`: three legs and a round top, so it has no front. See the header on
   * why obeying its `rotY` is worse than ignoring it.
   *
   * approach = seat radius 0.21 + 0.32 = 0.53.
   */
  'hut-stool': {
    kind: 'stool',
    anchors: [{ x: 0, y: SEAT_HEIGHT.stool, z: 0, yaw: 0, facing: 'free', approach: 0.53 }]
  },

  /**
   * The split-log bench. `assets/villageProps.ts::createBenchAsset`.
   *
   * `bench/seat` is a plank centred at 0.285 with a 0.055 half-thickness, so
   * its top face is at 0.34 = `SEAT_HEIGHT.bench`. It runs along local X for
   * 1.84 m and is 0.42 deep in Z.
   *
   * `either`: the plank has two identical long sides and no back, so ±Z are
   * both correct and ±X never is. That matters at der Treff, where the four
   * benches are laid tangentially round the fire pit
   * (`story/level.ts`, `rotY = −angle + π/2`, which puts local +Z radially
   * *outward*) — a `fixed` +Z would seat every one of them facing away from the
   * fire the square exists for.
   *
   * approach = half-depth 0.21 + 0.32 = 0.53.
   */
  'village-bench': {
    kind: 'bench',
    anchors: [{ x: 0, y: SEAT_HEIGHT.bench, z: 0, yaw: 0, facing: 'either', approach: 0.53 }]
  },

  /**
   * The edge of the bed. `assets/interior.ts::createHutBedAsset`.
   *
   * Not a bench, a chair or a stool, and in here because `SIT_BED` already
   * exists, is the only clip in the set that takes weight on the hands, and had
   * no way to be seen: nothing in the chapter sits anybody on a bed.
   *
   * `bed/mattress` crowns at 0.42 across its full width before tapering to a
   * rolled edge at 0.44 — 0.42 is the number `SEAT_HEIGHT.bed` was solved
   * against and the one the comment in the generator names.
   *
   * `x: +0.45` is the foot end. The cushion is authored at x = −0.52 and is the
   * frame act's first objective; sitting on it would bury the one saturated
   * colour in the room. `z: +0.30` is inboard of the 0.56 mattress edge by
   * about a hand's width, which is where somebody sitting on a bed puts
   * themselves — on it, not on the rail.
   *
   * `fixed`: the bed is against the west wall with its local +Z turned into the
   * room (`frame.ts` places it at a quarter turn), so +Z is the only side of it
   * a person can sit on.
   *
   * approach = (mattress edge 0.56 − anchor 0.30) + 0.32 = 0.58.
   */
  'hut-bed': {
    kind: 'bed',
    anchors: [{ x: 0.45, y: SEAT_HEIGHT.bed, z: 0.3, yaw: 0, facing: 'fixed', approach: 0.58 }]
  }
}

/**
 * A seat resolved into world space, once, at load.
 *
 * Flat numbers rather than a `Placement` plus an anchor, because the scan reads
 * these sixty times a second and every field it needs has to be one property
 * access away. Positions are static — no chapter moves a bench — so the whole
 * struct is computed at build time and never touched again.
 */
export interface WorldSeat {
  /** The placement this came from, so two benches are never confused. */
  placementId: string
  defId: string
  kind: SeatKind
  /** Which of the definition's anchors this is. Always 0 today. */
  anchorIndex: number
  /** Where the buttocks go, world space. `y` is the seat's top face. */
  x: number
  y: number
  z: number
  /** The anchor's `yaw` already rotated into world space. */
  yaw: number
  facingMode: SeatFacingMode
  approach: number
}

/**
 * Resolves every sittable placement into world-space seats.
 *
 * `groundAt` is the terrain sampler. It is sampled here, once, for the same
 * reason `World.setStoryPlacements` samples it once: a placement's y is
 * `terrain + groundOffset + lift`, `groundOffset` is 0 for every seat in the
 * catalogue and `lift` is carried through, so the seat's world height is fixed
 * the moment the terrain is.
 */
export const buildWorldSeats = (
  placements: readonly Placement[],
  groundAt: (x: number, z: number) => number
): WorldSeat[] => {
  const out: WorldSeat[] = []
  for (const placement of placements) {
    const definition = SEAT_CATALOGUE[placement.defId]
    if (!definition) {
      continue
    }
    const scale = placement.scale || 1
    const cos = Math.cos(placement.rotY)
    const sin = Math.sin(placement.rotY)
    const base = groundAt(placement.x, placement.z) + (placement.lift ?? 0)
    for (let i = 0; i < definition.anchors.length; i++) {
      const anchor = definition.anchors[i]!
      const localX = anchor.x * scale
      const localZ = anchor.z * scale
      out.push({
        placementId: placement.id,
        defId: placement.defId,
        kind: definition.kind,
        anchorIndex: i,
        // A yaw rotation about +Y takes local +X to (cos, −sin) and local +Z to
        // (sin, cos) — three's own convention, and the one `frame.ts` reasons
        // in when it turns the bed a quarter turn to put its length on the wall.
        x: placement.x + localX * cos + localZ * sin,
        y: base + anchor.y * scale,
        z: placement.z - localX * sin + localZ * cos,
        yaw: placement.rotY + anchor.yaw,
        facingMode: anchor.facing,
        approach: anchor.approach * scale
      })
    }
  }
  return out
}

/** Wraps a yaw into (−π, π]. */
const wrap = (angle: number): number => {
  let a = angle
  while (a > Math.PI) {
    a -= Math.PI * 2
  }
  while (a < -Math.PI) {
    a += Math.PI * 2
  }
  return a
}

/**
 * Which way a sitter ends up looking, given where they were standing.
 *
 * The rule is "face back the way you came", expressed as *face the point you
 * asked from*: `fromX/fromZ` is where the player was when they pressed the key,
 * so `atan2(from − seat)` is the yaw that turns the figure round to look at it.
 * Then the seat's own mode narrows it — `fixed` throws it away, `either` keeps
 * whichever of the plank's two sides it is nearer to, `free` takes it whole.
 *
 * Pure, and unit-tested, because getting it backwards is the failure the whole
 * `facing` field exists to prevent and it is invisible in a diff.
 */
export const resolveSeatFacing = (seat: WorldSeat, fromX: number, fromZ: number): number => {
  if (seat.facingMode === 'fixed') {
    return seat.yaw
  }
  const dx = fromX - seat.x
  const dz = fromZ - seat.z
  // Standing exactly on the seat says nothing about which way to turn, so the
  // seat's own yaw is the honest answer rather than an `atan2` of two zeroes.
  const approach = dx * dx + dz * dz < 1e-6 ? seat.yaw : Math.atan2(dx, dz)
  if (seat.facingMode === 'free') {
    return approach
  }
  // `either`: the plank's two sides, and the one the walker is already nearer.
  return Math.abs(wrap(approach - seat.yaw)) <= Math.PI * 0.5 ? seat.yaw : wrap(seat.yaw + Math.PI)
}
