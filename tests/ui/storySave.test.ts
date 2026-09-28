import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ─── Story saves ────────────────────────────────────────────────────────────
 *
 * Three things are worth a test here, and they are the three that would each
 * cost a player their file:
 *
 *   1. a payload survives the round trip through JSON and comes back the shape
 *      it went in — this module stores an opaque blob, so nothing else in the
 *      codebase is checking that;
 *   2. a blob it cannot read costs the blob, not the menu. `sanitiseStorySave`
 *      is total, and "total" is only true until someone adds a branch;
 *   3. `localStorage` throwing does not throw here. Several of the portals this
 *      ships to serve the game in a sandboxed iframe, where every storage call
 *      raises — a save menu that dies on click is the failure mode.
 *
 * The module is a singleton that reads storage at import time, so each test
 * that cares about *loading* seeds storage and then re-imports it through
 * `vi.resetModules()`. `tests/save/setup.ts` hands every test a fresh
 * in-memory `localStorage`.
 */

const KEY = 'world.storySave.v1'

const load = async () => {
  vi.resetModules()
  return await import('@/use/useStorySave')
}

const seed = (value: unknown): void => {
  localStorage.setItem(KEY, typeof value === 'string' ? value : JSON.stringify(value))
}

beforeEach(() => {
  vi.resetModules()
})

describe('round trip', () => {
  it('writes a slot, reads it back, and keeps the payload intact', async () => {
    const save = await load()
    const payload = { position: [1, 2.5, -3], flags: { metRolf: true }, inventory: ['bow', 'knife'] }

    expect(save.writeSlot(2, { chapter: 1, beatId: 'ambush', label: 'Drive off the bandits', payload })).toBe(true)

    const record = save.readSlot(2)
    expect(record).not.toBeNull()
    expect(record?.slot).toBe(2)
    expect(record?.chapter).toBe(1)
    expect(record?.beatId).toBe('ambush')
    expect(record?.payload).toEqual(payload)
    // Stamped here, not by the caller, and parseable as a date.
    expect(Number.isNaN(new Date(record!.savedAt).getTime())).toBe(false)
  })

  it('survives a reload', async () => {
    const first = await load()
    first.writeSlot(1, { chapter: 1, beatId: 'home', label: 'Go home', payload: { hp: 0.4 } })

    // A different module instance reading the same storage — what actually
    // happens on the player's next visit.
    const second = await load()
    expect(second.readSlot(1)?.beatId).toBe('home')
    expect(second.readSlot(1)?.payload).toEqual({ hp: 0.4 })
  })

  it('treats the quick slot as an ordinary slot', async () => {
    const save = await load()
    save.writeSlot(save.QUICK_SLOT, { chapter: 1, beatId: 'boar-chase', label: '', payload: 7 })
    expect(save.readSlot(save.QUICK_SLOT)?.payload).toBe(7)
    // …and it is not one of the three the player picks by hand.
    expect(save.SAVE_SLOTS).toEqual([1, 2, 3])
    expect(save.SAVE_SLOTS).not.toContain(save.QUICK_SLOT)
  })

  it('overwrites rather than accumulating', async () => {
    const save = await load()
    save.writeSlot(3, { chapter: 1, beatId: 'rest', label: 'Rest', payload: 'a' })
    save.writeSlot(3, { chapter: 2, beatId: 'gate', label: 'Run', payload: 'b' })
    expect(save.readSlot(3)?.payload).toBe('b')
    expect(save.readSlot(3)?.chapter).toBe(2)
  })

  it('clears one slot without touching the others', async () => {
    const save = await load()
    save.writeSlot(1, { chapter: 1, beatId: 'a', label: '', payload: 1 })
    save.writeSlot(2, { chapter: 1, beatId: 'b', label: '', payload: 2 })
    save.clearSlot(1)
    expect(save.readSlot(1)).toBeNull()
    expect(save.readSlot(2)?.payload).toBe(2)
    expect(save.hasSave(1)).toBe(false)
    expect(save.hasSave(2)).toBe(true)
  })
})

