import { type BufferGeometry, Color, Vector3 } from 'three'
import { C } from '../../art/palette'
import { HAT_CLEARANCE, EQUIPMENT_BUDGET } from '../equipment'
import { HEAD } from '../face'
import { limbMesh } from '../limb'
import { circleSection, finishGear, type GearModel, minGap, paintPart, type Surface, surfaceOf, sweep } from './gearKit'

/**
 * ─── The straw hat ──────────────────────────────────────────────────────────
 *
 * Frame (see `index.ts`): the origin is the `headTop` socket — which is the head
 * bone plus 150 mm, i.e. **the head's lower-cap centre at y = 1.29**, not its
 * crown. So this model is authored in a frame whose origin sits *inside* the
 * skull, the crown is at +0.27, and the whole hat lives between +0.09 and +0.30.
 * Reading `headTop` as "the top of the head" and authoring from y = 0 up is the
 * mistake this paragraph exists to prevent; it puts the hat 270 mm above the
 * figure.
 *
 * ── Sized against the head that is *built*, not the one that is meant ───────
 *
 * `equipment.ts` states the trap and this file is the reason it is stated. The
 * head is shaded as a smooth ellipsoid but **built as a 9-gon over 10 rings**,
 * and a 9-gon's facets sit up to `r(1 − cos 20°)` — 15 mm on a 250 mm head —
 * inside the ellipsoid they are inscribed in. Sized to the ideal surface a hat
 * floats; sized to the facets it clips through the crown at four bearings out of
 * nine.
 *
 * Two things follow, and both are in the code below:
 *
 * 1. **The hat is a 9-gon too, rotated onto the head's own bearings**
 *    (`segments: 9`, `vOffset: 0.25`). The head's vertex 0 sits at +Z, and
 *    `circleSection` puts its first sample at +Z when `v` starts at ¼. With the
 *    two polygons aligned, both surfaces lose the same inscription factor at
 *    every bearing, so the gap between them is `(R − r)·f(θ)` rather than
 *    alternating between `R − r` and `R·cos20° − r` — which is the difference
 *    between a uniform clearance and one that goes negative every 40°.
 * 2. **The clearance is measured on the built meshes**, both ways, by
 *    `hatHeadClearance()`. Not derived from the control points: the profile is a
 *    B-spline that sits *inside* them, and the mesh then chords between
 *    stations, so the authored apex height is an upper bound twice over.
 *
 * Measured for the shipped numbers: see the constant below, asserted in
 * `tests/world/gear.test.ts`.
 *
 * ── One closed surface, inside and out ──────────────────────────────────────
 *
 * The sweep runs apex → crown → brim → **around the rim** → brim underside →
 * inner crown → inner apex. Eleven stations for a hat is expensive; the reason
 * it is not eight is that the inner crown has to *exist*. An open-bottomed hat
 * is a single-sided shell, and `FrontSide` means the player looking up from
 * below a brim sees straight through the crown to the sky.
 */

const AXIS_X = new Vector3(1, 0, 0)
const AXIS_Z = new Vector3(0, 0, 1)

const _color = new Color()

/**
 * `[y, radius]` in the hat's own frame, outer apex first, all the way around.
 *
 * Control points, not surface points — the B-spline rounds every one of them,
 * and that rounding is the brim's roll and the crown's shoulder.
 */
const PROFILE: readonly (readonly [number, number])[] = [
  [0.306, 0.0], // outer apex
  [0.3, 0.119], // crown, upper
  [0.262, 0.21], // crown, mid
  [0.201, 0.257], // crown base — the hatband sits here
  [0.142, 0.312], // brim, mid
  [0.118, 0.35], // brim rim, over the top
  [0.1, 0.338], // brim rim, round the underside
  [0.126, 0.292], // brim underside, outer
  [0.163, 0.254], // inner crown base
  [0.216, 0.216], // inner crown, mid
  [0.271, 0.128], // inner crown, upper
  [0.292, 0.0] // inner apex
]

/**
 * Ring placement. Three rings across the rim's roll (0.43 / 0.50 / 0.57), which
 * the even spread does not give: control points 5 and 6 turn the surface through
 * ~180° between u = 0.46 and u = 0.54, and a single band spanning that has its
 * two ends facing opposite ways. Measured before this: `segments` faces winding
 * against their own normals, every one of them in that band.
 */
const STATION_US = [0, 0.12, 0.24, 0.35, 0.43, 0.5, 0.57, 0.66, 0.78, 0.89, 1.0]

/** Where the sweep crosses the rim, in `u`. Everything past it is underside. */
const RIM_U = 0.5

