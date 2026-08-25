import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  PerspectiveCamera,
  Scene,
  Vector3,
  type WebGLRenderer
} from 'three'
import { C } from '../art/palette'
import type { WorldAsset } from '../assets/types'
import { createLightRig, type LightRig } from '../core/lighting'
import { OrbitCameraController } from '../core/OrbitCameraController'
import { createRenderer, resizeRenderer } from '../core/renderer'
import { createSky } from '../core/sky'
import { fbm2D, valueNoise2D } from '../geometry/rng'
import { updateLodBiasFromView } from '../lod/config'
import { DitheredLod } from '../lod/DitheredLod'
import { Profiler } from '../perf/Profiler'
import { updateUnitsPerPixel, worldUniforms } from '../shading/globals'
import { TerrainMaterial } from '../terrain/TerrainMaterial'
import { waterStyle } from './styles'
import { createWaterPool, createWaterRiver } from './surface'
import { createWaterMaterial, type WaterMaterial } from './waterMaterial'
import { createWaterfallAsset, type WaterfallForm } from './waterfall'
import type { HeightSampler, RiverNode } from './types'

/**
 * ─── /water — the water bench ───────────────────────────────────────────────
 *
 * A small island built for one purpose: to put a pond, a river, a sea and
 * several waterfalls in one frame, on ground that makes each of them make
 * sense, so the water system can be judged in a real browser rather than in a
 * screenshot of a flat plane.
 *
 * **Why a bespoke island and not the main world's terrain.** `Heightfield` is an
 * unbounded fbm field with no notion of a shoreline, a gorge or a cliff lip.
 * Water needs all three at known coordinates: a river on flat ground proves
 * nothing, and hunting a procedural world for a slope that happens to look like
 * a gorge is not a test, it is luck. This field is authored — a radial profile,
 * two scarps, a dome, two bowls and one carved watercourse — so every feature
 * the water sits in is a number this file can hand to the generators and to the
 * camera presets.
 *
 * **The river's heights are authored, and the ground follows them.** The first
 * pass did the opposite: sample the ground along the river's path, subtract a
 * freeboard, force the result downhill. It produced a river that cut a nine
 * metre slot straight through the cliff it was supposed to fall off, because the
 * forced descent kept descending while the ground rose back to bench height. So
 * `RiverNode.y` is typed in (`types.ts` says surface heights are not derived,
 * and this is why), and the terrain is *lowered* toward it — never raised. That
 * one-sided operator is what makes the cliff survive: past the lip the valley
 * floor is above the ground, so the carve declines to do anything and the face
 * keeps its full drop.
 *
 * Everything here is generated once at construction. Nothing in the frame path
 * allocates.
 */

// ─── The field ──────────────────────────────────────────────────────────────

const SEA_LEVEL = 0

/** Half-extent of the ground mesh. */
const EXTENT = 150
/**
 * Half-extent of the sea, deliberately *larger* than the ground.
 *
 * The sea's own rectangle edge is a shore, so it foams — and a white line ruled
 * across the horizon is the one artefact that would ruin every wide shot. Put
 * out past the ground, it sits at ~88 % fog extinction, and the ground's own cut
 * edge is 5 m underwater in front of it.
 */
const SEA_HALF_EXTENT = 170

/** Height of the low bench most of the island's surface sits on. */
const BENCH_Y = 6.5
/** The radial fall-off that becomes the beach. Its width is the beach's width. */
const SHORE_INNER = 68
const SHORE_OUTER = 110
/** How far the sea bed drops away, and over what run. Sets the sea's `aDepth`. */
const SEABED_DEPTH = 9
const SEABED_INNER = 112
const SEABED_OUTER = 172

/**
 * The main scarp: a circle centred NW of the island, so its arc crosses the
 * island facing SE — the bearing the orbit camera starts on. A cliff you have to
 * fly around to see is a cliff nobody reviews.
 */
const SCARP_X = -26
const SCARP_Z = -22
const SCARP_R = 46
/**
 * Half the transition run — and it is the number that decides whether a
 * waterfall is possible at all.
 *
 * At 2.4 the face dropped 16 m over 4.8 m of ground: a slope of 3.3, which
 * looks like a cliff and is not one. A curtain hung at the lip spent its whole
 * length inside the rock, and one pushed out far enough to hang free started
 * five metres from the river it comes out of. 1.5 puts the face at a slope of
 * 5.3 and the curtain clears it 2 m out, which reads as water leaving the edge.
 */
const SCARP_W = 1.5
const SCARP_RISE = 16
/** Half a scarp rim's wander, so a fall's lip lands inside it whatever the noise did. */
const RIM_MARGIN = 1.7

/** A second, much shorter scarp east of the pond, so the falls aren't one size. */
const MESA_X = 52
const MESA_Z = -26
const MESA_R = 20
const MESA_W = 1.2
const MESA_RISE = 6.5

/** The shoulder the river starts on. */
const SHOULDER_X = -44
const SHOULDER_Z = -40
const SHOULDER_R = 30
const SHOULDER_RISE = 14

