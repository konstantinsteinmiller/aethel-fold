import { computed, ref } from 'vue'

/**
 * ─── Keybindings ────────────────────────────────────────────────────────────
 *
 * One table mapping an **action** to a **key**, owned here and read by three
 * unrelated things: the input layer that plays the game (`world/story/
 * StoryPlayer.ts`), the on-screen controls panel that shows the player what to
 * press, and the settings screen that lets them change it.
 *
 * Before this existed the key codes were literals inside `StoryPlayer`'s event
 * handlers. That is fine for one reader and wrong for three: the controls panel
 * would have had to *restate* them, and a rebound key would then have been
 * correct in the game and wrong on screen — a class of bug nobody reports
 * because it looks like the player misread the panel.
 *
 * ── Codes, not keys ─────────────────────────────────────────────────────────
 *
 * Bindings store `KeyboardEvent.code` (`KeyW`, `ShiftLeft`, `Space`), never
 * `KeyboardEvent.key`. `code` is the **physical key**, so WASD stays under the
 * same three fingers on a QWERTZ keyboard — which matters here, because this
 * game's first language is German and QWERTZ is what its author is typing on.
 * With `key` the same binding would read `KeyY`/`KeyZ` swapped and "W" would be
 * the wrong letter on an AZERTY layout.
 *
 * The display side pays for that: `KeyW` has to be turned back into something a
 * player recognises, which is what `keyLabel` does.
 *
 * ── Mouse buttons live in the same table ────────────────────────────────────
 *
 * As `Mouse0` / `Mouse1` / `Mouse2`. They are not keyboard codes and could have
 * had their own map, and the reason they do not is that the *player* does not
 * think of them separately: "what do I press to guard" has one answer, and a
 * rebind screen that could not offer a mouse button for it would be a rebind
 * screen with a hole in it.
 */

export type ActionId =
  // ── Movement ──────────────────────────────────────────────────────────────
  | 'moveForward'
  | 'moveBack'
  | 'moveLeft'
  | 'moveRight'
  | 'sprint'
  | 'dodge'
  // ── Fighting ──────────────────────────────────────────────────────────────
  | 'attackLight'
  | 'attackHeavy'
  /**
   * The one binding whose *meaning* depends on what is in your hands.
   *
   * With a melee weapon drawn it raises a guard, and releasing it inside
   * `PARRY_WINDOW` of an incoming blow is a parry. With a bow drawn it enters
   * an over-the-shoulder aim with a crosshair. One button, because they are the
   * same *intent* — "defend / commit to the weapon I am holding" — and because
   * a player who has to remember which of two buttons is live for which weapon
   * is a player who dies pressing the wrong one.
   */
  | 'guardOrAim'
  | 'drawWeapon'
  // ── World ─────────────────────────────────────────────────────────────────
  | 'interact'
  // ── Shell ─────────────────────────────────────────────────────────────────
  | 'pause'
  | 'quickSave'
  | 'quickLoad'
  | 'toggleControls'

export const ACTION_IDS: readonly ActionId[] = [
  'moveForward',
  'moveBack',
  'moveLeft',
  'moveRight',
  'sprint',
  'dodge',
  'attackLight',
  'attackHeavy',
  'guardOrAim',
  'drawWeapon',
  'interact',
  'pause',
  'quickSave',
  'quickLoad',
  'toggleControls'
]

/**
 * Groups, purely for how the settings screen and the controls panel lay
 * themselves out.
 *
 * Here rather than in the components because both of them need the same
 * grouping and a second copy would drift — the controls panel would grow a
 * binding the rebind screen could not reach.
 */
export const ACTION_GROUPS: readonly { id: string; actions: readonly ActionId[] }[] = [
  { id: 'move', actions: ['moveForward', 'moveBack', 'moveLeft', 'moveRight', 'sprint', 'dodge'] },
  { id: 'fight', actions: ['attackLight', 'attackHeavy', 'guardOrAim', 'drawWeapon'] },
  { id: 'world', actions: ['interact'] },
  { id: 'system', actions: ['pause', 'quickSave', 'quickLoad', 'toggleControls'] }
]

export const DEFAULT_BINDINGS: Record<ActionId, string> = {
  moveForward: 'KeyW',
  moveBack: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  /**
   * Shift is **sprint**, which is where every player's hand already expects it.
   *
   * It used to be the heavy attack, and that was a mistake worth recording: a
   * player holding shift to run into a fight was throwing a 0.62 s committed
   * overhead swing the instant they arrived, and nothing on screen explained
   * why. The heavy attack moved to the middle mouse button, which nothing else
   * was using.
   */
  sprint: 'ShiftLeft',
  dodge: 'Space',
  attackLight: 'Mouse0',
  attackHeavy: 'Mouse1',
  guardOrAim: 'Mouse2',
  drawWeapon: 'KeyR',
  interact: 'KeyE',
  pause: 'Escape',
  quickSave: 'F5',
  quickLoad: 'F9',
  toggleControls: 'F1'
}

/**
 * Bindings that cannot be rebound onto a mouse button.
 *
 * Pointer lock is what makes the camera work, and the first click inside a
 * locked-out canvas is spent *acquiring* the lock rather than doing anything —
 * so an action bound to a mouse button that is needed *before* the lock exists
 * can never fire. `pause` is the whole of that set, and it is the one that
 * matters: a player who cannot reach the menu cannot fix the binding that
 * stopped them reaching it.
 */
