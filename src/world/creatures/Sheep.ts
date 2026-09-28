import {
  Bone,
  type BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Skeleton,
  SkinnedMesh,
  Sphere,
  Vector3
} from 'three'
import { C } from '../art/palette'
import { mergeParts, partRanges } from '../assets/common'
import { assertFiniteGeometry } from '../assets/plateau'
import { assertTriBudget } from '../geometry/budget'
import { makeRng } from '../geometry/rng'
import { assertOutwardWinding, circleSection, paintPart, type Section, splineSection, sweep, type SweptPart } from '../geometry/sweep'
import { bakeVertexAO } from '../geometry/vertexAO'
import { applyVertexAO } from '../geometry/vertexColor'
import { COVERAGE_EPSILON, coverageAt, cullDistanceFor, TIER_COUNT } from '../lod/config'
import { createOutlineMaterial, type OutlineMaterial } from '../shading/outlineMaterial'
import { createToonMaterial, type ToonMaterial } from '../shading/toonMaterial'
import type { BoneName } from '../characters/rig'
import { type Grazer, makeGrazer, type Pasture, type Rect, separate, stepGrazer } from './grazing'

/**
 * ─── The flock ──────────────────────────────────────────────────────────────
 *
 * Five sheep on the storyteller's island, walking a slow wander and stopping to
 * eat. `TrollBoar.ts` is the other creature in this folder and most of its
 * reasoning carries over unchanged — a merged geometry, rigid one-bone-per-vertex
 * skinning, a hand-authored rig, analytic normals, no textures. What follows is
 * only the three places a sheep is *not* a boar, because those are the decisions.
 *
 * ── 1. It is rigged, and the rig is bigger than the boar's by one bone ──────
 *
 * The honest question is whether scenery needs a skeleton at all. It does, and
 * the argument is arithmetic rather than taste: the player asked for animals
 * that are visibly **eating grass**, and the muzzle's trip from head-up to the
 * turf is **0.73 m** — 84 % of the animal's own standing height. There is no
 * whole-body transform that produces it. Pitching the body about the hips lifts
 * the hind feet off the ground; scaling does not move a muzzle; a translation
 * buries the chest. The motion is a neck, so there is a neck.
 *
 * And it is `hips · chest · neck · head · 4 legs` = **8 bones**, one more than
 * the boar, because the boar folds its neck into `chest → head` and a grazer
 * cannot. A single joint rotating 95° swings the muzzle out on a 0.37 m radius
 * and lands it a third of a metre *in front of* the chest with the throat
 * stretched flat — a sheep pointing at the floor. Two joints let the neck come
 * down and the head level out onto the grass between the forefeet, which is the
 * pose that reads as eating. Solved above `NECK_GRAZE`: 1.20 rad at the neck
 * plus 0.42 at the head. Measured in the browser on the island, with the terrain
 * at y = 6.000: head up, the muzzle is at **6.820**; grazing, at **6.006**.
 *
 * The bone *names* are the humanoid ones for the reason `TrollBoar` gives — one
 * bone vocabulary in `creatures/`, so a future shared rig helper serves both —
 * and the lie is smaller here: a sheep really does have a neck and a head.
 *
 * ── 2. Five animals are one mesh, not five meshes ───────────────────────────
 *
 * The story scene already draws ~225 against GDD §5.2's 180 (the room's own
 * measured exception), so five sheep at two draws each — body plus the mandatory
 * inverted hull, R6 — would be **+10** on a frame that has none to give.
 *
 * So the flock is a single `SkinnedMesh` over a **40-bone** skeleton: the tier's
 * geometry is built once and stamped five times with `skinIndex` offset by
 * `i * BONE_COUNT`, and each animal is placed by its own mount `Group` under
 * which its root bone hangs. The whole flock is **2 draw calls** at LOD0/LOD1,
 * one past it, and four for the width of a crossfade band. Nothing about the
 * animation changes: bone 11 is the third sheep's neck.
 *
 * The cost is that the flock takes **one** LOD decision. It is measured off the
 * *nearest* animal rather than the centroid, so the ladder can only ever err
 * toward too much detail on the far ones — which costs vertices on a 500-triangle
 * model, where the other direction costs a visibly coarse sheep two metres away.
 *
 * ── 3. Four tiers, where the boar has one ───────────────────────────────────
 *
 * `TrollBoar` takes GDD §4.1's LOD0 number and stops, and its argument is sound
 * for a boss: it is never further away than the fight it is part of. A sheep is
 * the opposite — it is scenery on a 46 m plateau the player walks all over, seen
 * at every distance from two metres to the far shore, and it is the *only* thing
 * in this chapter that is both animated and routinely 100 m away. So it ships the
 * full four-tier ladder with the dithered crossfade, exactly as a prop does, and
 * drops its hull past LOD1 (R6).
 */

const AXIS_X = new Vector3(1, 0, 0)
const AXIS_Y = new Vector3(0, 1, 0)
const AXIS_Z = new Vector3(0, 0, 1)
const TAU = Math.PI * 2

const _colour = new Color()
const _lodPosition = new Vector3()

// ─── Proportions ────────────────────────────────────────────────────────────
//
// A ewe, at the world's own scale. Measured off the built LOD0 mesh rather than
// stated: **0.52 m across the fleece, 0.87 m to the top of the back, 1.53 m from
// rump to muzzle** with the head up. Against the 1.56 m chibi that is an animal
// which comes up to a standing adult's thigh and to a seated child's shoulder,
// which is the relationship the scene needs — the two grandchildren run past
// these on their way to the door.
//
// The hooves are at y = 0 and `SheepFlock.place` puts that origin on the terrain,
// so there is no authored lift to forget. `sheep.test.ts` asserts it, because a
// model authored 10 cm proud is precisely the defect that put the whole cast
// inside the storyteller's floorboards once already.

