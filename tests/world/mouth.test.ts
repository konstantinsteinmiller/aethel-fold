import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { buildChibiGeometry, CHIBI_TIERS } from '@/world/characters/chibiGeometry'
import { DEFAULT_APPEARANCE, type CharacterAppearance } from '@/world/characters/equipment'
import { HEAD, MOUTH_STYLES } from '@/world/characters/face'
import { applyMouth, captureMouth } from '@/world/characters/mouth'

/**
 * ─── The eight vertices that make a chibi talk ──────────────────────────────
 *
 * `mouth.ts` writes straight into a live position buffer, which is the cheapest
 * thing it could do and also the least forgiving: there is no material, no
 * animation system and no validation between it and the screen. The failures it
 * can produce are correspondingly blunt — a mouth that opens *upward*, a mouth
 * that sinks into the chin and vanishes, or a NaN that fails the skinned mesh's
 * bounding-sphere test and takes the entire character out of the frame.
 *
 * So this suite is mostly about direction and about staying finite.
 */

const build = (appearance: CharacterAppearance = DEFAULT_APPEARANCE, tier = 0) =>
  buildChibiGeometry(
    undefined,
    tier === 0 ? 'chibi/LOD0' : `chibi/LOD${tier}`,
    appearance,
    null,
    null,
    undefined,
    undefined,
    tier
  )

const vertexAt = (geometry: ReturnType<typeof build>['geometry'], i: number): Vector3 => {
  const position = geometry.getAttribute('position')
  return new Vector3(position.getX(i), position.getY(i), position.getZ(i))
}

describe('capturing a mouth', () => {
  it('finds one on every mouth style', () => {
    for (const mouth of MOUTH_STYLES) {
      const { geometry, blocks } = build({ ...DEFAULT_APPEARANCE, mouth })
      expect(captureMouth(geometry, blocks.face), mouth).not.toBeNull()
    }
  })

  /**
   * From LOD1 out the face is gone entirely (`CHIBI_TIERS[n].face`), so there is
   * no mouth to find and the correct answer is null rather than a rig pointing
   * at whatever eight vertices happen to sit at that offset — which on a shorter
   * buffer would be somebody's ear.
   */
  it('returns null on the tiers that have no face', () => {
    for (let tier = 1; tier < CHIBI_TIERS.length; tier++) {
      expect(CHIBI_TIERS[tier]!.face, `tier ${tier}`).toBe(false)
      const { geometry, blocks } = build(DEFAULT_APPEARANCE, tier)
      expect(captureMouth(geometry, blocks.face), `tier ${tier}`).toBeNull()
    }
  })

  it('points its outward axis away from the face, not into it', () => {
    const { geometry, blocks } = build()
    const rig = captureMouth(geometry, blocks.face)!
    // The rig faces +Z. A negative one here is the cross product coming out the
    // wrong way round, and it turns the anti-clipping bulge into a dent that
    // buries the lower lip in the chin.
    expect(rig.outZ).toBeGreaterThan(0.5)
    /**
     * The separation axis is up — but **tangent to the face, not world up**.
     * `face.ts` walks its frame down the curve of the head to place the mouth,
     * so at the mouth the frame is tilted about 34 degrees forward (measured:
     * `upY` = 0.83). That is the correct axis for lips to part along, and it is
     * the reason the anti-clipping bulge is expressed in this frame rather than
     * in world space — both vectors are tangent-frame or neither works.
     */
    expect(rig.upY).toBeGreaterThan(0.6)
    expect(rig.upY).toBeLessThan(1)
  })
})

