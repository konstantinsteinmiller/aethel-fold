import { getPlaceable, registerPlaceable } from '../level/catalog'
import type { PlaceableDefinition } from '../level/types'
import { basaltMetrics, createBasaltAsset } from './basalt'
import { birchMetrics, createBirchAsset } from './birch'
import { cliffMetrics, createCliffAsset } from './cliff'
import { measuredRadius } from './common'
import { createDeadTreeAsset, deadTreeMetrics } from './deadTree'
import { createShrubAsset } from './shrub'
import { createStumpAsset, stumpMetrics } from './stump'
import { createGrassRockAsset, grassRockMetrics } from './grassRock'
import { createHoodooAsset, hoodooMetrics } from './hoodoo'
import { createMesaAsset, mesaMetrics } from './mesa'
import { createOldOakAsset, oldOakMetrics } from './oldOak'
import { createPillarStackAsset, pillarStackMetrics } from './pillarStack'
import { createPineAsset, pineMetrics } from './pine'
import { assertFiniteGeometry, createPlateauAsset, plateauMetrics } from './plateau'
import { createBoulderAsset, createStoneAsset } from './rock'
import { createShardWallAsset, shardWallMetrics } from './shardWall'
import { createSlabAsset, slabMetrics } from './slab'
import { DESERT_STONE } from './stone'
import { createTreeAsset, treeMetrics } from './tree'
import { createWaterfallAsset, waterfallMetrics } from '../water/waterfall'
import {
  createBarnAsset,
  createBridgeAsset,
  createCottageAsset,
  createGateAsset,
  createLonghouseAsset,
  createPalisadeAsset,
  createSmithyAsset,
  PALISADE_RUN
} from './village'
import {
  createAnvilAsset,
  createBarrelAsset,
  createBenchAsset,
  createCartAsset,
  createCrateStackAsset,
  createFenceAsset,
  createFirePitAsset,
  createHayStackAsset,
  createHuntNetAsset,
  createLogPileAsset,
  createMarketStallAsset,
  createStaveRackAsset,
  createTroughAsset,
  createWellAsset,
  FENCE_RUN
} from './villageProps'
import {
  createHutAntlersAsset,
  createHutBedAsset,
  createHutChairAsset,
  createHutChestAsset,
  createHutDaggerBlockAsset,
  createHutFloorAsset,
  createHutGlassAsset,
  createHutHammersAsset,
  createHutHearthAsset,
  createHutPailAsset,
  createHutPeltAsset,
  createHutPortraitAsset,
  createHutRaftersAsset,
  createHutRoofAsset,
  createHutShelfAsset,
  createHutStoolAsset,
  createHutTableAsset,
  createHutWallFlankAsset,
  createHutWallLongAsset,
  createHutWallSideAsset,
  createHutWindowBayAsset,
  createHutWineAsset
} from './interior'

/**
 * ─── The placeable catalogue ────────────────────────────────────────────────
 *
 * Everything the level editor can put in the world, and the only place asset
 * generators meet collider shapes. Generation is not free — every tier bakes
 * vertex AO by ray-casting (`geometry/vertexAO.ts`) — so this module builds
 * exactly once, on first call, and never on import.
 *
 * ── Colliders are proxies, and the proxy is chosen to fail safe ─────────────
 *
 * Per `level/types.ts`, colliders are cheap analytic shapes, never the render
 * mesh. For this family that is not a shortcut, it is the only workable answer:
 * a plateau is an undercut mushroom, and colliding against its real silhouette
 * would let a player walk under the lip and then be pushed *out of the world*
 * when the overhang above them resolves.
 *
 * Every walkable prop therefore reports the metrics of its own top face,
 * measured from the generated shape rather than from the options that produced
 * it — `plateauMetrics`, `slabMetrics`, `grassRockMetrics` and friends all
 * re-derive from the same seed. Where a top is irregular the metric is its
 * *inscribed* size, because the two failure modes are not symmetric: a collider
 * slightly too small costs a few centimetres of unreachable ledge, while one
 * slightly too large puts the player standing on thin air, and only one of
 * those gets reported as a bug.
 *
 * The two existing rock props are registered here too, from the bounding radius
 * their generator already publishes. `rock.ts` does not expose shape metrics and
 * is not modified for this — a boulder is a blocker, not a floor, so an
 * approximate cylinder is the whole requirement.
 */

/** Seeds are fixed: a placeable id is persisted, so its shape must not drift. */
const PLATEAU_WIDE_SEED = 31
const PLATEAU_TALL_SEED = 47
const CLIFF_BARE_SEED = 53
const CLIFF_GRASS_SEED = 67
const BASALT_SEED = 71
const SLAB_BLOCK_SEED = 83
const SLAB_STEP_SEED = 97
const GRASS_ROCK_SEED = 103
const TREE_SEED = 11
const BOULDER_SEED = 23
const STONE_SEED = 5
const TREE_CROWN_SEED = 19
const PINE_SEED = 37
const FIR_SEED = 59
const PINE_SNOW_SEED = 73
const BIRCH_SEED = 41
const OLD_OAK_SEED = 7
// -- The wood's second layer: oak shapes, dead wood, understorey -------------
//
// Nine rows that exist because a procedural forest of three seeds of one tree
// reads as wallpaper. They are grouped here rather than merged into the block
// above so the *set* is visible: three oak silhouettes, two states of dead wood,
// two stumps, and the layer under four metres.
const TREE_OAK_BROAD_SEED = 227
const TREE_OAK_TALL_SEED = 229
const TREE_OAK_LEAN_SEED = 233
const STUMP_SAWN_SEED = 239
const STUMP_NOTCHED_SEED = 241
const DEAD_SNAG_SEED = 251
const FALLEN_LOG_SEED = 257
const SHRUB_SEED = 263
const SAPLING_SEED = 269
const THICKET_SEED = 271
const MESA_SEED = 113
// -- The village --------------------------------------------------------------
const HOUSE_COTTAGE_SEED = 401
const HOUSE_COTTAGE_B_SEED = 409
const HOUSE_LONG_SEED = 419
const HOUSE_BARN_SEED = 421
const HOUSE_SMITHY_SEED = 431
const PALISADE_SEED = 433
const GATE_SEED = 439
const BRIDGE_SEED = 443
const WELL_SEED = 449
const FIRE_PIT_SEED = 457
const BENCH_SEED = 461
const LOG_PILE_SEED = 463
const HAY_SEED = 467
const BARREL_SEED = 479
const CRATE_SEED = 487
const CART_SEED = 491
const STALL_SEED = 499
const FENCE_SEED = 503
const ANVIL_SEED = 509
const STAVE_SEED = 521
const TROUGH_SEED = 523
const NET_SEED = 541
const BUTTE_SEED = 127
const MESA_DESERT_SEED = 131
const BUTTE_DESERT_SEED = 137
const PILLAR_TOWER_SEED = 149
const PILLAR_STEP_SEED = 151
const PILLAR_DESERT_SEED = 157
const HOODOO_SQUAT_SEED = 163
const HOODOO_TALL_SEED = 167
const SHARD_WALL_SEED = 173
const SHARD_CLUSTER_SEED = 179
const SHARD_DESERT_SEED = 181
const FALL_SPLASH_SEED = 191
const FALL_CURTAIN_SEED = 193
const FALL_BROAD_SEED = 197
const FALL_RIBBON_SEED = 199
const FALL_STRANDS_SEED = 211

/**
 * One catalogue row, not yet built.
 *
 * The array below returns **factories rather than definitions** for one reason:
 * generating all 34 placeables is ~500 ms of geometry, AO baking and tier
 * assembly on this desktop and 2.4–4 s under a 4× CPU throttle, and an array
 * literal evaluates every element before it returns. Deferring the work off boot
 * only moved that block; it did not divide it. A factory per row is what lets
 * `registerPlaceablesIncremental` stop partway and hand the frame back.
 *
 * The shared metrics and the two assets computed at the top of the function are
 * deliberately left eager — they are ~6 % of the cost, several rows depend on
 * each of them, and memoising them individually would buy a few milliseconds in
 * exchange for making every row read through a lazy accessor.
 */
