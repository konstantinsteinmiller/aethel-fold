import type { BufferGeometry } from 'three'
import { Vector3 } from 'three'
import { C } from '../art/palette'
import { makeRng } from '../geometry/rng'
import { bakeVertexAO } from '../geometry/vertexAO'
import { applyVertexAO } from '../geometry/vertexColor'
import { createOutlineMaterial } from '../shading/outlineMaterial'
import { mergeParts, partRanges } from './common'
import {
  buildGrassCap,
  buildRingList,
  createCliffMaterial,
  finishTier,
  type GrassShelf,
  loftGeometry,
  makeDrape,
  makeSection,
  makeStrata,
  paintGrassCap,
  paintGrassShelves,
  profileVolumeInflate,
  sectionAreaInflate,
  smootherstep,
  strataAt,
  type Stratum,
  strataOffsetAt,
  strataSeeds
} from './plateau'
import {
  makeStoneBands,
  PALE_STONE,
  paintSedimentaryBands,
  paintStoneBody,
  type StoneBand,
  type StonePalette
} from './stone'
import type { WorldAsset } from './types'

/**
 * ─── Mesa / butte ───────────────────────────────────────────────────────────
 *
 * The cliff family's **stepped** member, and it exists to be the plateau's
 * opposite. A plateau undercuts: its rim overhangs twice the waist radius and
 * the prop reads as floating. A mesa never undercuts — it *steps*, a staircase
 * of broad terraces widening steadily from a wide flat crown to a foot ~1.7×
 * as wide, like an eroded layer cake. Placed near a plateau it is what gives
 * the player's eye something to read that overhang against; built with the same
 * silhouette language it would just be a second plateau at a different scale.
 *
 * Everything structural comes from `plateau.ts` — the loft, the fused-column
 * section, the strata, the ring refinement, the material — so a mesa, a plateau
 * and a spire standing together are one rock formation and one draw batch.
 *
 * ── The four decisions that make it a mesa and not a cone with rings on it ──
 *
 *   1. **The profile is monotone outward, and the foot closure starts at ground
 *      level.** The plateau's closure begins at `u = 0.88`, well above the
 *      ground plane, which is exactly what produces its flare-then-tuck. Reused
 *      here it puts the widest ring at `u ≈ 0.9` and leaves the ground ring at
 *      75 % of that radius — half a metre of overhang all the way round a 5.5 m
 *      mesa, which is small but is enough to read as an anvil again, because an
 *      overhang is the one silhouette cue this prop exists to *not* have.
 *      `mesaFoot` therefore holds at 1 until `u = 0.98` and spends its whole
 *      taper underground.
 *   2. **A shallower flute bundle** (7 lobes at offset 0.46 → valleys ~8 % in
 *      from the crests, against the plateau's 18 %). A mesa is blocky; at the
 *      plateau's depth the same section reads as a fluted column, and on a 6.5 m
 *      crown the flutes get big enough that the walkable top visibly scallops.
 *      Fourteen segments still land on all seven crests and all seven arrises.
 *   3. **Wide stratum breaks.** A break's face spans `height × width/2` vertically
 *      against `radius × jut × 0.79` horizontally, so its angle is a property of
 *      the *form*, not of the numbers alone. The plateau's 0.04–0.07 of `u` makes
 *      an arris; the mesa's 0.09–0.15 puts the face ~28° off horizontal, which is
 *      a tread — broad enough to hold turf and to look walked on. The butte's
 *      breaks are **narrower** (0.05–0.09) for exactly that reason and not the
 *      opposite one: it is twice as tall and half as wide, so the same fraction
 *      of `u` buys twice the vertical drop, and the mesa's widths on a butte tip
 *      every face past 60° and smear the staircase back into a plain wall. At
 *      0.05–0.09 it sits near 46° — a bench with a sloped riser, which is what a
 *      butte has.
 *   4. **Tiny axis jogs** (4 % of radius, against the spire's 22 %). The crown is
 *      walkable and its collider is a cylinder about the placement point, so the
 *      ring list is anchored at `u = 0` and the stack leans only below. The
 *      spire's 22 % would drift a 6.5 m crown 1.4 m sideways — more than the
 *      inscribed collider's whole margin — and the player would walk off one
 *      flank onto air.
 *
 * ── Why this one takes a `StonePalette` ─────────────────────────────────────
 *
 * It ships twice from one generator: a pale grass-crowned platform and a bare
 * banded desert butte. Those are not two shapes, they are two paint stacks over
 * the same loft (see the header of `stone.ts`), so the stone is an option and
 * the body goes through `paintStoneBody` rather than `paintCliffRock`.
 *
 * `banding` is the desert half's whole identity and costs zero triangles: the
 * band list is drawn **once in `buildShape`** and shared by all four tiers,
 * because a band is a function of Y alone and per-tier lists would make the
 * dithered crossfade show two differently-striped rocks.
 *
 * Budgets (GDD §4.1): 300 / 175 / 95 / 44.
 */

