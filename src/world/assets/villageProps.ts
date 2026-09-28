import { Color } from 'three'
import { C } from '../art/palette'
import {
  bands,
  beam,
  BEAM_SECTION,
  box,
  buildStructureAsset,
  clamp01,
  CURVED_RINGS,
  LOG_SECTION,
  PLANK_SECTION,
  roof,
  SIMPLE_RINGS,
  smoothstep,
  type StructureMember,
  type Vec3
} from './structure'
import type { WorldAsset } from './types'

/**
 * ─── What stands between the houses ─────────────────────────────────────────
 *
 * A village is not a set of buildings. It is a set of buildings plus the things
 * people leave lying about between them, and the second half is what makes the
 * first half look inhabited: a well with a rope on it, a cart with its shafts
 * down, a stack of split logs against a wall, hay under a tarp, a fire pit with
 * benches round it.
 *
 * Chapter 1 names four of these specifically and they are all here for that
 * reason rather than for dressing:
 *
 *   * **der Treff** — "a small square with benches and a fire pit", where the
 *     four of them agree to roast the boar that evening. `fire-pit` and `bench`.
 *   * **the market square**, where the village trader loads the boat.
 *     `market-stall` and `cart`.
 *   * **the bowyer's** — Kareen's father Lothar makes the best longbows in the
 *     kingdom, so the village has a workshop that is also a house. `work-bench`
 *     and `stave-rack`.
 *   * **the smithy's yard** — Athalus is supposed to be helping his father and
 *     is not. `anvil`, `water-trough`, `log-pile`.
 *
 * Every one of them is small and placed in numbers, so unlike the houses they
 * are budgeted near the *scatter* end of GDD §4.1 rather than the landmark end,
 * and most of them lose their small members by LOD1.
 */

const _c = new Color()

// ─── Paints ─────────────────────────────────────────────────────────────────

const timberPaint = (u: number, v: number, out: Color): void => {
  const grain = bands(u, 0.17, 2)
  const facet = 0.5 + 0.5 * Math.cos(4 * Math.PI * v)
  out.copy(C.timberBase).lerp(C.timberLit, 0.2 + 0.4 * facet + 0.16 * grain)
  out.lerp(C.timberShadow, 0.3 * (1 - facet))
}

const planedPaint = (u: number, v: number, out: Color): void => {
  out.copy(C.woodBase).lerp(C.woodLit, 0.22 + 0.4 * bands(v, 0.25, 2) + 0.12 * bands(u, 0.3, 2))
  out.lerp(C.woodShadow, 0.45 * (1 - bands(v, 0.25, 8)))
}

const stonePaint = (u: number, v: number, out: Color): void => {
  const course = bands(u, 0.14, 5)
  const joint = bands(v + u * 3.1, 0.19, 7)
  out.copy(C.rockBase).lerp(C.rockWarm, 0.25 + 0.4 * course * joint)
  out.lerp(C.rockShadow, 0.45 * (1 - course) + 0.2 * (1 - joint))
}

const ironPaint = (u: number, v: number, out: Color): void => {
  const facet = 0.5 + 0.5 * Math.cos(4 * Math.PI * v)
  out.copy(C.ironBase).lerp(C.ironLit, 0.2 + 0.45 * facet)
  out.lerp(C.ironShadow, 0.4 * (1 - facet) + 0.15 * bands(u, 0.22, 3))
}

/**
 * A cut log end: rings, and bark round the outside.
 *
 * The end grain is the whole point of a log pile — a stack of logs seen from the
 * side is a stack of sticks, and a stack seen end-on is unmistakable. So the
 * rings are painted as a function of the *section* radius, which is what `v`
 * cannot give: the paint reads the section's own parameter and the rings are
 * concentric only because every log is sampled with its end ring collapsed to a
 * point. Cheap, and correct for the one view that matters.
 */
const logEndPaint = (u: number, v: number, out: Color): void => {
  const end = Math.max(smoothstep(0.3, 0.06, u), smoothstep(0.7, 0.94, u))
  out.copy(C.barkBase).lerp(C.barkDark, 0.3 + 0.35 * bands(v, 0.09, 3))
  if (end > 0) {
    _c.copy(C.woodLit).lerp(C.woodBase, 0.4 + 0.5 * bands(v * 0.5 + u * 6, 0.16, 4))
    out.lerp(_c, end)
  }
}

const strawPaint = (u: number, v: number, out: Color): void => {
  out.copy(C.strawBase).lerp(C.strawLit, 0.25 + 0.4 * bands(v, 0.11, 2) + 0.15 * bands(u, 0.19, 2))
  out.lerp(C.strawShadow, 0.5 * smoothstep(0.25, 0.02, u))
}

// ─── The well ───────────────────────────────────────────────────────────────

/**
 * A round stone kerb, two posts, a windlass and a shingle hood.
 *
 * The hood is what makes it a well rather than a ring of stones, and it is the
 * one member here worth its triangles: at 25 m the kerb is a grey blob and the
 * hood is a recognisable little roof floating over it.
 */