/** Nose at +Z, tail at −Z. The same facing convention as every character. */
const MUZZLE_Z = 0.92
const RUMP_Z = -0.56

/**
 * The bind pose, in the animal's own space with the hooves at y = 0.
 *
 * Read beside `rig.ts::BIND_POSE` and `TrollBoar`'s `BOAR_BIND`: same idea, same
 * convention, different animal. Order **is** the `skinIndex` slot order.
 */
const SHEEP_BIND: { name: BoneName; parent: BoneName | null; head: readonly [number, number, number] }[] = [
  { name: 'hips', parent: null, head: [0, 0.58, -0.34] },
  { name: 'chest', parent: 'hips', head: [0, 0.6, 0.24] },
  // The neck's pivot sits *inside* the barrel, at the base of the swept neck
  // part whose extent there is exactly zero. A pivot forward of the part's own
  // base is a base that swings out of the fleece the moment the head goes down.
  { name: 'neck', parent: 'chest', head: [0, 0.63, 0.22] },
  { name: 'head', parent: 'neck', head: [0, 0.79, 0.55] },
  // Forelegs off the chest, hind legs off the hips. +X is the animal's left,
  // matching the rig.
  { name: 'upperArm.L', parent: 'chest', head: [0.155, 0.5, 0.3] },
  { name: 'upperArm.R', parent: 'chest', head: [-0.155, 0.5, 0.3] },
  { name: 'thigh.L', parent: 'hips', head: [0.155, 0.5, -0.4] },
  { name: 'thigh.R', parent: 'hips', head: [-0.155, 0.5, -0.4] }
]

const BONE_COUNT = SHEEP_BIND.length
const HIPS = 0
const CHEST = 1
const NECK = 2
const HEAD = 3
const FORE_L = 4
const FORE_R = 5
const HIND_L = 6
const HIND_R = 7

/**
 * The tip of the muzzle, in bind pose, **relative to the head bone**.
 *
 * The one number in this file that has to agree with the geometry — it is the
 * last control point of `buildHead`'s path, minus the head bone's own head. It
 * exists because "is this animal's mouth in the grass" is the entire feature and
 * is otherwise unanswerable from outside: the graze is eight bone rotations
 * whose product nobody can read, and the alternative to publishing the answer is
 * re-deriving the forward kinematics in a test, which would then agree with a
 * copy of the rig rather than with the rig.
 *
 * Subtracting the bind head is what the skin's own bone inverse does, so this
 * lands in exactly the space `bone.matrixWorld` maps to world.
 */
const MUZZLE_FROM_HEAD = new Vector3(0, 0.725 - 0.79, MUZZLE_Z - 0.55)

// ─── The graze, as angles ───────────────────────────────────────────────────

/** Neck pitch with the head up and walking. Barely off the bind pose. */
const NECK_IDLE = -0.05
/** Head up and looking around — the alert beat between eating and moving. */
const NECK_ALERT = -0.24
/** Muzzle on the ground. Solved in the header; do not tune one of these alone. */
const NECK_GRAZE = 1.2
const HEAD_IDLE = 0.05
const HEAD_ALERT = 0.16
const HEAD_GRAZE = 0.42
/** Bites per second while cropping. Slow — a ewe is not a woodpecker. */
const CROP_HZ = 1.55
/** How far the head nods on each bite. 4°, and it only applies at full down. */
const CROP_NOD = 0.075
/** Stride length, metres. A little over half the body. */
const STRIDE = 0.55
/** Peak leg swing at full walking speed, radians. */
const LEG_SWING = 0.45

// ─── Sections ───────────────────────────────────────────────────────────────

/**
 * The fleece, as a closed profile: a deep oval, flat-ish underneath, widest low.
 *
 * The **curl** is a ±`curl` ripple at six times round the section, composed onto
 * the spline rather than displaced afterwards. That distinction is GDD R2/R3:
 * `sweep` central-differences the *shape function* for its normals, so a ripple
 * written here is a ripple the normals know about, while the same ripple applied
 * to the built vertices would leave every one of them carrying the smooth
 * profile's normal and the fleece would light like a balloon.
 *
 * Six lumps against LOD0's twelve segments puts a sample on every crest and every
 * trough. The coarse tiers **damp it to nothing** (see `SHEEP_TIERS`), because at
 * seven segments the same six-cycle ripple aliases into a uniform inflation —
 * i.e. into a sheep of a slightly different size, which is exactly the kind of
 * silhouette change the crossfade cannot hide.
 */
const woolSection = (curl: number): Section => {
  const base = splineSection([
    [1.0, 0.06],
    [0.86, 0.52],
    [0.52, 0.88],
    [0.0, 1.0],
    [-0.52, 0.88],
    [-0.86, 0.52],
    [-1.0, 0.06],
    [-0.88, -0.42],
    [-0.5, -0.8],
    [0.0, -0.88],
    [0.5, -0.8],
    [0.88, -0.42]
  ])
  if (curl <= 0) {
    return base
  }
  return (v, out) => {
    base(v, out)
    out.multiplyScalar(1 + curl * Math.cos(v * TAU * 6))
  }
}

