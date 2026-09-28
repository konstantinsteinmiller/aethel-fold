import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import FpsMeter from '@/components/atoms/FpsMeter.vue'
import KeybindingsMenu from '@/components/organisms/KeybindingsMenu.vue'
import PauseMenu from '@/components/organisms/PauseMenu.vue'
import SettingsMenu from '@/components/organisms/SettingsMenu.vue'
import WorldSettingsPanel from '@/components/organisms/WorldSettingsPanel.vue'
import en from '@/i18n/locales/en'
import { isGamePaused } from '@/use/useGamePause'
import { DEFAULT_SETTINGS, setSetting, settings } from '@/use/useGameSettings'
import { bindingFor, resetBindings } from '@/use/useKeybindings'
import { clearAllSlots, writeSlot } from '@/use/useStorySave'

/**
 * ─── The menus, mounted ─────────────────────────────────────────────────────
 *
 * `vue-tsc` proves the templates type-check; it does not prove they *render* —
 * a pug indentation slip, a `v-else` chain that fell out of sequence or a
 * handler wired to a name that no longer exists all compile and then fail in
 * front of a player. These are the four behaviours that are not visible in a
 * screenshot either:
 *
 *   * the pause is actually held while the menu is up, and released on unmount
 *     (leaving it held is a game that never resumes);
 *   * Escape means "back" inside the menu and only closes from the root;
 *   * a rebind arms, captures the next key, and cancels on Escape;
 *   * the FPS readout obeys its setting rather than a code word.
 */

const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en } })

const mountWith = (component: unknown, props?: Record<string, unknown>) =>
  mount(component as never, { props, global: { plugins: [i18n] } })

const pressEscape = async (): Promise<void> => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }))
  await nextTick()
}

const textOf = (html: string): string => html.replace(/<[^>]+>/g, ' ')

beforeEach(() => {
  clearAllSlots()
  resetBindings()
  settings.value = { ...DEFAULT_SETTINGS }
})