const TAU = Math.PI * 2

/** Where the buried tip lands. The profile is exactly 0 here. */
const MESA_BOTTOM = 1.25

/**
 * The ground plane, and a **seed ring on every tier**.
 *
 * The widest ring of the whole prop is the one that meets the terrain, and
 * greedy refinement gets close to it without help but not reliably *the same*
 * close on every tier: across 60 seeds the worst tier rendered the foot at 93 %
 * of its true radius, and the four tiers of one prop disagreed by about 3
 * percentage points. That disagreement is the part that matters — an error every
 * tier shares is invisible, while three points of radius appearing and
 * disappearing is a size pop, and it lands in a crossfade band by construction
 * because the foot is the last thing on screen before the prop switches down.
 *
 * Seeding it costs nothing: the ring would have been placed near here anyway.
 */
const MESA_GROUND = 1

/** Lobes in the section. Every tier's segment count is 2× or 1× this. */
const LOBES = 7

/**
 * Sub-column offset. 0.46 puts the valleys ~8 % in from the crests; the
 * plateau's 0.56 puts them at 18 %. See header note 2 — this is the dial that
 * decides "blocky butte" against "fluted column", and it is the only reason the
 * two props read as different rocks at the same distance.
 */
const FLUTE_OFFSET = 0.46

/**
 * The layer-cake trend the terraces sit on: 0 at the crown, 1 at the foot,
 * monotone throughout.
 *
 * Two overlapping smootherstep terms rather than one, so the wall stays near
 * vertical for the first fifth of the drop — the crown of a mesa is a cliff, and
 * a single term wide enough to reach the foot starts widening immediately and
 * turns the whole prop into a cone. Both terms are clamped, so `u < 0` (which
 * the loft's central difference samples at the crown) returns exactly 0 rather
 * than NaN.
 */
const mesaWiden = (u: number): number => 0.42 * smootherstep(0.06, 0.6, u) + 0.58 * smootherstep(0.32, 0.98, u)

/**
 * Closes the stack to a buried point.
 *
 * Held at 1 until `u = 0.98` — 2 % of the height above the ground plane, where a
 * smootherstep has barely left 1 — so the ground ring is within half a percent of
 * the true foot radius and every visible ring is at least as wide as the one
 * above it. See header note 1: the plateau's `0.88` start is what makes *it*
 * flare and tuck, and it is the one number that will silently turn a mesa back
 * into an anvil.
 */
const mesaFoot = (u: number): number => 1 - smootherstep(0.98, MESA_BOTTOM, u)

export type MesaForm = 'mesa' | 'butte'

export interface MesaOptions {
  seed?: number
  form?: MesaForm
  /** Radius of the flat crown in metres. The foot is `widen`× this. */
  radius?: number
  height?: number
  stone?: StonePalette
  /** Grass crown on top. Defaults to true for `PALE_STONE`, false otherwise. */
  grassCap?: boolean
  /** Sedimentary banding strength, 0 disables. Defaults to 0 for `PALE_STONE`, 1 otherwise. */
  banding?: number
}

interface FormSpec {
  radius: number
  height: number
  /** Trend widening from crown to foot, before the terraces are added. */
  widen: number
  breaks: number
  span: [number, number]
  width: [number, number]
  jut: [number, number]
  distanceScale: number
}

/**
 * `widen` is set so that the trend *plus* the expected terrace sum lands on the
 * form's target foot ratio. Measured over 60 seeds that comes out at 1.70× the
 * crown for a mesa (range 1.24–2.14) and 1.49× for a butte (range 1.10–1.93).
 *
 * It is deliberately **not** renormalised against the realised terrace sum. The
 * spread is variety worth having — `makeStrata` steps outward about two times in
 * three, so some mesas are near-vertical-sided and some are proper wedding cakes
 * — and normalising it is actively dangerous: a seed that draws mostly inward
 * steps needs a large correction factor, which then amplifies those same inward
 * steps until the profile crosses zero and the loft turns inside out. Fixed
 * amplitudes cannot do that, because `1 + widen·mesaWiden(u)` is at least 1 and
 * the terrace sum is bounded well under it.
 *
 * Distance scales stay at or under 2.5 for the reason `plateau.ts` records: cull
 * is clamped to 320 m, so a larger scale pushes the LOD2→LOD3 switch past it and
 * LOD3 becomes a tier that is generated, budgeted, asserted and never drawn.
 */
