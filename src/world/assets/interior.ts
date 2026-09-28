import { Color } from 'three'
import { C } from '../art/palette'
import {
  bands,
  beam,
  box,
  boxHeightAt,
  buildStructureAsset,
  clamp01,
  CURVED_RINGS,
  daubMottle,
  FLAT_RINGS,
  roof,
  flatTimber,
  LOG_SECTION,
  PLANK_SECTION,
  SIMPLE_RINGS,
  smoothstep,
  type StructureMember,
  type Vec3,
  WALL_RINGS,
  WALL_SECTION
} from './structure'
import { shinglePaint } from './village'
import type { WorldAsset } from './types'

/**
 * ─── Inside the storyteller's hut ───────────────────────────────────────────
 *
 * One furnished room, built from a precise list: a sparse wooden table, a jug of
 * wine from the store cupboard, a big chest the smith drops his hammer into, a
 * cushion fetched for an old man's back, two full pails of water carried in from
 * the river, and a door somebody stands in to shout down the road.
 *
 * Every one of those is below, because every one of them is *used* — the frame
 * act is a scene about a household getting ready to sit down, and a room with
 * nothing in it to fetch is a room with nothing to play.
 *
 * ── Why the room is placeable parts, not one asset ──────────────────────────
 *
 * The obvious build is a single `hut-room` prop. It fails on collision: a
 * `Placement` carries **one** collider (`level/types.ts`), and one box around a
 * room is either solid — you cannot get in — or empty — you walk through the
 * walls. Neither is a room.
 *
 * So the shell is four wall slabs, a floor and a rafter set, each its own
 * catalogue row with its own box collider, assembled by the level. That also
 * makes it reusable: the same three wall lengths build a different room in a
 * different chapter, which one baked `hut-room` never could.
 *
 * ── The room is 12.8 × 10.8 m, and it used to be 6.4 × 5.4 ─────────────────
 *
 * Doubled on both axes, which is four times the floor. The old room was sized
 * from the *blocking* — five marks and a camera lane between them — and that is
 * not the same as being able to walk around in it: with a hearth on one wall, a
 * bed on another, a dresser on the third, a table with four stools round it in
 * the middle and a chest and a work block by the door, the clear floor left over
 * was about 2 m × 1.5 m in two disconnected pieces. Playing it, the household
 * stood inside the furniture and the player could not get from the door to the
 * fire without walking through the table.
 *
 * Nothing here is a longer wall, though. Every slab is still one of the three
 * lengths below and the room is *composed* of more of them — two 6.4 m runs make
 * a long wall, two 5.4 m runs make a side — because a 12.8 m slab would need its
 * own budget row and its own stud count, and because the window bays have to
 * interrupt a wall run somewhere anyway. Parts that tile are what made that
 * free.
 *
 * ── Why there is no ceiling, and why there is now a roof ────────────────────
 *
 * The rafters span overhead and the *underside* of the roof is still not
 * modelled. That is a camera decision. The story camera sits 5.6 m behind the
 * player and 2.9 m up; inside a room 2.9 m to the wall plate it is at the roof
 * line, so a closed ceiling means every interior beat is played against the
 * inside of a roof.
 *
 * What is new is that the roof exists at all, as `hut-roof` — a separate
 * placement carrying a shingled gable — and that the story layer can *veil* it:
 * `World.setPlacementVeil` drives the instanced field's own crossfade coverage,
 * so the roof dissolves into the same ordered dither the LOD system uses
 * whenever the player is inside the room or talking to somebody who is. From
 * outside it is a building with a roof on it; from inside it is a room you can
 * see, and the transition costs no material, no program and no sorting.
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

/** The wall slab's own bevel, shared with the paint so it can invert the map. */
const WALL_BEVEL = 0.02

/**
 * ─── An interior wall: daub between studs, with a dark skirt at the floor ───
 *
 * Different from `structure.ts::timberFrame` in one way that matters indoors:
 * the outside of a wall is weathered at the *bottom*, where rain splashes it,
 * and the inside is sooted at the *top*, where a hearth with no chimney puts its
 * smoke. A room painted with the exterior's own gradient reads as a wall seen
 * from the wrong side, which is exactly what it would be.
 *
 * It is also the surface in this project that is read from **closest** — the
 * story camera sits 5.6 m back in a room 6.4 m across, so a wall is 3 m away and
 * a 14 cm stud is 44 screen pixels. Everything the exterior facade has to smear
 * over is legible here, which is why the studs are modelled below rather than
 * approximated by a cosine in `v` (the old `|cos(10πv)|⁹`, which put five
 * "studs" per half-turn of the section — on a 26:1 slab that is four of them
 * crammed into the 24 cm end and one across the whole 6.4 m face).
 *
 * `u` arrives as a `box` ring parameter, not a height; `boxHeightAt` converts.
 * The old code compared it against 0.66 and 0.72 as though it were a height, and
 * on the old `box` polygon those resolved to 0.998 and 0.999 — the mid-rail and
 * the soot line were both painted on the wall plate.
 */
const interiorWall = (u: number, v: number, out: Color): void => {
  interiorWallAt(boxHeightAt(u, WALL_BEVEL), v, out)
}

/**
 * The same paint, keyed on a height that the *caller* supplies.
 *
 * Split out for the window bay. Its wall is three boxes stacked — a sill panel,
 * two jambs and a head panel — and each of them maps its own `u` over its own
 * height, so a panel that runs from 2.14 m to 2.86 m would otherwise paint a
 * sill at its bottom and a wall plate at its top: three little half-timbered
 * walls stacked on each other rather than one wall with a hole in it.
 *
 * `panelPaint` below converts a panel's local `u` into the wall's own fraction
 * and calls this, so every feature lands where it does on a plain slab.
 */
const interiorWallAt = (h: number, v: number, out: Color): void => {
  // Sill, mid-rail and plate. The rail sits at the same 0.611 the exterior uses,
  // which is where `WALL_RINGS` puts a row in three of the four tiers.
  const sill = smoothstep(0.075, 0.03, h)
  const plate = smoothstep(0.90, 0.955, h)
  const rail = smoothstep(0.055, 0.012, Math.abs(h - 0.611))
  const wood = clamp01(Math.max(sill, Math.max(plate, rail)))
  const panel = 1 - wood

  out.copy(C.daubBase).lerp(C.daubLit, clamp01(0.44 + 0.26 * (1 - h) + 0.10 * daubMottle(h, v) * panel))
  // Soot, gathering under the rafters.
  out.lerp(C.timberShadow, 0.4 * smoothstep(0.72, 1.0, h))
  // A skirting shadow where the floor meets the wall — the one thing that stops
  // an interior reading as a flat backdrop.
  out.lerp(C.daubShadow, 0.5 * smoothstep(0.12, 0.0, h))
  out.lerp(C.timberBase, wood)
  out.lerp(C.timberLit, wood * 0.3 * (0.4 + 0.6 * (1 - h)))
}

// ─── The shell ──────────────────────────────────────────────────────────────

/**
 * One wall slab, with its frame.
 *
 * `length` is along X and the slab is 0.24 m thick, which is a real daub wall on
 * a real frame and is also thick enough that its box collider does not need a
 * fudge factor to stop the player clipping a corner.
 *
 * ── Why the studs pass through the wall ─────────────────────────────────────
 *
 * A room's wall slab is seen from **both** sides — from inside by the story
 * camera, and from outside wherever the `house-cottage` shell around it does not
 * reach. Applying studs to one face would therefore have to be done twice, at
 * twice the cost. So each stud is 0.31 m thick against the slab's 0.24 and
 * stands 3.5 cm proud on *both* faces from one member, which is also how a real
 * frame is built: the stud is the wall's thickness and the daub is packed
 * between the studs, not laid over them.
 *
 * 3.5 cm of relief is 11 screen pixels at the 3 m this is read from, and it buys
 * a real AO line down both sides of every panel — `bakeVertexAO` can find a
 * 3.5 cm re-entrant, and it cannot find a painted one.
 *
 * Half-thickness 0.155 against the catalogue's 0.16 collider half-depth, which
 * is the 4 cm skin of air `index.ts` documents; the studs eat 3.5 cm of it and
 * still leave the render surface inside the collider.
 */
const wallAsset = (id: string, length: number, budget: readonly [number, number, number, number]): WorldAsset => {
  const half = length * 0.5
  const members: StructureMember[] = [
    box({
      name: `${id}/slab`,
      y0: -0.12,
      // 2.86, up from 2.32. A room four times the floor area under a 2.3 m wall
      // plate is a shed: the eye reads a room's proportion as its span against
      // its height, and 12.8 : 2.3 is 5.6 : 1 where the old room was 2.8 : 1.
      // 2.86 puts it back to 4.5 : 1, which is a hall a smith could have built
      // and is still low enough that the rafters are part of the room rather
      // than a distant ceiling.
      y1: 2.86,
      halfX: half,
      halfZ: 0.12,
      // Almost none: an interior wall is plumb, and the 4 % batter that makes
      // an exterior read as built makes an interior read as a tent.
      batter: 0.99,
      bevel: WALL_BEVEL,
      section: WALL_SECTION,
      rings: WALL_RINGS,
      segmentsByTier: [16, 12, 8, 8],
      // No inscribed-polygon compensation: `WALL_SECTION` is sampled on its
      // own control points at all three counts, so there is nothing to
      // compensate and the default would grow the wall 6.7 % by LOD3.
      inflate: 1,
      paint: interiorWall,
      deep: C.daubShadow,
      ao: 0.55
    }),
    // The wall plate — the beam the rafters land on. It runs the full length
    // and it is what ties the four walls into a room rather than four slabs.
    beam({
      name: `${id}/plate`,
      from: [-half, 2.92, 0],
      to: [half, 2.92, 0],
      halfA: 0.075,
      halfB: 0.09,
      segments: 6,
      rings: SIMPLE_RINGS,
      paint: timberPaint,
      deep: C.timberShadow
    })
  ]

  // One stud per ~1.35 m of wall, which is the spacing a hazel-and-daub panel is
  // actually woven at — wider and the wattle sags, narrower and it is a palisade.
  const studs = Math.max(1, Math.round(length / 1.35) - 1)
  for (let i = 0; i < studs; i++) {
    const x = -half + (length * (i + 1)) / (studs + 1)
    members.push(
      flatTimber({
        name: `${id}/stud-${i}`,
        from: [x, -0.1, 0],
        to: [x, 2.84, 0],
        half: 0.07,
        halfB: 0.155,
        paint: timberPaint,
        deep: C.timberShadow,
        ao: 0.8,
        lastTier: 1
      })
    )
  }

  // A brace in each end panel, rising toward the middle of the wall — the
  // diagonal is the one line in a timber frame that says which way the loads go,
  // and it is the feature a painted facade provably cannot draw (see
  // `village.ts::appliedFrame`).
  const braces = length > 4 ? [-1, 1] : [1]
  for (const s of braces) {
    members.push(
      flatTimber({
        name: `${id}/brace-${s}`,
        from: [s * half * 0.9, 0.12, 0],
        to: [s * half * (studs > 1 ? 0.52 : 0.2), 1.78, 0],
        half: 0.06,
        halfB: 0.15,
        paint: timberPaint,
        deep: C.timberShadow,
        ao: 0.75,
        lastTier: 1
      })
    )
  }

  return buildStructureAsset({
    name: id,
    perfTag: 'village',
    members,
    budgets: budget,
    distanceScale: 1.6,
    seed: length * 7
  })
}

