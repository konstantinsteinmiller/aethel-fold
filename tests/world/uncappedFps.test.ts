import { describe, expect, it } from 'vitest'
import type { WebGLRenderer } from 'three'
import { Profiler } from '@/world/perf/Profiler'

/**
 * ─── The purple number ──────────────────────────────────────────────────────
 *
 * `fps` is pinned to the display, so it is the same 60 for a 6 ms scene and a
 * 15 ms one. `uncappedFps` is the honest headroom reading, and its definition is
 * the kind of thing that gets "corrected" later by someone who reasons that CPU
 * and GPU work should add up. They don't — the CPU builds frame N+1 while the
 * GPU draws frame N, so the ceiling is the *slower* stage. Pinned here.
 *
 * Driven through a stub renderer: `Profiler` only ever touches `getContext()`
 * (for the timer extension, absent here, which is itself the interesting
 * no-GPU-timer case) and `info`.
 */
const stubRenderer = (): WebGLRenderer => {
  const info = {
    render: { calls: 0, triangles: 0 },
    programs: [] as unknown[],
    memory: { geometries: 0, textures: 0 },
    reset: () => {}
  }
  return {
    info,
    getContext: () => ({ getExtension: () => null })
  } as unknown as WebGLRenderer
}

/**
 * Runs `count` frames whose CPU cost is `cpuMs`, by moving the clock rather than
 * burning real time. `beginFrame` stamps `performance.now()`, so the CPU figure
 * is whatever elapses before `endFrame` — spending it for real would make this
 * suite take seconds to assert arithmetic.
 */
const runFrames = (profiler: Profiler, cpuMs: number, count: number): void => {
  const renderer = stubRenderer()
  const realNow = performance.now.bind(performance)
  let clock = realNow()
  try {
    performance.now = () => clock
    for (let i = 0; i < count; i++) {
      profiler.beginFrame(renderer)
      clock += cpuMs
      profiler.endFrame(renderer, clock)
      clock += 0.001
    }
  } finally {
    performance.now = realNow
  }
}

/**
 * Pins the GPU reading.
 *
 * It has to be done on the timer rather than on `frame.gpuMs`, because
 * `endFrame` reads the timer *into* that field on every frame — writing the
 * field from outside is overwritten before anything looks at it. Reaching for
 * the private is the point: this is the seam where a real GPU timer would sit.
 */
const pinGpuMs = (profiler: Profiler, ms: number): void => {
  const timer = (profiler as unknown as { timer: object }).timer
  Object.defineProperty(timer, 'smoothedMilliseconds', { get: () => ms, configurable: true })
}

describe('uncapped fps', () => {
  it('reports nothing before anything has been measured', () => {
    const profiler = new Profiler(stubRenderer())
    expect(profiler.frame.uncappedFps).toBe(0)
    expect(profiler.frame.uncappedBy).toBe('none')
  })

  it('derives the ceiling from CPU time when there is no GPU timer', () => {
    const profiler = new Profiler(stubRenderer())
    // Enough frames for the EMA to converge on 5 ms.
    runFrames(profiler, 5, 200)
    expect(profiler.frame.uncappedFps).toBe(200)
    expect(profiler.frame.uncappedBy).toBe('cpu')
  })

  it('takes the slower stage, not the sum', () => {
    const profiler = new Profiler(stubRenderer())
    pinGpuMs(profiler, 10)
    // 4 ms CPU alongside 10 ms GPU is a 100 fps ceiling, not 1000/14 = 71.
    runFrames(profiler, 4, 200)
    expect(profiler.frame.uncappedFps).toBe(100)
    expect(profiler.frame.uncappedBy).toBe('gpu')
  })

  it('names the CPU as the bound when it is the slower stage', () => {
    const profiler = new Profiler(stubRenderer())
    pinGpuMs(profiler, 5)
    runFrames(profiler, 20, 200)
    expect(profiler.frame.uncappedBy).toBe('cpu')
    expect(profiler.frame.uncappedFps).toBe(50)
  })

  /**
   * Smoothed, not filtered. A single terrible frame *should* move a headroom
   * readout — it is real — but a rate computed from the raw per-frame cost
   * swings by hundreds of fps and cannot be read at all. So: responds partially,
   * then recovers.
   */
  it('damps a single spike rather than snapping to it', () => {
    const profiler = new Profiler(stubRenderer())
    runFrames(profiler, 5, 200)
    const steady = profiler.frame.uncappedFps
    expect(steady).toBe(200)

    runFrames(profiler, 200, 1)
    const spiked = profiler.frame.uncappedFps
    // Neither ignored (it moved a long way off 200)…
    expect(spiked).toBeLessThan(steady / 2)
    // …nor snapped to the instantaneous 1000/200 = 5 fps that frame implies.
    expect(spiked).toBeGreaterThan(1000 / 200)

    runFrames(profiler, 5, 200)
    expect(profiler.frame.uncappedFps).toBe(steady)
  })

  it('survives a zero-cost frame without dividing by it', () => {
    const profiler = new Profiler(stubRenderer())
    runFrames(profiler, 0, 5)
    expect(Number.isFinite(profiler.frame.uncappedFps)).toBe(true)
    expect(profiler.frame.uncappedFps).toBe(0)
    expect(profiler.frame.uncappedBy).toBe('none')
  })
})
