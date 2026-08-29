import { copyAppearance, loadAppearance, sanitiseAppearance } from './appearance'
import { DEFAULT_APPEARANCE, EQUIP_SLOTS, type CharacterAppearance, type EquipmentLoadout } from './equipment'
import { ITEM_KINDS, copyLoadout, emptyLoadout, sanitiseInventory } from './inventory'
import {
  MAX_NAME_LENGTH,
  emptyProfile,
  makeCharacterId,
  type CharacterProfile,
  type CharacterRoster
} from './profile'

/**
 * ─── The roster: several saved characters, one open at a time ───────────────
 *
 * `profile.ts` defines what one character *is* and why its `id` is not its
 * `name`. This is the set of them: list, open, save, rename, duplicate, delete,
 * and remember which one the creation screen currently has loaded.
 *
 * Plain TypeScript, exactly like `inventory.ts`: no three.js, no Vue, no scene.
 * The screen holds copies of what it reads here and hands copies back, so a
 * reactive proxy can never reach `src/world/` (GDD §0). Every accessor below
 * therefore returns a **fresh object**, and every mutator **copies field by
 * field** out of what it is given.
 *
 * ── The id is not editable, and that is the whole design ────────────────────
 *
 * The player types a *name*. The id is derived from that name once, at creation,
 * by `makeCharacterId`, and is then frozen: `rename` changes the name and leaves
 * the id exactly where it was. Nothing in this file can rewrite an id.
 *
 * The argument for letting a player edit it is real — ids show up in
 * hand-authored data, and an author who ends up with `character-4` would like to
 * type `blacksmith` instead. It loses to the argument against, which is that a
 * save file, a quest, a dialogue line and a spawn table all refer to a character
 * *by id*: an editable id is a rename that silently breaks every one of those
 * references, with no error, no test that can see it, and a failure that shows up
 * as an NPC who has forgotten who you are. So the id is read-only and legibility
 * is bought a different way — it is a slug of the name, so naming a character
 * "Blacksmith" *is* how you get the id `blacksmith`, and a player who wants a
 * different id duplicates the character (a duplicate is a new profile, so its new
 * id is referenced by nothing yet) and deletes the original.
 *
 * ── Loading is total ────────────────────────────────────────────────────────
 *
 * Every path through `sanitiseRoster` produces a usable roster. A malformed,
 * truncated or older blob yields fewer characters, or none, but never a throw:
 * a creation screen that will not open because of a key from an older build is a
 * far worse failure than a player finding one character missing. This is the same
 * rule `sanitiseAppearance` and `sanitiseInventory` are written to, and both are
 * *reused* here rather than reimplemented — a second appearance sanitiser would
 * be a second thing to update the next time the unions grow.
 */

/** What the screen edits, and what `create` / `update` are handed. */
export interface ProfileDraft {
  name: string
  appearance: CharacterAppearance
  loadout: EquipmentLoadout
}

/**
 * Its own key.
 *
 * Not the appearance's `world.characterAppearance.v1`, not the inventory's
 * `world.characterInventory.v1`, not the level editor's `world_editor_*`, not
 * the sculptor's `world_sculpt_delta`. Those are either owner-only dev state a
 * player must never inherit, or a *different* piece of player state with its own
 * lifetime — the appearance key is still what says "this is the character you
 * play as", and the roster is the set you can choose that from. Sharing a key
 * means whichever writes last wins, silently.
 */
export const ROSTER_KEY = 'world.characterRoster.v1'

/**
 * A ceiling on how many characters a blob may contain.
 *
 * Not a design limit — nobody is going to hand-make sixty-four characters on a
 * turntable — but a bound on what a corrupt or hostile `localStorage` value can
 * make this screen do before it draws its first frame. Truncating is the total
 * behaviour; refusing to open is not.
 */
export const MAX_PROFILES = 64

/**
 * Collapses whitespace, trims, and caps the length.
 *
 * Applied when a name is *committed*, never on every keystroke: collapsing runs
 * of spaces while somebody is typing eats the space between two words the moment
 * they press it, and an input that fights the person using it is worse than a
 * name with a double space in it.
 */