describe('opening a mouth', () => {
  it('drops the lower lip further than it lifts the upper', () => {
    const { geometry, blocks } = build()
    const rig = captureMouth(geometry, blocks.face)!
    const topBefore = vertexAt(geometry, rig.start)
    const bottomBefore = vertexAt(geometry, rig.start + 1)

    expect(applyMouth(rig, geometry, 1)).toBe(true)

    const topAfter = vertexAt(geometry, rig.start)
    const bottomAfter = vertexAt(geometry, rig.start + 1)
    // A jaw hinges: the skull does not move.
    expect(bottomBefore.y - bottomAfter.y).toBeGreaterThan(topAfter.y - topBefore.y)
    expect(topAfter.y).toBeGreaterThan(topBefore.y)
    expect(bottomAfter.y).toBeLessThan(bottomBefore.y)
  })

  /**
   * ── The one that caught a real bug ──────────────────────────────────────
   *
   * The mouth must stay *on the head*, at every openness. The first version
   * pushed the lips outward by 0.9 of the distance they travelled, reasoned from
   * "a round head recedes under a dropping lip". It does not, here: `face.ts`
   * builds the mouth on a **tangent** frame, so sliding along it already follows
   * the skull. Measured in the browser, the lower lip ended up 259.4 mm from the
   * head centre on a head of radius 250 — hovering 9 mm clear of the face, in
   * the one shot framed on that face.
   *
   * Asserted as a distance from the head's own centre rather than as "z goes up",
   * because "z goes up" is exactly what the broken version did.
   */
  it('keeps every lip vertex on the surface of the head', () => {
    const { geometry, blocks } = build()
    const rig = captureMouth(geometry, blocks.face)!
    const centre = new Vector3(HEAD.centre[0], HEAD.centre[1], HEAD.centre[2])
    const shut: number[] = []
    for (let i = 0; i < 8; i++) {
      shut.push(vertexAt(geometry, rig.start + i).distanceTo(centre))
    }
    for (const amount of [0.25, 0.5, 0.75, 1]) {
      applyMouth(rig, geometry, amount)
      for (let i = 0; i < 8; i++) {
        const moved = vertexAt(geometry, rig.start + i).distanceTo(centre)
        // Within a millimetre of where it started, in or out. The decal's own
        // lift is 4.5 mm, so a millimetre of play is invisible and 9 mm is not.
        expect(Math.abs(moved - shut[i]!), `vertex ${i} at ${amount}`).toBeLessThan(0.001)
      }
    }
  })

  it('opens the middle wider than the corners', () => {
    const { geometry, blocks } = build()
    const rig = captureMouth(geometry, blocks.face)!
    const cornerBefore = vertexAt(geometry, rig.start + 1)
    const middleBefore = vertexAt(geometry, rig.start + 3)
    applyMouth(rig, geometry, 1)
    const corner = cornerBefore.y - vertexAt(geometry, rig.start + 1).y
    const middle = middleBefore.y - vertexAt(geometry, rig.start + 3).y
    expect(middle).toBeGreaterThan(corner)
    // But the corner still moves — pinned, not welded.
    expect(corner).toBeGreaterThan(0)
  })

  /**
   * Written from `base` every time, never accumulated. An incremental version
   * drifts, and the drift is a mouth that slides off the chin over the course of
   * a long conversation — invisible for the first minute and unmistakable after.
   */
  it('returns exactly to where it started', () => {
    const { geometry, blocks } = build()
    const rig = captureMouth(geometry, blocks.face)!
    const before: number[] = []
    for (let i = 0; i < 8; i++) {
      const v = vertexAt(geometry, rig.start + i)
      before.push(v.x, v.y, v.z)
    }
    for (const amount of [0.3, 1, 0.7, 0.2, 0.9, 0.44, 0]) {
      applyMouth(rig, geometry, amount)
    }
    const after: number[] = []
    for (let i = 0; i < 8; i++) {
      const v = vertexAt(geometry, rig.start + i)
      after.push(v.x, v.y, v.z)
    }
    expect(after).toEqual(before)
  })

  it('never writes a NaN, at any amount including the silly ones', () => {
    const { geometry, blocks } = build()
    const rig = captureMouth(geometry, blocks.face)!
    for (const amount of [-1, -0.001, 0, 0.5, 1, 2, 1e9, Number.NaN]) {
      applyMouth(rig, geometry, amount)
      for (let i = 0; i < 8; i++) {
        const v = vertexAt(geometry, rig.start + i)
        expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z), `at ${amount}`).toBe(true)
      }
    }
  })

  it('skips the write when nothing changed', () => {
    const { geometry, blocks } = build()
    const rig = captureMouth(geometry, blocks.face)!
    expect(applyMouth(rig, geometry, 0.5)).toBe(true)
    expect(applyMouth(rig, geometry, 0.5)).toBe(false)
    expect(applyMouth(rig, geometry, 0.5000001)).toBe(false)
    expect(applyMouth(rig, geometry, 0.6)).toBe(true)
  })

  /**
   * Eight vertices, not the whole figure. A full attribute upload is ~11 KB a
   * frame per speaker for the benefit of 96 bytes of it.
   */
  it('uploads only the mouth', () => {
    const { geometry, blocks } = build()
    const rig = captureMouth(geometry, blocks.face)!
    applyMouth(rig, geometry, 0.8)
    const position = geometry.getAttribute('position') as { updateRanges: { start: number; count: number }[] }
    expect(position.updateRanges).toHaveLength(1)
    expect(position.updateRanges[0]!.count).toBe(24)
    expect(position.updateRanges[0]!.start).toBe(rig.start * 3)
    // And a second write does not stack a second window on top of the first.
    applyMouth(rig, geometry, 0.2)
    expect(position.updateRanges).toHaveLength(1)
  })
})