/** A limb: an oval with the flat toward the body. Same shape the boar's legs use. */
const LIMB_SECTION: Section = splineSection([
  [1, 0.45],
  [0.75, 0.85],
  [0, 1],
  [-0.75, 0.85],
  [-1, 0.45],
  [-1, -0.45],
  [-0.75, -0.85],
  [0, -1],
  [0.75, -0.85],
  [1, -0.45]
])

// ─── Paint ──────────────────────────────────────────────────────────────────
//
// ── On the palette, and on the one colour that is missing ───────────────────
//
// There is no wool in `art/palette.ts`, and adding one is somebody else's file.
// The fleece is therefore `boneBase → boneLit`, which is the palette's cream,
// deepening to `clothShadow` in the crevices; the face, ears and legs are the
// `bandit*` charcoals and the hooves `ironShadow`.
//
// The dark face and legs are not a compromise — they are the strongest thing
// available for separating a cream animal from the cream **daub** of the wall it
// will most often be standing in front of, they are a real breed (a Suffolk), and
// they cost nothing because they are paint. Even so, a dedicated
// `woolLit/Base/Shadow` a shade cooler and greyer than bone would be worth having;
// see the report.

/**
 * `v` here is the sweep's own section parameter *before* `vOffset`, so with
 * `vOffset: 0.25` — which puts a vertex exactly on the spine and on the belly —
 * `v = 0` is the top of the animal and `v = 0.5` is underneath it.
 */
const fleecePaint = (u: number, v: number, out: Color): void => {
  const up = Math.cos(v * TAU)
  out.copy(C.boneBase).lerp(C.boneLit, 0.34 + 0.44 * Math.max(0, up))
  // The belly and the inside of the legs, where the fleece is dirty and in shade.
  out.lerp(C.clothShadow, 0.34 * Math.max(0, -up) ** 1.4)
  // Curl, as a two-frequency band. The same argument the boar's coarse hair
  // makes: it is the one thing that stops a 500-triangle animal reading as
  // moulded plastic, and it is free.
  const curl = Math.abs(Math.cos(6 * Math.PI * v)) * Math.abs(Math.cos(9 * Math.PI * u))
  out.lerp(C.clothBase, 0.24 * curl)
}

/** The dark head, with the fleece running forward over the poll. */
const headPaint = (u: number, v: number, out: Color): void => {
  const up = Math.cos(v * TAU)
  out.copy(C.banditBase).lerp(C.banditLit, 0.28 + 0.34 * Math.max(0, up))
  // Wool over the crown, fading out by a fifth of the way down the face. This is
  // what stops the head reading as a black sock pulled over the neck.
  out.lerp(C.boneBase, 0.9 * Math.max(0, 1 - u * 5))
  // The muzzle, paler over the last fifth.
  out.lerp(C.banditLit, 0.45 * Math.max(0, (u - 0.74) / 0.26))
  // The eye: a dark patch either side of the skull. Two triangles of paint that
  // do the whole job of a face — and it is *darker* than an already dark head,
  // which is the only direction left on a black-faced breed.
  const side = Math.abs(Math.abs(((v + 0.25) % 1) - 0.5) - 0.25)
  const eye = Math.max(0, 1 - Math.abs(u - 0.34) * 13) * Math.max(0, 1 - side * 15)
  out.lerp(C.eyeDark, 0.85 * eye)
}

/** The neck: fleece at the shoulder, going dark as it reaches the head. */
const neckPaint = (u: number, v: number, out: Color): void => {
  fleecePaint(u * 0.5, v, out)
  out.lerp(C.banditBase, 0.9 * Math.max(0, (u - 0.62) / 0.38))
}

/** A leg: charcoal, with a wool cuff at the top and a hard hoof at the bottom. */
const legPaint = (u: number, v: number, out: Color): void => {
  const up = Math.cos(v * TAU)
  out.copy(C.banditBase).lerp(C.banditLit, 0.2 + 0.3 * Math.max(0, up))
  // The fleece hanging over the top of the leg. A third of the way down, which
  // is where it actually stops on an unshorn ewe and is most of what keeps four
  // black posts from reading as a table.
  out.lerp(C.boneBase, 0.95 * Math.max(0, 1 - u * 3.2))
  // The hoof, hard-edged over the bottom 7 %.
  out.lerp(C.ironShadow, 0.95 * Math.max(0, (u - 0.93) / 0.07))
}

const earPaint = (u: number, _v: number, out: Color): void => {
  out.copy(C.banditBase).lerp(C.banditShadow, 0.4 * u)
}

const tailPaint = (u: number, v: number, out: Color): void => {
  fleecePaint(0.5, v, out)
  out.lerp(C.clothShadow, 0.3 * u)
}

// ─── The tier ladder ────────────────────────────────────────────────────────

interface SheepTier {
  /** `[stations, segments]` per part. */
  body: readonly [number, number]
  neck: readonly [number, number]
  head: readonly [number, number]
  leg: readonly [number, number]
  ears: readonly [number, number] | null
  tail: readonly [number, number] | null
  /** Fleece ripple amplitude. Damped out on the coarse tiers — see `woolSection`. */
  curl: number
  /** Triangles for **one** animal. GDD §4.1. */
  budget: number
}

/**
 * Four rungs, and what each one gives up.
 *
 * LOD1 loses half the rings and most of the curl; LOD2 loses the ears, the tail
 * and the eye (paint follows vertices, so a coarser head simply has nowhere to
 * put one); LOD3 is a body, a stub neck, a head and four posts. The parts that
 * survive to the bottom are the ones that carry the silhouette — R1 — and the
 * legs survive because a sheep is 7 px tall at LOD3's 110 m and a *floating*
 * 7 px blob is the one failure at that size that is still visible.
 *
 * Budgets are per animal; the flock mesh is five of these.
 */
