import type { WorldAsset } from '../assets/types'
import { type FogExp2, Group, type Mesh, PerspectiveCamera, Scene, Vector3, type WebGLRenderer } from 'three'
import { createBirchAsset } from '../assets/birch'
import { createDeadTreeAsset } from '../assets/deadTree'
import { createPineAsset } from '../assets/pine'
import { createBoulderAsset, createStoneAsset } from '../assets/rock'
import { createShrubAsset } from '../assets/shrub'
import { createStumpAsset } from '../assets/stump'
import { createTreeAsset } from '../assets/tree'
import {
  disposeLevelEditor,
  heldPlacementId,
  installLevelEditor,
  levelPlacements,
  levelRevision,
  rehydrateLevel,
  seedLevel,
  setPlacementsRendered,
  updateLevelEditor
} from '../editor'
import { disposeCrowd, installCrowd, seedNpcs, updateCrowd } from '../npc'
import {
  disposeWaterEditor,
  installWaterEditor,
  seedWater,
  setWaterViewFactory,
  updateWaterEditor,
  waterPlacements,
  waterRevision
} from '../water/editorFacade'
import { createWaterView } from '../water/view'
import { placeableBuildTimes, placeableProgress, registerPlaceablesIncremental } from '../assets'
import { getPlaceable } from '../level/catalog'
import { editorMode } from '../editor/toggle'
import { budgetLedger } from '../geometry/budget'
import { GrassField } from '../grass/GrassField'
import { GRASS_LEVELS, type GrassDetailSetting, grassLevelIndex } from '../grass/config'
import { setGrassPalette } from '../grass/grassPlacement'
import { aoStats } from '../geometry/vertexAO'
import { PlacementBatcher } from '../level/PlacementBatcher'
import { buildStartingLevel } from '../level/startingLevel'
import type { Placement } from '../level/types'
import { SIT_SECONDS, type SeatKind } from '../combat/postures'
import { SeatFinder, SitController, type SitActor } from '../interaction'
import { groundForward } from '../player'
import { setLodBandScale, setLodQuality, updateLodBiasFromView } from '../lod/config'
import {
  InstancedLodField,
  type InstancedLodFieldOptions,
  type InstanceTransform
} from '../lod/InstancedLodField'
import { Profiler } from '../perf/Profiler'
import { AdaptiveQuality } from '../perf/AdaptiveQuality'
import { TerrainOcclusion } from '../perf/TerrainOcclusion'
import { Character, type CharacterState } from '../characters/Character'
import { playerLook } from '../characters/roster'
import { createPlayer, type Player } from '../player'
import { filterScatter, maxInstancesPerChunk, scatterChunkSet, type ScatterOptions } from '../scatter'
import { shoreHeightAbove, type WaterBody } from '../terrain/waterLevel'
import type { RiverNode, WaterPlacement } from '../water/types'
import { ScatterColliderIndex, type ScatterColliderSpec } from '../scatterColliders'
import { saveScatterOverrides, ScatterOverrides, scatterKey } from '../level/scatterOverrides'
import { WORLD_PATCH } from '../level/worldPatch.generated'
import { applyPatchToBaseline, type PlacementLike } from '../level/worldPatch'
import { updateUnitsPerPixel, worldUniforms } from '../shading/globals'
import { Heightfield, type HeightfieldOptions } from '../terrain/heightfield'
import type { SculptField } from '../terrain/SculptField'
import { TERRAIN_PALETTE_SLOTS } from '../terrain/heightfieldCore'
import { Terrain } from '../terrain/Terrain'
import { C } from '../art/palette'
import { Celestials } from './celestials'
import { DayCycle } from './dayCycle'
import { createLightRig, type LightRig } from './lighting'
import { OrbitCameraController } from './OrbitCameraController'
import { createRenderer, resizeRenderer } from './renderer'
import { advanceClouds, type CloudUniforms } from './clouds'
import { createSky, type SkyMesh } from './sky'

/**
 * ─── World ──────────────────────────────────────────────────────────────────
 *
 * Owns the canvas and everything on it. The Vue layer holds exactly one
 * reference to this object and calls imperative methods on it — no reactive
 * proxy ever reaches a scene node (GDD §0).
 *
 * The frame is deliberately ordered: camera → matrices → LOD assignment →
 * render. LOD assignment needs `matrixWorldInverse` for its frustum tests, and
 * three only refreshes that inside `render()`, so the update is done by hand
 * before the systems run. Getting this backwards produces a one-frame-stale
 * frustum, which shows up as props popping in at the screen edge during fast
 * camera turns — and it is very hard to diagnose after the fact.
 */

export interface WorldSettings {
  outlines: boolean
  shadows: boolean
  wind: boolean
  frustumCullInstances: boolean
  /** Cell-level culling. Off = the original flat per-instance sweep (A/B). */
  hierarchical: boolean
  /** Cull cells hidden behind terrain ridges. */
  occlusion: boolean
  /** Let the adaptive controller drive quality from measured GPU time. */
  adaptiveQuality: boolean
  /** 0.6–1.0 quality slider. */
  renderScale: number
  /**
   * Grass detail. `auto` tracks the adaptive controller's level, which is the
   * only setting that can be right on a machine nobody has measured — see
   * `syncGrassDetail`.
   */
  grassDetail: GrassDetailSetting
}

export interface WorldBuildInfo {
  buildMs: number
  treeInstances: number
  rockInstances: number
  terrainChunks: number
  /** Editor palette size — how many prop types the level editor can place. */
  placeables: number
  /** Props the starting level seeded. 0 once a saved level exists. */
  seededProps: number
  /**
   * Wall-clock cost of each construction phase, in ms.
   *
   * Boot is synchronous main-thread work, so on a constrained device it is the
   * longest single block in the session — measured at 4.8 s under a 4× CPU
   * throttle against 650 ms on desktop. A total alone doesn't say which phase to
   * attack, and guessing between "asset generation" and "scatter placement" is
   * exactly the guess this project keeps getting wrong.
   */
  phases: { name: string; ms: number }[]
  /**
   * Cost of each of the first few `render()` calls, in ms, indexed by frame.
   *
   * Frame 0 is not a normal frame: it is where the driver compiles and links
   * every program the scene touches and uploads every buffer, and that cost is
   * invisible to `recordFrameDelta`, which only starts measuring gaps once two
   * frames exist. Without this the largest remaining stall in the session had no
   * owner.
   */
  firstFrameMs: number[]
  /** Draw calls on each of those frames. See `firstFrameMs`. */
  firstFrameDraws: number[]
  /** Resident geometries on each of those frames. See `firstFrameMs`. */
  firstFrameGeometries: number[]
  budgets: { name: string; tris: number; budget: number }[]
}

export interface WorldOptions {
  seed?: number
  /** Square extent of the terrain, in metres. */
  worldSize?: number
  /**
   * Multiplies scatter density. `2` is four times the instances (spacing is a
   * distance, so the count goes as the square).
   *
   * Exists to make culling and streaming work *measurable*: at the shipping
   * density the frame is vsync-bound and a 10× improvement in the instance loop
   * shows up as no change at all. Benchmarks run at 3–4.
   */
  densityScale?: number
  /**
   * Batch the crowd's socketed gear. Default true; `?gearinst=0` turns it off
   * so the two can be A/B'd inside one build.
   */
  instanceGear?: boolean
  /** How many crowd figures may stand at once. Default `DEFAULT_CROWD_BUDGET`. */
  crowdBudget?: number
  /**
   * Shadow cascade count and range, for A/B-ing the shadow pass.
   *
   * Measured under a 4× CPU throttle with quality pinned, the shadow pass is
   * **90 of 139 draw calls and 63 % of GPU time** — by a wide margin the most
   * expensive thing in the frame. `CSM_CASCADES` is a shader define, so the
   * count cannot be toggled at runtime without recompiling every material;
   * these are constructor options and the comparison is two page loads of the
   * same build, not two builds.
   */
  shadowCascades?: number
  shadowMaxFar?: number
  /** Detailed terrain reach, in metres. For A/B against the distant ring. */
  loadRadius?: number
  /** Time of day to start at, 0-1. 0 is midnight, 0.5 noon. */
  startTime?: number
  /**
   * Which product this world is.
   *
   * `sandbox` is Meadowfall: the level editor, the saved placement store, the
   * demo characters, the seeded crowd. `story` is a chapter: a hand-authored
   * placement list that is never persisted, no editor, no crowd, and a camera
   * somebody else drives.
   *
   * It is an option on `World` rather than a subclass because the *world* is the
   * same world in both -- the same terrain, scatter, grass, lighting, LOD,
   * profiler and adaptive quality, which is 90 % of this file. What differs is
   * what is placed in it and who is holding the camera, and those are four
   * branches rather than a second 1700-line class.
   */
  mode?: WorldMode
  /**
   * Story mode: the props the chapter places.
   *
   * Passed in rather than read from a module so the chapter owns its own map.
   * They go straight to the batcher and to the collision cache and are never
   * written to `localStorage` -- a story level is content, not player state, and
   * persisting it would mean a patched chapter could not reach anyone who had
   * already played it.
   */
  placements?: Placement[]
  /**
   * Story mode: keeps procedural scatter out of the village.
   *
   * `ScatterOptions.clearRadius` is measured from the world origin, and the
   * sandbox uses 10-16 m so the camera opens in a clearing. A village 38 m
   * across needs the whole of it clear or there are oaks growing through the
   * market square.
   */
  scatterClearRadius?: number
  /**
   * Story mode: extra circles the procedural scatter keeps out of.
   *
   * `scatterClearRadius` only reaches around the world origin, so a chapter with
   * a second settlement in it needs this. See `ScatterOptions.clearZones`.
   */
  scatterClearZones?: readonly { x: number; z: number; radius: number }[]
  /**
   * Story mode: terrain shaping, as a sculpt delta.
   *
   * Attached to the heightfield *and* broadcast to the chunk workers, which is
   * the only way both agree -- see `story/terrain.ts` on why a story-specific
   * height function cannot work.
   */
  sculpt?: SculptField
  /** Story mode: the terrain's own shape. Chapter 1 wants gentler ground. */
  heightfield?: HeightfieldOptions
}

export type WorldMode = 'sandbox' | 'story'

/**
 * Orbit is the inspection camera the world was built with; first-person is the
 * capsule player. Both stay attached — a disabled controller ignores every
 * event — so switching is a flag, not a teardown.
 */
export type CameraMode = 'orbit' | 'firstPerson' | 'story'

/**
 * `story` is a third mode and it is deliberately *passive*: the world neither
 * moves the camera nor reads input for it. `StoryPlayer` owns both, because a
 * third-person combat camera has to frame the space between two moving bodies
 * and neither of the two rigs here can (`orbit` frames a point, `firstPerson`
 * frames the inside of a head). The world's only remaining job is to leave the
 * matrices alone and let the shadow rig follow whatever the story is looking at.
 */

/**
 * The editor's aim, as plain numbers.
 *
 * Deliberately not a `Ray` or a pair of `Vector3`s: this crosses from the editor
 * into the world every frame, and a scatter pick has to allocate nothing (GDD
 * §5.2). The caller already holds the components.
 */
export interface PickRay {
  originX: number
  originY: number
  originZ: number
  /** Must be normalised — the cylinder test measures distance along it. */
  dirX: number
  dirY: number
  dirZ: number
  /** How far along the ray to search, in metres. */
  maxDistance: number
  /** Where the aim met the terrain. The fallback test searches around this. */
  pointX: number
  pointZ: number
}

/**
 * One scatter species, as the world holds it.
 *
 * Named rather than inline because two arrays refer to the same objects: the
 * declaration order (which is a stable identity — see `scatterPlan`) and the
 * resolution order the placement pass walks.
 */
interface ScatterSpeciesEntry {
  field: InstancedLodField
  options: ScatterOptions
  collide?: ScatterColliderSpec
  id: string
  editorDefId?: string
  /** Ground-level solid radius at unit scale — see `scatter.ts::scatterChunkSet`. */
  footprint: number
  /** Its index in `scatterSpecies`, i.e. the ordinal the collider index stores. */
  ordinal: number
}

/**
 * How far past a river's own channel its water table reaches, in metres.
 *
 * `waterLevel.ts` is explicit that a `WaterBody` rect is the *water plane's*
 * footprint and not the wet ground's: the query "how high is the water here" has
 * to be answerable on dry land, or there is no shore to grade. A sea already
 * satisfies that — the storyteller's sea is 172 m from the island's centre
 * against a shoreline at 71 — but a river's nodes describe the channel and
 * nothing else, so its rect has to be grown by hand.
 *
 * 12 m: the Arla's bank climbs at ~0.7 m/m, so `SHORE_DRY_TOP` (2.3 m) is
 * reached 3.3 m from the water and 12 m is that with room for a shallower reach
 * upstream. Wider is harmless — ground that stands well above the surface reads
 * as "no shore" through the same expression that ramps it near one — and it
 * stops well short of the village 96 m away.
 */
const RIVER_TABLE_MARGIN = 12

/**
 * Turns the scene's water into the engine's water table.
 *
 * `WaterPlacement` is what water *is* (a rotated pool, or a polyline with a
 * per-node width); `WaterBody` is the axis-aligned rectangle plus a linear
 * gradient that a Web Worker can be handed as a `Float32Array`. This is the one
 * place the two meet.
 *
 * Two lossy steps, both deliberate and both named in `waterLevel.ts`:
 *
 *   * a **rotated pool** becomes its axis-aligned bounding box. Every pool in
 *     the project sits at `rotY = 0`; a rotated one would report water over its
 *     corners, which paints a little sand on ground that has none under it —
 *     visible only where a rotated pool meets a slope, and cheap to fix by
 *     splitting it if that ever happens.
 *   * a **river** becomes one sloped rectangle rather than a rect per segment.
 *     That is not an approximation of the Arla, it is exact: its surface falls
 *     linearly, so one `slopeZ` reproduces it, where per-segment rects would
 *     step 0.34 m at every node boundary and notch the shore every 26 m.
 */
export const waterBodiesOf = (placements: readonly WaterPlacement[]): WaterBody[] => {
  const bodies: WaterBody[] = []

  for (const placement of placements) {
    if (placement.kind === 'pool') {
      if (!(placement.halfX > 0) || !(placement.halfZ > 0)) {
        continue
      }
      // Circumscribing box of the rotated rectangle.
      const cos = Math.abs(Math.cos(placement.rotY))
      const sin = Math.abs(Math.sin(placement.rotY))
      const halfX = placement.halfX * cos + placement.halfZ * sin
      const halfZ = placement.halfX * sin + placement.halfZ * cos
      bodies.push({
        minX: placement.x - halfX,
        maxX: placement.x + halfX,
        minZ: placement.z - halfZ,
        maxZ: placement.z + halfZ,
        y: placement.y
      })
      continue
    }

    const river = riverBody(placement.nodes)
    if (river) {
      bodies.push(river)
    }
  }

  return bodies
}

