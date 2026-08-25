import type { WorldAsset } from '../assets/types'

/**
 * ─── Level contract ─────────────────────────────────────────────────────────
 *
 * The single interface shared by the three systems that meet in a level: the
 * asset generators that produce placeable props, the level editor that places
 * them, and the player controller that collides with them. It is defined here,
 * once, so none of the three has to know anything about the other two.
 */

/**
 * Collision proxy for a placed prop.
 *
 * Cheap analytic shapes only — never the render mesh. A BotW-style plateau is
 * an undercut mushroom; colliding against its real silhouette would let the
 * player clip under the lip and fall through, and would cost a BVH per prop.
 * A box that matches the *walkable top* and blocks the *body* is both cheaper
 * and better behaved.
 */
export type ColliderShape =
  | { kind: 'none' }
  /** Axis-aligned in object space before the placement's Y-rotation. */
  | { kind: 'box'; halfX: number; halfZ: number; height: number }
  | { kind: 'cylinder'; radius: number; height: number }

export type PlaceableCategory = 'platform' | 'cliff' | 'desert' | 'rock' | 'flora' | 'water'

export const PLACEABLE_CATEGORY_ORDER: PlaceableCategory[] = [
  'platform',
  'cliff',
  'desert',
  'rock',
  'flora',
  'water'
]

/**
 * `desert` is a **stone family**, not a shape family — a hoodoo is the same
 * lofted surface of revolution as a sea stack, painted from `DESERT_STONE`
 * instead of `PALE_STONE` (see `assets/stone.ts`). It gets its own section
 * anyway because that is how a level designer reaches for it: nobody hunts
 * through "Platforms" for the red rock, they look for the red rock.
 */
export const PLACEABLE_CATEGORY_LABELS: Record<PlaceableCategory, string> = {
  platform: 'Platforms',
  cliff: 'Cliffs & spires',
  desert: 'Desert rock',
  rock: 'Rocks',
  flora: 'Flora',
  // Waterfalls only. Ponds, rivers and seas are *not* placeables — they are not
  // point-with-a-uniform-scale objects, so they have their own editor and their
  // own store (`world/water/WaterEditor.ts`). A fall is a prop like any other.
  water: 'Water'
}

export interface PlaceableDefinition {
  /** Stable id. Persisted in save data — never rename one in place. */
  id: string
  /** Palette label. Editor is a dev tool, so this stays untranslated. */
  label: string
  category: PlaceableCategory
  asset: WorldAsset
  collider: ColliderShape
  /**
   * The collider's top face is standable. Platforms and slabs are; a spire the
   * player should only ever bump into is not.
   */
  walkable: boolean
  /**
   * Y offset applied at placement so the visual sits on the ground rather than
   * hovering or sinking. Positive lifts.
   */
  groundOffset?: number
  defaultScale?: number
  /** Suggested random scale spread for scatter placement. */
  scaleRange?: [number, number]
}

/** One placed instance. This is what gets persisted and exported. */
export interface Placement {
  /** Unique per instance, so the editor can address one without index drift. */
  id: string
  defId: string
  x: number
  y: number
  z: number
  rotY: number
  scale: number
}

/** What the player controller queries. Implemented by the level store. */
export interface CollisionWorld {
  /** Ground height under a point, terrain and walkable prop tops included. */
  groundHeightAt(x: number, z: number, fromY: number): number
  /**
   * Resolves a horizontal move against blocking props. Returns the allowed
   * position; may slide along a surface rather than stopping dead.
   */
  resolveMove(fromX: number, fromZ: number, toX: number, toZ: number, radius: number, y: number): { x: number; z: number }
}
