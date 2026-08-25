import { Color, Vector2, Vector3 } from 'three'
import { C } from '../../art/palette'
import { EQUIPMENT_BUDGET } from '../equipment'
import { circleSection, finishGear, type GearModel, paintPart, splineAt, splineSection, sweep } from './gearKit'

/**
 * ─── The heater shield ──────────────────────────────────────────────────────
 *
 * Frame (see `index.ts`, and `ITEM_FORWARD_AXIS` in `equipment.ts`): the **grip
 * bar** is at the origin and runs ±X, the board's width is ±X, its point hangs
 * **−Y**, and the face and boss look **+Z**.
 *
 * This is the one item where the contract's second clause — "front facing +Z" —
 * is completely unambiguous, so it is followed to the letter. The payoff is that
 * a shield at `SOCKETS.handL` with the socket's own zero rotation already faces
 * the way the character does (`equipment.ts`: the character faces +Z), and the
 * animation layer has nothing to undo.
 *
 * ── Point-down, and where the hand actually sits ────────────────────────────
 *
 * The board's centre is 45 mm **below** the grip, so the point hangs 201 mm
 * below the fist and the top edge stands 110 mm above it. That is where a heater
 * sits on an arm: elbow low, hand high, point past the knee.
 *
 * The two enarmes follow from it and are the reason those numbers are not free
 * to drift. The grip bar and the forearm strap are both perpendicular to the
 * forearm, so they are parallel to each other (both ±X) and separated **along**
 * it (55 mm in Y). The arm therefore runs ±Y across the board's back.
 *
 * **The elbow is at +Y, and this file first said −Y.** The item frame runs its
 * length along −Y (`ITEM_FORWARD_AXIS`), so −Y is the *point*; the arm goes the
 * other way. `SOCKETS.handL` has an identity rotation and `buildSkeleton` leaves
 * every bone unrotated in bind pose, so the item's axes are the hand bone's are
 * the world's — and `forearm.L` sits 190 mm **above** `hand.L`. With the strap at
 * −55 mm it was on the point side, measured a constant **90 mm off the forearm
 * segment in every carriage**, and the animation layer had nothing real to put
 * the arm through. Put the strap beside the grip in X instead and the arm would
 * have to lie along the bar it is supposed to cross.
 *
 * ── The back face is modelled, deliberately ─────────────────────────────────
 *
 * A strap and a grip bar are 76 triangles — a third of the budget — spent on a
 * surface the camera sees perhaps a fifth of the time. They are here because the
 * alternative is that the animation layer has to *invent* where the hand goes,
 * and a hand placed against a flat board sinks into it. There is now a bar at a
 * known place with a known radius, and it is at the origin.
 *
 * ── Board construction ──────────────────────────────────────────────────────
 *
 * The board is swept along **Z**, from the front dome's pole through the rim to
 * the back pole — a sphere's parameterisation with a heater outline substituted
 * for the circle. So the front is domed, the rim is a genuine rolled edge with
 * thickness (a 16 mm roll, not a chamfer), and the back is shallower. That is
 * one closed surface with no join, which is the only construction that gets a
 * bevel on the rim for free.
 *
 * The outline's bottom point lands on `v = ½` and the top centre on `v = 0`, and
 * the sweep samples 12 segments — so both are on the grid. A heater sampled at
 * 10 or 14 rounds off its own point, which is the one feature that separates it
 * from a dinner tray.
 */

const AXIS_X = new Vector3(1, 0, 0)
const AXIS_Y = new Vector3(0, 1, 0)
const AXIS_Z = new Vector3(0, 0, 1)

const _color = new Color()
const _sec = new Vector2()

/** Board centre, in the grip's frame. Below the fist — see the header. */
const BOARD_Y = -0.045
const BOARD_HALF_HEIGHT = 0.155
const BOARD_HALF_WIDTH = 0.135

const HEATER_POINTS: readonly (readonly [number, number])[] = [
  [1.0, 0.0],
  [0.98, 0.52],
  [0.92, 0.95],
  [0.45, 1.0],
  [-0.1, 0.88],
  [-0.72, 0.55],
  [-1.15, 0.0],
  [-0.72, -0.55],
  [-0.1, -0.88],
  [0.45, -1.0],
  [0.92, -0.95],
  [0.98, -0.52]
]

const HEATER_SECTION = splineSection(HEATER_POINTS)

