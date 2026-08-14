import { BufferAttribute, BufferGeometry } from 'three'
import { C } from '../art/palette'
import { smoothNormalsByAngle } from '../geometry/normals'
import { makeRng, type Rng } from '../geometry/rng'
import { bakeVertexAO } from '../geometry/vertexAO'
import { applyVertexAO } from '../geometry/vertexColor'
import { createOutlineMaterial } from '../shading/outlineMaterial'
import { mergeParts } from './common'
import { createCliffMaterial, finishTier, paintCliffRock } from './plateau'
import type { WorldAsset } from './types'

/**
 * ─── Columnar basalt ────────────────────────────────────────────────────────
 *
 * A tight cluster of hexagonal prisms at varying heights with flat tops. The
 * one asset in the world that is genuinely prismatic, which makes it the one
 * place the project's normal doctrine has to be read carefully rather than
 * copied.
 *
 * ── Normals: why 30°, and why that is not the mistake GDD R2 documents ──────
 *
 * GDD R2 records a real failure: `smoothNormalsByAngle(38°)` applied to a
 * *curved* surface, where the angle between adjacent faces is a function of
 * tessellation (36° at W=10, 60° at W=6, 90° at W=4). A fixed threshold sits
 * above some of those and below others, so the fine tier smoothed and the
 * coarse tiers went faceted, and the shading solution changed at every LOD
 * boundary. The fix there was to stop asking the mesh and difference the shape
 * function instead.
 *
 * Nothing here curves. A prism's dihedral angles are set by its *cross-section*
 * and its chamfer, not by how finely anything is sampled:
 *
 *   side ↔ side     60° (hexagon) · 72° (pentagon) · 90° (square)
 *   side ↔ chamfer  45°, at every tier, by construction
 *   chamfer ↔ top   45°, at every tier, by construction
 *   within a quad    0°
 *
 * The whole set is `{0°, 45°, 60°…90°}` at *every* tier. A 30° threshold sits
 * below every non-coplanar angle and above 0, so it welds each quad and each
 * top fan into one flat face and keeps every real edge crisp — and it resolves
 * to the identical shading solution at LOD0 and LOD3, which is the property R2
 * actually cares about. Per-face normals are correct for this shape; this is
 * just the project's existing tool arriving at them.
 *
 * The 45° chamfer on every top rim is GDD R2's bevel. It is not decoration: an
 * unchamfered prism top is the one silhouette in the world that catches a
 * pixel-wide specular line along a perfectly hard edge, and it reads as
 * papercraft immediately.
 *
 * Budgets (GDD §4.1): 210 / 124 / 60 / 20.
 */

export interface BasaltOptions {
  seed?: number
  /** Circumradius of one column in metres. */
  radius?: number
  /** Height of the tallest (central) column. */
  height?: number
}

interface Column {
  x: number
  z: number
  radius: number
  height: number
  /** Section start angle — no two neighbours share a facet direction. */
  rotation: number
  /** Ranking for tier reduction: tall and central survives, short and outer goes. */
  prominence: number
}

interface BasaltShape {
  columns: Column[]
  radius: number
  height: number
  /** Outer edge of the cluster, for bounds and scatter spacing. */
  extent: number
  rng: Rng
}

interface BasaltTier {
  /** Columns kept. Fewer means each survivor is inflated to hold the mass. */
  columns: number
  /** Sides per prism. Triangles per column = 5·sides − 2. */
  sides: number
  budget: number
  aoSamples: number
}

const TIERS: BasaltTier[] = [
  { columns: 7, sides: 6, budget: 210, aoSamples: 10 },
  { columns: 5, sides: 5, budget: 124, aoSamples: 8 },
  { columns: 3, sides: 4, budget: 60, aoSamples: 8 },
  { columns: 1, sides: 4, budget: 20, aoSamples: 6 }
]

/** How far below y = 0 a column runs, as a fraction of its height. */
const BURY = 0.18

/** Chamfer as a fraction of the column radius. 45°, so Δy equals Δradius. */
const CHAMFER = 0.13

const buildShape = (options: BasaltOptions): BasaltShape => {
  const rng = makeRng(options.seed ?? 1)
  const radius = options.radius ?? 0.62 * rng.range(0.85, 1.2)
  const height = options.height ?? 3.2 * rng.range(0.8, 1.3)

  // Hexagonal lattice at 1.72 × circumradius. Perfect hexagon tiling wants
  // √3 ≈ 1.732; going marginally under makes neighbours interpenetrate, which
  // is what closes the vertical seams between them. A gap there is a light leak
  // straight through the cluster and it is the first thing the eye finds.
  const spacing = radius * 1.72
  const columns: Column[] = []

  columns.push({
    x: 0,
    z: 0,
    radius,
    // Tallest by construction, because the collider describes this column and
    // nothing else — see `basaltMetrics`.
    height: height,
    rotation: rng.range(0, Math.PI / 3),
    prominence: Number.POSITIVE_INFINITY
  })

  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + rng.spread(0.12)
    const distance = spacing * rng.range(0.94, 1.06)
    // Two of the six stay near full height so the cluster has a shoulder rather
    // than a single spike; the rest drop away into a broken apron.
    const tall = i === 1 || i === 4
    const columnHeight = height * (tall ? rng.range(0.74, 0.9) : rng.range(0.34, 0.62))
    columns.push({
      x: Math.cos(angle) * distance,
      z: Math.sin(angle) * distance,
      radius: radius * rng.range(0.86, 1.08),
      height: columnHeight,
      rotation: rng.range(0, Math.PI / 3),
      prominence: columnHeight
    })
  }

  let extent = 0
  for (const column of columns) {
    extent = Math.max(extent, Math.hypot(column.x, column.z) + column.radius)
  }

  return { columns, radius, height, extent, rng }
}

