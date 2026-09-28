import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ─── Rebinding, and what a conflict does ────────────────────────────────────
 *
 * The rebind screen (`KeybindingsMenu.vue`) is a thin shell over `bind()`, and
 * every decision that can go wrong for a player is in the function rather than
 * the component — so it is tested here, with no DOM.
 *
 * The one that matters is the conflict rule. Assigning a code that another
 * action already holds **unbinds the other one** rather than refusing. Both
 * alternatives are worse: refusing leaves the player hunting fifteen rows for
 * the one in their way, and allowing the duplicate leaves two actions firing on
 * one press. The displaced row goes visibly empty, which is fixable.
 *
 * `useKeybindings` is a module-level singleton that reads storage at import, so
 * a test that cares about loading seeds storage and re-imports through
 * `vi.resetModules()`. `tests/save/setup.ts` supplies a fresh in-memory
 * `localStorage` per test.
 */

const KEY = 'world.keybindings.v1'

const load = async () => {
  vi.resetModules()
  return await import('@/use/useKeybindings')
}

beforeEach(() => {
  vi.resetModules()
})

describe('conflicts', () => {
  it('unbinds whichever action already held the code', async () => {
    const keys = await load()
    // `KeyW` is forward by default. Putting it on "interact" has to take it off
    // forward, or one press would do both.
    expect(keys.bind('interact', 'KeyW')).toBe('ok')
    expect(keys.bindingFor('interact')).toBe('KeyW')
    expect(keys.keybindings.value.moveForward).toBe('')
  })

  it('leaves exactly one action holding a code', async () => {
    const keys = await load()
    keys.bind('interact', 'KeyW')
    const holders = keys.ACTION_IDS.filter(action => keys.keybindings.value[action] === 'KeyW')
    expect(holders).toEqual(['interact'])
  })

  it('does not unbind an action from itself', async () => {
    const keys = await load()
    // Re-confirming the key a row already has is the most common thing a player
    // does in a rebind screen: they arm a row and then change their mind.
    expect(keys.bind('sprint', 'ShiftLeft')).toBe('ok')
    expect(keys.bindingFor('sprint')).toBe('ShiftLeft')
  })

  it('lets a displaced action be given the code back', async () => {
    const keys = await load()
    keys.bind('interact', 'KeyW')
    keys.bind('moveForward', 'KeyW')
    expect(keys.bindingFor('moveForward')).toBe('KeyW')
    expect(keys.keybindings.value.interact).toBe('')
  })

  it('routes a code back to the action that now holds it', async () => {
    const keys = await load()
    keys.bind('interact', 'KeyW')
    expect(keys.actionForCode('KeyW')).toBe('interact')
  })

  /**
   * Characterisation, not approval.
   *
   * `actionForCode` compares codes with `===` and a displaced action is stored
   * as `''`, so an empty code used to find the displaced action. A
   * `KeyboardEvent` can carry `code: ''` — IME composition and some virtual
   * keyboards produce exactly that — and the input layer then fired whichever
   * control the player had most recently rebound away.
   */
  it('refuses an empty code rather than matching a displaced action', async () => {
    const keys = await load()
    keys.bind('interact', 'KeyW')
    expect(keys.bindingFor('moveForward')).toBe('')
    expect(keys.actionForCode('')).toBeNull()
  })
})

describe('keyboard-only actions', () => {
  it('refuses a mouse button for pause, and displaces nothing on the way', async () => {
    const keys = await load()
    expect(keys.bind('pause', 'Mouse0')).toBe('mouseNotAllowed')
    expect(keys.bindingFor('pause')).toBe('Escape')
    // The refusal happens before the displacement sweep. If it did not, the
    // player would lose their attack button to a rebind that was then rejected.
    expect(keys.bindingFor('attackLight')).toBe('Mouse0')
  })

  const KEYBOARD_ONLY = ['pause', 'quickSave', 'quickLoad', 'toggleControls'] as const

  it.each(KEYBOARD_ONLY)('refuses a mouse button for %s', async action => {
    const keys = await load()
    expect(keys.bind(action, 'Mouse2')).toBe('mouseNotAllowed')
  })

  it('still accepts a keyboard key for them', async () => {
    const keys = await load()
    expect(keys.bind('pause', 'Backquote')).toBe('ok')
    expect(keys.bindingFor('pause')).toBe('Backquote')
  })
})

