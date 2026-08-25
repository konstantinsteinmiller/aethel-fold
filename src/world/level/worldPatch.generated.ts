import type { WorldPatch } from './worldPatch'

/**
 * ─── The shipped world patch ────────────────────────────────────────────────
 *
 * Written by the in-game level editor's **Export to code**, which POSTs to the
 * dev server and replaces this file wholesale. Committed empty so the import
 * always resolves and the export has somewhere to land — a generated file that
 * only exists after someone has run the tool is a broken checkout for everyone
 * who has not.
 *
 * It layers on top of `STARTING_PROPS` to make the world a fresh install boots
 * into:
 *
 *   * `removedPlacements` takes starting props away, matched by transform.
 *   * `placements` adds props, seeded alongside whatever is left.
 *   * `removedScatter` merges into the override set on **every** boot, since
 *     tombstones only ever add and so cannot clobber a player's own edits.
 *
 * The export diffs against `STARTING_PROPS` alone — never against this file — so
 * a patch always restates everything it is responsible for. That is what makes
 * overwriting it safe, and what makes the round trip idempotent: export, commit,
 * reboot, export again, and the file is unchanged.
 *
 * Edit by hand only to *revert* something — the next export overwrites it.
 */
export const WORLD_PATCH: WorldPatch = {
  version: 1,
  placements: [],
  removedPlacements: [],
  removedScatter: []
}
