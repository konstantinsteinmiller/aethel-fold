import { Group, type Vector3 } from 'three'
import { Character } from '../characters/Character'
import { CharacterEquipment, gearMaterials, variantOf } from '../characters/CharacterEquipment'
import { GearInstancer } from '../characters/GearInstancer'
import { professionAppearance, professionLoadout } from '../characters/professions'
import type { NpcSpawn, NpcStore } from './spawns'

/**
 * ─── The crowd ──────────────────────────────────────────────────────────────
 *
 * Turns a list of `NpcSpawn` records into figures standing in the world, and —
 * more importantly — decides **which ones**. A town can hold five hundred
 * spawns; the scene can afford about a dozen figures. This class is the whole of
 * that decision.
 *
 * ── Why a pool and not a character per spawn ────────────────────────────────
 *
 * A `Character` is two draw calls, one shadow draw, a skeleton, two skinned
 * meshes and ~1000 triangles, plus two more draws per socketed item. Six or
 * seven draws each, against GDD §5.2's **ceiling of 180 for the whole scene** —
 * of which the terrain, the props and the grass have already spent most. A
 * hundred NPCs is ~700 draws on its own and the frame is gone.
 *
 * So there are `budget` figures, they are recycled, and the nearest `budget`
 * spawns are the ones wearing them. What is not near enough is not built at all
 * — not built and hidden, not built at a coarse LOD: **not built**. That is not
 * a compromise, it is the only shape that scales, and it is the same argument
 * `InstancedLodField` makes for props with the opposite answer (props can be
 * instanced; a skinned figure with its own pose cannot).
 *
 * ── Why re-assignment is rate-limited ───────────────────────────────────────
 *
 * Dressing a slot in a new person is a full body rebuild — `Character.ts`
 * measures it at **1.4 ms median, 3.1 ms worst** — plus re-socketing whatever
 * they carry. Twelve of those in one frame is 17 ms and a visible hitch, and it
 * would happen every time the player rounded a corner into a new street. So at
 * most `REBUILDS_PER_FRAME` slots change hands per frame and the rest wait; a
 * villager arriving two frames late is invisible, a dropped frame is not.
 *
 * ── Why the search is throttled ─────────────────────────────────────────────
 *
 * Sorting every spawn by distance every frame is the kind of work that looks
 * free at ten NPCs and is not at five hundred. It only produces a *different*
 * answer when the camera has actually moved or the list has changed, so it runs
 * on those two conditions and on a slow tick, never on every frame.
 */

/**
 * How many figures may exist at once.
 *
 * ── Eight, and here is the arithmetic ───────────────────────────────────────
 *
 * A/B'd in a browser **within one build**, both arms a fresh boot of the
 * shipped world with the same 56 spawns in storage — not estimated, and not
 * compared across commits:
 *
 *   | scene                   | draws | tris   | programs |
 *   |-------------------------|------:|-------:|---------:|
 *   | A · crowd empty         |   132 | 126.0k |       19 |
 *   | B · 8 figures, 18 roles |   178 | 161.1k |       25 |
 *   | (12 figures, earlier)   |   204 | 179.4k |       22 |
 *
 * That is **+5.75 draws, +4.4k triangles and +6 programs** for eight figures:
 * two draws for the body and its hull, one shadow, and two per *socketed* item
 * (a hat, a sword). A **garment is free** — `CharacterEquipment` substitutes it
 * into the body rather than hanging it off a bone — which is why a robed mage
 * costs less than a helmeted guard.
 *
 * GDD §5.2 caps the scene at **180 draws**, and the world spends 132 of it
 * before a single villager exists. That leaves 48, which is **eight figures**;
 * twelve measured 204 and was over by 24. The first row is what decides this
 * constant, so raising the budget means either measuring a cheaper baseline or
 * instancing the gear — not preferring a bigger crowd.
 *
 * **The programs are the uncomfortable number.** Six of them for the character
 * family (skinned toon and outline, their depth permutations, and the gear
 * pair), against GDD §5's guidance of ~14 for the whole scene — which this world
 * already exceeded at 19 before any of this existed. Recorded rather than
 * quietly absorbed.
 *
 * CPU is the other one to watch: the profiler bills the `npc` tag **1.6 ms** for
 * eight figures, the largest single tag in the scene. That is pose evaluation
 * and skinning, it scales linearly with this constant, and it is why the answer
 * to a bigger crowd is not simply a bigger number here.
 *
 * ── Gear instancing is done, and it did not raise this ─────────────────────
 *
 * `GearInstancer` now batches socketed hats and weapons, and the prediction
 * written here before it was measured — "six draws to three, and roughly double
 * this" — was wrong. The measurement is in that file: **−12 draws at eight
 * figures, −26 at twelve, −3 programs at any size**, on a guard-heavy crowd.
 *
 * It does not raise this constant because the saving has the wrong shape for
 * it. Batching replaces a per-figure cost with a **fixed** one of 20–22 draws,
 * so at eight figures it gives back about as much as it takes; the win only
 * compounds above twelve, which is exactly where the 180-draw ceiling already
 * says no. What it did buy is a marginal cost per figure of **3–4 draws instead
 * of 8.3**, so the day the baseline gets cheaper — a smaller `loadRadius`, a
 * cheaper terrain — this number can move a long way rather than a little.
 */
