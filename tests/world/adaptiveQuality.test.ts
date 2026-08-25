import { describe, expect, it } from 'vitest'
import { AdaptiveQuality, QUALITY_LEVELS, type QualityApply } from '@/world/perf/AdaptiveQuality'

/**
 * The controller is a state machine driven by a noisy signal, which makes it
 * exactly the wrong thing to verify by watching a browser: the world's own frame
 * loop samples it every frame, so any in-page probe is racing the real driver
 * and measures their interleaving rather than the logic. Driven directly here.
 */

const recorder = () => {
  const applied = { bandScale: 1, lodQuality: 1, renderScale: 1, calls: 0 }
  const apply: QualityApply = {
    setBandScale: v => {
      applied.bandScale = v
      applied.calls++
    },
    setLodQuality: v => {
      applied.lodQuality = v
    },
    setRenderScale: v => {
      applied.renderScale = v
    }
  }
  return { applied, apply }
}

const feed = (controller: AdaptiveQuality, ms: number, times: number): void => {
  for (let i = 0; i < times; i++) {
    controller.sample(ms)
  }
}

describe('AdaptiveQuality', () => {
  it('drops a level after sustained over-budget frames', () => {
    const { apply } = recorder()
    const q = new AdaptiveQuality(apply, { targetMs: 10, dropAfter: 5, cooldown: 0 })
    expect(q.currentLevel).toBe(0)
    feed(q, 20, 4)
    expect(q.currentLevel).toBe(0)
    feed(q, 20, 1)
    expect(q.currentLevel).toBe(1)
  })

  it('applies the level it moved to', () => {
    const { applied, apply } = recorder()
    const q = new AdaptiveQuality(apply, { targetMs: 10, dropAfter: 2, cooldown: 0 })
    feed(q, 20, 2)
    expect(applied.bandScale).toBe(QUALITY_LEVELS[1]!.bandScale)
    expect(applied.lodQuality).toBe(QUALITY_LEVELS[1]!.lodQuality)
    expect(applied.renderScale).toBe(QUALITY_LEVELS[1]!.renderScale)
  })

  it('never drops below the last level however long it is overloaded', () => {
    const { apply } = recorder()
    const q = new AdaptiveQuality(apply, { targetMs: 10, dropAfter: 1, cooldown: 0 })
    feed(q, 100, 500)
    expect(q.currentLevel).toBe(QUALITY_LEVELS.length - 1)
  })

  it('ignores everything during the cooldown after a change', () => {
    const { apply } = recorder()
    const q = new AdaptiveQuality(apply, { targetMs: 10, dropAfter: 2, cooldown: 50 })
    feed(q, 20, 2)
    expect(q.currentLevel).toBe(1)
    // Well past dropAfter again, but inside the cooldown.
    feed(q, 20, 40)
    expect(q.currentLevel).toBe(1)
  })

  it('raises far more reluctantly than it drops', () => {
    const { apply } = recorder()
    const q = new AdaptiveQuality(apply, {
      targetMs: 10,
      dropAfter: 5,
      raiseAfter: 100,
      cooldown: 0,
      startLevel: 2
    })
    // Plenty of headroom, but not yet enough of it.
    feed(q, 1, 99)
    expect(q.currentLevel).toBe(2)
    feed(q, 1, 1)
    expect(q.currentLevel).toBe(1)
  })

  it('never rises above ultra', () => {
    const { apply } = recorder()
    const q = new AdaptiveQuality(apply, { targetMs: 10, raiseAfter: 2, cooldown: 0 })
    feed(q, 1, 200)
    expect(q.currentLevel).toBe(0)
  })

  it('does not oscillate on a signal sitting in the dead band', () => {
    const { applied, apply } = recorder()
    const q = new AdaptiveQuality(apply, {
      targetMs: 10,
      surplusFactor: 0.5,
      dropAfter: 5,
      raiseAfter: 20,
      cooldown: 0,
      startLevel: 2
    })
    const callsBefore = applied.calls
    // 7 ms is under target but above the 5 ms surplus line — neither too slow
    // nor clearly fast. This is the case a naive threshold flip-flops on.
    feed(q, 7, 500)
    expect(q.currentLevel).toBe(2)
    expect(applied.calls).toBe(callsBefore)
  })

  it('alternating over/under samples do not accumulate into a change', () => {
    const { apply } = recorder()
    const q = new AdaptiveQuality(apply, { targetMs: 10, dropAfter: 5, raiseAfter: 20, cooldown: 0, startLevel: 2 })
    for (let i = 0; i < 200; i++) {
      q.sample(i % 2 === 0 ? 20 : 1)
    }
    // Each sample resets the opposite counter, so neither ever reaches its
    // threshold — the controller correctly refuses to act on a bimodal signal.
    expect(q.currentLevel).toBe(2)
  })

  it('does nothing while disabled', () => {
    const { apply } = recorder()
    const q = new AdaptiveQuality(apply, { targetMs: 10, dropAfter: 2, cooldown: 0 })
    q.enabled = false
    feed(q, 100, 100)
    expect(q.currentLevel).toBe(0)
  })

  it('does nothing when neither signal is available', () => {
    const { apply } = recorder()
    const q = new AdaptiveQuality(apply, { targetMs: 10, dropAfter: 2, cooldown: 0 })
    feed(q, 0, 100)
    expect(q.currentLevel).toBe(0)
  })

  describe('without a GPU timer', () => {
    // Measured on a software rasteriser: no timer extension, 2 fps, 517 ms p50 —
    // and the controller sat at ultra and never moved. The machine that needed
    // it most was the one it ignored.
    it('drops on frame time well past vsync', () => {
      const { apply } = recorder()
      const q = new AdaptiveQuality(apply, { dropAfter: 5, cooldown: 0, frameTargetMs: 20 })
      for (let i = 0; i < 5; i++) {
        q.sample(0, 517)
      }
      expect(q.currentLevel).toBe(1)
    })

    it('walks all the way down while frame time stays catastrophic', () => {
      const { apply } = recorder()
      const q = new AdaptiveQuality(apply, { dropAfter: 2, cooldown: 0, frameTargetMs: 20 })
      for (let i = 0; i < 200; i++) {
        q.sample(0, 517)
      }
      expect(q.currentLevel).toBe(QUALITY_LEVELS.length - 1)
    })

    it('treats a frame time pinned at vsync as headroom, not as trouble', () => {
      const { apply } = recorder()
      const q = new AdaptiveQuality(apply, {
        dropAfter: 5,
        raiseAfter: 50,
        cooldown: 0,
        startLevel: 3,
        frameTargetMs: 20,
        frameSurplusMs: 17.5
      })
      for (let i = 0; i < 50; i++) {
        q.sample(0, 16.7)
      }
      expect(q.currentLevel).toBe(2)
    })

    it('does not act on frame time sitting between vsync and the ceiling', () => {
      const { apply } = recorder()
      const q = new AdaptiveQuality(apply, {
        dropAfter: 5,
        raiseAfter: 20,
        cooldown: 0,
        startLevel: 2,
        frameTargetMs: 20,
        frameSurplusMs: 17.5
      })
      // 18.5 ms: past vsync but not clearly failing. Ambiguous, so neither.
      for (let i = 0; i < 300; i++) {
        q.sample(0, 18.5)
      }
      expect(q.currentLevel).toBe(2)
    })

    it('prefers the GPU timer when both are present', () => {
      const { apply } = recorder()
      const q = new AdaptiveQuality(apply, { targetMs: 10, dropAfter: 5, cooldown: 0, frameTargetMs: 20 })
      // GPU comfortable, frame time terrible — vsync-capped compositing or a
      // CPU-bound frame. The GPU signal is the one this controller's knobs move.
      for (let i = 0; i < 100; i++) {
        q.sample(2, 500)
      }
      expect(q.currentLevel).toBe(0)
    })
  })

  describe('panic path', () => {
    it('drops on a handful of samples when far past budget', () => {
      const { apply } = recorder()
      const q = new AdaptiveQuality(apply, {
        targetMs: 10,
        dropAfter: 20,
        panicFactor: 2.5,
        panicDropAfter: 3,
        cooldown: 0
      })
      // 40 ms against a 10 ms budget is 4× — no deliberation needed.
      feed(q, 40, 3)
      expect(q.currentLevel).toBe(1)
    })

    it('still deliberates when merely over budget', () => {
      const { apply } = recorder()
      const q = new AdaptiveQuality(apply, {
        targetMs: 10,
        dropAfter: 20,
        panicFactor: 2.5,
        panicDropAfter: 3,
        cooldown: 0
      })
      // 12 ms is over, but nowhere near panic — the full run is required.
      feed(q, 12, 5)
      expect(q.currentLevel).toBe(0)
      feed(q, 12, 15)
      expect(q.currentLevel).toBe(1)
    })

    it('reaches the bottom quickly on a catastrophic frame time', () => {
      const { apply } = recorder()
      const q = new AdaptiveQuality(apply, {
        dropAfter: 20,
        panicFactor: 2.5,
        panicDropAfter: 3,
        cooldown: 60,
        frameTargetMs: 20
      })
      // The software-rasteriser case: 517 ms frames, no GPU timer. Previously
      // this took ~35 s of real time to walk down; the cost of arriving late is
      // paid entirely by the player.
      let samples = 0
      while (q.currentLevel < QUALITY_LEVELS.length - 1 && samples < 100) {
        q.sample(0, 517)
        samples++
      }
      expect(q.currentLevel).toBe(QUALITY_LEVELS.length - 1)
      // Four levels at panicDropAfter + a shortened cooldown each.
      expect(samples).toBeLessThan(45)
    })
  })

  it('setLevel pins and applies immediately', () => {
    const { applied, apply } = recorder()
    const q = new AdaptiveQuality(apply, { targetMs: 10 })
    q.setLevel(4)
    expect(q.currentLevel).toBe(4)
    expect(applied.renderScale).toBe(QUALITY_LEVELS[4]!.renderScale)
    q.setLevel(99)
    expect(q.currentLevel).toBe(QUALITY_LEVELS.length - 1)
    q.setLevel(-5)
    expect(q.currentLevel).toBe(0)
  })

  it('degrades the horizon far harder than the near field', () => {
    // The point of the whole design: the worst level must still keep most of
    // LOD0's range while gutting the far tiers.
    const worst = QUALITY_LEVELS[QUALITY_LEVELS.length - 1]!
    const near = worst.lodQuality ** 0.25
    const far = worst.lodQuality ** 1.2
    expect(near).toBeGreaterThan(0.8)
    expect(far).toBeLessThan(0.5)
    expect(near / far).toBeGreaterThan(1.8)
  })
})
