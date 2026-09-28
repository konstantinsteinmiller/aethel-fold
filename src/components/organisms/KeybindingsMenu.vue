<template lang="pug">
  div(class="space-y-4")
    p(class="text-[11px] leading-snug text-slate-400") {{ hint }}

    div(v-for="group in groups" :key="group.id" class="space-y-1")
      h4(class="px-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300/70") {{ t(`controls.group.${group.id}`) }}

      button(
        v-for="action in group.actions"
        :key="action"
        type="button"
        class="flex w-full items-center justify-between gap-4 rounded-lg px-1 py-1.5 text-left transition-colors"
        :class="armed === action ? 'bg-amber-500/15' : 'hover:bg-white/5'"
        @click="arm(action)"
      )
        span(class="text-sm text-slate-200") {{ t(`controls.action.${action}`) }}
        kbd(
          class="min-w-12 rounded bg-white/10 px-2 py-0.5 text-center text-xs font-semibold ring-1 ring-white/10"
          :class="keyClass(action)"
        ) {{ armed === action ? t('settings.pressKey') : keyText(action) }}

    p(v-if="refused" class="px-1 text-[11px] text-rose-300") {{ t('settings.mouseNotAllowed') }}

    div(class="border-t border-white/10 pt-4")
      button(
        type="button"
        class="rounded-full bg-slate-800/80 px-4 py-1.5 text-xs text-slate-200 ring-1 ring-white/10 transition-colors hover:bg-slate-700/80"
        @click="onReset"
      ) {{ t('settings.resetBindings') }}
</template>

<!--
  The rebind screen. Every action, grouped, with what it is currently on.

  ── Props / emits ───────────────────────────────────────────────────────────
  Props:  none.
  Emits:  `armed` — `(active: boolean)`, fired when capture is armed and again
          when it is released.

  That emit exists for exactly one reason, and it is worth stating plainly: this
  component swallows **every** key while it is armed, Escape included. Any host
  that also listens for Escape — the pause menu does — has to stand down for
  that window, or the first thing a player presses to cancel a rebind closes the
  whole menu instead. `PauseMenu` forwards it through `SettingsMenu`; a host that
  ignores the emit still works, it just loses "Escape cancels".

  ── Capture is on `window`, in the capture phase ────────────────────────────
  Not on the row. A rebind screen has to be able to catch keys the page would
  otherwise act on first — F5 reloads, F1 opens browser help, Space scrolls —
  and the only place to intercept those is before they reach anyone else.
  `preventDefault` + `stopPropagation` on the way down does it; the listeners
  exist only while armed, so nothing is intercepted the rest of the time.

  ── Why the mouse is `mousedown` and not `click` ────────────────────────────
  Arming happens on `click`, which fires after `mouseup`, so the very press that
  armed the row cannot also be captured by it. Listening for `click` would need
  a flag to skip that first event; listening for `mousedown` needs nothing,
  because the arming press's `mousedown` is already in the past.

  A consequence worth knowing: while armed, a click anywhere — including on
  another row or on "Reset controls" — binds that mouse button rather than
  doing what the control says. That is what "the next button you press" means,
  and Escape is the way out.
-->

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ACTION_GROUPS,
  type ActionId,
  bind,
  keybindings,
  keyLabel,
  mouseCode,
  resetBindings
} from '@/use/useKeybindings'

const emit = defineEmits<{ armed: [active: boolean] }>()

const { t } = useI18n()

const groups = ACTION_GROUPS

/** The row waiting for a key, or null. */
const armed = ref<ActionId | null>(null)
/** True after a mouse button was offered for a keyboard-only action. */
const refused = ref(false)

const hint = computed(() => (armed.value ? t('settings.pressKey') : t('settings.rebind')))

/**
 * What a row shows.
 *
 * Read out of the `keybindings` computed rather than through `bindingFor`, so
 * the dependency is the whole table: `bind` displaces whatever else held the
 * code, and that *other* row has to redraw as unbound in the same tick. Reading
 * one entry through a helper would leave a key looking like it was in two
 * places at once until something else forced a render.
 */
const keyText = (action: ActionId): string => {
  const label = keyLabel(keybindings.value[action])
  return label.i18n ? t(label.i18n) : (label.text ?? '')
}

// An action left with nothing on it is a control the player cannot use, so it
// is coloured rather than left as a quiet em dash among fourteen normal rows.
const keyClass = (action: ActionId): string => {
  if (armed.value === action) {
    return 'text-amber-300'
  }
  return keybindings.value[action] ? 'text-slate-100' : 'text-rose-300'
}

const disarm = (): void => {
  armed.value = null
}

const arm = (action: ActionId): void => {
  refused.value = false
  armed.value = armed.value === action ? null : action
}

const onReset = (): void => {
  disarm()
  refused.value = false
  resetBindings()
}

const apply = (code: string): void => {
  const action = armed.value
  if (!action || code.length === 0) {
    return
  }
  if (bind(action, code) === 'mouseNotAllowed') {
    // Stay armed. The player's next press can be the keyboard key this action
    // needs, which is the whole content of the message they are being shown.
    refused.value = true
    return
  }
  refused.value = false
  disarm()
}

const onKeyDown = (event: KeyboardEvent): void => {
  event.preventDefault()
  event.stopPropagation()
  if (event.code === 'Escape') {
    // Cancels rather than binds. Escape is the pause key by default, and a
    // player who bound it away could not reopen the menu to bind it back.
    refused.value = false
    disarm()
    return
  }
  apply(event.code)
}

const onMouseDown = (event: MouseEvent): void => {
  event.preventDefault()
  event.stopPropagation()
  apply(mouseCode(event.button))
}

// The right button's press is captured above; without this its `contextmenu`
// still fires on release and drops a browser menu over the settings screen.
const onContextMenu = (event: Event): void => {
  event.preventDefault()
  event.stopPropagation()
}

const listen = (on: boolean): void => {
  if (typeof window === 'undefined') {
    return
  }
  if (on) {
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('contextmenu', onContextMenu, true)
  } else {
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('mousedown', onMouseDown, true)
    window.removeEventListener('contextmenu', onContextMenu, true)
  }
}

watch(armed, (action, previous) => {
  if ((action !== null) === (previous !== null)) {
    return
  }
  listen(action !== null)
  emit('armed', action !== null)
})

onBeforeUnmount(() => {
  // Unmounting while armed — closing the pause menu with the mouse, say — must
  // not leave three capture listeners swallowing the game's input forever.
  if (armed.value !== null) {
    listen(false)
    emit('armed', false)
  }
})
</script>
