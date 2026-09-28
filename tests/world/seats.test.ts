import { describe, expect, it } from 'vitest'
import { Box3 } from 'three'
import { registerAllPlaceables } from '@/world/assets/index'
import { SEAT_HEIGHT, type SeatKind } from '@/world/characters/postures'
import {
  buildWorldSeats,
  resolveSeatFacing,
  SEAT_CATALOGUE,
  SeatFinder,
  SIT_RANGE,
  SitController,
  type WorldSeat
} from '@/world/interaction'
import { getPlaceable } from '@/world/level/catalog'
import type { Placement } from '@/world/level/types'

/**
 * ─── The seat catalogue, against the geometry it claims to describe ─────────
 *
 * `world/interaction/seats.ts` says where the buttocks go on four props. Every
 * number in it is a claim about a mesh that is generated somewhere else, and
 * the two have already come apart once in each direction: `hut-chair`'s seat
 * plank passed its half-extents in the wrong order and rendered as a vertical
 * fin, and `village-bench` was authored 0.155 m higher than the pose that sits
 * on it solves for. Neither typechecks differently and neither fails a test
 * that does not go and measure.
 *
 * So the anchor tests below build the real asset and read the real vertices.
 */

/**
 * Half-width of the patch a sitter actually rests on, metres.
 *
 * A vertex directly over the anchor is not guaranteed to exist — a swept
 * member's rings land where `CAP_T` puts them, not where a test would like
 * them — so the measurement is the highest point of a 30 cm square centred on
 * the anchor, which is roughly the contact patch and is what "the surface the
 * buttocks rest on" means anyway.
 */
const PATCH = 0.15

/** Highest vertex of the built tier-0 mesh within `PATCH` of a local XZ point. */
const surfaceAt = (defId: string, x: number, z: number): number => {
  const definition = getPlaceable(defId)
  expect(definition, `${defId} is in the catalogue`).toBeTruthy()
  const position = definition!.asset.tiers[0]!.getAttribute('position')
  let top = Number.NEGATIVE_INFINITY
  for (let i = 0; i < position.count; i++) {
    if (Math.abs(position.getX(i) - x) > PATCH || Math.abs(position.getZ(i) - z) > PATCH) {
      continue
    }
    top = Math.max(top, position.getY(i))
  }
  return top
}

const placement = (over: Partial<Placement> & { defId: string }): Placement => ({
  id: over.id ?? 'p1',
  defId: over.defId,
  x: over.x ?? 0,
  y: 0,
  z: over.z ?? 0,
  rotY: over.rotY ?? 0,
  scale: over.scale ?? 1,
  ...(over.lift !== undefined ? { lift: over.lift } : {})
})

const seatAt = (x: number, z: number, over: Partial<WorldSeat> = {}): WorldSeat => ({
  placementId: `s-${x}-${z}`,
  defId: 'village-bench',
  kind: 'bench',
  anchorIndex: 0,
  x,
  y: 0.34,
  z,
  yaw: 0,
  facingMode: 'either',
  approach: 0.53,
  ...over
})

/** A `SitActor` whose posture blend the test drives by hand. */
const fakeActor = (x = 0, z = 0) => ({
  x,
  z,
  postureBlend: 0,
  seat: null as SeatKind | null,
  standing: 0,
  sit(seat: SeatKind) {
    this.seat = seat
  },
  stand() {
    this.seat = null
    this.standing++
  }
})