export const createWellAsset = (seed = 1): WorldAsset =>
  buildStructureAsset({
    name: `well-${seed}`,
    perfTag: 'village',
    members: [
      box({
        name: 'well/kerb',
        y0: -0.2,
        y1: 0.72,
        halfX: 0.78,
        halfZ: 0.78,
        batter: 0.93,
        bevel: 0.09,
        segments: 12,
        paint: stonePaint,
        deep: C.rockShadow,
        ao: 0.7
      }),
      // The mouth: a darker ring inside the kerb, standing 6 cm lower so the
      // silhouette breaks. Without it the well reads as a solid drum.
      box({
        name: 'well/mouth',
        y0: 0.3,
        y1: 0.66,
        halfX: 0.6,
        halfZ: 0.6,
        batter: 1,
        bevel: 0.14,
        segments: 10,
        paint: (u, _v, out) => {
          out.copy(C.rockShadow).lerp(C.skyZenithNight, 0.55 * smoothstep(0.7, 0.2, u))
        },
        deep: C.rockShadow,
        ao: 0.9,
        lastTier: 1
      }),
      ...[-1, 1].map(side =>
        beam({
          name: `well/post-${side}`,
          from: [side * 0.66, 0.5, 0],
          to: [side * 0.62, 1.78, 0],
          halfA: 0.075,
          halfB: 0.075,
          segments: 6,
          rings: SIMPLE_RINGS,
          paint: timberPaint,
          deep: C.timberShadow,
          lastTier: 2
        })
      ),
      // The windlass, with the rope wound on it — painted, because a modelled
      // rope at 2 cm is under a pixel at any distance this prop is read from.
      beam({
        name: 'well/windlass',
        from: [-0.6, 1.5, 0],
        to: [0.6, 1.5, 0],
        halfA: 0.11,
        halfB: 0.11,
        section: LOG_SECTION,
        segments: 7,
        rings: SIMPLE_RINGS,
        paint: (u, v, out) => {
          out.copy(C.woodBase).lerp(C.woodShadow, 0.4)
          // Rope, wound over the middle two thirds.
          const wound = smoothstep(0.22, 0.32, u) * smoothstep(0.78, 0.68, u)
          _c.copy(C.strawBase).lerp(C.strawShadow, 0.5 * bands(u, 0.035, 6))
          out.lerp(_c, wound * 0.9)
          out.lerp(C.woodLit, 0.25 * (0.5 + 0.5 * Math.cos(4 * Math.PI * v)))
        },
        deep: C.woodShadow,
        lastTier: 1
      }),
      roof({
        name: 'well/hood',
        from: [-0.86, 1.72, 0],
        to: [0.86, 1.72, 0],
        halfSpan: 0.86,
        rise: 0.44,
        sag: 0.01,
        gableOverhang: 0.02,
        segments: 8,
        paint: (u, v, out) => {
          const downslope = clamp01(Math.abs(((v + 0.5) % 1) * 2 - 1))
          out.copy(C.shingleBase).lerp(C.shingleLit, 0.2 + 0.4 * bands(downslope, 0.1, 8))
          out.lerp(C.shingleShadow, 0.7 * smoothstep(0.88, 1.0, downslope))
        },
        deep: C.shingleShadow,
        ao: 0.5
      })
    ],
    budgets: [600, 330, 190, 70],
    distanceScale: 1.4,
    seed,
    material: 'stone'
  })

// ─── Der Treff: fire pit and benches ────────────────────────────────────────

export const createFirePitAsset = (seed = 1): WorldAsset =>
  buildStructureAsset({
    name: `fire-pit-${seed}`,
    perfTag: 'village',
    members: [
      // The ring of field stones. One member, with the stones painted as lobes —
      // eight modelled stones would be eight sweeps for a shape that is a ring
      // of blobs at every distance it is seen from.
      box({
        name: 'pit/ring',
        y0: -0.12,
        y1: 0.34,
        halfX: 0.92,
        halfZ: 0.92,
        batter: 0.86,
        bevel: 0.3,
        segments: 12,
        paint: (u, v, out) => {
          const lobe = 0.5 + 0.5 * Math.cos(16 * Math.PI * v)
          stonePaint(u + lobe * 0.3, v, out)
          out.lerp(C.rockShadow, 0.5 * (1 - lobe))
        },
        deep: C.rockShadow,
        ao: 0.6
      }),
      // The fire itself: charred logs leaning into the middle with the embers
      // showing between them. This is the only member in the village painted
      // with `ember*` over a large fraction of its area, and it is small enough
      // that the palette's note on keeping that colour scarce still holds.
      ...[0, 1, 2].map(i =>
        beam({
          name: `pit/log-${i}`,
          from: [Math.cos((i * 2.1) + 0.4) * 0.55, 0.06, Math.sin((i * 2.1) + 0.4) * 0.55],
          to: [Math.cos(i * 2.1 + 0.4 + Math.PI) * 0.2, 0.46, Math.sin(i * 2.1 + 0.4 + Math.PI) * 0.2],
          halfA: 0.09,
          halfB: 0.09,
          section: LOG_SECTION,
          segments: 6,
          rings: SIMPLE_RINGS,
          paint: (u, v, out) => {
            out.copy(C.timberShadow).lerp(C.barkDark, 0.5 + 0.3 * bands(v, 0.1, 3))
            // Charred toward the middle of the fire, which is the high-u end.
            out.lerp(C.emberDeep, 0.5 * smoothstep(0.45, 0.95, u))
            out.lerp(C.emberBase, 0.55 * smoothstep(0.72, 1.0, u) * (0.4 + 0.6 * bands(v, 0.13, 5)))
          },
          deep: C.emberDeep,
          ao: 0.35,
          lastTier: 1
        })
      )
    ],
    budgets: [340, 190, 100, 40],
    distanceScale: 1.0,
    seed,
    material: 'stone'
  })

