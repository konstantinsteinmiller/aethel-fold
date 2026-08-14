import type { LevelSeed } from '../editor'

/**
 * ─── The starting level ─────────────────────────────────────────────────────
 *
 * A small hand-placed arrangement seeded on a fresh install, so booting the
 * world shows what the new asset family is *for* — a traversal route built out
 * of platforms — instead of an empty meadow with a palette hidden behind a code
 * word.
 *
 * It is seeded, not shipped: `seedLevel` runs with `onlyIfEmpty`, so the moment
 * anyone edits anything this becomes their level and is never re-applied. There
 * is deliberately no defaults/tombstone layer (see the editor's notes) — once
 * placed, these are ordinary placements: movable, deletable, exportable.
 *
 * Coordinates are world-space XZ; **Y is resolved against the terrain at seed
 * time**, so this survives a heightfield change instead of leaving props
 * hovering. Anything meant to float (a stepping stone over a gap) carries an
 * explicit `y` offset and says so.
 */

export interface StartingProp {
  defId: string
  x: number
  z: number
  /** Metres above the terrain. Omit to sit flush. */
  lift?: number
  rotY?: number
  scale?: number
}

/**
 * Laid out around the spawn point at (-38, 26) and reading roughly north-east:
 * a low stepping route rising onto a plateau, with spires framing it. Spacing is
 * tuned to the player's 0.4 m step-up and jump arc, so the route is walkable
 * without any of it being a puzzle.
 */
export const STARTING_PROPS: StartingProp[] = [
  // ── The approach: low slabs stepping up out of the meadow ────────────────
  { defId: 'slab-step', x: -30, z: 16, rotY: 0.2, scale: 1.0 },
  { defId: 'slab-step', x: -26, z: 12, rotY: -0.35, scale: 1.15 },
  { defId: 'slab-block', x: -21, z: 8, rotY: 0.6, scale: 1.1 },

  // ── The first platform, low enough to walk onto from the slabs ───────────
  { defId: 'grass-rock', x: -15, z: 3, rotY: 1.1, scale: 1.3 },
  { defId: 'plateau-wide', x: -6, z: -3, rotY: 0.4, scale: 1.0 },

  // ── A gap, then the tall plateau — this one needs the jump ───────────────
  { defId: 'basalt-cluster', x: 4, z: -9, rotY: 2.2, scale: 1.0 },
  { defId: 'plateau-tall', x: 14, z: -14, rotY: -0.8, scale: 0.95 },

  // ── Framing: spires the route threads between, not onto ──────────────────
  { defId: 'cliff-spire', x: -24, z: -12, rotY: 1.4, scale: 1.0 },
  { defId: 'cliff-crown', x: 24, z: 4, rotY: -2.1, scale: 0.9 },
  { defId: 'cliff-spire', x: 8, z: 22, rotY: 0.7, scale: 0.75 },

  // ── Scatter dressing, so the built route doesn't read as a floating set ──
  { defId: 'grass-rock', x: -33, z: 6, rotY: 2.8, scale: 0.7 },
  { defId: 'slab-block', x: 0, z: 12, rotY: 1.9, scale: 0.8 },
  { defId: 'basalt-cluster', x: -12, z: -20, rotY: 0.3, scale: 0.75 }
]

/**
 * Resolves the layout against the terrain. Kept separate from the table so the
 * table stays readable as a level design rather than as a list of magic Ys.
 */
export const buildStartingLevel = (heightAt: (x: number, z: number) => number): LevelSeed[] =>
  STARTING_PROPS.map(prop => ({
    defId: prop.defId,
    x: prop.x,
    y: heightAt(prop.x, prop.z) + (prop.lift ?? 0),
    z: prop.z,
    rotY: prop.rotY ?? 0,
    scale: prop.scale ?? 1
  }))