/**
 * Section scale along the sweep. `1.08` at the rim rather than `1.00`: the
 * closed B-spline sits inside its control polygon, so the authored extreme is an
 * upper bound and the rim would otherwise come out 7 % narrow.
 *
 * ── Why the face is nearly flat ─────────────────────────────────────────────
 *
 * The first pass domed the front 22 mm from rim to pole. Rendered, the twelve
 * triangles meeting at that pole fanned their normals through a full turn and
 * the toon ramp resolved them as **radial spokes** across the whole face — a
 * twelve-pointed star on a shield, which no amount of albedo hides.
 *
 * Two things fix it, and neither is more triangles. The face is now nearly flat
 * — all 12 mm of its curve happens in the outer third — so the pole's
 * neighbourhood has one normal rather than twelve; and the first ring is pulled
 * in to **28 % of the half-width**, which is the boss's own radius, so whatever
 * fan survives is underneath 76 mm of steel. It is also the shape a heater has:
 * a flat board with a rolled edge, not a dish.
 */
const BOARD_SCALE = [0.0, 0.28, 0.7, 0.98, 1.08, 0.88, 0.0]
const BOARD_Z = [0.06, 0.0598, 0.0585, 0.0555, 0.048, 0.041, 0.036]

/**
 * Ring placement, with a station **on** the rim rather than either side of it.
 *
 * Evenly spread, the widest point of the profile (u ≈ 0.63) fell inside a band
 * rather than on a ring, and along the board's flatter top edge the band's two
 * ends came out facing opposite ways — five faces winding against their own
 * normals, all of them there. Same failure as the hat's brim roll, same fix:
 * rings where the curve turns.
 */
const BOARD_US = [0, 0.16, 0.36, 0.52, 0.61, 0.78, 1.0]

/**
 * Where the sweep crosses the rim: the profile's true radial maximum, found by
 * evaluating the scale spline rather than by assuming it sits where its control
 * point does. It does not — control 4 of 7 peaks at u = 0.61, not at 5/8.
 */
const RIM_U = 0.61

const buildBoard = () => {
  const part = sweep({
    name: 'gear/shield/board',
    path: BOARD_Z.map(z => [0, BOARD_Y, z] as const),
    extentA: BOARD_SCALE.map(s => s * BOARD_HALF_HEIGHT),
    extentB: BOARD_SCALE.map(s => s * BOARD_HALF_WIDTH),
    axisA: AXIS_Y,
    axisB: AXIS_X,
    section: HEATER_SECTION,
    stations: BOARD_US.length,
    us: BOARD_US,
    segments: 12
  })

  return paintPart(
    part,
    (u, v, out) => {
      // Planks. Their boundaries are lines of constant *x*, so the band has to
      // be a function of the vertex's real x — `v` alone would bend the planks
      // around the outline and they would read as a spider's web.
      HEATER_SECTION(v, _sec)
      // The vertex's **real** x, which means scaling by this ring's own extent
      // and not by the board's half-width.
      //
      // That distinction was a bug with a very specific signature. At the front
      // pole all twelve vertices are coincident but each still carries its own
      // `v`, so evaluating the stripe at unit section radius gave twelve
      // *different* colours to one point — and the planks rendered as twelve
      // wedges radiating from the centre of the shield instead of as stripes.
      // It read as a shading artefact of the pole fan, which is what sent the
      // first two attempts at fixing it after the geometry.
      const across = _sec.y * BOARD_HALF_WIDTH * splineAt(BOARD_SCALE, u)
      // Four planks across 270 mm. The frequency is tuned against the *segment
      // count*, not against the board: at 12 samples anything above ~3 cycles
      // aliases into noise, and below 1.5 it reads as a single shadow.
      const plank = 0.5 + 0.5 * Math.cos(across * 62)
      out.copy(C.woodShadow).lerp(C.woodBase, 0.7 + 0.3 * plank)
      out.lerp(C.woodLit, 0.4 * plank * plank)
      // The back is a plain board; only the face is planked and sunlit.
      const front = u < RIM_U ? 1 : 0
      out.lerp(C.woodShadow, 0.4 * (1 - front))
      // The rim: a steel band over the rolled edge, at the sweep's widest
      // station. Costs nothing — the roll is already geometry (GDD R1).
      const rim = Math.max(0, 1 - Math.abs(u - RIM_U) * 5)
      out.lerp(C.steelBase, 0.9 * rim).lerp(C.steelLit, 0.35 * rim * front)
    },
    _color
  )
}

/**
 * The boss: a steel dome 76 mm across and 38 mm proud, centred on the **grip**
 * rather than on the board. That is what a boss is — the cover over the hollow
 * the fist sits in — and putting it on the board's centre instead leaves the
 * hand behind flat plate with the dome 45 mm away doing nothing.
 */