/**
 * A split-log bench: a plank on two chocks. Four at the Treff, more elsewhere.
 *
 * ── 0.34 at the top face, and it was 0.495 ──────────────────────────────────
 *
 * The bench is the last seat in the project still authored at human scale, and
 * it was missed for one reason: nobody ever sat on it. The storyteller's room
 * came down by a third the day the household did — `combat/postures.ts` carries
 * the arithmetic and `hut-table`'s note carries the summary — and the rule it
 * establishes is that a figure whose hip-to-sole is 0.62 m against a real
 * adult's 0.90 cannot use furniture built for the adult.
 *
 * The old plank had its centre at 0.44 and a half-thickness of 0.055, i.e. a
 * top face at **0.495**. `seatedLeg(0.495)` asks the thigh to hang 61° below
 * horizontal: that is not sitting on a bench, it is perching on a wall, with
 * the soles a hand's width off the ground. At 0.34 the decline is 20°, the shin
 * comes out vertical and the feet land — which is the whole point of solving
 * the pose instead of keying it.
 *
 * So the plank's centre is 0.285 (top face 0.34, matching `SEAT_HEIGHT.bench`
 * and `hut-stool`) and the chocks are shortened to meet its underside on the
 * same 0.035 m of overlap they had before. Scaled back by the same 0.62/0.90
 * this is a 0.49 m bench, which is a bench.
 *
 * **The catalogue's collider is still 0.46 tall** (`assets/index.ts`), i.e. 12 cm
 * proud of the plank it stands for. It blocks nothing either way — every mover
 * in the project tests against a step ceiling of at least `y + 0.6`, so a
 * 0.46 m box is walked over rather than into — but it should come down to 0.34
 * with the geometry, and `tests/world/seats.test.ts` says so out loud
 * rather than leaving the two to drift quietly.
 */
export const createBenchAsset = (seed = 1): WorldAsset =>
  buildStructureAsset({
    name: `bench-${seed}`,
    perfTag: 'village',
    members: [
      beam({
        name: 'bench/seat',
        from: [-0.92, 0.285, 0],
        to: [0.92, 0.285, 0],
        halfA: 0.055,
        halfB: 0.21,
        section: PLANK_SECTION,
        roll: Math.PI * 0.5,
        segments: 6,
        rings: SIMPLE_RINGS,
        paint: planedPaint,
        deep: C.woodShadow,
        ao: 0.6
      }),
      ...[-1, 1].map(side =>
        beam({
          name: `bench/chock-${side}`,
          from: [side * 0.6, -0.05, 0],
          // 0.265: the plank's underside is 0.285 − 0.055 = 0.23, and the chock
          // runs 0.035 past it, exactly as it did at the old height.
          to: [side * 0.62, 0.265, 0],
          halfA: 0.11,
          halfB: 0.15,
          section: LOG_SECTION,
          segments: 6,
          rings: SIMPLE_RINGS,
          paint: logEndPaint,
          deep: C.barkDark,
          ao: 0.8,
          lastTier: 2
        })
      )
    ],
    budgets: [220, 130, 70, 30],
    distanceScale: 0.85,
    seed
  })

// ─── Yard clutter ───────────────────────────────────────────────────────────

/** Split logs stacked against a wall. The one prop that says "somebody lives here". */
export const createLogPileAsset = (seed = 1): WorldAsset => {
  const members: StructureMember[] = []
  const rows = [
    { y: 0.14, count: 5, jitter: 0.0 },
    { y: 0.4, count: 5, jitter: 0.11 },
    { y: 0.66, count: 4, jitter: 0.06 },
    { y: 0.9, count: 3, jitter: 0.16 }
  ]
  for (const [r, row] of rows.entries()) {
    for (let i = 0; i < row.count; i++) {
      const z = (i - (row.count - 1) / 2) * 0.27 + row.jitter
      members.push(
        beam({
          name: `log-${r}-${i}`,
          from: [-0.62, row.y, z],
          to: [0.62, row.y + (i % 2 ? 0.012 : -0.012), z],
          halfA: 0.125,
          halfB: 0.125,
          section: LOG_SECTION,
          segments: 6,
          rings: SIMPLE_RINGS,
          paint: logEndPaint,
          deep: C.barkDark,
          ao: 0.75,
          // Every log is gone by LOD2, where the painted mass takes over — see
          // `firstTier` on that member. The top two rows go one tier earlier
          // still: a woodpile's read is its *mass* plus the ragged top, and the
          // ragged top survives in the mass's own outline.
          lastTier: r >= 2 ? 0 : 1
        })
      )
    }
  }
  // The coarse stand-in: one battered block with the log ends painted on.
  members.push(
    box({
      name: 'log-pile/mass',
      y0: 0,
      y1: 1.0,
      halfX: 0.62,
      halfZ: 0.72,
      batter: 0.78,
      bevel: 0.07,
      segments: 6,
      paint: (u, v, out) => {
        logEndPaint(u, v, out)
        out.lerp(C.barkDark, 0.4 * (1 - bands(u, 0.13, 4)))
      },
      deep: C.barkDark,
      ao: 0.6,
      firstTier: 2
    })
  )
  return buildStructureAsset({
    name: `log-pile-${seed}`,
    perfTag: 'village',
    members,
    budgets: [760, 430, 90, 34],
    distanceScale: 1.0,
    seed
  })
}

