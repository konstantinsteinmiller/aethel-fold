import { valueNoise2D } from '../geometry/rng'

/**
 * ─── Sculpt delta ───────────────────────────────────────────────────────────
 *
 * A **sparse tile raster of height offsets** laid over the analytic heightfield.
 * `heightAtCore` adds `delta.sample(x, z)` to whatever the noise produced, so
 * one object makes every consumer sculpt-aware at once: the player's ground
 * clamp, the editor's aim march, the camera's floor, and the chunk geometry the
 * worker builds.
 *
 * ── Why a raster and not a stroke list ──────────────────────────────────────
 *
 * The obvious alternative is to keep the brush strokes and evaluate them
 * analytically. It is O(strokes) per height query and there is no bound on the
 * stroke count — `heightAt` is called a few hundred thousand times per chunk
 * batch and a few dozen times per frame by the player, so a sculpting session
 * would get slower the longer it went on, with no ceiling and no way to
 * compact. A raster is O(1) per query no matter how much has been carved, and
 * the memory is bounded by *area touched* rather than by *edits made*: paint
 * the same hill for an hour and it still costs one tile.
 *
 * It is also the only one of the two that is cheap to ship to a worker. A tile
 * is a `Float32Array`; a patch is a handful of them and structured-clones
 * without walking any object graph.
 *
 * ── Layout ──────────────────────────────────────────────────────────────────
 *
 * Samples sit on a global lattice at `cellSize` metres. A tile owns a
 * `tileCells × tileCells` square of that lattice and is allocated on first
 * touch. At the defaults that is 64 m of world per tile and 16 KB of storage.
 *
 * Sampling reads the four surrounding **lattice** points, looked up
 * independently. Tiles therefore store no duplicated border ring: there is
 * nothing to keep in sync, so there is no way to produce a seam at a tile
 * boundary — and a seam in the delta is a permanent crease in the terrain,
 * which is the one failure here that would be genuinely hard to trace.
 *
 * The interpolant is bilinear with a **cubic fade** (`t²(3−2t)`) rather than a
 * raw one. Raw bilinear is C0: its gradient jumps at every cell boundary, and
 * terrain normals are taken from the analytic gradient (`normalAtCore`), so a
 * sculpted slope would shade in 1 m facets. The fade drives the derivative to
 * zero on both sides of a boundary, which makes the surface C1 for the cost of
 * two multiplies. It also means a query on a lattice point returns that point's
 * value exactly — and chunk vertices land on the lattice, since chunk origins
 * are multiples of 48 m and the finest tier steps 2 m.
 *
 * Nothing in here imports three: the terrain worker rehydrates a `SculptField`
 * from a patch, and its bundle must stay a few kilobytes (see `terrainWorker`).
 */

/** Metres between lattice samples. */
export const SCULPT_CELL_SIZE = 1
/** Lattice samples along a tile edge. 64 × 64 × 4 B = 16 KB per tile. */
export const SCULPT_TILE_CELLS = 64

/** Brush radius bounds, in metres. */
export const MIN_SCULPT_RADIUS = 2
/**
 * Upper bound chosen against the cost of one dab, not against taste: `smooth`
 * and `flatten` read the *finished* surface over the footprint plus a ring, and
 * at 48 m that is a 99 × 99 = 9 801-sample snapshot. Memoised (see
 * `createBaseGridCache`) the passes after the first are cheap — **measured**
 * 1.42 ms per dab at 48 m and 0.37 ms at 24 m, against 6.31 ms for the dab that
 * opens fresh ground. Past this the opening dab starts to be felt as a hitch.
 */
export const MAX_SCULPT_RADIUS = 48

/** Metres per unit of the roughen tool's noise — ~3 m bumps. */
const NOISE_FREQUENCY = 0.32

/**
 * Tile keys are numeric, not `${tx}_${tz}`: `sample` runs on the player's
 * per-frame path and a template string there would allocate 60 times a second
 * for the lifetime of the session.
 */
const KEY_BIAS = 1 << 20
const KEY_SPAN = 1 << 21

const tileKey = (tx: number, tz: number): number => (tx + KEY_BIAS) * KEY_SPAN + (tz + KEY_BIAS)
const keyTileZ = (key: number): number => (key % KEY_SPAN) - KEY_BIAS
const keyTileX = (key: number): number => (key - (key % KEY_SPAN)) / KEY_SPAN - KEY_BIAS

