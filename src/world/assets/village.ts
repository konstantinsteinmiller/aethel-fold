import { Color } from 'three'
import { C } from '../art/palette'
import {
  bands,
  beam,
  BEAM_SECTION,
  box,
  boxHeightAt,
  buildStructureAsset,
  clamp01,
  FLAT_RINGS,
  flatTimber,
  LOG_SECTION,
  PLANK_SECTION,
  SIMPLE_RINGS,
  roof,
  smoothstep,
  type StructureMember,
  SHINGLE_AT,
  SHINGLE_COURSE,
  THATCH_AT,
  THATCH_COURSE,
  timberFrame,
  type Vec3,
  WALL_RINGS,
  WALL_SECTION
} from './structure'
import type { WorldAsset } from './types'

/**
 * ─── Nimmerschein ───────────────────────────────────────────────────────────
 *
 * The village Chapter 1 ends in: "a middling village of a little under 500
 * souls", walled with a palisade after the Forty Years' War, two gates, a market
 * square, and *der Treff* — a small place with benches and a fire pit where the
 * young people meet. The smithy is the only one in the village, it is a family
 * business handed down for generations, and it is the one house that is two
 * storeys and has a wash-room and a store built onto it. That last sentence is
 * the whole reason `house-smithy` is a separate generator rather than a taller
 * cottage: the book says it "stood out", so it has to stand out from across the
 * square, and the thing that makes a building stand out at 40 m is its
 * *silhouette*, not its size.
 *
 * ── Four house shapes, and why not one parameterised one ────────────────────
 *
 * A village of one house type at five scales is a housing estate. What separates
 * real vernacular buildings is the *roof-to-wall ratio* and where the door is,
 * and both are discrete rather than continuous:
 *
 *   * **cottage** — one storey, roof about as tall as the wall, door in the long
 *     side. The village's ordinary house, placed twenty times.
 *   * **longhouse** — the same section run out to twice the length, with the
 *     door in the gable end. Reads as a different building at any distance
 *     because its ridge is the longest line in the village.
 *   * **barn** — roof to the ground on both sides, no wall visible at all. The
 *     one shape in the set with no daub in it, which is what makes it read as a
 *     store rather than as a home.
 *   * **smithy** — two storeys with a **jettied** upper floor, a stone chimney
 *     and a lean-to forge. Two storeys alone is not enough; the jetty is what
 *     makes the outline unmistakable at range.
 *
 * ── Why the palisade is stakes at LOD0 and a slab at LOD2 ───────────────────
 *
 * The gaps between the stakes are the whole read of a palisade — a solid wall
 * with a zigzag top is a fence, not a stockade. So the near tiers are twelve
 * individually leaning split logs. Past about 60 m a stake is under a pixel
 * wide, twelve of them alias into a shimmering band, and they cost twelve times
 * the triangles of the painted slab that replaces them. See `firstTier` in
 * `structure.ts` — this is the substitution that field exists for.
 */

const _c = new Color()

// ─── Shared paints ──────────────────────────────────────────────────────────

/**
 * ─── Thatch ─────────────────────────────────────────────────────────────────
 *
 * `v` runs around the roof section, which — since a roof is one extrusion along
 * its ridge — is the direction the water runs, so everything a thatched roof has
 * is a band in `v` and `downslope` is the only coordinate that matters. It is 0
 * at the ridge, 1 at the middle of the soffit, and `THATCH_AT` names where the
 * section's own features land in it.
 *
 * The paint has to hit those features exactly, because half of them are now
 * *geometry*: the ridge cap, its edge face, the course laps and the eaves bead
 * are control points of `THATCH_SECTION`, and a colour that lands 6 % away from
 * a modelled crease reads as a printing error rather than as a shadow. The old
 * paint had no such anchors — it ran `bands(downslope, 0.13)` against a LOD0
 * vertex spacing of 0.125, i.e. **one sample per course**, so the courses were
 * aliasing noise and a *different* noise in each tier.
 *
 * ── The lap, and why it is asymmetric ───────────────────────────────────────
 *
 * A course of straw overhangs the one below, so the light does not fall
 * symmetrically about the lap line: there is a hard shadow immediately *under*
 * the overhang and the course brightens down its face toward its own cut butts.
 * A symmetric `bands()` ridge cannot say that, and it is most of why the old
 * roof read as corrugation rather than as straw.
 */
const thatchPaint = (u: number, v: number, out: Color): void => {
  const down = clamp01(Math.abs(((v + 0.5) % 1) * 2 - 1))

  // ── The course, and the two bugs that were in this line ──────────────────
  //
  // `courseFace` is 1 on the section's *proud* control-point rows — the cut
  // butts of a course, which face the sky — and 0 on its recessed ones, which
  // are the lap the course above throws its shadow into. One cosine, one cycle
  // per course, crest on the geometry's own crest.
  //
  // What it replaces was `q = ((down / THATCH_COURSE − 0.5) mod 1)` fed through
  // two `smoothstep`s, and both of them were wrong in a way only arithmetic
  // finds:
  //
  //   * **The phase was inverted.** A vertex row sits at `down = k/12`, so
  //     `q = (k/2 − 0.5) mod 1` is 0 on odd rows and 0.5 on even ones — and the
  //     odd rows (5, 7, 9) are exactly the rows the section pushes *proud*. So
  //     `lapShadow = smoothstep(0.30, 0, q)` painted the lap shadow onto every
  //     butt edge and left the laps neutral: the paint cancelled the relief the
  //     section had just been authored to carry, rather than reinforcing it.
  //   * **`butts` never fired at all.** `smoothstep(0.62, 1.0, q)` with q only
  //     ever 0 or 0.5 is identically zero at every vertex in every tier, so the
  //     `+0.34 * butts` term below — a third of the roof's whole tonal range —
  //     had no effect on any pixel that has ever been rendered.
  //
  // Together those are most of why the village's roofs read as flat tan planes
  // from the street: the only surviving variation was a dark band on the rows
  // that were supposed to be the bright ones.
  const courseFace = 0.5 - 0.5 * Math.cos((2 * Math.PI * down) / THATCH_COURSE)
  const lapShadow = 1 - courseFace
  const butts = courseFace

  // Combed, along the ridge. Two low harmonics rather than noise: `u` has only
  // seven ring rows at LOD0 and four at LOD3, so anything with harmonics above
  // the ring rate aliases differently in every tier (GDD R7). This is a long
  // undulation — the settle of a thatched roof over its rafters — and it
  // reconstructs to the same surface at any sample count.
  const combed = 0.5 + 0.5 * Math.sin(2 * Math.PI * (u * 1.7 + 0.2)) * Math.sin(Math.PI * (u * 2.9 + 0.6))

  out.copy(C.thatchBase).lerp(C.thatchLit, 0.18 + 0.42 * butts + 0.10 * combed)
  // And a second lift toward `strawLit` on the butts alone. `thatchBase` →
  // `thatchLit` is a deliberately narrow pair — the palette puts thatch a band
  // under straw so a roof separates from a hay pile — but a pair that narrow
  // gives the whole coat a tonal range of about 0.09 in luminance, which three
  // toon bands quantise to one. The cut ends of a course are the one part of a
  // thatched roof that is *fresh* straw, so borrowing the straw highlight there
  // is both what the material does and the only place in this paint with the
  // headroom to widen the range.
  out.lerp(C.strawLit, 0.2 * butts)
  out.lerp(C.thatchShadow, 0.5 * lapShadow)

  // ── The ridge cap ─────────────────────────────────────────────────────────
  //
  // Capped with fresh straw and pinned under liggers — split hazel rods. The
  // cap is paler than the coat because it is the newest straw on the building
  // (a ridge is re-capped every 10–15 years and a coat lasts 40), and that value
  // step is the thing that says "thatch" from across the square.
  const cap = smoothstep(THATCH_AT.capEdge + 0.02, THATCH_AT.capEdge - 0.10, down)
  out.lerp(C.strawLit, 0.42 * cap)
  // One ligger a side, on the cap's flank row. The band is 0.075 wide rather
  // than one row's 0.083, deliberately: at LOD0 that is the flank row alone, and
  // at LOD1 — whose rows land at 0.105 and 0.211 instead — it still catches 44 %
  // on the nearer of the two, so the line thins across the crossfade instead of
  // switching off.
  out.lerp(C.timberBase, 0.55 * smoothstep(0.075, 0.01, Math.abs(down - 0.1667)))
  // The shadow the cap's edge throws down the coat, centred on the row where
  // that edge lands back on the coat (`coatTop`). It is therefore a modelled
  // crease *and* a painted line at the same place — the one feature on this roof
  // where geometry and paint agree to the vertex.
  out.lerp(C.thatchShadow, 0.62 * smoothstep(0.06, 0.0, Math.abs(down - THATCH_AT.coatTop)))

  // ── The eaves ─────────────────────────────────────────────────────────────
  //
  // The neck above the bead holds a shadow; the bead itself is the cut ends of
  // the straw seen square on, and is the palest band on the roof.
  out.lerp(C.thatchShadow, 0.4 * smoothstep(0.07, 0.0, Math.abs(down - THATCH_AT.throat)))
  out.lerp(C.strawBase, 0.5 * smoothstep(0.10, 0.02, Math.abs(down - THATCH_AT.bead)))
  // The soffit — the underside — never sees the sun. Painted dark rather than
  // left to AO, which cannot reach it. Anchored on the section's own
  // under-bead row so the whole soffit darkens, not only its centre vertex:
  // the old threshold of 0.86 caught one row out of three.
  out.lerp(C.thatchShadow, 0.78 * smoothstep(THATCH_AT.soffit - 0.09, THATCH_AT.soffit + 0.04, down))

  // Weathering along the ridge, so a row of houses is not a row of one house.
  out.lerp(C.thatchShadow, 0.14 * bands(u, 0.31, 2))
}