/** One sloped rectangle covering a river run and its banks. */
const riverBody = (nodes: readonly RiverNode[]): WaterBody | null => {
  if (nodes.length < 2) {
    return null
  }
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const node of nodes) {
    const reach = node.halfWidth + RIVER_TABLE_MARGIN
    minX = Math.min(minX, node.x - reach)
    maxX = Math.max(maxX, node.x + reach)
    minZ = Math.min(minZ, node.z - reach)
    maxZ = Math.max(maxZ, node.z + reach)
  }

  const first = nodes[0]!
  const last = nodes[nodes.length - 1]!
  // The gradient is taken along whichever axis the run actually travels. Fitting
  // both would be ill-conditioned on a river that wanders 11 m across and runs
  // 260 m down: the cross-axis slope would be meander noise scaled by the fall.
  const spanX = Math.abs(last.x - first.x)
  const spanZ = Math.abs(last.z - first.z)
  const fall = last.y - first.y
  const alongZ = spanZ >= spanX
  const run = alongZ ? last.z - first.z : last.x - first.x
  const slope = Math.abs(run) < 1e-6 ? 0 : fall / run
  const centre = alongZ ? (minZ + maxZ) * 0.5 : (minX + maxX) * 0.5
  const from = alongZ ? first.z : first.x

  return {
    minX,
    maxX,
    minZ,
    maxZ,
    y: first.y + slope * (centre - from),
    ...(alongZ ? { slopeZ: slope } : { slopeX: slope })
  }
}

/**
 * One scattered instance, named well enough to tombstone or replace.
 *
 * `pickScatter` returns a **shared** instance of this. Read what you need from
 * it before calling again; copy it if you intend to keep it.
 */
export interface ScatterPick {
  /** Its tombstone key. Stable across chunk unload and reload. */
  key: string
  /** Species id, e.g. `tree1`. The species half of the key. */
  species: string
  /** Catalogue entry to place when this prop is *moved*, if it has one. */
  editorDefId: string | undefined
  x: number
  z: number
  /** Ground height at its base. */
  y: number
}

/**
 * Per-frame budget for draining the placeable catalogue, in ms.
 *
 * Matches the terrain chunk upload budget, and for the same reason: whatever is
 * left of a 16.7 ms frame after the scene has drawn is a couple of milliseconds,
 * not ten. Set higher and the drain finishes sooner at the cost of a visibly
 * juddering first second, which is exactly the thing being fixed.
 */
const PLACEABLE_BUDGET_MS = 2

/**
 * Reach of the streamed, detailed terrain in metres.
 *
 * Beyond it the distant ring takes over. Sized by where the ring's ~29 m cells
 * start to read as coarse, not by how much world is wanted — the world is
 * unbounded either way.
 */
const DEFAULT_LOAD_RADIUS = 190

/**
 * How far around the player scatter colliders are gathered, in metres.
 *
 * Capsule radius plus the furthest a clamped frame can travel plus the widest
 * prop radius, with margin. Larger costs a longer inner loop for props that
 * cannot be reached this frame; smaller lets a fast move tunnel past a trunk
 * that was never gathered.
 */
const SCATTER_COLLIDER_QUERY_RADIUS = 4

/**
 * How long an edited water layout must sit still before the scatter is rebuilt.
 *
 * A third of a second: long enough that dragging a river out is one rebuild
 * rather than sixty, short enough that it feels immediate when you let go.
 */
const WATER_SETTLE_MS = 350

/**
 * Collision radius of a chibi character, in metres.
 *
 * Narrower than the player's 0.35: the figure is genuinely slimmer, and a
 * character that collides wider than it looks reads as clumsy in exactly the
 * situations — squeezing between two trees — where the player is watching.
 */
/**
 * Walk speed for a scripted approach to a seat, m/s.
 *
 * `PlayerController`'s own `walkSpeed` default, because a walk the game drives
 * must not be a different speed from the walk the player drives -- the seam
 * shows the moment the two are visible in one motion.
 */
const SIT_WALK_SPEED = 5.2

/** Scratch for the seat scan's forward. Module level -- the scan runs every frame. */
const _seatForward = new Vector3()

const CHARACTER_RADIUS = 0.28

/** Scratch for character placement. Module level — GDD §5 bans frame allocation. */
const _characterAt = new Vector3()

/** How many opening `render()` calls to time individually. See `firstFrameMs`. */
const FIRST_FRAME_SAMPLES = 6

/**
 * Ceiling on warmup passes. Each is one frame into a 1×1 buffer.
 *
 * Four rather than twelve, measured: both caps eliminate the opening stall
 * equally (5–10 ms opening frames either way), but twelve costs 2.1–2.7 s of
 * warmup against 0.9–2.0 s for four. Past the first pass with real content in
 * it there is almost nothing left to link — the extra passes were waiting for
 * a *draw count* to settle, which it never does while chunks keep streaming.
 */
const WARMUP_MAX_PASSES = 4

/**
 * Gap between warmup passes, in ms. Roughly a frame — the terrain worker needs
 * real time to deliver, and spinning faster only spends passes waiting.
 */
const WARMUP_PASS_MS = 16

/** Consecutive passes that must link no new program before warmup stops. */
const WARMUP_SETTLED_PASSES = 2

/** Scratch for `pickScatter`, so a per-frame pick allocates nothing. */
const _pick: ScatterPick = { key: '', species: '', editorDefId: undefined, x: NaN, z: NaN, y: 0 }

export class World {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly camera: PerspectiveCamera
  readonly controller: OrbitCameraController
  readonly profiler: Profiler
  readonly terrain: Terrain
  readonly buildInfo: WorldBuildInfo
  readonly player: Player
  // -- Sitting on things ----------------------------------------------------
  //
  // The sandbox half of `world/interaction/`. The chapter's copy lives in
  // `StoryDirector` and drives a `Combatant`; this one drives the first-person
  // walker through a five-member adapter. The catalogue, the focus scan and the
  // state machine are the same three objects in both -- which is the point: a
  // bug in the sit is one bug, reproducible from either route.
  private seats: SeatFinder | null = null
  private readonly sit = new SitController()
  /** The seat being held, and how far into it. `Combatant.postureBlend`'s twin. */
  private sitSeat: SeatKind = 'bench'
  private sitting = false
  private sitBlend = 0
  /** The seat's top face over the ground under it, for the root lift. */
  private sitSeatHeight = 0
  /** Built in the constructor, so `SitController` never sees a `Player`. */
  private sitActor: SitActor | null = null
  /** Latched by the shell on the interact key, consumed on the next frame. */
  private wantsInteract = false
  /** The HUD's copy -- one struct, rewritten in place, never a `ref` (GDD §0). */
  private readonly seatSlot = { at: { x: 0, y: 0, z: 0 }, distance: 0, seated: false }
  private seatFocus: { at: { x: number; y: number; z: number }; distance: number; seated: boolean } | null = null

  readonly settings: WorldSettings = {
    outlines: true,
    shadows: true,
    wind: true,
    frustumCullInstances: true,
    hierarchical: true,
    // Off by default — measured, not assumed. It removes real geometry (5.4 % of
    // triangles, 16–43 % of instances in a valley) but bought **no GPU time** on
    // a desktop GPU even at 9× density, because the scene is not GPU-bound
    // (3.3 ms against a 16.7 ms budget) and three already sorts opaque
    // front-to-back, so most of what it culls was being early-z rejected anyway.
    //
    // Kept and left switchable because the target is a mid-range Android, where
    // tile-based GPUs handle overdraw very differently — this is the first thing
    // to re-measure on real mobile hardware.
    occlusion: false,
    adaptiveQuality: true,
    renderScale: 1,
    grassDetail: 'auto'
  }

  readonly grass: GrassField

  /** The dome, and with it the cloud uniforms every sky material shares. */
  private readonly sky: SkyMesh
  /**
   * Wind strength for the clouds. 1 is the rate `CLOUD_LAYERS` is authored at.
   *
   * A single scalar rather than a per-layer control on purpose: the layers'
   * *relative* speeds are the thing that makes the sky read as weather, and a
   * caller that could set them independently could flatten them and get one
   * sliding texture back. See `clouds.ts`.
   */
  private cloudWind = 1
  private readonly lights: LightRig
  /**
   * Sun, sky, fog and ambient over a 24-minute day.
   *
   * Public so the perf panel and a CDP probe can scrub time — a cycle you
   * have to wait twelve minutes to see the other half of is one nobody
   * checks.
   */
  readonly dayCycle: DayCycle
  /** The sun disc and the moon. Two draw calls; see `celestials.ts`. */
  private readonly celestials: Celestials
  private readonly fields: InstancedLodField[] = []
  /** Per-species scatter config, consulted by the terrain load hook. */
  private readonly scatterSpecies: ScatterSpeciesEntry[] = []
  /**
   * `scatterSpecies` in **resolution order** — biggest and most structural
   * first, so a stone gives way to a boulder and never the other way round.
   *
   * A second array of the same objects rather than a reordering of the first,
   * because `scatterSpecies`' order is a *stable identity*: it is the
   * `speciesOrdinal` stored in the collider index and read back by
   * `pickScatter`, and reordering it would repoint every scatter tombstone at
   * a different species.
   */
  private readonly scatterPlan: ScatterSpeciesEntry[] = []
  /** One output list per plan slot. Reused every chunk load — see GDD §5.2. */
  private readonly scatterBatch: InstanceTransform[][] = []
  /**
   * Editor deletions applied on top of the procedural scatter.
   *
   * Public so the editor and the export can reach it. See
   * `level/scatterOverrides.ts` for why the world is not simply converted into
   * placements instead.
   */
  readonly scatterOverrides = ScatterOverrides.restore()
  /**
   * The prop layout this world booted from: the starting level plus whatever
   * `worldPatch.generated.ts` ships.
   *
   * This is what a delta export diffs against, so it must be *what was seeded*
   * and not a fresh evaluation of the same tables — a terrain seed change
   * between two boots would otherwise re-resolve every Y and report the whole
   * level as moved.
   */
  readonly levelBaseline: PlacementLike[]
  /**
   * Collision for scattered props.
   *
   * Hand-placed props collide through the placement path; scatter cannot —
   * there are tens of thousands of instances and the player can only touch
   * the few within arm's reach. See `scatterColliders.ts`.
   */
  private readonly scatterColliders: ScatterColliderIndex
  /**
   * How many bodies of water the world currently knows about.
   *
   * Held so `setWaterPlanes` can tell "nothing changed" from "the layout is now
   * empty" and skip a world-wide rebuild for the first.
   */
  private waterBodyCount = 0
  /**
   * The shore query, bound to the terrain seed, allocated once.
   *
   * The seed has to match the one the terrain paint and the grass use or their
   * jitter is a different wander and the three boundaries separate.
   */
  private readonly shoreAbove = (x: number, z: number, height: number): number =>
    shoreHeightAbove(x, z, height, this.terrain.field.params.seed)
  /** Water-editor revision the scatter was last generated against. */
  private lastWaterRevision = -1
  /** Countdown, in ms, before an edited water layout is pushed into scatter. */
  private waterSettleMs = 0
  /**
   * The sample characters. Public so a CDP probe can drive a one-shot clip at a
   * chosen moment — a jump lasts under a second, and waiting for one to happen
   * to line up with a screenshot is not a review process.
   */
  readonly characters: Character[] = []
  private readonly characterGroup = new Group()
  /** Demo locomotion for the sample characters — see the note where they are built. */
  private readonly characterPaths: {
    centreX: number
    centreZ: number
    radius: number
    angle: number
    speed: number
    jumpAt: number
  }[] = []
  private characterClock = 0
  private readonly assets: WorldAsset[] = []
  private rafId: number | null = null
  private lastTime = 0
  private width = 1
  private height = 1
  private running = false

  private cameraMode: CameraMode = 'orbit'

  /** See `WorldOptions.mode`. Fixed at construction. */
  readonly mode: WorldMode

  /**
   * Story mode's placement list and its revision.
   *
   * Plain fields rather than the editor's store, and never persisted. The
   * revision is bumped by `setStoryPlacements` so `syncPlacementBatch` and
   * `syncColliders` can use exactly the same "has it changed" test they use for
   * an edited level -- which is what keeps both modes on one code path.
   */
  private storyPlacements: Placement[] = []
  private storyAuthored: Placement[] = []
  private storyRevision = 0

  /**
   * Per-frame hook, run after the player/camera step and before the LOD passes.
   *
   * One hook, not an event bus: the story is the only thing that has ever needed
   * one, it needs to run at exactly one point in a frame whose order is load-
   * bearing (see the class notes), and a bus would make that point negotiable.
   */
  onUpdate: ((dt: number) => void) | null = null

  /**
   * Fired once, on the frame the placeable catalogue finishes draining.
   *
   * The catalogue is generated a slice at a time *after* the first frame is on
   * screen, so anything that has to ask it a question — "how big is a cottage's
   * collider" — cannot ask at construction. The story uses this to derive its
   * building footprints and hand them to the scatter and the grass; without it
   * every one of those queries returns `undefined` and the exclusion list comes
   * out empty, silently.
   */
  onPlaceablesReady: (() => void) | null = null

  /**
   * Re-arms the procedural scatter with a new set of keep-out circles.
   *
   * Refreshes every live chunk, because the zones only take effect where
   * scatter is *generated* — the chunks already standing when this is called
   * still have their trees, and a village with three oaks left in it is a
   * village with three oaks in it. `refreshAllScatter` regenerates the instance
   * lists in place without touching the terrain meshes, so nothing blinks.
   */
  setScatterClearZones(zones: readonly { x: number; z: number; radius: number }[]): void {
    for (const entry of this.scatterSpecies) {
      entry.options = { ...entry.options, clearZones: zones }
    }
    this.refreshAllScatter()
  }

