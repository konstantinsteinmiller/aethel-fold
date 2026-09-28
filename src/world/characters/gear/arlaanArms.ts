import { Color, Vector3 } from 'three'
import { C } from '../../art/palette'
import { EQUIPMENT_BUDGET } from '../equipment'
import { buildCruciform, type CruciformSpec } from './sword'
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
 * ─── The arms of Chapter 1 ──────────────────────────────────────────────────
 *
 * Six weapons, one per named character, and the brief they answer is not "make
 * more swords". It is: *four teenagers walk home from a hunt carrying a dead
 * boar between them, and the player has to be able to tell which one is which
 * from behind, at fifteen metres, while all four are moving.*
 *
 * `equipment.ts` measures what actually survives that distance — the face is
 * gone by 20 m, the hair by 40 — so the answer cannot be facial detail or dye.
 * It has to be **outline**, and a weapon is the largest piece of outline a chibi
 * figure carries that is not its own body. So each of the four gets a weapon
 * whose silhouette is a different *kind of shape*:
 *
 *   | who     | weapon      | the shape it adds to the outline          |
 *   |---------|-------------|-------------------------------------------|
 *   | Athalus | dagger      | almost nothing — and that is the point      |
 *   | Jester  | scrantis    | a segmented **chain** with gaps in it       |
 *   | Gearn   | war axe     | a **disc** above the shoulder               |
 *   | Kareen  | hunting bow | a tall **arc** down the spine               |
 *   | Theodor | broadsword  | a broad straight bar plus a shield **disc** |
 *
 * A chain, a disc, an arc, a bar. No two of those can be confused at any
 * distance, and none of them needs a single triangle spent on decoration.
 *
 * ── Athalus carries the least, deliberately ─────────────────────────────────
 *
 * He is the protagonist and he has the plainest kit in the group, because that
 * is the chapter's own setup: he is up a tree with a boar under him precisely
 * *because* he dropped his bow and his knife running, and the narration is
 * explicit that he is good with a sword and did not have one with him. Giving
 * him something impressive to carry in Chapter 1 would undercut the only thing
 * the chapter is about.
 *
 * ── The frame, unchanged ────────────────────────────────────────────────────
 *
 * Everything in `gear/index.ts`'s convention holds: grip at the origin, length
 * down **−Y**, front on **+Z**, broad axis on **±Z** for anything that hangs
 * from the Z-canted hip and back sockets. The scrantis is the one model that
 * bends the last clause and it says why where it does it.
 */

const AXIS_X = new Vector3(1, 0, 0)
const AXIS_Y = new Vector3(0, 1, 0)
const AXIS_Z = new Vector3(0, 0, 1)

const _color = new Color()
const _dir = new Vector3()
const _perp = new Vector3()

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t)
const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-6))
  return t * t * (3 - 2 * t)
}

// ════════════════════════════════════════════════════════════════════════════
// Jester's scrantis
// ════════════════════════════════════════════════════════════════════════════

/**
 * ─── The scrantis ───────────────────────────────────────────────────────────
 *
 * Chapter 1 defines it, and the definition is unusually precise for a fantasy
 * weapon: *"a weapon made of several blades, held together by hinges … the
 * individual sabre leaves would wrap around the target and worked much like a
 * whip, except that the leaves were sharp."* Jester carries **two six-leaved
 * folded scrantis of steel on his belt**, and learned it from a travelling
 * showman — it is a performer's tool before it is a weapon, which is why he
 * trained on a wooden one for two years first.
 *
 * ── Why it is modelled hanging, not folded and not extended ─────────────────
 *
 * The weapon has three states and only one of them can be a rigid mesh.
 *
 *   * **Folded** is a baton. It is what lives on the belt, and it is a separate
 *     item (`scrantisPair`) for exactly that reason.
 *   * **Thrown** is a whip mid-crack. It is a different shape every frame and
 *     cannot be geometry at all — it would need a simulated chain and a
 *     per-frame rebuild, which is the one thing `gear/` never does.
 *   * **Hanging** — the chain paid out of the fist, curving down and curling
 *     back at the tip under its own weight — is what the weapon looks like in
 *     every frame between cracks, which is almost every frame it is on screen.
 *
 * So the model is the hanging state, and it is what makes the silhouette work:
 * a **segmented** curve with visible daylight between the leaves. Collapse the
 * gaps and it is a sabre, which is the one thing it must never read as.
 *
 * ── The one place it leaves the folder's convention ─────────────────────────
 *
 * `index.ts` clause 4 puts the broad axis of a hip-hung item on ±Z so it stays
 * in the socket's cant plane. The scrantis cannot: its chain *curves*, and the
 * blade widths have to stay perpendicular to a tangent that rotates 60° from
 * grip to tip. Each leaf therefore derives its own width axis from its own
 * chord (the same construction `assets/structure.ts::beam` uses), and the
 * chain's **plane** is the Y–Z plane so the assembly as a whole still satisfies
 * clause 4. Thickness is on ±X throughout, which is 12 mm — narrow enough that
 * the cant cannot drive it into the thigh.
 */

/** Six leaves, as the book says. */
const SCRANTIS_LEAVES = 6

/**
 * The chain's centre line, `[x, y, z]`, from the fist to the tip.
 *
 * A lazy S: it falls, kicks forward at the third leaf, and the last two curl
 * back under. Curling *back* rather than continuing forward is what reads as
 * weight — a chain that keeps going one way reads as a stiff rod bent once.
 */