export type SculptTool = 'raise' | 'lower' | 'smooth' | 'flatten' | 'noise'
export type SculptFalloff = 'smooth' | 'linear' | 'sharp' | 'plateau'

export const SCULPT_TOOLS: readonly SculptTool[] = ['raise', 'lower', 'smooth', 'flatten', 'noise']
export const SCULPT_FALLOFFS: readonly SculptFalloff[] = ['smooth', 'linear', 'sharp', 'plateau']

/** One tile crossing the wire. `null` data means "delete this tile". */
export interface SculptTilePatch {
  tx: number
  tz: number
  data: Float32Array | null
}

/** A structured-cloneable slice of the delta. Sent to the chunk workers. */
export interface SculptPatch {
  cellSize: number
  tileCells: number
  tiles: SculptTilePatch[]
}

/** A tile as it was before a stroke touched it. `null` = it did not exist. */
export interface SculptUndoTile {
  tx: number
  tz: number
  data: Float32Array | null
}

export interface SculptUndoRecord {
  tiles: SculptUndoTile[]
  /** World-space bounds of the tiles involved — what has to be rebuilt. */
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

/**
 * The delta itself. Implements the `DeltaSampler` shape that
 * `HeightfieldParams.delta` expects.
 */
export class SculptField {
  readonly cellSize: number
  readonly tileCells: number

  private readonly inverseCell: number
  private readonly tileMetres: number
  private readonly tiles = new Map<number, Float32Array>()
  /** Tiles changed since the last `takePatch` — what the workers still owe. */
  private readonly dirty = new Set<number>()
  /** Copy-on-write snapshots for the stroke in progress, or `null`. */
  private journal: Map<number, Float32Array | null> | null = null
  /** Last tile resolved by `at`. Four taps of one sample share a tile 97 % of
   *  the time, and this turns four map lookups into one. */
  private memoKey = -1
  private memoTile: Float32Array | null = null

  constructor(cellSize = SCULPT_CELL_SIZE, tileCells = SCULPT_TILE_CELLS) {
    this.cellSize = cellSize
    this.tileCells = tileCells
    this.inverseCell = 1 / cellSize
    this.tileMetres = cellSize * tileCells
  }

  get tileCount(): number {
    return this.tiles.size
  }

  get isEmpty(): boolean {
    return this.tiles.size === 0
  }

  /** Approximate resident bytes, for the panel's readout. */
  get byteLength(): number {
    return this.tiles.size * this.tileCells * this.tileCells * 4
  }

  /**
   * Height offset at a world position, in metres.
   *
   * Returns a **hard zero** wherever nothing has been carved, so
   * `heightAtCore` can skip the addition entirely and an unsculpted query is
   * bit-identical to the field before any of this existed.
   */
  sample(x: number, z: number): number {
    if (this.tiles.size === 0) {
      return 0
    }
    const gx = x * this.inverseCell
    const gz = z * this.inverseCell
    const i0 = Math.floor(gx)
    const j0 = Math.floor(gz)

    const a = this.at(i0, j0)
    const b = this.at(i0 + 1, j0)
    const c = this.at(i0, j0 + 1)
    const d = this.at(i0 + 1, j0 + 1)
    if (a === 0 && b === 0 && c === 0 && d === 0) {
      return 0
    }

    const fx = gx - i0
    const fz = gz - j0
    const u = fx * fx * (3 - 2 * fx)
    const v = fz * fz * (3 - 2 * fz)
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v
  }

  /** Exact stored offset at a lattice point. */
  valueAt(i: number, j: number): number {
    return this.at(i, j)
  }

  private at(i: number, j: number): number {
    const n = this.tileCells
    const tx = Math.floor(i / n)
    const tz = Math.floor(j / n)
    const key = tileKey(tx, tz)
    let tile: Float32Array | null
    if (key === this.memoKey) {
      tile = this.memoTile
    } else {
      tile = this.tiles.get(key) ?? null
      this.memoKey = key
      this.memoTile = tile
    }
    if (!tile) {
      return 0
    }
    return tile[(j - tz * n) * n + (i - tx * n)]!
  }

