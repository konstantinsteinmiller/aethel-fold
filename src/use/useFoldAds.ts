// ─── Aethel Fold ad placements (roadmaps #9, #17, #19) ──────────────────────
//
// Module-level singleton that binds the pure rules in `ads/foldAdPolicy` to
// the live game and the provider surface in `useAds`. Everything here is
// behind the build constants in `@/platforms/adFlags`: on the jury build, and
// on every platform without an ad SDK, they are literal `false`, so each entry
// point returns at its first line (and the minifier drops the rest). No ad is
// ever requested and no ad UI is ever offered there.
//
// Pause and audio: `showMidgameAd` / `showRewardedAd` hard-stop the music, cut
// one-shot SFX and hold `isAdShowing` for the ad's lifetime. That ORs into
// `isGamePaused`, which `FoldScene` already turns into `engine.setPaused` (the
// sim and the paper stop) and `syncGameplayLifecycle(false)` (the platform's
// gameplayStop); both lift when the ad closes. The providers themselves call
// the SDK's gameplayStop/Start around the ad where the SDK has them.

import { computed, nextTick, ref } from 'vue'
import { ANY_FOLD_ADS, INTERSTITIAL_ADS, REWARDED_ADS } from '@/platforms/adFlags'
import { isInterstitialReady, isRewardedReady, showMidgameAd, showRewardedAd } from '@/use/useAds'
import { addPlaytime, playtime } from '@/use/useFoldProgress'
import {
  cancelInterstitial, createPacer, isCalmFor, markAdClosed, markInterstitialStart, pollInterstitial, requestInterstitial,
  retryVariant, secondChanceAvailable, type AdMoment, type CalmProbe, type RetryVariant, type RewardedInput
} from '@/use/ads/foldAdPolicy'

/** Seconds of play not yet written to the save (written every `SAVE_EVERY_S`). */
const SAVE_EVERY_S = 10

const nowS = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000

const pacer = createPacer()
/** Played seconds this session not yet in the save. */
const unsaved = ref(0)
/** Lifetime playtime including this session's unsaved seconds. */
export const adPlaytime = computed(() => playtime.value + unsaved.value)
/** A rewarded ad is on screen (the buttons show a busy state and ignore taps). */
export const rewardedInFlight = ref(false)
/** An ad (the second-chance offer, or an interstitial) already came on this death: the Try again stays plain. */
let adThisDeath = false

const rewardedInput = (rushing: boolean): RewardedInput => ({
  enabled: REWARDED_ADS,
  ready: isRewardedReady.value,
  playtime: adPlaytime.value,
  rushing
})

/** May the last heart hold for a second-chance offer (#19)? Reactive. */
export const secondChanceOn = computed(() => REWARDED_ADS && !rewardedInFlight.value && secondChanceAvailable(rewardedInput(false)))

/** The Almost! Try again's look for this crumple (#9): read once, when the button comes up. */
export const almostVariant = (continuesLeft: number, rushing: boolean): RetryVariant => {
  if (!REWARDED_ADS) return 'plain'
  return retryVariant(rewardedInput(rushing), continuesLeft, adThisDeath)
}

/** The second-chance offer was put in front of the player: it counts as this death's ad. */
export const noteSecondChanceOffered = (): void => {
  if (REWARDED_ADS) adThisDeath = true
}

/** A page dropped (a retry, a fresh page) or a new page began: the next death starts clean. */
export const resetDeath = (): void => {
  adThisDeath = false
}

/**
 * Show a rewarded ad for a placement. Resolves true only if it was watched to
 * the end; false on no fill, a skip, the throttle, an error, or a build without
 * rewarded ads. Awaits a tick after the ad so the pause it held has lifted
 * before the caller grants the reward into the game.
 */
export const watchRewarded = async (): Promise<boolean> => {
  if (!REWARDED_ADS || rewardedInFlight.value) return false
  rewardedInFlight.value = true
  try {
    const granted = await showRewardedAd()
    // A rewarded ad the player chose to watch also restarts the interstitial gap.
    if (granted) markAdClosed(pacer, nowS())
    await nextTick()
    return granted
  } finally {
    rewardedInFlight.value = false
  }
}

// ─── Interstitials (#17) ─────────────────────────────────────────────────────

/** Requests made (and dropped as not allowed) — for the e2e and the debug handle. */
export const interstitialLog = { requested: 0, shown: 0 }

/** A moment for an interstitial happened (page clear, boss clear, crumple). */
export const requestFoldInterstitial = (moment: AdMoment): void => {
  if (!INTERSTITIAL_ADS) return
  // One ad per death: a crumple right after a turned-down second chance gets no interstitial.
  if (moment === 'crumple' && adThisDeath) return
  interstitialLog.requested++
  requestInterstitial(pacer, moment, nowS(), adPlaytime.value)
}

/**
 * Per frame (allocation-free): when the pending interstitial's calm point has
 * come, show it. The ad's pause gate freezes the game until it closes.
 */
export const pollFoldInterstitial = (g: CalmProbe): void => {
  if (!INTERSTITIAL_ADS || pacer.pending === null) return
  const moment = pollInterstitial(pacer, nowS(), adPlaytime.value, isCalmFor(pacer.pending, g))
  if (moment === null) return
  // No fill right now: drop it (the game never waits on an ad that isn't there).
  if (!isInterstitialReady.value) return
  if (moment === 'crumple') adThisDeath = true
  void playInterstitial()
}

const playInterstitial = async (): Promise<void> => {
  markInterstitialStart(pacer)
  interstitialLog.shown++
  try {
    await showMidgameAd()
  } finally {
    markAdClosed(pacer, nowS())
  }
}

/** Forget a pending interstitial (a new run, a rush, leaving the scene). */
export const cancelFoldInterstitial = (): void => {
  if (INTERSTITIAL_ADS) cancelInterstitial(pacer)
}

// ─── Playtime clock ─────────────────────────────────────────────────────────

let clock: ReturnType<typeof setInterval> | null = null

const flushPlaytime = (): void => {
  const s = unsaved.value
  if (s <= 0) return
  unsaved.value = 0
  addPlaytime(s)
}

/**
 * Count live play (not paused, not on a menu) once a second, for the ad grace.
 * Ad builds only: the jury build never writes `fold_playtime`.
 */
export const startPlaytimeClock = (isLive: () => boolean): void => {
  if (!ANY_FOLD_ADS || clock !== null) return
  clock = setInterval(() => {
    if (!isLive()) return
    unsaved.value++
    if (unsaved.value >= SAVE_EVERY_S) flushPlaytime()
  }, 1000)
}

export const stopPlaytimeClock = (): void => {
  if (clock !== null) clearInterval(clock)
  clock = null
  if (ANY_FOLD_ADS) flushPlaytime()
}

/** Test seam: a fresh pacer and death state. */
export const __resetFoldAds = (): void => {
  pacer.lastAt = -Infinity
  pacer.pending = null
  pacer.pendingAt = 0
  pacer.showing = false
  adThisDeath = false
  unsaved.value = 0
  rewardedInFlight.value = false
  interstitialLog.requested = 0
  interstitialLog.shown = 0
}

/** Debug view of the pacer (the DEV handle). */
export const foldAdsDebug = (): { lastAt: number; pending: AdMoment | null; showing: boolean; playtime: number; requested: number; shown: number } => ({
  lastAt: pacer.lastAt,
  pending: pacer.pending,
  showing: pacer.showing,
  playtime: adPlaytime.value,
  requested: interstitialLog.requested,
  shown: interstitialLog.shown
})
