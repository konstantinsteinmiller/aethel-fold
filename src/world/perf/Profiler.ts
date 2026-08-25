import type { Object3D, WebGLRenderer } from 'three'
import type { InstancedBufferGeometry } from 'three'
import { InstancedMesh, Mesh } from 'three'
import { GpuTimer } from './GpuTimer'

/**
 * ─── Per-asset performance attribution ──────────────────────────────────────
 *
 * GDD §5.3. Answers "which assets and NPCs waste the most performance" three
 * ways, in ascending order of honesty:
 *
 * 1. **Counters** — visible draw calls, triangles and instances per tag, walked
 *    from the scene graph each frame. Cheap, always on, and enough to catch a
 *    tag that's drawing 40 000 triangles it shouldn't be.
 *
 * 2. **CPU system timers** — each update system brackets itself, so a tag that
 *    is cheap to *draw* but expensive to *update* (skinned monsters, LOD
 *    bucketing over 5 000 instances) is still caught. Triangle counts say
 *    nothing about this and it's frequently where the frame actually goes.
 *
 * 3. **Ablation** — the one that's actually true. Hide one tag, measure the drop
 *    in GPU frame time, restore, repeat. Everything else is a proxy: a tag with
 *    huge triangle counts may be nearly free (small on screen, early-z rejected)
 *    while a tag with 200 triangles may cost 3 ms (giant overdraw, or it forced
 *    a shader recompile). Ablation measures the thing you'd actually get back by
 *    deleting it, which is the only number worth optimising against.
 *
 * The ablation run is deliberately not continuous — it visibly changes the
 * scene while it runs. It's a button.
 */

export interface TagStats {
  tag: string
  drawCalls: number
  triangles: number
  instances: number
  /** ms of CPU update time, from `beginCpu`/`endCpu`. */
  cpuMs: number
  /** ms of GPU time attributed by the last ablation run. -1 = not measured. */
  gpuMs: number
}

export interface FrameStats {
  fps: number
  cpuMs: number
  gpuMs: number
  gpuSupported: boolean
  drawCalls: number
  triangles: number
  programs: number
  geometries: number
  textures: number
  /**
   * ─── Percentiles, not averages ────────────────────────────────────────────
   *
   * A mean frame time hides exactly what players feel. A scene running at a
   * flawless 8 ms mean that spends one frame in sixty at 40 ms reads as
   * *stuttering*, and the mean moves by 0.5 ms — invisible. Streaming makes
   * this the number that matters: chunk uploads land on individual frames, so
   * the whole cost shows up in the tail and nowhere else.
   *
   * Measured over a 240-frame window (~4 s at 60 fps).
   */
  frameMsP50: number
  frameMsP95: number
  frameMsP99: number
  /** Worst frame in the window. The one users actually notice. */
  frameMsMax: number
  /** Frames in the window that missed a 60 Hz budget (>16.7 ms). */
  jankFrames: number
  /**
   * Cost of the profiler's own scene walk, on the frames it runs. Exposed
   * because an instrument that cannot report its own overhead is one you cannot
   * trust when it matters.
   */
  profilerMs: number
  /**
   * CPU time inside `renderer.render()` — draw submission, uniform uploads and
   * the shadow passes, not GPU time.
   *
   * Split out because the per-tag CPU table only covers the systems that wrap
   * themselves in `beginCpu`/`endCpu`, and on a constrained device those added
   * up to 12.8 ms of a 31.8 ms frame. The missing 19 ms had no owner, and
   * "unattributed" is where the wrong optimisation gets chosen: the far-field
   * instance loop was about to be rebuilt on the assumption that it was the
   * problem, when the scatter fields together cost 6 ms.
   */
  renderMs: number
  /**
   * Longest gap between frames ever seen, in ms — **unfiltered**.
   *
   * The percentile window discards deltas over a second as tab-switches, which
   * is right for percentiles and wrong for finding freezes: a genuine 2.4 s
   * stall from deferred asset generation reported a `worst` of 165 ms, because
   * the real number had been thrown away as noise. A filter that hides the worst
   * thing that happened needs a companion that doesn't.
   */
  longestStallMs: number
  /**
   * ─── What the frame rate would be with vsync out of the way ───────────────
   *
   * `fps` is pinned to the display: a 6 ms scene and a 15 ms scene both read 60.
   * That is the single most misleading number on the panel, and the reason this
   * project's rules say to judge by GPU ms rather than fps. This is the same
   * information as a rate — how fast frames *could* be presented if each one
   * started the moment the last finished.
   *
   * `1000 / max(cpuMs, gpuMs)`, because the two are pipelined: the CPU builds
   * frame N+1 while the GPU draws frame N, so the ceiling is set by whichever
   * stage is slower, not by their sum. Which one that is, is the actionable half
   * of the number — hence `uncappedBy`.
   *
   * **It is an upper bound, and an optimistic one.** `cpuMs` covers our own loop
   * between `beginFrame` and `endFrame` and nothing else: browser compositing,
   * event dispatch, GC and rAF overhead are all outside it. Treat a large gap
   * between this and `fps` as "there is headroom here", never as a promise of
   * that number on an unlocked display.
   */
  uncappedFps: number
  /** Which stage sets the ceiling above. `none` = nothing measured yet. */
  uncappedBy: 'cpu' | 'gpu' | 'none'
}

