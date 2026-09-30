import { beforeEach, describe, expect, it } from 'vitest'
import { appearanceEquals, copyAppearance, sanitiseAppearance } from '@/world/characters/appearance'
import { DEFAULT_APPEARANCE, EMPTY_LOADOUT, type EquipmentLoadout } from '@/world/characters/equipment'
import { MAX_NAME_LENGTH, emptyProfile, makeCharacterId } from '@/world/characters/profile'
import {
  MAX_PROFILES,
  ROSTER_KEY,
  RosterStore,
  characterRoster,
  emptyDraft,
  filterProfiles,
  foldForSearch,
  loadRoster,
  matchesQuery,
  loadoutEquals,
  resetCharacterRoster,
  sanitiseLoadout,
  sanitiseName,
  sanitiseProfile,
  sanitiseRoster,
  saveRoster,
  type ProfileDraft
} from '@/world/characters/roster'

/**
 * ─── The roster ─────────────────────────────────────────────────────────────
 *
 * Two things here are worth more than the rest.
 *
 * The first is that **a rename never touches the id**. That is the whole reason
 * `CharacterProfile` carries both fields, and it is a rule that fails silently:
 * an id rewritten on rename breaks every save, quest and spawn-table reference
 * to that character with no error anywhere, and the symptom arrives days later
 * as an NPC who has forgotten who you are.
 *
 * The second is that **loading is total**. Every malformed shape below has to
 * come back as a usable roster, because the alternative is a creation screen
 * that will not open at all — a strictly worse failure than one missing
 * character.
 */

const draftOf = (name: string, over: Partial<ProfileDraft> = {}): ProfileDraft => ({
  ...emptyDraft(),
  name,
  ...over
})

describe('character ids', () => {
  it('slugs a name, and only suffixes when it has to', () => {
    expect(makeCharacterId('Blacksmith', [])).toBe('blacksmith')
    expect(makeCharacterId('Old Man Willow', [])).toBe('old-man-willow')
    // Punctuation collapses to single separators and never leads or trails, so
    // an id is always a legal lookup key rather than something with a dangling
    // hyphen that a hand-authored spawn table would get subtly wrong.
    expect(makeCharacterId('  ¡¡Zoë!! ', [])).toBe('zo')
    expect(makeCharacterId('Blacksmith', ['blacksmith'])).toBe('blacksmith-2')
    expect(makeCharacterId('Blacksmith', ['blacksmith', 'blacksmith-2'])).toBe('blacksmith-3')
  })

  it('never mints an empty id', () => {
    // An id of `''` is a lookup that silently matches nothing — the one failure
    // the fallback exists to prevent.
    for (const name of ['', '   ', '!!!', '…', '\n\t']) {
      expect(makeCharacterId(name, []), JSON.stringify(name)).not.toBe('')
      expect(makeCharacterId(name, [])).toBe('character')
    }
    expect(makeCharacterId('', ['character'])).toBe('character-2')
  })
})

describe('name repair', () => {
  it('trims, collapses whitespace and caps the length', () => {
    expect(sanitiseName('  Ada   Lovelace  ')).toBe('Ada Lovelace')
    expect(sanitiseName('line\nbreak')).toBe('line break')
    expect(sanitiseName('x'.repeat(200))).toHaveLength(MAX_NAME_LENGTH)
    expect(sanitiseName(undefined)).toBe('')
    expect(sanitiseName(42)).toBe('')
  })

  it('keeps a blank name legal', () => {
    // `profile.ts` is explicit that the name may be empty. The screen shows a
    // placeholder for it; the store must not invent one.
    const store = new RosterStore()
    const created = store.create(draftOf(''), 1)
    expect(created.name).toBe('')
    expect(created.id).toBe('character')
  })
})

describe('loadout repair', () => {
  it('drops an item that is in the wrong slot and settles an illegal draw', () => {
    const repaired = sanitiseLoadout({ mainHand: 'shield', back: 'greatsword', drawn: 'twoHand', offHand: 'shield' })
    // A shield is an off-hand item, so it never survives in `mainHand`.
    expect(repaired.mainHand).toBeNull()
    expect(repaired.back).toBe('greatsword')
    // Two hands are needed and the off hand is carrying a shield, so the drawn
    // state falls back rather than being rendered as something impossible.
    expect(repaired.drawn).toBe('sheathed')
  })

  it('is total: every kind of nonsense yields a legal loadout', () => {
    for (const raw of [null, undefined, 7, 'sword', [], { drawn: 'levitating' }, { head: {} }]) {
      const repaired = sanitiseLoadout(raw)
      expect(loadoutEquals(repaired, sanitiseLoadout(repaired)), JSON.stringify(raw)).toBe(true)
    }
    expect(loadoutEquals(sanitiseLoadout(null), EMPTY_LOADOUT)).toBe(true)
  })
})