/**
 * ─── Split shingle ──────────────────────────────────────────────────────────
 *
 * For the roofs that must not burn — the smithy, the gate towers, and the
 * storyteller's hut — and now painted against `SHINGLE_SECTION`'s own control
 * points rather than against a period picked by eye.
 *
 * The old version was `bands(downslope, 0.09, 9)` on a section whose rows are
 * 0.083 apart: one sample per band, which is under Nyquist, so the courses were
 * aliasing noise — and a *different* noise in each tier, which is the shading
 * flip GDD R7 says a crossfade cannot hide. `stagger` was worse at 0.11 with a
 * sharpness of 9 against `u`'s seven ring rows.
 *
 * Everything here is now either a control-point row (`SHINGLE_AT`) or a
 * harmonic below the ring rate, so all four tiers reconstruct the same roof.
 */
export const shinglePaint = (u: number, v: number, out: Color): void => {
  const down = clamp01(Math.abs(((v + 0.5) % 1) * 2 - 1))

  // 1 on the proud butt rows, 0 in the laps between them. Same construction as
  // `thatchPaint`, and the same period — see `SHINGLE_COURSE`.
  const courseFace = 0.5 - 0.5 * Math.cos((2 * Math.PI * down) / SHINGLE_COURSE)

  // Broken bond: the vertical joints move half a shingle every course, so the
  // pattern has to shift with `down` as well as run along `u`. Two low
  // harmonics rather than a band function — `u` has seven ring rows at LOD0 and
  // four at LOD3, and anything above that rate is a different roof per tier.
  const stagger = 0.5 + 0.5 * Math.cos(2 * Math.PI * (u * 2.4 + down * 3.0))

  out.copy(C.shingleBase).lerp(C.shingleLit, 0.16 + 0.34 * courseFace + 0.2 * stagger * courseFace)
  out.lerp(C.shingleShadow, 0.55 * (1 - courseFace))

  // The ridge board: sawn oak rather than split, so it is the one part of the
  // roof with a planed face, and it is paler than the weathered coat.
  out.lerp(C.woodBase, 0.42 * smoothstep(SHINGLE_AT.capEdge + 0.04, SHINGLE_AT.ridge, down))
  // The hard line where its cut edge lands back on the coat. Geometry and paint
  // agree here to the vertex — the section puts a near-vertical face at exactly
  // this row.
  out.lerp(C.shingleShadow, 0.72 * smoothstep(0.05, 0.0, Math.abs(down - SHINGLE_AT.coatTop)))

  // The drip: the overhanging tips catch the sky, and the square cut ends
  // immediately under them are end grain, which is the palest wood on the
  // building.
  out.lerp(C.shingleLit, 0.4 * smoothstep(0.06, 0.0, Math.abs(down - SHINGLE_AT.drip)))
  out.lerp(C.woodLit, 0.34 * smoothstep(0.06, 0.0, Math.abs(down - SHINGLE_AT.butt)))

  // The soffit never sees the sun, and AO cannot reach it. Anchored on the
  // section's own under-drip row so the whole underside darkens rather than
  // only its centre vertex.
  out.lerp(C.shingleShadow, 0.78 * smoothstep(SHINGLE_AT.soffit - 0.09, SHINGLE_AT.soffit + 0.04, down))

  // Weathering along the ridge, so a row of shingled roofs is not one roof.
  out.lerp(C.shingleShadow, 0.13 * bands(u, 0.29, 2))
}

/** Structural oak: darker into the grain, lit along the arris. */
const timberPaint = (u: number, v: number, out: Color): void => {
  const grain = bands(u, 0.17, 2)
  const facet = 0.5 + 0.5 * Math.cos(4 * Math.PI * v)
  out.copy(C.timberBase).lerp(C.timberLit, 0.2 + 0.4 * facet + 0.16 * grain)
  out.lerp(C.timberShadow, 0.3 * (1 - facet))
}

/**
 * A split stake: bark on the round, pale heartwood on the flat.
 *
 * `LOG_SECTION` puts its flat at v = 0.5, so the paint keys off exactly that —
 * which means a stake rotated to lean still has its flat painted as the flat.
 * Keying off world x/z instead was the first attempt and every third stake in a
 * run came out inside-out.
 */
const stakePaint = (u: number, v: number, out: Color): void => {
  const flat = smoothstep(0.24, 0.1, Math.abs(((v + 0.5) % 1) - 0.5))
  out.copy(C.barkBase).lerp(C.barkDark, 0.3 + 0.3 * bands(v, 0.07, 3))
  out.lerp(C.woodBase, flat)
  out.lerp(C.woodLit, flat * 0.4 * u)
  // The sharpened tip is fresh cut and pale.
  out.lerp(C.woodLit, 0.55 * smoothstep(0.86, 1.0, u))
}

/**
 * Planks: seams across the boards, ironwork at the ends.
 *
 * The strap positions are **ring parameters, not length fractions**, and that
 * distinction was a bug worth a comment. `PaintFn`'s `u` is the spline parameter
 * of the ring the vertex belongs to, and `CAP_T` is deliberately non-uniform, so
 * on a `CAPPED_RINGS` member the seven LOD0 rows sit at length fractions
 * 0, 0.013, 0.102, 0.5, 0.898, 0.987, 1 — at *parameters* 0, 0.3, 0.4, 0.5, 0.6,
 * 0.7, 1. The old code aimed at u = 0.22 and 0.78 with a half-width of 0.05,
 * which is 0.08 away from the nearest row in either direction: **every door in
 * the village had invisible straps.**
 *
 * 0.4 and 0.6 are rows that exist, and they are 10 % and 90 % along the door —
 * which is where a strap hinge actually goes.
 */