const SCRANTIS_CURVE: readonly (readonly [number, number, number])[] = [
  [0, -0.035, 0.012],
  [0, -0.13, 0.05],
  [0, -0.245, 0.082],
  [0, -0.36, 0.072],
  [0, -0.46, 0.018],
  [0, -0.535, -0.062],
  [0, -0.57, -0.155]
]

/**
 * A sabre leaf's section: sharp on +b, thick and rounded on −b.
 *
 * Asymmetric on purpose. A lens section (which `sword.ts` uses) is a
 * double-edged blade; a sabre leaf has one edge and a spine, and the spine is
 * what catches the light along the outside of the curve. Read at a metre from
 * the lens that difference is the whole reason a scrantis leaf does not look
 * like six small swords.
 */
const LEAF_SECTION = splineSection([
  [0.0, 1.0],
  [0.62, 0.52],
  [0.9, 0.0],
  [0.98, -0.42],
  [0.55, -0.86],
  [0.0, -1.0],
  [-0.55, -0.86],
  [-0.98, -0.42],
  [-0.9, 0.0],
  [-0.62, 0.52]
])

/** Samples the chain's centre line. Three scalar splines, as `sweep` does. */
const curveAt = (t: number, out: Vector3): Vector3 =>
  out.set(
    splineAt(
      SCRANTIS_CURVE.map(p => p[0]),
      t
    ),
    splineAt(
      SCRANTIS_CURVE.map(p => p[1]),
      t
    ),
    splineAt(
      SCRANTIS_CURVE.map(p => p[2]),
      t
    )
  )

const _a = new Vector3()
const _b = new Vector3()

/**
 * One leaf, occupying `[from, to]` of the chain parameter.
 *
 * The leaf's own width axis comes from its chord, not from the world, and the
 * leaves **taper along the chain** — 26 mm at the first, 17 mm at the last. A
 * chain of equal leaves reads as a bicycle chain; a taper reads as a weapon
 * that was designed to be thrown, because the far end is the end that has to
 * accelerate.
 */
const buildLeaf = (index: number, seed: number): SweptPart => {
  const span = 1 / SCRANTIS_LEAVES
  // A gap of 14 % of a leaf at each end. That is the hinge's own length, and it
  // is the number the whole silhouette turns on: at 6 % the chain reads solid,
  // at 25 % it reads as beads on a string.
  const from = index * span + span * 0.14
  const to = (index + 1) * span - span * 0.14

  curveAt(from, _a)
  curveAt(to, _b)
  _dir.subVectors(_b, _a).normalize()
  // Perpendicular to the chord, inside the chain's own Y–Z plane. `AXIS_X` is
  // the plane's normal, so this is exact rather than approximate.
  _perp.crossVectors(AXIS_X, _dir).normalize()

  const stations = 6
  const path: [number, number, number][] = []
  for (let i = 0; i < stations; i++) {
    curveAt(from + (to - from) * (i / (stations - 1)), _a)
    path.push([_a.x, _a.y, _a.z])
  }

  // Width across the leaf, and half-thickness through it.
  const scale = 1 - index * 0.085
  const width = 0.026 * scale
  const thick = 0.0032 * scale

  const part = sweep({
    name: `gear/scrantis/leaf${index}`,
    path,
    // A is thickness (±X), B is width (the in-plane perpendicular). Both taper
    // to zero at the ends so each leaf is capped and bevelled — GDD R2, and the
    // reason a leaf reads as a *blade* rather than as a length of tube.
    extentA: [0, thick * 0.8, thick, thick, thick * 0.8, 0],
    extentB: [0, width * 0.72, width, width * 0.96, width * 0.72, 0],
    axisA: AXIS_X,
    axisB: _perp.clone(),
    section: LEAF_SECTION,
    stations,
    segments: 6,
    // Puts a vertex on the edge and on the spine. Same argument as the sword's
    // 8-sample blade: a section's features have to be sampled or they deliver a
    // third of their authored depth.
    vOffset: 0.25
  })

  return paintPart(
    part,
    (u, v, out) => {
      // The edge sits at v ≈ 0 and the spine at v ≈ 0.5 (see `LEAF_SECTION`).
      const edge = Math.abs(Math.cos(Math.PI * v))
      out.copy(C.steelBase).lerp(C.steelLit, 0.22 + 0.5 * edge)
      // Each leaf darkens toward its hinge ends, where a hand and a pin both
      // shade it and where AO alone cannot reach — the gap is only 3 mm.
      out.lerp(C.steelShadow, 0.35 * (1 - smoothstep(0.1, 0.3, u)) + 0.3 * smoothstep(0.72, 0.94, u))
      // A faint temper line down the middle of the flat. Free, and it is what
      // stops six identical steel leaves reading as plastic.
      out.lerp(C.brassBase, 0.1 * smoothstep(0.35, 0.5, v) * smoothstep(0.65, 0.5, v))
      // Deterministic per-leaf variation, so the chain is not one leaf six times.
      out.lerp(C.steelShadow, 0.06 * (((index * 7 + seed) % 5) / 5))
    },
    _color
  )
}

