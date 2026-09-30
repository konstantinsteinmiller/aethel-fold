import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCsp } from '@/platforms/csp'
import { resolveCapabilities } from '@/platforms/capabilities'

// The Poki SDK v2 wiring (`@/utils/pokiPlugin`, `@/use/ads/PokiProvider`)
// against a mocked `window.PokiSDK`: init failure, gameLoadingFinished once,
// gameplayStart/Stop pairing, and the break mapping.

interface FakePoki {
  calls: string[]
  initFails: boolean
  rewarded: boolean | 'throw'
  commercial: 'ok' | 'throw'
}

const install = (over: Partial<FakePoki> = {}): FakePoki => {
  const f: FakePoki = { calls: [], initFails: false, rewarded: true, commercial: 'ok', ...over }
  window.PokiSDK = {
    init: async () => {
      f.calls.push('init')
      if (f.initFails) throw new Error('adblock')
    },
    gameLoadingFinished: () => f.calls.push('gameLoadingFinished'),
    gameplayStart: () => f.calls.push('gameplayStart'),
    gameplayStop: () => f.calls.push('gameplayStop'),
    commercialBreak: async (onStart?: () => void) => {
      f.calls.push('commercialBreak')
      if (f.commercial === 'throw') throw new Error('break failed')
      onStart?.()
    },
    rewardedBreak: async () => {
      f.calls.push('rewardedBreak')
      if (f.rewarded === 'throw') throw new Error('break failed')
      return f.rewarded
    }
  }
  return f
}

