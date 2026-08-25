import { BufferAttribute, BufferGeometry, Color, Vector3 } from 'three'
import { C } from '../art/palette'
import { assertTriBudget } from '../geometry/budget'
import {
  EQUIPMENT_BUDGET,
  ITEM_SLOT,
  SOCKETS,
  type CharacterAppearance,
  type EquipSlot,
  type ItemKind,
  DEFAULT_APPEARANCE
} from './equipment'
import { appendFace } from './face'
import { limbMesh } from './limb'
import { BONE_NAMES, type BoneName, boneDefinition } from './rig'
import {
  BUILDS,
  HAIRLINE,
  type HairMesh,
  type HeadWarp,
  bodyPalette,
  browColour,
  earMesh,
  hairMesh,
  headWarp,
  warpVertex
} from './variants'

/**
 * ─── The chibi body ─────────────────────────────────────────────────────────
 *
 * One skinned geometry, assembled from `limbMesh` parts placed between the rig's
 * bind-pose joints. Everything the art contract asks of a prop applies here too:
 * analytic normals (GDD R3), palette-only colour (R2), a triangle budget (R7).
 *
 * ── Weights fall out of the construction ────────────────────────────────────
 *
 * Each part is built *for* a bone, from that bone's joint to its child's, and
 * `limbMesh` hands back a parametric position along that axis for every vertex.
 * So a vertex already knows which bone it belongs to and how far along it sits —
 * no nearest-bone search, no heat diffusion, no hand-painted weight map.
 *
 * The only real decision is the joint blend: within `JOINT_BLEND` of either end
 * the weight ramps toward the neighbouring bone, reaching an even split exactly
 * at the joint. That is what makes an elbow bend as a crease rather than as a
 * hinge, and it is symmetric by construction, so a limb cannot collapse on one
 * side of a joint and not the other.
 *
 * ── No baked AO, deliberately ───────────────────────────────────────────────
 *
 * Every prop in this world carries baked vertex AO. Characters must not: AO is
 * baked in bind pose, and the darkest thing it would find is the contact between
 * the upper arm and the ribcage. The moment the arm swings, that shadow walks
 * out into open air and travels with the arm for the rest of the animation.
 * Static occlusion on an animated body is worse than none.
 *
 * ── Appearance ──────────────────────────────────────────────────────────────
 *
 * Head shape, hair, build and colour come from `variants.ts`, which is where the
 * reasoning about *what reads at 10–40 m* lives. Three things enter this file
 * from there and nothing else does: the colours a part is painted, the torso and
 * limb radii, and a post-build warp of the head.
 *
 * The warp is the part with a trap in it. The head's `PartSpec` — its joints,
 * radius, `radial`, `capRings` and `crossSection` — is **mirrored in `face.ts`**
 * and pinned by a test, because the face is placed by ray-casting onto the head
 * as built. So head shape may not be a different `PartSpec`; it is a warp
 * applied *after* the build, to the head, the hair and the face alike. The cast
 * still runs against the surface `face.ts` believes in, and the features ride
 * the shape change rather than being invalidated by it.
 *
 * ── A torso garment *replaces* the torso; it does not cover it ──────────────
 *
 * Pass `torsoGarment` and the torso `PartSpec` is **not emitted at all** — the
 * garment's triangles are appended in its place, weighted by the torso's own
 * hips→chest rule (`torsoChestWeight`, below). That is the option
 * `CharacterEquipment.ts` named and could not take, because it does not own this
 * file.
 *
 * It is called a *garment* rather than *armour* because the mechanism is not
 * about armour: anything authored in the hips-joint frame that wants to be the
 * torso — a cuirass, a robe, an apron, a tabard — is the same call. Adding one is
 * a builder in `gear/`, a row in `EQUIPMENT_BUDGET` and `ITEM_SLOT[kind] =
 * 'torso'`; nothing in this file changes, and the new garment costs the wearer
 * zero extra draw calls because it is not a mesh.
 *
 * What it buys, measured (`tests/world/equipment.test.ts`):
 *
 *   • **96 body triangles stop being drawn buried** under the plate. The armoured
 *     figure is 1100 triangles on the shipped bowl cut and 1160 on the worst-case
 *     hair, against 956 + 240 and 1016 + 240 for the overlay it replaces.
 *   • **Zero extra draw calls and zero extra programs.** Measured in the running
 *     creation screen: 6 draws / 5 programs unarmoured, 6 / 5 armoured, and
 *     **8 / 5** with the armour put back as a second `SkinnedMesh` and its own
 *     hull. In the world, three armoured characters render in the same 6 draws
 *     and 19 programs as three unarmoured ones. At the ≤180 draw cap of GDD §5.2
 *     that is the whole cost of an equipped item recovered
 *     (`CharacterEquipment.ts` measures ~3.3 draws per item).
 *   • **The 8 mm clearance is gone**, and with it the thing it was holding off:
 *     there is no torso left to poke through the plate.
 *
 * What it costs is a rebuild of the merged geometry on equip — the same call the
 * creation screen already makes on every click, measured in Chrome at **1.4 ms
 * median, 3.1 ms worst** over 40 equip/unequip cycles. See
 * `Character.lastRebuildMs`.
 *
 * The armour arrives in the **hips-joint frame** (`gear/index.ts`: y = 0 at the
 * hips joint, +Y up) and is translated into bind-pose world space here, because
 * that is the space a skeleton's inverse binds are in. Its winding is *not*
 * reversed: `gearKit`'s `finishGear` already asserts outward winding, whereas
 * `limbMesh` winds inward — see the note further down.
 */

/**
 * Fraction of a bone's length over which weight ramps to the neighbour.
 *
 * Exported because the armour that substitutes for the torso has to be weighted
 * by exactly this rule, and "exactly" is not a thing two copies of a constant can
 * promise. It used to be restated in `CharacterEquipment.ts` with a comment
 * asking the reader to keep them equal; a test caught that it had to.
 */
export const JOINT_BLEND = 0.3

interface PartSpec {
  /** Bone that drives this part. */
  bone: BoneName
  /**
   * Where the part starts, when that is not the driving bone's own joint.
   *
   * The head needs this: the head *bone* sits at the top of the neck, but the
   * head *volume* is a sphere resting above it. Building the sphere from the
   * joint put a 0.70 m ball spanning 0.89–1.59 m — it swallowed the neck, blew
   * past the figure's own stated height, and read on screen as a balloon.
   */
  from?: Vector3
  /** Where the part ends. A bone name uses that joint; a vector is explicit. */
  to: BoneName | Vector3
  radiusStart: number
  radiusEnd: number
  radial: number
  rings: number
  capRings?: number
  crossSection?: readonly [number, number]
  /** Albedo at the part's start joint and end joint; lerped along the axis. */
  colorStart: Color
  colorEnd: Color
  /**
   * Shifts the colour ramp along the axis, in units of `along`.
   *
   * The head's ramp *is* the hairline, and moving it is how a crop differs from
   * a bowl cut without a triangle changing hands. Expressed in `along` rather
   * than in metres so the default is a literal 0 and `(t − 0) / 1` is `t`
   * exactly — the shipped figure has to come out bit-identical, not close.
   */
  colorOffset?: number
  /** Width of that ramp, in the same units. */
  colorWidth?: number
  /** Whether the head-shape warp applies to this part. Only the head. */
  warped?: boolean
  /**
   * Whether the part's near end ramps toward its bone's **parent**. Default true.
   *
   * A part is normally built *from* its bone's joint, so `along = 0` is the joint
   * and blending there is exactly right. The two finger parts are not: they start
   * at the knuckles, 40 mm out along the hand, and the ordinary rule would give
   * their roots a 50/50 split with the *forearm* — so a fingertip would follow
   * the wrist half way through every wrist turn. They are rigid to `hand`
   * instead, which is the truth: there are no finger bones.
   */
  blendToParent?: boolean
}

const jointVector = (name: BoneName): Vector3 => {
  const [x, y, z] = boneDefinition(name).head
  return new Vector3(x, y, z)
}

const _handAxis = new Vector3()
const _palmNormal = new Vector3()

/** Unit vector down the arm, from the elbow through the wrist to the fingertips. */
const handAxis = (side: 'L' | 'R', out: Vector3): Vector3 =>
  out.subVectors(jointVector(`hand.${side}`), jointVector(`forearm.${side}`)).normalize()

/**
 * The direction the palm faces, in bind pose: **inboard, toward the thigh**.
 *
 * Perpendicular to both the arm axis and +Z by construction, which is the same
 * statement as "the palm's broad axis is Z and its flats are on ±X" made in a
 * way that survives the arm's 17° lean. It is the axis a closed fist is *thick*
 * along, and the side the thumb folds across.
 */
const palmNormal = (side: 'L' | 'R', out: Vector3): Vector3 => {
  handAxis(side, _handAxis)
  // ẑ × a for the right hand, a × ẑ for the left — the two differ because the
  // arm axis leans the opposite way and only one of the two products lands on
  // the thigh side.
  if (side === 'R') {
    out.set(_handAxis.y, -_handAxis.x, 0)
  } else {
    out.set(-_handAxis.y, _handAxis.x, 0)
  }
  return out.normalize()
}

/**
 * A point in the hand's own frame: `along` metres down the arm from the wrist,
 * `forward` metres toward +Z (which is the character's front, so it is the
 * direction the thumb points on **both** hands — see below), and `outward`
 * metres toward the palm's own face.
 *
 * Derived from the rig rather than written out, so the hand cannot drift if the
 * arm's proportions ever move. Allocates, like `jointVector` beside it: this
 * runs once per body build and never in an update path.
 */
const handPoint = (side: 'L' | 'R', scale: number, along: number, forward: number, outward = 0): Vector3 => {
  const wrist = jointVector(`hand.${side}`)
  handAxis(side, _handAxis)
  wrist.addScaledVector(_handAxis, along * scale)
  wrist.z += forward * scale
  if (outward !== 0) {
    wrist.addScaledVector(palmNormal(side, _palmNormal), outward * scale)
  }
  return wrist
}