/** The hinge pin between two leaves: a short brass barrel across the chain. */
const buildHinge = (index: number): SweptPart => {
  const span = 1 / SCRANTIS_LEAVES
  const at = (index + 1) * span
  curveAt(at, _a)
  const scale = 1 - index * 0.085
  const half = 0.0125 * scale

  const part = sweep({
    name: `gear/scrantis/hinge${index}`,
    // Across the chain, on ±X — a pin runs through the leaves, so its axis is
    // the one direction neither leaf occupies.
    path: [
      [_a.x - half * 1.5, _a.y, _a.z],
      [_a.x - half, _a.y, _a.z],
      [_a.x + half, _a.y, _a.z],
      [_a.x + half * 1.5, _a.y, _a.z]
    ],
    extentA: [0, half * 0.9, half * 0.9, 0],
    extentB: [0, half * 0.9, half * 0.9, 0],
    axisA: AXIS_Y,
    axisB: AXIS_Z,
    section: circleSection,
    stations: 4,
    segments: 6
  })

  return paintPart(
    part,
    (_u, v, out) => {
      const up = 0.5 + 0.5 * Math.sin(v * Math.PI * 2)
      out.copy(C.brassBase).lerp(C.brassLit, 0.25 + 0.4 * up)
      out.lerp(C.leatherShadow, 0.35 * (1 - up))
    },
    _color
  )
}

/** The grip: a short leather-bound handle with a brass ferrule at the chain end. */
const buildScrantisGrip = (): SweptPart => {
  const part = sweep({
    name: 'gear/scrantis/grip',
    path: [
      [0, 0.098, 0],
      [0, 0.09, 0],
      [0, 0.06, 0],
      [0, 0.01, 0.004],
      [0, -0.02, 0.008],
      [0, -0.038, 0.012],
      [0, -0.046, 0.013]
    ],
    extentA: [0, 0.019, 0.017, 0.0155, 0.017, 0.019, 0],
    extentB: [0, 0.019, 0.017, 0.0155, 0.017, 0.019, 0],
    axisA: AXIS_X,
    axisB: AXIS_Z,
    section: circleSection,
    stations: 7,
    segments: 6
  })

  return paintPart(
    part,
    (u, v, out) => {
      const round = 0.5 + 0.5 * Math.sin(v * Math.PI * 2)
      out.copy(C.leatherBase).lerp(C.leatherLit, 0.25 + 0.35 * round)
      out.lerp(C.leatherShadow, 0.4 * (1 - round))
      // Ferrules at both ends, brass, matching the hinge pins so the whole
      // weapon reads as one piece of ironmongery rather than as a chain
      // borrowed from something else.
      const ferrule = smoothstep(0.14, 0.05, u) + smoothstep(0.82, 0.94, u)
      out.lerp(C.brassBase, clamp01(ferrule) * 0.9)
      out.lerp(C.brassLit, clamp01(ferrule) * 0.3 * round)
    },
    _color
  )
}

export const buildScrantis = (options: { seed?: number } = {}): GearModel => {
  const seed = options.seed ?? 1
  const parts: SweptPart[] = [buildScrantisGrip()]
  const deep: Color[] = [C.leatherShadow]
  const ao: number[] = [0.7]

  for (let i = 0; i < SCRANTIS_LEAVES; i++) {
    parts.push(buildLeaf(i, seed))
    deep.push(C.steelShadow)
    // Weak: a leaf is a thin flat field and strong AO on one turns it mottled,
    // which is `sword.ts`'s measurement applied to a smaller blade.
    ao.push(0.3)
  }
  for (let i = 0; i < SCRANTIS_LEAVES - 1; i++) {
    parts.push(buildHinge(i))
    deep.push(C.leatherShadow)
    ao.push(0.8)
  }

  return finishGear({
    name: 'gear/scrantis',
    budget: EQUIPMENT_BUDGET.scrantis,
    parts,
    deep,
    aoAmount: ao,
    seed,
    // Half the usual, for the reason `sword.ts` gives: steel takes the ramp's
    // top band along a whole leaf at once and albedo noise reads as dirt.
    jitter: 0.02
  })
}

/**
 * ─── The pair on the belt ───────────────────────────────────────────────────
 *
 * Two folded scrantis, which is what Jester actually wears — the third is the
 * one in his hand. Folded, the six leaves stack into a short flat baton with the
 * hinge pins showing down one side, and that stack is painted rather than
 * modelled: six 3 mm leaves face-to-face is a 20 mm block whose *internal* seams
 * are three pixels apart at any distance a belt is seen from, and R1 is explicit
 * that interior detail is colour.
 */