/** Aligns the hat's 9-gon with the head's, whose vertex 0 sits at +Z. */
const HEAD_BEARING_OFFSET = 0.25

/**
 * The head's real triangles, in the hat's frame.
 *
 * Built by the same `limbMesh` call `chibiGeometry` makes, from the same `HEAD`
 * spec `face.ts` pins — so if the head's `radial` or `capRings` ever change, the
 * clearance measurement follows for free instead of quietly measuring a head
 * that is no longer shipped.
 */
let headSurface: Surface | null = null
const headInHatSpace = (): Surface => {
  if (!headSurface) {
    const mesh = limbMesh({
      from: new Vector3(HEAD.centre[0], HEAD.centre[1], HEAD.centre[2]),
      to: new Vector3(HEAD.top[0], HEAD.top[1], HEAD.top[2]),
      radiusStart: HEAD.radius,
      radiusEnd: HEAD.radius,
      radial: HEAD.radial,
      rings: HEAD.rings,
      capRings: HEAD.capRings,
      crossSection: [1, HEAD.widthScale]
    })
    // The socket is at the head's lower-cap centre, so the hat's frame is the
    // head's translated down by `HEAD.centre.y`.
    const position = new Float32Array(mesh.position.length)
    for (let i = 0; i < mesh.position.length; i += 3) {
      position[i] = mesh.position[i]!
      position[i + 1] = mesh.position[i + 1]! - HEAD.centre[1]
      position[i + 2] = mesh.position[i + 2]!
    }
    headSurface = { position, index: mesh.index }
  }
  return headSurface
}

const buildCrown = () => {
  const part = sweep({
    name: 'gear/hat/crown',
    path: PROFILE.map(([y]) => [0, y, 0] as const),
    extentA: PROFILE.map(([, r]) => r),
    extentB: PROFILE.map(([, r]) => r),
    axisA: AXIS_X,
    axisB: AXIS_Z,
    section: circleSection,
    stations: STATION_US.length,
    us: STATION_US,
    segments: HEAD.radial,
    vOffset: HEAD_BEARING_OFFSET
  })

  return paintPart(
    part,
    (u, _v, out) => {
      if (u <= RIM_U) {
        // Outside: the crown is duller than the brim, because the brim is the
        // large flat surface that takes the ramp's top band across its whole
        // area and the crown is not.
        const crown = u / RIM_U
        out.copy(C.strawBase).lerp(C.strawLit, 0.25 + 0.55 * crown)
        // The hatband: a leather cord at the crown's base. Zero triangles
        // (GDD R1), but it is a *soft* band and cannot be otherwise — the crown
        // carries four rings, so a 1/16-wide band in `u` fell between them and
        // painted 4 % of itself. Widened to what the sampling can actually
        // resolve, which reads as a band in shadow rather than as a cord.
        const band = Math.max(0, 1 - Math.abs(u - 0.31) * 6)
        out.lerp(C.leatherBase, 0.9 * band).lerp(C.leatherShadow, 0.45 * band)
      } else {
        // Underneath: a brim's own shadow is the deepest value on the figure's
        // head, and it is what makes a hat read as *worn* rather than as a disc
        // balanced on hair. Falls to `strawShadow`, never toward black (R4).
        const inward = (u - RIM_U) / (1 - RIM_U)
        out.copy(C.strawBase).lerp(C.strawShadow, 0.35 + 0.5 * inward)
      }
    },
    _color
  )
}

/**
 * Smallest distance between the built hat and the built head, measured both
 * ways. Compare against `HAT_CLEARANCE`.
 */
export const hatHeadClearance = (geometry: BufferGeometry): number =>
  minGap(surfaceOf(geometry), headInHatSpace())

export const buildHat = (options: { seed?: number } = {}): GearModel => {
  const model = finishGear({
    name: 'gear/hat',
    budget: EQUIPMENT_BUDGET.hat,
    parts: [buildCrown()],
    deep: [C.strawShadow],
    // Strong: the underside of a brim is a cavity, and AO is the only thing in
    // this renderer that knows it is one.
    aoAmount: [0.9],
    seed: options.seed ?? 1,
    // Straw is fibrous. This is the one item where albedo noise is the material.
    jitter: 0.06
  })

  const clearance = hatHeadClearance(model.geometry)
  if (clearance < HAT_CLEARANCE * 0.9 && import.meta.env.DEV) {
    throw new Error(
      `[gear] hat clears the built head by ${(clearance * 1000).toFixed(1)} mm, ` +
        `below HAT_CLEARANCE (${(HAT_CLEARANCE * 1000).toFixed(0)} mm)`
    )
  }
  return model
}
