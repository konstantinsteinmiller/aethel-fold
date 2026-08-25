/**
 * ─── Editing a procedural world ─────────────────────────────────────────────
 *
 * Trees, boulders and stones are not authored — they are a function of the
 * terrain seed, generated per chunk, streamed, and instanced. There are roughly
 * 20 000 of them resident at any moment and the set changes as you walk.
 *
 * Making each one an editor `Placement` so it could be moved or deleted is the
 * obvious reading of "everything should be editable" and it does not survive
 * contact with the numbers: 20 000 placements is a save file measured in
 * megabytes, a collider rebuild over the whole list whenever anything changes,
 * and a per-chunk streaming system whose contents are suddenly global state.
 *
 * So the world stays procedural and the editor keeps a **sparse override
 * layer** on top of it:
 *
 *   * **Tombstones.** A deleted scatter instance is remembered by key. The
 *     generator still produces it; the chunk loader filters it out.
 *   * **Additions.** A *moved* scatter prop is a tombstone plus an ordinary
 *     editor placement at the new spot, which is a thing the editor already
 *     knows how to store, render, collide and export.
 *
 * The override set is only as large as what the user actually changed — which
 * is also exactly the shape of a distributable world patch, so the same data
 * structure serves the editor, the save file and the export.
 *
 * ── Keys have to survive regeneration ───────────────────────────────────────
 *
 * A tombstone is useless if it cannot find its instance again after the chunk
 * unloads and comes back. An index into the generator's output would be
 * fragile — it depends on iteration order, rejection tests and the RNG. The key
 * is the **species plus the position, quantised to a centimetre**, because that
 * is what the generator is a function *of*: same seed, same terrain, same
 * position, forever.
 *
 * It does not survive a change to the terrain seed or a species' spacing. That
 * is correct and unavoidable — those regenerate the world, and a tombstone for
 * a tree that no longer exists should be dropped, not honoured somewhere else.
 */

/** Quantisation of the position half of a key, in units per metre. */
const KEY_PRECISION = 100

export type ScatterKey = string

/**
 * Stable identity for one scattered instance.
 *
 * `species` is the field's tag plus its variant index — two oaks from different
 * seeds can stand at the same spot in different chunks and must not share a
 * tombstone.
 */
export const scatterKey = (species: string, x: number, z: number): ScatterKey =>
  `${species}:${Math.round(x * KEY_PRECISION)}:${Math.round(z * KEY_PRECISION)}`

export interface ScatterOverrideData {
  /** Keys of scatter instances the editor has deleted. */
  removed: ScatterKey[]
}

const EMPTY: readonly ScatterKey[] = []

export class ScatterOverrides {
  private readonly removed = new Set<ScatterKey>()
  private revisionCounter = 0

  /**
   * A set restored from this browser's storage.
   *
   * A named constructor rather than a `load()` call at the end of `World`'s
   * constructor, because the chunk-load hook that consumes it can fire before
   * that constructor finishes — and a deletion that only takes effect from the
   * *second* chunk load looks exactly like a deletion that did not persist.
   * Field initialisers run first, so `= ScatterOverrides.restore()` cannot be
   * ordered wrongly.
   */
  static restore(): ScatterOverrides {
    const overrides = new ScatterOverrides()
    overrides.load(loadScatterOverrides())
    return overrides
  }

  /** Bumped on every change, so the world knows to re-apply. */
  get revision(): number {
    return this.revisionCounter
  }

  get removedCount(): number {
    return this.removed.size
  }

  isRemoved(key: ScatterKey): boolean {
    return this.removed.size > 0 && this.removed.has(key)
  }

  /** Returns false if it was already tombstoned. */
  remove(key: ScatterKey): boolean {
    if (this.removed.has(key)) {
      return false
    }
    this.removed.add(key)
    this.revisionCounter++
    return true
  }

  restore(key: ScatterKey): boolean {
    if (!this.removed.delete(key)) {
      return false
    }
    this.revisionCounter++
    return true
  }

  clear(): void {
    if (this.removed.size === 0) {
      return
    }
    this.removed.clear()
    this.revisionCounter++
  }

  /** Sorted, so an export is stable and diffs cleanly in review. */
  list(): ScatterKey[] {
    return this.removed.size === 0 ? (EMPTY as ScatterKey[]) : [...this.removed].sort()
  }

  toJSON(): ScatterOverrideData {
    return { removed: this.list() }
  }

  /** Replaces the whole set. Used by load and by an applied world patch. */
  load(data: ScatterOverrideData | null | undefined): void {
    this.removed.clear()
    if (data?.removed) {
      for (const key of data.removed) {
        if (typeof key === 'string' && key.length > 0) {
          this.removed.add(key)
        }
      }
    }
    this.revisionCounter++
  }

  /**
   * Merges another set in, rather than replacing.
   *
   * This is how a shipped world patch composes with a player's own edits: the
   * patch's deletions apply, and anything the player deleted locally stays
   * deleted. Tombstones only ever add, so the merge cannot conflict.
   */
  merge(data: ScatterOverrideData | null | undefined): number {
    let added = 0
    for (const key of data?.removed ?? []) {
      if (typeof key === 'string' && key.length > 0 && !this.removed.has(key)) {
        this.removed.add(key)
        added++
      }
    }
    if (added > 0) {
      this.revisionCounter++
    }
    return added
  }
}

/**
 * ─── Storage ────────────────────────────────────────────────────────────────
 *
 * Free functions rather than methods, so `ScatterOverrides` itself stays a pure
 * data structure that a test can drive without a DOM. Guarded because
 * `localStorage` throws outright in a sandboxed iframe, which several of the
 * portals this ships to serve games from.
 */
const STORAGE_KEY = 'world.scatterOverrides.v1'

export const loadScatterOverrides = (): ScatterOverrideData | null => {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as ScatterOverrideData
    return Array.isArray(parsed?.removed) ? parsed : null
  } catch {
    // Corrupt or unreadable. A world with no overrides is a valid world; a
    // thrown exception at boot is not.
    return null
  }
}

export const saveScatterOverrides = (data: ScatterOverrideData): void => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    }
  } catch {
    // Storage full or blocked. The edit still applies this session.
  }
}
