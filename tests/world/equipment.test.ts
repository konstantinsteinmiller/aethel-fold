import { describe, expect, it, beforeEach } from 'vitest'
import { BufferAttribute, BufferGeometry, Color, Matrix4, Quaternion, Ray, SkinnedMesh, Triangle, Vector3 } from 'three'
import { Character } from '@/world/characters/Character'
import { transitionSeconds } from '@/world/characters/combatPoses'
import {
  CharacterEquipment,
  buildPlaceholderItem,
  disposeGearCache,
  registerItemGeometry,
  type EquipmentHost
} from '@/world/characters/CharacterEquipment'
import {
  DEFAULT_APPEARANCE,
  DRAWN_SOCKET,
  EQUIPMENT_BUDGET,
  EQUIP_SLOTS,
  ITEM_SLOT,
  SOCKETS,
  STOW_SOCKET,
  type DrawnState,
  type HairStyle,
  type ItemKind
} from '@/world/characters/equipment'
import {
  DRAWN_STATES,
  ITEM_KINDS,
  PlayerInventory,
  canDraw,
  clearStoredInventory,
  drawFault,
  emptyLoadout,
  loadInventory,
  sanitiseInventory,
  saveInventory,
  socketFor
} from '@/world/characters/inventory'
import {
  CHIBI_ARMOURED_BUDGET,
  buildChibiGeometry,
  skinTorsoGeometry,
  torsoChestWeight
} from '@/world/characters/chibiGeometry'
import { gearModel } from '@/world/characters/gear'
import { limbMesh } from '@/world/characters/limb'
import { RUN, WALK, applyBank, applyGait, applyJump } from '@/world/characters/poses'
import { buildSkeleton } from '@/world/characters/skeleton'
import { BONE_NAMES, boneDefinition } from '@/world/characters/rig'
import { BUILDS, HAIRLINE } from '@/world/characters/variants'

/**
 * ─── Equipment: state, sockets, and the torso decision ──────────────────────
 *
 * None of this needs WebGL. Sockets are arithmetic on the bind pose, the drawn
 * state is a state machine, and the torso-armour question — overlay or rigid —
 * is answered by skinning the body's own vertices two ways and measuring the
 * gap. That last one is the reason this file imports the pose code: the number
 * in `CharacterEquipment.ts`'s header comment is produced here, not asserted from memory.
 */

const hostFor = (character: Character): EquipmentHost => character

/**
 * The bare figure's triangle count, for the substitution arithmetic below.
 *
 * Written as a constant with the breakdown attached rather than as the literal
 * `692` it used to be, because that literal moved twice in one week and both
 * times the failure read as "the armour is wrong". 956 = 654 body + 192 hands +
 * 60 ears + 50 face; `chibi.test.ts` owns the split and asserts it.
 */
const BARE_CHIBI_TRIANGLES = 956

/** Every bone's world matrix, current for whatever pose was just applied. */
const posed = (): ReturnType<typeof buildSkeleton> => {
  const built = buildSkeleton()
  return built
}

describe('socket resolution', () => {
  it('resolves a socket for every item kind, stowed and drawn', () => {
    // The table is walked rather than spot-checked: a kind added to
    // `equipment.ts` without a stow socket resolves to null and silently never
    // renders, which looks exactly like "the mesh is not ready yet".
    for (const kind of ITEM_KINDS) {
      const slot = ITEM_SLOT[kind]
      const loadout = { ...emptyLoadout(), [slot]: kind }

      const stowed = socketFor(loadout, slot, 'sheathed')
      expect(stowed, `${kind} stowed`).toBe(STOW_SOCKET[kind])

      // Which drawn state puts this kind in hand — null for the two that are
      // never held.
      const drawnState: DrawnState | null =
        kind === 'sword'
          ? 'mainHand'
          : kind === 'greatsword'
            ? 'twoHand'
            : kind === 'bow'
              ? 'bow'
              : kind === 'crossbow'
                ? 'crossbow'
                : null
      if (drawnState) {
        expect(socketFor(loadout, slot, drawnState), `${kind} drawn`).toBe(DRAWN_SOCKET[kind])
      }
    }
  })

  it('leaves the shield in the left hand in both conditions', () => {
    const loadout = { ...emptyLoadout(), offHand: 'shield' as ItemKind }
    for (const state of DRAWN_STATES) {
      expect(socketFor(loadout, 'offHand', state)).toBe('handL')
    }
  })

  it('gives torso armour no socket at all — it is a body swap', () => {
    const loadout = { ...emptyLoadout(), torso: 'torsoArmour' as ItemKind }
    expect(STOW_SOCKET.torsoArmour).toBeNull()
    expect(DRAWN_SOCKET.torsoArmour).toBeNull()
    expect(socketFor(loadout, 'torso', 'sheathed')).toBeNull()
  })

  it('resolves nothing for an empty slot', () => {
    for (const slot of EQUIP_SLOTS) {
      expect(socketFor(emptyLoadout(), slot, 'sheathed')).toBeNull()
    }
  })
})

describe('the right hip is at negative X', () => {
  /**
   * The rig fact this whole feature trips over: `shoulder.L` is at **+**0.09, so
   * the character's right side is **−**X. A sword hung on the wrong side is
   * symmetric enough to look deliberate, so it is asserted three ways: against
   * the socket table's own number, against a bone that is unambiguously on the
   * right, and against the character's right *after a turn*, where a sign error
   * that happens to cancel in bind pose cannot hide.
   */
  it('puts the sheathed sword on the same side as the right thigh', () => {
    expect(SOCKETS.hipR.position[0]).toBeLessThan(0)
    expect(boneDefinition('thigh.R').head[0]).toBeLessThan(0)
    expect(boneDefinition('shoulder.L').head[0]).toBeGreaterThan(0)
    expect(Math.sign(SOCKETS.hipR.position[0])).toBe(Math.sign(boneDefinition('thigh.R').head[0]))
  })

  it('hangs the sword off the right hip in world space, at any facing', () => {
    const character = new Character({ outline: false })
    const equipment = new CharacterEquipment(hostFor(character), { outline: false })
    equipment.equip('mainHand', 'sword')

    const hip = new Vector3()
    const item = new Vector3()
    const right = new Vector3()

    for (const yaw of [0, Math.PI * 0.5, Math.PI, -Math.PI * 0.75]) {
      character.setFacing(yaw)
      character.group.updateMatrixWorld(true)

      const object = equipment.objectAt('mainHand')!
      object.getWorldPosition(item)
      character.bone('hips')!.getWorldPosition(hip)
      // Local −X is the character's right; rotate it by the yaw.
      right.set(-Math.cos(yaw), 0, Math.sin(yaw))

      const offset = item.clone().sub(hip)
      expect(offset.dot(right), `yaw ${yaw}`).toBeGreaterThan(0.1)
    }

    equipment.dispose()
    character.dispose()
  })

  it('reads the sheathed blade as hanging down and back, not standing up', () => {
    // The item frame: the grip is the origin and the blade runs −Y. `hipR`'s
    // rotation only makes sense under that reading — applied to +Y it stands the
    // sword out of the waist. Checked as a direction so it survives a retune of
    // the numbers.
    const character = new Character({ outline: false })
    const equipment = new CharacterEquipment(hostFor(character), { outline: false })
    equipment.equip('mainHand', 'sword')
    character.group.updateMatrixWorld(true)

    const object = equipment.objectAt('mainHand')!
    const orientation = new Quaternion()
    object.getWorldQuaternion(orientation)
    const blade = new Vector3(0, -1, 0).applyQuaternion(orientation)
    expect(blade.y).toBeLessThan(-0.8)
    expect(blade.x).toBeLessThan(0)
    expect(blade.z).toBeLessThan(0)

    equipment.dispose()
    character.dispose()
  })
})