export const buildScrantisPair = (options: { seed?: number } = {}): GearModel => {
  const seed = options.seed ?? 1
  const parts: SweptPart[] = []
  const deep: Color[] = []

  for (const side of [-1, 1]) {
    const x = side * 0.026
    const part = sweep({
      name: `gear/scrantisPair/${side}`,
      path: [
        [x, 0.03, 0],
        [x, 0.018, 0],
        [x, -0.01, 0.002],
        [x, -0.085, 0.006],
        [x, -0.16, 0.01],
        [x, -0.188, 0.012],
        [x, -0.2, 0.013]
      ],
      extentA: [0, 0.0105, 0.0115, 0.012, 0.0115, 0.0105, 0],
      extentB: [0, 0.022, 0.024, 0.0245, 0.024, 0.022, 0],
      axisA: AXIS_X,
      axisB: AXIS_Z,
      section: splineSection([
        [1, 0.5],
        [1, 1],
        [-1, 1],
        [-1, 0.5],
        [-1, -0.5],
        [-1, -1],
        [1, -1],
        [1, -0.5]
      ]),
      stations: 7,
      segments: 6
    })

    parts.push(
      paintPart(
        part,
        (u, v, out) => {
          // The stack of six leaves, as bands across the flat.
          const stack = Math.abs(Math.cos(6 * Math.PI * v))
          out.copy(C.steelBase).lerp(C.steelLit, 0.2 + 0.4 * stack)
          out.lerp(C.steelShadow, 0.5 * (1 - stack ** 3))
          // The hinge pins run down one edge — a brass line, which is the detail
          // that says "this folds" rather than "this is a bar of steel".
          const pinEdge = smoothstep(0.14, 0.02, Math.abs(((v + 0.75) % 1) - 0.75))
          out.lerp(C.brassBase, pinEdge * 0.8 * (0.4 + 0.6 * Math.abs(Math.cos(6 * Math.PI * u))))
          // A leather retaining strap across the middle.
          out.lerp(C.leatherBase, 0.85 * smoothstep(0.1, 0.04, Math.abs(u - 0.5)))
        },
        _color
      )
    )
    deep.push(C.steelShadow)
  }

  return finishGear({
    name: 'gear/scrantisPair',
    budget: EQUIPMENT_BUDGET.scrantisPair,
    parts,
    deep,
    aoAmount: [0.5, 0.5],
    seed,
    jitter: 0.02
  })
}

// ════════════════════════════════════════════════════════════════════════════
// Gearn's berserker axe
// ════════════════════════════════════════════════════════════════════════════

/**
 * ─── The war axe ────────────────────────────────────────────────────────────
 *
 * The story bible describes it exactly: *"a two-bladed berserker axe; the head
 * is an ell wide, circular, with a semicircular cut-out top and bottom, with
 * which he can trap an opponent's blade and disarm them."* Both halves of that
 * sentence are load-bearing.
 *
 *   * **Circular and double-bitted** is the silhouette. Nothing else in this
 *     world puts a *disc* above a shoulder, so at any distance where Gearn's
 *     head is a blob, the disc over it is still unambiguous.
 *   * **The notches are the mechanic.** Chapter 3 has him catching a short sword
 *     in one, and the notch is the one feature of this weapon that has to be
 *     geometry: a painted notch cannot trap anything and, more to the point,
 *     cannot be *seen* to.
 *
 * "An ell" is about 60 cm, which on a 1.56 m chibi would be a head and a half
 * across and would clip his own shoulder on every stride. It is authored at
 * 30 cm — the same reduction `sword.ts` records for the blade, and for the same
 * reason: this figure is three heads tall and honest scaling reads as wrong.
 *
 * ── One sweep for the head ──────────────────────────────────────────────────
 *
 * The head is a single section swept along its own **thickness**, so the notch
 * is a feature of the section and exists identically on both faces by
 * construction. Built as two bits plus an eye it would be three parts, three
 * normal solutions, and two seams running straight through the notch — which is
 * the one place on the model the eye actually goes.
 */

/**
 * The head's outline, in (up, fore) with the haft through the origin.
 *
 * Read it as a clock: the two bits point fore and aft (±b), and the two notches
 * cut in at 12 and 6 o'clock. The control points at ±0.5 on `a` with `b` at zero
 * are the notch floors — the curve falls short of them, which rounds the notch,
 * which is what lets a blade slide into it rather than jam on an arris.
 */
const AXE_HEAD = splineSection([
  [0.1, 1.0],
  [0.68, 0.86],
  [0.95, 0.5],
  [0.86, 0.2],
  // ── the upper notch ──
  [0.5, 0.05],
  [0.46, 0.0],
  [0.5, -0.05],
  [0.86, -0.2],
  [0.95, -0.5],
  [0.68, -0.86],
  [0.1, -1.0],
  [-0.1, -1.0],
  [-0.68, -0.86],
  [-0.95, -0.5],
  [-0.86, -0.2],
  // ── the lower notch ──
  [-0.5, -0.05],
  [-0.46, 0.0],
  [-0.5, 0.05],
  [-0.86, 0.2],
  [-0.95, 0.5],
  [-0.68, 0.86],
  [-0.1, 1.0]
])

/** Half the head's diameter. 300 mm across — see the header on the ell. */
const AXE_RADIUS = 0.15
/** Where the head sits down the haft, in item space. */
const AXE_HEAD_Y = -0.5

