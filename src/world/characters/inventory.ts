import {
  DRAWN_SOCKET,
  EMPTY_LOADOUT,
  EQUIP_SLOTS,
  ITEM_SLOT,
  STOW_SOCKET,
  type DrawnState,
  type EquipSlot,
  type EquipmentLoadout,
  type ItemKind,
  type SocketName
} from './equipment'

/**
 * ─── What the character owns, and where it is worn ──────────────────────────
 *
 * The plain model behind the creation / inventory screen. No three.js, no Vue,
 * no scene: `CharacterEquipment.ts` reads the same rules to decide which bone a mesh
 * hangs off, and the UI reads copies of the same state to draw the panel. One
 * definition of "legal", used by both, is the whole point — a UI that greys out
 * a button by one rule while the scene enforces another is how you get a sword
 * that is drawn according to the animation and sheathed according to the panel.
 *
 * ── Everything here is a copy in, a copy out ────────────────────────────────
 *
 * `loadout()` and `snapshot()` hand back fresh objects. The scene is allowed to
 * hold the live model (it is on the same thread and it never mutates it), but
 * the UI must not: a Vue `ref` wrapped around the live loadout would make every
 * `equip()` walk a reactive proxy, and GDD §0 keeps reactivity out of
 * `src/world/` entirely. The UI polls `revision` and re-reads a copy.
 */

/** Every item kind, derived from the contract so a new kind cannot be missed. */
export const ITEM_KINDS = Object.keys(ITEM_SLOT) as ItemKind[]

/**
 * Every drawn state.
 *
 * Written out rather than derived, because `DrawnState` is a bare union with no
 * runtime table behind it. The test asserts this list covers the union by
 * assigning it back — a missing entry is a type error, not a silent gap.
 */
export const DRAWN_STATES: readonly DrawnState[] = ['sheathed', 'mainHand', 'twoHand', 'bow', 'crossbow']

/**
 * Which slot each drawn state takes its weapon from, and which kind it expects.
 *
 * `mainHand` names no kind: the slot itself is already restricted to one-handers
 * by `ITEM_SLOT`, so naming `sword` here would be a second place to update when
 * a mace arrives.
 */
const DRAWN_SOURCE: Record<DrawnState, { slot: EquipSlot; kind: ItemKind | null } | null> = {
  sheathed: null,
  mainHand: { slot: 'mainHand', kind: null },
  twoHand: { slot: 'back', kind: 'greatsword' },
  bow: { slot: 'back', kind: 'bow' },
  crossbow: { slot: 'back', kind: 'crossbow' }
}

/**
 * Drawn states that need both hands.
 *
 * The crossbow is in here even though `DRAWN_SOCKET` puts it in the right hand:
 * the socket says where the *mesh* hangs, and the left hand is still under the
 * stock holding it level. A shield on that arm is not a rendering conflict, it
 * is a physical one.
 */
const TWO_HANDED: Record<DrawnState, boolean> = {
  sheathed: false,
  mainHand: false,
  twoHand: true,
  bow: true,
  crossbow: true
}

export type DrawFault =
  /** The weapon that state draws is not equipped. */
  | 'itemNotEquipped'
  /** Both hands are needed and the off hand is carrying something. */
  | 'offHandOccupied'

export type EquipFault =
  /** `ITEM_SLOT` puts this kind somewhere else. */
  | 'wrongSlot'
  /** The character does not own one. */
  | 'notOwned'

/**
 * Why `state` cannot be drawn from this loadout, or null if it can.
 *
 * A reason rather than a boolean so the UI can say *why* the button is dead.
 * Ask this before `setDrawn` — both this module and `CharacterEquipment`
 * silently ignore an illegal request rather than throwing, because the caller is
 * usually a click on a panel that was rendered one frame before the loadout
 * changed underneath it.
 */
export const drawFault = (loadout: EquipmentLoadout, state: DrawnState): DrawFault | null => {
  const source = DRAWN_SOURCE[state]
  if (!source) {
    return null
  }
  const held = loadout[source.slot]
  if (held === null || (source.kind !== null && held !== source.kind)) {
    return 'itemNotEquipped'
  }
  // A shield is never stowed — `STOW_SOCKET.shield` is the left hand, the same
  // socket it uses when carried — so "both hands free" means "no shield". The
  // alternative, hiding the shield for the duration of the draw, was rejected:
  // an item that vanishes when you draw and reappears when you sheathe is a
  // state the player cannot see, and it makes the off hand's contents depend on
  // the main hand's.
  if (TWO_HANDED[state] && loadout.offHand !== null) {
    return 'offHandOccupied'
  }
  return null
}

export const canDraw = (loadout: EquipmentLoadout, state: DrawnState): boolean => drawFault(loadout, state) === null

/**
 * Whether the item in `slot` is the one currently in use.
 *
 * The shield answers `false` and it does not matter: its stow and drawn sockets
 * are the same left hand, so `socketFor` lands on `handL` either way. That is
 * the reason this can be a single expression instead of a table of
 * (slot × drawn state).
 */