/** A hay heap under a weighted cloth. Round, so it reads from every direction. */
export const createHayStackAsset = (seed = 1): WorldAsset =>
  buildStructureAsset({
    name: `hay-stack-${seed}`,
    perfTag: 'village',
    members: [
      box({
        name: 'hay/heap',
        y0: -0.1,
        y1: 1.55,
        halfX: 1.15,
        halfZ: 1.15,
        batter: 0.34,
        bevel: 0.2,
        segments: 10,
        rings: CURVED_RINGS,
        paint: strawPaint,
        deep: C.strawShadow,
        ao: 0.55
      }),
      // The pole through the middle, standing proud. A haystack without one is a
      // cone; with one it is a haystack.
      beam({
        name: 'hay/pole',
        from: [0.06, 1.1, -0.04],
        to: [0.02, 2.15, 0.02],
        halfA: 0.055,
        halfB: 0.055,
        segments: 5,
        rings: SIMPLE_RINGS,
        paint: timberPaint,
        deep: C.timberShadow,
        lastTier: 2
      })
    ],
    budgets: [440, 250, 120, 44],
    distanceScale: 1.1,
    seed
  })

/** A barrel: staves, two hoops, a slightly domed head. */
export const createBarrelAsset = (seed = 1): WorldAsset =>
  buildStructureAsset({
    name: `barrel-${seed}`,
    perfTag: 'village',
    members: [
      {
        name: 'barrel/body',
        // The bulge is in the *extent*, so the staves curve. A cylinder with a
        // painted bulge is the usual shortcut and it fails at the silhouette,
        // which is the only place a barrel differs from a bucket.
        path: [
          [0, -0.02, 0],
          [0, 0.02, 0],
          [0, 0.1, 0],
          [0, 0.42, 0],
          [0, 0.74, 0],
          [0, 0.82, 0],
          [0, 0.86, 0]
        ] as Vec3[],
        extentA: [0, 0.22, 0.29, 0.34, 0.29, 0.22, 0],
        extentB: [0, 0.22, 0.29, 0.34, 0.29, 0.22, 0],
        segments: 10,
        rings: CURVED_RINGS,
        paint: (u, v, out) => {
          const stave = bands(v, 0.1, 3)
          out.copy(C.woodBase).lerp(C.woodLit, 0.2 + 0.35 * stave)
          out.lerp(C.woodShadow, 0.45 * (1 - bands(v, 0.1, 9)))
          // Two iron hoops. Bands in `u`, so they follow the bulge.
          const hoop = smoothstep(0.05, 0.02, Math.abs(u - 0.3)) + smoothstep(0.05, 0.02, Math.abs(u - 0.7))
          out.lerp(C.ironBase, clamp01(hoop) * 0.9)
          // The head, seen from above.
          out.lerp(C.woodShadow, 0.5 * smoothstep(0.9, 0.99, u))
        },
        deep: C.woodShadow,
        ao: 0.7
      }
    ],
    budgets: [260, 150, 80, 28],
    distanceScale: 0.8,
    seed
  })

/** A stack of two crates, offset. Market square and quay dressing. */
export const createCrateStackAsset = (seed = 1): WorldAsset =>
  buildStructureAsset({
    name: `crate-stack-${seed}`,
    perfTag: 'village',
    members: [
      box({
        name: 'crate/lower',
        y0: -0.03,
        y1: 0.56,
        halfX: 0.36,
        halfZ: 0.32,
        batter: 1,
        bevel: 0.08,
        segments: 8,
        paint: (u, v, out) => {
          planedPaint(u, v, out)
          // Corner battens, painted at the section's four corners.
          const corner = clamp01(Math.abs(Math.cos(4 * Math.PI * v)) ** 6)
          out.lerp(C.timberBase, corner * 0.8)
        },
        deep: C.woodShadow,
        ao: 0.7
      }),
      box({
        name: 'crate/upper',
        x: 0.07,
        z: -0.05,
        y0: 0.56,
        y1: 1.0,
        halfX: 0.29,
        halfZ: 0.26,
        batter: 1,
        bevel: 0.1,
        segments: 8,
        paint: (u, v, out) => {
          planedPaint(u * 1.3 + 0.2, v, out)
          const corner = clamp01(Math.abs(Math.cos(4 * Math.PI * v)) ** 6)
          out.lerp(C.timberBase, corner * 0.8)
        },
        deep: C.woodShadow,
        ao: 0.7,
        lastTier: 2
      })
    ],
    budgets: [300, 170, 90, 34],
    distanceScale: 0.85,
    seed
  })

/**
 * A hand cart with its shafts down.
 *
 * Shafts down rather than up, and that is a story decision as much as an art
 * one: a cart with its shafts in the air is *in use*, and Nimmerschein in
 * Chapter 1 is a village going about a summer morning while four teenagers are
 * off doing something they were told not to.
 */
