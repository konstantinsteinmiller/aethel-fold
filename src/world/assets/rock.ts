import type { BufferGeometry } from 'three'
import { Vector3 } from 'three'
import { C } from '../art/palette'
import { assertTriBudget } from '../geometry/budget'
import { blobGeometry, type CutPlane, type Lump, makeCutPlanes, makeLumps } from '../geometry/build'
import { makeRng, type Rng } from '../geometry/rng'
import { bakeVertexAO } from '../geometry/vertexAO'
import { applyVertexAO, jitterColor, paintByUpness, paintUniform } from '../geometry/vertexColor'
import { createOutlineMaterial } from '../shading/outlineMaterial'
import { createToonMaterial } from '../shading/toonMaterial'
import { normalizeAssetGeometry } from './common'
import type { WorldAsset } from './types'

/**
 * ─── Stone and boulder ──────────────────────────────────────────────────────
 *
 * Both come out of the same generator because they are the same shape function
 * at different scales and complexities — and because sharing it guarantees a
 * pebble and a boulder read as the same *material*, which is half of what makes
 * a set of props look art-directed rather than assembled.
 *
 * The rock look is GDD R2 made literal:
 *
 *   1. a lump field swells the sphere into an irregular mass (smooth, C∞, so
 *      every LOD tier agrees on the shape)
 *   2. a few **bevelled half-space cuts** slice flat facets into it
 *   3. 38° angle smoothing then keeps the facet edges crisp (they meet at ≥60°)
 *      while the swells between them stay glassy smooth
 *
 * That combination is the entire difference between "stylised granite" and
 * "faceted low-poly asset-store rock". Skip the bevel and the cuts read as
 * papercraft; skip the cuts and it's a potato.
 *
 * Budgets (GDD §4.1): stone 72/40/20/8, boulder 180/96/44/12.
 */

export type RockVariant = 'stone' | 'boulder'

export interface RockOptions {
  seed?: number
  variant?: RockVariant
  /** Base radius in metres. Defaults per variant. */
  radius?: number
}

interface RockShape {
  radius: number
  lumps: Lump[]
  cuts: CutPlane[]
  scale: Vector3
  /** Object-space Y of the flat base cut. */
  bottomY: number
  /** Lift applied after generation so the base sits just below y = 0. */
  lift: number
  rng: Rng
}

interface VariantSpec {
  radius: number
  lumpCount: number
  lumpAmp: [number, number]
  lumpPower: [number, number]
  cutCount: number
  /** Cut distance as a fraction of radius — lower means a flatter, blockier rock. */
  cutDist: [number, number]
  /** Bevel radius as a fraction of radius (GDD R2). */
  bevel: number
  squash: [number, number]
  /** Segment counts per tier: [width, height]. */
  tiers: [number, number][]
  budgets: [number, number, number, number]
  aoSamples: [number, number, number, number]
  distanceScale: number
}

const VARIANTS: Record<RockVariant, VariantSpec> = {
  // Small enough that the eye reads it as a single form — few, tight lumps and
  // a single decisive cut give it a chipped, angular character.
  stone: {
    radius: 0.36,
    lumpCount: 3,
    lumpAmp: [0.12, 0.34],
    lumpPower: [1.4, 3.2],
    cutCount: 2,
    cutDist: [0.74, 0.95],
    bevel: 0.11,
    squash: [0.74, 0.92],
    tiers: [
      [7, 5],
      [6, 4],
      [5, 3],
      [4, 2]
    ],
    budgets: [72, 40, 20, 8],
    aoSamples: [16, 12, 8, 6],
    distanceScale: 0.55
  },
  // A landmark the player navigates by, so it earns more lumps and more cuts —
  // the silhouette has to stay interesting from every angle.
  boulder: {
    radius: 1.35,
    lumpCount: 5,
    lumpAmp: [0.1, 0.3],
    lumpPower: [1.2, 3.6],
    cutCount: 3,
    cutDist: [0.76, 0.98],
    bevel: 0.09,
    squash: [0.8, 1.0],
    tiers: [
      [10, 8],
      [8, 6],
      [6, 4],
      [6, 2]
    ],
    budgets: [180, 96, 44, 12],
    aoSamples: [16, 12, 8, 6],
    distanceScale: 1.15
  }
}