type DefinitionFactory = () => PlaceableDefinition

const definitionFactories = (): DefinitionFactory[] => {
  const plateauWide = { seed: PLATEAU_WIDE_SEED, form: 'wide' as const }
  const plateauTall = { seed: PLATEAU_TALL_SEED, form: 'tall' as const }
  const cliffBare = { seed: CLIFF_BARE_SEED, grassCap: false }
  const cliffGrass = { seed: CLIFF_GRASS_SEED, grassCap: true }
  const basalt = { seed: BASALT_SEED }
  const slabBlock = { seed: SLAB_BLOCK_SEED, form: 'block' as const }
  const slabStep = { seed: SLAB_STEP_SEED, form: 'step' as const }
  const grassRock = { seed: GRASS_ROCK_SEED }

  const wide = plateauMetrics(plateauWide)
  const tall = plateauMetrics(plateauTall)
  const bare = cliffMetrics(cliffBare)
  const crowned = cliffMetrics(cliffGrass)
  const columns = basaltMetrics(basalt)
  const block = slabMetrics(slabBlock)
  const step = slabMetrics(slabStep)
  const capped = grassRockMetrics(grassRock)

  const boulder = createBoulderAsset({ seed: BOULDER_SEED })
  const stone = createStoneAsset({ seed: STONE_SEED })

  // ── Flora ────────────────────────────────────────────────────────────────
  //
  // Every option object is declared once and handed to both the generator and
  // the metrics function, because the two must agree on the seed *and* on every
  // other option — a metrics call that re-derives from a different literal is a
  // collider silently describing a different tree.
  const treeCrown = { seed: TREE_CROWN_SEED, form: 'crown' as const }
  const pine = { seed: PINE_SEED, form: 'spruce' as const }
  const fir = { seed: FIR_SEED, form: 'fir' as const }
  const pineSnow = { seed: PINE_SNOW_SEED, form: 'spruce' as const, snow: true }
  const birch = { seed: BIRCH_SEED }
  const oldOak = { seed: OLD_OAK_SEED }

  const oakBroad = { seed: TREE_OAK_BROAD_SEED, form: 'oakBroad' as const }
  const oakTall = { seed: TREE_OAK_TALL_SEED, form: 'oakTall' as const }
  const oakLean = { seed: TREE_OAK_LEAN_SEED, form: 'oakLean' as const }
  const stumpSawn = { seed: STUMP_SAWN_SEED }
  const stumpNotched = { seed: STUMP_NOTCHED_SEED, form: 'notched' as const }
  const deadSnag = { seed: DEAD_SNAG_SEED }
  const fallenLog = { seed: FALLEN_LOG_SEED, form: 'log' as const }

  const broadTrunk = treeMetrics(oakBroad)
  const tallTrunk = treeMetrics(oakTall)
  const leanTrunk = treeMetrics(oakLean)
  const sawnBole = stumpMetrics(stumpSawn)
  const notchedBole = stumpMetrics(stumpNotched)
  const snagBole = deadTreeMetrics(deadSnag)
  const logBox = deadTreeMetrics(fallenLog)

  const crownTrunk = treeMetrics(treeCrown)
  const spruce = pineMetrics(pine)
  const firTrunk = pineMetrics(fir)
  const snowTrunk = pineMetrics(pineSnow)
  const birchTrunk = birchMetrics(birch)
  const oldOakTrunk = oldOakMetrics(oldOak)

  // ── Stone: the pale family ───────────────────────────────────────────────
  const mesa = { seed: MESA_SEED, form: 'mesa' as const }
  const butte = { seed: BUTTE_SEED, form: 'butte' as const }
  const pillarTower = { seed: PILLAR_TOWER_SEED, form: 'tower' as const }
  const pillarStep = { seed: PILLAR_STEP_SEED, form: 'step' as const }
  const shardWall = { seed: SHARD_WALL_SEED, form: 'wall' as const }
  const shardCluster = { seed: SHARD_CLUSTER_SEED, form: 'cluster' as const }

  const mesaTop = mesaMetrics(mesa)
  const butteTop = mesaMetrics(butte)
  const towerTop = pillarStackMetrics(pillarTower)
  const stepTop = pillarStackMetrics(pillarStep)
  const wallBox = shardWallMetrics(shardWall)
  const clusterBox = shardWallMetrics(shardCluster)

  // ── Stone: the desert family ─────────────────────────────────────────────
  //
  // Same generators, same shapes, `DESERT_STONE` instead of the pale palette
  // plus the sedimentary banding pass — see `assets/stone.ts`. `grassCap` and
  // `shelfGrass` switch themselves off for a non-pale palette, but `grassCap`
  // is passed explicitly here anyway: it is a *visual* decision the catalogue
  // owns, and inheriting it from a default would make it invisible at the one
  // place someone would look for it.
  const mesaDesert = {
    seed: MESA_DESERT_SEED,
    form: 'mesa' as const,
    stone: DESERT_STONE,
    grassCap: false,
    banding: 1
  }
  const butteDesert = {
    seed: BUTTE_DESERT_SEED,
    form: 'butte' as const,
    stone: DESERT_STONE,
    grassCap: false,
    banding: 1
  }
  const pillarDesert = {
    seed: PILLAR_DESERT_SEED,
    form: 'tower' as const,
    stone: DESERT_STONE,
    banding: 1
  }
  const shardDesert = { seed: SHARD_DESERT_SEED, form: 'wall' as const, stone: DESERT_STONE, banding: 1 }
  const hoodooSquat = { seed: HOODOO_SQUAT_SEED, form: 'squat' as const }
  const hoodooTall = { seed: HOODOO_TALL_SEED, form: 'tall' as const }

  const mesaDesertTop = mesaMetrics(mesaDesert)
  const butteDesertTop = mesaMetrics(butteDesert)
  const pillarDesertTop = pillarStackMetrics(pillarDesert)
  const shardDesertBox = shardWallMetrics(shardDesert)
  const squatWaist = hoodooMetrics(hoodooSquat)
  const tallWaist = hoodooMetrics(hoodooTall)

  // ── Waterfalls ───────────────────────────────────────────────────────────
  //
  // Falls are ordinary placeables; the flat water is not. A waterfall is a
  // point with a yaw and a uniform scale, which is exactly what a `Placement`
  // describes — while a sea is non-uniformly sized and a river is a polyline,
  // which is why those live in their own editor (`world/water/WaterEditor.ts`)
  // with their own schema. Splitting on that line rather than on "is it water"
  // is what keeps both stores honest.
  const fallSplash = { seed: FALL_SPLASH_SEED, form: 'splash' as const }
  const fallCurtain = { seed: FALL_CURTAIN_SEED, form: 'curtain' as const }
  const fallBroad = { seed: FALL_BROAD_SEED, form: 'broad' as const }
  const fallRibbon = { seed: FALL_RIBBON_SEED, form: 'ribbon' as const }
  const fallStrands = { seed: FALL_STRANDS_SEED, form: 'strands' as const }

  return [
    () => ({
      id: 'plateau-wide',
      label: 'Plateau (wide)',
      category: 'platform',
      asset: createPlateauAsset(plateauWide),
      // Sized to the flat top and shaved by 6 %: the rim is fluted, so the
      // outline is not a circle and the inscribed radius is the honest one.
      collider: { kind: 'cylinder', radius: wide.radius * 0.94, height: wide.height },
      walkable: true,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.75, 1.35]
    }),
    () => ({
      id: 'plateau-tall',
      label: 'Plateau (tall)',
      category: 'platform',
      asset: createPlateauAsset(plateauTall),
      collider: { kind: 'cylinder', radius: tall.radius * 0.94, height: tall.height },
      walkable: true,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.8, 1.3]
    }),
    () => ({
      id: 'cliff-spire',
      label: 'Sea stack (bare)',
      category: 'cliff',
      asset: createCliffAsset(cliffBare),
      // Not walkable: the crown is a couple of metres across at fourteen metres
      // up, so it is a landmark to navigate around, not a destination.
      collider: { kind: 'cylinder', radius: bare.radius, height: bare.height },
      walkable: false,
      groundOffset: -0.2,
      defaultScale: 1,
      scaleRange: [0.8, 1.4]
    }),
    () => ({
      id: 'cliff-crown',
      label: 'Sea stack (grass crown)',
      category: 'cliff',
      asset: createCliffAsset(cliffGrass),
      collider: { kind: 'cylinder', radius: crowned.radius, height: crowned.height },
      walkable: false,
      groundOffset: -0.2,
      defaultScale: 1,
      scaleRange: [0.8, 1.4]
    }),
    () => ({
      id: 'basalt-cluster',
      label: 'Basalt columns',
      category: 'platform',
      asset: createBasaltAsset(basalt),
      // The central column only — see `basaltMetrics` for why a cluster of
      // uneven tops cannot honestly be one cylinder.
      collider: { kind: 'cylinder', radius: columns.radius, height: columns.height },
      walkable: true,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.85, 1.25]
    }),
    () => ({
      id: 'slab-block',
      label: 'Stratified block',
      category: 'platform',
      asset: createSlabAsset(slabBlock),
      collider: { kind: 'box', halfX: block.halfX, halfZ: block.halfZ, height: block.height },
      walkable: true,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.9, 1.2]
    }),
    () => ({
      id: 'slab-step',
      label: 'Stratified step',
      category: 'platform',
      asset: createSlabAsset(slabStep),
      collider: { kind: 'box', halfX: step.halfX, halfZ: step.halfZ, height: step.height },
      walkable: true,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.85, 1.25]
    }),
    () => ({
      id: 'grass-rock',
      label: 'Grass-capped boulder',
      category: 'platform',
      asset: createGrassRockAsset(grassRock),
      collider: { kind: 'cylinder', radius: capped.radius, height: capped.height },
      walkable: true,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.8, 1.35]
    }),
    () => ({
      id: 'rock-boulder',
      label: 'Boulder',
      category: 'rock',
      asset: boulder,
      // Derived from the published bounding radius, which includes a 1.35
      // silhouette margin — dividing it back out lands close to the real mass.
      collider: { kind: 'cylinder', radius: (boulder.radius / 1.35) * 0.85, height: boulder.radius * 0.9 },
      walkable: false,
      groundOffset: -0.12,
      defaultScale: 1,
      scaleRange: [0.8, 1.25]
    }),
    () => ({
      id: 'rock-stone',
      label: 'Stone',
      category: 'rock',
      asset: stone,
      // Knee-high at most. Blocking on it would mean the player catching on
      // pebbles, which reads as the ground being sticky rather than as detail.
      collider: { kind: 'none' },
      walkable: false,
      groundOffset: -0.06,
      defaultScale: 1,
      scaleRange: [0.7, 1.3]
    }),
    () => ({
      id: 'tree-oak',
      label: 'Broadleaf tree',
      category: 'flora',
      asset: createTreeAsset({ seed: TREE_SEED, height: 5.4 }),
      // Trunk only. The canopy is at head height and above, and colliding with
      // it would stop the player dead in what looks like open ground.
      collider: { kind: 'cylinder', radius: 0.46, height: 3.1 },
      walkable: false,
      groundOffset: -0.1,
      defaultScale: 1,
      scaleRange: [0.8, 1.3]
    }),
    () => ({
      id: 'tree-crown',
      label: 'Broadleaf tree (crown)',
      category: 'flora',
      asset: createTreeAsset(treeCrown),
      // Same rule as `tree-oak` — trunk only. `treeMetrics` reports the trunk's
      // *widest* section, flare included, which inverts the inscribed rule used
      // everywhere else in this file: that rule protects a player standing on a
      // top, and this is a blocker, where the failure to avoid is walking into
      // visible wood. The 1.12 reproduces the hand-tuned 0.46 the oak above has
      // carried since before the metric existed.
      collider: { kind: 'cylinder', radius: crownTrunk.trunkRadius * 1.12, height: crownTrunk.trunkHeight },
      walkable: false,
      groundOffset: -0.1,
      defaultScale: 1,
      scaleRange: [0.8, 1.25]
    }),
    () => ({
      id: 'tree-pine',
      label: 'Pine (spruce)',
      category: 'flora',
      asset: createPineAsset(pine),
      // Chest-height trunk radius, and only 40 % of the tree's height: a
      // conifer's skirt starts low, and a collider tall enough to include it
      // would stop the player a metre out from a trunk they can walk up to.
      collider: { kind: 'cylinder', radius: spruce.radius, height: spruce.height },
      walkable: false,
      groundOffset: -0.12,
      defaultScale: 1,
      scaleRange: [0.75, 1.35]
    }),
    () => ({
      id: 'tree-fir',
      label: 'Pine (fir)',
      category: 'flora',
      asset: createPineAsset(fir),
      collider: { kind: 'cylinder', radius: firTrunk.radius, height: firTrunk.height },
      walkable: false,
      groundOffset: -0.12,
      defaultScale: 1,
      scaleRange: [0.75, 1.35]
    }),
    () => ({
      id: 'tree-pine-snow',
      label: 'Pine (snow-laden)',
      category: 'flora',
      // Identical geometry to `tree-pine` — the snow is a paint pass, not a
      // mesh (GDD R1). Different seed only so the two don't stand next to each
      // other as the same tree in two colours.
      asset: createPineAsset(pineSnow),
      collider: { kind: 'cylinder', radius: snowTrunk.radius, height: snowTrunk.height },
      walkable: false,
      groundOffset: -0.12,
      defaultScale: 1,
      scaleRange: [0.75, 1.35]
    }),
    () => ({
      id: 'tree-birch',
      label: 'Birch',
      category: 'flora',
      asset: createBirchAsset(birch),
      // Circumscribed across *both* stems below chest height. A metric sized to
      // one stem would let the player stand inside the other, which is the one
      // place a two-trunk species differs from every other blocker here.
      collider: { kind: 'cylinder', radius: birchTrunk.radius, height: birchTrunk.height },
      walkable: false,
      groundOffset: -0.08,
      defaultScale: 1,
      scaleRange: [0.8, 1.3]
    }),
    () => ({
      id: 'tree-oak-ancient',
      label: 'Ancient oak',
      category: 'flora',
      asset: createOldOakAsset(oldOak),
      // `oldOakMetrics` is inscribed on the fused-buttress section, and on a
      // 1.7 m bole the gap between the inscribed and circumscribed bearings is
      // wide enough to walk into. Opened to 1.2× — still inside the crests, but
      // no longer inside the visible wood.
      collider: { kind: 'cylinder', radius: oldOakTrunk.radius * 1.2, height: oldOakTrunk.height },
      walkable: false,
      groundOffset: -0.15,
      defaultScale: 1,
      scaleRange: [0.85, 1.2]
    }),

    // ── Flora: the wood's second layer ───────────────────────────────────────
    //
    // Three oak *shapes* (not three seeds — see `tree.ts`), the two states of
    // dead wood, two stumps, and everything under four metres. Every one of
    // these is also a scatter species in `core/World.ts`; they are registered
    // here because the catalogue is the only way anything reaches the level
    // editor's palette, and because a scattered prop that is *moved* becomes an
    // ordinary placement and needs a `defId` to become (`ScatterSpecies.editorDefId`).
    () => ({
      id: 'tree-oak-broad',
      label: 'Oak (broad)',
      category: 'flora',
      asset: createTreeAsset(oakBroad),
      // Trunk only, as every tree here is: the canopy starts at head height and
      // colliding with it stops the player dead in what looks like open ground.
      // The 1.12 reproduces the hand-tuned 0.46 `tree-oak` has carried since
      // before `treeMetrics` existed — and note this form's bole is the thickest
      // in the file, because a 4.8 m field oak spends its growth on girth.
      collider: { kind: 'cylinder', radius: broadTrunk.trunkRadius * 1.12, height: broadTrunk.trunkHeight },
      walkable: false,
      groundOffset: -0.1,
      defaultScale: 1,
      scaleRange: [0.8, 1.3]
    }),
    () => ({
      id: 'tree-oak-tall',
      label: 'Oak (tall)',
      category: 'flora',
      asset: createTreeAsset(oakTall),
      collider: { kind: 'cylinder', radius: tallTrunk.trunkRadius * 1.12, height: tallTrunk.trunkHeight },
      walkable: false,
      groundOffset: -0.1,
      defaultScale: 1,
      scaleRange: [0.85, 1.2]
    }),
    () => ({
      id: 'tree-oak-lean',
      label: 'Oak (leaning)',
      category: 'flora',
      asset: createTreeAsset(oakLean),
      // Stops at the split, which on this form is where the trunk has already
      // travelled ~0.8 m sideways. The collider is a vertical cylinder on the
      // *base*, so it under-claims the top of the bole rather than over-claiming
      // it — the right way round for a blocker whose lean the player can see.
      collider: { kind: 'cylinder', radius: leanTrunk.trunkRadius * 1.12, height: leanTrunk.trunkHeight },
      walkable: false,
      groundOffset: -0.1,
      defaultScale: 1,
      scaleRange: [0.8, 1.25]
    }),
    () => ({
      id: 'tree-stump',
      label: 'Tree stump (sawn)',
      category: 'flora',
      asset: createStumpAsset(stumpSawn),
      collider: { kind: 'cylinder', radius: sawnBole.radius, height: sawnBole.height },
      // Not walkable. It is 0.74 m of flat top and standing on it would be
      // lovely, and the collider is a cylinder while the top is a shallow dome
      // over a fluted section — the proxy would claim flat ground a hand's width
      // outside the wood on three bearings. `assets/index.ts`'s own rule: a
      // collider slightly too large puts the player on thin air, and only one of
      // the two failure modes gets reported as a bug.
      walkable: false,
      groundOffset: -0.06,
      defaultScale: 1,
      scaleRange: [0.75, 1.35]
    }),
    () => ({
      id: 'tree-stump-notched',
      label: 'Tree stump (axe-notched)',
      category: 'flora',
      asset: createStumpAsset(stumpNotched),
      collider: { kind: 'cylinder', radius: notchedBole.radius, height: notchedBole.height },
      walkable: false,
      groundOffset: -0.06,
      defaultScale: 1,
      scaleRange: [0.75, 1.35]
    }),
    () => ({
      id: 'tree-dead',
      label: 'Dead tree (standing)',
      category: 'flora',
      asset: createDeadTreeAsset(deadSnag),
      // Stops under the lowest limb stub. The stubs are geometry the cylinder
      // does not describe, and a collider tall enough to include them would stop
      // the player a metre out from a trunk they can walk right up to.
      collider: { kind: 'cylinder', radius: snagBole.radius, height: snagBole.height },
      walkable: false,
      groundOffset: -0.12,
      defaultScale: 1,
      scaleRange: [0.8, 1.25]
    }),
    () => ({
      id: 'tree-log',
      label: 'Fallen log',
      category: 'flora',
      asset: createDeadTreeAsset(fallenLog),
      // A **box**, for `shard-wall`'s reason: this is the only piece of flora in
      // the catalogue that is a *line* rather than a surface of revolution, and
      // a cylinder around a 3.6 m trunk lying on its side would be mostly thin
      // air with the player stopped 1.8 m from the wood. The generator fixes the
      // log's axis to object +X so the box means something before the
      // placement's Y-rotation.
      collider: { kind: 'box', halfX: logBox.halfX, halfZ: logBox.halfZ, height: logBox.height },
      walkable: false,
      groundOffset: -0.02,
      defaultScale: 1,
      scaleRange: [0.8, 1.3]
    }),
    () => ({
      id: 'shrub',
      label: 'Shrub',
      category: 'flora',
      asset: createShrubAsset({ seed: SHRUB_SEED }),
      // No collider, and that is the considered answer rather than the lazy one.
      // A bush is foliage the player pushes through; blocking on it is what makes
      // a world feel like it is made of glue — the same call `rock-stone` makes
      // for ankle-high rubble, and the reason its comment gives.
      collider: { kind: 'none' },
      walkable: false,
      groundOffset: -0.08,
      defaultScale: 1,
      scaleRange: [0.6, 1.4]
    }),
    () => ({
      id: 'tree-sapling',
      label: 'Sapling',
      category: 'flora',
      asset: createShrubAsset({ seed: SAPLING_SEED, form: 'sapling' }),
      // Also none: the stem is 24 mm and a whip that thin bends rather than
      // stops, so a collider on it would be a 2 cm invisible post in the middle
      // of walkable ground.
      collider: { kind: 'none' },
      walkable: false,
      groundOffset: -0.05,
      defaultScale: 1,
      scaleRange: [0.7, 1.3]
    }),
    () => ({
      id: 'thicket',
      label: 'Thicket',
      category: 'flora',
      asset: createShrubAsset({ seed: THICKET_SEED, form: 'thicket' }),
      collider: { kind: 'none' },
      walkable: false,
      groundOffset: -0.08,
      defaultScale: 1,
      scaleRange: [0.7, 1.3]
    }),

    // ── Platforms: the pale stone family ─────────────────────────────────────
    () => ({
      id: 'mesa-wide',
      label: 'Mesa (grass top)',
      category: 'platform',
      asset: createMesaAsset(mesa),
      // No second shave here, unlike `plateau-*`: `mesaMetrics` already reports
      // the narrowest fluted bearing (measured at 0.79 of the crest radius
      // across seeds), and stacking the plateau's extra 0.94 on top of that
      // would cost most of a metre off a six-metre landing pad.
      collider: { kind: 'cylinder', radius: mesaTop.radius, height: mesaTop.height },
      walkable: true,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.8, 1.3]
    }),
    () => ({
      id: 'mesa-butte',
      label: 'Butte (grass top)',
      category: 'platform',
      asset: createMesaAsset(butte),
      collider: { kind: 'cylinder', radius: butteTop.radius, height: butteTop.height },
      walkable: true,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.85, 1.25]
    }),
    () => ({
      id: 'pillar-tower',
      label: 'Stacked pillar (tower)',
      category: 'platform',
      asset: createPillarStackAsset(pillarTower),
      collider: { kind: 'cylinder', radius: towerTop.radius, height: towerTop.height },
      walkable: true,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.85, 1.25]
    }),
    () => ({
      id: 'pillar-step',
      label: 'Stacked pillar (step)',
      category: 'platform',
      asset: createPillarStackAsset(pillarStep),
      collider: { kind: 'cylinder', radius: stepTop.radius, height: stepTop.height },
      walkable: true,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.8, 1.35]
    }),

    // ── Cliffs: the fin walls ────────────────────────────────────────────────
    () => ({
      id: 'shard-wall',
      label: 'Shard wall',
      category: 'cliff',
      asset: createShardWallAsset(shardWall),
      // A box, not a cylinder — this is the one prop in the family that is a
      // *line* rather than a surface of revolution, and a cylinder around a
      // seven-metre row of fins would be mostly thin air. The box is
      // axis-aligned in object space before the placement's Y-rotation, which
      // is why the generator fixes the row's bearing rather than jittering it.
      collider: { kind: 'box', halfX: wallBox.halfX, halfZ: wallBox.halfZ, height: wallBox.height },
      walkable: false,
      groundOffset: -0.15,
      defaultScale: 1,
      scaleRange: [0.8, 1.35]
    }),
    () => ({
      id: 'shard-cluster',
      label: 'Shard cluster',
      category: 'cliff',
      asset: createShardWallAsset(shardCluster),
      collider: {
        kind: 'box',
        halfX: clusterBox.halfX,
        halfZ: clusterBox.halfZ,
        height: clusterBox.height
      },
      walkable: false,
      groundOffset: -0.15,
      defaultScale: 1,
      scaleRange: [0.75, 1.4]
    }),

    // ── Desert: the same shapes in sandstone ─────────────────────────────────
    () => ({
      id: 'mesa-desert',
      label: 'Desert mesa',
      category: 'desert',
      asset: createMesaAsset(mesaDesert),
      collider: { kind: 'cylinder', radius: mesaDesertTop.radius, height: mesaDesertTop.height },
      walkable: true,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.8, 1.3]
    }),
    () => ({
      id: 'butte-desert',
      label: 'Desert butte',
      category: 'desert',
      asset: createMesaAsset(butteDesert),
      collider: { kind: 'cylinder', radius: butteDesertTop.radius, height: butteDesertTop.height },
      walkable: true,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.85, 1.25]
    }),
    () => ({
      id: 'hoodoo-squat',
      label: 'Hoodoo (squat)',
      category: 'desert',
      asset: createHoodooAsset(hoodooSquat),
      // Not walkable, and the collider is the **waist** rather than the cap.
      // Both follow from the same fact about the shape: the cap overhangs the
      // stem by about 2.5×, so a cap-sized cylinder is an invisible wall a
      // metre out from a stem the player can plainly see is thin, and a
      // walkable cap would stand them on a disc a third the width of the rock
      // they appear to be on. Walking *under* the overhang is the point.
      collider: { kind: 'cylinder', radius: squatWaist.radius, height: squatWaist.height },
      walkable: false,
      groundOffset: -0.1,
      defaultScale: 1,
      // The reference sheet runs these from ankle height to house height, and
      // one generator covering that whole range is most of why the desert reads
      // as a formation rather than as a row of identical props.
      scaleRange: [0.55, 1.6]
    }),
    () => ({
      id: 'hoodoo-tall',
      label: 'Hoodoo (tall)',
      category: 'desert',
      asset: createHoodooAsset(hoodooTall),
      collider: { kind: 'cylinder', radius: tallWaist.radius, height: tallWaist.height },
      walkable: false,
      groundOffset: -0.12,
      defaultScale: 1,
      scaleRange: [0.75, 1.3]
    }),
    () => ({
      id: 'pillar-desert',
      label: 'Desert pillar stack',
      category: 'desert',
      asset: createPillarStackAsset(pillarDesert),
      collider: { kind: 'cylinder', radius: pillarDesertTop.radius, height: pillarDesertTop.height },
      walkable: true,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.85, 1.25]
    }),
    () => ({
      id: 'shard-desert',
      label: 'Desert shard wall',
      category: 'desert',
      asset: createShardWallAsset(shardDesert),
      collider: {
        kind: 'box',
        halfX: shardDesertBox.halfX,
        halfZ: shardDesertBox.halfZ,
        height: shardDesertBox.height
      },
      walkable: false,
      groundOffset: -0.15,
      defaultScale: 1,
      scaleRange: [0.8, 1.35]
    }),

    // ── Water ────────────────────────────────────────────────────────────────
    //
    // Every fall carries `collider: { kind: 'none' }`, and that is a design call
    // rather than an omission. Walking through a curtain and standing in the
    // hollow behind it is a genre staple, and the alternative fails badly in
    // both directions: a collider sized to the visible sheet is an invisible
    // wall in front of a cave, and one sized to the stone behind it blocks
    // nothing the terrain doesn't already block. The splash pool is ankle-deep
    // and reads as ground the player should be able to stand in.
    () => ({
      id: 'fall-splash',
      label: 'Waterfall (splash)',
      category: 'water',
      asset: createWaterfallAsset(fallSplash),
      collider: { kind: 'none' },
      walkable: false,
      groundOffset: -0.05,
      defaultScale: 1,
      scaleRange: [0.6, 1.6]
    }),
    () => ({
      id: 'fall-curtain',
      label: 'Waterfall (curtain)',
      category: 'water',
      asset: createWaterfallAsset(fallCurtain),
      collider: { kind: 'none' },
      walkable: false,
      groundOffset: -0.08,
      defaultScale: 1,
      scaleRange: [0.7, 1.5]
    }),
    () => ({
      id: 'fall-broad',
      label: 'Waterfall (broad)',
      category: 'water',
      asset: createWaterfallAsset(fallBroad),
      collider: { kind: 'none' },
      walkable: false,
      groundOffset: -0.1,
      defaultScale: 1,
      scaleRange: [0.75, 1.4]
    }),
    () => ({
      id: 'fall-ribbon',
      label: 'Waterfall (tall ribbon)',
      category: 'water',
      asset: createWaterfallAsset(fallRibbon),
      collider: { kind: 'none' },
      walkable: false,
      groundOffset: -0.1,
      defaultScale: 1,
      scaleRange: [0.7, 1.5]
    }),
    () => ({
      id: 'fall-strands',
      label: 'Waterfall (strands)',
      category: 'water',
      asset: createWaterfallAsset(fallStrands),
      collider: { kind: 'none' },
      walkable: false,
      groundOffset: -0.08,
      defaultScale: 1,
      scaleRange: [0.65, 1.55]
    }),

    // -- The village --------------------------------------------------------
    //
    // Colliders here are **boxes**, not cylinders, and that is the one place
    // the village differs from every family above it. A rock is round enough
    // that a cylinder is the honest proxy; a house is emphatically not, and a
    // cylinder around a 6.4 x 4.5 m cottage either lets the player walk into
    // the middle of the long wall or stops them two metres short of the gable.
    // A box rotates with the placement's own yaw (`level/types.ts`), which is
    // exactly what a building needs and what nothing before this did.
    //
    // None of them is `walkable`. A roof the player can stand on is a promise
    // the collision proxy cannot keep -- the top face of a house's box is at
    // eaves height while the actual roof is a pitch, so standing on it means
    // hovering in mid-air over the ridge.
    () => ({
            // ── The height is the *roof*, not the wall ──────────────────────────
      //
      // `ScatterColliderSpec` says a blocking height "only has to exceed the
      // player's step height to block", and for a player capsule that is true.
      // Three other things ray-cast against these boxes and none of them is a
      // capsule: `Projectiles` (an arrow that flies through a roof), the
      // dialogue camera's spring arm, and — since the follow camera got one —
      // `StoryPlayer.shortenArm`.
      //
      // The follow camera rides `BASE_HEIGHT` = 2.85 m above the character's
      // feet. Against a 2.4 m box it sails straight over the proxy and into the
      // roof space, back-face culling removes the near wall, and the building
      // appears to vanish. That is what "this house disappears on camera
      // rotation" actually was.
      //
      // So the boxes now reach the roof apex: eaves + rise x 1.035, which is
      // where `THATCH_SECTION` puts its ridge. The chimney is left out — it is a
      // 0.5 m spike and a proxy that included it would stop the camera a foot
      // further out for the whole building.
      id: 'house-cottage',
      label: 'Cottage',
      category: 'village',
      asset: createCottageAsset(HOUSE_COTTAGE_SEED),
      collider: { kind: 'box', halfX: 3.05, halfZ: 2.15, height: 4.58 },
      walkable: false,
      groundOffset: -0.1,
      defaultScale: 1,
      scaleRange: [0.92, 1.12]
    }),
    () => ({
      id: 'house-cottage-b',
      label: 'Cottage (second)',
      category: 'village',
      // A different seed, and that is the whole difference -- shape is authored
      // and `seed` only jitters albedo (see `structure.ts`). Two rows rather
      // than one so a street is not one house repeated, without paying for a
      // second set of tiers' worth of authoring.
      asset: createCottageAsset(HOUSE_COTTAGE_B_SEED),
      // Roof apex, not the wall — see `house-cottage` above on why a 2.4 m
      // proxy made the building vanish when the camera swung behind it.
      collider: { kind: 'box', halfX: 3.05, halfZ: 2.15, height: 4.58 },
      walkable: false,
      groundOffset: -0.1,
      defaultScale: 1,
      scaleRange: [0.92, 1.12]
    }),
    () => ({
      id: 'house-long',
      label: 'Longhouse',
      category: 'village',
      asset: createLonghouseAsset(HOUSE_LONG_SEED),
      // Roof apex, not the wall — see `house-cottage` above.
      collider: { kind: 'box', halfX: 4.45, halfZ: 2.35, height: 4.88 },
      walkable: false,
      groundOffset: -0.1,
      defaultScale: 1,
      scaleRange: [0.94, 1.1]
    }),
    () => ({
      id: 'house-barn',
      label: 'Barn',
      category: 'village',
      asset: createBarnAsset(HOUSE_BARN_SEED),
      // Roof apex, not the wall — see `house-cottage` above. A barn's roof
      // reaches the ground, so its eaves are at 0.85 and almost all of this is
      // roof.
      collider: { kind: 'box', halfX: 3.7, halfZ: 2.7, height: 4.06 },
      walkable: false,
      groundOffset: -0.1,
      defaultScale: 1,
      scaleRange: [0.9, 1.15]
    }),
    () => ({
      id: 'house-smithy',
      label: 'Smithy (the hero house)',
      category: 'village',
      asset: createSmithyAsset(HOUSE_SMITHY_SEED),
      // Wide enough to take in the forge lean-to on the -X gable, which is why
      // this box is not centred on the building's own origin. The placement
      // rotates it, so an off-centre proxy still tracks the building.
      //
      // Roof apex, not the wall — see `house-cottage` above. Two storeys, so
      // this is the tallest proxy in the catalogue.
      collider: { kind: 'box', halfX: 5.2, halfZ: 3.0, height: 6.83 },
      walkable: false,
      groundOffset: -0.12,
      defaultScale: 1,
      scaleRange: [1, 1]
    }),
    () => ({
      id: 'palisade-run',
      label: 'Palisade run',
      category: 'village',
      asset: createPalisadeAsset(PALISADE_SEED),
      collider: { kind: 'box', halfX: PALISADE_RUN * 0.5, halfZ: 0.3, height: 2.9 },
      walkable: false,
      groundOffset: -0.25,
      defaultScale: 1,
      scaleRange: [1, 1]
    }),
    () => ({
      id: 'palisade-gate',
      label: 'Village gate',
      category: 'village',
      asset: createGateAsset(GATE_SEED),
      // Two boxes would be right -- the opening between the towers is walkable
      // and the towers are not -- and the schema has room for exactly one. So
      // the proxy is the *left tower only*, and the right tower gets its own
      // `palisade-run` placement behind it in the level. Blocking the whole
      // span would wall off the gate the chapter ends by walking through, which
      // is the one failure this prop cannot have.
      collider: { kind: 'box', halfX: 0.95, halfZ: 1.0, height: 4.1 },
      walkable: false,
      groundOffset: -0.22,
      defaultScale: 1,
      scaleRange: [1, 1]
    }),
    () => ({
      id: 'bridge-arla',
      label: 'River bridge',
      category: 'village',
      asset: createBridgeAsset(BRIDGE_SEED),
      // The one **walkable** village prop, and the only one that has to be: the
      // chapter crosses it. The box top is the deck at its lowest, so the player
      // walks the camber rather than floating over it.
      collider: { kind: 'box', halfX: 3.6, halfZ: 0.92, height: 0.44 },
      walkable: true,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [1, 1]
    }),
    () => ({
      id: 'village-well',
      label: 'Well',
      category: 'village',
      asset: createWellAsset(WELL_SEED),
      collider: { kind: 'cylinder', radius: 0.82, height: 0.72 },
      walkable: false,
      groundOffset: -0.05,
      defaultScale: 1,
      scaleRange: [0.95, 1.05]
    }),
    () => ({
      id: 'village-firepit',
      label: 'Fire pit',
      category: 'village',
      asset: createFirePitAsset(FIRE_PIT_SEED),
      // Deliberately not blocking: it is 34 cm of stone kerb, the player steps
      // over it, and a fire pit that stops you dead is a fire pit nobody can
      // stand around -- which is the one thing der Treff is for.
      collider: { kind: 'none' },
      walkable: false,
      groundOffset: -0.04,
      defaultScale: 1,
      scaleRange: [0.9, 1.15]
    }),
    () => ({
      id: 'village-bench',
      label: 'Bench',
      category: 'village',
      asset: createBenchAsset(BENCH_SEED),
      // 0.34 is the plank's top face, not a guess: the bench came down from a
      // human-scale 0.495 to the rig's own seat height when it became sittable
      // (see `interaction/seats.ts` and the arithmetic in `characters/postures.ts`),
      // and a collider left at the old 0.46 states a bench 12 cm taller than the
      // one being drawn. Nothing currently notices -- every mover tests against a
      // step ceiling of at least y+0.6 -- which is exactly why it would have sat
      // here wrong indefinitely.
      collider: { kind: 'box', halfX: 0.95, halfZ: 0.24, height: 0.34 },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.9, 1.1]
    }),
    () => ({
      id: 'village-logpile',
      label: 'Log pile',
      category: 'village',
      asset: createLogPileAsset(LOG_PILE_SEED),
      collider: { kind: 'box', halfX: 0.65, halfZ: 0.75, height: 1.0 },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.85, 1.2]
    }),
    () => ({
      id: 'village-haystack',
      label: 'Hay stack',
      category: 'village',
      asset: createHayStackAsset(HAY_SEED),
      collider: { kind: 'cylinder', radius: 1.05, height: 1.5 },
      walkable: false,
      groundOffset: -0.06,
      defaultScale: 1,
      scaleRange: [0.85, 1.25]
    }),
    () => ({
      id: 'village-barrel',
      label: 'Barrel',
      category: 'village',
      asset: createBarrelAsset(BARREL_SEED),
      collider: { kind: 'cylinder', radius: 0.36, height: 0.86 },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.85, 1.15]
    }),
    () => ({
      id: 'village-crates',
      label: 'Crate stack',
      category: 'village',
      asset: createCrateStackAsset(CRATE_SEED),
      collider: { kind: 'box', halfX: 0.38, halfZ: 0.34, height: 0.58 },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.85, 1.15]
    }),
    () => ({
      id: 'village-cart',
      label: 'Hand cart',
      category: 'village',
      asset: createCartAsset(CART_SEED),
      collider: { kind: 'box', halfX: 1.1, halfZ: 0.62, height: 0.95 },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.95, 1.05]
    }),
    () => ({
      id: 'village-stall',
      label: 'Market stall',
      category: 'village',
      asset: createMarketStallAsset(STALL_SEED),
      collider: { kind: 'box', halfX: 1.2, halfZ: 0.46, height: 0.94 },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.95, 1.08]
    }),
    () => ({
      id: 'village-fence',
      label: 'Fence run',
      category: 'village',
      asset: createFenceAsset(FENCE_SEED),
      collider: { kind: 'box', halfX: FENCE_RUN * 0.5, halfZ: 0.12, height: 1.0 },
      walkable: false,
      groundOffset: -0.2,
      defaultScale: 1,
      scaleRange: [1, 1]
    }),
    () => ({
      id: 'village-anvil',
      label: 'Anvil',
      category: 'village',
      asset: createAnvilAsset(ANVIL_SEED),
      collider: { kind: 'cylinder', radius: 0.34, height: 0.9 },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.95, 1.05]
    }),
    () => ({
      id: 'village-staverack',
      label: 'Stave rack',
      category: 'village',
      asset: createStaveRackAsset(STAVE_SEED),
      collider: { kind: 'box', halfX: 0.78, halfZ: 0.32, height: 1.5 },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.95, 1.05]
    }),
    () => ({
      id: 'village-trough',
      label: 'Water trough',
      category: 'village',
      asset: createTroughAsset(TROUGH_SEED),
      collider: { kind: 'box', halfX: 0.92, halfZ: 0.29, height: 0.5 },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.95, 1.05]
    }),

    // -- The storyteller's hut ------------------------------------------------
    //
    // A room, as parts. `assets/interior.ts` explains why it is not one prop:
    // a `Placement` carries exactly one collider, and one box around a room is
    // either solid or empty and neither is a room. So the shell is four wall
    // slabs with their own box colliders, a walkable floor and an uncollided
    // rafter set, and the level assembles them.
    //
    // The wall colliders are **0.16 half-thick against a 0.12 slab**, which is a
    // 4 cm skin of air on each face. That is deliberate and it is the one number
    // here worth defending: a collider flush with a wall lets a player's capsule
    // touch the render surface, and at a grazing angle the near plane then cuts
    // into it and you can see through your own house.
    () => ({
      id: 'hut-wall-long',
      label: 'Hut wall (6.4 m)',
      category: 'village',
      asset: createHutWallLongAsset(),
      collider: { kind: 'box', halfX: 3.2, halfZ: 0.16, height: 2.86 },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [1, 1]
    }),
    () => ({
      id: 'hut-wall-side',
      label: 'Hut wall (5.4 m)',
      category: 'village',
      asset: createHutWallSideAsset(),
      collider: { kind: 'box', halfX: 2.7, halfZ: 0.16, height: 2.86 },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [1, 1]
    }),
    () => ({
      id: 'hut-wall-flank',
      label: 'Hut wall (2.6 m)',
      category: 'village',
      asset: createHutWallFlankAsset(),
      collider: { kind: 'box', halfX: 1.3, halfZ: 0.16, height: 2.86 },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [1, 1]
    }),
    () => ({
      id: 'hut-floor',
      label: 'Hut floor',
      category: 'village',
      asset: createHutFloorAsset(),
      // Walkable, and one of only two props in the whole catalogue that are
      // (the other is the bridge). A room the player stands *beside* rather than
      // in is not a room.
      //
      // 0.02, down from 0.4. `walkable` stands the player on `placement.y +
      // height`, and 0.4 against a *visual* top of 0.1 had them walking the room
      // 30 cm above its floorboards while the cast — placed on the terrain by
      // `groundAt` — stood 10 cm under them. See the asset's own note; the
      // boards are flush now and this is the matching number.
      collider: { kind: 'box', halfX: 6.5, halfZ: 5.5, height: 0.02 },
      walkable: true,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [1, 1]
    }),
    () => ({
      id: 'hut-rafters',
      label: 'Hut rafters',
      category: 'village',
      // No collider at all: they are 2.4 m overhead, the player cannot reach
      // them, and a box round them would be a ceiling you bump your head on
      // while standing on the floor below.
      asset: createHutRaftersAsset(),
      collider: { kind: 'none' },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [1, 1]
    }),
    () => ({
      id: 'hut-table',
      label: 'Table',
      category: 'village',
      asset: createHutTableAsset(),
      collider: { kind: 'box', halfX: 1.2, halfZ: 0.52, height: 0.6 },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [1, 1]
    }),
    () => ({
      id: 'hut-stool',
      label: 'Stool',
      category: 'village',
      asset: createHutStoolAsset(),
      collider: { kind: 'cylinder', radius: 0.24, height: 0.36 },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.94, 1.06]
    }),
    () => ({
      id: 'hut-hearth',
      label: 'Hearth',
      category: 'village',
      asset: createHutHearthAsset(),
      collider: { kind: 'box', halfX: 1.05, halfZ: 0.48, height: 2.3 },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [1, 1]
    }),
    () => ({
      id: 'hut-chest',
      label: 'Chest',
      category: 'village',
      asset: createHutChestAsset(),
      collider: { kind: 'box', halfX: 0.66, halfZ: 0.4, height: 0.76 },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [1, 1]
    }),
    () => ({
      id: 'hut-shelf',
      label: 'Dresser',
      category: 'village',
      asset: createHutShelfAsset(),
      collider: { kind: 'box', halfX: 0.8, halfZ: 0.2, height: 1.62 },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [1, 1]
    }),
    () => ({
      id: 'hut-bed',
      label: 'Bed',
      category: 'village',
      asset: createHutBedAsset(),
      collider: { kind: 'box', halfX: 1.02, halfZ: 0.6, height: 0.46 },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [1, 1]
    }),
    () => ({
      id: 'hut-pail',
      label: 'Water pail',
      category: 'village',
      asset: createHutPailAsset(),
      // ── It blocks now, and the doorway argument no longer holds ──────────
      //
      // This used to be `none`, on the grounds that two pails are set down in a
      // doorway in the frame act and a pail blocking a doorway is a pail the
      // player gets stuck behind. That was true of a 1.2 m doorway in a 6.4 m
      // room; the door is 2.0 m now and `frame.ts` sets them down beside it
      // rather than in it. A pail you walk *through* on your way in is worse
      // than one you walk round — it is the first prop of the chapter and it
      // tells the player, in the first three seconds, which rules this world
      // runs on.
      //
      // 0.2 against the pail's own 0.19 top radius: a hair proud, like every
      // other collider here, so the capsule never touches the render surface.
      collider: { kind: 'cylinder', radius: 0.2, height: 0.42 },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.95, 1.05]
    }),
    () => ({
      id: 'hut-wine',
      label: 'Wine and cups',
      category: 'village',
      asset: createHutWineAsset(),
      // A collider is anchored at the *placement's* y (`collision.ts` sets
      // `baseY = placement.y`), and this one is placed with `lift: 0.81` — on
      // the table — so the box it makes is a box in the air 81 cm up, which is
      // exactly where the jug is. It is inside the table's own collider from
      // most directions, and not from the ends.
      collider: { kind: 'cylinder', radius: 0.3, height: 0.34 },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [1, 1]
    }),
    () => ({
      id: 'hunt-net',
      label: 'Hunting net (set)',
      category: 'village',
      asset: createHuntNetAsset(NET_SEED),
      // ── It blocks, and that is the point of it ──────────────────────────
      //
      // The trap is a barrier; a net the player walks through is a net that
      // explains nothing about why the boar came *through* it. The box is the
      // net panel only — 2.7 m of it — and stops short of the guys, which are
      // rope on the ground and which the player has to be able to step over.
      collider: { kind: 'box', halfX: 2.7, halfZ: 0.5, height: 2.1 },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.95, 1.08]
    }),
    () => ({
      id: 'hut-window-bay',
      label: 'Hut wall with window (2.8 m)',
      category: 'village',
      asset: createHutWindowBayAsset(),
      // Same 0.16 half-depth as the plain slabs — the 4 cm skin of air this
      // section's header defends. The opening is *not* cut out of the collider:
      // its sill is 1.02 m up, well above a capsule's waist, so a player who
      // could walk through the hole would be walking through a wall.
      collider: { kind: 'box', halfX: 1.4, halfZ: 0.16, height: 2.86 },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [1, 1]
    }),
    () => ({
      id: 'hut-glass',
      label: 'Hut window glass',
      category: 'village',
      asset: createHutGlassAsset(),
      // None. The pane lives inside the bay's own collider, and glass you can
      // walk into is glass you have broken.
      collider: { kind: 'none' },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [1, 1]
    }),
    () => ({
      id: 'hut-roof',
      label: 'Hut roof (shingled)',
      category: 'village',
      asset: createHutRoofAsset(),
      // None, for the same reason the rafters have none: its lowest point is
      // 2.9 m up and a box round it would be a ceiling the player bumps their
      // head on while standing on the floor below.
      collider: { kind: 'none' },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [1, 1]
    }),
    () => ({
      id: 'hut-chair',
      label: "Chair (the storyteller's)",
      category: 'village',
      asset: createHutChairAsset(),
      collider: { kind: 'box', halfX: 0.3, halfZ: 0.36, height: 0.38 },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [1, 1]
    }),
    // ── Wall pieces ───────────────────────────────────────────────────────
    //
    // All four hang between 1.6 m and 2.4 m on a wall that already has a
    // collider, so none of them takes one: a second box up there is an
    // invisible pillar you cannot walk under, and the wall behind it is what
    // actually stops the player.
    () => ({
      id: 'hut-hammers',
      label: "Smith's hammers (wall rack)",
      category: 'village',
      asset: createHutHammersAsset(),
      collider: { kind: 'none' },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [1, 1]
    }),
    () => ({
      id: 'hut-pelt',
      label: "Wolf pelt (wall)",
      category: 'village',
      asset: createHutPeltAsset(),
      collider: { kind: 'none' },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.94, 1.06]
    }),
    () => ({
      id: 'hut-antlers',
      label: 'Deer antlers (wall)',
      category: 'village',
      asset: createHutAntlersAsset(),
      collider: { kind: 'none' },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.94, 1.06]
    }),
    () => ({
      id: 'hut-portrait',
      label: 'Portrait of Athalus',
      category: 'village',
      asset: createHutPortraitAsset(),
      collider: { kind: 'none' },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [1, 1]
    }),
    () => ({
      id: 'hut-workblock',
      label: "Work block (the count's dagger)",
      category: 'village',
      asset: createHutDaggerBlockAsset(),
      collider: { kind: 'cylinder', radius: 0.3, height: 0.62 },
      walkable: false,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [1, 1]
    })
  ]
}

