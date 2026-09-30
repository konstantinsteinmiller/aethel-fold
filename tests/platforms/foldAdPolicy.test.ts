import { describe, expect, it } from 'vitest'
import {
  AD_GRACE_S, CRUMPLE_CALM_FROM_S, CRUMPLE_CALM_UNTIL_S, INTERSTITIAL_GAP_S, INTRO_SETTLE_S, PENDING_TTL_S,
  createPacer, interstitialAllowed, isCalmFor, markAdClosed, markInterstitialStart, pollInterstitial, requestInterstitial,
  retryVariant, secondChanceAvailable, type CalmProbe, type RewardedInput
} from '@/use/ads/foldAdPolicy'
import { ALMOST, CRUMPLE_TIME } from '@/fold/logic/config'
import { BOOKS } from '@/fold/logic/pages'

const probe = (over: Partial<CalmProbe> = {}): CalmProbe => ({
  phase: 'intro',
  phaseTime: 1,
  paused: false,
  defeated: false,
  rushing: false,
  lastChance: 0,
  lesson: { id: null },
  shelf: { open: false },
  folds: [{ phase: 'ready' }, { phase: 'up' }],
  sling: null,
  ...over
})

const PLAYED = AD_GRACE_S + 60

describe('interstitial pacing (#17)', () => {
  it('keeps its crumple window in step with the game', () => {
    expect(CRUMPLE_CALM_FROM_S).toBe(CRUMPLE_TIME)
    expect(CRUMPLE_CALM_UNTIL_S).toBe(ALMOST.button)
    expect(INTERSTITIAL_GAP_S).toBe(121)
    expect(AD_GRACE_S).toBe(180)
  })

  it('every page\'s intro lasts past the page-clear calm point, so there is always a window', () => {
    for (const book of Object.values(BOOKS)) {
      for (const page of Object.values(book)) expect(page.introDelay).toBeGreaterThan(INTRO_SETTLE_S + 0.1)
    }
  })

  it('shows none inside the first three minutes of playtime', () => {
    const p = createPacer()
    expect(interstitialAllowed(p, 1000, AD_GRACE_S - 1)).toBe(false)
    expect(requestInterstitial(p, 'pageClear', 1000, AD_GRACE_S - 1)).toBe(false)
    expect(pollInterstitial(p, 1001, AD_GRACE_S - 1, true)).toBeNull()
    expect(requestInterstitial(p, 'pageClear', 1000, AD_GRACE_S)).toBe(true)
  })

  it('the first after the grace may show at once; then 121 s must pass', () => {
    const p = createPacer()
    expect(requestInterstitial(p, 'pageClear', 10, PLAYED)).toBe(true)
    expect(pollInterstitial(p, 11, PLAYED, true)).toBe('pageClear')
    markInterstitialStart(p)
    expect(interstitialAllowed(p, 20, PLAYED)).toBe(false) // one is on screen
    markAdClosed(p, 40)
    expect(requestInterstitial(p, 'crumple', 40 + INTERSTITIAL_GAP_S - 0.5, PLAYED)).toBe(false)
    expect(requestInterstitial(p, 'crumple', 40 + INTERSTITIAL_GAP_S, PLAYED)).toBe(true)
  })

  it('a rewarded ad restarts the gap too', () => {
    const p = createPacer()
    markAdClosed(p, 500)
    expect(interstitialAllowed(p, 560, PLAYED)).toBe(false)
    expect(interstitialAllowed(p, 621, PLAYED)).toBe(true)
  })

  it('waits for calm, and drops a request that never finds it', () => {
    const p = createPacer()
    requestInterstitial(p, 'pageClear', 0, PLAYED)
    expect(pollInterstitial(p, 1, PLAYED, false)).toBeNull()
    expect(p.pending).toBe('pageClear')
    expect(pollInterstitial(p, PENDING_TTL_S + 0.1, PLAYED, true)).toBeNull()
    expect(p.pending).toBeNull()
  })

  it('the latest moment wins', () => {
    const p = createPacer()
    requestInterstitial(p, 'pageClear', 0, PLAYED)
    requestInterstitial(p, 'bossClear', 1, PLAYED)
    expect(pollInterstitial(p, 2, PLAYED, true)).toBe('bossClear')
    expect(pollInterstitial(p, 3, PLAYED, true)).toBeNull()
  })
})