export const createHutWallLongAsset = (): WorldAsset => wallAsset('hut-wall-long', 6.4, [340, 200, 110, 60])
export const createHutWallSideAsset = (): WorldAsset => wallAsset('hut-wall-side', 5.4, [340, 200, 110, 60])
export const createHutWallFlankAsset = (): WorldAsset => wallAsset('hut-wall-flank', 2.6, [340, 200, 110, 60])

/**
 * The floor: boards, laid across the room.
 *
 * Walkable, and one of only two props in the catalogue that are.
 *
 * ── It is flush now, and it used to stand 0.1 m proud ───────────────────────
 *
 * The old note said the boards stood 10 cm above the terrain "so the room has a
 * threshold — a floor flush with the ground outside is a floor nobody can see
 * the edge of, and the doorway stops reading as a doorway". That was true of a
 * room with no walls above waist height and no door frame. It is not true now,
 * and it was never free:
 *
 *   * the **cast** is placed at `groundAt`, which samples the *terrain*, so
 *     every one of the five people in this room stood 10 cm inside its floor —
 *     and a seated figure, whose feet are the lowest thing on it, lost its soles
 *     entirely;
 *   * the **player** is not, because `walkable` puts them on the collider's top
 *     at `placement.y + height`, and that height was 0.4 against a visual top of
 *     0.1. So the player walked the room 30 cm above the boards while everybody
 *     else was 10 cm under them.
 *
 * 2 cm proud and a 2 cm collider puts all three on the same surface. The
 * threshold is now the door frame's own reveal and the wall's 24 cm of thickness,
 * which is what a threshold is.
 */
export const createHutFloorAsset = (): WorldAsset =>
  buildStructureAsset({
    name: 'hut-floor',
    perfTag: 'village',
    members: [
      box({
        name: 'hut-floor/boards',
        y0: -0.38,
        y1: 0.02,
        // Half-extents of the doubled room plus 10 cm, so the boards run under
        // the wall slabs rather than stopping at their inside face — the same
        // 0.1 the old 3.3 × 2.8 carried over a 6.4 × 5.4 room.
        halfX: 6.5,
        halfZ: 5.5,
        batter: 1,
        bevel: 0.06,
        paint: (u, v, out) => {
          planedPaint(u, v, out)
          // Boards, running across the room. `v` is the section parameter, so
          // this is a band per board and it survives the floor being rotated.
          out.lerp(C.woodShadow, 0.5 * (1 - bands(v, 0.055, 9)))
          // Worn pale down the middle, where a household walks.
          out.lerp(C.woodLit, 0.22 * smoothstep(0.35, 0.5, bands(v, 0.5, 1)))
        },
        // 12, up from the default. The board bands are a function of `v`, and
        // on a doubled floor 8 samples put one board every 1.6 m — which is a
        // stripe, not a floorboard. This costs 4 quads a band and is the one
        // place in the room where a section sample is buying a *paint* feature
        // rather than a shape (the same argument `WALL_RINGS` makes).
        segments: 12,
        deep: C.woodShadow,
        ao: 0.4
      })
    ],
    budgets: [200, 120, 70, 40],
    distanceScale: 1.6,
    seed: 3
  })

/**
 * The rafters: five ties and a ridge, spanning the room overhead.
 *
 * No thatch above them — see the header. They are the whole of what says
 * "indoors" once the ceiling is cut away, so they are modelled rather than
 * painted and they survive to the coarsest tier.
 */
export const createHutRaftersAsset = (): WorldAsset => {
  const members: StructureMember[] = []
  // Seven ties across a 12.8 m room rather than five across a 6.4 m one, which
  // keeps them 1.9 m apart instead of stretching the same five to 3.2 m. The
  // spacing is what makes a set of ties read as a roof: at 3.2 m they read as
  // five loose beams, and the eye has no way to tell whether they are structure
  // or decoration.
  const ties = [-0.86, -0.575, -0.29, 0, 0.29, 0.575, 0.86]
  for (const at of ties) {
    // Just inside the walls, which stand at x = ±6.4. The first pass on the old
    // room multiplied by the full length and the roof came out 9.4 m across a
    // 6.4 m room; the same trap is here, one factor of two larger.
    const x = at * 6.3
    members.push(
      beam({
        name: `rafter-${at}`,
        from: [x, 2.96, -5.75],
        to: [x, 2.96, 5.75],
        halfA: 0.075,
        halfB: 0.095,
        segments: 5,
        rings: SIMPLE_RINGS,
        paint: timberPaint,
        deep: C.timberShadow,
        ao: 0.8,
        // The four intermediate ties go at LOD1. A tie is 15 cm deep against a
        // 12.8 m room — under a pixel from outside the door — and the three
        // that carry principals are the ones that describe the structure.
        ...(at === -0.86 || at === 0 || at === 0.86 ? {} : { lastTier: 1 })
      })
    )
    // The principal rafters, rising to the ridge. Only on the outer three, so
    // the roof reads as a structure rather than as a comb.
    if (at === -0.86 || at === 0 || at === 0.86) {
      for (const side of [-1, 1]) {
        members.push(
          beam({
            name: `principal-${at}-${side}`,
            from: [x, 2.98, side * 5.75],
            to: [x, 5.0, side * 0.14],
            halfA: 0.06,
            halfB: 0.08,
            segments: 5,
            rings: SIMPLE_RINGS,
            paint: timberPaint,
            deep: C.timberShadow,
            lastTier: 2
          })
        )
      }
    }
  }
  members.push(
    beam({
      name: 'ridge',
      from: [-6.6, 5.06, 0],
      to: [6.6, 5.06, 0],
      halfA: 0.095,
      halfB: 0.115,
      segments: 6,
      rings: SIMPLE_RINGS,
      paint: timberPaint,
      deep: C.timberShadow
    })
  )
  return buildStructureAsset({
    name: 'hut-rafters',
    perfTag: 'village',
    members,
    // Up from [560, 320, 150, 90]: seven ties and a ridge is two more beams
    // than five and a ridge, and the room they span is four times the area.
    // GDD §4.1 carries the row.
    budgets: [700, 380, 170, 100],
    distanceScale: 1.6,
    seed: 5
  })
}

// ─── Windows ────────────────────────────────────────────────────────────────

/** Top and bottom of a wall slab, so the bay's panels can share its paint. */
const WALL_BOTTOM = -0.12
const WALL_TOP = 2.86

/**
 * `interiorWall`, remapped so a panel occupying part of the wall's height
 * paints the part of the wall it actually occupies.
 *
 * `boxHeightAt(u)` is the panel's *own* 0..1; the two multiplies put it back on
 * the wall's. See `interiorWallAt`.
 */
const panelPaint =
  (y0: number, y1: number) =>
  (u: number, v: number, out: Color): void => {
    const local = boxHeightAt(u, WALL_BEVEL)
    interiorWallAt((y0 + local * (y1 - y0) - WALL_BOTTOM) / (WALL_TOP - WALL_BOTTOM), v, out)
  }

/** The window opening, in the bay's local frame. */
const BAY_HALF = 1.4
const OPEN_HALF = 1.02
const OPEN_SILL = 1.02
const OPEN_HEAD = 2.14

/**
 * ─── A wall unit with a window in it ────────────────────────────────────────
 *
 * The hut had no windows, and it could not have one: `wallAsset` builds a slab
 * from a single `box`, and there is no way to cut a hole in a swept extrusion.
 * So the opening is made the way a timber-framed building actually makes one —
 * by *stopping the panels* — and the bay is a fourth wall length that the room
 * uses wherever it wants light.
 *
 * ── Two panels, not four ────────────────────────────────────────────────────
 *
 * A sill panel below the opening and a head panel above it, and no jamb panels
 * either side: the opening runs 2.04 m of the bay's 2.8, and the 38 cm left at
 * each end is *filled by the jamb post itself* rather than by a slab of daub
 * that would be one stud wide. That is both what a real frame does at a wide
 * opening and what the budget allows — a `box` on `WALL_RINGS` is 160 triangles
 * and four of them would cost more than the two houses beside it.
 *
 * The panels run on `SIMPLE_RINGS` at 10 segments rather than the slab's
 * `WALL_RINGS` at 16. `WALL_RINGS` exists to put vertex rows on the sill, the
 * mid-rail and the plate so `interiorWall` can paint them; a panel 1.14 m tall
 * contains at most one of those three, and `panelPaint` already knows which.
 *
 * ── The glass is a separate placement ───────────────────────────────────────
 *
 * `buildStructureAsset` gives an asset exactly one material, and glass needs a
 * different one — see `structure.ts`'s `glass` ramp and its `transparent`.
 * `hut-glass` is therefore its own row in the catalogue, placed at the same
 * transform as the bay. That is the same argument the room itself is built on:
 * a `Placement` carries one collider and one material, so anything that needs
 * two of either is two placements.
 */
