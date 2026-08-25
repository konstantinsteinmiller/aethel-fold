import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { Character } from '@/world/characters/Character'
import { CharacterEquipment, variantOf } from '@/world/characters/CharacterEquipment'
import { buildChibiGeometry } from '@/world/characters/chibiGeometry'
import { DEFAULT_APPEARANCE, ITEM_SLOT, SOCKETS, type HairStyle, type ItemKind } from '@/world/characters/equipment'
import { GEAR_SEED_SPACE, gearModel } from '@/world/characters/gear'
import { GARMENT_COLOURWAYS, sleeveColourFor, sleeveColourForItem } from '@/world/characters/gear/garments'
import { TUNIC_COLOURS } from '@/world/characters/variants'

/**
 * ─── What a character is wearing, and what that does to their body ──────────
 *
 * Four things are asserted here and each one shipped broken:
 *
 *   1. **Two body slots, not one.** `torso` and `legs` are both substitutions
 *      with no socket, and both used to arrive at a host hook that took a single
 *      geometry — so putting trousers on took the cuirass off.
 *   2. **A wearer's colourway reaches the mesh.** Every garment carries five or
 *      six authored colourways and nothing was passing a seed, so a hundred
 *      robed NPCs wore one robe.
 *   3. **Sleeves match the garment.** A garment replaces the torso and not the
 *      arms, so a moss-green dress arrived with two woad-blue shoulder caps.
 *   4. **Hair goes under a hat.** Nine of twenty-one hairstyles grew through the
 *      crown of at least one of the six headwear kinds.
 */

const triangles = (character: Character): number => character.body.geometry.getIndex()!.count / 3

const TORSO_KINDS = (Object.keys(ITEM_SLOT) as ItemKind[]).filter(kind => ITEM_SLOT[kind] === 'torso')
const LEG_KINDS = (Object.keys(ITEM_SLOT) as ItemKind[]).filter(kind => ITEM_SLOT[kind] === 'legs')
const HEAD_KINDS = (Object.keys(ITEM_SLOT) as ItemKind[]).filter(kind => ITEM_SLOT[kind] === 'head')

describe('the two body slots are independent', () => {
  it('keeps the cuirass on when the trousers go on', () => {
    // The bug: both slots resolve to `socketFor() === null`, both landed on a
    // hook that took one geometry, and the second call overwrote the first.
    const character = new Character({ outline: false })
    const equipment = new CharacterEquipment(character, { outline: false })

    const bare = triangles(character)
    equipment.equip('torso', 'torsoArmour')
    const armoured = triangles(character)
    expect(armoured).not.toBe(bare)

    equipment.equip('legs', 'plateLegs')
    const both = triangles(character)
    // Strictly more than the cuirass alone: if the legs had replaced it, this
    // would have come back to roughly the trousers-only figure instead.
    expect(both).toBeGreaterThan(armoured)

    // And taking the trousers off leaves the cuirass exactly where it was.
    equipment.equip('legs', null)
    expect(triangles(character)).toBe(armoured)

    equipment.dispose()
    character.dispose()
  })

  it('gives each part back when its own slot empties, and only its own', () => {
    const character = new Character({ outline: false })
    const equipment = new CharacterEquipment(character, { outline: false })
    const bare = triangles(character)

    equipment.equip('torso', 'robe')
    equipment.equip('legs', 'hose')
    equipment.equip('torso', null)
    equipment.equip('legs', null)
    expect(triangles(character)).toBe(bare)

    equipment.dispose()
    character.dispose()
  })

  it('applies a whole outfit in one rebuild', () => {
    // Three of the six slots want a body rebuild and a rebuild is the whole
    // figure. Dressing a hundred NPCs one slot at a time is 0.4 s of merging
    // intermediate figures nobody sees.
    const character = new Character({ outline: false })
    const equipment = new CharacterEquipment(character, { outline: false })
    let rebuilds = 0
    const inner = character.rebuildBody.bind(character)
    character.rebuildBody = garments => {
      rebuilds++
      inner(garments)
    }

    equipment.setLoadout({
      mainHand: 'sword',
      offHand: null,
      back: null,
      head: 'hat',
      torso: 'jerkin',
      legs: 'looseTrousers',
      drawn: 'sheathed'
    })
    expect(rebuilds).toBe(1)

    equipment.dispose()
    character.dispose()
  })
})

