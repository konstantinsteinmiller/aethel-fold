import { ref } from 'vue'

/**
 * ─── Editor code word ───────────────────────────────────────────────────────
 *
 * Typing a word anywhere on the page toggles the editor. A code word rather
 * than a key binding because the editor is an owner-only tool that ships in
 * every build: a single hotkey is discovered by accident, a five-letter
 * sequence never is.
 *
 * The word is **"cmonc"**. The dreamion original used "copoc" purely because
 * an 'm' in the sequence collided with its map key — pressing M there opened
 * the map, so the sequence could not be typed in-scene. This project has no
 * map key (the world's only keyboard bindings are WASD/arrows on the camera
 * and the editor's own G/F/X/Q/E), so "cmonc" is typeable and is the correct
 * word here.
 *
 * The mode is persisted in its **own localStorage key, never the cloud save
 * blob**. A dev toggle that synced would follow a player across devices and,
 * worse, ride along in any save export.
 */

const EDITOR_MODE_KEY = 'world_editor_mode'
const CODE = 'cmonc'

const readEditorMode = (): boolean => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(EDITOR_MODE_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Panel-facing mode flag. A `ref` is safe here only because it holds a
 * boolean — GDD §0 forbids reactivity reaching a scene object, not reactivity
 * existing. The scene side keeps its own plain copy (`LevelEditor.active`) so
 * nothing on a per-frame path ever dereferences this.
 */
export const editorMode = ref(readEditorMode())

const persistEditorMode = (): void => {
  try {
    localStorage.setItem(EDITOR_MODE_KEY, editorMode.value ? 'true' : 'false')
  } catch {
    // Private mode / storage disabled. The toggle still works, it just won't
    // survive a reload — which is strictly better than throwing.
  }
}

let onToggle: ((on: boolean) => void) | null = null

export const setEditorMode = (on: boolean): void => {
  if (editorMode.value === on) {
    return
  }
  editorMode.value = on
  persistEditorMode()
  onToggle?.(on)
}

let buffer = ''
let installed = false

const onKeyDown = (event: KeyboardEvent): void => {
  // Single printable characters only, and never a modifier chord — Ctrl+C must
  // not feed a 'c' into the buffer or every copy edges the player toward the
  // code word.
  if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) {
    return
  }
  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
    return
  }
  buffer = (buffer + event.key.toLowerCase()).slice(-CODE.length)
  if (buffer !== CODE) {
    return
  }
  buffer = ''
  setEditorMode(!editorMode.value)
}

/** Installs the listener. Returns the uninstall function. Idempotent. */
export const installEditorToggle = (onChange?: (on: boolean) => void): (() => void) => {
  onToggle = onChange ?? null
  if (!installed) {
    window.addEventListener('keydown', onKeyDown)
    installed = true
  }
  return () => {
    if (installed) {
      window.removeEventListener('keydown', onKeyDown)
      installed = false
    }
    onToggle = null
    buffer = ''
  }
}