const plankPaint = (u: number, v: number, out: Color): void => {
  const seam = 1 - bands(v, 0.25, 10)
  out.copy(C.woodBase).lerp(C.woodLit, 0.25 + 0.35 * bands(v, 0.25, 2))
  out.lerp(C.woodShadow, 0.55 * seam)
  const strap = smoothstep(0.055, 0.02, Math.abs(u - 0.4)) + smoothstep(0.055, 0.02, Math.abs(u - 0.6))
  out.lerp(C.ironBase, clamp01(strap) * 0.85)
}

/** Field stone, for chimneys, plinths and the well. */
const stonePaint = (u: number, v: number, out: Color): void => {
  const course = bands(u, 0.14, 5)
  const joint = bands(v + u * 3.1, 0.19, 7)
  out.copy(C.rockBase).lerp(C.rockWarm, 0.25 + 0.4 * course * joint)
  out.lerp(C.rockShadow, 0.45 * (1 - course) + 0.2 * (1 - joint))
}

/**
 * ─── The ridge: liggers and crossed spars ───────────────────────────────────
 *
 * Two hazel rods running the length of the ridge with short crossed spars
 * pinning them down. This is what actually holds a thatched ridge on, and it is
 * the one detail on a thatched roof that a person can name from fifty metres —
 * the ridge is the only part of the roof that is on the *skyline* from every
 * approach, and until now Nimmerschein's was a bare tan roll.
 *
 * ── Why it is geometry and not paint ────────────────────────────────────────
 *
 * `thatchPaint` already draws a ligger line (see its note on the 0.075 band).
 * That line is a colour on a smooth surface, so it disappears the moment the
 * roof is lit from anywhere but straight on, and it cannot reach the silhouette
 * at all. Twelve rods, 3.5 cm thick, break the ridge's outline into a comb —
 * which is the thing being modelled here, and it costs about 190 triangles at
 * LOD0 and nothing past LOD1.
 *
 * ── Where they sit ──────────────────────────────────────────────────────────
 *
 * `roof()` maps the section's x to the span direction and its y to world up,
 * scaled by `halfSpan` and `rise` about the ridge line. `THATCH_POINTS` puts the
 * cap's flank at (0.112, 0.938) and the start of its cut edge at (0.158, 0.868),
 * so a rod centred at (±0.135, 0.905) lies along the middle of that flank, which
 * is exactly where a ligger goes: on the shoulder of the roll, not over its
 * crown. Half of the rod's 3.5 cm then stands proud of the straw.
 */
const ridgeSpars = (halfLength: number, halfSpan: number, eaves: number, rise: number): StructureMember[] => {
  const out: StructureMember[] = []
  const z = 0.135 * halfSpan
  const y = eaves + 0.905 * rise
  // Short of the gable half-hip: `ROOF_E` collapses the section over the outer
  // 7 % of the ridge, so a ligger run to the full length would float off the end
  // of a roof that has already curved away underneath it.
  const run = halfLength * 0.86

  // ── Two members, and the budget is why there are only two ────────────────
  //
  // `flatTimber`, not `beam`: 16 triangles at LOD0 against a beam's 40, for a
  // rod whose whole content is a straight line.
  //
  // The first pass was two liggers *and* five crossed spars in round beam, came
  // to 240, and put all three thatched buildings over — the cottage by 132. The
  // second was six applied timbers at 96, which still misses: a cottage is 812
  // against 860, a barn 550 against 640 and the smithy 1150 against 1220, so
  // the tightest of the three has 48 to spend and 96 does not fit any of them.
  //
  // So the crossed spars are cut and the liggers stay, which is the right half
  // to keep. A spar is 2.8 cm and 34 cm long — it is legible from the doorstep
  // and gone by ten metres. A ligger is a 7 cm line running the whole 5.4 m
  // ridge, and the ridge is the only part of a roof that is on the skyline from
  // every approach. Two of them cost 32 at LOD0 and 16 at LOD1, which fits
  // every budget in GDD §4.1 with room, and no budget in that table had to move.
  const rod = (name: string, from: Vec3, to: Vec3, half: number, lastTier: number): void => {
    out.push(
      flatTimber({
        name,
        from,
        to,
        half,
        paint: (u, _v, colour) => {
          // Peeled hazel: pale, and paler still where the drawknife took the
          // bark off. `u` is the ring parameter along the rod, and `FLAT_RINGS`
          // gives it four rows — so this is one slow variation, not a grain.
          colour.copy(C.woodBase).lerp(C.woodLit, 0.3 + 0.34 * bands(u, 0.3, 2))
          colour.lerp(C.woodShadow, 0.26 * (1 - bands(u, 0.5, 2)))
        },
        deep: C.thatchShadow,
        ao: 0.72,
        lastTier
      })
    )
  }

  for (const side of [-1, 1] as const) {
    // 4.2 cm half-width, not the 3.5 a real hazel rod would be. With the spars
    // gone these two lines are the entire ridge fixing, and a rod under 8 cm
    // across is under one screen pixel at the 40 m a village is read from —
    // which would make this 32 triangles of nothing.
    rod(`ligger-${side}`, [-run, y, side * z], [run, y, side * z], 0.042, 1)
  }
  return out
}

// ─── Houses ─────────────────────────────────────────────────────────────────

interface HouseSpec {
  id: string
  /** Half-extent along X — the ridge runs along X. */
  halfLength: number
  /** Half-extent along Z. */
  halfDepth: number
  eaves: number
  rise: number
  seed: number
}

/**
 * The door, as a plank slab standing 6 cm proud of the wall in a recessed jamb.
 *
 * Proud rather than flush, and that is the whole trick: a flush door is paint,
 * and paint on a wall this size is two pixels of contrast at 25 m. Six
 * centimetres of relief gives it its own AO line down both jambs and its own
 * band on the toon ramp, and it survives to LOD1.
 */
const doorMember = (x: number, z: number, height: number, halfWidth: number, facing: 'z' | 'x'): StructureMember[] => {
  const out: StructureMember[] = []
  const depth = facing === 'z' ? 0.06 : 0
  const across = facing === 'z' ? 0.06 : 0.06
  out.push(
    beam({
      name: 'door',
      from: facing === 'z' ? [x, 0.02, z + depth] : [x + across, 0.02, z],
      to: facing === 'z' ? [x, height, z + depth] : [x + across, height, z],
      halfA: halfWidth,
      halfB: 0.05,
      section: PLANK_SECTION,
      roll: facing === 'z' ? 0 : Math.PI * 0.5,
      segments: 6,
      paint: plankPaint,
      deep: C.woodShadow,
      ao: 0.9,
      lastTier: 1
    })
  )
  // The lintel. A door with no head reads as a hole; this is 14 triangles that
  // turn one into the other.
  out.push(
    beam({
      name: 'door-lintel',
      from: facing === 'z' ? [x - halfWidth - 0.09, height + 0.08, z + depth] : [x + across, height + 0.08, z - halfWidth - 0.09],
      to: facing === 'z' ? [x + halfWidth + 0.09, height + 0.08, z + depth] : [x + across, height + 0.08, z + halfWidth + 0.09],
      halfA: 0.07,
      halfB: 0.07,
      segments: 5,
      paint: timberPaint,
      deep: C.timberShadow,
      lastTier: 1
    })
  )
  return out
}

