import type { BufferGeometry } from 'three'
import { Vector3 } from 'three'
import { C } from '../art/palette'
import { makeRng, type Rng } from '../geometry/rng'
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
  paintCliffRock,
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
import type { WorldAsset } from './types'

/**
 * ─── Sea-stack spire ────────────────────────────────────────────────────────
 *
 * The vertical counterpart to the plateau: a tall fractured stack, slim at the
 * crown and broadening into a stratified base, optionally grass-crowned. Built
 * on the plateau's loft kit, so the two share a section, a paint stack, a
 * material and therefore a draw batch.
 *
 * What separates it from "a tapered cylinder" is all shape, not shading:
 *
 *   • **The deepest flute bundle in the family** (`LOBES = 5`, offset 0.55 →
 *     valleys ~24 % in from the crests). At this height the section is the only
 *     thing carrying detail over most of the silhouette — there is no rim, no
 *     undercut and no cap to look at. Ten segments put a vertex on every crest
 *     and every arris, down to LOD2.
 *   • **Three stratum breaks with axis jogs**, so the spire is a stack of
 *     offset blocks that jut and lean rather than a continuous taper. The jogs
 *     are the important half: a profile that only changes *width* still reads as
 *     lathe-turned, because the axis is straight and the eye finds that.
 *   • **Turf on the outward breaks.** Narrow green ledges partway up the face,
 *     free of triangles (`paintGrassShelves`), and the single strongest cue that
 *     this is BotW rock rather than generic stylised stone.
 *
 * ── One arithmetic note that cost a rendering bug ───────────────────────────
 *
 * The taper is **linear**. It was `0.5 + 0.36·u^0.85`, which is a partial
 * function: the loft's central difference samples `u − ε` at the crown, and
 * `(-0.0025) ** 0.85` is NaN for every non-integer exponent. That NaN reached
 * the normal, then the colour through `paintByUpness`, and rendered as a solid
 * black cap on all eight cliff tiers. Every profile term in this family is now
 * either polynomial or a clamped smootherstep, and `assertFiniteGeometry` in
 * `plateau.ts` runs on every tier so the class cannot come back silently.
 *
 * Budgets (GDD §4.1): 260 / 150 / 100 / 36.
 */

export interface CliffOptions {
  seed?: number
  /** Total height in metres, crown to ground. */
  height?: number
  /** Radius at the widest point of the base. */
  radius?: number
  /** Flat green crown. Off gives a bare fractured stack. */
  grassCap?: boolean
}

/** Where the buried tip lands. The profile is exactly 0 here. */
const PROFILE_BOTTOM = 1.12

const LOBES = 5

/**
 * `u` runs 0 at the crown to 1.12 at the buried tip.
 *
 * Only the linear taper and the closing foot live here — everything that makes
 * the silhouette interesting is a stratum, added by the caller, because breaks
 * have to drive the ring list and a hard-coded profile cannot.
 */
const cliffTaper = (u: number): number => 0.44 + 0.3 * u

const cliffFoot = (u: number): number => 1 - smootherstep(0.94, PROFILE_BOTTOM, u)

interface CliffShape {
  radius: number
  height: number
  sectionAt: (theta: number) => number
  strata: Stratum[]
  profileScale: number
  lean: Vector3
  grassCap: boolean
  drapeAt: (theta: number) => number
  maxDrape: number
  extent: number
  rng: Rng
}

interface CliffTier {
  resolved: number
  rings: number
  segments: number
  skirt: boolean
  budget: number
  aoSamples: number
}

/**
 * Segments hold at `2 × LOBES` through LOD2 and drop to `LOBES` only at LOD3,
 * where the mesh still lands on every crest. Rings are what each tier spends
 * instead, and `resolved` says how many of the three breaks it pins as real
 * steps rather than ramps.
 *
 * `resolved` is deliberately far below what each tier could afford. Pinning a
 * break costs two rings, and a tier whose whole ring budget goes on pinned
 * breaks has none left for `buildRingList` to place — LOD1 and LOD2 were in
 * exactly that state and came out 34 % and 63 % under LOD0's volume, because
 * every ring sat clustered on a step and the entire body between them was one
 * straight chord. Ledges are worth having only on tiers that can still afford to
 * describe the rock they sit on.
 */