describe('profile repair', () => {
  it('keeps a good id exactly as stored', () => {
    const profile = sanitiseProfile({ id: 'blacksmith', name: 'Blacksmith' }, [])
    expect(profile.id).toBe('blacksmith')
  })

  it('rewrites only an id that could not be looked up', () => {
    // Missing, blank, not slug-shaped, or already taken — the four cases where
    // keeping the stored id would mean a reference that resolves to nothing.
    expect(sanitiseProfile({ name: 'Mara' }, []).id).toBe('mara')
    expect(sanitiseProfile({ id: '   ', name: 'Mara' }, []).id).toBe('mara')
    expect(sanitiseProfile({ id: 'Old Smith!', name: 'Mara' }, []).id).toBe('old-smith')
    expect(sanitiseProfile({ id: 'mara', name: 'Mara' }, ['mara']).id).toBe('mara-2')
  })

  it('repairs the appearance through the same sanitiser the screen uses', () => {
    const profile = sanitiseProfile({ id: 'x', appearance: { sex: 'walrus', skinTone: 99, hair: 'braids' } }, [])
    expect(profile.appearance.sex).toBe(DEFAULT_APPEARANCE.sex)
    expect(profile.appearance.hair).toBe('braids')
    // Identical to asking `sanitiseAppearance` directly — there is deliberately
    // no second appearance sanitiser in this file's implementation.
    expect(appearanceEquals(profile.appearance, sanitiseAppearance({ sex: 'walrus', skinTone: 99, hair: 'braids' })))
      .toBe(true)
  })

  it('never throws, whatever it is handed', () => {
    for (const raw of [null, undefined, 0, '', 'nonsense', [], [1, 2], { id: 5, name: {}, updatedAt: 'soon' }]) {
      const profile = sanitiseProfile(raw, [])
      expect(typeof profile.id, JSON.stringify(raw)).toBe('string')
      expect(profile.id.length).toBeGreaterThan(0)
      expect(typeof profile.name).toBe('string')
      expect(Number.isFinite(profile.updatedAt)).toBe(true)
    }
  })
})

describe('roster repair', () => {
  it('is total: a malformed blob still yields a usable roster', () => {
    for (const raw of [null, undefined, 'nope', 12, [], { profiles: 'two' }, { profiles: {} }]) {
      const roster = sanitiseRoster(raw)
      expect(Array.isArray(roster.profiles), JSON.stringify(raw)).toBe(true)
      expect(roster.activeId).toBeNull()
    }
  })

  it('keeps every profile a truncated write left behind, with unique ids', () => {
    // The shape a half-finished write produces: the same character twice, and a
    // trailing entry that is barely an object. Both have to survive as
    // *distinct* characters — an id collision would make one shadow the other.
    const roster = sanitiseRoster({
      profiles: [{ id: 'mara', name: 'Mara' }, { id: 'mara', name: 'Mara' }, { junk: true }],
      activeId: 'mara'
    })
    expect(roster.profiles.map(profile => profile.id)).toEqual(['mara', 'mara-2', 'character'])
    expect(roster.activeId).toBe('mara')
  })

  it('falls back to the draft when activeId names nothing', () => {
    // Not an error state: `null` is the unsaved-draft state a first visit is in,
    // so there is exactly one "nothing is open" rather than two.
    expect(sanitiseRoster({ profiles: [], activeId: 'ghost' }).activeId).toBeNull()
    expect(sanitiseRoster({ profiles: [{ id: 'a' }], activeId: 7 }).activeId).toBeNull()
  })

  it('bounds what a hostile blob can make the screen do', () => {
    const profiles = Array.from({ length: MAX_PROFILES + 20 }, (_, index) => ({ id: `c${index}`, name: `C${index}` }))
    expect(sanitiseRoster({ profiles }).profiles).toHaveLength(MAX_PROFILES)
  })
})