/**
 * ─── A window: a reveal and one open shutter ────────────────────────────────
 *
 * The old version was a single flat board 5 cm proud of the daub. That is a
 * *patch*, not a window: nothing about it breaks the wall's outline, so at any
 * distance the outline shader draws the same rectangle it would draw without it.
 *
 * Two members instead, and the split is the whole point:
 *
 *   * a **reveal** — a slab 62 × 66 cm standing 3 cm proud, painted timber
 *     around a dark centre. Three centimetres is not a recess, but it gives the
 *     opening its own AO line down all four sides (`bakeVertexAO` samples at
 *     0.4 × the structure's radius) and its own band on the toon ramp, which is
 *     what a recess *reads* as;
 *   * a **shutter, swung 40° open**, which projects 21 cm from the wall. That
 *     one does break the outline, from every direction that sees the wall at
 *     less than 40° off normal, and it is the only 20 triangles on this building
 *     that add a moving part to the silhouette.
 *
 * Both are on `FLAT_RINGS`: a flat board has nothing along its length for the
 * three interior rings `CAPPED_RINGS` would spend on it. 20 triangles each at
 * LOD0 against the old 50 for one board.
 */
const windowMember = (x: number, y: number, z: number, facing: 'z' | 'x', side: number): StructureMember[] => {
  // Outward normal of the wall this window sits in, and the in-plane horizontal.
  const nx = facing === 'x' ? side : 0
  const nz = facing === 'z' ? side : 0
  const tx = -nz
  const tz = nx
  const at = (along: number, up: number, out: number): Vec3 => [
    x + tx * along + nx * out,
    y + up,
    z + tz * along + nz * out
  ]

  // The shutter hangs on one jamb and swings 40° out — *away* from the opening,
  // not across it, which is what `-hinge` buys: the leaf then runs from the jamb
  // at 0.29 out to 0.61 along the wall and 0.32 m proud of the daub. That
  // projection is the only part of a window that can reach the silhouette at all.
  //
  // It clears everything else on the face by construction: the leaf lives at
  // y ∈ [1.53, 2.13] on a cottage, the mid-rail at [1.31, 1.47] and the top of
  // the nearest brace at 1.35.
  const hinge = -0.29
  const leafHalf = 0.21
  const swing = 0.7
  const dx = -tx * Math.cos(swing) + nx * Math.sin(swing)
  const dz = -tz * Math.cos(swing) + nz * Math.sin(swing)
  const cx = x + tx * hinge + nx * 0.05 + dx * leafHalf
  const cz = z + tz * hinge + nz * 0.05 + dz * leafHalf

  return [
    beam({
      name: 'window-reveal',
      from: at(0, -0.34, 0.028),
      to: at(0, 0.34, 0.028),
      halfA: 0.31,
      halfB: 0.022,
      section: PLANK_SECTION,
      // `beam` builds a vertical member's frame as axisA = +X, so the roll that
      // lays the slab into the wall is the wall's own in-plane direction.
      roll: Math.atan2(tz, tx),
      segments: 5,
      rings: FLAT_RINGS,
      paint: (u, v, out) => {
        // Timber all round, opening dark in the middle. `v` is the section
        // parameter, so the two broad faces are the middle of each half-turn
        // and are what the frame has to leave dark.
        const face = smoothstep(0.34, 0.16, Math.abs(((v + 0.5) % 1) - 0.5))
        const inner = face * smoothstep(0.30, 0.42, u) * smoothstep(0.70, 0.58, u)
        out.copy(C.timberBase).lerp(C.timberLit, 0.22 + 0.34 * bands(v, 0.25, 3))
        out.lerp(C.timberShadow, 0.72 * inner)
      },
      deep: C.timberShadow,
      ao: 0.9,
      lastTier: 1
    }),
    beam({
      name: 'shutter',
      from: [cx, y - 0.3, cz],
      to: [cx, y + 0.3, cz],
      halfA: leafHalf,
      halfB: 0.04,
      section: PLANK_SECTION,
      roll: Math.atan2(dz, dx),
      segments: 5,
      rings: FLAT_RINGS,
      paint: (u, v, out) => {
        out.copy(C.timberBase).lerp(C.timberLit, 0.2 + 0.4 * bands(v, 0.25, 3))
        out.lerp(C.timberShadow, 0.4 * (1 - bands(u, 0.5, 2)))
      },
      deep: C.timberShadow,
      ao: 0.85,
      lastTier: 0
    })
  ]
}

/**
 * ─── The applied frame: corner posts, mid-rails, braces ─────────────────────
 *
 * Twelve small members, 16 triangles each on `FLAT_RINGS`, and the reason they
 * are modelled at all is a measurement rather than a preference.
 *
 * `structure.ts`'s header records that a *fully* modelled Fachwerk frame — sill,
 * plate, studs, braces — cost 1 640 triangles for one cottage and read worse
 * than paint. That is still true and this is not a return to it. What has
 * changed is that the paint's own limit is now measured: **vertex colour cannot
 * express a feature narrower than the vertex spacing.** A cottage wall has an
 * 18.8 m perimeter; at the 16 samples `WALL_SECTION` runs at, the narrowest
 * paintable vertical is 2.35 m, and doubling to 32 segments costs 320 triangles
 * to get it to 1.2 m — still four times the 28 cm one. Four modelled posts cost 64
 * and are 28 cm.
 *
 * So the split is by *orientation*, not by ideology:
 *
 * | feature | how | tris | why |
 * |---|---|---:|---|
 * | sill, mid-rail, plate | paint | 0 | a horizontal is a function of height, and height costs *rings* — `WALL_RINGS` buys three rows for 40 |
 * | corner posts | 4 members | 64 | 6.5–13.5 cm proud at the one place a wall *has* a silhouette |
 * | mid-rails | 4 members | 64 | ditto, and it is what stops the posts reading as four loose sticks |
 * | braces | 4 members, LOD0 only | 64 | no silhouette — see below |
 *
 * The braces are the one entry that fails GDD R1 on its own terms: a diagonal in
 * the middle of a wall face changes nothing about the outline. They are paid for
 * because paint cannot draw a diagonal any more than it can draw a post, and a
 * Fachwerk wall without braces reads as a shed — and they are held to **LOD0
 * only** (≤ 43 m, where a 14 cm member is 3 screen px) so the concession does not
 * follow the building out to the horizon. Everything else here is on the outline.
 */