export const createHutWindowBayAsset = (): WorldAsset => {
  const members: StructureMember[] = [
    box({
      name: 'bay/sill-panel',
      y0: WALL_BOTTOM,
      y1: OPEN_SILL,
      halfX: BAY_HALF,
      halfZ: 0.12,
      batter: 0.99,
      bevel: WALL_BEVEL,
      section: WALL_SECTION,
      rings: SIMPLE_RINGS,
      segments: 10,
      inflate: 1,
      paint: panelPaint(WALL_BOTTOM, OPEN_SILL),
      deep: C.daubShadow,
      ao: 0.55
    }),
    box({
      name: 'bay/head-panel',
      y0: OPEN_HEAD,
      y1: WALL_TOP,
      halfX: BAY_HALF,
      halfZ: 0.12,
      batter: 0.99,
      bevel: WALL_BEVEL,
      section: WALL_SECTION,
      rings: SIMPLE_RINGS,
      segments: 10,
      inflate: 1,
      paint: panelPaint(OPEN_HEAD, WALL_TOP),
      deep: C.daubShadow,
      ao: 0.55
    }),
    beam({
      name: 'bay/plate',
      from: [-BAY_HALF, 2.92, 0],
      to: [BAY_HALF, 2.92, 0],
      halfA: 0.075,
      halfB: 0.09,
      segments: 6,
      rings: SIMPLE_RINGS,
      paint: timberPaint,
      deep: C.timberShadow
    })
  ]

  // The jambs. 0.155 half-depth against the wall's 0.12, so like the slab's
  // studs they stand 3.5 cm proud on *both* faces from one member and buy an AO
  // line down each side of the opening from inside and from outside at once.
  for (const side of [-1, 1] as const) {
    members.push(
      flatTimber({
        name: `bay/jamb-${side}`,
        from: [side * (OPEN_HALF + 0.19), WALL_BOTTOM, 0],
        to: [side * (OPEN_HALF + 0.19), 2.84, 0],
        half: 0.19,
        halfB: 0.155,
        paint: timberPaint,
        deep: C.timberShadow,
        ao: 0.8
      })
    )
  }

  // Sill board and lintel, running past the jambs so the opening has a frame
  // rather than a pair of stops.
  for (const [name, y, halfA, halfB] of [
    ['bay/sill', OPEN_SILL, 0.075, 0.17],
    ['bay/lintel', OPEN_HEAD, 0.065, 0.15]
  ] as const) {
    members.push(
      flatTimber({
        name,
        from: [-BAY_HALF + 0.1, y, 0],
        to: [BAY_HALF - 0.1, y, 0],
        half: halfA,
        halfB,
        paint: timberPaint,
        deep: C.timberShadow,
        ao: 0.85,
        lastTier: 2
      })
    )
  }

  // The mullion and the transom, which are what make this read as a *window*
  // and not as a hole: a 2 m by 1.1 m opening with nothing crossing it is a
  // doorway that starts a metre up.
  members.push(
    flatTimber({
      name: 'bay/mullion',
      from: [0, OPEN_SILL, 0],
      to: [0, OPEN_HEAD, 0],
      half: 0.055,
      halfB: 0.09,
      paint: timberPaint,
      deep: C.timberShadow,
      ao: 0.7,
      lastTier: 1
    }),
    flatTimber({
      name: 'bay/transom',
      from: [-OPEN_HALF, (OPEN_SILL + OPEN_HEAD) * 0.5, 0],
      to: [OPEN_HALF, (OPEN_SILL + OPEN_HEAD) * 0.5, 0],
      half: 0.045,
      halfB: 0.085,
      paint: timberPaint,
      deep: C.timberShadow,
      ao: 0.7,
      lastTier: 1
    })
  )

  return buildStructureAsset({
    name: 'hut-window-bay',
    perfTag: 'village',
    members,
    budgets: [460, 260, 140, 80],
    distanceScale: 1.6,
    seed: 41
  })
}

/**
 * The glazing for one bay: a single thin pane filling the whole opening.
 *
 * One member rather than four. The mullion and the transom stand 3 cm proud of
 * the glass, so they read as dividing it whether or not the glass is actually
 * divided — and four panes would be four sorted transparent draws where this is
 * one.
 *
 * ── The paint is a reflection, not a colour ────────────────────────────────
 *
 * Glass has no albedo worth speaking of; what a window shows is the sky, and
 * what makes it read as glass rather than as a hole is that the sky it shows is
 * *not* the sky behind it. So the pane runs from `skyHorizon` at the bottom to
 * `skyZenith` at the top — inverted relative to the real sky behind it — with a
 * broad diagonal wipe across it, which is the one cue that says "there is a flat
 * surface here" when everything else about it is transparent.
 */
export const createHutGlassAsset = (): WorldAsset =>
  buildStructureAsset({
    name: 'hut-glass',
    perfTag: 'village',
    material: 'glass',
    // No inverted hull. See `StructureSpec.outline`: on a translucent pane it is
    // an opaque dark rectangle standing two pixels outside the glass, and it is
    // a draw call per tier on a prop placed four times in one room.
    outline: false,
    members: [
      beam({
        name: 'glass/pane',
        from: [-OPEN_HALF + 0.02, (OPEN_SILL + OPEN_HEAD) * 0.5, 0],
        to: [OPEN_HALF - 0.02, (OPEN_SILL + OPEN_HEAD) * 0.5, 0],
        // ── `halfA` is the wall's *thickness*, not the pane's height ────────
        //
        // `beam` builds its frame from the member's own direction: for one
        // running along +X it takes `axisA = dir × up = +Z` and
        // `axisB = axisA × dir = +Y`. So on a horizontal member `halfA` is
        // measured **across** the run horizontally and `halfB` vertically —
        // the opposite way round from a vertical member, where the fallback
        // frame makes `halfA` the width and `halfB` the thickness.
        //
        // These two were the other way round, and the result was a pane
        // **1.08 m thick through the wall and 16 mm tall**: a sheet of glass
        // lying flat like a shelf, jutting a half-metre into the room and a
        // half-metre out into the yard. It is the one mistake in this file that
        // nothing catches — the budget is unchanged, the geometry is finite,
        // and from head-on it even looks like a window.
        halfA: 0.008,
        halfB: (OPEN_HEAD - OPEN_SILL) * 0.5 - 0.02,
        section: PLANK_SECTION,
        segments: 8,
        rings: FLAT_RINGS,
        paint: (u, v, out) => {
          // ── The face test has a period of *half* a turn ──────────────────
          //
          // `v` runs once round the section. `PLANK_SECTION` is eight control
          // points and its two broad faces sit at v ≈ 0 and v ≈ 0.44, with the
          // two cut edges between them at v ≈ 0.19 and v ≈ 0.69. A full-turn
          // test — which is what `village.ts`'s window reveal uses, and what
          // this was copied from — marks **one** broad face as glass and the
          // other as lead. On an opaque reveal that is invisible; on a pane the
          // player looks *through*, with a `DoubleSide` material chosen for
          // exactly that reason, it means the window is a dark board seen from
          // inside the room.
          const face = smoothstep(0.17, 0.07, Math.abs(((v + 0.25) % 0.5) - 0.25))
          // Height up the pane, and it has to read the same on both faces. The
          // section's own y peaks at v ≈ 0.19 and troughs at v ≈ 0.69, so this
          // is 1 at the head and 0 at the sill whichever side you are standing.
          const up = 0.5 + 0.5 * Math.cos(2 * Math.PI * (v - 0.19))
          out.copy(C.skyHorizon).lerp(C.skyZenith, 0.25 + 0.5 * up)
          // The wipe. A low harmonic, so it survives the section dropping to
          // four samples at LOD3 instead of turning into a different pane.
          out.lerp(C.waterSparkle, 0.35 * face * smoothstep(0.25, 0.62, u + 0.35 * up))
          // The cut edges of the glass and the lead round them — the only
          // opaque-looking thing on the pane.
          out.lerp(C.ironShadow, 0.7 * (1 - face))
        },
        deep: C.skyHorizon,
        // No AO. Ambient occlusion darkens a surface by how enclosed it is, and
        // a pane in a reveal is enclosed on all four sides — baking it would
        // put a dark border on the one surface whose whole job is to be bright.
        ao: 0
      })
    ],
    budgets: [120, 70, 40, 24],
    distanceScale: 1.6,
    seed: 43
  })

// ─── The roof ───────────────────────────────────────────────────────────────