interface Root {
  object: Object3D
  tag: string
}

/** ~4 s at 60 fps. Long enough to catch a rare hitch, short enough to react. */
const PERCENTILE_WINDOW = 240
/** Recomputing percentiles needs a sort, so it runs on a subset of frames. */
const PERCENTILE_INTERVAL = 15
const FRAME_BUDGET_MS = 1000 / 60

/**
 * Frames between per-tag stat collections. The panel samples at 8 Hz, so
 * anything under ~7 is measuring more often than anyone reads.
 */
const TAG_STATS_INTERVAL = 6

/** Frames to let the pipeline settle after toggling visibility. */
const ABLATION_WARMUP = 8
/** Frames sampled per step. Median of these is the measurement. */
const ABLATION_SAMPLES = 14

type AblationPhase = 'idle' | 'baseline' | 'tag'

export class Profiler {
  /**
   * Whether anything is reading the per-tag table.
   *
   * Set by the perf panel from its own visibility. The tag walk traverses the
   * whole scene graph, and the ablation profiler overrides this while it runs,
   * so turning it off costs nothing that anyone can see.
   */
  collectTags = true

  readonly frame: FrameStats = {
    fps: 0,
    cpuMs: 0,
    gpuMs: 0,
    gpuSupported: false,
    drawCalls: 0,
    triangles: 0,
    programs: 0,
    geometries: 0,
    textures: 0,
    frameMsP50: 0,
    frameMsP95: 0,
    frameMsP99: 0,
    frameMsMax: 0,
    jankFrames: 0,
    profilerMs: 0,
    renderMs: 0,
    longestStallMs: 0,
    uncappedFps: 0,
    uncappedBy: 'none'
  }

  /** Tag stats, rebuilt each frame. Stable object identity per tag. */
  readonly tags = new Map<string, TagStats>()

  private readonly roots: Root[] = []
  private readonly timer: GpuTimer
  private readonly cpuMarks = new Map<string, number>()
  private readonly cpuAccumulator = new Map<string, number>()

  private frameStart = 0
  private frameTimes: number[] = []
  /** EMA behind `uncappedFps` — see `updateUncapped`. */
  private smoothedCpuMs = 0

  // Ring buffer of frame *deltas*, plus a scratch copy for sorting. The buffers
  // are preallocated and the sort is amortised across PERCENTILE_INTERVAL
  // frames — a per-frame sort on the path that measures jank would be its own
  // source of it. (The two `subarray` views per recompute are the one small
  // allocation, once every 15 frames.)
  private readonly frameDeltas = new Float32Array(PERCENTILE_WINDOW)
  private readonly sortScratch = new Float32Array(PERCENTILE_WINDOW)
  private deltaCursor = 0
  private deltaFilled = 0
  private lastFrameTime = 0
  private percentileCountdown = 0
  private tagCountdown = 0

  // ── Ablation state ───────────────────────────────────────────────────────
  private phase: AblationPhase = 'idle'
  private queue: string[] = []
  private currentTag = ''
  private stepFrame = 0
  private samples: number[] = []
  private baselineMs = 0
  private ablationProgress = 0

  constructor(renderer: WebGLRenderer) {
    this.timer = new GpuTimer(renderer.getContext() as WebGL2RenderingContext)
    this.frame.gpuSupported = this.timer.supported
  }

