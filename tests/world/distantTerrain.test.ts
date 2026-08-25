import { describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { DistantTerrain } from '@/world/terrain/DistantTerrain'
import type { ChunkWorkerPool } from '@/world/terrain/ChunkWorkerPool'
import type { TerrainMaterial } from '@/world/terrain/TerrainMaterial'

/**
 * ─── Rebuild scheduling ─────────────────────────────────────────────────────
 *
 * The ring costs ~17 ms of worker time to build, so *when* it rebuilds matters
 * more than how fast it builds. Two failure modes, both measured in a browser
 * before this suite existed:
 *
 *   1. Rebuilding every frame — the naive reading of "keep it centred".
 *   2. Rebuilding once per `invalidate()`. An editor drag calls that every few
 *      frames, and a one-in-flight guard does not stop it: each build finishes
 *      before the next call arrives. Twenty invalidations produced **sixteen**
 *      rebuilds, a quarter-second of worker time competing with the chunk
 *      rebuilds the same drag depends on.
 *
 * Both are scheduling bugs with no visual symptom — the ring looks correct
 * throughout — which is exactly why they belong in a test rather than in a
 * screenshot.
 */

const stubPool = () => {
  const calls: { centerX: number; centerZ: number }[] = []
  const pool = {
    buildRing: (request: { centerX: number; centerZ: number }) => {
      calls.push({ centerX: request.centerX, centerZ: request.centerZ })
      // Resolves on a microtask, as the real worker's promise does. The buffers
      // are the smallest thing `upload` will accept.
      return Promise.resolve({
        type: 'chunk' as const,
        id: calls.length,
        tiers: [
          {
            position: new Float32Array(9),
            normal: new Int16Array(9),
            color: new Uint16Array(9),
            index: new Uint16Array([0, 1, 2]),
            boundsY: [0, 0] as [number, number]
          }
        ],
        buildMs: 0
      })
    }
  }
  return { pool: pool as unknown as ChunkWorkerPool, calls }
}

const stubMaterial = () => ({}) as TerrainMaterial

/** Lets a test move the clock without waiting for it. */
const withClock = async (run: (advance: (ms: number) => void) => Promise<void>): Promise<void> => {
  const real = performance.now.bind(performance)
  let clock = real()
  const spy = vi.spyOn(performance, 'now').mockImplementation(() => clock)
  try {
    await run(ms => {
      clock += ms
    })
  } finally {
    spy.mockRestore()
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('DistantTerrain rebuild scheduling', () => {
  it('does not rebuild while the viewer stays inside a snap cell', async () => {
    const { pool, calls } = stubPool()
    const ring = new DistantTerrain(pool, stubMaterial(), { snapStep: 192 })

    ring.update(new Vector3(0, 0, 0))
    await settle()
    expect(calls).toHaveLength(1)

    // Well within the same 192 m cell, many frames.
    for (let i = 0; i < 30; i++) {
      ring.update(new Vector3(i * 2, 0, i * 2))
      await settle()
    }
    expect(calls).toHaveLength(1)
  })

  it('rebuilds when the viewer crosses into a new snap cell', async () => {
    const { pool, calls } = stubPool()
    const ring = new DistantTerrain(pool, stubMaterial(), { snapStep: 192 })
    ring.update(new Vector3(0, 0, 0))
    await settle()
    ring.update(new Vector3(400, 0, 0))
    await settle()
    expect(calls).toHaveLength(2)
    expect(calls[1]!.centerX).toBe(384)
  })

  it('costs one rebuild for a whole editor stroke, and it lands after it', async () => {
    await withClock(async advance => {
      const { pool, calls } = stubPool()
      const ring = new DistantTerrain(pool, stubMaterial(), { snapStep: 192 })
      const at = new Vector3(0, 0, 0)
      ring.update(at)
      await settle()
      const initial = calls.length

      // A drag: ~20 invalidations over a third of a second, shorter than the
      // cooldown. Nothing rebuilds *during* it — the ring is 170 m from whatever
      // is being edited, so it has nothing to show yet.
      for (let i = 0; i < 20; i++) {
        ring.invalidate()
        ring.update(at)
        await settle()
        advance(16)
      }
      expect(calls.length - initial).toBe(0)

      // Once the stroke settles, exactly one rebuild picks up its final state.
      // Losing this would leave the horizon showing terrain the player edited
      // away, which is the bug the cooldown must not introduce.
      advance(2000)
      ring.update(at)
      await settle()
      expect(calls.length - initial).toBe(1)

      // And nothing further: the dirty flag is consumed, not sticky.
      advance(2000)
      ring.update(at)
      await settle()
      expect(calls.length - initial).toBe(1)
    })
  })

  it('does not rate-limit a rebuild caused by actually moving', async () => {
    await withClock(async advance => {
      const { pool, calls } = stubPool()
      const ring = new DistantTerrain(pool, stubMaterial(), { snapStep: 192 })
      ring.update(new Vector3(0, 0, 0))
      await settle()

      // Straight after an invalidation, inside the cooldown — but the viewer has
      // crossed a boundary and the ring is on screen, so this one is prompt.
      ring.invalidate()
      ring.update(new Vector3(0, 0, 0))
      await settle()
      advance(10)
      ring.update(new Vector3(1000, 0, 0))
      await settle()
      expect(calls[calls.length - 1]!.centerX).toBe(960)
    })
  })
})
