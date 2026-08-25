/**
 * ─── Adaptive quality ───────────────────────────────────────────────────────
 *
 * Drives quality from **measured GPU time**, not from a static setting a player
 * has to find. The target is a mid-range Android at 0.75× render scale (GDD
 * header) while development happens on a desktop GPU with five times the
 * headroom — so a hand-tuned quality level is a level tuned for the wrong
 * machine by definition.
 *
 * ── The knob order is the whole design ──────────────────────────────────────
 *
 * The brief was "reduce machine strain without losing near-field asset quality",
 * so the knobs are spent in the order that costs the player least:
 *
 *   1. **Crossfade band width.** 21–29 % of instances are drawn by two tiers at
 *      once; narrowing the bands reclaims that directly. The transition gets
 *      more abrupt — the cheapest possible thing to give up.
 *   2. **Far LOD distances.** Applied non-uniformly (see `setLodQuality`): the
 *      horizon coarsens hard, LOD0 barely moves. The player loses detail they
 *      would need binoculars to notice.
 *   3. **Render scale.** Genuinely costs near-field sharpness, so it is the
 *      last resort and never goes below 0.7 — past that the outlines, which are
 *      1.6 *screen pixels*, start to break up.
 *
 * ── Why it drops fast and rises slowly ──────────────────────────────────────
 *
 * Asymmetric on purpose. Dropping late means the player has already felt the
 * stutter; rising eagerly means oscillating between two levels, which is far
 * more noticeable than simply sitting one level lower. So: drop after a short
 * sustained overage, raise only after a long sustained *surplus*, and refuse to
 * do anything at all during a cooldown after either.
 */

export interface QualityLevel {
  name: string
  /** Multiplier on the LOD crossfade band width. */
  bandScale: number
  /** Non-uniform LOD distance quality — 1 is full. */
  lodQuality: number
  renderScale: number
}

/**
 * Coarse on purpose: five levels a human can reason about, not a continuum that
 * makes every screenshot a different configuration.
 */
export const QUALITY_LEVELS: QualityLevel[] = [
  { name: 'ultra', bandScale: 1.0, lodQuality: 1.0, renderScale: 1.0 },
  { name: 'high', bandScale: 0.75, lodQuality: 0.92, renderScale: 1.0 },
  { name: 'medium', bandScale: 0.55, lodQuality: 0.8, renderScale: 1.0 },
  { name: 'low', bandScale: 0.4, lodQuality: 0.65, renderScale: 0.85 },
  { name: 'minimum', bandScale: 0.3, lodQuality: 0.5, renderScale: 0.7 }
]

export interface AdaptiveQualityOptions {
  /**
   * GPU budget in ms. Deliberately well under the 16.6 ms frame: the GPU is not
   * the only thing in a frame, and a target set at the wall leaves nothing for
   * the CPU, the compositor or a chunk upload landing on the same frame.
   */
  targetMs?: number
  /** Below this fraction of target, the frame has room to spare. */
  surplusFactor?: number
  /** Consecutive over-budget samples before dropping a level. */
  dropAfter?: number
  /** Consecutive surplus samples before raising one. Much larger — see notes. */
  raiseAfter?: number
  /** Samples to ignore entirely after any change. */
  cooldown?: number
  startLevel?: number
  /**
   * Frame-time ceiling used when GPU timing is unavailable, in ms. Above the
   * vsync interval on purpose — see `sample`.
   */
  frameTargetMs?: number
  /** Frame time at or under this counts as headroom in the fallback path. */
  frameSurplusMs?: number
  /**
   * Multiple of the budget at which the controller stops deliberating.
   *
   * Thresholds are counted in *samples*, and samples arrive one per frame — so
   * on a machine that is failing badly the evidence also arrives slowly. Measured
   * on a software rasteriser at 3 fps, `dropAfter: 20` meant seven seconds per
   * level and roughly 35 seconds to reach the bottom, which is most of a short
   * session spent unplayable while the controller collects data it already has.
   *
   * Nobody needs twenty samples to conclude that a 500 ms frame is bad.
   */
  panicFactor?: number
  /** Samples required to drop while in panic. */
  panicDropAfter?: number
}

export interface QualityApply {
  setBandScale(value: number): void
  setLodQuality(value: number): void
  setRenderScale(value: number): void
}

export class AdaptiveQuality {
  enabled = true

  readonly stats = {
    level: 0,
    levelName: 'ultra',
    gpuMs: 0,
    overCount: 0,
    underCount: 0,
    cooldown: 0,
    changes: 0
  }

  private readonly apply: QualityApply
  private readonly targetMs: number
  private readonly surplusFactor: number
  private readonly dropAfter: number
  private readonly raiseAfter: number
  private readonly cooldownSamples: number
  private readonly frameTargetMs: number
  private readonly frameSurplusMs: number
  private readonly panicFactor: number
  private readonly panicDropAfter: number