const isInUse = (slot: EquipSlot, drawn: DrawnState): boolean => {
  const source = DRAWN_SOURCE[drawn]
  return source !== null && source.slot === slot
}

/**
 * Where the item in `slot` sits right now — the one function `CharacterEquipment.ts`
 * parents by, and the only place the two socket tables are read together.
 *
 * Null means "nothing to hang": either the slot is empty, or the kind has no
 * socket in this condition. `torsoArmour` is always the second case — it is not
 * an attachment at all (see `CharacterEquipment.ts`).
 */
export const socketFor = (loadout: EquipmentLoadout, slot: EquipSlot, drawn: DrawnState): SocketName | null => {
  const kind = loadout[slot]
  if (kind === null) {
    return null
  }
  return isInUse(slot, drawn) ? DRAWN_SOCKET[kind] : STOW_SOCKET[kind]
}

/** Why `kind` cannot go in `slot`, or null if it can. Ownership is not checked here. */
export const equipFault = (slot: EquipSlot, kind: ItemKind): EquipFault | null =>
  ITEM_SLOT[kind] === slot ? null : 'wrongSlot'

/** A loadout with nothing in it. A fresh object every time — `EMPTY_LOADOUT` is shared. */
export const emptyLoadout = (): EquipmentLoadout => ({ ...EMPTY_LOADOUT })

export const copyLoadout = (loadout: EquipmentLoadout): EquipmentLoadout => ({ ...loadout })

export interface InventorySnapshot {
  /** Kinds the character owns. A set, not a count — nothing here stacks. */
  owned: ItemKind[]
  loadout: EquipmentLoadout
}

/**
 * Repairs anything that comes back from storage, or from a hand-edited save.
 *
 * Deliberately total: every branch produces a valid inventory rather than
 * throwing, because the alternative is a character-creation screen that cannot
 * open because a key from three versions ago is still in localStorage.
 */
export const sanitiseInventory = (raw: unknown): InventorySnapshot => {
  const snapshot: InventorySnapshot = { owned: [], loadout: emptyLoadout() }
  if (!raw || typeof raw !== 'object') {
    return snapshot
  }
  const data = raw as Partial<InventorySnapshot>

  const owned = new Set<ItemKind>()
  if (Array.isArray(data.owned)) {
    for (const entry of data.owned) {
      if (typeof entry === 'string' && (ITEM_KINDS as string[]).includes(entry)) {
        owned.add(entry as ItemKind)
      }
    }
  }
  snapshot.owned = [...owned]

  // Through `unknown`: the declared shape is what we *hope* is in storage, and
  // reading it as anything narrower would let the compiler assume fields that a
  // hand-edited or version-skewed store may not have.
  const loadout = data.loadout as unknown as Record<string, unknown> | undefined
  if (loadout && typeof loadout === 'object') {
    for (const slot of EQUIP_SLOTS) {
      const kind = loadout[slot]
      // Owning it is required to wear it: a store that lost the `owned` array
      // but kept the loadout would otherwise resurrect gear the player never
      // had, and the creation screen would show an item it cannot list.
      if (typeof kind === 'string' && (ITEM_KINDS as string[]).includes(kind) && owned.has(kind as ItemKind)) {
        const typed = kind as ItemKind
        if (equipFault(slot, typed) === null) {
          snapshot.loadout[slot] = typed
        }
      }
    }
    const drawn = loadout.drawn
    if (typeof drawn === 'string' && (DRAWN_STATES as string[]).includes(drawn)) {
      const state = drawn as DrawnState
      // An illegal drawn state falls back rather than being dropped: `sheathed`
      // is legal from every loadout, so this cannot fail in turn.
      snapshot.loadout.drawn = canDraw(snapshot.loadout, state) ? state : 'sheathed'
    }
  }

  return snapshot
}

/**
 * ─── Storage ────────────────────────────────────────────────────────────────
 *
 * Its own key. Not the level editor's `world.level.*`, not the water editor's,
 * not the sculptor's: those are owner-only dev state that a player must never
 * inherit, and this is the opposite — player state that must survive every
 * reload. Sharing a key would mean one of the two clobbering the other on the
 * first save.
 *
 * Guarded, per the convention in `editor/toggle.ts`: `localStorage` throws
 * outright in a sandboxed iframe, which is how several of the portals this
 * ships to serve games.
 */
const STORAGE_KEY = 'world.characterInventory.v1'

export const loadInventory = (): InventorySnapshot => {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
    return sanitiseInventory(raw ? JSON.parse(raw) : null)
  } catch {
    // Corrupt JSON, or storage blocked. An empty inventory is a valid
    // inventory; a throw at boot is not.
    return sanitiseInventory(null)
  }
}

export const saveInventory = (snapshot: InventorySnapshot): void => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
    }
  } catch {
    // Storage full or blocked. The change still applies for this session.
  }
}

