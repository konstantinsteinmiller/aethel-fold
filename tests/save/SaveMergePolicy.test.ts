import { describe, expect, it } from 'vitest'
import {
  computeMeta,
  decideMerge,
  parseMeta,
  readField,
  SAVE_KEYS,
  SCHEMA_VERSION,
  serializeMeta,
  type SaveMeta
} from '@/utils/save/SaveMergePolicy'
import * as policy from '@/utils/save/SaveMergePolicy'

// Tiny in-memory snapshot reader. Each scenario describes the progress fields
// as a plain object literal; `blob` wraps them into the single `aethel_state`
// entry exactly the way `useAethelState` persists them.
const reader = (snap: Record<string, string>): { get: (k: string) => string | null } => ({
  get: (k: string) => (k in snap ? snap[k]! : null)
})
const blob = (fields: Record<string, unknown>): { get: (k: string) => string | null } =>
  reader({ [SAVE_KEYS.STATE]: JSON.stringify(fields) })

// Score formula under test:
//   cleared × 1000 + wins × 5000 + lessons × 50 + (page − 1) × 100 + runs × 10
describe('SaveMergePolicy.computeMeta', () => {
  it('returns score=0 for a fresh install (no blob at all)', () => {
    const meta = computeMeta(reader({}), '2026-04-27T10:00:00Z')
    expect(meta).toEqual({
      savedAt: '2026-04-27T10:00:00Z',
      progressScore: 0,
      schemaVersion: SCHEMA_VERSION,
      maxStage: 0
    })
  })

  it('returns score=0 for an empty blob and for a blob holding only settings', () => {
    expect(computeMeta(blob({})).progressScore).toBe(0)
    expect(computeMeta(blob({ user_sound_volume: 0.4, fold_settings: { haptics: false } })).progressScore).toBe(0)
  })

  it('counts pagesCleared * 1000 and reports it as maxStage', () => {
    const meta = computeMeta(blob({ [SAVE_KEYS.CLEARED]: 3 }))
    expect(meta.progressScore).toBe(3000)
    expect(meta.maxStage).toBe(3)
  })

  it('clamps pagesCleared into 0…6 for negative / garbage / oversized values', () => {
    expect(computeMeta(blob({ [SAVE_KEYS.CLEARED]: -3 })).progressScore).toBe(0)
    expect(computeMeta(blob({ [SAVE_KEYS.CLEARED]: 'abc' })).progressScore).toBe(0)
    expect(computeMeta(blob({ [SAVE_KEYS.CLEARED]: 99 })).progressScore).toBe(6000)
    expect(computeMeta(blob({ [SAVE_KEYS.CLEARED]: 99 })).maxStage).toBe(6)
  })

  it('counts wins at 5000 each', () => {
    expect(computeMeta(blob({ [SAVE_KEYS.WINS]: 2 })).progressScore).toBe(10_000)
  })

  it('counts only lessons that are literally true, at 50 each', () => {
    const meta = computeMeta(blob({
      [SAVE_KEYS.LESSONS]: { fold: true, tear: true, stamp: false, crush: 'yes', flip: 1 }
    }))
    expect(meta.progressScore).toBe(100)
  })

  it('counts the resume page beyond 1 at 100 each, clamped to 1…6', () => {
    expect(computeMeta(blob({ [SAVE_KEYS.PAGE]: 1 })).progressScore).toBe(0)
    expect(computeMeta(blob({ [SAVE_KEYS.PAGE]: 4 })).progressScore).toBe(300)
    expect(computeMeta(blob({ [SAVE_KEYS.PAGE]: 0 })).progressScore).toBe(0)
    expect(computeMeta(blob({ [SAVE_KEYS.PAGE]: 42 })).progressScore).toBe(500)
  })

  it('counts runs at 10 each so two equal-progress saves still break their tie', () => {
    const a = computeMeta(blob({ [SAVE_KEYS.CLEARED]: 2, [SAVE_KEYS.RUNS]: 12 }))
    const b = computeMeta(blob({ [SAVE_KEYS.CLEARED]: 2, [SAVE_KEYS.RUNS]: 3 }))
    expect(a.progressScore).toBe(2000 + 120)
    expect(b.progressScore).toBe(2000 + 30)
    expect(a.progressScore).toBeGreaterThan(b.progressScore)
  })

  it('floors negative wins / runs at zero defensively', () => {
    expect(computeMeta(blob({ [SAVE_KEYS.WINS]: -1, [SAVE_KEYS.RUNS]: -5 })).progressScore).toBe(0)
  })

  it('combines every term per the formula', () => {
    const meta = computeMeta(blob({
      [SAVE_KEYS.CLEARED]: 4,
      [SAVE_KEYS.WINS]: 1,
      [SAVE_KEYS.LESSONS]: { fold: true, tear: true, stamp: true },
      [SAVE_KEYS.PAGE]: 5,
      [SAVE_KEYS.RUNS]: 7
    }))
    expect(meta.progressScore).toBe(4000 + 5000 + 150 + 400 + 70)
    expect(meta.maxStage).toBe(4)
  })

  it('survives a malformed state blob (scores 0, no throw)', () => {
    expect(computeMeta(reader({ [SAVE_KEYS.STATE]: '{not json' })).progressScore).toBe(0)
  })

  it('survives malformed lessons inside the blob', () => {
    const meta = computeMeta(blob({ [SAVE_KEYS.CLEARED]: 1, [SAVE_KEYS.LESSONS]: 'not an object' }))
    expect(meta.progressScore).toBe(1000)
  })

  it('falls back to a top-level read when the blob lacks the field (legacy per-key writes)', () => {
    const meta = computeMeta(reader({ [SAVE_KEYS.CLEARED]: '2', [SAVE_KEYS.STATE]: JSON.stringify({ [SAVE_KEYS.WINS]: 1 }) }))
    expect(meta.progressScore).toBe(2000 + 5000)
  })
})

