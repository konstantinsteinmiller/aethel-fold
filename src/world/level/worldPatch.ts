import type { Placement } from './types'
import type { ScatterKey } from './scatterOverrides'

/**
 * ─── World patches ──────────────────────────────────────────────────────────
 *
 * A distributable record of what the level editor changed, in two halves:
 *
 *   * **`placements`** — props the user put down (or moved), as ordinary
 *     `Placement`s.
 *   * **`removedScatter`** — tombstones for procedural props they deleted.
 *
 * Both are deltas against a baseline, which is what makes a patch small enough
 * to commit and to hand to someone else. The baseline for scatter is the
 * generator itself: the seed *is* the shipped world, so a tombstone list is
 * already a diff with nothing to compare against.
 *
 * ── Why an export needs a diff at all ───────────────────────────────────────
 *
 * The obvious export is "write out every placement". That works exactly once.
 * The second time, the file contains the shipped starting level *plus* the
 * user's additions, so applying it on top of a world that already seeds the
 * starting level duplicates every prop in it. `diffPlacements` is what keeps a
 * patch idempotent — apply it twice and you get the same world.
 *
 * ── What the baseline is, exactly ───────────────────────────────────────────
 *
 * **`STARTING_PROPS` alone — never the starting level *plus* the current
 * patch.** This is subtle, and it is the difference between a patch that
 * accumulates and one that quietly eats its own history. Diff against "starting
 * level + patch" and everything the patch already contains compares equal, so
 * the next export writes only what changed *since* that patch — and since the
 * export replaces the file wholesale, the previous session's work vanishes from
 * it. Diffing against the starting level alone means the patch always restates
 * everything it is responsible for, which is what makes overwriting it safe.
 *
 * ── Three kinds of change, and why a move needs two entries ─────────────────
 *
 * `placements` adds props; `removedPlacements` suppresses starting props. A
 * *move* is both: without the removal half, the original starting prop is still
 * seeded on a fresh install and the moved copy simply appears next to it.
 *
 * ── Two modes, and the honest difference ────────────────────────────────────
 *
 * `delta` is the patch: what changed against the shipped defaults. `full` is
 * the whole scene as a replacement for the defaults themselves — it suppresses
 * every starting prop and lists the scene instead. Delta is what you
 * distribute; full is what you use when you have redesigned the level and want
 * to *become* the new baseline.
 */

export interface WorldPatch {
  /** Bumped when the format changes, so a loader can refuse what it can't read. */
  version: number
  /**
   * Props the patch adds, in their final transforms.
   *
   * Without ids: those are minted per browser by the editor, so shipping them
   * would put one machine's bookkeeping in a file every machine reads, and churn
   * the diff on every re-export. `seedLevel` mints fresh ones on the way in.
   */
  placements: PlacementLike[]
  /**
   * Starting-level props the patch takes away.
   *
   * Matched by transform at seed time, so this is how a patch says "the shipped
   * platform at (14, -14) should not be there" — and, paired with an entry in
   * `placements`, how it says a prop *moved*.
   */
  removedPlacements: PlacementLike[]
  /** Procedural instances the patch deletes. */
  removedScatter: ScatterKey[]
  /**
   * The crowd, as a whole list rather than a diff.
   *
   * ── Why this one is not a delta ─────────────────────────────────────────────
   *
   * Every other field here is a diff because there is a *shipped baseline* to
   * diff against — `buildStartingLevel` puts props in the world before any
   * patch is applied. There is no starting crowd: a fresh install has nobody in
   * it, so "what changed" and "who is there" are the same list, and expressing
   * it as a diff would be a `removedNpcs` array that is always empty.
   *
   * Optional, so `worldPatch.generated.ts` files written before the crowd
   * existed still typecheck and still load. Absent means "no NPCs in this
   * patch", which is exactly what those files meant.
   */
  npcs?: NpcPatchEntry[]
  /**
   * Ponds, seas and rivers, as a whole list — the same argument as `npcs`.
   *
   * There is no shipped baseline of water to diff against: a fresh install has
   * none, so "what changed" and "what is there" are the same list. Optional for
   * the same reason too — a `worldPatch.generated.ts` written before water was
   * in the world still typechecks and still loads.
   *
   * Style *tuning* is deliberately not in here. A retuned `waveAmplitude` is a
   * change to the presets in `styles.ts`, not to a placement, and folding the
   * two together would produce a file that neither a seed nor a code review
   * could consume. The panel logs tuned values separately for pasting back.
   */
  water?: WaterPatchEntry[]
}

