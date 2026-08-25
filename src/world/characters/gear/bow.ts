import { Color, Vector3 } from 'three'
import { C } from '../../art/palette'
import { EQUIPMENT_BUDGET } from '../equipment'
import { circleSection, finishGear, type GearModel, paintPart, splineAt, sweep } from './gearKit'

/**
 * ─── The recurve bow ────────────────────────────────────────────────────────
 *
 * Frame (see `index.ts`): the riser's grip is at the origin, the upper limb runs
 * **+Y** and the lower **−Y**, the bow's back (the face toward the target) is
 * **+Z**, and the string hangs at **−Z**. Flats face ±X, so the readable view —
 * the one where the recurve is a shape rather than a line — is from −X.
 *
 * ── One sweep for both limbs *and* the riser ────────────────────────────────
 *
 * The whole stave is a single swept profile from the lower tip to the upper one.
 * That is not an economy, it is the shape: a bow is one piece of wood whose
 * thickness swells at the hand and thins to the nocks, and building it as
 * limb + riser + limb would put two hard joins exactly where the eye tracks the
 * curve. One surface, one normal rule, nothing to bevel (`limb.ts`'s argument
 * for building caps into the profile, applied to the middle instead of the end).
 *
 * ── Recurve, and why it is not an arc ───────────────────────────────────────
 *
 * The brief for this item was "so the limbs have real curvature in silhouette
 * rather than being an arc", and those are different shapes. An arc is monotone
 * in `z`: it leaves the riser going one way and never comes back. A recurve is
 * an **S** — the limb sweeps *away* from the target to z = −38 mm at 74 % of its
 * length, then the tip curls *back* toward it to −18 mm. Reading down the +Y
 * limb the control points go
 *
 *     riser +48 → +38 → −10 → −38 → −28 → −18 mm
 *
 * with the sign of `dz/dy` changing once. That single change of sign is the
 * entire visual difference between "a bow" and "this is a recurve", and it is
 * why the stave gets 13 stations for 11 control points: the mesh chords between
 * stations, so the curvature only exists where a station resolves it.
 *
 * ── The string is a prism, and that is a rule not a preference ──────────────
 *
 * GDD R1 forbids approximating a silhouette with a flat plane, and a bowstring
 * is where that temptation is strongest — a 4 mm string is two triangles as a
 * billboard and 24 as a solid. It is a square prism here. The reason is not
 * purity: a camera orbiting a character passes through the plane of a billboard
 * twice per revolution and the string *disappears* at both, which reads as the
 * bow breaking rather than as a rendering choice.
 */

const AXIS_X = new Vector3(1, 0, 0)
const AXIS_Z = new Vector3(0, 0, 1)

const _color = new Color()

/** Half the tip-to-tip span. 670 mm of bow against a 1.56 m figure. */
const HALF_SPAN = 0.335

/**
 * `[y, z]` down the stave, lower tip first. Symmetric by construction: the
 * upper half is the lower half mirrored, so a typo cannot make one limb stiffer
 * than the other — which is the one asymmetry a bow cannot survive.
 */
const STAVE: readonly (readonly [number, number])[] = [
  [-HALF_SPAN, -0.018],
  [-0.31, -0.028],
  [-0.25, -0.038],
  [-0.15, -0.01],
  [-0.055, 0.038],
  [0.0, 0.048],
  [0.055, 0.038],
  [0.15, -0.01],
  [0.25, -0.038],
  [0.31, -0.028],
  [HALF_SPAN, -0.018]
]

/**
 * Half-width across the flat (X). The riser is 38 mm across against the limbs'
 * 23 and the nocks' 17 — "riser thicker than the limbs", measured on the axis
 * where a bow is actually thicker.
 */
const STAVE_WIDTH = [0.0, 0.0085, 0.0115, 0.0135, 0.0175, 0.019, 0.0175, 0.0135, 0.0115, 0.0085, 0.0]