const SHEEP_TIERS: readonly SheepTier[] = [
  { body: [8, 12], neck: [5, 8], head: [6, 9], leg: [6, 6], ears: [4, 5], tail: [4, 5], curl: 0.1, budget: 560 },
  { body: [6, 9], neck: [4, 6], head: [5, 7], leg: [4, 5], ears: [3, 4], tail: [3, 4], curl: 0.055, budget: 280 },
  { body: [5, 7], neck: [3, 5], head: [4, 6], leg: [3, 4], ears: null, tail: null, curl: 0.02, budget: 130 },
  { body: [4, 6], neck: [3, 4], head: [3, 5], leg: [3, 3], ears: null, tail: null, curl: 0, budget: 80 }
]

/** The last rung that draws an inverted hull. GDD R6, same as every other object. */
const OUTLINE_MAX_TIER = 1

interface SheepPart {
  part: SweptPart
  /** Index into `SHEEP_BIND`. */
  bone: number
  deep: Color
  ao: number
}

const buildBody = (t: SheepTier): SheepPart => {
  const part = sweep({
    name: 'sheep/body',
    // Tail to shoulder. The back rises slightly to the middle, which is what
    // gives a fleeced animal its loaf shape from the side.
    path: [
      [0, 0.605, RUMP_Z],
      [0, 0.62, -0.49],
      [0, 0.645, -0.28],
      [0, 0.655, 0.0],
      [0, 0.645, 0.18],
      [0, 0.63, 0.31],
      [0, 0.615, 0.4]
    ],
    // Half-width, then half-height. Widest at the barrel and *deep* rather than
    // round: a sheep in fleece is a rectangle with the corners knocked off.
    extentA: [0, 0.17, 0.245, 0.265, 0.245, 0.165, 0],
    extentB: [0, 0.16, 0.215, 0.24, 0.225, 0.155, 0],
    axisA: AXIS_X,
    axisB: AXIS_Y,
    section: woolSection(t.curl),
    stations: t.body[0],
    segments: t.body[1],
    // Puts a vertex exactly on the spine and on the belly, which are the two
    // places `fleecePaint` puts a band edge.
    vOffset: 0.25
  })
  paintPart(part, fleecePaint, _colour)
  // Bound to `chest`, not `hips`, for the reason `TrollBoar` gives: pivoting the
  // whole barrel about the hindquarters looks like an animal sitting down.
  return { part, bone: CHEST, deep: C.clothShadow, ao: 0.5 }
}

const buildNeck = (t: SheepTier): SheepPart => {
  const part = sweep({
    name: 'sheep/neck',
    path: [
      [0, 0.63, 0.22],
      [0, 0.655, 0.29],
      [0, 0.715, 0.42],
      [0, 0.77, 0.52],
      [0, 0.785, 0.575]
    ],
    extentA: [0, 0.105, 0.092, 0.068, 0],
    extentB: [0, 0.11, 0.096, 0.07, 0],
    axisA: AXIS_X,
    axisB: AXIS_Y,
    section: LIMB_SECTION,
    stations: t.neck[0],
    segments: t.neck[1],
    vOffset: 0.25
  })
  paintPart(part, neckPaint, _colour)
  return { part, bone: NECK, deep: C.clothShadow, ao: 0.7 }
}

const buildHead = (t: SheepTier): SheepPart => {
  const part = sweep({
    name: 'sheep/head',
    // Poll to muzzle. The head starts 6 cm *behind* its own bone so the joint is
    // buried in the neck at every angle the graze reaches.
    path: [
      [0, 0.8, 0.49],
      [0, 0.805, 0.57],
      [0, 0.79, 0.67],
      [0, 0.755, 0.79],
      [0, 0.73, 0.88],
      [0, 0.725, MUZZLE_Z]
    ],
    extentA: [0, 0.084, 0.075, 0.054, 0.038, 0],
    extentB: [0, 0.095, 0.088, 0.062, 0.042, 0],
    axisA: AXIS_X,
    axisB: AXIS_Y,
    section: LIMB_SECTION,
    stations: t.head[0],
    segments: t.head[1],
    vOffset: 0.25
  })
  paintPart(part, headPaint, _colour)
  return { part, bone: HEAD, deep: C.banditShadow, ao: 0.72 }
}

/**
 * An ear: a flat leaf standing out sideways and a little back.
 *
 * Horizontal rather than upright, which is the silhouette difference between a
 * sheep and a goat and costs the same 20 triangles either way.
 */
const buildEars = (t: SheepTier): SheepPart[] =>
  [-1, 1].map(side => ({
    part: paintPart(
      sweep({
        name: `sheep/ear-${side}`,
        path: [
          [side * 0.06, 0.82, 0.575],
          [side * 0.09, 0.825, 0.56],
          [side * 0.15, 0.825, 0.52],
          [side * 0.19, 0.81, 0.495]
        ],
        // Thin vertically, broad fore-and-aft.
        extentA: [0, 0.014, 0.011, 0],
        extentB: [0, 0.042, 0.033, 0],
        axisA: AXIS_Y,
        axisB: AXIS_Z,
        section: LIMB_SECTION,
        stations: t.ears![0],
        segments: t.ears![1]
      }),
      earPaint,
      _colour
    ),
    bone: HEAD,
    deep: C.banditShadow,
    ao: 0.6
  }))

