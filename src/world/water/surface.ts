import { BufferAttribute, BufferGeometry, Vector3 } from 'three'
import { WATER_ATTRIBUTES, type HeightSampler, type RiverNode, type WaterStyle, type WaterSurface } from './types'

/**
 * ─── Water surfaces: pools and river ribbons ────────────────────────────────
 *
 * The geometry half of the water system. `types.ts` explains why depth and
 * shore distance are *vertex attributes* here rather than a depth-buffer read;
 * this file is what bakes them.
 *
 * ── Tessellation is for the waves, not for the silhouette ───────────────────
 *
 * Every other generator in this world is budgeted by GDD R1 — triangles only
 * where they change the outline. Water is the one exception, and it has to be,
 * because the vertex shader *displaces* this sheet. A quad is the finest
 * wavelength the surface can express: at one quad per 8 m the sea's 11 m wave
 * is a triangle with a bump in it, and no amount of shader work recovers it.
 *
 * So quad size comes from the style, not from the body's size:
 *
 *   quad = min( waveLength / 7 , foamWidth / 2 )
 *
 * The wave term is the obvious one. The **foam term is the one that gets
 * forgotten**: `aShore` is a vertex attribute, so the foam band's profile is
 * whatever the hardware interpolates between two vertices. With 1.5 m of foam
 * and 8 m quads the entire band lives inside one quad's interpolation and the
 * shoreline reads as a single hard gradient wrapped round the whole body.
 *
 * A still style (`waveAmplitude === 0`, which the pond is *exactly*) drops the
 * wave term entirely — nothing displaces it, so paying for wave resolution buys
 * a mirror with more triangles in it.
 *
 * ── …and then it is capped, and a uniform grid stops being the answer ───────
 *
 * That rule is scale-free and the world is not. A 340 m sea at the sea preset's
 * ideal 0.75 m quad is 206 000 vertices. `MAX_WATER_VERTICES` clamps the base
 * grid, and on that sea the clamp lands at **3.43 m quads** — 4.6× coarser than
 * the foam band asked for.
 *
 * Which shipped, and looked exactly as bad as the arithmetic says. The
 * shoreline rendered as **large angular white shards with straight polygon
 * edges**. The shader is what makes this so unforgiving: its foam band is
 * *quantised into three hard steps*, not ramped (`waterGlsl.ts` — a smooth
 * falloff is the clearest tell of stock engine water). A hard step across a
 * linearly-interpolated vertex attribute lands on a **straight line inside each
 * triangle**, so the band's outline is not merely coarse, it is literally the
 * tessellation drawn in white.
 *
 * Raising the cap is the wrong fix and it is worth being precise about why: a
 * uniform grid spends ~97 % of its vertices on open water where `aShore` is a
 * constant 1 and *nothing varies at all*. Doubling it doubles that waste to buy
 * a 1.4× finer shoreline.
 *
 * ── So resolution is spent where `aShore` actually varies ───────────────────
 *
 * Two different mechanisms, because there are two different shores and they
 * have completely different shapes:
 *
 * **The plane's own edge is axis-aligned and exactly linear** — `aShore` ramps
 * 0→1 over `foamWidth` straight in from each side. A linear attribute
 * reproduces that *exactly* provided a vertex line sits at the inset. So the
 * base grid gets two extra lines per axis at ±(half − foamWidth) and the edge
 * band is then correct at any base resolution, for four lines. No subdivision
 * can improve on exact, and subdividing the whole perimeter of the bench sea
 * would have cost 12 700 triangles for foam that is over the horizon.
 *
 * **The terrain waterline is an arbitrary curve**, so it gets local
 * subdivision: any base cell whose corners straddle the shelf term is split
 * into a K×K sub-grid, K ∈ {2,4,8}. Cost is proportional to *shoreline length*
 * rather than to area, which is the whole point — on the bench sea it is ~1 %
 * of the cells.
 *
 * **T-junctions are not survivable here, so the transition is stitched.** The
 * sheet is flat, so a hanging vertex costs nothing in the base geometry — but
 * the vertex shader displaces it, at full amplitude right up to the shoreline
 * (the wave is not depth-damped). A fine vertex on a coarse neighbour's edge
 * then moves to `wave(x,z)` while the coarse edge stays a chord, opening a gap
 * of up to ~9 cm at these quad sizes. Every unrefined cell bordering a refined
 * one is therefore emitted as a **fan from its own centre** through the full
 * boundary vertex ring, hanging vertices included. Only two levels exist
 * (unrefined and K), so no 2:1 balance pass is needed.
 *
 * ── Dry cells are dropped ───────────────────────────────────────────────────
 *
 * A cell whose four corners are all above the surface is not emitted. This is
 * not only overdraw: the shader has no `discard`, and at `aDepth 0, aShore 0`
 * it draws **fully opaque foam** — so a sea plane overlapping a beach was
 * painting a solid white sheet across it. Corner-tested, so a puddle smaller
 * than one base cell is missed; that is the same approximation the refinement
 * test makes and it is why the base cell is sized by the art dials.
 */

/** Quads across one wave crest. Below ~6 the crest visibly becomes a ridge. */
const QUADS_PER_WAVELENGTH = 7
/** Quads across the foam band. 2 is the minimum that gives the band a shape. */
const QUADS_PER_FOAM_BAND = 2
/** No style needs finer than this, and it is where generation time starts to show. */
const MIN_QUAD = 0.25
/** Coarser than this and even the shore normal-interpolation goes blocky. */
const MAX_QUAD = 4

/**
 * Ceiling on the **base grid**, before shore refinement. Worst case 99×99
 * quads. Deliberately left where it was: this is the open-water/wave cost, it
 * was never the thing that was wrong, and the fix for the shoreline must not be
 * paid for out of the sea's body.
 */
export const MAX_WATER_VERTICES = 10_000

/**
 * Ceiling on triangles for one finished body, base + refinement + stitching.
 *
 * This is the currency that matters: water is the transparent, overdraw-heavy
 * pass. Measured in the bench scene at 102 k triangles total with water
 * contributing 40 k, so a single body is held to a bit over a third of that and
 * the refinement level backs off to fit rather than the budget being exceeded.
 */