  /** Adds to a lattice point, allocating and journalling its tile as needed. */
  addAt(i: number, j: number, amount: number): void {
    if (amount === 0 || !Number.isFinite(amount)) {
      return
    }
    const n = this.tileCells
    const tx = Math.floor(i / n)
    const tz = Math.floor(j / n)
    const key = tileKey(tx, tz)
    let tile = this.tiles.get(key)
    if (tile) {
      this.journalTile(key, tile)
    } else {
      this.journalTile(key, null)
      tile = new Float32Array(n * n)
      this.tiles.set(key, tile)
      this.memoKey = -1
      this.memoTile = null
    }
    this.dirty.add(key)
    const index = (j - tz * n) * n + (i - tx * n)
    tile[index] = tile[index]! + amount
  }

  // ── strokes and undo ──────────────────────────────────────────────────────

  /**
   * Opens a stroke. Every tile is snapshotted the first time the stroke writes
   * to it, so undo is exact rather than an inverse brush — an inverse
   * `flatten` or `smooth` does not exist, and an inverse `raise` only matches
   * if the dab timings replay identically, which under a variable frame rate
   * they never do.
   */
  beginStroke(): void {
    this.journal = new Map()
  }

  /** Closes the stroke and hands back what would restore it. */
  endStroke(): SculptUndoRecord | null {
    const journal = this.journal
    this.journal = null
    if (!journal || journal.size === 0) {
      return null
    }
    return this.recordFrom(journal)
  }

  /** Discards the stroke journal without producing a record. */
  abortStroke(): void {
    this.journal = null
  }

  /** Puts the tiles in a record back exactly as they were. */
  restore(record: SculptUndoRecord): void {
    const n = this.tileCells
    for (const entry of record.tiles) {
      const key = tileKey(entry.tx, entry.tz)
      if (entry.data) {
        // Copied in rather than adopted, so a record stays replayable and can
        // never be aliased by a later edit.
        let tile = this.tiles.get(key)
        if (!tile) {
          tile = new Float32Array(n * n)
          this.tiles.set(key, tile)
        }
        tile.set(entry.data)
      } else {
        this.tiles.delete(key)
      }
      this.dirty.add(key)
    }
    this.memoKey = -1
    this.memoTile = null
  }

  /** Drops every tile. The record restores all of them. */
  clear(): SculptUndoRecord | null {
    if (this.tiles.size === 0) {
      return null
    }
    const journal = new Map<number, Float32Array | null>()
    for (const [key, tile] of this.tiles) {
      journal.set(key, tile.slice())
      this.dirty.add(key)
    }
    this.tiles.clear()
    this.journal = null
    this.memoKey = -1
    this.memoTile = null
    return this.recordFrom(journal)
  }

  private journalTile(key: number, before: Float32Array | null): void {
    const journal = this.journal
    if (!journal || journal.has(key)) {
      return
    }
    journal.set(key, before ? before.slice() : null)
  }

  private recordFrom(journal: Map<number, Float32Array | null>): SculptUndoRecord {
    const tiles: SculptUndoTile[] = []
    let minX = Number.POSITIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY
    for (const [key, data] of journal) {
      const tx = keyTileX(key)
      const tz = keyTileZ(key)
      tiles.push({ tx, tz, data })
      minX = Math.min(minX, tx * this.tileMetres)
      minZ = Math.min(minZ, tz * this.tileMetres)
      maxX = Math.max(maxX, (tx + 1) * this.tileMetres)
      maxZ = Math.max(maxZ, (tz + 1) * this.tileMetres)
    }
    return { tiles, minX, minZ, maxX, maxZ }
  }

  // ── worker transport ──────────────────────────────────────────────────────

  /**
   * Everything changed since the last call, as copies, and marks it delivered.
   *
   * Copies rather than transfers: this thread has to keep sampling the same
   * arrays for the player's collision and the editor's aim, so handing the
   * buffers away would detach the authoritative delta.
   */
  takePatch(): SculptPatch | null {
    if (this.dirty.size === 0) {
      return null
    }
    const tiles: SculptTilePatch[] = []
    for (const key of this.dirty) {
      const tile = this.tiles.get(key)
      tiles.push({ tx: keyTileX(key), tz: keyTileZ(key), data: tile ? tile.slice() : null })
    }
    this.dirty.clear()
    return { cellSize: this.cellSize, tileCells: this.tileCells, tiles }
  }