/** A leg. The hoof is in the profile, not a separate part — one surface, no seam. */
const buildLeg = (t: SheepTier, side: number, hind: boolean): SheepPart => {
  const z = hind ? -0.4 : 0.3
  const x = side * 0.155
  // Hind legs rake back under the animal, forelegs stand plumb. It is 3 cm and
  // it is most of what stops four identical posts reading as a table.
  const bend = hind ? 0.035 : -0.015
  const part = sweep({
    name: `sheep/leg-${hind ? 'hind' : 'fore'}-${side}`,
    path: [
      [x, 0.52, z],
      [x, 0.47, z + bend],
      [x, 0.34, z + bend * 0.6],
      [x, 0.2, z],
      [x, 0.07, z],
      [x, 0.015, z],
      [x, 0, z]
    ],
    // Thick where the fleece covers it, pencil-thin at the cannon, then the hoof
    // flares again. That double pinch is a hoofed leg's whole silhouette.
    extentA: [0, 0.068, 0.048, 0.031, 0.036, 0.038, 0],
    extentB: [0, 0.072, 0.05, 0.032, 0.038, 0.04, 0],
    axisA: AXIS_X,
    axisB: AXIS_Z,
    section: LIMB_SECTION,
    stations: t.leg[0],
    segments: t.leg[1],
    vOffset: 0.25
  })
  paintPart(part, legPaint, _colour)
  return {
    part,
    bone: hind ? (side > 0 ? HIND_L : HIND_R) : side > 0 ? FORE_L : FORE_R,
    deep: C.banditShadow,
    ao: 0.78
  }
}

const buildTail = (t: SheepTier): SheepPart => ({
  part: paintPart(
    sweep({
      name: 'sheep/tail',
      path: [
        [0, 0.64, -0.54],
        [0, 0.63, -0.575],
        [0, 0.575, -0.6],
        [0, 0.53, -0.595]
      ],
      extentA: [0, 0.03, 0.024, 0],
      extentB: [0, 0.032, 0.026, 0],
      axisA: AXIS_X,
      axisB: AXIS_Z,
      section: circleSection,
      stations: t.tail![0],
      segments: t.tail![1]
    }),
    tailPaint,
    _colour
  ),
  bone: HIPS,
  deep: C.clothShadow,
  ao: 0.65
})

/**
 * One animal's geometry at one tier, weighted, painted, occluded and asserted.
 *
 * Exported so a probe can measure the ladder without building a scene — the same
 * facility `boarBudget` provides, and what `tests/world/sheep.test.ts` runs on.
 */
export const buildSheepGeometry = (tier: number): BufferGeometry => {
  const t = SHEEP_TIERS[tier]!
  const parts: SheepPart[] = [
    buildBody(t),
    buildNeck(t),
    buildHead(t),
    buildLeg(t, 1, false),
    buildLeg(t, -1, false),
    buildLeg(t, 1, true),
    buildLeg(t, -1, true)
  ]
  if (t.ears) {
    parts.push(...buildEars(t))
  }
  if (t.tail) {
    parts.push(buildTail(t))
  }

  const geometries = parts.map(p => p.part.geometry)
  // Rigid binding: every vertex of a part is weight 1.0 on that part's bone.
  // Written per part **before** the merge, because afterwards there is no way
  // left to tell which vertex came from which sweep.
  for (const [i, entry] of parts.entries()) {
    const geometry = geometries[i]!
    assertOutwardWinding(geometry, `sheep/LOD${tier}/part-${i}`)
    const count = geometry.getAttribute('position').count
    const index = new Float32Array(count * 4)
    const weight = new Float32Array(count * 4)
    for (let v = 0; v < count; v++) {
      index[v * 4] = entry.bone
      weight[v * 4] = 1
    }
    geometry.setAttribute('skinIndex', new Float32BufferAttribute(index, 4))
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(weight, 4))
  }

  const ranges = partRanges(geometries)
  const merged = mergeParts(geometries, `sheep/LOD${tier}`)
  // 0.3 m of reach: a shade over the barrel's own radius, so the shadow under
  // the belly and inside the legs is found and the fleece's own curl is not
  // flattened by an occluder half a body away.
  const ao = bakeVertexAO(merged, { samples: 10, maxDistance: 0.3, strength: 0.82, power: 1.15 })
  for (const [i, entry] of parts.entries()) {
    applyVertexAO(merged, ao, entry.deep, entry.ao, ranges[i]!)
  }
  merged.computeBoundingSphere()
  // Finiteness first, budget second: every comparison against NaN is false, so a
  // budget assertion over a NaN mesh passes. `plateau.ts` says why at length.
  assertFiniteGeometry(merged, `sheep/LOD${tier}`)
  assertTriBudget(merged, t.budget, `sheep/LOD${tier}`)
  return merged
}

/**
 * `count` copies of one animal in a single buffer, each bound to its own eight
 * bones.
 *
 * The clone is the cheap half — the geometry is already built — and the only
 * edit is `skinIndex += i * BONE_COUNT`. `skinWeight` is untouched because every
 * weight is 1.0 on slot 0 of the four.
 */
const stampFlock = (single: BufferGeometry, count: number, name: string): BufferGeometry => {
  const copies: BufferGeometry[] = []
  for (let i = 0; i < count; i++) {
    const copy = i === 0 ? single : single.clone()
    if (i > 0) {
      const attribute = copy.getAttribute('skinIndex')
      const array = attribute.array as Float32Array
      for (let v = 0; v < array.length; v += 4) {
        array[v] = array[v]! + i * BONE_COUNT
      }
      attribute.needsUpdate = true
    }
    copies.push(copy)
  }
  return mergeParts(copies, name)
}

interface FlockTier {
  body: SkinnedMesh
  outline: SkinnedMesh | null
  material: ToonMaterial
  outlineMaterial: OutlineMaterial | null
}

