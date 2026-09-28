import {
  Bone,
  type BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Object3D,
  Skeleton,
  SkinnedMesh,
  Vector3
} from 'three'
import { C } from '../art/palette'
import { mergeParts } from '../assets/common'
import { assertTriBudget } from '../geometry/budget'
import { circleSection, paintPart, type Section, splineSection, sweep, type SweptPart } from '../geometry/sweep'
import { bakeVertexAO } from '../geometry/vertexAO'
import { applyVertexAO } from '../geometry/vertexColor'
import { createOutlineMaterial } from '../shading/outlineMaterial'
import { createToonMaterial } from '../shading/toonMaterial'
import type { BoneName } from '../characters/rig'

/**
 * ─── The Trollschwein ───────────────────────────────────────────────────────
 *
 * *"The roughly four-foot Trollschwein had bitten through the net in a raging
 * fury and fell to the ground … it was, as far as I remember, four feet tall and
 * a good eight feet long."*
 *
 * Four feet tall and eight long is 1.22 m × 2.44 m. Against a 1.56 m chibi that
 * is an animal whose shoulder comes up past their waist and which is longer than
 * they are tall — and the numbers are kept, unscaled, because they are the whole
 * reason the opening of Chapter 1 works. Athalus does not climb a tree because he
 * is a coward; he climbs it because the thing chasing him outweighs him four to
 * one and he threw his bow away.
 *
 * ── Why it is skinned, and on its own seven-bone rig ────────────────────────
 *
 * The obvious build is a `Group` of rigid meshes — a body, a head, four legs —
 * rotated in place. It is rejected on the budget: GDD §5.2 caps the scene at 180
 * draw calls, the world spends 132 before anything moves, and a seven-part boar
 * with its mandatory outline hull (R6) is **fourteen draws** for one animal.
 *
 * A `SkinnedMesh` is two. So the parts are merged into one geometry and each
 * vertex is bound **rigidly to exactly one bone** — weight 1.0, no blending —
 * which is both correct for an animal made of hard segments and free: there is
 * no weight painting, no falloff to tune, and no joint that can pinch. The rig
 * is the deformation of a *puppet*, and a boar at this stylisation is a puppet.
 *
 * ── The bone names are the humanoid ones, deliberately ──────────────────────
 *
 * `hips`, `chest`, `head`, `thigh.L/R`, `upperArm.L/R`. They are lies — the
 * "upper arms" are forelegs and the "chest" is a shoulder hump — and they buy
 * something concrete: `combat/Combatant.ts::applyClip` walks `BONE_NAMES` and
 * poses whatever it finds, so the boar's charge and gore clips live in
 * `movesets.ts` beside every human one, in the same format, evaluated by the same
 * function. One pose evaluator for the whole game.
 *
 * The cost is exactly this paragraph plus the comment on `BOAR_CHARGE`. The
 * alternative — a second bone vocabulary — is a second pose evaluator, a second
 * clip format and a second set of sign conventions to get backwards.
 */

const AXIS_X = new Vector3(1, 0, 0)
const AXIS_Y = new Vector3(0, 1, 0)
const AXIS_Z = new Vector3(0, 0, 1)

const _colour = new Color()

/** Nose at +Z, tail at −Z. Same facing convention as every character. */
const NOSE_Z = 1.24
const TAIL_Z = -1.2
/** Shoulder height. The hump is the tallest point on the animal. */
const SHOULDER_Y = 1.12

/**
 * The body's section: a barrel, flattened top and bottom, widest low.
 *
 * A boar is not a cylinder. Its ribcage is *deep* rather than round — taller than
 * it is wide, with a keel underneath — and that is the difference between an
 * animal that reads as a boar and one that reads as a bull. The lower control
 * points sit at 0.86 of the upper ones' spread, which is the keel.
 */
const BODY_SECTION: Section = splineSection([
  [1.0, 0.15],
  [0.94, 0.62],
  [0.5, 0.96],
  [0.0, 1.0],
  [-0.5, 0.96],
  [-0.94, 0.62],
  [-1.0, 0.15],
  [-0.9, -0.4],
  [-0.55, -0.86],
  [0.0, -0.98],
  [0.55, -0.86],
  [0.9, -0.4]
])