const TIERS: CliffTier[] = [
  { resolved: 3, rings: 10, segments: LOBES * 2, skirt: true, budget: 260, aoSamples: 10 },
  { resolved: 1, rings: 6, segments: LOBES * 2, skirt: true, budget: 150, aoSamples: 10 },
  { resolved: 0, rings: 5, segments: LOBES * 2, skirt: false, budget: 100, aoSamples: 8 },
  { resolved: 0, rings: 4, segments: LOBES, skirt: false, budget: 36, aoSamples: 6 }
]

const buildShape = (options: CliffOptions): CliffShape => {
  const rng = makeRng(options.seed ?? 1)
  const height = options.height ?? 12.5 * rng.range(0.82, 1.24)
  const radius = options.radius ?? height * rng.range(0.15, 0.21)

  const sectionAt = makeSection(rng, LOBES, 0.55, [0.035, 0.08])

  // Narrow bands with large juts. The ratio is what decides whether a break is a
  // ledge or a slope: the step spans `height × width/2` vertically and
  // `radius × jut × 0.79` horizontally, so at these numbers the face sits about
  // 25° off horizontal — shallow enough for turf to read as sitting on it.
  const strata = makeStrata(rng, 3, [0.2, 0.84], [0.025, 0.045], [0.16, 0.3], radius * 0.22)

  let peak = 0
  for (let i = 0; i <= 128; i++) {
    const u = (i / 128) * PROFILE_BOTTOM
    peak = Math.max(peak, (cliffTaper(u) + strataAt(u, strata)) * cliffFoot(u))
  }
  const profileScale = peak > 1e-6 ? 1 / peak : 1

  const leanAngle = rng.range(0, Math.PI * 2)
  const leanAmount = height * rng.range(0.03, 0.07)
  const lean = new Vector3(Math.cos(leanAngle) * leanAmount, 0, Math.sin(leanAngle) * leanAmount)

  const maxDrape = Math.min(radius * 0.3, height * 0.14)

  let jog = 0
  for (const stratum of strata) {
    jog += Math.hypot(stratum.jogX, stratum.jogZ)
  }

  return {
    radius,
    height,
    sectionAt,
    strata,
    profileScale,
    lean,
    grassCap: options.grassCap ?? true,
    drapeAt: makeDrape(rng, maxDrape),
    maxDrape,
    extent: radius + jog + leanAmount,
    rng
  }
}

const _jog = new Vector3()
const _crown = new Vector3()