const KEYBOARD_ONLY: ReadonlySet<ActionId> = new Set<ActionId>(['pause', 'quickSave', 'quickLoad', 'toggleControls'])

export const KEYBINDINGS_KEY = 'world.keybindings.v1'

const isMouse = (code: string): boolean => code.startsWith('Mouse')

const sanitise = (raw: unknown): Record<ActionId, string> => {
  const out = { ...DEFAULT_BINDINGS }
  if (!raw || typeof raw !== 'object') {
    return out
  }
  const data = raw as Record<string, unknown>
  for (const action of ACTION_IDS) {
    const value = data[action]
    if (typeof value !== 'string' || value.length === 0) {
      continue
    }
    if (KEYBOARD_ONLY.has(action) && isMouse(value)) {
      continue
    }
    out[action] = value
  }
  return out
}

const load = (): Record<ActionId, string> => {
  // Guarded exactly as `editor/toggle.ts` and `characters/appearance.ts` are:
  // `localStorage` **throws outright** in a sandboxed iframe, which is how
  // several of the portals this ships to serve games.
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEYBINDINGS_KEY)
    return sanitise(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...DEFAULT_BINDINGS }
  }
}

const bindings = ref<Record<ActionId, string>>(load())

/** The live table. Read it; do not write to it — use `bind` / `resetBindings`. */
export const keybindings = computed(() => bindings.value)

const persist = (): void => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(KEYBINDINGS_KEY, JSON.stringify(bindings.value))
    }
  } catch {
    // A player in a sandboxed iframe keeps their bindings for this session and
    // loses them on reload. That is strictly better than the alternative, which
    // is the settings screen throwing on every click.
  }
}

/**
 * What is currently bound to an action.
 *
 * Falls back to the default rather than to `undefined`, so a table written by
 * an older build that did not have an action still answers for it. Every reader
 * of this is in an input path where `undefined` would silently disable a
 * control.
 */
export const bindingFor = (action: ActionId): string => bindings.value[action] ?? DEFAULT_BINDINGS[action]

/** Which action a raw code triggers, or null. Used by the input layer. */
export const actionForCode = (code: string): ActionId | null => {
  // `bind` stores an unbound action as the empty string, so without this an
  // event carrying `code: ''` — which IMEs and some virtual keyboards do send —
  // matches whichever action the player last rebound away, and fires it.
  if (code.length === 0) {
    return null
  }
  for (const action of ACTION_IDS) {
    if (bindings.value[action] === code) {
      return action
    }
  }
  return null
}

export type BindResult = 'ok' | 'mouseNotAllowed'

/**
 * Rebinds an action.
 *
 * **A code may only be bound once.** Assigning a code that another action holds
 * *unbinds the other one* rather than refusing, which is the behaviour every
 * game with a rebind screen has settled on: refusing leaves the player having
 * to work out which of fifteen rows is in their way, and allowing a duplicate
 * leaves two actions firing on one press. The displaced action is left showing
 * an empty cell, which is visible and fixable.
 */
export const bind = (action: ActionId, code: string): BindResult => {
  if (KEYBOARD_ONLY.has(action) && isMouse(code)) {
    return 'mouseNotAllowed'
  }
  const next = { ...bindings.value }
  for (const other of ACTION_IDS) {
    if (other !== action && next[other] === code) {
      next[other] = ''
    }
  }
  next[action] = code
  bindings.value = next
  persist()
  return 'ok'
}

export const resetBindings = (): void => {
  bindings.value = { ...DEFAULT_BINDINGS }
  persist()
}

/**
 * A code, as something a player recognises on a key cap.
 *
 * Not translated, and that is deliberate: the glyph on the physical key is what
 * the player is looking for, and "W" is "W" in both languages this game ships
 * in. The one thing that *is* translated is a mouse button, because "left
 * click" is a phrase rather than a glyph — those come back as an i18n key for
 * the caller to resolve.
 */
export const keyLabel = (code: string): { text?: string; i18n?: string } => {
  if (!code) {
    return { i18n: 'controls.unbound' }
  }
  if (code === 'Mouse0') {
    return { i18n: 'controls.mouseLeft' }
  }
  if (code === 'Mouse1') {
    return { i18n: 'controls.mouseMiddle' }
  }
  if (code === 'Mouse2') {
    return { i18n: 'controls.mouseRight' }
  }
  if (code.startsWith('Key')) {
    return { text: code.slice(3) }
  }
  if (code.startsWith('Digit')) {
    return { text: code.slice(5) }
  }
  if (code.startsWith('Arrow')) {
    const arrows: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }
    return { text: arrows[code] ?? code }
  }
  const named: Record<string, string> = {
    Space: '␣',
    ShiftLeft: 'Shift',
    ShiftRight: 'Shift',
    ControlLeft: 'Ctrl',
    ControlRight: 'Ctrl',
    AltLeft: 'Alt',
    AltRight: 'Alt',
    Escape: 'Esc',
    Tab: 'Tab',
    Enter: '⏎',
    Backquote: '`'
  }
  return { text: named[code] ?? code }
}

/** Turns a `MouseEvent.button` into the code this table stores. */
export const mouseCode = (button: number): string => `Mouse${button}`