describe('drawn-state legality', () => {
  const withBack = (kind: ItemKind) => ({ ...emptyLoadout(), back: kind })

  it('allows sheathing from anything', () => {
    for (const kind of ITEM_KINDS) {
      expect(canDraw({ ...emptyLoadout(), [ITEM_SLOT[kind]]: kind }, 'sheathed')).toBe(true)
    }
    expect(canDraw(emptyLoadout(), 'sheathed')).toBe(true)
  })

  it('refuses to draw a weapon that is not equipped', () => {
    for (const state of DRAWN_STATES) {
      if (state === 'sheathed') {
        continue
      }
      expect(drawFault(emptyLoadout(), state)).toBe('itemNotEquipped')
    }
  })

  it('refuses to draw the wrong weapon out of the back slot', () => {
    expect(drawFault(withBack('greatsword'), 'bow')).toBe('itemNotEquipped')
    expect(drawFault(withBack('bow'), 'twoHand')).toBe('itemNotEquipped')
    expect(drawFault(withBack('crossbow'), 'twoHand')).toBe('itemNotEquipped')
    expect(drawFault(withBack('greatsword'), 'twoHand')).toBeNull()
  })

  it('will not have a two-hander and a shield out at once', () => {
    const both = { ...emptyLoadout(), back: 'greatsword' as ItemKind, offHand: 'shield' as ItemKind }
    expect(drawFault(both, 'twoHand')).toBe('offHandOccupied')
    expect(drawFault(both, 'bow')).toBe('itemNotEquipped')
    // A one-hander alongside a shield is the whole point of a shield.
    const swordAndBoard = { ...emptyLoadout(), mainHand: 'sword' as ItemKind, offHand: 'shield' as ItemKind }
    expect(drawFault(swordAndBoard, 'mainHand')).toBeNull()
  })

  it('counts the crossbow as two-handed even though it hangs off the right hand', () => {
    expect(DRAWN_SOCKET.crossbow).toBe('handR')
    const both = { ...emptyLoadout(), back: 'crossbow' as ItemKind, offHand: 'shield' as ItemKind }
    expect(drawFault(both, 'crossbow')).toBe('offHandOccupied')
  })
})

describe('the inventory model', () => {
  beforeEach(() => {
    clearStoredInventory()
  })

  it('only lets an item into the slot ITEM_SLOT allows', () => {
    const inventory = new PlayerInventory()
    for (const kind of ITEM_KINDS) {
      inventory.acquire(kind)
    }
    for (const kind of ITEM_KINDS) {
      for (const slot of EQUIP_SLOTS) {
        const applied = inventory.equip(slot, kind)
        expect(applied, `${kind} in ${slot}`).toBe(ITEM_SLOT[kind] === slot)
        if (applied) {
          inventory.equip(slot, null)
        }
      }
    }
  })

  it('refuses to equip what the character does not own', () => {
    const inventory = new PlayerInventory()
    expect(inventory.equipFaultFor('mainHand', 'sword')).toBe('notOwned')
    expect(inventory.equip('mainHand', 'sword')).toBe(false)
    inventory.acquire('sword')
    expect(inventory.equip('mainHand', 'sword')).toBe(true)
  })

  it('sheathes when the drawn weapon is unequipped or discarded', () => {
    const inventory = new PlayerInventory()
    inventory.acquire('greatsword')
    inventory.equip('back', 'greatsword')
    expect(inventory.setDrawn('twoHand')).toBe(true)
    inventory.equip('back', null)
    expect(inventory.loadout().drawn).toBe('sheathed')

    inventory.equip('back', 'greatsword')
    inventory.setDrawn('twoHand')
    inventory.discard('greatsword')
    expect(inventory.loadout().drawn).toBe('sheathed')
    expect(inventory.loadout().back).toBeNull()
  })

  it('sheathes when a shield is equipped under a two-handed draw', () => {
    const inventory = new PlayerInventory()
    inventory.acquire('greatsword')
    inventory.acquire('shield')
    inventory.equip('back', 'greatsword')
    inventory.setDrawn('twoHand')
    inventory.equip('offHand', 'shield')
    expect(inventory.loadout().drawn).toBe('sheathed')
  })

  it('hands out copies, never the live loadout', () => {
    const inventory = new PlayerInventory()
    inventory.acquire('sword')
    inventory.equip('mainHand', 'sword')

    const first = inventory.loadout()
    first.mainHand = null
    first.drawn = 'twoHand'
    expect(inventory.loadout().mainHand).toBe('sword')
    expect(inventory.loadout().drawn).toBe('sheathed')
    expect(inventory.loadout()).not.toBe(first)

    const snapshot = inventory.snapshot()
    snapshot.owned.push('greatsword')
    expect(inventory.ownedItems()).toEqual(['sword'])
  })

  it('bumps a revision the UI can poll instead of holding the model reactively', () => {
    const inventory = new PlayerInventory()
    const start = inventory.revision
    inventory.acquire('hat')
    inventory.equip('head', 'hat')
    expect(inventory.revision).toBeGreaterThan(start)
    const settled = inventory.revision
    inventory.equip('head', 'hat')
    expect(inventory.revision).toBe(settled)
  })

  it('lists only owned candidates for a slot', () => {
    const inventory = new PlayerInventory()
    inventory.acquire('sword')
    inventory.acquire('greatsword')
    expect(inventory.candidatesFor('mainHand')).toEqual(['sword'])
    expect(inventory.candidatesFor('back')).toEqual(['greatsword'])
    expect(inventory.candidatesFor('head')).toEqual([])
  })
})

describe('inventory storage', () => {
  beforeEach(() => {
    clearStoredInventory()
  })

  it('round-trips through its own localStorage key', () => {
    const inventory = new PlayerInventory()
    inventory.acquire('sword')
    inventory.acquire('shield')
    inventory.acquire('hat')
    inventory.equip('mainHand', 'sword')
    inventory.equip('offHand', 'shield')
    inventory.equip('head', 'hat')
    inventory.setDrawn('mainHand')
    inventory.save()

    const restored = new PlayerInventory(loadInventory())
    expect(restored.loadout()).toEqual(inventory.loadout())
    expect(restored.ownedItems().sort()).toEqual(inventory.ownedItems().sort())
  })

  it('does not write to any other editor key', () => {
    const inventory = new PlayerInventory()
    inventory.acquire('sword')
    inventory.save()
    for (const foreign of ['world_editor_mode', 'world.scatterOverrides.v1', 'world.level.placements']) {
      expect(localStorage.getItem(foreign)).toBeNull()
    }
    expect(localStorage.getItem('world.characterInventory.v1')).not.toBeNull()
  })

  it('loads empty from a malformed store rather than throwing', () => {
    for (const junk of ['', '{', 'null', '[]', '"sword"', '{"owned":"sword"}', '{"loadout":42}']) {
      localStorage.setItem('world.characterInventory.v1', junk)
      const loaded = loadInventory()
      expect(loaded.owned).toEqual([])
      expect(loaded.loadout).toEqual(emptyLoadout())
    }
  })

  it('drops gear that is not owned, in the wrong slot, or an unknown kind', () => {
    saveInventory({
      owned: ['sword', 'nonsense' as ItemKind],
      // A greatsword in the main hand, a sword the player owns, a hat they do not.
      loadout: { ...emptyLoadout(), mainHand: 'sword', back: 'sword', head: 'hat', drawn: 'twoHand' }
    })
    const loaded = loadInventory()
    expect(loaded.owned).toEqual(['sword'])
    expect(loaded.loadout.mainHand).toBe('sword')
    expect(loaded.loadout.back).toBeNull()
    expect(loaded.loadout.head).toBeNull()
    // `twoHand` has nothing to draw once the back slot is dropped.
    expect(loaded.loadout.drawn).toBe('sheathed')
  })

  it('survives storage being unavailable', () => {
    const original = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked, as in a sandboxed portal iframe')
      }
    })
    expect(() => loadInventory()).not.toThrow()
    expect(() => saveInventory({ owned: [], loadout: emptyLoadout() })).not.toThrow()
    expect(loadInventory().owned).toEqual([])
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original, writable: true })
  })

  it('sanitises an arbitrary object', () => {
    expect(sanitiseInventory(undefined).loadout).toEqual(emptyLoadout())
    expect(sanitiseInventory({ owned: [1, 2, 3] }).owned).toEqual([])
  })
})

