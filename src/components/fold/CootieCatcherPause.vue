<script setup lang="ts">
/**
 * Pause (GDD §9): "Tapping it folds the screen down into a pause menu (like an
 * origami cootie catcher)." Four triangular paper flaps fold in from the
 * corners and meet in the middle; the menu is printed on the folded paper.
 *
 * Faces: the menu (resume / restart page / settings / books / start over),
 * the settings (music, effects, vibration, screen shake, hold to fold, slow
 * mode, highlight, graphics, language),
 * the bookshelf (pick book 1 or, once it has been won, book 2, each with the
 * origami stars earned in it) and a confirm.
 *
 * Layout: the card is a flex column — the ribbon sits in its own row, pulled
 * half-way above the card's top edge, and only the body below it scrolls. (The
 * ribbon used to be absolutely positioned inside the scrolling card, which
 * clipped it at every viewport size.)
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import FButton from '@/components/atoms/FButton.vue'
import FSlider from '@/components/atoms/FSlider.vue'
import FSwitch from '@/components/atoms/FSwitch.vue'
import FSelect from '@/components/atoms/FSelect.vue'
import OrigamiIcon from '@/components/icons/OrigamiIcon.vue'
import PaperRibbon from '@/components/fold/PaperRibbon.vue'
import StarTally from '@/components/fold/StarTally.vue'
import { HIGHLIGHT_MODES, type BookId, type HighlightMode } from '@/fold/logic/types'
import useUser from '@/use/useUser'
import { foldSettings, secretCount, setFoldSetting, starsForBook, type Quality } from '@/use/useFoldProgress'
import { LANGUAGES, LANGUAGE_AUTONYMS } from '@/utils/enums'
import { setI18nLocale } from '@/i18n'
import useSounds from '@/use/useSound'

const props = defineProps<{
  open: boolean
  /** The book being played. */
  book: BookId
  /** Has book 2 been unlocked (book 1 won)? */
  unlocked: boolean
}>()
const emit = defineEmits<{
  (e: 'resume'): void
  (e: 'restartPage'): void
  (e: 'newGame'): void
  (e: 'pickBook', book: BookId): void
}>()

const { t } = useI18n()
const { userSoundVolume, userMusicVolume, userLanguage, setSettingValue } = useUser()
const { playSound } = useSounds()
const BOOK_IDS: readonly BookId[] = [1, 2]
const face = ref<'menu' | 'settings' | 'confirm' | 'books'>('menu')
const title = computed(() =>
  face.value === 'settings' ? t('fold.pause.settings') : face.value === 'books' ? t('fold.books.title') : t('fold.pause.title'))
const folded = ref(false)
/** Stars per book, for the shelf rows (reactive on the saved stars). */
const bookStars = computed(() => ({ 1: starsForBook(1), 2: starsForBook(2) }))
/** Page secrets found over every book (roadmap #15), under the books. */
const secrets = computed(() => secretCount())

watch(() => props.open, (o) => {
  if (o) {
    face.value = 'menu'
    folded.value = false
    requestAnimationFrame(() => requestAnimationFrame(() => (folded.value = true)))
  } else {
    folded.value = false
  }
})

const music = computed({
  get: () => Math.round(userMusicVolume.value * 100),
  set: (v: number) => setSettingValue('music', v / 100)
})
const sfx = computed({
  get: () => Math.round(userSoundVolume.value * 100),
  set: (v: number) => setSettingValue('sound', v / 100)
})
const haptics = computed({
  get: () => foldSettings.value.haptics,
  set: (v: boolean) => setFoldSetting('haptics', v)
})
const shake = computed({
  get: () => foldSettings.value.shake,
  set: (v: boolean) => setFoldSetting('shake', v)
})
const holdToFold = computed({
  get: () => foldSettings.value.holdToFold,
  set: (v: boolean) => setFoldSetting('holdToFold', v)
})
const slowMode = computed({
  get: () => foldSettings.value.slowMode,
  set: (v: boolean) => setFoldSetting('slowMode', v)
})
const highlightMode = computed({
  get: () => foldSettings.value.highlightMode,
  set: (v: HighlightMode) => setFoldSetting('highlightMode', v)
})
const highlightOptions = computed(() => HIGHLIGHT_MODES.map((m) => ({ value: m, label: t(`fold.settings.highlight_${m}`) })))
const quality = computed({
  get: () => foldSettings.value.quality,
  set: (v: Quality) => setFoldSetting('quality', v)
})
const qualityOptions = computed(() => [
  { value: 'auto', label: t('fold.settings.qualityAuto') },
  { value: 'high', label: t('fold.settings.qualityHigh') },
  { value: 'low', label: t('fold.settings.qualityLow') }
])
const languageOptions = computed(() => LANGUAGES.map((code) => ({ value: code, label: LANGUAGE_AUTONYMS[code] ?? code })))
const language = computed({
  get: () => userLanguage.value,
  set: (code: string) => {
    setSettingValue('language', code)
    const i18n = (window as unknown as { __i18n?: Parameters<typeof setI18nLocale>[0] }).__i18n
    if (i18n) void setI18nLocale(i18n, code)
  }
})