export const DEFAULT_CROWD_BUDGET = 8

/**
 * Beyond this, a spawn is not built however much budget is spare.
 *
 * A chibi figure is 1.56 m tall and reads as a coloured smudge past about 60 m —
 * the face is gone by 20 m and the hair by 40 (`equipment.ts` measures both). A
 * figure nobody can identify is six draw calls buying nothing.
 */
export const DEFAULT_CROWD_RANGE = 55

/** Slots that may change hands in one frame. See the header. */
const REBUILDS_PER_FRAME = 1

/** Seconds between re-evaluations when nothing else has changed. */
const RESEARCH_INTERVAL = 0.4

/** Camera travel that forces a re-evaluation before the tick is due. */
const RESEARCH_DISTANCE = 3

export interface CrowdOptions {
  budget?: number
  range?: number
  /**
   * Whether figures cast shadows and carry outlines.
   *
   * Both default on. A caller running a constrained-device profile turns them
   * off together, which — per `CharacterEquipmentOptions.castShadow` — is worth
   * a whole shader program for the family rather than only the draws.
   */
  outline?: boolean
  castShadow?: boolean
  /**
   * Ground height under a point, so a spawn placed by the editor still stands on
   * the terrain after it has been sculpted underneath.
   *
   * Optional: without it the spawn's stored `y` is used exactly, which is what a
   * test wants and what a flat scene gets away with.
   */
  groundAt?: (x: number, z: number) => number
  /**
   * Batch socketed gear through a shared `GearInstancer`.
   *
   * On by default. The switch exists so the two can be **A/B'd inside one
   * build** — the project's rule for any perf claim (`AAA-graphics.md` §10) —
   * because "instancing helped" is a sentence that has to survive a
   * measurement, and how much it helps depends entirely on how much gear the
   * crowd actually shares.
   */
  instanceGear?: boolean
}

interface Slot {
  character: Character
  equipment: CharacterEquipment
  /** Which spawn is wearing this slot, or `''` when it is parked. */
  spawnId: string
  /** Set when the slot has been claimed but not yet dressed. */
  pending: NpcSpawn | null
}

export class Crowd {
  /** Root for every figure. Registered with the profiler by the caller. */
  readonly group = new Group()

  private readonly store: NpcStore
  private readonly budget: number
  private readonly rangeSq: number
  private readonly outline: boolean
  private readonly castShadow: boolean
  private readonly groundAt: ((x: number, z: number) => number) | null

  private readonly slots: Slot[] = []
  /**
   * One batcher for the whole crowd.
   *
   * Built lazily with the first slot, because it needs the shared gear
   * materials and those are created on first use — `ToonMaterial` enrols with
   * the cascaded-shadow rig in its constructor, so building one before the
   * world's lighting exists gets different `CSM_CASCADES` defines from every
   * other toon material in the scene.
   */
  private instancer: GearInstancer | null = null
  private readonly instanceGear: boolean
  /**
   * Scratch for the nearest-first search.
   *
   * Pre-allocated and reused: this runs several times a second against every
   * spawn in the level, and GDD §5 bans allocation on any path that can run
   * mid-frame. `order` is sorted in place; `distances` is read by its comparator.
   */
  private readonly order: number[] = []
  private distances: Float64Array = new Float64Array(0)
  /** The winners of the last search, as spawn ids. Reused, never reallocated. */
  private readonly wanted = new Set<string>()
  /** Spawn ids currently assigned to a slot. */
  private readonly assigned = new Set<string>()

  private seenRevision = -1
  private sinceSearch = RESEARCH_INTERVAL
  private lastX = Number.NaN
  private lastZ = Number.NaN