/**
 * ─── Hands ──────────────────────────────────────────────────────────────────
 *
 * The comment that used to sit here said hands and feet are not separate parts,
 * because "a rounded, slightly fattened end cap on the forearm reads as a mitten
 * and on the shin as a boot". The boot half of that is still true. The mitten
 * half was not: a 55 mm sphere on the end of a 50 mm forearm has no wrist, no
 * palm and no thumb, so the arm simply thickens and stops — and once a character
 * can hold a sword the eye goes straight to it.
 *
 * ── What a hand has to do here, in order ────────────────────────────────────
 *
 * 1. **Read as a hand from 3 m** (~30 px), where what survives is the thumb
 *    standing off the mass, one break in the finger line, and a wrist narrower
 *    than the palm. Five separate fingers at this size are a dozen triangles of
 *    mush — that part of the old note was right and is the reason there are
 *    three parts rather than six.
 * 2. **Have a grip pass through it.** `SOCKETS.handR/handL` put a held item's
 *    grip at `(0, −0.02, 0.03)` in the hand bone's space, so the palm has to
 *    contain that point rather than sit beside it. Measured: the **nearest hand
 *    vertex to that socket is 9.1 mm away**, on a palm 85 mm across and 46 mm
 *    thick, with hand surface above it, below it, in front of it and behind it —
 *    so the hilt is inside the fist and the blade leaves through the palm's thin
 *    axis, which is where a hand's grip opening is.
 * 3. **Not get wider than the mitten it replaces.** The sword's hip socket was
 *    searched against a body that had a 55 mm ball there, and the clearance it
 *    settled on is 8.3 mm. The palm's thin axis is ±23 mm and its broad axis is
 *    ±43 mm of **Z**, so the hand's x-extent is 292–357 mm against the mitten's
 *    265–375: narrower in the axis the scabbard is measured in. Re-measured over
 *    the same 97 poses after the hand landed, the sheathed sword's worst signed
 *    clearance is **+8.3 mm (male, against `upperArm.R`) and +9.1 mm (female,
 *    against the hips)** — the numbers the socket was tuned to, unchanged.
 *
 * ── Why the palm's broad axis is Z ──────────────────────────────────────────
 *
 * The bind pose is an A-pose with the arms hanging, and a hanging hand's palm
 * faces the thigh — so the thumb points **forward** and the little finger back,
 * which puts the hand's width front-to-back and its thickness across X. That is
 * also what makes both hands mirror for free: everything below is authored from
 * the arm axis and +Z, and +Z is the same direction on both sides.
 *
 * ── The one thing that is not anatomy ───────────────────────────────────────
 *
 * The break is between the index finger and the other three, which is the
 * *shallowest* split on a real hand. It is there because it is the split that
 * sits next to the thumb, so the thumb and the break read as one gesture at
 * 3 m instead of as two unrelated lumps. 96 triangles a hand, 192 a figure.
 */
const HAND_PARTS = [
  {
    // The palm and the three fingers that stay together, as one flattened mass.
    // Rooted 10 mm back inside the forearm so the wrist cannot open a seam at
    // any limb scale.
    from: [-0.01, 0],
    to: [0.05, -0.004],
    radiusStart: 0.037,
    radiusEnd: 0.032,
    radial: 6,
    rings: 1,
    capRings: 1,
    // [Z, X-ish] for a near-vertical axis — the same reading `limbMesh` gives
    // the torso. 85 mm across the palm, 46 mm through it, 82 mm long.
    //
    // **The taper is shallow on purpose.** `capRings: 1` makes an end cap a
    // *cone*, so the far radius is the length of the point the hand ends in:
    // at 26 mm it rendered as a flattened chisel — a blade, not a fist. At 32 mm
    // against a 37 mm palm the cone is short and blunt and the mass ends in
    // knuckles. The cost of the alternative (`capRings: 2`, a real rounded cap)
    // is 24 triangles a hand, which is a quarter of the hand's whole budget for
    // a shape that is 4 px across at the range the game is read at.
    crossSection: [1.15, 0.62] as const,
    blendToParent: true
  },
  {
    // The index finger: rooted inside the palm, ~18 mm proud of it on the +Z
    // side and 16 mm past its tip, so the union has a notch rather than a hole.
    from: [0.036, 0.026],
    to: [0.082, 0.034],
    radiusStart: 0.016,
    radiusEnd: 0.014,
    radial: 5,
    rings: 1,
    capRings: 1,
    crossSection: undefined,
    blendToParent: false
  },
  {
    // The thumb, standing ~25 mm forward of the palm and angled down the hand.
    // Shorter and thicker than the index, or the two read as a pair of pincers
    // rather than as a thumb and a finger.
    from: [0.012, 0.012],
    to: [0.034, 0.05],
    radiusStart: 0.019,
    radiusEnd: 0.016,
    radial: 5,
    rings: 1,
    capRings: 1,
    crossSection: undefined,
    blendToParent: false
  }
] as const

/**
 * ─── The closed fist ────────────────────────────────────────────────────────
 *
 * Which hands are gripping something. Both false is the ordinary figure and must
 * stay byte-identical to what shipped before this existed — `characterVariants`
 * hashes it — so a closed hand is an *addition*, never a change to the open one.
 */
export interface HandGrips {
  L: boolean
  R: boolean
}

export const OPEN_HANDS: HandGrips = { L: false, R: false }

/**
 * ── Why a fist is geometry and not a pose ───────────────────────────────────
 *
 * There are no finger bones. `HAND_PARTS` weights the index and the thumb 1.0 to
 * `hand` with `blendToParent: false`, and the note there says why that must stay
 * true: their roots sit 40 mm out along the hand, so the ordinary rule would give
 * them a 50/50 split with the *forearm* and a fingertip would follow the wrist
 * through half of every wrist turn. Nothing about the skeleton can curl them. So
 * a hand that closes is a hand whose shape is swapped, exactly the way a torso or
 * a leg garment is swapped — and the machinery for that already exists here.
 *
 * ── The bore is the point ───────────────────────────────────────────────────
 *
 * A fist is not a blob with a hilt buried in it. `SOCKETS.handR/handL` put a held
 * item's grip on the line `x = 0, y = −0.02` running along the hand's **local
 * Z**, and `GRIP_ROTATION` exists to put every handle *on that line* — so the
 * fist has to close **around** it. It is therefore a hollow barrel: a single
 * closed profile in (radius, z) swept about that line, whose inner half is the
 * bore the handle passes through and whose outer half is the mass of the curled
 * fingers and the palm.
 *
 * One closed profile rather than "a tube plus two end caps" for the reason
 * `limb.ts` gives for building its caps into the radius profile: the rims are
 * *in* the profile, so the normals roll over them continuously and there is no
 * cut to bevel (GDD R2). At the two rims the profile turns from the outer
 * surface into the bore over 10–12 mm, which is what a heel of a hand and a set
 * of knuckles both do.
 *
 * ── The numbers, and which of them are measured ─────────────────────────────
 *
 * `FIST_BORE` is **not scaled by `limbScale`**, and that is the one deliberate
 * break from the rest of the hand: a smaller character holds the *same sword*.
 * Measured on the shipped models, the widest thing that has to pass through the
 * bore over the fist's span is the greatsword's grip at **22.1 mm** of radius
 * (the sword's is 17.1 mm), and the clearance to the bore's inner *surface* — a
 * real point-to-triangle distance, not a radius comparison, because the bore is
 * a hexagon and its narrowest point is a facet's middle — is **5.65 mm on the
 * greatsword and 10.44 mm on the sword**. `grip.test.ts` measures it. The wall
 * is what pays for it and the wall *is* scaled: the outer radius is the bore plus
 * 9 mm of knuckle, so a female build gets a slightly thinner fist rather than one
 * whose bore has closed on the hilt.
 *
 * `FIST_FROM` / `FIST_TO` are measured against the same two models. The sword's
 * quillons reach the bore axis at 28 mm out the thumb side of the socket and its
 * pommel necks out at 72 mm on the other, so the fist's span is set to sit inside
 * that: 70 mm of grip behind the socket and 14 mm in front of it, which leaves
 * 14 mm of bare grip showing under the guard and ~24 mm above the pommel rather
 * than swallowing either. The bore spans 84 mm on the male build and 79 on the
 * female.
 */
const FIST_BORE = 0.032
/** Wall thickness at the knuckles, before `limbScale`. */
const FIST_WALL = 0.009
/** Span along the bore, relative to the socket: pinky side, then thumb side. */
const FIST_FROM = -0.07
const FIST_TO = 0.014
/**
 * Cross-section, `[along the arm, across the palm]`.
 *
 * Slightly flattened across the palm rather than circular, because a fist is:
 * 82 mm from the knuckles to the heel and 78 mm through. The open hand it
 * replaces is 82 × 46 — a fist is *thicker*, not wider, which is the whole
 * silhouette difference between the two at 30 px.
 */
const FIST_SECTION: readonly [number, number] = [1, 0.95]
/** Segments around the bore. Six, like the palm it replaces. */
const FIST_RADIAL = 6
/**
 * The profile loop, as `[radius factor, z fraction]` pairs running from the
 * pinky rim, out over the knuckles, to the thumb rim and back down the bore.
 * A radius factor of 0 means the bore; 1 means the full outer radius.
 */
const FIST_PROFILE: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.9, 0.143],
  [1, 0.35],
  [0.95, 0.881],
  [0, 1]
]

/**
 * The thumb, folded across the front of the fist.
 *
 * It runs from the index side toward the little finger and lies on the **palm**
 * side — which is where a thumb goes on a closed fist, over the middle phalanges
 * rather than beside them. `[along, outward, z]` about the socket, in the same
 * frame the fist is built in.
 */
const FIST_THUMB = {
  from: [0.008, 0.03, 0.016] as const,
  to: [-0.002, 0.026, -0.03] as const,
  radiusStart: 0.018,
  radiusEnd: 0.014,
  radial: 5,
  rings: 1,
  capRings: 1
}

/**
 * The socket a fist closes around, in bind-pose world space.
 *
 * Read off `SOCKETS` rather than restated: the bore has to be on the same line
 * the item is, and two copies of one offset is exactly the kind of pair that
 * drifts. The socket offset is **not** scaled by `limbScale` — it is a property
 * of the socket, not of the build.
 */
const fistOrigin = (side: 'L' | 'R'): Vector3 => {
  const socket = SOCKETS[side === 'L' ? 'handL' : 'handR']
  const wrist = jointVector(`hand.${side}`)
  return wrist.add(new Vector3(socket.position[0], socket.position[1], socket.position[2]))
}

/** A point in the fist's frame: `along` the arm, `outward` toward the palm, `z` down the bore. */
const fistPoint = (side: 'L' | 'R', scale: number, along: number, outward: number, z: number): Vector3 => {
  const point = fistOrigin(side)
  point.addScaledVector(handAxis(side, _handAxis), along * scale)
  point.addScaledVector(palmNormal(side, _palmNormal), outward * scale)
  point.z += z * scale
  return point
}

/**
 * The body, part by part.
 *
 * Feet are not separate volumes for the reason hands no longer share: a rounded,
 * slightly fattened end cap on the shin reads as a boot, and a boot is a shape
 * the style wants anyway. See `HAND_PARTS` for the other half of that argument.
 */