let factories: DefinitionFactory[] | null = null
let cursor = 0
const definitions: PlaceableDefinition[] = []

/**
 * Builds one row and publishes it.
 *
 * The finite check runs over **every tier of every placeable**, not only the
 * ones generated by the cliff family. The generators in `plateau.ts` and friends
 * already validate themselves through `finishTier`, but the flora modules do
 * not, and the catalogue is the one place every prop in the world is in scope at
 * once. A NaN in any of them renders as a solid black prop, which the art
 * contract bans outright (GDD R4) — so it is caught here, at generation, rather
 * than in a screenshot.
 */
/**
 * What each row cost to generate, in ms, newest last.
 *
 * The frame budget can only stop *between* placeables, so the worst single row
 * is the floor on how long a slice can block — which makes "which asset is
 * expensive to build" a number with consequences, not trivia. Kept always (not
 * DEV-gated): it is 34 floats, and the perf panel is a shipping surface.
 */
export const placeableBuildTimes: { id: string; ms: number }[] = []

const buildOne = (factory: DefinitionFactory): PlaceableDefinition => {
  const startedAt = performance.now()
  const definition = factory()
  placeableBuildTimes.push({ id: definition.id, ms: Math.round((performance.now() - startedAt) * 10) / 10 })
  for (const [tier, geometry] of definition.asset.tiers.entries()) {
    assertFiniteGeometry(geometry, `${definition.id}/LOD${tier}`)
  }
  // Widen — never narrow — the published bounding radius to the mesh's actual
  // reach. See `measuredRadius`: a generator derives this number from its shape
  // description, which misses everything applied afterwards, and ten of the
  // props here shipped a radius short of their own geometry (the worst by
  // 27.7 %). Since the radius drives instanced frustum culling, that is a prop
  // vanishing while a quarter of it is still on screen.
  //
  // Corrected here rather than in ten generators because this is the one place
  // every prop in the world is in scope, and because a generator that
  // *deliberately* publishes a larger radius — the plateau reports its bounding-
  // box corner so a player standing on the rim can't cull it — must keep it.
  // `Math.max` is what makes both true at once.
  definition.asset.radius = Math.max(definition.asset.radius, measuredRadius(definition.asset.tiers))
  definitions.push(definition)
  // Guarded, because `registerPlaceable` throws on a duplicate id and the
  // catalogue can outlive this module: Vite hot-swaps `assets/index.ts` with a
  // fresh cursor while `level/catalog.ts` keeps its registry, so the drain
  // replays ids that are already there. That threw on the first row and killed
  // the rest of the drain — a dev-only path, but the pre-drain code checked
  // this and dropping the check was a regression, not a simplification.
  if (!getPlaceable(definition.id)) {
    registerPlaceable(definition)
  }
  return definition
}