export const createCartAsset = (seed = 1): WorldAsset =>
  buildStructureAsset({
    name: `cart-${seed}`,
    perfTag: 'village',
    members: [
      box({
        name: 'cart/bed',
        y0: 0.52,
        y1: 0.74,
        halfX: 1.05,
        halfZ: 0.58,
        batter: 1.04,
        bevel: 0.22,
        segments: 8,
        paint: planedPaint,
        deep: C.woodShadow,
        ao: 0.7
      }),
      ...[-1, 1].map(side =>
        beam({
          name: `cart/side-${side}`,
          from: [-1.0, 0.94, side * 0.56],
          to: [1.0, 0.94, side * 0.56],
          halfA: 0.05,
          halfB: 0.22,
          section: PLANK_SECTION,
          roll: Math.PI * 0.5,
          segments: 5,
          rings: SIMPLE_RINGS,
          paint: planedPaint,
          deep: C.woodShadow,
          lastTier: 1
        })
      ),
      // Two wheels, as flat discs with the spokes painted. A modelled spoke is
      // 2 cm of section and would cost more than the rest of the cart.
      ...[-1, 1].map(side =>
        beam({
          name: `cart/wheel-${side}`,
          from: [0.34, 0.46, side * 0.64],
          to: [0.34, 0.46, side * 0.72],
          halfA: 0.46,
          halfB: 0.46,
          segments: 12,
          rings: SIMPLE_RINGS,
          paint: (u, v, out) => {
            out.copy(C.woodBase).lerp(C.woodLit, 0.25 + 0.3 * bands(v, 0.25, 2))
            // Eight spokes and a hub, as a function of the section angle.
            const spoke = clamp01(Math.abs(Math.cos(8 * Math.PI * v)) ** 8)
            out.lerp(C.woodShadow, 0.55 * (1 - spoke) * smoothstep(0.15, 0.5, u))
            // The iron tyre.
            out.lerp(C.ironBase, 0.85 * smoothstep(0.86, 0.97, u))
          },
          deep: C.woodShadow,
          ao: 0.5,
          lastTier: 2
        })
      ),
      ...[-1, 1].map(side =>
        beam({
          name: `cart/shaft-${side}`,
          from: [-0.95, 0.6, side * 0.3],
          to: [-2.15, 0.08, side * 0.34],
          halfA: 0.045,
          halfB: 0.045,
          segments: 5,
          rings: SIMPLE_RINGS,
          paint: timberPaint,
          deep: C.timberShadow,
          lastTier: 1
        })
      )
    ],
    budgets: [680, 380, 200, 70],
    distanceScale: 1.2,
    seed
  })

/**
 * A market stall: a counter, four posts and a striped awning.
 *
 * The awning is cloth and carries wind, which is the second and last member in
 * the village that does — see the gate's banner. It is what makes the market
 * square read as a market rather than as four tables.
 */
export const createMarketStallAsset = (seed = 1): WorldAsset =>
  buildStructureAsset({
    name: `market-stall-${seed}`,
    perfTag: 'village',
    members: [
      box({
        name: 'stall/counter',
        y0: 0.0,
        y1: 0.92,
        halfX: 1.15,
        halfZ: 0.42,
        batter: 1.02,
        bevel: 0.1,
        segments: 8,
        paint: (u, v, out) => {
          planedPaint(u, v, out)
          out.lerp(C.woodShadow, 0.5 * smoothstep(0.35, 0.05, u))
        },
        deep: C.woodShadow,
        ao: 0.7
      }),
      ...[
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1]
      ].map(([sx, sz]) =>
        beam({
          name: `stall/post-${sx}-${sz}`,
          from: [sx! * 1.1, 0.1, sz! * 0.5],
          to: [sx! * 1.06, 2.05, sz! * 0.48],
          halfA: 0.055,
          halfB: 0.055,
          segments: 5,
          rings: SIMPLE_RINGS,
          paint: timberPaint,
          deep: C.timberShadow,
          lastTier: 1
        })
      ),
      roof({
        name: 'stall/awning',
        from: [-1.35, 2.02, 0],
        to: [1.35, 2.02, 0],
        halfSpan: 0.78,
        rise: 0.26,
        sag: 0.07,
        gableOverhang: 0.03,
        segments: 8,
        paint: (_u, v, out) => {
          const downslope = clamp01(Math.abs(((v + 0.5) % 1) * 2 - 1))
          // Stripes across the slope. Two dyes a village could actually make:
          // madder and undyed wool.
          const stripe = bands(downslope, 0.16, 10)
          out.copy(C.clothLit).lerp(C.arlaanRed, 0.75 * (1 - stripe))
          out.lerp(C.clothShadow, 0.6 * smoothstep(0.88, 1.0, downslope))
        },
        deep: C.clothShadow,
        ao: 0.3,
        wind: 0.5
      })
    ],
    budgets: [680, 380, 200, 70],
    distanceScale: 1.2,
    seed,
    material: 'cloth'
  })

/**
 * A run of split-rail fence, 4 m long.
 *
 * Same length as `PALISADE_RUN` is not, deliberately: a fence follows a field
 * boundary and a palisade follows a defence line, and matching their module
 * lengths would tempt a level to use one for the other.
 */
export const FENCE_RUN = 4.0