/**
 * One body of water, as it ships.
 *
 * Structurally a `WaterPlacement`, restated here rather than imported so the
 * patch schema does not move every time the water module's internals do — this
 * file is a wire format, and a wire format that follows a refactor is a wire
 * format that breaks saved data. `normaliseWaterPlacement` is what reads it back
 * and is total, so a mismatch costs a dropped body rather than a boot failure.
 */
export interface WaterPatchEntry {
  id: string
  kind: string
  styleId: string
  x: number
  y: number
  z: number
  rotY: number
  halfX: number
  halfZ: number
  nodes: { x: number; y: number; z: number; halfWidth: number }[]
}

/**
 * One spawned villager, as it ships.
 *
 * Without an id, for the same reason `PlacementLike` has none: ids are minted
 * per browser and shipping them would put one machine's bookkeeping in a file
 * every machine reads, and churn the diff on every re-export.
 */
export interface NpcPatchEntry {
  profession: string
  x: number
  y: number
  z: number
  facingDeg: number
  seed: number
}

export const WORLD_PATCH_VERSION = 1

export type PatchMode = 'delta' | 'full'

/**
 * A placement without the `id`.
 *
 * The baseline is a *seed* list — the props the world lays down on a fresh
 * install — and those have no ids until the editor mints them. Ids are also the
 * one field a diff must never look at: they are minted per browser, so two users
 * who placed the same prop hold different ids for it.
 */
export type PlacementLike = Omit<Placement, 'id'>

export interface PlacementDiff {
  /** Live props that are not in the baseline. */
  added: Placement[]
  /**
   * Props in both lists that are not in the same place.
   *
   * Both halves are kept: `from` is the baseline entry the patch has to
   * suppress, `to` is where the prop ended up. Reporting only `to` is the bug
   * that leaves the original standing beside the copy on a fresh install.
   */
  moved: { from: PlacementLike; to: Placement }[]
  /** Baseline props that are no longer live. */
  deleted: PlacementLike[]
}

/** Rounded so a prop nudged by a float epsilon is not reported as moved. */
const r3 = (value: number): number => Math.round(value * 1000) / 1000

/** Same prop, same place? Compared on the transform, not on an id. */
const sameTransform = (a: PlacementLike, b: PlacementLike): boolean =>
  a.defId === b.defId &&
  r3(a.x) === r3(b.x) &&
  r3(a.y) === r3(b.y) &&
  r3(a.z) === r3(b.z) &&
  r3(a.rotY) === r3(b.rotY) &&
  r3(a.scale) === r3(b.scale)

/**
 * Classifies a live placement list against a baseline.
 *
 * Matching is by **transform**, not by `id`. Placement ids are minted locally
 * and persisted per browser, so they are stable for one user and meaningless
 * across two — which is precisely the case a distributable patch has to serve.
 * A prop that has not moved compares equal wherever it was authored.
 *
 * Pure, and the single source of the added/moved/deleted classification shared
 * by the export and by anything that later wants to show the user what their
 * patch contains.
 */
export const diffPlacements = (live: readonly Placement[], baseline: readonly PlacementLike[]): PlacementDiff => {
  const added: Placement[] = []
  const moved: { from: PlacementLike; to: Placement }[] = []
  const deleted: PlacementLike[] = []

  const unmatched = new Set(baseline)

  for (const placement of live) {
    let exact: PlacementLike | null = null
    for (const candidate of unmatched) {
      if (sameTransform(placement, candidate)) {
        exact = candidate
        break
      }
    }
    if (exact) {
      // Unchanged: in the baseline already, so a delta must not carry it.
      unmatched.delete(exact)
      continue
    }

    // Not an exact match. If a baseline prop of the same kind is unaccounted
    // for nearby, call it a move rather than an add-plus-delete — that keeps a
    // nudged prop one line in the patch instead of two.
    let nearest: PlacementLike | null = null
    let nearestDistance = MOVE_RADIUS_SQUARED
    for (const candidate of unmatched) {
      if (candidate.defId !== placement.defId) {
        continue
      }
      const dx = candidate.x - placement.x
      const dy = candidate.y - placement.y
      const dz = candidate.z - placement.z
      const distance = dx * dx + dy * dy + dz * dz
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = candidate
      }
    }

    if (nearest) {
      unmatched.delete(nearest)
      moved.push({ from: nearest, to: placement })
    } else {
      added.push(placement)
    }
  }

  for (const remaining of unmatched) {
    deleted.push(remaining)
  }

  return { added, moved, deleted }
}