describe('the store', () => {
  it('starts empty, with no character open', () => {
    const store = new RosterStore()
    expect(store.isEmpty).toBe(true)
    expect(store.size).toBe(0)
    expect(store.list()).toEqual([])
    expect(store.activeId).toBeNull()
    expect(store.activeProfile()).toBeNull()
  })

  it('mints an id on create and opens the new character', () => {
    const store = new RosterStore()
    const first = store.create(draftOf('Blacksmith'), 10)
    expect(first.id).toBe('blacksmith')
    expect(store.activeId).toBe('blacksmith')

    // Two characters may share a name — it is free text — so the second id has
    // to disambiguate rather than collide.
    const second = store.create(draftOf('Blacksmith'), 20)
    expect(second.id).toBe('blacksmith-2')
    expect(store.size).toBe(2)
  })

  it('leaves the id alone across a rename', () => {
    const store = new RosterStore()
    const created = store.create(draftOf('Blacksmith'), 10)
    const renamed = store.rename(created.id, 'Wandering Cooper', 20)
    expect(renamed?.id).toBe('blacksmith')
    expect(renamed?.name).toBe('Wandering Cooper')
    expect(store.ids()).toEqual(['blacksmith'])
    // And the same through the full save path, which is what the Save button
    // actually calls — there is no parameter on `update` that could change it.
    const updated = store.update('blacksmith', draftOf('Someone Else'), 30)
    expect(updated?.id).toBe('blacksmith')
  })

  it('lists most recently edited first, and stably', () => {
    const store = new RosterStore()
    store.create(draftOf('One'), 100)
    store.create(draftOf('Two'), 100)
    store.create(draftOf('Three'), 100)
    // Same millisecond: creation order is preserved rather than shuffled, so two
    // reads of an unchanged roster cannot disagree.
    expect(store.list().map(profile => profile.name)).toEqual(['One', 'Two', 'Three'])
    store.rename('one', 'One', 500)
    expect(store.list().map(profile => profile.name)).toEqual(['One', 'Two', 'Three'])
    store.rename('three', 'Three', 900)
    expect(store.list().map(profile => profile.name)).toEqual(['Three', 'One', 'Two'])
  })

  it('duplicates under a new id and opens the copy', () => {
    const store = new RosterStore()
    const source = store.create(draftOf('Mara', { appearance: { ...DEFAULT_APPEARANCE, hair: 'braids' } }), 10)
    const copy = store.duplicate(source.id, 'Mara copy', 20)
    expect(copy).not.toBeNull()
    expect(copy!.id).not.toBe(source.id)
    expect(copy!.id).toBe('mara-copy')
    expect(copy!.appearance.hair).toBe('braids')
    expect(store.activeId).toBe('mara-copy')
    // The original is untouched — a duplicate is a new character, not a second
    // reference to the same one.
    expect(store.profile('mara')?.name).toBe('Mara')
  })

  it('refuses to open a character that is not there', () => {
    const store = new RosterStore()
    store.create(draftOf('Mara'), 10)
    expect(store.open('ghost')).toBe(false)
    expect(store.activeId).toBe('mara')
    // `null` is always legal: it is the unsaved draft.
    expect(store.open(null)).toBe(true)
    expect(store.activeId).toBeNull()
  })

  it('opens the neighbour when the open character is deleted', () => {
    const store = new RosterStore()
    store.create(draftOf('One'), 100)
    store.create(draftOf('Two'), 200)
    store.create(draftOf('Three'), 300)
    // Display order is [Three, Two, One]; deleting the open middle one lands on
    // the row it was sitting on top of.
    store.open('two')
    expect(store.remove('two')).toBe('one')
    expect(store.activeId).toBe('one')
    // Deleting the last entry in the list has no row below it, so it goes up.
    expect(store.remove('one')).toBe('three')
  })

  it('falls back to the draft when the last character is deleted', () => {
    const store = new RosterStore()
    store.create(draftOf('Only'), 10)
    expect(store.remove('only')).toBeNull()
    expect(store.activeId).toBeNull()
    expect(store.isEmpty).toBe(true)
  })

  it('leaves the open character alone when a different one is deleted', () => {
    const store = new RosterStore()
    store.create(draftOf('One'), 100)
    store.create(draftOf('Two'), 200)
    store.open('one')
    expect(store.remove('two')).toBe('one')
    expect(store.remove('ghost')).toBe('one')
  })

  it('bumps a revision on every change that alters what list() returns', () => {
    const store = new RosterStore()
    const seen: number[] = []
    const mark = (): void => {
      seen.push(store.revision)
    }
    mark()
    store.create(draftOf('One'), 10)
    mark()
    store.rename('one', 'Two', 20)
    mark()
    store.remove('one')
    mark()
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('hands out copies, and keeps none of what it is given', () => {
    const store = new RosterStore()
    const draft = draftOf('Mara')
    store.create(draft, 10)

    // Mutating the caller's draft afterwards must not reach the store: the
    // caller is a Vue component, and a retained object is a reactive proxy on a
    // per-frame path (GDD §0).
    draft.name = 'Someone Else'
    draft.appearance.hair = 'wild'
    draft.loadout.mainHand = 'sword'
    expect(store.profile('mara')?.name).toBe('Mara')
    expect(store.profile('mara')?.appearance.hair).toBe(DEFAULT_APPEARANCE.hair)
    expect(store.profile('mara')?.loadout.mainHand).toBeNull()

    // And the other way: what it hands out is not the stored object either.
    const read = store.profile('mara')!
    read.name = 'Tampered'
    read.appearance.hair = 'wild'
    expect(store.profile('mara')?.name).toBe('Mara')
    expect(store.profile('mara')?.appearance.hair).toBe(DEFAULT_APPEARANCE.hair)
  })

  it('carries every appearance field through a create/read round-trip', () => {
    // The regression this exists for: `copyAppearance` used to list its fields by
    // hand, `eyes` and `mouth` were added to `CharacterAppearance` and the list
    // was not, and the figure silently kept the shipped face. Derived from
    // `DEFAULT_APPEARANCE` it cannot happen again — asserted field by field so a
    // new field is covered the day it is added.
    const store = new RosterStore()
    const appearance = { ...DEFAULT_APPEARANCE, eyes: 'weary' as const, mouth: 'grin' as const, hair: 'wild' as const }
    store.create(draftOf('Mara', { appearance }), 10)
    const stored = store.profile('mara')!.appearance
    for (const field of Object.keys(DEFAULT_APPEARANCE) as (keyof typeof DEFAULT_APPEARANCE)[]) {
      expect(stored[field], field).toBe(appearance[field])
    }
    expect(appearanceEquals(stored, appearance)).toBe(true)
    expect(appearanceEquals(copyAppearance(appearance), appearance)).toBe(true)
  })

  it('stores a full loadout, which is the seam the weapon panel will use', () => {
    const store = new RosterStore()
    const loadout: EquipmentLoadout = { ...EMPTY_LOADOUT, mainHand: 'sword', head: 'helmet', drawn: 'mainHand' }
    store.create(draftOf('Guard', { loadout }), 10)
    expect(loadoutEquals(store.profile('guard')!.loadout, loadout)).toBe(true)
  })
})

describe('roster persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    resetCharacterRoster()
  })

  it('round-trips through storage under its own key', () => {
    const store = new RosterStore()
    store.create(draftOf('Mara', { appearance: { ...DEFAULT_APPEARANCE, hair: 'braids', eyes: 'sleepy' } }), 10)
    store.create(draftOf('Bran'), 20)
    store.open('mara')
    store.save()

    // Named, not just "some key": sharing the appearance key, the inventory's,
    // the editor's or the sculptor's means whichever writes last wins, silently.
    expect(ROSTER_KEY).toBe('world.characterRoster.v1')
    expect(localStorage.getItem(ROSTER_KEY)).toBeTruthy()

    const reloaded = loadRoster()
    expect(reloaded.activeId).toBe('mara')
    expect(reloaded.profiles.map(profile => profile.id).sort()).toEqual(['bran', 'mara'])
    const mara = reloaded.profiles.find(profile => profile.id === 'mara')!
    expect(mara.appearance.hair).toBe('braids')
    expect(mara.appearance.eyes).toBe('sleepy')
  })

  it('does not collide with the appearance, the inventory or the editor', () => {
    saveRoster({ profiles: [emptyProfile('mara', 'Mara')], activeId: 'mara' })
    for (const foreign of [
      'world.characterAppearance.v1',
      'world.characterInventory.v1',
      'world_editor_mode',
      'world_sculpt_delta'
    ]) {
      expect(localStorage.getItem(foreign), foreign).toBeNull()
    }
  })

  it('opens an empty roster on a first visit', () => {
    const roster = loadRoster()
    expect(roster.profiles).toEqual([])
    expect(roster.activeId).toBeNull()
  })

  it('opens a usable roster from a corrupt blob rather than refusing to start', () => {
    for (const blob of ['{ this is not json', '[]', 'null', '{"profiles":{"a":1},"activeId":"a"}', '"hello"']) {
      localStorage.setItem(ROSTER_KEY, blob)
      const roster = loadRoster()
      expect(Array.isArray(roster.profiles), blob).toBe(true)
      // A store built on it is immediately usable — not merely non-throwing.
      const store = new RosterStore(roster)
      expect(store.create(draftOf('Recovered'), 10).id).toBe('recovered')
    }
  })

  it('recovers the readable half of a truncated write', () => {
    localStorage.setItem(
      ROSTER_KEY,
      JSON.stringify({
        profiles: [
          { id: 'mara', name: 'Mara', appearance: { hair: 'braids' }, updatedAt: 5 },
          { id: 'mara', name: 'Mara', appearance: null },
          'not a profile'
        ],
        activeId: 'nobody'
      })
    )
    const store = new RosterStore(loadRoster())
    expect(store.size).toBe(3)
    expect(store.activeId).toBeNull()
    expect(store.profile('mara')?.appearance.hair).toBe('braids')
    expect(store.profile('mara-2')?.appearance.hair).toBe(DEFAULT_APPEARANCE.hair)
  })

  it('survives storage being blocked entirely', () => {
    // Sandboxed iframes — how several of the portals this ships to serve games —
    // throw on `getItem`, not just on `setItem`.
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked')
      }
    })
    try {
      expect(loadRoster().profiles).toEqual([])
      expect(() => saveRoster({ profiles: [], activeId: null })).not.toThrow()
    } finally {
      if (original) {
        Object.defineProperty(window, 'localStorage', original)
      }
    }
  })

  it('gives the game one roster, re-read from storage after a reset', () => {
    saveRoster({ profiles: [emptyProfile('mara', 'Mara')], activeId: 'mara' })
    expect(characterRoster()).toBe(characterRoster())
    expect(characterRoster().activeId).toBe('mara')
    resetCharacterRoster()
    localStorage.clear()
    expect(characterRoster().isEmpty).toBe(true)
  })
})

