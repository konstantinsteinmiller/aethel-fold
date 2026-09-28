import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { Character } from '@/world/characters/Character'
import { Combatant } from '@/world/combat/Combatant'
import { CombatDirector } from '@/world/combat/CombatDirector'
import { movesetFor, STATS } from '@/world/combat/movesets'

/**
 * ─── Getting back up ────────────────────────────────────────────────────────
 *
 * Death in this game is a pose rather than a ragdoll: `CombatDirector.settle`
 * tips the whole figure 77 degrees about X and sinks it, which is what the
 * budget allows and reads correctly at every distance a fight happens at.
 *
 * The pose is applied to the **scene graph**, and `Combatant.revive` resets only
 * the numbers a fight reads — it holds no reference to a `Character` and cannot
 * undo it. So for a long time nothing did, and the consequence was invisible
 * until something revived a corpse on screen:
 *
 *   * a player who died and pressed Retry stood up at 77 degrees and played the
 *     rest of the chapter lying down;
 *   * Chapter 2 opens on the five bandits Chapter 1 ends by routing — which
 *     kills them — and every one of them held their conversation on their back.
 *
 * The second one is how it was found, in a browser, with the dialogue camera
 * two metres behind a head at ankle height.
 */

const makeCombatant = (id: string): Combatant =>
  new Combatant({
    id,
    team: 'bandits',
    stats: STATS.bandit,
    moveset: movesetFor('sword'),
    x: 0,
    y: 0,
    z: 0,
    facing: 0
  })

describe('a revived figure', () => {
  it('stands back up rather than staying tipped over', () => {
    const director = new CombatDirector(
      () => 0,
      () => null
    )
    const combatant = makeCombatant('bandit-test')
    const character = new Character({ outline: false })
    director.add({ id: 'bandit-test', combatant, character, brain: 'none' })

    const camera = new Vector3(0, 2, 8)

    // Alive and upright to begin with.
    director.update(1 / 60, camera)
    expect(character.group.rotation.x).toBe(0)

    // Killed: the tip is the death pose.
    combatant.kill()
    director.update(1 / 60, camera)
    expect(character.group.rotation.x).toBeLessThan(-1)

    // Revived: back on their feet, and the *scene graph* has to agree.
    combatant.revive()
    director.update(1 / 60, camera)
    expect(character.group.rotation.x, 'revived and still tipped over').toBe(0)

    character.dispose()
  })
})