const load = async () => {
  vi.resetModules()
  return import('@/utils/pokiPlugin')
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  delete window.PokiSDK
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('Poki init', () => {
  it('inits once and marks the SDK active', async () => {
    const f = install()
    const p = await load()
    await Promise.all([p.pokiPlugin(), p.pokiPlugin()])
    expect(f.calls).toEqual(['init'])
    expect(p.isPokiSdkLoaded.value).toBe(true)
    expect(p.isPokiSdkActive.value).toBe(true)
    expect(p.isPokiAdsBlocked.value).toBe(false)
  })

  it('a rejected init (ad blocker) is survived: loading still finishes, rewarded is off', async () => {
    const f = install({ initFails: true })
    const p = await load()
    await expect(p.pokiPlugin()).resolves.toBeUndefined()
    expect(p.isPokiSdkActive.value).toBe(false)
    expect(p.isPokiAdsBlocked.value).toBe(true)
    await p.pokiGameLoadingFinished()
    expect(f.calls).toContain('gameLoadingFinished')
    expect(await p.showRewardedBreakPoki()).toBe(false)
    expect(f.calls).not.toContain('rewardedBreak')
  })

  it('no SDK at all (script blocked): every call is inert', async () => {
    vi.useFakeTimers()
    const p = await load()
    const done = p.pokiPlugin()
    await vi.advanceTimersByTimeAsync(11_000)
    await done
    vi.useRealTimers()
    await p.pokiGameLoadingFinished()
    p.pokiGameplayStart()
    await p.showCommercialBreakPoki()
    expect(await p.showRewardedBreakPoki()).toBe(false)
    expect(p.isPokiSdkLoaded.value).toBe(false)
    // It asked for the script from Poki's CDN.
    expect(document.getElementById('poki-sdk')?.getAttribute('src')).toBe(p.POKI_SDK_SRC)
    document.getElementById('poki-sdk')?.remove()
  })
})

describe('gameLoadingFinished and gameplay pairing', () => {
  it('gameLoadingFinished goes out exactly once', async () => {
    const f = install()
    const p = await load()
    await p.pokiGameLoadingFinished()
    await p.pokiGameLoadingFinished()
    expect(f.calls.filter((c) => c === 'gameLoadingFinished')).toHaveLength(1)
  })

  it('holds gameplayStart until loading has finished, then pairs start/stop without repeats', async () => {
    const f = install()
    const p = await load()
    await p.pokiPlugin()
    p.pokiGameplayStart()
    expect(f.calls).toEqual(['init'])
    await p.pokiGameLoadingFinished()
    expect(f.calls).toEqual(['init', 'gameLoadingFinished', 'gameplayStart'])
    p.pokiGameplayStart()
    p.pokiGameplayStop()
    p.pokiGameplayStop()
    p.pokiGameplayStart()
    expect(f.calls.slice(2)).toEqual(['gameplayStart', 'gameplayStop', 'gameplayStart'])
  })

  it('a stop before loading finished sends nothing', async () => {
    const f = install()
    const p = await load()
    p.pokiGameplayStart()
    p.pokiGameplayStop()
    await p.pokiGameLoadingFinished()
    expect(f.calls).toEqual(['init', 'gameLoadingFinished'])
  })

  it('the gameplay lifecycle fan-out drives it on a Poki build', async () => {
    vi.stubEnv('VITE_APP_POKI', 'true')
    const f = install()
    vi.resetModules()
    const p = await import('@/utils/pokiPlugin')
    const { syncGameplayLifecycle } = await import('@/use/useGameplayLifecycle')
    await p.pokiGameLoadingFinished()
    syncGameplayLifecycle(true)
    await vi.waitFor(() => expect(f.calls).toContain('gameplayStart'))
    syncGameplayLifecycle(false)
    await vi.waitFor(() => expect(f.calls.at(-1)).toBe('gameplayStop'))
  })
})

describe('breaks', () => {
  const ready = async (over: Partial<FakePoki> = {}) => {
    const f = install(over)
    const p = await load()
    await p.pokiGameLoadingFinished()
    p.pokiGameplayStart()
    f.calls.length = 0
    return { f, p }
  }

  it('commercialBreak is the interstitial: gameplay stops first, the impression callback is passed on', async () => {
    const { f, p } = await ready()
    const onStart = vi.fn()
    await p.showCommercialBreakPoki(onStart)
    expect(f.calls).toEqual(['gameplayStop', 'commercialBreak'])
    expect(onStart).toHaveBeenCalledOnce()
  })

  it('a failed commercialBreak resolves (the game never hangs)', async () => {
    const { f, p } = await ready({ commercial: 'throw' })
    await expect(p.showCommercialBreakPoki()).resolves.toBeUndefined()
    expect(f.calls).toContain('commercialBreak')
  })

  it('rewardedBreak → true only when Poki says the reward was earned', async () => {
    const { f, p } = await ready()
    expect(await p.showRewardedBreakPoki()).toBe(true)
    expect(f.calls).toEqual(['gameplayStop', 'rewardedBreak'])
    f.rewarded = false
    expect(await p.showRewardedBreakPoki()).toBe(false)
    f.rewarded = 'throw'
    expect(await p.showRewardedBreakPoki()).toBe(false)
  })

  it('the provider maps them into the AdProvider surface', async () => {
    const f = install()
    vi.resetModules()
    const { createPokiProvider } = await import('@/use/ads/PokiProvider')
    const provider = createPokiProvider()
    expect(provider.name).toBe('poki')
    expect(provider.isRewardedReady.value).toBe(false)
    await provider.init()
    expect(provider.isInterstitialReady.value).toBe(true)
    expect(provider.isRewardedReady.value).toBe(true)
    expect(await provider.showRewardedAd()).toBe(true)
    await provider.showMidgameAd()
    expect(f.calls).toEqual(['init', 'rewardedBreak', 'commercialBreak'])
  })

  it('an ad-blocked provider offers no rewarded ad', async () => {
    install({ initFails: true })
    vi.resetModules()
    const { createPokiProvider } = await import('@/use/ads/PokiProvider')
    const provider = createPokiProvider()
    await provider.init()
    expect(provider.isRewardedReady.value).toBe(false)
    expect(provider.isAdsBlocked.value).toBe(true)
  })
})

describe('Poki build wiring', () => {
  it('resolveAdProvider picks Poki on a Poki build', async () => {
    vi.stubEnv('VITE_APP_POKI', 'true')
    vi.resetModules()
    const { resolveAdProvider } = await import('@/platforms/resolveAdProvider')
    const p = resolveAdProvider({
      flags: { isCrazyWeb: false, isWaveDash: false, isItch: false, isGlitch: false, isGameDistribution: false, isPlaygama: false, isGamepix: false, isGameMonetize: false, isYandex: false, isPoki: true },
      showMediatorAds: false,
      isNative: false
    })
    expect(p.name).toBe('poki')
  })

  it('saves stay in localStorage', async () => {
    vi.stubEnv('VITE_APP_POKI', 'true')
    vi.resetModules()
    const { resolveSaveStrategy } = await import('@/platforms/resolveSaveStrategy')
    const s = await resolveSaveStrategy({ isCrazyWeb: false, isWaveDash: false, isItch: false, isGlitch: false, isGameDistribution: false, isPlaygama: false, isGamepix: false, isGameMonetize: false, isYandex: false, isPoki: true })
    expect(s.constructor.name).toBe('LocalStorageStrategy')
  })

  it('the CSP lets the SDK script and its ads in, only on the Poki build', () => {
    const csp = buildCsp({ VITE_APP_POKI: 'true' })
    const script = csp.split('; ').find((d) => d.startsWith('script-src'))!
    expect(script).toContain('https://game-cdn.poki.com')
    expect(csp.split('; ').find((d) => d.startsWith('frame-src'))).toContain('https:')
    expect(buildCsp({ VITE_APP_ITCH: 'true' })).not.toContain('poki')
    // No other portal's hostname in the Poki build's policy.
    for (const other of ['crazygames', 'gamedistribution', 'playgama', 'gamepix', 'gamemonetize', 'yandex', 'itch.io', 'glitch', 'wavedash']) {
      expect(csp).not.toContain(other)
    }
  })

  it('renders on any host (no site-lock), with no "only available on" gate', () => {
    const caps = resolveCapabilities({
      flags: { isCrazyWeb: false, isWaveDash: false, isItch: false, isGlitch: false, isGameDistribution: false, isPlaygama: false, isGamepix: false, isGameMonetize: false, isYandex: false, isPoki: true },
      hostname: 'games.poki-gdn.com',
      glitchLicenseStatus: 'ok'
    })
    expect(caps.allowedToShowOnPoki).toBe(true)
    expect(caps.isNotPlatformBuild).toBe(false)
  })

  it('shows no other-portal text on a Poki build', async () => {
    vi.stubEnv('VITE_APP_POKI', 'true')
    vi.resetModules()
    const { getPlattformText } = await import('@/platforms/plattformText')
    expect(getPlattformText()).toBe('')
  })
})
