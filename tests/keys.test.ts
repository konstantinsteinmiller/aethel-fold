// Pins the literal string values of the persisted keys. These are a contract
// with every player's save blob — renaming one strands existing players'
// progress on the old field, and the cloud strategies key their manifests off
// these exact strings. `src/keys.ts` is the single source of truth; this test is
// the tripwire that catches an accidental rename during a refactor.

import { describe, expect, it } from 'vitest'
import { SAVE_KEYS, isPayloadKey, META_KEY } from '@/utils/save/SaveMergePolicy'
import { STATE_KEY } from '@/use/useAethelState'
import {
  BEST_KEY,
  CLEARED_KEY,
  LANGUAGE_KEY,
  LESSONS_KEY,
  MOBILE_MUTE_KEY,
  MUSIC_KEY,
  PAGE_KEY,
  RUN_KEY,
  RUNS_KEY,
  SETTINGS_KEY,
  SOUND_KEY,
  STATS_KEY,
  WINS_KEY
} from '@/keys'

describe('field keys inside aethel_state are stable', () => {
  it.each([
    [PAGE_KEY, 'fold_page'],
    [RUN_KEY, 'fold_run'],
    [CLEARED_KEY, 'fold_cleared'],
    [BEST_KEY, 'fold_best'],
    [WINS_KEY, 'fold_wins'],
    [RUNS_KEY, 'fold_runs'],
    [LESSONS_KEY, 'fold_lessons'],
    [STATS_KEY, 'fold_stats'],
    [SETTINGS_KEY, 'fold_settings'],
    [SOUND_KEY, 'user_sound_volume'],
    [MUSIC_KEY, 'user_music_volume'],
    [LANGUAGE_KEY, 'user_language'],
    [MOBILE_MUTE_KEY, 'mobile_mute']
  ])('%s is the literal %s', (actual, expected) => {
    expect(actual).toBe(expected)
  })
})

describe('SAVE_KEYS values are stable', () => {
  it('pins every key the merge policy / fresh-user guard reads', () => {
    expect(SAVE_KEYS).toEqual({
      STATE: 'aethel_state',
      CLEARED: 'fold_cleared',
      WINS: 'fold_wins',
      RUNS: 'fold_runs',
      PAGE: 'fold_page',
      LESSONS: 'fold_lessons'
    })
  })
})

describe('the persisted surface is exactly one state blob plus the meta blob', () => {
  it('accepts the state blob and the meta blob', () => {
    expect(STATE_KEY).toBe('aethel_state')
    expect(META_KEY).toBe('__save_meta__')
    expect(isPayloadKey(STATE_KEY)).toBe(true)
    expect(isPayloadKey(META_KEY)).toBe(true)
  })

  it('rejects the per-field names — they live INSIDE the blob, never as their own entries', () => {
    for (const key of [PAGE_KEY, CLEARED_KEY, WINS_KEY, RUNS_KEY, LESSONS_KEY, SETTINGS_KEY, SOUND_KEY]) {
      expect(isPayloadKey(key)).toBe(false)
    }
  })

  it('rejects the retired tower-siege keys', () => {
    for (const key of ['tower_state', 'ts_coins', 'ts_best_wave', 'ts_tech', 'ts_runs']) {
      expect(isPayloadKey(key)).toBe(false)
    }
  })

  it('rejects foreign keys so ad-tech / dev scribbles never reach the cloud', () => {
    for (const key of ['debug', 'cheat', 'prebid11_exp', 'li-module-enabled', 'epic_stage', 'spinner_user_language']) {
      expect(isPayloadKey(key)).toBe(false)
    }
  })
})
