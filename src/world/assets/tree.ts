import type { BufferGeometry } from 'three'
import { Vector3 } from 'three'
import { C } from '../art/palette'
import { assertTriBudget } from '../geometry/budget'
import { blobGeometry, type Lump, makeLumps, paintWindWeight, type Ring, tubeGeometry } from '../geometry/build'
import { blendNormalsToCylinder, blendNormalsToSphere } from '../geometry/normals'
import { makeRng, type Rng } from '../geometry/rng'
import { bakeVertexAO } from '../geometry/vertexAO'
import {
  applyVertexAO,
  jitterColor,
  paintByHeight,
  paintByUpness,
  paintRadial,
  paintUniform
} from '../geometry/vertexColor'
import { createOutlineMaterial } from '../shading/outlineMaterial'
import { getFoliageRamp } from '../shading/ramp'
import { createToonMaterial } from '../shading/toonMaterial'
import { mergeParts, partRanges } from './common'
import type { WorldAsset } from './types'

/**
 * ─── Broadleaf tree ─────────────────────────────────────────────────────────
 *
 * The showpiece for the whole art doctrine. 162 triangles at LOD0, and every
 * technique in `src/world/geometry/` is doing a job:
 *
 *   • the trunk is a 6-sided tube with **cylindrical normals**, so it shades
 *     like a turned column — a 12-sided trunk is indistinguishable and costs
 *     another 36 triangles the canopy needs more
 *   • each canopy clump gets **spherical normals at 0.85**, which is why the
 *     toon band sweeps across the canopy in one arc instead of stair-stepping
 *     per face (GDD R3 — the single biggest quality lever in the file)
 *   • AO is baked on the **merged** tree, so the canopy genuinely darkens the
 *     trunk beneath it and the clumps shade each other
 *   • all four tiers are generated from **one seeded shape description**, so
 *     their silhouettes agree and the dithered crossfade has nothing to reveal
 *
 * Budget ladder (GDD §4.1): 200 / 110 / 56 / 16.
 */

export interface TreeOptions {
  seed?: number
  /** Overall height in metres, canopy top included. */
  height?: number
  trunkRadius?: number
  clumpCount?: number
}

/**
 * The LOD-independent description of one tree. Generated once per seed; each
 * tier is this same shape sampled at a different resolution.
 */
interface TreeShape {
  height: number
  trunkTop: number
  trunkBaseRadius: number
  lean: Vector3
  clumps: { center: Vector3; radius: number; lumps: Lump[]; squash: number }[]
  canopyCenter: Vector3
  canopyRadius: number
  rng: Rng
}

/** Trunk radius as a continuous function of height fraction — LOD-safe (§4.3). */
const trunkProfile = (t: number, baseRadius: number): number => {
  // Linear taper plus an exponential root flare. The flare is only ~8 % of the
  // trunk's height but it is most of what makes the tree look planted rather
  // than pushed into the ground like a stick.
  const taper = baseRadius * (1 - 0.52 * t)
  const flare = baseRadius * 0.42 * Math.exp(-t * 9)
  return taper + flare
}

/** Trunk centreline offset — a dead-straight trunk reads as a lamp post. */
const trunkLean = (t: number, lean: Vector3, out: Vector3): Vector3 =>
  out.copy(lean).multiplyScalar(t ** 1.7)

const buildShape = (options: TreeOptions): TreeShape => {
  const { seed = 1, height = 5.4, trunkRadius = 0.29, clumpCount = 3 } = options
  const rng = makeRng(seed)

  const trunkTop = height * rng.range(0.54, 0.62)
  const leanAngle = rng.range(0, Math.PI * 2)
  const leanAmount = rng.range(0.1, 0.28)
  const lean = new Vector3(Math.cos(leanAngle) * leanAmount, 0, Math.sin(leanAngle) * leanAmount)

  const clumps: TreeShape['clumps'] = []
  const canopyCenter = new Vector3()
  const scratch = new Vector3()

  for (let i = 0; i < clumpCount; i++) {
    // Clumps ring the trunk top with a golden-angle spread, so no seed can
    // produce two clumps stacked on the same side.
    const angle = (i / clumpCount) * Math.PI * 2 + rng.spread(0.5) + seed * 2.39996
    const spread = rng.range(0.35, 0.85)
    const radius = rng.range(1.02, 1.42)
    const center = new Vector3(
      Math.cos(angle) * spread,
      trunkTop + rng.range(0.35, 1.05),
      Math.sin(angle) * spread
    )
    center.add(trunkLean(1, lean, scratch))

    clumps.push({
      center,
      radius,
      // Broad, gentle lumps: a canopy wants a soft irregular mass, not knuckles.
      lumps: makeLumps(rng, 4, [0.1, 0.26], [1.1, 2.4]),
      squash: rng.range(0.72, 0.9)
    })
    canopyCenter.addScaledVector(center, 1 / clumpCount)
  }

  let canopyRadius = 0
  for (const clump of clumps) {
    canopyRadius = Math.max(canopyRadius, clump.center.distanceTo(canopyCenter) + clump.radius)
  }

  return {
    height,
    trunkTop,
    trunkBaseRadius: trunkRadius,
    lean,
    clumps,
    canopyCenter,
    canopyRadius,
    rng
  }
}

