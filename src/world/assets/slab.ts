import type { BufferGeometry } from 'three'
import { C } from '../art/palette'
import { makeRng, type Rng } from '../geometry/rng'
import { bakeVertexAO } from '../geometry/vertexAO'
import { applyVertexAO } from '../geometry/vertexColor'
import { createOutlineMaterial } from '../shading/outlineMaterial'
import {
  createCliffMaterial,
  finishTier,
  loftGeometry,
  paintCliffRock,
  sectionAreaInflate,
  smootherstep
} from './plateau'
import type { WorldAsset } from './types'

/**
 * ─── Stratified slab ────────────────────────────────────────────────────────
 *
 * A blocky quarried block, layered horizontally. The level-design workhorse:
 * stacked into stairs, run out into walls, dropped as a single step.
 *
 * ── Why this is the loft again and not a box ────────────────────────────────
 *
 * It is a rectangle, so a `BoxGeometry` looks like the obvious answer. It isn't,
 * for two reasons that both come out of the contract rather than out of taste:
 *
 *   • **Bevels.** A box has eight hard 90° edges, which GDD R2 bans outright.
 *     Getting them off a box means an explicit chamfer pass; getting them off
 *     the loft means sampling a superellipse section *between* its corners,
 *     which rounds all four vertical edges for free and gives the analytic
 *     normals a real surface to differentiate across.
 *   • **Strata.** The courses are steps in the profile function, so they are
 *     continuous in `u` and every tier samples the same block. Modelled as
 *     stacked boxes they would be a different object at every tier.
 *
 * The section exponent (`SECTION_POWER`) is the single dial between "rounded
 * pillow" and "quarried stone". At 2 it is an ellipse; past about 8 the corners
 * are hard enough that the bevel stops reading at LOD1 and the ban in R2 is
 * back in force through the side door.
 *
 * Budgets (GDD §4.1): 112 / 76 / 40 / 18.
 */

export type SlabForm = 'block' | 'step'

export interface SlabOptions {
  seed?: number
  form?: SlabForm
  /** Half-extent along X in metres, at the widest (lowest) course. */
  halfX?: number
  halfZ?: number
  height?: number
}

interface FormSpec {
  halfX: number
  halfZ: number
  height: number
  distanceScale: number
}

const FORMS: Record<SlabForm, FormSpec> = {
  // Wall and pedestal stock.
  block: { halfX: 1.9, halfZ: 1.35, height: 1.55, distanceScale: 1.1 },
  // Deliberately shallow and wide, so a run of them stacks into a stair the
  // player can actually climb rather than into a cliff they have to jump.
  step: { halfX: 2.4, halfZ: 1.1, height: 0.55, distanceScale: 0.95 }
}

const SECTION_POWER = 5

/**
 * Superellipse section: a rectangle with rounded corners, as a radius at an
 * angle. `|cos|^p` is C¹ at its zero for `p > 1`, so this stays differentiable
 * everywhere and the loft's central differences hold.
 */
const sectionAt = (theta: number, aspect: number): number => {
  const c = Math.abs(Math.cos(theta)) ** SECTION_POWER
  const s = Math.abs(Math.sin(theta) * aspect) ** SECTION_POWER
  return (c + s) ** (-1 / SECTION_POWER)
}

/**
 * `u` runs 0 at the top face to 1 at the buried base.
 *
 * Narrowest at the top by design — a block that oversails its own base reads as
 * unstable, and stacking two of them then leaves the upper one's overhang
 * hanging in air. The courses grow downward instead, which also means the
 * collider can take the *top* footprint and be strictly conservative.
 */
const slabProfile = (u: number): number => {
  let r = 0.8
  r += 0.075 * smootherstep(0.3, 0.38, u)
  r += 0.065 * smootherstep(0.66, 0.74, u)
  // Mostly buried. It exists so the block flares where it meets the ground
  // instead of stopping dead at a visible seam on sloped terrain.
  r += 0.06 * smootherstep(0.96, 1.06, u)
  return r
}

interface SlabShape {
  halfX: number
  halfZ: number
  height: number
  /** halfX / halfZ, fed to the superellipse. */
  aspect: number
  rng: Rng
}

interface SlabTier {
  us: number[]
  segments: number
  budget: number
  aoSamples: number
}

