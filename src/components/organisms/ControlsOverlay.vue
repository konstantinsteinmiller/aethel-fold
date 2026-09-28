<template lang="pug">
  div(
    class="pointer-events-none absolute bottom-0 right-0 z-20 select-none p-3"
    :style="insetStyle"
  )
    //- One transition around both states, so collapsing and expanding are the
    //- same movement rather than one thing vanishing and another appearing
    //- somewhere else. `out-in` because the two boxes are different sizes and
    //- cross-fading them makes the corner flicker.
    transition(name="controls" mode="out-in")
      //- ── Expanded ────────────────────────────────────────────────────────
      div(
        v-if="visible && !minimised"
        key="panel"
        class="w-56 max-w-[calc(100vw_-_1.5rem)] rounded-xl bg-slate-950/70 px-3 py-2.5 backdrop-blur-sm ring-1 ring-white/10"
      )
        div(class="mb-2 flex items-center justify-between gap-2")
          span(class="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300/80") {{ t('controls.title') }}
          button(
            type="button"
            class="pointer-events-auto -mr-1 rounded p-1 text-slate-400 transition-colors hover:text-slate-100"
            :aria-label="t('controls.minimise')"
            :title="t('controls.minimise')"
            @click="setMinimised(true)"
          )
            svg(class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true")
              path(d="M3.5 6L8 10.5L12.5 6" stroke-linecap="round" stroke-linejoin="round")

        div(v-for="group in groups" :key="group.id" class="mt-2 first:mt-0")
          div(class="mb-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500") {{ group.title }}
          //- `items-start`, not `items-center`: the German guard label is long
          //- enough to wrap in a 224 px panel, and a centred cap beside a
          //- two-line label sits between the lines.
          div(v-for="row in group.rows" :key="row.id" class="flex items-start gap-2 py-[1.5px]")
            KeyCap(:code="row.code" wide)
            span(class="min-w-0 pt-[2px] text-[11px] leading-[1.3] text-slate-300") {{ row.label }}

      //- ── Minimised ───────────────────────────────────────────────────────
      button(
        v-else-if="visible"
        key="tab"
        type="button"
        class="pointer-events-auto flex items-center gap-2 rounded-full bg-slate-950/70 py-1.5 pl-3 pr-2 text-[11px] text-slate-300 backdrop-blur-sm ring-1 ring-white/10 transition-colors hover:text-slate-100"
        @click="setMinimised(false)"
      )
        svg(class="h-3 w-3 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true")
          path(d="M3.5 10L8 5.5L12.5 10" stroke-linecap="round" stroke-linejoin="round")
        span {{ t('controls.expand') }}
        KeyCap(:code="toggleCode")
</template>

<!--
  The on-screen controls, bottom-right.

  ── Contract ────────────────────────────────────────────────────────────────

    props   visible   render at all. Pass `false` once the player reaches
                      chapter 2 — this component does no chapter detection and
                      never will; it has no way to know what a chapter is.
            weapon    'melee' | 'bow' | 'none' — what is currently drawn.
    emits   none
    expose  toggle()  flips minimised, for a caller that would rather route the
                      key through its own input layer (see below).

  ── Why `weapon` is a prop and not a nicety ─────────────────────────────────

  Right-click *does a different thing* depending on what is in your hands: with
  a blade it raises a guard that parries on release, with a bow it enters an
  over-the-shoulder aim (`useKeybindings`, `guardOrAim`). A panel that says
  "Guard" while the player is holding a bow is worse than no panel — it is a
  confident wrong answer, and the player believes it. Bare-handed the row is
  removed rather than greyed, because there is nothing the button does.

  ── The minimised state is persisted, and the read can throw ────────────────

  In its own `localStorage` key, never the cloud save blob — a HUD preference
  that synced would follow a player across devices and ride along in a save
  export, which is the reasoning `world/editor/toggle.ts` already records. Every
  read and write is wrapped, because `localStorage` **throws outright** in a
  sandboxed iframe, which is how several of the portals this ships to serve
  games. A player there keeps the setting for the session and loses it on
  reload, which is strictly better than the panel throwing on first paint.

  ── It owns the `toggleControls` key ────────────────────────────────────────

  Nothing else in the project binds it, and the minimised tab *promises* that
  key works — a label naming a key nobody listens for is a bug the player
  reports as "the panel is broken". So the listener lives here, beside the state
  it flips. To drive this from the scene's input layer instead, call the exposed
  `toggle()` and do not bind `toggleControls` there as well, or one press
  toggles twice and looks like nothing happened.
-->

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import KeyCap from '@/components/atoms/KeyCap.vue'
import { ACTION_GROUPS, bindingFor } from '@/use/useKeybindings'

interface Props {
  visible: boolean
  weapon: 'melee' | 'bow' | 'none'
}

const props = defineProps<Props>()

const { t } = useI18n()

const PANEL_KEY = 'world.controlsPanel.v1'

interface CapRow {
  id: string
  code: string
  label: string
}

interface CapGroup {
  id: string
  title: string
  rows: CapRow[]
}

/**
 * The rows, built from `ACTION_GROUPS` rather than restated here.
 *
 * That is the whole reason `useKeybindings` owns the grouping: a panel with its
 * own list grows an action the rebind screen cannot reach, and a rebound key is
 * then correct in the game and wrong on screen — a class of bug nobody reports,
 * because it looks like the player misread the panel.
 */
const groups = computed<CapGroup[]>(() => {
  const out: CapGroup[] = []
  for (const group of ACTION_GROUPS) {
    const rows: CapRow[] = []
    for (const action of group.actions) {
      if (action === 'guardOrAim') {
        if (props.weapon === 'none') {
          continue
        }
        rows.push({
          id: action,
          code: bindingFor(action),
          label: t(props.weapon === 'bow' ? 'controls.action.guardBow' : 'controls.action.guardMelee')
        })
        continue
      }
      rows.push({ id: action, code: bindingFor(action), label: t(`controls.action.${action}`) })
    }
    // Looking is not a binding — it is the mouse itself, and it is the one
    // control a player who has never held a mouse-look camera has to be told
    // about. It sits with movement because that is what it is part of.
    if (group.id === 'move') {
      rows.push({ id: 'look', code: 'Mouse', label: t('controls.look') })
    }
    if (rows.length > 0) {
      out.push({ id: group.id, title: t(`controls.group.${group.id}`), rows })
    }
  }
  return out
})

const toggleCode = computed(() => bindingFor('toggleControls'))

const readMinimised = (): boolean => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(PANEL_KEY) === 'true'
  } catch {
    return false
  }
}

