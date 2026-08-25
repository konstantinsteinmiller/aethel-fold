import { Color, Vector3 } from 'three'
import { C } from '../../art/palette'
import { EQUIPMENT_BUDGET } from '../equipment'
import { circleSection, finishGear, type GearModel, paintPart, splineSection, sweep } from './gearKit'

/**
 * ─── The crossbow ───────────────────────────────────────────────────────────
 *
 * Frame (see `index.ts`, and `ITEM_FORWARD_AXIS` in `equipment.ts`): the grip is
 * at the origin under the tiller, the stock runs **−Y** and the bolt flies that
 * way, the prod spans **±Z**, and the bolt rail is cut into the **−X** face.
 * Flats face ±X, so — as with every other item here — the readable view is from
 * −X, and for this one that view is the *plan*: stock down the middle, prod
 * across it, string drawn back in a V.
 *
 * The rail faces −X rather than +X for exactly that reason. The first pass put
 * it on +X and the one feature that says "crossbow" rather than "paddle with a
 * bow on it" was on the face nobody looks at. Nothing else constrained the
 * choice: the prod is on ±Z, so the rail can only be on ±X, and the item is
 * symmetric in Z — swapping it is a 180° turn about Y, not a mirror.
 *
 * Point-down like the swords, and for a shared reason rather than a stylistic
 * one: `SOCKETS.backOver` carries **both** this and the greatsword, so the two
 * have to agree about which way their length runs or one of them hangs upside
 * down from a socket nobody may retune. The prod stays on ±Z for the same
 * reason `sword.ts` keeps its guard there — `backOver` cants by 0.55 rad about
 * Z, which leaves ±Z in the cant's own plane and swings ±X out of it.
 *
 * That last point is why this item is authored plan-first. A crossbow read only
 * from the side is a stick; its identity is the T, and a flat plate with a bar
 * across it would satisfy the T and still be wrong. So the stock carries a real
 * section — 60 × 42 mm at the waist, with a **rail groove 7 mm deep** cut into
 * its top by two control points of the section spline — and the prod is a
 * separate swept solid that arcs 33 mm back in Y across its span.
 *
 * ── The string is drawn, not slack ──────────────────────────────────────────
 *
 * The string runs from each prod tip back to a nut at y = 48 mm, which is a
 * 130 mm draw. A slack string (tip to tip, straight across the nose) is cheaper
 * by two stations and reads as a crossbow that has already been fired — and
 * since `DRAWN_SOCKET.crossbow` is the *drawn* pose, the spanned string is the
 * state the item spends its screen time in.
 *
 * The string's path climbs from x = 0 at the tips to x = 30 mm at the nut,
 * because the nut sits on top of the rail and the prod tips do not. Getting that
 * wrong buries the middle of the string inside the stock.
 *
 * ── No bolt ─────────────────────────────────────────────────────────────────
 *
 * A nocked bolt was costed at ~28 triangles and cut. Not for budget — there were
 * 44 spare — but because it is *state*: the animation layer owns whether the
 * weapon is loaded, and a bolt welded into the mesh is a bolt that survives its
 * own firing.
 */

const AXIS_X = new Vector3(1, 0, 0)
const AXIS_Y = new Vector3(0, 1, 0)
const AXIS_Z = new Vector3(0, 0, 1)

const _color = new Color()

/**
 * The stock's section, in (X, Z). `v = 0` is the groove floor and `v = ⅛`, `⅞`
 * the rails either side of it, which is why the sweep samples 8 segments with no
 * offset: at 6 or 10 the grid steps over the groove and the section's most
 * expensive feature delivers nothing (`plateau.ts`, measured at 37 %).
 */
const STOCK_SECTION = splineSection([
  [-0.2, 0.0],
  [-1.1, 0.68],
  [-0.1, 1.05],
  [0.9, 0.7],
  [1.0, 0.0],
  [0.9, -0.7],
  [-0.1, -1.05],
  [-1.1, -0.68]
])

/**
 * The tiller, butt first.
 *
 * Two things the first pass got wrong and this fixes. The butt collapsed to a
 * point over 20 mm and the whole stock read as a **canoe** — a symmetric pointed
 * leaf with a bow tied across it. It is now blunt: the taper to zero happens in
 * the last 6 mm, so the mesh puts a near-full ring right at the end.
 *
 * And the profile is no longer monotone. A crossbow's identity in plan is the
 * **step** between a wide fore-end where the prod is lashed on and a narrow
 * tiller behind it; a smooth taper from butt to nose has no such event and reads
 * as a paddle. The 18 → 22 mm swell at y = −0.19 costs nothing but two control
 * points on a spline that already existed.
 */
const STOCK_Y = [0.126, 0.12, 0.1, 0.04, -0.02, -0.09, -0.15, -0.19, -0.225, -0.248, -0.254]
const STOCK_HEIGHT = [0.0, 0.019, 0.028, 0.031, 0.026, 0.021, 0.019, 0.026, 0.022, 0.012, 0.0]
// In *plan* — the bearing this item is read at — the tiller narrows to 26 mm and
// the fore-end blooms to 48 mm. The first pass held 38–42 mm the whole way and
// the step existed only in the numbers.
const STOCK_WIDTH = [0.0, 0.011, 0.017, 0.019, 0.016, 0.013, 0.013, 0.024, 0.021, 0.011, 0.0]

