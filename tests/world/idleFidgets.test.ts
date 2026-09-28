import { Bone, Group, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { CombatDirector, type CombatBody } from '@/world/combat/CombatDirector'
import { Combatant } from '@/world/combat/Combatant'
import { movesetFor, STATS } from '@/world/combat/movesets'
import { applyFidget, FIDGET_SECONDS, Fidgets } from '@/world/characters/fidgets'
import { BONE_NAMES, type BoneName } from '@/world/characters/rig'
import type { PoseTargets } from '@/world/characters/poses'

/** A rig of real `Bone`s, so a gesture can be read back off it. */
const makeBones = (): Map<BoneName, Bone> => {
  const bones = new Map<BoneName, Bone>()
  for (const name of BONE_NAMES) {
    bones.set(name, new Bone())
  }
  return bones
}

const targets = (bones: Map<BoneName, Bone>): PoseTargets => ({ get: name => bones.get(name) })

/**
 * ─── A person waiting is not a paused video ─────────────────────────────────
 *
 * `CombatDirector.update` freezes during a dialogue beat and calls `settle` so
 * the cast still stands where the story put them. It used to pass `dt = 0` on
 * that path, and `Character.update` returns *before* `resetPose` when the delta
 * is zero — so the figure kept whatever pose the last moving frame left on it.
 * The player ran up to somebody, pressed the key, and stood through the whole
 * conversation frozen mid-stride with one foot off the ground.
 *
 * That is the defect these tests exist for, and it is a good example of the kind
 * this project keeps finding: nothing threw, nothing was out of budget, and the
 * suite was green.
 */
describe('the frozen dialogue path', () => {
  const buildDirector = (): { director: CombatDirector; seen: number[]; body: CombatBody } => {
    const seen: number[] = []
    const bones = makeBones()
    const body: CombatBody = {
      group: new Group(),
      bones,
      setPosition: () => {},
      setFacing: () => {},
      update: (dt: number) => {
        seen.push(dt)
      }
    }
    const director = new CombatDirector(
      () => 0,
      () => null
    )
    const combatant = new Combatant({
      id: 'test',
      team: 'party',
      stats: STATS.villager ?? Object.values(STATS)[0]!,
      moveset: movesetFor(null),
      weapon: null
    })
    director.add({ id: 'test', combatant, character: body, brain: 'none' })
    return { director, seen, body }
  }

  it('still poses the cast while combat is disabled', () => {
    const { director, seen } = buildDirector()
    director.enabled = false
    director.update(1 / 60, new Vector3())
    expect(seen).toHaveLength(1)
  })

  /**
   * The assertion the fix is actually about. A zero delta is what froze the
   * stride; anything that hands the body a real one lets the gait decay into
   * the idle on its own.
   */
  it('hands the body the real frame delta, not zero', () => {
    const { director, seen } = buildDirector()
    director.enabled = false
    director.update(1 / 60, new Vector3())
    director.update(1 / 30, new Vector3())
    expect(seen).toEqual([1 / 60, 1 / 30])
  })

  it('does not advance combat clocks while disabled', () => {
    const { director } = buildDirector()
    const combatant = director.get('test')!
    const before = combatant.stanceTime
    director.enabled = false
    for (let i = 0; i < 60; i++) {
      director.update(1 / 60, new Vector3())
    }
    expect(combatant.stanceTime).toBe(before)
  })
})

describe('idle fidgets', () => {
  /**
   * Both ends of every gesture have to be the idle pose exactly, or the
   * character snaps into and out of it. The envelope is the only thing
   * guaranteeing that, and it is one line that is easy to "simplify".
   */
  it('starts and ends every gesture at the idle pose', () => {
    for (const kind of Object.keys(FIDGET_SECONDS) as (keyof typeof FIDGET_SECONDS)[]) {
      for (const t of [0, 1]) {
        const bones = makeBones()
        applyFidget(targets(bones), kind, t)
        for (const [name, bone] of bones) {
          const moved = Math.abs(bone.rotation.x) + Math.abs(bone.rotation.y) + Math.abs(bone.rotation.z)
          expect(moved, `${kind} moves ${name} at t = ${t}`).toBeLessThan(1e-6)
        }
      }
    }
  })

  /**
   * Swept rather than sampled at t = 0.5, and that is not defensive coding:
   * `lookAround` turns the head one way, back through centre, and the other, so
   * its midpoint is *exactly* the neutral pose. A single sample there reported
   * it as a no-op at 6.6e-17. The question this test is asking is whether a
   * gesture does anything at all across its run, so it has to look across it.
   */
  it('actually moves bones somewhere in every gesture', () => {
    for (const kind of Object.keys(FIDGET_SECONDS) as (keyof typeof FIDGET_SECONDS)[]) {
      let peak = 0
      for (let step = 1; step < 20; step++) {
        const bones = makeBones()
        applyFidget(targets(bones), kind, step / 20)
        let total = 0
        for (const bone of bones.values()) {
          total += Math.abs(bone.rotation.x) + Math.abs(bone.rotation.y) + Math.abs(bone.rotation.z)
        }
        peak = Math.max(peak, total)
      }
      expect(peak, `${kind} is a no-op`).toBeGreaterThan(0.05)
    }
  })

  /**
   * Additive on a pose that is reset every frame, so applying the same instant
   * twice must give the same answer as applying it once — the trap
   * `combat/postures.ts` documents for the hip lift, from the other side.
   * Nothing here writes `position`, and this is what keeps that true.
   */
  it('writes no bone positions, only rotations', () => {
    for (const kind of Object.keys(FIDGET_SECONDS) as (keyof typeof FIDGET_SECONDS)[]) {
      const bones = makeBones()
      applyFidget(targets(bones), kind, 0.5)
      for (const [name, bone] of bones) {
        expect(bone.position.lengthSq(), `${kind} moved ${name}.position`).toBe(0)
      }
    }
  })

  it('fires within a few seconds of standing still, and keeps firing', () => {
    const fidgets = new Fidgets(3)
    let played = 0
    let last: string | null = null
    for (let i = 0; i < 60 * 90; i++) {
      fidgets.update(1 / 60, 1)
      if (fidgets.playing !== null && last === null) {
        played++
      }
      last = fidgets.playing
    }
    // 90 seconds at a 5–13 s gap plus a 2–3.6 s gesture is at least five.
    expect(played).toBeGreaterThanOrEqual(5)
  })

  it('abandons a gesture the moment the character walks off', () => {
    const fidgets = new Fidgets(11)
    for (let i = 0; i < 60 * 20 && fidgets.playing === null; i++) {
      fidgets.update(1 / 60, 1)
    }
    expect(fidgets.playing, 'nothing ever started').not.toBeNull()
    fidgets.update(1 / 60, 0)
    expect(fidgets.playing).toBeNull()
  })

  /**
   * Two figures built from the same cast row must not gesture in unison — five
   * people round a table scratching their heads on the same frame is worse than
   * five standing still. `Character` seeds them from a construction counter;
   * this checks the seed actually separates them.
   */
  it('keeps two differently-seeded schedulers out of step', () => {
    const a = new Fidgets(1)
    const b = new Fidgets(2)
    let together = 0
    let apart = 0
    for (let i = 0; i < 60 * 120; i++) {
      a.update(1 / 60, 1)
      b.update(1 / 60, 1)
      if (a.playing !== null && b.playing !== null) {
        together++
      } else if (a.playing !== null || b.playing !== null) {
        apart++
      }
    }
    expect(apart).toBeGreaterThan(together)
  })
})
