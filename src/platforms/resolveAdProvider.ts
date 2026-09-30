// ─── Ad-provider resolver ───────────────────────────────────────────────────
//
// Pure function. Returns the right `AdProvider` for the active build.
// Lifted from the inline ternary in `useAds.ts:29-35` so the branching
// is testable.
//
// ## Branches are gated on `import.meta.env.VITE_APP_*`, not the input
// flags. Why:
//
// The previous version branched on `input.flags.isXxx` — runtime
// parameters that Rollup cannot statically analyse. Result: every
// platform's provider was bundled into every build, dragging
// `@tauri-apps/api/core` (via LevelPlayProvider) and the GD provider
// into CrazyGames builds and inflating the entry chunk.
//
// `import.meta.env.VITE_APP_X` is replaced with a string literal at
// build time. `if ('false' === 'true')` is dead code, and Rollup
// removes both the branch AND any imports only reached through it.
// Net effect: a CrazyGames build only links `CrazyGamesProvider`;
// LevelPlay and GameDistribution providers tree-shake to zero.
//
// `useAds.ts` calls this synchronously at module load, so the
// resolver stays sync — we keep static imports (instead of dynamic
// `await import`) so the function can return without async handoff.
//
// ## Priority order MUST match `useAds.ts`'s historical ternary:
//   1. isCrazyWeb              → CrazyGames provider
//   2. isGameDistribution      → GameDistribution provider
//   3. showMediatorAds + isNative → LevelPlay (mobile mediation)
//   4. else                    → Noop (UI hidden, calls inert)

import { createCrazyGamesProvider } from '@/use/ads/CrazyGamesProvider'
import { createGameDistributionProvider } from '@/use/ads/GameDistributionProvider'
import { createPlaygamaProvider } from '@/use/ads/PlaygamaProvider'
import { createGamepixProvider } from '@/use/ads/GamepixProvider'
import { createGameMonetizeProvider } from '@/use/ads/GameMonetizeProvider'
import { createYandexProvider } from '@/use/ads/YandexProvider'
import { createPokiProvider } from '@/use/ads/PokiProvider'
import { createNoopProvider } from '@/use/ads/NoopProvider'
import type { AdProvider } from '@/use/ads/types'
import type { PlatformFlags } from './capabilities'

export interface AdResolverInput {
  flags: PlatformFlags
  /** True when the build wants to show mediator ads (LevelPlay), env-driven. */
  showMediatorAds: boolean
  /** True when running inside a Tauri / native shell (Android, iOS, desktop). */
  isNative: boolean
}

export const resolveAdProvider = (input: AdResolverInput): AdProvider => {
  if (import.meta.env.VITE_APP_CRAZY_WEB === 'true') return createCrazyGamesProvider()
  if (import.meta.env.VITE_APP_GAME_DISTRIBUTION === 'true') return createGameDistributionProvider()
  if (import.meta.env.VITE_APP_PLAYGAMA === 'true') return createPlaygamaProvider()
  if (import.meta.env.VITE_APP_GAMEPIX === 'true') return createGamepixProvider()
  if (import.meta.env.VITE_APP_GAME_MONETIZE === 'true') return createGameMonetizeProvider()
  if (import.meta.env.VITE_APP_YANDEX === 'true') return createYandexProvider()
  if (import.meta.env.VITE_APP_POKI === 'true') return createPokiProvider()
  return createNoopProvider()
}