const appliedFrame = (
  halfLength: number,
  halfDepth: number,
  y0: number,
  y1: number,
  batter: number
): StructureMember[] => {
  const members: StructureMember[] = []
  const height = y1 - y0
  // The same 0.611 `timberFrame` paints the rail band at, so the modelled rail
  // and its painted shadow are the same line. See `WALL_RINGS`.
  const railY = y0 + height * 0.611
  const railWidth = 1 + (batter - 1) * 0.611

  // ── Corner posts ──────────────────────────────────────────────────────────
  //
  // Plumb, not battered: a timber frame is plumb and the daub is what leans.
  //
  // 28 cm square, centred at 0.96 of the half-extent, and both numbers come from
  // the built wall rather than from a catalogue. The wall's LOD0 plan puts its
  // bevelled corner at (2.516, 1.864) on a cottage; a post at 0.985 with a 23 cm
  // section starts at x = 2.545, which is *outboard* of that corner and leaves an
  // 8.7 cm slot between the post's back and the wall's chamfer, visible along the
  // face at close range. At 0.96 the post spans x ∈ [2.452, 2.732], so the
  // chamfer corner is inside it, and it still stands 6.5 cm proud of the daub at
  // the sill and 13.5 cm at the plate (the wall batters in 4 % over its height,
  // the post does not).
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      members.push(
        flatTimber({
          name: `post-${sx}-${sz}`,
          from: [sx * halfLength * 0.96, y0 - 0.02, sz * halfDepth * 0.96],
          to: [sx * halfLength * 0.96, y1 + 0.06, sz * halfDepth * 0.96],
          half: 0.14,
          paint: timberPaint,
          deep: C.timberShadow,
          ao: 0.85,
          lastTier: 1
        })
      )
    }
  }

  // ── Mid-rails, one per face ───────────────────────────────────────────────
  const rail = (facing: 'z' | 'x', side: number): StructureMember => {
    const span = facing === 'z' ? halfLength : halfDepth
    const off = (facing === 'z' ? halfDepth : halfLength) * railWidth + 0.05
    return flatTimber({
      name: `rail-${facing}-${side}`,
      from: facing === 'z' ? [-span * 0.92, railY, side * off] : [side * off, railY, -span * 0.92],
      to: facing === 'z' ? [span * 0.92, railY, side * off] : [side * off, railY, span * 0.92],
      half: 0.075,
      halfB: 0.08,
      paint: timberPaint,
      deep: C.timberShadow,
      ao: 0.8,
      lastTier: 1
    })
  }
  members.push(rail('z', -1), rail('z', 1), rail('x', -1), rail('x', 1))

  // ── Braces ────────────────────────────────────────────────────────────────
  //
  // A knee brace off each corner post, rising inboard to the mid-rail — four of
  // them, a pair on each **long** face, which is where 62 % of a cottage's wall
  // area is and the two faces a village street ever shows you at once.
  //
  // The run [0.62, 0.92] of the half-length is set by what the same face already
  // carries, measured on the cottage: with `doorOn: 'z'` the door spans
  // x ∈ [−1.22, −0.50] and the window's reveal x ∈ [0.82, 1.44], against brace
  // runs of [1.67, 2.48] and their mirror — 23 cm of daylight at the tighter
  // end, of which the brace's own half-width takes 7. With `doorOn: 'x'` both
  // are on a gable and nothing on the long faces is in the way.
  const off = halfDepth * railWidth + 0.035
  for (const sz of [-1, 1]) {
    for (const s of [-1, 1]) {
      members.push(
        flatTimber({
          name: `brace-${sz}-${s}`,
          from: [s * halfLength * 0.92, y0 + height * 0.1, sz * off],
          to: [s * halfLength * 0.62, railY - 0.04, sz * off],
          half: 0.07,
          halfB: 0.065,
          paint: timberPaint,
          deep: C.timberShadow,
          ao: 0.75,
          lastTier: 0
        })
      )
    }
  }
  return members
}

/** The batter and bevel every house wall shares, so `appliedFrame` can match. */
const WALL_BATTER = 0.96
const WALL_BEVEL = 0.045

/**
 * Segment counts for a wall, finest first.
 *
 * Not `SEGMENT_SCALE`'s 16 / 12 / 10 / 7 — see `WALL_SECTION`. 10 and 7 are
 * counts at which a 16-point loop has no mirror symmetry, so the wall comes out
 * lopsided on one side. 12 and 8 both keep it symmetric, and 8 additionally
 * lands a sample on all four corners.
 */
const WALL_SEGMENTS = [16, 12, 8, 8] as const

const buildHouse = (spec: HouseSpec, opts: {
  /** Roof material. Thatch everywhere except the smithy and the gate towers. */
  roofPaint?: (u: number, v: number, out: Color) => void
  roofDeep?: Color
  /** Door in the long wall (`z`) or in the gable (`x`). */
  doorOn?: 'z' | 'x'
  chimney?: boolean
  /**
   * The applied Fachwerk frame — posts, rails, braces. Off for the barn, whose
   * roof reaches the ground and whose 0.85 m of visible wall cannot carry a
   * frame that would be 3 % of its own height.
   */
  frame?: boolean
  /** Extra members layered on top — a jetty, a lean-to, a porch. */
  extra?: StructureMember[]
  budgets: readonly [number, number, number, number]
  jitter?: number
}): WorldAsset => {
  const { halfLength, halfDepth, eaves, rise } = spec
  const doorOn = opts.doorOn ?? 'z'
  const members: StructureMember[] = []

  // The wall block, battered 4 % over its height. See `box`'s note on why, and
  // `WALL_SECTION` / `WALL_RINGS` for why this one member does not take the
  // kit's defaults: it is the only surface in the village whose entire content
  // is paint, so where its samples land *is* the facade.
  members.push(
    box({
      name: `${spec.id}/walls`,
      y0: -0.12,
      y1: eaves,
      halfX: halfLength,
      halfZ: halfDepth,
      batter: WALL_BATTER,
      bevel: WALL_BEVEL,
      section: WALL_SECTION,
      rings: WALL_RINGS,
      segmentsByTier: WALL_SEGMENTS,
      // No inscribed-polygon compensation: `WALL_SECTION` is sampled on its
      // own control points at all three counts, so there is nothing to
      // compensate and the default would grow the wall 6.7 % by LOD3.
      inflate: 1,
      paint: (u, v, out) => timberFrame(u, v, out, WALL_BEVEL),
      deep: C.daubShadow,
      ao: 0.55
    })
  )

  // The roof, overhanging the wall by 22 cm on every side — the eaves shadow is
  // what plants a building on the ground, and a roof flush with its wall reads
  // as a cardboard box however good the thatch is.
  members.push(
    roof({
      name: `${spec.id}/roof`,
      from: [-halfLength - 0.16, eaves, 0],
      to: [halfLength + 0.16, eaves, 0],
      halfSpan: halfDepth + 0.24,
      rise,
      sag: Math.min(0.075, halfLength * 0.02),
      paint: opts.roofPaint ?? thatchPaint,
      deep: opts.roofDeep ?? C.thatchShadow,
      ao: 0.5
    })
  )

  // Only on thatch. A shingled ridge is capped with a sawn board — which
  // `SHINGLE_SECTION` models — and putting hazel rods on it would be putting a
  // thatcher's fixing on a carpenter's roof.
  if (!opts.roofPaint) {
    members.push(...ridgeSpars(halfLength, halfDepth + 0.24, eaves, rise))
  }

  // The window sits **above** the mid-rail, because on a framed wall the rail is
  // the window's sill — and because a rail 8 cm proud running through the middle
  // of a shutter is the kind of intersection nobody notices in a wireframe and
  // everybody notices in a screenshot. On an unframed wall (the barn) there is no
  // rail, so it keeps the old two-thirds-height placement.
  const railY = -0.12 + (eaves + 0.12) * 0.611
  const windowY = opts.frame === false ? eaves * 0.62 : railY + 0.44

  if (doorOn === 'z') {
    members.push(...doorMember(-halfLength * 0.32, halfDepth * 0.96, 1.72, 0.36, 'z'))
    members.push(...windowMember(halfLength * 0.42, windowY, halfDepth * 0.96, 'z', 1))
  } else {
    members.push(...doorMember(halfLength * 0.98, 0, 1.72, 0.36, 'x'))
    members.push(...windowMember(halfLength * 0.98, windowY, halfDepth * 0.45, 'x', 1))
  }

  if (opts.frame !== false) {
    members.push(...appliedFrame(halfLength, halfDepth, -0.12, eaves, WALL_BATTER))
  }

  if (opts.chimney !== false) {
    members.push(
      box({
        name: `${spec.id}/chimney`,
        x: halfLength * 0.62,
        z: 0,
        y0: eaves * 0.5,
        y1: eaves + rise + 0.42,
        halfX: 0.24,
        halfZ: 0.24,
        batter: 0.8,
        bevel: 0.06,
        segments: 7,
        paint: stonePaint,
        deep: C.rockShadow,
        ao: 0.7
      })
    )
  }

  if (opts.extra) {
    members.push(...opts.extra)
  }

  return buildStructureAsset({
    name: spec.id,
    perfTag: 'village',
    members,
    budgets: opts.budgets,
    // Houses are large and hand-placed, so their tiers have to hold much
    // further out than a scatter prop's: a cottage at LOD3 is still a
    // recognisable building on the skyline and stripping it at 120 m would make
    // the village evaporate as you walk away from it.
    distanceScale: 2.4,
    seed: spec.seed,
    jitter: opts.jitter ?? 0.028
  })
}