describe('persistence', () => {
  it('survives a reload', async () => {
    const first = await load()
    first.bind('dodge', 'KeyC')
    const second = await load()
    expect(second.bindingFor('dodge')).toBe('KeyC')
    expect(second.bindingFor('moveForward')).toBe('KeyW')
  })

  it('resets to the defaults and persists that too', async () => {
    const first = await load()
    first.bind('dodge', 'KeyC')
    first.resetBindings()
    expect(first.bindingFor('dodge')).toBe('Space')

    const second = await load()
    expect(second.bindingFor('dodge')).toBe('Space')
  })

  it('falls back to the defaults for a blob it cannot read', async () => {
    localStorage.setItem(KEY, '{ not json')
    const keys = await load()
    expect(keys.keybindings.value).toEqual(keys.DEFAULT_BINDINGS)
  })

  it('repairs a stored table rather than trusting it', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        // A mouse button on a keyboard-only action: reachable by hand-editing,
        // and it would leave the player unable to open the menu that fixes it.
        pause: 'Mouse1',
        // Wrong type, empty, and an action this build does not have.
        dodge: 7,
        interact: '',
        somethingElse: 'KeyZ',
        // …and one that is simply fine.
        moveLeft: 'KeyQ'
      })
    )
    const keys = await load()
    expect(keys.bindingFor('pause')).toBe('Escape')
    expect(keys.bindingFor('dodge')).toBe('Space')
    expect(keys.bindingFor('interact')).toBe('KeyE')
    expect(keys.bindingFor('moveLeft')).toBe('KeyQ')
    expect(Object.keys(keys.keybindings.value).sort()).toEqual([...keys.ACTION_IDS].sort())
  })

  it('keeps working when storage throws', async () => {
    const keys = await load()
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('The operation is insecure.')
    })
    try {
      // A sandboxed iframe: the rebind has to apply for this session even though
      // it cannot be written down.
      expect(() => keys.bind('dodge', 'KeyC')).not.toThrow()
      expect(keys.bindingFor('dodge')).toBe('KeyC')
    } finally {
      setItem.mockRestore()
    }
  })
})

describe('what the rebind screen draws', () => {
  it('labels an unbound row with a key the caller can translate', async () => {
    const keys = await load()
    keys.bind('interact', 'KeyW')
    expect(keys.keyLabel(keys.keybindings.value.moveForward)).toEqual({ i18n: 'controls.unbound' })
  })

  it.each([
    ['Mouse0', { i18n: 'controls.mouseLeft' }],
    ['Mouse1', { i18n: 'controls.mouseMiddle' }],
    ['Mouse2', { i18n: 'controls.mouseRight' }],
    // Glyphs, not phrases: what is printed on the physical key is the same in
    // both languages this game ships in.
    ['KeyW', { text: 'W' }],
    ['Digit4', { text: '4' }],
    ['ArrowUp', { text: '↑' }],
    ['ShiftLeft', { text: 'Shift' }],
    ['Escape', { text: 'Esc' }],
    ['F5', { text: 'F5' }]
  ])('labels %s', async (code, expected) => {
    const keys = await load()
    expect(keys.keyLabel(code)).toEqual(expected)
  })

  it('turns a mouse button into the code the table stores', async () => {
    const keys = await load()
    expect(keys.mouseCode(0)).toBe('Mouse0')
    expect(keys.mouseCode(2)).toBe('Mouse2')
  })

  it('groups every action exactly once', async () => {
    const keys = await load()
    // The screen renders from `ACTION_GROUPS`; an action missing from it is an
    // action the player can never rebind, and one listed twice is a row that
    // fights itself.
    const grouped = keys.ACTION_GROUPS.flatMap(group => group.actions)
    expect([...grouped].sort()).toEqual([...keys.ACTION_IDS].sort())
  })
})