export const MAX_WATER_TRIANGLES = 36_000

/** Finest shore subdivision of one base cell. 8 is 128 triangles per cell. */
const MAX_REFINE_LEVEL = 8

/**
 * Bearing of a sea's constant drift, radians in the XZ plane.
 *
 * A sea is separated from a pond by `flowSpeed` alone (0.05 vs 0), so this
 * direction is multiplied by it and a pond comes out exactly (0,0) with no
 * branch on the style. The specific bearing is arbitrary — what matters is that
 * it is *constant across the body*, because a sea whose drift varies spatially
 * reads as a current rather than as open water.
 */
const SEA_DRIFT_BEARING = 0.6

/** Catmull-Rom samples per node segment used to build the arc-length table. */
const ARC_SAMPLES_PER_SEGMENT = 24

/**
 * Fraction of the local bend radius a river's half-width is allowed to reach.
 *
 * At 1.0 the inner bank lands exactly on the centre of curvature and collapses
 * to a point; past it the offset curve reverses and the ribbon folds through
 * itself, which renders as a black crease because half the triangles face away.
 * 0.9 leaves the inner edge a tenth of the radius of travel — enough that the
 * along-tangent never reaches zero.
 */
const SAFE_BEND_FRACTION = 0.9

/** Minimum columns across a river. Even, so a vertex lands on the centreline. */
const MIN_RIVER_COLUMNS = 4

// Module-level scratch — generation runs at boot, but the no-allocation
// discipline (GDD §5.2) is cheaper to keep than to reintroduce.
const _pA = new Vector3()
const _pB = new Vector3()
const _pC = new Vector3()
const _pD = new Vector3()
const _dS = new Vector3()
const _dV = new Vector3()
const _n = new Vector3()
const _side = new Vector3()
const _tangent = new Vector3()

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

// ─── Tessellation policy ────────────────────────────────────────────────────

const waterQuadSize = (style: WaterStyle, override?: number): number => {
  if (override !== undefined && override > 0) {
    return clamp(override, MIN_QUAD, MAX_QUAD)
  }
  // `foamWidth` can legitimately be tiny; the clamp below catches a zero.
  let quad = style.foamWidth / QUADS_PER_FOAM_BAND
  if (style.waveAmplitude > 0) {
    quad = Math.min(quad, style.waveLength / QUADS_PER_WAVELENGTH)
  }
  return clamp(quad, MIN_QUAD, MAX_QUAD)
}

/**
 * Shrinks a segment pair until `(a+1)·(b+1)` fits the cap, isotropically so the
 * quads stay square — an anisotropic shrink would resolve the wave along one
 * axis and alias it along the other, which reads as a corduroy pattern crossing
 * the sea at 45°.
 */
const fitToVertexCap = (segA: number, segB: number, cap = MAX_WATER_VERTICES): [number, number] => {
  let a = Math.max(1, Math.round(segA))
  let b = Math.max(1, Math.round(segB))
  while ((a + 1) * (b + 1) > cap && (a > 1 || b > 1)) {
    const scale = Math.sqrt(cap / ((a + 1) * (b + 1)))
    const nextA = Math.max(1, Math.floor(a * scale))
    const nextB = Math.max(1, Math.floor(b * scale))
    if (nextA === a && nextB === b) {
      // The floor has stalled one vertex over; step the longer axis by hand.
      if (a >= b) {
        a -= 1
      } else {
        b -= 1
      }
    } else {
      a = nextA
      b = nextB
    }
  }
  return [a, b]
}

// ─── Shared finishing ───────────────────────────────────────────────────────

const buildGeometry = (
  position: Float32Array,
  normal: Float32Array,
  depth: Float32Array,
  shore: Float32Array,
  flow: Float32Array,
  index: Uint16Array | Uint32Array
): BufferGeometry => {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('normal', new BufferAttribute(normal, 3))
  geometry.setAttribute('aDepth', new BufferAttribute(depth, 1))
  geometry.setAttribute('aShore', new BufferAttribute(shore, 1))
  geometry.setAttribute('aFlow', new BufferAttribute(flow, 2))
  geometry.setIndex(new BufferAttribute(index, 1))
  return geometry
}

/**
 * Measures the built geometry and inflates it by the wave the shader will add.
 *
 * Measured rather than derived from the options on purpose. The two diverge in
 * both generators: a river's bounds are not its node bounding box (the spline
 * overshoots outside the control polygon, and the ribbon is a half-width wider
 * again), and every body is `waveAmplitude` taller than any vertex in it,
 * because the displacement happens after this file is done. A culling sphere
 * built from the node list clips a river's outer bank on every bend.
 */
const measureSurface = (geometry: BufferGeometry, surfaceY: number, waveAmplitude: number): WaterSurface => {
  const position = geometry.getAttribute('position').array as Float32Array
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  let maxDistanceSq = 0

  for (let i = 0; i < position.length; i += 3) {
    const x = position[i]!
    const y = position[i + 1]!
    const z = position[i + 2]!
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
    const distanceSq = x * x + y * y + z * z
    if (distanceSq > maxDistanceSq) maxDistanceSq = distanceSq
  }

  return {
    geometry,
    surfaceY,
    // From the *object origin*, which is what a culling sphere on this mesh is
    // centred on. For a river authored in world coordinates that is a large
    // number — see `waterSurfaceMetrics`, which hands back the footprint centre
    // so the caller can recentre the mesh and get a tight sphere instead.
    radius: Math.sqrt(maxDistanceSq) + waveAmplitude,
    halfX: (maxX - minX) / 2,
    halfZ: (maxZ - minZ) / 2
  }
}

