import { PROFESSION_IDS, isProfession, type Profession } from '../characters/professions'

/**
 * ─── Where the people stand ─────────────────────────────────────────────────
 *
 * One record per NPC, and it is deliberately tiny: a position, a facing, a
 * profession and a seed. Everything about what that person *looks like* is
 * derived from the last two by `professions.ts`, so a hundred-NPC town is about
 * 3 KB of level data rather than a hundred appearance blobs that would need
 * migrating every time an appearance union grows.
 *
 * Plain TypeScript — no three.js, no Vue. The editor writes it, the crowd reads
 * it, the patch export serialises it, and none of the three imports the others.
 *
 * ── Its own store, not the placement list ───────────────────────────────────
 *
 * A `Placement` names a `PlaceableDefinition`, which carries a four-tier LOD
 * ladder and goes through `InstancedLodField`. An NPC is a **skinned** figure
 * with a skeleton, an equipment state and a gait — nothing about it can be
 * instanced through that path, and nothing in that path would know what to do
 * with a profession. They are different enough that sharing a list would mean a
 * `defId` that sometimes means a rock and sometimes means a fisherman.
 */

export interface NpcSpawn {
  /** Unique per instance, so the editor can address one without index drift. */
  id: string
  profession: Profession
  x: number
  y: number
  z: number
  /** Yaw in degrees, 0 = facing +Z, matching `Placement.rotY`'s convention. */
  facingDeg: number
  /**
   * Which person of that profession this is.
   *
   * An integer, and the *only* thing that separates two farmers. See
   * `professionAppearance` for what it reaches.
   */
  seed: number
}

export const NPC_KEY = 'world_editor_npcs'

/**
 * A ceiling on what a stored blob may contain.
 *
 * Not a design limit on a town — it is above what the crowd will ever have on
 * screen at once — but a bound on what a corrupt or hand-edited `localStorage`
 * value can make the loader do before the first frame.
 */
export const MAX_SPAWNS = 4096

const finite = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

/**
 * Repairs one stored spawn, or rejects it.
 *
 * Rejects rather than repairs on exactly one field: an unrecognised
 * `profession`. Every other field has a defensible default — a missing seed is
 * 0, a missing facing is 0 — but a profession that is not in the table has no
 * honest fallback, and silently turning a `blacksmith` from a future build into
 * a farmer would be worse than dropping it. Dropped ones are kept as orphans by
 * the store so a save never eats them.
 */
export const sanitiseSpawn = (raw: unknown): NpcSpawn | null => {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const data = raw as Record<string, unknown>
  if (!isProfession(data.profession)) {
    return null
  }
  return {
    id: typeof data.id === 'string' && data.id ? data.id : nextSpawnId(),
    profession: data.profession,
    x: finite(data.x),
    y: finite(data.y),
    z: finite(data.z),
    facingDeg: finite(data.facingDeg),
    // Floored and non-negative: it indexes hash tables, and a fractional seed
    // would make two spawns that look identical hash to different people.
    seed: Math.max(0, Math.floor(finite(data.seed)))
  }
}

let counter = 0

/**
 * Ids are `npc-<n>`, minted in order.
 *
 * Not a UUID and not derived from the position: a designer moves a spawn and it
 * has to stay the same spawn, and these show up in the exported patch where
 * `npc-12` is legible and a UUID is not. Uniqueness only has to hold within one
 * level, and the loader re-bases the counter past whatever it read.
 */
export const nextSpawnId = (): string => `npc-${++counter}`

/** Pushes the id counter past everything in `spawns`. Called after a load. */
export const rebaseSpawnIds = (spawns: readonly NpcSpawn[]): void => {
  for (const spawn of spawns) {
    const match = /^npc-(\d+)$/.exec(spawn.id)
    if (match) {
      counter = Math.max(counter, Number(match[1]))
    }
  }
}

/** Test seam — the counter is module state and a suite must be able to reset it. */
export const resetSpawnIds = (): void => {
  counter = 0
}

/**
 * ─── The store ──────────────────────────────────────────────────────────────
 *
 * A class rather than free functions over an array, for the reason `RosterStore`
 * is one: every mutation has to bump `revision`, and an exported
 * `remove(list, id)` a caller could forget to route through is how the crowd
 * ends up rendering a spawn the editor deleted.
 */
export class NpcStore {
  /**
   * Bumped on every change. A plain integer, polled — this is read from the
   * frame loop, which must never touch Vue (GDD §0).
   */
  revision = 0

  private readonly list: NpcSpawn[] = []
  private readonly byId = new Map<string, NpcSpawn>()
  /**
   * Spawns whose profession this build does not know.
   *
   * Kept, never rendered, and written back out on save. A designer who opens a
   * level from a branch that added `blacksmith` and saves it on this build must
   * not silently delete every blacksmith in the town.
   */
  private orphans: unknown[] = []

  get size(): number {
    return this.list.length
  }

