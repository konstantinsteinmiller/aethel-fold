import { Color, Vector3 } from 'three'
import { C } from '../../art/palette'
import { EQUIPMENT_BUDGET } from '../equipment'
import {
  circleSection,
  finishGear,
  type GearModel,
  paintPart,
  splineAt,
  splineSection,
  sweep,
  type SweptPart
} from './gearKit'

/**
 * ─── The sword, and the cruciform language the greatsword shares ────────────
 *
 * Frame (see `index.ts`, and `ITEM_FORWARD_AXIS` in `equipment.ts`): grip at the
 * origin, blade **down −Y** with the pommel above the fist, edges and guard
 * along **±Z**, flats facing **±X**. The readable view is from −X.
 *
 * ── Point-down, and why the guard stayed on ±Z ──────────────────────────────
 *
 * The blade was authored tip-up in the first pass and measured wrong: hung at
 * `SOCKETS.hipR` it spanned 0.528–1.031 m above the feet, standing up the
 * ribcage rather than down the thigh. `ITEM_FORWARD_AXIS` now pins the length
 * to −Y and this file follows it.
 *
 * The guard did **not** move to ±X with it, and that is a deliberate reading of
 * the contract's second clause rather than an omission. `hipR` cants by −0.35
 * rad **about Z**, so anything lying on ±Z stays in the plane the socket tilts
 * in while anything on ±X swings out of it: a 200 mm guard on X reaches from
 * x = −0.23 to −0.03 at a hip whose hand swings through x = −0.32, i.e. into the
 * arm. On Z it lies fore-and-aft inside the torso's own 391 mm depth. A
 * double-edged blade has no unique "front", so +Z is taken to be its leading
 * edge — which is also the natural hip carry.
 *
 * ── Chibi proportions, which are not "a sword, smaller" ─────────────────────
 *
 * A 1.56 m figure with a 0.52 m head needs a 0.44 m blade, not the 0.72 m one
 * that scaling a real arming sword would give. The number that matters is
 * width-to-length: this blade is 71 mm across a 440 mm blade — a ratio of 1:6.2
 * where a real sword runs 1:16. Scaled honestly it reads as a needle next to a
 * head that wide, and the fix is not a longer blade (which pushes the tip past
 * the crown at rest) but a broader one.
 *
 * ── Three parts, and why the grip and pommel are one ────────────────────────
 *
 * Blade, guard, grip+pommel. The last two are a single sweep whose profile
 * bulges at the pommel and necks into the grip, for exactly the reason
 * `limb.ts` gives for building its end caps into the radius profile: one
 * surface, one normal rule, **no seam to bevel** — the cheapest possible way to
 * satisfy GDD R2, because there is no cut.
 *
 * ── The fuller is painted, not modelled ─────────────────────────────────────
 *
 * A real fuller is a groove down the flat. At 8 section samples a groove needs
 * three of them per face — a shoulder, the floor, the far shoulder — which
 * leaves one sample for the entire rest of the flat, and `plateau.ts` measured
 * what happens when a section's features fall between samples: 37 % of the
 * authored depth reaches a triangle. So the section carries a **bevel ridge**
 * (which the sample grid does land on) and the fuller is vertex colour: the
 * flats resolve toward `steelBase` while the ridge line and both edges take
 * `steelLit`. That is GDD R1 stated exactly — interior detail from colour, never
 * from geometry — and it costs nothing.
 */

/** 8 samples, so a vertex lands on both edges (v = 0, ½) and both ridges (¼, ¾). */
const BLADE_SEGMENTS = 8

/**
 * The blade's unit section: a lens with a bevel ridge and thin edges.
 *
 * Authored as control points of a closed cubic B-spline, so the curve sits
 * inside this polygon — the `(1, 0)` ridge lands at 0.96 and the `(0, 1)` edge
 * at 0.887. The distance the curve loses at each corner **is** the bevel.
 *
 * The interior points are what make it a lens rather than an ellipse: at 68 % of
 * the half-width the section is still 78 % of full thickness, so the blade is
 * flat across its middle and thins only in the last quarter — which is what
 * reads as a ground edge in silhouette from the flat side.
 */
const BLADE_SECTION = splineSection([
  [0.0, 1.0],
  [0.88, 0.66],
  [1.0, 0.0],
  [0.88, -0.66],
  [0.0, -1.0],
  [-0.88, -0.66],
  [-1.0, 0.0],
  [-0.88, 0.66]
])