/** Presence + finiteness gate. Every generator ends here. */
const assertWaterGeometry = (geometry: BufferGeometry, name: string): BufferGeometry => {
  for (const key of WATER_ATTRIBUTES) {
    const attribute = geometry.getAttribute(key)
    if (!attribute) {
      throw new Error(`[water] ${name} is missing the "${key}" attribute (types.ts WATER_ATTRIBUTES)`)
    }
    const array = attribute.array as ArrayLike<number>
    for (let i = 0; i < array.length; i++) {
      // Written as a positive test. `array[i] === NaN`, `> `, `<` and `!==` are
      // all false against NaN, so the natural guard passes on exactly the input
      // it exists to catch — which shipped a black asset in this repo once.
      if (!Number.isFinite(array[i]!)) {
        throw new Error(`[water] ${name} has a non-finite "${key}" at vertex ${Math.floor(i / attribute.itemSize)}`)
      }
    }
  }
  return geometry
}

// ─── Pool ───────────────────────────────────────────────────────────────────

export interface WaterPoolOptions {
  halfX: number
  halfZ: number
  surfaceY: number
  style: WaterStyle
  /**
   * Terrain height beneath the pool.
   *
   * **Called in world space** — `(centerX + localX, centerZ + localZ)` — which
   * is the same space `createWaterRiver` calls its sampler in. The two used to
   * disagree (pool-local vs world), which is a trap that costs a caller one
   * silently misplaced shoreline to find. A pool left at the default centre of
   * (0,0) behaves exactly as before.
   */
  depthAt?: HeightSampler
  /**
   * World position of the pool's centre. Geometry is still built centred on the
   * object origin; this only tells `depthAt` where the pool actually is.
   */
  centerX?: number
  centerZ?: number
  /** Target world-space edge length of a base quad, metres. Clamped internally. */
  resolution?: number
}

/**
 * Grid line positions along one axis: uniform lines, plus an exact line at the
 * foam-band inset.
 *
 * The inset line is what makes the plane-edge foam correct at any resolution —
 * `aShore` ramps linearly 0→1 over `foamWidth`, so with a vertex at each end
 * the hardware's interpolation *is* the function. Without it the outermost cell
 * stretches the band to the full cell width; on the bench sea that was a 3.4 m
 * foam band where the style asked for 1.5.
 */
const buildAxisLines = (half: number, segments: number, foamWidth: number): Float64Array => {
  const raw: number[] = []
  for (let i = 0; i <= segments; i++) {
    raw.push(-half + (2 * half * i) / segments)
  }
  const inset = half - foamWidth
  if (inset > 1e-3) {
    raw.push(-inset, inset)
  }
  raw.sort((a, b) => a - b)

  // Collapse lines that landed on top of each other, keeping the first — a
  // sliver cell is a degenerate triangle and a wasted vertex row.
  const out: number[] = [raw[0]!]
  for (let i = 1; i < raw.length; i++) {
    if (raw[i]! - out[out.length - 1]! > 1e-3) {
      out.push(raw[i]!)
    }
  }
  out[out.length - 1] = half
  return Float64Array.from(out)
}

interface ShoreSample {
  /** Unclamped, so the sign still says which side of the waterline this is. */
  signed: number
  depth: number
  /** Shore term from the terrain shelf alone — drives the refinement test. */
  shelf: number
  shore: number
}

/**
 * A pond or a sea: a subdivided rectangle at `surfaceY`, centred on the object
 * origin, `2·halfX × 2·halfZ`, refined along the waterline.
 *
 * ── `aShore` is the minimum of two distances, and that is the whole point ────
 *
 * The obvious implementation measures distance to the rectangle's own edge.
 * That is right for a pond dropped in a hollow and **wrong for every sea**: a
 * sea meets a beach somewhere in the middle of its plane, so edge-only foam
 * puts the white line 90 m offshore and the water laps the sand with a hard
 * blue termination. It reads as a rug.
 *
 * So the terrain contributes a second distance — how far this vertex is from
 * the waterline, estimated as `depth / |∇depth|`, the standard first-order
 * distance to the zero set of an implicit function. On a flat bed the gradient
 * vanishes and the estimate is infinite, which is correct: a flat-bottomed pond
 * genuinely has no shelf and only its own edge is a shore.
 *
 * The gradient comes from four probes at a fixed `foamWidth/4` offset rather
 * than from differences across the grid. Grid differencing was cheaper and had
 * to go: it makes the shore field a function of the *local cell size*, so a
 * base vertex and a refined vertex 40 cm away disagreed about where the
 * waterline was, and the disagreement landed exactly on the band the refinement
 * exists to sharpen. One probe distance everywhere makes `aShore` a single
 * well-defined function of position that every tessellation agrees on.
 */
