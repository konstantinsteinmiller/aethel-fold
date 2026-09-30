import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import en from '@/i18n/locales/en'

/**
 * ─── Ad UI in FoldScene, mounted (roadmaps #9, #17, #19) ────────────────────
 *
 * The real scene with a stand-in engine: the test drives its `onFrame` hook
 * with a crumple and a held last heart, and reads what the DOM offers.
 *
 *   * The jury config (no platform, no ad flags) shows the plain Try again and
 *     no second-chance card — even with a provider that claims an ad is ready,
 *     because the build flags are what gate it.
 *   * An ad config (CrazyGames + VITE_APP_REWARDED, past the grace) shows the
 *     movie-marked Try again and the second-chance card.
 */

const box = vi.hoisted(() => ({
  hooks: null as null | { onFrame?: (g: unknown, dt: number) => void; onEvent: (e: unknown, g: unknown) => void },
  rewardedCalls: 0,
  midgameCalls: 0,
  secondChance: [] as boolean[]
}))

vi.mock('@/use/useAds', async () => {
  const { ref, computed } = await vi.importActual<typeof import('vue')>('vue')
  const ready = ref(true)
  return {
    isRewardedReady: computed(() => ready.value),
    isInterstitialReady: computed(() => ready.value),
    showRewardedAd: async () => {
      box.rewardedCalls++
      return true
    },
    showMidgameAd: async () => {
      box.midgameCalls++
    }
  }
})

vi.mock('@/fold/FoldEngine', () => {
  class FakeEngine {
    game: Record<string, unknown>
    view = { paintMs: {}, currentLook: {}, printedLook: null, bats: { group: { visible: false } }, effects: {}, desk: { shelfK: 0 } }
    constructor(_c: unknown, hooks: typeof box.hooks) {
      box.hooks = hooks
      this.game = {}
      return new Proxy(this, {
        get(t, k) {
          if (k in t) return (t as Record<PropertyKey, unknown>)[k]
          return () => undefined
        }
      })
    }
    prewarm(): Promise<never> {
      return new Promise(() => undefined)
    }
    shelfTop(): number {
      return Number.NaN
    }
    setSecondChance(on: boolean): void {
      box.secondChance.push(on)
    }
  }
  return { FoldEngine: FakeEngine }
})

/** Just enough of a FoldGame for FoldScene's HUD sync. */
const fakeGame = (over: Record<string, unknown> = {}) => ({
  score: 0,
  hero: { hp: 0, maxHp: 3 },
  phase: 'crumple',
  phaseTime: 2,
  defeated: true,
  continuesLeft: 1,
  rushing: false,
  rush: { running: false, time: 0 },
  lastChance: 0,
  paused: false,
  lesson: { id: null, hand: { anchor: null } },
  shelf: { available: false, inView: false, open: false },
  boss: {},
  folds: [],
  sling: null,
  ...over
})

const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en } })

