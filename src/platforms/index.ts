// ─── Platform registry ──────────────────────────────────────────────────────
//
// Aggregates the per-platform modules under `src/platforms/<name>/index.ts`
// and exposes the active one based on Vite env flags. Each module is
// statically imported here ONLY for its `platform` descriptor (id, envFlag,
// capabilities). The actual heavy implementations (strategies, providers,
// composables) are still resolved lazily by `resolveSaveStrategy` /
// `resolveAdProvider` so non-active platforms tree-shake cleanly.
//
// Adding a new platform:
//   1. Create `src/platforms/<name>/index.ts` exporting `{ platform: { id, envFlag, capabilities } }`.
//   2. Append the platform to `ALL_PLATFORMS` below.
//   3. Add an arm to `resolveSaveStrategy` if it has a save backend.
//   4. Add an arm to `resolveAdProvider` if it has ads.
//   5. Add an arm to `buildCsp` (`src/platforms/csp.ts`) if it needs special CSP.
//
// `useUser.ts`, `main.ts`, `vite.config.ts`, and `App.vue` no longer
// branch on individual platform flags — they consume capabilities and
// resolved providers from this layer instead.

import { platform as crazygames } from './crazygames'
import { platform as gamedistribution } from './gamedistribution'
import { platform as glitch } from './glitch'
import { platform as itch } from './itch'
import { platform as wavedash } from './wavedash'
import { platform as playgama } from './playgama'
import { platform as gamepix } from './gamepix'
import { platform as gamemonetize } from './gamemonetize'
import { platform as yandex } from './yandex'
import { platform as poki } from './poki'

export const ALL_PLATFORMS = [crazygames, gamedistribution, glitch, itch, wavedash, playgama, gamepix, gamemonetize, yandex, poki] as const
export type ActivePlatform = (typeof ALL_PLATFORMS)[number]

/**
 * Resolve the active platform for the current build, or `null` when none
 * is set (plain web / dev). Reads `import.meta.env` at call time. The
 * static `import.meta.env.VITE_APP_<X>` lookup is what gives Vite the
 * tree-shaking signal — this function still resolves to the correct
 * platform at runtime, but the per-platform branches in resolvers below
 * are what actually drive tree-shaking.
 */
export const activePlatform = (): ActivePlatform | null => {
  for (const p of ALL_PLATFORMS) {
    const flagName = `VITE_APP_${p.envFlag}`
    if (import.meta.env[flagName] === 'true') return p
  }
  return null
}

/** Convenience: capabilities of the active platform, or default-empty
 *  capabilities when no platform flag is set. */
export const activeCapabilities = (): ActivePlatform['capabilities'] | null => {
  const p = activePlatform()
  return p?.capabilities ?? null
}

// Resolvers — re-exported here so `main.ts` and `useAds.ts` can import
// from a single `@/platforms` barrel.
export { resolveSaveStrategy } from './resolveSaveStrategy'
export { resolveAdProvider } from './resolveAdProvider'
export { resolveCapabilities } from './capabilities'
export type { PlatformFlags, ResolvedCapabilities, GlitchLicenseStatus } from './capabilities'
export { buildCsp } from './csp'