describe('attachment', () => {
  beforeEach(() => {
    disposeGearCache()
  })

  it('parents an item under the bone, never under the character group', () => {
    const character = new Character({ outline: false })
    const equipment = new CharacterEquipment(hostFor(character), { outline: false })
    equipment.equip('mainHand', 'sword')

    const object = equipment.objectAt('mainHand')!
    expect(object.parent).toBe(character.bone('hips'))
    // The failure this guards: parented to the group, an item stands in the
    // bind pose while the character animates out from under it.
    expect(object.parent).not.toBe(character.group)

    equipment.setDrawn('mainHand')
    equipment.update(1)
    expect(equipment.objectAt('mainHand')!.parent).toBe(character.bone('hand.R'))

    equipment.dispose()
    character.dispose()
  })

  it('does not skin a held item', () => {
    // Skinning a sword would run it through the body's joint blend, so the tip
    // would lag the hilt on every wrist turn — and it would compile a second
    // program for a mesh that needs none.
    const character = new Character({ outline: false })
    const equipment = new CharacterEquipment(hostFor(character), { outline: false })
    equipment.equip('mainHand', 'sword')
    const object = equipment.objectAt('mainHand')!
    expect((object as SkinnedMesh).isSkinnedMesh).toBeFalsy()
    expect((object as SkinnedMesh & { geometry: BufferGeometry }).geometry.getAttribute('skinWeight')).toBeUndefined()
    equipment.dispose()
    character.dispose()
  })

  it('moves an item between sockets when the drawn state changes', () => {
    const character = new Character({ outline: false })
    const equipment = new CharacterEquipment(hostFor(character), { outline: false })
    equipment.equip('back', 'greatsword')
    expect(equipment.socketAt('back')).toBe('backOver')

    // Advance by the transition's *own* length rather than a fixed second. With
    // no timing options the clip length is derived per weapon from
    // `combatPoses`, and a greatsword sheathe is 2.15 s — a hardcoded `update(1)`
    // stops 47 % in, before the handoff, and the item is still in the hand.
    equipment.setDrawn('twoHand')
    equipment.update(transitionSeconds('greatsword', 'draw'))
    expect(equipment.socketAt('back')).toBe('handR')

    equipment.setDrawn('sheathed')
    equipment.update(transitionSeconds('greatsword', 'sheathe'))
    expect(equipment.socketAt('back')).toBe('backOver')

    equipment.dispose()
    character.dispose()
  })

  it('ignores an item that cannot occupy the slot', () => {
    const character = new Character({ outline: false })
    const equipment = new CharacterEquipment(hostFor(character), { outline: false })
    equipment.equip('back', 'sword')
    expect(equipment.itemAt('back')).toBeNull()
    expect(equipment.objectAt('back')).toBeNull()
    equipment.dispose()
    character.dispose()
  })

  it('ignores an illegal draw and keeps the state it had', () => {
    const character = new Character({ outline: false })
    const equipment = new CharacterEquipment(hostFor(character), { outline: false })
    equipment.setDrawn('twoHand')
    expect(equipment.drawn).toBe('sheathed')
    expect(equipment.drawing).toBe(false)
    equipment.dispose()
    character.dispose()
  })

  it('sheathes immediately when the drawn weapon is unequipped', () => {
    const character = new Character({ outline: false })
    const equipment = new CharacterEquipment(hostFor(character), { outline: false })
    equipment.equip('back', 'greatsword')
    equipment.setDrawn('twoHand')
    equipment.update(1)
    expect(equipment.socketAt('back')).toBe('handR')

    equipment.equip('back', null)
    expect(equipment.drawn).toBe('sheathed')
    expect(equipment.drawing).toBe(false)
    equipment.equip('back', 'bow')
    // Re-equipping lands stowed, not in the hand it was drawn from.
    expect(equipment.socketAt('back')).toBe('backFlat')

    equipment.dispose()
    character.dispose()
  })

  it('hands the loadout out as a copy', () => {
    const character = new Character({ outline: false })
    const equipment = new CharacterEquipment(hostFor(character), { outline: false })
    equipment.equip('mainHand', 'sword')
    const copy = equipment.loadout()
    copy.mainHand = null
    copy.drawn = 'bow'
    expect(equipment.loadout().mainHand).toBe('sword')
    expect(equipment.loadout().drawn).toBe('sheathed')
    expect(equipment.loadout()).not.toBe(copy)
    equipment.dispose()
    character.dispose()
  })

  it('detaches everything on dispose, and gives the torso back', () => {
    const character = new Character({ outline: false })
    const equipment = new CharacterEquipment(hostFor(character))
    equipment.equip('mainHand', 'sword')
    equipment.equip('head', 'hat')
    equipment.equip('torso', 'torsoArmour')
    const sword = equipment.objectAt('mainHand')!
    // Torso armour has no scene object to detach — it is in the body's own
    // geometry — so the thing that has to be undone is the substitution itself.
    expect(equipment.objectAt('torso')).toBeNull()
    const armoured = character.body.geometry.getIndex()!.count
    equipment.dispose()
    expect(sword.parent).toBeNull()
    expect(character.body.geometry.getIndex()!.count).toBeLessThan(armoured)
    // The bare figure. 956 since hands, ears and brows landed — see
    // `CHIBI_BUDGET` for the breakdown.
    expect(character.body.geometry.getIndex()!.count / 3).toBe(BARE_CHIBI_TRIANGLES)
    character.dispose()
  })

  it('drives off a structural host, with no Character at all', () => {
    // The reason `EquipmentHost` is structural: a monster rig that is not a
    // `Character` wears gear by exposing three members, and this test needs no
    // body, no material and no outline.
    const { skeleton, root, byName } = buildSkeleton()
    const body = new SkinnedMesh(new BufferGeometry())
    body.add(root)
    body.bind(skeleton)
    const host: EquipmentHost = {
      bone: name => byName.get(name) ?? null,
      group: body,
      body
    }
    const equipment = new CharacterEquipment(host, { outline: false })
    equipment.equip('offHand', 'shield')
    expect(equipment.objectAt('offHand')!.parent).toBe(byName.get('hand.L'))
    equipment.dispose()
  })

  it('accepts a registered mesh in place of the placeholder', () => {
    const geometry = buildPlaceholderItem('sword')
    registerItemGeometry('sword', () => geometry)
    const character = new Character({ outline: false })
    const equipment = new CharacterEquipment(hostFor(character), { outline: false })
    equipment.equip('mainHand', 'sword')
    expect((equipment.objectAt('mainHand') as SkinnedMesh).geometry).toBe(geometry)
    equipment.dispose()
    character.dispose()
    disposeGearCache()
  })
})

describe('the draw transition', () => {
  it('re-parents at the handoff, not at the request', () => {
    // The split the animation layer depends on: this owns *where the mesh is*,
    // it owns the pose, and the swap has to land on the frame the hand reaches
    // the hilt — not when the button was pressed.
    const character = new Character({ outline: false })
    const equipment = new CharacterEquipment(hostFor(character), { outline: false, drawDuration: 0.4, handoff: 0.5 })
    equipment.equip('mainHand', 'sword')

    const seen: [DrawnState, DrawnState][] = []
    equipment.onDrawChange = (from, to) => {
      seen.push([from, to])
    }

    equipment.setDrawn('mainHand')
    expect(seen).toEqual([['sheathed', 'mainHand']])
    expect(equipment.drawn).toBe('mainHand')
    expect(equipment.effectiveDrawn).toBe('sheathed')
    expect(equipment.socketAt('mainHand')).toBe('hipR')

    equipment.update(0.1)
    expect(equipment.drawProgress).toBeCloseTo(0.25, 6)
    expect(equipment.socketAt('mainHand')).toBe('hipR')

    equipment.update(0.12)
    expect(equipment.drawProgress).toBeGreaterThanOrEqual(0.5)
    expect(equipment.effectiveDrawn).toBe('mainHand')
    expect(equipment.socketAt('mainHand')).toBe('handR')

    equipment.update(1)
    expect(equipment.drawProgress).toBe(1)
    expect(equipment.drawing).toBe(false)

    equipment.dispose()
    character.dispose()
  })

  it('settles instantly when the duration is zero', () => {
    const character = new Character({ outline: false })
    const equipment = new CharacterEquipment(hostFor(character), { outline: false, drawDuration: 0 })
    equipment.equip('mainHand', 'sword')
    equipment.setDrawn('mainHand')
    expect(equipment.drawing).toBe(false)
    expect(equipment.socketAt('mainHand')).toBe('handR')
    equipment.dispose()
    character.dispose()
  })

  it('does nothing per frame once settled', () => {
    const character = new Character({ outline: false })
    const equipment = new CharacterEquipment(hostFor(character), { outline: false })
    equipment.equip('mainHand', 'sword')
    const object = equipment.objectAt('mainHand')!
    const parent = object.parent
    const matrix = object.matrix.clone()
    for (let i = 0; i < 120; i++) {
      equipment.update(1 / 60)
    }
    expect(object.parent).toBe(parent)
    expect(object.matrix.elements).toEqual(matrix.elements)
    expect(equipment.drawProgress).toBe(1)
    equipment.dispose()
    character.dispose()
  })

  it('applies a whole loadout without animating a draw', () => {
    const character = new Character({ outline: false })
    const equipment = new CharacterEquipment(hostFor(character), { outline: false })
    equipment.setLoadout({ ...emptyLoadout(), back: 'bow', head: 'hat', drawn: 'bow' })
    expect(equipment.drawing).toBe(false)
    expect(equipment.socketAt('back')).toBe('handL')
    expect(equipment.socketAt('head')).toBe('headTop')

    // An illegal drawn state in the loaded data lands sheathed rather than
    // refusing to load.
    equipment.setLoadout({ ...emptyLoadout(), drawn: 'twoHand' })
    expect(equipment.drawn).toBe('sheathed')

    equipment.dispose()
    character.dispose()
  })
})