/** A leg: oval, with the flat toward the body. */
const LEG_SECTION: Section = splineSection([
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

/**
 * Bristle: coarse dark hair over a warmer hide, with a *ridge* down the spine.
 *
 * The ridge is what makes it a boar rather than a pig, and it is paint rather
 * than geometry for the usual reason (R1): a raised mane on the spine would be a
 * second swept part standing 4 cm proud, which is 60 triangles for something the
 * toon ramp already separates by two full bands.
 */
const hidePaint = (u: number, v: number, out: Color): void => {
  // `v` runs round the section; 0.25 is the spine (see `BODY_SECTION` — the
  // +b extreme), 0.75 the belly.
  const up = Math.cos((v - 0.25) * Math.PI * 2)
  out.copy(C.boarHide).lerp(C.boarBristle, 0.35 + 0.4 * Math.max(0, up))
  // The mane, along the top 12 % of the section, strongest over the shoulders.
  const ridge = Math.max(0, up) ** 8
  out.lerp(C.boarBristle, 0.75 * ridge * (0.45 + 0.55 * Math.max(0, 1 - Math.abs(u - 0.42) * 3)))
  // Belly, paler and warmer.
  out.lerp(C.boarSnout, 0.42 * Math.max(0, -up) ** 2)
  // Coarse hair, as a high-frequency band round the section. Cheap, and the one
  // thing that stops a 1200-triangle animal reading as moulded plastic.
  const hair = Math.abs(Math.cos(19 * Math.PI * v))
  out.lerp(C.boarBristle, 0.13 * hair)
}

interface BoarPart {
  part: SweptPart
  bone: BoneName
  deep: Color
  ao: number
}

/**
 * Bone heads in the boar's own bind pose, world space, feet at y = 0.
 *
 * Read alongside `rig.ts::BIND_POSE` — same idea, same convention, different
 * animal. The names are the humanoid ones; the positions are not.
 */
const BOAR_BIND: { name: BoneName; parent: BoneName | null; head: readonly [number, number, number] }[] = [
  { name: 'hips', parent: null, head: [0, 0.82, -0.55] },
  { name: 'chest', parent: 'hips', head: [0, 0.9, 0.28] },
  { name: 'head', parent: 'chest', head: [0, 0.86, 0.72] },
  // Forelegs, hanging off the chest. +X is the animal's left, matching the rig.
  { name: 'upperArm.L', parent: 'chest', head: [0.3, 0.72, 0.42] },
  { name: 'upperArm.R', parent: 'chest', head: [-0.3, 0.72, 0.42] },
  // Hind legs, off the hips.
  { name: 'thigh.L', parent: 'hips', head: [0.32, 0.7, -0.68] },
  { name: 'thigh.R', parent: 'hips', head: [-0.32, 0.7, -0.68] }
]

const buildBody = (): BoarPart => {
  const part = sweep({
    name: 'boar/body',
    // Along the animal, tail to nose. The rings cluster at the shoulder, where
    // the profile swells fastest.
    path: [
      [0, 0.86, TAIL_Z],
      [0, 0.9, TAIL_Z + 0.1],
      [0, 0.95, -0.72],
      [0, 1.0, -0.2],
      [0, SHOULDER_Y - 0.06, 0.3],
      [0, SHOULDER_Y - 0.02, 0.55],
      [0, 1.0, 0.78],
      [0, 0.94, 0.86]
    ],
    // Half-width, then half-height. A boar is 1.5 times as deep as it is wide,
    // and the widest point is the *hips*, not the shoulders — the hump is tall,
    // not broad, which is what makes the animal read as wedge-shaped from above.
    extentA: [0, 0.3, 0.4, 0.42, 0.38, 0.3, 0.18, 0],
    extentB: [0, 0.28, 0.4, 0.5, 0.56, 0.48, 0.3, 0],
    axisA: AXIS_X,
    axisB: AXIS_Y,
    section: BODY_SECTION,
    stations: 9,
    // Twelve: enough to resolve the keel and the spine ridge, which are the two
    // features of the section that carry the species.
    segments: 12,
    // Puts a vertex exactly on the spine and on the keel. Same argument as the
    // sword's blade: an unsampled feature delivers a third of its depth.
    vOffset: 0.25
  })
  paintPart(part, hidePaint, _colour)
  // The body spans the whole animal and is bound to `chest`, which is the bone
  // the charge's rear-up rotates. Binding it to `hips` instead would pivot the
  // whole barrel about the hindquarters and the animal would look like it was
  // sitting down.
  return { part, bone: 'chest', deep: C.boarBristle, ao: 0.55 }
}

/** The head: a wedge from the shoulders to the snout, with the jaw underneath. */
const buildHead = (): BoarPart => {
  const part = sweep({
    name: 'boar/head',
    path: [
      [0, 0.98, 0.6],
      [0, 0.96, 0.68],
      [0, 0.9, 0.84],
      [0, 0.82, 1.02],
      [0, 0.76, NOSE_Z - 0.06],
      [0, 0.74, NOSE_Z]
    ],
    extentA: [0, 0.26, 0.22, 0.15, 0.1, 0],
    extentB: [0, 0.3, 0.25, 0.17, 0.11, 0],
    axisA: AXIS_X,
    axisB: AXIS_Y,
    section: BODY_SECTION,
    stations: 6,
    segments: 10,
    vOffset: 0.25
  })
  paintPart(
    part,
    (u, v, out) => {
      hidePaint(u * 0.4, v, out)
      // The snout: bare skin, paler, over the last fifth.
      out.lerp(C.boarSnout, 0.75 * Math.max(0, (u - 0.72) / 0.28))
      // The eye. A dark patch either side at the base of the wedge — two
      // triangles' worth of paint that does the entire job of a face.
      const side = Math.abs(Math.abs(((v + 0.25) % 1) - 0.5) - 0.25)
      const eye = Math.max(0, 1 - Math.abs(u - 0.34) * 14) * Math.max(0, 1 - side * 16)
      out.lerp(C.eyeDark, 0.9 * eye)
    },
    _colour
  )
  return { part, bone: 'head', deep: C.boarBristle, ao: 0.7 }
}

/**
 * The tusks: four of them, two up from the lower jaw and two down from the
 * upper.
 *
 * They are the single most identifiable feature of the animal and they cost 96
 * triangles, which is 8 % of the budget for the thing the player is trying not
 * to be hit by. The lower pair curve *up and out*; the upper pair are shorter
 * and curve down — that opposition is what a real boar has and what makes the
 * head read as armed rather than as decorated.
 */
const buildTusks = (): BoarPart[] => {
  const parts: BoarPart[] = []
  for (const side of [-1, 1]) {
    parts.push({
      part: paintPart(
        sweep({
          name: `boar/tusk-lower-${side}`,
          path: [
            [side * 0.1, 0.7, 1.1],
            [side * 0.11, 0.72, 1.16],
            [side * 0.14, 0.8, 1.28],
            [side * 0.16, 0.92, 1.34],
            [side * 0.15, 1.02, 1.28],
            [side * 0.145, 1.06, 1.24]
          ],
          extentA: [0, 0.028, 0.024, 0.016, 0.008, 0],
          extentB: [0, 0.028, 0.024, 0.016, 0.008, 0],
          axisA: AXIS_X,
          axisB: AXIS_Z,
          section: circleSection,
          stations: 6,
          segments: 6
        }),
        (u, _v, out) => {
          out.copy(C.boneBase).lerp(C.boneLit, 0.3 + 0.5 * u)
          // Stained at the root, where it comes out of the jaw.
          out.lerp(C.boneShadow, 0.6 * Math.max(0, 1 - u * 4))
        },
        _colour
      ),
      bone: 'head',
      deep: C.boneShadow,
      ao: 0.5
    })
    parts.push({
      part: paintPart(
        sweep({
          name: `boar/tusk-upper-${side}`,
          path: [
            [side * 0.12, 0.84, 1.06],
            [side * 0.125, 0.82, 1.11],
            [side * 0.135, 0.76, 1.19],
            [side * 0.14, 0.7, 1.24],
            [side * 0.138, 0.67, 1.22]
          ],
          extentA: [0, 0.02, 0.016, 0.008, 0],
          extentB: [0, 0.02, 0.016, 0.008, 0],
          axisA: AXIS_X,
          axisB: AXIS_Z,
          section: circleSection,
          stations: 5,
          segments: 5
        }),
        (u, _v, out) => {
          out.copy(C.boneBase).lerp(C.boneLit, 0.25 + 0.45 * u)
          out.lerp(C.boneShadow, 0.5 * Math.max(0, 1 - u * 4))
        },
        _colour
      ),
      bone: 'head',
      deep: C.boneShadow,
      ao: 0.5
    })
  }
  return parts
}

/** An ear: a small flat leaf standing off the side of the skull. */
const buildEars = (): BoarPart[] =>
  [-1, 1].map(side => ({
    part: paintPart(
      sweep({
        name: `boar/ear-${side}`,
        path: [
          [side * 0.16, 1.0, 0.66],
          [side * 0.19, 1.04, 0.64],
          [side * 0.26, 1.16, 0.58],
          [side * 0.3, 1.26, 0.53],
          [side * 0.31, 1.3, 0.51]
        ],
        extentA: [0, 0.02, 0.024, 0.014, 0],
        extentB: [0, 0.06, 0.075, 0.04, 0],
        axisA: AXIS_Z,
        axisB: AXIS_X,
        section: LEG_SECTION,
        stations: 5,
        segments: 5
      }),
      (u, _v, out) => {
        out.copy(C.boarBristle).lerp(C.boarHide, 0.3 + 0.3 * u)
      },
      _colour
    ),
    bone: 'head' as BoneName,
    deep: C.boarBristle,
    ao: 0.6
  }))

/**
 * A leg. Four of them, and the hind pair are longer and set further back.
 *
 * The hoof is built into the profile rather than added as a part — the same
 * argument `limb.ts` makes for a character's hands and `sword.ts` for its
 * pommel: one surface, one normal rule, no seam to bevel.
 */
const buildLeg = (side: number, hind: boolean): BoarPart => {
  const z = hind ? -0.68 : 0.42
  const top = hind ? 0.7 : 0.72
  const x = side * (hind ? 0.32 : 0.3)
  const part = sweep({
    name: `boar/leg-${hind ? 'hind' : 'fore'}-${side}`,
    path: [
      [x, top, z],
      [x, top - 0.06, z],
      [x * 1.02, top - 0.26, z + (hind ? 0.06 : -0.03)],
      [x * 1.05, top - 0.48, z + (hind ? -0.02 : 0.02)],
      [x * 1.05, 0.1, z],
      [x * 1.05, 0.03, z],
      [x * 1.05, 0, z]
    ],
    // Thick at the top, ankle-thin, then the hoof flares again. That double
    // pinch is a hoofed leg's whole silhouette.
    extentA: [0, 0.15, 0.13, 0.085, 0.055, 0.075, 0],
    extentB: [0, 0.17, 0.15, 0.09, 0.06, 0.085, 0],
    axisA: AXIS_X,
    axisB: AXIS_Z,
    section: LEG_SECTION,
    stations: 7,
    segments: 6
  })
  paintPart(
    part,
    (u, v, out) => {
      hidePaint(0.6, v, out)
      out.lerp(C.boarBristle, 0.35 * u)
      // The hoof: bone, hard-edged, over the bottom 8 %.
      out.lerp(C.boneShadow, 0.9 * Math.max(0, (u - 0.9) / 0.1))
    },
    _colour
  )
  return {
    part,
    bone: (hind ? (side > 0 ? 'thigh.L' : 'thigh.R') : side > 0 ? 'upperArm.L' : 'upperArm.R') as BoneName,
    deep: C.boarBristle,
    ao: 0.75
  }
}

/** The tail: a short tuft. Bound to the hips so it swings with the rump. */
const buildTail = (): BoarPart => ({
  part: paintPart(
    sweep({
      name: 'boar/tail',
      path: [
        [0, 1.0, TAIL_Z + 0.04],
        [0, 1.01, TAIL_Z - 0.02],
        [0, 0.98, TAIL_Z - 0.14],
        [0, 0.9, TAIL_Z - 0.2],
        [0, 0.85, TAIL_Z - 0.19]
      ],
      extentA: [0, 0.028, 0.022, 0.03, 0],
      extentB: [0, 0.028, 0.022, 0.03, 0],
      axisA: AXIS_X,
      axisB: AXIS_Z,
      section: circleSection,
      stations: 5,
      segments: 5
    }),
    (u, _v, out) => {
      out.copy(C.boarBristle).lerp(C.boarHide, 0.4 * (1 - u))
    },
    _colour
  ),
  bone: 'hips' as BoneName,
  deep: C.boarBristle,
  ao: 0.6
})

/**
 * Triangle budget.
 *
 * GDD §4.1 has a `(future) Monster` row at **900 / 420 / 180 / 40**. This is the
 * first thing to claim it, and it takes only the LOD0 number: unlike a world
 * prop, a creature in this chapter is never further away than the fight it is
 * part of, so a tier ladder for it would be four geometries of which three never
 * draw. `Character` makes the same call for the same reason (its tiers exist
 * because a *crowd* recedes; a boss does not).
 */
const BOAR_BUDGET = 1450

export interface TrollBoarOptions {
  perfTag?: string
}

/**
 * The animal.
 *
 * Structurally compatible with `Character` where the combat director cares —
 * `group`, `bones`, `setPosition`, `setFacing`, `update` — which is what lets
 * `CombatDirector` drive a boar and a bandit through the same code path without
 * knowing which is which.
 */
export class TrollBoar {
  readonly group = new Group()
  readonly bones = new Map<BoneName, Bone>()

  private readonly mesh: SkinnedMesh
  private readonly hull: SkinnedMesh
  private readonly skeleton: Skeleton
  private readonly root: Bone
  private elapsed = 0
  private lastX = 0
  private lastZ = 0
  private speed = 0
  /** Gait phase, 0..1. Advanced by distance travelled, never by time. */
  private phase = 0

  constructor(options: TrollBoarOptions = {}) {
    this.group.name = 'trollboar'
    this.group.userData.perfTag = options.perfTag ?? 'combat'

    // ── The rig ────────────────────────────────────────────────────────────
    const bones: Bone[] = []
    let root: Bone | null = null
    for (const definition of BOAR_BIND) {
      const bone = new Bone()
      bone.name = definition.name
      if (definition.parent === null) {
        bone.position.set(definition.head[0], definition.head[1], definition.head[2])
        root = bone
      } else {
        const parent = BOAR_BIND.find(b => b.name === definition.parent)!
        bone.position.set(
          definition.head[0] - parent.head[0],
          definition.head[1] - parent.head[1],
          definition.head[2] - parent.head[2]
        )
        this.bones.get(definition.parent)!.add(bone)
      }
      this.bones.set(definition.name, bone)
      bones.push(bone)
    }
    this.root = root!
    this.group.add(this.root)

    const inverses = BOAR_BIND.map(definition =>
      new Matrix4().makeTranslation(definition.head[0], definition.head[1], definition.head[2]).invert()
    )
    this.skeleton = new Skeleton(bones, inverses)

    // ── The mesh ───────────────────────────────────────────────────────────
    const parts: BoarPart[] = [
      buildBody(),
      buildHead(),
      ...buildTusks(),
      ...buildEars(),
      buildLeg(1, false),
      buildLeg(-1, false),
      buildLeg(1, true),
      buildLeg(-1, true),
      buildTail()
    ]

    const geometries = parts.map(p => p.part.geometry)
    // Rigid binding: every vertex of a part is weight 1.0 on that part's bone.
    // Written **before** the merge, per part, because after it there is no way
    // left to tell which vertex came from which sweep.
    for (const [i, entry] of parts.entries()) {
      const count = geometries[i]!.getAttribute('position').count
      const index = new Float32Array(count * 4)
      const weight = new Float32Array(count * 4)
      const boneIndex = BOAR_BIND.findIndex(b => b.name === entry.bone)
      for (let v = 0; v < count; v++) {
        index[v * 4] = boneIndex
        weight[v * 4] = 1
      }
      geometries[i]!.setAttribute('skinIndex', new Float32BufferAttribute(index, 4))
      geometries[i]!.setAttribute('skinWeight', new Float32BufferAttribute(weight, 4))
    }

    const merged = mergeParts(geometries, 'trollboar')
    let cursor = 0
    const ao = bakeVertexAO(merged, { samples: 12, maxDistance: 0.55, strength: 0.85, power: 1.2 })
    for (const [i, entry] of parts.entries()) {
      const count = geometries[i]!.getAttribute('position').count
      applyVertexAO(merged, ao, entry.deep, entry.ao, { start: cursor, count })
      cursor += count
    }
    merged.computeBoundingSphere()
    assertTriBudget(merged, BOAR_BUDGET, 'trollboar')

    const material = createToonMaterial({ name: 'trollboar' })
    this.mesh = new SkinnedMesh(merged, material)
    this.mesh.castShadow = true
    this.mesh.receiveShadow = false
    this.mesh.bindMode = 'attached'
    this.mesh.bind(this.skeleton, new Matrix4())
    this.group.add(this.mesh)

    // The hull shares the geometry *and the skeleton*, for the reason
    // `Character.ts` gives: one set of bone matrices means the outline cannot
    // drift out of register with the body, because there is nothing to keep in
    // sync.
    const outline = createOutlineMaterial({ pixelWidth: 1.6, name: 'trollboar-outline' })
    this.hull = new SkinnedMesh(merged, outline)
    this.hull.castShadow = false
    this.hull.receiveShadow = false
    this.hull.bindMode = 'attached'
    this.hull.bind(this.skeleton, new Matrix4())
    this.hull.renderOrder = -1
    this.group.add(this.hull)
  }

  setPosition(position: Vector3): void {
    this.group.position.copy(position)
  }

  setFacing(radians: number): void {
    this.group.rotation.y = radians
  }

  /**
   * The idle and the trot.
   *
   * A four-beat walk with the diagonals paired — left fore with right hind — at
   * a phase offset of a half cycle, which is what a real quadruped does at a
   * walk and at a trot alike. The head bobs against the stride rather than with
   * it, which is the detail that keeps it from looking like a rocking horse.
   *
   * **Phase advances on distance, not on time.** A gait driven by a clock slides
   * its feet whenever the speed changes, which on a boar that accelerates from a
   * trot into a 5.6 m/s charge is every second of the fight.
   */
  update(dt: number, _cameraPosition?: Vector3): void {
    this.elapsed += dt

    const x = this.group.position.x
    const z = this.group.position.z
    if (dt > 0) {
      const travelled = Math.hypot(x - this.lastX, z - this.lastZ)
      this.speed += (travelled / dt - this.speed) * Math.min(1, dt * 8)
      // 1.35 m per stride, which is a little over half the animal's length.
      this.phase = (this.phase + travelled / 1.35) % 1
    }
    this.lastX = x
    this.lastZ = z

    const moving = Math.min(1, this.speed / 2.4)
    const swing = 0.62 * moving
    const cycle = this.phase * Math.PI * 2

    const set = (name: BoneName, rx: number, ry = 0, rz = 0): void => {
      const bone = this.bones.get(name)
      if (bone) {
        bone.rotation.set(rx, ry, rz)
      }
    }

    set('upperArm.L', Math.sin(cycle) * swing)
    set('upperArm.R', Math.sin(cycle + Math.PI) * swing)
    set('thigh.L', Math.sin(cycle + Math.PI) * swing * 0.9)
    set('thigh.R', Math.sin(cycle) * swing * 0.9)

    // The body pitches a little on each beat and the head counters it. Both are
    // tiny — 3° and 4° — and both are the difference between an animal and a
    // sliding prop.
    const bob = Math.sin(cycle * 2) * 0.05 * moving
    set('chest', 0.02 + bob)
    set('head', 0.04 - bob * 1.3 + Math.sin(this.elapsed * 1.7) * 0.03 * (1 - moving))

    const hips = this.bones.get('hips')
    if (hips) {
      hips.position.y = BOAR_BIND[0]!.head[1] + Math.abs(Math.sin(cycle)) * 0.035 * moving
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as { dispose(): void }).dispose()
    ;(this.hull.material as { dispose(): void }).dispose()
    this.skeleton.dispose()
    this.group.clear()
  }
}

/** Re-exported so a probe can measure the model without constructing a scene. */
export const boarBudget = BOAR_BUDGET
export type { Object3D, BufferGeometry }