const AXIS_X = new Vector3(1, 0, 0)
const AXIS_Y = new Vector3(0, 1, 0)
const AXIS_Z = new Vector3(0, 0, 1)

const _color = new Color()
const _steelFlat = C.steelBase.clone()

export interface CruciformSpec {
  name: string
  budget: number
  /** Blade path heights, low to high. First is inside the guard, last is the tip. */
  bladeY: readonly number[]
  /** Blade half-thickness (X) and half-width (Z) at each `bladeY`. */
  bladeThickness: readonly number[]
  bladeWidth: readonly number[]
  bladeStations: number
  /** Guard control points as `[z, y]`; mirrored authoring is the caller's job. */
  guard: readonly (readonly [number, number])[]
  guardThickness: readonly number[]
  guardHeight: readonly number[]
  guardStations: number
  /** Grip + pommel: a single profile from the pommel's bottom pole upward. */
  gripY: readonly number[]
  gripThickness: readonly number[]
  gripWidth: readonly number[]
  gripStations: number
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t)

const smootherstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-6))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

const buildBlade = (spec: CruciformSpec): SweptPart => {
  const part = sweep({
    name: `${spec.name}/blade`,
    path: spec.bladeY.map(y => [0, y, 0] as const),
    extentA: spec.bladeThickness,
    extentB: spec.bladeWidth,
    axisA: AXIS_X,
    axisB: AXIS_Z,
    section: BLADE_SECTION,
    stations: spec.bladeStations,
    segments: BLADE_SEGMENTS
  })

  return paintPart(
    part,
    (u, v, out) => {
      // 1 on both edges and both ridges, 0 on the four flats between them —
      // one closed form for the painted fuller. See the header.
      const line = Math.abs(Math.cos(4 * Math.PI * v))
      out.copy(_steelFlat).lerp(C.steelLit, 0.2 + 0.55 * line)
      // The last few centimetres above the guard sit in the guard's own shade.
      // Modelled by AO too, but AO only reaches what a ray can see, and the
      // ricasso's inner face is a narrow slot.
      out.lerp(C.steelShadow, 0.4 * (1 - smootherstep(0.05, 0.3, u)))
    },
    _color
  )
}

const buildGuard = (spec: CruciformSpec): SweptPart => {
  const part = sweep({
    name: `${spec.name}/guard`,
    path: spec.guard.map(([z, y]) => [0, y, z] as const),
    extentA: spec.guardThickness,
    extentB: spec.guardHeight,
    axisA: AXIS_X,
    axisB: AXIS_Y,
    section: circleSection,
    stations: spec.guardStations,
    segments: 6
  })

  return paintPart(
    part,
    (_u, v, out) => {
      // `axisB` is +Y here, so the section's b component *is* upness — no need
      // to read the normal back off the attribute to find the lit face.
      //
      // Held down from the first pass's `0.45 + 0.4·up`: brass is the only warm
      // accent on a cool kit (see the palette's note on `brassLit`), and at that
      // range the guard was the brightest field on the model and pulled the read
      // off the blade it exists to frame.
      const up = Math.sin(v * Math.PI * 2)
      out.copy(C.brassBase).lerp(C.brassLit, 0.3 + 0.35 * Math.max(0, up))
      out.lerp(C.leatherShadow, 0.3 * Math.max(0, -up))
    },
    _color
  )
}