describe('seat catalogue', () => {
  registerAllPlaceables()

  it('names only ids that exist, with a ground offset of zero', () => {
    for (const id of Object.keys(SEAT_CATALOGUE)) {
      const definition = getPlaceable(id)
      expect(definition, `${id} exists`).toBeTruthy()
      // `buildWorldSeats` resolves a seat's height as `terrain + lift + anchor`
      // and never reads the catalogue, so a non-zero `groundOffset` on a
      // sittable prop would sink or float every sitter on it by exactly that
      // much, silently. If one ever needs a non-zero offset, this is the test
      // that has to be changed with it.
      expect(definition!.groundOffset ?? 0, `${id} groundOffset`).toBe(0)
    }
  })

  it('anchors every seat at the height its own posture clip solves for', () => {
    for (const [id, definition] of Object.entries(SEAT_CATALOGUE)) {
      for (const anchor of definition.anchors) {
        expect(anchor.y, `${id} anchor height is SEAT_HEIGHT.${definition.kind}`).toBeCloseTo(
          SEAT_HEIGHT[definition.kind],
          6
        )
      }
    }
  })

  it('puts the chair, stool and bench anchors on their real top faces', () => {
    // A plank's top face is its centre plus a half-thickness inflated by the
    // section's own inscribed-polygon compensation, so ~1 cm of slack is the
    // mesh, not the arithmetic. The bed gets more: its "surface" is a rolled
    // straw edge rather than a board.
    const cases: [string, number][] = [
      ['hut-chair', 0.012],
      ['hut-stool', 0.005],
      ['village-bench', 0.012],
      ['hut-bed', 0.035]
    ]
    for (const [id, tolerance] of cases) {
      const anchor = SEAT_CATALOGUE[id]!.anchors[0]!
      const measured = surfaceAt(id, anchor.x, anchor.z)
      expect(Number.isFinite(measured), `${id} has geometry over its anchor`).toBe(true)
      expect(Math.abs(measured - anchor.y), `${id} top face at its anchor (${measured})`).toBeLessThanOrEqual(
        tolerance
      )
    }
  })

  it('keeps the chair seat a plank rather than a fin', () => {
    // The regression this file was written for. A `beam` with `roll: π/2` puts
    // `halfA` on world up, so passing the *width* there produced a 0.068 m wide,
    // 0.57 m tall blade where the seat should be — and the storyteller sat on it
    // for as long as the room existed.
    const box = new Box3().setFromBufferAttribute(
      getPlaceable('hut-chair')!.asset.tiers[0]!.getAttribute('position') as never
    )
    // The seat plank spans the chair's full width; a fin would leave the widest
    // thing in the mesh being the two stiles at ±0.269.
    expect(box.max.x).toBeGreaterThan(0.26)
    // And nothing between the seat and the crest rail: a fin reached 0.625.
    const overSeat = surfaceAt('hut-chair', 0, 0.08)
    expect(overSeat).toBeLessThan(0.4)
  })

  it('keeps the bench low enough for the solved leg to reach the ground', () => {
    // `seatedLeg` clamps its sine at 0.94, i.e. it gives up above a seat of
    // 0.24 + 0.94 × 0.29 = 0.513 m and hands back a figure with its feet in the
    // air. The bench was 0.495 — inside the clamp by 2 cm, and 61° of thigh
    // decline, which is a crouch.
    expect(surfaceAt('village-bench', 0, 0)).toBeLessThan(0.36)
  })
})

describe('resolving seats into the world', () => {
  it('rotates, scales and lifts an anchor into world space', () => {
    // The bed, turned a quarter turn the way `frame.ts` turns it: local +X
    // (the foot end) becomes world −Z, and local +Z (the room side) becomes
    // world +X.
    const seats = buildWorldSeats([placement({ defId: 'hut-bed', x: 10, z: 20, rotY: Math.PI * 0.5 })], () => 3)
    expect(seats).toHaveLength(1)
    const seat = seats[0]!
    const anchor = SEAT_CATALOGUE['hut-bed']!.anchors[0]!
    expect(seat.x).toBeCloseTo(10 + anchor.z, 6)
    expect(seat.z).toBeCloseTo(20 - anchor.x, 6)
    expect(seat.y).toBeCloseTo(3 + anchor.y, 6)
    expect(seat.yaw).toBeCloseTo(Math.PI * 0.5, 6)
  })

  it('carries a placement lift and scales the anchor with the prop', () => {
    const seats = buildWorldSeats([placement({ defId: 'hut-stool', lift: 0.4, scale: 2 })], () => 1)
    expect(seats[0]!.y).toBeCloseTo(1 + 0.4 + SEAT_HEIGHT.stool * 2, 6)
    expect(seats[0]!.approach).toBeCloseTo(SEAT_CATALOGUE['hut-stool']!.anchors[0]!.approach * 2, 6)
  })

  it('ignores everything that is not a seat', () => {
    const seats = buildWorldSeats(
      [placement({ defId: 'tree-log' }), placement({ defId: 'tree-stump' }), placement({ defId: 'hut-table' })],
      () => 0
    )
    expect(seats).toHaveLength(0)
  })
})

