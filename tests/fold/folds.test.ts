import { describe, expect, it } from 'vitest'
import {
  FOLD_READY, FOLD_SNAPPED, FOLD_STAMPED, acrossHinge, alongHinge, createFold, damageFold, dragFold, grabFold,
  isBarrier, isStampable, isTrap, onFootprint, releaseFold, revealFold, snapFold, stampFold, updateFold
} from '@/fold/logic/folds'
import { launchFlap, valleyLine, wallLine } from '@/fold/logic/pages'
import { FOLD_SNAP_THRESHOLD } from '@/fold/logic/config'

const run = (f: ReturnType<typeof createFold>, seconds: number): number[] => {
  const moments: number[] = []
  for (let t = 0; t < seconds; t += 1 / 60) {
    const r = updateFold(f, 1 / 60)
    if (r) moments.push(r)
  }
  return moments
}

describe('fold geometry', () => {
  it('a wall flap lies on the enemy side of its hinge', () => {
    const f = createFold(wallLine('w', -1, 1, 0, 2))
    expect(f.nz).toBe(-1)
    expect(onFootprint(f, 0, -1)).toBe(true)
    expect(onFootprint(f, 0, 0.5)).toBe(false)
    expect(alongHinge(f, 0, -1)).toBeCloseTo(1)
    expect(acrossHinge(f, 0, -1)).toBeCloseTo(1)
  })

  it('a valley footprint covers both sides of its centre line', () => {
    const f = createFold(valleyLine('v', -4, 4, 0, 1))
    expect(onFootprint(f, 0, -0.8)).toBe(true)
    expect(onFootprint(f, 0, 0.8)).toBe(true)
    expect(onFootprint(f, 0, 1.3)).toBe(false)
  })

  it('a launch flap lies on the player side (it flings things up the page)', () => {
    const f = createFold(launchFlap('l', -1, 1, 0, 1.5))
    expect(onFootprint(f, 0, 1)).toBe(true)
    expect(onFootprint(f, 0, -1)).toBe(false)
  })
})

describe('fold state machine', () => {
  it('starts hidden, is revealed as ready, and only ready folds can be grabbed', () => {
    const f = createFold(wallLine('w', -1, 1, 0, 2))
    expect(f.phase).toBe('hidden')
    expect(grabFold(f)).toBe(false)
    revealFold(f)
    expect(f.phase).toBe('ready')
    expect(grabFold(f)).toBe(true)
    expect(f.phase).toBe('dragging')
  })

  it('follows the finger while dragging, springs back below the threshold', () => {
    const f = createFold(wallLine('w', -1, 1, 0, 2))
    revealFold(f)
    grabFold(f)
    dragFold(f, FOLD_SNAP_THRESHOLD * 0.6)
    run(f, 0.3)
    expect(f.t).toBeGreaterThan(0.1)
    expect(releaseFold(f, 0)).toBe(false)
    expect(f.phase).toBe('ready')
    run(f, 1)
    expect(f.t).toBe(0)
  })

  it('snaps past the threshold, holds, lowers, cools down and becomes ready again', () => {
    const f = createFold(wallLine('w', -1, 1, 0, 2, { hold: 1, cooldown: 0.5 }))
    revealFold(f)
    grabFold(f)
    dragFold(f, 0.8)
    run(f, 0.1)
    expect(releaseFold(f, 0)).toBe(true)
    const m = run(f, 3)
    expect(m[0]).toBe(FOLD_SNAPPED)
    expect(m).toContain(FOLD_READY)
    expect(f.phase).toBe('ready')
  })

  it('a quick flick snaps even from a short drag', () => {
    const f = createFold(wallLine('w', -1, 1, 0, 2))
    revealFold(f)
    grabFold(f)
    dragFold(f, 0.2)
    expect(releaseFold(f, 8)).toBe(true)
  })

  it('a raised wall is a barrier and stampable; a stamp slams it flat', () => {
    const f = createFold(wallLine('w', -1, 1, 0, 2))
    revealFold(f)
    snapFold(f)
    run(f, 0.5)
    expect(f.phase).toBe('up')
    expect(isBarrier(f)).toBe(true)
    expect(isStampable(f)).toBe(true)
    expect(stampFold(f)).toBe(true)
    const m = run(f, 0.3)
    expect(m).toContain(FOLD_STAMPED)
    expect(f.t).toBe(0)
    expect(isBarrier(f)).toBe(false)
  })

  it('a valley becomes a trap, not a barrier', () => {
    const f = createFold(valleyLine('v', -4, 4, 0, 1))
    revealFold(f)
    snapFold(f)
    run(f, 0.5)
    expect(isTrap(f)).toBe(true)
    expect(isBarrier(f)).toBe(false)
  })

  it('a launch flap is single use', () => {
    const f = createFold(launchFlap('l', -1, 1, 0, 1.5))
    revealFold(f)
    snapFold(f)
    run(f, 0.5)
    expect(f.phase).toBe('spent')
    expect(grabFold(f)).toBe(false)
  })

  it('a battered wall breaks and lowers', () => {
    const f = createFold(wallLine('w', -1, 1, 0, 2, { hp: 2 }))
    revealFold(f)
    snapFold(f)
    run(f, 0.5)
    expect(damageFold(f, 1)).toBe(false)
    expect(damageFold(f, 1)).toBe(true)
    expect(f.phase).toBe('lowering')
  })
})
