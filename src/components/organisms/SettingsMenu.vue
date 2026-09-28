<template lang="pug">
  div(class="flex min-h-0 flex-col gap-4")
    h3(class="text-center text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-300/80") {{ t('settings.title') }}

    //- ── The three panels ───────────────────────────────────────────────────
    div(class="grid grid-cols-3 gap-1 rounded-full bg-slate-950/60 p-1 ring-1 ring-white/10")
      button(
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="rounded-full px-3 py-1.5 text-xs font-semibold transition-colors"
        :class="panel === tab.id ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:bg-white/5'"
        :aria-pressed="panel === tab.id"
        @click="select(tab.id)"
      ) {{ t(tab.label) }}

    //- The scroll lives here rather than on the page: the controls list is
    //- fifteen rows and would push the Back button off a phone in landscape,
    //- which is the one screen where a player most needs to get out again.
    div(class="min-h-0 flex-1 overflow-y-auto pr-1")
      AudioMenu(v-if="panel === 'audio'")
      GraphicsMenu(v-else-if="panel === 'graphics'")
      KeybindingsMenu(v-else @armed="onArmed")

    div(class="flex items-center justify-between gap-3 border-t border-white/10 pt-3")
      button(
        type="button"
        class="rounded-full bg-slate-800/80 px-5 py-2 text-sm font-semibold text-slate-100 ring-1 ring-white/10 transition-colors hover:bg-slate-700/80"
        @click="emit('close')"
      ) {{ t('menu.back') }}

      //- Hidden on the controls panel, where the honest reset is the one inside
      //- `KeybindingsMenu`. Two buttons a hand's width apart, one saying "Reset
      //- to defaults" and one saying "Reset controls", is a way to lose a key
      //- table by aiming badly.
      button(
        v-if="panel !== 'controls'"
        type="button"
        class="rounded-full px-4 py-2 text-xs text-slate-400 transition-colors hover:text-slate-200"
        @click="resetSettings"
      ) {{ t('settings.reset') }}
</template>

<!--
  The settings screen: audio, graphics, controls.

  ── Props / emits ───────────────────────────────────────────────────────────
  Props:  none.
  Emits:  `close` — Back was pressed.
          `armed` — `(active: boolean)`, forwarded straight from
          `KeybindingsMenu`. A host that steals Escape must stand down while it
          is true; see that component's header for why.

  ── It is a block, not an overlay ───────────────────────────────────────────
  No backdrop, no fixed position, no plate of its own. `PauseMenu` renders it
  inside the plate the pause buttons were just in, so the surface the player is
  looking at does not change under them — only its contents do. Mounted
  anywhere else, it is the container's job to give it a box; it will fill it and
  scroll its middle section.

  ── Why three panels and not one long page ──────────────────────────────────
  Audio is four controls, graphics is seven, controls is fifteen rows. Stacked,
  the thing a player came for is always below the fold, and on a phone in
  landscape the fold is about four rows down.
-->

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AudioMenu from '@/components/organisms/AudioMenu.vue'
import GraphicsMenu from '@/components/organisms/GraphicsMenu.vue'
import KeybindingsMenu from '@/components/organisms/KeybindingsMenu.vue'
import { resetSettings } from '@/use/useGameSettings'

type PanelId = 'audio' | 'graphics' | 'controls'

const emit = defineEmits<{ close: []; armed: [active: boolean] }>()

const { t } = useI18n()

const tabs: readonly { id: PanelId; label: string }[] = [
  { id: 'audio', label: 'settings.audio' },
  { id: 'graphics', label: 'settings.graphics' },
  { id: 'controls', label: 'settings.keybindings' }
]

const panel = ref<PanelId>('audio')

const select = (id: PanelId): void => {
  panel.value = id
}

const onArmed = (active: boolean): void => {
  emit('armed', active)
}
</script>