describe('PauseMenu', () => {
  it('renders nothing and holds no pause while closed', () => {
    const wrapper = mountWith(PauseMenu, { open: false })
    expect(wrapper.find('button').exists()).toBe(false)
    expect(isGamePaused.value).toBe(false)
    wrapper.unmount()
  })

  it('holds the pause and asks the host to stop feeding input', async () => {
    const wrapper = mountWith(PauseMenu, { open: true })
    await nextTick()
    expect(isGamePaused.value).toBe(true)
    expect(wrapper.emitted('blockInput')?.[0]).toEqual([true])

    await wrapper.setProps({ open: false })
    expect(isGamePaused.value).toBe(false)
    expect(wrapper.emitted('blockInput')?.[1]).toEqual([false])
    wrapper.unmount()
  })

  it('releases the pause if it is unmounted while open', async () => {
    const wrapper = mountWith(PauseMenu, { open: true })
    await nextTick()
    expect(isGamePaused.value).toBe(true)
    // A route change with the menu up. Without the unmount guard the game stays
    // paused with nothing on screen able to unpause it.
    wrapper.unmount()
    expect(isGamePaused.value).toBe(false)
  })

  it('offers the five entries in order', () => {
    const wrapper = mountWith(PauseMenu, { open: true })
    const labels = wrapper.findAll('button').map(button => button.text())
    expect(labels).toEqual([
      en.menu.continue,
      en.menu.newGame,
      en.menu.loadGame,
      en.menu.saveGame,
      en.menu.settings
    ])
    wrapper.unmount()
  })

  it('emits continue and close together', async () => {
    const wrapper = mountWith(PauseMenu, { open: true })
    await wrapper.findAll('button')[0]!.trigger('click')
    expect(wrapper.emitted('continue')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('asks before starting a new game', async () => {
    const wrapper = mountWith(PauseMenu, { open: true })
    await wrapper.findAll('button')[1]!.trigger('click')
    expect(wrapper.emitted('newGame')).toBeUndefined()
    expect(textOf(wrapper.html())).toContain(en.menu.newGameConfirm)

    // Cancel is the second button on the confirmation screen.
    await wrapper.findAll('button')[1]!.trigger('click')
    expect(wrapper.emitted('newGame')).toBeUndefined()

    await wrapper.findAll('button')[1]!.trigger('click')
    await wrapper.findAll('button')[0]!.trigger('click')
    expect(wrapper.emitted('newGame')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('closes on Escape from the root and steps back from anywhere else', async () => {
    const wrapper = mountWith(PauseMenu, { open: true })
    await nextTick()

    await wrapper.findAll('button')[3]!.trigger('click')
    expect(textOf(wrapper.html())).toContain(en.menu.quickSlot)

    await pressEscape()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.findAll('button')[0]!.text()).toBe(en.menu.continue)

    await pressEscape()
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('emits a save with the slot the player picked, then returns to the root', async () => {
    const wrapper = mountWith(PauseMenu, { open: true })
    await wrapper.findAll('button')[3]!.trigger('click')

    // Quick slot first, then 1, 2, 3 — `ALL_SLOTS` order.
    const rows = wrapper.findAll('button')
    expect(rows[0]!.text()).toContain(en.menu.quickSlot)
    expect(rows[1]!.text()).toContain('Slot 1')
    await rows[2]!.trigger('click')

    expect(wrapper.emitted('save')?.[0]).toEqual([2])
    // The host owns the write, so the menu must not close on the player: they
    // are one click from carrying on.
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.findAll('button')[0]!.text()).toBe(en.menu.continue)
    wrapper.unmount()
  })

  it('draws a written slot and refuses to load an empty one', async () => {
    writeSlot(2, { chapter: 1, beatId: 'ambush', label: 'Drive off the bandits', payload: { hp: 1 } })
    const wrapper = mountWith(PauseMenu, { open: true })
    await wrapper.findAll('button')[2]!.trigger('click')

    const rows = wrapper.findAll('button')
    expect(rows[0]!.attributes('disabled')).toBeDefined()
    expect(rows[2]!.attributes('disabled')).toBeUndefined()
    expect(rows[2]!.text()).toContain('Drive off the bandits')

    await rows[2]!.trigger('click')
    expect(wrapper.emitted('load')?.[0]).toEqual([2])
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })
})

describe('SettingsMenu', () => {
  it('switches between the three panels', async () => {
    const wrapper = mountWith(SettingsMenu)
    // Audio first.
    expect(textOf(wrapper.html())).toContain(en.settings.master)

    await wrapper.findAll('button')[1]!.trigger('click')
    expect(textOf(wrapper.html())).toContain(en.settings.renderScale)
    expect(textOf(wrapper.html())).not.toContain(en.settings.master)

    await wrapper.findAll('button')[2]!.trigger('click')
    expect(textOf(wrapper.html())).toContain(en.controls.action.dodge)
    wrapper.unmount()
  })

  it('hides the settings reset on the controls panel', async () => {
    const wrapper = mountWith(SettingsMenu)
    expect(textOf(wrapper.html())).toContain(en.settings.reset)
    await wrapper.findAll('button')[2]!.trigger('click')
    // Two reset buttons a hand's width apart is how a key table gets lost.
    expect(textOf(wrapper.html())).not.toContain(en.settings.reset)
    expect(textOf(wrapper.html())).toContain(en.settings.resetBindings)
    wrapper.unmount()
  })
})

describe('KeybindingsMenu', () => {
  const rowFor = (wrapper: ReturnType<typeof mountWith>, label: string) =>
    wrapper.findAll('button').find(button => button.text().startsWith(label))!

  it('arms a row and binds the next key', async () => {
    const wrapper = mountWith(KeybindingsMenu)
    await rowFor(wrapper, en.controls.action.dodge).trigger('click')
    expect(wrapper.emitted('armed')?.[0]).toEqual([true])
    expect(rowFor(wrapper, en.controls.action.dodge).text()).toContain(en.settings.pressKey)

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', bubbles: true }))
    await nextTick()
    expect(bindingFor('dodge')).toBe('KeyC')
    expect(wrapper.emitted('armed')?.[1]).toEqual([false])
    wrapper.unmount()
  })

  it('cancels on Escape instead of binding it', async () => {
    const wrapper = mountWith(KeybindingsMenu)
    await rowFor(wrapper, en.controls.action.interact).trigger('click')
    await pressEscape()
    // Escape is the pause key. A player who bound it away could not reopen the
    // menu that would let them bind it back.
    expect(bindingFor('interact')).toBe('KeyE')
    expect(wrapper.emitted('armed')?.[1]).toEqual([false])
    wrapper.unmount()
  })

  it('refuses a mouse button for a keyboard-only action and says so', async () => {
    const wrapper = mountWith(KeybindingsMenu)
    await rowFor(wrapper, en.controls.action.pause).trigger('click')

    window.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))
    await nextTick()
    expect(bindingFor('pause')).toBe('Escape')
    expect(textOf(wrapper.html())).toContain(en.settings.mouseNotAllowed)
    // Still armed, so the next press can be the keyboard key it needs.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Backquote', bubbles: true }))
    await nextTick()
    expect(bindingFor('pause')).toBe('Backquote')
    wrapper.unmount()
  })

  it('stops listening when it is unmounted mid-capture', async () => {
    const wrapper = mountWith(KeybindingsMenu)
    await rowFor(wrapper, en.controls.action.dodge).trigger('click')
    wrapper.unmount()
    // Three capture listeners left on `window` would swallow the game's input
    // for the rest of the session.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', bubbles: true }))
    await nextTick()
    expect(bindingFor('dodge')).toBe('Space')
  })
})

describe('WorldSettingsPanel', () => {
  /**
   * A `World` stub, structural rather than real.
   *
   * The panel only ever asks a world for two things — `applySettings` and the
   * grass counters — which is the whole reason `useGameSettings` declares
   * `SettingsTarget` structurally instead of importing `World`. Building the
   * real thing here would need a WebGL context.
   */
  const fakeWorld = () => {
    const applied: Record<string, unknown>[] = []
    return {
      applied,
      world: {
        applySettings: (partial: Record<string, unknown>): void => {
          applied.push(partial)
        },
        grass: { stats: { drawnPatches: 12, triangles: 3400 } }
      }
    }
  }

  it('pushes the settings into a world that arrives after it mounts', async () => {
    const wrapper = mountWith(WorldSettingsPanel, { world: null })
    const fake = fakeWorld()

    // A child's `onMounted` runs before its parent's, and the parent is where
    // `new World(...)` happens — so on `/` the prop is null for the first tick.
    await wrapper.setProps({ world: fake.world })
    expect(fake.applied).toHaveLength(1)
    expect(fake.applied[0]).toMatchObject({ grassDetail: 'auto', shadows: true })

    setSetting('shadows', false)
    await nextTick()
    expect(fake.applied[1]).toMatchObject({ shadows: false })
    wrapper.unmount()
  })
})

/**
 * ─── The one-time grass migration ───────────────────────────────────────────
 *
 * It runs at **module load** rather than on a component's mount, so these
 * import the module fresh with `localStorage` already seeded. That placement is
 * the point of the tests: it used to run in `WorldSettingsPanel.onMounted`, and
 * that panel is no longer mounted on `/story` — a player who only ever opened
 * the chapter silently lost the grass level they had chosen.
 */
describe('legacy grass setting', () => {
  const loadSettings = async () => {
    vi.resetModules()
    return await import('@/use/useGameSettings')
  }

  it('adopts the level the old panel stored, once', async () => {
    localStorage.setItem('world.grassDetail', 'low')
    const mod = await loadSettings()
    // A player who had turned grass down must not find it back on `auto`.
    expect(mod.settings.value.grassDetail).toBe('low')
    // And the old key is gone, so a later reset to `auto` is not undone by it.
    expect(localStorage.getItem('world.grassDetail')).toBeNull()
  })

  it('ignores the old key once the new screen has been used', async () => {
    localStorage.setItem('world.grassDetail', 'low')
    localStorage.setItem('world.settings.v1', JSON.stringify({ ...DEFAULT_SETTINGS, grassDetail: 'ultra' }))
    const mod = await loadSettings()
    expect(mod.settings.value.grassDetail).toBe('ultra')
    expect(localStorage.getItem('world.grassDetail')).toBeNull()
  })

  it('survives a value the setting no longer accepts', async () => {
    localStorage.setItem('world.grassDetail', 'sixteen')
    const mod = await loadSettings()
    expect(mod.settings.value.grassDetail).toBe('auto')
  })
})

describe('FpsMeter', () => {
  it('follows its setting rather than a code word', async () => {
    const wrapper = mountWith(FpsMeter)
    expect(wrapper.html()).toBe('<!--v-if-->')

    setSetting('fpsMonitor', true)
    await nextTick()
    expect(wrapper.html()).not.toBe('<!--v-if-->')
    wrapper.unmount()
  })
})
