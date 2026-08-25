import type { ChunkRequest } from './chunkGeometry'
import { buildDistantRing, type DistantRingRequest } from './distantRing'
import { buildChunkBuffers } from './chunkGeometry'
import type { HeightfieldParams } from './heightfieldCore'
import type { SculptPatch } from './SculptField'
import type { TerrainWorkerResult } from './terrainWorker'

/**
 * ─── Worker pool ────────────────────────────────────────────────────────────
 *
 * Round-robins chunk builds across a small pool and resolves them by id.
 *
 * **Falls back to the main thread** when workers are unavailable — some
 * embedded portal webviews block them, and a game that renders no ground at all
 * on those is worse than one that stutters for a second while it builds. The
 * fallback runs `buildChunkBuffers`, the same function the worker runs, so the
 * two paths cannot drift apart.
 *
 * Pool size is capped at 3: chunk generation is memory-bandwidth bound rather
 * than compute bound, so more workers stop helping quickly, and each one costs
 * a thread on a phone that has few to spare.
 */

export interface PendingChunk {
  id: number
  requests: ChunkRequest[]
  resolve: (result: TerrainWorkerResult) => void
}

const MAX_WORKERS = 3

export class ChunkWorkerPool {
  readonly usingWorkers: boolean

  private readonly workers: Worker[] = []
  private readonly pending = new Map<number, PendingChunk>()
  private readonly params: HeightfieldParams
  private readonly palette: Float32Array
  private nextId = 1
  private cursor = 0
  private disposed = false

  constructor(params: HeightfieldParams, palette: Float32Array, requested = 2) {
    this.params = params
    this.palette = palette

    const count = Math.max(1, Math.min(MAX_WORKERS, requested))
    let created = 0
    try {
      for (let i = 0; i < count; i++) {
        // `new URL(..., import.meta.url)` is the form Vite statically analyses
        // to emit the worker as its own chunk. A string path silently ships
        // nothing and 404s at runtime.
        const worker = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (event: MessageEvent<TerrainWorkerResult>) => this.onMessage(event.data)
        // A worker that dies mid-flight must not strand its request forever.
        worker.onerror = () => this.failWorker(worker)
        worker.postMessage({ type: 'init', params, palette })
        this.workers.push(worker)
        created++
      }
    } catch {
      // Blocked or unsupported — tear down whatever came up and go synchronous.
      for (const worker of this.workers) {
        worker.terminate()
      }
      this.workers.length = 0
      created = 0
    }
    this.usingWorkers = created > 0
  }

  get inFlight(): number {
    return this.pending.size
  }

  /**
   * Queues a build. The promise resolves when the geometry arrives; the caller
   * decides when to actually spend main-thread time turning it into a mesh.
   */
  build(requests: ChunkRequest[]): Promise<TerrainWorkerResult> {
    const id = this.nextId++

    if (!this.usingWorkers) {
      // Synchronous fallback. Still a promise so the streamer has one code path,
      // and still budget-gated on the consuming side.
      return Promise.resolve(this.buildInline(id, requests))
    }

    return new Promise<TerrainWorkerResult>(resolve => {
      this.pending.set(id, { id, requests, resolve })
      const worker = this.workers[this.cursor % this.workers.length]!
      this.cursor++
      worker.postMessage({ type: 'build', id, requests })
    })
  }

  /**
   * Queues a distant-ring build. Same lifecycle as `build`, same fallback.
   *
   * Separate from `build` because the ring is one mesh with a hole rather than
   * four tiers of a square — see `distantRing.ts`. It shares the worker so the
   * ring's ~17 ms of height sampling never lands on a frame.
   */
  buildRing(request: DistantRingRequest): Promise<TerrainWorkerResult> {
    const id = this.nextId++

    if (!this.usingWorkers) {
      return Promise.resolve({
        type: 'chunk',
        id,
        tiers: [buildDistantRing(request, this.params, this.palette)],
        buildMs: 0
      })
    }

    return new Promise<TerrainWorkerResult>(resolve => {
      this.pending.set(id, { id, requests: [], resolve })
      const worker = this.workers[this.cursor % this.workers.length]!
      this.cursor++
      worker.postMessage({ type: 'ring', id, request })
    })
  }

  /**
   * Broadcasts an editor sculpt patch to every worker.
   *
   * Ordering does the work here: `postMessage` is FIFO per worker, so any build
   * queued after this call sees the new offsets, and any build queued before it
   * lands with the old ones — which is why the sculptor pushes the patch first
   * and only then asks `Terrain` to rebuild.
   *
   * The inline fallback needs nothing: it evaluates `this.params`, the very
   * object the main thread's `SculptField` is attached to.
   */
  setSculptDelta(patch: SculptPatch): void {
    for (const worker of this.workers) {
      worker.postMessage({ type: 'sculpt', patch })
    }
  }

  private buildInline(id: number, requests: ChunkRequest[]): TerrainWorkerResult {
    const started = performance.now()
    return {
      type: 'chunk',
      id,
      tiers: requests.map(request => buildChunkBuffers(request, this.params, this.palette)),
      buildMs: performance.now() - started
    }
  }

  private onMessage(result: TerrainWorkerResult): void {
    const entry = this.pending.get(result.id)
    if (!entry) {
      return
    }
    this.pending.delete(result.id)
    entry.resolve(result)
  }

  /**
   * A worker crashed. Rebuild its outstanding requests on the main thread rather
   * than leaving chunks permanently missing — a hole in the ground is a far
   * worse failure than a frame of jank.
   */
  private failWorker(worker: Worker): void {
    worker.terminate()
    const index = this.workers.indexOf(worker)
    if (index >= 0) {
      this.workers.splice(index, 1)
    }
    if (this.disposed) {
      return
    }
    for (const [id, entry] of [...this.pending]) {
      this.pending.delete(id)
      entry.resolve(this.buildInline(id, entry.requests))
    }
  }

  dispose(): void {
    this.disposed = true
    for (const worker of this.workers) {
      worker.terminate()
    }
    this.workers.length = 0
    this.pending.clear()
  }
}