const buildShape = (options: RockOptions): RockShape => {
  const variant = options.variant ?? 'boulder'
  const spec = VARIANTS[variant]
  const rng = makeRng(options.seed ?? 1)
  const radius = options.radius ?? spec.radius

  const squash = rng.range(spec.squash[0], spec.squash[1])
  // Cut the base a little above the lowest point so there's a real flat to sit
  // on, then bury 12 % of it — a rock resting exactly on the ground plane reads
  // as placed, not as part of the terrain.
  //
  // Shallow on purpose: an earlier 0.58 sliced away 42 % of the underside and
  // every boulder came out a hexagonal puck. The flat only has to be wide enough
  // to look seated, and the terrain hides it anyway.
  const bottomY = -radius * squash * 0.8

  return {
    radius,
    lumps: makeLumps(rng, spec.lumpCount, spec.lumpAmp, spec.lumpPower),
    // `biasDown` tilts cut planes away from pointing straight down, which would
    // fight the base cut and shave the rock into a wafer.
    cuts: makeCutPlanes(
      rng,
      spec.cutCount,
      [radius * spec.cutDist[0], radius * spec.cutDist[1]],
      radius * spec.bevel,
      0.35
    ),
    scale: new Vector3(rng.range(0.94, 1.18), squash, rng.range(0.94, 1.18)),
    bottomY,
    lift: -bottomY - radius * 0.12,
    rng
  }
}

const buildTier = (shape: RockShape, spec: VariantSpec, tier: number, name: string): BufferGeometry => {
  const [widthSegments, heightSegments] = spec.tiers[tier]!

  const geometry = blobGeometry({
    radius: shape.radius,
    widthSegments,
    heightSegments,
    lumps: shape.lumps,
    cuts: shape.cuts,
    scale: shape.scale,
    flatBottom: shape.bottomY,
    flatBottomBevel: shape.radius * 0.14
  })

  // Normals arrive analytic from `blobGeometry` — smooth across the swells,
  // tight across the bevelled cuts, and identical at every tier.

  paintUniform(geometry, C.rockBase)
  // Sun-bleached tops. This is standing in for a sky-light bounce and it's most
  // of why the rocks don't read as grey blobs (GDD R1 — colour, not geometry).
  paintByUpness(geometry, C.rockWarm, 0.55, 2)

  const ao = bakeVertexAO(geometry, {
    samples: spec.aoSamples[tier]!,
    maxDistance: shape.radius * 1.1,
    strength: 0.9,
    power: 1.2
  })
  applyVertexAO(geometry, ao, C.rockShadow, 0.85)
  jitterColor(geometry, shape.rng, 0.035)

  geometry.translate(0, shape.lift, 0)
  normalizeAssetGeometry(geometry)
  geometry.computeBoundingSphere()

  return assertTriBudget(geometry, spec.budgets[tier]!, name)
}

export const createRockAsset = (options: RockOptions = {}): WorldAsset => {
  const variant = options.variant ?? 'boulder'
  const spec = VARIANTS[variant]
  const shape = buildShape(options)
  const name = `${variant}-${options.seed ?? 1}`

  const tiers: BufferGeometry[] = []
  for (let tier = 0; tier < 4; tier++) {
    tiers.push(buildTier(shape, spec, tier, `${name}/LOD${tier}`))
  }

  return {
    name,
    perfTag: variant === 'stone' ? 'stones' : 'boulders',
    tiers,
    material: createToonMaterial({
      name: variant,
      // Rock takes the default hard-edged ramp; the crisp terminator is what
      // sells it as mineral rather than as the soft foliage mass next to it.
      rimStrength: 0.5,
      shadowTintMix: 0.32
    }),
    outline: createOutlineMaterial({ pixelWidth: 1.6, name: `${variant}-outline` }),
    outlineMaxTier: 1,
    radius: shape.radius * Math.max(shape.scale.x, shape.scale.z) * 1.35,
    distanceScale: spec.distanceScale
  }
}

export const createStoneAsset = (options: Omit<RockOptions, 'variant'> = {}): WorldAsset =>
  createRockAsset({ ...options, variant: 'stone' })

export const createBoulderAsset = (options: Omit<RockOptions, 'variant'> = {}): WorldAsset =>
  createRockAsset({ ...options, variant: 'boulder' })