const mountScene = async () => {
  const FoldScene = (await import('@/views/FoldScene.vue')).default
  const wrapper = mount(FoldScene, { global: { plugins: [i18n] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

const frame = async (g: Record<string, unknown>): Promise<void> => {
  box.hooks!.onFrame!(g, 1 / 60)
  await nextTick()
  await flushPromises()
  // The lazily imported ad components resolve on a later microtask.
  await new Promise((r) => setTimeout(r, 0))
  await flushPromises()
}

beforeEach(() => {
  vi.resetModules()
  box.hooks = null
  box.rewardedCalls = 0
  box.midgameCalls = 0
  box.secondChance = []
  localStorage.clear()
  ;(globalThis as Record<string, unknown>).ResizeObserver ??= class { observe(): void {} disconnect(): void {} }
})
afterEach(() => {
  vi.unstubAllEnvs()
  document.body.innerHTML = ''
})

describe('FoldScene ad UI', () => {
  it('jury config: plain Try again, no movie mark, no second chance, no ad calls', async () => {
    // A seasoned player (no grace) on a provider that says an ad is ready: only the flags stand in the way.
    localStorage.setItem('aethel_state', JSON.stringify({ fold_playtime: 3600 }))
    const w = await mountScene()
    await frame(fakeGame())
    expect(w.find('[data-testid="almost-retry"]').exists()).toBe(true)
    expect(w.find('[data-testid="almost-retry-ad"]').exists()).toBe(false)
    await frame(fakeGame({ phase: 'play', defeated: false, phaseTime: 0, lastChance: 3 }))
    expect(w.find('[data-testid="second-chance"]').exists()).toBe(false)
    expect(w.html()).not.toContain(en.fold.ads.secondChance)
    expect(w.html()).not.toContain(en.fold.ads.tryAgain)
    // The game is never told it may hold for an offer.
    expect(box.secondChance.every((on) => !on)).toBe(true)
    // A page clear and a crumple request nothing.
    box.hooks!.onEvent({ type: 'crumple', a: 3, b: 1, c: 0 }, { ...fakeGame(), kind: { crumples: {}, streak: 0, bossEase: false } })
    await frame(fakeGame({ phaseTime: 1.5 }))
    await new Promise((r) => setTimeout(r, 50))
    expect(box.midgameCalls).toBe(0)
    expect(box.rewardedCalls).toBe(0)
    w.unmount()
  })

  it('ad config past the grace: the movie-marked Try again and the second-chance card', async () => {
    vi.stubEnv('VITE_APP_CRAZY_WEB', 'true')
    vi.stubEnv('VITE_APP_REWARDED', 'true')
    vi.stubEnv('VITE_APP_INTERSTITIALS', 'true')
    localStorage.setItem('aethel_state', JSON.stringify({ fold_playtime: 3600 }))
    const w = await mountScene()
    expect(box.secondChance.at(-1)).toBe(true)
    await frame(fakeGame())
    // The ad button is a lazily imported chunk: give it time to arrive.
    await vi.waitFor(() => expect(w.find('[data-testid="almost-retry-ad"]').exists()).toBe(true), { timeout: 5000 })
    expect(w.find('[data-testid="almost-retry-ad"] .origami-icon').exists()).toBe(true)
    expect(w.find('[data-testid="almost-retry"]').exists()).toBe(false)
    // A tap asks for the rewarded video; with no page to drop (the stand-in engine) it falls back to the plain button.
    await w.find('[data-testid="almost-retry-ad"]').trigger('click')
    await flushPromises()
    expect(box.rewardedCalls).toBe(1)
    await vi.waitFor(() => expect(w.find('[data-testid="almost-retry"]').exists()).toBe(true))
    // A crumple asks for an interstitial, shown in the calm after the ball is gone (the grace is long past).
    box.hooks!.onEvent({ type: 'crumple', a: 3, b: 1, c: 0 }, { ...fakeGame(), kind: { crumples: {}, streak: 0, bossEase: false } })
    await frame(fakeGame({ phaseTime: 1.5 }))
    // …but a rewarded ad was just watched: the 121 s gap holds it back.
    expect(box.midgameCalls).toBe(0)
    // Back to play, then the last heart holds for the offer.
    await frame(fakeGame({ phase: 'play', defeated: false, phaseTime: 0 }))
    await frame(fakeGame({ phase: 'play', defeated: false, phaseTime: 0, lastChance: 3 }))
    await vi.waitFor(() => expect(w.find('[data-testid="second-chance"]').exists()).toBe(true), { timeout: 5000 })
    expect(w.find('[data-testid="second-chance-watch"]').exists()).toBe(true)
    expect(w.find('[data-testid="second-chance-skip"]').exists()).toBe(true)
    w.unmount()
  })

  it('ad config inside the first three minutes: still the plain button, no offer', async () => {
    vi.stubEnv('VITE_APP_CRAZY_WEB', 'true')
    vi.stubEnv('VITE_APP_REWARDED', 'true')
    localStorage.setItem('aethel_state', JSON.stringify({ fold_playtime: 30 }))
    const w = await mountScene()
    expect(box.secondChance.every((on) => !on)).toBe(true)
    await frame(fakeGame())
    expect(w.find('[data-testid="almost-retry"]').exists()).toBe(true)
    expect(w.find('[data-testid="almost-retry-ad"]').exists()).toBe(false)
    w.unmount()
  })
})
