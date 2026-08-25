import type { InstanceTransform } from './lod/InstancedLodField'

/**
 * ─── Collision for scattered props ──────────────────────────────────────────
 *
 * Trees, boulders and stones are *scattered*, not placed: they arrive per
 * terrain chunk from a seeded function and live in instanced fields. Nothing
 * ever gave them a collider, so the player walked through every trunk in the
 * world. Hand-placed props (platforms, pillars, plateaus) always collided —
 * they are `Placement`s with a catalogue entry — which is why the gap was easy
 * to miss: the level had collision and the *forest* did not.
 *
 * ── Why this is not just more Placements ────────────────────────────────────
 *
 * The obvious fix is to feed scatter into the same collider source the editor
 * uses. It does not scale: that path resolves a catalogue lookup and a trig pair
 * per prop and rebuilds the whole list when anything changes, which is correct
 * for the few dozen props a level holds and wrong for the ~20 000 instances a
 * forest holds. The player can only touch the handful within a couple of metres.
 *
 * So this is a spatial index instead. Instances are stored per terrain chunk —
 * the residency unit that already exists — and a query walks only the 3×3 chunk
 * neighbourhood around the player. At a 48 m chunk that is at most nine map
 * lookups regardless of how big the world gets.
 *
 * ── Storage ─────────────────────────────────────────────────────────────────
 *
 * Flat `Float32Array`s, five floats per instance, grown and reused. An array of
 * `{x, z, ...}` objects for 20 000 trees is 20 000 allocations that the GC then
 * has to walk on a frame budget that has none to spare (GDD §5.2).
 */

/** Floats per stored instance: x, z, baseY, topY, radius, species ordinal. */
const STRIDE = 6

export interface ScatterColliderSpec {
  /**
   * Blocking radius at unit scale, in metres.
   *
   * The **trunk**, not the canopy. A tree's bounding radius is its foliage, and
   * using it would stop the player two metres short of every tree in a wall of
   * invisible cylinders.
   */
  radius: number
  /**
   * Blocking height at unit scale, in metres.
   *
   * Only has to exceed the player's step height to block — beyond that the
   * number is irrelevant, since there are no ceilings and nothing stands on a
   * trunk. Kept honest anyway so a future ranged check reads sensibly.
   */
  height: number
}

/** Receives colliders found by a query. Implemented by the collision world. */
export interface ScatterColliderSink {
  addTransientCylinder(x: number, z: number, baseY: number, topY: number, radius: number): void
}

interface ChunkEntry {
  data: Float32Array
  count: number
}

export class ScatterColliderIndex {
  private readonly chunks = new Map<number, ChunkEntry>()
  private readonly chunkSize: number

  constructor(chunkSize: number) {
    this.chunkSize = chunkSize
  }

  /** Instances currently indexed. Diagnostics only. */
  get size(): number {
    let total = 0
    for (const entry of this.chunks.values()) {
      total += entry.count
    }
    return total
  }

  /**
   * Adds one species' instances for a chunk.
   *
   * Called from the same chunk-load hook that populates the scatter field, so
   * the index and the visible instances can never disagree about what exists.
   */
  add(
    chunkX: number,
    chunkZ: number,
    transforms: readonly InstanceTransform[],
    spec: ScatterColliderSpec,
    /**
     * Which species these belong to.
     *
     * Carried so this index can also answer *which* instance is under the
     * editor's cursor, not just what blocks the player. One structure holding
     * every scattered instance's position beats two that have to be kept in
     * step — and they would drift the first time a chunk unloaded from one and
     * not the other.
     */
    speciesOrdinal = 0
  ): void {
    if (transforms.length === 0) {
      return
    }
    const key = packChunk(chunkX, chunkZ)
    let entry = this.chunks.get(key)
    if (!entry) {
      entry = { data: new Float32Array(transforms.length * STRIDE), count: 0 }
      this.chunks.set(key, entry)
    }

    const needed = (entry.count + transforms.length) * STRIDE
    if (entry.data.length < needed) {
      // Grown to the next power of two rather than to exactly what is needed:
      // several species land in the same chunk one after another, and growing
      // per species would copy the whole buffer once per species.
      const grown = new Float32Array(nextPowerOfTwo(needed))
      grown.set(entry.data.subarray(0, entry.count * STRIDE))
      entry.data = grown
    }

    const data = entry.data
    let cursor = entry.count * STRIDE
    for (let i = 0; i < transforms.length; i++) {
      const transform = transforms[i]!
      const scale = transform.scale
      data[cursor] = transform.x
      data[cursor + 1] = transform.z
      data[cursor + 2] = transform.y
      data[cursor + 3] = transform.y + spec.height * scale
      data[cursor + 4] = spec.radius * scale
      data[cursor + 5] = speciesOrdinal
      cursor += STRIDE
    }
    entry.count += transforms.length
  }

