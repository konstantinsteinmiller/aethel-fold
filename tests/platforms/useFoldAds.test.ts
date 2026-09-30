import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalmProbe } from '@/use/ads/foldAdPolicy'

// `useFoldAds` wired to a stand-in provider: what each build config actually
// asks the SDK for (roadmaps #9, #17, #19).

const box = vi.hoisted(() => ({
  ready: null as null | { value: boolean },
  interstitialReady: null as null | { value: boolean },
  grant: true,
  rewarded: 0,
  midgame: 0
}))

vi.mock('@/use/useAds', async () => {
  const { ref, computed } = await vi.importActual<typeof import('vue')>('vue')
  box.ready = ref(true)
  box.interstitialReady = ref(true)
  return {
    isRewardedReady: computed(() => box.ready!.value),
    isInterstitialReady: computed(() => box.interstitialReady!.value),
    showRewardedAd: async () => {
      box.rewarded++
      return box.grant
    },
    showMidgameAd: async () => {
      box.midgame++
    }
  }
})

const calm = (over: Partial<CalmProbe> = {}): CalmProbe => ({
  phase: 'intro', phaseTime: 1, paused: false, defeated: false, rushing: false, lastChance: 0,
  lesson: { id: null }, shelf: { open: false }, folds: [], sling: null, ...over
})

const load = async (env: Record<string, string>, playtime: number) => {
  vi.resetModules()
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  localStorage.setItem('aethel_state', JSON.stringify({ fold_playtime: playtime }))
  const ads = await import('@/use/useFoldAds')
  const progress = await import('@/use/useFoldProgress')
  return { ads, progress }
}

const AD_BUILD = { VITE_APP_GAMEPIX: 'true', VITE_APP_REWARDED: 'true', VITE_APP_INTERSTITIALS: 'true' }

beforeEach(() => {
  localStorage.clear()
  box.grant = true
  if (box.ready) box.ready.value = true
  if (box.interstitialReady) box.interstitialReady.value = true
  box.rewarded = 0
  box.midgame = 0
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('useFoldAds — jury config', () => {
  it('never asks the provider for anything, whatever it says is ready', async () => {
    const { ads } = await load({}, 3600)
    ads.requestFoldInterstitial('pageClear')
    ads.requestFoldInterstitial('crumple')
    ads.pollFoldInterstitial(calm())
    ads.pollFoldInterstitial(calm({ phase: 'crumple', defeated: true, phaseTime: 1.5 }))
    expect(await ads.watchRewarded()).toBe(false)
    expect(ads.secondChanceOn.value).toBe(false)
    expect(ads.almostVariant(1, false)).toBe('plain')
    expect(box.midgame).toBe(0)
    expect(box.rewarded).toBe(0)
  })

  it('never writes a playtime into the save', async () => {
    vi.useFakeTimers()
    const { ads } = await load({}, 0)
    localStorage.clear()
    ads.startPlaytimeClock(() => true)
    vi.advanceTimersByTime(30_000)
    ads.stopPlaytimeClock()
    expect(localStorage.getItem('aethel_state') ?? '').not.toContain('fold_playtime')
  })
})

describe('useFoldAds — ad build', () => {
  it('shows an interstitial at the calm point after a page clear', async () => {
    const { ads } = await load(AD_BUILD, 3600)
    ads.requestFoldInterstitial('pageClear')
    ads.pollFoldInterstitial(calm({ phase: 'turn' }))
    expect(box.midgame).toBe(0)
    ads.pollFoldInterstitial(calm())
    await Promise.resolve()
    expect(box.midgame).toBe(1)
    // …and not another for 121 s.
    ads.requestFoldInterstitial('pageClear')
    ads.pollFoldInterstitial(calm())
    expect(box.midgame).toBe(1)
  })

  it('shows none inside the grace', async () => {
    const { ads } = await load(AD_BUILD, 60)
    ads.requestFoldInterstitial('pageClear')
    ads.pollFoldInterstitial(calm())
    expect(box.midgame).toBe(0)
    expect(ads.secondChanceOn.value).toBe(false)
    expect(ads.almostVariant(1, false)).toBe('plain')
  })

  it('drops an interstitial there is no fill for (the game never waits)', async () => {
    const { ads } = await load(AD_BUILD, 3600)
    box.interstitialReady!.value = false
    ads.requestFoldInterstitial('crumple')
    ads.pollFoldInterstitial(calm({ phase: 'crumple', defeated: true, phaseTime: 1.5 }))
    box.interstitialReady!.value = true
    ads.pollFoldInterstitial(calm({ phase: 'crumple', defeated: true, phaseTime: 1.6 }))
    expect(box.midgame).toBe(0)
  })

  it('a crumple interstitial makes that death\'s Try again plain', async () => {
    const { ads } = await load(AD_BUILD, 3600)
    expect(ads.almostVariant(1, false)).toBe('rewarded')
    ads.requestFoldInterstitial('crumple')
    ads.pollFoldInterstitial(calm({ phase: 'crumple', defeated: true, phaseTime: 1.5 }))
    expect(box.midgame).toBe(1)
    expect(ads.almostVariant(1, false)).toBe('plain')
    ads.resetDeath()
    expect(ads.almostVariant(1, false)).toBe('rewarded')
  })

  it('after a second-chance offer: no crumple interstitial and a plain Try again', async () => {
    const { ads } = await load(AD_BUILD, 3600)
    ads.noteSecondChanceOffered()
    ads.requestFoldInterstitial('crumple')
    ads.pollFoldInterstitial(calm({ phase: 'crumple', defeated: true, phaseTime: 1.5 }))
    expect(box.midgame).toBe(0)
    expect(ads.almostVariant(1, false)).toBe('plain')
  })

  it('rewarded: true only when watched; a skip or no fill is false (the caller falls back)', async () => {
    const { ads } = await load(AD_BUILD, 3600)
    expect(await ads.watchRewarded()).toBe(true)
    box.grant = false
    expect(await ads.watchRewarded()).toBe(false)
    expect(box.rewarded).toBe(2)
  })

  it('the second chance is not offered while the provider has nothing (or the throttle is full)', async () => {
    const { ads } = await load(AD_BUILD, 3600)
    expect(ads.secondChanceOn.value).toBe(true)
    box.ready!.value = false
    expect(ads.secondChanceOn.value).toBe(false)
    expect(ads.almostVariant(1, false)).toBe('plain')
  })

  it('counts live playtime into aethel_state and crosses the grace', async () => {
    vi.useFakeTimers()
    const { ads, progress } = await load(AD_BUILD, AD_GRACE_LESS_5)
    let live = true
    ads.startPlaytimeClock(() => live)
    vi.advanceTimersByTime(3000)
    live = false
    vi.advanceTimersByTime(10_000)
    expect(ads.adPlaytime.value).toBe(AD_GRACE_LESS_5 + 3)
    expect(ads.almostVariant(1, false)).toBe('plain')
    live = true
    vi.advanceTimersByTime(3000)
    expect(ads.almostVariant(1, false)).toBe('rewarded')
    ads.stopPlaytimeClock()
    expect(progress.playtime.value).toBe(AD_GRACE_LESS_5 + 6)
    ;(await import('@/use/useAethelState')).flushPersist()
    expect(JSON.parse(localStorage.getItem('aethel_state')!).fold_playtime).toBe(AD_GRACE_LESS_5 + 6)
  })
})

const AD_GRACE_LESS_5 = 175