const buildBoss = () => {
  const part = sweep({
    name: 'gear/shield/boss',
    path: [
      [0, 0, 0.094],
      [0, 0, 0.086],
      [0, 0, 0.07],
      [0, 0, 0.052]
    ],
    extentA: [0.0, 0.02, 0.032, 0.038],
    extentB: [0.0, 0.02, 0.032, 0.038],
    axisA: AXIS_Y,
    axisB: AXIS_X,
    // Eight, not six. At six the dome's own silhouette is a visible hexagon at
    // arm's length, and a boss is a circle or it is a bolt head.
    section: circleSection,
    stations: 4,
    segments: 8
  })

  return paintPart(
    part,
    (u, v, out) => {
      const up = Math.cos(v * Math.PI * 2)
      out.copy(C.steelBase).lerp(C.steelLit, 0.5 * (1 - u) + 0.3 * Math.max(0, up))
      out.lerp(C.steelShadow, 0.35 * u)
    },
    _color
  )
}

/**
 * The forearm strap, arcing off the back 55 mm **above** the grip — toward the
 * elbow, which is up the arm from the fist (see the frame note in the header).
 *
 * Both ends terminate at z = 42 mm, which is *inside* the board's back surface
 * (33–48 mm across the span) — so the open ring at each end is buried and there
 * is no visible hole where the strap meets the board. This is the same trick the
 * armour's collar uses, and it is the cheapest way to join two swept solids
 * without modelling the join.
 */
const buildStrap = () => {
  const part = sweep({
    name: 'gear/shield/strap',
    path: [
      [-0.095, 0.055, 0.042],
      [-0.07, 0.055, 0.028],
      [-0.035, 0.055, 0.008],
      [0.0, 0.055, 0.002],
      [0.035, 0.055, 0.008],
      [0.07, 0.055, 0.028],
      [0.095, 0.055, 0.042]
    ],
    extentA: [0.0, 0.011, 0.013, 0.013, 0.013, 0.011, 0.0],
    extentB: [0.0, 0.004, 0.005, 0.005, 0.005, 0.004, 0.0],
    axisA: AXIS_Y,
    axisB: AXIS_Z,
    section: circleSection,
    stations: 5,
    segments: 5
  })

  return paintPart(
    part,
    (_u, v, out) => {
      const up = Math.cos(v * Math.PI * 2)
      out.copy(C.leatherBase).lerp(C.leatherLit, 0.3 + 0.35 * Math.max(0, up))
      out.lerp(C.leatherShadow, 0.4 * Math.max(0, -up))
    },
    _color
  )
}

/**
 * The grip bar. Its axis passes exactly through the origin, so `grip` is not an
 * approximation of where the hand goes — it is a point on the bar.
 */
const buildGrip = () => {
  const part = sweep({
    name: 'gear/shield/grip',
    path: [
      [-0.064, 0.006, 0.044],
      [-0.05, 0.002, 0.03],
      [0.0, 0.0, 0.0],
      [0.05, 0.002, 0.03],
      [0.064, 0.006, 0.044]
    ],
    extentA: [0.0, 0.013, 0.016, 0.013, 0.0],
    extentB: [0.0, 0.013, 0.016, 0.013, 0.0],
    axisA: AXIS_Y,
    axisB: AXIS_Z,
    section: circleSection,
    stations: 5,
    segments: 6
  })

  return paintPart(
    part,
    (u, _v, out) => {
      const wrap = 0.5 + 0.5 * Math.cos(u * Math.PI * 2 * 7)
      out.copy(C.leatherShadow).lerp(C.leatherBase, 0.4 + 0.5 * wrap)
    },
    _color
  )
}

export const buildShield = (options: { seed?: number } = {}): GearModel =>
  finishGear({
    name: 'gear/shield',
    budget: EQUIPMENT_BUDGET.shield,
    parts: [buildBoard(), buildBoss(), buildStrap(), buildGrip()],
    deep: [C.woodShadow, C.steelShadow, C.leatherShadow, C.leatherShadow],
    // Strong on the back: the strap and the grip sit in a cavity behind a dome,
    // and that cavity is the one place on this prop where AO is doing real
    // modelling rather than decorating. Weak on the board itself, which is
    // convex and finds nothing but its own sampling noise — and that noise was
    // loud enough to swallow the planks.
    aoAmount: [0.3, 0.5, 0.95, 0.95],
    seed: options.seed ?? 1,
    jitter: 0.035
  })