export const createCottageAsset = (seed = 1): WorldAsset =>
  buildHouse(
    { id: `house-cottage-${seed}`, halfLength: 2.7, halfDepth: 2.0, eaves: 2.35, rise: 2.15, seed },
    { budgets: [860, 420, 200, 100] }
  )

export const createLonghouseAsset = (seed = 2): WorldAsset =>
  buildHouse(
    { id: `house-long-${seed}`, halfLength: 4.1, halfDepth: 2.2, eaves: 2.5, rise: 2.3, seed },
    { doorOn: 'x', budgets: [860, 420, 200, 100] }
  )

/**
 * The barn: roof to the ground, no wall.
 *
 * Built by giving the roof a span *wider than the wall it sits on* and dropping
 * the wall's height to almost nothing, rather than by a separate generator —
 * which keeps it inside the same normal rule and the same crossfade schedule as
 * every other roof in the village.
 */
export const createBarnAsset = (seed = 3): WorldAsset =>
  buildHouse(
    { id: `house-barn-${seed}`, halfLength: 3.4, halfDepth: 2.5, eaves: 0.85, rise: 3.1, seed },
    {
      doorOn: 'x',
      chimney: false,
      // No applied frame: the barn's roof reaches the ground, so there is 0.85 m
      // of wall to put it on and a 28 cm corner post would be a third of it.
      frame: false,
      budgets: [640, 320, 160, 90]
    }
  )

/**
 * ── The smithy: Athalus's house ─────────────────────────────────────────────
 *
 * Two storeys, jettied — the upper floor oversails the lower by 30 cm on the
 * long sides, carried on brackets. That oversail is the single feature doing the
 * work: it puts a hard horizontal shadow line across the building at 2.4 m, and
 * a horizontal line at mid-height is the one thing no other building in the
 * village has. A two-storey cottage without it just reads as a cottage seen from
 * closer up.
 *
 * The forge is a lean-to on the gable end with an open front and a shingle roof
 * (the book has the smithy running continuously, so a thatch roof over a forge
 * would be a fire that has already happened), and its chimney is stone and
 * carries the ember paint at the top.
 */
export const createSmithyAsset = (seed = 4): WorldAsset => {
  const halfLength = 3.5
  const halfDepth = 2.4
  const storey = 2.4
  const eaves = 4.35
  const jetty = 0.3

  const brackets: StructureMember[] = []
  for (const side of [-1, 1]) {
    for (const at of [-0.62, 0, 0.62]) {
      brackets.push(
        beam({
          name: 'jetty-bracket',
          from: [halfLength * at, storey - 0.42, side * (halfDepth - 0.02)],
          to: [halfLength * at, storey + 0.06, side * (halfDepth + jetty)],
          halfA: 0.075,
          halfB: 0.075,
          segments: 5,
          // `FLAT_RINGS`, not the `CAPPED_RINGS` default: a bracket is 7 cm
          // square and 50 cm long, so the three interior rings `CAPPED_RINGS`
          // spends on it are duplicated geometry down a member with no shape.
          // Six of them came down from 300 triangles to 120 at LOD0 for no
          // visible change — their entire read is that they are there.
          rings: FLAT_RINGS,
          paint: timberPaint,
          deep: C.timberShadow,
          lastTier: 1
        })
      )
    }
  }

  return buildHouse(
    { id: `house-smithy-${seed}`, halfLength, halfDepth: halfDepth + jetty, eaves, rise: 2.4, seed },
    {
      doorOn: 'z',
      chimney: false,
      // No applied frame. The smithy's upper storey **oversails** its ground
      // storey by 30 cm, so a corner post plumb with the upper wall would hang
      // in mid-air for the 2.4 m below the jetty, and one plumb with the ground
      // wall would run through the jetty's own soffit. Its identity is the jetty
      // and the forge chimney, and both are already modelled; the facade it does
      // get is the fixed `timberFrame` paint on both storeys.
      frame: false,
      jitter: 0.024,
      budgets: [1220, 620, 340, 140],
      extra: [
        // The ground storey, narrower than the box above it. Drawn *after* the
        // main wall so its own AO lands on top rather than under.
        box({
          name: 'smithy/ground',
          y0: -0.14,
          y1: storey + 0.05,
          halfX: halfLength + 0.02,
          halfZ: halfDepth,
          batter: 0.99,
          bevel: 0.035,
          // The same facade kit as the storey above it, so the jetty's shadow
          // line falls between two walls that are built the same way rather than
          // between one that is and one that is not.
          section: WALL_SECTION,
          rings: WALL_RINGS,
          segmentsByTier: WALL_SEGMENTS,
      // No inscribed-polygon compensation: `WALL_SECTION` is sampled on its
      // own control points at all three counts, so there is nothing to
      // compensate and the default would grow the wall 6.7 % by LOD3.
      inflate: 1,
          paint: (u, v, out) => {
            // Stone to sill height, daub above: the only house in the village
            // with a stone plinth, because it is the one that has to carry a
            // forge and the one the book calls out as bigger than the rest.
            timberFrame(u, v, out, 0.035)
            const plinth = smoothstep(0.30, 0.20, boxHeightAt(u, 0.035))
            if (plinth > 0) {
              stonePaint(u * 3, v, _c)
              out.lerp(_c, plinth)
            }
          },
          deep: C.daubShadow,
          ao: 0.6
        }),
        ...brackets,
        // The forge lean-to, on the −X gable.
        box({
          name: 'smithy/forge-wall',
          x: -halfLength - 1.15,
          z: 0,
          y0: -0.1,
          y1: 1.95,
          halfX: 1.2,
          halfZ: 1.7,
          batter: 0.97,
          bevel: 0.05,
          segments: 8,
          paint: (u, v, out) => {
            stonePaint(u * 1.6, v, out)
            // Sooted, and increasingly so toward the chimney end.
            out.lerp(C.timberShadow, 0.4 * smoothstep(0.3, 0.95, u))
          },
          deep: C.rockShadow,
          ao: 0.7,
          lastTier: 2
        }),
        roof({
          name: 'smithy/forge-roof',
          from: [-halfLength - 2.5, 1.95, 0],
          to: [-halfLength + 0.1, 1.95, 0],
          halfSpan: 1.9,
          rise: 0.85,
          sag: 0.02,
          kind: 'shingle',
          // Below the section's own 24 because a lean-to is small on screen,
          // but not below 16: `SHINGLE_SECTION`'s apex is a cluster of three
          // control points and its ridge board another two, and at 12 samples
          // the grid steps two control points at a time and can miss the board
          // entirely — a shingle roof reads as a dome the same way a thatched
          // one does. `vOffset` guarantees only the apex itself.
          segments: 16,
          paint: shinglePaint,
          deep: C.shingleShadow,
          ao: 0.5,
          lastTier: 2
        }),
        // The forge chimney, tall enough to clear the main ridge, with the fire
        // showing at the throat. It is the last thing on the smithy to be
        // dropped — a chimney with smoke over it is how you find the forge from
        // the other side of the village.
        box({
          name: 'smithy/chimney',
          x: -halfLength - 1.9,
          z: 0,
          y0: 0.6,
          y1: 5.6,
          halfX: 0.42,
          halfZ: 0.42,
          batter: 0.72,
          bevel: 0.05,
          segments: 8,
          paint: (u, v, out) => {
            stonePaint(u * 1.4, v, out)
            out.lerp(C.timberShadow, 0.5 * smoothstep(0.82, 1.0, u))
            // The throat, glowing. Kept to the last 4 % of the height so it is
            // a line rather than a field — see the palette's note on `ember*`.
            out.lerp(C.emberBase, 0.7 * smoothstep(0.94, 0.99, u) * (1 - smoothstep(0.99, 1.0, u)))
          },
          deep: C.rockShadow,
          ao: 0.65
        })
      ]
    }
  )
}

