import { Color, Vector2, Vector3 } from 'three'
import { boneDefinition } from '../rig'
import { inflateFor } from './garmentKit'
import { paintPart, type Section, splineSection, sweep, type SweptPart } from './gearKit'

/**
 * ─── Leg garments: the recipe every one of them follows ─────────────────────
 *
 * A leg garment **replaces** the body's thigh and shin parts, exactly as a torso
 * garment replaces its torso (`equipment.ts::BODY_SLOTS`). So it costs its wearer
 * zero draw calls and zero programs — and so a gap in it is not a costume error,
 * it is a hole straight through the character with the sky visible through it.
 *
 * `garmentKit.ts` is the worked example and this is its equivalent for a limb.
 * What it owns, and what a garment file may therefore not author, is the closure
 * at **both** ends of a leg: `HIP_ROWS` at the top, where the leg meets whatever
 * is above it, and `ANKLE_ROWS` at the bottom, where it meets the foot. Nine
 * torso garments could not each re-derive the pelvis and the gorget by trial and
 * neither can four leg garments re-derive these; a copy per garment would drift.
 *
 * ── Four facts about the leg that every number below is authored against ─────
 *
 * `rig.ts`: `thigh.L` at (0.09, 0.60, 0), `shin.L` at (0.10, 0.33, 0), `foot.L`
 * at (0.10, 0.06, 0) — and **+X is the character's LEFT**.
 *
 *   1. **A leg is not a solid of revolution about its own bone.** The two thighs
 *      are 180 mm apart and the body's own thigh — radius 0.085 at x = 0.09 —
 *      comes within **5 mm of the midline**. A garment wider than the thigh it
 *      replaces, swept round a circular section, crosses x = 0, and the
 *      substitution blends the two legs' weights across a 12 mm band there: cloth
 *      inside it follows the *average* of two limbs, which through a stride is
 *      neither of them. Hence `LEG_SECTION`, which is 8 % narrower inboard than
 *      outboard and is mirrored per side. Eight per cent is all there is: the
 *      body's own leg has to stay *inside* the garment on that side too, and that
 *      floor and this ceiling are ~35 mm apart.
 *   2. **The shin part *is* the boot shaft.** `chibiGeometry` runs the shin from
 *      `clothShadow` to `hairBase`, and the only thing left below a substituted
 *      leg is the horizontal `foot` part — a ball of radius 0.06 about the ankle
 *      joint plus a toe. So a leg garment has to carry the calf and the ankle
 *      down to y ≈ 0 itself, and paint its own bottom dark, or the figure ends in
 *      a pale stump above a dark shoe.
 *   3. **The shin's own bottom cap is bigger than the foot's.** A hemisphere of
 *      radius 0.072 about the ankle joint against the foot's 0.060. Twelve
 *      millimetres of shell that nothing else in the figure supplies, over the
 *      lower half of the ankle — which is why `ANKLE_ROWS` reaches down to
 *      y = −0.024 and not to the joint.
 *   4. **The thigh's start cap domes to y = 0.685**, well above the hips joint at
 *      0.62 and inside the torso. `HIP_ROWS` closes at 0.692 for the same reason
 *      the cuirass's gorget closes inside the neck: the apex is buried, so the
 *      closure is never seen, and the surface below it crosses out through the
 *      torso's own wall so the two solids genuinely intersect.
 *
 * ── What a leg garment may not be ───────────────────────────────────────────
 *
 * **Not a skirt.** A skirt in the *legs* slot would have to be a bell *and* two
 * legs — the legs below its hem are gone — so it costs twice what a leg garment
 * costs to deliver a silhouette `garments.ts` already ships three of (robe,
 * dress, pinafore). Measured at the distance the world is read at, a leg-slot
 * bell and a torso-slot bell are the same bell. The lever legs actually own is
 * the *leg*, and that is what these are.
 */

/** The hips joint. Every row below is stated in character space against it. */
export const HIPS_Y = boneDefinition('hips').head[1]

/** Character-space height of the three joints a leg garment spans. */
export const THIGH_Y = boneDefinition('thigh.L').head[1]
export const KNEE_Y = boneDefinition('shin.L').head[1]
export const ANKLE_Y = boneDefinition('foot.L').head[1]

/**
 * Samples around a leg's section.
 *
 * Eight against the body's own six, and the extra two are not padding: the leg is
 * ~180 mm across and is read at arm's length in the creation screen, where a
 * hexagon's facets are 30 mm of flat. It is also the number that makes the sample
 * grid land **on** the section's own eight control bearings — see `legSection`.
 */