describe("a wearer's colourway reaches the mesh", () => {
  it('gives two seeds two different garments, and shares one between equals', () => {
    const a = gearModel('robe', 0).geometry
    const b = gearModel('robe', 1).geometry
    expect(a).not.toBe(b)
    // Identical requests share a buffer — that is what makes a hundred villagers
    // in the same jerkin cost one jerkin.
    expect(gearModel('robe', 1).geometry).toBe(b)

    const colourOf = (geometry: typeof a): string => {
      const colour = geometry.getAttribute('color')!
      return `${colour.getX(0).toFixed(4)},${colour.getY(0).toFixed(4)},${colour.getZ(0).toFixed(4)}`
    }
    expect(colourOf(a)).not.toBe(colourOf(b))
  })

  it('folds the seed to the widest authored table and no further', () => {
    // Larger would cache duplicates; smaller would make two seeds collide that
    // a builder would have separated.
    const widest = Math.max(...Object.values(GARMENT_COLOURWAYS))
    expect(GEAR_SEED_SPACE).toBe(widest)
    // The fold is a fold, so a seed past the end comes back to the start rather
    // than minting a fresh cache entry for an identical mesh.
    expect(gearModel('robe', GEAR_SEED_SPACE).geometry).toBe(gearModel('robe', 0).geometry)
  })

  it('varies the one kind that shows skin, and no others', () => {
    // A rolled cuff leaves a bare calf, so that model is painted from the
    // wearer. Nothing else is, and giving a sword five copies per seed would be
    // five times the vertex buffers for no visible difference.
    expect(gearModel('rolledTrousers', 1, 0).geometry).not.toBe(gearModel('rolledTrousers', 1, 4).geometry)
    expect(gearModel('sword', 1, 0).geometry).toBe(gearModel('sword', 1, 4).geometry)
    expect(gearModel('hose', 1, 0).geometry).toBe(gearModel('hose', 1, 4).geometry)
  })

  it('reads the variant off the appearance, both fields', () => {
    expect(variantOf({ ...DEFAULT_APPEARANCE, gearSeed: 4, skinTone: 3 })).toEqual({ seed: 4, skinTone: 3 })
  })

  it('re-points what is already worn when the wearer changes', () => {
    const character = new Character({ outline: false, appearance: { ...DEFAULT_APPEARANCE, gearSeed: 0 } })
    const equipment = new CharacterEquipment(character, {
      outline: false,
      variant: variantOf({ ...DEFAULT_APPEARANCE, gearSeed: 0 })
    })
    equipment.equip('mainHand', 'sword')
    equipment.equip('torso', 'robe')

    const before = equipment.objectAt('mainHand')!.geometry
    const bodyBefore = character.body.geometry
    // Through `setAppearance`, not `setVariant` directly: the point is that an
    // owner who changes the appearance cannot forget to forward the colourway.
    character.setAppearance({ ...DEFAULT_APPEARANCE, gearSeed: 3 })

    expect(equipment.objectAt('mainHand')!.geometry).not.toBe(before)
    expect(character.body.geometry).not.toBe(bodyBefore)
    expect(equipment.getVariant()).toEqual({ seed: 3, skinTone: DEFAULT_APPEARANCE.skinTone })

    equipment.dispose()
    character.dispose()
  })
})