// ─── The palisade ───────────────────────────────────────────────────────────

/**
 * `PALISADE_RUN` metres of wall per instance.
 *
 * 4.8, which is twelve 40 cm stakes. The number is set from the other end: the
 * village's perimeter is about 210 m, so a run this long needs ~44 instances,
 * and 44 × the LOD0 budget below is 15 400 triangles for the entire wall — under
 * one ancient oak per 50 m of it. Halving the run would double the instance
 * count for no visual gain, and doubling it would make the wall unable to follow
 * a curve without visible facets.
 */
export const PALISADE_RUN = 4.8
const PALISADE_STAKES = 12
const PALISADE_HEIGHT = 2.95

const palisadeStakes = (): StructureMember[] => {
  const members: StructureMember[] = []
  const step = PALISADE_RUN / PALISADE_STAKES
  for (let i = 0; i < PALISADE_STAKES; i++) {
    // Deterministic per-stake jitter. A palisade of identical stakes reads as
    // extruded; 4 cm of height variation and 2° of lean is enough to break it
    // and small enough that the wall still reads as one line.
    const wobble = Math.sin(i * 12.9898) * 43758.5453
    const jitter = wobble - Math.floor(wobble)
    const x = -PALISADE_RUN * 0.5 + step * (i + 0.5)
    const height = PALISADE_HEIGHT + (jitter - 0.5) * 0.16
    const lean = (jitter - 0.5) * 0.07
    members.push(
      beam({
        name: `stake-${i}`,
        from: [x, -0.28, 0],
        to: [x + lean, height, lean * 0.6],
        halfA: step * 0.52,
        halfB: step * 0.5,
        // The point. `taper` scales both half-extents at the far end, so 0.16
        // gives a stake sharpened over its last 20 cm rather than a spike.
        taper: [1, 0.16],
        section: LOG_SECTION,
        segments: 6,
        rings: SIMPLE_RINGS,
        paint: stakePaint,
        deep: C.barkDark,
        ao: 0.6,
        lastTier: 1
      })
    )
  }
  return members
}

export const createPalisadeAsset = (seed = 1): WorldAsset =>
  buildStructureAsset({
    name: `palisade-run-${seed}`,
    perfTag: 'village',
    members: [
      ...palisadeStakes(),
      // The waling — the horizontal rail the stakes are lashed to, on the inside
      // face. It is what stops the wall reading as a row of loose sticks, and it
      // is cheap because it is one member for twelve stakes.
      beam({
        name: 'waling',
        from: [-PALISADE_RUN * 0.5, 2.05, -0.19],
        to: [PALISADE_RUN * 0.5, 2.05, -0.19],
        halfA: 0.075,
        halfB: 0.06,
        segments: 5,
        rings: SIMPLE_RINGS,
        paint: timberPaint,
        deep: C.timberShadow,
        lastTier: 1
      }),
      // ── The coarse substitution ────────────────────────────────────────────
      //
      // One slab with the stakes painted on, from LOD2 outward. See the header
      // and `structure.ts`'s note on `firstTier`.
      box({
        name: 'palisade-slab',
        y0: -0.2,
        y1: PALISADE_HEIGHT - 0.14,
        halfX: PALISADE_RUN * 0.5,
        halfZ: 0.2,
        batter: 0.86,
        bevel: 0.04,
        segments: 6,
        paint: (u, v, out) => {
          stakePaint(u, v, out)
          // The stake rhythm, as paint. At the distance this tier is for, the
          // rhythm is all that survives of the gaps anyway.
          out.lerp(C.barkDark, 0.5 * (1 - bands(v, 1 / PALISADE_STAKES, 4)))
        },
        deep: C.barkDark,
        ao: 0.5,
        firstTier: 2
      })
    ],
    budgets: [540, 290, 120, 60],
    distanceScale: 1.5,
    seed
  })

/**
 * The north gate: two towers, a lintel, the leaves of the gate, and Arlaan's
 * banner.
 *
 * It is a landmark and is budgeted like one. Every other prop in the village is
 * placed in tens; there are exactly two of these, they are the first and last
 * thing the player sees of Nimmerschein, and Chapter 1 ends by walking through
 * one of them past a nineteen-year-old on a chair.
 */