/**
 * ─── A shingled roof over the room, and why it can be looked through ────────
 *
 * The hut had no roof at all. From outside it was four walls and a set of
 * rafters standing in a field, which is a building site rather than a house —
 * and the neighbours twelve metres away all had roofs, so it read as a mistake
 * rather than as a convention.
 *
 * ── Shingle, not thatch ─────────────────────────────────────────────────────
 *
 * Two reasons, and the first is the manuscript's. The frame story's household is
 * a *smith's*: there is a forge attached to the house, the father walks in from
 * it with a hammer in his hand, and `village.ts` already says shingle is for
 * "the roofs that must not burn". The second is that the storyteller's house has
 * to be findable — three thatched neighbours and one grey roof is a landmark you
 * can walk back to, where four thatched roofs is a hamlet you get lost in.
 *
 * ── And why it dissolves ────────────────────────────────────────────────────
 *
 * The room is played from inside, by a story camera 5.6 m back and 2.9 m up. A
 * closed roof over it means every interior beat is shot through the underside of
 * a roof; cutting the ceiling away is what `interior.ts` has always done, and it
 * is why there are rafters and nothing above them.
 *
 * The roof is therefore a *veiled* prop rather than a permanent one:
 * a caller uses `World.setPlacementVeil('hut-roof', …)` whenever the camera
 * is inside the room, and the
 * instanced field multiplies the coverage into the same signed `aFade`
 * attribute the LOD crossfade already writes. So it goes see-through through the
 * ordered dither this whole world dissolves things with — no transparency, no
 * sorting, no second material, no program.
 *
 * The reason it is a separate placement at all is the same one everything else
 * in this room is: the veil is per-*field*, and a field is per-`defId`. A roof
 * that was a member of the wall asset could not be dissolved without dissolving
 * the walls with it.
 */
export const createHutRoofAsset = (): WorldAsset => {
  // 6.9 of ridge against the room's 6.4, and 5.9 of span against its 5.4: half a
  // metre of overhang on all four sides. The eaves shadow is what plants a
  // building on the ground (`village.ts` makes the same argument at 22 cm), and
  // a roof this large flush with its walls would read as a lid.
  const halfRidge = 6.4
  const halfSpan = 5.9
  const eaves = 2.92
  const rise = 2.35

  const members: StructureMember[] = [
    roof({
      name: 'hut-roof/shingles',
      from: [-halfRidge, eaves, 0],
      to: [halfRidge, eaves, 0],
      halfSpan,
      rise,
      kind: 'shingle',
      // A shingled roof is laid on boards on rafters and does not settle the way
      // straw does, so 2 cm across 12.8 m rather than the cottage's 7.5.
      sag: 0.02,
      paint: shinglePaint,
      deep: C.shingleShadow,
      ao: 0.5
    })
  ]

  // Barge boards on the two gables. `ROOF_E` rounds the section away over the
  // last 7 % of the ridge, which is right for straw combed over an end and wrong
  // for shingle — a shingled gable is cut square and finished with a board, and
  // without one the two ends of this roof were the only rounded thing on an
  // otherwise entirely arrised building.
  for (const end of [-1, 1] as const) {
    for (const side of [-1, 1] as const) {
      members.push(
        flatTimber({
          name: `hut-roof/barge-${end}-${side}`,
          from: [end * (halfRidge - 0.12), eaves + rise * 0.99, 0],
          to: [end * (halfRidge - 0.12), eaves + rise * 0.06, side * (halfSpan - 0.1)],
          half: 0.075,
          halfB: 0.16,
          paint: (u, v, colour) => {
            planedPaint(u, v, colour)
            colour.lerp(C.shingleShadow, 0.35)
          },
          deep: C.shingleShadow,
          ao: 0.8,
          lastTier: 1
        })
      )
    }
  }

  return buildStructureAsset({
    name: 'hut-roof',
    perfTag: 'village',
    members,
    budgets: [340, 200, 110, 60],
    distanceScale: 2.4,
    seed: 47
  })
}

// ─── The storyteller's chair ────────────────────────────────────────────────

/**
 * The chair the old man sits in, and the only seat in the room with a back.
 *
 * The book puts him "in a chair by the fire" and has a cushion fetched for his
 * back, so a back is not decoration — it is the thing the objective refers to.
 * Everyone else in the household sits on `hut-stool`, which has three legs and
 * no back, and that difference is the blocking: in a wide shot of the room the
 * one figure with a frame behind their shoulders is the one telling the story.
 *
 * Four legs, not three. `hut-stool`'s note says three because a four-legged
 * stool rocks on a board floor — true, and it is exactly why a *chair* has four:
 * it is not moved, it lives beside the hearth, and its back needs two feet
 * behind it or it tips when somebody leans on it.
 */
export const createHutChairAsset = (): WorldAsset => {
  const members: StructureMember[] = [
    // ── The seat: a plank, and it was a fin ────────────────────────────────
    //
    // `halfA` is the half-extent along `beam`'s **axisA**, and `roll: π/2` puts
    // axisA on world **up** for a member laid horizontally — `hut-table` and
    // `village-bench` both rely on that, and both pass the *thickness* as
    // `halfA`. This one passed the width. Measured on the built tier-0 mesh:
    // the seat came out **0.068 m wide, 0.57 m tall**, spanning y 0.055 → 0.625,
    // i.e. a vertical fin running front-to-back down the middle of the chair
    // where the seat should be. It survived because the storyteller has been
    // sitting on it since the day it was written: the fin is thinner than his
    // hips and the dialogue camera never sees the one strip it shows.
    //
    // Swapped rather than un-rolled, because `PLANK_SECTION` holds its flats on
    // the `a = ±1` faces (four control points each, against two on `b = ±1`) —
    // which have to be the plank's broad faces, and are only the broad faces
    // when `halfA` is the thin one.
    //
    // 0.305 rather than 0.34, for the same reason the whole room came down a
    // third: `SEAT_HEIGHT.chair` is 0.34 and `characters/postures.ts` solves the
    // seated leg against the surface the buttocks rest on. A plank whose
    // *centre* is at 0.34 has its top at 0.375, so a solved sit put the figure
    // 3.5 cm inside its own chair. Centre 0.305 + half 0.035 = a top face at
    // 0.34, which is what the stool already does (its seat beam is vertical, so
    // its 0.34 is the top by construction).
    beam({
      name: 'chair/seat',
      from: [0, 0.305, -0.24],
      to: [0, 0.305, 0.26],
      halfA: 0.035,
      halfB: 0.27,
      section: PLANK_SECTION,
      roll: Math.PI * 0.5,
      // Eight, and a plank cannot have fewer — `hut-table` measured this: a
      // 10:1 section sampled at six has no vertex on either flat and collapses
      // to a lens, so the seat renders as a small tent.
      segments: 8,
      rings: SIMPLE_RINGS,
      paint: (u, v, out) => {
        planedPaint(u, v, out)
        // Worn pale in the middle, where sixty years of one man have sat.
        out.lerp(C.woodLit, 0.24 * smoothstep(0.3, 0.55, bands(u, 0.5, 1)))
        out.lerp(C.woodShadow, 0.4 * (1 - bands(v, 0.2, 7)))
      },
      deep: C.woodShadow,
      ao: 0.6
    })
  ]

  // Legs. The back pair rise past the seat and become the back's stiles, which
  // is how a chair of this period is actually made and is 32 triangles cheaper
  // than four legs plus two stiles.
  for (const sx of [-1, 1] as const) {
    members.push(
      flatTimber({
        name: `chair/front-${sx}`,
        from: [sx * 0.235, 0, 0.21],
        // 0.32, so the leg dies **inside** the seat rather than 1 cm proud of
        // it. It was 0.35 against a plank whose mid-plane was 0.34 — buried by
        // the same 1 cm — and the seat has since come down to a 0.305 centre.
        to: [sx * 0.2, 0.32, 0.19],
        half: 0.032,
        paint: timberPaint,
        deep: C.timberShadow,
        ao: 0.75,
        lastTier: 2
      }),
      flatTimber({
        name: `chair/stile-${sx}`,
        from: [sx * 0.235, 0, -0.2],
        to: [sx * 0.205, 0.92, -0.31],
        half: 0.034,
        paint: timberPaint,
        deep: C.timberShadow,
        ao: 0.75
      })
    )
  }

  // Two back slats and a crest rail. Three horizontals across two stiles is a
  // ladder-back, which is the one chair silhouette that is unmistakable at the
  // 6 m the dialogue camera sits at.
  for (const [i, y] of [0.55, 0.73, 0.9].entries()) {
    const lean = -0.24 - (y - 0.35) * 0.115
    members.push(
      flatTimber({
        name: `chair/slat-${i}`,
        from: [-0.21, y, lean],
        to: [0.21, y, lean],
        half: i === 2 ? 0.055 : 0.04,
        halfB: 0.022,
        paint: (u, v, colour) => {
          planedPaint(u, v, colour)
          colour.lerp(C.woodShadow, 0.3)
        },
        deep: C.woodShadow,
        ao: 0.7,
        lastTier: i === 2 ? 2 : 1
      })
    )
  }

  // One stretcher, front only. A full set of four is 64 triangles of thing
  // nobody can see under a seat; the front one is the one a sitter's heels rest
  // on and the only one that ever catches the light.
  members.push(
    flatTimber({
      name: 'chair/stretcher',
      from: [-0.22, 0.13, 0.2],
      to: [0.22, 0.13, 0.2],
      half: 0.026,
      paint: timberPaint,
      deep: C.timberShadow,
      ao: 0.85,
      lastTier: 1
    })
  )

  return buildStructureAsset({
    name: 'hut-chair',
    perfTag: 'village',
    members,
    budgets: [400, 230, 120, 64],
    distanceScale: 0.9,
    seed: 53
  })
}

// ─── What is on the walls ───────────────────────────────────────────────────

/**
 * ─── Three wall pieces, and why a room needs them ───────────────────────────
 *
 * Everything in this room until now was *furniture*: things standing on the
 * floor, all of them between 0.4 m and 1.6 m tall. Above that line the room was
 * 2.9 m of blank daub on every side, and blank daub is what makes an interior
 * read as a set — the eye has nothing to rest on between the dresser and the
 * rafters.
 *
 * The three below are chosen so that each says something the dialogue does not
 * have to:
 *
 *   * **the hammers** — this is a smith's house, three generations deep. The
 *     father walks in with one and drops it in the chest; these are the ones
 *     that are not in use, which is what a wall of tools means.
 *   * **the pelt and the antlers** — the old man was a hunter before he was a
 *     storyteller, and the chapter he is about to tell is a hunt. They are the
 *     room's only argument that the story is his.
 *   * **the portrait** — Athalus, who is not in this room and never will be.
 *
 * ── All three are LOD1 at the coarsest, and none of them has a collider ─────
 *
 * They hang between 1.6 m and 2.4 m, above a standing figure's shoulder and
 * below the wall plate, on walls that already carry a collider. A second
 * collider there would be a box in mid-air you cannot walk under.
 */