export const createWaterPool = (options: WaterPoolOptions): WaterSurface => {
  const { halfX, halfZ, surfaceY, style, depthAt, resolution } = options
  const centerX = options.centerX ?? 0
  const centerZ = options.centerZ ?? 0
  const quad = waterQuadSize(style, resolution)
  // A zero foam width would divide by zero into NaN, which renders as a black
  // sheet rather than as an obviously missing effect.
  const foamWidth = Math.max(style.foamWidth, 1e-3)
  const probe = Math.max(foamWidth * 0.25, 0.05)

  // ── Base grid ────────────────────────────────────────────────────────────
  let [segX, segZ] = fitToVertexCap((halfX * 2) / quad, (halfZ * 2) / quad)
  let xs = buildAxisLines(halfX, segX, foamWidth)
  let zs = buildAxisLines(halfZ, segZ, foamWidth)
  // The inset lines are added after the fit, so give back what they took.
  while (xs.length * zs.length > MAX_WATER_VERTICES && (segX > 1 || segZ > 1)) {
    if (segX >= segZ) {
      segX -= 1
    } else {
      segZ -= 1
    }
    xs = buildAxisLines(halfX, segX, foamWidth)
    zs = buildAxisLines(halfZ, segZ, foamWidth)
  }

  const cols = xs.length
  const rows = zs.length
  const cellsX = cols - 1
  const cellsZ = rows - 1

  const sampleAt = (x: number, z: number, out: ShoreSample): void => {
    const signed = depthAt ? surfaceY - depthAt(centerX + x, centerZ + z) : style.depthFalloff
    let shelfDistance = Infinity
    if (depthAt) {
      const left = surfaceY - depthAt(centerX + x - probe, centerZ + z)
      const right = surfaceY - depthAt(centerX + x + probe, centerZ + z)
      const back = surfaceY - depthAt(centerX + x, centerZ + z - probe)
      const front = surfaceY - depthAt(centerX + x, centerZ + z + probe)
      const slope = Math.hypot((right - left) / (2 * probe), (front - back) / (2 * probe))
      // A flat bed gives no shelf, so the terrain imposes no shore at all.
      if (slope > 1e-4) {
        shelfDistance = signed / slope
      }
    }
    const edgeDistance = Math.min(halfX - Math.abs(x), halfZ - Math.abs(z))
    out.signed = signed
    out.depth = Math.max(0, signed)
    out.shelf = clamp(shelfDistance / foamWidth, 0, 1)
    out.shore = Math.min(out.shelf, clamp(edgeDistance / foamWidth, 0, 1))
  }

  // ── Base node field ──────────────────────────────────────────────────────
  const nodeCount = cols * rows
  const nodeSigned = new Float64Array(nodeCount)
  const nodeDepth = new Float64Array(nodeCount)
  const nodeShelf = new Float64Array(nodeCount)
  const nodeShore = new Float64Array(nodeCount)
  const scratch: ShoreSample = { signed: 0, depth: 0, shelf: 0, shore: 0 }

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      sampleAt(xs[col]!, zs[row]!, scratch)
      const i = row * cols + col
      nodeSigned[i] = scratch.signed
      nodeDepth[i] = scratch.depth
      nodeShelf[i] = scratch.shelf
      nodeShore[i] = scratch.shore
    }
  }

  // ── Classify cells ───────────────────────────────────────────────────────
  const CELL_LIVE = 1
  const CELL_REFINE = 2
  const cellFlags = new Uint8Array(cellsX * cellsZ)
  let refinedCells = 0
  let liveCells = 0

  for (let row = 0; row < cellsZ; row++) {
    for (let col = 0; col < cellsX; col++) {
      const a = row * cols + col
      let wet = false
      let shelfMin = Infinity
      let shelfMax = -Infinity
      for (let k = 0; k < 4; k++) {
        const c = a + (k & 1) + (k >> 1) * cols
        if (nodeSigned[c]! > 0) {
          wet = true
        }
        shelfMin = Math.min(shelfMin, nodeShelf[c]!)
        shelfMax = Math.max(shelfMax, nodeShelf[c]!)
      }
      if (!wet) {
        // All four corners are above the surface. See the header: the shader has
        // no discard, so this cell would paint opaque foam over dry ground.
        continue
      }
      let flags = CELL_LIVE
      liveCells++
      if (shelfMin < 1 - 1e-4 && shelfMax > 1e-4) {
        flags |= CELL_REFINE
        refinedCells++
      }
      cellFlags[row * cellsX + col] = flags
    }
  }

  // ── Pick the refinement level the triangle budget can afford ─────────────
  const isRefined = (col: number, row: number): boolean =>
    col >= 0 &&
    row >= 0 &&
    col < cellsX &&
    row < cellsZ &&
    (cellFlags[row * cellsX + col]! & CELL_REFINE) !== 0

  let maxSpacing = 0
  for (let i = 0; i < cols - 1; i++) {
    maxSpacing = Math.max(maxSpacing, xs[i + 1]! - xs[i]!)
  }
  for (let i = 0; i < rows - 1; i++) {
    maxSpacing = Math.max(maxSpacing, zs[i + 1]! - zs[i]!)
  }

  // Transition cells: live, unrefined, and touching a refined cell on ≥1 edge.
  let transitionEdgeTotal = 0
  let transitionCells = 0
  let plainCells = 0
  for (let row = 0; row < cellsZ; row++) {
    for (let col = 0; col < cellsX; col++) {
      const flags = cellFlags[row * cellsX + col]!
      if ((flags & CELL_LIVE) === 0 || (flags & CELL_REFINE) !== 0) {
        continue
      }
      let edges = 0
      if (isRefined(col - 1, row)) edges++
      if (isRefined(col + 1, row)) edges++
      if (isRefined(col, row - 1)) edges++
      if (isRefined(col, row + 1)) edges++
      if (edges > 0) {
        transitionCells++
        transitionEdgeTotal += edges
      } else {
        plainCells++
      }
    }
  }

  /** Wanted: fine enough that the foam band spans `QUADS_PER_FOAM_BAND` quads. */
  let level = 1
  while (level < MAX_REFINE_LEVEL && maxSpacing / level > foamWidth / QUADS_PER_FOAM_BAND) {
    level *= 2
  }
  const trianglesAt = (k: number): number =>
    plainCells * 2 +
    transitionCells * 4 +
    transitionEdgeTotal * (k - 1) +
    refinedCells * 2 * k * k
  while (level > 1 && trianglesAt(level) > MAX_WATER_TRIANGLES) {
    level /= 2
  }
  if (level === 1) {
    // Nothing to refine, or nothing affordable: the transition fans have no
    // hanging vertices to stitch and collapse back to two triangles each.
    refinedCells = 0
    for (let i = 0; i < cellFlags.length; i++) {
      cellFlags[i] = cellFlags[i]! & ~CELL_REFINE
    }
  }

  // ── Emit ─────────────────────────────────────────────────────────────────
  const vertexX: number[] = []
  const vertexZ: number[] = []
  const vertexDepth: number[] = []
  const vertexShore: number[] = []
  const indices: number[] = []
  const lookup = new Map<string, number>()

  /** 1/10 mm quantisation, matching `normals.ts` — well under any real spacing. */
  const vertexKey = (x: number, z: number): string => `${Math.round(x * 1e4)},${Math.round(z * 1e4)}`

  const addVertex = (x: number, z: number, depth?: number, shore?: number): number => {
    const key = vertexKey(x, z)
    const existing = lookup.get(key)
    if (existing !== undefined) {
      return existing
    }
    let d = depth
    let s = shore
    if (d === undefined || s === undefined) {
      sampleAt(x, z, scratch)
      d = scratch.depth
      s = scratch.shore
    }
    const i = vertexX.length
    vertexX.push(x)
    vertexZ.push(z)
    vertexDepth.push(d)
    vertexShore.push(s)
    lookup.set(key, i)
    return i
  }

  const addBaseVertex = (col: number, row: number): number => {
    const i = row * cols + col
    return addVertex(xs[col]!, zs[row]!, nodeDepth[i]!, nodeShore[i]!)
  }

  // (a,c,b) then (b,c,d): with rows running +Z and columns +X this is the
  // winding whose facet normal is +Y. The mirrored order renders the sheet
  // backface-culled away, which looks exactly like the material failing.
  const addQuad = (a: number, b: number, c: number, d: number): void => {
    indices.push(a, c, b, b, c, d)
  }

  for (let row = 0; row < cellsZ; row++) {
    for (let col = 0; col < cellsX; col++) {
      const flags = cellFlags[row * cellsX + col]!
      if ((flags & CELL_LIVE) === 0) {
        continue
      }
      const x0 = xs[col]!
      const x1 = xs[col + 1]!
      const z0 = zs[row]!
      const z1 = zs[row + 1]!

      if ((flags & CELL_REFINE) !== 0) {
        // Uniform K×K sub-grid. Its corners land on the base nodes to the last
        // bit of the quantisation, so `lookup` welds them without a special case.
        const grid: number[] = []
        for (let b = 0; b <= level; b++) {
          const z = z0 + ((z1 - z0) * b) / level
          for (let a = 0; a <= level; a++) {
            grid.push(addVertex(x0 + ((x1 - x0) * a) / level, z))
          }
        }
        const stride = level + 1
        for (let b = 0; b < level; b++) {
          for (let a = 0; a < level; a++) {
            const i = b * stride + a
            addQuad(grid[i]!, grid[i + 1]!, grid[i + stride]!, grid[i + stride + 1]!)
          }
        }
        continue
      }

      const west = isRefined(col - 1, row)
      const east = isRefined(col + 1, row)
      const south = isRefined(col, row - 1)
      const north = isRefined(col, row + 1)

      if (!west && !east && !south && !north) {
        addQuad(
          addBaseVertex(col, row),
          addBaseVertex(col + 1, row),
          addBaseVertex(col, row + 1),
          addBaseVertex(col + 1, row + 1)
        )
        continue
      }

      // Clockwise in (x,z) — the orientation whose fan normal is +Y. Each edge
      // shared with a refined neighbour carries that neighbour's K−1 hanging
      // vertices, which is what closes the crack the wave would otherwise open.
      const ring: number[] = []
      const walk = (
        fromX: number,
        fromZ: number,
        toX: number,
        toZ: number,
        subdivided: boolean
      ): void => {
        ring.push(addVertex(fromX, fromZ))
        if (!subdivided) {
          return
        }
        for (let k = 1; k < level; k++) {
          ring.push(addVertex(fromX + ((toX - fromX) * k) / level, fromZ + ((toZ - fromZ) * k) / level))
        }
      }
      walk(x0, z0, x0, z1, west)
      walk(x0, z1, x1, z1, north)
      walk(x1, z1, x1, z0, east)
      walk(x1, z0, x0, z0, south)

      const centre = addVertex((x0 + x1) / 2, (z0 + z1) / 2)
      for (let k = 0; k < ring.length; k++) {
        indices.push(centre, ring[k]!, ring[(k + 1) % ring.length]!)
      }
    }
  }

  // ── Pack ─────────────────────────────────────────────────────────────────
  const count = vertexX.length
  if (count === 0) {
    throw new Error(`[water] pool ${halfX * 2}×${halfZ * 2} is entirely above the terrain — nothing to draw`)
  }

  const position = new Float32Array(count * 3)
  const normal = new Float32Array(count * 3)
  const depth = new Float32Array(count)
  const shore = new Float32Array(count)
  const flow = new Float32Array(count * 2)

  const driftX = Math.cos(SEA_DRIFT_BEARING) * style.flowSpeed
  const driftZ = Math.sin(SEA_DRIFT_BEARING) * style.flowSpeed

  for (let i = 0; i < count; i++) {
    position[i * 3] = vertexX[i]!
    position[i * 3 + 1] = surfaceY
    position[i * 3 + 2] = vertexZ[i]!
    // Flat sheet. The shader re-derives the wave normal from the same function
    // it displaces with; baking a wave normal here would be a second source of
    // truth that drifts the moment a style dial moves.
    normal[i * 3 + 1] = 1
    depth[i] = vertexDepth[i]!
    shore[i] = vertexShore[i]!
    flow[i * 2] = driftX
    flow[i * 2 + 1] = driftZ
  }

  const index = count > 65535 ? new Uint32Array(indices) : new Uint16Array(indices)
  const geometry = assertWaterGeometry(
    buildGeometry(position, normal, depth, shore, flow, index),
    `pool ${halfX * 2}×${halfZ * 2}`
  )
  return measureSurface(geometry, surfaceY, style.waveAmplitude)
}