const buildAxeHead = (): SweptPart => {
  const t = 0.023
  const part = sweep({
    name: 'gear/warAxe/head',
    // Swept along ±X, the thinnest axis. The path is the *thickness*: seven
    // rings, so the head is a lens through its own section — thick at the eye
    // and ground away toward the rim.
    path: [
      [-t, AXE_HEAD_Y, 0],
      [-t * 0.86, AXE_HEAD_Y, 0],
      [-t * 0.45, AXE_HEAD_Y, 0],
      [0, AXE_HEAD_Y, 0],
      [t * 0.45, AXE_HEAD_Y, 0],
      [t * 0.86, AXE_HEAD_Y, 0],
      [t, AXE_HEAD_Y, 0]
    ],
    // `axisA` is up the haft and `axisB` is fore-and-aft, which puts the disc's
    // plane on Y–Z: exactly clause 4 of the folder convention, so a head slung
    // over the shoulder lies in the `backOver` socket's cant plane rather than
    // sticking out sideways.
    extentA: [0, 0.7, 0.94, 1, 0.94, 0.7, 0].map(e => AXE_RADIUS * e),
    extentB: [0, 0.7, 0.94, 1, 0.94, 0.7, 0].map(e => AXE_RADIUS * e),
    axisA: AXIS_Y,
    axisB: AXIS_Z,
    section: AXE_HEAD,
    stations: 7,
    // 20, which is what the notches need. `plateau.ts` measured the cost of
    // sampling a section's features too coarsely — a 24 %-deep flute delivered
    // 37 % of its depth — and a notch is a much sharper feature than a flute.
    segments: 20
  })

  return paintPart(
    part,
    (u, v, out) => {
      // Distance from the head's centre in the section, as the section's own
      // radius: 1 at the bits, ~0.46 at the notch floors. That is what separates
      // the ground edge from the body of the head, and it survives the head
      // being rotated in a way a world-space gradient would not.
      const bit = Math.abs(Math.sin(Math.PI * v))
      out.copy(C.ironBase).lerp(C.steelBase, 0.35)
      // The bits are polished and the body is left black from the forge, which
      // is how a working axe actually looks and is most of why this does not
      // read as a stage prop.
      out.lerp(C.steelLit, 0.55 * bit ** 2.2)
      out.lerp(C.ironShadow, 0.5 * (1 - bit))
      // The lens: the faces are darker than the rim, so the grind reads.
      out.lerp(C.ironShadow, 0.3 * smoothstep(0.35, 0.05, Math.abs(u - 0.5)))
      // The eye's reinforcing collar, a band round the haft hole.
      out.lerp(C.brassBase, 0.35 * smoothstep(0.55, 0.3, bit))
    },
    _color
  )
}

const buildAxeHaft = (): SweptPart => {
  const part = sweep({
    name: 'gear/warAxe/haft',
    path: [
      [0, 0.185, 0],
      [0, 0.17, 0],
      [0, 0.12, 0],
      [0, -0.16, 0],
      [0, -0.44, 0],
      [0, -0.6, 0],
      [0, -0.635, 0]
    ],
    // Oval rather than round — an axe haft has to tell the hand which way the
    // bit is pointing, and that is what an oval section is for. Broad on Z, the
    // same plane as the bits.
    extentA: [0, 0.0155, 0.0165, 0.0155, 0.0165, 0.0175, 0],
    extentB: [0, 0.021, 0.023, 0.021, 0.023, 0.0245, 0],
    axisA: AXIS_X,
    axisB: AXIS_Z,
    section: circleSection,
    stations: 7,
    segments: 6
  })

  return paintPart(
    part,
    (u, v, out) => {
      const round = 0.5 + 0.5 * Math.sin(v * Math.PI * 2)
      out.copy(C.woodBase).lerp(C.woodLit, 0.2 + 0.35 * round)
      out.lerp(C.woodShadow, 0.4 * (1 - round))
      // Leather binding over the two grip zones — the fore hand near the head
      // and the aft hand at the butt. Two bindings rather than one is what makes
      // it read as a two-hander.
      const bound = smoothstep(0.09, 0.16, u) * smoothstep(0.34, 0.27, u) + smoothstep(0.66, 0.74, u)
      _color.copy(C.leatherBase).lerp(C.leatherLit, 0.3 * round)
      out.lerp(_color, clamp01(bound) * 0.9)
      // The langets — two iron straps down the haft from the eye, which every
      // axe that has ever been used in anger has, and which stop the head
      // reading as glued on.
      out.lerp(C.ironBase, 0.85 * smoothstep(0.9, 0.82, u) * smoothstep(0.78, 0.84, u))
    },
    _color
  )
}

export const buildWarAxe = (options: { seed?: number } = {}): GearModel =>
  finishGear({
    name: 'gear/warAxe',
    budget: EQUIPMENT_BUDGET.warAxe,
    parts: [buildAxeHaft(), buildAxeHead()],
    deep: [C.woodShadow, C.ironShadow],
    // Strong on the haft, weak on the head. The head is one big flat field per
    // face and AO on it turns the grind into blotches; the haft's binding and
    // langets are exactly the crevices AO exists for.
    aoAmount: [0.8, 0.3],
    seed: options.seed ?? 1,
    jitter: 0.022
  })

// ════════════════════════════════════════════════════════════════════════════
// Kareen's hunting bow
// ════════════════════════════════════════════════════════════════════════════