/**
 * One chamfered prism, indexed, positions only.
 *
 * Three rings top-down — chamfer edge, shoulder, base — so the band winding is
 * the same "upper ring first" convention the loft uses. The bottom is left
 * open: the prop is placed buried by `BURY`, the material is front-side, and a
 * fan down there would cost `sides − 2` triangles per column per tier to close
 * a hole nothing can see.
 */
const buildColumn = (column: Column, sides: number): BufferGeometry => {
  const chamfer = column.radius * CHAMFER
  const rings: { y: number; radius: number }[] = [
    { y: column.height, radius: column.radius - chamfer },
    { y: column.height - chamfer, radius: column.radius },
    { y: -column.height * BURY, radius: column.radius }
  ]

  const positions = new Float32Array(rings.length * sides * 3)
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r]!
    for (let s = 0; s < sides; s++) {
      const theta = column.rotation + (s / sides) * Math.PI * 2
      const i = (r * sides + s) * 3
      positions[i] = column.x + Math.cos(theta) * ring.radius
      positions[i + 1] = ring.y
      positions[i + 2] = column.z + Math.sin(theta) * ring.radius
    }
  }

  const indices: number[] = []
  for (let r = 0; r < rings.length - 1; r++) {
    for (let s = 0; s < sides; s++) {
      const a = r * sides + s
      const b = r * sides + ((s + 1) % sides)
      const c = (r + 1) * sides + s
      const d = (r + 1) * sides + ((s + 1) % sides)
      indices.push(a, b, c, b, d, c)
    }
  }
  // Fan the flat top off vertex 0 rather than off an added centre vertex: the
  // face is planar and convex, so a centre vertex would buy two extra triangles
  // and nothing else.
  for (let s = 1; s < sides - 1; s++) {
    indices.push(0, s + 1, s)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  // See the header: 30° is below every non-coplanar dihedral this generator can
  // produce, at every tier, and above the 0° within a quad.
  return smoothNormalsByAngle(geometry, 30)
}

/**
 * The columns a tier keeps, tallest-and-most-central first, each widened to
 * carry the mass of the ones dropped.
 *
 * The exponent is well under the 0.5 that would conserve footprint area,
 * because these are packed: a survivor already covers part of what its dropped
 * neighbour covered, and conserving area outright turns a broken cluster into
 * one fat stump at LOD2.
 */
const selectColumns = (shape: BasaltShape, count: number): Column[] => {
  if (count >= shape.columns.length) {
    return shape.columns
  }
  if (count === 1) {
    // A single prism spanning the whole footprint. Same reasoning as the GDD's
    // impostor rule: real geometry at its coarsest, not a stand-in that shades
    // differently from the tiers either side of it.
    return [
      {
        x: 0,
        z: 0,
        radius: shape.extent * 0.66,
        height: shape.height * 0.88,
        rotation: shape.columns[0]!.rotation,
        prominence: Number.POSITIVE_INFINITY
      }
    ]
  }

  const ranked = [...shape.columns].sort((a, b) => b.prominence - a.prominence).slice(0, count)
  const inflate = (shape.columns.length / count) ** 0.28
  return ranked.map(column => ({ ...column, radius: column.radius * inflate }))
}

const buildTier = (shape: BasaltShape, tier: BasaltTier, name: string): BufferGeometry => {
  const parts = selectColumns(shape, tier.columns).map(column => buildColumn(column, tier.sides))
  const merged = mergeParts(parts, name)

  // Painted on the merged cluster, not per column, so the vertical ramp
  // describes the whole formation — a short column shaded over its own height
  // gets a top as pale as the tallest one's and the cluster flattens out.
  paintCliffRock(merged, shape.rng, 0.045)

  // The prize here is the packed gaps between columns going dark. A radius of
  // roughly one spacing is what reaches across a joint without also shading the
  // open tops, which have to stay pale for the flat-top read to survive.
  const ao = bakeVertexAO(merged, {
    samples: tier.aoSamples,
    maxDistance: shape.radius * 1.7,
    strength: 0.95,
    power: 1.1
  })
  applyVertexAO(merged, ao, C.cliffShadow, 0.9)

  return finishTier(merged, tier.budget, name)
}

export const createBasaltAsset = (options: BasaltOptions = {}): WorldAsset => {
  const shape = buildShape(options)
  const name = `basalt-${options.seed ?? 1}`

  const tiers = TIERS.map((tier, i) => buildTier(shape, tier, `${name}/LOD${i}`))

  return {
    name,
    perfTag: 'basalt',
    tiers,
    material: createCliffMaterial('basalt'),
    outline: createOutlineMaterial({ pixelWidth: 1.6, name: 'basalt-outline' }),
    outlineMaxTier: 1,
    radius: Math.hypot(shape.extent, shape.height),
    distanceScale: 1.4
  }
}

/**
 * Collider dimensions. Deliberately just the central column.
 *
 * A cylinder can describe exactly one top face, and this prop's whole point is
 * that its tops are at different heights. Sizing to the cluster would either
 * float the player over the short columns or bury them in the tall ones, and of
 * the two failures standing on air is the one players report as a bug. So the
 * central column — the tallest by construction — is what the collider is, and
 * the apron around it is scenery to be walked past rather than over.
 */
export const basaltMetrics = (options: BasaltOptions = {}): { radius: number; height: number } => {
  const center = buildShape(options).columns[0]!
  return { radius: center.radius * (1 - CHAMFER), height: center.height }
}
