import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { Character } from '@/world/characters/Character'

/**
 * ─── Motion drives the animation, never the other way round ─────────────────
 *
 * The demo used to declare a character's speed and compute its facing by hand,
 * and got the facing formula a quarter turn out — the characters walked
 * sideways and backwards. Nothing caught it, because nothing tied the animation
 * to the movement.
 *
 * A `Character` now *measures* its own velocity and derives speed, gait, heading
 * and bank from it, so the two cannot disagree. These tests assert that
 * relationship directly: move the character, then check where it points and how
 * fast it thinks it is going.
 */

const stepped = (from: Vector3, to: Vector3, seconds = 1, steps = 30): Character => {
  const character = new Character({ outline: false })
  character.setPosition(from)
  const dt = seconds / steps
  const at = new Vector3()
  for (let i = 1; i <= steps; i++) {
    at.lerpVectors(from, to, i / steps)
    character.setPosition(at)
    character.update(dt)
  }
  return character
}

/** Where the character's own forward (+Z, rotated by its yaw) points. */
const forwardOf = (character: Character): Vector3 =>
  new Vector3(Math.sin(character.group.rotation.y), 0, Math.cos(character.group.rotation.y))

describe('character facing', () => {
  it('faces +Z when walking toward +Z', () => {
    const character = stepped(new Vector3(0, 0, 0), new Vector3(0, 0, 4))
    const forward = forwardOf(character)
    expect(forward.z).toBeGreaterThan(0.98)
  })

  it('faces +X when walking toward +X', () => {
    // The case the hand-written formula got wrong: a quarter turn out reads as
    // walking sideways, and it only shows on an axis you did not test.
    const character = stepped(new Vector3(0, 0, 0), new Vector3(4, 0, 0))
    const forward = forwardOf(character)
    expect(forward.x).toBeGreaterThan(0.98)
  })

  it('never walks backwards, on any heading', () => {
    // The complaint that prompted this. Swept over the whole circle rather than
    // a couple of axes, because a sign or swap error hides on three of the four.
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2
      const to = new Vector3(Math.sin(angle) * 4, 0, Math.cos(angle) * 4)
      const character = stepped(new Vector3(0, 0, 0), to)
      const forward = forwardOf(character)
      const travel = to.clone().normalize()
      // Dot of 1 is facing straight along the travel; −1 is walking backwards.
      expect(forward.dot(travel), `heading ${((angle * 180) / Math.PI).toFixed(0)}deg`).toBeGreaterThan(0.97)
    }
  })

  it('turns at a bounded rate rather than snapping', () => {
    // A person pivots. Snapping to a new heading in one frame is the tell of a
    // facing assigned rather than steered.
    const character = new Character({ outline: false })
    character.setPosition(new Vector3(0, 0, 0))
    character.setFacing(0)
    // One frame of travel in the exact opposite direction.
    character.setPosition(new Vector3(0, 0, -0.05))
    character.update(1 / 60)
    expect(Math.abs(character.group.rotation.y)).toBeLessThan(Math.PI * 0.5)
  })
})

describe('character speed', () => {
  it('measures the speed it actually travelled', () => {
    const character = stepped(new Vector3(0, 0, 0), new Vector3(0, 0, 3), 1)
    // 3 m in 1 s, smoothed — close to 3, and certainly not zero or declared.
    expect(character.speed).toBeGreaterThan(2.4)
    expect(character.speed).toBeLessThan(3.2)
  })

  it('settles to standing when the character stops', () => {
    const character = stepped(new Vector3(0, 0, 0), new Vector3(0, 0, 3), 1)
    const still = new Vector3(0, 0, 3)
    for (let i = 0; i < 120; i++) {
      character.setPosition(still)
      character.update(1 / 60)
    }
    expect(character.speed).toBeLessThan(0.05)
    expect(character.state).toBe('idle')
  })

  it('picks its own gait from how fast it is going', () => {
    const walking = stepped(new Vector3(0, 0, 0), new Vector3(0, 0, 1.6), 1)
    const running = stepped(new Vector3(0, 0, 0), new Vector3(0, 0, 5.5), 1)
    expect(walking.state).toBe('walk')
    expect(running.state).toBe('run')
  })
})

describe('jump', () => {
  it('owns the body until it completes, then restores the gait', () => {
    const character = new Character({ outline: false })
    character.setPosition(new Vector3(0, 0, 0))
    character.jump()
    expect(character.state).toBe('jump')
    for (let i = 0; i < 30; i++) {
      character.update(1 / 60)
    }
    expect(character.state).toBe('jump')
    for (let i = 0; i < 90; i++) {
      character.update(1 / 60)
    }
    expect(character.state).not.toBe('jump')
  })

  it('reports airborne only between the drive and the landing', () => {
    const character = new Character({ outline: false })
    character.setPosition(new Vector3(0, 0, 0))
    expect(character.airborne).toBe(false)
    character.jump()
    character.update(0.05)
    // Still crouching.
    expect(character.airborne).toBe(false)
    for (let i = 0; i < 25; i++) {
      character.update(1 / 60)
    }
    expect(character.airborne).toBe(true)
  })

  it('ignores a second jump while one is running', () => {
    const character = new Character({ outline: false })
    character.setPosition(new Vector3(0, 0, 0))
    character.jump()
    character.update(0.3)
    character.jump()
    // The clip must not restart, or a held key produces a permanent crouch.
    for (let i = 0; i < 45; i++) {
      character.update(1 / 60)
    }
    expect(character.state).not.toBe('jump')
  })
})
