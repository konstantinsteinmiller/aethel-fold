// ─── Aethel Fold ad policy (roadmap #9, #17, #19) — pure TS ─────────────────
//
// Every rule about *when* an ad may show lives here, free of Vue, the SDKs and
// the clock, so the whole matrix is unit-testable. `useFoldAds` wires it to the
// live game; the build flags in `@/platforms/adFlags` decide whether any of it
// is compiled in at all.
//
// The rules:
//   • No ad of any kind before `AD_GRACE_S` of lifetime playtime (a first-time
//     player's first three minutes are ad-free; playtime is saved in
//     `aethel_state`, so a returning player doesn't get the grace again).
//   • Interstitials: at most one per `INTERSTITIAL_GAP_S`; a rewarded ad the
//     player chose to watch restarts that clock too.
//   • An interstitial is *requested* at a moment (page clear, boss clear,
//     crumple) and *shown* at the next calm point for that moment — never
//     during a lesson, a fold in the hand, a Dragon Rush, the page turn or the
//     shelf. If no calm point comes within `PENDING_TTL_S` it is dropped, never
//     forced into play.
//   • One ad per death: the Almost! Try again is plain when the player was
//     already offered the second chance, or sat through an interstitial, on
//     this crumple.

import type { GamePhase } from '@/fold/logic/types'

/** Lifetime playtime (s) before any ad: the first-time player's grace. */
export const AD_GRACE_S = 180
/** Minimum gap (s) between two interstitials (and after a rewarded ad). */
export const INTERSTITIAL_GAP_S = 121
/** A requested interstitial that finds no calm point within this (s) is dropped. */
export const PENDING_TTL_S = 8
/**
 * Page clear: the next page has been in its intro this long (s): the sheet has
 * landed, and the first wave (every page's `introDelay` is longer) hasn't
 * marched yet — the quietest beat a page has.
 */
export const INTRO_SETTLE_S = 0.2
/** Crumple: the ball is gone from this phase time (s)… (`CRUMPLE_TIME`) */
export const CRUMPLE_CALM_FROM_S = 1.25
/** …and the Try-again button comes at this one (`ALMOST.button`): the ad goes before it. */
export const CRUMPLE_CALM_UNTIL_S = 1.9

export type AdMoment = 'pageClear' | 'bossClear' | 'crumple'

/** What the policy reads of the game (a `FoldGame` fits structurally). */
export interface CalmProbe {
  phase: GamePhase
  phaseTime: number
  paused: boolean
  defeated: boolean
  rushing: boolean
  lastChance: number
  lesson: { id: string | null }
  shelf: { open: boolean }
  folds: readonly { phase: string }[]
  sling: { aiming: boolean } | null
}

/** Is `g` at a calm point for an interstitial requested at `moment`? Allocation-free. */
export const isCalmFor = (moment: AdMoment, g: CalmProbe): boolean => {
  if (g.paused || g.rushing || g.shelf.open || g.lastChance > 0 || g.lesson.id) return false
  for (let i = 0; i < g.folds.length; i++) if (g.folds[i]!.phase === 'dragging') return false
  if (g.sling?.aiming) return false
  if (moment === 'crumple') {
    return g.phase === 'crumple' && g.defeated && g.phaseTime >= CRUMPLE_CALM_FROM_S && g.phaseTime < CRUMPLE_CALM_UNTIL_S
  }
  // Page / boss clear: the next page has dropped in and its pop-ups have risen.
  return g.phase === 'intro' && g.phaseTime >= INTRO_SETTLE_S
}

// ─── Interstitial pacer ─────────────────────────────────────────────────────

export interface InterstitialPacer {
  /** When (s) the last interstitial (or rewarded ad) closed; -Infinity = never this session. */
  lastAt: number
  pending: AdMoment | null
  /** When (s) the pending moment was requested. */
  pendingAt: number
  /** An interstitial is on screen. */
  showing: boolean
}

export const createPacer = (): InterstitialPacer => ({ lastAt: -Infinity, pending: null, pendingAt: 0, showing: false })

/** May an interstitial show at `now` with `playtime` seconds played (the grace and the gap)? */
export const interstitialAllowed = (p: InterstitialPacer, now: number, playtime: number): boolean =>
  !p.showing && playtime >= AD_GRACE_S && now - p.lastAt >= INTERSTITIAL_GAP_S

/**
 * A moment for an interstitial happened. Kept pending (the latest wins) only
 * if one would be allowed now; returns whether it was kept.
 */
export const requestInterstitial = (p: InterstitialPacer, moment: AdMoment, now: number, playtime: number): boolean => {
  if (!interstitialAllowed(p, now, playtime)) return false
  p.pending = moment
  p.pendingAt = now
  return true
}

/**
 * Per frame: should the pending interstitial show now? `calm` is `isCalmFor`
 * for the pending moment. Returns the moment to show (and clears it), or null.
 */
export const pollInterstitial = (p: InterstitialPacer, now: number, playtime: number, calm: boolean): AdMoment | null => {
  const m = p.pending
  if (m === null) return null
  if (now - p.pendingAt > PENDING_TTL_S || !interstitialAllowed(p, now, playtime)) {
    p.pending = null
    return null
  }
  if (!calm) return null
  p.pending = null
  return m
}

/** An interstitial opened. */
export const markInterstitialStart = (p: InterstitialPacer): void => {
  p.showing = true
  p.pending = null
}

/** An interstitial (or a rewarded ad) closed at `now`: the gap restarts. */
export const markAdClosed = (p: InterstitialPacer, now: number): void => {
  p.showing = false
  p.lastAt = now
}

/** Drop a pending request (a new run, a rush, the scene going away). */
export const cancelInterstitial = (p: InterstitialPacer): void => {
  p.pending = null
}

// ─── Rewarded placements ────────────────────────────────────────────────────

export interface RewardedInput {
  /** `REWARDED_ADS`: the build has rewarded placements at all. */
  enabled: boolean
  /** A rewarded ad is loaded and the watch throttle has room. */
  ready: boolean
  /** Lifetime playtime (s). */
  playtime: number
  rushing: boolean
}

/** Can a rewarded placement be offered at all right now? */
export const rewardedAvailable = (r: RewardedInput): boolean =>
  r.enabled && r.ready && !r.rushing && r.playtime >= AD_GRACE_S

export type RetryVariant = 'plain' | 'rewarded'

/**
 * The Almost! moment's Try again (#9): a rewarded button only when a rewarded
 * ad can be offered, the retry is a real continue (not the fresh drop that
 * comes by itself anyway), and no ad has been put in front of the player on
 * this death yet. Otherwise the plain button, exactly as the jury build has it.
 */
export const retryVariant = (r: RewardedInput, continuesLeft: number, adThisDeath: boolean): RetryVariant =>
  rewardedAvailable(r) && continuesLeft > 0 && !adThisDeath ? 'rewarded' : 'plain'

/**
 * Should the game hold on the last heart for a second-chance offer (#19)? The
 * once-per-page rule lives in the game (`FoldGame.secondChanceUsed`).
 */
export const secondChanceAvailable = (r: RewardedInput): boolean => rewardedAvailable(r)
