import { syncGameplayLifecycle as syncCrazyGameplay } from '@/use/useCrazyGames'
import { isPlaygama } from '@/use/useUser'

/**
 * ─── "Is the player actually playing?" ──────────────────────────────────────
 *
 * Several portals want to be told when gameplay runs and when it stops — they
 * use it to time their own ad breaks, measure session quality, and (on
 * Playgama) to pass certification. The game has exactly one notion of that
 * state, so it should be reported from exactly one place: this fan-out, driven
 * by the `isLiveGameplay` watcher in the game scene.
 *
 * Before this existed only CrazyGames was wired. Playgama's `gameplay_started`
 * / `gameplay_stopped` messages were implemented, idempotent, and never called
 * once — the same class of miss the plugin's own comment flags for
 * `game_ready` ("an explicit rejection reason on the Playgama QA Tool").
 *
 * Every branch is gated on a build-time flag, so a CrazyGames bundle contains
 * none of the Playgama code and vice versa.
 */
export const syncGameplayLifecycle = (live: boolean): void => {
  // No-ops unless this is a full CrazyGames release build.
  syncCrazyGameplay(live)

  if (isPlaygama) {
    // Dynamic, to keep the bridge out of every other platform's bundle. Both
    // calls are idempotent and no-op until the SDK is active, so an event that
    // lands before init is simply dropped rather than queued or duplicated.
    void import('@/utils/playgamaPlugin').then(({ playgamaGameplayStart, playgamaGameplayStop }) => {
      if (live) playgamaGameplayStart()
      else playgamaGameplayStop()
    }).catch(() => { /* bridge missing — nothing to report to */ })
  }

  // Poki: gameplayStart/Stop. Env literal so every other build drops the
  // import; the plugin pairs the calls and holds a start until
  // gameLoadingFinished has gone out.
  if (import.meta.env.VITE_APP_POKI === 'true') {
    void import('@/utils/pokiPlugin').then(({ pokiGameplayStart, pokiGameplayStop }) => {
      if (live) pokiGameplayStart()
      else pokiGameplayStop()
    }).catch(() => { /* SDK glue missing — nothing to report to */ })
  }
}
