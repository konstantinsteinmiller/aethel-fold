import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { mobileCheck } from '@/utils/function'
import { DEFAULT_LOCALE } from '@/utils/enums'
import { isDbInitialized, isSplashScreenVisible } from '@/use/useMatch'
import { saveDataVersion } from '@/use/useSaveStatus'
import { getState, setState, hasState } from '@/use/useAethelState'
import { SOUND_KEY, MUSIC_KEY, LANGUAGE_KEY } from '@/keys'

export const windowWidth = ref(window.innerWidth)
export const windowHeight = ref(window.innerHeight)

export const orientation = ref(mobileCheck() && windowWidth.value > windowHeight.value ? 'landscape' : 'portrait')

export const isMobileLandscape = computed(() =>
  mobileCheck() && windowWidth.value > 500 && orientation.value === 'landscape'
)
export const isMobilePortrait = computed(() =>
  mobileCheck() && windowWidth.value < windowHeight.value
)

// A short viewport (≤ 500px tall) where the full-size desktop result/reward
// overlay overflows — e.g. the game embedded in a portal iframe on a
// Chromebook (~764×385). Deliberately NOT gated on `mobileCheck()`, so it
// catches the non-touch short-embed case that `isMobileLandscape` misses; the
// overlay uses it to shrink the title, drop the tiles line, and tighten gaps.
export const isShortViewport = computed(() => windowHeight.value <= 500)

declare const APP_VERSION: string
export const isCrazyWeb = import.meta.env.VITE_APP_CRAZY_WEB === 'true'
export const isWaveDash = import.meta.env.VITE_APP_WAVEDASH === 'true'
export const isItch = import.meta.env.VITE_APP_ITCH === 'true'
export const isGlitch = import.meta.env.VITE_APP_GLITCH === 'true'
export const isGameDistribution = import.meta.env.VITE_APP_GAME_DISTRIBUTION === 'true'
export const isPlaygama = import.meta.env.VITE_APP_PLAYGAMA === 'true'
export const isGamepix = import.meta.env.VITE_APP_GAMEPIX === 'true'
export const isGameMonetize = import.meta.env.VITE_APP_GAME_MONETIZE === 'true'
export const isYandex = import.meta.env.VITE_APP_YANDEX === 'true'
export const isPoki = import.meta.env.VITE_APP_POKI === 'true'
export const showMediatorAds = import.meta.env.VITE_APP_SHOW_MEDIATOR_ADS === 'true'
export const isNative = import.meta.env.VITE_APP_NATIVE === 'true'
export const isWeb = import.meta.env.VITE_APP_NATIVE !== 'true'
export const isDemo = import.meta.env.VITE_APP_DEMO === 'true'
export const version: string = APP_VERSION

// ─── Persisted settings ────────────────────────────────────────────────────
//
// Aethel Fold persists THREE user settings — sound volume, music volume and
// locale — as fields inside the single `aethel_state` blob (keys catalogued in
// `src/keys.ts`), never as their own localStorage entries. On a platform build
// the blob goes through the patched `SaveManager.setItem` and is mirrored to
// the SDK cloud store automatically.
//
// Key constants are re-exported here so long-standing importers
// (`useCrazyMuteSync`, tests) keep working without an extra import hop.
export { SOUND_KEY, MUSIC_KEY, LANGUAGE_KEY }

const readNumber = (key: string, fallback: number): number => {
  const v = getState<unknown>(key)
  if (v === undefined || v === null) return fallback
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : fallback
}
const readString = <T extends string>(key: string, fallback: T): T => {
  const v = getState<unknown>(key)
  if (v === undefined || v === null) return fallback
  return String(v) as T
}

/** Default audio levels for a fresh install. Exported so the mute toggle
 *  (`useCrazyMuteSync`) can restore to the same levels when a user unmutes
 *  but there's no pre-mute snapshot to fall back to. */
export const DEFAULT_SOUND_VOLUME = 0.7
export const DEFAULT_MUSIC_VOLUME = 0.6

const userSoundVolume: Ref<number> = ref(readNumber(SOUND_KEY, DEFAULT_SOUND_VOLUME))
const userMusicVolume: Ref<number> = ref(readNumber(MUSIC_KEY, DEFAULT_MUSIC_VOLUME))
// The fallback is the game's default language, not a hardcoded 'en'. This ref
// is what `main.ts` applies once hydrate settles, so whatever is written here
// *overrides* `resolveInitialLocale` for every player who has never opened the
// language picker — which is all of them, on a first run.
const userLanguage: Ref<string> = ref(readString(LANGUAGE_KEY, DEFAULT_LOCALE))

