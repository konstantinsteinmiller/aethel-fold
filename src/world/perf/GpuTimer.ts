/**
 * ─── GPU timer queries ──────────────────────────────────────────────────────
 *
 * `EXT_disjoint_timer_query_webgl2` — the only way to get a real GPU-side cost
 * out of WebGL, and the reason the ablation profiler produces numbers worth
 * acting on.
 *
 * Why CPU frame time isn't enough: with vsync on, a scene that costs 6 ms of
 * GPU time and one that costs 15 ms both report 16.6 ms per frame. Every
 * measurement of "which asset is expensive" is meaningless until you're already
 * dropping frames — at which point everything is expensive. Timer queries read
 * the GPU's own clock, so a 0.8 ms difference is visible while the frame is
 * still comfortably inside budget.
 *
 * The awkward parts are inherent to the extension, not to this wrapper:
 *
 * • Results are asynchronous — typically 1–3 frames late. Callers must treat
 *   `milliseconds` as "recent", never as "this frame".
 * • Only one `TIME_ELAPSED_EXT` query can be open at a time per context, so
 *   this brackets the whole frame rather than individual passes. Per-pass
 *   attribution comes from ablation instead.
 * • `GPU_DISJOINT_EXT` means the GPU was interrupted (power state change, other
 *   tabs) and every in-flight result is garbage. They all have to be thrown out.
 * • The extension is absent on Safari and on a number of mobile drivers, and is
 *   sometimes disabled entirely as a fingerprinting mitigation. `supported`
 *   must be checked, not assumed.
 */

interface TimerExtension {
  TIME_ELAPSED_EXT: number
  GPU_DISJOINT_EXT: number
}

export class GpuTimer {
  readonly supported: boolean

  private readonly gl: WebGL2RenderingContext
  private readonly ext: TimerExtension | null
  private readonly pool: WebGLQuery[] = []
  private readonly pending: WebGLQuery[] = []
  private active: WebGLQuery | null = null
  private latest = 0

  /** Rolling average, which is what a HUD should show — raw samples jitter. */
  private smoothed = 0

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null
    this.supported = this.ext !== null
  }

  /** Last resolved GPU frame time in ms. 0 when unsupported or not yet resolved. */
  get milliseconds(): number {
    return this.latest
  }

  get smoothedMilliseconds(): number {
    return this.smoothed
  }

  begin(): void {
    if (!this.ext || this.active) {
      return
    }
    // Cap the in-flight depth. If results stop arriving (a driver that accepts
    // the queries and never resolves them) this would otherwise leak a query
    // object every frame.
    if (this.pending.length > 4) {
      return
    }
    const query = this.pool.pop() ?? this.gl.createQuery()
    if (!query) {
      return
    }
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query)
    this.active = query
  }

  end(): void {
    if (!this.ext || !this.active) {
      return
    }
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT)
    this.pending.push(this.active)
    this.active = null
  }

  /** Call once per frame after `end()`. Resolves whatever the GPU has finished. */
  poll(): void {
    if (!this.ext || this.pending.length === 0) {
      return
    }

    if (this.gl.getParameter(this.ext.GPU_DISJOINT_EXT)) {
      // Disjoint: every in-flight timing is invalid, not just the oldest.
      for (const query of this.pending) {
        this.pool.push(query)
      }
      this.pending.length = 0
      return
    }

    // Queries resolve in submission order, so stop at the first unfinished one.
    while (this.pending.length > 0) {
      const query = this.pending[0]!
      if (!this.gl.getQueryParameter(query, this.gl.QUERY_RESULT_AVAILABLE)) {
        break
      }
      this.pending.shift()
      const nanoseconds = this.gl.getQueryParameter(query, this.gl.QUERY_RESULT) as number
      this.latest = nanoseconds / 1e6
      this.smoothed = this.smoothed === 0 ? this.latest : this.smoothed * 0.85 + this.latest * 0.15
      this.pool.push(query)
    }
  }

  dispose(): void {
    for (const query of this.pool) {
      this.gl.deleteQuery(query)
    }
    for (const query of this.pending) {
      this.gl.deleteQuery(query)
    }
    this.pool.length = 0
    this.pending.length = 0
    this.active = null
  }
}