const parts = (
  appearance: CharacterAppearance,
  torsoArmoured: boolean,
  legArmoured: boolean,
  grips: HandGrips = OPEN_HANDS
): PartSpec[] => {
  const mirror = (spec: PartSpec): PartSpec => spec
  const paint = bodyPalette(appearance)
  const build = BUILDS[appearance.sex]
  const limb = build.limbScale
  const list: PartSpec[] = []
  if (!torsoArmoured) {
    // Torso. Deeper than it is wide — `crossSection[0]` scales **Z**, not X (see
    // the note in `face.ts`) — so the figure reads as a body from the side
    // rather than as a tube. Its two radii and its cross-section are the whole
    // of how sex reads on this figure; see `BUILDS`.
    //
    // **Omitted entirely when a torso armour is supplied.** Not hidden, not
    // draw-ranged out — never built. The armour is the torso then, and the 96
    // triangles this spec emits are the ones the overlay used to bury.
    list.push({
      bone: 'hips',
      to: 'chest',
      radiusStart: build.hipRadius,
      radiusEnd: build.chestRadius,
      radial: 8,
      rings: 2,
      capRings: 2,
      crossSection: build.torsoCrossSection,
      colorStart: C.clothBase,
      colorEnd: paint.tunic
    })
  }
  list.push(
    // Neck, short and thick — a chibi neck is barely a neck. Not scaled by
    // build: a thinner neck at this size is a millimetre and reads as an error.
    {
      bone: 'neck',
      to: 'head',
      radiusStart: 0.07,
      radiusEnd: 0.08,
      radial: 6,
      rings: 1,
      capRings: 1,
      colorStart: paint.tunicShadow,
      colorEnd: paint.skin
    },
    // Head. A near-degenerate axis with big caps, which makes it a sphere built
    // by the same code as everything else. Slightly flattened front-to-back.
    {
      bone: 'head',
      // A 2 cm axis with 0.25 m caps: the volume spans `from − r` to `to + r`,
      // so 1.29−0.25 = 1.04 up to 1.31+0.25 = 1.56. Centre 1.30, height 0.52 —
      // exactly a third of FIGURE_HEIGHT, which is what "three heads tall"
      // means. The span is set by the caps, not by the centre; reading it as
      // "centre ± radius" is what put the crown 2 cm proud of the figure.
      from: new Vector3(0, 1.29, 0),
      to: new Vector3(0, 1.31, 0),
      radiusStart: 0.25,
      radiusEnd: 0.25,
      radial: 9,
      rings: 1,
      capRings: 4,
      crossSection: [1, 0.94],
      // The gradient's whole span sits in the 1.28–1.32 band, so this is a
      // hairline rather than a fade: skin below, hair above, a clean bowl cut.
      // `colorOffset` slides that line per hairstyle; `bald` runs skin → skin,
      // so there is no line at all and the whole skull is one field.
      colorStart: paint.skin,
      colorEnd: appearance.hair === 'bald' ? paint.skin : paint.hair,
      colorOffset: HAIRLINE[appearance.hair],
      // Every one of the head's build parameters above is mirrored in `face.ts`
      // and may not vary. Shape comes from the warp instead — see the header.
      warped: true
    }
  )

  for (const side of ['L', 'R'] as const) {
    list.push(
      mirror({
        bone: `upperArm.${side}` as BoneName,
        to: `forearm.${side}` as BoneName,
        radiusStart: 0.062 * limb,
        radiusEnd: 0.05 * limb,
        radial: 6,
        rings: 1,
        capRings: 1,
        colorStart: paint.tunic,
        colorEnd: C.clothBase
      }),
      // The forearm ends at a **wrist**, not at a mitten: 68 mm across against
      // the palm's 83. That step is the cheapest cue on the arm that there is a
      // hand on the end of it, and it costs nothing — the same 36 triangles,
      // one radius smaller (0.055 → 0.034).
      mirror({
        bone: `forearm.${side}` as BoneName,
        to: `hand.${side}` as BoneName,
        radiusStart: 0.05 * limb,
        radiusEnd: 0.034 * limb,
        radial: 6,
        rings: 1,
        capRings: 1,
        colorStart: C.clothBase,
        colorEnd: paint.skin
      })
    )

    // The hand. Three parts, all skin, all driven by the `hand` bone — see
    // `HAND_PARTS`. Built from the rig's own arm axis rather than from world
    // coordinates, which is what makes the two sides exact mirrors.
    //
    // A **closed** hand emits only the thumb here: its palm and fingers are the
    // hollow barrel appended after this loop, which is not a surface of
    // revolution between two joints and so cannot be a `PartSpec`. The thumb
    // still is one — it is a capsule lying across the fist — and it keeps
    // `blendToParent: false` for exactly the reason the open thumb does.
    if (grips[side]) {
      list.push({
        bone: `hand.${side}` as BoneName,
        from: fistPoint(side, limb, FIST_THUMB.from[0], FIST_THUMB.from[1], FIST_THUMB.from[2]),
        to: fistPoint(side, limb, FIST_THUMB.to[0], FIST_THUMB.to[1], FIST_THUMB.to[2]),
        radiusStart: FIST_THUMB.radiusStart * limb,
        radiusEnd: FIST_THUMB.radiusEnd * limb,
        radial: FIST_THUMB.radial,
        rings: FIST_THUMB.rings,
        capRings: FIST_THUMB.capRings,
        blendToParent: false,
        colorStart: paint.skin,
        colorEnd: paint.skin
      })
    } else {
      for (const hand of HAND_PARTS) {
        list.push({
          bone: `hand.${side}` as BoneName,
          from: handPoint(side, limb, hand.from[0], hand.from[1]),
          to: handPoint(side, limb, hand.to[0], hand.to[1]),
          radiusStart: hand.radiusStart * limb,
          radiusEnd: hand.radiusEnd * limb,
          radial: hand.radial,
          rings: hand.rings,
          capRings: hand.capRings,
          crossSection: hand.crossSection,
          blendToParent: hand.blendToParent,
          colorStart: paint.skin,
          colorEnd: paint.skin
        })
      }
    }

    // ── The legs, which a leg garment replaces the way armour replaces the
    //    torso ────────────────────────────────────────────────────────────────
    //
    // **Both** parts go, not just the thigh: trousers reach the ankle, and a
    // garment that displaced the thigh while leaving the shin would leave a
    // 70 mm tube of `clothShadow` standing inside it. What is left below is the
    // boot — the `foot` part — which is why a leg garment has to overlap it.
    if (!legArmoured) {
      list.push(
        mirror({
          bone: `thigh.${side}` as BoneName,
          to: `shin.${side}` as BoneName,
          radiusStart: 0.085 * limb,
          radiusEnd: 0.07 * limb,
          radial: 6,
          rings: 1,
          capRings: 1,
          colorStart: C.clothBase,
          colorEnd: C.clothShadow
        }),
        // The boot shafts. `hairBase`/`hairDark` stay palette literals here on
        // purpose: the palette shares them with hair so "the silhouette closes
        // top and bottom", and that coincidence turns into a bug the moment hair
        // is customisable — a blond character would get blond boots.
        mirror({
          bone: `shin.${side}` as BoneName,
          to: `foot.${side}` as BoneName,
          radiusStart: 0.07 * limb,
          radiusEnd: 0.072 * limb,
          radial: 6,
          rings: 1,
          capRings: 1,
          colorStart: C.clothShadow,
          colorEnd: C.hairBase
        })
      )
    }

    list.push(
      // The foot proper: short, forward-pointing, and the only part whose axis
      // is horizontal. Without it the legs end in round stumps and the figure
      // reads as kneeling. Kept even under a leg garment — a trouser is not a
      // boot, and this is the one volume the garment has to overlap at the ankle.
      mirror({
        bone: `foot.${side}` as BoneName,
        to: new Vector3(side === 'L' ? 0.1 : -0.1, 0.045, 0.13),
        radiusStart: 0.06 * limb,
        radiusEnd: 0.045 * limb,
        radial: 6,
        rings: 1,
        capRings: 1,
        colorStart: C.hairBase,
        colorEnd: C.hairDark
      })
    )
  }
  return list
}

const boneIndexOf = (name: BoneName): number => {
  const index = BONE_NAMES.indexOf(name)
  if (index < 0) {
    throw new Error(`[chibi] bone "${name}" is not in BONE_NAMES`)
  }
  return index
}

const parentOf = (name: BoneName): BoneName | null => boneDefinition(name).parent

/**
 * The child bone a part's far end blends into.
 *
 * `to` may be an explicit vector (feet, head), in which case there is nothing
 * beyond the part and the far end stays fully weighted to its own bone.
 */
const childOf = (spec: PartSpec): BoneName | null => (spec.to instanceof Vector3 ? null : spec.to)

// ─── The torso's weight rule, shared with whatever replaces the torso ───────

const HIPS_INDEX = BONE_NAMES.indexOf('hips')
const CHEST_INDEX = BONE_NAMES.indexOf('chest')

const _torsoAxis = new Vector3()
const _fromHips = new Vector3()
let _torsoLength = 0

const torsoAxis = (): Vector3 => {
  if (_torsoLength === 0) {
    const hips = boneDefinition('hips').head
    const chest = boneDefinition('chest').head
    _torsoAxis.set(chest[0] - hips[0], chest[1] - hips[1], chest[2] - hips[2])
    _torsoLength = _torsoAxis.length()
    _torsoAxis.divideScalar(_torsoLength)
  }
  return _torsoAxis
}

/**
 * The chest's share of a torso vertex, for a point in the **hips-joint frame**.
 *
 * This is the loop above, lifted out and given a name, because the torso is the
 * one part something else can be substituted for. Under linear blend skinning a
 * vertex's transform is a function of its weights alone, so armour built to this
 * rule and body vertices at the same height undergo the *same* affine map — which
 * is what makes a replacement torso stay welded to the neck above it and the
 * thighs below it rather than sliding against them.
 *
 * The torso part runs hips→chest and blends to the **chest**, not the spine: a
 * part is weighted between its own bone and its `to` bone, and the torso's `to`
 * is the chest. The blend is the same smoothstep as every other joint (a linear
 * ramp leaves a slope discontinuity the toon ramp quantises into a visible ring),
 * and it reaches an even split exactly at the chest joint.
 */
export const torsoChestWeight = (x: number, y: number, z: number): number => {
  const axis = torsoAxis()
  const t = (x * axis.x + y * axis.y + z * axis.z) / _torsoLength
  if (t <= 1 - JOINT_BLEND) {
    return 0
  }
  const k = (Math.min(1, t) - (1 - JOINT_BLEND)) / JOINT_BLEND
  return 0.5 * (k * k * (3 - 2 * k))
}