describe('SaveMergePolicy.readField', () => {
  it('stringifies non-string fields exactly the way the score / fresh-guard parse them', () => {
    const r = blob({ n: 3, s: 'x', o: { a: true }, z: null })
    expect(readField(r, 'n')).toBe('3')
    expect(readField(r, 's')).toBe('x')
    expect(readField(r, 'o')).toBe('{"a":true}')
    expect(readField(r, 'z')).toBeNull()
    expect(readField(r, 'missing')).toBeNull()
  })
})

describe('SaveMergePolicy.parseMeta / serializeMeta', () => {
  it('round-trips a valid meta blob', () => {
    const meta: SaveMeta = {
      savedAt: '2026-04-27T18:30:00Z',
      progressScore: 1234,
      schemaVersion: SCHEMA_VERSION,
      maxStage: 4
    }
    expect(parseMeta(serializeMeta(meta))).toEqual(meta)
  })

  it('round-trips the optional bonusReceivedFor field and drops unknown fields', () => {
    const raw = JSON.stringify({
      savedAt: '2026-04-27T18:30:00Z',
      progressScore: 1,
      schemaVersion: SCHEMA_VERSION,
      maxStage: 0,
      bonusReceivedFor: '2026-04-01T00:00:00Z',
      junk: 7
    })
    expect(parseMeta(raw)).toEqual({
      savedAt: '2026-04-27T18:30:00Z',
      progressScore: 1,
      schemaVersion: SCHEMA_VERSION,
      maxStage: 0,
      bonusReceivedFor: '2026-04-01T00:00:00Z'
    })
  })

  it('returns null for null / empty / non-string inputs', () => {
    expect(parseMeta(null)).toBeNull()
    expect(parseMeta(undefined)).toBeNull()
    expect(parseMeta('')).toBeNull()
  })

  it('returns null for malformed JSON and non-object JSON', () => {
    expect(parseMeta('{nope')).toBeNull()
    expect(parseMeta('null')).toBeNull()
    expect(parseMeta('42')).toBeNull()
  })

  it('returns null when required fields are missing or wrong-typed', () => {
    expect(parseMeta(JSON.stringify({}))).toBeNull()
    expect(parseMeta(JSON.stringify({ savedAt: 'x', progressScore: 'oops', schemaVersion: 1, maxStage: 1 }))).toBeNull()
    expect(parseMeta(JSON.stringify({ savedAt: 'x', progressScore: NaN, schemaVersion: 1, maxStage: 1 }))).toBeNull()
    expect(parseMeta(JSON.stringify({ savedAt: 'x', progressScore: 1, schemaVersion: 1 }))).toBeNull()
  })
})

