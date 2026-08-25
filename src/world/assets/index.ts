import { getPlaceable, registerPlaceable } from '../level/catalog'
import type { PlaceableDefinition } from '../level/types'
import { basaltMetrics, createBasaltAsset } from './basalt'
import { birchMetrics, createBirchAsset } from './birch'
import { cliffMetrics, createCliffAsset } from './cliff'
import { measuredRadius } from './common'
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
const MESA_SEED = 113
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
