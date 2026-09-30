import { beforeEach, describe, expect, it, vi } from 'vitest'

// Roadmap #13: boot_ms / first_input_ms are recorded once, in memory only.

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
})

describe('boot telemetry', () => {
  it('starts empty and records boot_ms, first_input_ms and the precompile once each', async () => {
    const b = await import('@/use/useBoot')
    expect(b.bootSnapshot().boot_ms).toBe(-1)
    expect(b.bootSnapshot().first_input_ms).toBe(-1)
    expect(b.bootSnapshot().precompile_ms).toBe(-1)

    b.markInteractive()
    const boot = b.bootSnapshot().boot_ms
    expect(boot).toBeGreaterThanOrEqual(0)
    b.markFirstInput()
    const first = b.bootSnapshot().first_input_ms
    expect(first).toBeGreaterThanOrEqual(boot)
    b.markPrecompiled(12.4, true)
    expect(b.bootSnapshot().precompile_ms).toBe(12)
    expect(b.bootSnapshot().precompile_parallel).toBe(true)

    // Later calls never overwrite the first.
    const spy = vi.spyOn(performance, 'now').mockReturnValue(999_999)
    b.markInteractive()
    b.markFirstInput()
    spy.mockRestore()
    expect(b.bootSnapshot().boot_ms).toBe(boot)
    expect(b.bootSnapshot().first_input_ms).toBe(first)
  })

  it('stamps each boot milestone the first time it is reached', async () => {
    const b = await import('@/use/useBoot')
    b.bootStage(b.BOOT.js)
    b.bootStage(b.BOOT.scene)
    const s = b.bootSnapshot().stages
    expect(s[b.BOOT.js]).toBeGreaterThanOrEqual(0)
    expect(s[b.BOOT.scene]).toBeGreaterThanOrEqual(s[b.BOOT.js]!)
    // The snapshot is a copy: the DEV handle can't write back.
    s[b.BOOT.js] = -5
    expect(b.bootSnapshot().stages[b.BOOT.js]).not.toBe(-5)
  })

  it('never touches storage (one save object: aethel_state)', async () => {
    const b = await import('@/use/useBoot')
    b.markInteractive()
    b.markFirstInput()
    expect(localStorage.length).toBe(0)
  })
})