/** How many rows the catalogue has, without building any of them. */
export const placeableTotal = (): number => (factories ??= definitionFactories()).length

/** How many have been generated so far. */
export const placeableProgress = (): number => cursor

/**
 * Generates catalogue rows until `budgetMs` is spent, and returns `true` once
 * the whole catalogue exists.
 *
 * Checked *after* each row rather than before, so the budget is a stopping rule
 * and not a permission slip: with a check up front a 1 ms budget could still
 * start a 60 ms row, and with zero rows built per call the loop would never
 * finish. One row is therefore always the minimum unit of progress — the
 * granularity of this system is a placeable, and no budget can subdivide it.
 */
export const registerPlaceablesIncremental = (budgetMs: number): boolean => {
  factories ??= definitionFactories()
  const started = performance.now()
  while (cursor < factories.length) {
    buildOne(factories[cursor++]!)
    if (performance.now() - started >= budgetMs) {
      break
    }
  }
  return cursor >= factories.length
}

/**
 * Registers every placeable in the world, in one blocking pass. Safe to call
 * more than once.
 *
 * Idempotency is per-definition rather than a module-level "already ran" flag,
 * because `clearPlaceables()` exists: a flag would leave the catalogue
 * permanently empty after a clear, while checking each id re-populates it. The
 * generated assets are cached either way, so a second call costs a map lookup
 * per prop and no geometry.
 *
 * Prefer `registerPlaceablesIncremental` anywhere a frame is being drawn; this
 * blocking form is for tests, for tools, and for the tail of an incremental
 * drain that something suddenly needs finished *now*.
 *
 * ── Registration is not optional ────────────────────────────────────────────
 *
 * **A generator that is not registered here does not exist.** The level editor's
 * palette is a projection of this catalogue and nothing else, so an asset module
 * that compiles, passes its budgets and renders perfectly is still unreachable
 * until it has a row below. Adding the generator and forgetting the row is the
 * failure mode this note exists to prevent — it looks like finished work right
 * up until someone opens the editor and cannot find the thing.
 */
