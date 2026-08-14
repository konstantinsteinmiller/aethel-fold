import { getPlaceable, registerPlaceable } from '../level/catalog'
import type { PlaceableDefinition } from '../level/types'
import { basaltMetrics, createBasaltAsset } from './basalt'
import { cliffMetrics, createCliffAsset } from './cliff'
import { createGrassRockAsset, grassRockMetrics } from './grassRock'
import { assertFiniteGeometry, createPlateauAsset, plateauMetrics } from './plateau'
import { createBoulderAsset, createStoneAsset } from './rock'
import { createSlabAsset, slabMetrics } from './slab'
import { createTreeAsset } from './tree'

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

const buildDefinitions = (): PlaceableDefinition[] => {
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

  return [
    {
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
    },
    {
      id: 'plateau-tall',
      label: 'Plateau (tall)',
      category: 'platform',
      asset: createPlateauAsset(plateauTall),
      collider: { kind: 'cylinder', radius: tall.radius * 0.94, height: tall.height },
      walkable: true,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.8, 1.3]
    },
    {
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
    },
    {
      id: 'cliff-crown',
      label: 'Sea stack (grass crown)',
      category: 'cliff',
      asset: createCliffAsset(cliffGrass),
      collider: { kind: 'cylinder', radius: crowned.radius, height: crowned.height },
      walkable: false,
      groundOffset: -0.2,
      defaultScale: 1,
      scaleRange: [0.8, 1.4]
    },
    {
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
    },
    {
      id: 'slab-block',
      label: 'Stratified block',
      category: 'platform',
      asset: createSlabAsset(slabBlock),
      collider: { kind: 'box', halfX: block.halfX, halfZ: block.halfZ, height: block.height },
      walkable: true,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.9, 1.2]
    },
    {
      id: 'slab-step',
      label: 'Stratified step',
      category: 'platform',
      asset: createSlabAsset(slabStep),
      collider: { kind: 'box', halfX: step.halfX, halfZ: step.halfZ, height: step.height },
      walkable: true,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.85, 1.25]
    },
    {
      id: 'grass-rock',
      label: 'Grass-capped boulder',
      category: 'platform',
      asset: createGrassRockAsset(grassRock),
      collider: { kind: 'cylinder', radius: capped.radius, height: capped.height },
      walkable: true,
      groundOffset: 0,
      defaultScale: 1,
      scaleRange: [0.8, 1.35]
    },
    {
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
    },
    {
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
    },
    {
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
    }
  ]
}

let definitions: PlaceableDefinition[] | null = null

/**
 * Registers every placeable in the world. Safe to call more than once.
 *
 * Idempotency is per-definition rather than a module-level "already ran" flag,
 * because `clearPlaceables()` exists: a flag would leave the catalogue
 * permanently empty after a clear, while checking each id re-populates it. The
 * generated assets are cached either way, so a second call costs a map lookup
 * per prop and no geometry.
 *
 * The finite check runs over **every tier of every placeable**, not only the
 * five generated by this family. The generators in `plateau.ts` and friends
 * already validate themselves through `finishTier`, but the tree and the two
 * rocks come from modules this change does not own, and the catalogue is the one
 * place all eleven are in scope at once. A NaN in any of them renders as a solid
 * black prop, which the art contract bans outright (GDD R4) — so it is caught
 * here, at generation, rather than in a screenshot.
 */
export const registerAllPlaceables = (): PlaceableDefinition[] => {
  if (!definitions) {
    definitions = buildDefinitions()
    for (const definition of definitions) {
      for (const [tier, geometry] of definition.asset.tiers.entries()) {
        assertFiniteGeometry(geometry, `${definition.id}/LOD${tier}`)
      }
    }
  }
  for (const definition of definitions) {
    if (!getPlaceable(definition.id)) {
      registerPlaceable(definition)
    }
  }
  return definitions
}

export { createBasaltAsset } from './basalt'
export { createCliffAsset } from './cliff'
export { createGrassRockAsset } from './grassRock'
export { createPlateauAsset } from './plateau'
export { createBoulderAsset, createRockAsset, createStoneAsset } from './rock'
export { createSlabAsset } from './slab'
export { createTreeAsset } from './tree'