export const sanitiseName = (raw: unknown): string =>
  typeof raw === 'string'
    ? raw
        // Control and format characters as well as whitespace: a newline pasted
        // out of a document renders as nothing inside a one-line <option> and
        // turns two names into what looks like one.
        .replace(/\p{C}/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_NAME_LENGTH)
    : ''

/**
 * Repairs a loadout, by asking `inventory.ts` rather than by re-deriving its
 * rules.
 *
 * `sanitiseInventory` is the total repair path for a loadout — it drops items
 * that are in the wrong slot and settles an illegal drawn state back to
 * `sheathed` — but it also requires ownership, because out in the world a
 * loadout that resurrects gear the player never had is a bug. On this screen
 * there is no ownership: the creator dresses the figure in anything so the player
 * can judge the silhouette, and `CreatorScene.setLoadout` is explicit that this
 * grants nothing. So it is handed the full kind list as "owned" and the ownership
 * clause becomes a no-op, leaving exactly the slot and drawn-state rules —
 * reused, not copied.
 */
export const sanitiseLoadout = (raw: unknown): EquipmentLoadout =>
  sanitiseInventory({ owned: ITEM_KINDS, loadout: raw }).loadout

export const loadoutEquals = (a: EquipmentLoadout, b: EquipmentLoadout): boolean =>
  a.drawn === b.drawn && EQUIP_SLOTS.every(slot => a[slot] === b[slot])

/** A deep-enough copy: every field is a primitive or null. */
export const copyProfile = (profile: CharacterProfile): CharacterProfile => ({
  id: profile.id,
  name: profile.name,
  appearance: copyAppearance(profile.appearance),
  loadout: copyLoadout(profile.loadout),
  updatedAt: profile.updatedAt
})

const finiteTime = (raw: unknown): number =>
  typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0

/**
 * Repairs one stored profile.
 *
 * `taken` is the set of ids already claimed by the profiles ahead of this one in
 * the same blob, so a file that somehow contains two `blacksmith`s yields two
 * characters rather than one that shadows the other — which is the shape of
 * corruption a half-finished write produces, and the shape in which "load
 * everything" and "keep ids unique" actually conflict.
 *
 * A stored id is kept **unchanged whenever it is still legal and free**:
 * `makeCharacterId('blacksmith', taken)` is `blacksmith`. It is only rewritten
 * when it is missing, empty, not slug-shaped, or already taken — the four cases
 * where keeping it would mean an id that cannot be looked up.
 */
export const sanitiseProfile = (raw: unknown, taken: readonly string[] = []): CharacterProfile => {
  const data = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const name = sanitiseName(data.name)
  const stored = typeof data.id === 'string' ? data.id : ''
  return {
    id: makeCharacterId(stored.trim() ? stored : name, taken),
    name,
    appearance: sanitiseAppearance(data.appearance),
    loadout: sanitiseLoadout(data.loadout),
    updatedAt: finiteTime(data.updatedAt)
  }
}

/**
 * Repairs a whole stored roster. Total — see the header.
 *
 * An `activeId` that names no profile falls back to `null`, which is the *legal*
 * "unsaved draft" state rather than an error: a roster whose active character was
 * deleted by a build that crashed mid-write opens on a new blank character, which
 * is what a first visit does anyway.
 */
export const sanitiseRoster = (raw: unknown): CharacterRoster => {
  const roster: CharacterRoster = { profiles: [], activeId: null }
  if (!raw || typeof raw !== 'object') {
    return roster
  }
  const data = raw as Record<string, unknown>

  if (Array.isArray(data.profiles)) {
    const taken: string[] = []
    for (const entry of data.profiles.slice(0, MAX_PROFILES)) {
      const profile = sanitiseProfile(entry, taken)
      taken.push(profile.id)
      roster.profiles.push(profile)
    }
  }

  if (typeof data.activeId === 'string' && roster.profiles.some(profile => profile.id === data.activeId)) {
    roster.activeId = data.activeId
  }
  return roster
}

/**
 * Guarded per the convention in `editor/toggle.ts`: `localStorage` throws
 * outright in a sandboxed iframe, which is how several of the portals this ships
 * to serve games. A corrupt blob and a blocked store take the same branch,
 * because from here they are the same thing — no roster.
 */