// ─── River ──────────────────────────────────────────────────────────────────

export interface WaterRiverOptions {
  nodes: readonly RiverNode[]
  style: WaterStyle
  /**
   * Terrain height beneath the channel, **called in world space** — river nodes
   * are world-space (`types.ts`) and the ribbon is built where they put it, so
   * the sampler sees the same coordinates the nodes were given in. Matches
   * `WaterPoolOptions.depthAt`, which takes `centerX`/`centerZ` to reach the
   * same contract from a body whose geometry is origin-centred.
   */
  depthAt?: HeightSampler
  resolution?: number
}

interface CentreSample {
  x: number
  y: number
  z: number
  halfWidth: number
}

const _c0: CentreSample = { x: 0, y: 0, z: 0, halfWidth: 0 }
const _c1: CentreSample = { x: 0, y: 0, z: 0, halfWidth: 0 }
const _c2: CentreSample = { x: 0, y: 0, z: 0, halfWidth: 0 }

/** Uniform Catmull-Rom, tension ½. C¹ everywhere, which is the requirement. */
const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
  const t2 = t * t
  const t3 = t2 * t
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  )
}

/**
 * The spline's control points with reflected phantoms at both ends, so the run
 * starts and ends along its own chord instead of curling away from it.
 */
const extendNodes = (nodes: readonly RiverNode[]): RiverNode[] => {
  const last = nodes.length - 1
  const first = nodes[0]!
  const second = nodes[1]!
  const end = nodes[last]!
  const penultimate = nodes[last - 1]!
  const reflect = (a: RiverNode, b: RiverNode): RiverNode => ({
    x: 2 * a.x - b.x,
    y: 2 * a.y - b.y,
    z: 2 * a.z - b.z,
    halfWidth: Math.max(1e-3, 2 * a.halfWidth - b.halfWidth)
  })
  return [reflect(first, second), ...nodes, reflect(end, penultimate)]
}