  /** Drops a chunk's colliders. Mirrors the scatter field's `removeCell`. */
  remove(chunkX: number, chunkZ: number): void {
    this.chunks.delete(packChunk(chunkX, chunkZ))
  }

  clear(): void {
    this.chunks.clear()
  }

  /**
   * Feeds every collider within `radius` of (x, z) to the sink.
   *
   * Returns how many were emitted, so a caller can assert the query is finding
   * anything at all — a spatial index that silently returns nothing looks
   * exactly like a world with no collision, which is the bug this fixes.
   */
  queryNear(x: number, z: number, radius: number, sink: ScatterColliderSink): number {
    const cx = Math.floor(x / this.chunkSize)
    const cz = Math.floor(z / this.chunkSize)
    // 3×3 rather than 1: the player is rarely at a chunk's centre, and a query
    // radius plus a tree radius easily reaches across a boundary.
    let emitted = 0
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const entry = this.chunks.get(packChunk(cx + dx, cz + dz))
        if (!entry) {
          continue
        }
        const data = entry.data
        for (let i = 0; i < entry.count; i++) {
          const at = i * STRIDE
          const px = data[at]!
          const pz = data[at + 1]!
          const r = data[at + 4]!
          const ox = px - x
          const oz = pz - z
          const reach = radius + r
          if (ox * ox + oz * oz > reach * reach) {
            continue
          }
          sink.addTransientCylinder(px, pz, data[at + 2]!, data[at + 3]!, r)
          emitted++
        }
      }
    }
    return emitted
  }

  /**
   * The instance closest to a point, within `maxDistance`.
   *
   * For the editor's aim: the ray gives a world position, and this turns that
   * into *which* scattered prop was pointed at. Deliberately position-based
   * rather than an `InstancedMesh` raycast — the fields swap LOD tiers and
   * repack their instance buffers every frame, so an `instanceId` identifies a
   * slot rather than a prop and means something different the next frame.
   *
   * Returns a shared object; read it before calling again.
   */
  nearest(x: number, z: number, maxDistance: number): ScatterHit | null {
    const cx = Math.floor(x / this.chunkSize)
    const cz = Math.floor(z / this.chunkSize)
    let bestSquared = maxDistance * maxDistance
    let found = false

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const entry = this.chunks.get(packChunk(cx + dx, cz + dz))
        if (!entry) {
          continue
        }
        const data = entry.data
        for (let i = 0; i < entry.count; i++) {
          const at = i * STRIDE
          const ox = data[at]! - x
          const oz = data[at + 1]! - z
          const distance = ox * ox + oz * oz
          if (distance >= bestSquared) {
            continue
          }
          bestSquared = distance
          _hit.x = data[at]!
          _hit.z = data[at + 1]!
          _hit.baseY = data[at + 2]!
          _hit.radius = data[at + 4]!
          _hit.speciesOrdinal = data[at + 5]!
          found = true
        }
      }
    }
    return found ? _hit : null
  }

  /**
   * The first instance the aim ray passes through, within `maxDistance`.
   *
   * `nearest` alone is not enough for the editor's crosshair. It searches around
   * the *terrain* point under the aim, and a ray aimed at a tree does not hit
   * the terrain at the tree — it passes the trunk and lands somewhere behind it,
   * which is how you end up deleting the tree you were not looking at (or
   * nothing at all). Aiming is a ray question, so this answers it with a ray.
   *
   * Scatter is not in the editor's raycast targets and cannot be: the fields are
   * `InstancedMesh`es whose instance slots are repacked every frame by the LOD
   * and culling passes, so a three.js `instanceId` names a slot rather than a
   * prop. Testing the stored cylinders is both cheaper and stable.
   *
   * Chunks are visited once each, gathered by walking the ray — an instance test
   * is a handful of multiplies, and the scan is bounded by how many chunks the
   * ray crosses rather than by how large the world is.
   */
  nearestToRay(
    originX: number,
    originY: number,
    originZ: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    maxDistance: number,
    /** Widens every collider, so a prop can be picked by aiming near it. */
    slack = 0.5
  ): ScatterHit | null {
    _visited.length = 0
    // Quarter-chunk steps: fine enough that the ray cannot skip a chunk, coarse
    // enough that a 400 m ray is a few dozen samples rather than a few hundred.
    const step = this.chunkSize * 0.25
    for (let travelled = 0; travelled <= maxDistance; travelled += step) {
      const key = packChunk(
        Math.floor((originX + dirX * travelled) / this.chunkSize),
        Math.floor((originZ + dirZ * travelled) / this.chunkSize)
      )
      if (!_visited.includes(key)) {
        _visited.push(key)
      }
    }

    const planar = dirX * dirX + dirZ * dirZ
    if (planar < 1e-6) {
      // Straight up or straight down. There is no meaningful "along the ray"
      // ordering in XZ, so leave this to the caller's positional fallback.
      return null
    }

    let bestT = maxDistance
    let found = false

    for (let v = 0; v < _visited.length; v++) {
      const entry = this.chunks.get(_visited[v]!)
      if (!entry) {
        continue
      }
      const data = entry.data
      for (let i = 0; i < entry.count; i++) {
        const at = i * STRIDE
        const ox = originX - data[at]!
        const oz = originZ - data[at + 1]!
        // Closest approach in XZ, clamped to the forward half of the ray.
        const t = Math.max(0, -(ox * dirX + oz * dirZ) / planar)
        if (t >= bestT) {
          // Something nearer already matched; this cannot win regardless.
          continue
        }
        const missX = ox + dirX * t
        const missZ = oz + dirZ * t
        const reach = data[at + 4]! + slack
        if (missX * missX + missZ * missZ > reach * reach) {
          continue
        }
        // The ray is over the footprint — is it at the prop's *height* there?
        const y = originY + dirY * t
        if (y < data[at + 2]! - slack || y > data[at + 3]! + slack) {
          continue
        }
        bestT = t
        _hit.x = data[at]!
        _hit.z = data[at + 1]!
        _hit.baseY = data[at + 2]!
        _hit.radius = data[at + 4]!
        _hit.speciesOrdinal = data[at + 5]!
        found = true
      }
    }
    return found ? _hit : null
  }
}

/** Chunk keys along the current ray. Module-level so a pick allocates nothing. */
const _visited: number[] = []

/** One scattered instance, as returned by `nearest`. */
export interface ScatterHit {
  speciesOrdinal: number
  x: number
  z: number
  baseY: number
  radius: number
}

const _hit: ScatterHit = { speciesOrdinal: 0, x: 0, z: 0, baseY: 0, radius: 0 }

/**
 * Packs a signed chunk coordinate pair into one number.
 *
 * A string key would allocate on every lookup, and this runs nine times a frame
 * for the player alone. ±32767 chunks is ±1.5 million metres at 48 m chunks,
 * which is past where float32 world positions stop being usable anyway.
 */
const packChunk = (cx: number, cz: number): number => ((cx & 0xffff) << 16) | (cz & 0xffff)

const nextPowerOfTwo = (value: number): number => {
  let size = 1
  while (size < value) {
    size *= 2
  }
  return size
}