describe('which way a sitter ends up facing', () => {
  it('gives a chair exactly one answer, wherever you came from', () => {
    const chair = seatAt(0, 0, { facingMode: 'fixed', yaw: 0.4 })
    expect(resolveSeatFacing(chair, 0, 5)).toBeCloseTo(0.4, 6)
    expect(resolveSeatFacing(chair, 0, -5)).toBeCloseTo(0.4, 6)
  })

  it('turns a stool to face back the way the sitter came', () => {
    const stool = seatAt(0, 0, { facingMode: 'free', yaw: 1.2 })
    // Approached from +X, so the sitter turns to look at +X: yaw = atan2(1, 0).
    expect(resolveSeatFacing(stool, 5, 0)).toBeCloseTo(Math.PI * 0.5, 6)
    // Approached from −Z: yaw = atan2(0, −1) = π.
    expect(Math.abs(resolveSeatFacing(stool, 0, -5))).toBeCloseTo(Math.PI, 6)
  })

  it('picks whichever of a bench’s two sides the sitter walked from', () => {
    // A bench whose plank runs along world X, so its two legal facings are ±Z.
    const bench = seatAt(0, 0, { facingMode: 'either', yaw: 0 })
    // Walked in from +Z: sit facing +Z, i.e. the seat's own yaw.
    expect(resolveSeatFacing(bench, 0.2, 4)).toBeCloseTo(0, 6)
    // Walked in from −Z: sit facing the other way. This is the one that makes
    // der Treff work — its four benches are laid with local +Z pointing *away*
    // from the fire pit, so a player arriving from the fire has to end up
    // looking back at it.
    expect(Math.abs(resolveSeatFacing(bench, -0.2, -4))).toBeCloseTo(Math.PI, 6)
    // Never along the plank: a sitter approaching from the end still gets one
    // of the two sides, not `atan2` of where they stood.
    const fromTheEnd = resolveSeatFacing(bench, 4, 0.01)
    expect(Math.min(Math.abs(fromTheEnd), Math.abs(Math.abs(fromTheEnd) - Math.PI))).toBeCloseTo(0, 6)
  })
})

describe('finding the seat the camera is on', () => {
  const finderOf = (seats: readonly { x: number; z: number; defId?: string }[]): SeatFinder =>
    new SeatFinder(
      seats.map((s, i) => placement({ id: `p${i}`, defId: s.defId ?? 'village-bench', x: s.x, z: s.z })),
      () => 0
    )

  it('lets aim beat proximity', () => {
    // Yaw 0 looks down +Z. `far` is 3 m dead ahead; `near` is 1 m away and 53°
    // off — inside the cone, three times closer, and it must still lose.
    const finder = finderOf([
      { x: 0, z: 3 },
      { x: 0.8, z: 0.6 }
    ])
    const focus = finder.find(0, 0, 0, 1)
    expect(focus).toBeTruthy()
    expect(focus!.seat.z).toBeCloseTo(3, 6)
    expect(focus!.distance).toBeCloseTo(3, 6)
  })

  it('breaks a tie between two equally-centred seats by distance', () => {
    const finder = finderOf([
      { x: 0, z: 3 },
      { x: 0, z: 1.5 }
    ])
    expect(finder.find(0, 0, 0, 1)!.seat.z).toBeCloseTo(1.5, 6)
  })

  it('refuses anything outside the cone or out of range', () => {
    expect(finderOf([{ x: 0, z: -2 }]).find(0, 0, 0, 1)).toBeNull()
    expect(finderOf([{ x: 0, z: SIT_RANGE + 0.5 }]).find(0, 0, 0, 1)).toBeNull()
  })

  it('follows the camera rather than the player', () => {
    const finder = finderOf([
      { x: 0, z: 2 },
      { x: 2, z: 0 }
    ])
    expect(finder.find(0, 0, 0, 1)!.seat.z).toBeCloseTo(2, 6)
    // Same standing position, camera turned a quarter turn onto +X.
    expect(finder.find(0, 0, 1, 0)!.seat.x).toBeCloseTo(2, 6)
  })

  it('finds seats at negative coordinates, where a naive cell key collides', () => {
    // Der Treff is at (−9, −13) and the bandits' camp at (−74, −92). A cell key
    // packed without the sign offset puts those in the same bucket as points in
    // the positive quadrant, which shows up as a prompt that works in one
    // village and not the other.
    const finder = finderOf([{ x: -74, z: -92 }])
    expect(finder.find(-74, -94, 0, 1)).toBeTruthy()
    expect(finder.find(74, 92, 0, 1)).toBeNull()
  })

  it('allocates nothing per scan', () => {
    const finder = finderOf([
      { x: 0, z: 2 },
      { x: 0.5, z: 2.5 }
    ])
    const first = finder.find(0, 0, 0, 1)
    const second = finder.find(0, 0, 0, 1)
    // The same struct, rewritten. GDD §5.2: nothing on a per-frame path
    // allocates, and a finder that returned a fresh object would be 60 of them
    // a second for the whole chapter.
    expect(first).toBe(second)
  })
})