export const SEGMENTS = 8

/**
 * `[y, centreX, halfWidth (outboard, +X), halfDepth (front, +Z)]` in **character**
 * space, for the character's **left** leg, top to bottom.
 *
 * Character space rather than the hips frame so the numbers read straight against
 * `rig.ts` — thigh 0.60, knee 0.33, ankle 0.06 — and `centreX` reads straight
 * against the bone it follows. They are shifted into the hips frame, and mirrored
 * for the right leg, on the way into the sweep.
 *
 * `halfWidth` is the **outboard** reach only. The inboard reach is that times the
 * section's own `inner` ratio, which is what keeps the two legs out of each
 * other. Reading `halfWidth` as a radius is the mistake this type exists to stop.
 */
export type LegRow = readonly [number, number, number, number]

/**
 * The top closure: an apex buried in the torso, then out to the thigh's width.
 *
 * The apex sits at (±0.09, 0.692, 0). The narrowest torso the figure ships —
 * `BUILDS.male`, radius 0.15 at the hips scaled 0.85 across — is 132 mm half-width
 * at that height, so the apex is **42 mm inside it**, and it stays inside through
 * a full stride because `legBoneWeights` gives it the hips outright — see the
 * note at the bottom of this file.
 * Every torso garment in `garments.ts` is wider there still: the tightest is the
 * cuirass at 152 mm.
 *
 * Not decorative. The thigh part being removed opens the whole band between the
 * torso's wall and the thigh's own start dome; without these three rows the
 * differential ray test reports it immediately, and it is the same failure
 * `garmentKit.ts::PELVIS_ROWS` closed at the crotch.
 */
export const HIP_ROWS: readonly LegRow[] = [
  [0.692, 0.09, 0.0, 0.0], // apex — closed, and buried in the torso above
  [0.664, 0.096, 0.092, 0.096], // the dome, out across the thigh's own start cap
  [0.628, 0.0955, 0.0855, 0.0895]
]

/**
 * The bottom closure: down past the ankle joint, then an apex under the shoe.
 *
 * ── The apex height is not free, and both obvious choices are wrong ──────────
 *
 * The `foot` part is still there and its start ball — radius 0.060 about the ankle
 * joint — is the obvious thing to bury the closure in, exactly as the gorget is
 * buried in the neck. It does not work, because the part being *removed* is bigger
 * than the part that stays: the shin's own end cap is a hemisphere of radius
 * **0.072** about the same joint, so it reaches y = −0.012, **12 mm below the
 * foot's sole**, and the shipped figure genuinely dips that far. An apex tucked
 * inside the foot at y = 0.045 leaves that 12 mm shell unclosed, which the
 * differential ray test finds immediately.
 *
 * Going the other way is worse: an apex at −0.042 was tried, and it is a cone tip
 * 30 mm below anything else on the figure — invisible while standing on ground and
 * a spike under the shoe the moment the character jumps.
 *
 * So the apex sits at **−0.024**, which is 12 mm under the shin cap it replaces —
 * far enough that the tip's own chords still cover the cap's lower pole, close
 * enough that the extra is inside the ground plane while the character stands.
 * Level with the cap at −0.014 was tried first and does not work: the profile has
 * to turn through 90° in the last 120 mm and a tip that short simply chords across
 * the corner, leaving the body 5.1 mm outside the garment at y = −0.007.
 *
 * Five rows rather than three, for the same reason. With three, every model was
 * 9.9 mm short at y = 0.009 at once.
 */
export const ANKLE_ROWS: readonly LegRow[] = [
  [0.108, 0.1, 0.0765, 0.0765],
  [0.062, 0.1, 0.085, 0.085], // the ankle — covers the shin cap the substitution removes
  [0.03, 0.1, 0.083, 0.083],
  [0.004, 0.1, 0.07, 0.07],
  [-0.024, 0.1, 0.0, 0.0] // apex — closed, 12 mm under the shin cap it replaces
]

// ─── Sections ───────────────────────────────────────────────────────────────

const _probe = new Vector2()

/**
 * Scales a section so its outboard reach is exactly +1 and its front reach +1.
 *
 * Not `clearingSection`, which normalises to the *smallest* radius. That is right
 * for a torso garment, whose extents are a promise that the body is inside them at
 * every bearing; it is wrong here, because a leg's tightest bearing is the
 * **inboard** one and normalising to it would make `halfWidth` mean the gap to the
 * other leg. Normalising the two axes independently instead makes `halfWidth` read
 * as the outboard reach and `halfDepth` as the forward reach, which is what the
 * rows above claim, and leaves the inboard reach as a stated ratio.
 */