  /**
   * Tells the world where the water is.
   *
   * ── Why the engine has to be told at all ────────────────────────────────
   *
   * `ScatterOptions.minHeight` used to keep props out of the water, as a single
   * world constant. That works while there is one body of water at one height
   * and stops working the moment there are two: the chapter's sea sits at
   * y = 2.0 round the storyteller's island and the Arla runs from y = 1.7 down
   * to y = −1.7 seventeen hundred metres away, so any one number is either above
   * the river (a bare valley) or below the sea — a forest growing out of it, out
   * to the horizon, which is what shipped.
   *
   * ── One table, three consumers ──────────────────────────────────────────
   *
   * The rectangles go to `Terrain.setWaterBodies`, which is the engine's water
   * table (`terrain/waterLevel.ts`): the terrain paint reads it for sand, the
   * grass placer reads it for the bald band at the waterline, and the scatter
   * reads it here for the treeline. All three go through `shoreHeightAbove`,
   * jitter included, so the beach, the meadow's edge and the treeline are the
   * *same* wandering boundary rather than three that nearly agree.
   *
   * This is the narrow seam the chapter reaches the engine through — it takes
   * `WaterPlacement`s rather than reaching for them, because the **sandbox**
   * keeps its water in the water editor's persisted store and polls it (see
   * `syncWater`) while the **chapter** builds two bodies of its own and never
   * persists anything, and `src/world/` may not import `src/world/story/` to
   * find that out.
   *
   * Everything already built is regenerated — terrain chunks by
   * `setWaterBodies`, grass by the explicit `rebuild` it asks the field's owner
   * for, scatter by `refreshAllScatter`. Without it the ring of world the player
   * is standing in keeps its trees in the sea until they walk far enough to
   * unload it.
   */
  setWaterPlanes(bodies: readonly WaterPlacement[]): void {
    const rects = waterBodiesOf(bodies)
    const had = this.waterBodyCount > 0
    if (!had && rects.length === 0) {
      // Nothing to say and nothing said before. Worth the compare: the sandbox
      // polls this every time the water editor's revision settles, and a fresh
      // install has no water at all.
      return
    }
    this.waterBodyCount = rects.length

    this.terrain.setWaterBodies(rects)
    // `Terrain` rebuilds its own chunks and cannot rebuild the grass — the field
    // belongs to this class. Same call the story's footprint pass makes.
    this.grass.rebuild()

    const shoreAbove = rects.length > 0 ? this.shoreAbove : undefined
    for (const entry of this.scatterSpecies) {
      entry.options = { ...entry.options, shoreAbove }
    }
    this.refreshAllScatter()
  }

  /**
   * Per-placeable generation cost, worst first.
   *
   * Re-exported off the world rather than imported directly by whoever wants it,
   * because a `import('…/assets')` from a probe or a lazily-loaded panel gets a
   * *second* module instance under Vite and reads an empty array — the same trap
   * that once had a probe reporting zero placed props while thirteen were on
   * screen. Everything reads the world's copy, which is the app's.
   */
  get assetBuildCosts(): readonly { id: string; ms: number }[] {
    return placeableBuildTimes
  }

  /** Cumulative vertex-AO bake cost, for attributing catalogue build time. */
  get assetAoStats(): { ms: number; bakes: number; rayTriangleTests: number } {
    return aoStats
  }

  /** Shader precompile guard — see `warmUp`. */
  private warmedUp = false
  /** True only while `warmUp` is driving `frame()` into a 1×1 buffer. */
  private warming = false

  /** Deferred placeable generation — see the note in the constructor. */
  private placeablesPending = true
  private placeableMs = 0
  private placeableFrames = 0
  private framesRendered = 0

  /**
   * Placements the player collides with, refreshed only when the editor's
   * revision counter moves.
   *
   * `levelPlacements()` allocates and sorts, so polling it per frame would
   * violate the zero-per-frame-allocation rule (GDD §5.2). The revision compare
   * is one integer. The array identity is also deliberately stable between
   * changes — the player rebuilds its collider pool when the identity changes,
   * so handing it a fresh array every frame would defeat its cache too.
   */
  private cachedPlacements: Placement[] = []
  private lastLevelRevision = -1

  /**
   * Draws hand-placed props as instances while the editor is closed.
   *
   * The editor's one-node-per-placement layout is what makes props pickable and
   * costs a draw call each — measured at 86 of 304 draws for a 40-prop level,
   * past the whole-frame budget on its own. Batching is a straight swap: the
   * editor's nodes stop drawing, the batch draws the same props in a handful of
   * instanced calls. It rebuilds on an editor toggle, never on an edit.
   */
  readonly quality: AdaptiveQuality
  private readonly occlusion: TerrainOcclusion
  private readonly batcher = new PlacementBatcher()
  private batchedRevision = -1
  private lastEditorMode = false