export const createHutHammersAsset = (): WorldAsset => {
  const members: StructureMember[] = [
    // The rack: one board with pegs, which is what tools hang on. Without it
    // three hammers on a wall read as three hammers *stuck to* a wall.
    flatTimber({
      name: 'hammers/rack',
      from: [-0.62, 0.44, 0],
      to: [0.62, 0.44, 0],
      half: 0.055,
      halfB: 0.05,
      paint: timberPaint,
      deep: C.timberShadow,
      ao: 0.8
    })
  ]

  // Three, at three weights: a sledge, a cross-pein and a small planishing
  // hammer. Same shape at three sizes would read as one hammer badly
  // instanced — the spread of head-to-haft ratio is the whole point.
  for (const [i, spec] of (
    [
      [-0.42, 0.5, 0.105, 0.052],
      [0.02, 0.42, 0.082, 0.04],
      [0.4, 0.33, 0.062, 0.032]
    ] as const
  ).entries()) {
    const [x, length, headHalf, hardware] = spec
    // The sledge survives one tier further than the other two. Partly because
    // it is half again their size and is the last of the three still legible;
    // partly because `flatTimber` pins `segmentsByTier` to [4, 4, 4, 4] and
    // `FLAT_RINGS` is identical at LOD2 and LOD3, so a rack that is the *only*
    // member at both tiers builds the same 8 triangles twice — which
    // `assets.test.ts` fails outright, and correctly: a ladder whose last two
    // rungs are the same mesh is one wasted crossfade.
    const tier = i === 0 ? 2 : 1
    members.push(
      flatTimber({
        name: `hammers/haft-${i}`,
        from: [x, 0.4, 0.05],
        to: [x + 0.02, 0.4 - length, 0.05],
        half: 0.019,
        halfB: 0.016,
        paint: (u, v, colour) => {
          planedPaint(u, v, colour)
          colour.lerp(C.leatherBase, 0.55 * smoothstep(0.55, 0.85, u))
        },
        deep: C.woodShadow,
        ao: 0.7,
        lastTier: tier
      }),
      flatTimber({
        name: `hammers/head-${i}`,
        from: [x - headHalf, 0.4, 0.05],
        to: [x + headHalf, 0.4, 0.05],
        half: hardware,
        halfB: hardware * 0.92,
        paint: (u, _v, colour) => {
          colour.copy(C.ironBase).lerp(C.ironLit, 0.3 + 0.35 * u)
          // The struck face is bright where it is peened and dark where it is
          // not — the one thing that says a tool is used rather than displayed.
          colour.lerp(C.steelLit, 0.5 * smoothstep(0.84, 1.0, u))
          colour.lerp(C.ironShadow, 0.4 * smoothstep(0.3, 0.05, u))
        },
        deep: C.ironShadow,
        ao: 0.6,
        lastTier: tier
      })
    )
  }

  return buildStructureAsset({
    name: 'hut-hammers',
    perfTag: 'village',
    members,
    budgets: [260, 150, 80, 40],
    distanceScale: 0.6,
    seed: 59
  })
}

/**
 * A wolf's pelt, nailed flat.
 *
 * Built as one swept member whose extent goes shoulders–waist–haunch–tail, plus
 * four legs pinned out sideways. A skin on a wall is the one shape here that is
 * *not* rectangular, which is the whole reason it is worth 170 triangles beside
 * a board of hammers and a framed panel: three rectangles on a wall is a
 * noticeboard.
 *
 * Colour comes from `bandit*` — the world's most desaturated cloth field —
 * grizzled with `boarBristle` down the spine and `boneBase` on the belly. There
 * is no wolf in the palette and this world does not take hex literals (GDD R2),
 * so a grey animal is composed rather than picked.
 */
export const createHutPeltAsset = (): WorldAsset => {
  const furPaint = (u: number, v: number, out: Color): void => {
    // `u` runs nose (0) to tail (1); `v` round the section, so the middle of a
    // half-turn is the spine and the edges are the flanks.
    const spine = 0.5 + 0.5 * Math.cos(2 * Math.PI * v)
    // ── Started from the lit end of the field, not the base ──────────────
    //
    // `banditBase` is 0x3d3b3f, the most desaturated and nearly the darkest
    // cloth colour in the palette, and it is that dark on purpose: five bandits
    // breaking out of a treeline have to read as shapes. A pelt is the opposite
    // problem — it hangs on a wall *indoors*, in a room lit by one hearth and
    // whatever gets past a roof, and starting from `banditBase` there put a
    // black rectangle on the wall. Looked at in the browser it was the darkest
    // thing in the room by a wide margin, including the hearth's own flue.
    out.copy(C.banditLit).lerp(C.boneBase, 0.2 + 0.34 * (1 - spine))
    // The dark saddle a grey wolf carries over its shoulders and back.
    out.lerp(C.boarBristle, 0.5 * spine * smoothstep(0.08, 0.3, u))
    // Pale throat and belly.
    out.lerp(C.boneLit, 0.55 * (1 - spine) * smoothstep(0.42, 0.14, u))
    // Guard hairs: one low harmonic along the length. `CURVED_RINGS` gives this
    // member eight rows at LOD0 and three at LOD3, so anything finer is a
    // different animal per tier.
    out.lerp(C.banditBase, 0.34 * bands(u, 0.17, 2))
  }

  const members: StructureMember[] = [
    {
      name: 'pelt/hide',
      path: [
        [0, 0.62, 0],
        [0, 0.5, 0.005],
        [0, 0.22, 0.012],
        [0, -0.16, 0.012],
        [0, -0.5, 0.008],
        [0, -0.78, 0.004]
      ] as Vec3[],
      // Head, neck, shoulders, waist, haunches, tail.
      extentA: [0, 0.17, 0.29, 0.2, 0.27, 0],
      extentB: [0, 0.035, 0.05, 0.042, 0.045, 0],
      segments: 7,
      rings: CURVED_RINGS,
      paint: furPaint,
      deep: C.banditShadow,
      ao: 0.55
    }
  ]

  // Four legs, splayed. A skin nailed to a wall is nailed by its legs, and it is
  // the four points sticking out of the outline that say "pelt" rather than
  // "rug" or "cloak".
  for (const [i, spec] of (
    [
      [-1, 0.2, -0.34, 0.3],
      [1, 0.2, -0.34, 0.3],
      [-1, -0.42, -0.66, 0.26],
      [1, -0.42, -0.66, 0.26]
    ] as const
  ).entries()) {
    const [side, y0, y1, reach] = spec
    members.push(
      flatTimber({
        name: `pelt/leg-${i}`,
        from: [side * 0.16, y0, 0.008],
        to: [side * reach, y1, 0.004],
        half: 0.05,
        halfB: 0.02,
        taper: [1, 0.4],
        paint: furPaint,
        deep: C.banditShadow,
        ao: 0.6,
        lastTier: 1
      })
    )
  }

  return buildStructureAsset({
    name: 'hut-pelt',
    perfTag: 'village',
    members,
    budgets: [320, 180, 90, 44],
    distanceScale: 0.7,
    seed: 61
  })
}

/**
 * A stag's antlers on a skull plate.
 *
 * The one object in the room with a silhouette that is mostly *gaps*, which is
 * why it is worth modelling six little beams instead of painting a shape: an
 * antler read as a solid mass is a branch, and the thing that makes it an antler
 * is that you can see the wall through it.
 */
export const createHutAntlersAsset = (): WorldAsset => {
  const bonePaint = (u: number, v: number, out: Color): void => {
    out.copy(C.boneBase).lerp(C.boneLit, 0.24 + 0.36 * u + 0.18 * bands(v, 0.25, 2))
    out.lerp(C.boneShadow, 0.4 * (1 - bands(v, 0.3, 3)))
  }

  const members: StructureMember[] = [
    // The skull plate the pair are cut off with, and the board it is fixed to.
    flatTimber({
      name: 'antlers/plate',
      from: [0, -0.1, 0.03],
      to: [0, 0.12, 0.05],
      half: 0.09,
      halfB: 0.06,
      paint: bonePaint,
      deep: C.boneShadow,
      ao: 0.75
    }),
    flatTimber({
      name: 'antlers/board',
      from: [0, -0.24, 0],
      to: [0, 0.2, 0],
      half: 0.15,
      halfB: 0.025,
      paint: (u, v, colour) => {
        planedPaint(u, v, colour)
        colour.lerp(C.woodShadow, 0.35)
      },
      deep: C.woodShadow,
      ao: 0.85,
      // Down to LOD2. `flatTimber` builds the same 8 triangles at LOD2 and
      // LOD3 — `FLAT_RINGS` and `segmentsByTier` are identical there — so a
      // set of members that all survive to the bottom gives two tiers of
      // exactly the same mesh, which `assets.test.ts` rejects and which is one
      // crossfade spent on nothing.
      lastTier: 2
    })
  ]

  for (const side of [-1, 1] as const) {
    // The main beam, sweeping up and out.
    members.push(
      flatTimber({
        name: `antlers/beam-${side}`,
        from: [side * 0.07, 0.1, 0.04],
        to: [side * 0.46, 0.62, 0.14],
        half: 0.032,
        halfB: 0.026,
        taper: [1, 0.55],
        paint: bonePaint,
        deep: C.boneShadow,
        ao: 0.5
      })
    )
    // Three tines a side, off the beam at increasing height. Two is a goat and
    // four is a budget; three is a stag anybody would recognise.
    for (const [i, at] of [0.24, 0.5, 0.76].entries()) {
      const bx = side * (0.07 + 0.39 * at)
      const by = 0.1 + 0.52 * at
      const bz = 0.04 + 0.1 * at
      members.push(
        flatTimber({
          name: `antlers/tine-${side}-${i}`,
          from: [bx, by, bz],
          to: [bx + side * 0.06, by + 0.15 + 0.05 * i, bz + 0.06],
          half: 0.022,
          halfB: 0.019,
          taper: [1, 0.3],
          paint: bonePaint,
          deep: C.boneShadow,
          ao: 0.45,
          lastTier: 1
        })
      )
    }
  }

  return buildStructureAsset({
    name: 'hut-antlers',
    perfTag: 'village',
    members,
    budgets: [320, 180, 90, 44],
    distanceScale: 0.7,
    seed: 67
  })
}

