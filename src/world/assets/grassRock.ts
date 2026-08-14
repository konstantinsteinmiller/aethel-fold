import type { BufferGeometry } from 'three'
import { Vector3 } from 'three'
import { C } from '../art/palette'
import {
  applyCutPlane,
  blobGeometry,
  type CutPlane,
  type Lump,
  lumpRadius,
  makeCutPlanes,
  makeLumps
} from '../geometry/build'
import { makeRng, type Rng } from '../geometry/rng'
import { bakeVertexAO } from '../geometry/vertexAO'
import { applyVertexAO } from '../geometry/vertexColor'
import { createOutlineMaterial } from '../shading/outlineMaterial'
import { mergeParts, partRanges } from './common'
import { buildGrassCap, createCliffMaterial, finishTier, makeDrape, paintCliffRock, paintGrassCap } from './plateau'
import type { WorldAsset } from './types'

/**
 * ─── Grass-capped boulder ───────────────────────────────────────────────────
 *
 * A boulder with its crown sliced off and turfed — the smallest member of the
 * family, and the one that has to sit on a hillside without looking placed.
 *
 * ── Why this one is a blob and not a loft ───────────────────────────────────
 *
 * The plateau's loft cannot make a boulder: a surface of revolution with a
 * per-angle section has one radius per direction, which is fine for a spire and
 * hopeless for a lumpy mass. So the body comes off `blobGeometry`, exactly like
 * `createBoulderAsset`, and the flat top is a **cut plane with an upward
 * normal** appended to the cut list. That reuse is the point: this prop has to
 * read as the same rock the boulders are made of, and sharing the shape
 * function is what guarantees that rather than hoping two sets of numbers land
 * in the same place.
 *
 * ── Fitting the cap to a shape nobody has a formula for ─────────────────────
 *
 * The cut leaves an outline the generator does not know — it is wherever the
 * lump field happens to cross the plane, and it moves with the seed *and* with
 * the tier (each tier has its own inscribed-polygon inflation). Guessing a
 * radius gives a grass disc that floats off the rock on one side and sinks into
 * it on the other.
 *
 * So this file re-evaluates `blobGeometry`'s shape function directly —
 * `lumpRadius`, then the same cuts in the same order — and **bisects on the
 * polar angle** to find, for a given compass bearing, the point on the rock at
 * a given height. The cap's rim and its drape are both queried that way, so the
 * turf lands on the stone at every tier, for every seed, by construction.
 *
 * The rock's own top plate stays under the cap, unseen. That is `widthSegments`
 * triangles of waste per tier, knowingly spent: the alternative is a bespoke
 * top-capping path through `blobGeometry`, which is a shared file two other
 * generators depend on, to save nine triangles at LOD0.
 *
 * Budgets (GDD §4.1): 130 / 84 / 40 / 20.
 */

export interface GrassRockOptions {
  seed?: number
  /** Base radius in metres. */
  radius?: number
}

interface GrassRockShape {
  radius: number
  lumps: Lump[]
  cuts: CutPlane[]
  scale: Vector3
  /** Object-space Y of the top slice, before its bevel rounds it off. */
  topY: number
  /** Where the flat actually settles: `smoothMax` asymptotes half a bevel high. */
  plateY: number
  topBevel: number
  bottomY: number
  lift: number
  dipAt: (theta: number) => number
  maxDip: number
  rng: Rng
}

interface GrassRockTier {
  widthSegments: number
  heightSegments: number
  skirt: boolean
  budget: number
  aoSamples: number
}

const TIERS: GrassRockTier[] = [
  { widthSegments: 9, heightSegments: 5, skirt: true, budget: 130, aoSamples: 14 },
  { widthSegments: 7, heightSegments: 4, skirt: true, budget: 84, aoSamples: 12 },
  { widthSegments: 6, heightSegments: 3, skirt: false, budget: 40, aoSamples: 8 },
  { widthSegments: 5, heightSegments: 2, skirt: false, budget: 20, aoSamples: 6 }
]

/** Slice height as a fraction of the squashed radius. */
const TOP_CUT = 0.46