export const createFenceAsset = (seed = 1): WorldAsset => {
  const members: StructureMember[] = []
  for (const at of [-0.5, -0.17, 0.17, 0.5]) {
    members.push(
      beam({
        name: `fence/post-${at}`,
        from: [FENCE_RUN * at, -0.24, 0],
        to: [FENCE_RUN * at + 0.03, 1.02, 0.02],
        halfA: 0.07,
        halfB: 0.07,
        section: LOG_SECTION,
        segments: 5,
        rings: SIMPLE_RINGS,
        paint: (u, v, out) => {
          out.copy(C.barkBase).lerp(C.barkDark, 0.3 + 0.3 * bands(v, 0.1, 3))
          out.lerp(C.woodLit, 0.4 * smoothstep(0.9, 1.0, u))
        },
        deep: C.barkDark,
        lastTier: 1
      })
    )
  }
  for (const [i, y] of [0.44, 0.84].entries()) {
    members.push(
      beam({
        name: `fence/rail-${i}`,
        from: [-FENCE_RUN * 0.52, y, 0.02],
        to: [FENCE_RUN * 0.52, y + (i ? -0.03 : 0.03), -0.02],
        halfA: 0.045,
        halfB: 0.06,
        segments: 5,
        rings: SIMPLE_RINGS,
        paint: timberPaint,
        deep: C.timberShadow
      })
    )
  }
  return buildStructureAsset({
    name: `fence-run-${seed}`,
    perfTag: 'village',
    members,
    budgets: [320, 190, 110, 46],
    distanceScale: 1.1,
    seed
  })
}

/**
 * The smithy's anvil on its stump, and the slack tub beside it.
 *
 * Small, and placed exactly once, but it is the prop that identifies Athalus's
 * yard from across the square — and Chapter 1 turns on the fact that he is
 * supposed to be standing at it.
 */
export const createAnvilAsset = (seed = 1): WorldAsset =>
  buildStructureAsset({
    name: `anvil-${seed}`,
    perfTag: 'village',
    members: [
      beam({
        name: 'anvil/stump',
        from: [0, -0.12, 0],
        to: [0.02, 0.56, 0.01],
        halfA: 0.3,
        halfB: 0.3,
        section: LOG_SECTION,
        segments: 8,
        rings: SIMPLE_RINGS,
        paint: logEndPaint,
        deep: C.barkDark,
        ao: 0.75
      }),
      // The body: waisted, with the face standing proud. The waist is the whole
      // silhouette of an anvil and it is three control points.
      {
        name: 'anvil/body',
        path: [
          [0, 0.54, 0],
          [0, 0.58, 0],
          [0, 0.63, 0],
          [0, 0.72, 0],
          [0, 0.82, 0],
          [0, 0.87, 0],
          [0, 0.9, 0]
        ] as Vec3[],
        extentA: [0, 0.17, 0.19, 0.09, 0.2, 0.21, 0],
        extentB: [0, 0.1, 0.11, 0.055, 0.115, 0.12, 0],
        section: BEAM_SECTION,
        segments: 8,
        rings: CURVED_RINGS,
        paint: ironPaint,
        deep: C.ironShadow,
        ao: 0.8
      },
      // The horn.
      beam({
        name: 'anvil/horn',
        from: [0.16, 0.85, 0],
        to: [0.46, 0.83, 0],
        halfA: 0.075,
        halfB: 0.075,
        taper: [1, 0.18],
        segments: 6,
        rings: SIMPLE_RINGS,
        paint: ironPaint,
        deep: C.ironShadow,
        lastTier: 1
      })
    ],
    budgets: [440, 250, 130, 46],
    distanceScale: 0.8,
    seed,
    material: 'stone'
  })

/** The bowyer's stave rack: a frame with six roughed longbow staves leaning in it. */
export const createStaveRackAsset = (seed = 1): WorldAsset => {
  const members: StructureMember[] = [
    ...[-1, 1].map(side =>
      beam({
        name: `rack/leg-${side}`,
        from: [side * 0.7, -0.1, 0.28],
        to: [side * 0.66, 1.5, -0.2],
        halfA: 0.06,
        halfB: 0.06,
        segments: 5,
        rings: SIMPLE_RINGS,
        paint: timberPaint,
        deep: C.timberShadow
      })
    ),
    beam({
      name: 'rack/rail',
      from: [-0.74, 1.34, -0.15],
      to: [0.74, 1.34, -0.15],
      halfA: 0.05,
      halfB: 0.05,
      segments: 5,
      rings: SIMPLE_RINGS,
      paint: timberPaint,
      deep: C.timberShadow
    })
  ]
  for (let i = 0; i < 6; i++) {
    const x = (i - 2.5) * 0.2
    members.push(
      beam({
        name: `rack/stave-${i}`,
        from: [x, -0.06, 0.3 + (i % 2) * 0.04],
        to: [x + 0.03, 1.86 + (i % 3) * 0.07, -0.24],
        halfA: 0.028,
        halfB: 0.042,
        segments: 5,
        rings: SIMPLE_RINGS,
        paint: (u, v, out) => {
          out.copy(C.woodBase).lerp(C.woodLit, 0.25 + 0.4 * (0.5 + 0.5 * Math.cos(4 * Math.PI * v)))
          out.lerp(C.barkBase, 0.5 * smoothstep(0.7, 1.0, u))
        },
        deep: C.woodShadow,
        lastTier: 1
      })
    )
  }
  return buildStructureAsset({
    name: `stave-rack-${seed}`,
    perfTag: 'village',
    members,
    budgets: [560, 310, 140, 66],
    distanceScale: 0.9,
    seed
  })
}

