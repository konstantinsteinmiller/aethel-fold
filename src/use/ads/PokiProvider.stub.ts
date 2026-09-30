// ─── PokiProvider no-op stub (non-Poki builds only) ─────────────────────────
//
// Aliased over `PokiProvider.ts` by `vite.config.ts` on every build that isn't
// Poki, for the same reason as the other portal stubs: `resolveAdProvider`
// imports every provider statically, and the real one would carry the Poki
// SDK URL and name into bundles that must not mention another portal.

import { ref } from 'vue'
import type { AdProvider } from './types'

const inertRef = ref(false)

export const createPokiProvider = (): AdProvider => ({
  name: '',
  isReady: inertRef,
  isRewardedReady: inertRef,
  isInterstitialReady: inertRef,
  isAdsBlocked: inertRef,
  init: async () => {},
  showRewardedAd: async () => false,
  showMidgameAd: async () => {}
})
