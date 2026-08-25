import { beforeEach, describe, expect, it } from 'vitest'
import router from '@/router'
import { LANGUAGES } from '@/utils/enums'
import {
  APPEARANCE_KEY,
  EYE_STYLE_OPTIONS,
  HAIR_COLOUR_SWATCHES,
  HAIR_STYLES,
  HEAD_SHAPES,
  MOUTH_STYLE_OPTIONS,
  PREVIEW_ITEMS,
  SEXES,
  SKIN_TONE_SWATCHES,
  TUNIC_COLOUR_SWATCHES,
  asSkinTone,
  appearanceEquals,
  buildPlinth,
  loadAppearance,
  randomAppearance,
  sanitiseAppearance,
  saveAppearance
} from '@/world/characters/CreatorScene'
import {
  DEFAULT_APPEARANCE,
  EMPTY_LOADOUT,
  ITEM_SLOT,
  type EquipmentLoadout,
  type HairStyle,
  type HeadShape,
  type Sex
} from '@/world/characters/equipment'
import { ITEM_KINDS, canDraw, playerInventory, resetPlayerInventory } from '@/world/characters/inventory'

import ar from '@/i18n/locales/ar'
import de from '@/i18n/locales/de'
import en from '@/i18n/locales/en'
import es from '@/i18n/locales/es'
import fr from '@/i18n/locales/fr'
import hi from '@/i18n/locales/hi'
import id from '@/i18n/locales/id'
// Aliased: `it` is vitest's own global, and importing the Italian bundle under
// that name shadows it — every `it(...)` in this file then calls a message
// object and the whole suite fails to collect.
import itLocale from '@/i18n/locales/it'
import ja from '@/i18n/locales/ja'
import kk from '@/i18n/locales/kk'
import ko from '@/i18n/locales/ko'
import nl from '@/i18n/locales/nl'
import pl from '@/i18n/locales/pl'
import pt from '@/i18n/locales/pt'
import ru from '@/i18n/locales/ru'
import th from '@/i18n/locales/th'
import tr from '@/i18n/locales/tr'
import uk from '@/i18n/locales/uk'
import uz from '@/i18n/locales/uz'
import vi from '@/i18n/locales/vi'
import zh from '@/i18n/locales/zh'

/**
 * ─── /characters ────────────────────────────────────────────────────────────
 *
 * The most valuable assertions in this file are the boring ones about locale
 * keys. A character-creation screen is player-facing, so a key that exists in
 * `en.ts` and nowhere else does not throw, does not warn in production, and does
 * not fail a type-check — it ships as the literal string
 * `characters.hairStyles.ponytail` in the middle of somebody's UI, in their
 * language, and the only way to find it is to switch to that language and look.
 * So the key sets are compared **both ways** across all 21 bundles: a missing
 * key and a stale extra one are the same class of bug.
 *
 * The rest covers what can be checked without a WebGL context: the storage
 * repair path (which has to be total, because it is the one thing standing
 * between an old blob and a screen that will not open), the option lists that
 * the picker is generated from, and the winding of the one new surface here.
 */

const BUNDLES: Record<string, unknown> = {
  ar, de, en, es, fr, hi, id, it: itLocale, ja, kk, ko, nl, pl, pt, ru, th, tr, uk, uz, vi, zh
}

const flatten = (value: unknown, prefix = '', into = new Map<string, string>()): Map<string, string> => {
  if (typeof value === 'string') {
    into.set(prefix, value)
    return into
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, into)
    }
  }
  return into
}

const FLAT: Record<string, Map<string, string>> = Object.fromEntries(
  Object.entries(BUNDLES).map(([code, messages]) => [code, flatten(messages)])
)

const ENGLISH = FLAT.en!
const CHARACTER_KEYS = [...ENGLISH.keys()].filter(key => key.startsWith('characters.'))