const FORMS: Record<MesaForm, FormSpec> = {
  // Wide and low — a landing pad the player runs around on.
  mesa: {
    radius: 6.5,
    height: 5.5,
    widen: 0.49,
    breaks: 5,
    span: [0.15, 0.88],
    width: [0.09, 0.15],
    jut: [0.09, 0.15],
    distanceScale: 2.4
  },
  // Narrow and tall — a landmark, reachable from an adjacent mesa rather than
  // from the ground.
  butte: {
    radius: 3.2,
    height: 10,
    widen: 0.3,
    breaks: 4,
    span: [0.12, 0.86],
    width: [0.05, 0.09],
    jut: [0.1, 0.17],
    distanceScale: 2.5
  }
}

interface MesaShape {
  radius: number
  height: number
  stone: StonePalette
  grassCap: boolean
  banding: number
  sectionAt: (theta: number) => number
  strata: Stratum[]
  /** 1 at the crown by construction, so `radius` is exactly the crown radius. */
  profileAt: (u: number) => number
  bands: StoneBand[]
  drapeAt: (theta: number) => number
  maxDrape: number
  extent: number
  paintSeed: number
}

interface MesaTier {
  /** How many terraces (prominence-first) this tier pins as real steps. */
  resolved: number
  rings: number
  segments: number
  skirt: boolean
  budget: number
  aoSamples: number
}

/**
 * Segments hold at `2 × LOBES` through LOD2 and halve only at LOD3, where the
 * mesh still lands on every crest. A count coprime with the bundle renders the
 * section as a smooth polygon at any tier — the header of `plateau.ts` has the
 * measurement.
 *
 * Rings are what each tier spends instead, which is the right way round: the
 * section is this family's identity and the profile is its pose. LOD3 keeps four
 * rings, not three; `plateau.ts` records three measuring 45 % over LOD0's volume
 * on a shape with far less vertical structure than this one, and the fourth ring
 * costs 12 triangles here.
 *
 * `resolved` stays well under what the ring count could pin. Each tier spends one
 * ring on the buried tip and two more on the crown and the ground plane, and each
 * pinned break costs two on top of that — so LOD0 at `resolved: 3` is already at
 * 9 of its 10. Pinning all five leaves `buildRingList` nothing to place and the
 * body *between* the terraces collapses to one straight chord, which is the
 * failure `cliff.ts` measured at 34–63 % under LOD0's volume. The unpinned breaks
 * are not lost: greedy refinement puts its free rings exactly there, because that
 * is where the chord error is largest. It renders them as ramps rather than as
 * crisp treads, which is the correct thing to lose first.
 *
 * Triangles = segments × (rings − 1) × 2 − segments (the buried tip band is half
 * degenerate) + segments (crown fan, from the loft cap or the grass disc)
 * + 2 × segments (grass skirt, fine tiers only).
 */
const TIERS: MesaTier[] = [
  { resolved: 3, rings: 10, segments: LOBES * 2, skirt: true, budget: 300, aoSamples: 12 },
  { resolved: 1, rings: 6, segments: LOBES * 2, skirt: true, budget: 175, aoSamples: 10 },
  { resolved: 0, rings: 4, segments: LOBES * 2, skirt: false, budget: 95, aoSamples: 8 },
  { resolved: 0, rings: 4, segments: LOBES, skirt: false, budget: 44, aoSamples: 6 }
]