// ─── The legs' weight rule, shared with whatever replaces the legs ──────────

/**
 * A vertex's bones and weights, up to four. Filled in place; never allocated in
 * a loop.
 */
export interface BoneWeights {
  index: [number, number, number, number]
  weight: [number, number, number, number]
}

export const emptyBoneWeights = (): BoneWeights => ({ index: [0, 0, 0, 0], weight: [0, 0, 0, 0] })

const LEG_BONES = {
  L: { thigh: BONE_NAMES.indexOf('thigh.L'), shin: BONE_NAMES.indexOf('shin.L'), foot: BONE_NAMES.indexOf('foot.L') },
  R: { thigh: BONE_NAMES.indexOf('thigh.R'), shin: BONE_NAMES.indexOf('shin.R'), foot: BONE_NAMES.indexOf('foot.R') }
} as const

interface Segment {
  origin: Vector3
  axis: Vector3
  length: number
}

const segmentOf = (from: BoneName, to: BoneName): Segment => {
  const a = boneDefinition(from).head
  const b = boneDefinition(to).head
  const axis = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  const length = axis.length()
  return { origin: new Vector3(a[0], a[1], a[2]), axis: axis.divideScalar(length), length }
}

const LEG_SEGMENTS = {
  L: { thigh: segmentOf('thigh.L', 'shin.L'), shin: segmentOf('shin.L', 'foot.L') },
  R: { thigh: segmentOf('thigh.R', 'shin.R'), shin: segmentOf('shin.R', 'foot.R') }
} as const

/** Smoothstep, the same one every joint on this body blends with. */
const smooth = (k: number): number => k * k * (3 - 2 * k)

/** How far a point sits along a segment, in the segment's own `along` units. */
const alongSegment = (segment: Segment, x: number, y: number, z: number): number =>
  ((x - segment.origin.x) * segment.axis.x +
    (y - segment.origin.y) * segment.axis.y +
    (z - segment.origin.z) * segment.axis.z) /
  segment.length

/**
 * Half the width of the band, either side of the midline, over which a leg
 * garment's weights cross-fade from the right leg's rule to the left's.
 *
 * **12 mm, and the number is the anatomy rather than a taste.** `thigh.L` sits
 * at x = +0.09 with a radius of 0.085, so the two thighs' inner surfaces are
 * 10 mm apart: a trouser leg drawn around either one crosses the midline by a
 * few millimetres, and a hard `x >= 0` split would give that sliver the *other*
 * leg's weights and tear the tube open the first time the legs parted.
 *
 * It is deliberately narrow. Outside it the rule is bit for bit the body's own,
 * which is the property that matters — a trouser leg weighted identically to the
 * thigh it replaced undergoes the same affine map, so it cannot slide against
 * the boot below it. A wide band would buy nothing and would start blending
 * weights across geometry that is plainly on one leg.
 */
const LEG_MIDLINE_BAND = 0.012

/**
 * The bones and weights for a point on the legs, in the **hips-joint frame**.
 *
 * The direct analogue of `torsoChestWeight`, and it has the same job: to
 * *reproduce* what `buildChibiGeometry` writes for the parts it replaces rather
 * than to approximate it. Per leg it is exactly the two omitted `PartSpec`s:
 *
 *   * project onto the **thigh** segment. Below `JOINT_BLEND` of its length the
 *     weight ramps toward `hips`; above `1 − JOINT_BLEND` it ramps toward `shin`,
 *     reaching an even split *at* the joint.
 *   * past the shin joint, project onto the **shin** segment and do the same
 *     between `thigh` and `foot`.
 *
 * The two agree exactly where they meet (`t_thigh = 1` and `t_shin = 0` both
 * give 0.5 thigh / 0.5 shin), so the rule is continuous down the leg by
 * construction rather than by tuning, and below the ankle it clamps to the same
 * 50/50 shin/foot the boot's own top ring carries.
 *
 * **Two places it diverges from the body, both deliberate and both tested:**
 * above the thigh joint it keeps ramping to *pure* hips where the thigh's start
 * cap clamps at 50/50 (see below), and within `LEG_MIDLINE_BAND` of the midline
 * it blends the two legs, which the body has no geometry to disagree with. There
 * is a third, irreducible one: the thigh's axis is 2.1° off the shin's, so a
 * point on the knee joint 70 mm out to one side projects to `t = 0.990` rather
 * than 1.000 and lands 1.6 ‰ off the body's split. `chibi.test.ts` bounds it.
 *
 * Up to **three** bones come back near the midline, which is one more than
 * anything else on this figure uses. `skinIndex` is a `vec4`; the fourth slot
 * stays zero-weighted.
 */
export const legBoneWeights = (x: number, y: number, z: number, out: BoneWeights): BoneWeights => {
  const hips = boneDefinition('hips').head
  // The band is measured about the hips joint's own x, not about world zero, so
  // it means the same thing if the rig ever shifts.
  const k = (x - hips[0] + LEG_MIDLINE_BAND) / (2 * LEG_MIDLINE_BAND)
  const left = k <= 0 ? 0 : k >= 1 ? 1 : smooth(k)

  out.index[0] = HIPS_INDEX
  out.weight[0] = 0
  out.index[1] = 0
  out.weight[1] = 0
  out.index[2] = 0
  out.weight[2] = 0
  out.index[3] = 0
  out.weight[3] = 0

  for (const side of ['L', 'R'] as const) {
    const share = side === 'L' ? left : 1 - left
    if (share <= 0) {
      continue
    }
    const bones = LEG_BONES[side]
    const segments = LEG_SEGMENTS[side]
    const thigh = alongSegment(segments.thigh, x, y, z)

    let self: number
    let other: number
    let otherWeight: number
    if (thigh <= 1) {
      self = bones.thigh
      if (thigh > 1 - JOINT_BLEND) {
        other = bones.shin
        otherWeight = 0.5 * smooth((thigh - (1 - JOINT_BLEND)) / JOINT_BLEND)
      } else {
        other = HIPS_INDEX
        otherWeight =
          thigh >= 0
            ? 0.5 * (1 - smooth(Math.min(1, thigh / JOINT_BLEND)))
            : // ── Above the thigh joint the ramp keeps going, to *pure* hips ──
              //
              // The one place this rule deliberately differs from the thigh part
              // it replaces. The thigh's own start cap clamps at a 50/50 split
              // with the hips — but that cap is buried inside the pelvis, and the
              // thing a waistband is actually welded to up there is the **torso**,
              // which the body weights 1.0 to `hips` (the torso part's bone has no
              // parent, so it never blends). A waistband at 50/50 would swing with
              // the leg inside a tunic that does not.
              //
              // It also removes the midline seam where it would otherwise matter
              // most: both sides converge on pure hips 81 mm above the joint, so a
              // waistband bridging left and right has *identical* weights on both
              // halves and cannot shear at all.
              0.5 + 0.5 * smooth(Math.min(1, -thigh / JOINT_BLEND))
      }
    } else {
      const shin = alongSegment(segments.shin, x, y, z)
      self = bones.shin
      if (shin > 1 - JOINT_BLEND) {
        other = bones.foot
        otherWeight = 0.5 * smooth(Math.min(1, (shin - (1 - JOINT_BLEND)) / JOINT_BLEND))
      } else {
        other = bones.thigh
        // **Clamped at both ends.** `smooth` is a cubic, not a saturating curve:
        // past 1 it turns over and goes negative fast, so an unclamped argument
        // here made the *self* weight negative through the middle of the shin —
        // where `addWeight` dropped it as non-positive and left the vertex
        // weighted 1.06 to one bone. It skinned the whole lower leg somewhere
        // else and opened 2 244 rays of hole, with no NaN and no error anywhere.
        otherWeight = 0.5 * (1 - smooth(Math.max(0, Math.min(1, shin / JOINT_BLEND))))
      }
    }
    addWeight(out, self, share * (1 - otherWeight))
    addWeight(out, other, share * otherWeight)
  }
  return out
}

/**
 * Accumulates onto an existing bone slot, or claims the first free one.
 *
 * A **negative** weight throws rather than being dropped. It is not a value the
 * rule can legitimately produce, and dropping one is silent: the vertex simply
 * comes out weighted more than 1.0 to whatever was left, skins to the wrong
 * place, and reports as a hole a hundred rays away from the arithmetic that
 * caused it. That is exactly how the shin's missing clamp above stayed hidden.
 */
const addWeight = (out: BoneWeights, index: number, weight: number): void => {
  if (weight < 0) {
    throw new Error(`[chibi] a leg-garment weight went negative (${weight}) on bone ${BONE_NAMES[index]}`)
  }
  if (weight === 0) {
    return
  }
  for (let i = 0; i < 4; i++) {
    if (out.weight[i] === 0 || out.index[i] === index) {
      out.index[i] = index
      out.weight[i] = out.weight[i]! + weight
      return
    }
  }
  throw new Error('[chibi] a leg-garment vertex needs more than four bones')
}

/**
 * Gives a leg-shaped geometry the body's own skin weights, in the body's own
 * space. The legs' `skinTorsoGeometry`; see that function for why it exists.
 */
export const skinLegGeometry = (source: BufferGeometry): BufferGeometry => {
  const position = source.getAttribute('position')
  const hips = boneDefinition('hips').head
  const scratch = emptyBoneWeights()

  const indices = new Uint16Array(position.count * 4)
  const weights = new Float32Array(position.count * 4)
  const moved = new Float32Array(position.count * 3)

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    legBoneWeights(x + hips[0], y + hips[1], z + hips[2], scratch)
    for (let slot = 0; slot < 4; slot++) {
      indices[i * 4 + slot] = scratch.index[slot]!
      weights[i * 4 + slot] = scratch.weight[slot]!
    }
    moved[i * 3] = x + hips[0]
    moved[i * 3 + 1] = y + hips[1]
    moved[i * 3 + 2] = z + hips[2]
  }

  const skinned = new BufferGeometry()
  skinned.setAttribute('position', new BufferAttribute(moved, 3))
  for (const attribute of ['normal', 'color'] as const) {
    const source_ = source.getAttribute(attribute)
    if (source_) {
      skinned.setAttribute(attribute, source_)
    }
  }
  skinned.setIndex(source.getIndex())
  skinned.setAttribute('skinIndex', new BufferAttribute(indices, 4))
  skinned.setAttribute('skinWeight', new BufferAttribute(weights, 4))
  skinned.computeBoundingSphere()
  return skinned
}

