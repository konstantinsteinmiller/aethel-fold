import { onMounted, onUnmounted, ref } from 'vue'
import { toggleDebug } from '@/use/useMatch'

// `cheat` stays a top-level localStorage flag — it's an explicit dev toggle
// that gates the whole keyboard-shortcut module, so we don't want it living
// inside the gameplay save blob (where a cloud restore could re-enable
// cheats on a clean device).
const storedCheat = localStorage.getItem('cheat') || 'false'
const isCheat = ref<boolean>(JSON.parse(storedCheat))

// ─── Always-on key-sequence cheat: type "cmarc" to flip debug mode. ──────
//
// Sits OUTSIDE the `useCheats` factory so it works even when the regular
// cheat module is gated off — flipping `isDebug` is itself the entry point
// to dev tooling (editor button, perf meter, etc.).
//
// Exported + idempotent so a boot-time caller (App.vue setup) can guarantee
// it installs at app start. The old module-level `installDebugUnlock()` call
// only ran when this file's side-effects were retained — but App.vue's bare
// `import useCheats` is tree-shaken in production (the default export is never
// called there), and the only other importer is the LAZY game scene, so on a
// built bundle the sequence listener wasn't attached until the player was
// already in-game (and never at all if they typed it on the menu). Calling
// the exported initialiser from executed setup code can't be tree-shaken.
let debugUnlockInstalled = false
export const installDebugUnlock = (): void => {
  if (typeof window === 'undefined' || debugUnlockInstalled) return
  debugUnlockInstalled = true
  const target = 'cmarc'
  let buf = ''
  const isTypingTarget = (el: EventTarget | null): boolean => {
    if (!(el instanceof HTMLElement)) return false
    const tag = el.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
    return el.isContentEditable
  }
  window.addEventListener('keydown', (e) => {
    if (isTypingTarget(e.target)) { buf = ''; return }
    const k = e.key.toLowerCase()
    // Non-character keys (Shift, Tab, arrow keys) don't reset the buffer
    // outright — they just don't extend it — so the cheat survives a stray
    // modifier press. Anything else of length 1 gets appended.
    if (k.length !== 1) return
    buf = (buf + k).slice(-target.length)
    if (buf === target) {
      buf = ''
      toggleDebug()
    }
  })
}
// Best-effort module-level install for dev (vite serve keeps side-effects);
// App.vue also calls installDebugUnlock() in setup so production builds — where
// this bare side-effect can be tree-shaken — still attach the listener at boot.
installDebugUnlock()

/** Minimal surface of the running game the cheats need (published by FoldEngine). */
interface FoldDebugHandle {
  jumpTo(page: number): void
  clearPage(): void
}

const foldHandle = (): FoldDebugHandle | null =>
  ((window as unknown as { __fold?: FoldDebugHandle }).__fold) ?? null

const useCheats = () => {
  if (!isCheat.value) return {}

  // Dev shortcuts for Castle Fold. The running engine publishes `window.__fold`
  // (dev builds, or when the `cheat` flag is set), so nothing here imports the
  // game — `useCheats` runs on the eager boot path and must stay tiny.
  const cheatsMap: Record<string, () => void> = {
    'ctrl+shift+alt+c': () => {
      foldHandle()?.clearPage()
      console.warn('[CHEAT] Page cleared.')
    }
  }
  for (let p = 1; p <= 6; p++) {
    cheatsMap[`ctrl+shift+alt+${p}`] = () => {
      foldHandle()?.jumpTo(p)
      console.warn(`[CHEAT] Jumped to page ${p}.`)
    }
  }

  const onKey = (e: KeyboardEvent): void => {
    const combo = `${e.ctrlKey ? 'ctrl+' : ''}${e.shiftKey ? 'shift+' : ''}${e.altKey ? 'alt+' : ''}${e.code.replace(/^Key|^Digit/, '').toLowerCase()}`
    const fn = cheatsMap[combo]
    if (fn) {
      e.preventDefault()
      fn()
    }
  }
  onMounted(() => window.addEventListener('keydown', onKey))
  onUnmounted(() => window.removeEventListener('keydown', onKey))
  return { isCheat }
}

export default useCheats