  constructor(store: NpcStore, options: CrowdOptions = {}) {
    const {
      budget = DEFAULT_CROWD_BUDGET,
      range = DEFAULT_CROWD_RANGE,
      outline = true,
      castShadow = true,
      groundAt,
      instanceGear = true
    } = options
    this.store = store
    this.budget = Math.max(0, Math.floor(budget))
    this.rangeSq = range * range
    this.outline = outline
    this.castShadow = castShadow
    this.groundAt = groundAt ?? null
    this.instanceGear = instanceGear
    this.group.name = 'crowd'
    this.group.userData.perfTag = 'npc'
  }

  /** How many figures are standing right now. The number to judge draws by. */
  get active(): number {
    let count = 0
    for (const slot of this.slots) {
      if (slot.spawnId) {
        count++
      }
    }
    return count
  }

  /** Slots built so far. Never shrinks — a parked slot is cheaper than a rebuild. */
  get pooled(): number {
    return this.slots.length
  }

  /**
   * How many standing figures are on each rung of the chibi LOD ladder.
   *
   * Allocates, so it is a debug read rather than a per-frame one — a console
   * probe and `characterLod.test.ts` are the callers today, and the perf panel
   * is the obvious third. It is the only way to see from outside that a crowd
   * spread over 55 m is actually spread over tiers rather than all sitting on
   * LOD0, which is exactly what a ladder that never engaged would look like and
   * which nothing else would report.
   */
  tierCensus(): number[] {
    const census = [0, 0, 0, 0, 0]
    for (const slot of this.slots) {
      if (!slot.spawnId) {
        continue
      }
      const tier = slot.character.lodTier
      census[tier < 0 ? 4 : tier] = (census[tier < 0 ? 4 : tier] ?? 0) + 1
    }
    return census
  }

  /**
   * One frame.
   *
   * `cameraPosition` decides who is near enough to exist. Without it nothing is
   * built at all, which is the honest behaviour: "everyone" is not a fallback the
   * draw budget can survive.
   */
  update(dt: number, cameraPosition?: Vector3): void {
    if (cameraPosition) {
      this.sinceSearch += dt
      const moved = Math.hypot(cameraPosition.x - this.lastX, cameraPosition.z - this.lastZ)
      const stale = this.seenRevision !== this.store.revision
      if (stale || this.sinceSearch >= RESEARCH_INTERVAL || !(moved < RESEARCH_DISTANCE)) {
        this.seenRevision = this.store.revision
        this.sinceSearch = 0
        this.lastX = cameraPosition.x
        this.lastZ = cameraPosition.z
        this.search(cameraPosition)
      }
    }

    this.settle()

    for (const slot of this.slots) {
      if (slot.spawnId) {
        slot.equipment.update(dt)
        // The camera goes through, which is what engages each figure's own LOD
        // ladder (`Character.update`). The crowd is the only caller that passes
        // one: the player is the camera's own focus and is tier 0 by definition,
        // and the creation screen and the benches want the authored figure.
        //
        // Per figure rather than once for the crowd, because a crowd is spread
        // over the 55 m the search radius allows — the near half of a market is
        // LOD0 and the far half is LOD2, and a tier chosen for the group would
        // be wrong for both ends of it.
        slot.character.update(dt, cameraPosition)
      }
    }

    // **After** the characters have posed. The batch copies each item's world
    // matrix, and a bone that has not been rotated yet hands over last frame's.
    this.instancer?.update()
  }

  /**
   * Picks the nearest `budget` spawns within range, and parks everyone else.
   *
   * Parking is immediate and dressing is not: releasing a slot costs nothing and
   * a figure that should have vanished is a figure standing in a wall, whereas a
   * figure that arrives a frame late is not visible at all.
   */
  private search(camera: Vector3): void {
    const spawns = this.store.view()
    const count = spawns.length

    if (this.distances.length < count) {
      // Grown in one step to the size actually needed, not doubled: this happens
      // when a level loads and then never again.
      this.distances = new Float64Array(count)
    }
    // `length =` truncates or extends in place — no new array, which `slice`
    // would be, once per search, for the whole life of the scene.
    this.order.length = count
    for (let i = 0; i < count; i++) {
      const spawn = spawns[i]!
      const dx = spawn.x - camera.x
      const dz = spawn.z - camera.z
      this.distances[i] = dx * dx + dz * dz
      this.order[i] = i
    }
    this.order.sort(this.byDistance)

    this.wanted.clear()
    const limit = Math.min(this.budget, count)
    for (let i = 0; i < limit; i++) {
      const index = this.order[i]!
      if (this.distances[index]! > this.rangeSq) {
        // Sorted, so everything after this is further still.
        break
      }
      this.wanted.add(spawns[index]!.id)
    }

    // Park whoever fell out. Their slot becomes available this frame.
    for (const slot of this.slots) {
      if (slot.spawnId && !this.wanted.has(slot.spawnId)) {
        this.park(slot)
      }
    }

    // Queue whoever is missing, nearest first — `order` is already in that order.
    for (let i = 0; i < limit; i++) {
      const spawn = spawns[this.order[i]!]!
      if (!this.wanted.has(spawn.id) || this.assigned.has(spawn.id)) {
        continue
      }
      const slot = this.freeSlot()
      if (!slot) {
        break
      }
      slot.pending = spawn
      slot.spawnId = spawn.id
      this.assigned.add(spawn.id)
    }
  }