  /**
   * Registers a scene root under a tag. Anything not registered is invisible to
   * the profiler and its cost lands in nobody's column — which is why
   * `CLAUDE.md` makes registration a rule rather than a suggestion.
   */
  registerRoot(object: Object3D, tag: string): void {
    object.userData.perfTag = tag
    this.roots.push({ object, tag })
    if (!this.tags.has(tag)) {
      this.tags.set(tag, { tag, drawCalls: 0, triangles: 0, instances: 0, cpuMs: 0, gpuMs: -1 })
    }
  }

  // ── CPU system timing ────────────────────────────────────────────────────

  beginCpu(tag: string): void {
    this.cpuMarks.set(tag, performance.now())
  }

  endCpu(tag: string): void {
    const start = this.cpuMarks.get(tag)
    if (start === undefined) {
      return
    }
    this.cpuAccumulator.set(tag, (this.cpuAccumulator.get(tag) ?? 0) + (performance.now() - start))
    this.cpuMarks.delete(tag)
  }

  // ── Frame hooks ──────────────────────────────────────────────────────────

  beginFrame(renderer: WebGLRenderer): void {
    this.frameStart = performance.now()
    renderer.info.reset()
    this.timer.begin()
  }

  endFrame(renderer: WebGLRenderer, now: number): void {
    this.timer.end()
    this.timer.poll()

    this.frame.cpuMs = performance.now() - this.frameStart
    this.frame.gpuMs = this.timer.smoothedMilliseconds
    this.frame.drawCalls = renderer.info.render.calls
    this.frame.triangles = renderer.info.render.triangles
    this.frame.programs = renderer.info.programs?.length ?? 0
    this.frame.geometries = renderer.info.memory.geometries
    this.frame.textures = renderer.info.memory.textures

    // 60-frame rolling window, same shape as the 2D game's FPerfMeter so the
    // two numbers are comparable.
    this.frameTimes.push(now)
    if (this.frameTimes.length > 60) {
      this.frameTimes.shift()
    }
    if (this.frameTimes.length >= 2) {
      const elapsed = this.frameTimes[this.frameTimes.length - 1]! - this.frameTimes[0]!
      if (elapsed > 0) {
        this.frame.fps = Math.round(((this.frameTimes.length - 1) * 1000) / elapsed)
      }
    }

    this.recordFrameDelta(now)
    this.updateUncapped()

    // Per-tag stats walk the *entire* scene graph. The panel reads them at 8 Hz,
    // so collecting at 60 Hz was pure waste — and not cheap waste: under a 4×
    // CPU throttle this traversal was a measurable slice of a frame in which the
    // systems it measures cost 2.26 ms combined. A profiler that distorts the
    // frame it is measuring is worse than no profiler.
    //
    // The ablation profiler needs them fresh, so it forces every frame while it
    // runs.
    //
    // `collectTags` is the panel saying whether anyone is looking. Minimising
    // the panel stops the walk outright rather than merely hiding its output —
    // an instrument nobody is reading should cost nothing, and this one is
    // expensive enough to have shown up in its own measurements.
    if ((this.collectTags && --this.tagCountdown <= 0) || this.phase !== 'idle') {
      this.tagCountdown = TAG_STATS_INTERVAL
      const started = performance.now()
      this.collectTagStats()
      this.frame.profilerMs = Math.round((performance.now() - started) * 100) / 100
    } else {
      this.frame.profilerMs = 0
    }

    this.stepAblation()
  }

  /**
   * The vsync-free frame rate ceiling. See `FrameStats.uncappedFps`.
   *
   * `cpuMs` is smoothed here rather than at the source: the raw per-frame value
   * is what the panel shows and what makes a single expensive frame visible,
   * while a *rate* computed from it would swing by hundreds of fps frame to
   * frame and be unreadable. The GPU side arrives already smoothed with the same
   * 0.85/0.15 weighting, so the two halves of the comparison match.
   *
   * Without the timer extension `gpuMs` is 0 and this reports the CPU ceiling
   * alone — correct as far as it goes, and flagged as `cpu` so the panel can say
   * so rather than implying the GPU was checked and found faster.
   */
  private updateUncapped(): void {
    this.smoothedCpuMs = this.smoothedCpuMs === 0 ? this.frame.cpuMs : this.smoothedCpuMs * 0.85 + this.frame.cpuMs * 0.15

    const cpu = this.smoothedCpuMs
    const gpu = this.frame.gpuMs
    const slowest = Math.max(cpu, gpu)
    if (slowest <= 0) {
      this.frame.uncappedFps = 0
      this.frame.uncappedBy = 'none'
      return
    }
    this.frame.uncappedFps = Math.round(1000 / slowest)
    this.frame.uncappedBy = gpu > cpu ? 'gpu' : 'cpu'
  }

