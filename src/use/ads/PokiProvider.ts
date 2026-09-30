// Poki ad provider — wraps `pokiPlugin` in the cross-platform `AdProvider`
// surface `useAds` consumes. Static imports (the GameMonetize pattern) so the
// readiness computeds track the plugin's refs from module-eval time. On every
// non-Poki build this file is aliased to `PokiProvider.stub.ts`
// (`vite.config.ts`), so neither it nor the plugin enters those bundles.
//
// Poki has no fill API: an interstitial is "ready" once the SDK script is in
// (Poki decides per call whether a break actually plays, and throttles them),
// a rewarded break once `init()` resolved (a rejected init = an ad blocker).

import { computed } from 'vue'
import {
  isPokiAdsBlocked, isPokiSdkActive, isPokiSdkLoaded, pokiPlugin, showCommercialBreakPoki, showRewardedBreakPoki
} from '@/utils/pokiPlugin'
import type { AdProvider } from './types'

export const createPokiProvider = (): AdProvider => ({
  name: 'poki',
  isReady: computed(() => isPokiSdkLoaded.value),
  isRewardedReady: computed(() => isPokiSdkActive.value && !isPokiAdsBlocked.value),
  isInterstitialReady: computed(() => isPokiSdkLoaded.value),
  isAdsBlocked: computed(() => isPokiAdsBlocked.value),
  init: () => pokiPlugin(),
  showRewardedAd: () => showRewardedBreakPoki(),
  showMidgameAd: (onImpression) => showCommercialBreakPoki(onImpression)
})
