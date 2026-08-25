import { describe, expect, it } from 'vitest'
import { BoxGeometry, Group, Mesh, Object3D } from 'three'
import { Character } from '@/world/characters/Character'
import { CharacterEquipment, gearMaterials } from '@/world/characters/CharacterEquipment'
import { GearInstancer } from '@/world/characters/GearInstancer'
import { gearModel } from '@/world/characters/gear'

/**
 * ─── Batching the crowd's hats and swords ───────────────────────────────────
 *
 * Three properties, and each one fails silently rather than loudly.
 *
 * **`aFade` must be 1.** Both the toon and the outline shader declare it under
 * `USE_INSTANCING` and read it unconditionally. A zero-filled default is a
 * perfectly valid buffer that draws every hat in the town fully transparent —
 * which looks exactly like the instancer not working at all, and no error says
 * otherwise.
 *
 * **The batch key must be the geometry.** Keying by item kind would split one
 * batch in two whenever a model ignores part of the variant, and merge two that
 * should be separate if a kind ever produced more than one mesh.
 *
 * **The matrix must be this frame's.** Three refreshes the scene graph inside
 * `render()`, which runs after this — a batch that read `matrixWorld` without
 * forcing the update would trail the hand by one frame.
 */

const materials = () => {
  const { toon, outline } = gearMaterials()
  return { toon, outline }
}

/** A carrier of the shape `register` expects: a mesh parented under a root. */
const carrier = (geometry = new BoxGeometry(1, 1, 1)): { root: Object3D; mesh: Mesh } => {
  const root = new Group()
  const pivot = new Object3D()
  const mesh = new Mesh(geometry, materials().toon)
  root.add(pivot)
  pivot.add(mesh)
  return { root, mesh }
}

describe('gear instancer', () => {
  it('hides what it takes over and gives it back on release', () => {
    // The object stays in the bone hierarchy — its world matrix is the whole
    // point — so "taken over" has to mean invisible, never detached.
    const instancer = new GearInstancer({ material: materials().toon, outline: null })
    const { mesh } = carrier()
    const handle = instancer.register(mesh)
    expect(mesh.visible).toBe(false)
    expect(mesh.parent).not.toBeNull()
    expect(instancer.instanceCount).toBe(1)

    instancer.release(handle)
    expect(mesh.visible).toBe(true)
    expect(instancer.instanceCount).toBe(0)
    instancer.dispose()
  })

  it('fills aFade with 1, not the zero default', () => {
    // The whole-town-invisible bug. Asserted on the attribute rather than on a
    // rendered pixel, because a test cannot see a shader.
    const instancer = new GearInstancer({ material: materials().toon, outline: materials().outline })
    const { mesh } = carrier()
    instancer.register(mesh)
    instancer.update()

    let checked = 0
    instancer.group.traverse(node => {
      const batch = node as Mesh
      if (!batch.isMesh) {
        return
      }
      const fade = batch.geometry.getAttribute('aFade')
      expect(fade, batch.name).toBeDefined()
      for (let i = 0; i < fade!.count; i++) {
        expect(fade!.getX(i), `${batch.name}[${i}]`).toBe(1)
      }
      checked++
    })
    expect(checked).toBeGreaterThan(0)
    instancer.dispose()
  })

  it('shares a batch between items with the same geometry and splits on different', () => {
    const instancer = new GearInstancer({ material: materials().toon, outline: null })
    const shared = new BoxGeometry(1, 1, 1)
    const a = carrier(shared)
    const b = carrier(shared)
    const c = carrier(new BoxGeometry(2, 2, 2))
    instancer.register(a.mesh)
    instancer.register(b.mesh)
    expect(instancer.batchCount).toBe(1)
    instancer.register(c.mesh)
    expect(instancer.batchCount).toBe(2)
    instancer.dispose()
  })

  it('writes the carrier’s live world matrix, not a stale one', () => {
    // Three only refreshes the graph inside `render()`. Moving the *parent* and
    // reading the batch without any explicit update is exactly the case that
    // would lag a sword behind the hand holding it.
    const instancer = new GearInstancer({ material: materials().toon, outline: null })
    const { root, mesh } = carrier()
    instancer.register(mesh)
    root.position.set(3, 4, 5)
    instancer.update()

    let written: number[] | null = null
    instancer.group.traverse(node => {
      const batch = node as Mesh & { instanceMatrix?: { array: ArrayLike<number> } }
      if (batch.instanceMatrix) {
        written = Array.from(batch.instanceMatrix.array).slice(0, 16)
      }
    })
    expect(written).not.toBeNull()
    // Translation lives in elements 12..14 of a column-major matrix.
    expect(written![12]).toBeCloseTo(3, 5)
    expect(written![13]).toBeCloseTo(4, 5)
    expect(written![14]).toBeCloseTo(5, 5)
    instancer.dispose()
  })

  it('repacks from zero, so a released item stops drawing', () => {
    const instancer = new GearInstancer({ material: materials().toon, outline: null })
    const shared = new BoxGeometry(1, 1, 1)
    const a = carrier(shared)
    const b = carrier(shared)
    const handle = instancer.register(a.mesh)
    instancer.register(b.mesh)
    instancer.update()

    const batchOf = (): Mesh & { count: number } => {
      let found: (Mesh & { count: number }) | null = null
      instancer.group.traverse(node => {
        const m = node as Mesh & { count: number; instanceMatrix?: unknown }
        if (m.instanceMatrix) {
          found = m
        }
      })
      return found!
    }
    expect(batchOf().count).toBe(2)

    instancer.release(handle)
    instancer.update()
    expect(batchOf().count).toBe(1)
    instancer.dispose()
  })

  it('grows past its initial capacity without losing anyone', () => {
    // The default capacity is the crowd budget, so a market square exceeds it.
    // The bug this guards is dropping every instance packed *before* the growth.
    const instancer = new GearInstancer({ material: materials().toon, outline: null })
    const shared = new BoxGeometry(1, 1, 1)
    const wearers = Array.from({ length: 21 }, () => carrier(shared))
    for (const wearer of wearers) {
      instancer.register(wearer.mesh)
    }
    instancer.update()
    expect(instancer.batchCount).toBe(1)

    let count = -1
    instancer.group.traverse(node => {
      const m = node as Mesh & { count: number; instanceMatrix?: unknown }
      if (m.instanceMatrix) {
        count = m.count
      }
    })
    expect(count).toBe(21)
    instancer.dispose()
  })

  it('restores every carrier on dispose', () => {
    const instancer = new GearInstancer({ material: materials().toon, outline: null })
    const wearers = [carrier(), carrier()]
    for (const wearer of wearers) {
      instancer.register(wearer.mesh)
    }
    instancer.dispose()
    for (const wearer of wearers) {
      expect(wearer.mesh.visible).toBe(true)
    }
    expect(instancer.batchCount).toBe(0)
  })
})