const buildShape = (options: GrassRockOptions): GrassRockShape => {
  const rng = makeRng(options.seed ?? 1)
  const radius = options.radius ?? 1.3 * rng.range(0.85, 1.2)

  // Flatter than a boulder's 0.8–1.0. The slice has to leave a top wide enough
  // to stand on, and squashing the sphere is a cheaper way to get there than
  // cutting deeper — cutting deeper just makes a puck.
  const squash = rng.range(0.72, 0.88)
  const topY = radius * squash * TOP_CUT
  const topBevel = radius * 0.09
  // A fifth of the radius. The first pass used 0.14 and the turf stopped at the
  // silhouette, which reads as a green sticker rather than as a cap that grew
  // over the stone — the drape has to be deep enough to see from eye level.
  const maxDip = radius * 0.2

  return {
    radius,
    lumps: makeLumps(rng, 4, [0.1, 0.28], [1.3, 3.2]),
    // Side chips only. `biasDown` is 0 here rather than the boulder's 0.35
    // because the top plane already owns the upper half — an upward-facing chip
    // lands above it and is simply overruled, while the sideways ones are what
    // give the plate its irregular outline.
    cuts: makeCutPlanes(rng, 2, [radius * 0.82, radius * 1.0], radius * 0.1, 0),
    scale: new Vector3(rng.range(0.96, 1.16), squash, rng.range(0.96, 1.16)),
    topY,
    plateY: topY + topBevel * 0.5,
    topBevel,
    bottomY: -radius * squash * 0.8,
    lift: radius * squash * 0.8 - radius * 0.12,
    dipAt: makeDrape(rng, maxDip),
    maxDip,
    rng
  }
}

const _dir = new Vector3()

/**
 * `blobGeometry`'s shape function, re-evaluated here.
 *
 * It has to be reproduced rather than imported because the tier's inscribed
 * polygon inflation is applied inside the builder and never exposed. Order is
 * load-bearing: scale, then the cut list *as passed*, then the ground plane —
 * any other order gives a surface the mesh does not sit on.
 */
const makeEval = (shape: GrassRockShape, widthSegments: number) => {
  const inflate = 1 / Math.cos(Math.PI / widthSegments) ** 0.6
  const topPlane: CutPlane = { normal: new Vector3(0, 1, 0), dist: shape.topY, bevel: shape.topBevel }
  const bottomPlane: CutPlane = {
    normal: new Vector3(0, -1, 0),
    dist: -shape.bottomY,
    bevel: shape.radius * 0.14
  }
  const cuts = [...shape.cuts, topPlane]

  const evalShape = (direction: Vector3, out: Vector3): Vector3 => {
    out.copy(direction).multiplyScalar(shape.radius * inflate * lumpRadius(direction, shape.lumps))
    out.multiply(shape.scale)
    for (let i = 0; i < cuts.length; i++) {
      applyCutPlane(out, cuts[i]!)
    }
    applyCutPlane(out, bottomPlane)
    return out
  }

  /**
   * The rock's surface at a bearing and a height.
   *
   * Bisection on the polar angle, not a closed form — the lump field makes the
   * height a transcendental function of direction, and 24 halvings of a 0.78π
   * arc lands inside a tenth of a millimetre, which is two orders below
   * anything the cap can show.
   */
  const surfaceAtHeight = (theta: number, targetY: number, out: Vector3): Vector3 => {
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    let lo = 0
    let hi = Math.PI * 0.78
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) * 0.5
      const s = Math.sin(mid)
      _dir.set(s * cos, Math.cos(mid), s * sin)
      evalShape(_dir, out)
      if (out.y > targetY) {
        lo = mid
      } else {
        hi = mid
      }
    }
    const s = Math.sin(lo)
    _dir.set(s * cos, Math.cos(lo), s * sin)
    return evalShape(_dir, out)
  }

  return { cuts, evalShape, surfaceAtHeight }
}

const _query = new Vector3()

