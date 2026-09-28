<template lang="pug">
  transition(name="pause-fade")
    div(
      v-if="open"
      class="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm select-none"
    )
      div(
        class="flex max-h-[85vh] w-full max-w-md flex-col gap-4 rounded-2xl bg-slate-900/90 px-6 py-6 text-slate-200 ring-1 ring-white/10"
        :style="insetStyle"
      )
        //- ── Root ───────────────────────────────────────────────────────────
        template(v-if="screen === 'root'")
          h2(class="text-center text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-300/80") {{ t('menu.paused') }}
          div(class="flex flex-col gap-2")
            button(
              type="button"
              class="menu-item bg-amber-500 text-slate-950 hover:bg-amber-400"
              @click="onContinue"
            ) {{ t('menu.continue') }}
            button(type="button" class="menu-item menu-item--quiet" @click="screen = 'confirmNew'") {{ t('menu.newGame') }}
            button(type="button" class="menu-item menu-item--quiet" @click="screen = 'load'") {{ t('menu.loadGame') }}
            button(type="button" class="menu-item menu-item--quiet" @click="screen = 'save'") {{ t('menu.saveGame') }}
            button(type="button" class="menu-item menu-item--quiet" @click="screen = 'settings'") {{ t('menu.settings') }}

        //- ── New game confirmation ──────────────────────────────────────────
        //- A separate screen rather than a `confirm()`: the native dialog is not
        //- styled, not translated by us, and on a portal that serves the game in
        //- a sandboxed iframe it can be suppressed outright — which would turn
        //- "are you sure" into "yes".
        template(v-else-if="screen === 'confirmNew'")
          h2(class="text-center text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-300/80") {{ t('menu.newGame') }}
          p(class="px-1 text-sm leading-relaxed text-slate-300") {{ t('menu.newGameConfirm') }}
          div(class="flex flex-col gap-2")
            button(type="button" class="menu-item bg-rose-500 text-slate-950 hover:bg-rose-400" @click="onNewGame") {{ t('menu.confirm') }}
            button(type="button" class="menu-item menu-item--quiet" @click="screen = 'root'") {{ t('menu.cancel') }}

        //- ── Save / Load ────────────────────────────────────────────────────
        template(v-else-if="screen === 'save' || screen === 'load'")
          h2(class="text-center text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-300/80")
            | {{ screen === 'save' ? t('menu.saveGame') : t('menu.loadGame') }}

          div(class="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1")
            button(
              v-for="slot in slotIds"
              :key="slot"
              type="button"
              class="flex w-full items-center justify-between gap-4 rounded-xl bg-slate-800/70 px-4 py-3 text-left ring-1 ring-white/10 transition-colors"
              :class="slotDisabled(slot) ? 'cursor-not-allowed opacity-40' : 'hover:bg-slate-700/70'"
              :disabled="slotDisabled(slot)"
              @click="onSlot(slot)"
            )
              span(class="min-w-0")
                span(class="block text-sm font-semibold text-slate-100") {{ slotTitle(slot) }}
                span(class="mt-0.5 block truncate text-[11px] text-slate-400") {{ slotSubtitle(slot) }}
              span(class="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-amber-300/80") {{ slotAction(slot) }}

          p(v-if="screen === 'load' && !anySave" class="px-1 text-center text-xs text-slate-400") {{ t('menu.noSave') }}

          button(type="button" class="menu-item menu-item--quiet" @click="screen = 'root'") {{ t('menu.back') }}

        //- ── Settings ───────────────────────────────────────────────────────
        SettingsMenu(v-else @close="screen = 'root'" @armed="onArmed")
</template>

<!--
  The pause menu. Opens on the `pause` action (Escape by default).

  ── Props / emits ───────────────────────────────────────────────────────────
  Props:  `open: boolean` — the host owns it. This component never sets it.
  Emits:  `close`      — dismiss me. Fired on Escape, on Continue, and after
                         New game / Load, so a host only has to wire
                         `@close="paused = false"` for every exit to work.
          `continue`   — the player asked to resume. Always followed by `close`.
          `newGame`    — confirmed, not merely clicked.
          `save`       — `(slot: SaveSlotId)`. **The host performs the write**:
                         only it has the payload. Call
                         `useStorySave.writeSlot(slot, …)` and the row redraws
                         itself, because it is rendered from `saveSlots`.
          `load`       — `(slot: SaveSlotId)`. Followed by `close`. The record
                         is at `useStorySave.readSlot(slot)`.
          `blockInput` — `(blocked: boolean)`. True while the menu is up, false
                         when it goes away. The host uses it to stop feeding the
                         story player input; see below.

  ── Engine-free on purpose ─────────────────────────────────────────────────
  No `StoryDirector`, no `World`, no `three`. It knows about a pause gate, a
  settings singleton and a save table, and every one of those is a plain module.
  That is what lets the same component sit over the sandbox world, the chapter,
  and whatever comes after it — and it is why `save` emits a slot number instead
  of doing the save itself.

  ── Two halves of stopping the game ────────────────────────────────────────
  `acquireAppPause()` halts the simulation and the audio through the shared
  gate in `useGamePause`. It does **not** stop the story's input layer, which
  reads the keyboard directly — without the second half, a player walking into
  the menu with W held keeps walking behind it, and the click that picks
  "Continue" is also a light attack. Hence `blockInput`.

  Both are released on close *and* on unmount: a route change with the menu open
  would otherwise leave the game paused with nothing on screen to unpause it.

  ── Escape is swallowed while open ─────────────────────────────────────────
  A capture-phase listener on `window` takes Escape before anything else sees
  it, so the host's `pause` binding cannot fire on the same press and toggle the
  menu twice. Inside the menu it means "back one screen", and only closes from
  the root — which is the behaviour every player already has in their fingers.

  The one exception is while `KeybindingsMenu` is armed for a rebind: it is
  waiting for a key, Escape is how a player cancels that, and it must not close
  the whole menu instead. The `armed` emit travels up through `SettingsMenu` and
  this listener stands down — deliberately *without* calling `stopPropagation`,
  so the rebind screen's own capture listener still receives the key.

  Clicking the backdrop does nothing. A pause menu is not a tooltip: dismissing
  it resumes a fight, and a stray click outside the plate is not consent to that.
