import type { WorldAsset } from '../assets/types'
import { type FogExp2, Group, type Mesh, PerspectiveCamera, Scene, Vector3, type WebGLRenderer } from 'three'
import { createBoulderAsset, createStoneAsset } from '../assets/rock'
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
  updateWaterEditor
} from '../water/editorFacade'
import { createWaterView } from '../water/view'
import { placeableBuildTimes, placeableProgress, registerPlaceablesIncremental } from '../assets'
import { editorMode } from '../editor/toggle'
import { budgetLedger } from '../geometry/budget'
import { GrassField } from '../grass/GrassField'
import { GRASS_LEVELS, type GrassDetailSetting, grassLevelIndex } from '../grass/config'
import { setGrassPalette } from '../grass/grassPlacement'
import { aoStats } from '../geometry/vertexAO'
import { PlacementBatcher } from '../level/PlacementBatcher'
import { buildStartingLevel } from '../level/startingLevel'
import type { Placement } from '../level/types'
import { setLodBandScale, setLodQuality, updateLodBiasFromView } from '../lod/config'
import { InstancedLodField, type InstanceTransform } from '../lod/InstancedLodField'
import { Profiler } from '../perf/Profiler'
import { AdaptiveQuality } from '../perf/AdaptiveQuality'
import { TerrainOcclusion } from '../perf/TerrainOcclusion'
import { Character, type CharacterState } from '../characters/Character'
import { playerLook } from '../characters/roster'
import { createPlayer, type Player } from '../player'
import { addChunkScatter, maxInstancesPerChunk, type ScatterOptions } from '../scatter'
import { ScatterColliderIndex, type ScatterColliderSpec } from '../scatterColliders'
import { saveScatterOverrides, ScatterOverrides, scatterKey } from '../level/scatterOverrides'
import { WORLD_PATCH } from '../level/worldPatch.generated'
import { applyPatchToBaseline, type PlacementLike } from '../level/worldPatch'
import { updateUnitsPerPixel, worldUniforms } from '../shading/globals'
import { Heightfield } from '../terrain/heightfield'
import { TERRAIN_PALETTE_SLOTS } from '../terrain/heightfieldCore'
import { Terrain } from '../terrain/Terrain'
import { C } from '../art/palette'
import { DayCycle } from './dayCycle'
import { createLightRig, type LightRig } from './lighting'
import { OrbitCameraController } from './OrbitCameraController'
import { createRenderer, resizeRenderer } from './renderer'
import { createSky } from './sky'

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
  /** Time of day to start at, 0–1. 0 is midnight, 0.5 noon. */
  startTime?: number
}

/**
 * Orbit is the inspection camera the world was built with; first-person is the
 * capsule player. Both stay attached — a disabled controller ignores every
 * event — so switching is a flag, not a teardown.
 */
