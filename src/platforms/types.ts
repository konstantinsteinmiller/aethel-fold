// ─── Platform module shape ──────────────────────────────────────────────────
//
// The contract every `src/platforms/<name>/index.ts` adheres to. Lets the
// platform registry enumerate platforms uniformly without each consumer
// having to know the per-platform file layout.
//
// Today this interface is mostly aspirational — `main.ts` and `useAds.ts`
// still call into `resolveSaveStrategy` / `resolveAdProvider` directly.
// As the platform shells stabilize, those resolvers can collapse into
// `platform.createSaveStrategy()` / `platform.createAdProvider()` calls
// against `activePlatform`.
//
// `id` is the canonical name for logs / telemetry. `envFlag` is the
// VITE_APP_<X> name (sans the prefix) — the registry reads
// `import.meta.env[envFlag]` to detect the active platform.

export interface PlatformModule {
  /** Canonical platform identifier — used in logs/telemetry. */
  readonly id: 'crazygames' | 'gamedistribution' | 'glitch' | 'itch' | 'wavedash' | 'playgama' | 'gamepix' | 'gamemonetize' | 'yandex' | 'poki'
  /** Vite env-var suffix that activates this platform (full name is
   *  `VITE_APP_<envFlag>`). */
  readonly envFlag: string
}