describe('torso armour replaces the torso', () => {
  const HIPS = BONE_NAMES.indexOf('hips')
  const CHEST = BONE_NAMES.indexOf('chest')
  const NECK = BONE_NAMES.indexOf('neck')
  const THIGH_L = BONE_NAMES.indexOf('thigh.L')
  const THIGH_R = BONE_NAMES.indexOf('thigh.R')

  const armourGeometry = (): BufferGeometry => gearModel('torsoArmour').geometry

  /** The unarmoured figure, and the same figure with the armour substituted in. */
  const plain = (): BufferGeometry => buildChibiGeometry().geometry
  const armoured = (): BufferGeometry =>
    buildChibiGeometry(undefined, 'chibi/armoured', undefined, armourGeometry()).geometry

  /** Torso vertices of the body — the only part whose primary bone is the hips. */
  const torsoVertices = (): { position: Vector3; weight: number }[] => {
    const geometry = plain()
    const position = geometry.getAttribute('position')
    const skinIndex = geometry.getAttribute('skinIndex')
    const skinWeight = geometry.getAttribute('skinWeight')
    const out: { position: Vector3; weight: number }[] = []
    for (let i = 0; i < position.count; i++) {
      if (skinIndex.getX(i) !== HIPS) {
        continue
      }
      out.push({
        position: new Vector3(position.getX(i), position.getY(i), position.getZ(i)),
        // Weight on the chest — slot 1 is the blend partner.
        weight: skinIndex.getY(i) === CHEST ? skinWeight.getY(i) : 0
      })
    }
    return out
  }

  /** Linear blend skinning, by hand, so both candidates go through one path. */
  const skinPoint = (
    built: ReturnType<typeof buildSkeleton>,
    point: Vector3,
    chestWeight: number,
    out = new Vector3()
  ): Vector3 => {
    const matrix = new Matrix4()
    const accumulated = new Vector3(0, 0, 0)
    const scratch = new Vector3()
    const contribute = (index: number, weight: number): void => {
      if (weight === 0) {
        return
      }
      matrix.multiplyMatrices(built.skeleton.bones[index]!.matrixWorld, built.skeleton.boneInverses[index]!)
      scratch.copy(point).applyMatrix4(matrix).multiplyScalar(weight)
      accumulated.add(scratch)
    }
    contribute(HIPS, 1 - chestWeight)
    contribute(CHEST, chestWeight)
    return out.copy(accumulated)
  }

  /** The worst pose the torso sees: a full run, at the phase of peak twist, banking. */
  const worstPoses = (): ReturnType<typeof buildSkeleton>[] => {
    const list: ReturnType<typeof buildSkeleton>[] = []
    for (let step = 0; step < 16; step++) {
      for (const bank of [-0.35, 0, 0.35]) {
        const built = posed()
        applyGait(built.byName, step / 16, WALK, RUN, 1)
        applyBank(built.byName, bank)
        built.root.updateMatrixWorld(true)
        list.push(built)
      }
    }
    return list
  }

  /**
   * The body's torso vertices, moved into the hips-joint frame the gear module
   * authors armour in (`gear/index.ts`): y = 0 at the hips joint.
   */
  const probeGeometry = (vertices: { position: Vector3 }[]): BufferGeometry => {
    const hips = boneDefinition('hips').head
    const positions = new Float32Array(vertices.length * 3)
    vertices.forEach((vertex, i) => {
      positions[i * 3] = vertex.position.x - hips[0]
      positions[i * 3 + 1] = vertex.position.y - hips[1]
      positions[i * 3 + 2] = vertex.position.z - hips[2]
    })
    const probe = new BufferGeometry()
    probe.setAttribute('position', new BufferAttribute(positions, 3))
    return probe
  }

  it('derives exactly the skin weights the body carries', () => {
    // `chibiGeometry.ts` now exports the rule, so the coupling is an import
    // rather than a comment asking two constants to stay equal. This is still
    // the functional guard: skinning the body's *own* torso vertices with the
    // shared rule has to reproduce the weights the body geometry carries.
    const vertices = torsoVertices()
    expect(vertices.length).toBeGreaterThan(20)

    const skinned = skinTorsoGeometry(probeGeometry(vertices))
    const index = skinned.getAttribute('skinIndex')
    const weight = skinned.getAttribute('skinWeight')

    for (let i = 0; i < vertices.length; i++) {
      expect(index.getX(i)).toBe(HIPS)
      const chestWeight = index.getY(i) === CHEST ? weight.getY(i) : 0
      expect(chestWeight, `vertex ${i} at y=${vertices[i]!.position.y}`).toBeCloseTo(vertices[i]!.weight, 6)
    }
  })

  it('translates the armour out of the hips frame into bind-pose world space', () => {
    // A skeleton's inverse binds are world matrices, so armour left in the hips
    // frame skins from the wrong place — and it does not error, it just takes
    // weight 1 on the hips and swings the collar with the pelvis.
    const vertices = torsoVertices()
    const hips = boneDefinition('hips').head
    const source = probeGeometry(vertices)
    const skinned = skinTorsoGeometry(source)
    const before = source.getAttribute('position')
    const after = skinned.getAttribute('position')
    expect(after).not.toBe(before)
    for (let i = 0; i < after.count; i++) {
      expect(after.getY(i)).toBeCloseTo(before.getY(i) + hips[1], 6)
      expect(after.getY(i)).toBeCloseTo(vertices[i]!.position.y, 6)
    }
    // And the source is untouched, because a gear module hands out one model
    // for the worn suit and the paper-doll preview both.
    expect(before.getY(0)).toBeCloseTo(vertices[0]!.position.y - hips[1], 6)
  })

  it('measures how far a rigid, chest-parented shell parts from the body', () => {
    // Kept from the overlay era because it is the reason torso armour is not
    // socketed at all: whatever carries it has to be skinned.
    const vertices = torsoVertices()
    let worst = 0
    const skinnedPoint = new Vector3()
    const rigidPoint = new Vector3()
    for (const built of worstPoses()) {
      for (const vertex of vertices) {
        skinPoint(built, vertex.position, vertex.weight, skinnedPoint)
        // A rigid attachment is weight 1 on the bone it hangs off.
        skinPoint(built, vertex.position, 1, rigidPoint)
        worst = Math.max(worst, skinnedPoint.distanceTo(rigidPoint))
      }
    }
    // 132 mm, recorded in `CharacterEquipment.ts`'s header. The torso's
    // half-width is 196 mm, so a rigid shell parts from the body by two thirds
    // of its own half-width — there is no clearance that hides that.
    expect(worst).toBeGreaterThan(0.12)
    expect(worst).toBeLessThan(0.15)
  })

  it('moves a garment vertex exactly as the body vertex beside it, in every pose', () => {
    // Written for the overlay's 8 mm clearance and kept, because it is the
    // reason the *substitution* works too: under linear blend skinning a
    // vertex's transform is a function of its weights alone, so a garment vertex
    // and a body vertex at the same height share one affine map and the offset
    // between them can only change by however much that map is not a rotation.
    // That is what welds the pelvis to the thighs and the gorget to the neck
    // without any of them being the same mesh — and it is why `torsoChestWeight`
    // is imported rather than approximated.
    const vertices = torsoVertices()
    const offsetLength = 0.008
    const radial = new Vector3()
    const bodyPoint = new Vector3()
    const garmentPoint = new Vector3()
    const offset = new Vector3()
    let drift = 0
    let closest = Number.POSITIVE_INFINITY

    for (const built of worstPoses()) {
      for (const vertex of vertices) {
        radial.set(vertex.position.x, 0, vertex.position.z)
        if (radial.lengthSq() < 1e-8) {
          continue
        }
        radial.normalize().multiplyScalar(offsetLength)
        skinPoint(built, vertex.position, vertex.weight, bodyPoint)
        // The offset is radial, so the garment vertex sits at the same height and
        // therefore takes exactly the same weight.
        skinPoint(built, vertex.position.clone().add(radial), vertex.weight, garmentPoint)
        const gap = bodyPoint.distanceTo(garmentPoint)
        drift = Math.max(drift, Math.abs(gap - offsetLength))
        closest = Math.min(closest, gap)
        // And it must never invert.
        offset.subVectors(garmentPoint, bodyPoint)
        expect(offset.dot(radial)).toBeGreaterThan(0)
      }
    }
    // 0.20 mm on 8 mm: a 2.4 % squeeze, which is skinning's own volume loss and
    // is suffered identically by the body surface beside it. Against 132 mm for
    // the rigid shell above — three orders of magnitude apart.
    expect(drift).toBeLessThan(0.00025)
    expect(closest).toBeGreaterThan(offsetLength * 0.9)
  })

  it('leaves an overlay 96 buried triangles, which the substitution recovers', () => {
    // The number that justified moving this into `chibiGeometry.ts`, kept as the
    // *before* half of the measurement rather than deleted. The torso is a
    // contiguous prefix of the index buffer because it is the first part emitted
    // — which is also what made `drawRange` a candidate, and the prefix is
    // asserted here so that claim cannot rot.
    const geometry = plain()
    const skinIndex = geometry.getAttribute('skinIndex')
    const index = geometry.getIndex()!
    let buried = 0
    let prefix = 0
    let stillPrefix = true
    for (let t = 0; t < index.count; t += 3) {
      const wholeTriangle =
        skinIndex.getX(index.getX(t)) === HIPS &&
        skinIndex.getX(index.getX(t + 1)) === HIPS &&
        skinIndex.getX(index.getX(t + 2)) === HIPS
      if (wholeTriangle) {
        buried++
        if (stillPrefix) {
          prefix++
        }
      } else {
        stillPrefix = false
      }
    }
    expect(buried).toBe(96)
    expect(prefix).toBe(96)
  })

  it('does not build the torso at all when armour is supplied', () => {
    // The assertion that matters, and it is about *vertices*, not counts: a
    // triangle count could match by coincidence. Every one of the torso part's
    // 63 vertices is in the plain figure and none of them is in the armoured one.
    const build = BUILDS.male
    const hips = boneDefinition('hips').head
    const chest = boneDefinition('chest').head
    const torso = limbMesh({
      from: new Vector3(hips[0], hips[1], hips[2]),
      to: new Vector3(chest[0], chest[1], chest[2]),
      radiusStart: build.hipRadius,
      radiusEnd: build.chestRadius,
      radial: 8,
      rings: 2,
      capRings: 2,
      crossSection: build.torsoCrossSection
    })

    // The two collapsed pole rings are excluded: they are 18 copies of two
    // points on the axis, and one of them — the bottom pole at y = 0.470 — is
    // *deliberately* where the armour's pelvis apex sits, so matching it proves
    // nothing about the torso being built.
    const distinctive: number[] = []
    for (let i = 0; i < torso.position.length; i += 3) {
      if (Math.hypot(torso.position[i]!, torso.position[i + 2]!) > 1e-6) {
        distinctive.push(i)
      }
    }

    const present = (geometry: BufferGeometry): number => {
      const position = geometry.getAttribute('position')
      let found = 0
      for (const i of distinctive) {
        for (let v = 0; v < position.count; v++) {
          if (
            Math.abs(position.getX(v) - torso.position[i]!) < 1e-6 &&
            Math.abs(position.getY(v) - torso.position[i + 1]!) < 1e-6 &&
            Math.abs(position.getZ(v) - torso.position[i + 2]!) < 1e-6
          ) {
            found++
            break
          }
        }
      }
      return found
    }

    expect(torso.position.length / 3).toBe(63)
    expect(distinctive.length).toBe(45)
    expect(present(plain())).toBe(distinctive.length)
    expect(present(armoured())).toBe(0)

    // And the count moves by exactly what that implies.
    expect(plain().getIndex()!.count / 3).toBe(BARE_CHIBI_TRIANGLES)
    expect(armourGeometry().getIndex()!.count / 3).toBe(240)
    expect(armoured().getIndex()!.count / 3).toBe(BARE_CHIBI_TRIANGLES - 96 + 240)
  })

  it('weights the substituted armour by the torso’s own rule', () => {
    // Not "close to" — identical. The armour's vertices are the last block
    // before the hair, so they are found by matching positions against the
    // armour model translated into bind-pose world space.
    const source = armourGeometry()
    const reference = skinTorsoGeometry(source)
    const referenceIndex = reference.getAttribute('skinIndex')
    const referenceWeight = reference.getAttribute('skinWeight')
    const referencePosition = reference.getAttribute('position')

    const body = armoured()
    const position = body.getAttribute('position')
    const skinIndex = body.getAttribute('skinIndex')
    const skinWeight = body.getAttribute('skinWeight')

    let matched = 0
    for (let i = 0; i < referencePosition.count; i++) {
      for (let v = 0; v < position.count; v++) {
        if (
          Math.abs(position.getX(v) - referencePosition.getX(i)) < 1e-9 &&
          Math.abs(position.getY(v) - referencePosition.getY(i)) < 1e-9 &&
          Math.abs(position.getZ(v) - referencePosition.getZ(i)) < 1e-9
        ) {
          expect(skinIndex.getX(v)).toBe(referenceIndex.getX(i))
          expect(skinIndex.getY(v)).toBe(referenceIndex.getY(i))
          expect(skinWeight.getX(v)).toBeCloseTo(referenceWeight.getX(i), 9)
          expect(skinWeight.getY(v)).toBeCloseTo(referenceWeight.getY(i), 9)
          matched++
          break
        }
      }
    }
    expect(matched).toBe(referencePosition.count)

    // And the rule really is the hips→chest ramp: the hem is all hips, the
    // gorget is an even split with the chest, and nothing is on a third bone.
    const hipsY = boneDefinition('hips').head[1]
    expect(torsoChestWeight(0, 0, 0)).toBe(0)
    expect(torsoChestWeight(0, boneDefinition('chest').head[1] - hipsY, 0)).toBeCloseTo(0.5, 9)
    for (let i = 0; i < skinWeight.count; i++) {
      expect(skinWeight.getZ(i)).toBe(0)
      expect(skinWeight.getW(i)).toBe(0)
    }
  })

  it('stays inside the chibi budget, for every hairstyle', () => {
    // Derived from `HAIRLINE`, which `variants.ts` keys by the union itself, so
    // a hairstyle added to `equipment.ts` is covered here without an edit — and
    // the one that costs the most silhouette is exactly the one this budget has
    // to survive.
    for (const hair of Object.keys(HAIRLINE) as HairStyle[]) {
      const geometry = buildChibiGeometry(
        undefined,
        'chibi/armoured',
        { ...DEFAULT_APPEARANCE, hair },
        armourGeometry()
      ).geometry
      const tris = geometry.getIndex()!.count / 3
      expect(tris, hair).toBeLessThanOrEqual(CHIBI_ARMOURED_BUDGET)
      // Strictly cheaper than the overlay it replaces, which drew the whole
      // body *and* the whole armour.
      expect(tris, hair).toBeLessThan(buildChibiGeometry(undefined, 'plain', { ...DEFAULT_APPEARANCE, hair }).geometry.getIndex()!.count / 3 + 240)
    }
  })

  it('winds the substituted armour outward, like the rest of the figure', () => {
    // `limbMesh` winds inward and `chibiGeometry` reverses it; gear already
    // winds outward and must *not* be reversed. Getting that wrong renders the
    // inside of the breastplate and is invisible to every other assertion here.
    const geometry = armoured()
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    const index = geometry.getIndex()!
    const a = new Vector3()
    const b = new Vector3()
    const c = new Vector3()
    const edgeA = new Vector3()
    const edgeB = new Vector3()
    const face = new Vector3()
    const authored = new Vector3()

    let inverted = 0
    for (let t = 0; t < index.count; t += 3) {
      const ia = index.getX(t)
      const ib = index.getX(t + 1)
      const ic = index.getX(t + 2)
      a.set(position.getX(ia), position.getY(ia), position.getZ(ia))
      b.set(position.getX(ib), position.getY(ib), position.getZ(ib))
      c.set(position.getX(ic), position.getY(ic), position.getZ(ic))
      edgeA.subVectors(b, a)
      edgeB.subVectors(c, a)
      face.crossVectors(edgeA, edgeB)
      if (face.lengthSq() < 1e-16) {
        continue
      }
      authored
        .set(normal.getX(ia), normal.getY(ia), normal.getZ(ia))
        .add(new Vector3(normal.getX(ib), normal.getY(ib), normal.getZ(ib)))
        .add(new Vector3(normal.getX(ic), normal.getY(ic), normal.getZ(ic)))
      if (face.dot(authored) < 0) {
        inverted++
      }
    }
    expect(inverted).toBe(0)
  })

  it('never paints the armour black (R4)', () => {
    // The *authored* sRGB luma, per the note in `characterFace.test.ts`: three
    // holds linear-sRGB, where every dark albedo in this project sits near
    // 0.015, so a linear threshold would be a test about colour management.
    const authoredLuma = (r: number, g: number, b: number): number => {
      const srgb = new Color(r, g, b).convertLinearToSRGB()
      return 0.2126 * srgb.r + 0.7152 * srgb.g + 0.0722 * srgb.b
    }
    const colour = armoured().getAttribute('color')
    let darkest = 1
    for (let i = 0; i < colour.count; i++) {
      darkest = Math.min(darkest, authoredLuma(colour.getX(i), colour.getY(i), colour.getZ(i)))
    }
    expect(darkest).toBeGreaterThan(0.02)
  })

  // ── The seam ──────────────────────────────────────────────────────────────
  //
  // With an overlay the body underneath covered any gap in the armour's
  // coverage. Once the torso is gone a gap is a **hole straight through the
  // character**, so the two tests below are the ones that earn the change.

  /** Every bone's skinning matrix for a pose, so a probe can be posed cheaply. */
  const poseMatrices = (apply: (built: ReturnType<typeof buildSkeleton>) => void): Matrix4[] => {
    const built = posed()
    apply(built)
    built.root.updateMatrixWorld(true)
    return built.skeleton.bones.map((bone, i) =>
      new Matrix4().multiplyMatrices(bone.matrixWorld, built.skeleton.boneInverses[i]!)
    )
  }

  /**
   * Bind pose, the walk and the run at four phases each with the bank at both
   * extremes, and the jump at four phases.
   *
   * Bind pose alone is not the test: the armour is weighted hips→chest while the
   * neck above it hangs off the chest and the thighs below it off the hips, so
   * every one of those seams *moves*, and it moves most exactly where a stride
   * and a bank compound.
   */
  const seamPoses = (): { label: string; matrices: Matrix4[] }[] => {
    const list = [{ label: 'bind', matrices: poseMatrices(() => {}) }]
    for (let step = 0; step < 4; step++) {
      for (const bank of [-0.35, 0.35]) {
        for (const [name, weight] of [
          ['walk', 0],
          ['run', 1]
        ] as const) {
          list.push({
            label: `${name} ${step}/4 bank ${bank}`,
            matrices: poseMatrices(built => {
              applyGait(built.byName, step / 4, WALK, RUN, weight)
              applyBank(built.byName, bank)
            })
          })
        }
      }
      list.push({
        label: `jump ${step}/4`,
        matrices: poseMatrices(built => {
          applyJump(built.byName, step / 4)
        })
      })
    }
    return list
  }

  interface Soup {
    rest: Float32Array
    index: Uint32Array
    boneA: Uint16Array
    boneB: Uint16Array
    weightA: Float32Array
    weightB: Float32Array
  }

  const soupOf = (geometry: BufferGeometry): Soup => {
    const position = geometry.getAttribute('position')
    const skinIndex = geometry.getAttribute('skinIndex')
    const skinWeight = geometry.getAttribute('skinWeight')
    const source = geometry.getIndex()!
    const rest = new Float32Array(position.count * 3)
    const boneA = new Uint16Array(position.count)
    const boneB = new Uint16Array(position.count)
    const weightA = new Float32Array(position.count)
    const weightB = new Float32Array(position.count)
    for (let i = 0; i < position.count; i++) {
      rest[i * 3] = position.getX(i)
      rest[i * 3 + 1] = position.getY(i)
      rest[i * 3 + 2] = position.getZ(i)
      boneA[i] = skinIndex.getX(i)
      boneB[i] = skinIndex.getY(i)
      weightA[i] = skinWeight.getX(i)
      weightB[i] = skinWeight.getY(i)
    }
    const index = new Uint32Array(source.count)
    for (let i = 0; i < source.count; i++) {
      index[i] = source.getX(i)
    }
    return { rest, index, boneA, boneB, weightA, weightB }
  }

  const skinSoup = (soup: Soup, matrices: Matrix4[], out: Float32Array): void => {
    const point = new Vector3()
    const accumulated = new Vector3()
    for (let i = 0; i < soup.boneA.length; i++) {
      accumulated.set(0, 0, 0)
      if (soup.weightA[i]! !== 0) {
        point.fromArray(soup.rest, i * 3).applyMatrix4(matrices[soup.boneA[i]!]!).multiplyScalar(soup.weightA[i]!)
        accumulated.add(point)
      }
      if (soup.weightB[i]! !== 0) {
        point.fromArray(soup.rest, i * 3).applyMatrix4(matrices[soup.boneB[i]!]!).multiplyScalar(soup.weightB[i]!)
        accumulated.add(point)
      }
      out[i * 3] = accumulated.x
      out[i * 3 + 1] = accumulated.y
      out[i * 3 + 2] = accumulated.z
    }
  }

  it('opens no hole the torso was closing, in any pose', () => {
    // A **differential** test rather than an absolute one, and that is the
    // point: the shipped figure already has a 16 mm slot above each shoulder
    // where the arm ball leaves the torso, so "no ray passes through the
    // armoured figure" would fail on a fault this change did not introduce.
    // What must hold is that every ray the plain body stops, the armoured one
    // stops too.
    const plainSoup = soupOf(plain())
    const armouredSoup = soupOf(armoured())
    const plainPosed = new Float32Array(plainSoup.rest.length)
    const armouredPosed = new Float32Array(armouredSoup.rest.length)

    // Only the two bands the substitution can affect: the pelvis under the
    // skirt, and the collar. Everything between them is a shell strictly
    // outside the torso it replaced.
    const bands = [
      [0.45, 0.63],
      [0.98, 1.16]
    ]

    const ray = new Ray()
    const a = new Vector3()
    const b = new Vector3()
    const c = new Vector3()
    const hit = new Vector3()
    const blocked = (positions: Float32Array, index: Uint32Array): boolean => {
      for (let f = 0; f < index.length; f += 3) {
        a.fromArray(positions, index[f]! * 3)
        b.fromArray(positions, index[f + 1]! * 3)
        c.fromArray(positions, index[f + 2]! * 3)
        if (ray.intersectTriangle(a, b, c, false, hit)) {
          return true
        }
      }
      return false
    }

    let cast = 0
    let holes = 0
    let firstHole = ''
    for (const pose of seamPoses()) {
      skinSoup(plainSoup, pose.matrices, plainPosed)
      skinSoup(armouredSoup, pose.matrices, armouredPosed)
      for (let bearing = 0; bearing < 8; bearing++) {
        const theta = (bearing / 8) * Math.PI * 2
        const dx = Math.sin(theta)
        const dz = Math.cos(theta)
        for (let side = -20; side <= 20; side++) {
          const offset = side * 0.01
          for (const [low, high] of bands) {
            for (let y = low!; y <= high!; y += 0.01) {
              ray.origin.set(Math.cos(theta) * offset - dx * 3, y, -Math.sin(theta) * offset - dz * 3)
              ray.direction.set(dx, 0, dz)
              cast++
              if (blocked(plainPosed, plainSoup.index) && !blocked(armouredPosed, armouredSoup.index)) {
                holes++
                if (!firstHole) {
                  firstHole = `${pose.label} at y=${y.toFixed(3)}, offset ${offset.toFixed(3)}, bearing ${bearing}`
                }
              }
            }
          }
        }
      }
    }

    expect(cast).toBeGreaterThan(200_000)
    expect(holes, firstHole).toBe(0)
  }, 120_000)

  /**
   * Connected, closed components of an indexed mesh.
   *
   * Needed because the chibi body is a **union of overlapping closed solids** —
   * twelve limb volumes, the hair, the face patch and now the garment — and
   * parity ray-casting is only valid per solid. Run over the whole index buffer
   * and a thigh's surface *inside* the pelvis reads as a boundary crossing,
   * which reports a point plainly inside the body as outside.
   *
   * Vertices are welded by position first: `limbMesh` duplicates the seam vertex
   * of every ring, so a capsule that is geometrically closed has two boundary
   * edges by index alone. Triangles that collapse under the weld (the fan around
   * a pole) contribute no edges, because they have no area.
   */
  const componentsOf = (index: Uint32Array, rest: Float32Array): { faces: number[]; closed: boolean }[] => {
    const vertexCount = rest.length / 3
    const welded = new Int32Array(vertexCount)
    const byPosition = new Map<string, number>()
    for (let i = 0; i < vertexCount; i++) {
      // Integer keys, not `toFixed`: a coordinate of −1e−9 formats as
      // "-0.000000" and +1e−9 as "0.000000", which leaves every pole unwelded.
      const key = `${Math.round(rest[i * 3]! * 1e6)}:${Math.round(rest[i * 3 + 1]! * 1e6)}:${Math.round(rest[i * 3 + 2]! * 1e6)}`
      const seen = byPosition.get(key)
      if (seen === undefined) {
        byPosition.set(key, i)
        welded[i] = i
      } else {
        welded[i] = seen
      }
    }
    const parent = new Int32Array(vertexCount)
    for (let i = 0; i < vertexCount; i++) {
      parent[i] = i
    }
    const find = (x: number): number => {
      let root = x
      while (parent[root]! !== root) {
        root = parent[root]!
      }
      return root
    }
    const join = (x: number, y: number): void => {
      const a = find(x)
      const b = find(y)
      if (a !== b) {
        parent[a] = b
      }
    }
    for (let f = 0; f < index.length; f += 3) {
      join(welded[index[f]!]!, welded[index[f + 1]!]!)
      join(welded[index[f + 1]!]!, welded[index[f + 2]!]!)
    }
    const groups = new Map<number, number[]>()
    for (let f = 0; f < index.length; f += 3) {
      const key = find(welded[index[f]!]!)
      const list = groups.get(key)
      if (list) {
        list.push(f)
      } else {
        groups.set(key, [f])
      }
    }
    const out: { faces: number[]; closed: boolean }[] = []
    for (const faces of groups.values()) {
      const edges = new Map<string, number>()
      for (const f of faces) {
        const tri = [welded[index[f]!]!, welded[index[f + 1]!]!, welded[index[f + 2]!]!]
        if (tri[0] === tri[1] || tri[1] === tri[2] || tri[2] === tri[0]) {
          continue
        }
        for (let e = 0; e < 3; e++) {
          const u = tri[e]!
          const v = tri[(e + 1) % 3]!
          const key = u < v ? `${u}:${v}` : `${v}:${u}`
          edges.set(key, (edges.get(key) ?? 0) + 1)
        }
      }
      let closed = true
      for (const count of edges.values()) {
        if (count !== 2) {
          closed = false
        }
      }
      out.push({ faces, closed })
    }
    return out
  }

  /**
   * How far out from the torso's own axis the figure is solid, per band.
   *
   * `cap` is where the measurement stops, and it is chosen to sit **inside the
   * arms**: above the waist an arm is a separate solid with genuine air between
   * it and the ribcage, so a "no void ring" assertion that reached that far
   * would be failing on anatomy rather than on a hole.
   */
  const SOLID_BANDS = [
    { name: 'hip/skirt', low: 0.5, high: 0.7, cap: 0.14 },
    { name: 'waist/chest', low: 0.7, high: 0.95, cap: 0.14 },
    { name: 'armpit', low: 0.95, high: 1.0, cap: 0.1 },
    { name: 'collar', low: 1.0, high: 1.07, cap: 0.1 }
  ]

  /**
   * The radius out to which the body is solid at every bearing and height of a
   * band, minimised over poses.
   *
   * The probe **rides the torso** rather than sitting on the world axis: the hips
   * translate during a jump and the chest counter-rotates through a stride, so a
   * ray cast from `(0, y, 0)` leaves the figure entirely at the top of a jump and
   * reports a hole that is really a camera in the wrong place. Origin and
   * direction are both carried by the torso's own hips→chest blend — the same
   * blend the garment is skinned with.
   *
   * Bearings are offset by a fraction of a step because the section's `v = 0`
   * vertex sits exactly on +Z: a ray straight down that bearing passes through a
   * vertex and is counted by both triangles sharing it, which flips the parity.
   */
  const solidRadius = (geometry: BufferGeometry, poses: { label: string; matrices: Matrix4[] }[]) => {
    const soup = soupOf(geometry)
    const components = componentsOf(soup.index, soup.rest)
    const posedPositions = new Float32Array(soup.rest.length)
    const blend = new Matrix4()
    const ray = new Ray()
    const a = new Vector3()
    const b = new Vector3()
    const c = new Vector3()
    const hit = new Vector3()
    const hipsY = boneDefinition('hips').head[1]
    const hipsBone = BONE_NAMES.indexOf('hips')
    const chestBone = BONE_NAMES.indexOf('chest')
    const worst = new Map<string, { radius: number; where: string }>()

    for (const pose of poses) {
      skinSoup(soup, pose.matrices, posedPositions)
      for (const band of SOLID_BANDS) {
        for (let y = band.low; y <= band.high + 1e-9; y += 0.01) {
          for (let bearing = 0; bearing < 16; bearing++) {
            const theta = ((bearing + 0.371) / 16) * Math.PI * 2
            const chestWeight = torsoChestWeight(0, y - hipsY, 0)
            for (let e = 0; e < 16; e++) {
              blend.elements[e] =
                (1 - chestWeight) * pose.matrices[hipsBone]!.elements[e]! +
                chestWeight * pose.matrices[chestBone]!.elements[e]!
            }
            ray.origin.set(0, y, 0).applyMatrix4(blend)
            ray.direction.set(Math.sin(theta), 0, Math.cos(theta)).transformDirection(blend)

            const crossings = components.map(() => [] as number[])
            for (let ci = 0; ci < components.length; ci++) {
              if (!components[ci]!.closed) {
                continue
              }
              for (const f of components[ci]!.faces) {
                a.fromArray(posedPositions, soup.index[f]! * 3)
                b.fromArray(posedPositions, soup.index[f + 1]! * 3)
                c.fromArray(posedPositions, soup.index[f + 2]! * 3)
                if (ray.intersectTriangle(a, b, c, false, hit)) {
                  crossings[ci]!.push(hit.distanceTo(ray.origin))
                }
              }
            }
            const insideAt = (radius: number): boolean => {
              for (const list of crossings) {
                let above = 0
                for (const distance of list) {
                  if (distance > radius) {
                    above++
                  }
                }
                if (above % 2 === 1) {
                  return true
                }
              }
              return false
            }
            let solid = band.cap
            for (let radius = 0.02; radius <= band.cap + 1e-9; radius += 0.005) {
              if (!insideAt(radius)) {
                solid = radius
                break
              }
            }
            const current = worst.get(band.name)
            if (!current || solid < current.radius) {
              worst.set(band.name, {
                radius: solid,
                where: `${pose.label}, y=${y.toFixed(2)}, bearing ${bearing}`
              })
            }
          }
        }
      }
    }
    return worst
  }

  it('stays solid out from its own axis across every seam band, in every pose', () => {
    // The absolute companion to the differential test above, and the one that
    // states the invariant a hole violates directly: **march outward from the
    // torso's axis and you must not leave the figure and come back.** A void ring
    // around the neck — the failure removing the torso creates — is exactly that,
    // and no triangle count, budget or winding assertion can see it.
    //
    // Measured on this machine, minimum over 13 poses × 4 bands × 16 bearings:
    //
    //   band          plain     armoured
    //   hip/skirt     60 mm     80 mm
    //   waist/chest  120 mm    140 mm (the cap)
    //   armpit       100 mm    100 mm (the cap)
    //   collar       100 mm    100 mm (the cap)
    //
    // So the armoured figure is solid at least as far out as the tunic'd one in
    // every band, which is the claim that matters, and the floors below are the
    // measured numbers with a couple of millimetres of slack.
    const poses = seamPoses()
    const armour = gearModel('torsoArmour').geometry
    const plainSolid = solidRadius(plain(), poses)
    const armouredSolid = solidRadius(
      buildChibiGeometry(undefined, 'chibi/armoured', undefined, armour).geometry,
      poses
    )

    const floors: Record<string, number> = {
      'hip/skirt': 0.055,
      'waist/chest': 0.115,
      armpit: 0.095,
      collar: 0.095
    }
    for (const band of SOLID_BANDS) {
      const armoured = armouredSolid.get(band.name)!
      const bare = plainSolid.get(band.name)!
      expect(armoured.radius, `${band.name} armoured, worst at ${armoured.where}`).toBeGreaterThanOrEqual(
        floors[band.name]!
      )
      // And never worse than the figure it replaces — the self-adjusting half,
      // so that a future change to the body cannot quietly move the goalposts.
      expect(armoured.radius, `${band.name}: armoured ${armoured.where} vs plain ${bare.where}`).toBeGreaterThanOrEqual(
        bare.radius - 1e-9
      )
    }
  }, 120_000)

  it('keeps the armour overlapping the neck and both thighs, in every pose', () => {
    // The structural version of the same claim, and the one that produces a
    // number. Every part of this body is a **closed** solid — `limbMesh` caps
    // both ends, and the armour's profile now begins and ends on a collapsed
    // ring — so if the armour's volume and its neighbour's volume intersect,
    // their union has no crack between them whatever the viewing angle. What is
    // reported is how deep that intersection is at its best point: 0 would mean
    // the two are merely touching, and a negative is impossible to express.
    const armourRest = skinTorsoGeometry(armourGeometry())
    const armourSoup = soupOf(armourRest)
    const bodySoup = soupOf(armoured())
    const body = armoured()
    const bodySkin = body.getAttribute('skinIndex')

    const probesFor = (bone: number): number[] => {
      const list: number[] = []
      for (let i = 0; i < bodySkin.count; i++) {
        if (bodySkin.getX(i) === bone) {
          list.push(i)
        }
      }
      return list
    }
    const neighbours = [
      { name: 'neck', probes: probesFor(NECK) },
      { name: 'thigh.L', probes: probesFor(THIGH_L) },
      { name: 'thigh.R', probes: probesFor(THIGH_R) }
    ]
    for (const neighbour of neighbours) {
      expect(neighbour.probes.length, neighbour.name).toBeGreaterThan(10)
    }

    const armourPosed = new Float32Array(armourSoup.rest.length)
    const bodyPosed = new Float32Array(bodySoup.rest.length)
    const triangle = new Triangle()
    const probe = new Vector3()
    const closest = new Vector3()
    const ray = new Ray()
    const a = new Vector3()
    const b = new Vector3()
    const c = new Vector3()
    const hit = new Vector3()

    /** Parity along an arbitrary direction: odd crossings means inside. */
    const inside = (point: Vector3): boolean => {
      ray.origin.copy(point)
      ray.direction.set(0.5121, 0.6042, 0.6104).normalize()
      let crossings = 0
      for (let f = 0; f < armourSoup.index.length; f += 3) {
        a.fromArray(armourPosed, armourSoup.index[f]! * 3)
        b.fromArray(armourPosed, armourSoup.index[f + 1]! * 3)
        c.fromArray(armourPosed, armourSoup.index[f + 2]! * 3)
        if (ray.intersectTriangle(a, b, c, false, hit)) {
          crossings++
        }
      }
      return crossings % 2 === 1
    }

    const worst = new Map<string, { depth: number; pose: string }>()
    for (const pose of seamPoses()) {
      skinSoup(armourSoup, pose.matrices, armourPosed)
      skinSoup(bodySoup, pose.matrices, bodyPosed)
      for (const neighbour of neighbours) {
        let deepest = 0
        for (const index of neighbour.probes) {
          probe.fromArray(bodyPosed, index * 3)
          if (!inside(probe)) {
            continue
          }
          let nearest = Number.POSITIVE_INFINITY
          for (let f = 0; f < armourSoup.index.length; f += 3) {
            triangle.a.fromArray(armourPosed, armourSoup.index[f]! * 3)
            triangle.b.fromArray(armourPosed, armourSoup.index[f + 1]! * 3)
            triangle.c.fromArray(armourPosed, armourSoup.index[f + 2]! * 3)
            triangle.closestPointToPoint(probe, closest)
            nearest = Math.min(nearest, closest.distanceTo(probe))
          }
          deepest = Math.max(deepest, nearest)
        }
        const current = worst.get(neighbour.name)
        if (!current || deepest < current.depth) {
          worst.set(neighbour.name, { depth: deepest, pose: pose.label })
        }
      }
    }

    // Measured over the full run, walk and jump cycles: the neck's deepest point
    // is **107 mm** inside the gorget at its worst pose (a mid-jump) and each
    // thigh **104 mm** inside the pelvis. These are *intersections*, not
    // clearances — the surfaces are meant to pass through each other, and the
    // number is how much pose the seam can absorb before it opens. Compare the
    // overlay era, where the equivalent quantity was an 8 mm gap that had to be
    // held open to within 0.2 mm.
    for (const neighbour of neighbours) {
      const measured = worst.get(neighbour.name)!
      expect(measured.depth, `${neighbour.name}, worst at ${measured.pose}`).toBeGreaterThan(0.05)
    }
  }, 120_000)

  it('builds the armour into the body rather than beside it', () => {
    const character = new Character({ outline: false })
    const before = character.body.geometry
    const equipment = new CharacterEquipment(hostFor(character), { outline: false })
    equipment.equip('torso', 'torsoArmour')

    // No second mesh, no second hull, no second shadow caster — and no socket,
    // because there was never anything to parent.
    expect(equipment.objectAt('torso')).toBeNull()
    expect(equipment.socketAt('torso')).toBeNull()
    expect(equipment.itemAt('torso')).toBe('torsoArmour')
    expect(character.group.children.length).toBe(1)
    expect(character.body.geometry).not.toBe(before)
    expect(character.body.geometry.getIndex()!.count / 3).toBe(BARE_CHIBI_TRIANGLES - 96 + 240)

    equipment.dispose()
    character.dispose()
  })

  it('costs a body rebuild, and the rebuild is a click-scale cost', () => {
    // Equipping is not a per-frame path — but "not per-frame" is not a licence
    // to be slow, and this is the number that says whether the merge was
    // affordable. It is the creation screen's own per-click figure, because it
    // is the same call.
    const character = new Character({ outline: false })
    const armour = gearModel('torsoArmour').geometry
    const worn = { torso: { kind: 'torsoArmour' as const, geometry: armour }, legs: null, head: null }
    const bare = { torso: null, legs: null, head: null }
    const samples: number[] = []
    for (let i = 0; i < 40; i++) {
      const started = performance.now()
      character.rebuildBody(i % 2 === 0 ? worn : bare)
      samples.push(performance.now() - started)
    }
    samples.sort((x, y) => x - y)
    const median = samples[Math.floor(samples.length / 2)]!
    expect(median).toBeLessThan(12)
    expect(character.lastRebuildMs).toBeGreaterThanOrEqual(0)
    character.dispose()
  })

  it('leaves a host that cannot rebuild its body without armour, not broken', () => {
    // The bare-skeleton host from `EquipmentHost`: it has no body geometry to
    // rebuild, so it simply does not wear a cuirass. Everything else still works.
    const { skeleton, root, byName } = buildSkeleton()
    const body = new SkinnedMesh(new BufferGeometry())
    body.add(root)
    body.bind(skeleton)
    const host: EquipmentHost = { bone: name => byName.get(name) ?? null, group: body, body }
    const equipment = new CharacterEquipment(host, { outline: false })
    equipment.equip('torso', 'torsoArmour')
    equipment.equip('offHand', 'shield')
    expect(equipment.itemAt('torso')).toBe('torsoArmour')
    expect(equipment.objectAt('torso')).toBeNull()
    expect(equipment.objectAt('offHand')!.parent).toBe(byName.get('hand.L'))
    equipment.dispose()
  })
})