/**
 * The river, authored upstream-first. `y` is the water surface, and it descends
 * strictly — see the header for what happened when it was derived instead.
 *
 * The path leaves the shoulder **radially**, down the dome's fall line, because
 * a channel run across a convex slope has a bank on one side and open hillside
 * on the other, and the water pours out sideways. Running down the fall line is
 * what makes the two banks the same height.
 *
 * The last node is the lip: the channel stops there and the scarp takes over.
 */
const RIVER_NODES: readonly RiverNode[] = [
  { x: -38, z: -34, y: 31.4, halfWidth: 1.5 },
  { x: -31, z: -27.5, y: 26.6, halfWidth: 1.6 },
  // Nodes are close together on the shoulder because the surface between two of
  // them is a straight chord and the dome under it is convex: spaced any wider,
  // the chord climbs out of the ground halfway along and the river runs over a
  // rise it should be cutting through.
  { x: -27.5, z: -24, y: 23.4, halfWidth: 1.7 },
  { x: -24, z: -20.5, y: 21.8, halfWidth: 1.9 },
  { x: -17, z: -14, y: 19.6, halfWidth: 2.0 },
  { x: -10, z: -7.5, y: 18.4, halfWidth: 2.2 },
  { x: -4, z: -1.5, y: 17.4, halfWidth: 2.3 },
  { x: 0.5, z: 4, y: 16.5, halfWidth: 2.4 },
  { x: 4.5, z: 9.5, y: 15.6, halfWidth: 2.4 }
]

/** How far the water sits below the channel's own banks. */
const CHANNEL_DEPTH = 1.15
/** Horizontal run from the water's edge back up to untouched ground. */
const CHANNEL_BANK = 3.2
/** The gorge around the channel: how wide, and how far above the water it sits. */
const GORGE_R = 15
const GORGE_RISE = 0.7

/**
 * The two standing bodies of water, as bowls in the ground.
 *
 * `depth` is how far the bowl's floor sits below the surrounding ground and
 * `fill` how far the water stands above that floor — so the rim clears the
 * waterline by `depth − fill`, which is the margin that stops a noise trough
 * from draining the pond sideways.
 */
interface Bowl {
  id: string
  x: number
  z: number
  radius: number
  depth: number
  fill: number
}

const BOWLS: readonly Bowl[] = [
  { id: 'pond', x: 46, z: 6, radius: 13, depth: 4.0, fill: 2.4 },
  // Under the river's fall — close enough that the curtain lands in it, far
  // enough that its own bowl doesn't scoop a dent out of the cliff top the
  // water leaves from. A plunge pool is not decoration: without one the fall
  // lands on flat grass, which is the one thing the reference never shows.
  { id: 'plunge', x: 7.5, z: 12.5, radius: 9, depth: 3.2, fill: 2.0 }
]

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value)

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/** A raised disc with a soft rim — one scarp. `width` is half the rim's run. */
const scarp = (distance: number, radius: number, width: number, rise: number): number =>
  rise * (1 - smoothstep(radius - width, radius + width, distance))

const distanceTo = (x: number, z: number, cx: number, cz: number): number => Math.hypot(x - cx, z - cz)

/**
 * Closest point on the river polyline, as a distance plus a parameter in segment
 * units (`2.4` = 40 % along the third segment). Written into module scratch: the
 * field is evaluated ~150 000 times at build and this is its inner loop.
 */
const _hit = { distance: 0, t: 0 }

const projectOnRiver = (x: number, z: number): void => {
  let best = Infinity
  let bestT = 0
  for (let i = 0; i < RIVER_NODES.length - 1; i++) {
    const a = RIVER_NODES[i]!
    const b = RIVER_NODES[i + 1]!
    const ex = b.x - a.x
    const ez = b.z - a.z
    const lengthSquared = ex * ex + ez * ez
    let t = lengthSquared > 0 ? ((x - a.x) * ex + (z - a.z) * ez) / lengthSquared : 0
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const dx = x - (a.x + ex * t)
    const dz = z - (a.z + ez * t)
    const distance = Math.hypot(dx, dz)
    if (distance < best) {
      best = distance
      bestT = i + t
    }
  }
  _hit.distance = best
  _hit.t = bestT
}

/** Linear sample of a per-node quantity at a path parameter. */
const sampleAlongRiver = (pick: (node: RiverNode) => number, t: number): number => {
  const last = RIVER_NODES.length - 1
  const index = Math.min(last - 1, Math.max(0, Math.floor(t)))
  const fraction = clamp01(t - index)
  const a = pick(RIVER_NODES[index]!)
  const b = pick(RIVER_NODES[index + 1]!)
  return a + (b - a) * fraction
}

const nodeY = (node: RiverNode): number => node.y
const nodeHalfWidth = (node: RiverNode): number => node.halfWidth

export interface FallSite {
  id: string
  /** Where the water leaves the rock. */
  lipX: number
  lipZ: number
  /** Height the curtain starts and lands at. */
  topY: number
  bottomY: number
  /** Unit horizontal direction the face looks along. */
  outX: number
  outZ: number
  /** Horizontal run from lip to foot — how far the curtain leans out. */
  run: number
  /** Curtain width, metres. */
  width: number
}