/**
 * How far a prop can travel and still be called *moved* rather than deleted and
 * re-added. Beyond this it is a different prop in a different place, and saying
 * so keeps the patch honest about what happened.
 */
const MOVE_RADIUS_SQUARED = 12 * 12

export interface BuildPatchInput {
  live: readonly Placement[]
  /** What the world seeds when a save is empty — the shipped starting level. */
  baseline: readonly PlacementLike[]
  removedScatter: readonly ScatterKey[]
  /** The whole crowd. See `WorldPatch.npcs` for why it is not a diff. */
  npcs?: readonly NpcPatchEntry[]
  /** Every body of water. Not a diff, for the same reason. */
  water?: readonly WaterPatchEntry[]
  mode: PatchMode
}

export interface BuiltPatch {
  patch: WorldPatch
  added: number
  moved: number
  deleted: number
  removedScatter: number
  npcs: number
  water: number
}

/** Stable order, so a re-export with nothing changed produces no diff. */
const compareNpcs = (a: NpcPatchEntry, b: NpcPatchEntry): number =>
  a.profession.localeCompare(b.profession) || a.x - b.x || a.z - b.z || a.seed - b.seed

export const buildWorldPatch = (input: BuildPatchInput): BuiltPatch => {
  const { live, baseline, removedScatter, npcs = [], water = [], mode } = input
  const crowd = [...npcs].sort(compareNpcs)
  // Already sorted by `WaterEditor.snapshot`, copied so the patch cannot alias
  // the editor's own array.
  const bodies = [...water]

  if (mode === 'full') {
    // The whole scene *as* the baseline: suppress every starting prop, then
    // list what is actually there. Seeding that gives back exactly `live`,
    // whatever the starting level happens to contain.
    return {
      patch: {
        version: WORLD_PATCH_VERSION,
        placements: [...live].sort(comparePlacements),
        removedPlacements: [...baseline].sort(comparePlacements),
        removedScatter: [...removedScatter].sort(),
        npcs: crowd,
        water: bodies
      },
      added: live.length,
      moved: 0,
      deleted: baseline.length,
      removedScatter: removedScatter.length,
      npcs: crowd.length,
      water: bodies.length
    }
  }

  const diff = diffPlacements(live, baseline)
  return {
    patch: {
      version: WORLD_PATCH_VERSION,
      placements: [...diff.added, ...diff.moved.map(entry => entry.to)].sort(comparePlacements),
      // A move contributes to both halves — see the note on `PlacementDiff`.
      removedPlacements: [...diff.deleted, ...diff.moved.map(entry => entry.from)].sort(comparePlacements),
      removedScatter: [...removedScatter].sort(),
      npcs: crowd,
      water: bodies
    },
    added: diff.added.length,
    moved: diff.moved.length,
    deleted: diff.deleted.length,
    removedScatter: removedScatter.length,
    npcs: crowd.length,
    water: bodies.length
  }
}

/**
 * The prop list a world should seed, given its starting level and a patch.
 *
 * The single place the patch's two placement halves are interpreted, so the
 * boot path and every test agree by construction on what "applying a patch"
 * means. Matching is the same transform comparison the diff uses, which is what
 * closes the round trip: the export writes the baseline entry verbatim, and
 * this finds it again.
 */
export const applyPatchToBaseline = (
  baseline: readonly PlacementLike[],
  patch: Pick<WorldPatch, 'placements' | 'removedPlacements'>
): PlacementLike[] => {
  const kept: PlacementLike[] = []
  // Consumed one at a time: two identical starting props and one removal entry
  // must take away one of them, not both.
  const removals = [...patch.removedPlacements]
  for (const prop of baseline) {
    const at = removals.findIndex(removed => sameTransform(prop, removed))
    if (at >= 0) {
      removals.splice(at, 1)
      continue
    }
    kept.push(prop)
  }
  return [...kept, ...patch.placements]
}