// Re-read on hydrate-success bump. Module init reads these synchronously
// from localStorage, but on cloud-only builds (CrazyGames) the blob is
// in-memory only — `useUser.ts` is one of the few composables imported at
// the top of `main.ts`, so its module evaluation runs BEFORE
// `await saveManager.init()` populates the blob from `sdk.data`. Without
// this watcher the user's saved difficulty / volume / language would
// silently revert to defaults on every refresh.
//
// Settings-stranding fix: after refreshing refs from localStorage, write
// the current ref value back for any setting still null in localStorage.
// Triggers the patched setItem path → strategy.onLocalSet → sdk.data, so
// even a player who never opens OptionsModal ends up with their settings
// round-tripping through the cloud. Idempotent for returning players
// because hydrate has already populated localStorage from sdk.data.
//
// LANGUAGE is intentionally NOT seeded here: main.ts handles it
// separately so the CrazyGames portal locale (`cgLocale`) can seed
// first-time players. If we wrote the default 'en' here, main.ts's
// "is there a stored choice?" probe would always see a value and
// never apply the portal locale to a fresh player.
watch(saveDataVersion, () => {
  userSoundVolume.value = readNumber(SOUND_KEY, userSoundVolume.value)
  userMusicVolume.value = readNumber(MUSIC_KEY, userMusicVolume.value)
  userLanguage.value = readString(LANGUAGE_KEY, userLanguage.value)

  if (!hasState(SOUND_KEY)) setState(SOUND_KEY, userSoundVolume.value)
  if (!hasState(MUSIC_KEY)) setState(MUSIC_KEY, userMusicVolume.value)
})

// Boot signal that several composables (`main.ts`, `useCrazyMuteSync`,
// the i18n loader) wait on. Previously the IDB hydrate flipped this; with
// localStorage we have synchronous reads, so flip immediately. The
// SaveManager has already populated localStorage from the cloud strategy
// before this module evaluates (see `main.ts`: `await saveManager.init()`
// runs BEFORE `import('@/App.vue')`).
isDbInitialized.value = true
isSplashScreenVisible.value = false

// One-time legacy cleanup. CG QA's standing rule is "NO locally-saved
// data" — both localStorage AND sessionStorage count. We sweep relics
// from prior builds at module load:
//   • `user_db` IndexedDB store — held CardQuest userHand / userCollection
//     / quest-* relics nothing here references.
//   • `card*` keys (case-insensitive) — the CardQuest-era prefix that
//     produced `cardQuestUserLanguage`, `cardQuestSoundVolume`, etc.
//   • `chaosArena*` keys — the interim prefix from the
//     2026-05-04 build. We no longer mirror the locale hint to
//     sessionStorage at all (the value lives in `user_language`,
//     which flows through `sdk.data` on CG), so any existing
//     `chaosArena*` entry is also dead data.
// Fire-and-forget — errors are swallowed because there is nothing to
// recover. Runs at module load (useUser.ts is imported at the top of
// main.ts) so the data is gone before the rest of the app boots.
try {
  if (typeof window !== 'undefined' && window.indexedDB?.deleteDatabase) {
    const req = window.indexedDB.deleteDatabase('user_db')
    req.onerror = () => { /* no-op: harmless if locked / already gone */
    }
  }
} catch { /* harmless */
}
const LEGACY_KEY_RE = /^(card|chaosArena)/i
const sweepLegacyKeys = (storage: Storage) => {
  try {
    const toRemove: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (k && LEGACY_KEY_RE.test(k)) toRemove.push(k)
    }
    for (const k of toRemove) storage.removeItem(k)
  } catch { /* harmless */
  }
}
sweepLegacyKeys(localStorage)
sweepLegacyKeys(sessionStorage)

// ─── Composable surface ───────────────────────────────────────────────────

const useUser = () => {
  const setSettingValue = (name: string, value: unknown) => {
    switch (name) {
      case 'sound':
        userSoundVolume.value = +(value as number)
        setState(SOUND_KEY, userSoundVolume.value)
        break
      case 'music':
        userMusicVolume.value = +(value as number)
        setState(MUSIC_KEY, userMusicVolume.value)
        break
      case 'language':
        userLanguage.value = value as string
        setState(LANGUAGE_KEY, userLanguage.value)
        break
    }
  }

  return {
    userSoundVolume,
    userMusicVolume,
    userLanguage,
    setSettingValue
  }
}

export default useUser