/**
 * Gives a torso-shaped geometry the body's own skin weights, in the body's own
 * space.
 *
 * **Input is in the hips-joint frame** (`gear/index.ts`: y = 0 at the hips joint,
 * +Y up). Skinning needs bind-pose *world* space, because a skeleton's inverse
 * binds are world matrices, so the positions are translated on the way through.
 * Getting that wrong does not error — every vertex simply lands below the blend
 * band, takes weight 1 on the hips, and the collar swings with the pelvis while
 * the chest turns underneath it.
 *
 * `buildChibiGeometry` does not call this — it writes the same weights straight
 * into the merged buffers it is already filling. This is for a caller that wants
 * a torso-framed geometry skinned on its own: a paper-doll preview, or a test
 * that skins the body's own torso vertices and compares. Returns a new geometry;
 * the source is left untouched.
 */
export const skinTorsoGeometry = (source: BufferGeometry): BufferGeometry => {
  const position = source.getAttribute('position')
  const hips = boneDefinition('hips').head

  const indices = new Uint16Array(position.count * 4)
  const weights = new Float32Array(position.count * 4)
  const moved = new Float32Array(position.count * 3)

  for (let i = 0; i < position.count; i++) {
    // Already relative to the hips joint, so this *is* the offset along the
    // torso axis — no subtraction, and the translation below is the only place
    // the frames differ.
    _fromHips.set(position.getX(i), position.getY(i), position.getZ(i))
    const chest = torsoChestWeight(_fromHips.x, _fromHips.y, _fromHips.z)

    indices[i * 4] = HIPS_INDEX
    indices[i * 4 + 1] = chest > 0 ? CHEST_INDEX : HIPS_INDEX
    weights[i * 4] = 1 - chest
    weights[i * 4 + 1] = chest

    moved[i * 3] = _fromHips.x + hips[0]
    moved[i * 3 + 1] = _fromHips.y + hips[1]
    moved[i * 3 + 2] = _fromHips.z + hips[2]
  }

  const skinned = new BufferGeometry()
  skinned.setAttribute('position', new BufferAttribute(moved, 3))
  // Normals and colours are frame-independent (a translation does not rotate a
  // normal), so those buffers are shared rather than copied.
  for (const attribute of ['normal', 'color'] as const) {
    const source_ = source.getAttribute(attribute)
    if (source_) {
      skinned.setAttribute(attribute, source_)
    }
  }
  skinned.setIndex(source.getIndex())
  skinned.setAttribute('skinIndex', new BufferAttribute(indices, 4))
  skinned.setAttribute('skinWeight', new BufferAttribute(weights, 4))
  skinned.computeBoundingSphere()
  return skinned
}

/**
 * Where each block of vertices begins in the merged geometry.
 *
 * Body → substituted garments → ears → hair → face, and only the last of those
 * used to be locatable (the face is last, so it is `count − FACE_VERTICES`).
 * That arithmetic no longer identifies the hair on its own, because ears now sit
 * between the two, and a suite that kept doing the subtraction would have gone
 * on passing while measuring an ear as a hairstyle. Handed out rather than
 * recomputed, because this is the only place that knows the order.
 */
export interface ChibiBlocks {
  /** First vertex of the ear block. Equal to `hair` when no ear is shown. */
  ears: number
  /** First vertex of the hair block. Equal to `face` for a painted style. */
  hair: number
  /** First vertex of the face block. */
  face: number
  /** Total vertex count, so a caller never has to reach for the attribute. */
  count: number
}

export interface ChibiGeometry {
  geometry: BufferGeometry
  /** Hull for the outline pass — body, ears and hair; the face is excluded. See below. */
  outlineGeometry: BufferGeometry
  /** Bone order matching `BONE_NAMES`; the skeleton must be built to match. */
  boneNames: readonly BoneName[]
  blocks: ChibiBlocks
}

/**
 * GDD §4.1, `Chibi human` LOD0.
 *
 * ── Raised from 850 to 1060, and here is every triangle of it ───────────────
 *
 *   | part                        | was | now | note                          |
 *   |-----------------------------|----:|----:|-------------------------------|
 *   | body, no hands              | 654 | 654 | unchanged                     |
 *   | hands                       |   0 | 192 | 96 each — see `HAND_PARTS`    |
 *   | ears                        |   0 |  60 | 30 each, moved off the hair   |
 *   | face (eyes + mouth)         |  38 |  38 | unchanged                     |
 *   | brows                       |   0 |  12 | 6 each                        |
 *   | **default figure (`bowl`)** | 692 | 956 |                               |
 *   | worst hair (`wild`, `mane`) | 120 | 120 | unchanged                     |
 *   | **worst figure**            | 812 |1016 | 44 of headroom                |
 *
 * Ears are in both columns' worst case and cost the *figure* nothing new: they
 * were already 60 triangles on the nine styles that showed them, and moving them
 * to the body only changed who decides. What is genuinely additive is **204** —
 * hands and brows — and the split matters, because a crowd pays for it a hundred
 * times over:
 *
 *   * **Hands are 192 of the 204 and are 19 % of the figure.** That is a lot for
 *     two objects that are 30 px at 3 m and 3 px at 20 m, and it is the one line
 *     here that a coarse tier should attack first: LOD1 wants the mitten back.
 *     It is spent because a character in this game holds a sword, and the hand
 *     is where the player's eye goes the moment one is drawn.
 *   * **Brows are 12** — half a percent — and they are the only thing on the
 *     figure that puts the character's *hair colour* on their face.
 *
 * Head shape, build, skin tone and every colour still cost nothing: they are
 * warps, radii and albedo.
 */
export const CHIBI_BUDGET = 1060

/**
 * The most expensive thing `ITEM_SLOT` allows in a given body slot.
 *
 * Derived rather than named, so the day a garment lands — a robe, an apron, a
 * tabard, a pair of trousers — its budget is accounted for here by having been
 * declared in `EQUIPMENT_BUDGET`, and nothing in this file changes.
 *
 * **`legs` is 0 today**, and that is a fact about `equipment.ts` rather than a
 * decision here: the slot exists and `BODY_SLOTS` names it, but no `ItemKind`
 * maps to it yet. Until one does, a supplied leg garment is charged against the
 * body's own ceiling — which it will overrun, loudly, in dev. That is the right
 * failure: the message it produces is "declare your item in `equipment.ts`".
 */
const slotBudget = (slot: EquipSlot): number => {
  const kinds = (Object.keys(ITEM_SLOT) as ItemKind[]).filter(kind => ITEM_SLOT[kind] === slot)
  return kinds.length === 0 ? 0 : Math.max(...kinds.map(kind => EQUIPMENT_BUDGET[kind]))
}

const TORSO_GARMENT_BUDGET = slotBudget('torso')
const LEG_GARMENT_BUDGET = slotBudget('legs')

/**
 * The ceiling once a torso garment is substituted in.
 *
 * The sum of the two budgets that already exist, and it is *conservative* by 96
 * triangles: the garment displaces the torso rather than joining it, so the
 * figure is `body − 96 + garment`. Measured with the cuirass: 1100 on the shipped
 * bowl cut (956 − 96 + 240) and 1160 on the worst-case hair, against a ceiling of
 * 1465. Stated as a sum rather than as a new number so that raising either
 * budget cannot silently make the dressed build the one that fails.
 */
/**
 * The ceiling for a fully dressed figure.
 *
 * Both body slots, not just the torso. `assertTriBudget` has always summed the
 * slots actually in use, so the runtime was never wrong — but this exported
 * constant understated a figure in a cuirass *and* trousers by the whole leg
 * allowance, which is exactly the number a caller reaches for when sizing a
 * crowd.
 */
export const CHIBI_ARMOURED_BUDGET = CHIBI_BUDGET + TORSO_GARMENT_BUDGET + LEG_GARMENT_BUDGET

/** Scratch for the head-shape warp. Nothing in a build path may allocate. */
const _position = new Vector3()
const _normal = new Vector3()
const _legWeights = emptyBoneWeights()

interface StrandSink {
  positions: number[]
  normals: number[]
  colors: number[]
  skinIndices: number[]
  skinWeights: number[]
  indices: number[]
  headBone: number
  neckBone: number
  /** The worn headwear to tuck this block under, or null when bare-headed. */
  headwear: HeadShell | null
}

// ─── Tucking hair under a hat ───────────────────────────────────────────────

/**
 * The shell a hat presents to the head, as the head sees it.
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 *
 * Headwear is a rigid mesh on a socket; hair is body geometry built from the
 * skull. Neither knows about the other, so a hairstyle with any volume on top
 * grows straight through the crown of whatever is worn over it. Measured before
 * this existed, worst vertex per pair: a **topknot 81 mm through the straw hat**
 * and 85 through a coif, **wild hair 111 mm through a coif** and 105 through a
 * helmet, a **ponytail 235 mm out the back of a hood**. Nine of the twenty-one
 * hairstyles break at least one of the six headwear kinds.
 *
 * ── Why clipping and not hiding ─────────────────────────────────────────────
 *
 * The obvious fix — drop the hair mesh whenever the head slot is filled — is
 * wrong in both directions. A flat cap does not remove a ponytail, and a helmet
 * does not leave the fringe under it visible. What actually happens is that hair
 * *flattens under* what covers it and hangs freely where nothing does, and that
 * is exactly what a per-vertex clip against the shell produces: a vertex outside
 * the shell is pulled to just inside it, a vertex on a bearing the headwear does
 * not cover is left alone. A ponytail below a cap's brim keeps its whole length.
 *
 * ── Why a ray from the head's centre ────────────────────────────────────────
 *
 * Because that is the frame every hat in `gear/` is already authored in. Its
 * origin is the `headTop` socket — the head's *centre*, not its crown — and
 * `hat.ts` builds its inner crown by casting from exactly this point against the
 * skull's built 9-gon surface. Casting from anywhere else would measure the hat
 * against a surface it was not cut for.
 */
interface HeadShell {
  position: ArrayLike<number>
  index: ArrayLike<number>
}

/**
 * A headwear geometry as a shell, or null when there is nothing to clip against.
 *
 * An unindexed geometry is refused rather than expanded: everything `gear/`
 * builds is indexed, and quietly synthesising an index here would hide the day
 * something stops being.
 */
const headShell = (geometry: BufferGeometry | null): HeadShell | null => {
  if (!geometry) {
    return null
  }
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  if (!position || !index) {
    if (import.meta.env.DEV) {
      console.warn('[chibi] headwear has no indexed position — hair is not tucked under it')
    }
    return null
  }
  return { position: position.array, index: index.array }
}