  constructor(canvas: HTMLCanvasElement, options: WorldOptions = {}) {
    const {
      seed = 1337,
      worldSize = 384,
      densityScale = 1,
      instanceGear = true,
      crowdBudget,
      mode = 'sandbox'
    } = options
    const story = mode === 'story'
    this.mode = mode
    const phases: { name: string; ms: number }[] = []
    let phaseMark = performance.now()
    const phase = (name: string): void => {
      const now = performance.now()
      phases.push({ name, ms: Math.round((now - phaseMark) * 10) / 10 })
      phaseMark = now
    }
    // Spacing is a distance, so dividing it by the scale squares the count.
    const spacingOf = (base: number): number => base / densityScale
    const buildStart = performance.now()

    this.renderer = createRenderer({ canvas })
    this.camera = new PerspectiveCamera(55, 1, 0.5, 1200)
    this.controller = new OrbitCameraController(this.camera)
    this.profiler = new Profiler(this.renderer)

    // Held, not just added: the dome has to follow the camera. It is a finite
    // sphere, so with a streamed (unbounded) world the player eventually walks
    // out through it and the horizon renders as black wedges — which is exactly
    // what happened at 1 km once terrain stopped being bounded.
    this.sky = createSky()
    this.scene.add(this.sky)

    this.lights = createLightRig(this.scene, {
      camera: this.camera,
      ...(options.shadowCascades ? { cascades: options.shadowCascades } : {}),
      ...(options.shadowMaxFar ? { shadowMaxFar: options.shadowMaxFar } : {})
    })
    // ── Day / night ────────────────────────────────────────────────────────
    //
    // After the light rig, which owns three of the four things it drives, and
    // after the sky, which owns the fourth. Everything it touches is a uniform
    // or a light property, so a full cycle costs a dozen float writes per frame
    // and rebuilds nothing — see `dayCycle.ts`.
    this.dayCycle = new DayCycle(
      {
        cascades: this.lights.cascades,
        fill: this.lights.fill,
        fog: this.scene.fog as FogExp2,
        sky: this.sky
      },
      { startTime: options.startTime }
    )

    // ── The two bodies ──────────────────────────────────────────────────────
    //
    // Hung under the dome rather than added to the scene, so they inherit the
    // re-centring the dome already does every frame (see the `sky.position`
    // write in `frame`) and stay a fixed distance from the viewer for free.
    // Registered with the profiler in the same breath, or their cost lands in
    // nobody's column — `sky` is the tag next door and it is not registered,
    // which is exactly the hole this rule exists to stop widening.
    this.celestials = new Celestials(this.sky.clouds)
    this.sky.add(this.celestials.group)
    this.profiler.registerRoot(this.celestials.group, 'celestials')

    // ── A chapter does not have a day cycle ─────────────────────────────────
    //
    // The sandbox does: Meadowfall is a place you wander, and watching the
    // light move across it is half of what it is for. A *chapter* is a scene
    // with a stated time of day — Chapter 1's own `startTime` comment reasons
    // carefully about the sun being "high enough to light a forest floor", and
    // `script.ts` has the party setting the trap in the morning and hours out
    // by the time it springs.
    //
    // `dayLength` is 1440 s, so the sky runs a full day every 24 real minutes.
    // Measured in the browser: 45 minutes into a session the chapter had rolled
    // from mid-afternoon (0.58) to 0.84 — well past sunset, the cast reduced to
    // silhouettes and the two directional lights down to `moonIntensity`. The
    // afternoon the script describes had become night, on the clock, while the
    // player was still setting the trap.
    if (story) {
      this.dayCycle.timeScale = 0
    }

    phase('renderer+lights')

    // Story mode may reshape the terrain and *must* be able to: a village needs
    // gentler ground than a hero landscape. The sculpt is attached here and
    // broadcast to the chunk workers below -- see `story/terrain.ts` on why both
    // are required and why a story-specific height function is not an option.
    const field = new Heightfield({ seed, ...(options.heightfield ?? {}) })
    if (options.sculpt) {
      field.params.delta = options.sculpt
    }
    // `size` is deliberately NOT passed: with scatter streaming per chunk there
    // is nothing left that assumes a bounded world, so the terrain is infinite.
    // The starting level still sits near the origin; it just no longer defines
    // the edge of everything.
    // ── How far the *detailed* terrain has to reach ───────────────────────
    //
    // Chunk count goes as the square of this, and every visible chunk is a draw
    // call in a frame that is CPU-bound on draw submission. Since the distant
    // ring (`DistantTerrain`) now draws everything past its hole for one call,
    // this only has to cover the range where 29 m cells would read as coarse.
    const loadRadius = options.loadRadius ?? DEFAULT_LOAD_RADIUS
    this.terrain = new Terrain(field, { chunkSize: 48, loadRadius })
    // Before any chunk is built. `setSculptDelta` is how the *workers* learn the
    // shaping -- the main thread already has it via `field.params.delta` -- and
    // a chunk built before the patch lands is a chunk of unshaped ground the
    // player can see and walk on until it happens to stream out.
    if (options.sculpt) {
      this.terrain.setSculptDelta(options.sculpt.fullPatch())
    }
    this.scene.add(this.terrain.group)
    this.profiler.registerRoot(this.terrain.group, 'terrain')
    phase('terrain')

    // ── Scatter ────────────────────────────────────────────────────────────
    //
    // Fields are empty shells: instances arrive per chunk from the terrain
    // streamer's load hook, so the world is unbounded and only what's nearby is
    // resident.
    //
    // ── What a species costs, and why the list is the length it is ─────────
    //
    // One `InstancedLodField` per species, and a field submits up to **10 draw
    // calls** in a wide view: four tier meshes, two outline hulls (GDD R6 —
    // LOD0 and LOD1 only), and two shadow-casting tiers into each of the two
    // cascades. Against §5.2's ceiling of 180 for the whole frame that is the
    // single most expensive decision in this constructor, and it is paid whether
    // or not the species is visible in *this* chunk — the only relief is that a
    // tier with no resident instances hides itself, so a genuinely rare, tightly
    // clustered species costs nothing in the views it is absent from. That is
    // what `clusterThreshold` is doing on the rarer rows below, and it is why
    // the understorey is one field with three *forms* rather than three fields.
    //
    // ── Three seeds of one tree is wallpaper ───────────────────────────────
    //
    // This list used to be three seeds of `createTreeAsset` plus two boulders
    // and two stones, and it read exactly as it was: one tree stamped across the
    // world. A seed moves the lumps and the clump bearings; it does not move the
    // canopy's mass distribution or the trunk's lean, and past ~40 m those are
    // the only two things left (`characters/equipment.ts`: "silhouette is the
    // only thing that survives 20 m"). So the canopy is now five species chosen
    // for *silhouette spread* — a wide low dome, a narrow warm column, a
    // wind-shaped lean, a grove birch and a conifer — and the wood underneath
    // them has dead wood, cut stumps and a layer below four metres, without
    // which a stand of trees reads as a park.
    //
    // ── What it cost, counted rather than guessed ──────────────────────────
    //
    // 7 fields → 12. Draw calls counted deterministically from the real
    // heightfield: every chunk inside the 190 m load radius scattered, every
    // instance classified through `lod/config.ts::coverageAt`, a tier counted
    // when it holds at least one instance. The browser's own counter was not
    // available for this change, and the ablation profiler has a floor that
    // makes a 4-draw difference unmeasurable anyway (`AAA-graphics.md` §10).
    //
    // | camera                    | before | after | Δ |
    // |---|---:|---:|---:|
    // | sandbox spawn (0, 0)      | 53 | 87 | +34 |
    // | sandbox mid-world         | 57 | 95 | +38 |
    // | sandbox far (1.9 km out)  | 62 | 98 | +36 |
    // | story, village centre     | 29 | 49 | +20 |
    // | story, just outside the palisade | 49 | 95 | +46 |
    //
    // Resident scatter instances go 2 029 → 3 715, of which 874 are the
    // understorey. Instances are the cheaper half: the frame is CPU-bound on
    // *draw submission* (20 ms of 26.4 measured), not on the instance loop.
    //
    // **The story scene is the tight one** and it is worth saying out loud: it
    // measured 161 draws with an empty crowd against §5.2's ≤180, so the wood
    // outside the palisade now costs most of what is left. The cheapest ten to
    // reclaim if a device needs them are `stone1` — 452 resident instances of a
    // 0.36 m pebble, a prop the new understorey largely hides — and after that
    // `shadowMaxTier: 0` on `stone0`, which is worth another two.
    const species: {
      asset: WorldAsset
      tag: string
      /**
       * Stable identity for the override layer.
       *
       * Half of a scatter tombstone's key, so it must not change when a species
       * is reordered or a seed is tuned — otherwise every deletion in every
       * save silently re-grows a tree somewhere else.
       */
      id: string
      scatter: ScatterOptions
      /** Omit for props small enough to walk over. */
      collide?: ScatterColliderSpec
      /**
       * Ground-level solid radius at unit scale, in metres, for the
       * cross-species rejection pass (`scatter.ts::scatterChunkSet`).
       *
       * **Read that header before changing one.** It is not the render bounding
       * radius (a canopy, which may overlap another canopy — that is a grove)
       * and it is not quite `collide.radius` either: a collider is sized for
       * *blocking*, which is the stem, whereas this is what the prop occupies
       * where another prop would stand in it. They coincide for a trunk and
       * diverge for anything whose foliage reaches the floor.
       */
      footprint: number
      /**
       * Resolution rank, lower first. Ties are broken by declaration order.
       *
       * Structure before clutter: a boulder is a landmark and there are 60 of
       * them inside the load radius, a stone is rubble and there are 452, so
       * the boulder wins and the loss is invisible. The alternative — sorting
       * purely by footprint — would put the understorey ahead of the canopy and
       * punch bush-shaped holes in the wood.
       */
      rank: number
      /**
       * Catalogue entry the editor places when this species is *moved*.
       *
       * Moving a scattered prop is a tombstone plus an ordinary placement, and
       * a placement needs a catalogue `defId`. This is the closest authored
       * equivalent of the scattered variant.
       */
      editorDefId?: string
      /**
       * Field construction options, for the species that should not pay the
       * default two shadow-casting tiers.
       *
       * `shadowMaxTier` defaults to 1, so LOD0 *and* LOD1 cast — and a tier
       * casts into **each** shadow cascade, which makes the shadow pass four of
       * the ten draw calls a field submits. That is the right default for a
       * tree, whose LOD1 spans 36–90 m and whose mid-distance shade is most of
       * what makes a wood look like a wood. It is the wrong one for a 0.74 m
       * stump, whose LOD1 spans 29–70 m: the shadow there is under a pixel, and
       * two of the frame's scarcest resource are buying it.
       */
      fieldOptions?: InstancedLodFieldOptions
    }[] = []

    // ── The canopy: five silhouettes ───────────────────────────────────────
    //
    // A wide low dome, a narrow warm column, a wind-shaped lean, a grove birch
    // and a conifer. Five rather than six on purpose — see the note where the
    // sixth would have gone.
    //
    // `spacing` is a *distance*, so instance count goes as its inverse square —
    // halving it quadruples the trees. Summed over the five rows the tree grid is
    // **1.6× denser** than the three rows it replaces (Σ 1/s² = 0.0289 against
    // 0.0186 per m²), and counted against the real heightfield inside the 190 m
    // load radius that lands at **736 → 1 216 resident trees**, mean 13.1 per
    // 48 m chunk for the dominant oak against the old 6.7. The stands are
    // tighter than even that suggests
    // because `clusterSize` went up while `clusterThreshold` came down: bigger
    // features means bigger *woods* and bigger clearings, which is what makes a
    // treeline read as authored rather than as a sprinkle.
    //
    // `id` is half of a scatter tombstone's key, so `tree0`–`tree2` keep their
    // names even though the shape behind each has changed. Renaming them would
    // re-grow every tree anybody has ever deleted from a saved level; changing
    // the geometry under a stable id only changes what stands there.
    //
    // The colliders are the **trunk**, never the canopy — `asset.radius` is the
    // foliage and using it would ring every tree with a two-metre invisible
    // wall. Height stops at the split, which is why the broad oak's is 1.9 m and
    // the crown's is 4.4: the player walks *under* a broad oak's canopy.
    species.push(
      {
        // The dominant tree, and the one that defines where a wood is.
        asset: createTreeAsset({ seed: 211, form: 'oakBroad' }),
        tag: 'trees',
        id: 'tree0',
        editorDefId: 'tree-oak-broad',
        collide: { radius: 0.42, height: 1.9 },
        // Trunk 0.42 plus the root flare the generator sweeps out at the base.
        // The canopy is 1.9 m up and reaches ~3 m: props stand under it, which
        // is what a broad oak in a meadow looks like.
        footprint: 0.45,
        rank: 10,
        scatter: {
          spacing: spacingOf(10),
          seed: 300,
          maxSlope: 0.34,
          clusterSize: 130,
          clusterThreshold: 0.42,
          scaleRange: [0.82, 1.3],
          clearRadius: 16
        }
      },
      {
        asset: createTreeAsset({ seed: 223, form: 'oakTall' }),
        tag: 'trees',
        id: 'tree1',
        editorDefId: 'tree-oak-tall',
        collide: { radius: 0.3, height: 4 },
        footprint: 0.34,
        rank: 11,
        scatter: {
          spacing: spacingOf(13),
          seed: 397,
          maxSlope: 0.34,
          clusterSize: 130,
          clusterThreshold: 0.44,
          scaleRange: [0.85, 1.2],
          clearRadius: 16
        }
      },
      {
        // Rarest of the oaks on purpose: a wind-shaped tree is a strong,
        // asymmetric silhouette, and a wood where every tree leans reads as a
        // bug in the placement rather than as weather. The high threshold is
        // also what keeps its field out of most views entirely.
        asset: createTreeAsset({ seed: 281, form: 'oakLean' }),
        tag: 'trees',
        id: 'tree2',
        editorDefId: 'tree-oak-lean',
        collide: { radius: 0.35, height: 3.2 },
        // A leaning trunk meets the ground as an ellipse, so a touch wider than
        // the collider's circumscribed stem.
        footprint: 0.42,
        rank: 12,
        scatter: {
          spacing: spacingOf(18),
          seed: 494,
          maxSlope: 0.32,
          clusterSize: 150,
          clusterThreshold: 0.5,
          scaleRange: [0.8, 1.25],
          clearRadius: 16
        }
      },
      // `crown` — the catalogue's other broadleaf — is deliberately **not** a
      // sixth field, and the measurement is why. Once `oakTall` took the warm
      // foliage set the two are near-duplicates: 2.86 × 8.44 × 2.23 m against
      // 3.44 × 6.81 × 2.83 m, both narrow verticals split above 70 %, both warm,
      // both four clumps. That is a second ten draw calls for a silhouette the
      // eye cannot separate from the first at any distance the pair is seen
      // together. It stays in the catalogue (`tree-crown`) for hand placement,
      // where one of it next to one of something else is a different question.
      {
        // Birch grows in tight groves rather than spread through a wood, which
        // is what the small `clusterSize` says: a 64 m feature against the oak's
        // 130 puts a stand of pale trunks inside a broadleaf wood rather than
        // mixing one birch into every clearing.
        asset: createBirchAsset({ seed: 307 }),
        tag: 'birches',
        id: 'birch0',
        editorDefId: 'tree-birch',
        // Circumscribed across *both* stems: a birch is two trunks, and a
        // collider sized to one lets the player stand inside the other.
        collide: { radius: 0.34, height: 2.4 },
        // Across both stems, as the collider is.
        footprint: 0.4,
        rank: 13,
        scatter: {
          spacing: spacingOf(15),
          seed: 688,
          maxSlope: 0.3,
          clusterSize: 64,
          clusterThreshold: 0.5,
          scaleRange: [0.8, 1.3],
          clearRadius: 16
        }
      },
      {
        // The conifer, and the only species here allowed on genuinely steep
        // ground: `maxSlope` 0.46 against the broadleaves' 0.32–0.34 puts pine
        // on the valley sides the oaks refuse, which is what makes the treeline
        // follow the terrain instead of stopping at a contour.
        asset: createPineAsset({ seed: 311, form: 'spruce' }),
        tag: 'pines',
        id: 'pine0',
        editorDefId: 'tree-pine',
        collide: { radius: 0.3, height: 3 },
        // **Not** the collider's 0.3 m stem. A spruce carries its lowest whorl
        // to the floor, so anything inside that skirt is invisible — this is
        // the one species where "hidden by a canopy at ground level" is the
        // failure the brief names, and 0.85 m is where the bottom branches end.
        footprint: 0.85,
        rank: 9,
        scatter: {
          spacing: spacingOf(15),
          seed: 785,
          maxSlope: 0.46,
          clusterSize: 150,
          clusterThreshold: 0.5,
          scaleRange: [0.75, 1.35],
          clearRadius: 16
        }
      }
    )

    // ── Dead wood and the understorey ──────────────────────────────────────
    //
    // Three fields, and each earns its ten draw calls differently.
    //
    // The **snag** breaks the canopy line, which is the thing that makes a
    // procedural wood read as procedural: every other tree here puts its mass
    // between 3 m and 9 m, so a stand is a continuous band of foliage over a
    // continuous band of shadow, and no amount of reseeding changes that. A bare
    // vertical bar through the band costs 90 triangles.
    //
    // The **stump** is the only prop in the world that says a person has been
    // here. Sparse and strongly clustered (`clusterSize` 170, threshold 0.52) so
    // it arrives as a felled patch rather than as one stump every thirty metres,
    // which would read as decoration instead of as work.
    //
    // The **thicket** is the layer under four metres, and it is one field
    // carrying three forms for the reason in `assets/shrub.ts`: a bush and a
    // young tree out of one generator is one field instead of two, and two
    // fields is 20 draw calls for the cheapest layer in the wood. Tight spacing,
    // low threshold, small cluster feature — dense inside a patch, absent
    // between patches.
    species.push(
      {
        asset: createDeadTreeAsset({ seed: 313 }),
        tag: 'deadwood',
        id: 'dead0',
        editorDefId: 'tree-dead',
        collide: { radius: 0.26, height: 2.4 },
        footprint: 0.3,
        rank: 20,
        scatter: {
          spacing: spacingOf(28),
          seed: 862,
          maxSlope: 0.34,
          clusterSize: 130,
          clusterThreshold: 0.47,
          scaleRange: [0.8, 1.25],
          clearRadius: 16
        }
      },
      {
        asset: createStumpAsset({ seed: 317 }),
        tag: 'stumps',
        id: 'stump0',
        editorDefId: 'tree-stump',
        collide: { radius: 0.36, height: 0.74 },
        // A cut stump is a disc: the collider radius is the whole prop.
        footprint: 0.4,
        rank: 21,
        // LOD0 only. This prop's LOD1 runs 29–70 m, where a 0.74 m stump's
        // shadow is under a pixel and costs one draw call *per cascade*.
        fieldOptions: { shadowMaxTier: 0 },
        scatter: {
          spacing: spacingOf(26),
          seed: 941,
          maxSlope: 0.36,
          clusterSize: 170,
          clusterThreshold: 0.52,
          sink: 0.06,
          scaleRange: [0.75, 1.35],
          clearRadius: 12
        }
      },
      {
        asset: createShrubAsset({ seed: 331, form: 'thicket' }),
        tag: 'undergrowth',
        id: 'shrub0',
        editorDefId: 'thicket',
        // No collider. A bush is foliage the player pushes through; blocking on
        // it is what makes a world feel like it is made of glue — the same call
        // `rock-stone` makes for ankle-high rubble.
        //
        // LOD0 only for shadows, as the stump: a 1.9 m thicket's LOD1 runs
        // 34–83 m, and this is the densest field in the world, so the two
        // cascade draws it saves are the cheapest two in the frame.
        fieldOptions: { shadowMaxTier: 0 },
        // No collider to derive this from — a thicket is walked through — but it
        // is dense to the ground and swallows a stone whole, so it excludes on
        // its own visual mass rather than on nothing.
        footprint: 0.6,
        rank: 30,
        scatter: {
          spacing: spacingOf(7),
          seed: 1039,
          maxSlope: 0.42,
          clusterSize: 46,
          clusterThreshold: 0.46,
          sink: 0.08,
          scaleRange: [0.6, 1.4],
          clearRadius: 12
        }
      }
    )

    for (const [i, seed] of [23, 61].entries()) {
      species.push({
        asset: createBoulderAsset({ seed }),
        tag: 'boulders',
        id: `boulder${i}`,
        editorDefId: 'rock-boulder',
        // Waist-high and wide: these block rather than trip.
        collide: { radius: 0.85, height: 1.1 },
        // A little past the blocking radius, which is the widest *walkable*
        // circle rather than the widest part of the rock.
        footprint: 0.95,
        // First of everything. A boulder is a landmark and there are ~60 inside
        // the load radius against 452 stones; thinning the rubble around one
        // costs nothing anybody can see.
        rank: 0,
        scatter: {
          spacing: spacingOf(26 + i * 7),
          seed: 700 + i * 131,
          maxSlope: 0.5,
          clusterSize: 140,
          clusterThreshold: 0.42,
          sink: 0.28,
          scaleRange: [0.7, 1.5],
          clearRadius: 10
        }
      })
    }

    for (const [i, seed] of [5, 91].entries()) {
      species.push({
        asset: createStoneAsset({ seed }),
        tag: 'stones',
        id: `stone${i}`,
        editorDefId: 'rock-stone',
        // Deliberately shorter than the player's step height, so a stone is
        // stepped over rather than walked into. Blocking on ankle-high rubble
        // is what makes a world feel like it is made of glue.
        collide: { radius: 0.4, height: 0.28 },
        footprint: 0.42,
        // Last. Rubble fills whatever the rest of the world has left.
        rank: 40,
        // ── No shadow past LOD0 ────────────────────────────────────────────
        //
        // These are ankle-high rubble: 0.36 m at scale 1, and the densest
        // species in the world at 7 m spacing (452 instances resident inside
        // the load radius). Their LOD1 band starts around 20 m, where the
        // shadow of a stone that size is roughly a pixel — and it costs **one
        // draw per cascade**, twice over.
        //
        // Added when the new forest species took the story scene from 161 to
        // 197 draws against GDD §5.2's ceiling of 180. This is the cheapest ten
        // of that back, and it is invisible: the shadow the eye actually reads
        // off a stone is the contact shadow directly under it, which LOD0 still
        // casts out to 20 m.
        fieldOptions: { shadowMaxTier: 0 },
        scatter: {
          spacing: spacingOf(7 + i * 3),
          seed: 900 + i * 173,
          maxSlope: 0.55,
          clusterSize: 60,
          clusterThreshold: 0.44,
          sink: 0.1,
          scaleRange: [0.6, 1.4]
        }
      })
    }

    // One floor under every species' own clear radius. Applied here rather than
    // at each declaration so a new species cannot forget it and grow an oak
    // through the smithy.
    if (options.scatterClearRadius !== undefined || options.scatterClearZones !== undefined) {
      for (const entry of species) {
        entry.scatter = {
          ...entry.scatter,
          ...(options.scatterClearRadius !== undefined
            ? { clearRadius: Math.max(entry.scatter.clearRadius ?? 0, options.scatterClearRadius) }
            : {}),
          ...(options.scatterClearZones !== undefined ? { clearZones: options.scatterClearZones } : {})
        }
      }
    }

    phase('scatter assets')

    const chunkSize = this.terrain.size
    this.scatterColliders = new ScatterColliderIndex(chunkSize)
    // Slots must cover every chunk that can be resident at once — the *unload*
    // radius, not the load radius, since a chunk lingers past the load boundary
    // by design. Over-reserving costs a few hundred KB; running out drops
    // scatter silently in the middle of a traversal.
    const residentChunks = Math.ceil((Math.PI * (loadRadius * 1.25) ** 2) / (chunkSize * chunkSize)) + 8

    for (const entry of species) {
      const capacity = residentChunks * maxInstancesPerChunk(entry.scatter.spacing, chunkSize)
      const scatter = new InstancedLodField(entry.asset, capacity, entry.fieldOptions)
      this.registerField(entry.asset, scatter, entry.tag)
      this.scatterSpecies.push({
        field: scatter,
        options: entry.scatter,
        collide: entry.collide,
        id: entry.id,
        editorDefId: entry.editorDefId,
        footprint: entry.footprint,
        ordinal: this.scatterSpecies.length
      })
    }

    // ── The order the placement pass resolves species in ────────────────────
    //
    // Built once, from `rank`, and stable within a rank so the declaration order
    // breaks ties (the two boulders, the two stones). `scatterSpecies` itself is
    // never reordered: its indices are the `speciesOrdinal` the collider index
    // stores and `pickScatter` reads back, so shuffling it would repoint every
    // tombstone at the wrong species.
    const rankOf = new Map(species.map((entry, i) => [i, entry.rank]))
    this.scatterPlan.push(...this.scatterSpecies)
    this.scatterPlan.sort((a, b) => (rankOf.get(a.ordinal) ?? 0) - (rankOf.get(b.ordinal) ?? 0))
    for (let i = 0; i < this.scatterPlan.length; i++) {
      this.scatterBatch.push([])
    }

    // ── Grass ──────────────────────────────────────────────────────────────
    //
    // Not a scatter species. `InstancedLodField` is built around one instance
    // per *object* with a 64-byte matrix, which is the right shape for a tree
    // and hopeless for a blade — the near field alone is ~25 000 of them. Grass
    // instances a whole 4 m patch instead and builds its blades in the vertex
    // shader, so the same meadow is ~900 instances of 48 bytes and six draws.
    // See `grass/GrassField.ts`.
    //
    // The palette crosses into placement as a flat linear-RGB array for exactly
    // the reason the terrain worker gets one: `grassPlacement.ts` is three-free
    // so it can move onto a worker, and `THREE.Color` is what performs the
    // sRGB → linear conversion the rest of the world's colours went through.
    const grassPalette = new Float32Array(TERRAIN_PALETTE_SLOTS.length * 3)
    TERRAIN_PALETTE_SLOTS.forEach((slot, i) => {
      const color = C[slot]
      grassPalette[i * 3] = color.r
      grassPalette[i * 3 + 1] = color.g
      grassPalette[i * 3 + 2] = color.b
    })
    setGrassPalette(grassPalette)

    this.grass = new GrassField({ params: field.params, chunkSize })
    this.scene.add(this.grass.group)
    this.profiler.registerRoot(this.grass.group, 'grass')
    // Its own phase: this is six baked patch geometries plus their instance
    // buffers, and boot phases are the only place this project has ever managed
    // to attribute a stall correctly on the first try (AAA-graphics §11d).
    phase('grass')

    // Scatter rides the terrain's residency decisions rather than running its
    // own — two systems deciding independently what is loaded eventually
    // disagree, and the failure mode is a tree standing on a chunk that no
    // longer exists.
    this.terrain.onChunkLoad = (key, originX, originZ, size) => {
      this.fillChunkScatter(field, key, originX, originZ, size)
      // Grass only *notes* the chunk. Its own residency radius is narrower than
      // the terrain's — 140 m against 190 m, and 56 m at `minimum` — so building
      // patches here would generate up to five times as many as can ever be
      // drawn, on the frame a chunk lands.
      this.grass.noteChunk(key, originX, originZ)
    }
    this.terrain.onChunkUnload = key => {
      for (const entry of this.scatterSpecies) {
        entry.field.removeCell(key)
      }
      // Chunk keys are `cx_cz` (`Terrain.instantiate`). Parsed rather than
      // tracked in a side map: this runs a handful of times a second at most,
      // and a second map that has to be kept in step with residency is exactly
      // the kind of thing that drifts and leaves colliders behind.
      const split = key.indexOf('_')
      if (split > 0) {
        this.scatterColliders.remove(Number(key.slice(0, split)), Number(key.slice(split + 1)))
      }
      this.grass.dropChunk(key)
    }
    phase('scatter fields')

    // ── Camera ─────────────────────────────────────────────────────────────
    this.controller.setGroundSampler((x, z) => field.heightAt(x, z))
    // Start off the origin and looking across the valley rather than down at the
    // spawn flat — the opening frame should show the terrain doing something.
    this.controller.setFocus(-38, field.heightAt(-38, 26) + 2.2, 26)
    if (story) {
      // The orbit rig is left attached but never updated (see `CameraMode`), so
      // this only decides where the shadow cascades sit on the very first frame,
      // before the story has told the camera anything.
      this.controller.setFocus(0, field.heightAt(0, 0) + 2, 0)
    }

    // ── Player ─────────────────────────────────────────────────────────────
    //
    // The figure is whoever `/characters` last saved — see `roster.ts::playerLook`
    // for the three sources it falls through and why it is read once here rather
    // than watched. Read at construction, so returning from the creation screen
    // (which unmounts `WorldScene` and mounts a fresh `World`) picks the new
    // character up with no plumbing at all.
    const look = playerLook()
    if (import.meta.env.DEV) {
      console.debug(`[world] player is the ${look.source} character`)
    }
    this.player = createPlayer({
      camera: this.camera,
      heightAt: (x, z) => field.heightAt(x, z),
      spawn: { x: -38, z: 26 },
      appearance: look.appearance,
      loadout: look.loadout,
      // Orbit owns the frame on boot; first-person is opt-in.
      enabled: false
    })
    this.scene.add(this.player.object)
    this.profiler.registerRoot(this.player.object, this.player.perfTag)

    // -- The sitter, as five members ---------------------------------------
    //
    // `x`/`z` read the walker's live feet and write them through `slideTo`
    // rather than `teleport`: teleport clears the grounded flag, and this is
    // called every frame of a settle that would then re-enter the fall on every
    // one of them.
    const world = this
    this.sitActor = {
      get x(): number {
        return world.player.position.x
      },
      set x(value: number) {
        world.player.slideTo(value, world.player.position.z)
      },
      get z(): number {
        return world.player.position.z
      },
      set z(value: number) {
        world.player.slideTo(world.player.position.x, value)
      },
      get postureBlend(): number {
        return world.sitBlend
      },
      sit(seat: SeatKind): void {
        world.sitSeat = seat
        world.sitting = true
      },
      stand(): void {
        world.sitting = false
      }
    }

    // ── Characters ─────────────────────────────────────────────────────────
    //
    // Three of them, in the three locomotion states, standing where the camera
    // opens. A character is the first thing in this world that is *skinned*, and
    // skinned meshes fail silently — an outline hull that stayed in bind pose or
    // an inverse bind computed a frame early both render something, just not the
    // right thing. Having all three states on screen at once is what makes those
    // failures obvious instead of subtle.
    const characterSpots: { at: [number, number]; speed: number; radius: number; jumpAt: number }[] = [
      // The idler stands still and jumps every few seconds; the other two walk
      // and run circles, so all four animations are on screen at once.
      //
      // No state or facing is declared here. A `Character` measures its own
      // velocity and picks its gait, heading and lean from that — the demo just
      // moves it. The previous version computed a facing by hand and had the
      // formula a quarter turn out, so the characters walked sideways.
      { at: [-34.5, 24.5], speed: 0, radius: 0, jumpAt: 3.5 },
      { at: [-37.5, 23.0], speed: 1.5, radius: 3.2, jumpAt: 0 },
      { at: [-41.0, 20.5], speed: 4.5, radius: 6.0, jumpAt: 0 }
    ]
    // One container, registered once. Registering each character separately
    // would give the ablation profiler three buckets for one asset family, and
    // registering the scene itself would bill everything to `characters`.
    this.characterGroup.name = 'characters'
    this.scene.add(this.characterGroup)
    this.profiler.registerRoot(this.characterGroup, 'characters')
    // ── The three demo figures are a *sandbox* fixture ──────────────────────
    //
    // They exist so a skinned-mesh failure is obvious: an outline hull left in
    // bind pose or an inverse bind computed a frame early both render something,
    // and having all four locomotion states on screen at once is what makes
    // those visible instead of subtle. A chapter has a cast doing that job, and
    // three strangers walking in circles behind the story would be a bug report.
    for (const spot of story ? [] : characterSpots) {
      const character = new Character()
      character.setPosition(_characterAt.set(spot.at[0], field.heightAt(spot.at[0], spot.at[1]), spot.at[1]))
      character.setFacing(Math.PI * 0.15)
      this.characterGroup.add(character.group)
      this.characters.push(character)
      // Each walker gets a circle to travel. A locomotion cycle played on a
      // stationary figure always reads as moonwalking however correct the joint
      // angles are — the feet plant, the ground does not move under them, and
      // the eye reads sliding rather than striding. Judging the gait at all
      // requires the character to actually cover ground.
      this.characterPaths.push({
        centreX: spot.at[0] - spot.radius,
        centreZ: spot.at[1],
        radius: spot.radius,
        angle: 0,
        speed: spot.speed,
        jumpAt: spot.jumpAt
      })
    }
    // Stable identity between revisions — see `cachedPlacements`.
    this.player.setColliderSource(() => this.cachedPlacements)
    // ── Scattered props block, in every mode ────────────────────────────────
    //
    // The trees, boulders and stones are not `Placement`s and cannot be — see
    // `scatterColliders.ts`. This is how they reach the collision world, and it
    // is a *pull*: whoever asks for a move gets the scatter around their own
    // position. Both alternatives were tried and both were wrong. Pushing once a
    // frame around the player left the chapter with no scatter collision at all,
    // because `/story` never takes the `firstPerson` branch that did the push;
    // pushing per actor left every caller responsible for remembering to.
    //
    // The query radius is the capsule plus the furthest a clamped frame can
    // travel plus the widest prop, not anything view-shaped: a tree 30 m away is
    // not a collision candidate however visible it is.
    this.player.propCollision?.setTransientSource((x, z) => {
      this.scatterColliders.queryNear(x, z, SCATTER_COLLIDER_QUERY_RADIUS, this.player.propCollision!)
    })

    // ── Level editor ───────────────────────────────────────────────────────
    //
    // Placeables first so the palette is populated before the editor reads it.
    // The editor tolerates the other order (it retries unresolved placements on
    // its first update), but paying for that recovery path on every boot when
    // the ordering is ours to choose would be silly.
    // ── Placeables are NOT generated here ──────────────────────────────────
    //
    // Measured at 521 ms of a 660 ms boot on desktop — 77 % — and boot is
    // synchronous main-thread work, so under a 4× CPU throttle it was the
    // single longest block in the session. Nothing on screen in the first frame
    // needs it: terrain streams itself and the scatter species above are
    // generated separately.
    //
    // So it runs after the first frame is on screen instead. The starting level
    // is seeded before the catalogue exists, which the editor already handles —
    // an unresolved `defId` parks as an orphan and `rehydrateLevel()` spawns it
    // once the definition arrives. That path existed for asset-module ordering;
    // it turns out to be exactly what deferring needs.

    // Installed unconditionally **in the sandbox**: the code-word listener has to
    // be live for "cmonc" to ever be typed, and the editor itself does nothing
    // until it is.
    //
    // Story mode installs none of it, and that is not a performance decision. The
    // editor persists one level to one `localStorage` key; a chapter that shared
    // it would either inherit somebody's sandbox props or overwrite them, and
    // both are silent. The chapter carries its own placements instead
    // (`setStoryPlacements`) and they are never written anywhere.
    const levelEditor = story ? null : installLevelEditor(this)

    // ── The baseline: starting level, then the shipped patch ───────────────
    //
    // Seeded only on a fresh install (`onlyIfEmpty` is the default), so anyone
    // who has edited anything keeps their level untouched across reloads.
    //
    // The patch's placements come *after* the starting props and are part of
    // the same seed for a reason: `exportWorldPatch` diffs the live level
    // against exactly this list, so whatever is committed here is what a
    // subsequent export treats as already-shipped. Seed the two separately and
    // the patch's own contents would come back out of the next export.
    // The starting props alone, resolved against this terrain. Kept whether or
    // not the seed applies, because the export needs it on *every* boot — a
    // returning player's edits still have to be diffed against the props they
    // started from.
    //
    // Explicitly **not** including the patch's own placements. The export diffs
    // against this list, and a baseline that already contained the patch would
    // make the patch's contents compare equal and drop out of the next export —
    // which, since the export replaces the file, would erase them. See
    // `worldPatch.ts`.
    //
    // `buildStartingLevel` always writes `rotY` and `scale`, so the defaults
    // below are for the type rather than for a case that happens; if a future
    // seed omits them, `seedLevel` resolves `scale` from the catalogue and this
    // would have to as well, or every such prop would export as moved.
    this.levelBaseline = story
      ? []
      : buildStartingLevel((x, z) => field.heightAt(x, z)).map(seed => ({
          defId: seed.defId,
          x: seed.x,
          y: seed.y,
          z: seed.z,
          rotY: seed.rotY ?? 0,
          scale: seed.scale ?? 1
        }))
    // What actually goes into the world: the starting props the patch has not
    // taken away, plus the ones it adds.
    const seeded = story ? 0 : seedLevel(applyPatchToBaseline(this.levelBaseline, WORLD_PATCH))
    // Tombstones merge on *every* boot rather than only a fresh one. They are
    // purely additive — a patch that deletes a tree cannot conflict with a
    // player who deleted a different one — so there is nothing to clobber, and
    // a shipped deletion that only applied to new installs would leave the tree
    // standing for everyone who had ever opened the game before.
    this.scatterOverrides.merge({ removed: [...WORLD_PATCH.removedScatter] })

    // ── The crowd ──────────────────────────────────────────────────────────
    //
    // After the editor, because the placing tool borrows its crosshair and hangs
    // its preview under the editor's own group (see `NpcBrush`). `groundAt` is
    // the terrain's own height function rather than the spawn's stored `y`, so a
    // villager placed before the ground under them was sculpted still stands on
    // it afterwards instead of hovering or sinking.
    const crowd = installCrowd({
      editor: levelEditor ?? null,
      groundAt: (x, z) => field.heightAt(x, z),
      instanceGear,
      ...(crowdBudget !== undefined ? { budget: crowdBudget } : {})
    })
    // The shipped crowd, on a fresh install only - see `seedNpcs`. Never in a
    // chapter: its people are named, authored and driven by the story, and a
    // pooled villager standing among them would be the one figure with no lines
    // and no reason to be there.
    if (!story) {
      seedNpcs(WORLD_PATCH.npcs)
    }
    this.scene.add(crowd.group)
    // Its own tag, not `characters`: the ablation profiler exists to attribute
    // cost, and a crowd of twelve folded in with the player would make the one
    // number worth watching invisible.
    this.profiler.registerRoot(crowd.group, 'npc')

    // ── Water ──────────────────────────────────────────────────────────────
    //
    // Rides the same code word and the same lifecycle as the prop editor and
    // the sculptor: from the user's side they are one tool, and installing them
    // separately means three places that can forget to tear the others down.
    //
    // The **view factory is handed over immediately** rather than left for a
    // later call. `WaterEditor` draws its own flat proxy until it has one, which
    // is the right behaviour for a bench that has not built its generator yet
    // and the wrong one here: a world that booted with saved water would show a
    // grey rectangle where the lake is until something happened to set it.
    // The water *editor* is a sandbox tool and carries the same persisted-store
    // problem the level editor does. The chapter still gets water -- it adds the
    // Arla's mesh to the scene itself, straight from `createWaterView`, which is
    // the same factory this hands the editor.
    if (!story) {
      installWaterEditor(this)
      setWaterViewFactory(createWaterView)
    }
    // The shipped layout, on a fresh install only — the guard is inside
    // `WaterEditor.seed`, which is the only thing that knows whether this
    // browser already has water in it.
    if (!story) {
      seedWater(WORLD_PATCH.water)
    }
    phase('editor+seed')

    this.scene.add(this.batcher.group)
    this.profiler.registerRoot(this.batcher.group, 'level')

    // Terrain is the dominant occluder in a heightfield world, so horizon
    // culling tests against the height function directly rather than
    // rasterising occluders into a depth buffer.
    this.quality = new AdaptiveQuality({
      setBandScale: setLodBandScale,
      setLodQuality,
      // Routed through `applySettings` so the renderer resize and the LOD-bias
      // recompute that depend on it stay in one place.
      setRenderScale: value => {
        if (this.settings.renderScale !== value) {
          this.settings.renderScale = value
          this.setSize(this.width, this.height)
        }
      }
    })

    this.occlusion = new TerrainOcclusion((x, z) => field.heightAt(x, z))
    for (const scatter of this.fields) {
      scatter.setOcclusion(this.occlusion)
    }

    // Resolve the initial grass detail. Has to be after `this.quality` exists,
    // because the default setting is `auto` and `auto` is defined relative to it.
    this.grass.setWind(this.settings.wind)
    this.syncGrassDetail(true)

    this.buildInfo = {
      buildMs: performance.now() - buildStart,
      treeInstances: 0,
      rockInstances: 0,
      terrainChunks: this.terrain.chunks.length,
      // Filled in once the deferred generation runs.
      placeables: 0,
      seededProps: seeded,
      phases,
      firstFrameMs: [],
      firstFrameDraws: [],
      firstFrameGeometries: [],
      budgets: budgetLedger.slice()
    }
  }