export const createGateAsset = (seed = 1): WorldAsset => {
  const half = 2.3
  const towerHalf = 0.95
  const towerTop = 4.1

  const tower = (side: number): StructureMember[] => [
    box({
      name: `gate-tower-${side}`,
      x: side * (half + towerHalf),
      z: 0,
      y0: -0.25,
      y1: towerTop,
      halfX: towerHalf,
      halfZ: 1.0,
      batter: 0.88,
      bevel: 0.04,
      segments: 9,
      paint: (u, v, out) => {
        stakePaint(u, v, out)
        out.lerp(C.barkDark, 0.42 * (1 - bands(v, 0.115, 4)))
        // A stone footing, so the towers do not look like they are standing in
        // mud — which, in a village that has just built a wall, they would be.
        const plinth = smoothstep(0.14, 0.06, u)
        if (plinth > 0) {
          stonePaint(u * 4, v, _c)
          out.lerp(_c, plinth)
        }
      },
      deep: C.barkDark,
      ao: 0.6
    }),
    // The fighting platform's rail, on the inside face only.
    beam({
      name: `gate-rail-${side}`,
      from: [side * (half + towerHalf) - towerHalf, towerTop + 0.34, -1.0],
      to: [side * (half + towerHalf) + towerHalf, towerTop + 0.34, -1.0],
      halfA: 0.06,
      halfB: 0.06,
      segments: 5,
      paint: timberPaint,
      deep: C.timberShadow,
      lastTier: 1
    }),
    roof({
      name: `gate-roof-${side}`,
      from: [side * (half + towerHalf) - towerHalf - 0.3, towerTop, 0],
      to: [side * (half + towerHalf) + towerHalf + 0.3, towerTop, 0],
      halfSpan: 1.35,
      rise: 0.72,
      sag: 0.015,
      kind: 'shingle',
      // 12, not 8. A gate tower's roof is on the skyline from the whole
      // approach road, and 8 samples of a 24-point section steps three control
      // points at a time — which walks straight past the ridge board and lands
      // the tower under a dome. See the same note on the forge roof.
      segments: 12,
      paint: shinglePaint,
      deep: C.shingleShadow,
      ao: 0.5,
      lastTier: 2
    })
  ]

  return buildStructureAsset({
    name: `palisade-gate-${seed}`,
    perfTag: 'village',
    members: [
      ...tower(-1),
      ...tower(1),
      // The lintel across the opening, carrying the banner.
      beam({
        name: 'gate-lintel',
        from: [-half - towerHalf * 1.6, 3.35, 0],
        to: [half + towerHalf * 1.6, 3.35, 0],
        halfA: 0.16,
        halfB: 0.19,
        segments: 7,
        paint: timberPaint,
        deep: C.timberShadow
      }),
      // Both leaves of the gate, standing open — Chapter 1 walks in through it
      // in daylight, and a shut gate would have to be animated to be walked
      // through, which is a whole system for one prop.
      ...[-1, 1].map(side =>
        beam({
          name: `gate-leaf-${side}`,
          from: [side * (half - 0.1), 0.02, -0.05],
          to: [side * (half - 0.55), 0.02, -1.72],
          halfA: 0.09,
          halfB: 1.42,
          section: PLANK_SECTION,
          roll: Math.PI * 0.5,
          segments: 6,
          paint: (u, v, out) => {
            plankPaint(v, u, out)
            out.lerp(C.ironBase, 0.8 * smoothstep(0.06, 0.02, Math.abs(u - 0.06)))
          },
          deep: C.woodShadow,
          ao: 0.8,
          lastTier: 1
        })
      ),
      // ── Arlaan's banner ───────────────────────────────────────────────────
      //
      // A golden griffin on red (the story bible's §4.1). The griffin itself is
      // *painted*, and at the size a banner is read from the road it is a gold
      // mass in the middle of a red field, which is what a device on a banner
      // actually resolves to. This is the only member in the village with a wind
      // weight, so it is the only one on the `cloth` material.
      beam({
        name: 'gate-banner',
        from: [0, 3.22, 0.04],
        to: [0, 1.65, 0.04],
        halfA: 0.52,
        halfB: 0.02,
        section: PLANK_SECTION,
        segments: 5,
        paint: (u, v, out) => {
          out.copy(C.arlaanRed)
          // The griffin: a blob in the middle two thirds, roughened so it does
          // not read as a printed circle.
          const device =
            smoothstep(0.42, 0.2, Math.abs(u - 0.45)) *
            smoothstep(0.4, 0.16, Math.abs(((v + 0.25) % 0.5) - 0.25)) *
            (0.6 + 0.4 * Math.cos(9 * Math.PI * u))
          out.lerp(C.arlaanGold, clamp01(device))
          // The hem, darker, so the cloth has an edge.
          out.lerp(C.timberShadow, 0.5 * smoothstep(0.08, 0.0, u))
        },
        deep: C.timberShadow,
        ao: 0.25,
        wind: 0.85,
        lastTier: 2
      })
    ],
    budgets: [1320, 760, 410, 140],
    distanceScale: 2.6,
    seed,
    material: 'cloth'
  })
}

// ─── The bridge over the Arla ───────────────────────────────────────────────

/**
 * "A small wooden bridge six feet wide over the Arla" — Chapter 1, on the way
 * home. Six feet is 1.83 m, so the deck is authored at 1.8 and the span at 7.2,
 * which clears the river's "two dozen feet" (7.3 m) with the abutments standing
 * on the banks rather than in the water.
 *
 * The deck is **cambered**: 12 cm of rise at the middle over 7.2 m. That is not
 * decoration — a dead-flat deck between two banks reads as a plank laid across a
 * ditch, and the camber is what makes it read as built. It also means the player
 * cannot see the far bank's ground plane through the deck at a grazing angle,
 * which a flat deck at this thickness does.
 */
export const createBridgeAsset = (seed = 1): WorldAsset => {
  const span = 7.2
  const halfWidth = 0.9
  const camber = 0.12
  const deckY = 0.34

  const rail = (side: number): StructureMember[] => {
    const members: StructureMember[] = []
    for (const at of [-0.42, -0.14, 0.14, 0.42]) {
      const x = span * at
      const y = deckY + camber * Math.cos(Math.PI * at * 2.38)
      members.push(
        beam({
          name: `rail-post-${side}-${at}`,
          from: [x, y - 0.1, side * halfWidth],
          to: [x, y + 0.86, side * halfWidth],
          halfA: 0.055,
          halfB: 0.055,
          segments: 5,
          paint: timberPaint,
          deep: C.timberShadow,
          lastTier: 1
        })
      )
    }
    // The handrail itself, following the camber over five control points.
    const us = [-0.5, -0.25, 0, 0.25, 0.5]
    members.push({
      name: `handrail-${side}`,
      path: us.map(at => [span * at, deckY + 0.84 + camber * Math.cos(Math.PI * at * 2.38), side * halfWidth] as Vec3),
      extentA: [0, 0.06, 0.06, 0.06, 0],
      extentB: [0, 0.05, 0.05, 0.05, 0],
      section: BEAM_SECTION,
      segments: 5,
      paint: timberPaint,
      deep: C.timberShadow,
      lastTier: 2
    })
    return members
  }

  const us = [-0.5, -0.3, -0.1, 0.1, 0.3, 0.5]
  return buildStructureAsset({
    name: `bridge-arla-${seed}`,
    perfTag: 'village',
    members: [
      // The deck: a cambered slab. Its `path` carries the camber, so the planks
      // and their seams follow it rather than being sheared to fit.
      {
        name: 'deck',
        path: us.map(at => [span * at, deckY + camber * Math.cos(Math.PI * at * 2.38), 0] as Vec3),
        extentA: [0, halfWidth, halfWidth, halfWidth, halfWidth, 0],
        extentB: [0, 0.09, 0.1, 0.1, 0.09, 0],
        section: PLANK_SECTION,
        segments: 8,
        paint: (u, v, out) => {
          // Planks run *across* the bridge, so their seams are bands in `u`.
          out.copy(C.woodBase).lerp(C.woodLit, 0.2 + 0.4 * bands(u, 0.055, 2))
          out.lerp(C.woodShadow, 0.6 * (1 - bands(u, 0.055, 7)))
          // The underside is never lit and never seen except from the bank.
          out.lerp(C.woodShadow, 0.6 * smoothstep(0.6, 0.9, Math.abs(((v + 0.5) % 1) * 2 - 1)))
        },
        deep: C.woodShadow,
        ao: 0.6
      },
      // Two stringers under the deck, which is what a camber needs to be
      // believable and what gives the underside a silhouette from the bank.
      ...[-1, 1].map(side => ({
        name: `stringer-${side}`,
        path: us.map(at => [span * at, deckY - 0.16 + camber * Math.cos(Math.PI * at * 2.38), side * halfWidth * 0.62] as Vec3),
        extentA: [0, 0.08, 0.09, 0.09, 0.08, 0] as number[],
        extentB: [0, 0.13, 0.15, 0.15, 0.13, 0] as number[],
        section: BEAM_SECTION,
        segments: 5,
        paint: timberPaint,
        deep: C.timberShadow,
        ao: 0.8,
        lastTier: 2
      })),
      ...rail(-1),
      ...rail(1),
      // Abutments: two stone shoulders the stringers land on.
      ...[-1, 1].map(side =>
        box({
          name: `abutment-${side}`,
          x: side * span * 0.5,
          z: 0,
          y0: -1.1,
          y1: deckY - 0.05,
          halfX: 0.42,
          halfZ: halfWidth + 0.18,
          batter: 0.82,
          bevel: 0.06,
          segments: 7,
          paint: stonePaint,
          deep: C.rockShadow,
          ao: 0.7
        })
      )
    ],
    budgets: [960, 520, 260, 90],
    distanceScale: 2.0,
    seed,
    material: 'timber'
  })
}