/** What the rest of the outfit changes about the body. See `buildChibiGeometry`. */
export interface WornContext {
  /**
   * A `TUNIC_COLOURS` index to paint the sleeves from instead of the
   * appearance's own, or null to leave them alone. `sleeveColourForItem` in
   * `gear/garments.ts` is what produces it.
   */
  sleeveColour?: number | null
  /** The worn headwear's mesh, for tucking hair and ears under. */
  headwear?: BufferGeometry | null
}

/** Bare-headed, in the appearance's own colours. The byte-identical path. */
const NOTHING_WORN: WornContext = { sleeveColour: null, headwear: null }

/**
 * How far inside the shell a clipped vertex lands, as a fraction of the radius.
 *
 * Not zero: a vertex left exactly on the surface z-fights the hat it is touching
 * along every facet it shares with it. 1.5 % of a ~0.3 m radius is about 4.5 mm,
 * which is under the hat's own 12 mm `HAT_CLEARANCE` and so cannot show as a gap
 * on the other side.
 */
const TUCK_MARGIN = 0.015

/**
 * The origin every hat is authored around: the `headTop` socket, in the body's
 * own frame.
 *
 * Derived from the rig and the socket table rather than written as `1.29`, so a
 * head bone that moves takes the hats and this clip with it.
 */
const HEAD_TOP = jointVector('head').add(
  new Vector3(SOCKETS.headTop.position[0], SOCKETS.headTop.position[1], SOCKETS.headTop.position[2])
)

const _tuckLocal = new Vector3()
const _tuckDir = new Vector3()
const _tuckA = new Vector3()
const _tuckB = new Vector3()
const _tuckC = new Vector3()
const _tuckEdge1 = new Vector3()
const _tuckEdge2 = new Vector3()
const _tuckPvec = new Vector3()
const _tuckQvec = new Vector3()
const _tuckTvec = new Vector3()

/**
 * Pulls `point` inside `shell` if it is outside it, along the ray from the
 * head's centre.
 *
 * Möller–Trumbore against every triangle, by hand rather than through three's
 * `Raycaster`: that wants an `Object3D` and a fresh array of hits per call, and
 * this runs a few hundred times inside a rebuild that has a 1.4 ms budget. All
 * scratch is module level (GDD §5 — nothing on a build path allocates).
 *
 * **Nearest hit, not any hit.** A hood is not convex from the head's centre —
 * its cowl folds back on itself — so the first crossing going outward is the one
 * that bounds the interior, and taking the last would let a ponytail sit in the
 * fold outside the fabric.
 */
const tuckUnder = (point: Vector3, shell: HeadShell): void => {
  _tuckLocal.copy(point).sub(HEAD_TOP)
  const distance = _tuckLocal.length()
  if (distance < 1e-6) {
    return
  }
  _tuckDir.copy(_tuckLocal).divideScalar(distance)

  const { position, index } = shell
  let nearest = Infinity
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i]! * 3
    const b = index[i + 1]! * 3
    const c = index[i + 2]! * 3
    _tuckA.set(position[a]!, position[a + 1]!, position[a + 2]!)
    _tuckB.set(position[b]!, position[b + 1]!, position[b + 2]!)
    _tuckC.set(position[c]!, position[c + 1]!, position[c + 2]!)
    _tuckEdge1.subVectors(_tuckB, _tuckA)
    _tuckEdge2.subVectors(_tuckC, _tuckA)
    _tuckPvec.crossVectors(_tuckDir, _tuckEdge2)
    const det = _tuckEdge1.dot(_tuckPvec)
    // Two-sided: a hat's inner surface faces the head, so the back-face cull a
    // one-sided test does would skip exactly the face the hair comes through.
    if (det > -1e-12 && det < 1e-12) {
      continue
    }
    const inverse = 1 / det
    // The ray starts at the shell's own origin, so `origin − A` is just `−A`.
    _tuckTvec.set(-_tuckA.x, -_tuckA.y, -_tuckA.z)
    const u = _tuckTvec.dot(_tuckPvec) * inverse
    if (u < 0 || u > 1) {
      continue
    }
    _tuckQvec.crossVectors(_tuckTvec, _tuckEdge1)
    const v = _tuckDir.dot(_tuckQvec) * inverse
    if (v < 0 || u + v > 1) {
      continue
    }
    const t = _tuckEdge2.dot(_tuckQvec) * inverse
    if (t > 1e-6 && t < nearest) {
      nearest = t
    }
  }

  // No hit means the headwear does not cover this bearing at all — a ponytail
  // below the brim, the face below a helmet's rim. Leave it exactly where it is.
  if (nearest === Infinity || distance <= nearest) {
    return
  }
  point.copy(_tuckDir).multiplyScalar(nearest * (1 - TUCK_MARGIN)).add(HEAD_TOP)
}

/**
 * Appends a block of geometry glued to the head — the ears, or the hair.
 *
 * One function for both because they have to agree on three things and each is
 * a silent failure if they do not: the head-shape **warp** (a second copy that
 * skipped it would leave ears floating beside a narrowed skull), the **skull's
 * own skin weights** at each vertex's height (weight 1 on `head` measured 49.6 mm
 * of slide on the face, and 44 mm on hair), and the **winding**, which
 * `variants.ts` has already reversed out of `limbMesh`'s inward default.
 */
const appendHeadStrands = (mesh: HairMesh | null, warp: HeadWarp, sink: StrandSink): void => {
  if (!mesh) {
    return
  }
  const base = sink.positions.length / 3
  const count = mesh.position.length / 3
  for (let i = 0; i < count; i++) {
    _position.set(mesh.position[i * 3]!, mesh.position[i * 3 + 1]!, mesh.position[i * 3 + 2]!)
    _normal.set(mesh.normal[i * 3]!, mesh.normal[i * 3 + 1]!, mesh.normal[i * 3 + 2]!)
    if (!warp.identity) {
      warpVertex(warp, _position, _normal)
    }
    // **After the warp, never before.** The clip is against the actual built
    // surface, and a square head pushes its own hair 20 mm further out than a
    // round one does — clipping the unwarped shape would leave exactly that much
    // of it outside the hat on the head shapes that need it most.
    if (sink.headwear) {
      tuckUnder(_position, sink.headwear)
    }
    sink.positions.push(_position.x, _position.y, _position.z)
    sink.normals.push(_normal.x, _normal.y, _normal.z)
    sink.colors.push(mesh.color[i * 3]!, mesh.color[i * 3 + 1]!, mesh.color[i * 3 + 2]!)

    const t = mesh.along[i]!
    let otherWeight = 0
    if (t < JOINT_BLEND) {
      const k = Math.max(0, t) / JOINT_BLEND
      otherWeight = 0.5 * (1 - k * k * (3 - 2 * k))
    }
    sink.skinIndices.push(sink.headBone, sink.neckBone, 0, 0)
    sink.skinWeights.push(1 - otherWeight, otherWeight, 0, 0)
  }
  for (const value of mesh.index) {
    sink.indices.push(base + value)
  }
}

// ─── The closed fist, appended ─────────────────────────────────────────────

const _fistAxis = new Vector3()
const _fistPalm = new Vector3()
const _fistOrigin = new Vector3()
const _fistPalmRoot = new Vector3()
const _fistPalmDir = new Vector3()
const _fistPoint = new Vector3()
const _fistNormal = new Vector3()
const _fistEdgeA = new Vector3()
const _fistEdgeB = new Vector3()
const _fistFace = new Vector3()

interface FistSink {
  positions: number[]
  normals: number[]
  colors: number[]
  skinIndices: number[]
  skinWeights: number[]
  indices: number[]
  handBone: number
  forearmBone: number
}

/**
 * Sweeps `FIST_PROFILE` about the hand's grip axis and appends it.
 *
 * ── Normals from the profile, never from the mesh ───────────────────────────
 *
 * The same rule `limb.ts` states and for the same reason (GDD R3): the shape
 * function here is the closed loop `(r(s), z(s))`, so the surface normal is
 * `dz · radial − dr · axis`, central-differenced *around* the loop. That is what
 * makes the two rims roll continuously from the outer surface into the bore
 * instead of creasing, and it is why there is no bevel to author — there is no
 * cut. The radial part is divided by the cross-section and the position
 * multiplied by it, which is the non-uniform-scale normal rule; getting it the
 * same way round on both would shade a flattened fist like a round one.
 *
 * ── Weights are the palm's own, not weight 1 on the hand ────────────────────
 *
 * The barrel straddles the wrist, so its heel has to blend toward the forearm
 * exactly as the open palm's start cap does — `blendToParent: true`, the
 * smoothstep to a 50/50 split at the joint. It is evaluated positionally here
 * (a swept loop has no `along`) against the very axis the palm part is built on,
 * so the two rules agree by construction rather than by being tuned to match.
 */