export interface SheepFlockOptions {
  /** How many animals. Five, and the rig scales linearly with it. */
  count?: number
  /** Where they live. They are clamped inside it, hard. */
  paddock: Rect
  /** Rectangles they must never enter — `frame.ts::HUT_ROOM` is the one that matters. */
  keepOut?: readonly Rect[]
  groundAt: (x: number, z: number) => number
  seed?: number
  perfTag?: string
}

export class SheepFlock {
  readonly group = new Group()
  /** The minds, in placement order. Public so a test can watch one wander. */
  readonly grazers: Grazer[] = []
  /** The rung currently carrying the flock, or −1 when it is culled. */
  lodTier = 0

  private readonly mounts: Group[] = []
  private readonly bones: Bone[][] = []
  private readonly skeleton: Skeleton
  private readonly tiers: FlockTier[] = []
  private readonly coverage = new Float32Array(TIER_COUNT)
  private readonly cullDistance = cullDistanceFor(1)
  private readonly pasture: Pasture
  private readonly groundAt: (x: number, z: number) => number
  /** Eased 0..1 per animal — the head-up-and-look-around blend. Presentation only. */
  private readonly alert: Float32Array
  private elapsed = 0
  private active = true

  /**
   * The world's blocking props, or null.
   *
   * A field the owner writes each frame rather than a constructor argument,
   * because the collision world is rebuilt when placements change and a captured
   * reference would go stale — `StoryDirector` already holds it as a getter for
   * exactly that reason.
   */
  collision: Pasture['collision'] = null

  constructor(options: SheepFlockOptions) {
    const count = options.count ?? 5
    this.groundAt = options.groundAt
    this.group.name = 'sheep-flock'
    // Rule 10. The flock hangs under the chapter's own registered root, so this
    // is what puts its draws and triangles in the `story` column rather than in
    // nobody's — see `Profiler.collectTagStats`, which bills by root.
    this.group.userData.perfTag = options.perfTag ?? 'story'

    this.pasture = {
      paddock: options.paddock,
      keepOut: options.keepOut ?? [],
      collision: null,
      y: options.groundAt(options.paddock.x, options.paddock.z),
      playerX: 0,
      playerZ: 0,
      hasPlayer: false,
      // Seeded, so the flock stands the same way every time the chapter loads.
      // A wander that differs run to run is a wander no screenshot can check.
      rng: makeRng(options.seed ?? 0x5133b)
    }

    // ── The rig: `count` copies of an eight-bone skeleton ──────────────────
    const bones: Bone[] = []
    const inverses: Matrix4[] = []
    for (let i = 0; i < count; i++) {
      const mount = new Group()
      mount.name = `sheep-${i}`
      // ── The only per-animal variation there is, and it is free ──────────
      //
      // Five stamps of one geometry share one set of vertex colours, so paint
      // cannot tell them apart and neither can shape. Scale can: ±7 % on the
      // mount is one float and it is enough to stop the flock reading as five
      // copies of a prop.
      //
      // Uniform, and that is what keeps it safe. The bind pose has the hooves at
      // y = 0 and the graze lands the muzzle at y = 0.006, so scaling about the
      // mount's origin moves both by the same factor — a small sheep's mouth is
      // still on the ground. A non-uniform scale would also break the outline
      // hull, which assumes an orthogonal rotation block (`outlineMaterial`).
      mount.scale.setScalar(0.93 + this.pasture.rng() * 0.14)
      this.group.add(mount)
      this.mounts.push(mount)

      const own: Bone[] = []
      for (const definition of SHEEP_BIND) {
        const bone = new Bone()
        bone.name = `sheep${i}/${definition.name}`
        if (definition.parent === null) {
          bone.position.set(definition.head[0], definition.head[1], definition.head[2])
          mount.add(bone)
        } else {
          const parentIndex = SHEEP_BIND.findIndex(b => b.name === definition.parent)
          const parent = SHEEP_BIND[parentIndex]!
          bone.position.set(
            definition.head[0] - parent.head[0],
            definition.head[1] - parent.head[1],
            definition.head[2] - parent.head[2]
          )
          own[parentIndex]!.add(bone)
        }
        own.push(bone)
        bones.push(bone)
        // The bind pose is authored in the animal's own space with the mount at
        // identity, so the inverse is the same eight matrices for every sheep —
        // the mount's transform is what makes them different, and it applies
        // *outside* this.
        inverses.push(new Matrix4().makeTranslation(definition.head[0], definition.head[1], definition.head[2]).invert())
      }
      this.bones.push(own)
    }
    this.skeleton = new Skeleton(bones, inverses)
    this.alert = new Float32Array(count)

    // ── The meshes ────────────────────────────────────────────────────────
    //
    // All four rungs up front rather than on demand. `Character` builds lazily
    // and is right to — a rebuild there is 1.4 ms of re-merging a dressed figure,
    // and most figures never leave tier 0. A sheep tier is a fixed set of sweeps
    // built once for the whole flock, the coarse three are 300 triangles between
    // them, and the player walks away from these animals within seconds of the
    // chapter opening. Paying at load is strictly better than a hitch on the
    // path out of the yard.
    const startedAt = performance.now()
    const paddockY = this.pasture.y
    // Frustum culling reads `geometry.boundingSphere`, which is computed from the
    // *bind* pose — five animals stacked at the paddock's origin. Left alone it
    // would cull the flock the moment the mount groups walked it off that spot.
    const bounds = new Sphere(
      new Vector3(options.paddock.x, paddockY + 0.5, options.paddock.z),
      Math.hypot(options.paddock.halfX, options.paddock.halfZ) + 1.5
    )
    for (let tier = 0; tier < TIER_COUNT; tier++) {
      const geometry = stampFlock(buildSheepGeometry(tier), count, `sheep-flock/LOD${tier}`)
      geometry.boundingSphere = bounds.clone()
      geometry.boundingBox = null

      const material = createToonMaterial({ name: `sheep/LOD${tier}` })
      const body = new SkinnedMesh(geometry, material)
      body.name = `sheep/body/LOD${tier}`
      body.castShadow = tier <= OUTLINE_MAX_TIER
      body.receiveShadow = true
      body.visible = false
      body.bindMode = 'attached'
      body.bind(this.skeleton, new Matrix4())
      this.group.add(body)

      let outline: SkinnedMesh | null = null
      let outlineMaterial: OutlineMaterial | null = null
      if (tier <= OUTLINE_MAX_TIER) {
        outlineMaterial = createOutlineMaterial({ pixelWidth: 1.6, name: `sheep-outline/LOD${tier}` })
        outline = new SkinnedMesh(geometry, outlineMaterial)
        outline.name = `sheep/outline/LOD${tier}`
        outline.castShadow = false
        outline.receiveShadow = false
        outline.visible = false
        outline.bindMode = 'attached'
        // The hull shares the geometry *and the skeleton*, for the reason
        // `Character.ts` gives: one set of bone matrices means the outline
        // cannot drift out of register, because there is nothing to keep in sync.
        outline.bind(this.skeleton, new Matrix4())
        outline.renderOrder = -1
        this.group.add(outline)
      }
      this.tiers.push({ body, outline, material, outlineMaterial })
    }

    for (let i = 0; i < count; i++) {
      const grazer = makeGrazer(i, count, this.pasture)
      this.grazers.push(grazer)
      this.place(i, grazer)
    }

    if (import.meta.env.DEV) {
      console.debug(`[world] sheep flock: ${count} animals, 4 tiers in ${(performance.now() - startedAt).toFixed(1)} ms`)
    }
  }