export interface IslandFeatures {
  seaLevel: number
  /** Radius at which the ground crosses the waterline on an average bearing. */
  shoreRadius: number
  shoulder: { x: number; z: number; y: number }
  cliffLip: { x: number; z: number; y: number }
  /** Standing water: the pond in its hollow, and the fall's plunge pool. */
  pools: { id: string; x: number; z: number; radius: number; surfaceY: number; floorY: number }[]
  falls: FallSite[]
}

export interface Island {
  seed: number
  /** Half-extent of the ground mesh, metres. */
  extent: number
  /** Final ground height, river channel included. */
  heightAt: HeightSampler
  /** Ground before the gorge and channel are cut. */
  shapeAt: HeightSampler
  /** Analytic normal by central difference of `heightAt`. */
  normalAt(x: number, z: number, out: Vector3): Vector3
  /** The river's spline, upstream first. Handed straight to the generator. */
  riverNodes: readonly RiverNode[]
  features: IslandFeatures
}

export interface IslandOptions {
  seed?: number
}

/**
 * Builds the field. Deterministic in `seed`: the noise is the only stochastic
 * term and every feature above is authored.
 */
export const createIsland = (options: IslandOptions = {}): Island => {
  const seed = options.seed ?? 4021

  /** Radial profile: bench → beach → sea bed. The beach is the middle term. */
  const profile = (radius: number): number =>
    BENCH_Y * (1 - smoothstep(SHORE_INNER, SHORE_OUTER, radius)) -
    SEABED_DEPTH * smoothstep(SEABED_INNER, SEABED_OUTER, radius)

  /**
   * Wander applied to a scarp's radius, so its rim is not a circle.
   *
   * A clean arc is worse than it sounds: the face is only 3 m of run and the
   * grid samples it about every metre, so the rim came out as a *regular* sawtooth
   * locked to the grid — which reads as broken geometry, because a regular
   * sawtooth is what broken geometry looks like. Pushing the rim in and out by
   * more than a cell makes the same stepping read as erosion instead.
   */
  const rimWander = (x: number, z: number): number =>
    (fbm2D(x * 0.055, z * 0.055, 2, 2.1, 0.5, seed + 313) - 0.5) * 3.4

  /** Everything before the noise, the bowls and the water. */
  const massing = (x: number, z: number): number => {
    const wander = rimWander(x, z)
    return (
      profile(Math.hypot(x, z)) +
      scarp(distanceTo(x, z, SCARP_X, SCARP_Z) + wander, SCARP_R, SCARP_W, SCARP_RISE) +
      scarp(distanceTo(x, z, MESA_X, MESA_Z) + wander, MESA_R, MESA_W, MESA_RISE) +
      SHOULDER_RISE * (1 - smoothstep(0, SHOULDER_R, distanceTo(x, z, SHOULDER_X, SHOULDER_Z)))
    )
  }

  const shapeAt = (x: number, z: number): number => {
    const smooth = massing(x, z)

    // Noise damped three ways, and every one of them is load-bearing.
    //
    // Across the whole shore band — nine metres of elevation either side of the
    // waterline, not two — because the sea's foam comes from `depth / |∇depth|`,
    // so what puts foam in the wrong place is not the depth being wrong but the
    // *gradient* being noisy. At full amplitude the sea bed's noise beat the
    // beach's own 0.23 slope and scattered foam patches fifty metres offshore.
    //
    // Around each bowl, because a pond's rim only clears its own surface by
    // `depth − fill`, and a noise trough deeper than that drains it sideways.
    //
    // Along the river, because the node heights are authored against the *smooth*
    // massing, and ±2.6 m of noise on a channel cut 1.5 m into the hillside is
    // the river standing proud of its own bank for ten metres at a time.
    let damp = 0.14 + 0.86 * smoothstep(0, 9, Math.abs(smooth - SEA_LEVEL))
    for (const bowl of BOWLS) {
      const distance = distanceTo(x, z, bowl.x, bowl.z)
      damp = Math.min(damp, smoothstep(bowl.radius * 0.75, bowl.radius * 1.8, distance))
    }
    projectOnRiver(x, z)
    damp = Math.min(damp, smoothstep(GORGE_R * 0.45, GORGE_R * 1.4, _hit.distance))

    const noise =
      (fbm2D(x / 38, z / 38, 4, 2.03, 0.5, seed) - 0.5) * 2 * 2.6 +
      (valueNoise2D(x * 0.085, z * 0.085, seed + 17) - 0.5) * 0.55

    let height = smooth + noise * damp

    // Bowls are blended from the *un-noised* massing, so a floor is a clean
    // local minimum. A noised bowl floor is a floor with a 30 cm ridge across
    // it, and a mirror-still pond is exactly where that shows.
    for (const bowl of BOWLS) {
      const weight = 1 - smoothstep(0, bowl.radius, distanceTo(x, z, bowl.x, bowl.z))
      if (weight > 0) {
        height = height * (1 - weight) + (smooth - bowl.depth * weight) * weight
      }
    }
    return height
  }

  /**
   * Lowers ground toward a target, and **only** lowers it.
   *
   * Past the river's last node the valley floor sits well above the cliff below,
   * so this returns the cliff untouched and the face keeps its full drop. A
   * symmetric `mix` would instead build a ramp out of thin air down the middle of
   * the waterfall.
   */
  const lowerTo = (height: number, target: number, weight: number): number => {
    const blended = height * (1 - weight) + target * weight
    return blended < height ? blended : height
  }

  const heightAt = (x: number, z: number): number => {
    let height = shapeAt(x, z)
    projectOnRiver(x, z)
    const distance = _hit.distance
    if (distance > GORGE_R) {
      return height
    }

    const surface = sampleAlongRiver(nodeY, _hit.t)
    // The gorge: valley walls, so the river runs in something rather than on it.
    height = lowerTo(height, surface + GORGE_RISE, 1 - smoothstep(0, GORGE_R, distance))

    const halfWidth = sampleAlongRiver(nodeHalfWidth, _hit.t)
    if (distance > halfWidth + CHANNEL_BANK) {
      return height
    }
    // The channel. Weight is exactly 1 inside the wetted width, so the bed *is*
    // the node profile there and the river's descent is a property of the node
    // list rather than of whatever the noise happened to do.
    const across = Math.min(distance, halfWidth) / halfWidth
    const bed = surface - CHANNEL_DEPTH * (1 - across * across)
    return lowerTo(height, bed, 1 - smoothstep(halfWidth, halfWidth + CHANNEL_BANK, distance))
  }

  const normalAt = (x: number, z: number, out: Vector3): Vector3 => {
    const epsilon = 0.55
    const dx = heightAt(x + epsilon, z) - heightAt(x - epsilon, z)
    const dz = heightAt(x, z + epsilon) - heightAt(x, z - epsilon)
    return out.set(-dx, 2 * epsilon, -dz).normalize()
  }

  /**
   * Walks the face outward from a lip and reports where the rock has finished
   * falling away.
   *
   * Both numbers are *sampled*, not typed. A hand-typed drop is wrong the first
   * time anything about the terrain moves and it fails silently: the curtain
   * either stops in mid-air or spends its whole length inside the hill, which is
   * exactly what the first pass shipped.
   */
  const faceProfile = (
    lipX: number,
    lipZ: number,
    outX: number,
    outZ: number,
    landsInY?: number
  ): { footY: number; clearance: number } => {
    const step = 0.25
    const lipY = heightAt(lipX, lipZ)
    let previous = lipY
    let footY = lipY
    let clearance = step

    for (let d = step; d <= 14; d += step) {
      const height = heightAt(lipX + outX * d, lipZ + outZ * d)
      // The **break in slope** is the foot, not the lowest point on the ray: past
      // the face the ground carries on falling gently toward the sea, so "lowest
      // within 14 m" walked the curtain seven metres out into a field. The 1.5 m
      // guard stops the flat lip itself from reading as the break.
      if (lipY - height > 1.5 && previous - height < 0.12) {
        footY = height
        clearance = d
        break
      }
      previous = height
      footY = height
      clearance = d
    }

    if (landsInY === undefined) {
      return { footY, clearance }
    }
    // A fall that lands in standing water has to reach the water: its splash
    // pool is a disc at its own origin, and one parked on the bank sits half
    // buried in it.
    for (let d = clearance; d <= 14; d += step) {
      if (heightAt(lipX + outX * d, lipZ + outZ * d) <= landsInY + 0.1) {
        return { footY, clearance: d }
      }
    }
    return { footY, clearance }
  }

  /** Locates a fall on a scarp by bearing: the lip sits just inside the rim. */
  const fallOn = (
    id: string,
    site: { x: number; z: number; radius: number; width: number },
    bearing: number,
    width: number,
    landsInY?: number
  ): FallSite => {
    const outX = Math.sin(bearing)
    const outZ = Math.cos(bearing)
    const inset = site.width * 0.6 + RIM_MARGIN
    const lipX = site.x + outX * (site.radius - inset)
    const lipZ = site.z + outZ * (site.radius - inset)
    const { footY, clearance } = faceProfile(lipX, lipZ, outX, outZ, landsInY)
    return {
      id,
      lipX,
      lipZ,
      topY: heightAt(lipX, lipZ),
      // A curtain's origin is its *pool surface*, so a fall landing in standing
      // water stops at the waterline rather than at the bed under it.
      bottomY: landsInY ?? footY,
      outX,
      outZ,
      run: clearance,
      width
    }
  }

  const scarpSite = { x: SCARP_X, z: SCARP_Z, radius: SCARP_R, width: SCARP_W }
  const mesaSite = { x: MESA_X, z: MESA_Z, radius: MESA_R, width: MESA_W }

  // The river's own fall is placed by the channel's last node rather than by a
  // bearing — it has to leave the rock exactly where the water does.
  const lip = RIVER_NODES[RIVER_NODES.length - 1]!
  const lipBearing = Math.atan2(lip.x - SCARP_X, lip.z - SCARP_Z)
  const lipOutX = Math.sin(lipBearing)
  const lipOutZ = Math.cos(lipBearing)
  const plunge = BOWLS[1]!
  const plungeSurfaceY = heightAt(plunge.x, plunge.z) + plunge.fill
  const lipFace = faceProfile(lip.x, lip.z, lipOutX, lipOutZ, plungeSurfaceY)

  const falls: FallSite[] = [
    {
      id: 'river',
      lipX: lip.x,
      lipZ: lip.z,
      // The curtain starts at the water's surface, not at the bed under it.
      topY: lip.y,
      bottomY: plungeSurfaceY,
      outX: lipOutX,
      outZ: lipOutZ,
      run: lipFace.clearance,
      width: lip.halfWidth * 1.75
    },
    // Tall and narrow, further along the same scarp: two falls of one height and
    // width read as one asset drawn twice.
    fallOn('ribbon', scarpSite, Math.atan2(0.94, 0.34), 1.6),
    // Short and wide, off the low mesa. The set has to span a range of scales or
    // it only proves the generator works at exactly one.
    fallOn('shelf', mesaSite, Math.atan2(0.72, 0.69), 5.4)
  ]

  return {
    seed,
    extent: EXTENT,
    heightAt,
    shapeAt,
    normalAt,
    riverNodes: RIVER_NODES,
    features: {
      seaLevel: SEA_LEVEL,
      shoreRadius: SHORE_OUTER,
      shoulder: { x: SHOULDER_X, z: SHOULDER_Z, y: heightAt(SHOULDER_X, SHOULDER_Z) },
      cliffLip: { x: lip.x, z: lip.z, y: lip.y },
      pools: BOWLS.map(bowl => {
        const floorY = heightAt(bowl.x, bowl.z)
        return { id: bowl.id, x: bowl.x, z: bowl.z, radius: bowl.radius, floorY, surfaceY: floorY + bowl.fill }
      }),
      falls
    }
  }
}