/**
 * ─── A small painting of Athalus ────────────────────────────────────────────
 *
 * The chapter's hero, on the wall of a room he is not in, in a story told sixty
 * years after it happened by the man who was standing next to him.
 *
 * ── It is painted, and the paint is the asset ───────────────────────────────
 *
 * One panel and four frame members. Everything that makes it a *portrait*
 * happens in `figurePaint` below, which is 20 lines of `smoothstep` and is the
 * only place in this world where vertex colour is asked to draw a picture
 * rather than a material.
 *
 * That is only possible because of the section count: `PLANK_SECTION` at 24
 * samples on `CURVED_RINGS` gives the panel a 24 by 8 grid on its front face,
 * which is about the resolution of a very coarse tapestry — and a very coarse
 * tapestry is exactly what a 40 cm panel seen from 2 m in a stylised world
 * should look like. Asking for a likeness would need a texture, and there are no
 * prop textures here (GDD R8).
 *
 * The figure follows `cast.ts`: dark blond, shoulder-length, swept back; the
 * broadest shoulders in the chapter; and the arms empty, which is the one thing
 * the book insists on about him.
 */
export const createHutPortraitAsset = (): WorldAsset => {
  const HALF_W = 0.21
  const HALF_H = 0.27

  const figurePaint = (u: number, v: number, out: Color): void => {
    // `u` runs bottom (0) to top (1) of the panel; `v` runs round the section,
    // and the front face is the middle of one half-turn. `across` is −1 at the
    // left edge of the front face and +1 at the right.
    const face = smoothstep(0.32, 0.2, Math.abs(((v + 0.5) % 1) - 0.5))
    const across = clamp01((((v + 0.5) % 1) - 0.25) * 4 - 1) * 2 - 1
    const fromCentre = Math.abs(across)

    // Ground: a dark warm field, lighter behind the head so the figure reads.
    out.copy(C.timberShadow).lerp(C.leatherBase, 0.25 + 0.3 * u)
    out.lerp(C.daubShadow, 0.4 * smoothstep(0.55, 0.85, u) * smoothstep(0.9, 0.4, fromCentre))

    // The shoulders: a broad trapezium from a third of the way up to the neck.
    const shoulders = smoothstep(0.2, 0.3, u) * smoothstep(0.66, 0.58, u) * smoothstep(0.82, 0.6, fromCentre)
    out.lerp(C.tunicBase, 0.9 * shoulders)
    out.lerp(C.tunicLit, 0.4 * shoulders * smoothstep(0.35, 0.0, fromCentre))

    // The head. Narrower and higher, and its own oval rather than a rectangle:
    // the product of two smoothsteps in u and one in `fromCentre` is enough of
    // an oval at eight rows.
    const head = smoothstep(0.63, 0.7, u) * smoothstep(0.88, 0.8, u) * smoothstep(0.36, 0.2, fromCentre)
    out.lerp(C.skinTone2, 0.95 * head)

    // Hair: shoulder-length, swept back, so it is *wider* than the head and
    // reaches lower. `cast.ts` calls this his read, and it is the only feature
    // at this resolution that can carry it.
    const hair =
      smoothstep(0.6, 0.66, u) * smoothstep(0.92, 0.86, u) * smoothstep(0.5, 0.34, fromCentre) * (1 - head * 0.85)
    out.lerp(C.hairBase, 0.85 * hair)
    out.lerp(C.strawBase, 0.35 * hair * smoothstep(0.86, 0.7, u))

    // Heraldic red and gold, bottom corner: a painter's mark, and the one
    // saturated accent that stops the panel reading as a brown rectangle.
    const mark = smoothstep(0.16, 0.09, u) * smoothstep(0.95, 0.78, fromCentre)
    out.lerp(C.bannerRed, 0.7 * mark)
    out.lerp(C.bannerGold, 0.5 * mark * smoothstep(0.13, 0.1, u))

    // Everything above is the *front*. The panel's edges take the board it is
    // painted on.
    out.lerp(C.woodShadow, 0.85 * (1 - face))
  }

  const members: StructureMember[] = [
    beam({
      name: 'portrait/panel',
      from: [0, -HALF_H, 0],
      to: [0, HALF_H, 0],
      halfA: HALF_W,
      halfB: 0.014,
      section: PLANK_SECTION,
      // 24, against the eight a plank normally gets. This is the one member in
      // the room whose section samples are buying *picture* rather than shape —
      // eight of them puts four samples across the whole front face, which is
      // one sample for the head and one for each shoulder.
      segments: 24,
      rings: CURVED_RINGS,
      paint: figurePaint,
      deep: C.timberShadow,
      // A painting in a frame is not occluded by anything; baking AO on it puts
      // a dark vignette over the figure.
      ao: 0.15
    })
  ]

  // The frame: four members mitred by overlap, standing 2 cm proud. It is what
  // makes the panel a *painting* — an unframed board on a wall is a board.
  for (const side of [-1, 1] as const) {
    members.push(
      flatTimber({
        name: `portrait/stile-${side}`,
        from: [side * (HALF_W + 0.028), -HALF_H - 0.028, 0.012],
        to: [side * (HALF_W + 0.028), HALF_H + 0.028, 0.012],
        half: 0.028,
        halfB: 0.026,
        paint: (u, v, colour) => {
          timberPaint(u, v, colour)
          colour.lerp(C.brassLit, 0.22 * bands(u, 0.28, 3))
        },
        deep: C.timberShadow,
        ao: 0.7,
        lastTier: 1
      }),
      flatTimber({
        name: `portrait/rail-${side}`,
        from: [-HALF_W - 0.028, side * (HALF_H + 0.028), 0.012],
        to: [HALF_W + 0.028, side * (HALF_H + 0.028), 0.012],
        half: 0.028,
        halfB: 0.026,
        paint: (u, v, colour) => {
          timberPaint(u, v, colour)
          colour.lerp(C.brassLit, 0.22 * bands(u, 0.28, 3))
        },
        deep: C.timberShadow,
        ao: 0.7,
        lastTier: 1
      })
    )
  }

  return buildStructureAsset({
    name: 'hut-portrait',
    perfTag: 'village',
    members,
    budgets: [560, 300, 150, 70],
    distanceScale: 0.6,
    seed: 71
  })
}

// ─── Furniture ──────────────────────────────────────────────────────────────

/**
 * "The sparse wooden table."
 *
 * A plank top on two trestles, which is what a table was before it was a piece
 * of furniture — and the shape matters here because the whole household gathers
 * round it in the frame act, so it has to read as a *board* rather than as a
 * dining table.
 */
export const createHutTableAsset = (): WorldAsset =>
  buildStructureAsset({
    name: 'hut-table',
    perfTag: 'village',
    members: [
      beam({
        name: 'table/top',
        // ── 0.56, and it was 0.76 ────────────────────────────────────────
        //
        // Every seat and every table in this room came down by a third, and the
        // arithmetic is in `characters/postures.ts`: the rig's hip-to-sole is
        // 0.62 m against a real adult's 0.90, so furniture authored at human
        // scale is furniture these figures cannot use. A 0.76 m board is chest
        // height on a seated one. Scaled by the same 0.62 / 0.90 this is a
        // 0.81 m table, which is a table.
        from: [-1.15, 0.56, 0],
        to: [1.15, 0.56, 0],
        halfA: 0.045,
        halfB: 0.46,
        section: PLANK_SECTION,
        roll: Math.PI * 0.5,
        // ── Eight, and a plank cannot have fewer ──────────────────────────
        //
        // `PLANK_SECTION` is a 10:1 rectangle. Sampled at six the inscribed
        // polygon has no vertex on either flat, so the section collapses to a
        // lens and the table top rendered as a small peaked tent on four legs.
        // Eight puts a sample on each face; `plateau.ts` measured the general
        // form of this once and it is the same failure.
        segments: 8,
        rings: SIMPLE_RINGS,
        paint: (u, v, out) => {
          planedPaint(u, v, out)
          out.lerp(C.woodShadow, 0.45 * (1 - bands(u, 0.16, 8)))
        },
        deep: C.woodShadow,
        ao: 0.55
      }),
      ...[-1, 1].flatMap(side => [
        // A trestle: two splayed legs and a cross-rail. Splayed, because a
        // table on vertical legs reads as modern and a trestle is the whole
        // point of the silhouette.
        beam({
          name: `table/leg-${side}-a`,
          from: [side * 0.78, 0, -0.34],
          to: [side * 0.72, 0.54, -0.06],
          halfA: 0.045,
          halfB: 0.045,
          segments: 5,
          rings: SIMPLE_RINGS,
          paint: timberPaint,
          deep: C.timberShadow,
          lastTier: 2
        }),
        beam({
          name: `table/leg-${side}-b`,
          from: [side * 0.78, 0, 0.34],
          to: [side * 0.72, 0.54, 0.06],
          halfA: 0.045,
          halfB: 0.045,
          segments: 5,
          rings: SIMPLE_RINGS,
          paint: timberPaint,
          deep: C.timberShadow,
          lastTier: 2
        })
      ]),
      beam({
        name: 'table/rail',
        from: [-0.8, 0.22, 0],
        to: [0.8, 0.22, 0],
        halfA: 0.04,
        halfB: 0.055,
        segments: 5,
        rings: SIMPLE_RINGS,
        paint: timberPaint,
        deep: C.timberShadow,
        lastTier: 1
      })
    ],
    budgets: [420, 240, 130, 70],
    distanceScale: 0.9,
    seed: 7
  })