const buildTier = (shape: GrassRockShape, tier: GrassRockTier, name: string): BufferGeometry => {
  const { widthSegments, heightSegments } = tier
  const { cuts, surfaceAtHeight } = makeEval(shape, widthSegments)

  const body = blobGeometry({
    radius: shape.radius,
    widthSegments,
    heightSegments,
    lumps: shape.lumps,
    cuts,
    scale: shape.scale,
    flatBottom: shape.bottomY,
    flatBottomBevel: shape.radius * 0.14
  })
  paintCliffRock(body, shape.rng, 0.035)

  // The rim sits half a bevel below the plate, which is where the slice stops
  // being flat and starts rolling over the shoulder — measure it there and the
  // grass edge lands on the roll instead of on the flat or off the side.
  const rimY = shape.plateY - shape.topBevel
  const cap = buildGrassCap({
    segments: widthSegments,
    // `blobGeometry` derives from `SphereGeometry`, whose first longitudinal
    // sample is at θ = 0. Matching it keeps the cap's facets in phase with the
    // body's, so the lip does not scallop against the rock beneath it.
    thetaOffset: 0,
    topY: shape.plateY,
    rimRadius: theta => {
      surfaceAtHeight(theta, rimY, _query)
      return Math.hypot(_query.x, _query.z)
    },
    skirtPoint: tier.skirt
      ? (theta, out) => {
          surfaceAtHeight(theta, rimY - shape.dipAt(theta), out)
          // Pushed out past the stone, not just clear of it. Coplanar turf and
          // rock would z-fight along the most visible edge on the prop, and a
          // hem that hugs the surface reads as paint — this one overhangs.
          out.x *= 1.04
          out.z *= 1.04
          return out
        }
      : null
  })
  paintGrassCap(cap, shape.plateY, shape.topBevel + shape.maxDip)

  const parts = [body, cap]
  const ranges = partRanges(parts)
  const merged = mergeParts(parts, name)

  const ao = bakeVertexAO(merged, {
    samples: tier.aoSamples,
    maxDistance: shape.radius * 0.9,
    strength: 0.9,
    power: 1.2
  })
  applyVertexAO(merged, ao, C.cliffShadow, 0.85, ranges[0])
  applyVertexAO(merged, ao, C.grassCapDeep, 0.45, ranges[1])

  // Bury 12 % of the base, as the boulders do — a rock resting exactly on the
  // ground plane reads as placed rather than as part of the terrain.
  merged.translate(0, shape.lift, 0)
  return finishTier(merged, tier.budget, name)
}

export const createGrassRockAsset = (options: GrassRockOptions = {}): WorldAsset => {
  const shape = buildShape(options)
  const name = `grass-rock-${options.seed ?? 1}`

  const tiers = TIERS.map((tier, i) => buildTier(shape, tier, `${name}/LOD${i}`))

  return {
    name,
    perfTag: 'grassRocks',
    tiers,
    material: createCliffMaterial('grass-rock'),
    outline: createOutlineMaterial({ pixelWidth: 1.6, name: 'grass-rock-outline' }),
    outlineMaxTier: 1,
    radius: shape.radius * Math.max(shape.scale.x, shape.scale.z) * 1.4,
    distanceScale: 1.1
  }
}

/**
 * Collider dimensions.
 *
 * The radius is the *narrowest* point of the plate over a full turn, not the
 * average: the outline is irregular, and a cylinder sized to the mean leaves
 * arcs of thin air the player can stand on. Under-sizing costs a few
 * centimetres of unreachable stone at the widest bearings, which nobody
 * notices; over-sizing is a floating player, which everybody does.
 */
export const grassRockMetrics = (options: GrassRockOptions = {}): { radius: number; height: number } => {
  const shape = buildShape(options)
  const { surfaceAtHeight } = makeEval(shape, TIERS[0]!.widthSegments)
  const rimY = shape.plateY - shape.topBevel

  let narrowest = Number.POSITIVE_INFINITY
  for (let i = 0; i < 24; i++) {
    surfaceAtHeight((i / 24) * Math.PI * 2, rimY, _query)
    narrowest = Math.min(narrowest, Math.hypot(_query.x, _query.z))
  }

  return { radius: narrowest * 0.94, height: shape.plateY + shape.lift }
}