describe('locale bundles', () => {
  it('covers every language the picker offers', () => {
    // If a 22nd language is added to `LANGUAGES` and not imported above, the
    // parity checks below would silently stop covering it.
    expect([...Object.keys(BUNDLES)].sort()).toEqual([...LANGUAGES].sort())
  })

  it('gives every locale exactly the keys English has', () => {
    for (const [code, messages] of Object.entries(FLAT)) {
      const missing = [...ENGLISH.keys()].filter(key => !messages.has(key))
      const extra = [...messages.keys()].filter(key => !ENGLISH.has(key))
      expect(missing, `${code} is missing keys`).toEqual([])
      expect(extra, `${code} has keys English does not`).toEqual([])
    }
  })

  it('translates every string on the character screen into every locale', () => {
    // Named explicitly rather than relying on the parity check alone: that one
    // would still pass if this whole block were deleted from all 21 files at
    // once, which is exactly what a bad merge does.
    expect(CHARACTER_KEYS.length).toBeGreaterThanOrEqual(45)
    for (const [code, messages] of Object.entries(FLAT)) {
      for (const key of CHARACTER_KEYS) {
        const value = messages.get(key)
        expect(typeof value, `${code}:${key}`).toBe('string')
        expect(value!.trim().length, `${code}:${key} is blank`).toBeGreaterThan(0)
      }
    }
  })

  it('keeps interpolation inside i18n rather than in string concatenation', () => {
    // `{n}` numbers the swatch labels and `{name}` carries the character's name
    // into the delete confirmation and the duplicate's name. A translation that
    // drops a placeholder loses that value entirely — vue-i18n renders the rest
    // and says nothing, so "Delete ?" ships.
    //
    // Every placeholder English uses, not just `{n}`: the check is written from
    // the source string rather than from a list here, so a new interpolated key
    // is covered the day it is added instead of the day somebody remembers.
    let checked = 0
    for (const key of CHARACTER_KEYS) {
      const placeholders = [...ENGLISH.get(key)!.matchAll(/\{[a-zA-Z0-9_]+\}/g)].map(match => match[0])
      for (const placeholder of placeholders) {
        checked++
        for (const [code, messages] of Object.entries(FLAT)) {
          expect(messages.get(key), `${code}:${key} dropped ${placeholder}`).toContain(placeholder)
        }
      }
    }
    // The loop above is vacuously green if the placeholders ever stop being
    // found — a `{n}` rewritten as `%s` would silently pass it otherwise.
    expect(checked).toBeGreaterThanOrEqual(5)
  })

  it('translates the roster into every locale', () => {
    // The strings the roster added. Listed by name rather than left to the
    // parity check, for the same reason the block above is: parity is satisfied
    // by 21 files that are all equally wrong.
    const ROSTER_KEYS = [
      'roster',
      'newCharacter',
      'unnamed',
      'empty',
      'name',
      'namePlaceholder',
      'copyName',
      'id',
      'idPending',
      'idFixed',
      'duplicate',
      'delete',
      'deleteConfirm',
      'unsavedChanges',
      'saveAndContinue',
      'discard'
    ]
    for (const suffix of ROSTER_KEYS) {
      for (const [code, messages] of Object.entries(FLAT)) {
        const value = messages.get(`characters.${suffix}`)
        expect(typeof value, `${code}:characters.${suffix}`).toBe('string')
        expect(value!.trim().length, `${code}:characters.${suffix} is blank`).toBeGreaterThan(0)
      }
    }
  })

  it('reuses the shared Cancel rather than adding a second one', () => {
    // Both confirmations on this screen offer a way out, and the bundles already
    // had a word for it. A `characters.cancel` alongside the global one is two
    // strings to keep in step across 21 languages for one button.
    expect(ENGLISH.has('cancel')).toBe(true)
    expect(ENGLISH.has('characters.cancel')).toBe(false)
  })
})

