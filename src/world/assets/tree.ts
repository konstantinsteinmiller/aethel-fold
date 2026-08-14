import type { BufferGeometry, Color } from 'three'
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
 * ─── Broadleaf trees: two species out of one generator ──────────────────────
 *
 * The showpiece for the whole art doctrine. 162 triangles at LOD0 for the oak,
 * 180 for the maple, and every technique in `src/world/geometry/` is doing a job:
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
 * ── Why the second species lives here and not in its own file ───────────────
 *
 * `form` picks a row of `FORMS`, and that row is the *whole* difference between
 * the oak and the field maple: trunk fraction, clump count, spread, squash, lean
 * and the foliage triple. Nothing below the table branches on the form, so a
 * third species is a row rather than a code path — and both forms come out of
 * one material, one ramp and one budget ladder, so a mixed wood still costs one
 * draw call per tier per scatter field. A second file would have doubled the
 * draw calls to render the same wood.
 *
 * The colours carry as much of the read as the geometry does. Two seeds of the
 * same silhouette are indistinguishable past ~40 m; the maple's warm, yellower
 * canopy (`foliageWarm*`) separates the two at any distance. Bark stays
 * `barkBase`/`barkDark` for both — they are the same genus, and a recoloured
 * trunk reads as a different *material* rather than as a different tree.
 *
 * Budget ladder (GDD §4.1): 200 / 110 / 56 / 16, one ladder for both forms.
 * See `clumpSegmentBias` for what pays for the maple's extra clump.
 */

export type TreeForm = 'broadleaf' | 'crown'

export interface TreeOptions {
  seed?: number
  /** Overall height in metres, canopy top included. Defaults per form. */
  height?: number
  trunkRadius?: number
  clumpCount?: number
  /** Species. Defaults to `'broadleaf'` — the shape `tree-oak` was authored as. */
  form?: TreeForm
}

/**
 * Everything that differs between species. Ranges are drawn from the rng in the
 * order they are listed in `buildShape`, so a row is read top to bottom there.
 */
interface FormSpec {
  /**
   * Default overall height. A constant rather than a range on purpose: an rng
   * draw for it would have to happen before the clump loop, and every draw after
   * a new one shifts, which silently re-rolls every tree standing in a saved
   * level. Per-instance variation comes from the caller passing `height`.
   */
  height: number
  trunkRadius: number
  clumpCount: number
  /** Height of the split, as a fraction of the whole. The strongest species cue. */
  trunkTop: [number, number]
  leanAmount: [number, number]
  /** Distance of a clump centre from the trunk axis. */
  spread: [number, number]
  /** How far a clump centre sits above the split. */
  rise: [number, number]
  clumpRadius: [number, number]
  lumpAmp: [number, number]
  lumpPower: [number, number]
  /** Vertical squash of a clump. Low = a flattened canopy, high = a dome. */
  squash: [number, number]
  /** Vertical squash of the LOD3 canopy impostor — the whole mass, not a clump. */
  impostorSquash: number
  /** Longitudinal segments added to (or taken from) every clump, at every tier. */
  clumpSegmentBias: number
  foliage: { lit: Color; base: Color; deep: Color }
}