/** Half-depth in the bending plane (Z). Thin, which is what lets a limb bend. */
const STAVE_DEPTH = [0.0, 0.004, 0.005, 0.006, 0.011, 0.0135, 0.011, 0.006, 0.005, 0.004, 0.0]

/** Where the grip leather starts and ends, as a fraction of the stave. */
const WRAP_HALF = 0.075

const buildStave = () => {
  const part = sweep({
    name: 'gear/bow/stave',
    path: STAVE.map(([y, z]) => [0, y, z] as const),
    extentA: STAVE_WIDTH,
    extentB: STAVE_DEPTH,
    axisA: AXIS_X,
    axisB: AXIS_Z,
    section: circleSection,
    stations: 13,
    segments: 8
  })

  return paintPart(
    part,
    (u, v, out) => {
      // Distance from the riser's centre along the stave, in metres — read off
      // the path spline rather than from `u`, so adding a control point to
      // sharpen the recurve cannot slide the grip wrap up one limb.
      const y = splineAt(
        STAVE.map(point => point[0]),
        u
      )
      const grip = Math.abs(y) < WRAP_HALF ? 1 : 0
      // The back of the limb (+Z) catches the sun; the belly is in its own
      // shade. `axisB` is +Z, so the section's b component is that facing.
      const back = Math.sin(v * Math.PI * 2)
      // Lifted off the first pass's numbers. A 23 mm limb is a thin object seen
      // against sky, so it takes the ramp's *lowest* band over most of its
      // surface; painting the belly 35 % toward `woodShadow` on top of that put
      // the whole stave in the dark and it read as charcoal, not seasoned wood.
      out.copy(C.woodBase).lerp(C.woodLit, 0.4 + 0.4 * back)
      out.lerp(C.woodShadow, 0.2 * Math.max(0, -back))
      if (grip > 0) {
        const wrap = 0.5 + 0.5 * Math.cos(y * 120)
        out.copy(C.leatherShadow).lerp(C.leatherBase, 0.4 + 0.6 * wrap)
        out.lerp(C.leatherLit, 0.3 * Math.max(0, back))
      }
    },
    _color
  )
}

/**
 * The string: tip to tip, straight, passing just clear of the recurved limb.
 *
 * `-0.018` is the tips' own `z`, so the chord grazes the outside of the recurve
 * exactly the way a braced string does — which is the detail that makes the
 * recurve read as *braced* rather than as a bow with a wire floating in front
 * of it.
 */
const buildString = () => {
  const part = sweep({
    name: 'gear/bow/string',
    path: [
      [0, -0.331, -0.018],
      [0, -0.32, -0.018],
      [0, 0.0, -0.019],
      [0, 0.32, -0.018],
      [0, 0.331, -0.018]
    ],
    extentA: [0.0, 0.0021, 0.0023, 0.0021, 0.0],
    extentB: [0.0, 0.0021, 0.0023, 0.0021, 0.0],
    axisA: AXIS_X,
    axisB: AXIS_Z,
    section: circleSection,
    stations: 5,
    segments: 4
  })

  return paintPart(
    part,
    (_u, _v, out) => {
      // Pale linen. `straw*` rather than a new palette entry: a bowstring and a
      // straw hat are the same dried fibre at two thicknesses, and the palette
      // does not need a second name for it.
      out.copy(C.strawBase).lerp(C.strawLit, 0.5)
    },
    _color
  )
}

export const buildBow = (options: { seed?: number } = {}): GearModel =>
  finishGear({
    name: 'gear/bow',
    budget: EQUIPMENT_BUDGET.bow,
    parts: [buildStave(), buildString()],
    deep: [C.woodShadow, C.strawShadow],
    // None on the string. It is a 4 mm prism with nothing near it but air, so
    // every AO ray escapes and the pass costs time to change nothing. And light
    // on the stave for the same reason the paint above was lifted: a bow is
    // almost all convex surface with nothing to occlude it, so what AO finds
    // here is not contact shade, it is the sampler's own noise floor.
    aoAmount: [0.4, 0],
    seed: options.seed ?? 1,
    jitter: 0.035
  })