export type CameraMode = 'orbit' | 'firstPerson'

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
 * Collision radius of a chibi character, in metres.
 *
 * Narrower than the player's 0.35: the figure is genuinely slimmer, and a
 * character that collides wider than it looks reads as clumsy in exactly the
 * situations — squeezing between two trees — where the player is watching.
 */
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

  private readonly sky: Mesh
  private readonly lights: LightRig
  /**
   * Sun, sky, fog and ambient over a 24-minute day.
   *
   * Public so the perf panel and a CDP probe can scrub time — a cycle you
   * have to wait twelve minutes to see the other half of is one nobody
   * checks.
   */
  readonly dayCycle: DayCycle
  private readonly fields: InstancedLodField[] = []
  /** Per-species scatter config, consulted by the terrain load hook. */
  private readonly scatterSpecies: {
    field: InstancedLodField
    options: ScatterOptions
    collide?: ScatterColliderSpec
    id: string
    editorDefId?: string
  }[] = []
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
  /** Reused across every chunk load — placement generation must not allocate. */
  private readonly scatterScratch: InstanceTransform[] = []
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
    const { seed = 1337, worldSize = 384, densityScale = 1, instanceGear = true, crowdBudget } = options
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

    phase('renderer+lights')

    const field = new Heightfield({ seed })
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
    this.scene.add(this.terrain.group)
    this.profiler.registerRoot(this.terrain.group, 'terrain')
    phase('terrain')

    // ── Scatter ────────────────────────────────────────────────────────────
    //
    // Several seeded variants per species rather than one. Instancing means a
    // variant costs one extra draw call per visible tier, and three visibly
    // different trees is the difference between a forest and a wallpaper.
    //
    // Fields are now empty shells: instances arrive per chunk from the terrain
    // streamer's load hook, so the world is unbounded and only what's nearby is
    // resident.
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
       * Catalogue entry the editor places when this species is *moved*.
       *
       * Moving a scattered prop is a tombstone plus an ordinary placement, and
       * a placement needs a catalogue `defId`. This is the closest authored
       * equivalent of the scattered variant.
       */
      editorDefId?: string
    }[] = []

    const treeSeeds = [11, 29, 47]
    for (let i = 0; i < treeSeeds.length; i++) {
      species.push({
        asset: createTreeAsset({ seed: treeSeeds[i]!, height: 5.0 + i * 0.7 }),
        tag: 'trees',
        id: `tree${i}`,
        editorDefId: 'tree-crown',
        // The **trunk**, not the canopy. `asset.radius` is the foliage, and
        // using it would ring every tree with a two-metre invisible wall.
        collide: { radius: 0.3, height: 3 },
        scatter: {
          spacing: spacingOf(11 + i * 2),
          seed: 300 + i * 97,
          maxSlope: 0.34,
          clusterSize: 95,
          clusterThreshold: 0.47,
          clearRadius: 16
        }
      })
    }

    for (const [i, seed] of [23, 61].entries()) {
      species.push({
        asset: createBoulderAsset({ seed }),
        tag: 'boulders',
        id: `boulder${i}`,
        editorDefId: 'rock-boulder',
        // Waist-high and wide: these block rather than trip.
        collide: { radius: 0.85, height: 1.1 },
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
      const scatter = new InstancedLodField(entry.asset, capacity)
      this.registerField(entry.asset, scatter, entry.tag)
      this.scatterSpecies.push({
        field: scatter,
        options: entry.scatter,
        collide: entry.collide,
        id: entry.id,
        editorDefId: entry.editorDefId
      })
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
      const cx = Math.round(originX / size)
      const cz = Math.round(originZ / size)
      let speciesOrdinal = 0
      for (const entry of this.scatterSpecies) {
        // The override filter runs between generation and the field, so a
        // deleted prop reaches neither the renderer nor the collider index.
        addChunkScatter(
          entry.field,
          field,
          entry.options,
          key,
          originX,
          originZ,
          size,
          this.scatterScratch,
          this.scatterOverrides.removedCount === 0
            ? undefined
            : transform => this.scatterOverrides.isRemoved(scatterKey(entry.id, transform.x, transform.z))
        )
        // Indexed from the same scratch the field just consumed, so what
        // collides and what is drawn are the same instances by construction.
        if (entry.collide) {
          this.scatterColliders.add(cx, cz, this.scatterScratch, entry.collide, speciesOrdinal)
        }
        speciesOrdinal++
      }
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
    for (const spot of characterSpots) {
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

    // Installed unconditionally: the code-word listener has to be live for
    // "cmonc" to ever be typed, and the editor itself does nothing until it is.
    const levelEditor = installLevelEditor(this)

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
    this.levelBaseline = buildStartingLevel((x, z) => field.heightAt(x, z)).map(seed => ({
      defId: seed.defId,
      x: seed.x,
      y: seed.y,
      z: seed.z,
      rotY: seed.rotY ?? 0,
      scale: seed.scale ?? 1
    }))
    // What actually goes into the world: the starting props the patch has not
    // taken away, plus the ones it adds.
    const seeded = seedLevel(applyPatchToBaseline(this.levelBaseline, WORLD_PATCH))
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
      editor: levelEditor,
      groundAt: (x, z) => field.heightAt(x, z),
      instanceGear,
      ...(crowdBudget !== undefined ? { budget: crowdBudget } : {})
    })
    // The shipped crowd, on a fresh install only — see `seedNpcs`.
    seedNpcs(WORLD_PATCH.npcs)
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
    installWaterEditor(this)
    setWaterViewFactory(createWaterView)
    // The shipped layout, on a fresh install only — the guard is inside
    // `WaterEditor.seed`, which is the only thing that knows whether this
    // browser already has water in it.
    seedWater(WORLD_PATCH.water)
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
    let speciesOrdinal = 0
    for (const entry of this.scatterSpecies) {
      entry.field.removeCell(key)
      addChunkScatter(
        entry.field,
        this.terrain.field,
        entry.options,
        key,
        originX,
        originZ,
        size,
        this.scatterScratch,
        this.scatterOverrides.removedCount === 0
          ? undefined
          : transform => this.scatterOverrides.isRemoved(scatterKey(entry.id, transform.x, transform.z))
      )
      if (entry.collide) {
        this.scatterColliders.add(cx, cz, this.scatterScratch, entry.collide, speciesOrdinal)
      }
      speciesOrdinal++
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

    if (this.cameraMode === 'firstPerson') {
      this.profiler.beginCpu('player')
      // ── Scatter collision ──────────────────────────────────────────────
      //
      // Refilled every frame, immediately before the move that consumes it.
      // The player can only touch what is within a stride, so the query radius
      // is the capsule plus a margin rather than anything view-shaped — a tree
      // 30 m away is not a collision candidate however visible it is.
      //
      // Ordering is the whole contract: `beginTransientColliders` settles the
      // placement list first, then these are appended past it, and `update`
      // reads both. Querying after the move would collide against where the
      // player *was*.
      const collision = this.player.propCollision
      if (collision) {
        collision.beginTransientColliders()
        const at = this.player.position
        this.scatterColliders.queryNear(at.x, at.z, SCATTER_COLLIDER_QUERY_RADIUS, collision)
      }
      this.player.update(delta)
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
    this.lights.follow(this.cameraMode === 'firstPerson' ? this.player.position : this.controller.focus)

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
            collision.beginTransientColliders()
            this.scatterColliders.queryNear(from.x, from.z, SCATTER_COLLIDER_QUERY_RADIUS, collision)
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
  private syncPlacementBatch(): void {
    const editing = editorMode.value
    const revision = levelRevision()

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
      this.batcher.build(levelPlacements())
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
    const revision = levelRevision()
    if (revision === this.lastLevelRevision) {
      return
    }
    this.lastLevelRevision = revision

    const held = heldPlacementId()
    const placements = levelPlacements()
    this.cachedPlacements = held === null ? placements : placements.filter(entry => entry.id !== held)
    this.player.invalidateColliders()
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
    this.lights.dispose()
    this.profiler.dispose()
    this.renderer.dispose()
  }
}

/** Convenience for the `DitheredLod` path — hero props placed by hand. */
export const groundedPosition = (field: Heightfield, x: number, z: number, out = new Vector3()): Vector3 =>
  out.set(x, field.heightAt(x, z), z)