describe('calm points', () => {
  it('page and boss clear: once the next page has settled into its intro', () => {
    expect(isCalmFor('pageClear', probe({ phase: 'turn' }))).toBe(false)
    expect(isCalmFor('pageClear', probe({ phase: 'cleared' }))).toBe(false)
    expect(isCalmFor('pageClear', probe({ phase: 'intro', phaseTime: INTRO_SETTLE_S - 0.1 }))).toBe(false)
    expect(isCalmFor('pageClear', probe({ phase: 'intro', phaseTime: INTRO_SETTLE_S }))).toBe(true)
    expect(isCalmFor('bossClear', probe())).toBe(true)
    expect(isCalmFor('pageClear', probe({ phase: 'play' }))).toBe(false)
  })

  it('crumple: after the ball is gone, before the Try again comes up', () => {
    const c = (t: number) => probe({ phase: 'crumple', defeated: true, phaseTime: t })
    expect(isCalmFor('crumple', c(CRUMPLE_CALM_FROM_S - 0.05))).toBe(false)
    expect(isCalmFor('crumple', c(CRUMPLE_CALM_FROM_S))).toBe(true)
    expect(isCalmFor('crumple', c(CRUMPLE_CALM_UNTIL_S))).toBe(false)
    expect(isCalmFor('crumple', probe({ phase: 'crumple', defeated: false, phaseTime: 1.5 }))).toBe(false)
  })

  it.each([
    ['a lesson', { lesson: { id: 'swipe' } }],
    ['a fold in the hand', { folds: [{ phase: 'dragging' }] }],
    ['a sling pulled back', { sling: { aiming: true } }],
    ['a Dragon Rush', { rushing: true }],
    ['the shelf', { shelf: { open: true } }],
    ['the pause', { paused: true }],
    ['a second-chance offer', { lastChance: 2 }]
  ] as [string, Partial<CalmProbe>][])('never during %s', (_name, over) => {
    expect(isCalmFor('pageClear', probe(over))).toBe(false)
    expect(isCalmFor('crumple', probe({ phase: 'crumple', defeated: true, phaseTime: 1.5, ...over }))).toBe(false)
  })
})

describe('rewarded placements (#9, #19)', () => {
  const r = (over: Partial<RewardedInput> = {}): RewardedInput => ({ enabled: true, ready: true, playtime: PLAYED, rushing: false, ...over })

  it('Try again is rewarded only in an ad build, past the grace, with an ad ready', () => {
    expect(retryVariant(r(), 1, false)).toBe('rewarded')
    expect(retryVariant(r({ enabled: false }), 1, false)).toBe('plain')
    expect(retryVariant(r({ ready: false }), 1, false)).toBe('plain')
    expect(retryVariant(r({ playtime: AD_GRACE_S - 1 }), 1, false)).toBe('plain')
    expect(retryVariant(r({ rushing: true }), 1, false)).toBe('plain')
  })

  it('stays plain when the retry is the fresh page that drops anyway', () => {
    expect(retryVariant(r(), 0, false)).toBe('plain')
  })

  it('one ad per death: plain after a second-chance offer or an interstitial', () => {
    expect(retryVariant(r(), 1, true)).toBe('plain')
  })

  it('the second chance follows the same gates', () => {
    expect(secondChanceAvailable(r())).toBe(true)
    expect(secondChanceAvailable(r({ enabled: false }))).toBe(false)
    expect(secondChanceAvailable(r({ ready: false }))).toBe(false) // no fill or throttled
    expect(secondChanceAvailable(r({ playtime: 10 }))).toBe(false)
  })
})