describe('SaveMergePolicy.decideMerge', () => {
  const meta = (overrides: Partial<SaveMeta>): SaveMeta => ({
    savedAt: '2026-04-27T12:00:00Z',
    progressScore: 0,
    schemaVersion: SCHEMA_VERSION,
    maxStage: 1,
    ...overrides
  })

  it('returns \'local-only\' when remote is null (network unreachable etc.)', () => {
    expect(decideMerge(meta({ progressScore: 5000 }), null)).toEqual({ kind: 'local-only' })
  })

  it('returns \'remote-only\' when local is null (truly fresh device)', () => {
    expect(decideMerge(null, meta({ progressScore: 5000 }))).toEqual({ kind: 'remote-only' })
  })

  it('returns \'remote-wins\' with NO bonus even when local had progress (Castle Fold has no currency)', () => {
    const local = meta({ progressScore: 2000, maxStage: 2 })
    const remote = meta({ progressScore: 8000, maxStage: 6 })
    expect(decideMerge(local, remote)).toEqual({ kind: 'remote-wins', bonusCoins: 0 })
  })

  it('returns \'remote-wins\' with NO bonus when local was completely empty (score 0)', () => {
    const local = meta({ progressScore: 0, maxStage: 0 })
    const remote = meta({ progressScore: 8000, maxStage: 6 })
    expect(decideMerge(local, remote)).toEqual({ kind: 'remote-wins', bonusCoins: 0 })
  })

  it('returns \'local-wins\' when local score > remote (player advanced offline)', () => {
    const local = meta({ progressScore: 8000 })
    const remote = meta({ progressScore: 2000 })
    expect(decideMerge(local, remote)).toEqual({ kind: 'local-wins' })
  })

  it('returns \'remote-wins\' (bonus 0) when scores tie but remote savedAt is newer', () => {
    const local = meta({ progressScore: 5000, savedAt: '2026-04-27T10:00:00Z' })
    const remote = meta({ progressScore: 5000, savedAt: '2026-04-27T11:00:00Z' })
    expect(decideMerge(local, remote)).toEqual({ kind: 'remote-wins', bonusCoins: 0 })
  })

  it('returns \'tie-keep-local\' when scores AND timestamps match', () => {
    const local = meta({ progressScore: 5000, savedAt: '2026-04-27T10:00:00Z' })
    const remote = meta({ progressScore: 5000, savedAt: '2026-04-27T10:00:00Z' })
    expect(decideMerge(local, remote)).toEqual({ kind: 'tie-keep-local' })
  })

  it('returns \'tie-keep-local\' when scores match and local savedAt is newer', () => {
    const local = meta({ progressScore: 5000, savedAt: '2026-04-27T11:00:00Z' })
    const remote = meta({ progressScore: 5000, savedAt: '2026-04-27T10:00:00Z' })
    expect(decideMerge(local, remote)).toEqual({ kind: 'tie-keep-local' })
  })

  it('falls back to \'tie-keep-local\' when timestamps are unparseable on a score tie', () => {
    const local = meta({ progressScore: 5000, savedAt: 'garbage' })
    const remote = meta({ progressScore: 5000, savedAt: 'also garbage' })
    expect(decideMerge(local, remote)).toEqual({ kind: 'tie-keep-local' })
  })
})

describe('SaveMergePolicy has no coin economy left', () => {
  it('no longer exports the coin-bonus helpers', () => {
    expect('applyBonusCoins' in policy).toBe(false)
    expect('readCoinTotal' in policy).toBe(false)
  })
})