const buildGrip = (spec: CruciformSpec): SweptPart => {
  const part = sweep({
    name: `${spec.name}/grip`,
    path: spec.gripY.map(y => [0, y, 0] as const),
    extentA: spec.gripThickness,
    extentB: spec.gripWidth,
    axisA: AXIS_X,
    axisB: AXIS_Z,
    section: circleSection,
    stations: spec.gripStations,
    segments: 6
  })

  // The brass/leather boundary is read off the profile's **sampled** maximum,
  // not off an authored radius. Measured on the first pass, where it was
  // authored: the pommel's control point was 29 mm and the widest ring the mesh
  // actually placed was 25.7 mm, so the threshold was never crossed and the
  // pommel rendered as leather — a shape that was there and a material that was
  // not. The spline approximates; a threshold has to be told what it produced.
  let widest = 0
  for (let i = 0; i < spec.gripStations; i++) {
    widest = Math.max(widest, splineAt(spec.gripWidth, i / (spec.gripStations - 1)))
  }

  return paintPart(
    part,
    (u, v, out) => {
      const width = splineAt(spec.gripWidth, u)
      const brass = clamp01((width - widest * 0.66) / (widest * 0.34))
      // No cord wrap. It was authored as a 6-cycle cosine in `u` and the grip
      // has eight rings — below Nyquist, so it rendered as a smooth gradient
      // rather than as binding. What survives at this scale is *form*: the
      // leather darkens toward the guard, where a hand and a crossguard both
      // shade it.
      const shade = 0.35 + 0.5 * clamp01(u * 1.6)
      const round = 0.5 + 0.5 * Math.sin(v * Math.PI * 2)
      out.copy(C.leatherShadow).lerp(C.leatherBase, shade)
      out.lerp(C.leatherLit, 0.3 * round * (1 - brass))
      // The pommel is the *same* brass as the guard, at the same brightness —
      // authored as one lerp so the two cannot drift. When they did, the pommel
      // sat a band darker and read as a wooden knob at the end of a leather
      // grip rather than as the guard's twin at the other end of the sword.
      out.lerp(C.brassBase, brass).lerp(C.brassLit, brass * (0.3 + 0.35 * round))
    },
    _color
  )
}

/** Shared by `sword` and `greatsword` — the family's one shape language. */
export const buildCruciform = (spec: CruciformSpec, seed = 1): GearModel =>
  finishGear({
    name: spec.name,
    budget: spec.budget,
    parts: [buildBlade(spec), buildGuard(spec), buildGrip(spec)],
    deep: [C.steelShadow, C.leatherShadow, C.leatherShadow],
    // Weak on the blade on purpose: a blade is a large near-flat field and AO
    // strong enough to model the guard's notch turns the whole flat mottled.
    aoAmount: [0.35, 0.8, 0.7],
    seed,
    // Half the usual, for a reason specific to steel: the blade takes the toon
    // ramp's top band along its whole length at once, so albedo noise that is
    // invisible on leather shows up there as a dirty streak.
    jitter: 0.02
  })

const SWORD: CruciformSpec = {
  name: 'gear/sword',
  budget: EQUIPMENT_BUDGET.sword,
  //            base    above    full     mid     taper    point    tip
  bladeY: [-0.03, -0.045, -0.075, -0.23, -0.38, -0.435, -0.47],
  bladeThickness: [0.0, 0.0075, 0.0085, 0.008, 0.0062, 0.003, 0.0],
  bladeWidth: [0.0, 0.033, 0.0375, 0.036, 0.029, 0.013, 0.0],
  bladeStations: 7,
  // Quillons sweep 15 mm *toward the blade* over the span, down from 22 in the
  // first pass — measured on screen, 22 read as a drooping moustache rather
  // than as a crossguard. The pair of control points 2 mm inside each tip is
  // what makes the ends blunt: the taper to zero happens over 8 mm, so five
  // stations still land a full-width ring next to the tip.
  guard: [
    [-0.1, -0.044],
    [-0.098, -0.043],
    [-0.088, -0.04],
    [-0.045, -0.032],
    [0.0, -0.029],
    [0.045, -0.032],
    [0.088, -0.04],
    [0.098, -0.043],
    [0.1, -0.044]
  ],
  guardThickness: [0.0, 0.008, 0.013, 0.015, 0.016, 0.015, 0.013, 0.008, 0.0],
  guardHeight: [0.0, 0.011, 0.019, 0.022, 0.024, 0.022, 0.019, 0.011, 0.0],
  guardStations: 5,
  // A **wheel pommel**, not a ball: 60 mm across and 40 mm tall, necking to
  // 28 mm over 20 mm of axis. The first pass authored a ball and a grip whose
  // radii differed by 40 %, and the B-spline averaged the neck between them
  // into one continuous brown taper — pommel and grip read as a single lump.
  // A distinct wheel is the cheapest silhouette a sword's butt can have.
  gripY: [0.135, 0.124, 0.11, 0.096, 0.072, 0.03, -0.01, -0.028],
  gripThickness: [0.0, 0.023, 0.029, 0.025, 0.012, 0.0135, 0.016, 0.0],
  gripWidth: [0.0, 0.023, 0.029, 0.025, 0.014, 0.017, 0.02, 0.0],
  gripStations: 8
}

export const buildSword = (options: { seed?: number } = {}): GearModel => buildCruciform(SWORD, options.seed ?? 1)