const minimised = ref(readMinimised())

const setMinimised = (next: boolean): void => {
  minimised.value = next
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PANEL_KEY, next ? 'true' : 'false')
    }
  } catch {
    // Sandboxed iframe / storage disabled. The toggle still works, it just
    // will not survive a reload.
  }
}

const toggle = (): void => {
  setMinimised(!minimised.value)
}

/**
 * True while something else on the page is plausibly reading keys — the
 * keybindings screen's "press a key" capture being the one that matters.
 *
 * Without this, rebinding an action to F1 would also collapse the panel, and
 * the player would watch the HUD move while trying to configure it.
 * `activeElement` is the cheapest signal available from outside that component:
 * a rebind row is a focused control, and this panel's own two buttons both
 * unmount the instant they are clicked, so neither can hold focus and swallow
 * the key afterwards.
 */
const isTypingElsewhere = (): boolean => {
  const el = document.activeElement
  if (!el || el === document.body) {
    return false
  }
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') {
    return true
  }
  return (el as HTMLElement).isContentEditable === true
}

const onKeyDown = (event: KeyboardEvent): void => {
  if (event.code !== toggleCode.value || event.defaultPrevented) {
    return
  }
  // Unconditionally, and ahead of the `visible` guard: the default binding is
  // F1, which is the browser's own help window. Letting that through once is
  // enough to lose the game behind a browser panel, and the player did not
  // press a browser key — they pressed a key this game told them about.
  event.preventDefault()
  if (event.repeat || !props.visible || isTypingElsewhere()) {
    return
  }
  toggle()
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
})

// The corner this sits in is the one a phone's home indicator eats in portrait
// and a notch eats in landscape. Padding rather than margin, so on a desktop —
// where both insets are 0 — the panel still reaches the same corner.
const insetStyle = {
  paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))',
  paddingRight: 'calc(0.75rem + env(safe-area-inset-right, 0px))'
}

defineExpose({ toggle })
</script>

<style scoped lang="sass">
.controls-enter-active,
.controls-leave-active
  transition: opacity 180ms ease, transform 180ms ease

.controls-enter-from,
.controls-leave-to
  opacity: 0
  transform: translateY(6px)

@media (prefers-reduced-motion: reduce)
  .controls-enter-active,
  .controls-leave-active
    transition: opacity 180ms ease

  .controls-enter-from,
  .controls-leave-to
    transform: none
</style>
