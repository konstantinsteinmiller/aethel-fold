import type { Vector3 } from 'three'
import { BufferAttribute, BufferGeometry, Group, Mesh } from 'three'
import type { ChunkWorkerPool } from './ChunkWorkerPool'
import type { ChunkBuffers } from './chunkGeometry'
import type { TerrainMaterial } from './TerrainMaterial'

/**
 * ─── Distant terrain, one draw call ─────────────────────────────────────────
 *
 * Owns the coarse mesh from `distantRing.ts` and keeps it centred on the
 * viewer. See that file for why the ring exists and why it has a hole.
 *
 * ── Snapping, not following ─────────────────────────────────────────────────
 *
 * The mesh is rebuilt only when the camera crosses a `snapStep` boundary, not
 * every frame. Two reasons, and the second is the one that matters:
 *
 *   1. Rebuilding samples the heightfield across the whole grid — a few
 *      thousand `heightAtCore` calls. Cheap, but not per-frame cheap.
 *   2. A ring that slid smoothly with the camera would make the terrain
 *      *swim*: the coarse mesh would re-sample the height function at shifting
 *      positions every frame, so distant ridges would visibly crawl. Snapping
 *      to a grid means every vertex either stays exactly where it was or jumps
 *      once, at a distance where fog has already flattened the contrast.
 *
 * Reuses the streamed terrain's material, so this costs **no extra program** —
 * the same banded ramp, periwinkle shadow tint and fog reach both surfaces,
 * which is what makes the seam at the hole edge invisible rather than a
 * material change at 190 m.
 */

/**
 * Minimum gap between *sculpt-driven* ring rebuilds, in ms. See `update`.
 *
 * A held brush invalidates continuously; the ring only has to catch up once the
 * stroke settles, and it is 170 m away from whatever is being edited.
 */
const INVALIDATE_COOLDOWN_MS = 700

export interface DistantTerrainOptions {
  /** Half-extent of the covered square, in metres. */
  outerRadius?: number
  /** Ground the streamer covers, omitted from the ring. */
  holeRadius?: number
  /** Quads per edge across the full square. */
  segments?: number
  /** Camera travel that triggers a re-centre. */
  snapStep?: number
  /**
   * Metres the ring sits below true ground.
   *
   * The hole is cut at quad granularity, so a quad straddling the boundary
   * contributes triangles that lie entirely inside it — the ring and the
   * streamed chunks therefore overlap by up to one cell however the coverage
   * test is written. Coincident surfaces z-fight, which shimmers; a surface a
   * couple of metres lower simply loses. The streamed chunks win the whole
   * overlap band, and past it the ring is the only ground there is.
   */
  depthDrop?: number
}

export class DistantTerrain {
  readonly group = new Group()

  private readonly pool: ChunkWorkerPool
  private readonly outerRadius: number
  private readonly holeRadius: number
  private readonly segments: number
  private readonly snapStep: number
  private readonly depthDrop: number

  private readonly material: TerrainMaterial
  private mesh: Mesh | null = null
  private pending = 0
  /** Set by `invalidate`; survives until a build actually starts. */
  private dirty = false
  private startedAt = Number.NEGATIVE_INFINITY
  private centerX = Number.POSITIVE_INFINITY
  private centerZ = Number.POSITIVE_INFINITY

  /** Diagnostics for the perf panel. */
  readonly stats = { triangles: 0, rebuilds: 0, lastBuildMs: 0 }

  constructor(pool: ChunkWorkerPool, material: TerrainMaterial, options: DistantTerrainOptions = {}) {
    const {
      // 1.4 km of ground. Past that the fog is opaque and the ring is paying for
      // geometry nobody can distinguish from sky.
      outerRadius = 1400,
      // Slightly *inside* the streamer's 190 m load radius, so the detailed
      // chunks always overlap the ring's inner edge rather than leaving a gap
      // when a chunk is briefly missing.
      holeRadius = 170,
      // 96 quads over 2.8 km is a 29 m cell — coarse enough to be cheap, fine
      // enough that a ridge silhouette still reads as a ridge.
      segments = 96,
      snapStep = 192,
      // Two metres. Enough to lose the depth fight against a 29 m-cell surface
      // on ordinary slopes, small enough that the step where the streamed
      // terrain ends is a hairline at 190 m through exp² fog rather than a ledge.
      depthDrop = 2
    } = options

    this.pool = pool
    this.outerRadius = outerRadius
    this.holeRadius = holeRadius
    this.segments = segments
    this.snapStep = snapStep
    this.depthDrop = depthDrop

    this.group.name = 'distant-terrain'
    // Deliberately not its own perf tag. The group hangs inside `terrain`'s, and
    // `registerRoot` is what actually creates a bucket — a `userData.perfTag`
    // set here would register nothing and read as a missing measurement. The
    // ring shows up in the `terrain` row, which is where it belongs: it is the
    // same surface, the same material, further away.

    this.material = material
  }