/**
 * Ring lists straddle each course step rather than landing inside it, so the
 * strata stay crisp.
 *
 * The three fine tiers hold 8 segments and shed rings instead, because segments
 * are what a rectangle cannot spare: at 8 the section is a chamfered rectangle,
 * at 4 it is a diamond inscribed in one. LOD3 pays that price — it is the only
 * tier where the block loses its corners — and `sectionAreaInflate` is what
 * keeps it the same *size* as the tier it fades from, which is the part the
 * dither would otherwise expose.
 */
const TIERS: SlabTier[] = [
  { us: [0, 0.3, 0.38, 0.66, 0.74, 1], segments: 8, budget: 112, aoSamples: 12 },
  { us: [0, 0.34, 0.7, 1], segments: 8, budget: 76, aoSamples: 10 },
  { us: [0, 1], segments: 8, budget: 40, aoSamples: 8 },
  { us: [0, 1], segments: 4, budget: 18, aoSamples: 6 }
]

/** How far below y = 0 the base course runs. */
const BURY = 0.14

const buildShape = (options: SlabOptions): SlabShape => {
  const form = options.form ?? 'block'
  const spec = FORMS[form]
  const rng = makeRng(options.seed ?? 1)

  const halfX = options.halfX ?? spec.halfX * rng.range(0.88, 1.16)
  const halfZ = options.halfZ ?? spec.halfZ * rng.range(0.88, 1.16)
  const height = options.height ?? spec.height * rng.range(0.9, 1.15)

  return { halfX, halfZ, height, aspect: halfX / halfZ, rng }
}

const buildTier = (shape: SlabShape, tier: SlabTier, name: string): BufferGeometry => {
  const { segments } = tier
  // Half a step, so the section is sampled either side of its corners.
  const thetaOffset = Math.PI / segments
  const inflate = sectionAreaInflate(segments, thetaOffset, theta => sectionAt(theta, shape.aspect))

  const geometry = loftGeometry({
    us: tier.us,
    segments,
    thetaOffset,
    yAt: u => shape.height * (1 - u * (1 + BURY)),
    radiusAt: (u, theta) => shape.halfX * inflate * slabProfile(u) * sectionAt(theta, shape.aspect),
    capTop: true,
    capBottom: true
  })

  paintCliffRock(geometry, shape.rng, 0.028)

  // Short rays. A slab is convex apart from its own course steps, and those are
  // a few centimetres deep — a long ray budget here would find the ground plane
  // that isn't modelled yet and darken nothing that matters.
  const ao = bakeVertexAO(geometry, {
    samples: tier.aoSamples,
    maxDistance: shape.height * 0.6,
    strength: 0.85,
    power: 1.2
  })
  applyVertexAO(geometry, ao, C.cliffShadow, 0.8)

  return finishTier(geometry, tier.budget, name)
}

export const createSlabAsset = (options: SlabOptions = {}): WorldAsset => {
  const form = options.form ?? 'block'
  const shape = buildShape(options)
  const name = `slab-${form}-${options.seed ?? 1}`

  const tiers = TIERS.map((tier, i) => buildTier(shape, tier, `${name}/LOD${i}`))

  return {
    name,
    perfTag: 'slabs',
    tiers,
    material: createCliffMaterial('slab'),
    outline: createOutlineMaterial({ pixelWidth: 1.6, name: 'slab-outline' }),
    outlineMaxTier: 1,
    radius: Math.hypot(Math.max(shape.halfX, shape.halfZ), shape.height),
    distanceScale: FORMS[form].distanceScale
  }
}

/**
 * Collider box, sized to the **top** course.
 *
 * The lower courses oversail it by about a fifth, so the player brushes through
 * the last few centimetres of the bottom step instead of being stopped short of
 * it. That is the right way round: clipping a corner of a step you are walking
 * past is barely noticeable, whereas a collider sized to the base leaves a rim
 * of thin air around the top face that the player can stand on.
 */
export const slabMetrics = (
  options: SlabOptions = {}
): { halfX: number; halfZ: number; height: number } => {
  const shape = buildShape(options)
  const top = slabProfile(0)
  return { halfX: shape.halfX * top, halfZ: shape.halfZ * top, height: shape.height }
}