describe('the /characters route', () => {
  it('resolves, and is lazy', () => {
    const route = router.resolve('/characters')
    expect(route.name).toBe('characters')
    // A lazy route's component is a function; an eagerly imported one is an
    // object, and it would pull a second three.js scene into the entry chunk
    // that every player downloads whether or not they open this screen.
    expect(typeof route.matched[0]?.components?.default).toBe('function')
  })
})

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

  it('gives the picker a label key for every option', () => {
    for (const option of SEXES) {
      expect(ENGLISH.has(`characters.bodies.${option}`), option).toBe(true)
    }
    for (const option of HEAD_SHAPES) {
      expect(ENGLISH.has(`characters.heads.${option}`), option).toBe(true)
    }
    for (const option of HAIR_STYLES) {
      expect(ENGLISH.has(`characters.hairStyles.${option}`), option).toBe(true)
    }
    // The face pickers. Their label keys shipped before the panel had the
    // controls, which is the failure this catches from the other side: an option
    // list the player cannot reach is as invisible as a missing translation.
    for (const option of EYE_STYLE_OPTIONS) {
      expect(ENGLISH.has(`characters.eyeStyles.${option}`), option).toBe(true)
    }
    for (const option of MOUTH_STYLE_OPTIONS) {
      expect(ENGLISH.has(`characters.mouthStyles.${option}`), option).toBe(true)
    }
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

describe('the equipment preview', () => {
  it('offers one item per slot, each with a label in every locale', () => {
    const slots = PREVIEW_ITEMS.map(kind => ITEM_SLOT[kind])
    // Four items in four different slots is what makes them independent
    // toggles rather than a radio group — two in one slot and the panel would
    // let a player press both while only one could be worn.
    expect(new Set(slots).size).toBe(PREVIEW_ITEMS.length)
    for (const kind of PREVIEW_ITEMS) {
      for (const [code, messages] of Object.entries(FLAT)) {
        expect(messages.has(`characters.items.${kind}`), `${code}:${kind}`).toBe(true)
      }
    }
  })

  it('grants nothing: the preview never touches the inventory the player owns', () => {
    // The screen dresses the figure; `inventory.ts` decides what is owned. If
    // the two were ever merged, trying a shield on would be the same act as
    // being given one.
    expect(PREVIEW_ITEMS.every(kind => (ITEM_KINDS as string[]).includes(kind))).toBe(true)
    expect(playerInventory().ownedItems()).toEqual([])
    resetPlayerInventory()
  })

  it('agrees with inventory.ts about when the weapon can be drawn', () => {
    // The panel greys its draw button with `canDraw`, and `CharacterEquipment`
    // enforces the same call. Asserted here because a UI that greys by one rule
    // while the scene obeys another is the exact failure mode both were
    // written to prevent.
    const bare: EquipmentLoadout = { ...EMPTY_LOADOUT }
    expect(canDraw(bare, 'mainHand')).toBe(false)

    const armed: EquipmentLoadout = { ...EMPTY_LOADOUT, mainHand: 'sword' }
    expect(canDraw(armed, 'mainHand')).toBe(true)

    // A one-hander plus a shield is the whole point of a shield: `mainHand` is
    // not a two-handed state, so the off hand does not block it.
    const withShield: EquipmentLoadout = { ...armed, offHand: 'shield' }
    expect(canDraw(withShield, 'mainHand')).toBe(true)

    // Sheathing is always legal, so the toggle can never strand the player.
    expect(canDraw(withShield, 'sheathed')).toBe(true)
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

describe('the backdrop plinth', () => {
  const geometry = buildPlinth()
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const index = geometry.getIndex()!

  it('winds outward', () => {
    // Divergence theorem: for a closed mesh, `Σ v0 · (v1−v0) × (v2−v0) / 6` is
    // the enclosed volume, and its **sign** is the winding. `limbMesh` upstream
    // winds inward and the body had to reverse it, which is exactly the bug this
    // exists to make impossible for a new surface — an inward-wound plinth
    // renders its own underside through the top and looks like a hole.
    let volume = 0
    const a = [0, 0, 0]
    const b = [0, 0, 0]
    const c = [0, 0, 0]
    for (let i = 0; i < index.count; i += 3) {
      for (const [slot, target] of [
        [index.getX(i), a],
        [index.getX(i + 1), b],
        [index.getX(i + 2), c]
      ] as [number, number[]][]) {
        target[0] = position.getX(slot)
        target[1] = position.getY(slot)
        target[2] = position.getZ(slot)
      }
      const ux = b[0]! - a[0]!
      const uy = b[1]! - a[1]!
      const uz = b[2]! - a[2]!
      const vx = c[0]! - a[0]!
      const vy = c[1]! - a[1]!
      const vz = c[2]! - a[2]!
      volume += (a[0]! * (uy * vz - uz * vy) + a[1]! * (uz * vx - ux * vz) + a[2]! * (ux * vy - uy * vx)) / 6
    }
    expect(volume).toBeGreaterThan(0)
    // A disc of radius 1.15 and height 0.16: π·1.15²·0.16 ≈ 0.665, a little
    // under that once the two rim bevels and the 32-gon's chords are taken off.
    // Bounded on both sides so an inside-out *and* a collapsed plinth both fail.
    expect(volume).toBeGreaterThan(0.55)
    expect(volume).toBeLessThan(0.7)
  })

  it('agrees with its own authored normals', () => {
    // A face whose geometric normal opposes the normals authored on its corners
    // is either wound backwards or shaded backwards, and the toon ramp makes
    // either one read as a black facet.
    let disagreeing = 0
    for (let i = 0; i < index.count; i += 3) {
      const i0 = index.getX(i)
      const i1 = index.getX(i + 1)
      const i2 = index.getX(i + 2)
      const ux = position.getX(i1) - position.getX(i0)
      const uy = position.getY(i1) - position.getY(i0)
      const uz = position.getZ(i1) - position.getZ(i0)
      const vx = position.getX(i2) - position.getX(i0)
      const vy = position.getY(i2) - position.getY(i0)
      const vz = position.getZ(i2) - position.getZ(i0)
      const nx = uy * vz - uz * vy
      const ny = uz * vx - ux * vz
      const nz = ux * vy - uy * vx
      const ax = (normal.getX(i0) + normal.getX(i1) + normal.getX(i2)) / 3
      const ay = (normal.getY(i0) + normal.getY(i1) + normal.getY(i2)) / 3
      const az = (normal.getZ(i0) + normal.getZ(i1) + normal.getZ(i2)) / 3
      if (nx * ax + ny * ay + nz * az <= 0) {
        disagreeing++
      }
    }
    expect(disagreeing).toBe(0)
  })

  it('carries finite, unit-length authored normals', () => {
    let bad = 0
    for (let i = 0; i < normal.count; i++) {
      const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))
      if (!Number.isFinite(length) || Math.abs(length - 1) > 1e-3) {
        bad++
      }
    }
    expect(bad).toBe(0)
    for (const name of ['position', 'normal', 'color'] as const) {
      const array = geometry.getAttribute(name).array as ArrayLike<number>
      let nonFinite = 0
      for (let i = 0; i < array.length; i++) {
        // Positive test: every comparison against NaN is false, so a range check
        // would pass on the exact bug it exists to catch.
        if (!Number.isFinite(array[i]!)) {
          nonFinite++
        }
      }
      expect(nonFinite, name).toBe(0)
    }
  })

  it('stays a backdrop rather than a budget item', () => {
    // The character is 700 triangles (GDD §4.1). A stage that costs more than
    // the thing standing on it is a stage nobody asked for.
    expect(index.count / 3).toBeLessThan(400)
  })
})