/**
 * ─── The trollcherry bow ────────────────────────────────────────────────────
 *
 * Chapter 1 gives this weapon a provenance longer than any other object in the
 * book: Kareen's father Lothar is the village bowyer, his longbows are held to
 * be the best in the kingdom *because they can be drawn so hard*, the deposed
 * King Arthus II had a double-curved deer-sinew bow made by him, and Kareen's
 * own is cut from **trollcherry** wood. She shoots at a gallop, turning in the
 * saddle, and has the highest kill count of anyone in the manuscript.
 *
 * So this cannot be the standard bow in a different brown. Three things separate
 * it, all of them silhouette:
 *
 *   * **It is longer** — 840 mm tip to tip against the standard bow's 670. On a
 *     1.56 m figure that is a bow which reaches from her hip to over her head,
 *     which is what "longbow" has to mean at a glance.
 *   * **It is doubly recurved.** The standard bow's limb changes the sign of
 *     `dz/dy` once. This one changes it *twice* per limb — out at the fade, back
 *     at the working section, out again at the nock — so the limb reads as a
 *     shallow wave rather than as an S. That is the "doppelgeschwungen" the book
 *     keeps calling out, and it is the one shape a bow can have that nobody
 *     mistakes for a generic bow.
 *   * **The riser is deeper and shorter.** A bow that can be drawn hard is stiff
 *     in the middle and thin at the tips, so the depth ratio riser-to-nock is
 *     3.4:1 here against the standard bow's 3.1:1, over a longer stave.
 */

const HUNTING_HALF_SPAN = 0.42

/** `[y, z]` up the stave from the lower tip. Symmetric by construction. */
const HUNTING_STAVE: readonly (readonly [number, number])[] = [
  [-HUNTING_HALF_SPAN, -0.026],
  [-0.375, -0.006],
  [-0.315, -0.036],
  [-0.235, -0.03],
  [-0.135, 0.006],
  [-0.06, 0.046],
  [0.0, 0.058],
  [0.06, 0.046],
  [0.135, 0.006],
  [0.235, -0.03],
  [0.315, -0.036],
  [0.375, -0.006],
  [HUNTING_HALF_SPAN, -0.026]
]

const HUNTING_WIDTH = [0.0, 0.0075, 0.0105, 0.0125, 0.0155, 0.0185, 0.0205, 0.0185, 0.0155, 0.0125, 0.0105, 0.0075, 0.0]
const HUNTING_DEPTH = [0.0, 0.0042, 0.0052, 0.0062, 0.0092, 0.0125, 0.0143, 0.0125, 0.0092, 0.0062, 0.0052, 0.0042, 0.0]

const HUNTING_WRAP = 0.085

/**
 * Trollcherry: a red-brown that is neither the standard bow's `woodBase` nor
 * bark.
 *
 * Built by lerping `woodBase` toward `sandstoneBase` rather than by adding a
 * palette entry, because it is one object and the palette's rule is that colours
 * are *shared*, not that every object gets its own. `sandstoneBase` is the
 * world's warm red and mixing a third of it into planed timber lands exactly
 * where a fruitwood does.
 */
const TROLLCHERRY = C.woodBase.clone().lerp(C.sandstoneBase, 0.34)
const TROLLCHERRY_LIT = C.woodLit.clone().lerp(C.sandstoneLit, 0.28)

const buildHuntingStave = (): SweptPart => {
  const part = sweep({
    name: 'gear/huntingBow/stave',
    path: HUNTING_STAVE.map(([y, z]) => [0, y, z] as const),
    extentA: HUNTING_WIDTH,
    extentB: HUNTING_DEPTH,
    axisA: AXIS_X,
    axisB: AXIS_Z,
    section: circleSection,
    // 15 for 13 control points. The double recurve changes curvature four times
    // per limb, and the mesh chords between stations — an under-sampled stave
    // straightens exactly the waves that make it this bow.
    stations: 15,
    segments: 8
  })

  return paintPart(
    part,
    (u, v, out) => {
      const y = splineAt(
        HUNTING_STAVE.map(point => point[0]),
        u
      )
      const back = Math.sin(v * Math.PI * 2)
      out.copy(TROLLCHERRY).lerp(TROLLCHERRY_LIT, 0.35 + 0.4 * back)
      out.lerp(C.woodShadow, 0.22 * Math.max(0, -back))
      // Horn nock overlays at both tips — pale, and the one place this bow has a
      // second material. A nock is where a bowyer's work shows.
      const nock = smoothstep(0.94, 1.0, Math.abs(y) / HUNTING_HALF_SPAN)
      out.lerp(C.boneBase, nock * 0.85)
      out.lerp(C.boneLit, nock * 0.3 * Math.max(0, back))
      if (Math.abs(y) < HUNTING_WRAP) {
        const wrap = 0.5 + 0.5 * Math.cos(y * 110)
        out.copy(C.leatherShadow).lerp(C.leatherBase, 0.4 + 0.6 * wrap)
        out.lerp(C.leatherLit, 0.3 * Math.max(0, back))
      }
    },
    _color
  )
}

const buildHuntingString = (): SweptPart => {
  const z = HUNTING_STAVE[0]![1]
  const half = 0.0018
  const part = sweep({
    name: 'gear/huntingBow/string',
    path: [
      [0, -HUNTING_HALF_SPAN, z],
      [0, -HUNTING_HALF_SPAN * 0.5, z],
      [0, 0, z],
      [0, HUNTING_HALF_SPAN * 0.5, z],
      [0, HUNTING_HALF_SPAN, z]
    ],
    extentA: [0, half, half, half, 0],
    extentB: [0, half, half, half, 0],
    axisA: AXIS_X,
    axisB: AXIS_Z,
    section: circleSection,
    stations: 5,
    // Four, and it is a prism rather than a billboard for the reason `bow.ts`
    // records: a camera orbiting a character passes through a billboard's plane
    // twice a revolution and the string vanishes at both.
    segments: 4
  })

  return paintPart(
    part,
    (u, _v, out) => {
      out.copy(C.clothLit).lerp(C.clothBase, 0.35)
      // The serving — the thread whipped round the middle of the string where
      // the arrow nocks. Three centimetres, and it is the detail that says the
      // bow is used.
      out.lerp(C.leatherBase, 0.8 * smoothstep(0.08, 0.03, Math.abs(u - 0.5)))
    },
    _color
  )
}