const buildShape = (options: MesaOptions): MesaShape => {
  const form = options.form ?? 'mesa'
  const spec = FORMS[form]
  const seed = options.seed ?? 1
  const rng = makeRng(seed)

  const stone = options.stone ?? PALE_STONE
  // Pale stone is the temperate variant and grows turf; anything else is desert
  // rock, which is bare and banded. The integrator overrides both explicitly, so
  // this only has to be right for a bare `createMesaAsset({ stone })` call.
  const pale = stone === PALE_STONE

  const radius = options.radius ?? spec.radius * rng.range(0.92, 1.1)
  const height = options.height ?? spec.height * rng.range(0.9, 1.14)

  const sectionAt = makeSection(rng, LOBES, FLUTE_OFFSET, [0.025, 0.055])
  const strata = makeStrata(rng, spec.breaks, spec.span, spec.width, spec.jut, radius * 0.04)

  // No `profileScale` here, unlike the plateau and the spire. Those normalise
  // their *peak* to 1 because their widest ring is the crown; a mesa's widest
  // ring is its foot, so normalising the peak would make `radius` mean the base
  // and every collider in the level would be 70 % too wide. The terms are
  // authored to be exactly 1 at `u = 0` instead — `mesaWiden(0)` is 0 by clamp
  // and the topmost break's band starts well below the crown — so `profileAt(0)`
  // is 1 and `radius` is the crown radius, which is what a collider needs.
  const profileAt = (u: number): number => (1 + spec.widen * mesaWiden(u) + strataAt(u, strata)) * mesaFoot(u)

  // Drawn unconditionally even when `banding` is 0, so a pale mesa and a desert
  // one built from the same seed share every earlier draw and therefore the same
  // silhouette. Conditioning the draw would fork the RNG stream and make the two
  // registrations different rocks.
  const bands = makeStoneBands(rng, Math.max(4, Math.round(height * 0.7)), 0, height, [0.05, 0.13])

  const maxDrape = Math.min(radius * 0.3, height * 0.14)

  let widest = 0
  for (let i = 0; i <= 128; i++) {
    widest = Math.max(widest, profileAt((i / 128) * MESA_BOTTOM))
  }

  let jog = 0
  for (const stratum of strata) {
    jog += Math.hypot(stratum.jogX, stratum.jogZ)
  }

  return {
    radius,
    height,
    stone,
    grassCap: options.grassCap ?? pale,
    banding: options.banding ?? (pale ? 0 : 1),
    sectionAt,
    strata,
    profileAt,
    bands,
    drapeAt: makeDrape(rng, maxDrape),
    maxDrape,
    extent: radius * widest + jog,
    paintSeed: seed * 0x2545 + 7
  }
}

const _jog = new Vector3()
const _crown = new Vector3()

const buildTier = (shape: MesaShape, tier: MesaTier, index: number, name: string): BufferGeometry => {
  const { segments } = tier
  // A tier-local paint stream, rather than the shape's. Threading one `Rng`
  // through the tier loop makes tier N's colour jitter depend on how many
  // vertices tiers 0..N−1 happened to have, which is a dependency nothing wants
  // and the first thing to break when a budget moves by one ring.
  const rng = makeRng(shape.paintSeed + index)
  const inflate = sectionAreaInflate(segments, 0, shape.sectionAt)

  const yAt = (u: number): number => shape.height * (1 - u)
  const profileAt = shape.profileAt
  // Anchored at the crown: `strataOffsetAt` is 0 at `u = 0`, so the walkable top
  // stays centred over the placement point and only the stack below it leans.
  const offsetAt = (u: number, out: Vector3): Vector3 => strataOffsetAt(u, shape.strata, out)

  // Refined over the **visible** body only, with the buried tip appended after.
  //
  // Handing `MESA_BOTTOM` to the refiner instead is the single most expensive
  // mistake available here. The radius falling from 1.7× the crown to nothing
  // under the terrain is by a wide margin the largest deviation anywhere on the
  // curve, so the refiner chases it: measured over 60 seeds, only 14.2 of a
  // prop's 24 rings landed above ground, against the 20 it should be. LOD3 came
  // out with two visible rings — crown and foot — and rendered the whole
  // staircase as one straight chord. One closing ring is all the tip ever needs;
  // its band is half degenerate anyway.
  const us = [
    ...buildRingList(
      [0, MESA_GROUND, ...strataSeeds(shape.strata, tier.resolved)],
      tier.rings - 1,
      (u, out) => {
        offsetAt(u, out)
        const jogX = out.x
        const jogZ = out.z
        return out.set(shape.radius * profileAt(u), jogX, jogZ)
      }
    ),
    MESA_BOTTOM
  ]

  // Both corrections together: one for the section polygon, one for the ring
  // chords. Neither is optional — each fixes a bias the other cannot see.
  const scale = shape.radius * inflate * profileVolumeInflate(us, profileAt, yAt)
  const radiusAt = (u: number, theta: number): number => scale * profileAt(u) * shape.sectionAt(theta)

  const body = loftGeometry({
    us,
    segments,
    yAt,
    radiusAt,
    offsetAt,
    // The bare desert variant gets its planar crown here, with normals of exactly
    // +Y so it matches the flat collider the editor claims. The grass variant
    // gets the same thing from the cap disc, so capping here would bury
    // `segments` triangles under it.
    capTop: !shape.grassCap
  })
  paintStoneBody(body, rng, shape.stone)
  paintSedimentaryBands(body, shape.stone, shape.bands, shape.banding)

  const parts: BufferGeometry[] = [body]

  if (shape.grassCap) {
    // Turf on the outward treads — free detail, since the ledges already exist as
    // geometry, and the single strongest cue that this is BotW rock rather than
    // generic stylised stone. `paintGrassShelves` gates on normal upness, so a
    // coarse tier that smoothed a terrace into a ramp quietly grows none.
    const shelves: GrassShelf[] = shape.strata
      .filter(stratum => stratum.shelf)
      .map(stratum => ({ y: yAt(stratum.u), halfHeight: shape.height * stratum.width * 0.8 }))
    paintGrassShelves(body, shelves, 0.95)

    offsetAt(0, _crown)
    const cap = buildGrassCap({
      segments,
      thetaOffset: 0,
      topY: shape.height,
      centerX: _crown.x,
      centerZ: _crown.z,
      rimRadius: theta => radiusAt(0, theta),
      skirtPoint: tier.skirt
        ? (theta, out) => {
            // `yAt` is linear, so a drape depth converts straight to a profile
            // parameter and the hem lands on the body's own surface. The 1.05
            // pushes it back out past the rock — and here the rock is already
            // widening under the rim, so the hem flares rather than tucking, which
            // is what a turf lip does on a stepped face.
            const drape = shape.drapeAt(theta)
            const u = drape / shape.height
            const r = radiusAt(u, theta) * 1.05
            strataOffsetAt(u, shape.strata, _jog)
            return out.set(_jog.x + Math.cos(theta) * r, shape.height - drape, _jog.z + Math.sin(theta) * r)
          }
        : null
    })
    paintGrassCap(cap, shape.height, shape.maxDrape)
    parts.push(cap)
  }

  const ranges = partRanges(parts)
  const merged = mergeParts(parts, name)

  // Ray budget capped against height as well as radius. A mesa is wide and low,
  // so `radius × k` alone hands a 6.5 m crown rays longer than the prop is tall
  // and every one of them spends itself in open air. What has to be caught is the
  // undersides of the terraces and the tuck beneath the grass hem, both within
  // about a step's reach.
  const ao = bakeVertexAO(merged, {
    samples: tier.aoSamples,
    maxDistance: Math.min(shape.radius * 0.5, shape.height * 0.4),
    strength: 0.9,
    power: 1.15
  })
  applyVertexAO(merged, ao, shape.stone.shadow, 0.85, ranges[0])
  if (ranges.length > 1) {
    // Weak on the cap on purpose: the top must read as flat paint, and AO strong
    // enough to model stone is strong enough to make turf look mottled.
    applyVertexAO(merged, ao, C.grassCapDeep, 0.45, ranges[1])
  }

  return finishTier(merged, tier.budget, name)
}