  /**
   * Off stage.
   *
   * The cast is parked at `PARKED_Y` — 400 m underground — because a `Combatant`
   * is a *record the chapter reads*: `travel` beats test its position every frame
   * and `engagedFoes` counts it, so it has to go on existing somewhere legal.
   *
   * Nothing reads a sheep. So the cheap answer is the right one: hide the subtree
   * and stop stepping it. Three culls it before the frustum test, the profiler's
   * `traverseVisible` bills it zero, and the wander stops advancing — which is
   * also the correct behaviour rather than merely the cheap one. A flock that had
   * kept walking through twenty minutes of Arlaan would come back to the island
   * having drifted, en masse, into whichever fence its last target lay behind.
   */
  setActive(active: boolean): void {
    if (this.active === active) {
      return
    }
    this.active = active
    this.group.visible = active
  }

  get isActive(): boolean {
    return this.active
  }

  /**
   * One frame of the whole flock.
   *
   * Allocation-free: the grazers are mutated in place, `pasture` is a held
   * struct, the tier array is fixed-length and `coverage` is a field.
   */
  update(dt: number, cameraPosition: Vector3, playerX: number, playerZ: number, hasPlayer: boolean): void {
    if (!this.active) {
      return
    }
    this.elapsed += dt

    this.pasture.collision = this.collision
    this.pasture.playerX = playerX
    this.pasture.playerZ = playerZ
    this.pasture.hasPlayer = hasPlayer

    for (let i = 0; i < this.grazers.length; i++) {
      stepGrazer(this.grazers[i]!, dt, this.pasture)
    }
    separate(this.grazers, this.pasture)
    for (let i = 0; i < this.grazers.length; i++) {
      const grazer = this.grazers[i]!
      this.place(i, grazer)
      this.pose(i, grazer, dt)
    }

    this.updateLod(cameraPosition)
  }

  /**
   * Where one animal's mouth is, in world space.
   *
   * The measurement the whole feature reduces to: with the head up it sits 0.71 m
   * over the turf and while grazing it is on it. `tests/world/sheep.test.ts`
   * asserts both ends and the travel between them, which is the only way that
   * claim survives somebody retuning `NECK_GRAZE` on its own.
   */
  muzzleAt(index: number, out: Vector3): Vector3 {
    const head = this.bones[index]![HEAD]!
    head.updateWorldMatrix(true, false)
    return out.copy(MUZZLE_FROM_HEAD).applyMatrix4(head.matrixWorld)
  }

  /** Mount to ground. The bind pose has the hooves at y = 0, so this is the feet. */
  private place(index: number, g: Grazer): void {
    const mount = this.mounts[index]!
    mount.position.set(g.x, this.groundAt(g.x, g.z), g.z)
    mount.rotation.y = g.facing
  }