export const loadRoster = (): CharacterRoster => {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(ROSTER_KEY)
    return sanitiseRoster(raw ? JSON.parse(raw) : null)
  } catch {
    return sanitiseRoster(null)
  }
}

export const saveRoster = (roster: CharacterRoster): void => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ROSTER_KEY, JSON.stringify(sanitiseRoster(roster)))
    }
  } catch {
    // Storage full or blocked. The roster still works for this session, which is
    // strictly better than refusing the edit.
  }
}

/** Test seam, and the only way to un-save a roster. */
export const clearStoredRoster = (): void => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(ROSTER_KEY)
    }
  } catch {
    // Unreachable either way.
  }
}

/**
 * ─── Search ─────────────────────────────────────────────────────────────────
 *
 * A roster can hold `MAX_PROFILES` characters and the screen that populates a
 * city with a hundred NPCs will want a named one out of it in a second. Scrolling
 * a list of sixty-four is not that, so the roster list is filtered by a query.
 *
 * Lives here rather than in the screen for the reason everything else in this
 * file does: it is a rule about profiles, it has no DOM in it, and a test can
 * assert it directly. The screen decides how the result is *drawn*; what counts
 * as a match is decided once, here.
 *
 * ── What is searched ────────────────────────────────────────────────────────
 *
 * Name **and** id. The name is what a player recognises; the id is what a quest,
 * a spawn table and a save file refer to, so somebody who arrived from one of
 * those has an id in their hand and nothing else. Searching only the name would
 * make the id — the one identifier the rest of the game uses — the one thing you
 * cannot look a character up by.
 */

/**
 * Case-, accent- and punctuation-insensitive.
 *
 * The accent fold is not a nicety in a game that ships in 21 locales: a player
 * who named a character `Müller` on a German keyboard and is now typing on a
 * phone that autocorrects to `Muller` gets no result at all without it. NFD
 * splits the character into a base letter and a combining mark, and `\p{M}`
 * drops the mark.
 *
 * Punctuation collapses to a space so `d'Artagnan` is reachable by `dartagnan`
 * and by `artagnan`, and so a query pasted with a stray comma still matches.
 */
export const foldForSearch = (raw: string): string =>
  raw
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/**
 * Every whitespace-separated token must appear somewhere in name-plus-id.
 *
 * Tokens rather than one substring, so word order does not have to be
 * remembered: `smith black` finds `Blacksmith` and `Black Smith` alike. Every
 * token has to hit — an "any token" rule turns a two-word query into a *wider*
 * result set than one word, which is the opposite of what typing more means.
 *
 * An empty query matches everything, so a blank search box is not a filter.
 */
export const matchesQuery = (profile: CharacterProfile, query: string): boolean => {
  const tokens = foldForSearch(query).split(' ').filter(Boolean)
  if (tokens.length === 0) {
    return true
  }
  const haystack = `${foldForSearch(profile.name)} ${foldForSearch(profile.id)}`
  return tokens.every(token => haystack.includes(token))
}

/**
 * Lower sorts first. Prefix matches beat interior ones.
 *
 * Typing `gu` with a `Town Guard` and a `Guard Captain` in the roster should put
 * `Guard Captain` under the cursor, because Enter picks whatever is highlighted
 * and the thing you have typed the *start* of is the thing you meant. Name beats
 * id at the same rank: the name is what was typed from memory.
 *
 * Rank is only ever a tie-break *within* an already-matching set, and the sort
 * that uses it is stable, so profiles that rank equally keep the recency order
 * `list()` promises.
 */
const searchRank = (profile: CharacterProfile, query: string): number => {
  const folded = foldForSearch(query)
  if (!folded) {
    return 0
  }
  const name = foldForSearch(profile.name)
  const id = foldForSearch(profile.id)
  if (name.startsWith(folded)) {
    return 0
  }
  if (id.startsWith(folded)) {
    return 1
  }
  // A word inside the name — `guard` against `Town Guard`. Still better than a
  // match that only lands mid-word.
  if (name.split(' ').some(word => word.startsWith(folded))) {
    return 2
  }
  return 3
}

