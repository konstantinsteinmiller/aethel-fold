import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Playgama's gameplay events.
 *
 * `gameplay_started` / `gameplay_stopped` are portal messages their QA tool
 * looks for, in the same family as `game_ready` — which the plugin's own
 * comment calls "an explicit rejection reason" when missing. Both were
 * implemented and idempotent, and nothing in the game ever called them: the
 * kind of gap that is invisible in play and fatal in review. This pins the
 * wiring rather than the plugin.
 */

interface Harness {
  sync: (live: boolean) => void
  messages: string[]
}

const load = async (playgama: boolean): Promise<Harness> => {
  vi.resetModules()
  const messages: string[] = []

  vi.doMock('@/use/useUser', () => ({ isPlaygama: playgama }))
  // CrazyGames' half is covered by its own test; here it must simply not throw.
  vi.doMock('@/use/useCrazyGames', () => ({ syncGameplayLifecycle: () => {} }))
  vi.doMock('@/utils/playgamaPlugin', () => ({
    playgamaGameplayStart: () => messages.push('gameplay_started'),
    playgamaGameplayStop: () => messages.push('gameplay_stopped')
  }))

  const mod = await import('@/use/useGameplayLifecycle')
  return { sync: mod.syncGameplayLifecycle, messages }
}

/** The fan-out reaches the plugin through a dynamic import. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  vi.resetModules()
})

describe('Playgama gameplay events', () => {
  it('reports gameplay starting and stopping', async () => {
    const { sync, messages } = await load(true)

    sync(true)
    await settle()
    expect(messages).toEqual(['gameplay_started'])

    // A modal, the defeat screen, or an ad — all of them stop gameplay.
    sync(false)
    await settle()
    expect(messages).toEqual(['gameplay_started', 'gameplay_stopped'])
  })

  it('follows the whole run: play, pause, resume, die', async () => {
    const { sync, messages } = await load(true)

    sync(true); await settle()   // wave running
    sync(false); await settle()  // options modal
    sync(true); await settle()   // back to it
    sync(false); await settle()  // tower fell

    expect(messages).toEqual([
      'gameplay_started', 'gameplay_stopped', 'gameplay_started', 'gameplay_stopped'
    ])
  })

  it('sends nothing at all on a non-Playgama build', async () => {
    const { sync, messages } = await load(false)
    sync(true)
    sync(false)
    await settle()
    // Another platform's SDK must never be touched from this build — the
    // playbook's own trap, and a rejection reason in its own right.
    expect(messages).toEqual([])
  })
})