  /**
   * Records the wall-clock gap between presented frames — not the CPU time
   * spent inside our own loop. That difference is the point: a GC pause, a
   * compositor stall or a shader compile shows up here and nowhere else, and
   * those are precisely the spikes players notice.
   */
  private recordFrameDelta(now: number): void {
    if (this.lastFrameTime > 0) {
      const delta = now - this.lastFrameTime
      // Tracked before the tab-switch filter, so a real freeze is still visible
      // even though it is (correctly) excluded from the percentiles.
      if (delta > this.frame.longestStallMs) {
        this.frame.longestStallMs = Math.round(delta * 10) / 10
      }
      // Ignore tab-switch gaps; a 4-second delta is not a dropped frame, and
      // one of them would dominate the max for the next four seconds.
      if (delta < 1000) {
        this.frameDeltas[this.deltaCursor] = delta
        this.deltaCursor = (this.deltaCursor + 1) % PERCENTILE_WINDOW
        this.deltaFilled = Math.min(PERCENTILE_WINDOW, this.deltaFilled + 1)
      }
    }
    this.lastFrameTime = now

    if (--this.percentileCountdown > 0 || this.deltaFilled < 8) {
      return
    }
    this.percentileCountdown = PERCENTILE_INTERVAL

    const count = this.deltaFilled
    const scratch = this.sortScratch.subarray(0, count)
    scratch.set(this.frameDeltas.subarray(0, count))
    scratch.sort()

    const at = (fraction: number): number =>
      Math.round(scratch[Math.min(count - 1, Math.floor(fraction * count))]! * 100) / 100

    this.frame.frameMsP50 = at(0.5)
    this.frame.frameMsP95 = at(0.95)
    this.frame.frameMsP99 = at(0.99)
    this.frame.frameMsMax = Math.round(scratch[count - 1]! * 100) / 100

    let janky = 0
    for (let i = 0; i < count; i++) {
      if (scratch[i]! > FRAME_BUDGET_MS * 1.5) {
        janky++
      }
    }
    this.frame.jankFrames = janky
  }

  private collectTagStats(): void {
    for (const stats of this.tags.values()) {
      stats.drawCalls = 0
      stats.triangles = 0
      stats.instances = 0
      stats.cpuMs = this.cpuAccumulator.get(stats.tag) ?? 0
    }
    this.cpuAccumulator.clear()

    for (const root of this.roots) {
      const stats = this.tags.get(root.tag)!
      // `traverseVisible` skips invisible subtrees, which is exactly the
      // semantics wanted: a culled tier shouldn't be billed for anything.
      root.object.traverseVisible(object => {
        if (!(object instanceof Mesh)) {
          return
        }
        const geometry = object.geometry
        const index = geometry.index
        const positionAttribute = geometry.getAttribute('position')
        if (!positionAttribute) {
          return
        }
        const triangles = (index ? index.count : positionAttribute.count) / 3

        if (object instanceof InstancedMesh) {
          if (object.count === 0) {
            return
          }
          stats.drawCalls += 1
          stats.instances += object.count
          stats.triangles += triangles * object.count
        } else if ((geometry as InstancedBufferGeometry).isInstancedBufferGeometry) {
          // A plain `Mesh` carrying an `InstancedBufferGeometry` still draws
          // instanced — three decides that from the *geometry*, and only decides
          // `USE_INSTANCING` from `isInstancedMesh`. Grass takes exactly that
          // path (it wants its own 48-byte instance stream, not a 64-byte
          // matrix), and without this branch it billed six draws and 1.8k
          // triangles for six patches while `renderer.info` reported 39k — the
          // ablation table would have ranked the largest triangle source in the
          // scene as the cheapest thing in it.
          const count = (geometry as InstancedBufferGeometry).instanceCount
          if (!count) {
            return
          }
          stats.drawCalls += 1
          stats.instances += count
          stats.triangles += triangles * count
        } else {
          stats.drawCalls += 1
          stats.instances += 1
          stats.triangles += triangles
        }
      })
    }
  }