  /** The whole delta as a patch. Used to prime a worker that has none. */
  fullPatch(): SculptPatch {
    const tiles: SculptTilePatch[] = []
    for (const [key, tile] of this.tiles) {
      tiles.push({ tx: keyTileX(key), tz: keyTileZ(key), data: tile.slice() })
    }
    return { cellSize: this.cellSize, tileCells: this.tileCells, tiles }
  }

  /** Merges a patch in. The worker side of `takePatch`. */
  applyPatch(patch: SculptPatch): boolean {
    if (patch.cellSize !== this.cellSize || patch.tileCells !== this.tileCells) {
      // A geometry mismatch would silently misplace every offset. Refusing is
      // the only safe answer, and it can only happen across a version skew.
      return false
    }
    const n = this.tileCells
    for (const entry of patch.tiles) {
      const key = tileKey(entry.tx, entry.tz)
      if (!entry.data || entry.data.length !== n * n) {
        this.tiles.delete(key)
        continue
      }
      let tile = this.tiles.get(key)
      if (!tile) {
        tile = new Float32Array(n * n)
        this.tiles.set(key, tile)
      }
      tile.set(entry.data)
    }
    this.memoKey = -1
    this.memoTile = null
    return true
  }
}

// ─── brush ──────────────────────────────────────────────────────────────────

export interface SculptBrush {
  tool: SculptTool
  /** Metres. */
  radius: number
  /**
   * Metres per second at the brush centre for `raise` / `lower` / `noise`; a
   * convergence rate per second for `smooth` / `flatten`, where the quantity
   * being moved toward is a height rather than a delta.
   */
  strength: number
  falloff: SculptFalloff
  seed: number
}

export interface SculptDab {
  x: number
  z: number
  /** Seconds this dab represents. Dabs are time-scaled so the result does not
   *  depend on the frame rate the user happened to be painting at. */
  dt: number
  /** Absolute world Y that `flatten` converges on. */
  target: number
}

/** Brush weight at normalised distance `t`. 1 at the centre, 0 at the rim. */
export const sculptFalloff = (curve: SculptFalloff, t: number): number => {
  if (t >= 1) {
    return 0
  }
  if (t <= 0) {
    return 1
  }
  switch (curve) {
    case 'linear':
      return 1 - t
    case 'sharp': {
      const k = 1 - t
      return k * k * k
    }
    case 'plateau': {
      // Flat to 70 %, then a smooth shoulder — the curve you want for carving a
      // terrace, where a domed centre defeats the point.
      if (t < 0.7) {
        return 1
      }
      const u = (t - 0.7) / 0.3
      return 1 - u * u * (3 - 2 * u)
    }
    default:
      return 1 - t * t * (3 - 2 * t)
  }
}

/**
 * Base heights on the lattice, memoised.
 *
 * `smooth` and `flatten` need the *finished* surface, which means the analytic
 * height under every sample in the footprint — four fbm evaluations each. The
 * base field never changes, so the second pass over ground already painted is a
 * map lookup. **Measured** on a 24 m smooth brush: 2 601 misses and 6.31 ms on
 * the opening dab, then zero misses and 0.37 ms on every dab after it while the
 * brush stays put — a 17× difference, which is the whole reason this exists.
 */
export const createBaseGridCache = (
  heightAt: (x: number, z: number) => number,
  cellSize: number
): ((i: number, j: number) => number) => {
  const cache = new Map<number, number>()
  return (i, j) => {
    const key = (i + KEY_BIAS) * KEY_SPAN + (j + KEY_BIAS)
    const hit = cache.get(key)
    if (hit !== undefined) {
      return hit
    }
    const value = heightAt(i * cellSize, j * cellSize)
    // A long session walking the world would otherwise grow this without
    // bound. Dropping the whole map is fine — it is a cache, not state.
    if (cache.size > 400_000) {
      cache.clear()
    }
    cache.set(key, value)
    return value
  }
}

/**
 * Surface snapshot for the two tools that read it. Module-level and grown in
 * place: a dab runs every frame while the button is down.
 */
let _surface = new Float32Array(0)

/**
 * Applies one dab of `brush` at `dab`, returning whether anything moved.
 *
 * `baseAt` is the **unsculpted** height on the lattice — pass a cache built by
 * `createBaseGridCache` over a `heightAt` with the delta detached, or `smooth`
 * and `flatten` will chase their own output.
 */
export const applyDab = (
  field: SculptField,
  brush: SculptBrush,
  dab: SculptDab,
  baseAt: (i: number, j: number) => number
): boolean => {
  if (dab.dt <= 0 || brush.strength === 0) {
    return false
  }
  const radius = Math.min(MAX_SCULPT_RADIUS, Math.max(MIN_SCULPT_RADIUS, brush.radius))
  const cell = field.cellSize
  const cx = dab.x / cell
  const cz = dab.z / cell
  const rc = radius / cell
  const i0 = Math.ceil(cx - rc)
  const i1 = Math.floor(cx + rc)
  const j0 = Math.ceil(cz - rc)
  const j1 = Math.floor(cz + rc)
  if (i1 < i0 || j1 < j0) {
    return false
  }

  const reads = brush.tool === 'smooth' || brush.tool === 'flatten'
  // One cell of margin on every side, so the 3×3 smoothing kernel never reads
  // outside the snapshot and the rim samples are smoothed against real
  // neighbours instead of against zero.
  const width = i1 - i0 + 3
  const height = j1 - j0 + 3
  if (reads) {
    if (_surface.length < width * height) {
      _surface = new Float32Array(width * height)
    }
    for (let j = 0; j < height; j++) {
      const gj = j0 - 1 + j
      for (let i = 0; i < width; i++) {
        const gi = i0 - 1 + i
        _surface[j * width + i] = baseAt(gi, gj) + field.valueAt(gi, gj)
      }
    }
  }

  const inverseRadius = 1 / radius
  let changed = false

  for (let j = j0; j <= j1; j++) {
    const dz = (j - cz) * cell
    for (let i = i0; i <= i1; i++) {
      const dx = (i - cx) * cell
      const t = Math.sqrt(dx * dx + dz * dz) * inverseRadius
      if (t >= 1) {
        continue
      }
      const weight = sculptFalloff(brush.falloff, t)
      if (weight <= 0) {
        continue
      }

      let amount = 0
      switch (brush.tool) {
        case 'raise':
          amount = brush.strength * dab.dt * weight
          break
        case 'lower':
          amount = -brush.strength * dab.dt * weight
          break
        case 'noise':
          amount =
            (valueNoise2D(i * cell * NOISE_FREQUENCY, j * cell * NOISE_FREQUENCY, brush.seed) * 2 - 1) *
            brush.strength *
            dab.dt *
            weight
          break
        case 'flatten': {
          const centre = _surface[(j - j0 + 1) * width + (i - i0 + 1)]!
          amount = (dab.target - centre) * Math.min(1, brush.strength * dab.dt * weight)
          break
        }
        case 'smooth': {
          const o = (j - j0 + 1) * width + (i - i0 + 1)
          const centre = _surface[o]!
          const mean =
            (_surface[o - width - 1]! +
              _surface[o - width]! +
              _surface[o - width + 1]! +
              _surface[o - 1]! +
              centre +
              _surface[o + 1]! +
              _surface[o + width - 1]! +
              _surface[o + width]! +
              _surface[o + width + 1]!) /
            9
          amount = (mean - centre) * Math.min(1, brush.strength * dab.dt * weight)
          break
        }
      }

      if (amount === 0) {
        continue
      }
      field.addAt(i, j, amount)
      changed = true
    }
  }

  return changed
}

// ─── persistence ────────────────────────────────────────────────────────────

/**
 * localStorage key. Its **own** — the props live under
 * `world_editor_placements` and water under its own key, and a sculpt that
 * shared a store with either would be lost the first time that tool's
 * `clear` ran.
 */
export const SCULPT_STORE_KEY = 'world_sculpt_delta'

const STORE_VERSION = 1
/**
 * Offsets are stored as centimetres in an `Int16`, which halves the store and
 * caps a tile at 8 KB of base64 instead of 16.
 *
 * localStorage is the tightest resource this feature touches (~5 MB), and 1 cm
 * is 200× finer than the 2 m spacing of the *finest* terrain tier — it cannot
 * reach the mesh. The ±327 m range is an order of magnitude past the 30 m
 * amplitude of the world itself.
 */
const QUANTUM = 0.01
const MAX_STORED_TILES = 512

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Hand-rolled rather than `btoa(String.fromCharCode(...bytes))`: spreading an
 * 8 KB byte array into a call blows the argument limit on some engines, and
 * chunking around that is the same amount of code as just doing it.
 */
const toBase64 = (bytes: Uint8Array): string => {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
    out += BASE64[(n >>> 18) & 63]! + BASE64[(n >>> 12) & 63]! + BASE64[(n >>> 6) & 63]! + BASE64[n & 63]!
  }
  const left = bytes.length - i
  if (left === 1) {
    const n = bytes[i]! << 16
    out += `${BASE64[(n >>> 18) & 63]!}${BASE64[(n >>> 12) & 63]!}==`
  } else if (left === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8)
    out += `${BASE64[(n >>> 18) & 63]!}${BASE64[(n >>> 12) & 63]!}${BASE64[(n >>> 6) & 63]!}=`
  }
  return out
}