const normalisedSection = (section: Section): Section => {
  let maxX = 0
  let maxZ = 0
  for (let i = 0; i < 256; i++) {
    section(i / 256, _probe)
    maxX = Math.max(maxX, _probe.x)
    maxZ = Math.max(maxZ, _probe.y)
  }
  const scaleX = maxX > 1e-6 ? 1 / maxX : 1
  const scaleZ = maxZ > 1e-6 ? 1 / maxZ : 1
  return (v, out) => {
    section(v, out)
    out.set(out.x * scaleX, out.y * scaleZ)
  }
}

/**
 * A leg's cross-section, in (X, Z), `v = 0` at the **front** — the convention
 * `torsoArmour.ts` set for this folder and the reason `front()` is a cosine.
 *
 * Eight control points for eight segments, so the sample grid lands on the
 * section's own bearings. That is worth having — the outboard and inboard
 * extremes are *sampled* rather than chorded across — but it is not a substitute
 * for `inflateFor`, and the first pass shipped without one on exactly that
 * reasoning. Measured: with the vertices on the curve, the chord between the
 * inboard and rear-inboard vertices still runs 7 % inside it, and that put the
 * body's own thigh **5.6 mm outside the hose** at the crotch, at the one height
 * (y ≈ 0.47) where the torso's bottom cap has run out and nothing else is closing
 * the figure. So the correction is applied like everywhere else in the folder,
 * and the extents below are the **ideal curve** rather than the built polygon —
 * the octagon's vertices stand 8 % proud of them and its chord midpoints sit on
 * them (GDD §4.3).
 *
 * @param inner  inboard reach as a fraction of the outboard reach. `LEG_SECTION`
 *               is the only instantiation and its 0.92 is measured — see there.
 * @param back   rearward reach as a fraction of the forward reach.
 */
export const legSection = (inner: number, back: number, shoulder = 0.72): Section =>
  normalisedSection(
    splineSection([
      [0, 1], // front (+Z)
      [shoulder, shoulder],
      [1, 0], // outboard (+X on the left leg)
      [shoulder, -shoulder * back],
      [0, -back], // back (−Z)
      [-inner * shoulder, -shoulder * back],
      [-inner, 0], // inboard
      [-inner * shoulder, shoulder]
    ])
  )

/** The same section for the character's right leg, where outboard is −X. */
export const mirrorSection = (section: Section): Section => (v, out) => {
  section(v, out)
  out.x = -out.x
}

/**
 * **The** leg section. One, shared by every leg garment, and that is a measured
 * result rather than tidiness.
 *
 * The first pass gave each garment its own ratios — a flat-backed plate at 0.78, a
 * full-backed loose trouser at 0.96 — and it does not work, because `HIP_ROWS` and
 * `ANKLE_ROWS` are **shared** and their extents go through whatever section the
 * garment picked. A back ratio of 0.78 shrinks the shared ankle closure by 22 %,
 * which put the body's own heel outside the plate legs at **388 sample points**
 * along the ankle. A closure that is only closed for some of its users is not a
 * closure, so the section is fixed and every garment's shape lives in its rows,
 * where it is visible next to the height it happens at.
 *
 * Both ratios are floors rather than preferences:
 *
 *   * **0.92 inboard.** Sweeping it down, at 0.88 the *hose* — the narrowest thing
 *     here — leaves the body's own thigh outside its inboard wall between y = 0.43
 *     and 0.47, which is a hole through the crotch of a figure wearing no torso
 *     garment (the torso's bottom cap has run out by 0.47 and only the thigh was
 *     closing it). At 0.92 the tightest garment stands 1.7 mm inboard of the leg
 *     it replaces at that height.
 *   * **1.0 behind.** A flatter back was tried at 0.78 and 0.88 and both are
 *     wrong for the reason above — every closure row goes through the same ratio,
 *     so flattening the back flattens the ankle's, and the shin's own end cap
 *     comes out of the heel. Front-to-back shaping belongs in a row's
 *     `halfDepth`, where it sits next to the height it happens at.
 *
 * Which leaves 8 % of asymmetry, and its whole job is to let the widest garment —
 * the rolled trouser's turn-up — reach 108 mm outboard without its inboard wall
 * crossing x = 0.
 */
export const LEG_SECTION = legSection(0.92, 1)

// ─── Shading ────────────────────────────────────────────────────────────────