  /**
   * The graze, the look and the walk, on one animal's eight bones.
   *
   * ── Why the gait phase is distance and the head is a clock ────────────────
   *
   * They are different kinds of motion and want different drivers. A gait keyed
   * to time slides its feet the instant the speed changes — `TrollBoar` records
   * the same rule — so the legs read off `travelled`. The head is not touching
   * anything, so a clock is exactly right for it, and a clock is what lets a
   * *standing* animal keep cropping.
   */
  private pose(index: number, g: Grazer, dt: number): void {
    const bones = this.bones[index]!
    const t = this.elapsed + g.phase

    // Eased here rather than in `grazing.ts`, which keeps a linear ramp a test
    // can reason about. Smoothstep is what makes the head *settle* into the
    // grass instead of arriving at walking pace and stopping dead.
    const down = g.graze * g.graze * (3 - 2 * g.graze)
    const wantAlert = g.state === 'alert' ? 1 : 0
    const alertStep = dt * 1.6
    const wasAlert = this.alert[index]!
    this.alert[index] = wantAlert > wasAlert ? Math.min(1, wasAlert + alertStep) : Math.max(0, wasAlert - alertStep)
    const alert = this.alert[index]!

    // ── The legs ───────────────────────────────────────────────────────────
    const moving = Math.min(1, g.speed / 0.36)
    const cycle = (g.travelled / STRIDE) * TAU + g.phase
    const swing = LEG_SWING * moving
    // Diagonals paired — left fore with right hind — which is what a quadruped
    // does at a walk and at a trot alike.
    bones[FORE_L]!.rotation.x = Math.sin(cycle) * swing
    bones[FORE_R]!.rotation.x = Math.sin(cycle + Math.PI) * swing
    bones[HIND_L]!.rotation.x = Math.sin(cycle + Math.PI) * swing * 0.9
    bones[HIND_R]!.rotation.x = Math.sin(cycle) * swing * 0.9

    // ── The barrel ─────────────────────────────────────────────────────────
    //
    // Two degrees of pitch on each beat, and three and a half more when the head
    // goes down — a grazing sheep leans into the ground rather than folding at
    // the neck alone. Both are small and both are the difference between an
    // animal and a sliding prop.
    const bob = Math.sin(cycle * 2) * 0.04 * moving
    bones[CHEST]!.rotation.x = 0.012 + bob + down * 0.06
    bones[HIPS]!.position.y = SHEEP_BIND[HIPS]!.head[1] + Math.abs(Math.sin(cycle)) * 0.018 * moving

    // ── The neck and the head ──────────────────────────────────────────────
    const neckIdle = NECK_IDLE + (NECK_ALERT - NECK_IDLE) * alert
    const headIdle = HEAD_IDLE + (HEAD_ALERT - HEAD_IDLE) * alert
    // The slow sweep across a patch while eating: the head works sideways, not
    // the body. 11°, at a third of a hertz.
    const sweepY = Math.sin(t * 0.55) * 0.2 * down
    bones[NECK]!.rotation.set(neckIdle + down * (NECK_GRAZE - neckIdle), sweepY, Math.sin(t * 0.37) * 0.05 * down)
    // The bite. `down²` so it only starts once the muzzle is actually in the
    // grass — a nod that begins on the way down reads as a stumble.
    const crop = Math.sin(t * CROP_HZ * TAU) * CROP_NOD * down * down
    // And the look-around, which is the other half of the beat the player reads:
    // head comes up, sweeps, then the animal moves on.
    const lookY = Math.sin(t * 0.9) * 0.42 * alert
    bones[HEAD]!.rotation.set(headIdle + down * (HEAD_GRAZE - headIdle) + crop, lookY, 0)
  }

  /**
   * Picks the rungs this distance needs and sets each one's dither coverage.
   *
   * Distance is to the **nearest** animal, not to the flock's centre. Over an
   * 18 m paddock the two differ by 9 m, which straddles LOD0's 18 m boundary —
   * and the failure directions are not symmetric: over-detailing a 500-triangle
   * model at 30 m costs nothing anybody can measure, while under-detailing the
   * one standing next to the player is visible immediately.
   */
  private updateLod(cameraPosition: Vector3): void {
    let nearest = Number.POSITIVE_INFINITY
    for (const mount of this.mounts) {
      mount.getWorldPosition(_lodPosition)
      const distance = _lodPosition.distanceToSquared(cameraPosition)
      if (distance < nearest) {
        nearest = distance
      }
    }
    const distance = Math.sqrt(nearest)

    if (distance > this.cullDistance) {
      for (const tier of this.tiers) {
        tier.body.visible = false
        if (tier.outline) {
          tier.outline.visible = false
        }
      }
      this.lodTier = -1
      return
    }

    coverageAt(distance, 1, this.coverage)
    let dominant = 0
    let strongest = 0
    for (let tier = 0; tier < TIER_COUNT; tier++) {
      const strength = Math.abs(this.coverage[tier]!)
      if (strength > strongest) {
        strongest = strength
        dominant = tier
      }
    }
    this.lodTier = dominant

    for (let tier = 0; tier < TIER_COUNT; tier++) {
      const coverage = this.coverage[tier]!
      const built = this.tiers[tier]!
      const wanted = Math.abs(coverage) > COVERAGE_EPSILON
      built.body.visible = wanted
      if (built.outline) {
        built.outline.visible = wanted
      }
      if (!wanted) {
        continue
      }
      built.material.setFade(coverage)
      built.outlineMaterial?.setFade(coverage)
      // Only the dominant rung casts, so a crossfade cannot double-darken the
      // shadow map — the rule `DitheredLod` applies to props (GDD §4.3).
      built.body.castShadow = tier <= OUTLINE_MAX_TIER && Math.abs(coverage) >= 0.5
    }
  }

  dispose(): void {
    for (const tier of this.tiers) {
      tier.body.geometry.dispose()
      tier.material.dispose()
      tier.outlineMaterial?.dispose()
    }
    this.skeleton.dispose()
    this.group.clear()
  }
}

/** Re-exported so a probe can measure the ladder without constructing a flock. */
export const sheepBudgets = SHEEP_TIERS.map(t => t.budget)
export { SHEEP_BIND, BONE_COUNT as SHEEP_BONE_COUNT }