describe('the sit state machine', () => {
  const seat = seatAt(0, 0, { yaw: 0, approach: 0.5, kind: 'bench' })

  it('walks, sits, holds and stands, and ends where it started', () => {
    const sit = new SitController()
    const actor = fakeActor(0, 4)

    expect(sit.request(seat, actor.x, actor.z)).toBe(true)
    expect(sit.phase).toBe('walking')
    // Approached from +Z, so the sitter faces +Z and the approach point is half
    // a metre out on that side.
    sit.update(1 / 60, actor)
    expect(sit.throttle).toBeGreaterThan(0)
    expect(sit.moveZ).toBeLessThan(0)

    // Teleport the actor onto the approach point, as the walk would.
    actor.x = 0
    actor.z = 0.5
    sit.update(1 / 60, actor)
    expect(sit.phase).toBe('sitting')
    expect(actor.seat).toBe('bench')
    expect(sit.facing).toBeCloseTo(0, 6)
    // And the movement stops the frame the sit begins.
    expect(sit.throttle).toBe(0)

    // Half way into the blend, half way onto the seat.
    actor.postureBlend = 0.5
    sit.update(1 / 60, actor)
    expect(actor.z).toBeCloseTo(0.25, 6)
    expect(sit.phase).toBe('sitting')

    actor.postureBlend = 1
    sit.update(1 / 60, actor)
    expect(sit.phase).toBe('seated')
    expect(actor.x).toBeCloseTo(0, 6)
    expect(actor.z).toBeCloseTo(0, 6)
    expect(sit.seated).toBe(true)

    expect(sit.release(actor)).toBe(true)
    expect(sit.phase).toBe('standing')
    expect(actor.seat).toBeNull()

    actor.postureBlend = 0.5
    sit.update(1 / 60, actor)
    expect(actor.z).toBeCloseTo(0.25, 6)

    actor.postureBlend = 0
    sit.update(1 / 60, actor)
    expect(sit.phase).toBe('idle')
    expect(sit.seat).toBeNull()
    // Back on the approach point, on their feet, holding nothing.
    expect(actor.z).toBeCloseTo(0.5, 6)
    expect(actor.seat).toBeNull()
  })

  it('refuses a second seat while it is busy with one', () => {
    const sit = new SitController()
    const actor = fakeActor(0, 4)
    sit.request(seat, actor.x, actor.z)
    expect(sit.request(seatAt(5, 5), actor.x, actor.z)).toBe(false)
    expect(sit.seat).toBe(seat)
  })

  it('hands the controls straight back when a walk-up is released', () => {
    const sit = new SitController()
    const actor = fakeActor(0, 4)
    sit.request(seat, actor.x, actor.z)
    expect(sit.release(actor)).toBe(true)
    expect(sit.phase).toBe('idle')
    // Nothing was committed, so nothing is undone: no posture was ever taken
    // and the actor has not been moved.
    expect(actor.standing).toBe(0)
    expect(actor.z).toBe(4)
  })

  it('drops a seated actor onto the approach point when the world cancels', () => {
    const sit = new SitController()
    const actor = fakeActor(0, 0.5)
    sit.request(seat, 0, 4)
    sit.update(1 / 60, actor)
    actor.postureBlend = 1
    sit.update(1 / 60, actor)
    expect(sit.phase).toBe('seated')

    sit.cancel(actor)
    expect(sit.phase).toBe('idle')
    expect(sit.seat).toBeNull()
    expect(actor.seat).toBeNull()
    expect(actor.z).toBeCloseTo(0.5, 6)
  })

  it('does not drag an actor back to a seat they have been moved away from', () => {
    // A load, a retry and the cut between the two timeframes all cancel a sit
    // and all three place the player themselves. Writing the approach point
    // unconditionally would teleport a restored save back to a bench in a
    // village the beat has just left, 1.7 km away.
    const sit = new SitController()
    const actor = fakeActor(0, 0.5)
    sit.request(seat, 0, 4)
    sit.update(1 / 60, actor)
    actor.postureBlend = 1
    sit.update(1 / 60, actor)

    actor.x = 1400
    actor.z = 900
    sit.cancel(actor)
    expect(actor.x).toBe(1400)
    expect(actor.z).toBe(900)
    expect(sit.phase).toBe('idle')
  })

  it('gives up on a walk that never arrives', () => {
    const sit = new SitController()
    const actor = fakeActor(0, 4)
    sit.request(seat, actor.x, actor.z)
    // Pinned against something. The stall detector is the one that fires first.
    for (let i = 0; i < 120; i++) {
      sit.update(1 / 60, actor)
    }
    expect(sit.phase).toBe('idle')
    expect(sit.throttle).toBe(0)
    expect(actor.seat).toBeNull()
  })

  it('never leaves an actor mid-blend or bound to a seat', () => {
    // The invariant the whole class exists for, asserted from every phase.
    for (const stop of ['walking', 'sitting', 'seated', 'standing'] as const) {
      const sit = new SitController()
      const actor = fakeActor(0, 0.5)
      sit.request(seat, 0, 4)
      if (stop !== 'walking') {
        sit.update(1 / 60, actor)
        actor.postureBlend = stop === 'sitting' ? 0.4 : 1
        sit.update(1 / 60, actor)
      }
      if (stop === 'standing') {
        sit.release(actor)
        actor.postureBlend = 0.6
        sit.update(1 / 60, actor)
        expect(sit.phase).toBe('standing')
      }
      sit.cancel(actor)
      expect(sit.phase, stop).toBe('idle')
      expect(sit.seat, stop).toBeNull()
      expect(sit.active, stop).toBe(false)
      expect(actor.seat, stop).toBeNull()
    }
  })
})

