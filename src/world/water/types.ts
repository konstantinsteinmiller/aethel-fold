import type { BufferGeometry, Color, Vector2 } from 'three'

/**
 * ─── The water contract ─────────────────────────────────────────────────────
 *
 * Everything in `src/world/water/` is written against this file: the material
 * consumes it, the surface generators produce it, the waterfalls reuse it and
 * the editor edits it. It exists so the four can be built independently and
 * still agree.
 *
 * ── The central constraint, and the design that falls out of it ─────────────
 *
 * Stylised water normally gets its two best features — shoreline foam and a
 * depth-graded colour — by sampling the **scene depth buffer**: compare the
 * water surface's depth against whatever was drawn behind it, and the
 * difference is how much water the eye is looking through.
 *
 * That is not available here, and not by oversight. `core/renderer.ts` builds
 * the context with `alpha: false`, `stencil: false` and explicitly no depth
 * prepass, because the world is opaque with a sky dome behind it and a tiler
 * gets to skip both. Adding a depth target to serve water would cost a full
 * extra pass over the entire scene — for one material.
 *
 * So the depth is **baked into vertex attributes at generation time** instead.
 * Water in this world is static geometry over static terrain, so the quantity
 * the depth buffer would have told us per-pixel is knowable exactly, per-vertex,
 * before the frame starts. It costs nothing at runtime, needs no texture
 * (GDD §5.2), and it is the same move the rest of the world already makes:
 * interior detail comes from baked vertex data, never from geometry or from a
 * second pass (GDD R1).
 *
 * The trade is honest and worth stating: baked depth cannot respond to anything
 * that moves. A boat, or the player wading, gets no shoreline foam of its own.
 * If that is ever needed it is a ripple decal on top, not a reason to rebuild
 * the pipeline.
 *
 * ── Required vertex attributes ──────────────────────────────────────────────
 *
 * Every water geometry — plane, river ribbon or waterfall curtain — ships:
 *
 *   position   vec3
 *   normal     vec3   analytic, from the wave/sheet function, never the mesh
 *   aDepth     float  metres of water beneath this vertex. Drives the colour
 *                     ramp. 0 at a shoreline, `depthFalloff`+ in open sea.
 *                     Waterfalls use the sheet's thickness here.
 *   aShore     float  0 exactly on a free edge of the sheet, rising to 1 a
 *                     `foamWidth` inside it. Drives foam. This is a *distance
 *                     to the geometry's own boundary*, not to the terrain — a
 *                     river's banks and a waterfall's side edges are the same
 *                     quantity, which is why one attribute serves both.
 *   aFlow      vec2   surface-space drift of the flow pattern, in units/second.
 *                     Varies per-vertex so a river can bend. A pond is (0,0).
 *                     A waterfall points down its own curtain.
 *
 * `aShore` and `aDepth` are deliberately separate. They coincide on a gently
 * shelving pond and diverge everywhere interesting: a river running through a
 * gorge is deep *and* has banks a metre away, and collapsing the two would put
 * foam across its whole width.
 */

/** The four attributes above, for generators to assert against before returning. */
export const WATER_ATTRIBUTES = ['position', 'normal', 'aDepth', 'aShore', 'aFlow'] as const

/**
 * How a body of water behaves and looks.
 *
 * One struct spans mirror-still pond → drifting sea → running river → falling
 * curtain, because the user's requirement is that this be *configurable* rather
 * than four hard-coded looks. Every field is a continuous dial; the presets in
 * `styles.ts` are points in that space, not special cases, and the editor is
 * free to interpolate between them.
 */
export interface WaterStyle {
  /** Stable id. Persisted in water placements — never rename one in place. */
  id: string
  label: string

