import { getPlaceable } from '../level/catalog'
import type { Placement } from '../level/types'

/**
 * ─── Where nothing procedural may grow ──────────────────────────────────────
 *
 * A settlement is placed by hand; the forest and the meadow are placed by
 * noise. Neither knows about the other, so by default oaks grow through roofs,
 * boulders sit inside the market square and grass blades come up through the
 * storyteller's floorboards.
 *
 * This is the one list that reconciles them: every hand-placed *building*
 * becomes a circle, and both the scatter (`world/scatter.ts::clearZones`) and
 * the grass (`grass/grassPlacement.ts::setGrassExclusions`) refuse to place
 * anything inside it.
 *
 * ── Why a circle around a rectangular building ──────────────────────────────
 *
 * Because both consumers test thousands of candidate positions per chunk and a
 * circle is one subtraction, one multiply and a compare, while an oriented
 * rectangle is a rotation per test. The cost of the approximation is that a
 * long house clears slightly more ground at its corners than it strictly needs
 * — which is *the right way to be wrong*: a bare metre of ground beside a wall
 * reads as a swept yard, and a tree through a gable reads as a bug.
 *
 * ── Derived from the collider, not from a table ─────────────────────────────
 *
 * The radius comes from each prop's own registered collider, so a building that
 * is later made larger clears more ground automatically. A hand-written table of
 * radii would be a second description of every building's size, and the failure
 * mode of it drifting is invisible until something grows through a wall.
 */

/**
 * Prop id prefixes that count as "a building stands here".
 *
 * A prefix list rather than a flag on `PlaceableDefinition`, deliberately: the
 * catalogue is shared with the sandbox level editor, and "does the procedural
 * meadow avoid this" is a *story* concern that the editor's contract should not
 * have to carry. If a third settlement ever needs a different rule, it changes
 * here and nowhere else.
 *
 * `village-` covers the well, the stalls and the carts. Those are not buildings,
 * and they are in the list anyway for the same reason the houses are: grass
 * growing up through a market stall's counter looks exactly as wrong.
 */
const BUILDING_PREFIXES = ['house-', 'hut-', 'palisade-', 'bridge-', 'village-'] as const

/**
 * Props that are *meant* to sit in the grass.
 *
 * The exception list, and it is short on purpose. A bench at the Treff, a fence
 * across a field and a haystack in a yard all read better with the meadow
 * running up to them — clearing a two-metre disc around each one would leave the
 * village pocked with bald patches, which is a worse artefact than the clipping
 * it prevents.
 */
const KEEP_GRASS_AROUND: ReadonlySet<string> = new Set([
  'village-bench',
  'village-fence',
  'village-haystack',
  'village-logpile',
  'village-barrel',
  'village-crates',
  'village-trough'
])

export interface Footprint {
  x: number
  z: number
  radius: number
}

/**
 * The circle a placement occupies, or null if it is not a building.
 *
 * `Math.hypot` of the box's half-extents rather than the larger of the two: a
 * circle inscribed in a rectangle leaves the corners uncovered, and the corners
 * of a house are exactly where a tree looks worst.
 */
const footprintOf = (placement: Placement, margin: number): Footprint | null => {
  if (!BUILDING_PREFIXES.some(prefix => placement.defId.startsWith(prefix))) {
    return null
  }
  const definition = getPlaceable(placement.defId)
  if (!definition) {
    return null
  }
  const collider = definition.collider
  let radius: number
  if (collider.kind === 'box') {
    radius = Math.hypot(collider.halfX, collider.halfZ)
  } else if (collider.kind === 'cylinder') {
    radius = collider.radius
  } else {
    // No collider at all — a fire pit, a pail. They still occupy ground, and
    // the asset's own bounding radius is the only honest number left.
    radius = definition.asset.radius * 0.5
  }
  return { x: placement.x, z: placement.z, radius: radius * placement.scale + margin }
}

/**
 * Circles the procedural scatter must not place a tree or a rock inside.
 *
 * The margin is generous — 1.4 m — because a tree's *canopy* is what overlaps a
 * roof, and a canopy is several metres wider than the trunk the scatter places.
 * Clearing only the trunk's own footprint leaves branches through the eaves,
 * which is the version of this bug that is easiest to ship without noticing.
 */
export const scatterFootprints = (placements: readonly Placement[]): Footprint[] => {
  const out: Footprint[] = []
  for (const placement of placements) {
    const footprint = footprintOf(placement, 1.4)
    if (footprint) {
      out.push(footprint)
    }
  }
  return out
}

/**
 * The same circles for grass, tighter and with the exception list applied.
 *
 * 0.35 m of margin against the scatter's 1.4: grass is 0.5 m tall and only has
 * to stop at the wall, whereas a tree has to stop far enough away that nothing
 * of it reaches the wall.
 */
export const grassFootprints = (placements: readonly Placement[]): Footprint[] => {
  const out: Footprint[] = []
  for (const placement of placements) {
    if (KEEP_GRASS_AROUND.has(placement.defId)) {
      continue
    }
    const footprint = footprintOf(placement, 0.35)
    if (footprint) {
      out.push(footprint)
    }
  }
  return out
}

/**
 * Packs footprints for the grass placer, which takes a flat `Float32Array`.
 *
 * See `grassPlacement.ts::setGrassExclusions` — that module is three-free and
 * worker-ready, so anything crossing into it has to survive a structured clone.
 */
export const packFootprints = (footprints: readonly Footprint[]): Float32Array => {
  const out = new Float32Array(footprints.length * 3)
  for (const [i, footprint] of footprints.entries()) {
    out[i * 3] = footprint.x
    out[i * 3 + 1] = footprint.z
    out[i * 3 + 2] = footprint.radius
  }
  return out
}
