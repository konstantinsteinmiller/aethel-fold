// ─── Poki platform module ───────────────────────────────────────────────────
//
// Stable re-export surface for the Poki integration plus the descriptor the
// platform registry enumerates. The implementation lives in
// `@/utils/pokiPlugin` (SDK v2: init, gameLoadingFinished, gameplayStart/Stop,
// commercialBreak, rewardedBreak) and `@/use/ads/PokiProvider`.
//
// Saves: Poki has no player-data API, so the default `LocalStorageStrategy`
// (no arm in `resolveSaveStrategy`). No site-lock: Poki serves the game from
// its own CDN domains, so the render gate is flag-only (like Playgama).

export type { PlatformModule } from '../types'

export {
  pokiPlugin,
  pokiGameLoadingFinished,
  pokiGameplayStart,
  pokiGameplayStop,
  showCommercialBreakPoki,
  showRewardedBreakPoki,
  isPokiSdkLoaded,
  isPokiSdkActive,
  isPokiAdsBlocked
} from '@/utils/pokiPlugin'

export { createPokiProvider } from '@/use/ads/PokiProvider'

export const platform = {
  id: 'poki' as const,
  envFlag: 'POKI',
  capabilities: {
    hasCloudSave: false,          // no Poki player-data API: localStorage
    hasAds: true,                 // commercialBreak / rewardedBreak
    hostnameMatcher: 'poki',      // informational only — NO site-lock applied
    portalEnforcesAgeGate: false,
    childDirectedAdSignal: false,
    needsParentOriginCheck: false // Poki's own CDN domains vary
  }
}