  private registerField(asset: WorldAsset, scatter: InstancedLodField, tag: string): void {
    this.assets.push(asset)
    this.fields.push(scatter)
    this.scene.add(scatter.group)
    this.profiler.registerRoot(scatter.group, tag)
  }

  attach(element: HTMLElement): void {
    // Both attach. Each ignores input while the other owns the frame, so a mode
    // switch never has to re-bind listeners — and can't lose a pointer capture
    // mid-drag.
    this.controller.attach(element)
    this.player.attach(element)
  }

  // ── Editing the scattered world ───────────────────────────────────────────
  //
  // See `level/scatterOverrides.ts` for why scatter is edited through an
  // override layer rather than by turning 20 000 instances into placements.

  /**
   * Which scattered prop the editor is pointing at, if any.
   *
   * This is what makes a procedurally generated forest editable at all: scatter
   * instances have no scene node of their own to raycast, so the editor hands
   * over its aim and gets back an identity it can tombstone or replace.
   *
   * Two tests, in order, because they fail in opposite situations:
   *
   *  1. **The ray**, which is what "pointing at" actually means, and the only
   *     thing that works when you look at a tree from the ground — the terrain
   *     under that aim is metres *behind* the trunk.
   *  2. **The aim point**, for everything the ray's cylinders are too small for:
   *     looking down at a stone from above, or at a boulder whose silhouette is
   *     much wider than the trunk-sized collider it is indexed with.
   */
  pickScatter(ray: PickRay, maxDistance = 2.5): ScatterPick | null {
    const hit =
      this.scatterColliders.nearestToRay(
        ray.originX,
        ray.originY,
        ray.originZ,
        ray.dirX,
        ray.dirY,
        ray.dirZ,
        ray.maxDistance
      ) ?? this.scatterColliders.nearest(ray.pointX, ray.pointZ, maxDistance)
    if (!hit) {
      return null
    }
    const entry = this.scatterSpecies[hit.speciesOrdinal]
    if (!entry) {
      return null
    }
    // Shared object, and the key is rebuilt only when the pick actually moves.
    // This runs every frame the editor is open with a prop under the crosshair,
    // and `scatterKey` is a template string — i.e. an allocation per frame for a
    // value that changes a few times a second at most.
    if (_pick.x !== hit.x || _pick.z !== hit.z || _pick.species !== entry.id) {
      _pick.key = scatterKey(entry.id, hit.x, hit.z)
      _pick.species = entry.id
      _pick.x = hit.x
      _pick.z = hit.z
    }
    _pick.editorDefId = entry.editorDefId
    _pick.y = hit.baseY
    return _pick
  }