/** A three-legged stool. Three, because a four-legged one rocks on a board floor. */
export const createHutStoolAsset = (): WorldAsset =>
  buildStructureAsset({
    name: 'hut-stool',
    perfTag: 'village',
    members: [
      beam({
        name: 'stool/seat',
        // 0.28–0.34, down from 0.44–0.50. See `hut-table`'s note and the
        // arithmetic in `characters/postures.ts`: at 0.5 the seated solution asks
        // for a thigh 64 degrees below horizontal, which is not sitting on a
        // stool, it is crouching against one. At 0.34 it is 20 degrees and the
        // soles land on the boards.
        from: [0, 0.28, 0],
        to: [0, 0.34, 0],
        halfA: 0.21,
        halfB: 0.21,
        segments: 9,
        rings: SIMPLE_RINGS,
        paint: (u, v, out) => {
          planedPaint(u * 2, v, out)
          out.lerp(C.woodShadow, 0.3 * bands(v, 0.2, 5))
        },
        deep: C.woodShadow,
        ao: 0.6
      }),
      ...[0, 1, 2].map(i => {
        const angle = (i / 3) * Math.PI * 2 + 0.4
        return beam({
          name: `stool/leg-${i}`,
          from: [Math.cos(angle) * 0.19, 0, Math.sin(angle) * 0.19],
          to: [Math.cos(angle) * 0.13, 0.29, Math.sin(angle) * 0.13],
          halfA: 0.032,
          halfB: 0.032,
          section: LOG_SECTION,
          segments: 5,
          rings: SIMPLE_RINGS,
          paint: timberPaint,
          deep: C.timberShadow,
          lastTier: 2
        })
      })
    ],
    budgets: [260, 150, 80, 44],
    distanceScale: 0.7,
    seed: 11
  })

/**
 * The hearth: a stone breast, a fire, and a pot hanging over it.
 *
 * The only light source in the room and the reason the wall paint above it is
 * sooted. The fire is the same `ember*` family the forge chimney uses, kept to a
 * small area for the reason the palette gives.
 */
export const createHutHearthAsset = (): WorldAsset =>
  buildStructureAsset({
    name: 'hut-hearth',
    perfTag: 'village',
    members: [
      box({
        name: 'hearth/breast',
        y0: -0.15,
        y1: 2.3,
        halfX: 1.05,
        halfZ: 0.42,
        batter: 0.62,
        bevel: 0.05,
        segments: 8,
        paint: (u, v, out) => {
          stonePaint(u * 1.2, v, out)
          // Sooted up the flue.
          out.lerp(C.timberShadow, 0.55 * smoothstep(0.4, 0.95, u))
        },
        deep: C.rockShadow,
        ao: 0.7
      }),
      // The opening: a dark recess with the fire in it. Standing 12 cm proud of
      // the breast so its jambs cast their own AO line, which is what makes it
      // read as a hole rather than as a painted rectangle.
      box({
        name: 'hearth/mouth',
        z: 0.3,
        y0: 0.0,
        y1: 0.95,
        halfX: 0.62,
        halfZ: 0.18,
        batter: 0.92,
        bevel: 0.1,
        segments: 7,
        paint: (u, _v, out) => {
          out.copy(C.rockShadow).lerp(C.skyZenithNight, 0.6 * smoothstep(0.75, 0.25, u))
          // The fire, in the bottom third only.
          out.lerp(C.emberDeep, 0.7 * smoothstep(0.34, 0.1, u))
          out.lerp(C.emberBase, 0.75 * smoothstep(0.26, 0.04, u))
          out.lerp(C.emberLit, 0.5 * smoothstep(0.14, 0.0, u))
        },
        deep: C.emberDeep,
        ao: 0.3,
        lastTier: 2
      }),
      // The mantel beam.
      beam({
        name: 'hearth/mantel',
        from: [-1.0, 1.12, 0.44],
        to: [1.0, 1.12, 0.44],
        halfA: 0.09,
        halfB: 0.1,
        segments: 6,
        rings: SIMPLE_RINGS,
        paint: (u, v, out) => {
          timberPaint(u, v, out)
          out.lerp(C.timberShadow, 0.45)
        },
        deep: C.timberShadow,
        lastTier: 2
      })
    ],
    budgets: [520, 300, 160, 80],
    distanceScale: 1.1,
    seed: 13
  })

/**
 * "A large chest", which the smith drops his hammer into on the way in.
 *
 * It is an interactive prop in the frame act, so its lid is modelled as a
 * separate slightly-domed slab: the player has to be able to see *which* part
 * of it opens, and at this size that is a 4 cm step and a shadow line.
 */
export const createHutChestAsset = (): WorldAsset =>
  buildStructureAsset({
    name: 'hut-chest',
    perfTag: 'village',
    members: [
      box({
        name: 'chest/body',
        y0: 0,
        y1: 0.58,
        halfX: 0.62,
        halfZ: 0.36,
        batter: 1,
        bevel: 0.07,
        segments: 8,
        paint: (u, v, out) => {
          planedPaint(u, v, out)
          const corner = clamp01(Math.abs(Math.cos(4 * Math.PI * v)) ** 6)
          out.lerp(C.timberBase, corner * 0.8)
          // Two iron bands round the body.
          const band = smoothstep(0.05, 0.02, Math.abs(u - 0.28)) + smoothstep(0.05, 0.02, Math.abs(u - 0.74))
          out.lerp(C.ironBase, clamp01(band) * 0.85)
        },
        deep: C.woodShadow,
        ao: 0.7
      }),
      {
        name: 'chest/lid',
        // Domed: a coffered lid, which is what a chest of this period has and
        // what stops it reading as a crate.
        path: [
          [0, 0.58, 0],
          [0, 0.6, 0],
          [0, 0.66, 0],
          [0, 0.72, 0],
          [0, 0.75, 0],
          [0, 0.76, 0]
        ] as Vec3[],
        extentA: [0, 0.64, 0.63, 0.58, 0.4, 0],
        extentB: [0, 0.38, 0.37, 0.33, 0.22, 0],
        segments: 8,
        rings: CURVED_RINGS,
        paint: (u, v, out) => {
          planedPaint(u, v, out)
          out.lerp(C.woodShadow, 0.4 * (1 - bands(v, 0.25, 6)))
          // The hasp, front centre.
          out.lerp(C.ironBase, 0.9 * smoothstep(0.1, 0.04, Math.abs(((v + 0.25) % 1) - 0.25)) * smoothstep(0.4, 0.9, u))
        },
        deep: C.woodShadow,
        ao: 0.6,
        lastTier: 2
      }
    ],
    budgets: [340, 200, 110, 60],
    distanceScale: 0.8,
    seed: 17
  })

/** A dresser: two shelves of crocks against the wall. */
export const createHutShelfAsset = (): WorldAsset => {
  const members: StructureMember[] = [
    ...[-1, 1].map(side =>
      beam({
        name: `shelf/upright-${side}`,
        from: [side * 0.72, 0, 0],
        to: [side * 0.72, 1.62, 0],
        halfA: 0.05,
        halfB: 0.14,
        section: PLANK_SECTION,
        roll: Math.PI * 0.5,
        segments: 8,
        rings: SIMPLE_RINGS,
        paint: planedPaint,
        deep: C.woodShadow
      })
    )
  ]
  for (const y of [0.5, 1.0, 1.5]) {
    members.push(
      beam({
        name: `shelf/board-${y}`,
        from: [-0.76, y, 0],
        to: [0.76, y, 0],
        halfA: 0.03,
        halfB: 0.15,
        section: PLANK_SECTION,
        roll: Math.PI * 0.5,
        segments: 8,
        rings: SIMPLE_RINGS,
        paint: planedPaint,
        deep: C.woodShadow,
        lastTier: 2
      })
    )
  }
  // Crocks. Three, at mixed sizes, because a shelf with matching pots on it
  // reads as a shop and this is a kitchen.
  for (const [i, spec] of ([[-0.42, 0.5, 0.11], [0.1, 0.5, 0.085], [0.44, 1.0, 0.1]] as const).entries()) {
    members.push(
      beam({
        name: `shelf/crock-${i}`,
        from: [spec[0], spec[1] + 0.02, 0],
        to: [spec[0], spec[1] + 0.02 + spec[2] * 2.1, 0],
        halfA: spec[2],
        halfB: spec[2],
        segments: 7,
        rings: SIMPLE_RINGS,
        paint: (u, _v, out) => {
          out.copy(C.sandstoneBase).lerp(C.sandstoneLit, 0.3 + 0.3 * u)
          out.lerp(C.sandstoneShadow, 0.5 * smoothstep(0.8, 1.0, u))
        },
        deep: C.sandstoneShadow,
        lastTier: 1
      })
    )
  }
  return buildStructureAsset({
    name: 'hut-shelf',
    perfTag: 'village',
    members,
    budgets: [640, 360, 180, 90],
    distanceScale: 0.9,
    seed: 19
  })
}

/**
 * A low bed with a straw mattress and, on it, **the cushion**.
 *
 * The cushion is the reason this prop exists: the first thing the storyteller
 * asks his grandson for is one for his back, and it is the frame act's first
 * playable objective. So it is a separate member in a separate colour, sitting
 * proud, at a height a nine-year-old can reach.
 */