export const registerAllPlaceables = (): PlaceableDefinition[] => {
  // `Infinity` never satisfies the stopping rule, so this drains in one pass —
  // and picks up wherever an incremental drain left off rather than restarting.
  registerPlaceablesIncremental(Infinity)
  // Re-registration after a `clearPlaceables()`. Idempotency is per-definition
  // rather than a module-level "already ran" flag because a flag would leave the
  // catalogue permanently empty after a clear, while checking each id
  // re-populates it — and from the cache, so this costs a map lookup per prop
  // and no geometry.
  for (const definition of definitions) {
    if (!getPlaceable(definition.id)) {
      registerPlaceable(definition)
    }
  }
  return definitions
}

export { createBasaltAsset } from './basalt'
export { createBirchAsset } from './birch'
export { createCliffAsset } from './cliff'
export { createGrassRockAsset } from './grassRock'
export { createHoodooAsset } from './hoodoo'
export { createMesaAsset } from './mesa'
export { createOldOakAsset } from './oldOak'
export { createPillarStackAsset } from './pillarStack'
export { createPineAsset } from './pine'
export { createPlateauAsset } from './plateau'
export { createBoulderAsset, createRockAsset, createStoneAsset } from './rock'
export { createShardWallAsset } from './shardWall'
export { createSlabAsset } from './slab'
export { DESERT_STONE, PALE_STONE, type StonePalette } from './stone'
export { createTreeAsset } from './tree'
export {
  createBarnAsset,
  createBridgeAsset,
  createCottageAsset,
  createGateAsset,
  createLonghouseAsset,
  createPalisadeAsset,
  createSmithyAsset,
  PALISADE_RUN
} from './village'
export * from './villageProps'
export * from './interior'