  /**
   * Deletes a scattered prop and rebuilds the chunk it stood in.
   *
   * The tombstone is what persists — the instance itself is regenerated from
   * the seed every time its chunk streams in, and is filtered out on the way.
   */
  removeScatter(key: string, x: number, z: number): boolean {
    if (!this.scatterOverrides.remove(key)) {
      return false
    }
    saveScatterOverrides(this.scatterOverrides.toJSON())
    this.refreshScatterAt(x, z)
    return true
  }

  /** Un-deletes a scattered prop. The generator brings it back unchanged. */
  restoreScatter(key: string, x: number, z: number): boolean {
    if (!this.scatterOverrides.restore(key)) {
      return false
    }
    saveScatterOverrides(this.scatterOverrides.toJSON())
    this.refreshScatterAt(x, z)
    return true
  }

  /** Drops every scatter deletion and rebuilds everything resident. */
  clearScatterOverrides(): void {
    if (this.scatterOverrides.removedCount === 0) {
      return
    }
    this.scatterOverrides.clear()
    saveScatterOverrides(this.scatterOverrides.toJSON())
    this.refreshAllScatter()
  }

  /**
   * Regenerates the scatter for whichever chunk contains a point.
   *
   * Cheaper and far less disruptive than reloading the terrain chunk: the mesh,
   * its LOD tiers and its GPU buffers all stay exactly where they are, and only
   * the instance lists are rebuilt. Reloading the chunk instead would blink the
   * ground out from under the player for however long the worker takes.
   */
  private refreshScatterAt(x: number, z: number): void {
    const size = this.terrain.size
    const cx = Math.floor(x / size)
    const cz = Math.floor(z / size)
    this.repopulateScatter(`${cx}_${cz}`, cx * size, cz * size, size)
  }

  private refreshAllScatter(): void {
    const size = this.terrain.size
    for (const key of this.terrain.liveChunkKeys()) {
      const split = key.indexOf('_')
      if (split <= 0) {
        continue
      }
      const cx = Number(key.slice(0, split))
      const cz = Number(key.slice(split + 1))
      this.repopulateScatter(key, cx * size, cz * size, size)
    }
  }

  /** Shared by the chunk-load hook and the editor's refresh. */
  private repopulateScatter(key: string, originX: number, originZ: number, size: number): void {
    const cx = Math.round(originX / size)
    const cz = Math.round(originZ / size)
    this.scatterColliders.remove(cx, cz)
    for (const entry of this.scatterSpecies) {
      entry.field.removeCell(key)
    }
    this.fillChunkScatter(this.terrain.field, key, originX, originZ, size)
  }

  /**
   * Generates and installs one chunk's scatter, every species at once.
   *
   * **At once** is the point. Each species used to sample its own grid with no
   * knowledge of the others, which is how a boulder ended up standing inside a
   * canopy and a stone half inside another stone: two independent jittered grids
   * have no reason not to pick the same square metre. `scatterChunkSet` resolves
   * the whole plan against one footprint index — see its header for the rule and
   * for why it stays a pure function of `(seed, chunk)`.
   *
   * The batch is walked in **plan order** and written back through each entry's
   * own `ordinal`, so the collider index keeps storing species indices that
   * `pickScatter` can still resolve.
   */
  private fillChunkScatter(field: Heightfield, key: string, originX: number, originZ: number, size: number): void {
    const cx = Math.round(originX / size)
    const cz = Math.round(originZ / size)
    scatterChunkSet(field, this.scatterPlan, originX, originZ, size, this.scatterBatch)

    for (let i = 0; i < this.scatterPlan.length; i++) {
      const entry = this.scatterPlan[i]!
      const transforms = this.scatterBatch[i]!
      // The override filter runs between generation and the field, so a deleted
      // prop reaches neither the renderer nor the collider index.
      if (this.scatterOverrides.removedCount > 0 && transforms.length > 0) {
        filterScatter(transforms, transform =>
          this.scatterOverrides.isRemoved(scatterKey(entry.id, transform.x, transform.z))
        )
      }
      if (transforms.length === 0) {
        continue
      }
      entry.field.addCell(key, transforms)
      // Indexed from the same list the field just consumed, so what collides and
      // what is drawn are the same instances by construction.
      if (entry.collide) {
        this.scatterColliders.add(cx, cz, transforms, entry.collide, entry.ordinal)
      }
    }
  }

  /**
   * Switches who drives the camera. The player is spawned at the orbit focus so
   * the view doesn't teleport, which also means you drop into first-person
   * exactly where you were looking.
   */
  setCameraMode(mode: CameraMode): void {
    if (this.cameraMode === mode) {
      return
    }
    this.cameraMode = mode

    if (mode === 'story') {
      // The world's own walker is switched off and left off: in a chapter the
      // figure on screen is a cast member driven by `CombatDirector`, not the
      // sandbox player, and two controllers writing one camera is the kind of
      // fight that resolves by update order.
      this.player.setEnabled(false)
      return
    }

    if (mode === 'firstPerson') {
      const focus = this.controller.focus
      this.player.teleport(focus.x, this.terrain.heightAt(focus.x, focus.z), focus.z)
      this.player.setEnabled(true)
    } else {
      this.player.setEnabled(false)
      // Hand the orbit rig the player's last position, or the camera snaps back
      // to wherever it was parked before the switch.
      const position = this.player.position
      this.controller.setFocus(position.x, position.y, position.z)
    }
  }

  getCameraMode(): CameraMode {
    return this.cameraMode
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)

    const changed = resizeRenderer(this.renderer, this.width, this.height, this.settings.renderScale)
    this.camera.aspect = this.width / this.height
    this.camera.updateProjectionMatrix()