export const clearStoredInventory = (): void => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // Nothing to do — the key is unreachable either way.
  }
}

/**
 * ─── The model ──────────────────────────────────────────────────────────────
 *
 * A class rather than free functions over a plain object, because every mutation
 * has to bump `revision` and re-check the drawn state, and an exported
 * `equip(state, …)` that a caller could forget to route through is exactly how
 * the two get out of step.
 */
export class PlayerInventory {
  private readonly owned = new Set<ItemKind>()
  private readonly current = emptyLoadout()

  /**
   * Bumped on every change that alters what `snapshot()` would return.
   *
   * A plain integer, because the UI cannot hold this object reactively (GDD §0)
   * and polling one number in a `requestAnimationFrame` or a `watchEffect` is
   * the whole subscription mechanism it needs.
   */
  revision = 0

  constructor(snapshot?: InventorySnapshot) {
    if (snapshot) {
      this.restore(snapshot)
    }
  }

  /** Replaces the entire model. Sanitised, so untrusted input is safe here. */
  restore(snapshot: InventorySnapshot): void {
    const clean = sanitiseInventory(snapshot)
    this.owned.clear()
    for (const kind of clean.owned) {
      this.owned.add(kind)
    }
    for (const slot of EQUIP_SLOTS) {
      this.current[slot] = clean.loadout[slot]
    }
    this.current.drawn = clean.loadout.drawn
    this.revision++
  }

  owns(kind: ItemKind): boolean {
    return this.owned.has(kind)
  }

  /** Adds a kind to the pack. Idempotent — nothing here stacks. */
  acquire(kind: ItemKind): void {
    if (this.owned.has(kind)) {
      return
    }
    this.owned.add(kind)
    this.revision++
  }

  /** Removes a kind, unequipping it first if it is worn. */
  discard(kind: ItemKind): void {
    if (!this.owned.delete(kind)) {
      return
    }
    for (const slot of EQUIP_SLOTS) {
      if (this.current[slot] === kind) {
        this.current[slot] = null
      }
    }
    this.settleDrawn()
    this.revision++
  }

  ownedItems(): ItemKind[] {
    return [...this.owned]
  }

  /** Every kind that may go in `slot` and is owned. What the UI lists. */
  candidatesFor(slot: EquipSlot): ItemKind[] {
    return ITEM_KINDS.filter(kind => ITEM_SLOT[kind] === slot && this.owned.has(kind))
  }

  equipFaultFor(slot: EquipSlot, kind: ItemKind): EquipFault | null {
    if (!this.owned.has(kind)) {
      return 'notOwned'
    }
    return equipFault(slot, kind)
  }

  /**
   * Puts `kind` in `slot`, or empties it with `null`.
   *
   * Returns whether it applied, so a UI can flash the rejection instead of
   * silently doing nothing.
   */
  equip(slot: EquipSlot, kind: ItemKind | null): boolean {
    if (kind !== null && this.equipFaultFor(slot, kind) !== null) {
      return false
    }
    if (this.current[slot] === kind) {
      return true
    }
    this.current[slot] = kind
    this.settleDrawn()
    this.revision++
    return true
  }

  drawFaultFor(state: DrawnState): DrawFault | null {
    return drawFault(this.current, state)
  }

  setDrawn(state: DrawnState): boolean {
    if (drawFault(this.current, state) !== null) {
      return false
    }
    if (this.current.drawn === state) {
      return true
    }
    this.current.drawn = state
    this.revision++
    return true
  }

  /**
   * Drops back to `sheathed` if the loadout no longer supports what is drawn.
   *
   * Called after every equip change rather than checked at read time, so the
   * model is never momentarily in a state the renderer would have to interpret:
   * unequip the greatsword mid-swing and the character is sheathed, full stop.
   */
  private settleDrawn(): void {
    if (drawFault(this.current, this.current.drawn) !== null) {
      this.current.drawn = 'sheathed'
    }
  }

  loadout(): EquipmentLoadout {
    return copyLoadout(this.current)
  }

  snapshot(): InventorySnapshot {
    return { owned: this.ownedItems(), loadout: this.loadout() }
  }

  /** Where the item in `slot` currently hangs. Mirrors `CharacterEquipment.ts` exactly. */
  socketFor(slot: EquipSlot): SocketName | null {
    return socketFor(this.current, slot, this.current.drawn)
  }

  save(): void {
    saveInventory(this.snapshot())
  }
}

/**
 * The one inventory the game plays with, hydrated from storage at first import.
 *
 * A module-level singleton per the project's composable convention. Tests build
 * their own `PlayerInventory` instead of touching this, so a test cannot leave
 * the player wearing a greatsword.
 */
let singleton: PlayerInventory | null = null

export const playerInventory = (): PlayerInventory => {
  if (!singleton) {
    singleton = new PlayerInventory(loadInventory())
  }
  return singleton
}

/** Drops the singleton so the next call re-reads storage. Test seam. */
export const resetPlayerInventory = (): void => {
  singleton = null
}