export const createMesaAsset = (options: MesaOptions = {}): WorldAsset => {
  const form = options.form ?? 'mesa'
  const shape = buildShape(options)
  const name = `mesa-${form}-${shape.grassCap ? 'grass' : 'bare'}-${options.seed ?? 1}`

  const tiers = TIERS.map((tier, i) => buildTier(shape, tier, i, `${name}/LOD${i}`))

  return {
    name,
    perfTag: 'mesas',
    tiers,
    material: createCliffMaterial('mesa'),
    outline: createOutlineMaterial({ pixelWidth: 1.6, name: 'mesa-outline' }),
    outlineMaxTier: 1,
    // Corner of the bounding box, not the crown radius: the foot is the farthest
    // point from the origin on this shape, and a radius that misses it pops the
    // whole prop out of the frustum when the player is standing on it.
    radius: Math.hypot(shape.extent, shape.height),
    distanceScale: FORMS[form].distanceScale
  }
}

/** Crown radius and height of a generated mesa, for collider sizing. */
export const mesaMetrics = (options: MesaOptions = {}): { radius: number; height: number } => {
  const shape = buildShape(options)
  // The narrowest bearing of the fluted crown, not the widest. The flute valleys
  // alone sit ~8 % in from the crests and the section wobble takes the narrowest
  // bearing to 79 % of the widest; a collider on the crests would leave the
  // player a fifth of a radius of thin air to walk out onto over the valleys.
  // Erring the other way costs a strip of ledge nobody can reach, which is the
  // cheap failure.
  let narrowest = Number.POSITIVE_INFINITY
  for (let i = 0; i < 128; i++) {
    narrowest = Math.min(narrowest, shape.sectionAt((i / 128) * TAU))
  }
  return { radius: shape.radius * shape.profileAt(0) * narrowest, height: shape.height }
}