const buildStock = () => {
  const part = sweep({
    name: 'gear/crossbow/stock',
    path: STOCK_Y.map(y => [0, y, 0] as const),
    extentA: STOCK_HEIGHT,
    extentB: STOCK_WIDTH,
    axisA: AXIS_X,
    axisB: AXIS_Z,
    section: STOCK_SECTION,
    stations: 10,
    segments: 8
  })

  return paintPart(
    part,
    (u, v, out) => {
      const centred = v > 0.5 ? v - 1 : v
      const groove = Math.max(0, 1 - Math.abs(centred) * 13)
      // Negated with the section: `v = 0` is the groove, and the groove is now
      // on −X, so the section's a component runs the other way.
      const up = -Math.cos(v * Math.PI * 2)
      out.copy(C.woodBase).lerp(C.woodLit, 0.25 + 0.35 * Math.max(0, up))
      out.lerp(C.woodShadow, 0.45 * Math.max(0, -up))
      // The bolt channel: a dark line down the rail, which is what the eye reads
      // as a groove from any angle the 7 mm of geometry is edge-on at.
      out.lerp(C.woodShadow, 0.85 * groove)
      // Brass binding where the prod is lashed on, and at the butt plate. Both
      // are colour on geometry that already exists (GDD R1).
      const nose = Math.max(0, 1 - Math.abs(u - 0.78) * 11)
      const butt = Math.max(0, 1 - u * 11)
      out.lerp(C.brassBase, 0.85 * Math.max(nose, butt))
      out.lerp(C.brassLit, 0.3 * Math.max(0, up) * Math.max(nose, butt))
    },
    _color
  )
}

/** Prod half-span 165 mm, arcing 33 mm back in Y — a bow, not a crossbar. */
const buildProd = () => {
  const part = sweep({
    name: 'gear/crossbow/prod',
    path: [
      [0, -0.175, -0.165],
      [0, -0.177, -0.16],
      [0, -0.186, -0.14],
      [0, -0.202, -0.075],
      [0, -0.208, 0.0],
      [0, -0.202, 0.075],
      [0, -0.186, 0.14],
      [0, -0.177, 0.16],
      [0, -0.175, 0.165]
    ],
    // Wide across the flat (X), thin in the bending plane (Y) — the same
    // proportion the bow's limbs have, for the same reason. Half again as thick
    // as the first pass: at 22 mm it rendered as a wire hanging off a paddle,
    // and a prod is the part of a crossbow that has to look like it stores
    // energy. The control point 5 mm inside each tip blunts the ends the same
    // way the sword's guard is blunted.
    extentA: [0.0, 0.008, 0.012, 0.015, 0.017, 0.015, 0.012, 0.008, 0.0],
    extentB: [0.0, 0.004, 0.0055, 0.0065, 0.0075, 0.0065, 0.0055, 0.004, 0.0],
    axisA: AXIS_X,
    axisB: AXIS_Y,
    section: circleSection,
    stations: 9,
    segments: 6
  })

  return paintPart(
    part,
    (_u, v, out) => {
      const up = Math.sin(v * Math.PI * 2)
      out.copy(C.steelBase).lerp(C.steelLit, 0.35 + 0.4 * Math.max(0, up))
      out.lerp(C.steelShadow, 0.4 * Math.max(0, -up))
    },
    _color
  )
}

const buildString = () => {
  const part = sweep({
    name: 'gear/crossbow/string',
    path: [
      [0.0, -0.175, 0.165],
      [-0.004, -0.17, 0.15],
      [-0.018, -0.115, 0.08],
      [-0.03, -0.048, 0.0],
      [-0.018, -0.115, -0.08],
      [-0.004, -0.17, -0.15],
      [0.0, -0.175, -0.165]
    ],
    extentA: [0.0, 0.0018, 0.0021, 0.0023, 0.0021, 0.0018, 0.0],
    extentB: [0.0, 0.0018, 0.0021, 0.0023, 0.0021, 0.0018, 0.0],
    axisA: AXIS_X,
    axisB: AXIS_Y,
    section: circleSection,
    stations: 7,
    segments: 4
  })

  return paintPart(part, (_u, _v, out) => void out.copy(C.strawBase).lerp(C.strawLit, 0.45), _color)
}

/**
 * The trigger tab, on the underside of the tiller just forward of the fist —
 * the +X face now that the rail has moved to −X.
 *
 * Short and stubby, not the swept fin the first pass produced: at 53 mm of reach
 * it stood out from the stock like a dorsal and, painted brass, it was the
 * brightest thing on a wooden weapon. It is now 28 mm of dark leather, which is
 * what a trigger bar is.
 *
 * Swept along Y with the section on (Z, X) rather than the usual (X, Z): the
 * path's dominant motion here is Y with a lean in X, and a section carrying an
 * X axis would put `∂P/∂v` and `∂P/∂u` in the same plane at the lean.
 */
const buildTrigger = () => {
  const part = sweep({
    name: 'gear/crossbow/trigger',
    path: [
      [0.022, -0.03, 0],
      [0.028, -0.016, 0],
      [0.036, 0.002, 0],
      [0.042, 0.016, 0]
    ],
    extentA: [0.008, 0.009, 0.007, 0.0],
    extentB: [0.006, 0.007, 0.005, 0.0],
    axisA: AXIS_Z,
    axisB: AXIS_X,
    section: circleSection,
    stations: 4,
    segments: 4
  })

  return paintPart(part, (_u, _v, out) => void out.copy(C.leatherShadow).lerp(C.leatherBase, 0.55), _color)
}

export const buildCrossbow = (options: { seed?: number } = {}): GearModel =>
  finishGear({
    name: 'gear/crossbow',
    budget: EQUIPMENT_BUDGET.crossbow,
    parts: [buildStock(), buildProd(), buildString(), buildTrigger()],
    deep: [C.woodShadow, C.steelShadow, C.strawShadow, C.leatherShadow],
    aoAmount: [0.75, 0.4, 0, 0.6],
    seed: options.seed ?? 1,
    jitter: 0.03
  })