const FORMS: Record<TreeForm, FormSpec> = {
  // The oak: a wide, low, flattened ball of three clumps on a short leaning
  // trunk. Every number in this row is load-bearing beyond art — `tree-oak` is a
  // persisted placeable id, so a seed that produced a given tree has to keep
  // producing it, byte for byte. Nothing here may move.
  broadleaf: {
    height: 5.4,
    trunkRadius: 0.29,
    clumpCount: 3,
    trunkTop: [0.54, 0.62],
    leanAmount: [0.1, 0.28],
    spread: [0.35, 0.85],
    rise: [0.35, 1.05],
    clumpRadius: [1.02, 1.42],
    // Broad, gentle lumps: a canopy wants a soft irregular mass, not knuckles.
    lumpAmp: [0.1, 0.26],
    lumpPower: [1.1, 2.4],
    squash: [0.72, 0.9],
    impostorSquash: 0.78,
    clumpSegmentBias: 0,
    foliage: { lit: C.foliageLit, base: C.foliageBase, deep: C.foliageDeep }
  },
  // The field maple: taller, narrower, and split high. The trunk runs to ~71 %
  // of the height before it carries anything, against the oak's 58 %, and that
  // one number does most of the work — height is what the eye reads first.
  //
  // The lean nearly disappears with it. A 0.28 offset that reads as character on
  // a 5 m tree reads as storm damage on a 7 m one, because the lean is applied
  // as `t^1.7` of a fixed distance and the top of a taller trunk travels the
  // same absolute distance over a longer, more visible span.
  crown: {
    height: 7.2,
    trunkRadius: 0.3,
    clumpCount: 4,
    trunkTop: [0.68, 0.74],
    leanAmount: [0.04, 0.12],
    // Tight enough that the four clumps fuse into one dome instead of ringing
    // the trunk top as separate balls — at this clump radius the centres are
    // closer together than a single clump is wide.
    spread: [0.3, 0.58],
    rise: [0.25, 0.7],
    clumpRadius: [0.86, 1.12],
    // Shallower and tighter lumps than the oak's: a small clump carries a lump
    // of the same relative depth over a third of the arc, so the oak's numbers
    // here turn a maple clump into a knuckle.
    lumpAmp: [0.08, 0.2],
    lumpPower: [1.3, 2.6],
    // Barely squashed. The oak's canopy is a flattened disc; this one is a dome,
    // and the roundness is the second thing that separates them at distance.
    squash: [0.86, 0.98],
    impostorSquash: 0.9,
    // Four clumps instead of three, paid for out of the clumps' own resolution
    // rather than out of the budget: each gives up one longitudinal segment,
    // which lands the tiers at 180 / 84 / 54 against 200 / 110 / 56. The clumps
    // are ~30 % smaller in radius, so a segment of one covers about the same
    // screen area as an oak's — the detail moves, it isn't lost.
    //
    // Five clumps does not fit: LOD2 would want 66 triangles against 56, and the
    // only way back under is a 2-segment clump, which is a flat quad.
    clumpSegmentBias: -1,
    foliage: { lit: C.foliageWarmLit, base: C.foliageWarmBase, deep: C.foliageWarmDeep }
  }
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
  spec: FormSpec
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
  const spec = FORMS[options.form ?? 'broadleaf']
  const {
    seed = 1,
    height = spec.height,
    trunkRadius = spec.trunkRadius,
    clumpCount = spec.clumpCount
  } = options
  const rng = makeRng(seed)

  const trunkTop = height * rng.range(spec.trunkTop[0], spec.trunkTop[1])
  const leanAngle = rng.range(0, Math.PI * 2)
  const leanAmount = rng.range(spec.leanAmount[0], spec.leanAmount[1])
  const lean = new Vector3(Math.cos(leanAngle) * leanAmount, 0, Math.sin(leanAngle) * leanAmount)

  const clumps: TreeShape['clumps'] = []
  const canopyCenter = new Vector3()
  const scratch = new Vector3()

  for (let i = 0; i < clumpCount; i++) {
    // Clumps ring the trunk top with a golden-angle spread, so no seed can
    // produce two clumps stacked on the same side.
    const angle = (i / clumpCount) * Math.PI * 2 + rng.spread(0.5) + seed * 2.39996
    const spread = rng.range(spec.spread[0], spec.spread[1])
    const radius = rng.range(spec.clumpRadius[0], spec.clumpRadius[1])
    const center = new Vector3(
      Math.cos(angle) * spread,
      trunkTop + rng.range(spec.rise[0], spec.rise[1]),
      Math.sin(angle) * spread
    )
    center.add(trunkLean(1, lean, scratch))

    clumps.push({
      center,
      radius,
      lumps: makeLumps(rng, 4, spec.lumpAmp, spec.lumpPower),
      squash: rng.range(spec.squash[0], spec.squash[1])
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
    spec,
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

  // Bark is the one part that does *not* come from the form: both species are
  // the same genus, and recolouring the trunk reads as a different material
  // rather than as a different tree.
  paintUniform(geometry, C.barkBase)
  paintByHeight(geometry, C.barkDark, C.barkBase, { curve: 0.55 })
  return geometry
}

const buildClump = (
  shape: TreeShape,
  clump: TreeShape['clumps'][number],
  widthSegments: number,
  heightSegments: number
): BufferGeometry => {
  const { foliage } = shape.spec
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
  paintUniform(geometry, foliage.base)
  // Radial depth, so the underside of the canopy is already dark before AO runs.
  // Without it a 40-triangle clump lit from above has no bottom at all.
  paintRadial(geometry, new Vector3(0, clump.radius * 0.6, 0), foliage.base, foliage.deep, clump.radius * 1.9)
  paintByUpness(geometry, foliage.lit, 0.6, 2)

  geometry.translate(clump.center.x, clump.center.y, clump.center.z)
  return geometry
}

interface TierSpec {
  trunkRadial: number
  trunkRings: number
  /** Before `clumpSegmentBias`, which is how a form pays for extra clumps. */
  clumpW: number
  clumpH: number
  budget: number
  aoSamples: number
}

// Triangles = trunkRadial × (trunkRings − 1) × 2 + clumps × (clumpW + bias) × (2·clumpH − 2)
const TIERS: TierSpec[] = [
  { trunkRadial: 6, trunkRings: 4, clumpW: 7, clumpH: 4, budget: 200, aoSamples: 16 }, // 162 oak / 180 maple
  { trunkRadial: 5, trunkRings: 3, clumpW: 5, clumpH: 3, budget: 110, aoSamples: 12 }, //  80 oak /  84 maple
  { trunkRadial: 3, trunkRings: 2, clumpW: 4, clumpH: 3, budget: 56, aoSamples: 8 } //     54 oak /  54 maple
]

const buildTier = (shape: TreeShape, tier: TierSpec, name: string): BufferGeometry => {
  // Clamped at 3: two longitudinal segments is a flat quad, not a clump, and it
  // would break the "same shape at a different resolution" contract outright.
  const clumpW = Math.max(3, tier.clumpW + shape.spec.clumpSegmentBias)

  const parts: BufferGeometry[] = [buildTrunk(shape, tier.trunkRadial, tier.trunkRings)]
  for (const clump of shape.clumps) {
    parts.push(buildClump(shape, clump, clumpW, tier.clumpH))
  }

  const ranges = partRanges(parts)
  const merged = mergeParts(parts, name)

  // Baked on the merged tree so the canopy occludes the trunk. Range-split on
  // apply so the trunk resolves toward bark-dark and the leaves toward the
  // form's deep foliage — one shared deep colour would green the trunk's
  // crevices, and the warm form would drag them olive.
  const ao = bakeVertexAO(merged, {
    samples: tier.aoSamples,
    maxDistance: shape.canopyRadius * 0.75,
    strength: 0.95,
    power: 1.15
  })
  applyVertexAO(merged, ao, C.barkDark, 0.7, ranges[0])
  for (let i = 1; i < ranges.length; i++) {
    applyVertexAO(merged, ao, shape.spec.foliage.deep, 0.9, ranges[i])
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
  return assertTriBudget(merged, tier.budget, name)
}

/**
 * LOD3 at 220 m+: a canopy impostor plus a 6-triangle trunk stub.
 *
 * The stub is not optional. A canopy-only impostor makes every tree visibly
 * hop upward at the LOD2→LOD3 boundary — the trunk is still ~15 screen pixels
 * there, and losing it is exactly the pop the crossfade exists to prevent. It
 * matters more for the maple, whose trunk is 70 % of its height.
 */
const buildImpostor = (shape: TreeShape, name: string): BufferGeometry => {
  const { foliage } = shape.spec
  const canopy = blobGeometry({
    radius: shape.canopyRadius * 0.94,
    widthSegments: 5,
    heightSegments: 2,
    lumps: shape.clumps[0]!.lumps,
    scale: new Vector3(1, shape.spec.impostorSquash, 1)
  })
  blendNormalsToSphere(canopy, new Vector3(0, 0, 0), 0.9)
  paintUniform(canopy, foliage.base)
  paintRadial(
    canopy,
    new Vector3(0, shape.canopyRadius * 0.5, 0),
    foliage.base,
    foliage.deep,
    shape.canopyRadius * 1.9
  )
  paintByUpness(canopy, foliage.lit, 0.5, 2)
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
  const form = options.form ?? 'broadleaf'
  const shape = buildShape(options)
  const name = `tree-${form}-${options.seed ?? 1}`

  const tiers: BufferGeometry[] = TIERS.map((tier, i) => buildTier(shape, tier, `${name}/LOD${i}`))
  tiers.push(buildImpostor(shape, `${name}/LOD3`))

  const radius = Math.max(shape.canopyCenter.y + shape.canopyRadius, shape.canopyRadius * 1.2)

  return {
    name,
    // Both forms share the tag *and* the material, which is the point of keeping
    // them in one generator: a mixed wood is one draw call per tier per field.
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

/**
 * Trunk and canopy dimensions of a generated tree, for collider sizing.
 *
 * `trunkRadius` is the trunk's **widest** section, flare included — the
 * inscribed rule the walkable props follow is inverted for a blocker. A
 * collider under the visible trunk lets the player walk into wood before
 * anything stops them; one slightly over it costs a few centimetres of
 * clearance around a flare that is ankle-high anyway.
 *
 * The canopy numbers are for scatter clearance, never for a collider: it starts
 * at head height, and stopping the player there reads as an invisible wall in
 * open ground.
 */
export const treeMetrics = (
  options: TreeOptions = {}
): { trunkRadius: number; trunkHeight: number; canopyRadius: number; canopyTop: number } => {
  const shape = buildShape(options)
  return {
    trunkRadius: trunkProfile(0, shape.trunkBaseRadius),
    // Stops at the split — above it the canopy takes over.
    trunkHeight: shape.trunkTop,
    canopyRadius: shape.canopyRadius,
    canopyTop: shape.canopyCenter.y + shape.canopyRadius
  }
}
