import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── FMuteButton (toggleMute) — "can't unmute on CG" regression ─────────────
//
// The CrazyGames mute is volume-based: muted ⇔ music===0 && sound===0. The
// platform-sync `applyMute(false)` deliberately no-ops when there's no
// pre-mute snapshot (so a passive platform sync can't clobber a deliberate
// cloud-saved 0/0). But that left the in-game button unable to unmute a game
// that BOOTED already-muted (cloud save 0/0, or CrazyGames reported muted
// while volumes were already 0/0) — there was never a snapshot to restore, so
// every tap was a no-op and the game stayed muted forever.
//
// The fix: an explicit user tap always restores audible volumes — the
// snapshot if present, else the install defaults.

// Fields inside the single `aethel_state` blob (see `src/keys.ts`).
const SOUND_KEY = 'user_sound_volume'
const MUSIC_KEY = 'user_music_volume'

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

describe('useCrazyMuteSync.toggleMute', () => {
  it('unmutes a game that booted muted with NO snapshot (the reported CG bug)', async () => {
    // Seed aethel_state with a saved 0/0 BEFORE useUser reads its volumes.
    const { setState } = await import('@/use/useAethelState')
    setState(MUSIC_KEY, 0)
    setState(SOUND_KEY, 0)

    const { isMuted, toggleMute } = await import('@/use/useCrazyMuteSync')
    const { DEFAULT_MUSIC_VOLUME, DEFAULT_SOUND_VOLUME } = await import('@/use/useUser')
    expect(isMuted.value).toBe(true) // booted muted, no snapshot

    toggleMute()

    expect(isMuted.value).toBe(false) // the button actually unmutes now
    const { getState } = await import('@/use/useAethelState')
    expect(getState(MUSIC_KEY)).toBe(DEFAULT_MUSIC_VOLUME)
    expect(getState(SOUND_KEY)).toBe(DEFAULT_SOUND_VOLUME)
  })

  it('CG toolbar mute/unmute stays in sync with the in-game state', async () => {
    const { isMuted, applyPlatformMute } = await import('@/use/useCrazyMuteSync')
    expect(isMuted.value).toBe(false) // audible defaults

    applyPlatformMute(true)  // player clicks mute in the CG toolbar
    expect(isMuted.value).toBe(true) // → in-game button shows muted

    applyPlatformMute(false) // player clicks unmute in the CG toolbar
    expect(isMuted.value).toBe(false) // → in-game button shows unmuted
  })

  it('CG toolbar can STILL mute after the player used the in-game button (regression)', async () => {
    // Booted muted from a cloud-saved 0/0; player unmutes in-game. The CG
    // toolbar must remain able to mute afterwards — the persisted "in-game
    // wins" override used to swallow this event, which broke the sync.
    const { setState } = await import('@/use/useAethelState')
    setState(MUSIC_KEY, 0)
    setState(SOUND_KEY, 0)

    const { isMuted, toggleMute, applyPlatformMute } = await import('@/use/useCrazyMuteSync')
    expect(isMuted.value).toBe(true)

    toggleMute() // player unmutes in-game
    expect(isMuted.value).toBe(false)

    applyPlatformMute(true) // CG toolbar mute — now syncs again
    expect(isMuted.value).toBe(true)
  })

  it('mute → unmute restores the exact prior volumes via the snapshot', async () => {
    const { setState, getState } = await import('@/use/useAethelState')
    setState(MUSIC_KEY, 0.4)
    setState(SOUND_KEY, 0.5)

    const { isMuted, toggleMute } = await import('@/use/useCrazyMuteSync')
    expect(isMuted.value).toBe(false)

    toggleMute() // mute — snapshots 0.4 / 0.5
    expect(isMuted.value).toBe(true)
    expect(getState(MUSIC_KEY)).toBe(0)

    toggleMute() // unmute — restores the snapshot, not the defaults
    expect(isMuted.value).toBe(false)
    expect(getState(MUSIC_KEY)).toBe(0.4)
    expect(getState(SOUND_KEY)).toBe(0.5)
  })
})

describe('mute button — remembers the previous volumes in aethel_state', () => {
  it('a second tap restores exactly the volumes from before the mute', async () => {
    const { setState } = await import('@/use/useAethelState')
    setState(MUSIC_KEY, 0.3)
    setState(SOUND_KEY, 0.85)
    const { isMuted, toggleMute } = await import('@/use/useCrazyMuteSync')
    const { getState } = await import('@/use/useAethelState')
    expect(isMuted.value).toBe(false)

    toggleMute()
    expect(isMuted.value).toBe(true)
    expect(getState(MUSIC_KEY)).toBe(0)
    expect(getState(SOUND_KEY)).toBe(0)
    expect(getState('user_muted_volumes')).toEqual({ music: 0.3, sound: 0.85 })

    toggleMute()
    expect(isMuted.value).toBe(false)
    expect(getState(MUSIC_KEY)).toBe(0.3)
    expect(getState(SOUND_KEY)).toBe(0.85)
    expect(getState('user_muted_volumes')).toBe(null)
  })

  it('survives a reload: muted in one session, restored in the next', async () => {
    const first = await import('@/use/useAethelState')
    first.setState(MUSIC_KEY, 0.4)
    first.setState(SOUND_KEY, 0.6)
    ;(await import('@/use/useCrazyMuteSync')).toggleMute()
    first.flushPersist()

    // "Reload": fresh modules reading the persisted aethel_state.
    vi.resetModules()
    const { isMuted, toggleMute } = await import('@/use/useCrazyMuteSync')
    const { getState } = await import('@/use/useAethelState')
    expect(isMuted.value).toBe(true)
    toggleMute()
    expect(getState(MUSIC_KEY)).toBe(0.4)
    expect(getState(SOUND_KEY)).toBe(0.6)
  })
})