/** A hollowed-log water trough. Smithy yard and the well. */
export const createTroughAsset = (seed = 1): WorldAsset =>
  buildStructureAsset({
    name: `trough-${seed}`,
    perfTag: 'village',
    members: [
      beam({
        name: 'trough/body',
        from: [-0.9, 0.24, 0],
        to: [0.9, 0.24, 0],
        halfA: 0.27,
        halfB: 0.27,
        section: LOG_SECTION,
        segments: 8,
        rings: SIMPLE_RINGS,
        paint: logEndPaint,
        deep: C.barkDark,
        ao: 0.7
      }),
      // The water, as a flat inset lid. It is *not* on the water material: this
      // is 30 cm of standing water in a log and giving it the world's wave
      // shader would be a second program for a puddle.
      beam({
        name: 'trough/water',
        from: [-0.78, 0.4, 0],
        to: [0.78, 0.4, 0],
        halfA: 0.19,
        halfB: 0.02,
        section: PLANK_SECTION,
        roll: Math.PI * 0.5,
        segments: 5,
        rings: SIMPLE_RINGS,
        paint: (u, _v, out) => {
          out.copy(C.waterMid).lerp(C.waterShallow, 0.35 + 0.3 * bands(u, 0.3, 2))
          out.lerp(C.waterDeep, 0.3)
        },
        deep: C.waterDeep,
        ao: 0.4,
        lastTier: 1
      })
    ],
    budgets: [280, 160, 80, 30],
    distanceScale: 0.8,
    seed
  })

/**
 * ─── The hunting net ────────────────────────────────────────────────────────
 *
 * The trap that Chapter 1 opens on, and until now the only thing in the world
 * that said it existed was four people talking about it.
 *
 * The prose is explicit: the party has strung a net across the clearing, driven
 * the Trollschwein into it, and the boar comes *through* it. The player arrives
 * at a clearing, hears three companions discuss the net they have just set, and
 * looks at an empty patch of grass — which does not read as a subtle set piece,
 * it reads as a missing asset, and it is the first thing the chapter shows.
 *
 * ── What makes a net read as a net ──────────────────────────────────────────
 *
 * Holes. A net is defined by what is not there, so it cannot be a painted panel:
 * a sheet with a mesh painted on it is a tarpaulin at any distance where the
 * paint resolves, and a grey rectangle at any distance where it does not. So the
 * cords are modelled — seven down and four across — and the gaps between them
 * are the asset.
 *
 * They are `beam`s on `SIMPLE_RINGS` at four segments, which is 16 triangles a
 * cord, and they carry a **belly**: each cord's midpoint is pushed back out of
 * the net's plane by an amount that peaks in the middle of the panel. A net hung
 * between two stakes is not flat, and a flat one is a tennis net.
 *
 * ── And the ropes going off to the trees ────────────────────────────────────
 *
 * Four guys, 5.5 m each, running from the stake heads out and down to pegs. They
 * are the longest lines in the prop and they are what makes it read as
 * *rigging* rather than as a fence: a taut line disappearing off toward a tree
 * says somebody tied this to something, which is the whole difference between a
 * trap and a barrier.
 *
 * They are part of this asset rather than separate placements because a rope has
 * to *reach* something, and a `Placement` carries a uniform scale — a rope prop
 * long enough for one tree is the wrong length for every other tree, and scaling
 * it to fit would scale its thickness with it.
 */
const NET_HALF = 2.6
const NET_TOP = 2.05

/** Hemp cord: pale, dry, and lit along one side. */
const cordPaint = (u: number, v: number, out: Color): void => {
  out.copy(C.strawBase).lerp(C.strawLit, 0.24 + 0.3 * (0.5 + 0.5 * Math.cos(2 * Math.PI * v)))
  out.lerp(C.strawShadow, 0.42 * bands(u, 0.19, 2))
}