describe('the placeholder billet obeys the art contract', () => {
  it('is inside every equipment budget', () => {
    for (const kind of ITEM_KINDS) {
      const geometry = buildPlaceholderItem(kind)
      const tris = geometry.getIndex()!.count / 3
      expect(tris, kind).toBeLessThanOrEqual(EQUIPMENT_BUDGET[kind])
      expect(tris, kind).toBe(44)
    }
  })

  it('winds outward and carries authored unit normals', () => {
    // `limbMesh` winds inward and `chibiGeometry` has to reverse it — the bug
    // that made the body render the inside of its own skull. Asserted here so a
    // second generator cannot repeat it.
    const edgeA = new Vector3()
    const edgeB = new Vector3()
    const face = new Vector3()
    const a = new Vector3()
    const b = new Vector3()
    const c = new Vector3()
    const normal = new Vector3()

    for (const kind of ITEM_KINDS) {
      const geometry = buildPlaceholderItem(kind)
      const position = geometry.getAttribute('position')
      const normals = geometry.getAttribute('normal')
      const index = geometry.getIndex()!

      for (let i = 0; i < normals.count; i++) {
        normal.set(normals.getX(i), normals.getY(i), normals.getZ(i))
        expect(normal.length(), `${kind} normal ${i}`).toBeCloseTo(1, 6)
      }

      for (let t = 0; t < index.count; t += 3) {
        const i0 = index.getX(t)
        const i1 = index.getX(t + 1)
        const i2 = index.getX(t + 2)
        a.set(position.getX(i0), position.getY(i0), position.getZ(i0))
        b.set(position.getX(i1), position.getY(i1), position.getZ(i1))
        c.set(position.getX(i2), position.getY(i2), position.getZ(i2))
        edgeA.subVectors(b, a)
        edgeB.subVectors(c, a)
        face.crossVectors(edgeA, edgeB)
        normal.set(normals.getX(i0), normals.getY(i0), normals.getZ(i0))
        expect(face.dot(normal), `${kind} triangle ${t / 3}`).toBeGreaterThan(0)
      }
    }
  })

  it('has no hard 90° edge left in it', () => {
    // GDD R2: every cut is bevelled. On a chamfered box that shows up as three
    // facets meeting at 135°, so no two adjacent facet normals are 90° apart.
    const geometry = buildPlaceholderItem('sword')
    const normals = geometry.getAttribute('normal')
    const seen = new Set<string>()
    const normal = new Vector3()
    for (let i = 0; i < normals.count; i++) {
      normal.set(normals.getX(i), normals.getY(i), normals.getZ(i))
      seen.add(`${normal.x.toFixed(3)},${normal.y.toFixed(3)},${normal.z.toFixed(3)}`)
    }
    // 6 faces + 12 bevels + 8 corners.
    expect(seen.size).toBe(26)
  })

  it('carries no texture coordinates and no skinning', () => {
    const geometry = buildPlaceholderItem('shield')
    expect(geometry.getAttribute('uv')).toBeUndefined()
    expect(geometry.getAttribute('skinIndex')).toBeUndefined()
    expect(geometry.getAttribute('color')).toBeDefined()
  })
})