-->

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingsMenu from '@/components/organisms/SettingsMenu.vue'
import { acquireAppPause } from '@/use/useGamePause'
import { ALL_SLOTS, QUICK_SLOT, type SaveSlotId, saveSlots } from '@/use/useStorySave'

type Screen = 'root' | 'confirmNew' | 'save' | 'load' | 'settings'

const props = defineProps<{ open: boolean }>()

const emit = defineEmits<{
  close: []
  continue: []
  newGame: []
  save: [slot: SaveSlotId]
  load: [slot: SaveSlotId]
  blockInput: [blocked: boolean]
}>()

const { t, locale } = useI18n()

const screen = ref<Screen>('root')
/** True while the rebind screen is waiting for a key. See the header. */
const bindingArmed = ref(false)

const slotIds = ALL_SLOTS

const anySave = computed(() => ALL_SLOTS.some(slot => saveSlots.value[slot] !== null))

// Safe-area insets, so the plate clears a notch on a phone in landscape.
const insetStyle = {
  marginTop: 'env(safe-area-inset-top, 0px)',
  marginBottom: 'env(safe-area-inset-bottom, 0px)'
}

const slotTitle = (slot: SaveSlotId): string =>
  slot === QUICK_SLOT ? t('menu.quickSlot') : t('menu.slot', { n: slot })

/**
 * When the save was made, in the player's own locale.
 *
 * Guarded, because `savedAt` comes back out of storage as whatever was in
 * there: `new Date('')` is an Invalid Date and `toLocaleString` on it returns
 * the literal string "Invalid Date" in every language, which would sit in the
 * row looking like a broken translation.
 */
const savedAtText = (iso: string): string => {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleString(locale.value)
}

const slotSubtitle = (slot: SaveSlotId): string => {
  const record = saveSlots.value[slot]
  if (!record) {
    return t('menu.emptySlot')
  }
  const where = t('menu.savedChapter', { chapter: record.chapter, beat: record.label || record.beatId })
  const when = savedAtText(record.savedAt)
  return when ? `${where} · ${when}` : where
}

const slotAction = (slot: SaveSlotId): string => {
  if (screen.value === 'load') {
    return t('menu.load')
  }
  return saveSlots.value[slot] ? t('menu.overwrite') : t('menu.save')
}

/** Only on the load screen: there is nothing in an empty slot to load. */
const slotDisabled = (slot: SaveSlotId): boolean => screen.value === 'load' && saveSlots.value[slot] === null

const onSlot = (slot: SaveSlotId): void => {
  if (screen.value === 'load') {
    if (saveSlots.value[slot] === null) {
      return
    }
    emit('load', slot)
    emit('close')
    return
  }
  emit('save', slot)
  // Straight back to the root rather than closing: a player who saved usually
  // wants to keep playing, and the row they just wrote is visible on the way
  // past — which is the confirmation, without a toast that has to time out.
  screen.value = 'root'
}

const onContinue = (): void => {
  emit('continue')
  emit('close')
}

const onNewGame = (): void => {
  emit('newGame')
  emit('close')
}

const onArmed = (active: boolean): void => {
  bindingArmed.value = active
}

const onKeyDown = (event: KeyboardEvent): void => {
  if (event.code !== 'Escape' || bindingArmed.value) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  if (screen.value === 'root') {
    emit('close')
    return
  }
  screen.value = 'root'
}

let releasePause: (() => void) | null = null

const hold = (): void => {
  if (releasePause) {
    return
  }
  releasePause = acquireAppPause()
  emit('blockInput', true)
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown, true)
  }
}

const release = (): void => {
  if (!releasePause) {
    return
  }
  releasePause()
  releasePause = null
  bindingArmed.value = false
  emit('blockInput', false)
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', onKeyDown, true)
  }
}

watch(
  () => props.open,
  open => {
    if (open) {
      // Always back to the root. Reopening the menu into the rebind screen the
      // player left it on is a surprise, and the first thing they press there
      // is captured rather than acted on.
      screen.value = 'root'
      hold()
    } else {
      release()
    }
  },
  { immediate: true }
)

onBeforeUnmount(release)
</script>

<style scoped lang="sass">
.menu-item
  width: 100%
  border-radius: 9999px
  padding: 0.625rem 1.25rem
  font-size: 0.875rem
  font-weight: 600
  transition: background-color 140ms ease, color 140ms ease

  &--quiet
    background-color: rgba(30, 41, 59, 0.8)
    color: rgb(226, 232, 240)
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1)

    &:hover
      background-color: rgba(51, 65, 85, 0.85)

.pause-fade-enter-active,
.pause-fade-leave-active
  transition: opacity 160ms ease

.pause-fade-enter-from,
.pause-fade-leave-to
  opacity: 0
</style>