  get orphanCount(): number {
    return this.orphans.length
  }

  /** The live array. Do not mutate — `all()` is the copying accessor. */
  view(): readonly NpcSpawn[] {
    return this.list
  }

  /** Plain copies, sorted so an export is stable across sessions. */
  all(): NpcSpawn[] {
    return this.list
      .map(spawn => ({ ...spawn }))
      .sort((a, b) => a.profession.localeCompare(b.profession) || a.x - b.x || a.z - b.z || a.id.localeCompare(b.id))
  }

  get(id: string): NpcSpawn | null {
    return this.byId.get(id) ?? null
  }

  add(spawn: Omit<NpcSpawn, 'id'> & { id?: string }): NpcSpawn {
    const record: NpcSpawn = {
      id: spawn.id ?? nextSpawnId(),
      profession: spawn.profession,
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
      facingDeg: spawn.facingDeg,
      seed: Math.max(0, Math.floor(spawn.seed))
    }
    this.list.push(record)
    this.byId.set(record.id, record)
    this.revision++
    return record
  }

  remove(id: string): boolean {
    const at = this.list.findIndex(spawn => spawn.id === id)
    if (at < 0) {
      return false
    }
    this.list.splice(at, 1)
    this.byId.delete(id)
    this.revision++
    return true
  }

  /** Moves one in place. Returns false for an id that is not here. */
  move(id: string, x: number, y: number, z: number): boolean {
    const spawn = this.byId.get(id)
    if (!spawn) {
      return false
    }
    spawn.x = x
    spawn.y = y
    spawn.z = z
    this.revision++
    return true
  }

  turn(id: string, degrees: number): boolean {
    const spawn = this.byId.get(id)
    if (!spawn) {
      return false
    }
    // Wrapped into [0, 360) so a spawn turned eleven times does not persist a
    // facing of 3960 that reads as a bug in a diff.
    spawn.facingDeg = ((spawn.facingDeg + degrees) % 360 + 360) % 360
    this.revision++
    return true
  }

  /** Rerolls who this is, keeping the role and the place. */
  reseed(id: string, seed: number): boolean {
    const spawn = this.byId.get(id)
    if (!spawn) {
      return false
    }
    spawn.seed = Math.max(0, Math.floor(seed))
    this.revision++
    return true
  }

  clear(): number {
    const removed = this.list.length
    this.list.length = 0
    this.byId.clear()
    this.revision++
    return removed
  }

  /** Replaces everything. Sanitised, so untrusted input is safe here. */
  restore(raw: unknown): void {
    this.list.length = 0
    this.byId.clear()
    this.orphans = []
    if (Array.isArray(raw)) {
      for (const entry of raw.slice(0, MAX_SPAWNS)) {
        const spawn = sanitiseSpawn(entry)
        if (!spawn) {
          this.orphans.push(entry)
          continue
        }
        if (this.byId.has(spawn.id)) {
          // A truncated write can leave the same id twice. Both are real people
          // and both have to survive, so the second is re-minted rather than
          // shadowing the first.
          //
          // **In a loop, and after re-basing.** The first version minted once
          // from a counter that had not yet been pushed past what was being
          // read — so two spawns both called `npc-1` collided, the re-mint
          // handed back `npc-1`, and the second person vanished. Re-basing as
          // each one lands is what makes the fresh id actually fresh.
          rebaseSpawnIds(this.list)
          do {
            spawn.id = nextSpawnId()
          } while (this.byId.has(spawn.id))
        }
        this.list.push(spawn)
        this.byId.set(spawn.id, spawn)
      }
    }
    rebaseSpawnIds(this.list)
    this.revision++
  }

  /** Everything that should be written back, orphans included. */
  serialise(): unknown[] {
    return [...this.all(), ...this.orphans]
  }
}

/**
 * Guarded per the convention in `editor/toggle.ts`: `localStorage` throws
 * outright in a sandboxed iframe, which is how several of the portals this ships
 * to serve games.
 */
export const loadSpawns = (): unknown => {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(NPC_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const saveSpawns = (store: NpcStore): void => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(NPC_KEY, JSON.stringify(store.serialise()))
    }
  } catch {
    // Full or blocked. The crowd still works for this session, which is
    // strictly better than refusing the edit.
  }
}

export const clearStoredSpawns = (): void => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(NPC_KEY)
    }
  } catch {
    // Unreachable either way.
  }
}

/** Distinct professions in a spawn list, for a summary line. */
export const spawnBreakdown = (spawns: readonly NpcSpawn[]): { profession: Profession; count: number }[] => {
  const counts = new Map<Profession, number>()
  for (const spawn of spawns) {
    counts.set(spawn.profession, (counts.get(spawn.profession) ?? 0) + 1)
  }
  return PROFESSION_IDS.filter(id => counts.has(id)).map(id => ({ profession: id, count: counts.get(id)! }))
}