// ─── The ground mesh ────────────────────────────────────────────────────────

/**
 * Samples per axis. The grid is *non-uniform*: a cubic warp puts ~1.1 m spacing
 * over the land and ~3.5 m over the outer sea bed, where nothing but a depth
 * ramp is being described. A uniform grid fine enough for the 4.8 m scarp
 * transition would cost four times the triangles to draw sea floor nobody sees.
 */
const GRID = 176
const WARP_LINEAR = 100
const WARP_CUBIC = 80

const _normal = new Vector3()
const _paint = new Color()

/** Non-uniform axis sample, `u` in [-1, 1] → metres before scaling. */
const axisAt = (u: number): number => {
  const magnitude = Math.abs(u)
  return Math.sign(u) * (WARP_LINEAR * magnitude + WARP_CUBIC * magnitude ** 3)
}

/**
 * Ground colour, same discipline as the world's terrain: broad noise for macro
 * variation, dirt where soil can't hold, and sand as a *band* around the
 * waterline rather than below a height threshold — a threshold draws a contour
 * line across the beach, which is the one place in this scene the eye will be.
 */
const groundColor = (x: number, z: number, height: number, normalY: number, seed: number, out: Color): Color => {
  const macro = valueNoise2D(x * 0.012, z * 0.012, seed + 501)
  const fine = valueNoise2D(x * 0.07, z * 0.07, seed + 977)

  out.copy(C.grassBase)
  out.lerp(C.grassShadow, clamp01((0.48 - macro) * 2.2) * 0.55)
  out.lerp(C.grassDry, clamp01((macro - 0.52) * 2.2) * 0.6)
  out.lerp(C.grassLit, fine * 0.35)

  // Both ramps are wide on purpose. Narrow ones put a hard threshold on a
  // quantity that is sampled per vertex, so the grass/rock boundary followed the
  // grid instead of the terrain and the cliff rim came out as a regular
  // sawtooth — the artefact reads as broken geometry even though the mesh is
  // fine, because a mesh edge is exactly what a sawtooth normally is.
  const steep = 1 - clamp01((normalY - 0.42) / 0.46)
  out.lerp(C.dirt, clamp01(steep * 0.85))
  // The scarp faces are stone, and the pale blue-grey family rather than the
  // boulder family, so a 16 m cliff reads as rock and not as very steep mud.
  out.lerp(C.cliffBase, clamp01((steep - 0.35) * 1.15))

  const beach = 1 - clamp01((Math.abs(height - SEA_LEVEL) - 0.7) / 2.6)
  out.lerp(C.sand, beach * 0.9)
  if (height < SEA_LEVEL) {
    out.lerp(C.cliffShadow, clamp01(-height / 7) * 0.55)
  }
  return out
}