const buildTrunk = (shape: TreeShape, radialSegments: number, ringCount: number): BufferGeometry => {
  const rings: Ring[] = []
  const offset = new Vector3()
  for (let i = 0; i < ringCount; i++) {
    const t = i / (ringCount - 1)
    // The trunk runs a little past the canopy base so it never peeks out from
    // under the leaves when the LOD drops the clumps' lower lobes.
    const y = t * (shape.trunkTop + 0.35)
    trunkLean(t, shape.lean, offset)
    rings.push({
      center: new Vector3(offset.x, y, offset.z),
      radius: trunkProfile(t, shape.trunkBaseRadius)
    })
  }

  // `tubeGeometry` is indexed and welded, so `computeVertexNormals` inside it
  // already produces smooth shared normals — no angle pass needed, and keeping
  // it indexed is what lets it merge with the (also indexed) canopy blobs.
  const geometry = tubeGeometry(rings, radialSegments)
  blendNormalsToCylinder(geometry, new Vector3(0, 0, 0), new Vector3(0, 1, 0), 0.85)

  paintUniform(geometry, C.barkBase)
  paintByHeight(geometry, C.barkDark, C.barkBase, { curve: 0.55 })
  return geometry
}

const buildClump = (
  clump: TreeShape['clumps'][number],
  widthSegments: number,
  heightSegments: number
): BufferGeometry => {
  const geometry = blobGeometry({
    radius: clump.radius,
    widthSegments,
    heightSegments,
    lumps: clump.lumps,
    scale: new Vector3(1, clump.squash, 1)
  })

  // The foliage law (GDD R3), now applied on top of already-analytic normals:
  // the lump field would otherwise shade every bulge separately and the canopy
  // reads as a bag of spheres. `radiusBias` pushes the virtual centre down so
  // the top flattens into the light band instead of curling over.
  blendNormalsToSphere(geometry, new Vector3(0, 0, 0), 0.85, clump.radius * 0.18)

  // Order matters: `paintRadial` *replaces* the colour, the other two blend into
  // whatever is already there.
  paintUniform(geometry, C.foliageBase)
  // Radial depth, so the underside of the canopy is already dark before AO runs.
  // Without it a 40-triangle clump lit from above has no bottom at all.
  paintRadial(geometry, new Vector3(0, clump.radius * 0.6, 0), C.foliageBase, C.foliageDeep, clump.radius * 1.9)
  paintByUpness(geometry, C.foliageLit, 0.6, 2)

  geometry.translate(clump.center.x, clump.center.y, clump.center.z)
  return geometry
}

interface TierSpec {
  trunkRadial: number
  trunkRings: number
  clumpW: number
  clumpH: number
  budget: number
  aoSamples: number
}

// Triangles = trunkRadial × (trunkRings − 1) × 2  +  clumps × clumpW × (2·clumpH − 2)
const TIERS: TierSpec[] = [
  { trunkRadial: 6, trunkRings: 4, clumpW: 7, clumpH: 4, budget: 200, aoSamples: 16 }, // 36 + 126 = 162
  { trunkRadial: 5, trunkRings: 3, clumpW: 5, clumpH: 3, budget: 110, aoSamples: 12 }, //  20 +  60 =  80
  { trunkRadial: 3, trunkRings: 2, clumpW: 4, clumpH: 3, budget: 56, aoSamples: 8 } //     6 +  48 =  54
]

