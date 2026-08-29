import { SkinnedMesh, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { Character } from '@/world/characters/Character'
import { CHIBI_TIERS, CHIBI_TIER_COUNT, buildChibiGeometry, chibiTier } from '@/world/characters/chibiGeometry'
import { DEFAULT_APPEARANCE, type CharacterAppearance } from '@/world/characters/equipment'
import { BONE_NAMES } from '@/world/characters/rig'
import { LOD_BANDS, LOD_DISTANCES } from '@/world/lod/config'
import { triangleCount } from '@/world/geometry/budget'

/**
 * ─── The chibi LOD ladder ───────────────────────────────────────────────────
 *
 * The character shipped **one** tier where every other object in this world
 * ships four (GDD R7), and the GDD has carried that as owed since Phase C
 * started. This is the ladder, and these are the four things about it that
 * cannot be seen by looking:
 *
 *   1. **Every tier is bound to the same `Skeleton`.** Phase C states it as the
 *      requirement — *"LOD tiers share one skeleton, so LOD switching never
 *      re-binds a skin"* — and a second skeleton would not throw. It would pose
 *      correctly, cost a second bone texture, and drift by a frame.
 *   2. **Coarse rungs are built lazily and refreshed on equip.** A rung that
 *      missed a rebuild is a figure whose armour appears when you walk away.
 *   3. **The hull is dropped past LOD1**, which is the one part of the ladder
 *      that returns a *draw call* rather than vertices.
 *   4. **The switch is a crossfade**, not a swap. GDD R7: a hard LOD swap is a
 *      bug.
 */

const DWARF: CharacterAppearance = {
  ...DEFAULT_APPEARANCE,
  hair: 'wild',
  beard: 'patriarch',
  brows: 'bushy',
  nose: 'round'
}

const build = (tier: number, appearance: CharacterAppearance = DEFAULT_APPEARANCE) =>
  buildChibiGeometry(undefined, 'test/lod', appearance, null, null, undefined, undefined, tier)

/** Drives a character's ladder to the tier a given distance selects. */
const at = (character: Character, distance: number): void => {
  character.update(1 / 60, new Vector3(0, 0, distance))
}

// ─── The geometry ───────────────────────────────────────────────────────────

describe('every tier builds inside its own budget', () => {
  it.each([0, 1, 2, 3])('LOD%i', tier => {
    const profile = chibiTier(tier)
    // The dwarf is the worst *shape* the figure has — the longest beard, a nose
    // and a brow ridge — so it exercises every block the tier table gates.
    for (const appearance of [DEFAULT_APPEARANCE, DWARF, { ...DWARF, sex: 'female' as const }]) {
      const built = build(tier, appearance)
      expect(triangleCount(built.geometry), `LOD${tier}`).toBeLessThanOrEqual(profile.budget)
    }
  })

  it('falls monotonically — a coarser rung is never larger than a finer one', () => {
    // The obvious property, and the one a mis-signed scale factor breaks
    // silently: `Math.round(6 * 1.4)` is a *finer* tier, and nothing else here
    // would notice.
    for (const appearance of [DEFAULT_APPEARANCE, DWARF]) {
      let previous = Infinity
      for (let tier = 0; tier < CHIBI_TIER_COUNT; tier++) {
        const count = triangleCount(build(tier, appearance).geometry)
        expect(count, `LOD${tier} against LOD${tier - 1}`).toBeLessThan(previous)
        previous = count
      }
    }
  })

  it('leaves LOD0 byte-identical to the figure that shipped', () => {
    // The whole ladder is additive or it is a repaint. `parts()` returns the
    // authored specs untouched at tier 0 for exactly this.
    const withTier = build(0, DWARF).geometry.getAttribute('position').array
    const without = buildChibiGeometry(undefined, 'test/lod', DWARF).geometry.getAttribute('position').array
    expect(Array.from(withTier)).toEqual(Array.from(without))
  })

  it('emits only finite floats on every tier', () => {
    for (let tier = 0; tier < CHIBI_TIER_COUNT; tier++) {
      const built = build(tier, DWARF)
      for (const name of ['position', 'normal', 'color', 'skinWeight'] as const) {
        const attribute = built.geometry.getAttribute(name)
        for (let i = 0; i < attribute.count * attribute.itemSize; i++) {
          expect(Number.isFinite(attribute.array[i]), `LOD${tier} ${name}[${i}]`).toBe(true)
        }
      }
    }
  })

  it('never emits a flat-capped limb, however coarse', () => {
    // `capRings: 0` leaves an end open and flat, and the toon ramp draws a hard
    // band edge across it — a cut limb at any distance. Every tier floors caps
    // at 1, and the floor is asserted rather than trusted because it is one
    // `Math.max` away from being wrong on the tier nobody looks at.
    for (let tier = 0; tier < CHIBI_TIER_COUNT; tier++) {
      expect(Math.round(2 * chibiTier(tier).capRings), `LOD${tier}`).toBeGreaterThanOrEqual(1)
    }
  })

  it('indexes the same bones on every tier', () => {
    // A tier that referenced a different bone order would pose correctly at
    // bind and shear the moment anything moved.
    for (let tier = 0; tier < CHIBI_TIER_COUNT; tier++) {
      const built = build(tier, DWARF)
      expect(built.boneNames).toEqual(BONE_NAMES)
      const index = built.geometry.getAttribute('skinIndex')
      for (let i = 0; i < index.count; i++) {
        for (const component of [index.getX(i), index.getY(i), index.getZ(i), index.getW(i)]) {
          expect(component, `LOD${tier} vertex ${i}`).toBeLessThan(BONE_NAMES.length)
        }
      }
    }
  })

  it('drops the right blocks at the right rung', () => {
    // The table's claims, read off the geometry rather than off the table.
    const blocks = (tier: number) => build(tier, DWARF).blocks
    // LOD0: a face, and a feature block with all three axes in it.
    expect(blocks(0).face, 'LOD0 has a face').toBeLessThan(blocks(0).count)
    // LOD1: no face decals at all.
    expect(blocks(1).face, 'LOD1 face').toBe(blocks(1).count)
    // LOD1 and LOD2 keep a beard; LOD3 does not.
    expect(blocks(1).features, 'LOD1 keeps a beard').toBeLessThan(blocks(1).face)
    expect(blocks(2).features, 'LOD2 keeps a beard').toBeLessThan(blocks(2).face)
    expect(blocks(3).features, 'LOD3 drops it').toBe(blocks(3).face)
    // LOD2 drops the hair mesh and the ears.
    expect(blocks(2).hair, 'LOD2 hair').toBe(blocks(2).features)
    expect(blocks(2).ears, 'LOD2 ears').toBe(blocks(2).hair)
  })

  it('keeps the beard two tiers longer than the nose, which is the point', () => {
    // A beard is silhouette (294 mm across at 45 m) and a nose is not (3 px at
    // 8 m). If a future edit collapses them onto one tier this is the assertion
    // that says so.
    const bearded = triangleCount(build(1, DWARF).geometry)
    const shaven = triangleCount(build(1, { ...DWARF, beard: 'none' }).geometry)
    expect(bearded, 'LOD1 still pays for a beard').toBeGreaterThan(shaven)

    const nosed = triangleCount(build(1, { ...DEFAULT_APPEARANCE, nose: 'broad' }).geometry)
    const noseless = triangleCount(build(1, DEFAULT_APPEARANCE).geometry)
    expect(nosed, 'LOD1 pays nothing for a nose').toBe(noseless)
  })
})

// ─── The runtime ────────────────────────────────────────────────────────────

describe('the ladder at runtime', () => {
  it('stays on LOD0 for a caller that never passes a camera', () => {
    // The creation screen, the three benches and the player. A ladder that
    // engaged by default would quietly coarsen the turntable.
    const character = new Character({ outline: false })
    for (let i = 0; i < 10; i++) {
      character.update(1 / 60)
    }
    expect(character.lodTier).toBe(0)
    character.dispose()
  })

  it('climbs as the camera pulls away, and reports being culled', () => {
    const character = new Character()
    const seen: number[] = []
    for (const distance of [2, 30, 70, 200, 10_000]) {
      at(character, distance)
      seen.push(character.lodTier)
    }
    expect(seen[0], 'point blank').toBe(0)
    expect(seen[1], `inside ${LOD_DISTANCES[1]} m`).toBe(1)
    expect(seen[2]).toBe(2)
    expect(seen[3]).toBe(3)
    expect(seen[4], 'past the cull distance').toBe(-1)
    character.dispose()
  })

  it('shares one skeleton across every rung it builds', () => {
    // Phase C's requirement, and the one thing here that would not throw.
    const character = new Character()
    for (const distance of [2, 30, 70, 200]) {
      at(character, distance)
    }
    const meshes = character.group.children.filter((child): child is SkinnedMesh => (child as SkinnedMesh).isSkinnedMesh)
    expect(meshes.length, 'four tiers, two of them with hulls').toBeGreaterThan(4)
    for (const mesh of meshes) {
      expect(mesh.skeleton, mesh.name).toBe(character.body.skeleton)
      expect(mesh.bindMatrix.equals(character.body.bindMatrix), mesh.name).toBe(true)
    }
    character.dispose()
  })

  it('builds a rung only when it is first wanted', () => {
    const character = new Character()
    const skinnedCount = () =>
      character.group.children.filter(child => (child as SkinnedMesh).isSkinnedMesh).length
    // Tier 0's body and hull, and nothing else.
    const atSpawn = skinnedCount()
    expect(atSpawn).toBe(2)
    at(character, 2)
    expect(skinnedCount(), 'still nothing but LOD0').toBe(atSpawn)
    at(character, 200)
    expect(skinnedCount(), 'LOD3 arrives on demand').toBeGreaterThan(atSpawn)
    character.dispose()
  })

  it('crossfades rather than swapping, and the two tiers sum to one', () => {
    // GDD R7: a hard swap is a bug. Inside a band both rungs draw with
    // complementary dither, so the silhouette never thins and never doubles.
    const character = new Character()
    const inBand = LOD_DISTANCES[0]! + LOD_BANDS[0]! * 0.5
    at(character, inBand)
    const visible = character.group.children.filter(
      child => (child as SkinnedMesh).isSkinnedMesh && child.visible && !child.name.includes('outline')
    )
    expect(visible.length, `two bodies drawn at ${inBand} m`).toBe(2)
    character.dispose()
  })

  it('drops the hull past LOD1, which is where the draw call comes back', () => {
    const character = new Character()
    for (const distance of [2, 30, 70, 200]) {
      at(character, distance)
    }
    const hulls = character.group.children.filter(child => child.name.includes('outline'))
    // LOD0 and LOD1 only, however many rungs were built.
    expect(hulls.length).toBe(2)
    expect(hulls.map(hull => hull.name).sort()).toEqual(['chibi/outline', 'chibi/outline/LOD1'])
    character.dispose()
  })

  it('casts a shadow from the near rungs only', () => {
    const character = new Character()
    at(character, 200)
    for (const child of character.group.children) {
      const mesh = child as SkinnedMesh
      if (!mesh.isSkinnedMesh || mesh.name.includes('outline')) {
        continue
      }
      if (mesh.name.endsWith('LOD2') || mesh.name.endsWith('LOD3')) {
        expect(mesh.castShadow, mesh.name).toBe(false)
      }
    }
    character.dispose()
  })

  it('refreshes a rung that already exists when the figure is rebuilt', () => {
    // The failure this prevents is invisible up close: an equip that reached
    // LOD0 alone would *appear* on the figure as the player walked away.
    const character = new Character()
    at(character, 200)
    const coarse = character.group.children.find(child => child.name === 'chibi/body/LOD3') as SkinnedMesh
    expect(coarse).toBeDefined()
    const before = coarse.geometry
    const beforeCount = triangleCount(coarse.geometry)

    character.setAppearance({ ...DEFAULT_APPEARANCE, sex: 'female', head: 'heart' })
    expect(coarse.geometry, 'the coarse rung was re-pointed').not.toBe(before)
    // Still a real, budgeted figure rather than an empty buffer.
    expect(triangleCount(coarse.geometry)).toBeGreaterThan(0)
    expect(triangleCount(coarse.geometry)).toBeLessThanOrEqual(CHIBI_TIERS[3]!.budget)
    expect(beforeCount).toBeGreaterThan(0)
    character.dispose()
  })

  it('tears every rung down on dispose', () => {
    const character = new Character()
    at(character, 200)
    expect(character.group.children.length).toBeGreaterThan(2)
    character.dispose()
    expect(character.group.children.length).toBe(0)
  })
})