    if (changed) {
      const bufferHeight = this.renderer.getContext().drawingBufferHeight
      // Both of these are functions of the drawing buffer, so they'd silently
      // drift if only recomputed on construction: outlines would change
      // thickness with the window and LOD would coarsen on a resize.
      updateUnitsPerPixel(this.camera.fov, bufferHeight)
      updateLodBiasFromView(bufferHeight, this.camera.fov)
      // Cascade splits are derived from the projection, and CSM only refreshes
      // their uniforms here — `update()` re-fits the lights but not the splits.
      this.lights.onProjectionChanged()
    }
  }

  applySettings(partial: Partial<WorldSettings>): void {
    Object.assign(this.settings, partial)

    this.renderer.shadowMap.enabled = this.settings.shadows
    // Materials compiled against a shadow-enabled renderer need recompiling
    // when it flips, or they keep sampling a shadow map that's no longer bound.
    this.scene.traverse(object => {
      const material = (object as { material?: { needsUpdate: boolean } | { needsUpdate: boolean }[] }).material
      if (Array.isArray(material)) {
        for (const entry of material) {
          entry.needsUpdate = true
        }
      } else if (material) {
        material.needsUpdate = true
      }
    })

    worldUniforms.uWindSpeed.value = this.settings.wind ? 1.15 : 0

    for (const scatter of this.fields) {
      scatter.setFrustumCullInstances(this.settings.frustumCullInstances)
      scatter.setHierarchical(this.settings.hierarchical)
      scatter.setOutlinesEnabled(this.settings.outlines)
    }
    this.batcher.setFrustumCullInstances(this.settings.frustumCullInstances)
    this.batcher.setHierarchical(this.settings.hierarchical)
    this.batcher.setOutlinesEnabled(this.settings.outlines)
    this.occlusion.enabled = this.settings.occlusion

    this.grass.setWind(this.settings.wind)
    this.syncGrassDetail(true)

    this.setSize(this.width, this.height)
  }

  /**
   * Applies the grass detail setting, resolving `auto` against the adaptive
   * controller.
   *
   * ── Why `auto` is not simply "the adaptive level" ──────────────────────────
   *
   * The obvious mapping is `grass level = quality level`, and it is wrong at the
   * top. `AdaptiveQuality` starts every session at `ultra` and only walks *down*
   * once it has ~20 over-budget samples, so a machine that cannot run grass at
   * ultra spends its first second at ultra — which is precisely the second in
   * which the terrain is still streaming and the catalogue is still draining.
   *
   * So `auto` starts one level below the controller and follows it down. The
   * grass ladder is deliberately steeper than the quality ladder (`minimum` is
   * 30 % density at 40 % range, against the controller's 0.5 lodQuality), so one
   * level of offset is a real reduction rather than a rounding.
   *
   * @param force re-apply even when the resolved level has not changed — used
   *              after `applySettings`, where the *setting* may have changed
   *              from `off` to something with the same numeric level.
   */
  private syncGrassDetail(force = false): void {
    const setting = this.settings.grassDetail
    if (setting === 'off') {
      if (force || this.grass.isEnabled) {
        this.grass.setEnabled(false)
      }
      return
    }

    let level: number
    if (setting === 'auto') {
      // `QUALITY_LEVELS` is authored best-first (`ultra` at index 0) and
      // `GRASS_LEVELS` worst-first, so the index reads as "more grass" in both
      // files at the cost of one mirror here.
      const mirrored = GRASS_LEVELS.length - 1 - this.quality.currentLevel
      level = Math.max(0, mirrored - 1)
    } else {
      level = grassLevelIndex(setting)
    }

    if (!this.grass.isEnabled) {
      this.grass.setEnabled(true)
    }
    this.grass.setLevel(level)
  }

  /**
   * ─── Warm the shaders before the player is looking ──────────────────────────
   *
   * Measured on an unthrottled desktop, the opening `render()` calls cost
   * **35, 0.6, 577, 6.9, 5, 4.2 ms**. The spike is not frame 0 — frames 0 and 1
   * draw an almost-empty scene, because the terrain chunks arrive from the
   * worker and the scatter fields populate over the first few frames. Frame 2 is
   * the first frame that draws the *real* scene, so frame 2 is where the driver
   * compiles and links every program at once. That single frame was the largest
   * remaining stall in the session, larger than boot.
   *
   * ── Why this renders instead of calling `compileAsync` ─────────────────────
   *
   * `renderer.compileAsync(scene, camera)` was the obvious answer and it was
   * measured to be **worse than doing nothing**. Four interleaved A/B pairs in
   * one build: with it, 380–576 ms in `compile()` *plus* a 925–1446 ms opening
   * frame; without it, an opening frame of 566–1764 ms and nothing else. It
   * compiles the programs the scene needs *as `compile()` models it* — and the
   * frame that actually stalls needs more than that, because the shadow passes
   * and the streamed terrain chunks arrive afterwards and bring their own.
   *
   * So the warmup renders **real frames** into a 1×1 drawing buffer. That runs
   * the true path — shadow cascades, depth materials, outline hulls, every LOD
   * tier's program — at a rasterisation cost of one pixel. Nothing approximates
   * what the renderer needs better than the renderer.
   *
   * These frames go straight to `renderer.render` rather than through `frame()`,
   * so they do not touch `framesRendered`, the profiler window or the placeable
   * drain. A warmup that showed up in the statistics it exists to improve would
   * be its own kind of lie.
   *
   * This *relocates* the cost, it does not remove it — a driver's shader compile
   * cannot be divided across frames the way asset generation could. Relocation
   * is the whole point here: it happens with a splash on screen instead of on
   * the player's first interactive frame.
   */
  async warmUp(): Promise<void> {
    if (this.warmedUp) {
      return
    }
    this.warmedUp = true
    const started = performance.now()

    const { width, height } = this
    this.warming = true
    try {
      // Only the *drawing buffer* shrinks. The camera keeps its real aspect, so
      // culling and LOD selection resolve exactly as they will at full size and
      // the programs compiled are the programs frame 0 will want.
      this.renderer.setSize(1, 1, false)

      // ── Warm until the scene stops arriving ────────────────────────────────
      //
      // Not a fixed number of passes. Measured, frames 0 and 1 of a cold boot
      // draw **one call and one geometry** — the sky — because the terrain
      // chunks are still in flight from the worker; the expensive frame is the
      // first one with real content in it. Two earlier attempts at this warmup
      // both failed for the same reason, warming a scene that was still empty.
      //
      // Each pass is a whole `frame()`, which also pumps the streamer, so the
      // loop is what *causes* the content to arrive as well as what waits for
      // it. It stops once a pass draws the same number of calls as the one
      // before — the scene has settled and there is nothing new left to link.
      // The stop condition is **program count**, not draw count. Draw calls keep
      // climbing for as long as chunks stream, so waiting for them to settle ran
      // the full pass budget and cost 1.6–2.4 s; programs are what is actually
      // being warmed, and they stop appearing as soon as every material family
      // has been seen once. A hundredth chunk of terrain links nothing new.
      let previousPrograms = -1
      let settled = 0
      for (let pass = 0; pass < WARMUP_MAX_PASSES; pass++) {
        await new Promise(resolve => setTimeout(resolve, WARMUP_PASS_MS))
        // The whole `frame()` path, not a bare `render()`: an instanced LOD
        // field draws nothing until `update()` has chosen tiers and set its
        // instance counts, so a raw render compiles an empty scene even when
        // one is there.
        this.frame(performance.now())
        const programs = this.renderer.info.programs?.length ?? 0
        const drawing = this.renderer.info.render.calls > 1
        // Two consecutive quiet passes, not one: the shadow-depth variants are
        // linked a pass behind the colour programs that need them, so a single
        // quiet pass is reached while half the work is still ahead.
        settled = drawing && programs === previousPrograms ? settled + 1 : 0
        previousPrograms = programs
        if (settled >= WARMUP_SETTLED_PASSES) {
          break
        }
      }
      // ── Both shadow variants ────────────────────────────────────────────
      //
      // The day cycle switches the shadow pass off at night, and that changes
      // three's program key: `numDirectionalShadows` goes 2 → 0 and **every
      // material in the scene recompiles**. Measured, the first dusk cost a
      // **400 ms frame** (programs 12 → 17); every transition after it cost
      // 17 ms, because by then both variants were cached.
      //
      // So both are compiled here, behind the splash, where a 400 ms pause is
      // free. This is the same argument as the warmup itself — the cost cannot
      // be removed, only moved to where nobody is looking — and it is why the
      // night saving is worth having at all: a 32 % draw-call cut that hitches
      // twice a day would not be.
      this.lights.cascades.setShadowsEnabled(false)
      this.frame(performance.now())
      this.lights.cascades.setShadowsEnabled(true)
      this.frame(performance.now())
      // Re-applied so the cycle's own record of the shadow state matches what
      // was just left on the lights.
      this.dayCycle.setTime(this.dayCycle.time)
    } catch {
      // A failed warmup is not a failed world — the programs link on first draw
      // exactly as they did before this existed.
    } finally {
      this.warming = false
      // The warmup is not part of the session's history. Its frames would
      // otherwise sit in the percentile window as the worst frames ever
      // recorded, which is the opposite of what it exists to achieve.
      this.framesRendered = 0
      this.profiler.resetFrameWindow()
      this.setSize(width, height)
    }

    this.buildInfo.phases.push({ name: 'shader warmup', ms: Math.round((performance.now() - started) * 10) / 10 })
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
    // Clamped: a backgrounded tab returns a multi-second delta, which would
    // teleport the camera and snap every LOD in one frame.
    const delta = Math.min(0.05, (now - this.lastTime) / 1000)
    this.lastTime = now

    this.profiler.beginFrame(this.renderer)

    worldUniforms.uTime.value += delta

    // Collider refresh first: the player is about to move against these, and a
    // one-frame-stale set means walking through a platform the frame after it
    // was placed. One integer compare on the quiet path.
    this.syncColliders()
    this.syncWater(delta)

    if (this.cameraMode === 'story') {
      // Nothing. The story owns the camera and moves its own actors; the hook
      // below is where it runs. Deliberately *before* the matrix refresh, so the
      // LOD systems and the shadow cascades see this frame's camera rather than
      // last frame's.
      this.profiler.beginCpu('story')
      this.onUpdate?.(delta)
      this.profiler.endCpu('story')
    } else if (this.cameraMode === 'firstPerson') {
      this.profiler.beginCpu('player')
      // ── Scatter collision ──────────────────────────────────────────────
      //
      // Nothing to do here any more. The collision world pulls the scatter
      // around whoever is moving, through the source installed below the player
      // — see `PlayerCollisionWorld.setTransientSource` for why it stopped being
      // this branch's job, and what it cost the chapter while it was.
      // The sit runs first and can take the controls. While it has them the
      // walker does not integrate at all: the machine is writing the feet and a
      // physics step on the same frame would fight it.
      this.updateSit(delta)
      if (!this.sit.active) {
        this.player.update(delta)
      }
      this.profiler.endCpu('player')
    } else {
      this.controller.update(delta)
    }

    // See the class notes — the LOD systems frustum-test against these, and
    // three wouldn't refresh them until inside render().
    this.camera.updateMatrixWorld()
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert()

    // The shadow frustum follows whoever is driving. Following the orbit focus
    // while in first-person would leave the player standing outside their own
    // shadow map at any real traversal speed.
    // Advance the sky before the cascades re-fit, or the shadows spend a
    // frame fitted to yesterday's sun direction.
    this.dayCycle.update(delta)
    // The sky moves whether or not the sun does. A chapter freezes `DayCycle`
    // to hold a scene's light (see the story-mode note in the constructor), and
    // a frozen sky with frozen clouds is a painted backdrop — the clouds are
    // the only thing left telling the player the world is running.
    advanceClouds(this.sky.clouds, delta, this.cloudWind)
    // Immediately after, and before anything reads the camera again: the sun
    // billboards against the camera's rotation and both bodies are placed from
    // vectors the cycle has just rewritten in place.
    this.celestials.update(this.dayCycle, this.camera.quaternion)
    // In story mode the cascades follow the *camera*, which is where the story
    // has just put it. Following the sandbox player would fit the shadow map to
    // a figure parked at the origin and leave the whole chapter unshadowed.
    this.lights.follow(
      this.cameraMode === 'story'
        ? this.camera.position
        : this.cameraMode === 'firstPerson'
          ? this.player.position
          : this.controller.focus
    )

    // After the camera matrices, because the editor's aim ray starts from them.
    this.profiler.beginCpu('editor')
    updateLevelEditor(this.camera.position)
    this.profiler.endCpu('editor')

    // After the editor, because a spawn placed this frame should stand up this
    // frame. The camera position is what decides who exists at all — see
    // `Crowd`'s budget.
    this.profiler.beginCpu('npc')
    updateCrowd(delta, this.camera.position)
    this.profiler.endCpu('npc')

    // No camera argument: the water editor owns no LOD nodes to tick, only an
    // aim ray it takes from the host's own camera.
    this.profiler.beginCpu('water')
    updateWaterEditor()
    this.profiler.endCpu('water')

    this.profiler.beginCpu('level')
    this.syncPlacementBatch()
    if (this.batcher.isBuilt) {
      this.batcher.update(this.camera, this.camera.position)
    }
    this.profiler.endCpu('level')

    // Before every consumer's cull. Bumps its cache version when the camera has
    // moved far enough that ridge visibility could have changed.
    this.occlusion.beginFrame(this.camera.position)

    this.profiler.beginCpu('terrain')
    this.terrain.update(this.camera, this.camera.position)
    this.profiler.endCpu('terrain')

    for (const scatter of this.fields) {
      const tag = scatter.asset.perfTag
      this.profiler.beginCpu(tag)
      scatter.update(this.camera, this.camera.position)
      this.profiler.endCpu(tag)
    }

    // After the scatter fields, because grass is the one system whose residency
    // pass does real work (heightfield sampling) and it should land on a frame
    // whose other budgets are already spent rather than ahead of them.
    this.profiler.beginCpu('grass')
    this.grass.update(this.camera, this.camera.position)
    this.profiler.endCpu('grass')

    // Characters. Tagged so the ablation profiler can price the whole family,
    // and cheap by design — a pose is ~20 Euler writes, no allocation.
    if (this.characters.length > 0) {
      this.profiler.beginCpu('characters')
      this.characterClock += delta
      for (let i = 0; i < this.characters.length; i++) {
        const character = this.characters[i]!
        const path = this.characterPaths[i]
        if (path && path.radius > 0) {
          // Move it, and nothing else. Constant ground speed around the circle;
          // the character works out its own gait, heading and bank from the
          // resulting velocity.
          path.angle += (path.speed / path.radius) * delta
          const wantX = path.centreX + Math.cos(path.angle) * path.radius
          const wantZ = path.centreZ + Math.sin(path.angle) * path.radius

          // ── Characters collide with the world too ─────────────────────────
          //
          // Same collision world and the same scatter index the player uses, so
          // a tree that stops the player stops an NPC. Without this they walk
          // through trunks the player cannot, which reads as the world being
          // solid only for you.
          //
          // The path angle advances on *time*, not on progress. That matters:
          // blocked against a trunk the character slides along it while its
          // target keeps travelling round the circle, so it works its way past
          // instead of pressing into the bark forever. Progress-driven advance
          // would deadlock the moment anything got in the way.
          let x = wantX
          let z = wantZ
          const collision = this.player.propCollision
          if (collision) {
            const from = character.group.position
            const moved = collision.resolveMove(from.x, from.z, wantX, wantZ, CHARACTER_RADIUS, from.y + 0.2)
            x = moved.x
            z = moved.z
          }
          character.setPosition(_characterAt.set(x, this.terrain.heightAt(x, z), z))
        } else if (path && path.jumpAt > 0 && this.characterClock % path.jumpAt < delta) {
          character.jump()
        }
        character.update(delta)
      }
      this.profiler.endCpu('characters')
    }

    // Recentre the sky on the viewer. Depth write is off and it renders first,
    // so moving it costs nothing and keeps the horizon closed at any distance
    // from the origin.
    this.sky.position.copy(this.camera.position)

    // Timed separately for the first few frames only. The largest stall left in
    // the session sits between the first and second presented frame, and the
    // frame-delta recorder cannot see it — it starts measuring at frame two, so
    // the gap that *creates* frame two is outside its window. Attributing it
    // needs the render call itself on the clock.
    // Timed on every frame now, not only the opening ones: `renderMs` is the
    // single largest line in a constrained frame and the per-tag table cannot
    // see it.
    const renderStarted = performance.now()
    this.renderer.render(this.scene, this.camera)
    this.profiler.frame.renderMs = performance.now() - renderStarted
    if (!this.warming && this.framesRendered < FIRST_FRAME_SAMPLES) {
      this.buildInfo.firstFrameMs[this.framesRendered] = Math.round(this.profiler.frame.renderMs * 10) / 10
      // Draw calls and resident geometries alongside the cost, because the two
      // candidate explanations for an expensive opening frame are distinguished
      // by exactly this: a *compile* stall draws the same scene as the frame
      // before it, while an *upload* stall is the frame where the scene suddenly
      // has far more in it.
      this.buildInfo.firstFrameDraws[this.framesRendered] = this.renderer.info.render.calls
      this.buildInfo.firstFrameGeometries[this.framesRendered] = this.renderer.info.memory.geometries
    }
    this.framesRendered++
    this.profiler.endFrame(this.renderer, now)

    this.generatePlaceablesOnce()

    // Sampled after `endFrame`, so it reads this frame's GPU timing rather than
    // last frame's. The smoothed reading is what it wants — a raw sample is far
    // too noisy to drive a state machine.
    //
    // Nothing is sampled while the catalogue is still draining. Those frames are
    // slow because the world is being built, not because the machine is weak,
    // and feeding them in is measuring the loader: on a 4×-throttled run the
    // controller read the 33 drain frames and pinned itself at `minimum` while
    // the finished world ran at a comfortable 60 fps.
    this.quality.enabled = this.settings.adaptiveQuality
    if (this.placeablesPending) {
      return
    }
    this.quality.sample(
      this.profiler.frame.gpuSupported ? this.profiler.frame.gpuMs : 0,
      // p95 rather than the instantaneous frame time: the fallback path only
      // has frame time to go on, so it must not react to a single hitch.
      this.profiler.frame.frameMsP95
    )
    // Only while `auto` — every other setting is the player's and must not move
    // under them. `setLevel` early-returns when the level is unchanged, so the
    // steady-state cost of this is one string compare and one subtraction.
    if (this.settings.grassDetail === 'auto') {
      this.syncGrassDetail()
    }
  }

  /**
   * Generates the placeable catalogue a slice at a time, after the world is on
   * screen.
   *
   * Deliberately after `render()` rather than before: landing it on the same
   * frame as the first draw would put it right back on the critical path. One
   * frame of terrain-only world costs nothing and buys the whole 521 ms.
   *
   * ── Deferring is not the same as dividing ───────────────────────────────────
   *
   * Moving the call off boot took the *blocking* boot from 4775 ms to 728 ms
   * under a 4× CPU throttle, and `longestStallMs` promptly reported that the
   * same multi-second block was now simply happening one frame later. A player
   * cannot tell those apart. So the catalogue is drained under a frame budget
   * like terrain chunks are, and for the same reason.
   *
   * The budget is a stopping rule, not a guarantee: a single placeable is ~15 ms
   * of geometry and AO baking and cannot be subdivided, so a slice always
   * overruns. What it buys is that the overrun is one prop's worth instead of
   * thirty-four — the loop keeps turning, input is still read, and the camera
   * still moves while the world fills in.
   */
  private generatePlaceablesOnce(): void {
    // Not during the warmup: those frames exist to link shaders, and spending
    // 90 ms of one of them generating a placeable delays the world for work that
    // the drain will do anyway once the loop is running.
    if (this.warming || !this.placeablesPending || this.framesRendered < 2) {
      return
    }

    const started = performance.now()
    const done = registerPlaceablesIncremental(PLACEABLE_BUDGET_MS)
    this.placeableMs += performance.now() - started
    this.placeableFrames++
    this.buildInfo.placeables = placeableProgress()
    if (!done) {
      return
    }

    this.placeablesPending = false
    // ── Story mode has its own version of the orphan problem ───────────────
    //
    // The sandbox seeds its level before the catalogue exists and the editor
    // parks the unresolved placements as orphans until `rehydrateLevel` below.
    // A chapter has no editor to park anything, so its props take a shorter and
    // more brittle path: `setStoryPlacements` runs at mount, `syncPlacementBatch`
    // builds the batch on frame one, `PlacementBatcher.build` cannot resolve a
    // single `defId` because none of them has been generated yet, and the
    // revision never moves again — so the village silently never appears.
    //
    // That is exactly what happened, and the symptom was a chapter with no
    // buildings in it and a `level` row reading 0 draws. Bumping the revision
    // here is the whole fix: the batcher's own "has it changed" test then
    // rebuilds it once, on the frame the catalogue completes, against a
    // catalogue that can now resolve everything.
    if (this.mode === 'story') {
      this.resolveStoryPlacements()
    }
    // After the placements are resolved, so a listener that reads the catalogue
    // *and* the level sees both settled.
    this.onPlaceablesReady?.()
    this.onPlaceablesReady = null
    // The level's seats, now that the catalogue can answer for them. Rebuilt
    // with the batch -- see `rebuildSeats`.
    this.rebuildSeats()
    // Spawns the starting level's props, which were seeded before their
    // definitions existed and have been parked as orphans until now. Once, at
    // the end: a rehydrate per slice would walk the whole orphan list 34 times
    // to place a handful more props each pass.
    const hydratedStarted = performance.now()
    const hydrated = rehydrateLevel()
    this.placeableMs += performance.now() - hydratedStarted

    this.buildInfo.phases.push({
      name: `placeables (${this.placeableFrames} frames)`,
      ms: Math.round(this.placeableMs * 10) / 10
    })
    this.buildInfo.seededProps = Math.max(this.buildInfo.seededProps, hydrated)

    // The drain's own frames are not evidence about the machine — see the note
    // beside `quality.sample`. Cleared here rather than left to age out because
    // the window is 240 frames deep and the controller reads p95 from it.
    this.profiler.resetFrameWindow()
  }

  /**
   * Re-reads the level only when the editor says something changed.
   *
   * The held prop is excluded: while carried, its *stored* transform stays at
   * the pre-grab position (so a reload mid-carry can't lose it), and colliding
   * with that would leave a phantom platform hanging in the air where you
   * picked it up.
   */
  /**
   * Swaps between the editor's pickable nodes and the instanced batch.
   *
   * Rebuilds only when the editor *closes* (or when the level changed while it
   * was open), so the cost lands on a toggle rather than on an edit — and never
   * on a frame where nothing happened.
   */
  /**
   * The placements this world is drawing, whichever mode it is in.
   *
   * Two lines, and they are what let the batching, the collision cache and the
   * whole LOD path stay identical between a level somebody edited and a chapter
   * somebody wrote.
   */
  /**
   * Re-resolves the level's seats into world space.
   *
   * Rare and cheap. It filters the placement list down to the sittable `defId`s
   * -- thirteen out of two thousand in the chapter, a handful here -- and buckets
   * those into a 16 m grid, which is what keeps the per-frame scan off the other
   * one thousand nine hundred and eighty-seven. Called wherever the batch is
   * (re)built, because that is exactly when a bench can have been moved.
   */
  private rebuildSeats(): void {
    this.seats = new SeatFinder(this.currentPlacements(), (x, z) => this.terrain.heightAt(x, z))
  }

  private currentPlacements(): Placement[] {
    return this.mode === 'story' ? this.storyPlacements : levelPlacements()
  }

  private currentRevision(): number {
    return this.mode === 'story' ? this.storyRevision : levelRevision()
  }

  /**
   * Hands the world a chapter's props.
   *
   * Resolved against the terrain here rather than by the caller: a story level
   * is authored in XZ with no Y (see `story/level.ts`), exactly as the starting
   * level is, so the same rule applies -- the height comes from the ground at
   * seed time, which is what makes the layout survive a change to the terrain
   * instead of leaving a village hovering.
   */
  /**
   * Fades every instance of one placeable to `value` (1 solid, 0 gone).
   *
   * The story layer's handle on the storyteller's roof, and the only public way
   * into `PlacementBatcher.setVeil`. It is safe to call every frame and safe to
   * call before the catalogue exists — see that method — and it costs a map
   * lookup and a float when the value has not changed.
   */
  setPlacementVeil(defId: string, value: number): void {
    this.batcher.setVeil(defId, value)
  }

  /**
   * The weather.
   *
   * `cover` is 0 for a clear sky and 1 for overcast, and it biases the layers'
   * density threshold rather than their opacity — so turning it up grows the
   * clouds that are already there outward instead of fading a fixed shape in.
   * `wind` multiplies every layer's own rate, keeping their relative speeds.
   *
   * Both are clamped rather than trusted: these are the two knobs a chapter, a
   * settings panel or a console poke will reach for, and a NaN in either would
   * put a NaN in a uniform, which shades the entire sky black with no error
   * anywhere (the same class of silent failure `Number.isFinite` guards exist
   * for throughout `src/world/`).
   */
  setWeather(cover: number, wind = this.cloudWind): void {
    const clouds: CloudUniforms = this.sky.clouds
    if (Number.isFinite(cover)) {
      clouds.uCloudCover.value = Math.min(1, Math.max(0, cover))
    }
    if (Number.isFinite(wind)) {
      this.cloudWind = Math.min(8, Math.max(0, wind))
    }
  }

  /** What the sky is doing now: `{ cover, wind }`. For the perf panel and tests. */
  get weather(): { cover: number; wind: number } {
    return { cover: this.sky.clouds.uCloudCover.value, wind: this.cloudWind }
  }

  /**
   * One frame of the sit. `StoryDirector.advanceSit` + `updateSeat`, minus every
   * rule that belongs to a chapter.
   */
  private updateSit(delta: number): void {
    const actor = this.sitActor
    if (!actor) {
      return
    }

    // The blend. Advanced here because the sandbox has no `CombatDirector` to do
    // it -- deliberately with the same constant and the same shape as
    // `Combatant.advancePosture`, so the two routes are provably one motion.
    const target = this.sitting ? 1 : 0
    if (this.sitBlend !== target && delta > 0) {
      const step = delta / SIT_SECONDS
      this.sitBlend =
        this.sitBlend < target ? Math.min(target, this.sitBlend + step) : Math.max(target, this.sitBlend - step)
    }

    if (this.sit.active) {
      this.sit.update(delta, actor)
      // The walk-up. `SitController` hands out a steer rather than a position
      // (its header says why); here that steer is resolved against the same
      // collision world the walker uses, so a scripted walk cannot cross a wall
      // the player could not.
      if (this.sit.throttle > 0) {
        const length = Math.hypot(this.sit.moveX, this.sit.moveZ)
        if (length > 1e-4) {
          const step = SIT_WALK_SPEED * this.sit.throttle * delta
          const from = this.player.position
          const moved = this.player.collision.resolveMove(
            from.x,
            from.z,
            from.x + (this.sit.moveX / length) * step,
            from.z + (this.sit.moveZ / length) * step,
            CHARACTER_RADIUS,
            from.y + 0.2
          )
          this.player.slideTo(moved.x, moved.z)
        }
      }
      // And the view turns to the seat's own facing. Yaw only: a first-person
      // camera whose pitch is taken away reads as the game grabbing your head.
      this.player.controller.setLook(this.sit.facing, this.player.controller.lookPitch)
      const seat = this.sit.seat
      this.sitSeatHeight = seat ? seat.y - this.player.position.y : 0
    }

    // The pose, every frame, including the whole of the stand-up: `sitSeat`
    // keeps the last seat after `stand()` for the reason `Combatant.seatedAs`
    // does -- the clip that gets you out of a chair is the one that got you in,
    // run backwards, and it needs to know which chair.
    this.player.setPosture(this.sitBlend > 0 ? this.sitSeat : null, this.sitBlend, this.sitSeatHeight)
    this.updateSeatFocus()
  }

  /** The seat prompt, and the key that acts on it. */
  private updateSeatFocus(): void {
    const wanted = this.wantsInteract
    this.wantsInteract = false

    if (this.sit.active) {
      const seat = this.sit.seat
      // Only the settled state gets a prompt: during the walk-up and both blends
      // the player has already said what they want.
      if (seat && this.sit.phase === 'seated') {
        this.seatSlot.at.x = seat.x
        this.seatSlot.at.y = seat.y + 0.55
        this.seatSlot.at.z = seat.z
        this.seatSlot.distance = 0
        this.seatSlot.seated = true
        this.seatFocus = this.seatSlot
      } else {
        this.seatFocus = null
      }
      if (wanted && this.sit.holding && this.sitActor) {
        this.sit.release(this.sitActor)
      }
      return
    }

    if (!this.seats || !this.player.enabled) {
      this.seatFocus = null
      return
    }
    // The **camera's** yaw. Same rule as the chapter's: the prompt has to name
    // what the player is looking at.
    const at = this.player.position
    // `groundForward` rather than a raw yaw: the walker's yaw and the story's
    // are opposite conventions, and `SeatFinder.find` says at length why it
    // refuses to be handed either.
    groundForward(this.player.controller.lookYaw, _seatForward)
    const focus = this.seats.find(at.x, at.z, _seatForward.x, _seatForward.z)
    if (!focus) {
      this.seatFocus = null
      return
    }
    this.seatSlot.at.x = focus.seat.x
    this.seatSlot.at.y = focus.seat.y + 0.55
    this.seatSlot.at.z = focus.seat.z
    this.seatSlot.distance = focus.distance
    this.seatSlot.seated = false
    this.seatFocus = this.seatSlot
    if (wanted) {
      this.sit.request(focus.seat, at.x, at.z)
      this.seatFocus = null
    }
  }

  /** The shell latches the interact key into this; it is consumed next frame. */
  requestSit(): void {
    this.wantsInteract = true
  }

  /** Escape. True when it stood the player up, so the shell can stop there. */
  standUp(): boolean {
    return this.sitActor !== null && this.sit.release(this.sitActor)
  }

  /** What the seat billboard should draw, or null. Polled -- never a `ref`. */
  get seatPrompt(): { at: { x: number; y: number; z: number }; distance: number; seated: boolean } | null {
    return this.seatFocus
  }

  setStoryPlacements(placements: readonly Placement[]): void {
    // Kept, so the drain can re-resolve them. `groundOffset` comes from the
    // catalogue, which at mount time is still empty — so the first resolve gets
    // a 0 offset for every prop and the second, after the drain, gets the real
    // one. Storing the authored list is what makes the second pass possible.
    this.storyAuthored = placements.slice()
    this.resolveStoryPlacements()
  }

  private resolveStoryPlacements(): void {
    this.storyPlacements = this.storyAuthored.map(placement => ({
      ...placement,
      y:
        this.terrain.heightAt(placement.x, placement.z) +
        (getPlaceable(placement.defId)?.groundOffset ?? 0) +
        (placement.lift ?? 0)
    }))
    this.storyRevision++
  }

  private syncPlacementBatch(): void {
    // The editor cannot be open in story mode -- it is never installed -- so the
    // toggle path is skipped outright rather than relying on `editorMode` being
    // false. A code word typed during a chapter must not hand a player the
    // level editor for a level that is not theirs.
    const editing = this.mode === 'story' ? false : editorMode.value
    const revision = this.currentRevision()

    if (editing) {
      if (this.lastEditorMode !== editing) {
        // Hand the props back so they can be aimed at, and drop the batch —
        // leaving it up would double-draw every placement.
        this.batcher.clear()
        setPlacementsRendered(true)
        this.batchedRevision = -1
      }
      this.lastEditorMode = editing
      return
    }

    if (this.lastEditorMode !== editing || this.batchedRevision !== revision) {
      this.batcher.build(this.currentPlacements())
      this.rebuildSeats()
      this.batcher.setOcclusion(this.occlusion)
      this.batcher.setOutlinesEnabled(this.settings.outlines)
      this.batcher.setFrustumCullInstances(this.settings.frustumCullInstances)
      this.batcher.setHierarchical(this.settings.hierarchical)
      setPlacementsRendered(false)
      this.batchedRevision = revision
    }
    this.lastEditorMode = editing
  }

  private syncColliders(): void {
    const revision = this.currentRevision()
    if (revision === this.lastLevelRevision) {
      return
    }
    this.lastLevelRevision = revision

    const held = this.mode === 'story' ? null : heldPlacementId()
    const placements = this.currentPlacements()
    this.cachedPlacements = held === null ? placements : placements.filter(entry => entry.id !== held)
    this.player.invalidateColliders()
  }

  /**
   * Pushes the sandbox's edited water layout into the scatter, once it settles.
   *
   * Story mode installs no water editor and calls `setWaterPlanes` directly, so
   * this is the sandbox's half of the same wiring.
   *
   * **Settled**, not "changed": `setWaterPlanes` regenerates every resident
   * chunk, and the revision moves on every mouse-move while a river is being
   * laid. Waiting a third of a second turns a drag from one full rebuild per
   * frame into one at the end of it.
   *
   * `waterRevision()` is a plain integer read with no Vue in it, which is why it
   * exists — see the note on it in `water/editorFacade.ts`.
   */
  private syncWater(delta: number): void {
    if (this.mode === 'story') {
      return
    }
    const revision = waterRevision()
    if (revision !== this.lastWaterRevision) {
      this.lastWaterRevision = revision
      this.waterSettleMs = WATER_SETTLE_MS
      return
    }
    if (this.waterSettleMs <= 0) {
      return
    }
    this.waterSettleMs -= delta * 1000
    if (this.waterSettleMs > 0) {
      return
    }
    this.setWaterPlanes(waterPlacements())
  }

  dispose(): void {
    this.stop()
    // Before the editor: the brush's preview hangs under the editor's group, and
    // tearing the editor down first would leave it parented to a dead node.
    disposeCrowd()
    disposeWaterEditor()
    disposeLevelEditor()
    this.batcher.dispose()
    this.controller.detach()
    this.player.detach()
    this.player.dispose()
    for (const scatter of this.fields) {
      scatter.dispose()
    }
    this.fields.length = 0
    this.grass.dispose()
    for (const asset of this.assets) {
      for (const geometry of asset.tiers) {
        geometry.dispose()
      }
      asset.material.dispose()
      asset.outline?.dispose()
    }
    this.assets.length = 0
    this.terrain.dispose()
    this.celestials.dispose()
    this.lights.dispose()
    this.profiler.dispose()
    this.renderer.dispose()
  }
}

/** Convenience for the `DitheredLod` path — hero props placed by hand. */
export const groundedPosition = (field: Heightfield, x: number, z: number, out = new Vector3()): Vector3 =>
  out.set(x, field.heightAt(x, z), z)