export const buildHuntingBow = (options: { seed?: number } = {}): GearModel =>
  finishGear({
    name: 'gear/huntingBow',
    budget: EQUIPMENT_BUDGET.huntingBow,
    parts: [buildHuntingStave(), buildHuntingString()],
    deep: [C.woodShadow, C.clothShadow],
    aoAmount: [0.5, 0],
    seed: options.seed ?? 1,
    jitter: 0.025
  })

// ════════════════════════════════════════════════════════════════════════════
// The quiver
// ════════════════════════════════════════════════════════════════════════════

/**
 * ─── The quiver ─────────────────────────────────────────────────────────────
 *
 * "Kareen put the arrow back in her quiver and slung the bow over her shoulder."
 * It hangs from `beltL` (see `equipment.ts`), which stands it behind the left
 * hip with its mouth canted back — where a hand can reach it and where it does
 * not foul the draw.
 *
 * Four arrows are modelled and the fletchings are painted onto their upper
 * ends. That split is the usual one: the **shafts break the outline** above the
 * mouth and have to be geometry, while a fletching is 15 mm of feather that is
 * under a pixel at 8 m and would cost more than the four shafts together.
 */
const buildQuiverBody = (): SweptPart => {
  const part = sweep({
    name: 'gear/quiver/body',
    path: [
      [0, 0.012, 0],
      [0, 0.0, 0],
      [0, -0.03, 0.002],
      [0, -0.15, 0.008],
      [0, -0.27, 0.014],
      [0, -0.31, 0.016],
      [0, -0.325, 0.017]
    ],
    // Tapered: 96 mm across the mouth to 62 mm at the base. A parallel tube
    // reads as a pipe; the taper is what makes it a stitched leather cone.
    extentA: [0, 0.046, 0.048, 0.042, 0.034, 0.031, 0],
    extentB: [0, 0.046, 0.048, 0.042, 0.034, 0.031, 0],
    axisA: AXIS_X,
    axisB: AXIS_Z,
    section: circleSection,
    stations: 7,
    segments: 8
  })

  return paintPart(
    part,
    (u, v, out) => {
      const round = 0.5 + 0.5 * Math.sin(v * Math.PI * 2)
      out.copy(C.leatherBase).lerp(C.leatherLit, 0.22 + 0.38 * round)
      out.lerp(C.leatherShadow, 0.4 * (1 - round))
      // The seam up one side, and the two stitched bands that reinforce the
      // mouth and the base.
      out.lerp(C.leatherShadow, 0.6 * smoothstep(0.1, 0.02, Math.abs(((v + 0.5) % 1) - 0.5)))
      const band = smoothstep(0.06, 0.02, Math.abs(u - 0.13)) + smoothstep(0.06, 0.02, Math.abs(u - 0.86))
      out.lerp(C.leatherShadow, clamp01(band) * 0.55)
      // Down the mouth: the darkness inside a quiver, which is what stops it
      // reading as a solid peg.
      out.lerp(C.leatherShadow, 0.7 * smoothstep(0.94, 1.0, u))
    },
    _color
  )
}

const buildQuiverArrows = (): SweptPart[] => {
  const parts: SweptPart[] = []
  const spread: readonly (readonly [number, number, number])[] = [
    [-0.018, 0.0, 0.012],
    [0.014, -0.006, 0.02],
    [0.02, 0.004, -0.012],
    [-0.01, -0.01, -0.02]
  ]
  for (const [i, [dx, lean, dz]] of spread.entries()) {
    const half = 0.0038
    const top = 0.155 + i * 0.014
    const part = sweep({
      name: `gear/quiver/arrow${i}`,
      path: [
        [dx, -0.02, dz],
        [dx + lean * 0.3, 0.02, dz + lean * 0.2],
        [dx + lean * 0.7, top * 0.5, dz + lean * 0.5],
        [dx + lean, top - 0.01, dz + lean * 0.8],
        [dx + lean, top, dz + lean * 0.85]
      ],
      extentA: [0, half, half, half * 1.5, 0],
      extentB: [0, half, half, half * 1.5, 0],
      axisA: AXIS_X,
      axisB: AXIS_Z,
      section: circleSection,
      stations: 5,
      segments: 4
    })

    parts.push(
      paintPart(
        part,
        (u, _v, out) => {
          out.copy(C.woodBase).lerp(C.woodLit, 0.3)
          // The fletching, painted over the top third: three vanes, so the
          // banding is at period 1/3 of the section.
          const fletch = smoothstep(0.66, 0.76, u)
          _color.copy(C.clothLit).lerp(C.arlaanRed, 0.45)
          out.lerp(_color, fletch * 0.9)
          // The nock, dark, at the very top.
          out.lerp(C.leatherShadow, 0.8 * smoothstep(0.95, 1.0, u))
        },
        _color
      )
    )
  }
  return parts
}