/** Evaluates the centreline at node-parameter `u ∈ [0, nodeCount-1]`. */
const evalCentre = (extended: readonly RiverNode[], nodeCount: number, u: number, out: CentreSample): void => {
  const clamped = clamp(u, 0, nodeCount - 1)
  const segment = Math.min(Math.floor(clamped), nodeCount - 2)
  const t = clamped - segment
  const p0 = extended[segment]!
  const p1 = extended[segment + 1]!
  const p2 = extended[segment + 2]!
  const p3 = extended[segment + 3]!
  out.x = catmullRom(p0.x, p1.x, p2.x, p3.x, t)
  out.y = catmullRom(p0.y, p1.y, p2.y, p3.y, t)
  out.z = catmullRom(p0.z, p1.z, p2.z, p3.z, t)
  // Width overshoots negative on a sharp taper; a negative half-width turns the
  // ribbon inside out for the length of the overshoot.
  out.halfWidth = Math.max(1e-3, catmullRom(p0.halfWidth, p1.halfWidth, p2.halfWidth, p3.halfWidth, t))
}

/**
 * Horizontal side vector — `normalize(tangent × up)`.
 *
 * Horizontal rather than a parallel-transported frame on purpose: a river's
 * half-width is a map measurement, and a transported frame would bank the
 * channel into the hillside on every downhill stretch. It also removes twist
 * from the problem entirely, which is the usual reason lofted ribbons flicker.
 */
const sideAt = (extended: readonly RiverNode[], nodeCount: number, u: number, out: Vector3): void => {
  const h = 1e-3
  evalCentre(extended, nodeCount, u - h, _c1)
  evalCentre(extended, nodeCount, u + h, _c2)
  const dx = _c2.x - _c1.x
  const dz = _c2.z - _c1.z
  const length = Math.hypot(dx, dz)
  if (length < 1e-9) {
    // Vertically-falling centreline. That is a waterfall's geometry, not a
    // river's; keep the previous frame rather than producing a zero vector.
    return
  }
  out.set(-dz / length, 0, dx / length)
}

/** XZ tangent, unit length. Drives `aFlow`, so it must be the *centreline's*. */
const tangentAt = (extended: readonly RiverNode[], nodeCount: number, u: number, out: Vector3): void => {
  const h = 1e-3
  evalCentre(extended, nodeCount, u - h, _c1)
  evalCentre(extended, nodeCount, u + h, _c2)
  const dx = _c2.x - _c1.x
  const dz = _c2.z - _c1.z
  const length = Math.hypot(dx, dz)
  if (length < 1e-9) {
    return
  }
  out.set(dx / length, 0, dz / length)
}

/** Horizontal curvature, 1/metres. The pinch test is a plan-view problem. */
const curvatureAt = (extended: readonly RiverNode[], nodeCount: number, u: number): number => {
  const h = 0.01
  evalCentre(extended, nodeCount, u - h, _c1)
  evalCentre(extended, nodeCount, u, _c0)
  evalCentre(extended, nodeCount, u + h, _c2)
  const d1x = (_c2.x - _c1.x) / (2 * h)
  const d1z = (_c2.z - _c1.z) / (2 * h)
  const d2x = (_c2.x - 2 * _c0.x + _c1.x) / (h * h)
  const d2z = (_c2.z - 2 * _c0.z + _c1.z) / (h * h)
  const speed = Math.hypot(d1x, d1z)
  if (speed < 1e-9) {
    return 0
  }
  return Math.abs(d1x * d2z - d1z * d2x) / (speed * speed * speed)
}

/**
 * Lofts a river ribbon along a Catmull-Rom through `nodes`.
 *
 * ── Why a spline and not the chords ─────────────────────────────────────────
 *
 * Straight segments between nodes give a river visible corners, which is
 * survivable, and a **discontinuous tangent**, which is not: `aFlow` is that
 * tangent, so the scrolling pattern changes direction across one edge and the
 * flow tears along a line at every control point. The spline is C¹, so the
 * pattern rotates through a bend instead of snapping.
 *
 * ── The failure at tight bends ──────────────────────────────────────────────
 *
 * Offsetting a curve by a constant normal distance is only well-behaved while
 * that distance is under the local bend radius. Past it the inner edge runs
 * *backwards*, the ribbon folds through itself, and half its triangles face
 * away — a black crease down the inside of the corner, which is what a hairpin
 * on a 3 m channel produces if nothing checks.
 *
 * This clamps rather than reports-and-continues, because the alternative is a
 * generator that returns broken geometry with a console line next to it. What
 * it costs is that a hairpin silently narrows; a DEV warning names the node
 * range so it reads as a level-design note rather than as a mystery.
 *
 * The clamp cannot be applied pointwise, though. Curvature is only C⁰ across a
 * Catmull-Rom knot, so a raw `min(width, 0.9/κ)` puts a crease in the bank
 * exactly where it was trying to prevent one. The cap is therefore run through
 * a running-min (radius 3) and two box passes (radius 1) before being applied —
 * a window pair chosen so every term in the final average is a minimum over a
 * window that still contains the station being written, which is what keeps the
 * smoothed cap provably ≤ the true cap everywhere.
 */