describe('equipment through an instancer', () => {
  it('builds no per-character hull, and routes the item into a batch', () => {
    // The saving is the hull as much as the item: an outlined hat is two draws,
    // and batching both is what takes forty hats to two.
    const character = new Character({ outline: false })
    const instancer = new GearInstancer({ material: materials().toon, outline: materials().outline })
    const equipment = new CharacterEquipment(character, { instancer })

    equipment.equip('head', 'hat')
    expect(instancer.instanceCount).toBe(1)
    const object = equipment.objectAt('head')!
    expect(object.visible).toBe(false)
    // No child hull — `CharacterEquipment` skips building one when batching.
    expect(object.children).toHaveLength(0)

    equipment.equip('head', null)
    expect(instancer.instanceCount).toBe(0)

    equipment.dispose()
    instancer.dispose()
    character.dispose()
  })

  it('still builds a per-character hull without one', () => {
    // The creation screen and a lone hero keep the old path, so the batching
    // decision cannot quietly change how a single figure is drawn.
    const character = new Character({ outline: false })
    const equipment = new CharacterEquipment(character, { outline: true })
    equipment.equip('head', 'hat')
    const object = equipment.objectAt('head')!
    expect(object.visible).toBe(true)
    expect(object.children.length).toBeGreaterThan(0)
    equipment.dispose()
    character.dispose()
  })

  it('re-batches when the wearer’s colourway changes', () => {
    // A batch is keyed by geometry, so a re-pointed item belongs to a different
    // one. Without the re-register the instancer keeps drawing the old
    // colourway — which looks like the variant change silently failing.
    const character = new Character({ outline: false })
    const instancer = new GearInstancer({ material: materials().toon, outline: null })
    const equipment = new CharacterEquipment(character, { instancer, variant: { seed: 0, skinTone: 1 } })
    equipment.equip('head', 'hat')

    const before = gearModel('hat', 0).geometry
    expect(equipment.objectAt('head')!.geometry).toBe(before)

    equipment.setVariant({ seed: 3, skinTone: 1 })
    const after = gearModel('hat', 3).geometry
    expect(equipment.objectAt('head')!.geometry).toBe(after)
    expect(instancer.instanceCount).toBe(1)
    if (before !== after) {
      expect(instancer.batchCount).toBe(2)
    }

    equipment.dispose()
    instancer.dispose()
    character.dispose()
  })
})