const appendFist = (side: 'L' | 'R', limb: number, skin: Color, sink: FistSink): void => {
  _fistOrigin.copy(fistOrigin(side))
  handAxis(side, _fistAxis)
  palmNormal(side, _fistPalm)

  // The palm part's own axis, for the weights.
  _fistPalmRoot.copy(handPoint(side, limb, HAND_PARTS[0].from[0], HAND_PARTS[0].from[1]))
  _fistPalmDir.copy(handPoint(side, limb, HAND_PARTS[0].to[0], HAND_PARTS[0].to[1])).sub(_fistPalmRoot)
  const palmLength = _fistPalmDir.length()
  _fistPalmDir.divideScalar(palmLength)

  const z1 = FIST_FROM * limb
  const z2 = FIST_TO * limb
  const span = z2 - z1
  const outer = FIST_BORE + FIST_WALL * limb
  const [csA, csB] = FIST_SECTION

  const stations = FIST_PROFILE.length
  const radius: number[] = []
  const height: number[] = []
  for (const [factor, at] of FIST_PROFILE) {
    radius.push(FIST_BORE + factor * (outer - FIST_BORE))
    height.push(z1 + at * span)
  }

  const base = sink.positions.length / 3
  for (let i = 0; i < stations; i++) {
    const previous = (i + stations - 1) % stations
    const next = (i + 1) % stations
    const dr = radius[next]! - radius[previous]!
    const dz = height[next]! - height[previous]!
    const r = radius[i]!
    const z = height[i]!

    for (let step = 0; step <= FIST_RADIAL; step++) {
      // Offset by a half-facet so a vertex — not a facet mid-span — lands on the
      // palm's own normal, where the thumb sits and where the fist is widest.
      const angle = (step / FIST_RADIAL) * Math.PI * 2 + Math.PI / FIST_RADIAL
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)

      _fistPoint
        .copy(_fistOrigin)
        .addScaledVector(_fistAxis, r * cos * csA)
        .addScaledVector(_fistPalm, r * sin * csB)
      _fistPoint.z += z
      sink.positions.push(_fistPoint.x, _fistPoint.y, _fistPoint.z)

      _fistNormal
        .set(0, 0, -dr)
        .addScaledVector(_fistAxis, (dz * cos) / csA)
        .addScaledVector(_fistPalm, (dz * sin) / csB)
      _fistNormal.normalize()
      sink.normals.push(_fistNormal.x, _fistNormal.y, _fistNormal.z)
      sink.colors.push(skin.r, skin.g, skin.b)

      const t = _fistPoint.sub(_fistPalmRoot).dot(_fistPalmDir) / palmLength
      let otherWeight = 0
      if (t < JOINT_BLEND) {
        const k = Math.max(0, t) / JOINT_BLEND
        otherWeight = 0.5 * (1 - k * k * (3 - 2 * k))
      }
      sink.skinIndices.push(sink.handBone, otherWeight > 0 ? sink.forearmBone : sink.handBone, 0, 0)
      sink.skinWeights.push(1 - otherWeight, otherWeight, 0, 0)
    }
  }

  /**
   * Wound from the face normal rather than from the order the corners were
   * listed in — the same guard `placeholderGeometry` uses, and for the same
   * reason: `limbMesh` winds inward and this file has to reverse it, which is
   * exactly the bug worth not having twice.
   */
  const emit = (a: number, b: number, c: number): void => {
    const positions = sink.positions
    _fistEdgeA.set(
      positions[b * 3]! - positions[a * 3]!,
      positions[b * 3 + 1]! - positions[a * 3 + 1]!,
      positions[b * 3 + 2]! - positions[a * 3 + 2]!
    )
    _fistEdgeB.set(
      positions[c * 3]! - positions[a * 3]!,
      positions[c * 3 + 1]! - positions[a * 3 + 1]!,
      positions[c * 3 + 2]! - positions[a * 3 + 2]!
    )
    _fistFace.copy(_fistEdgeA).cross(_fistEdgeB)
    _fistNormal.set(
      sink.normals[a * 3]! + sink.normals[b * 3]! + sink.normals[c * 3]!,
      sink.normals[a * 3 + 1]! + sink.normals[b * 3 + 1]! + sink.normals[c * 3 + 1]!,
      sink.normals[a * 3 + 2]! + sink.normals[b * 3 + 2]! + sink.normals[c * 3 + 2]!
    )
    if (_fistFace.dot(_fistNormal) >= 0) {
      sink.indices.push(a, b, c)
    } else {
      sink.indices.push(a, c, b)
    }
  }

  const stride = FIST_RADIAL + 1
  for (let i = 0; i < stations; i++) {
    const next = (i + 1) % stations
    for (let step = 0; step < FIST_RADIAL; step++) {
      const a = base + i * stride + step
      const b = a + 1
      const c = base + next * stride + step
      const d = c + 1
      emit(a, c, b)
      emit(b, c, d)
    }
  }
}