const fromBase64 = (text: string): Uint8Array | null => {
  const clean = text.replace(/=+$/, '')
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let acc = 0
  let bits = 0
  let cursor = 0
  for (let i = 0; i < clean.length; i++) {
    const value = BASE64.indexOf(clean[i]!)
    if (value < 0) {
      return null
    }
    acc = (acc << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[cursor++] = (acc >>> bits) & 255
    }
  }
  return cursor === bytes.length ? bytes : bytes.subarray(0, cursor)
}

interface StoredTile {
  x: number
  z: number
  d: string
}

interface StoredSculpt {
  v: number
  cell: number
  tile: number
  tiles: StoredTile[]
}

/** The delta as a JSON string, or `null` when there is nothing to store. */
export const serialiseSculpt = (field: SculptField): string | null => {
  const patch = field.fullPatch()
  const n = field.tileCells
  const tiles: StoredTile[] = []

  for (const entry of patch.tiles) {
    const data = entry.data
    if (!data) {
      continue
    }
    // Explicit little-endian rather than an `Int16Array` view, so the bytes do
    // not depend on the machine that wrote them.
    const bytes = new Uint8Array(n * n * 2)
    const view = new DataView(bytes.buffer)
    let occupied = false
    for (let i = 0; i < data.length; i++) {
      const q = Math.round(data[i]! / QUANTUM)
      const clamped = q > 32767 ? 32767 : q < -32768 ? -32768 : q
      if (clamped !== 0) {
        occupied = true
      }
      view.setInt16(i * 2, clamped, true)
    }
    // A tile whose every sample rounds to zero is a tile the user erased back
    // to nothing. Storing it would grow the save forever.
    if (occupied) {
      tiles.push({ x: entry.tx, z: entry.tz, d: toBase64(bytes) })
    }
  }

  if (tiles.length === 0) {
    return null
  }
  const store: StoredSculpt = { v: STORE_VERSION, cell: field.cellSize, tile: n, tiles }
  return JSON.stringify(store)
}