export const createWaterRiver = (options: WaterRiverOptions): WaterSurface => {
  const { nodes, style, depthAt, resolution } = options
  if (nodes.length < 2) {
    throw new Error(`[water] a river needs at least 2 nodes, got ${nodes.length}`)
  }

  const nodeCount = nodes.length
  const extended = extendNodes(nodes)
  const quad = waterQuadSize(style, resolution)
  const foamWidth = Math.max(style.foamWidth, 1e-3)

  // ── Arc length, so stations are evenly spaced in metres ───────────────────
  // Uniform steps in the node parameter bunch triangles wherever the nodes are
  // close, which on a hand-placed river is most of the interesting corners.
  const arcSamples = (nodeCount - 1) * ARC_SAMPLES_PER_SEGMENT
  const arcU = new Float64Array(arcSamples + 1)
  const arcLength = new Float64Array(arcSamples + 1)
  evalCentre(extended, nodeCount, 0, _c0)
  let previousX = _c0.x
  let previousY = _c0.y
  let previousZ = _c0.z
  for (let i = 1; i <= arcSamples; i++) {
    const u = ((nodeCount - 1) * i) / arcSamples
    evalCentre(extended, nodeCount, u, _c0)
    arcU[i] = u
    arcLength[i] =
      arcLength[i - 1]! + Math.hypot(_c0.x - previousX, _c0.y - previousY, _c0.z - previousZ)
    previousX = _c0.x
    previousY = _c0.y
    previousZ = _c0.z
  }
  const totalLength = arcLength[arcSamples]!
  if (!(totalLength > 0)) {
    throw new Error('[water] river nodes describe a zero-length centreline')
  }

  let maxHalfWidth = 0
  for (const node of nodes) {
    maxHalfWidth = Math.max(maxHalfWidth, node.halfWidth)
  }

  let segAlong = Math.max(1, Math.round(totalLength / quad))
  // Even, and never below 4: `aShore` reaches 1 on the centreline, so the
  // centreline has to be a vertex or the peak of the foam ramp is interpolated
  // away and a narrow stream never goes white.
  let segAcross = Math.max(MIN_RIVER_COLUMNS, 2 * Math.ceil(maxHalfWidth / quad))
  // Width resolution is the thing that cannot be given up (see above), so the
  // cap is spent on it first and the length takes what is left.
  segAcross = Math.min(segAcross, 2 * Math.floor(Math.sqrt(MAX_WATER_VERTICES) / 2))
  segAlong = Math.max(1, Math.min(segAlong, Math.floor(MAX_WATER_VERTICES / (segAcross + 1)) - 1))

  const stationCount = segAlong + 1
  const colCount = segAcross + 1
  const count = stationCount * colCount

  // Station → node parameter, by inverting the arc-length table.
  const stationU = new Float64Array(stationCount)
  let cursor = 0
  for (let s = 0; s < stationCount; s++) {
    const target = (totalLength * s) / segAlong
    while (cursor < arcSamples && arcLength[cursor + 1]! < target) {
      cursor++
    }
    const lengthA = arcLength[cursor]!
    const lengthB = arcLength[Math.min(arcSamples, cursor + 1)]!
    const span = lengthB - lengthA
    const t = span > 1e-12 ? (target - lengthA) / span : 0
    stationU[s] = arcU[cursor]! + t * (arcU[Math.min(arcSamples, cursor + 1)]! - arcU[cursor]!)
  }

  // ── Width, clamped against the bend and then smoothed ─────────────────────
  const widthCap = new Float64Array(stationCount)
  const stationWidth = new Float64Array(stationCount)
  let pinchedFrom = -1
  let pinchedTo = -1
  for (let s = 0; s < stationCount; s++) {
    const u = stationU[s]!
    evalCentre(extended, nodeCount, u, _c0)
    stationWidth[s] = _c0.halfWidth
    const curvature = curvatureAt(extended, nodeCount, u)
    widthCap[s] = curvature > 1e-6 ? SAFE_BEND_FRACTION / curvature : Infinity
    if (widthCap[s]! < _c0.halfWidth) {
      if (pinchedFrom < 0) {
        pinchedFrom = s
      }
      pinchedTo = s
    }
  }

  const smoothedCap = new Float64Array(stationCount)
  const scratchCap = new Float64Array(stationCount)
  for (let s = 0; s < stationCount; s++) {
    let minimum = Infinity
    for (let k = Math.max(0, s - 3); k <= Math.min(stationCount - 1, s + 3); k++) {
      minimum = Math.min(minimum, widthCap[k]!)
    }
    smoothedCap[s] = minimum
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let s = 0; s < stationCount; s++) {
      const a = smoothedCap[Math.max(0, s - 1)]!
      const b = smoothedCap[s]!
      const c = smoothedCap[Math.min(stationCount - 1, s + 1)]!
      // Infinity + Infinity / 3 stays Infinity, which is the intended no-cap.
      scratchCap[s] = (a + b + c) / 3
    }
    smoothedCap.set(scratchCap)
  }
  for (let s = 0; s < stationCount; s++) {
    stationWidth[s] = Math.min(stationWidth[s]!, smoothedCap[s]!)
  }

  if (pinchedFrom >= 0 && import.meta.env.DEV) {
    const fromMetre = ((totalLength * pinchedFrom) / segAlong).toFixed(1)
    const toMetre = ((totalLength * pinchedTo) / segAlong).toFixed(1)
    console.warn(
      `[water] river bend between ${fromMetre} m and ${toMetre} m is tighter than its half-width; ` +
        'the channel was narrowed there to stop the ribbon folding through itself'
    )
  }

  const widthAtStation = (station: number): number => {
    const clamped = clamp(station, 0, segAlong)
    const low = Math.floor(clamped)
    const high = Math.min(segAlong, low + 1)
    const t = clamped - low
    return stationWidth[low]! * (1 - t) + stationWidth[high]! * t
  }

  const uAtStation = (station: number): number => {
    const clamped = clamp(station, 0, segAlong)
    const low = Math.floor(clamped)
    const high = Math.min(segAlong, low + 1)
    const t = clamped - low
    return stationU[low]! * (1 - t) + stationU[high]! * t
  }

  /** The ribbon's surface function. Normals are central differences of *this*. */
  const ribbonPoint = (station: number, v: number, out: Vector3): Vector3 => {
    const u = uAtStation(station)
    evalCentre(extended, nodeCount, u, _c0)
    sideAt(extended, nodeCount, u, _side)
    const halfWidth = widthAtStation(station)
    return out.set(
      _c0.x + _side.x * v * halfWidth,
      _c0.y,
      _c0.z + _side.z * v * halfWidth
    )
  }

  const position = new Float32Array(count * 3)
  const normal = new Float32Array(count * 3)
  const depth = new Float32Array(count)
  const shore = new Float32Array(count)
  const flow = new Float32Array(count * 2)

  // A quarter station along and a twentieth of the half-width across: small
  // enough that the secant is the tangent, large enough that the Float64
  // subtraction is not cancellation noise.
  const stepStation = 0.25
  const stepV = 0.05

  _side.set(0, 0, 1)
  _tangent.set(1, 0, 0)

  for (let s = 0; s < stationCount; s++) {
    const u = stationU[s]!
    tangentAt(extended, nodeCount, u, _tangent)
    const flowX = _tangent.x * style.flowSpeed
    const flowZ = _tangent.z * style.flowSpeed
    const halfWidth = stationWidth[s]!

    for (let col = 0; col < colCount; col++) {
      const i = s * colCount + col
      const v = -1 + (2 * col) / segAcross

      ribbonPoint(s, v, _pA)
      position[i * 3] = _pA.x
      position[i * 3 + 1] = _pA.y
      position[i * 3 + 2] = _pA.z

      ribbonPoint(Math.max(0, s - stepStation), v, _pB)
      ribbonPoint(Math.min(segAlong, s + stepStation), v, _pC)
      _dS.subVectors(_pC, _pB)
      ribbonPoint(s, Math.max(-1, v - stepV), _pB)
      ribbonPoint(s, Math.min(1, v + stepV), _pD)
      _dV.subVectors(_pD, _pB)
      _n.crossVectors(_dV, _dS)
      if (_n.lengthSq() < 1e-18) {
        // Degenerate patch — a zero-width station. Flat is the honest answer.
        _n.set(0, 1, 0)
      } else {
        _n.normalize()
        if (_n.y < 0) {
          _n.negate()
        }
      }
      normal[i * 3] = _n.x
      normal[i * 3 + 1] = _n.y
      normal[i * 3 + 2] = _n.z

      // The sheet's Y comes from the *nodes*, never from the terrain: a river
      // runs downhill along its own bed and is allowed to sit above ground the
      // heightfield says is higher. Resolving that is a waterfall's job.
      depth[i] = depthAt ? Math.max(0, _pA.y - depthAt(_pA.x, _pA.z)) : style.depthFalloff

      // Scaled against the *local* half-width, so on a channel narrower than
      // 2·foamWidth the two banks' foam meets in the middle instead of being
      // renormalised apart — which is what makes a narrow stream white water.
      shore[i] = clamp(((1 - Math.abs(v)) * halfWidth) / foamWidth, 0, 1)

      flow[i * 2] = flowX
      flow[i * 2 + 1] = flowZ
    }
  }

  const index = count > 65535 ? new Uint32Array(segAlong * segAcross * 6) : new Uint16Array(segAlong * segAcross * 6)
  let write = 0
  for (let s = 0; s < segAlong; s++) {
    for (let col = 0; col < segAcross; col++) {
      const a = s * colCount + col
      const b = a + 1
      const c = a + colCount
      const d = c + 1
      // (a,b,c) then (b,d,c): rows run along the flow and columns run toward
      // +side, which is the mirror of the pool's layout — hence the mirrored
      // winding for the same upward facet normal.
      index[write++] = a
      index[write++] = b
      index[write++] = c
      index[write++] = b
      index[write++] = d
      index[write++] = c
    }
  }

  const geometry = assertWaterGeometry(
    buildGeometry(position, normal, depth, shore, flow, index),
    `river ${nodeCount} nodes / ${totalLength.toFixed(1)} m`
  )

  // The representative sheet height. A river has no single Y — it descends —
  // so the midpoint of its run is the only number that is not a lie about one
  // end or the other.
  evalCentre(extended, nodeCount, (nodeCount - 1) / 2, _c0)
  return measureSurface(geometry, _c0.y, style.waveAmplitude)
}

