import { onMounted, onUnmounted, computed, ref, watch } from 'vue'
import useUser, { DEFAULT_SOUND_VOLUME, DEFAULT_MUSIC_VOLUME } from '@/use/useUser'
import {
  isSdkActive,
  onCrazyMuteChange,
  setCrazyMuted
} from '@/use/useCrazyGames'
import { isDbInitialized } from '@/use/useMatch'
import { getState, setState } from '@/use/useAethelState'
import { MUTED_VOLUMES_KEY } from '@/keys'

const { userSoundVolume, userMusicVolume, setSettingValue } = useUser()

const isMuted = computed(() => userMusicVolume.value === 0 && userSoundVolume.value === 0)

// The volumes from before we muted (the button, or a platform-mute event),
// persisted in `aethel_state` so the next unmute restores exactly them — also
// after a reload. `null` means "not muted by us": `applyMute(false)` must NOT
// restore anything then (a cloud-saved deliberate 0/0 stays 0/0 on a passive
// platform sync — CG QA caught that on 2026-05-05).
interface VolumeSnapshot { music: number; sound: number }

const readSnapshot = (): VolumeSnapshot | null => {
  const v = getState<unknown>(MUTED_VOLUMES_KEY, null)
  if (!v || typeof v !== 'object') return null
  const s = v as Partial<VolumeSnapshot>
  const music = Number(s.music)
  const sound = Number(s.sound)
  if (!Number.isFinite(music) || !Number.isFinite(sound)) return null
  return { music: Math.max(0, Math.min(1, music)), sound: Math.max(0, Math.min(1, sound)) }
}

const writeSnapshot = (s: VolumeSnapshot | null): void => {
  setState(MUTED_VOLUMES_KEY, s)
}

export const applyMute = (muted: boolean) => {
  if (muted && !isMuted.value) {
    // Muting while audible — remember the current volumes, then zero them.
    writeSnapshot({ music: userMusicVolume.value, sound: userSoundVolume.value })
    setSettingValue('music', 0)
    setSettingValue('sound', 0)
  } else if (!muted && isMuted.value) {
    // Unmuting — restore the remembered volumes if we muted. Without a
    // snapshot this is a no-op: a cold load whose cloud value is a deliberate
    // 0/0 must not be overwritten by a passive "not muted" platform sync.
    const snap = readSnapshot()
    if (!snap) return
    setSettingValue('music', snap.music)
    setSettingValue('sound', snap.sound)
    writeSnapshot(null)
  }
}

/** Apply a mute that originated from the CrazyGames platform toolbar. Keeps
 *  the in-game state in sync with the CG chrome toggle (one-way: CG → game,
 *  since the SDK exposes no setter to push the in-game button back to CG).
 *  Thin wrapper over `applyMute` so the sync hook and tests share one path. */
export const applyPlatformMute = (muted: boolean) => {
  applyMute(muted)
}

export const toggleMute = () => {
  const next = !isMuted.value
  const snap = readSnapshot()
  if (next) {
    // Muting: snapshot the current (audible) volumes, then zero them.
    applyMute(true)
  } else if (snap && (snap.music > 0 || snap.sound > 0)) {
    // Unmuting with a snapshot from an earlier mute → restore exactly it.
    applyMute(false)
  } else {
    // Unmuting with NO snapshot. `applyMute(false)` is a deliberate no-op in
    // that case (it must not clobber a deliberate cloud-saved 0/0 during a
    // PASSIVE platform sync). But a USER tapping the button is an explicit
    // request for sound, so always restore audible defaults — otherwise a
    // game that booted already-muted (e.g. CrazyGames reported muted, or the
    // cloud save was 0/0) stays stuck at 0/0 and the button never unmutes.
    // This is the "FMuteButton can't unmute on CG" fix.
    setSettingValue('music', DEFAULT_MUSIC_VOLUME)
    setSettingValue('sound', DEFAULT_SOUND_VOLUME)
    writeSnapshot(null)
  }
  setCrazyMuted(next)
}

export { isMuted }

/**
 * Call once at the App level to keep the CrazyGames platform mute toggle
 * in sync with the in-game volume for the entire session, regardless of
 * which components are mounted.
 *
 * Direction of truth: the CG SDK is the source of truth for the mute
 * state — there's no public setter, the platform chrome owns it. We
 * listen for `sdk.game.addSettingsChangeListener` events (the v3
 * canonical API — the legacy `addMuteListener` never fires on the real
 * SDK) via `onCrazyMuteChange`, which also replays the current state to
 * the subscriber on attach, so one hook covers both the initial sync
 * and every subsequent toggle.
 *
 * We gate the *initial* apply on `isDbInitialized`: if IndexedDB hasn't
 * hydrated saved volume settings yet, we stash the pending mute and
 * apply it once hydration finishes so we don't fight the loader. Later
 * toggles flow through immediately.
 */
export const useCrazyMuteSync = () => {
  let unsubscribe: (() => void) | null = null
  const pendingInitialMute = ref<boolean | null>(null)

  const handleSdkMute = (muted: boolean) => {
    if (!isDbInitialized.value) {
      pendingInitialMute.value = muted
      return
    }
    // `applyPlatformMute` ignores the event if the player has taken control —
    // so an in-game unmute is never re-muted by the platform.
    applyPlatformMute(muted)
  }

  const stopDbWatch = watch(isDbInitialized, (ready) => {
    if (!ready || pendingInitialMute.value === null) return
    applyPlatformMute(pendingInitialMute.value)
    pendingInitialMute.value = null
  })

  onMounted(() => {
    if (!isSdkActive.value) return
    unsubscribe = onCrazyMuteChange(handleSdkMute)
  })

  onUnmounted(() => {
    unsubscribe?.()
    unsubscribe = null
    stopDbWatch()
  })
}
