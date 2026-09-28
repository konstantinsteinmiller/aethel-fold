<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { keyLabel } from '@/use/useKeybindings'

/**
 * ─── One key icon ───────────────────────────────────────────────────────────
 *
 * The single visual unit the controls panel is built out of: a `<kbd>` cap
 * carrying whatever `useKeybindings` currently has bound to an action.
 *
 * ── Contract ────────────────────────────────────────────────────────────────
 *
 *   props   code   a `KeyboardEvent.code` (`KeyW`, `ShiftLeft`, `F1`), one of
 *                  `Mouse0` / `Mouse1` / `Mouse2`, `'Mouse'` for "the mouse as
 *                  a whole" (the *look* row has no bindable code), or `''` for
 *                  an action a rebind displaced, which renders `controls.unbound`.
 *          wide    reserve the width of a word cap so a **column** of caps
 *                  lines up. Set it for every cap in a list; leave it off for a
 *                  cap sitting inline in a sentence.
 *   emits   none
 *
 * ── Why a mouse button is not a lettered cap ────────────────────────────────
 *
 * `keyLabel('Mouse2')` answers `controls.mouseRight` → "RMB" / "RMT", and three
 * capital letters in a key cap is exactly what "Esc", "Alt" and "Tab" look
 * like — so in a scanned column the mouse rows read as more keyboard keys. The
 * glyph is what makes the row parse in one glance: a picture of a mouse with
 * *that button shaded*, plus L / M / R.
 *
 * The letter is a glyph, not a string: L/M/R is the same letter in both
 * languages this game ships (Left/Links, Middle/Mitte, Right/Rechts), the same
 * way "W" is the same letter on QWERTY and QWERTZ. The translated phrase is
 * still what a screen reader gets, via `aria-label`.
 */

interface Props {
  code: string
  wide?: boolean
  /**
   * Which surface the cap is sitting on.
   *
   * `panel` is the controls overlay and the pause menu — a dark chrome panel,
   * where a `bg-white/12` cap is a lighter square on a darker ground and reads
   * correctly. `prompt` is the world-space interaction billboard, where the cap
   * sits on a *translucent* panel over the live scene: `white/12` there is
   * mostly whatever is behind it, so a white glyph on it disappears against a
   * sunlit meadow. That variant paints its own opaque ground and takes the
   * amber accent the pill used to spend on its whole background.
   */
  tone?: 'panel' | 'prompt'
}

const props = withDefaults(defineProps<Props>(), { wide: false, tone: 'panel' })

const toneClass = computed(() =>
  props.tone === 'prompt'
    ? 'border-black/60 bg-slate-900/85 text-amber-100 ring-amber-200/50'
    : 'border-black/50 bg-white/12 text-slate-100 ring-white/20'
)

const { t } = useI18n()

/** Which button to shade, or `'any'` for the whole device, or `null` for a key. */
const mouse = computed<'left' | 'middle' | 'right' | 'any' | null>(() => {
  switch (props.code) {
    case 'Mouse0':
      return 'left'
    // `Mouse1` is the *middle* button — `MouseEvent.button`'s numbering, which
    // is what `mouseCode()` stores. It is the heavy attack in the defaults.
    case 'Mouse1':
      return 'middle'
    case 'Mouse2':
      return 'right'
    case 'Mouse':
      return 'any'
    default:
      return null
  }
})

const mouseLetter = computed(() => {
  switch (mouse.value) {
    case 'left':
      return 'L'
    case 'middle':
      return 'M'
    case 'right':
      return 'R'
    default:
      return ''
  }
})

/**
 * The accessible name, and the visible text for anything that is not a mouse.
 *
 * `'Mouse'` is resolved here rather than in `keyLabel`, because it is not a
 * code the input layer can ever receive — it exists only so the *look* row can
 * use the same cap as every other row instead of restating its styling.
 */
const label = computed(() => {
  if (props.code === 'Mouse') {
    return t('controls.mouse')
  }
  const resolved = keyLabel(props.code)
  return resolved.i18n ? t(resolved.i18n) : (resolved.text ?? '')
})
</script>

<template lang="pug">
  kbd(
    class="inline-flex items-center justify-center gap-[3px] rounded border-b px-1.5 py-[3px] font-sans text-[11px] font-semibold leading-none tracking-wide ring-1"
    :class="[wide ? 'min-w-[2.6rem]' : 'min-w-[1.4rem]', toneClass]"
    :aria-label="label"
    :title="label"
  )
    template(v-if="mouse")
      svg(
        class="h-[13px] w-[10px] shrink-0"
        viewBox="0 0 12 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.1"
        aria-hidden="true"
      )
        rect(x="0.6" y="0.6" width="10.8" height="14.8" rx="5.4")
        path(d="M0.6 6H11.4" stroke-width="0.9" opacity="0.65")
        path(d="M6 0.6V6" stroke-width="0.9" opacity="0.65")
        //- The shaded button. The two arcs are the top-left and top-right
        //- quadrants of the body's own corner radius, so the fill lands exactly
        //- inside the outline instead of a rectangle poking through it.
        path(v-if="mouse === 'left'" d="M6 6H0.6A5.4 5.4 0 0 1 6 0.6Z" fill="currentColor" stroke="none")
        path(v-else-if="mouse === 'right'" d="M6 6H11.4A5.4 5.4 0 0 0 6 0.6Z" fill="currentColor" stroke="none")
        rect(
          v-else-if="mouse === 'middle'"
          x="5.1" y="1.9" width="1.8" height="3.4" rx="0.9"
          fill="currentColor" stroke="none"
        )
      span(v-if="mouseLetter") {{ mouseLetter }}
    template(v-else) {{ label }}
</template>