/** Front-facing measure of a section bearing. `+1` at the shin, `−1` at the calf. */
export const front = (v: number): number => Math.cos(v * Math.PI * 2)

/**
 * Outboard-facing measure, `+1` on the outside of the leg and `−1` on the inside.
 *
 * The lever `front` is not: the inside of a thigh is in permanent contact shade
 * from the other leg, and no AO bake finds it because the two legs are separate
 * solids that only meet at the top. Every garment here darkens by it.
 */
export const outboard = (v: number): number => Math.sin(v * Math.PI * 2)

// ─── The sweep ──────────────────────────────────────────────────────────────

const AXIS_X = new Vector3(1, 0, 0)
const AXIS_Z = new Vector3(0, 0, 1)

const _color = new Color()

export interface LegPairOptions {
  name: string
  /** Rows between the hip closure and the ankle closure, top to bottom. */
  rows: readonly LegRow[]
  /** Authored for the **left** leg; mirrored for the right. */
  section: Section
  stations: number
  /**
   * Explicit ring parameters, and **every leg garment supplies them**. A leg's
   * middle is a straight line and its two ends turn through 90°, so an even
   * spread spends half its rings on a taper two would describe and hands the
   * ankle's tip two rings to round a hemisphere with. Measured: that chords
   * straight across the corner and leaves the body 3–4 mm outside the garment at
   * y = 0, on all four models at once.
   */
  us?: readonly number[]
  segments?: number
  /**
   * Paint, by the surface's own `(u, v)`.
   *
   * `at(i)` is the path parameter of costume row `i` — **derived, not counted off
   * by hand.** `splineAt` centres control point `j` at `u = (j + 1) / (n + 1)`;
   * the obvious `j / (n − 1)` puts a knee band a twentieth of the leg away from
   * the knee, which on a falloff of 14 is most of the band.
   */
  paint: (u: number, v: number, out: Color, at: (row: number) => number) => void
}

/** The full profile a leg garment ships: closure, costume, closure. */
export const legProfile = (rows: readonly LegRow[]): readonly LegRow[] => [...HIP_ROWS, ...rows, ...ANKLE_ROWS]

/** Triangles a pair of legs costs, with all four end rings collapsed. */
export const legPairTriangles = (stations: number, segments = SEGMENTS): number =>
  2 * ((stations - 1) * segments * 2 - 2 * segments)

/**
 * Both legs, as two independent closed solids.
 *
 * Two parts rather than one so the section can be mirrored per side — see the
 * header — and so `sweep` settles each one's winding on its own outermost point
 * rather than on a shape that has two of them.
 */
export const buildLegPair = (options: LegPairOptions): SweptPart[] => {
  const profile = legProfile(options.rows)
  const segments = options.segments ?? SEGMENTS
  const at = (row: number): number => (HIP_ROWS.length + row + 1) / (profile.length + 1)

  return [1, -1].map(side => {
    const part = sweep({
      name: `${options.name}/${side > 0 ? 'L' : 'R'}`,
      path: profile.map(([y, cx]) => [side * cx, y - HIPS_Y, 0] as const),
      extentA: profile.map(row => row[2]),
      extentB: profile.map(row => row[3]),
      axisA: AXIS_X,
      axisB: AXIS_Z,
      section: side > 0 ? options.section : mirrorSection(options.section),
      stations: options.stations,
      us: options.us,
      segments,
      inflate: inflateFor(segments)
    })
    return paintPart(part, (u, v, out) => options.paint(u, v, out, at), _color)
  })
}

// ─── The skinning rule, which lives in `chibiGeometry.ts` ───────────────────
//
// `legBoneWeights(x, y, z, out)` is the leg's counterpart to `torsoChestWeight`,
// and it belongs to the substitution rather than to the models — so it is
// *imported* by the tests and the bench here rather than restated. Two of its
// choices are the reason the rows above are what they are, and neither is
// obvious:
//
//   * **The midline is a 12 mm blend band, not a sign test.** A vertex within
//     12 mm of x = 0 is weighted to *both* thighs. That is strictly better than
//     the hard split and it is also why `LEG_SECTION` still keeps every garment
//     off the midline: a blended vertex does not tear, but it does move with the
//     average of two legs, which on a stride is neither of them.
//   * **Above the thigh joint the ramp continues to _pure_ hips**, where the
//     thigh's own start cap clamps at 50/50. So `HIP_ROWS`' apex is rigid to the
//     pelvis, not half-rigid to a swinging leg — which is what a waistband wants
//     and is why the apex stays buried in the torso through a full stride.
