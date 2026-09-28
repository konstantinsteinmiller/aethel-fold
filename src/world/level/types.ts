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

export type PlaceableCategory = 'platform' | 'cliff' | 'desert' | 'rock' | 'flora' | 'water' | 'village'

export const PLACEABLE_CATEGORY_ORDER: PlaceableCategory[] = [
  'platform',
  'cliff',
  'desert',
  'rock',
  'flora',
  'water',
  'village'
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
  water: 'Water',
  // Nimmerschein: houses, the palisade, the bridge over the Arla, and the yard
  // clutter between them. Its own section rather than folded into `platform`
  // because a designer laying out a village is not reaching for a plateau — and
  // because a house is the only thing in the catalogue whose *orientation* is
  // meaningful: a cottage placed with its door into the palisade is wrong in a
  // way a rock never is.
  village: 'Village'
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
  /**
   * Metres above the ground the placement resolves to. Optional, and **never
   * written by the editor** — it exists for hand-authored levels.
   *
   * `startingLevel.ts` has carried the same idea since the first sandbox layout
   * (a stepping stone over a gap needs an explicit height), and a chapter needs
   * it for a different reason: a jug of wine stands *on a table*, and a table
   * stands on a floor that itself stands 10 cm proud of the terrain. Without it
   * the only way to put an object on another object is to bake the offset into
   * the model, which makes the model unusable anywhere else.
   */
  lift?: number
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
  /**
   * How far a straight 3D segment gets before it enters a blocking prop.
   *
   * Returns a fraction of the segment in `[0, 1]`; **1 means nothing is in the
   * way**. Walkable props are ignored — you can see over a bridge deck.
   *
   * ── Why this exists next to `resolveMove` ────────────────────────────────
   *
   * `resolveMove` *slides*, which is right for a character and useless for a
   * line of sight: a sweep that meets a wall comes back the same distance from
   * where it started, just displaced along the wall, so "how far did I get"
   * always answers "all the way". Measured in the storyteller's hut — sweeping
   * 6 m out from the fireside in sixteen directions returned a reach of ~6 m in
   * every one of them, inside a room four metres across.
   *
   * That is what put the dialogue camera outside the building: its spring arm
   * asked `resolveMove` where the wall was and was told there wasn't one.
   */
  segmentHit(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number
}