/**
 * One indexed grid, one draw call. No skirt and no LOD: the whole island is
 * inside the view at every camera preset, so chunking it would be four systems'
 * worth of machinery to save nothing.
 */
export const buildIslandGeometry = (island: Island): BufferGeometry => {
  const side = GRID
  const vertexCount = side * side
  const position = new Float32Array(vertexCount * 3)
  const normal = new Float32Array(vertexCount * 3)
  const color = new Float32Array(vertexCount * 3)
  const scale = island.extent / (WARP_LINEAR + WARP_CUBIC)

  for (let row = 0; row < side; row++) {
    const z = axisAt((row / (side - 1)) * 2 - 1) * scale
    for (let column = 0; column < side; column++) {
      const x = axisAt((column / (side - 1)) * 2 - 1) * scale
      const index = row * side + column
      const height = island.heightAt(x, z)
      island.normalAt(x, z, _normal)
      groundColor(x, z, height, _normal.y, island.seed, _paint)

      position[index * 3] = x
      position[index * 3 + 1] = height
      position[index * 3 + 2] = z
      normal[index * 3] = _normal.x
      normal[index * 3 + 1] = _normal.y
      normal[index * 3 + 2] = _normal.z
      color[index * 3] = _paint.r
      color[index * 3 + 1] = _paint.g
      color[index * 3 + 2] = _paint.b
    }
  }

  const quads = side - 1
  const index = new Uint16Array(quads * quads * 6)
  let cursor = 0
  for (let row = 0; row < quads; row++) {
    for (let column = 0; column < quads; column++) {
      const a = row * side + column
      const b = a + 1
      const c = a + side
      const d = c + 1
      index[cursor++] = a
      index[cursor++] = c
      index[cursor++] = b
      index[cursor++] = b
      index[cursor++] = c
      index[cursor++] = d
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('normal', new BufferAttribute(normal, 3))
  geometry.setAttribute('color', new BufferAttribute(color, 3))
  geometry.setIndex(new BufferAttribute(index, 1))
  geometry.computeBoundingSphere()
  return geometry
}

// ─── The bench ──────────────────────────────────────────────────────────────

export interface WaterLabPreset {
  id: string
  label: string
  /** Focus point. The controller pins its height to the ground beneath it. */
  x: number
  z: number
  /** Orbit distance to settle at. */
  distance: number
  caption: string
}

export class WaterLab {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly camera: PerspectiveCamera
  readonly controller: OrbitCameraController
  readonly profiler: Profiler
  readonly island: Island
  readonly presets: readonly WaterLabPreset[]

  private readonly sky: Mesh
  private readonly lights: LightRig
  private readonly ground: Mesh
  private readonly groundMaterial: TerrainMaterial
  private readonly water = new Group()
  private readonly falls = new Group()
  private readonly waterMeshes: Mesh[] = []
  private readonly waterMaterials: WaterMaterial[] = []
  private readonly fallLods: DitheredLod[] = []
  private readonly fallAssets: WorldAsset[] = []
  private element: HTMLElement | null = null
  private activePreset = 'overview'
  /** Camera-to-focus distance as of the last frame. See `applyPendingZoom`. */
  private orbitDistance = 0
  private pendingDistance: number | null = null
  private rafId: number | null = null
  private lastTime = 0
  private width = 1
  private height = 1
  private running = false

  constructor(canvas: HTMLCanvasElement, options: IslandOptions = {}) {
    this.renderer = createRenderer({ canvas })
    this.camera = new PerspectiveCamera(55, 1, 0.5, 1200)
    this.controller = new OrbitCameraController(this.camera, { maxDistance: 280 })
    this.profiler = new Profiler(this.renderer)

    this.sky = createSky()
    this.scene.add(this.sky)
    this.profiler.registerRoot(this.sky, 'sky')

    // Before any material is constructed: `ToonMaterial` enrols itself in the
    // active cascade set inside its constructor, and a material built before the
    // rig exists renders with no direct light at all.
    this.lights = createLightRig(this.scene, { camera: this.camera })

    this.island = createIsland(options)

    this.groundMaterial = new TerrainMaterial({ name: 'island' })
    this.ground = new Mesh(buildIslandGeometry(this.island), this.groundMaterial)
    this.ground.name = 'island'
    this.ground.receiveShadow = true
    // Receives but never casts, exactly as `Terrain` does. Casting looked like
    // the richer choice and is not: a 300 m island in one 2048 cascade puts the
    // depth texel at ~15 cm, and the ground's own grazing-angle self-shadow came
    // back as a sawtooth crawling along the gorge's bank — through the middle of
    // the shot this scene exists to take. It also costs the shadow pass 61 k
    // triangles per cascade for a shape the toon ramp already reads.
    this.ground.castShadow = false
    this.scene.add(this.ground)
    this.profiler.registerRoot(this.ground, 'island')

    this.water.name = 'water'
    this.falls.name = 'waterfalls'
    this.scene.add(this.water)
    this.scene.add(this.falls)
    this.profiler.registerRoot(this.water, 'water')
    this.profiler.registerRoot(this.falls, 'waterfalls')
    this.buildWater()

    this.controller.setGroundSampler((x, z) => this.island.heightAt(x, z))

    const { pools, falls } = this.island.features
    const pond = pools[0]!
    // Framed from the falls themselves rather than from typed coordinates, so
    // the preset still holds all three when a site moves. The brief for this
    // scene asks for the set to be legible *together*, which costs the biggest
    // fall some screen — the alternative frames one fall and hides two.
    let fallsX = 0
    let fallsZ = 0
    for (const fall of falls) {
      fallsX += fall.lipX
      fallsZ += fall.lipZ
    }
    fallsX /= falls.length
    fallsZ /= falls.length
    let spread = 0
    for (const fall of falls) {
      spread = Math.max(spread, Math.hypot(fall.lipX - fallsX, fall.lipZ - fallsZ))
    }
    this.presets = [
      {
        id: 'overview',
        label: 'island',
        x: -4,
        z: 6,
        // 135 rather than "far enough to see the sea's edge": the world's fog is
        // tuned to a 384 m world (GDD §3) and reaches 89 % extinction at 200 m,
        // so the wider shot turned the island into a white smudge. This frames
        // the land and leaves the far shore in aerial perspective.
        distance: 135,
        caption: 'The island: sea all round, a scarp across the middle, the gorge on the shoulder.'
      },
      {
        id: 'sea',
        label: 'sea',
        x: 24,
        z: 98,
        distance: 60,
        caption: 'Sea and shelving beach — foam lands where the baked shore distance runs out.'
      },
      {
        id: 'pond',
        label: 'pond',
        x: pond.x,
        z: pond.z,
        distance: 28,
        caption: 'Pond, in its hollow. Mirror-still by design: the pond style has zero wave amplitude.'
      },
      {
        id: 'river',
        label: 'river',
        x: -18,
        z: -8,
        distance: 46,
        caption: 'River, down the gorge. Spline nodes, flowing pattern, banks either side.'
      },
      {
        id: 'falls',
        label: 'falls',
        x: fallsX,
        z: fallsZ,
        distance: spread * 1.8,
        caption: 'Falls: the river leaving the cliff into its plunge pool, plus two more at other scales.'
      }
    ]

    this.focusPreset('overview')
  }

  /**
   * Every body of water in the scene: sea, pond, plunge pool, river, three falls.
   *
   * Pools are generated in **pool-local** coordinates and carry their surface
   * height in the geometry's Y, so the mesh is placed at `(x, 0, z)` and its
   * depth sampler has to re-add the centre. The river is generated in world
   * space from world-space nodes, so it is placed at the origin. Getting either
   * of those the other way round puts the water somewhere else entirely, which
   * is at least loud.
   */
  private buildWater(): void {
    const island = this.island

    const addPool = (id: string, styleId: string, x: number, z: number, surfaceY: number, half: number): void => {
      const style = waterStyle(styleId)
      const surface = createWaterPool({
        halfX: half,
        halfZ: half,
        surfaceY,
        style,
        depthAt: (localX, localZ) => island.heightAt(x + localX, z + localZ)
      })
      const material = createWaterMaterial({ style, name: `water-${id}` })
      const mesh = new Mesh(surface.geometry, material)
      mesh.name = `water/${id}`
      mesh.position.set(x, 0, z)
      // Water never casts: the sheet is displaced in the material's own vertex
      // stage and three's depth material knows nothing about that, so a casting
      // water mesh drops the shadow of a flat plane it does not have.
      mesh.castShadow = false
      mesh.receiveShadow = false
      mesh.userData.perfTag = 'water'
      this.water.add(mesh)
      this.waterMeshes.push(mesh)
      this.waterMaterials.push(material)
    }

    // The sea first, so it sorts behind the pools standing above it.
    addPool('sea', 'sea', 0, 0, island.features.seaLevel, SEA_HALF_EXTENT)
    for (const pool of island.features.pools) {
      // Half-extent past the waterline, not up to it: the rectangle's corners
      // are meant to end up buried in the bank, where the baked depth turns them
      // off. Ending the sheet *at* the waterline leaves a straight blue edge
      // crossing the shore on the diagonals.
      addPool(pool.id, 'pond', pool.x, pool.z, pool.surfaceY, pool.radius * 0.62)
    }

    const riverStyle = waterStyle('river')
    const river = createWaterRiver({
      nodes: island.riverNodes,
      style: riverStyle,
      depthAt: (x, z) => island.heightAt(x, z)
    })
    const riverMaterial = createWaterMaterial({ style: riverStyle, name: 'water-river' })
    const riverMesh = new Mesh(river.geometry, riverMaterial)
    riverMesh.name = 'water/river'
    riverMesh.castShadow = false
    riverMesh.receiveShadow = false
    riverMesh.userData.perfTag = 'water'
    this.water.add(riverMesh)
    this.waterMeshes.push(riverMesh)
    this.waterMaterials.push(riverMaterial)

    // ── Falls ──────────────────────────────────────────────────────────────
    //
    // Each asset is generated at the drop its own cliff actually has, so a
    // change to the terrain moves the curtain with it. The form is the
    // character; the metres are the site's.
    const forms: Record<string, WaterfallForm> = { river: 'curtain', ribbon: 'ribbon', shelf: 'broad' }
    for (const [index, fall] of island.features.falls.entries()) {
      const asset = createWaterfallAsset({
        seed: 17 + index * 41,
        form: forms[fall.id] ?? 'curtain',
        height: fall.topY - fall.bottomY,
        width: fall.width
      })
      const lod = new DitheredLod(asset)
      lod.name = `fall/${fall.id}`
      // The asset's origin is the pool surface, its lip is at `+height` and it
      // hangs toward local +Z — so the yaw is the face's outward bearing, and
      // `run` (measured, not guessed) is how far out the rock has fallen away
      // enough for the curtain to hang free of it.
      lod.position.set(fall.lipX + fall.outX * fall.run, fall.bottomY, fall.lipZ + fall.outZ * fall.run)
      lod.rotation.y = Math.atan2(fall.outX, fall.outZ)
      this.falls.add(lod)
      this.fallLods.push(lod)
      this.fallAssets.push(asset)
    }
  }

  attach(element: HTMLElement): void {
    this.element = element
    this.controller.attach(element)
    // Re-apply, because the constructor's call had no element to zoom through
    // yet and left the camera at the controller's own 14 m default — which on a
    // 300 m island is a close-up of one hillside.
    this.focusPreset(this.activePreset)
  }

  /**
   * Jumps the camera to a feature.
   *
   * The focus is set directly. The orbit *distance* is private to the
   * controller, and widening that API for a bench is not this file's call — so
   * it is driven through the wheel handler the controller already exposes, with
   * one synthetic notch. Lands within a per cent; the damping absorbs the rest.
   */
  focusPreset(id: string): void {
    const preset = this.presets.find(entry => entry.id === id)
    if (!preset) {
      return
    }
    this.activePreset = preset.id
    this.controller.setFocus(preset.x, this.island.heightAt(preset.x, preset.z) + 2.2, preset.z)
    this.pendingDistance = preset.distance
    this.applyPendingZoom()
  }

  /**
   * Sizes the synthetic notch from `orbitDistance`, which is measured at the end
   * of each frame and is therefore the radius the camera was actually at
   * *before* this preset moved the focus. Measuring after the move would size
   * the zoom from the length of the jump across the island instead, and every
   * preset would fling the camera to the horizon. Nothing has been measured
   * before the first frame, so the request waits for one.
   */
  private applyPendingZoom(): void {
    const element = this.element
    const target = this.pendingDistance
    if (!element || target === null || this.orbitDistance <= 0.01) {
      return
    }
    this.pendingDistance = null
    // Inverse of the controller's `exp(deltaY · 0.0014)` zoom.
    const deltaY = Math.log(target / this.orbitDistance) / 0.0014
    element.dispatchEvent(new WheelEvent('wheel', { deltaY, cancelable: true }))
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)

    const changed = resizeRenderer(this.renderer, this.width, this.height, 1)
    this.camera.aspect = this.width / this.height
    this.camera.updateProjectionMatrix()

    if (changed) {
      const bufferHeight = this.renderer.getContext().drawingBufferHeight
      updateUnitsPerPixel(this.camera.fov, bufferHeight)
      updateLodBiasFromView(bufferHeight, this.camera.fov)
      this.lights.onProjectionChanged()
    }
  }

  start(): void {
    if (this.running) {
      return
    }
    this.running = true
    this.lastTime = performance.now()
    const tick = (now: number): void => {
      this.rafId = requestAnimationFrame(tick)
      this.frame(now)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  stop(): void {
    this.running = false
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  private frame(now: number): void {
    const delta = Math.min(0.05, (now - this.lastTime) / 1000)
    this.lastTime = now

    this.profiler.beginFrame(this.renderer)
    worldUniforms.uTime.value += delta

    this.applyPendingZoom()
    this.controller.update(delta)
    this.orbitDistance = this.camera.position.distanceTo(this.controller.focus)
    this.camera.updateMatrixWorld()
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert()
    this.lights.follow(this.controller.focus)
    this.sky.position.copy(this.camera.position)

    for (const lod of this.fallLods) {
      lod.update(this.camera.position)
    }

    this.renderer.render(this.scene, this.camera)
    this.profiler.endFrame(this.renderer, now)
  }

  dispose(): void {
    this.stop()
    this.controller.detach()
    this.element = null

    for (const mesh of this.waterMeshes) {
      mesh.geometry.dispose()
    }
    for (const material of this.waterMaterials) {
      material.dispose()
    }
    for (const lod of this.fallLods) {
      lod.dispose()
    }
    for (const asset of this.fallAssets) {
      for (const geometry of asset.tiers) {
        geometry.dispose()
      }
      asset.material.dispose()
    }

    this.ground.geometry.dispose()
    this.groundMaterial.dispose()
    this.sky.geometry.dispose()
    ;(this.sky.material as { dispose(): void }).dispose()
    this.lights.dispose()
    this.profiler.dispose()
    this.renderer.dispose()
  }
}