/**
 * The matching profiles, best first, recency-ordered within a rank.
 *
 * Takes and returns the *already ordered* list rather than reading the store, so
 * the screen can filter the copies it is holding without a second read — and so
 * this stays a pure function of its arguments.
 */
export const filterProfiles = (profiles: readonly CharacterProfile[], query: string): CharacterProfile[] =>
  profiles
    .filter(profile => matchesQuery(profile, query))
    .map((profile, at) => ({ profile, at, rank: searchRank(profile, query) }))
    // Sorting an index alongside the value rather than trusting `sort` to be
    // stable across every engine this ships to. It is (ES2019), but the roster
    // reordering itself under a player's cursor is a bug that would only appear
    // on somebody else's browser.
    .sort((a, b) => a.rank - b.rank || a.at - b.at)
    .map(entry => entry.profile)

/**
 * ─── The model ──────────────────────────────────────────────────────────────
 *
 * A class rather than free functions over a plain object, for the same reason
 * `PlayerInventory` is one: every mutation has to bump `revision`, keep ids
 * unique and keep `activeId` pointing at something that exists, and an exported
 * `remove(state, id)` a caller could forget to route through is exactly how those
 * three get out of step.
 */
export class RosterStore {
  private profiles: CharacterProfile[] = []
  private active: string | null = null

  /**
   * Bumped on every change that alters what `list()` would return.
   *
   * A plain integer, because the UI cannot hold this object reactively (GDD §0).
   * The screen re-reads copies after each call it makes; this exists so a second
   * reader — the world, once it spawns the player from the roster — can poll one
   * number instead of subscribing to anything.
   */
  revision = 0

  constructor(state?: CharacterRoster) {
    if (state) {
      this.restore(state)
    }
  }

  /** Replaces everything. Sanitised, so untrusted input is safe here. */
  restore(state: CharacterRoster): void {
    const clean = sanitiseRoster(state)
    this.profiles = clean.profiles
    this.active = clean.activeId
    this.revision++
  }

  get activeId(): string | null {
    return this.active
  }

  get size(): number {
    return this.profiles.length
  }

  get isEmpty(): boolean {
    return this.profiles.length === 0
  }

  /** Every id in use. What `makeCharacterId` has to avoid colliding with. */
  ids(): string[] {
    return this.profiles.map(profile => profile.id)
  }

  /**
   * Copies, **most recently edited first**, which is the order `profile.ts` says
   * `updatedAt` exists for.
   *
   * `Array.prototype.sort` is stable (ES2019), so profiles saved within the same
   * millisecond — every profile in a unit test, and the two halves of a
   * duplicate — keep their creation order rather than swapping about between two
   * reads of the same unchanged roster.
   */
  list(): CharacterProfile[] {
    return this.ordered().map(copyProfile)
  }