  /** Bound once. A fresh closure per search is an allocation per search. */
  private readonly byDistance = (a: number, b: number): number => this.distances[a]! - this.distances[b]!

  /** Dresses at most `REBUILDS_PER_FRAME` queued slots. See the header. */
  private settle(): void {
    let budget = REBUILDS_PER_FRAME
    for (const slot of this.slots) {
      if (budget === 0) {
        return
      }
      if (!slot.pending) {
        continue
      }
      const spawn = slot.pending
      slot.pending = null
      this.dress(slot, spawn)
      budget--
    }
  }

  private dress(slot: Slot, spawn: NpcSpawn): void {
    const appearance = professionAppearance(spawn.profession, spawn.seed)
    // Appearance before loadout: `setAppearance` pushes the colourway into the
    // equipment, and applying the loadout first would dress them in the previous
    // occupant's dye and then rebuild the body a second time to fix it.
    slot.character.setAppearance(appearance)
    slot.equipment.setVariant(variantOf(appearance))
    slot.equipment.setLoadout(professionLoadout(spawn.profession))

    const y = this.groundAt ? this.groundAt(spawn.x, spawn.z) : spawn.y
    slot.character.teleport(spawn.x, y, spawn.z)
    slot.character.setFacing((spawn.facingDeg * Math.PI) / 180)
    slot.character.group.visible = true
  }

  private park(slot: Slot): void {
    this.assigned.delete(slot.spawnId)
    slot.spawnId = ''
    slot.pending = null
    slot.character.group.visible = false
  }

  /**
   * A parked slot, or a new one while the pool is under budget.
   *
   * The pool only ever grows, and grows lazily: a level with three NPCs in it
   * never pays for twelve skeletons, and a player who walks into a market does
   * not pay for the market again when they walk back out.
   */
  private freeSlot(): Slot | null {
    for (const slot of this.slots) {
      if (!slot.spawnId) {
        return slot
      }
    }
    if (this.slots.length >= this.budget) {
      return null
    }
    const character = new Character({
      outline: this.outline,
      // One perf-panel row for the whole crowd, not one per figure: the ledger
      // replaces by name, and a name per slot would turn the panel into a list
      // of twelve near-identical rows that says nothing the total does not.
      perfTag: 'npc',
      geometryName: 'chibi/npc'
    })
    if (this.instanceGear && !this.instancer) {
      const { toon, outline } = gearMaterials()
      this.instancer = new GearInstancer({
        material: toon,
        outline: this.outline ? outline : null,
        castShadow: this.castShadow
      })
      this.group.add(this.instancer.group)
    }
    const equipment = new CharacterEquipment(character, {
      outline: this.outline,
      castShadow: this.castShadow,
      instancer: this.instancer
    })
    character.group.visible = false
    this.group.add(character.group)
    const slot: Slot = { character, equipment, spawnId: '', pending: null }
    this.slots.push(slot)
    return slot
  }

  /** Forces the next `update` to re-search, whatever the throttle says. */
  invalidate(): void {
    this.seenRevision = -1
    this.sinceSearch = RESEARCH_INTERVAL
  }

  /** Batches live right now. One or two draws each — see `GearInstancer`. */
  get gearBatches(): number {
    return this.instancer?.batchCount ?? 0
  }

  dispose(): void {
    this.instancer?.dispose()
    this.instancer = null
    for (const slot of this.slots) {
      slot.equipment.dispose()
      slot.character.dispose()
      slot.character.group.removeFromParent()
    }
    this.slots.length = 0
    this.assigned.clear()
    this.wanted.clear()
    this.group.removeFromParent()
  }
}
