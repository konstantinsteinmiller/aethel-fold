import { beforeEach, describe, expect, it } from 'vitest'
import {
  APPEARANCE_KEY,
  HAIR_COLOUR_SWATCHES,
  HAIR_STYLES,
  HEAD_SHAPES,
  SEXES,
  SKIN_TONE_SWATCHES,
  TUNIC_COLOUR_SWATCHES,
  asSkinTone,
  appearanceEquals,
  loadAppearance,
  randomAppearance,
  sanitiseAppearance,
  saveAppearance
} from '@/world/characters/appearance'
import { DEFAULT_APPEARANCE, type HairStyle, type HeadShape, type Sex } from '@/world/characters/equipment'

/**
 * The appearance model the Meadowfall roster reads (`roster.ts` ->
 * `loadAppearance`). These assertions used to live in `characterCreator.test.ts`
 * next to the `/characters` screen; the screen is gone, the model is not.
 */

describe('appearance options', () => {
  it('offers every value of every union', () => {
    // The lists are derived from `Record`s keyed by the unions in
    // `equipment.ts`, so this is really asserting that the derivation survives —
    // a hand-written array would be the thing that quietly went stale.
    expect([...SEXES].sort()).toEqual((['female', 'male'] as Sex[]).sort())
    expect([...HEAD_SHAPES].sort()).toEqual((['heart', 'oval', 'round', 'square'] as HeadShape[]).sort())
    expect([...HAIR_STYLES].sort()).toEqual(
      (
        [
          'bald', 'bearded', 'bob', 'bowl', 'braids', 'bun', 'buns', 'coif',
          'flowing', 'fringe', 'long', 'mane', 'plaits', 'ponytail', 'queue',
          'receding', 'short', 'swept', 'topknot', 'tresses', 'wild'
        ] as HairStyle[]
      ).sort()
    )
  })


  it('has a swatch for every skin tone the ramp defines', () => {
    // `SkinTone` is an index into `skinTone0..4`, so five is the contract.
    expect(SKIN_TONE_SWATCHES).toHaveLength(5)
    for (const list of [SKIN_TONE_SWATCHES, HAIR_COLOUR_SWATCHES, TUNIC_COLOUR_SWATCHES]) {
      expect(list.length).toBeGreaterThan(1)
      for (const swatch of list) {
        expect(swatch).toMatch(/^#[0-9a-f]{6}$/)
      }
      // Two identical swatches are two buttons the player cannot tell apart.
      expect(new Set(list).size).toBe(list.length)
    }
  })
})


describe('appearance persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round-trips through storage under its own key', () => {
    const chosen = { ...DEFAULT_APPEARANCE, sex: 'female' as const, hair: 'braids' as const, skinTone: 3 as const }
    saveAppearance(chosen)
    // Named, not just "some key": sharing the editor's, the sculptor's or the
    // inventory's key means whichever writes last wins, silently.
    expect(APPEARANCE_KEY).toBe('world.characterAppearance.v1')
    expect(localStorage.getItem(APPEARANCE_KEY)).toBeTruthy()
    expect(appearanceEquals(loadAppearance(), chosen)).toBe(true)
  })

  it('does not collide with the inventory or the editor', () => {
    saveAppearance(DEFAULT_APPEARANCE)
    for (const foreign of ['world.characterInventory.v1', 'world_editor_mode', 'world_sculpt_delta']) {
      expect(localStorage.getItem(foreign), foreign).toBeNull()
    }
  })

  it('returns the default appearance when nothing is stored', () => {
    expect(appearanceEquals(loadAppearance(), DEFAULT_APPEARANCE)).toBe(true)
  })

  it('survives a corrupt blob rather than refusing to open', () => {
    localStorage.setItem(APPEARANCE_KEY, '{ this is not json')
    expect(appearanceEquals(loadAppearance(), DEFAULT_APPEARANCE)).toBe(true)
  })

  it('repairs every kind of nonsense a hand-edited save can contain', () => {
    const repaired = sanitiseAppearance({
      sex: 'walrus',
      head: 42,
      hair: null,
      skinTone: 99,
      hairColour: -7,
      tunicColour: Number.NaN
    })
    expect(repaired.sex).toBe(DEFAULT_APPEARANCE.sex)
    expect(repaired.head).toBe(DEFAULT_APPEARANCE.head)
    expect(repaired.hair).toBe(DEFAULT_APPEARANCE.hair)
    // Indices clamp into range rather than falling back, so a player whose ramp
    // shrank keeps the nearest colour instead of jumping to the first one.
    expect(repaired.skinTone).toBe(SKIN_TONE_SWATCHES.length - 1)
    expect(repaired.hairColour).toBe(0)
    expect(repaired.tunicColour).toBe(0)
  })

  it('keeps defaults for fields an older blob never had', () => {
    // A blob written before `hairColour` existed must not reset it to 0 — the
    // default is 0 today, so this is asserted on `skinTone`, whose default is 1.
    const repaired = sanitiseAppearance({ sex: 'female' })
    expect(repaired.sex).toBe('female')
    expect(repaired.skinTone).toBe(DEFAULT_APPEARANCE.skinTone)
  })

  it('narrows a picker index to the SkinTone union', () => {
    expect(asSkinTone(0)).toBe(0)
    expect(asSkinTone(4)).toBe(4)
    expect(asSkinTone(9)).toBe(4)
    expect(asSkinTone(-1)).toBe(0)
  })

  it('only ever randomises into legal values', () => {
    // 200 draws, because a generator that can produce one out-of-range value
    // will produce it on somebody's first click.
    for (let i = 0; i < 200; i++) {
      const appearance = randomAppearance()
      expect(SEXES).toContain(appearance.sex)
      expect(HEAD_SHAPES).toContain(appearance.head)
      expect(HAIR_STYLES).toContain(appearance.hair)
      expect(appearanceEquals(sanitiseAppearance(appearance), appearance)).toBe(true)
    }
    // Both ends of every ramp are reachable — an off-by-one in the floor would
    // otherwise strand the last swatch, and 200 uniform draws would not notice.
    expect(randomAppearance(() => 0).skinTone).toBe(0)
    expect(randomAppearance(() => 0.999999).skinTone).toBe(SKIN_TONE_SWATCHES.length - 1)
  })
})
