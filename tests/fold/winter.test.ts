import { describe, expect, it } from 'vitest'
import { SNOW_MAX, SnowView } from '@/fold/render/views/SnowView'
import { seasonCastleGeometry, snowyGeometry, towerGeometry, pineGeometry } from '@/fold/render/models'
import { CASTLE } from '@/fold/logic/config'

// Roadmap #17 follow-up: Winter made clearly visible (thicker caps, falling snow).

const finite = (a: ArrayLike<number>): boolean => {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i]!)) return false
  return true
}

describe('Winter: falling snow', () => {
  it('shows only when asked; density follows the graphics and motion settings', () => {
    const s = new SnowView()
    expect(s.visible).toBe(false)
    expect(s.group.visible).toBe(false)
    s.show(true)
    expect(s.group.visible).toBe(true)
    expect(s.count).toBe(SNOW_MAX)
    s.setDensity(true, false)
    expect(s.count).toBe(Math.round(SNOW_MAX / 3))
    s.setDensity(false, true)
    expect(s.count).toBe(Math.round(SNOW_MAX / 4))
    s.setDensity(false, false)
    expect(s.count).toBe(SNOW_MAX)
    s.dispose()
  })

  it('flakes fall, respawn at the top, and never go non-finite; it is ink-free and casts no shadow', () => {
    const s = new SnowView()
    s.show(true)
    const mesh = s.group.children[0] as unknown as {
      instanceMatrix: { array: Float32Array }; castShadow: boolean; material: { uniforms: { uObjectId: { value: number } } }
    }
    expect(mesh.castShadow).toBe(false)
    expect(mesh.material.uniforms.uObjectId.value).toBe(127)
    s.update(0, 1 / 60)
    const y0 = mesh.instanceMatrix.array[13]!
    for (let f = 1; f <= 30; f++) s.update(f / 60, 1 / 60)
    const y1 = mesh.instanceMatrix.array[13]!
    expect(y1).toBeLessThan(y0)
    // Long enough for every flake to reach the ground and come back round.
    for (let f = 0; f < 60 * 20; f++) s.update(f / 60, 1 / 60)
    expect(finite(mesh.instanceMatrix.array)).toBe(true)
    for (let i = 0; i < SNOW_MAX; i++) {
      const y = mesh.instanceMatrix.array[i * 16 + 13]!
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(7.01)
    }
    s.dispose()
  })
})

describe('Winter: thicker caps', () => {
  it('the pop-up tower and the pine get snow caps on top of their facet snow; everything finite', () => {
    for (const [base, name] of [[towerGeometry(), 'tower'], [pineGeometry(), 'pine']] as const) {
      const snowy = snowyGeometry(base, name)
      expect(snowy.getAttribute('position').count, name).toBeGreaterThan(base.getAttribute('position').count)
      expect(finite(snowy.getAttribute('position').array as Float32Array)).toBe(true)
      expect(finite(snowy.getAttribute('color').array as Float32Array)).toBe(true)
      // The cap sits on the roof, a hair above its peak at most.
      snowy.computeBoundingBox()
      base.computeBoundingBox()
      expect(snowy.boundingBox!.max.y).toBeLessThan(base.boundingBox!.max.y + 0.15)
    }
  })

  it('the castle\'s winter dress stays as low as the castle wants', () => {
    const g = seasonCastleGeometry('winter', CASTLE.keepZ, CASTLE.towerX, CASTLE.towerZ, CASTLE.keepTop, CASTLE.towerTop)!
    expect(finite(g.getAttribute('position').array as Float32Array)).toBe(true)
    g.computeBoundingBox()
    // The front of the castle (the part over the page's bottom edge) stays under ~1 unit.
    const pos = g.getAttribute('position')
    let maxFront = 0
    for (let i = 0; i < pos.count; i++) if (pos.getZ(i) < 7.2) maxFront = Math.max(maxFront, pos.getY(i))
    expect(maxFront).toBeLessThan(1.1)
  })
})