  /**
   * Re-centres if the viewer has crossed a snap boundary. Cheap when it hasn't.
   *
   * The build itself goes to the terrain worker and lands a frame or several
   * later; only the upload is main-thread. Built inline it cost 17.4 ms on a
   * desktop — a hitch every 192 m — which is precisely the class of cost the
   * chunk streamer already exists to keep off the frame.
   */
  update(cameraPosition: Vector3): void {
    const snappedX = Math.round(cameraPosition.x / this.snapStep) * this.snapStep
    const snappedZ = Math.round(cameraPosition.z / this.snapStep) * this.snapStep
    const movedCentre = snappedX !== this.centerX || snappedZ !== this.centerZ
    if (!this.dirty && !movedCentre) {
      return
    }
    // One build in flight at a time.
    if (this.pending > 0) {
      return
    }
    // ── Sculpt-driven rebuilds are rate-limited; camera-driven ones are not ───
    //
    // An editor drag calls `invalidate()` every few frames. A one-in-flight
    // guard alone does not coalesce that: each ~17 ms worker build finishes
    // before the next call arrives, so twenty invalidations measured **sixteen
    // rebuilds** — a quarter-second of worker time competing with the chunk
    // rebuilds the same drag depends on. A cooldown is what actually collapses
    // a stroke into one rebuild.
    //
    // Deliberately not applied when the *centre* moved: crossing a snap boundary
    // is rare and the ring is on screen, so that rebuild should be prompt.
    if (!movedCentre && performance.now() - this.startedAt < INVALIDATE_COOLDOWN_MS) {
      return
    }
    // Claimed immediately, not on arrival: without this every frame until the
    // build returns would queue another one for the same centre.
    this.dirty = false
    this.startedAt = performance.now()
    this.centerX = snappedX
    this.centerZ = snappedZ
    this.pending++

    void this.pool.buildRing({
      centerX: snappedX,
      centerZ: snappedZ,
      outerRadius: this.outerRadius,
      holeRadius: this.holeRadius,
      segments: this.segments
    }).then(result => {
      this.pending--
      const buffers = result.tiers[0]
      if (!buffers) {
        return
      }
      // A result for a centre the viewer has already left is dropped rather than
      // uploaded: two rings in flight would otherwise land out of order and the
      // older one would win.
      if (snappedX !== this.centerX || snappedZ !== this.centerZ) {
        return
      }
      this.upload(buffers as ChunkBuffers, snappedX, snappedZ)
    })
  }

  /**
   * Forces a rebuild on the next `update`.
   *
   * The ring is built from the same heightfield params as the chunks, sculpt
   * delta included — but it only rebuilds when the viewer crosses a snap
   * boundary, so an editor stroke would otherwise leave it showing terrain that
   * no longer exists until someone walked 192 m. Cheap to call: it re-arms the
   * centre check rather than doing any work here.
   */
  invalidate(): void {
    this.dirty = true
  }

  private upload(buffers: ChunkBuffers, centerX: number, centerZ: number): void {
    const started = performance.now()
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(buffers.position, 3))
    // Normalized integers, exactly as the streamed chunks use — see
    // `chunkGeometry`'s compression notes. The GPU expands them, so the shader
    // is unchanged and both surfaces sample the same way.
    geometry.setAttribute('normal', new BufferAttribute(buffers.normal, 3, true))
    geometry.setAttribute('color', new BufferAttribute(buffers.color, 3, true))
    geometry.setIndex(new BufferAttribute(buffers.index, 1))
    geometry.computeBoundingSphere()

    if (this.mesh) {
      // Replace the geometry rather than the mesh: the mesh carries the material
      // and its shadow flags, and swapping it would re-add a node to the scene
      // every 192 m of travel.
      this.mesh.geometry.dispose()
      this.mesh.geometry = geometry
    } else {
      const mesh = new Mesh(geometry, this.material)
      mesh.name = 'distant-terrain/mesh'
      // Never casts and never receives. At this scale a shadow map texel covers
      // tens of metres, so the ring would receive a smear rather than a shadow —
      // and casting would put the whole 2.8 km square into every cascade, which
      // is the cost the shadow work just removed.
      mesh.castShadow = false
      mesh.receiveShadow = false
      // Drawn before the streamed chunks: it is the furthest thing in the scene
      // apart from the sky, so filling it first lets the detailed terrain reject
      // against it rather than the other way round.
      mesh.renderOrder = -1
      this.mesh = mesh
      this.group.add(mesh)
    }

    this.mesh.position.set(centerX - this.outerRadius, -this.depthDrop, centerZ - this.outerRadius)
    this.centerX = centerX
    this.centerZ = centerZ
    this.stats.triangles = buffers.index.length / 3
    this.stats.rebuilds++
    this.stats.lastBuildMs = Math.round((performance.now() - started) * 10) / 10
  }

  dispose(): void {
    this.mesh?.geometry.dispose()
    this.group.clear()
    this.mesh = null
  }
}