const buildTier = (shape: TreeShape, spec: TierSpec, name: string): BufferGeometry => {
  const parts: BufferGeometry[] = [buildTrunk(shape, spec.trunkRadial, spec.trunkRings)]
  for (const clump of shape.clumps) {
    parts.push(buildClump(clump, spec.clumpW, spec.clumpH))
  }

  const ranges = partRanges(parts)
  const merged = mergeParts(parts, name)

  // Baked on the merged tree so the canopy occludes the trunk. Range-split on
  // apply so the trunk resolves toward bark-dark and the leaves toward
  // foliage-deep — one shared deep colour would green the trunk's crevices.
  const ao = bakeVertexAO(merged, {
    samples: spec.aoSamples,
    maxDistance: shape.canopyRadius * 0.75,
    strength: 0.95,
    power: 1.15
  })
  applyVertexAO(merged, ao, C.barkDark, 0.7, ranges[0])
  for (let i = 1; i < ranges.length; i++) {
    applyVertexAO(merged, ao, C.foliageDeep, 0.9, ranges[i])
  }

  jitterColor(merged, shape.rng, 0.04)

  // Wind weight ramps from still at the root to full in the canopy. Derived
  // from height rather than from part membership so it's continuous — a step
  // at the trunk/canopy join would tear the mesh open in a gust.
  const windStart = shape.trunkTop * 0.3
  const windEnd = shape.canopyCenter.y + shape.canopyRadius
  paintWindWeight(merged, (_x, y) => {
    const t = Math.min(1, Math.max(0, (y - windStart) / (windEnd - windStart)))
    return t ** 1.5
  })

  merged.computeBoundingSphere()
  return assertTriBudget(merged, spec.budget, name)
}

/**
 * LOD3 at 220 m+: a canopy impostor plus a 6-triangle trunk stub.
 *
 * The stub is not optional. A canopy-only impostor makes every tree visibly
 * hop upward at the LOD2→LOD3 boundary — the trunk is still ~15 screen pixels
 * there, and losing it is exactly the pop the crossfade exists to prevent.
 */
const buildImpostor = (shape: TreeShape, name: string): BufferGeometry => {
  const canopy = blobGeometry({
    radius: shape.canopyRadius * 0.94,
    widthSegments: 5,
    heightSegments: 2,
    lumps: shape.clumps[0]!.lumps,
    scale: new Vector3(1, 0.78, 1)
  })
  blendNormalsToSphere(canopy, new Vector3(0, 0, 0), 0.9)
  paintUniform(canopy, C.foliageBase)
  paintRadial(
    canopy,
    new Vector3(0, shape.canopyRadius * 0.5, 0),
    C.foliageBase,
    C.foliageDeep,
    shape.canopyRadius * 1.9
  )
  paintByUpness(canopy, C.foliageLit, 0.5, 2)
  canopy.translate(shape.canopyCenter.x, shape.canopyCenter.y, shape.canopyCenter.z)

  const offset = new Vector3()
  const rings: Ring[] = [
    { center: new Vector3(0, 0, 0), radius: trunkProfile(0, shape.trunkBaseRadius) * 0.85 },
    {
      center: trunkLean(1, shape.lean, offset).clone().setY(shape.trunkTop),
      radius: trunkProfile(1, shape.trunkBaseRadius)
    }
  ]
  const stub = tubeGeometry(rings, 3)
  blendNormalsToCylinder(stub, new Vector3(0, 0, 0), new Vector3(0, 1, 0), 0.85)
  paintUniform(stub, C.barkDark)

  const merged = mergeParts([canopy, stub], name)
  paintWindWeight(merged, (_x, y) => (y > shape.trunkTop ? 0.6 : 0))
  merged.computeBoundingSphere()
  return assertTriBudget(merged, 16, name)
}

export const createTreeAsset = (options: TreeOptions = {}): WorldAsset => {
  const shape = buildShape(options)
  const name = `tree-${options.seed ?? 1}`

  const tiers: BufferGeometry[] = TIERS.map((spec, i) => buildTier(shape, spec, `${name}/LOD${i}`))
  tiers.push(buildImpostor(shape, `${name}/LOD3`))

  const radius = Math.max(shape.canopyCenter.y + shape.canopyRadius, shape.canopyRadius * 1.2)

  return {
    name,
    perfTag: 'trees',
    tiers,
    material: createToonMaterial({
      name: 'tree',
      // Foliage ramp for the whole tree, trunk included: they share one draw
      // call, and the softer terminator costs the bark almost nothing.
      ramp: getFoliageRamp(),
      wind: true,
      windStrength: 0.075,
      rimStrength: 0.4
    }),
    outline: createOutlineMaterial({ pixelWidth: 1.6, wind: true, windStrength: 0.075, name: 'tree-outline' }),
    outlineMaxTier: 1,
    radius,
    // Trees are the largest scatter prop, so they hold detail roughly twice as
    // far out as the base table assumes.
    distanceScale: 2
  }
}
