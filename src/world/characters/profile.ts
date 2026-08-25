import { type CharacterAppearance, DEFAULT_APPEARANCE, type EquipmentLoadout, EMPTY_LOADOUT } from './equipment'

/**
 * ─── A saved character ──────────────────────────────────────────────────────
 *
 * Everything that makes one person: who they look like, what they are wearing,
 * and what to call them. `CharacterAppearance` and `EquipmentLoadout` already
 * existed and are unchanged — this is the envelope that lets a *set* of them be
 * stored, listed and reloaded for editing.
 *
 * ── Why `id` is not the name ────────────────────────────────────────────────
 *
 * The user asked for both a name and an id, and they do different jobs. The
 * **name** is what a player types and may change their mind about, may reuse,
 * and may leave blank. The **id** is what a save file, a quest, a dialogue line
 * and a spawn table refer to — so it must be stable across renames and unique
 * across the roster. Storing one field and deriving the other looks tidy right
 * up until somebody renames a character and every reference to them breaks.
 *
 * The id is therefore generated once, at creation, and never rewritten. It is
 * slug-shaped rather than a UUID because it shows up in hand-authored data (a
 * spawn table, a quest script) where `blacksmith-2` is legible and
 * `f47ac10b-58cc` is not.
 */

export interface CharacterProfile {
  /** Stable, unique, generated once. Never rewritten by a rename. */
  id: string
  /** Free text the player typed. May be empty; may collide with another. */
  name: string
  appearance: CharacterAppearance
  loadout: EquipmentLoadout
  /** Epoch millis, for ordering the roster. Not shown as a date. */
  updatedAt: number
}

/** Characters are keyed by id, and the order they were last edited in. */
export interface CharacterRoster {
  profiles: CharacterProfile[]
  /** The id currently open in the creator, or null for an unsaved draft. */
  activeId: string | null
}

export const MAX_NAME_LENGTH = 32

/**
 * Slug from a name, with a numeric suffix only when it has to disambiguate.
 *
 * Deterministic given the name and the ids already taken, so a test can assert
 * it rather than mocking a clock or a random source. An empty or
 * punctuation-only name falls back to `character`, because an id of `''` is a
 * lookup that silently matches nothing.
 */
export const makeCharacterId = (name: string, taken: readonly string[]): string => {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, MAX_NAME_LENGTH) || 'character'
  if (!taken.includes(base)) {
    return base
  }
  let suffix = 2
  while (taken.includes(`${base}-${suffix}`)) {
    suffix++
  }
  return `${base}-${suffix}`
}

export const emptyProfile = (id: string, name = ''): CharacterProfile => ({
  id,
  name,
  appearance: { ...DEFAULT_APPEARANCE },
  loadout: { ...EMPTY_LOADOUT },
  updatedAt: 0
})