  private level: number
  private over = 0
  private under = 0
  private cooldown = 0
  private panicCooldown = false

  constructor(apply: QualityApply, options: AdaptiveQualityOptions = {}) {
    const {
      targetMs = 11,
      surplusFactor = 0.55,
      dropAfter = 20,
      raiseAfter = 180,
      cooldown = 60,
      startLevel = 0,
      frameTargetMs = 20,
      frameSurplusMs = 17.5,
      panicFactor = 2.5,
      panicDropAfter = 3
    } = options

    this.apply = apply
    this.targetMs = targetMs
    this.surplusFactor = surplusFactor
    this.dropAfter = dropAfter
    this.raiseAfter = raiseAfter
    this.cooldownSamples = cooldown
    this.frameTargetMs = frameTargetMs
    this.frameSurplusMs = frameSurplusMs
    this.panicFactor = panicFactor
    this.panicDropAfter = panicDropAfter
    this.level = startLevel
    this.applyLevel()
  }

  /**
   * One sample per frame.
   *
   * `gpuMs` is the *smoothed* GPU timer reading — a raw sample is far too noisy
   * to drive a state machine from. Pass 0 when the timer extension is missing,
   * and supply `frameMs` (p95 frame time) so the fallback below can work.
   *
   * ── Why there is a fallback at all ──────────────────────────────────────────
   *
   * This originally did nothing without a GPU timer, reasoning that frame time
   * is pinned to the vsync interval and therefore uninformative. That is true
   * only *while frames are being hit*. Measured on a software rasteriser with no
   * timer extension, the scene ran at **2 fps with a 517 ms p50** and the
   * controller sat at `ultra` and never moved — the exact machine that needed it
   * most was the one it ignored.
   *
   * So without a timer it falls back to frame time, asymmetrically: a frame time
   * well past vsync is unambiguous evidence of trouble and may drop quality,
   * while a frame time *at* vsync only proves we are not currently failing, so
   * it counts as headroom for the (much slower) raise path and nothing more.
   */
  sample(gpuMs: number, frameMs = 0): void {
    this.stats.gpuMs = gpuMs
    this.stats.level = this.level
    this.stats.levelName = QUALITY_LEVELS[this.level]!.name

    if (!this.enabled) {
      return
    }

    const useGpu = gpuMs > 0
    if (!useGpu && frameMs <= 0) {
      // Neither signal available — nothing honest to act on.
      return
    }

    if (this.cooldown > 0) {
      this.cooldown--
      this.stats.cooldown = this.cooldown
      return
    }

    const budget = useGpu ? this.targetMs : this.frameTargetMs
    const signal = useGpu ? gpuMs : frameMs
    const overBudget = signal > budget
    const hasHeadroom = useGpu ? gpuMs < this.targetMs * this.surplusFactor : frameMs <= this.frameSurplusMs
    // Far past the budget: act on a handful of samples instead of a full run.
    const panicking = signal > budget * this.panicFactor
    const dropThreshold = panicking ? this.panicDropAfter : this.dropAfter

    if (overBudget) {
      this.over++
      this.under = 0
    } else if (hasHeadroom) {
      this.under++
      this.over = 0
    } else {
      // In the dead band between "too slow" and "clearly has room". Decay both
      // counters rather than resetting: a frame that dips into the band should
      // not erase a long run of over-budget evidence.
      this.over = Math.max(0, this.over - 1)
      this.under = Math.max(0, this.under - 1)
    }

    this.stats.overCount = this.over
    this.stats.underCount = this.under

    if (this.over >= dropThreshold && this.level < QUALITY_LEVELS.length - 1) {
      this.level++
      this.panicCooldown = panicking
      this.commit()
    } else if (this.under >= this.raiseAfter && this.level > 0) {
      this.level--
      this.commit()
    }
  }

  /** Pins a level and stops adapting. For the perf panel and for benchmarks. */
  setLevel(level: number): void {
    this.level = Math.max(0, Math.min(QUALITY_LEVELS.length - 1, level))
    this.applyLevel()
    this.stats.level = this.level
    this.stats.levelName = QUALITY_LEVELS[this.level]!.name
  }

  get currentLevel(): number {
    return this.level
  }

  private commit(): void {
    this.over = 0
    this.under = 0
    // A panic drop shortens its own cooldown too, or the saving from reacting
    // fast is handed straight back to a 60-sample wait before the next level.
    this.cooldown = this.panicCooldown ? Math.min(this.cooldownSamples, this.panicDropAfter * 2) : this.cooldownSamples
    this.panicCooldown = false
    this.stats.changes++
    this.applyLevel()
  }

  private applyLevel(): void {
    const level = QUALITY_LEVELS[this.level]!
    this.apply.setBandScale(level.bandScale)
    this.apply.setLodQuality(level.lodQuality)
    this.apply.setRenderScale(level.renderScale)
  }
}