export const createHutBedAsset = (): WorldAsset =>
  buildStructureAsset({
    name: 'hut-bed',
    perfTag: 'village',
    members: [
      box({
        name: 'bed/frame',
        y0: 0,
        // 0.26, down from 0.36, which puts the mattress top at 0.42. That is
        // the height `SEAT_HEIGHT.bed` solves against, and it is high enough
        // that sitting on this reads differently from sitting on a stool —
        // which is the whole reason `SIT_BED` is a third clip rather than an
        // alias.
        y1: 0.26,
        halfX: 1.0,
        halfZ: 0.58,
        batter: 1,
        bevel: 0.06,
        segments: 7,
        paint: timberPaint,
        deep: C.timberShadow,
        ao: 0.75
      }),
      {
        name: 'bed/mattress',
        path: [
          [0, 0.24, 0],
          [0, 0.27, 0],
          [0, 0.32, 0],
          [0, 0.39, 0],
          [0, 0.42, 0],
          [0, 0.44, 0]
        ] as Vec3[],
        extentA: [0, 0.96, 0.98, 0.95, 0.7, 0],
        extentB: [0, 0.54, 0.56, 0.53, 0.38, 0],
        segments: 8,
        rings: CURVED_RINGS,
        paint: (u, v, out) => {
          out.copy(C.strawBase).lerp(C.strawLit, 0.3 + 0.35 * bands(v, 0.13, 2) + 0.2 * u)
          out.lerp(C.strawShadow, 0.45 * smoothstep(0.3, 0.02, u))
        },
        deep: C.strawShadow,
        ao: 0.55
      },
      {
        name: 'bed/cushion',
        path: [
          [-0.52, 0.41, 0],
          [-0.52, 0.44, 0],
          [-0.52, 0.5, 0],
          [-0.52, 0.58, 0],
          [-0.52, 0.62, 0],
          [-0.52, 0.64, 0]
        ] as Vec3[],
        extentA: [0, 0.3, 0.32, 0.3, 0.2, 0],
        extentB: [0, 0.24, 0.26, 0.24, 0.16, 0],
        segments: 8,
        rings: CURVED_RINGS,
        paint: (u, v, out) => {
          // The one saturated field in the room, so a nine-year-old can be told
          // to fetch "the cushion" and find it without a marker.
          out.copy(C.tunicBase).lerp(C.tunicLit, 0.3 + 0.4 * u + 0.15 * bands(v, 0.25, 2))
          out.lerp(C.tunicShadow, 0.5 * smoothstep(0.25, 0.02, u))
        },
        deep: C.tunicShadow,
        ao: 0.5,
        lastTier: 2
      }
    ],
    budgets: [520, 300, 160, 80],
    distanceScale: 0.9,
    seed: 23
  })

/**
 * A water pail. The mother carries two in from the Arla, one in each hand.
 *
 * Modelled with the water in it, because an empty pail and a full one are the
 * same silhouette and the scene is about her having just carried them.
 */
export const createHutPailAsset = (): WorldAsset =>
  buildStructureAsset({
    name: 'hut-pail',
    perfTag: 'village',
    members: [
      {
        name: 'pail/body',
        path: [
          [0, -0.01, 0],
          [0, 0.01, 0],
          [0, 0.06, 0],
          [0, 0.24, 0],
          [0, 0.36, 0],
          [0, 0.38, 0]
        ] as Vec3[],
        extentA: [0, 0.14, 0.15, 0.17, 0.19, 0],
        extentB: [0, 0.14, 0.15, 0.17, 0.19, 0],
        segments: 9,
        rings: CURVED_RINGS,
        paint: (u, v, out) => {
          const stave = bands(v, 0.11, 3)
          out.copy(C.woodBase).lerp(C.woodLit, 0.2 + 0.35 * stave)
          out.lerp(C.woodShadow, 0.45 * (1 - bands(v, 0.11, 9)))
          out.lerp(C.ironBase, 0.85 * smoothstep(0.05, 0.02, Math.abs(u - 0.72)))
        },
        deep: C.woodShadow,
        ao: 0.7
      },
      {
        name: 'pail/water',
        path: [
          [0, 0.3, 0],
          [0, 0.31, 0],
          [0, 0.32, 0]
        ] as Vec3[],
        extentA: [0, 0.175, 0],
        extentB: [0, 0.175, 0],
        segments: 8,
        rings: SIMPLE_RINGS,
        paint: (_u, v, out) => {
          out.copy(C.waterMid).lerp(C.waterShallow, 0.3 + 0.25 * bands(v, 0.3, 2))
          out.lerp(C.waterDeep, 0.35)
        },
        deep: C.waterDeep,
        ao: 0.3,
        lastTier: 1
      },
      // The bail, as a single arc over the top.
      {
        name: 'pail/bail',
        path: [
          [-0.185, 0.34, 0],
          [-0.17, 0.46, 0],
          [0, 0.54, 0],
          [0.17, 0.46, 0],
          [0.185, 0.34, 0]
        ] as Vec3[],
        extentA: [0, 0.012, 0.012, 0.012, 0],
        extentB: [0, 0.012, 0.012, 0.012, 0],
        segments: 5,
        rings: CURVED_RINGS,
        paint: (_u, _v, out) => {
          out.copy(C.ironBase).lerp(C.ironLit, 0.35)
        },
        deep: C.ironShadow,
        lastTier: 1
      }
    ],
    budgets: [420, 240, 120, 60],
    distanceScale: 0.6,
    seed: 29
  })

/**
 * The jug of wine and two cups, on a board.
 *
 * "A storyteller with a dry throat cannot tell a good story." It is the prop the
 * frame act ends on — the father sets it out, the old man pours, and the chapter
 * begins.
 */
export const createHutWineAsset = (): WorldAsset =>
  buildStructureAsset({
    name: 'hut-wine',
    perfTag: 'village',
    members: [
      {
        name: 'wine/jug',
        path: [
          [0, 0, 0],
          [0, 0.02, 0],
          [0, 0.1, 0],
          [0, 0.22, 0],
          [0, 0.3, 0],
          [0, 0.34, 0],
          [0, 0.36, 0]
        ] as Vec3[],
        extentA: [0, 0.09, 0.13, 0.12, 0.06, 0.07, 0],
        extentB: [0, 0.09, 0.13, 0.12, 0.06, 0.07, 0],
        segments: 9,
        rings: CURVED_RINGS,
        paint: (u, v, out) => {
          out.copy(C.sandstoneBase).lerp(C.sandstoneLit, 0.25 + 0.35 * (0.5 + 0.5 * Math.cos(2 * Math.PI * v)))
          out.lerp(C.sandstoneShadow, 0.45 * smoothstep(0.8, 1.0, u) + 0.25 * smoothstep(0.2, 0.0, u))
        },
        deep: C.sandstoneShadow,
        ao: 0.65
      },
      ...[-1, 1].map(side => ({
        name: `wine/cup-${side}`,
        path: [
          [side * 0.22, 0, 0.05 * side],
          [side * 0.22, 0.01, 0.05 * side],
          [side * 0.22, 0.06, 0.05 * side],
          [side * 0.22, 0.11, 0.05 * side],
          [side * 0.22, 0.12, 0.05 * side]
        ] as Vec3[],
        extentA: [0, 0.045, 0.055, 0.06, 0] as number[],
        extentB: [0, 0.045, 0.055, 0.06, 0] as number[],
        segments: 7,
        rings: SIMPLE_RINGS,
        paint: (u: number, _v: number, out: Color) => {
          out.copy(C.woodBase).lerp(C.woodLit, 0.3)
          // Wine in the cup, at the very top.
          out.lerp(C.bannerRed, 0.7 * smoothstep(0.86, 0.98, u))
        },
        deep: C.woodShadow,
        ao: 0.6,
        lastTier: 1
      }))
    ],
    budgets: [380, 220, 110, 56],
    distanceScale: 0.6,
    seed: 31
  })

/**
 * The engraved dagger the smith has just finished for the count.
 *
 * A single line in the book — Arthus uses it as the reason his father has time
 * to listen — and it is here because it is the one object in the room that is
 * *about* the frame's own present tense: the war is over, and a smith's biggest
 * job is now decorative work for a nobleman.
 */
export const createHutDaggerBlockAsset = (): WorldAsset =>
  buildStructureAsset({
    name: 'hut-workblock',
    perfTag: 'village',
    members: [
      beam({
        name: 'block/stump',
        from: [0, -0.1, 0],
        to: [0.02, 0.62, 0.01],
        halfA: 0.28,
        halfB: 0.28,
        section: LOG_SECTION,
        segments: 8,
        rings: SIMPLE_RINGS,
        paint: (u, v, out) => {
          const end = smoothstep(0.72, 0.95, u)
          out.copy(C.barkBase).lerp(C.barkDark, 0.3 + 0.35 * bands(v, 0.09, 3))
          _c.copy(C.woodLit).lerp(C.woodBase, 0.4 + 0.5 * bands(v * 0.5 + u * 6, 0.16, 4))
          out.lerp(_c, end)
        },
        deep: C.barkDark,
        ao: 0.75
      }),
      // The dagger, lying on it. Small, and gold where the engraving is.
      beam({
        name: 'block/dagger',
        from: [-0.16, 0.64, -0.04],
        to: [0.18, 0.64, 0.05],
        halfA: 0.016,
        halfB: 0.035,
        section: PLANK_SECTION,
        segments: 8,
        rings: SIMPLE_RINGS,
        paint: (u, _v, out) => {
          out.copy(C.steelBase).lerp(C.steelLit, 0.35)
          // The hilt, and the count's gold on it.
          out.lerp(C.leatherBase, 0.85 * smoothstep(0.24, 0.1, u))
          out.lerp(C.brassLit, 0.8 * smoothstep(0.12, 0.02, u))
        },
        deep: C.steelShadow,
        ao: 0.4,
        lastTier: 1
      })
    ],
    budgets: [340, 200, 100, 50],
    distanceScale: 0.7,
    seed: 37
  })