// ─── Metrics ────────────────────────────────────────────────────────────────

export interface WaterSurfaceMetrics {
  /** Bounding-sphere radius about the **object origin**, wave included. */
  radius: number
  halfX: number
  halfZ: number
  /**
   * Footprint centre. Zero for a pool, and the piece `WaterSurface` has no room
   * for on a river: river nodes are world-space, so the ribbon is built where
   * they put it and a caller wanting a tight culling sphere has to translate the
   * mesh here first. Without it the only correct sphere is one centred on the
   * world origin with the river's distance as its radius.
   */
  centerX: number
  centerZ: number
  surfaceY: number
}

/**
 * Longest-axis half-extents and radius, measured from the built geometry.
 *
 * Measured, not derived from the options that produced it — the two differ for
 * both generators, and a radius short of its own mesh is a body of water that
 * vanishes while a quarter of it is still on screen. The stored values from
 * generation are unioned in rather than replaced, because they carry the
 * `waveAmplitude` margin for displacement this file never applied.
 */
export const waterSurfaceMetrics = (surface: WaterSurface): WaterSurfaceMetrics => {
  const position = surface.geometry.getAttribute('position').array as Float32Array
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  let maxDistanceSq = 0

  for (let i = 0; i < position.length; i += 3) {
    const x = position[i]!
    const y = position[i + 1]!
    const z = position[i + 2]!
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
    const distanceSq = x * x + y * y + z * z
    if (distanceSq > maxDistanceSq) maxDistanceSq = distanceSq
  }

  return {
    radius: Math.max(surface.radius, Math.sqrt(maxDistanceSq)),
    halfX: Math.max(surface.halfX, (maxX - minX) / 2),
    halfZ: Math.max(surface.halfZ, (maxZ - minZ) / 2),
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    surfaceY: surface.surfaceY
  }
}
