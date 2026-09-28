import { Mesh, SkinnedMesh, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { buildSheepGeometry, SheepFlock, sheepBudgets, SHEEP_BIND, SHEEP_BONE_COUNT } from '@/world/creatures/Sheep'
import { GRAZE_DIP, insideRect, makeGrazer, type Pasture, type Rect, separate, SHEEP_RADIUS, stepGrazer } from '@/world/creatures/grazing'
import { makeRng } from '@/world/geometry/rng'
import { triangleCount } from '@/world/geometry/budget'
import { LOD_DISTANCES } from '@/world/lod/config'
import { HUT_ROOM, SHEEP_PADDOCK } from '@/world/story/frame'

/**
 * ─── The flock, as a contract ───────────────────────────────────────────────
 *
 * `CLAUDE.md` is blunt that a test suite is not what proves a chapter works —
 * four real defects in `/story` typechecked cleanly and passed the whole thing.
 * So this file deliberately does not try to assert how a sheep *looks*. It
 * asserts the four things that are true or false rather than good or bad, and
 * every one of them corresponds to a way this feature can be quietly wrong:
 *
 *   1. **The ladder fits its budgets and falls monotonically.** GDD §4.1.
 *   2. **The mouth reaches the grass.** The player asked for animals that eat,
 *      the graze is a product of eight bone rotations, and "the head goes down a
 *      bit" is indistinguishable from "the head goes down to the turf" in any
 *      screenshot taken from twenty metres. `muzzleAt` is published so this is
 *      answerable at all.
 *   3. **They stay in the paddock and out of the storyteller's kitchen** — over
 *      an hour of simulated wandering, not the ten seconds a browser session
 *      gets. The room's doorway is a 2 m hole in a wall of colliders, so prop
 *      collision alone does not do it.
 *   4. **The flock is one mesh.** The scene it lives in is already 45 draws over
 *      GDD §5.2, and the moment somebody "simplifies" this into five objects it
 *      costs eight more without failing anything else.
 */

const flat = (): ((x: number, z: number) => number) => () => 6

const pasture = (paddock: Rect, keepOut: readonly Rect[] = [], seed = 1): Pasture => ({
  paddock,
  keepOut,
  collision: null,
  y: 6,
  playerX: 0,
  playerZ: 0,
  hasPlayer: false,
  rng: makeRng(seed)
})

// ─── 1. The ladder ──────────────────────────────────────────────────────────

describe('the LOD ladder', () => {
  it.each([0, 1, 2, 3])('LOD%i builds inside its budget', tier => {
    expect(triangleCount(buildSheepGeometry(tier))).toBeLessThanOrEqual(sheepBudgets[tier]!)
  })

  it('falls monotonically — a coarser rung is never larger than a finer one', () => {
    const counts = [0, 1, 2, 3].map(tier => triangleCount(buildSheepGeometry(tier)))
    for (let tier = 1; tier < counts.length; tier++) {
      expect(counts[tier]!, `LOD${tier} vs LOD${tier - 1}`).toBeLessThan(counts[tier - 1]!)
    }
  })

  it('every vertex is finite and rigidly bound to exactly one bone', () => {
    // `assertFiniteGeometry` already throws inside the builder, so reaching this
    // line is half the assertion. The other half is the binding: a weight that
    // is not 1.0 on slot 0 is a vertex that blends two bones, which this rig has
    // no weight painting for and which shows up as a pinched joint, not an error.
    const geometry = buildSheepGeometry(0)
    const weight = geometry.getAttribute('skinWeight').array as Float32Array
    const index = geometry.getAttribute('skinIndex').array as Float32Array
    for (let v = 0; v < weight.length; v += 4) {
      expect(weight[v]).toBe(1)
      expect(weight[v + 1]! + weight[v + 2]! + weight[v + 3]!).toBe(0)
      expect(index[v]).toBeLessThan(SHEEP_BONE_COUNT)
    }
  })

  it('the rig is the eight bones the graze needs, and the neck is one of them', () => {
    expect(SHEEP_BIND.map(b => b.name)).toEqual([
      'hips',
      'chest',
      'neck',
      'head',
      'upperArm.L',
      'upperArm.R',
      'thigh.L',
      'thigh.R'
    ])
    // Standing on the ground, not floating over it or buried in it: the hooves
    // are the origin of the animal's own space, and `place()` puts that origin
    // on the terrain. A model authored 10 cm proud is the defect that put the
    // whole cast inside the floorboards once already.
    const geometry = buildSheepGeometry(0)
    geometry.computeBoundingBox()
    expect(geometry.boundingBox!.min.y).toBeCloseTo(0, 2)
  })
})

// ─── 2. The mouth reaches the grass ─────────────────────────────────────────

describe('grazing puts the muzzle in the grass', () => {
  const flock = new SheepFlock({ count: 3, paddock: SHEEP_PADDOCK, groundAt: flat(), seed: 7 })
  const at = new Vector3()

  /** Forces one animal into a state and runs it long enough for the head to arrive. */
  const settle = (index: number, grazing: boolean): number => {
    const g = flock.grazers[index]!
    for (let frame = 0; frame < 240; frame++) {
      g.state = grazing ? 'graze' : 'alert'
      g.timer = 99
      g.graze = grazing ? 1 : 0
      g.speed = 0
      flock.update(1 / 60, new Vector3(0, 6, 0), 0, 0, false)
    }
    flock.muzzleAt(index, at)
    return at.y - 6
  }

  it('head up, the muzzle is about 0.7 m over the turf', () => {
    expect(settle(0, false)).toBeGreaterThan(0.6)
  })

  it('head down, the muzzle is on the turf', () => {
    // Under 6 cm. Grass blades in this world stand taller than that, so a muzzle
    // here is a muzzle *in* the sward rather than hovering over it.
    const y = settle(0, true)
    expect(y).toBeLessThan(0.06)
    expect(y).toBeGreaterThan(-0.1)
  })

  it('the travel is the 0.7 m the header claims — 36 px at twenty metres', () => {
    const up = settle(1, false)
    const down = settle(1, true)
    // The whole legibility argument rests on this number. A "graze" that moved
    // the head 15 cm would pass every other test in this file and would read, at
    // the distance the player actually stands, as nothing at all.
    expect(up - down).toBeGreaterThan(0.6)
  })

  it('the muzzle ends up ahead of the forefeet, not under the chest', () => {
    settle(2, true)
    const g = flock.grazers[2]!
    // In the animal's own frame: project the muzzle onto its facing.
    const ahead = (at.x - g.x) * Math.sin(g.facing) + (at.z - g.z) * Math.cos(g.facing)
    // The forefeet are at z = 0.30 in bind space.
    expect(ahead).toBeGreaterThan(0.3)
  })

  it('the dip takes about a second — long enough to see, short enough to be a motion', () => {
    const p = pasture(SHEEP_PADDOCK)
    const g = makeGrazer(0, 1, p)
    g.state = 'graze'
    g.timer = 99
    g.graze = 0
    let seconds = 0
    while (g.graze < 1 && seconds < 5) {
      g.timer = 99
      stepGrazer(g, 1 / 60, p)
      seconds += 1 / 60
    }
    expect(seconds).toBeGreaterThan(GRAZE_DIP * 0.9)
    expect(seconds).toBeLessThan(GRAZE_DIP * 1.2)
  })

  it('nothing walks with its face in the grass', () => {
    const p = pasture(SHEEP_PADDOCK)
    const g = makeGrazer(0, 1, p)
    for (let frame = 0; frame < 60 * 600; frame++) {
      const before = g.travelled
      const head = g.graze
      stepGrazer(g, 1 / 60, p)
      if (g.travelled > before) {
        // The gate is `graze < 0.12` *before* the step; allow the frame's own ramp.
        expect(head).toBeLessThan(0.13)
      }
    }
    // And it did actually walk — a test that passes because nothing ever moved
    // is the failure mode this line exists to rule out.
    expect(g.travelled).toBeGreaterThan(20)
  })

  it('spends most of its life with its head down', () => {
    const p = pasture(SHEEP_PADDOCK)
    const g = makeGrazer(0, 1, p)
    let down = 0
    const frames = 60 * 900
    for (let frame = 0; frame < frames; frame++) {
      stepGrazer(g, 1 / 60, p)
      // Half way down already counts — the neck is past horizontal there and the
      // animal reads as eating well before the muzzle lands.
      if (g.graze > 0.5) {
        down++
      }
    }
    // Half the time, at least. The player asked for animals eating grass, and an
    // animal that grazes for two seconds in every fifteen is one that is mostly
    // milling about.
    expect(down / frames).toBeGreaterThan(0.5)
  })
})

// ─── 3. Where they are allowed to be ────────────────────────────────────────

describe('the paddock holds', () => {
  it('half an hour of wandering never leaves it', () => {
    const p = pasture(SHEEP_PADDOCK, [HUT_ROOM], 99)
    const flock = [0, 1, 2, 3, 4].map(i => makeGrazer(i, 5, p))
    // Violations are counted rather than asserted inside the loop: this is 540 k
    // animal-steps and an `expect` per step is thirty seconds of test framework
    // measuring a state machine that takes two.
    let escaped = 0
    let indoors = 0
    let broken = 0
    let ranged = 0
    for (let frame = 0; frame < 60 * 1800; frame++) {
      for (const g of flock) {
        stepGrazer(g, 1 / 60, p)
      }
      separate(flock, p)
      for (const g of flock) {
        if (!Number.isFinite(g.x) || !Number.isFinite(g.z)) {
          broken++
        } else {
          if (!insideRect(SHEEP_PADDOCK, g.x, g.z, 1e-6)) {
            escaped++
          }
          if (insideRect(HUT_ROOM, g.x, g.z, -SHEEP_RADIUS * 0.5)) {
            indoors++
          }
          if (Math.hypot(g.x - g.homeX, g.z - g.homeZ) > 9) {
            ranged++
          }
        }
      }
    }
    expect({ broken, escaped, indoors, ranged }).toEqual({ broken: 0, escaped: 0, indoors: 0, ranged: 0 })
    // And they went somewhere. A paddock nobody moves in is trivially airtight.
    expect(flock.reduce((sum, g) => sum + g.travelled, 0)).toBeGreaterThan(500)
  })

  it('a sheep put down inside the storyteller’s room is walked out of it', () => {
    // The doorway case, forced: the room is a keep-out and an animal that starts
    // inside one has to leave rather than settle there. The paddock is widened to
    // cover the room so the clamp is not what does the work.
    const wide: Rect = { x: HUT_ROOM.x, z: HUT_ROOM.z + 8, halfX: 14, halfZ: 18 }
    const p = pasture(wide, [HUT_ROOM])
    const g = makeGrazer(0, 1, p)
    g.x = HUT_ROOM.x
    g.z = HUT_ROOM.z
    stepGrazer(g, 1 / 60, p)
    expect(insideRect(HUT_ROOM, g.x, g.z, 0)).toBe(false)
  })

  it('the player pushes them out of the way instead of through them', () => {
    const p = pasture(SHEEP_PADDOCK)
    const g = makeGrazer(0, 1, p)
    g.state = 'graze'
    g.graze = 1
    g.timer = 99
    p.hasPlayer = true
    p.playerX = g.x
    p.playerZ = g.z + 0.4
    const before = Math.hypot(g.x - p.playerX, g.z - p.playerZ)
    for (let frame = 0; frame < 120; frame++) {
      stepGrazer(g, 1 / 60, p)
    }
    expect(Math.hypot(g.x - p.playerX, g.z - p.playerZ)).toBeGreaterThan(before)
    // And the head came up on the way. A sheep that flees with its face in the
    // grass is the same bug as one that walks with it there.
    expect(g.graze).toBeLessThan(0.2)
  })

  it('flockmates never stand inside one another', () => {
    const p = pasture(SHEEP_PADDOCK, [HUT_ROOM], 4)
    const flock = [0, 1, 2, 3, 4].map(i => makeGrazer(i, 5, p))
    // Everyone in one spot, which is the worst case and also what a bad spawn
    // would produce.
    for (const g of flock) {
      g.x = SHEEP_PADDOCK.x
      g.z = SHEEP_PADDOCK.z
    }
    for (let frame = 0; frame < 600; frame++) {
      for (const g of flock) {
        stepGrazer(g, 1 / 60, p)
      }
      separate(flock, p)
    }
    for (let i = 0; i < flock.length; i++) {
      for (let j = i + 1; j < flock.length; j++) {
        const a = flock[i]!
        const b = flock[j]!
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(SHEEP_RADIUS * 2 * 0.9)
      }
    }
  })
})

// ─── 4. It is one mesh ──────────────────────────────────────────────────────

describe('the flock costs what it claims to', () => {
  const flock = new SheepFlock({ count: 5, paddock: SHEEP_PADDOCK, groundAt: flat(), seed: 3 })

  const meshes = (): Mesh[] => {
    const found: Mesh[] = []
    flock.group.traverseVisible(object => {
      if ((object as Mesh).isMesh) {
        found.push(object as Mesh)
      }
    })
    return found
  }

  it('five animals are four bodies and two hulls, whatever the count', () => {
    let all = 0
    flock.group.traverse(object => {
      if ((object as Mesh).isMesh) {
        all++
      }
    })
    // Four rungs plus a hull on LOD0 and LOD1 (GDD R6). Not 5 × anything.
    expect(all).toBe(6)
  })

  it('is two draw calls up close and one past the outline', () => {
    // Well inside LOD0 and clear of its crossfade band.
    flock.update(1 / 60, new Vector3(SHEEP_PADDOCK.x, 6, SHEEP_PADDOCK.z), 0, 0, false)
    expect(flock.lodTier).toBe(0)
    expect(meshes()).toHaveLength(2)

    // Past LOD1, where the hull is dropped.
    flock.update(1 / 60, new Vector3(SHEEP_PADDOCK.x, 6, SHEEP_PADDOCK.z + LOD_DISTANCES[1]! + 40), 0, 0, false)
    expect(flock.lodTier).toBe(2)
    expect(meshes()).toHaveLength(1)
  })

  it('crossfades rather than swapping — two rungs draw inside a band', () => {
    // GDD R7: a hard LOD swap is a bug. Inside LOD0's band both rungs are up and
    // their coverages are complementary, which is what makes the silhouette
    // neither thin nor double.
    //
    // One animal, because the ladder measures the *nearest* one and a flock
    // spread over 18 m has no single distance to aim a camera at.
    const one = new SheepFlock({ count: 1, paddock: SHEEP_PADDOCK, groundAt: flat(), seed: 11 })
    const only = one.grazers[0]!
    one.update(1 / 60, new Vector3(only.x, 6, only.z + LOD_DISTANCES[0]! + 1.5), 0, 0, false)
    let drawn = 0
    one.group.traverseVisible(object => {
      if ((object as SkinnedMesh).isSkinnedMesh) {
        drawn++
      }
    })
    // Both bodies plus both hulls.
    expect(drawn).toBe(4)
    one.dispose()
  })

  it('every rung shares the one skeleton, so a switch never re-binds a skin', () => {
    const skeletons = new Set<unknown>()
    flock.group.traverse(object => {
      if ((object as SkinnedMesh).isSkinnedMesh) {
        skeletons.add((object as SkinnedMesh).skeleton)
      }
    })
    expect(skeletons.size).toBe(1)
    // 5 animals x 8 bones. The stamping is what makes one mesh five sheep, and
    // an off-by-one here poses the wrong animal's neck.
    expect([...skeletons][0]).toHaveProperty('bones')
    expect((([...skeletons][0] as { bones: unknown[] }).bones).length).toBe(5 * SHEEP_BONE_COUNT)
  })

  it('parks by disappearing, not by going underground', () => {
    flock.setActive(false)
    expect(flock.group.visible).toBe(false)
    const before = flock.grazers[0]!.travelled
    for (let frame = 0; frame < 600; frame++) {
      flock.update(1 / 60, new Vector3(0, 0, 0), 0, 0, true)
    }
    // Nothing advanced. A flock that kept wandering through twenty minutes of
    // Arlaan would come back to the island having drifted en masse into a fence.
    expect(flock.grazers[0]!.travelled).toBe(before)
    flock.setActive(true)
    expect(flock.group.visible).toBe(true)
  })

  it('stands on the ground it is given, not on the terrain it was built over', () => {
    const sloped = new SheepFlock({
      count: 2,
      paddock: SHEEP_PADDOCK,
      groundAt: (x: number) => x * 0.01,
      seed: 5
    })
    sloped.update(1 / 60, new Vector3(SHEEP_PADDOCK.x, 6, SHEEP_PADDOCK.z), 0, 0, false)
    for (const [index, g] of sloped.grazers.entries()) {
      const at = new Vector3()
      sloped.muzzleAt(index, at)
      // Head up or down, the mouth is somewhere between the animal's own feet
      // and the top of its back — never 400 m under the world, which is the
      // shape of the defect that put the whole cast underground once already.
      expect(at.y - g.x * 0.01).toBeGreaterThan(-0.1)
      expect(at.y - g.x * 0.01).toBeLessThan(1.1)
    }
    sloped.dispose()
  })
})