/**
 * ─── The two yaws ───────────────────────────────────────────────────────────
 *
 * `SeatFinder.find` took a *yaw* until the sandbox was wired to it, and that is
 * when the trap sprang: `StoryPlayer` builds its forward as `(+sin, +cos)` and
 * `PlayerController.groundForward` builds its as `(-sin, -cos)`. The two differ
 * by exactly half a turn, so the sandbox prompt appeared for benches **behind**
 * the player — and then nothing was drawn, because the billboard dutifully
 * projected a point that was behind the camera and found it off-screen.
 *
 * Nothing threw. No budget moved. The feature simply did not appear, which is
 * the same failure shape as the four defects `CLAUDE.md` lists.
 *
 * The method takes a direction now, so there is no convention left to mismatch.
 * These two pin the property that made the bug invisible: the scan is
 * *directional*, and reversing the direction must flip the answer.
 */
describe('the seat scan is directional, not merely near', () => {
  const bench = (x: number, z: number): Placement => ({
    id: `b-${x}-${z}`,
    defId: 'village-bench',
    x,
    y: 0,
    z,
    rotY: 0,
    scale: 1
  })
  const finder = (): SeatFinder => new SeatFinder([bench(0, 2)], () => 0)

  it('finds a seat ahead and not the same seat behind', () => {
    // +Z is where the bench is.
    expect(finder().find(0, 0, 0, 1)).toBeTruthy()
    // Exactly reversed: the same bench, the same distance, and no prompt.
    expect(finder().find(0, 0, 0, -1)).toBeNull()
  })

  it('agrees with both callers own forward, from the same yaw', () => {
    // One yaw, two conventions, opposite answers — the whole of the bug.
    const yaw = Math.PI
    const story = { x: Math.sin(yaw), z: Math.cos(yaw) } // StoryPlayer
    const walker = { x: -Math.sin(yaw), z: -Math.cos(yaw) } // groundForward
    expect(story.z).toBeCloseTo(-1, 6)
    expect(walker.z).toBeCloseTo(1, 6)
    // The bench is at +Z, so the walker's forward is the one that sees it.
    expect(finder().find(0, 0, story.x, story.z)).toBeNull()
    expect(finder().find(0, 0, walker.x, walker.z)).toBeTruthy()
  })
})