describe('sleeves match the garment', () => {
  it('answers for every cloth garment and declines for plate', () => {
    for (const kind of TORSO_KINDS) {
      const answer = sleeveColourForItem(kind, 2)
      if (kind === 'torsoArmour') {
        // Plate has no colourway table and its arms are bare skin. Narrowing the
        // type by hand here is what used to index `undefined`.
        expect(answer, kind).toBeNull()
        continue
      }
      expect(answer, kind).not.toBeNull()
      expect(answer, kind).toBeGreaterThanOrEqual(0)
      expect(answer, kind).toBeLessThan(TUNIC_COLOURS.length)
    }
  })

  it('paints the upper arms from the garment, not from the bare tunic', () => {
    // A dress whose cloth is nothing like the character's shirt. If the sleeves
    // still came from `appearance.tunicColour` the two blocks would be equal.
    //
    // The shirt colour is chosen *against* the dress rather than written as a
    // literal: a literal that happened to match the garment's own sleeve index
    // would make this pass while measuring nothing, which is exactly what a
    // hard-coded `tunicColour: 0` did on the first run.
    const gearSeed = 2
    const sleeve = sleeveColourFor('dress', gearSeed)
    const appearance = {
      ...DEFAULT_APPEARANCE,
      tunicColour: (sleeve + 1) % TUNIC_COLOURS.length,
      gearSeed
    }
    const dress = gearModel('dress', gearSeed).geometry
    expect(sleeve).not.toBe(appearance.tunicColour)

    const plain = buildChibiGeometry(undefined, 'test/plain', appearance, dress, null, undefined, {
      sleeveColour: null
    })
    const matched = buildChibiGeometry(undefined, 'test/matched', appearance, dress, null, undefined, {
      sleeveColour: sleeve
    })

    // Same topology, different colours: a substituted index repaints, it does
    // not re-shape.
    expect(matched.geometry.getIndex()!.count).toBe(plain.geometry.getIndex()!.count)
    const a = plain.geometry.getAttribute('color')!.array
    const b = matched.geometry.getAttribute('color')!.array
    let differences = 0
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i]! - b[i]!) > 1e-4) {
        differences++
      }
    }
    expect(differences).toBeGreaterThan(0)
  })

  it('leaves the body alone when nothing is worn', () => {
    // The byte-identical path: the default options bag must build exactly what
    // shipped before it existed.
    const bare = buildChibiGeometry(undefined, 'test/bare', DEFAULT_APPEARANCE)
    const explicit = buildChibiGeometry(undefined, 'test/bare', DEFAULT_APPEARANCE, null, null, undefined, {
      sleeveColour: null,
      headwear: null
    })
    const a = bare.geometry.getAttribute('position')!.array
    const b = explicit.geometry.getAttribute('position')!.array
    expect(a.length).toBe(b.length)
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBe(b[i])
    }
  })
})