export const buildChibiGeometry = (
  budget = CHIBI_BUDGET,
  name = 'chibi/LOD0',
  appearance: CharacterAppearance = DEFAULT_APPEARANCE,
  /**
   * A garment to build *instead of* the torso, in the hips-joint frame.
   *
   * Null is the ordinary figure and must stay byte-identical to what shipped
   * before this parameter existed — `characterVariants.test.ts` hashes it.
   */
  torsoGarment: BufferGeometry | null = null,
  /**
   * A garment to build **instead of both leg parts on both sides**, in the
   * hips-joint frame. See the note above `legBoneWeights`, and the two things it
   * must overlap: the pelvis above and the boot below.
   */
  legGarment: BufferGeometry | null = null,
  /**
   * Which hands are gripping something, and are therefore built as a closed
   * fist instead of an open hand. See `HandGrips` and `appendFist`.
   */
  grips: HandGrips = OPEN_HANDS,
  /**
   * What the rest of the figure is wearing, where it changes the *body*.
   *
   * An options bag rather than two more positional parameters: this is the
   * seventh argument, and both fields are things a caller either has or does not
   * — no caller ever wants to pass `sleeveColour` and skip `headwear` by
   * position. Both default to "nothing", which is the byte-identical path.
   */
  worn: WornContext = NOTHING_WORN
): ChibiGeometry => {
  const positions: number[] = []
  const normals: number[] = []
  const colors: number[] = []
  const skinIndices: number[] = []
  const skinWeights: number[] = []
  const indices: number[] = []

  const color = new Color()
  const warp = headWarp(appearance)

  // ── The sleeves that go with the garment ──────────────────────────────────
  //
  // A torso garment replaces the torso and **not the arms** — it does not own
  // them — so the upper arms keep being painted from `appearance.tunicColour`,
  // and a moss-green dress arrives with two woad-blue shoulder caps on it. The
  // fix is one substituted index, applied here and not by the caller: writing it
  // into the player's saved appearance would make trying a robe on permanently
  // change what colour their shirt is.
  //
  // Substituting the *whole appearance* rather than patching the palette
  // downstream, because `tunicColour` is read in more than one place and a patch
  // that missed one would be a sleeve and a collar that disagree.
  const dressed =
    worn.sleeveColour === null || worn.sleeveColour === undefined
      ? appearance
      : { ...appearance, tunicColour: worn.sleeveColour }

  for (const spec of parts(dressed, torsoGarment !== null, legGarment !== null, grips)) {
    const from = spec.from ? spec.from.clone() : jointVector(spec.bone)
    const to = spec.to instanceof Vector3 ? spec.to.clone() : jointVector(spec.to)

    const part = limbMesh({
      from,
      to,
      radiusStart: spec.radiusStart,
      radiusEnd: spec.radiusEnd,
      radial: spec.radial,
      rings: spec.rings,
      capRings: spec.capRings,
      crossSection: spec.crossSection
    })

    const base = positions.length / 3
    const self = boneIndexOf(spec.bone)
    const parent = parentOf(spec.bone)
    const child = childOf(spec)
    const parentIndex = parent ? boneIndexOf(parent) : self
    const childIndex = child ? boneIndexOf(child) : self
    const warpThisPart = spec.warped === true && !warp.identity
    const colorOffset = spec.colorOffset ?? 0
    const colorWidth = spec.colorWidth ?? 1
    const blendToParent = spec.blendToParent !== false

    for (let i = 0; i < part.along.length; i++) {
      // The unwarped path writes straight from the part's own buffers rather
      // than round-tripping through a `Vector3`. Not for speed — so that the
      // default appearance is provably the same bytes as the figure that
      // shipped before this file knew what an appearance was.
      if (warpThisPart) {
        _position.set(part.position[i * 3]!, part.position[i * 3 + 1]!, part.position[i * 3 + 2]!)
        _normal.set(part.normal[i * 3]!, part.normal[i * 3 + 1]!, part.normal[i * 3 + 2]!)
        warpVertex(warp, _position, _normal)
        positions.push(_position.x, _position.y, _position.z)
        normals.push(_normal.x, _normal.y, _normal.z)
      } else {
        positions.push(part.position[i * 3]!, part.position[i * 3 + 1]!, part.position[i * 3 + 2]!)
        normals.push(part.normal[i * 3]!, part.normal[i * 3 + 1]!, part.normal[i * 3 + 2]!)
      }

      const t = part.along[i]!
      const ramp = (t - colorOffset) / colorWidth
      const clamped = ramp < 0 ? 0 : ramp > 1 ? 1 : ramp
      color.copy(spec.colorStart).lerp(spec.colorEnd, clamped)
      colors.push(color.r, color.g, color.b)

      // ── The joint blend ──────────────────────────────────────────────────
      //
      // Reaches an even split *at* the joint (t = 0 or 1) and full ownership by
      // `JOINT_BLEND` in. Smoothstep rather than linear: a linear ramp leaves a
      // slope discontinuity where the blend ends, and that shows up as a visible
      // ring on a bent limb precisely because the toon ramp quantises shading.
      let otherIndex = self
      let otherWeight = 0
      if (t < JOINT_BLEND && parent && blendToParent) {
        const k = Math.max(0, t) / JOINT_BLEND
        otherIndex = parentIndex
        otherWeight = 0.5 * (1 - k * k * (3 - 2 * k))
      } else if (t > 1 - JOINT_BLEND && child) {
        const k = (Math.min(1, t) - (1 - JOINT_BLEND)) / JOINT_BLEND
        otherIndex = childIndex
        otherWeight = 0.5 * (k * k * (3 - 2 * k))
      }

      skinIndices.push(self, otherIndex, 0, 0)
      skinWeights.push(1 - otherWeight, otherWeight, 0, 0)
    }

    // ── Winding, reversed from what `limbMesh` emits ─────────────────────────
    //
    // `limbMesh` winds its triangles **inward**. On the body alone that is
    // invisible: normals are authored analytically and always point outward, so
    // a closed convex limb lights and silhouettes the same either way, and
    // nothing had ever asked the question.
    //
    // It is not invisible once anything depends on facing. The body material is
    // `FrontSide`, which on an inward-wound mesh keeps the **far** surface — so
    // the figure was rendering the inside of its own skull, evenly lit by
    // outward normals, which is exactly the flat washed-out look it had. And the
    // outline's `BackSide` kept the **near** surface, so the inverted hull drew
    // in front of the character and painted it solid outline colour, hiding the
    // face from ~5 m out.
    //
    // One swap fixes both, and it goes here rather than in `limb.ts` because
    // that file is shared and this is the only consumer that renders it.
    // `face.ts` already winds outward, which is why the face was the one part
    // that drew correctly.
    for (let i = 0; i < part.index.length; i += 3) {
      indices.push(base + part.index[i]!, base + part.index[i + 2]!, base + part.index[i + 1]!)
    }
  }

  // ── The substituted torso garment ────────────────────────────────────────
  //
  // Appended, like the face, because it is not a surface of revolution between
  // two joints — but *unlike* the face it goes in **before** the outline cut
  // below, because the armour is the whole silhouette of the upper body. Leaving
  // it out of the hull would outline the neck and the arms and nothing between
  // them.
  //
  // Three things differ from a `PartSpec`, and each is a way to get this wrong:
  //
  //   • **The frame.** The gear module authors in the hips-joint frame; skinning
  //     needs bind-pose world space, so the hips joint is added back on.
  //   • **The winding is not reversed.** Every part above comes from `limbMesh`,
  //     which winds inward. `finishGear` already asserts outward winding on gear,
  //     so reversing it here would be the same bug in the other direction — the
  //     figure wearing the inside of its own breastplate.
  //   • **The weights are positional, not parametric.** A swept shell has no
  //     `along`, so the hips→chest rule is evaluated from the vertex itself.
  if (torsoGarment) {
    const position = torsoGarment.getAttribute('position')
    const normal = torsoGarment.getAttribute('normal')
    const colour = torsoGarment.getAttribute('color')
    const garmentIndex = torsoGarment.getIndex()
    if (!normal || !colour || !garmentIndex) {
      throw new Error('[chibi] a torso garment needs position, normal, colour and an index buffer')
    }
    const hips = boneDefinition('hips').head
    const base = positions.length / 3
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i)
      const y = position.getY(i)
      const z = position.getZ(i)
      positions.push(x + hips[0], y + hips[1], z + hips[2])
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i))
      colors.push(colour.getX(i), colour.getY(i), colour.getZ(i))
      const chest = torsoChestWeight(x, y, z)
      skinIndices.push(HIPS_INDEX, chest > 0 ? CHEST_INDEX : HIPS_INDEX, 0, 0)
      skinWeights.push(1 - chest, chest, 0, 0)
    }
    for (let i = 0; i < garmentIndex.count; i++) {
      indices.push(base + garmentIndex.getX(i))
    }
  }

  // ── The substituted leg garment ──────────────────────────────────────────
  //
  // The torso's mechanism, with one difference and it is the whole of why
  // `legBoneWeights` exists rather than a second scalar like `torsoChestWeight`:
  // a torso is one bone pair, and the legs are **two chains of three**. A
  // trouser vertex has to know which leg it is on, how far down that leg it
  // sits, and — over the 90 mm of crotch where both answers are half true — a
  // share of each. So the weights come back as up to four (bone, weight) pairs
  // instead of one number.
  //
  // Everything else is verbatim: the hips-joint frame is translated into
  // bind-pose world space, the winding is *not* reversed (gear winds outward
  // already), and the append happens before the outline cut because trousers are
  // the lower body's silhouette.
  if (legGarment) {
    const position = legGarment.getAttribute('position')
    const normal = legGarment.getAttribute('normal')
    const colour = legGarment.getAttribute('color')
    const garmentIndex = legGarment.getIndex()
    if (!normal || !colour || !garmentIndex) {
      throw new Error('[chibi] a leg garment needs position, normal, colour and an index buffer')
    }
    const hips = boneDefinition('hips').head
    const base = positions.length / 3
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i) + hips[0]
      const y = position.getY(i) + hips[1]
      const z = position.getZ(i) + hips[2]
      positions.push(x, y, z)
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i))
      colors.push(colour.getX(i), colour.getY(i), colour.getZ(i))
      legBoneWeights(x, y, z, _legWeights)
      skinIndices.push(_legWeights.index[0], _legWeights.index[1], _legWeights.index[2], _legWeights.index[3])
      skinWeights.push(_legWeights.weight[0], _legWeights.weight[1], _legWeights.weight[2], _legWeights.weight[3])
    }
    for (let i = 0; i < garmentIndex.count; i++) {
      indices.push(base + garmentIndex.getX(i))
    }
  }

  // ── The closed fists ─────────────────────────────────────────────────────
  //
  // Before the outline cut, because a fist *is* the hand's silhouette and the
  // 1.6 px rim is most of what draws it at range. That puts the bore's inner
  // wall in the hull too, which is correct: the hull extrudes along the normal,
  // and the bore's normals point at its axis, so the hole gets an outline drawn
  // *around* it. Past ~8 m the extrusion exceeds the bore's radius and the hole
  // fills with outline colour — which is what a 4-pixel hand does anyway.
  if (grips.L || grips.R) {
    const paint = bodyPalette(appearance)
    for (const side of ['L', 'R'] as const) {
      if (!grips[side]) {
        continue
      }
      appendFist(side, BUILDS[appearance.sex].limbScale, paint.skin, {
        positions,
        normals,
        colors,
        skinIndices,
        skinWeights,
        indices,
        handBone: boneIndexOf(`hand.${side}` as BoneName),
        forearmBone: boneIndexOf(`forearm.${side}` as BoneName)
      })
    }
  }

  // ── Ears ─────────────────────────────────────────────────────────────────
  //
  // Emitted by the **body**, not by the hairstyle — a person has ears and a
  // haircut may cover them, which is the opposite of what the first pass built
  // (see `EAR_COVER` in `variants.ts`). They take the hair block's append rule
  // exactly: the head-shape warp, and the *skull's own* weights at their height
  // rather than weight 1 on `head`. Before the outline cut, because an ear 30 mm
  // proud of the skull is a silhouette and the 1.6 px rim is most of what draws
  // it at range.
  // Whatever is on the head, as a shell to tuck against. Resolved once for both
  // blocks below: an ear needs it as much as a fringe does, and a helmet that
  // leaves the ears sticking out of it is the same bug with a different vertex.
  const shell = headShell(worn.headwear ?? null)

  const earsStart = positions.length / 3
  appendHeadStrands(earMesh(appearance), warp, {
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    headBone: boneIndexOf('head'),
    neckBone: boneIndexOf('neck'),
    headwear: shell
  })

  // ── Hair ─────────────────────────────────────────────────────────────────
  //
  // Before the outline cut, unlike the face: hair is *the* silhouette change a
  // hairstyle exists to make, so leaving it out of the hull would outline the
  // skull inside a ponytail. It is also warped, because it belongs to the head.
  //
  // Weights are the skull's own at each vertex's height, never weight 1 on
  // `head` — see the note on `HairMesh.along`.
  const hairStart = positions.length / 3
  appendHeadStrands(hairMesh(appearance), warp, {
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    headBone: boneIndexOf('head'),
    neckBone: boneIndexOf('neck'),
    headwear: shell
  })

  // Where the body's triangles stop and the face's begin. The outline hull is
  // built from this prefix — see `outlineGeometry` below.
  const bodyIndexCount = indices.length

  // ── The face ─────────────────────────────────────────────────────────────
  //
  // Appended rather than expressed as `PartSpec`s: a feature is a patch pressed
  // onto the head's built surface, not a surface of revolution between two
  // joints. It rides the skull's own joint blend rather than claiming weight 1
  // on `head` — see `face.ts` for the 49.6 mm of slide that choice caused.
  const faceStart = positions.length / 3
  appendFace({
    positions,
    normals,
    colors,
    skinIndices,
    skinWeights,
    indices,
    headBone: boneIndexOf('head'),
    // The face rides the skull's own joint blend rather than claiming weight 1,
    // so both bone and blend width are handed over from here — the one place
    // that owns them — instead of being restated in `face.ts`.
    neckBone: boneIndexOf('neck'),
    jointBlend: JOINT_BLEND,
    eyes: appearance.eyes,
    mouth: appearance.mouth,
    // The brow is the only thing on the figure that puts the character's hair
    // colour below the hairline, and it is derived here rather than in `face.ts`
    // because that file knows nothing about appearance — and because importing
    // `variants.ts` from it would close a cycle. See `browColour` for what
    // "hair-coloured" has to survive: light hair on dark skin, which is the pair
    // that actually collides, and not the blond-on-pale one the palette feared.
    brow: browColour(appearance)
  })

  // ── And the face gets the same warp ──────────────────────────────────────
  //
  // `face.ts` places each feature by casting onto the *canonical* head — which
  // is the point: its mirror of the head spec stays true, and the cast keeps
  // working. Warping the result afterwards is what carries the features onto
  // the shaped skull. Done here rather than in `face.ts` both because that file
  // belongs to the face and because the warp is the body's business: the head,
  // the hair and the face have to receive exactly the same map or they come
  // apart, and there is only one place that can guarantee that.
  if (!warp.identity) {
    const vertexCount = positions.length / 3
    for (let i = faceStart; i < vertexCount; i++) {
      _position.set(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!)
      _normal.set(normals[i * 3]!, normals[i * 3 + 1]!, normals[i * 3 + 2]!)
      warpVertex(warp, _position, _normal)
      positions[i * 3] = _position.x
      positions[i * 3 + 1] = _position.y
      positions[i * 3 + 2] = _position.z
      normals[i * 3] = _normal.x
      normals[i * 3 + 1] = _normal.y
      normals[i * 3 + 2] = _normal.z
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(skinIndices), 4))
  geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array(skinWeights), 4))
  geometry.setIndex(new BufferAttribute(new Uint32Array(indices), 1))
  geometry.computeBoundingSphere()

  // Each garment's own budget is added rather than absorbed: `budget` names what
  // the *body* may cost, and a dressed figure is a body plus substituted parts
  // that `EQUIPMENT_BUDGET` already caps in their own right.
  assertTriBudget(
    geometry,
    budget + (torsoGarment ? TORSO_GARMENT_BUDGET : 0) + (legGarment ? LEG_GARMENT_BUDGET : 0),
    name
  )

  /**
   * ── The hull the outline is built from, and why it is not the body ────────
   *
   * The inverted hull draws the *silhouette* (GDD R6), and it is extruded along
   * the vertex normal by `pixelWidth × unitsPerPixel × depth` — a **world**
   * width that grows linearly with distance to hold a constant 1.6 screen px.
   * At 10 m that is 17.6 mm.
   *
   * The face is a decal pressed a fraction of a millimetre proud of the skull.
   * Extruded 17.6 mm it is no longer a decal — it is a shell standing almost two
   * centimetres off the head, in the outline colour, directly over the features
   * it is supposed to be outlining. Measured: the eyes, nose and mouth are
   * perfectly visible at 10 m with the outline mesh hidden and completely gone
   * with it shown. `face.ts` reasoned that an outward-facing open patch is culled
   * by `BackSide` and therefore free; that holds for the patch's *own* facing,
   * and does not survive the extrusion.
   *
   * So the hull is built from the body-and-hair index prefix alone — hair is in
   * it because hair *is* a silhouette change, which a decal is not. It shares every
   * attribute buffer with the body — the only new allocation is the shorter
   * index — and it is the geometrically correct answer regardless of the
   * rendering detail: a feature that does not change the silhouette has no
   * business in a silhouette pass.
   */
  const outlineGeometry = new BufferGeometry()
  for (const attribute of ['position', 'normal', 'color', 'skinIndex', 'skinWeight'] as const) {
    outlineGeometry.setAttribute(attribute, geometry.getAttribute(attribute))
  }
  // Straight prefix, same winding as the body — the swap above already made it
  // outward, so `BackSide` now keeps the far surface and the hull is a rim.
  outlineGeometry.setIndex(new BufferAttribute(new Uint32Array(indices.slice(0, bodyIndexCount)), 1))
  outlineGeometry.boundingSphere = geometry.boundingSphere

  return {
    geometry,
    outlineGeometry,
    boneNames: BONE_NAMES,
    blocks: { ears: earsStart, hair: hairStart, face: faceStart, count: positions.length / 3 }
  }
}