const buildTier = (shape: CliffShape, tier: CliffTier, name: string): BufferGeometry => {
  const { segments } = tier
  const inflate = sectionAreaInflate(segments, 0, shape.sectionAt)

  const yAt = (u: number): number => shape.height * (1 - u)
  const profileAt = (u: number): number => (cliffTaper(u) + strataAt(u, shape.strata)) * cliffFoot(u) * shape.profileScale

  /**
   * Axis displacement: a smooth lean anchored at the foot, plus the stratum
   * jogs. Anchoring the lean at `u = 1` keeps the base over the placement point
   * and lets only the crown drift; anchoring at the crown would hang the whole
   * spire off the spot the editor dropped it on.
   *
   * The falloff is a clamped cube, not `(1 - u) ** 1.7` — see the header. `1 - u`
   * is negative past the foot, and the difference between those two expressions
   * is the difference between a spire and eight black caps.
   */
  const offsetAt = (u: number, out: Vector3): Vector3 => {
    strataOffsetAt(u, shape.strata, out)
    const t = u < 0 ? 1 : u > 1 ? 0 : 1 - u
    return out.addScaledVector(shape.lean, t * t * t)
  }

  const us = buildRingList(
    [0, PROFILE_BOTTOM, ...strataSeeds(shape.strata, tier.resolved)],
    tier.rings,
    (u, out) => {
      offsetAt(u, out)
      const jogX = out.x
      const jogZ = out.z
      return out.set(shape.radius * profileAt(u), jogX, jogZ)
    }
  )

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
    // A bare stack still needs its crown closed; the grass-crowned variant gets
    // its flat top from the cap part, so capping here would bury `segments`
    // triangles under it for nothing.
    capTop: !shape.grassCap
  })
  paintCliffRock(body, shape.rng, 0.035)

  const shelves: GrassShelf[] = shape.strata
    .filter(stratum => stratum.shelf)
    .map(stratum => ({ y: yAt(stratum.u), halfHeight: shape.height * stratum.width * 0.9 }))
  paintGrassShelves(body, shelves, 0.95)

  const parts: BufferGeometry[] = [body]

  if (shape.grassCap) {
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
            const drape = shape.drapeAt(theta)
            const u = drape / shape.height
            const r = radiusAt(u, theta) * 1.05
            offsetAt(u, _jog)
            return out.set(_jog.x + Math.cos(theta) * r, shape.height - drape, _jog.z + Math.sin(theta) * r)
          }
        : null
    })
    paintGrassCap(cap, shape.height, shape.maxDrape)
    parts.push(cap)
  }

  const ranges = partRanges(parts)
  const merged = mergeParts(parts, name)

  // Tighter than the plateau's relative to the prop's size: a spire is mostly
  // convex, so a long ray budget spends itself finding nothing. What it must
  // catch is the ledge undersides and the tuck beneath the grass hem, and both
  // are within about a base radius.
  const ao = bakeVertexAO(merged, {
    samples: tier.aoSamples,
    maxDistance: shape.radius * 1.1,
    strength: 0.9,
    power: 1.2
  })
  applyVertexAO(merged, ao, C.cliffShadow, 0.85, ranges[0])
  if (ranges.length > 1) {
    applyVertexAO(merged, ao, C.grassCapDeep, 0.45, ranges[1])
  }

  return finishTier(merged, tier.budget, name)
}

export const createCliffAsset = (options: CliffOptions = {}): WorldAsset => {
  const shape = buildShape(options)
  const name = `cliff-${shape.grassCap ? 'grass' : 'bare'}-${options.seed ?? 1}`

  const tiers = TIERS.map((tier, i) => buildTier(shape, tier, `${name}/LOD${i}`))

  return {
    name,
    perfTag: 'cliffs',
    tiers,
    material: createCliffMaterial('cliff'),
    outline: createOutlineMaterial({ pixelWidth: 1.6, name: 'cliff-outline' }),
    outlineMaxTier: 1,
    radius: Math.hypot(shape.extent, shape.height),
    // The tallest thing in the world after the terrain, so it holds detail well
    // past where a tree would have collapsed to an impostor — but not past the
    // 320 m global cull (GDD §4.2). At 3.2 the LOD3 band opened at 352 m and the
    // tier was dead weight: generated, budgeted, asserted and never drawn.
    distanceScale: 2.6
  }
}

/**
 * Collider dimensions for a generated spire. Deterministic from the seed, so it
 * re-derives the shape rather than threading metrics through `WorldAsset`.
 */
export const cliffMetrics = (options: CliffOptions = {}): { radius: number; height: number } => {
  const shape = buildShape(options)
  // Shaved to the deepest flute so the collider sits inside the visual rather
  // than around it — being stopped by an invisible wall reads far worse than
  // brushing through a groove.
  let narrowest = Number.POSITIVE_INFINITY
  for (let i = 0; i < 128; i++) {
    narrowest = Math.min(narrowest, shape.sectionAt((i / 128) * (Math.PI * 2)))
  }
  return { radius: shape.radius * narrowest * 0.9, height: shape.height }
}
