import { beforeEach, describe, expect, it } from 'vitest'
import { APPEARANCE_KEY, saveAppearance } from '@/world/characters/appearance'
import { DEFAULT_APPEARANCE, type CharacterAppearance } from '@/world/characters/equipment'
import { emptyLoadout } from '@/world/characters/inventory'
import { ROSTER_KEY, playerLook } from '@/world/characters/roster'
import type { CharacterRoster } from '@/world/characters/profile'

/**
 * ─── Who the player walks around as ─────────────────────────────────────────
 *
 * `/characters` could build a character, name it, mint it a stable id and store
 * it — and until `playerLook` nothing outside that route read any of it. The
 * player was `new Character({ perfTag })`, i.e. the shipped bowl cut, whatever
 * the roster said.
 *
 * The failure mode this file is really guarding is the *silent* one: every
 * branch of the resolver returns something a `Character` can be built from, so a
 * bug here does not throw — it quietly hands back the default and the player
 * finds their character did not travel. Hence the `source` field, and hence a
 * test per branch.
 */

const DWARF: CharacterAppearance = {
  ...DEFAULT_APPEARANCE,
  head: 'square',
  hair: 'wild',
  hairColour: 4,
  beard: 'patriarch',
  brows: 'bushy',
  nose: 'round',
  eyes: 'sharp',
  mouth: 'neutral'
}

const storeRoster = (roster: CharacterRoster): void => {
  localStorage.setItem(ROSTER_KEY, JSON.stringify(roster))
}

const profile = (id: string, appearance: CharacterAppearance, loadout = emptyLoadout()) => ({
  id,
  name: id,
  appearance,
  loadout,
  updatedAt: 1
})

describe('playerLook', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('falls back to the shipped figure when nothing has ever been saved', () => {
    const look = playerLook()
    expect(look.source).toBe('default')
    expect(look.appearance).toEqual(DEFAULT_APPEARANCE)
    expect(look.loadout).toEqual(emptyLoadout())
  })

  it('wears the roster’s active profile, loadout and all', () => {
    storeRoster({
      profiles: [
        profile('durin', DWARF, { ...emptyLoadout(), mainHand: 'sword', torso: 'wanderersCoat' }),
        profile('someone-else', DEFAULT_APPEARANCE)
      ],
      activeId: 'durin'
    })
    const look = playerLook()
    expect(look.source).toBe('profile')
    expect(look.appearance.beard).toBe('patriarch')
    expect(look.appearance.nose).toBe('round')
    expect(look.appearance.brows).toBe('bushy')
    // The loadout is the half a bare appearance cannot carry, and it is the
    // reason `chibiBody` builds a `CharacterEquipment` at all.
    expect(look.loadout.mainHand).toBe('sword')
    expect(look.loadout.torso).toBe('wanderersCoat')
  })

  it('picks the active one, not the first one', () => {
    storeRoster({
      profiles: [profile('first', DEFAULT_APPEARANCE), profile('durin', DWARF)],
      activeId: 'durin'
    })
    expect(playerLook().appearance.beard).toBe('patriarch')
  })

  it('falls through to the standalone appearance when no profile is open', () => {
    // What a build that predates the roster wrote, and what `Save` still writes
    // alongside it. Appearance only — there is no loadout in that key to find,
    // so the player is dressed and unarmed rather than dressed in a guess.
    saveAppearance(DWARF)
    const look = playerLook()
    expect(look.source).toBe('appearance')
    expect(look.appearance.beard).toBe('patriarch')
    expect(look.loadout).toEqual(emptyLoadout())
  })

  it('prefers the active profile over the standalone key', () => {
    saveAppearance({ ...DEFAULT_APPEARANCE, beard: 'goatee' })
    storeRoster({ profiles: [profile('durin', DWARF)], activeId: 'durin' })
    const look = playerLook()
    expect(look.source).toBe('profile')
    expect(look.appearance.beard).toBe('patriarch')
  })

  it('treats a standalone key that is merely the default as "nothing saved"', () => {
    // Otherwise every player who has ever opened the screen and closed it again
    // reports `appearance`, and the label stops telling the two apart. It is only
    // a label — the figure is identical either way — which is exactly why an
    // exact compare is honest here.
    saveAppearance(DEFAULT_APPEARANCE)
    expect(playerLook().source).toBe('default')
  })

  it('survives a roster with an activeId that no longer exists', () => {
    // Another tab deleted the character this one had open.
    storeRoster({ profiles: [profile('durin', DWARF)], activeId: 'ghost' })
    const look = playerLook()
    expect(look.source).toBe('default')
    expect(look.appearance).toEqual(DEFAULT_APPEARANCE)
  })

  it('repairs a corrupt roster rather than throwing', () => {
    localStorage.setItem(ROSTER_KEY, '{ not json')
    expect(() => playerLook()).not.toThrow()
    expect(playerLook().source).toBe('default')
  })

  it('repairs a profile carrying styles this build does not have', () => {
    // A save from a build with a beard style that has since been renamed. It has
    // to come back as a buildable figure, not as `beard: 'chinstrap'` reaching
    // `features.ts` and emitting nothing while the rest of the face is fine.
    storeRoster({
      profiles: [profile('durin', { ...DWARF, beard: 'chinstrap' } as unknown as CharacterAppearance)],
      activeId: 'durin'
    })
    const look = playerLook()
    expect(look.source).toBe('profile')
    expect(look.appearance.beard).toBe('none')
    // and everything valid alongside it survives
    expect(look.appearance.nose).toBe('round')
  })

  it('hands back copies, never the stored objects', () => {
    storeRoster({ profiles: [profile('durin', DWARF)], activeId: 'durin' })
    const a = playerLook()
    a.appearance.beard = 'goatee'
    a.loadout.mainHand = 'shield'
    const b = playerLook()
    expect(b.appearance.beard).toBe('patriarch')
    expect(b.loadout.mainHand).toBeNull()
  })

  it('takes a roster passed in, for callers that already have one', () => {
    const look = playerLook({ profiles: [profile('durin', DWARF)], activeId: 'durin' })
    expect(look.source).toBe('profile')
    expect(look.appearance.beard).toBe('patriarch')
    // and it did not touch storage to do it
    expect(localStorage.getItem(ROSTER_KEY)).toBeNull()
    expect(localStorage.getItem(APPEARANCE_KEY)).toBeNull()
  })
})