/** Stable ordering, so re-exporting an unchanged world produces no diff. */
const comparePlacements = (a: PlacementLike, b: PlacementLike): number =>
  a.defId === b.defId ? (a.x === b.x ? a.z - b.z : a.x - b.x) : a.defId < b.defId ? -1 : 1

/**
 * Renders a patch as a TypeScript module.
 *
 * Source rather than JSON because it is meant to be committed: a `.ts` file
 * type-checks against `WorldPatch` at build time, so a patch that has drifted
 * from the format fails `pnpm type-check` instead of failing silently at
 * runtime in whatever browser loaded it.
 *
 * Numbers are rounded to millimetres. A raw float64 transform is 17 significant
 * digits of noise per axis in a file humans are supposed to review.
 */
export const formatWorldPatch = (built: BuiltPatch, mode: PatchMode): string => {
  const { patch } = built
  const lines: string[] = []

  lines.push('/**')
  lines.push(' * Generated by the in-game level editor. Do not edit by hand.')
  lines.push(' *')
  lines.push(
    mode === 'delta'
      ? ' * A **delta** against the shipped starting level: only what changed.'
      : ' * A **full** scene, intended to replace the shipped starting level.'
  )
  lines.push(' *')
  lines.push(` * ${built.added} added · ${built.moved} moved · ${built.deleted} deleted`)
  lines.push(` * ${built.removedScatter} scattered prop(s) removed`)
  lines.push(` * ${built.npcs} NPC spawn(s) · ${built.water} body(s) of water`)
  lines.push(' */')
  lines.push("import type { WorldPatch } from './worldPatch'")
  lines.push('')
  lines.push('export const WORLD_PATCH: WorldPatch = {')
  lines.push(`  version: ${patch.version},`)

  lines.push('  placements: [')
  for (const placement of patch.placements) {
    lines.push(
      `    { defId: ${JSON.stringify(placement.defId)}, ` +
        `x: ${r3(placement.x)}, y: ${r3(placement.y)}, z: ${r3(placement.z)}, ` +
        `rotY: ${r3(placement.rotY)}, scale: ${r3(placement.scale)} },`
    )
  }
  lines.push('  ],')

  lines.push('  removedPlacements: [')
  for (const placement of patch.removedPlacements) {
    lines.push(
      `    { defId: ${JSON.stringify(placement.defId)}, ` +
        `x: ${r3(placement.x)}, y: ${r3(placement.y)}, z: ${r3(placement.z)}, ` +
        `rotY: ${r3(placement.rotY)}, scale: ${r3(placement.scale)} },`
    )
  }
  lines.push('  ],')

  lines.push('  removedScatter: [')
  for (const key of patch.removedScatter) {
    lines.push(`    ${JSON.stringify(key)},`)
  }
  lines.push('  ],')

  lines.push('  npcs: [')
  for (const npc of patch.npcs ?? []) {
    lines.push(
      `    { profession: ${JSON.stringify(npc.profession)}, ` +
        `x: ${r3(npc.x)}, y: ${r3(npc.y)}, z: ${r3(npc.z)}, ` +
        `facingDeg: ${r3(npc.facingDeg)}, seed: ${npc.seed} },`
    )
  }
  lines.push('  ],')

  lines.push('  water: [')
  for (const body of patch.water ?? []) {
    const nodes = body.nodes
      .map(node => `{ x: ${r3(node.x)}, y: ${r3(node.y)}, z: ${r3(node.z)}, halfWidth: ${r3(node.halfWidth)} }`)
      .join(', ')
    lines.push(
      `    { id: ${JSON.stringify(body.id)}, kind: ${JSON.stringify(body.kind)}, ` +
        `styleId: ${JSON.stringify(body.styleId)}, ` +
        `x: ${r3(body.x)}, y: ${r3(body.y)}, z: ${r3(body.z)}, rotY: ${r3(body.rotY)}, ` +
        `halfX: ${r3(body.halfX)}, halfZ: ${r3(body.halfZ)}, nodes: [${nodes}] },`
    )
  }
  lines.push('  ]')
  lines.push('}')
  lines.push('')

  return lines.join('\n')
}