  // ── Motion ───────────────────────────────────────────────────────────────
  /**
   * Vertical displacement of the surface, metres. **0 is a first-class value**
   * — a pond must be able to be genuinely, perfectly still, and a "very small
   * amplitude" pond is not the same thing: any nonzero wave on a small surface
   * reads as jelly rather than as calm.
   */
  waveAmplitude: number
  /** Crest-to-crest distance, metres. Large values on a small pond read flat. */
  waveLength: number
  /** Crests per second. Slow is almost always right; fast reads as boiling. */
  waveSpeed: number
  /**
   * Gerstner steepness, 0–1. **0 is a plain sine swell; above 0 the surface also
   * displaces horizontally**, bunching vertices toward the crests so they sharpen
   * and the troughs broaden — which is the difference between a rolling sea and
   * a rippling bedsheet.
   *
   * Only open water earns it. A pond is still, and a waterfall is a vertical
   * sheet where horizontal bunching would tear the curtain sideways off the rock
   * — both sit at 0, which must reduce to *exactly* today's sinusoidal path so
   * the pond stays bit-exact still.
   *
   * 1 is the clamp where the crest is about to loop over itself. The shader
   * clamps the summed `Q·k·A` regardless, because a Gerstner sum that exceeds it
   * self-intersects and renders as folded shells.
   *
   * ── Why this is a uniform and not a define ─────────────────────────────────
   *
   * Forking the program on "is this Gerstner" would double water's program count
   * for one arithmetic branch (GDD §5.2 — one program per shading family). At 0
   * the horizontal term multiplies out and costs a few instructions on a surface
   * that is already the heaviest overdraw in the frame; that is the cheaper half
   * of the trade by a wide margin.
   */
  steepness: number
  /**
   * Surface-space drift of the flow pattern, units/second. This is what
   * separates a sea (bobbing in place, ~0) from a river (visibly travelling).
   * Generators may override it per-vertex via `aFlow`; this is the scale.
   */
  flowSpeed: number

  // ── Colour ───────────────────────────────────────────────────────────────
  shallow: Color
  mid: Color
  deep: Color
  foam: Color
  /** Metres of depth at which `deep` is fully reached. */
  depthFalloff: number
  /** Width of the shoreline foam band, metres. */
  foamWidth: number
  /**
   * Extra foam on wave crests, 0–1. Reads as chop; keep it at 0 for a pond, or
   * a still surface grows whitecaps out of nothing.
   */
  crestFoam: number

  // ── Surface response ─────────────────────────────────────────────────────
  /** Base opacity at zero depth. The depth ramp drives it up from here. */
  opacity: number
  /** Banded specular glint strength (GDD R4 — quantised, not a Blinn lobe). */
  sparkle: number
  /** Fresnel rim strength. Water takes a stronger rim than rock (GDD R5). */
  rimStrength: number
}

/**
 * A generated body of water: geometry plus the metrics the editor and the
 * collision/placement layers need back.
 */
export interface WaterSurface {
  geometry: BufferGeometry
  /** Object-space Y of the flat surface. Everything else hangs below it. */
  surfaceY: number
  /** Bounding radius from the object origin, for frustum culling. */
  radius: number
  /**
   * Object-space footprint. Measured over the geometry actually emitted, which
   * for a pool overhanging a beach is **smaller than the extent that was asked
   * for** — dry cells are dropped. The editor's gizmo therefore wants the
   * authored extent from the `WaterPlacement`, not this.
   */
  halfX: number
  halfZ: number
  /**
   * World-space centre of the emitted geometry.
   *
   * Only rivers need this, and they need it badly. A river is built from
   * world-space spline nodes, so its vertices carry absolute coordinates and
   * `radius` — honestly measured from the object origin — comes out at 622 m
   * for a 40 × 14 m ribbon sitting far from the world origin. That number is
   * useless for frustum culling. A caller that translates the mesh by this
   * centre (and offsets the geometry by its negation) gets a tight sphere back.
   *
   * Optional because a pool is already built origin-centred and has nothing to
   * say here.
   */
  centerX?: number
  centerZ?: number
}

/** Where the surface generators get the ground beneath the water from. */
export type HeightSampler = (x: number, z: number) => number

/** One control point of a river spline, in world space. */
export interface RiverNode {
  x: number
  z: number
  /** Surface height at this node. Rivers run downhill; this is not derived. */
  y: number
  /** Half-width of the channel here, metres. Varies along the run. */
  halfWidth: number
}

export type WaterKind = 'pool' | 'river'

/**
 * One placed body of water.
 *
 * Deliberately **not** a `Placement` (`level/types.ts`). A prop placement is a
 * point with a uniform scale and a yaw, which is exactly wrong for water: a sea
 * is non-uniformly sized, and a river is a polyline with a per-node width.
 * Forcing water through the prop schema would mean either a uniform-scale-only
 * sea or a `Placement` grown two optional shapes it can never use.
 */
export interface WaterPlacement {
  id: string
  kind: WaterKind
  styleId: string
  /** Pools only: centre, extent and yaw. */
  x: number
  y: number
  z: number
  rotY: number
  halfX: number
  halfZ: number
  /** Rivers only. Empty for a pool. */
  nodes: RiverNode[]
}