  private ordered(): CharacterProfile[] {
    return [...this.profiles].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  private find(id: string | null): CharacterProfile | null {
    return this.profiles.find(profile => profile.id === id) ?? null
  }

  has(id: string): boolean {
    return this.find(id) !== null
  }

  /** A copy, or null. The caller is Vue and must not hold the stored object. */
  profile(id: string | null): CharacterProfile | null {
    const found = this.find(id)
    return found ? copyProfile(found) : null
  }

  activeProfile(): CharacterProfile | null {
    return this.profile(this.active)
  }

  /**
   * Opens a saved character, or `null` for a fresh unsaved draft.
   *
   * Returns whether it applied, so the screen can ignore a click on a profile
   * that a second tab deleted rather than blanking itself.
   */
  open(id: string | null): boolean {
    if (id !== null && !this.has(id)) {
      return false
    }
    if (this.active === id) {
      return true
    }
    this.active = id
    this.revision++
    return true
  }

  /**
   * Saves the open draft as a new character, and opens it.
   *
   * **This is the only place an id is minted.** `now` is a parameter rather than
   * a `Date.now()` call so a test can assert ordering without mocking a clock.
   */
  create(draft: ProfileDraft, now: number = Date.now()): CharacterProfile {
    const name = sanitiseName(draft.name)
    const profile = emptyProfile(makeCharacterId(name, this.ids()), name)
    copyAppearance(draft.appearance, profile.appearance)
    profile.loadout = sanitiseLoadout(draft.loadout)
    profile.updatedAt = finiteTime(now)
    this.profiles.push(profile)
    this.active = profile.id
    this.revision++
    return copyProfile(profile)
  }

  /**
   * Writes over an existing character. The name may change; **the id never
   * does** — that is the entire point of the split, and there is deliberately no
   * parameter here that could.
   */
  update(id: string, draft: ProfileDraft, now: number = Date.now()): CharacterProfile | null {
    const profile = this.find(id)
    if (!profile) {
      return null
    }
    profile.name = sanitiseName(draft.name)
    copyAppearance(draft.appearance, profile.appearance)
    profile.loadout = sanitiseLoadout(draft.loadout)
    profile.updatedAt = finiteTime(now)
    this.revision++
    return copyProfile(profile)
  }

  /** Renames in place. The id is untouched — asserted in `roster.test.ts`. */
  rename(id: string, name: string, now: number = Date.now()): CharacterProfile | null {
    const profile = this.find(id)
    if (!profile) {
      return null
    }
    profile.name = sanitiseName(name)
    profile.updatedAt = finiteTime(now)
    this.revision++
    return copyProfile(profile)
  }

  /**
   * Copies a character under a **new id**, and opens the copy.
   *
   * The copy is a different character, not a second reference to the same one, so
   * it gets a fresh id — which is also the escape hatch for a player who wants a
   * different id than the one their first name produced.
   */
  duplicate(id: string, name?: string, now: number = Date.now()): CharacterProfile | null {
    const source = this.find(id)
    if (!source || this.profiles.length >= MAX_PROFILES) {
      return null
    }
    const copy = copyProfile(source)
    copy.name = sanitiseName(name ?? source.name)
    copy.id = makeCharacterId(copy.name, this.ids())
    copy.updatedAt = finiteTime(now)
    this.profiles.push(copy)
    this.active = copy.id
    this.revision++
    return copyProfile(copy)
  }

  /**
   * Deletes a character and returns the id that is open afterwards.
   *
   * Deleting the character that is **currently open** is the interesting case:
   * the screen has to keep showing something. It opens the neighbour *in display
   * order* — the entry the deleted one was sitting on top of, or the one above it
   * when it was last — because that is the row the player's eye is already on.
   * When the roster empties, it returns `null`: the unsaved-draft state, which is
   * also what a first visit is, so there is exactly one "nothing is open" state
   * rather than a second empty one that only deletion can reach.
   */
  remove(id: string): string | null {
    const order = this.ordered()
    const at = order.findIndex(profile => profile.id === id)
    if (at < 0) {
      return this.active
    }
    this.profiles = this.profiles.filter(profile => profile.id !== id)
    if (this.active === id) {
      const neighbour = order[at + 1] ?? order[at - 1] ?? null
      this.active = neighbour ? neighbour.id : null
    }
    this.revision++
    return this.active
  }

  /** A plain snapshot, safe to serialise. Copies all the way down. */
  state(): CharacterRoster {
    return { profiles: this.list(), activeId: this.active }
  }

  save(): void {
    saveRoster(this.state())
  }
}

/**
 * The one roster the game plays with, hydrated from storage at first import.
 *
 * A module-level singleton per the project's composable convention. Tests build
 * their own `RosterStore` instead of touching this, so a test cannot leave the
 * player with four characters they never made.
 */
let singleton: RosterStore | null = null

export const characterRoster = (): RosterStore => {
  if (!singleton) {
    singleton = new RosterStore(loadRoster())
  }
  return singleton
}

/** Drops the singleton so the next call re-reads storage. Test seam. */
export const resetCharacterRoster = (): void => {
  singleton = null
}

/**
 * ─── Seam: equipping weapons from this screen ───────────────────────────────
 *
 * The user asked for weapon equipping here *later*. Nothing is built for it, and
 * the shape it needs is already in place: `CharacterProfile.loadout` is a full
 * `EquipmentLoadout` — all six slots and the drawn state, not just the four the
 * preview panel currently toggles — it round-trips through `sanitiseLoadout`, and
 * `CreatorScene.setLoadout` already applies a whole loadout in one call.
 *
 * So that feature is a panel section and nothing else: no storage change, no
 * migration, no new key. The one decision left for it is whether equipping here
 * should also `acquire()` the item in `inventory.ts` — it should not, for the
 * reason `CreatorScene.setLoadout` gives: trying a sword on is not the same act
 * as being given one, and the roster is a wardrobe, not a pack.
 */
export const emptyDraft = (): ProfileDraft => ({
  name: '',
  appearance: copyAppearance(DEFAULT_APPEARANCE),
  loadout: emptyLoadout()
})


// ─── What the player walks around as ────────────────────────────────────────

/**
 * The appearance and loadout the world should dress the player in.
 *
 * ── The screen existed and had nowhere to send its work ────────────────────
 *
 * `/characters` could build a character, name it, mint it a stable id and store
 * it — and nothing outside that route ever read any of it. `player/chibiBody.ts`
 * built its figure with `new Character({ perfTag })`, i.e. `DEFAULT_APPEARANCE`,
 * so the person you walked around as was the shipped bowl-cut regardless. This
 * is the missing half.
 *
 * ── Three sources, in this order, and each one is a different promise ───────
 *
 *   1. **The roster's active profile.** What is open in the creation screen and
 *      what `Save` last wrote. This is the answer whenever the player has ever
 *      saved anybody, and it is the only source that carries a **loadout** —
 *      a profile stores all six slots, so a sword saved on the wardrobe screen
 *      is a sword worn in the world.
 *   2. **The standalone appearance key.** Written by `Save` as well, and by
 *      builds that predate the roster. Appearance only: there is no loadout in
 *      it to find, so the player is dressed and unarmed rather than dressed in
 *      a guess.
 *   3. **The default.** A first visit, or storage that is blocked or corrupt.
 *
 * Falling *forward* through the three rather than trusting any one of them is
 * what makes the failure mode "the shipped character" instead of "no character":
 * every branch returns something a `Character` can be built from, which is the
 * same total-repair rule `sanitiseAppearance` and `sanitiseInventory` are
 * written to.
 *
 * ── Read once, at spawn, on purpose ────────────────────────────────────────
 *
 * There is no live sync back into a running world, and none is needed:
 * `/characters` is its own route, so opening it unmounts `WorldScene` and
 * returning mounts a fresh `World` that calls this again. A watcher would be a
 * second path to the same result, and a rebuild is ~1.4 ms of merging the whole
 * figure — not something to run on every pill click in a screen the world is not
 * even visible behind.
 */
export interface PlayerLook {
  appearance: CharacterAppearance
  loadout: EquipmentLoadout
  /** Which of the three branches answered. Dev logging and the tests read it. */
  source: 'profile' | 'appearance' | 'default'
}

export const playerLook = (roster: CharacterRoster = loadRoster()): PlayerLook => {
  const active = roster.activeId === null ? null : roster.profiles.find(profile => profile.id === roster.activeId)
  if (active) {
    return {
      appearance: copyAppearance(active.appearance),
      loadout: { ...active.loadout },
      source: 'profile'
    }
  }
  const saved = loadAppearance()
  if (!appearanceIsDefault(saved)) {
    return { appearance: saved, loadout: emptyLoadout(), source: 'appearance' }
  }
  return { appearance: copyAppearance(DEFAULT_APPEARANCE), loadout: emptyLoadout(), source: 'default' }
}

/**
 * Whether a stored appearance is indistinguishable from the shipped one.
 *
 * Used to tell "nobody has ever opened the creation screen" from "somebody
 * opened it and chose the default on purpose". The two are genuinely the same
 * figure, so this only decides which `source` label comes back — nothing about
 * what is drawn — which is why an exact field-by-field compare is honest here
 * rather than a heuristic.
 */
const appearanceIsDefault = (appearance: CharacterAppearance): boolean =>
  (Object.keys(DEFAULT_APPEARANCE) as (keyof CharacterAppearance)[]).every(
    field => appearance[field] === DEFAULT_APPEARANCE[field]
  )