export const createHuntNetAsset = (seed = 1): WorldAsset => {
  const members: StructureMember[] = []

  // ── The two stakes ───────────────────────────────────────────────────────
  //
  // Leaning *outward*, away from the net, which is the direction a stake takes
  // when the thing tied to it pulls inward. A pair of vertical posts reads as a
  // gate; a pair splayed against a load reads as rigging.
  for (const side of [-1, 1] as const) {
    members.push(
      beam({
        name: `net/stake-${side}`,
        from: [side * NET_HALF, -0.25, 0],
        to: [side * (NET_HALF + 0.32), NET_TOP + 0.28, 0.04],
        halfA: 0.085,
        halfB: 0.085,
        section: LOG_SECTION,
        segments: 6,
        rings: SIMPLE_RINGS,
        paint: (u, v, out) => {
          out.copy(C.barkBase).lerp(C.barkDark, 0.3 + 0.3 * bands(v, 0.1, 3))
          // Freshly cut and sharpened: pale heartwood at the top.
          out.lerp(C.woodLit, 0.45 * smoothstep(0.88, 1.0, u))
        },
        deep: C.barkDark,
        ao: 0.6
      })
    )
  }

  // The head rope, sagging between the stake heads. One member with a five-point
  // path rather than a straight `beam`, because the catenary is the single line
  // in this prop that tells you the net has weight on it.
  members.push({
    name: 'net/head',
    path: [
      [-NET_HALF - 0.28, NET_TOP + 0.24, 0.03],
      [-NET_HALF * 0.5, NET_TOP - 0.02, 0.06],
      [0, NET_TOP - 0.09, 0.07],
      [NET_HALF * 0.5, NET_TOP - 0.02, 0.06],
      [NET_HALF + 0.28, NET_TOP + 0.24, 0.03]
    ] as Vec3[],
    extentA: [0, 0.026, 0.026, 0.026, 0],
    extentB: [0, 0.026, 0.026, 0.026, 0],
    segments: 4,
    rings: SIMPLE_RINGS,
    paint: cordPaint,
    deep: C.strawShadow
  })

  /** How far out of the net's plane a cord bellies, by how central it is. */
  const belly = (t: number): number => 0.42 * Math.cos((t * Math.PI) / 2) ** 2

  // ── Seven cords down ─────────────────────────────────────────────────────
  const downs = 7
  for (let i = 0; i < downs; i++) {
    const t = (i / (downs - 1)) * 2 - 1
    const x = t * (NET_HALF - 0.1)
    const out = belly(Math.abs(t))
    members.push({
      name: `net/down-${i}`,
      path: [
        [x, NET_TOP - 0.06, 0.06],
        [x + out * 0.12, NET_TOP * 0.62, out * 0.7],
        [x + out * 0.16, NET_TOP * 0.3, out],
        [x + out * 0.1, 0.12, out * 0.72]
      ] as Vec3[],
      extentA: [0, 0.019, 0.019, 0],
      extentB: [0, 0.019, 0.019, 0],
      segments: 4,
      rings: SIMPLE_RINGS,
      paint: cordPaint,
      deep: C.strawShadow,
      // The outer two go at LOD1. Seven cords is what makes the mesh read; five
      // is what makes it read at 30 m, and the ones that can be spared are the
      // ones nearest the stakes, where the stake is already drawing a line.
      ...(i === 0 || i === downs - 1 ? { lastTier: 1 } : {})
    })
  }

  // ── Four cords across ────────────────────────────────────────────────────
  //
  // LOD0 only. A horizontal at this thickness is under a pixel by the distance
  // LOD1 starts at, and at that range the vertical cords alone still say net.
  const acrossAt = [0.42, 0.86, 1.3, 1.72]
  for (const [i, y] of acrossAt.entries()) {
    // Deepest where the net hangs furthest out, i.e. in the middle of its height.
    const out = 0.42 * Math.sin((y / NET_TOP) * Math.PI) ** 0.6
    members.push({
      name: `net/across-${i}`,
      path: [
        [-NET_HALF + 0.08, y + 0.06, 0.05],
        [-NET_HALF * 0.45, y, out * 0.85],
        [NET_HALF * 0.45, y, out * 0.85],
        [NET_HALF - 0.08, y + 0.06, 0.05]
      ] as Vec3[],
      extentA: [0, 0.017, 0.017, 0],
      extentB: [0, 0.017, 0.017, 0],
      segments: 4,
      rings: SIMPLE_RINGS,
      paint: cordPaint,
      deep: C.strawShadow,
      lastTier: 0
    })
  }

  // ── The guys ─────────────────────────────────────────────────────────────
  //
  // Two off each stake head, running back and out to a peg 5.5 m away. Straight
  // members, because a guy under tension *is* straight — the head rope sags and
  // these do not, and the contrast between the two is what says which of them is
  // carrying the load.
  //
  // They survive to LOD2 while the net's own cords do not, which is the right
  // way round however odd it looks in a list: a 5.5 m line is legible from much
  // further away than a 2 m one, and from anywhere but close up these four are
  // the whole silhouette of the trap.
  for (const side of [-1, 1] as const) {
    for (const [i, back] of [-1, 1].entries()) {
      members.push(
        beam({
          name: `net/guy-${side}-${i}`,
          from: [side * (NET_HALF + 0.3), NET_TOP + 0.2, 0.02],
          to: [side * (NET_HALF + 3.5), 0.06, back * 4.2],
          halfA: 0.022,
          halfB: 0.022,
          segments: 4,
          rings: SIMPLE_RINGS,
          paint: cordPaint,
          deep: C.strawShadow,
          lastTier: 2
        })
      )
      // The peg it is tied to. Without one the rope ends in mid-air, which is
      // the one thing more obviously wrong than no rope at all.
      members.push(
        beam({
          name: `net/peg-${side}-${i}`,
          from: [side * (NET_HALF + 3.52), -0.16, back * 4.24],
          to: [side * (NET_HALF + 3.4), 0.24, back * 4.06],
          halfA: 0.045,
          halfB: 0.045,
          section: LOG_SECTION,
          segments: 5,
          rings: SIMPLE_RINGS,
          paint: (u, v, out) => {
            out.copy(C.barkBase).lerp(C.barkDark, 0.35 + 0.3 * bands(v, 0.12, 3))
            out.lerp(C.woodLit, 0.4 * smoothstep(0.85, 1.0, u))
          },
          deep: C.barkDark,
          ao: 0.8,
          lastTier: 1
        })
      )
    }
  }

  return buildStructureAsset({
    name: `hunt-net-${seed}`,
    perfTag: 'village',
    members,
    budgets: [820, 420, 200, 90],
    // 1.4 rather than a prop's usual 1: this is a set piece the player is meant
    // to see from across a clearing, and its whole content is thin lines.
    distanceScale: 1.4,
    seed
  })
}