/**
 * Rebuilds a delta from a stored string.
 *
 * Returns an **empty field** for anything it does not fully understand —
 * absent, unparseable, wrong version, wrong tile geometry, a tile whose
 * payload is the wrong length. A half-restored terrain is worse than a flat
 * one: the player would be standing on ground that does not match the ground
 * the workers built.
 */
export const parseSculpt = (raw: string | null | undefined): SculptField => {
  const field = new SculptField()
  if (!raw) {
    return field
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.warn('[sculpt] stored delta is not valid JSON — starting flat')
    return field
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return field
  }
  const store = parsed as Partial<StoredSculpt>
  if (store.v !== STORE_VERSION || store.cell !== field.cellSize || store.tile !== field.tileCells) {
    console.warn('[sculpt] stored delta has a different layout — starting flat')
    return field
  }
  if (!Array.isArray(store.tiles)) {
    return field
  }

  const n = field.tileCells
  const expected = n * n * 2
  const tiles: SculptTilePatch[] = []

  for (const entry of store.tiles.slice(0, MAX_STORED_TILES)) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }
    const tile = entry as Partial<StoredTile>
    if (!Number.isInteger(tile.x) || !Number.isInteger(tile.z) || typeof tile.d !== 'string') {
      continue
    }
    const bytes = fromBase64(tile.d)
    if (!bytes || bytes.length !== expected) {
      console.warn('[sculpt] stored tile has the wrong length — dropping it')
      continue
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const data = new Float32Array(n * n)
    for (let i = 0; i < data.length; i++) {
      data[i] = view.getInt16(i * 2, true) * QUANTUM
    }
    tiles.push({ tx: tile.x as number, tz: tile.z as number, data })
  }

  field.applyPatch({ cellSize: field.cellSize, tileCells: n, tiles })
  return field
}
