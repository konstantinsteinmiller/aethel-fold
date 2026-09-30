// ─── Poki plugin ────────────────────────────────────────────────────────────
//
// Everything the game says to the Poki SDK v2 (https://sdk.poki.com). Lazily
// imported: `main.ts`, `FLogoProgress` and `useGameplayLifecycle` reach it only
// behind an `import.meta.env.VITE_APP_POKI === 'true'` literal, and the ad
// provider that imports it statically is aliased to a stub on other builds, so
// no other build carries a byte of it.
//
//   init                 → `pokiPlugin()`: inject the SDK script, `PokiSDK.init()`.
//                          A rejected init (an ad blocker) is logged and the game
//                          carries on; rewarded ads are then reported unavailable.
//   gameLoadingFinished  → `pokiGameLoadingFinished()`, once, on the splash-resolved
//                          edge every platform uses (FLogoProgress).
//   gameplayStart/Stop   → `pokiGameplayStart/Stop()`, driven by FoldScene's single
//                          "live" signal through `useGameplayLifecycle`. Paired: the
//                          plugin remembers what it last told the SDK and never
//                          repeats a call, and it holds any start until
//                          `gameLoadingFinished` has gone out.
//   commercialBreak      → `showCommercialBreakPoki()` (our interstitial).
//   rewardedBreak        → `showRewardedBreakPoki()` → true only when Poki says so.
//
// Pause and mute are not handled here: `useAds` holds `isAdShowing` for the
// whole break, which pauses the sim and suspends audio. Poki throttles
// commercial breaks itself; ours are additionally paced by `useFoldAds`.

import { ref } from 'vue'

export const POKI_SDK_SRC = 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js'
const SDK_SCRIPT_ID = 'poki-sdk'
const SCRIPT_TIMEOUT_MS = 10_000

export interface PokiSdk {
  init: () => Promise<unknown>
  gameLoadingFinished: () => void
  gameplayStart: () => void
  gameplayStop: () => void
  commercialBreak: (onStart?: () => void) => Promise<unknown>
  rewardedBreak: (onStart?: () => void) => Promise<boolean>
  setDebug?: (on: boolean) => void
}

declare global {
  interface Window {
    PokiSDK?: PokiSdk
  }
}

/** The SDK script loaded (breaks can be called; with a blocker they resolve at once). */
export const isPokiSdkLoaded = ref(false)
/** `PokiSDK.init()` resolved: ads can actually play. */
export const isPokiSdkActive = ref(false)
/** `init()` rejected, which Poki documents as the ad-blocker case. */
export const isPokiAdsBlocked = ref(false)

let initPromise: Promise<void> | null = null
let loadingFinished = false
/** What the game wants (live play or not) and what the SDK was last told. */
let wantGameplay = false
let toldGameplay = false

const getSdk = (): PokiSdk | null => (typeof window !== 'undefined' ? window.PokiSDK ?? null : null)

const loadScript = (): Promise<void> => new Promise((resolve, reject) => {
  if (getSdk()) {
    resolve()
    return
  }
  const existing = document.getElementById(SDK_SCRIPT_ID) as HTMLScriptElement | null
  const s = existing ?? document.createElement('script')
  const timer = setTimeout(() => reject(new Error('poki sdk load timeout')), SCRIPT_TIMEOUT_MS)
  s.addEventListener('load', () => {
    clearTimeout(timer)
    resolve()
  })
  s.addEventListener('error', () => {
    clearTimeout(timer)
    reject(new Error('poki sdk failed to load'))
  })
  if (!existing) {
    s.id = SDK_SCRIPT_ID
    s.src = POKI_SDK_SRC
    s.async = true
    document.head.appendChild(s)
  }
})

/** Load and init the SDK. Idempotent; never rejects. */
export const pokiPlugin = (): Promise<void> => {
  if (initPromise) return initPromise
  initPromise = (async () => {
    if (typeof window === 'undefined') return
    try {
      await loadScript()
    } catch (e) {
      console.warn('[poki] SDK script unavailable — playing on without it', e)
      return
    }
    const sdk = getSdk()
    if (!sdk) return
    isPokiSdkLoaded.value = true
    try {
      await sdk.init()
      isPokiSdkActive.value = true
    } catch (e) {
      // Poki: "init rejects when an ad blocker is active — continue the game".
      isPokiAdsBlocked.value = true
      console.warn('[poki] init rejected (ad blocker?) — continuing without ads', e)
    }
    if (import.meta.env.DEV) sdk.setDebug?.(true)
  })()
  return initPromise
}

const flushGameplay = (): void => {
  const sdk = getSdk()
  if (!sdk || !loadingFinished || !isPokiSdkLoaded.value) return
  if (wantGameplay === toldGameplay) return
  toldGameplay = wantGameplay
  try {
    if (wantGameplay) sdk.gameplayStart()
    else sdk.gameplayStop()
  } catch (e) {
    console.warn('[poki] gameplay event failed', e)
  }
}

/** The first playable frame is up: tell Poki loading is over (once). */
export const pokiGameLoadingFinished = async (): Promise<void> => {
  await pokiPlugin()
  if (loadingFinished) return
  const sdk = getSdk()
  if (!sdk || !isPokiSdkLoaded.value) return
  loadingFinished = true
  try {
    sdk.gameLoadingFinished()
  } catch (e) {
    console.warn('[poki] gameLoadingFinished failed', e)
  }
  flushGameplay()
}

export const pokiGameplayStart = (): void => {
  wantGameplay = true
  flushGameplay()
}

export const pokiGameplayStop = (): void => {
  wantGameplay = false
  flushGameplay()
}

/**
 * A commercial break (our interstitial). Gameplay is stopped first, as Poki
 * asks; the live signal restarts it after the break. Resolves when the break
 * is over, including at once when Poki decides not to show one; never rejects.
 */
export const showCommercialBreakPoki = async (onStart?: () => void): Promise<void> => {
  const sdk = getSdk()
  if (!sdk || !isPokiSdkLoaded.value) return
  pokiGameplayStop()
  try {
    await sdk.commercialBreak(onStart)
  } catch (e) {
    console.warn('[poki] commercialBreak failed', e)
  }
}

/**
 * A rewarded break. True only when Poki reports the reward earned; a skip,
 * no fill, a blocker or an SDK error is false. Never rejects.
 */
export const showRewardedBreakPoki = async (): Promise<boolean> => {
  const sdk = getSdk()
  if (!sdk || !isPokiSdkActive.value) return false
  pokiGameplayStop()
  try {
    return (await sdk.rewardedBreak()) === true
  } catch (e) {
    console.warn('[poki] rewardedBreak failed', e)
    return false
  }
}

/** Test seam: forget everything. */
export const __resetPoki = (): void => {
  initPromise = null
  loadingFinished = false
  wantGameplay = false
  toldGameplay = false
  isPokiSdkLoaded.value = false
  isPokiSdkActive.value = false
  isPokiAdsBlocked.value = false
}