describe('roster search', () => {
  /** `updatedAt` descending is the order `list()` hands the screen. */
  const named = (id: string, name: string, updatedAt: number) => ({
    ...emptyProfile(id, name),
    updatedAt
  })

  const roster = [
    named('guard-captain', 'Guard Captain', 500),
    named('town-guard', 'Town Guard', 400),
    named('mueller', 'Müller', 300),
    named('blacksmith', 'Black Smith', 200),
    named('character-7', '', 100)
  ]

  const ids = (query: string) => filterProfiles(roster, query).map(profile => profile.id)

  it('matches on the id, not only the name', () => {
    // The whole reason the id is searched: a quest or a spawn table names a
    // character by id, so somebody arriving from one has only that.
    expect(ids('character-7')).toEqual(['character-7'])
    expect(ids('blacksmith')).toEqual(['blacksmith'])
  })

  it('folds case and accents', () => {
    expect(foldForSearch('Müller')).toBe('muller')
    expect(ids('muller')).toEqual(['mueller'])
    expect(ids('MÜLLER')).toEqual(['mueller'])
  })

  it('requires every token, in any order', () => {
    expect(ids('smith black')).toEqual(['blacksmith'])
    expect(ids('black smith')).toEqual(['blacksmith'])
    // Widening on a second token is the bug this rules out: typing more must
    // never return more.
    expect(ids('guard captain')).toEqual(['guard-captain'])
    expect(ids('guard nonsense')).toEqual([])
  })

  it('puts a prefix match under the cursor', () => {
    // Both contain "guard"; only one starts with it. Enter picks row 0, so the
    // ranking is the difference between one keystroke and a wrong character.
    expect(ids('gua')).toEqual(['guard-captain', 'town-guard'])
  })

  it('keeps recency order within a rank, and for an empty query', () => {
    expect(ids('')).toEqual(roster.map(profile => profile.id))
    // Both are interior matches of "a"; neither outranks the other, so the
    // list must not reshuffle away from what `list()` handed over.
    expect(filterProfiles(roster, 'guard').map(p => p.updatedAt)).toEqual([500, 400])
  })

  it('treats an unnamed character as findable by id alone', () => {
    expect(matchesQuery(named('character-7', '', 0), 'character')).toBe(true)
    expect(matchesQuery(named('character-7', '', 0), 'mara')).toBe(false)
  })

  it('matches everything on a blank or punctuation-only query', () => {
    expect(ids('   ')).toHaveLength(roster.length)
    expect(ids('-,.')).toHaveLength(roster.length)
  })
})