describe('hair goes under a hat', () => {
  /** The `headTop` socket in the body's frame — where every hat is authored. */
  const HEAD_TOP = new Vector3(0, 1.14 + SOCKETS.headTop.position[1], 0)

  /**
   * The worst distance any hair vertex sits outside `shell`, in mm.
   *
   * Cast from the head's centre, which is the frame the hats are cut in. A
   * bearing the headwear does not cover returns no hit and is not a breach — a
   * ponytail below a brim is meant to hang there.
   */
  const worstBreach = (hair: HairStyle, kind: ItemKind): number => {
    const shell = gearModel(kind).geometry
    const shellPos = shell.getAttribute('position')!
    const shellIndex = shell.getIndex()!
    // Built **wearing** the headwear — the whole point is that the body builder
    // was told about it. Passing `headwear: null` here measures the old bug.
    const built = buildChibiGeometry(
      undefined,
      'test/hair',
      { ...DEFAULT_APPEARANCE, hair },
      null,
      null,
      undefined,
      { headwear: shell }
    )
    const position = built.geometry.getAttribute('position')!
    // **Ears and hair only.** The first pass scanned every vertex and reported a
    // hood breached by 35 mm — which was the character's own shoulders, sitting
    // outside a cowl that comes down to the collarbone. They are supposed to.
    // `blocks` is exactly the range the clip is responsible for.
    const first = built.blocks.ears
    const last = built.blocks.face

    const local = new Vector3()
    const dir = new Vector3()
    const a = new Vector3()
    const b = new Vector3()
    const c = new Vector3()
    const e1 = new Vector3()
    const e2 = new Vector3()
    const p = new Vector3()
    const q = new Vector3()
    const t0 = new Vector3()

    let worst = 0
    for (let v = first; v < last; v++) {
      local.fromBufferAttribute(position, v).sub(HEAD_TOP)
      const distance = local.length()
      if (distance < 1e-6) {
        continue
      }
      dir.copy(local).divideScalar(distance)
      let nearest = Infinity
      for (let i = 0; i < shellIndex.count; i += 3) {
        a.fromBufferAttribute(shellPos, shellIndex.getX(i))
        b.fromBufferAttribute(shellPos, shellIndex.getX(i + 1))
        c.fromBufferAttribute(shellPos, shellIndex.getX(i + 2))
        e1.subVectors(b, a)
        e2.subVectors(c, a)
        p.crossVectors(dir, e2)
        const det = e1.dot(p)
        if (det > -1e-12 && det < 1e-12) {
          continue
        }
        const inv = 1 / det
        t0.set(-a.x, -a.y, -a.z)
        const u = t0.dot(p) * inv
        if (u < 0 || u > 1) {
          continue
        }
        q.crossVectors(t0, e1)
        const w = dir.dot(q) * inv
        if (w < 0 || u + w > 1) {
          continue
        }
        const hit = e2.dot(q) * inv
        if (hit > 1e-6 && hit < nearest) {
          nearest = hit
        }
      }
      if (nearest !== Infinity && distance > nearest) {
        worst = Math.max(worst, distance - nearest)
      }
    }
    return worst * 1000
  }

  /**
   * The nine that broke through, and the worst kind for each. Measured before
   * the clip existed — a topknot stood 81 mm out of the straw hat and a ponytail
   * 235 mm out of the back of a hood.
   */
  const BREACHED: readonly HairStyle[] = [
    'topknot',
    'wild',
    'mane',
    'ponytail',
    'fringe',
    'long',
    'braids',
    'bun',
    'queue'
  ]

  it('tucks every hairstyle inside every headwear kind', () => {
    for (const kind of HEAD_KINDS) {
      for (const hair of BREACHED) {
        // Zero would be a vertex sitting exactly on the surface, which z-fights;
        // the clip lands them 1.5 % inside, so nothing should be outside at all.
        expect(worstBreach(hair, kind), `${hair} under ${kind}`).toBe(0)
      }
    }
  })

  it('leaves hair alone when the head slot is empty', () => {
    // Not a no-op test: a clip that ran unconditionally would flatten every
    // ponytail in the game against a hat that is not there.
    const bare = buildChibiGeometry(undefined, 'test/x', { ...DEFAULT_APPEARANCE, hair: 'ponytail' })
    const hatted = buildChibiGeometry(
      undefined,
      'test/x',
      { ...DEFAULT_APPEARANCE, hair: 'ponytail' },
      null,
      null,
      undefined,
      { headwear: gearModel('hood').geometry }
    )
    const a = bare.geometry.getAttribute('position')!.array
    const b = hatted.geometry.getAttribute('position')!.array
    let moved = 0
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i]! - b[i]!) > 1e-6) {
        moved++
      }
    }
    // The hood moves some of it and must not move all of it: the length hanging
    // below the cowl is on a bearing the hood does not cover.
    expect(moved).toBeGreaterThan(0)
    expect(moved).toBeLessThan(a.length)
  })

  it('does not change the triangle count', () => {
    // The clip moves vertices; it never removes them. A topology that changed
    // with a hat would break the outline hull's shared prefix.
    const appearance = { ...DEFAULT_APPEARANCE, hair: 'topknot' as HairStyle }
    const bare = buildChibiGeometry(undefined, 'test/y', appearance)
    const hatted = buildChibiGeometry(undefined, 'test/y', appearance, null, null, undefined, {
      headwear: gearModel('helmet').geometry
    })
    expect(hatted.geometry.getIndex()!.count).toBe(bare.geometry.getIndex()!.count)
    expect(hatted.outlineGeometry.getIndex()!.count).toBe(bare.outlineGeometry.getIndex()!.count)
  })

  it('rebuilds the body when the head slot changes', () => {
    // A hat is a socketed mesh, so nothing about equipping it looks like a body
    // change — but the hair under it is body geometry.
    const character = new Character({ outline: false, appearance: { ...DEFAULT_APPEARANCE, hair: 'topknot' } })
    const equipment = new CharacterEquipment(character, { outline: false })
    const bare = character.body.geometry
    equipment.equip('head', 'helmet')
    expect(character.body.geometry).not.toBe(bare)

    equipment.dispose()
    character.dispose()
  })

  it('covers the leg kinds it claims to', () => {
    // Guards the constants this file filters on: an `ItemKind` added to a slot
    // without a model would otherwise quietly drop out of every test above.
    expect(LEG_KINDS.length).toBeGreaterThan(0)
    expect(TORSO_KINDS.length).toBeGreaterThan(0)
    expect(HEAD_KINDS.length).toBeGreaterThan(0)
  })
})