  // ── Ablation ─────────────────────────────────────────────────────────────

  get ablationRunning(): boolean {
    return this.phase !== 'idle'
  }

  /** 0–1 while an ablation run is in progress. */
  get ablationProgressRatio(): number {
    return this.ablationProgress
  }

  /**
   * Starts an ablation run over every registered tag. Takes
   * `(tags + 1) × 22` frames — under half a second at 60 fps.
   */
  /**
   * Forgets the frame-time window, keeping the freeze counter.
   *
   * For the end of a known one-off load: the window is 240 frames, so a burst of
   * slow frames stays in it for four seconds after the cause is gone. That is
   * correct for a *percentile* — it is a measure of recent history — but wrong
   * as evidence about the machine, and `AdaptiveQuality` reads p95. Draining the
   * placeable catalogue produced 33 slow frames and left the controller pinned
   * at `minimum` long after the world was running at 60 fps.
   *
   * `longestStallMs` deliberately survives. It exists to answer "did this
   * session ever freeze", and a reset that erased it would turn the one honest
   * freeze counter into another thing that forgets.
   */
  resetFrameWindow(): void {
    this.deltaFilled = 0
    this.deltaCursor = 0
    this.lastFrameTime = 0
    this.frame.jankFrames = 0
  }

  startAblation(): void {
    if (this.phase !== 'idle') {
      return
    }
    this.queue = [...this.tags.keys()]
    for (const stats of this.tags.values()) {
      stats.gpuMs = -1
    }
    this.phase = 'baseline'
    this.currentTag = ''
    this.stepFrame = 0
    this.samples.length = 0
    this.ablationProgress = 0
  }

  cancelAblation(): void {
    this.setTagVisible(this.currentTag, true)
    this.phase = 'idle'
    this.currentTag = ''
    this.samples.length = 0
    this.ablationProgress = 0
  }

  private setTagVisible(tag: string, visible: boolean): void {
    if (!tag) {
      return
    }
    for (const root of this.roots) {
      if (root.tag === tag) {
        root.object.visible = visible
      }
    }
  }

  private stepAblation(): void {
    if (this.phase === 'idle') {
      return
    }

    this.stepFrame++
    if (this.stepFrame <= ABLATION_WARMUP) {
      return
    }

    // Sample the *raw* timer, not the smoothed one — the smoothing window is
    // longer than a measurement step and would drag the previous step's value
    // into this one.
    this.samples.push(this.timer.supported ? this.timer.milliseconds : this.frame.cpuMs)

    if (this.samples.length < ABLATION_SAMPLES) {
      return
    }

    // Median, not mean: a single compositor hitch or GC pause during the window
    // would swamp a mean and turn a 0.4 ms result into a 9 ms one.
    const sorted = this.samples.slice().sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]!

    if (this.phase === 'baseline') {
      this.baselineMs = median
    } else {
      const stats = this.tags.get(this.currentTag)
      if (stats) {
        // Cost = what the frame gets back when this tag is gone. Clamped at 0:
        // measurement noise can make a cheap tag come out slightly negative,
        // and a negative "cost" in the HUD is worse than useless.
        stats.gpuMs = Math.max(0, this.baselineMs - median)
      }
      this.setTagVisible(this.currentTag, true)
    }

    const totalSteps = this.tags.size + 1
    this.ablationProgress = (totalSteps - this.queue.length) / totalSteps

    const next = this.queue.shift()
    if (next === undefined) {
      this.phase = 'idle'
      this.currentTag = ''
      this.ablationProgress = 1
      return
    }

    this.phase = 'tag'
    this.currentTag = next
    this.setTagVisible(next, false)
    this.stepFrame = 0
    this.samples.length = 0
  }

  /** Tags sorted by measured cost, worst first. For the HUD. */
  rankedTags(): TagStats[] {
    return [...this.tags.values()].sort((a, b) => {
      if (b.gpuMs !== a.gpuMs) {
        return b.gpuMs - a.gpuMs
      }
      return b.triangles - a.triangles
    })
  }

  dispose(): void {
    this.timer.dispose()
    this.roots.length = 0
    this.tags.clear()
  }
}
