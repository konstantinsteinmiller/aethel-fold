import type { Object3D, WebGLRenderer } from 'three'
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
}

interface Root {
  object: Object3D
  tag: string
}

/** Frames to let the pipeline settle after toggling visibility. */
const ABLATION_WARMUP = 8
/** Frames sampled per step. Median of these is the measurement. */
const ABLATION_SAMPLES = 14

type AblationPhase = 'idle' | 'baseline' | 'tag'

export class Profiler {
  readonly frame: FrameStats = {
    fps: 0,
    cpuMs: 0,
    gpuMs: 0,
    gpuSupported: false,
    drawCalls: 0,
    triangles: 0,
    programs: 0,
    geometries: 0,
    textures: 0
  }

  /** Tag stats, rebuilt each frame. Stable object identity per tag. */
  readonly tags = new Map<string, TagStats>()

  private readonly roots: Root[] = []
  private readonly timer: GpuTimer
  private readonly cpuMarks = new Map<string, number>()
  private readonly cpuAccumulator = new Map<string, number>()

  private frameStart = 0
  private frameTimes: number[] = []

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

    this.collectTagStats()
    this.stepAblation()
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
