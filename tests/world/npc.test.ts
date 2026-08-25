import { beforeEach, describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { DEFAULT_APPEARANCE, ITEM_SLOT, type ItemKind } from '@/world/characters/equipment'
import { GEAR_SEED_SPACE } from '@/world/characters/gear'
import {
  NPC_HAIR,
  PROFESSIONS,
  PROFESSION_IDS,
  isProfession,
  professionAppearance,
  professionLoadout,
  type Profession
} from '@/world/characters/professions'
import { HAIR_COLOURS, SKIN_TONES, TUNIC_COLOURS } from '@/world/characters/variants'
import { Crowd, DEFAULT_CROWD_BUDGET } from '@/world/npc/Crowd'
import {
  NpcStore,
  clearStoredSpawns,
  loadSpawns,
  resetSpawnIds,
  sanitiseSpawn,
  saveSpawns,
  spawnBreakdown
} from '@/world/npc/spawns'

/**
 * ─── The crowd ──────────────────────────────────────────────────────────────
 *
 * Three things here are worth more than the rest.
 *
 * **A person is derived, not stored.** A spawn is a profession and an integer;
 * everything about who that is falls out of the pair. If that ever stops being
 * deterministic, a level file stops describing a town and starts describing a
 * different town on every machine.
 *
 * **The outfit is the role.** A guard whose tabard rolled freely would sometimes
 * be a mage. The seed moves the person inside the clothes, never the clothes.
 *
 * **The budget is a hard ceiling.** `Crowd` is the only thing standing between a
 * five-hundred-spawn town and 3500 draw calls, so the cap is asserted directly
 * rather than trusted.
 */

const spawnAt = (profession: Profession, x: number, z: number, seed = 0) => ({
  profession,
  x,
  y: 0,
  z,
  facingDeg: 0,
  seed
})

describe('professions', () => {
  it('covers every role with a legal outfit', () => {
    for (const id of PROFESSION_IDS) {
      const outfit = PROFESSIONS[id]
      expect(outfit.label.length, id).toBeGreaterThan(0)
      expect(outfit.seeds.length, id).toBeGreaterThan(0)
      // Each garment has to belong in the slot the table puts it in, or
      // `CharacterEquipment.equip` silently refuses it and the villager stands
      // there in their underwear.
      const slots: [ItemKind | null, string][] = [
        [outfit.torso, 'torso'],
        [outfit.legs, 'legs'],
        [outfit.head, 'head'],
        [outfit.mainHand, 'mainHand'],
        [outfit.offHand, 'offHand'],
        [outfit.back, 'back']
      ]
      for (const [kind, slot] of slots) {
        if (kind !== null) {
          expect(ITEM_SLOT[kind], `${id}.${slot}`).toBe(slot)
        }
      }
      for (const seed of outfit.seeds) {
        expect(seed, id).toBeGreaterThanOrEqual(0)
        expect(seed, id).toBeLessThan(GEAR_SEED_SPACE)
      }
    }
  })

  it('produces the same person for the same two numbers, every time', () => {
    // The whole reason a spawn is a seed and not a blob. A `Math.random()`
    // anywhere in this path makes a committed level file describe a different
    // town on every reload.
    for (const id of PROFESSION_IDS) {
      for (const seed of [0, 1, 7, 41, 1000]) {
        expect(professionAppearance(id, seed), `${id}:${seed}`).toEqual(professionAppearance(id, seed))
      }
    }
  })

  it('separates people within a role', () => {
    // Eight farmers must not be one farmer eight times. Compared on the whole
    // appearance, because two who differ only in `gearSeed` are two farmers.
    const seen = new Set<string>()
    for (let seed = 0; seed < 24; seed++) {
      seen.add(JSON.stringify(professionAppearance('farmer', seed)))
    }
    expect(seen.size).toBeGreaterThan(12)
  })

  it('keeps the colourway inside the role', () => {
    // A judge free to roll its own seed is a judge who is sometimes a mage:
    // `ROBE_WAYS` holds the judge's forest at 0 and the mage's woad at 1.
    for (const id of PROFESSION_IDS) {
      const allowed = new Set(PROFESSIONS[id].seeds.map(seed => seed % GEAR_SEED_SPACE))
      for (let seed = 0; seed < 40; seed++) {
        expect(allowed.has(professionAppearance(id, seed).gearSeed), `${id}:${seed}`).toBe(true)
      }
    }
  })

  it('honours a forced sex and lets the rest vary', () => {
    for (let seed = 0; seed < 12; seed++) {
      expect(professionAppearance('housewife', seed).sex).toBe('female')
      expect(professionAppearance('maid', seed).sex).toBe('female')
    }
    // A town guard is not gendered by the word, so both must appear.
    const guards = new Set<string>()
    for (let seed = 0; seed < 24; seed++) {
      guards.add(professionAppearance('townGuard', seed).sex)
    }
    expect(guards.size).toBe(2)
  })

  it('stays inside every ramp it indexes', () => {
    for (const id of PROFESSION_IDS) {
      for (let seed = 0; seed < 30; seed++) {
        const appearance = professionAppearance(id, seed)
        expect(appearance.skinTone, id).toBeGreaterThanOrEqual(0)
        expect(appearance.skinTone, id).toBeLessThan(SKIN_TONES.length)
        expect(appearance.hairColour, id).toBeLessThan(HAIR_COLOURS.length)
        expect(appearance.tunicColour, id).toBeLessThan(TUNIC_COLOURS.length)
        expect(Number.isInteger(appearance.gearSeed), id).toBe(true)
      }
    }
  })

  it('lists every hairstyle the appearance union has', () => {
    // `NPC_HAIR` is written out rather than imported from the creator screen,
    // which drags a renderer in behind it. This is what stops the copy going
    // stale: a style added to `HairStyle` and not here is a haircut no NPC can
    // ever have, and nothing else would notice.
    const fromDefault = new Set(NPC_HAIR)
    expect(fromDefault.has(DEFAULT_APPEARANCE.hair)).toBe(true)
    expect(NPC_HAIR.length).toBe(new Set(NPC_HAIR).size)
    for (const id of PROFESSION_IDS) {
      for (const style of PROFESSIONS[id].hair ?? []) {
        expect(fromDefault.has(style), `${id}: ${style}`).toBe(true)
      }
    }
  })

  it('never spawns anybody with a weapon already drawn', () => {
    // A town square where everyone stands with a drawn sword is a battle, and
    // drawing is an animation — a spawn that started drawn would pop into the
    // guard pose on its first frame.
    for (const id of PROFESSION_IDS) {
      expect(professionLoadout(id).drawn, id).toBe('sheathed')
    }
  })

  it('recognises its own ids and nothing else', () => {
    expect(isProfession('farmer')).toBe(true)
    expect(isProfession('blacksmith')).toBe(false)
    expect(isProfession(null)).toBe(false)
    expect(isProfession('constructor')).toBe(false)
  })
})

describe('the spawn store', () => {
  beforeEach(() => {
    resetSpawnIds()
    clearStoredSpawns()
  })

  it('adds, moves, turns, reseeds and removes', () => {
    const store = new NpcStore()
    const one = store.add(spawnAt('farmer', 3, 4))
    expect(store.size).toBe(1)

    expect(store.move(one.id, 9, 1, 2)).toBe(true)
    expect(store.get(one.id)).toMatchObject({ x: 9, y: 1, z: 2 })

    expect(store.turn(one.id, 90)).toBe(true)
    expect(store.get(one.id)!.facingDeg).toBe(90)
    // Wrapped, so a spawn turned eleven times does not persist 3960 and read as
    // a bug in a diff.
    store.turn(one.id, 300)
    expect(store.get(one.id)!.facingDeg).toBe(30)
    store.turn(one.id, -60)
    expect(store.get(one.id)!.facingDeg).toBe(330)

    expect(store.reseed(one.id, 12)).toBe(true)
    expect(store.get(one.id)!.seed).toBe(12)

    expect(store.remove(one.id)).toBe(true)
    expect(store.size).toBe(0)
    expect(store.remove(one.id)).toBe(false)
  })

  it('is total: nonsense loads as a usable store', () => {
    for (const raw of [null, undefined, 7, 'nope', {}, [null], [{ profession: 5 }]]) {
      const store = new NpcStore()
      expect(() => store.restore(raw)).not.toThrow()
      expect(store.size, JSON.stringify(raw)).toBe(0)
    }
  })

  it('keeps a spawn whose profession this build does not know', () => {
    // A designer who opens a level from a branch that added `blacksmith` and
    // saves it here must not silently delete every blacksmith in the town.
    const store = new NpcStore()
    store.restore([spawnAt('farmer', 0, 0), { ...spawnAt('farmer', 1, 1), profession: 'blacksmith' }])
    expect(store.size).toBe(1)
    expect(store.orphanCount).toBe(1)
    const written = store.serialise()
    expect(written).toHaveLength(2)
    expect(written.some(entry => (entry as { profession: string }).profession === 'blacksmith')).toBe(true)
  })

  it('gives a duplicated id a fresh one rather than shadowing', () => {
    // The shape a half-finished write produces. Both are real people.
    const store = new NpcStore()
    store.restore([
      { ...spawnAt('farmer', 0, 0), id: 'npc-1' },
      { ...spawnAt('fisher', 5, 5), id: 'npc-1' }
    ])
    expect(store.size).toBe(2)
    expect(new Set(store.all().map(spawn => spawn.id)).size).toBe(2)
  })

  it('re-bases the id counter past what it loaded', () => {
    // Otherwise the next placement re-uses `npc-1` and the store has two.
    const store = new NpcStore()
    store.restore([{ ...spawnAt('farmer', 0, 0), id: 'npc-40' }])
    const next = store.add(spawnAt('fisher', 1, 1))
    expect(next.id).not.toBe('npc-40')
    expect(Number(/^npc-(\d+)$/.exec(next.id)![1])).toBeGreaterThan(40)
  })

  it('round-trips through storage', () => {
    const store = new NpcStore()
    store.add(spawnAt('mage', 2, 3, 5))
    store.add(spawnAt('knight', -4, 7, 2))
    saveSpawns(store)

    const reloaded = new NpcStore()
    reloaded.restore(loadSpawns())
    expect(reloaded.size).toBe(2)
    expect(reloaded.all().map(spawn => spawn.profession)).toEqual(['knight', 'mage'])
  })

  it('sanitises a fractional seed to an index', () => {
    // It indexes hash tables — a fractional seed makes two spawns that look
    // identical hash to different people.
    const spawn = sanitiseSpawn({ profession: 'farmer', x: 1, y: 2, z: 3, seed: 4.7 })
    expect(spawn!.seed).toBe(4)
    expect(sanitiseSpawn({ profession: 'farmer', seed: -3 })!.seed).toBe(0)
    expect(sanitiseSpawn({ profession: 'farmer', x: Number.NaN })!.x).toBe(0)
  })

  it('summarises who is in the level', () => {
    const store = new NpcStore()
    store.add(spawnAt('farmer', 0, 0))
    store.add(spawnAt('farmer', 1, 0))
    store.add(spawnAt('mage', 2, 0))
    expect(spawnBreakdown(store.view())).toEqual([
      { profession: 'mage', count: 1 },
      { profession: 'farmer', count: 2 }
    ])
  })
})

describe('the crowd budget', () => {
  /** Enough spawns that the budget is the thing being tested. */
  const town = (count: number): NpcStore => {
    const store = new NpcStore()
    for (let i = 0; i < count; i++) {
      store.add(spawnAt(PROFESSION_IDS[i % PROFESSION_IDS.length]!, i * 2, 0, i))
    }
    return store
  }

  /** Runs enough frames for the rate-limited dressing to catch up. */
  const settle = (crowd: Crowd, at: Vector3, frames = 60): void => {
    for (let i = 0; i < frames; i++) {
      crowd.update(1 / 60, at)
    }
  }

  it('never builds more figures than its budget, however many spawns there are', () => {
    // The one number standing between a five-hundred-spawn town and 3500 draws.
    const crowd = new Crowd(town(200), { budget: 6, range: 1000, outline: false, castShadow: false })
    settle(crowd, new Vector3(0, 0, 0), 200)
    expect(crowd.active).toBeLessThanOrEqual(6)
    expect(crowd.pooled).toBeLessThanOrEqual(6)
    crowd.dispose()
  })

  it('builds the nearest ones', () => {
    const store = town(40)
    const crowd = new Crowd(store, { budget: 3, range: 1000, outline: false, castShadow: false })
    settle(crowd, new Vector3(0, 0, 0), 120)
    expect(crowd.active).toBe(3)
    crowd.dispose()
  })

  it('builds nobody out of range', () => {
    const crowd = new Crowd(town(20), { budget: 8, range: 5, outline: false, castShadow: false })
    settle(crowd, new Vector3(500, 0, 500), 120)
    expect(crowd.active).toBe(0)
    crowd.dispose()
  })

  it('builds nobody at all without a camera', () => {
    // "Everyone" is not a fallback the draw budget can survive, so no camera
    // means no crowd rather than the whole town.
    const crowd = new Crowd(town(20), { budget: 8, outline: false, castShadow: false })
    for (let i = 0; i < 60; i++) {
      crowd.update(1 / 60)
    }
    expect(crowd.active).toBe(0)
    crowd.dispose()
  })

  it('grows the pool lazily and never past the budget', () => {
    // A level with three NPCs must not pay for twelve skeletons.
    const crowd = new Crowd(town(3), { budget: 10, range: 1000, outline: false, castShadow: false })
    settle(crowd, new Vector3(0, 0, 0), 120)
    expect(crowd.pooled).toBe(3)
    crowd.dispose()
  })

  it('recycles rather than growing when the player walks away', () => {
    const crowd = new Crowd(town(60), { budget: 4, range: 1000, outline: false, castShadow: false })
    settle(crowd, new Vector3(0, 0, 0), 120)
    const pooled = crowd.pooled
    settle(crowd, new Vector3(110, 0, 0), 120)
    expect(crowd.pooled).toBe(pooled)
    expect(crowd.active).toBeLessThanOrEqual(4)
    crowd.dispose()
  })

  it('ships a default budget the draw ceiling can pay for', () => {
    // ~6 draws each against GDD §5.2's 180 for the whole scene. Raising it is a
    // measurement, not a preference — see the constant.
    expect(DEFAULT_CROWD_BUDGET).toBeLessThanOrEqual(16)
  })
})