describe('a missing slot', () => {
  it('reads as null rather than undefined', async () => {
    const save = await load()
    for (const slot of save.ALL_SLOTS) {
      expect(save.readSlot(slot)).toBeNull()
      expect(save.hasSave(slot)).toBe(false)
    }
  })

  it('clears without complaint', async () => {
    const save = await load()
    expect(() => save.clearSlot(3)).not.toThrow()
    expect(save.readSlot(3)).toBeNull()
  })
})

describe('a blob it cannot read', () => {
  it.each([
    ['not JSON at all', '{ not json at all'],
    ['JSON that is not an object', '42'],
    ['null', 'null'],
    ['an array', '[]']
  ])('%s loads as four empty slots', async (_name, raw) => {
    seed(raw)
    const save = await load()
    expect(save.ALL_SLOTS.every(slot => save.readSlot(slot) === null)).toBe(true)
  })

  it('drops a version it does not know', async () => {
    seed({ version: 99, slots: { 1: { slot: 1, savedAt: '', chapter: 1, beatId: 'home', label: '', payload: 1 } } })
    const save = await load()
    expect(save.readSlot(1)).toBeNull()
  })

  it('drops only the unreadable slot, not the file', async () => {
    seed({
      version: 1,
      slots: {
        // No beat id: nothing to resume to, so the row must not be offered.
        1: { chapter: 1, savedAt: '2026-01-01T00:00:00.000Z', label: 'broken', payload: 1 },
        2: { chapter: 1, savedAt: '2026-01-01T00:00:00.000Z', beatId: 'home', label: 'fine', payload: 2 },
        // Not a record at all.
        3: 'nonsense',
        // Not a slot this build has.
        9: { chapter: 1, beatId: 'home', label: 'stray', payload: 3 }
      }
    })
    const save = await load()
    expect(save.readSlot(1)).toBeNull()
    expect(save.readSlot(2)?.label).toBe('fine')
    expect(save.readSlot(3)).toBeNull()
  })

  it('fills in what a partial record is missing instead of dropping it', async () => {
    seed({ version: 1, slots: { 2: { beatId: 'home' } } })
    const save = await load()
    const record = save.readSlot(2)
    expect(record).not.toBeNull()
    expect(record?.chapter).toBe(1)
    expect(record?.label).toBe('')
    expect(record?.savedAt).toBe('')
    expect(record?.payload).toBeNull()
  })

  it('takes the slot id from the key, not from the record', async () => {
    seed({ version: 1, slots: { 2: { slot: 3, chapter: 1, beatId: 'home', label: '', payload: 1 } } })
    const save = await load()
    expect(save.readSlot(2)?.slot).toBe(2)
    expect(save.readSlot(3)).toBeNull()
  })

  it('sanitises without throwing on anything', async () => {
    const { sanitiseStorySave } = await load()
    for (const junk of [undefined, null, 0, '', 'x', [], { version: 1 }, { version: 1, slots: 5 }]) {
      expect(() => sanitiseStorySave(junk)).not.toThrow()
      expect(sanitiseStorySave(junk)[1]).toBeNull()
    }
  })
})

describe('when storage refuses', () => {
  it('reports the failure but keeps the save for the session', async () => {
    const save = await load()
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('The operation is insecure.')
    })
    try {
      expect(save.writeSlot(1, { chapter: 1, beatId: 'home', label: '', payload: 1 })).toBe(false)
      // In memory it is still there — the player can carry on playing and only
      // loses the save on reload, which is what the `false` is telling the host.
      expect(save.readSlot(1)?.beatId).toBe('home')
    } finally {
      setItem.mockRestore()
    }
  })

  it('loads as empty when reading throws', async () => {
    const getItem = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('The operation is insecure.')
    })
    try {
      const save = await load()
      expect(save.readSlot(1)).toBeNull()
    } finally {
      getItem.mockRestore()
    }
  })

  it('reports a payload JSON cannot hold', async () => {
    const save = await load()
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(save.writeSlot(1, { chapter: 1, beatId: 'home', label: '', payload: circular })).toBe(false)
  })
})