const click = (fn: () => void): void => {
  playSound('reward-continue', 0.02)
  fn()
}

const onKey = (e: KeyboardEvent): void => {
  if (!props.open) return
  if (e.key === 'Escape') {
    e.preventDefault()
    if (face.value !== 'menu') face.value = 'menu'
    else emit('resume')
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template lang="pug">
  Teleport(to="body")
    div.cootie(v-if="open" :class="{ 'cootie--folded': folded }" role="dialog" aria-modal="true" :aria-label="t('fold.pause.title')")
      div.cootie__veil(@click="emit('resume')")
      //- Four flaps fold in from the corners.
      div.cootie__flap.cootie__flap--tl
      div.cootie__flap.cootie__flap--tr
      div.cootie__flap.cootie__flap--bl
      div.cootie__flap.cootie__flap--br
      div.cootie__card(@click.stop)
        div.cootie__ribbon
          PaperRibbon {{ title }}
        div.cootie__scroll
          //- ── Menu ──
          div.cootie__body.cootie__menu.flex.flex-col.items-stretch(v-if="face === 'menu'")
            FButton.cootie__resume(type="success" size="lg" block @click="click(() => emit('resume'))")
              span.flex.items-center.justify-center.gap-2
                OrigamiIcon(name="play" tone="white")
                span {{ t('fold.pause.resume') }}
            FButton(type="secondary" size="md" block @click="click(() => emit('restartPage'))")
              span.flex.items-center.justify-center.gap-2
                OrigamiIcon(name="restart" tone="white")
                span {{ t('fold.pause.restartPage') }}
            FButton(type="primary" size="md" block @click="click(() => (face = 'settings'))")
              span.flex.items-center.justify-center.gap-2
                OrigamiIcon(name="gear" tone="yellow")
                span {{ t('fold.pause.settings') }}
            FButton(v-if="unlocked" type="secondary" size="md" block data-testid="pause-books" @click="click(() => (face = 'books'))")
              span.flex.items-center.justify-center.gap-2
                OrigamiIcon(name="book" tone="white")
                span {{ t('fold.books.title') }}
            FButton(type="danger" size="sm" block @click="click(() => (face = 'confirm'))")
              span.flex.items-center.justify-center.gap-2
                OrigamiIcon(name="book" tone="white")
                span {{ t('fold.pause.newGame') }}
          //- ── Confirm new book ──
          div.cootie__body.flex.flex-col.items-stretch(v-else-if="face === 'confirm'")
            p.cootie__text {{ t('fold.pause.confirmNew') }}
            FButton(type="danger" size="md" block @click="click(() => emit('newGame'))") {{ t('fold.pause.confirmYes') }}
            FButton(type="success" size="md" block @click="click(() => (face = 'menu'))") {{ t('fold.pause.confirmNo') }}
          //- ── Bookshelf ──
          div.cootie__body.flex.flex-col.items-stretch(v-else-if="face === 'books'")
            p.cootie__text {{ t('fold.books.hint') }}
            button.cootie__book(
              v-for="b in BOOK_IDS"
              :key="b"
              type="button"
              :class="{ 'cootie__book--current': b === book, 'cootie__book--locked': b === 2 && !unlocked }"
              :disabled="b === 2 && !unlocked"
              :data-testid="`book-${b}`"
              @click="click(() => emit('pickBook', b))"
            )
              OrigamiIcon.cootie__book-icon(name="book" :tone="b === 1 ? 'red' : 'blue'")
              span.cootie__book-text.flex.flex-col.min-w-0
                span.cootie__book-name {{ t(`fold.books.name${b}`) }}
                span.cootie__book-sub {{ b === 2 && !unlocked ? t('fold.books.locked') : t(`fold.books.blurb${b}`) }}
              StarTally.cootie__book-stars(v-if="b === 1 || unlocked" :stars="bookStars[b]" compact :data-testid="`book-${b}-stars`")
            p.cootie__secrets.flex.items-center.justify-center.gap-2(data-testid="pause-secrets")
              OrigamiIcon(name="star" tone="purple")
              span {{ t('fold.books.secrets', { n: secrets.found, total: secrets.total }) }}
            FButton(type="primary" size="md" block @click="click(() => (face = 'menu'))")
              span.flex.items-center.justify-center.gap-2
                OrigamiIcon(name="left" tone="white")
                span {{ t('fold.pause.back') }}
          //- ── Settings ──
          div.cootie__body.cootie__settings.flex.flex-col(v-else)
            label.cootie__row
              span.cootie__row-label.flex.items-center.gap-2
                OrigamiIcon(name="music" tone="blue")
                span {{ t('fold.settings.music') }}
              FSlider(v-model="music" :min="0" :max="100" :step="5")
            label.cootie__row
              span.cootie__row-label.flex.items-center.gap-2
                OrigamiIcon(name="speaker" tone="yellow")
                span {{ t('fold.settings.sfx') }}
              FSlider(v-model="sfx" :min="0" :max="100" :step="5")
            div.cootie__row.cootie__row--toggle
              span.cootie__row-label.flex.items-center.gap-2
                OrigamiIcon(name="vibrate" tone="green")
                span {{ t('fold.settings.haptics') }}
              FSwitch(v-model="haptics")
            div.cootie__row.cootie__row--toggle
              span.cootie__row-label.flex.items-center.gap-2
                OrigamiIcon(name="shake" tone="purple")
                span {{ t('fold.settings.shake') }}
              FSwitch(v-model="shake")
            //- Accessibility (roadmap #14).
            div.cootie__row.cootie__row--toggle
              span.cootie__row-label.flex.items-center.gap-2
                OrigamiIcon(name="hand" tone="yellow")
                span {{ t('fold.settings.holdToFold') }}
              FSwitch(v-model="holdToFold" data-testid="setting-hold")
            div.cootie__row.cootie__row--toggle
              span.cootie__row-label.flex.items-center.gap-2
                OrigamiIcon(name="clock" tone="blue")
                span {{ t('fold.settings.slowMode') }}
              FSwitch(v-model="slowMode" data-testid="setting-slow")
            div.cootie__row
              span.cootie__row-label.flex.items-center.gap-2
                OrigamiIcon(name="star" tone="yellow")
                span {{ t('fold.settings.highlight') }}
              FSelect(v-model="highlightMode" :options="highlightOptions" data-testid="setting-highlight")
            div.cootie__row
              span.cootie__row-label.flex.items-center.gap-2
                OrigamiIcon(name="quality" tone="blue")
                span {{ t('fold.settings.quality') }}
              FSelect(v-model="quality" :options="qualityOptions")
            div.cootie__row
              span.cootie__row-label.flex.items-center.gap-2
                OrigamiIcon(name="globe" tone="green")
                span {{ t('fold.settings.language') }}
              FSelect(v-model="language" :options="languageOptions")
            FButton(type="primary" size="md" block @click="click(() => (face = 'menu'))")
              span.flex.items-center.justify-center.gap-2
                OrigamiIcon(name="left" tone="white")
                span {{ t('fold.pause.back') }}
</template>

<style scoped lang="sass">
.cootie
  position: fixed
  inset: 0
  z-index: 60
  display: flex
  align-items: center
  justify-content: center
  padding: calc(clamp(0.5rem, 2vw, 1rem) + env(safe-area-inset-top, 0px)) calc(clamp(0.5rem, 2vw, 1rem) + env(safe-area-inset-right, 0px)) calc(clamp(0.5rem, 2vw, 1rem) + env(safe-area-inset-bottom, 0px)) calc(clamp(0.5rem, 2vw, 1rem) + env(safe-area-inset-left, 0px))
  perspective: 1400px

.cootie__veil
  position: absolute
  inset: 0
  background: radial-gradient(circle at 50% 45%, rgba(58, 36, 22, 0.35), rgba(28, 16, 10, 0.75))
  opacity: 0
  transition: opacity 0.3s
.cootie--folded .cootie__veil
  opacity: 1

// Each flap is a triangle of paper hinged on a screen edge; folded, the four
// meet at the centre like the points of a cootie catcher.
.cootie__flap
  position: absolute
  width: 100%
  height: 100%
  left: 0
  top: 0
  background: linear-gradient(135deg, #fff6e3 0 50%, #ecdcb6 50% 100%)
  filter: drop-shadow(0 0 0 #1c1724) drop-shadow(0 6px 10px rgba(28, 23, 36, 0.35))
  transition: transform 0.42s cubic-bezier(.6, .05, .3, 1.15), opacity 0.2s
  pointer-events: none
  opacity: 0.96
  &--tl
    clip-path: polygon(0 0, 100% 0, 50% 50%)
    transform-origin: 50% 0
    transform: rotateX(-110deg)
  &--tr
    clip-path: polygon(100% 0, 100% 100%, 50% 50%)
    transform-origin: 100% 50%
    transform: rotateY(-110deg)
    background: linear-gradient(225deg, #fff6e3 0 50%, #e7d3a8 50% 100%)
  &--bl
    clip-path: polygon(0 0, 50% 50%, 0 100%)
    transform-origin: 0 50%
    transform: rotateY(110deg)
    background: linear-gradient(45deg, #fff6e3 0 50%, #e7d3a8 50% 100%)
  &--br
    clip-path: polygon(0 100%, 50% 50%, 100% 100%)
    transform-origin: 50% 100%
    transform: rotateX(110deg)
    background: linear-gradient(315deg, #fff6e3 0 50%, #ecdcb6 50% 100%)
.cootie--folded .cootie__flap
  transform: none
  opacity: 0.22

.cootie__card
  position: relative
  display: flex
  flex-direction: column
  width: min(92vw, 26rem)
  max-height: 100%
  min-height: 0
  background: linear-gradient(160deg, #fff6e3 0 60%, #f3e3bf 60% 100%)
  border: 3px solid #1c1724
  border-radius: 0.9rem
  box-shadow: 0 8px 0 rgba(76, 64, 120, 0.5)
  transform: scale(0.2) rotate(-8deg)
  opacity: 0
  transition: transform 0.38s cubic-bezier(.34, 1.4, .64, 1) 0.22s, opacity 0.2s 0.22s
  // Room above the card for the half of the ribbon that sticks out.
  margin-top: clamp(1.1rem, 4.5vh, 1.9rem)
.cootie--folded .cootie__card
  transform: none
  opacity: 1

// Its own row, pulled up so the ribbon straddles the card's top edge; it is
// outside the scroller, so nothing ever clips it.
.cootie__ribbon
  flex: none
  display: flex
  justify-content: center
  min-width: 0
  max-width: 100%
  padding: 0 clamp(0.6rem, 3vw, 1.2rem)
  margin-top: calc(clamp(1.05rem, 4.2vw + 0.2vh, 1.55rem) * -0.95)
  position: relative
  z-index: 1

.cootie__scroll
  flex: 1 1 auto
  min-height: 0
  overflow-y: auto
  overscroll-behavior: contain
  padding: clamp(0.6rem, 2vh, 1rem) clamp(1rem, 4vw, 1.6rem) clamp(1rem, 3vh, 1.4rem)

.cootie__body
  gap: clamp(0.5rem, 1.8vh, 0.8rem)

.cootie__text
  color: #1c1724
  font-size: clamp(0.85rem, 3.6vw, 1.05rem)
  text-align: center
  margin-bottom: 0.3rem

.cootie__row
  display: grid
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr)
  align-items: center
  gap: 0.6rem
  color: #1c1724
  font-size: clamp(0.8rem, 3.4vw, 1rem)
  &--toggle
    grid-template-columns: minmax(0, 1fr) auto

.cootie__row-label
  font-size: clamp(0.8rem, 3.4vw, 1rem)
  :deep(.origami-icon)
    font-size: 1.35em

// The bookshelf: a book per row, its cover icon, name and one line.
.cootie__book
  display: flex
  align-items: center
  gap: clamp(0.5rem, 2vw, 0.8rem)
  min-height: 3rem
  padding: clamp(0.45rem, 1.4vh, 0.65rem) clamp(0.6rem, 2.5vw, 0.9rem)
  background: rgba(255, 255, 255, 0.6)
  border: 2px solid #1c1724
  border-radius: 0.6rem
  box-shadow: 0 4px 0 rgba(76, 64, 120, 0.4)
  text-align: left
  cursor: pointer
  transition: transform 0.12s
  &:hover:not(:disabled)
    transform: translateY(-2px)
  &:active:not(:disabled)
    transform: translateY(2px)
    box-shadow: 0 1px 0 rgba(76, 64, 120, 0.4)
  &--current
    background: linear-gradient(135deg, #fff2b8 0 55%, #ffe38a 55% 100%)
  &--locked
    cursor: not-allowed
    opacity: 0.6
    filter: grayscale(0.7)

.cootie__book-icon
  flex: none

// Secrets found: one quiet line under the books (no hint where they are).
.cootie__secrets
  color: #3a3142
  font-size: clamp(0.75rem, 3vw, 0.9rem)
  :deep(.origami-icon)
    font-size: 1.3em

// The book's stars, right-aligned; the text column takes what is left.
.cootie__book-stars
  flex: none
  margin-left: auto
  font-size: clamp(1.8rem, 7vw, 2.4rem)

.cootie__book-text
  flex: 1 1 auto

.cootie__book-name
  color: #1c1724
  font-size: clamp(0.9rem, 3.6vw, 1.1rem)

.cootie__book-sub
  color: #3a3142
  font-size: clamp(0.7rem, 2.8vw, 0.85rem)

@media (max-height: 520px)
  .cootie__card
    width: min(94vw, 40rem)
  // Short landscape screens: the menu as two columns so nothing needs scrolling.
  .cootie__menu
    display: grid !important
    grid-template-columns: 1fr 1fr
    :deep(.cootie__resume)
      grid-column: 1 / -1
  .cootie__settings
    display: grid !important
    grid-template-columns: 1fr 1fr
    column-gap: 1.2rem
</style>
