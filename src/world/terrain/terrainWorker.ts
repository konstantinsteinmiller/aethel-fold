import { buildChunkBuffers, type ChunkRequest } from './chunkGeometry'
import { DEFAULT_HEIGHTFIELD_PARAMS, type HeightfieldParams } from './heightfieldCore'

/**
 * ─── Terrain chunk worker ───────────────────────────────────────────────────
 *
 * Builds chunk geometry off the main thread and returns the typed arrays as
 * **transferables** — ownership moves, nothing is copied. A 24×24 chunk is
 * ~90 KB across four arrays; structured-cloning that per chunk while streaming
 * would put the copy cost right back on the thread we moved the work off.
 *
 * It imports only `chunkGeometry` and `heightfieldCore`, both three.js-free, so
 * this bundle stays a few kilobytes instead of shipping a second copy of three.
 * That constraint is why those two files exist at all — see the notes there.
 */

interface InitMessage {
  type: 'init'
  params: HeightfieldParams
  /** Linear-RGB triples; see `TERRAIN_PALETTE_SLOTS`. */
  palette: Float32Array
}

interface BuildMessage {
  type: 'build'
  /** Echoed back so the streamer can match a result to a request it may have
   *  since cancelled. */
  id: number
  /** All four LOD tiers of one chunk, in one message. */
  requests: ChunkRequest[]
}

export type TerrainWorkerMessage = InitMessage | BuildMessage

/**
 * Buffers as they cross the wire. Typed loosely on the buffer parameter because
 * `buildChunkBuffers` returns arrays over `ArrayBufferLike`, and pinning them to
 * `ArrayBuffer` here would fail on the `SharedArrayBuffer` branch of the union
 * for no practical gain — these are always plain, transferable buffers.
 */
export interface TerrainTierBuffers {
  position: Float32Array<ArrayBufferLike>
  /** Int16, normalized. See `chunkGeometry`'s compression notes. */
  normal: Int16Array<ArrayBufferLike>
  /** Uint16, normalized. */
  color: Uint16Array<ArrayBufferLike>
  index: Uint16Array<ArrayBufferLike> | Uint32Array<ArrayBufferLike>
  boundsY: [number, number]
}

export interface TerrainWorkerResult {
  type: 'chunk'
  id: number
  /** One entry per LOD tier, in request order. */
  tiers: TerrainTierBuffers[]
  /** Wall-clock generation time, so the streamer can pace itself honestly. */
  buildMs: number
}

let params: HeightfieldParams = DEFAULT_HEIGHTFIELD_PARAMS
// Annotated, not inferred: the initialiser would narrow this to
// `Float32Array<ArrayBuffer>` and then reject the transferred array on init.
let palette: Float32Array<ArrayBufferLike> = new Float32Array(18)

self.onmessage = (event: MessageEvent<TerrainWorkerMessage>): void => {
  const message = event.data

  if (message.type === 'init') {
    params = message.params
    palette = message.palette
    return
  }

  const started = performance.now()
  const tiers = message.requests.map(request => buildChunkBuffers(request, params, palette))
  const result: TerrainWorkerResult = {
    type: 'chunk',
    id: message.id,
    tiers,
    buildMs: performance.now() - started
  }

  // Every buffer is transferred, not cloned — after this call they are detached
  // here and owned by the main thread.
  const transfer: ArrayBufferLike[] = []
  for (const tier of tiers) {
    transfer.push(tier.position.buffer, tier.normal.buffer, tier.color.buffer, tier.index.buffer)
  }
  ;(self as unknown as Worker).postMessage(result, transfer as Transferable[])
}