export const buildQuiver = (options: { seed?: number } = {}): GearModel => {
  const arrows = buildQuiverArrows()
  return finishGear({
    name: 'gear/quiver',
    budget: EQUIPMENT_BUDGET.quiver,
    parts: [buildQuiverBody(), ...arrows],
    deep: [C.leatherShadow, ...arrows.map(() => C.woodShadow)],
    aoAmount: [0.75, ...arrows.map(() => 0.4)],
    seed: options.seed ?? 1,
    jitter: 0.03
  })
}

// ════════════════════════════════════════════════════════════════════════════
// Theodor's broadsword and Athalus's hunting dagger
// ════════════════════════════════════════════════════════════════════════════

/**
 * ─── Two more cruciforms, and why they are not new geometry ─────────────────
 *
 * `sword.ts` factors the sword into a `CruciformSpec` — blade path, blade
 * section, guard, grip — precisely so a second sword is a table rather than a
 * file. Both of these are that table with different numbers, and neither
 * deserves more:
 *
 *   * **The broadsword** is Theodor's, and Theodor is *militia*. It is issue
 *     kit: 25 % wider in the blade than Athalus's arming sword, 10 % shorter,
 *     with a plain bar guard and a disc pommel. Wider-and-shorter is exactly the
 *     silhouette of a weapon meant to be used behind a shield by somebody who
 *     was taught it in a fortnight — and the book is blunt that Theodor is the
 *     weakest fighter in the group.
 *   * **The dagger** is Athalus's hunting knife, and Chapter 1 says he uses it
 *     "only for hunting and for gutting game" and does not know how to fight
 *     with it. So it is a *tool*: a short single-purpose blade with a stubby
 *     guard and an antler grip, and it is the one blade here with no brass on
 *     it at all.
 */

const BROADSWORD: CruciformSpec = {
  name: 'gear/broadsword',
  budget: EQUIPMENT_BUDGET.broadsword,
  //          base    above   full    mid     taper   point   tip
  bladeY: [-0.032, -0.048, -0.078, -0.215, -0.34, -0.395, -0.425],
  bladeThickness: [0.0, 0.0085, 0.0098, 0.0092, 0.007, 0.0034, 0.0],
  bladeWidth: [0.0, 0.042, 0.047, 0.045, 0.036, 0.016, 0.0],
  bladeStations: 7,
  // A straight bar, thicker than the arming sword's tapered quillons and with
  // no sweep in it at all. That flatness is the whole difference: a swept guard
  // is a personal weapon, a straight bar is a hundred of them from one smith.
  guard: [
    [-0.108, -0.046],
    [-0.106, -0.046],
    [-0.096, -0.045],
    [-0.048, -0.045],
    [0.0, -0.044],
    [0.048, -0.045],
    [0.096, -0.045],
    [0.106, -0.046],
    [0.108, -0.046]
  ],
  guardThickness: [0.0, 0.009, 0.014, 0.016, 0.017, 0.016, 0.014, 0.009, 0.0],
  guardHeight: [0.0, 0.012, 0.02, 0.022, 0.023, 0.022, 0.02, 0.012, 0.0],
  guardStations: 5,
  // A disc pommel, flatter and wider than the arming sword's wheel.
  gripY: [0.128, 0.12, 0.108, 0.094, 0.07, 0.028, -0.012, -0.03],
  gripThickness: [0.0, 0.019, 0.023, 0.021, 0.013, 0.0145, 0.017, 0.0],
  gripWidth: [0.0, 0.027, 0.033, 0.028, 0.015, 0.018, 0.021, 0.0],
  gripStations: 8
}

export const buildBroadsword = (options: { seed?: number } = {}): GearModel =>
  buildCruciform(BROADSWORD, options.seed ?? 1)

const DAGGER: CruciformSpec = {
  name: 'gear/dagger',
  budget: EQUIPMENT_BUDGET.dagger,
  bladeY: [-0.022, -0.03, -0.048, -0.115, -0.175, -0.2, -0.215],
  bladeThickness: [0.0, 0.0055, 0.0062, 0.0056, 0.0042, 0.002, 0.0],
  bladeWidth: [0.0, 0.019, 0.0205, 0.0185, 0.014, 0.0065, 0.0],
  bladeStations: 6,
  // A stub. 44 mm across, against the sword's 200 — barely more than a finger
  // guard, which is what a skinning knife has.
  guard: [
    [-0.022, -0.026],
    [-0.02, -0.026],
    [-0.012, -0.025],
    [0.0, -0.024],
    [0.012, -0.025],
    [0.02, -0.026],
    [0.022, -0.026]
  ],
  guardThickness: [0.0, 0.007, 0.009, 0.01, 0.009, 0.007, 0.0],
  guardHeight: [0.0, 0.008, 0.011, 0.012, 0.011, 0.008, 0.0],
  guardStations: 4,
  // Antler: swollen at the butt, waisted in the hand, no pommel cap. The
  // profile is what makes it read as bone rather than as a small sword.
  gripY: [0.088, 0.082, 0.072, 0.055, 0.03, 0.0, -0.018],
  gripThickness: [0.0, 0.0155, 0.017, 0.0125, 0.0135, 0.015, 0.0],
  gripWidth: [0.0, 0.0165, 0.0185, 0.0135, 0.0145, 0.016, 0.0],
  gripStations: 7
}

export const buildDagger = (options: { seed?: number } = {}): GearModel =>
  buildCruciform(DAGGER, options.seed ?? 1)
