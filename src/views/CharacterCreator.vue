<template lang="pug">
  div(class="flex h-full w-full flex-col overflow-hidden bg-slate-900 select-none md:flex-row")
    //- The stage. `min-h-0` so this can actually shrink inside the flex column —
    //- without it the canvas keeps its intrinsic height and pushes the panel off
    //- a short screen.
    div(ref="host" class="relative min-h-0 flex-1")
      canvas(
        ref="canvas"
        class="block h-full w-full touch-none outline-none"
      )

      //- Both overlays sit in a dark pill rather than relying on a drop shadow.
      //- The backdrop is the sky dome, which is pale and gets paler toward the
      //- horizon — pale text on it was legible in the top corner and invisible
      //- across the plinth, which is exactly where the hint sits.
      //-
      //- Top-left carries the roster, so this container has to take pointer
      //- events; the title inside it gives them back up so a drag started on the
      //- heading still turns the figure.
      div(class="absolute top-0 left-0 z-10 flex max-w-[min(18rem,60%)] flex-col items-start gap-2 p-3" :style="topInset")
        h1(class="pointer-events-none rounded-full bg-slate-950/60 px-4 py-1.5 text-sm font-semibold text-slate-100 backdrop-blur-sm sm:text-base")
          | {{ t('characters.title') }}

        //- The roster. A search-and-pick combobox rather than a native `select`:
        //- sixty-four characters is a scroll, and the id — which is what quests
        //- and spawn tables name a character by — is not visible in a `select` at
        //- all. What the native control gave for free is re-supplied by hand
        //- below: full keyboard operation, a list that contains its own scroll,
        //- and a trigger that is never empty.
        div(ref="rosterRoot" class="relative w-full")
          button#roster-trigger(
            ref="rosterTrigger"
            type="button"
            class="flex w-full items-center gap-1.5 rounded-full border border-white/10 bg-slate-950/75 px-3 py-1.5 text-xs text-slate-100 backdrop-blur-sm hover:bg-slate-900/80"
            role="combobox"
            aria-haspopup="listbox"
            aria-controls="roster-listbox"
            :aria-expanded="rosterOpen"
            :aria-label="t('characters.roster')"
            @click="toggleRoster"
            @keydown="onTriggerKey"
          )
            span(class="min-w-0 flex-1 truncate text-left") {{ triggerLabel }}
            span(class="shrink-0 text-slate-400" aria-hidden="true") ▾

          //- `overscroll-contain` matters more here than it looks: this panel
          //- floats over the canvas, and a wheel that runs off the end of the
          //- list would otherwise chain to the page behind it.
          div(
            v-if="rosterOpen"
            class="absolute top-full left-0 z-20 mt-1 flex w-[min(17rem,80vw)] flex-col overflow-hidden rounded-xl border border-white/10 bg-slate-950/95 shadow-xl backdrop-blur-sm"
          )
            div(class="border-b border-white/10 p-1.5")
              input#roster-search(
                ref="rosterSearch"
                type="text"
                autocomplete="off"
                spellcheck="false"
                class="w-full rounded-lg bg-slate-900/80 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
                :placeholder="t('characters.search')"
                :aria-label="t('characters.search')"
                aria-controls="roster-listbox"
                :aria-activedescendant="activeOptionId"
                :value="query"
                @input="onQuery"
                @keydown="onSearchKey"
              )

            ul#roster-listbox(
              class="max-h-64 overflow-y-auto overscroll-contain py-1"
              role="listbox"
              :aria-label="t('characters.roster')"
            )
              li(
                v-for="(entry, index) in rosterOptions"
                :key="entry.id ?? DRAFT"
                :id="`roster-option-${index}`"
                :ref="el => setOptionRef(el, index)"
                role="option"
                :aria-selected="entry.id === activeId"
                :class="rosterRow(index, entry.id === activeId)"
                @click="pickOption(entry)"
                @mousemove="cursor = index"
              )
                span(class="min-w-0 flex-1 truncate") {{ entry.label }}
                code(
                  v-if="entry.id !== null"
                  class="shrink-0 truncate font-mono text-[10px] text-slate-500"
                ) {{ entry.id }}

              li(
                v-if="rosterOptions.length === 0"
                class="px-2.5 py-2 text-xs text-slate-500"
              ) {{ t('characters.noMatches') }}

      div(class="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-3")
        p(class="rounded-full bg-slate-950/60 px-4 py-1.5 text-center text-[11px] text-slate-300 backdrop-blur-sm")
          | {{ t('characters.hint') }}

    //- The panel. Bottom half on a phone, a column on the right on a desktop;
    //- scrollable in both, because six option groups do not fit a landscape
    //- phone and a control the player cannot reach is a control they do not have.
    aside(
      class="flex w-full max-h-[56%] shrink-0 flex-col gap-3 overflow-y-auto bg-slate-950/85 px-3 pt-3 text-slate-200 backdrop-blur-sm md:h-full md:max-h-none md:w-80"
      :style="panelInset"
    )
      //- Identity. First, because the name is what the dropdown above will show
      //- and the id is what everything else in the game will refer to.
      section(class="flex flex-col gap-1.5")
        label(class="text-xs font-semibold tracking-wide text-slate-400" for="character-name")
          | {{ t('characters.name') }}
        input#character-name(
          type="text"
          autocomplete="off"
          class="w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
          :maxlength="MAX_NAME_LENGTH"
          :placeholder="t('characters.namePlaceholder')"
          :value="name"
          @input="onName"
        )
        //- The id is shown and never editable — see the header, and the argument
        //- in `roster.ts`. On a draft it previews the id the name would produce,
        //- suffix and all, so a player who cares can see the collision before
        //- they commit to it.
        div(class="flex items-baseline gap-1.5 text-[11px] text-slate-500")
          span {{ t('characters.id') }}
          code(class="min-w-0 truncate rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-slate-300") {{ shownId }}
        p(class="text-[11px] leading-snug text-slate-500")
          | {{ activeId === null ? t('characters.idPending') : t('characters.idFixed') }}
        p(v-if="profiles.length === 0" class="text-[11px] leading-snug text-slate-500")
          | {{ t('characters.empty') }}

      section(class="flex flex-col gap-1.5 border-t border-white/10 pt-3")
        span(class="text-xs font-semibold tracking-wide text-slate-400") {{ t('characters.body') }}
        div(class="flex flex-wrap gap-1.5" role="radiogroup" :aria-label="t('characters.body')")
          button(
            v-for="option in SEXES"
            :key="option"
            type="button"
            role="radio"
            :aria-checked="appearance.sex === option"
            :class="pill(appearance.sex === option)"
            @click="patch({ sex: option })"
          ) {{ t(`characters.bodies.${option}`) }}

      section(class="flex flex-col gap-1.5")
        span(class="text-xs font-semibold tracking-wide text-slate-400") {{ t('characters.head') }}
        div(class="flex flex-wrap gap-1.5" role="radiogroup" :aria-label="t('characters.head')")
          button(
            v-for="option in HEAD_SHAPES"
            :key="option"
            type="button"
            role="radio"
            :aria-checked="appearance.head === option"
            :class="pill(appearance.head === option)"
            @click="patch({ head: option })"
          ) {{ t(`characters.heads.${option}`) }}

      section(class="flex flex-col gap-1.5")
        span(class="text-xs font-semibold tracking-wide text-slate-400") {{ t('characters.hair') }}
        div(class="flex flex-wrap gap-1.5" role="radiogroup" :aria-label="t('characters.hair')")
          button(
            v-for="option in HAIR_STYLES"
            :key="option"
            type="button"
            role="radio"
            :aria-checked="appearance.hair === option"
            :class="pill(appearance.hair === option)"
            @click="patch({ hair: option })"
          ) {{ t(`characters.hairStyles.${option}`) }}

      section(class="flex flex-col gap-1.5")
        span(class="text-xs font-semibold tracking-wide text-slate-400") {{ t('characters.eyes') }}
        div(class="flex flex-wrap gap-1.5" role="radiogroup" :aria-label="t('characters.eyes')")
          button(
            v-for="option in EYE_STYLE_OPTIONS"
            :key="option"
            type="button"
            role="radio"
            :aria-checked="appearance.eyes === option"
            :class="pill(appearance.eyes === option)"
            @click="patch({ eyes: option })"
          ) {{ t(`characters.eyeStyles.${option}`) }}

      section(class="flex flex-col gap-1.5")
        span(class="text-xs font-semibold tracking-wide text-slate-400") {{ t('characters.mouth') }}
        div(class="flex flex-wrap gap-1.5" role="radiogroup" :aria-label="t('characters.mouth')")
          button(
            v-for="option in MOUTH_STYLE_OPTIONS"
            :key="option"
            type="button"
            role="radio"
            :aria-checked="appearance.mouth === option"
            :class="pill(appearance.mouth === option)"
            @click="patch({ mouth: option })"
          ) {{ t(`characters.mouthStyles.${option}`) }}

      section(class="flex flex-col gap-1.5")
        span(class="text-xs font-semibold tracking-wide text-slate-400") {{ t('characters.skinTone') }}
        div(class="flex flex-wrap gap-2" role="radiogroup" :aria-label="t('characters.skinTone')")
          button(
            v-for="(swatch, index) in SKIN_TONE_SWATCHES"
            :key="swatch"
            type="button"
            role="radio"
            :aria-checked="appearance.skinTone === index"
            :aria-label="t('characters.skinToneOption', { n: index + 1 })"
            :title="t('characters.skinToneOption', { n: index + 1 })"
            :class="dot(appearance.skinTone === index)"
            :style="{ backgroundColor: swatch }"
            @click="patch({ skinTone: asSkinTone(index) })"
          )

      section(class="flex flex-col gap-1.5")
        span(class="text-xs font-semibold tracking-wide text-slate-400") {{ t('characters.hairColour') }}
        div(class="flex flex-wrap gap-2" role="radiogroup" :aria-label="t('characters.hairColour')")
          button(
            v-for="(swatch, index) in HAIR_COLOUR_SWATCHES"
            :key="swatch"
            type="button"
            role="radio"
            :aria-checked="appearance.hairColour === index"
            :aria-label="t('characters.hairColourOption', { n: index + 1 })"
            :title="t('characters.hairColourOption', { n: index + 1 })"
            :class="dot(appearance.hairColour === index)"
            :style="{ backgroundColor: swatch }"
            @click="patch({ hairColour: index })"
          )

      section(class="flex flex-col gap-1.5")
        span(class="text-xs font-semibold tracking-wide text-slate-400") {{ t('characters.tunicColour') }}
        div(class="flex flex-wrap gap-2" role="radiogroup" :aria-label="t('characters.tunicColour')")
          button(
            v-for="(swatch, index) in TUNIC_COLOUR_SWATCHES"
            :key="swatch"
            type="button"
            role="radio"
            :aria-checked="appearance.tunicColour === index"
            :aria-label="t('characters.tunicColourOption', { n: index + 1 })"
            :title="t('characters.tunicColourOption', { n: index + 1 })"
            :class="dot(appearance.tunicColour === index)"
            :style="{ backgroundColor: swatch }"
            @click="patch({ tunicColour: index })"
          )

      //- The garment colourway. Numbered rather than swatched, because one seed
      //- means a different pair of colours in every garment — a robe's "2" is a
      //- mage's woad and a jerkin's "2" is something else entirely, so a single
      //- dot could only ever show one of them and would be wrong for the rest.
      //- The figure beside it is the preview.
      section(class="flex flex-col gap-1.5")
        span(class="text-xs font-semibold tracking-wide text-slate-400") {{ t('characters.outfit') }}
        div(class="flex flex-wrap gap-1.5" role="radiogroup" :aria-label="t('characters.outfit')")
          button(
            v-for="index in GEAR_SEED_SPACE"
            :key="index"
            type="button"
            role="radio"
            :aria-checked="appearance.gearSeed === index - 1"
            :class="pill(appearance.gearSeed === index - 1)"
            @click="patch({ gearSeed: index - 1 })"
          ) {{ index }}
        p(class="text-[11px] leading-snug text-slate-500") {{ t('characters.outfitHint') }}

      //- Equipment. Toggles rather than a radio group: the four items live in
      //- four different slots, so any combination of them is legal and a
      //- radiogroup would say otherwise.
      section(class="flex flex-col gap-1.5 border-t border-white/10 pt-3")
        span(class="text-xs font-semibold tracking-wide text-slate-400") {{ t('characters.equipment') }}
        div(class="flex flex-wrap gap-1.5")
          button(
            v-for="kind in PREVIEW_ITEMS"
            :key="kind"
            type="button"
            :aria-pressed="isEquipped(kind)"
            :class="pill(isEquipped(kind))"
            @click="toggleItem(kind)"
          ) {{ t(`characters.items.${kind}`) }}
          //- Dead rather than hidden when there is nothing to draw: a button
          //- that appears and disappears as you equip a sword moves everything
          //- next to it, and the player loses the thing they were aiming at.
          button(
            type="button"
            :aria-pressed="weaponDrawn"
            :disabled="!canDrawWeapon"
            :class="[pill(weaponDrawn), canDrawWeapon ? '' : 'cursor-not-allowed opacity-40']"
            @click="toggleDrawn"
          ) {{ t('characters.drawWeapon') }}

      div(class="flex flex-wrap gap-1.5 border-t border-white/10 pt-3")
        button(
          type="button"
          :aria-pressed="spinning"
          :class="pill(spinning)"
          @click="toggleSpin"
        ) {{ t('characters.spin') }}
        button(type="button" :class="pill(false)" @click="surprise") {{ t('characters.randomise') }}
        button(type="button" :class="pill(false)" @click="startOver") {{ t('characters.reset') }}

      //- Roster actions. Both act on a *saved* character, so both are dead on an
      //- unsaved draft: there is nothing to copy and nothing to delete until it
      //- has an id.
      div(class="flex flex-wrap gap-1.5")
        button(
          type="button"
          :disabled="activeId === null"
          :class="[pill(false), activeId === null ? 'cursor-not-allowed opacity-40' : '']"
          @click="request({ kind: 'duplicate' })"
        ) {{ t('characters.duplicate') }}
        button(
          type="button"
          :disabled="activeId === null"
          :class="[pill(false), activeId === null ? 'cursor-not-allowed opacity-40' : 'hover:bg-rose-900/60']"
          @click="askDelete"
        ) {{ t('characters.delete') }}

      //- Sticky, and it earns it: seven option groups do not fit a phone's half
      //- screen, so a Save button at the natural end of the column is a Save
      //- button the player has to go looking for.
      //-
      //- The panel deliberately has no bottom padding of its own and this bar
      //- supplies it. A `-mb-3` against a padded scroller looked equivalent and
      //- is not: `bottom: 0` pins the *margin* box, so a negative bottom margin
      //- lifts the bar clear of the scrollport edge and leaves a 20 px strip of
      //- options scrolling past underneath it.
      div(
        class="sticky bottom-0 z-10 -mx-3 mt-auto flex flex-col gap-1.5 border-t border-white/10 bg-slate-950/95 px-3 pt-2 backdrop-blur-sm"
        :style="footerInset"
      )
        //- The two confirmations live inside the sticky bar rather than over the
        //- canvas: a modal would cover the figure, and the figure is the thing
        //- the player is deciding about.
        div(v-if="pending" class="flex flex-col gap-1.5 rounded-lg bg-amber-950/50 p-2 ring-1 ring-amber-500/30")
          p(class="text-[11px] leading-snug text-amber-100") {{ t('characters.unsavedChanges') }}
          div(class="flex flex-wrap gap-1.5")
            button(type="button" :class="pill(true)" @click="confirmSave") {{ t('characters.saveAndContinue') }}
            button(type="button" :class="pill(false)" @click="confirmDiscard") {{ t('characters.discard') }}
            button(type="button" :class="pill(false)" @click="cancelPending") {{ t('cancel') }}

        div(v-if="pendingDelete" class="flex flex-col gap-1.5 rounded-lg bg-rose-950/50 p-2 ring-1 ring-rose-500/30")
          p(class="text-[11px] leading-snug text-rose-100")
            | {{ t('characters.deleteConfirm', { name: pendingDeleteLabel }) }}
          div(class="flex flex-wrap gap-1.5")
            button(
              type="button"
              class="rounded-full bg-rose-600 px-3 py-1.5 text-xs font-medium text-slate-50 hover:bg-rose-500"
              @click="confirmDelete"
            ) {{ t('characters.delete') }}
            button(type="button" :class="pill(false)" @click="pendingDelete = null") {{ t('cancel') }}

        button(
          type="button"
          class="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-slate-50 hover:bg-sky-500"
          @click="save"
        ) {{ justSaved ? t('characters.saved') : t('characters.save') }}
        button(
          type="button"
          class="rounded-lg px-4 py-2 text-xs text-slate-400 hover:text-slate-200"
          @click="back"
        ) {{ t('characters.back') }}
</template>

<!--
  `/characters` — the Vue shell for the character-creation stage.

  Same division of labour as `WorldScene.vue` and `WaterLabView.vue`: this
  component owns a canvas element, a size, a lifecycle and the panel; every frame
  of work happens inside `CreatorScene`. The instance is held in a `shallowRef`
  and wrapped in `markRaw` so Vue's reactive proxy never reaches a scene node — a
  plain `ref` would put dependency tracking on the whole three.js graph, which
  fails silently by rendering correctly at 12 fps.

  The appearance is a `shallowRef` holding a **plain, replaced-whole** object for
  the same reason from the other side: a deep `ref` would hand the scene a
  reactive proxy on every change, and although `CreatorScene` copies out of it
  field by field, the safe thing is for the proxy never to exist. The roster is
  the same shape one level up: `RosterStore` is a plain object this file never
  wraps, and every read out of it (`list`, `profile`) is already a copy.

  ── The states a one-character screen did not have ─────────────────────────────

  * **An unsaved draft.** `activeId === null`. It has no id yet, so the id line
    shows the id the current name *would* produce and says as much. Save mints it.
  * **Switching away with unsaved edits.** Any action that changes which profile
    is open goes through `request()`, which stops on a dirty editor and offers
    save / discard / cancel. One guard, so Duplicate cannot grow its own answer.
  * **Deleting the profile that is open.** `RosterStore.remove` returns the id
    that is open afterwards — the neighbour in display order, or `null` when the
    roster empties, which lands on the same draft state a first visit does.
  * **An empty roster.** The dropdown always carries "New character" as its first
    entry, so it is never an empty control, and the panel says so in words.

  Unlike the editor overlays elsewhere in this project — dev tools behind a code
  word, and exempt — this screen is player-facing, so every visible string here
  goes through vue-i18n and exists in all 21 locales.
-->

<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  CreatorScene,
  EYE_STYLE_OPTIONS,
  HAIR_COLOUR_SWATCHES,
  HAIR_STYLES,
  HEAD_SHAPES,
  MOUTH_STYLE_OPTIONS,
  PREVIEW_ITEMS,
  SEXES,
  SKIN_TONE_SWATCHES,
  TUNIC_COLOUR_SWATCHES,
  appearanceEquals,
  asSkinTone,
  loadAppearance,
  randomAppearance,
  saveAppearance
} from '@/world/characters/CreatorScene'
import { GEAR_SEED_SPACE } from '@/world/characters/gear'
import {
  DEFAULT_APPEARANCE,
  ITEM_SLOT,
  type CharacterAppearance,
  type DrawnState,
  type EquipmentLoadout,
  type ItemKind
} from '@/world/characters/equipment'
import { canDraw } from '@/world/characters/inventory'
import { MAX_NAME_LENGTH, makeCharacterId, type CharacterProfile } from '@/world/characters/profile'
import {
  characterRoster,
  emptyDraft,
  filterProfiles,
  foldForSearch,
  loadoutEquals,
  sanitiseName,
  type ProfileDraft
} from '@/world/characters/roster'

const { t } = useI18n()
const router = useRouter()

const host = useTemplateRef<HTMLDivElement>('host')
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')

/**
 * The `<select>` value that means "the unsaved draft".
 *
 * The empty string is safe as a sentinel because `makeCharacterId` never returns
 * one — an empty name falls back to `character` precisely so that an id of `''`,
 * which is a lookup that silently matches nothing, cannot exist.
 */
const DRAFT = ''

const roster = characterRoster()

// See the comment above — shallowRef + markRaw, never a plain ref.
const scene = shallowRef<CreatorScene | null>(null)
const profiles = shallowRef<CharacterProfile[]>(roster.list())
const activeId = shallowRef<string | null>(roster.activeId)
const name = ref('')
const appearance = shallowRef<CharacterAppearance>({ ...DEFAULT_APPEARANCE })
/**
 * The equipment preview.
 *
 * Part of the profile now, and saved with it: `CharacterProfile.loadout` is what
 * a future "equip weapons here" panel writes into, and storing it costs nothing
 * extra. It is still **not** ownership — `inventory.ts` decides what a player
 * *has*, and trying a shield on here is not being given one. See the seam note
 * at the bottom of `roster.ts`.
 */
const loadout = shallowRef<EquipmentLoadout>(emptyDraft().loadout)
/** What was last loaded or saved, for the dirty check. Plain, never a proxy. */
const baseline = shallowRef<ProfileDraft>(emptyDraft())
const spinning = ref(true)
const justSaved = ref(false)

/** An action deferred because the editor was dirty. */
type PendingAction = { kind: 'open'; id: string | null } | { kind: 'duplicate' }

const pending = ref<PendingAction | null>(null)
const pendingDelete = ref<string | null>(null)

/** How long the save button holds its confirmation before reverting. */
const SAVED_FEEDBACK_MS = 1800

// Safe-area insets: the title clears the notch, the panel clears the home
// indicator. Both are plain objects rather than classes because `env()` is not
// expressible as a Tailwind utility.
const topInset = { paddingTop: 'env(safe-area-inset-top, 0px)' }
const panelInset = { paddingRight: 'calc(0.75rem + env(safe-area-inset-right, 0px))' }
// The bottom inset lives on the sticky footer, not on the panel: once the
// footer is pinned it covers the panel's own bottom padding, so an inset there
// would be underneath it and the Save button would sit on the home indicator.
const footerInset = { paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }

const pill = (active: boolean): string =>
  active
    ? 'rounded-full bg-sky-600/90 px-3 py-1.5 text-xs font-medium text-slate-50'
    : 'rounded-full bg-slate-800/80 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700/80'

const dot = (active: boolean): string =>
  active
    ? 'h-8 w-8 rounded-full ring-2 ring-sky-400 ring-offset-2 ring-offset-slate-950'
    : 'h-8 w-8 rounded-full ring-1 ring-white/25 hover:ring-white/60'

// ─── The roster ─────────────────────────────────────────────────────────────

/** A blank name is legal, so the list needs a word for one. */
const entryLabel = (entry: CharacterProfile): string => entry.name || t('characters.unnamed')

const refresh = (): void => {
  profiles.value = roster.list()
  activeId.value = roster.activeId
}

/** Loads a draft into the editor and re-baselines it. Copies, never aliases. */
const apply = (draft: ProfileDraft): void => {
  name.value = draft.name
  appearance.value = { ...draft.appearance }
  loadout.value = { ...draft.loadout }
  baseline.value = { name: draft.name, appearance: { ...draft.appearance }, loadout: { ...draft.loadout } }
  justSaved.value = false
}

const editorDraft = (): ProfileDraft => ({
  name: name.value,
  appearance: appearance.value,
  loadout: loadout.value
})

/**
 * Whether the editor holds anything the roster does not.
 *
 * Against the baseline rather than against storage, so a draft seeded from the
 * legacy single-character appearance key does not open dirty and start
 * challenging the player before they have touched anything.
 */
const dirty = computed(
  () =>
    sanitiseName(name.value) !== baseline.value.name ||
    !appearanceEquals(appearance.value, baseline.value.appearance) ||
    !loadoutEquals(loadout.value, baseline.value.loadout)
)

/**
 * The id, or on a draft the id this name would be given.
 *
 * Read-only in both cases. The argument is in `roster.ts`: an editable id is a
 * rename that silently breaks every save, quest and spawn-table reference to the
 * character, and the way to get a legible id here is to type a good name.
 */
const shownId = computed(() =>
  activeId.value === null ? makeCharacterId(sanitiseName(name.value), roster.ids()) : activeId.value
)

const openProfile = (id: string | null): void => {
  if (!roster.open(id)) {
    // Gone — another tab deleted it. Show what is actually there rather than
    // blanking the screen.
    refresh()
    return
  }
  roster.save()
  const profile = roster.activeProfile()
  apply(profile ? { name: profile.name, appearance: profile.appearance, loadout: profile.loadout } : emptyDraft())
  refresh()
}

const duplicateActive = (): void => {
  const id = activeId.value
  if (id === null) {
    return
  }
  const source = roster.profile(id)
  const copy = roster.duplicate(id, t('characters.copyName', { name: source ? entryLabel(source) : '' }))
  if (!copy) {
    refresh()
    return
  }
  roster.save()
  apply({ name: copy.name, appearance: copy.appearance, loadout: copy.loadout })
  refresh()
}

const run = (action: PendingAction): void => {
  pending.value = null
  if (action.kind === 'open') {
    openProfile(action.id)
  } else {
    duplicateActive()
  }
}

/**
 * One guard for every action that changes which profile is open.
 *
 * Duplicate goes through it as well as the dropdown, because it opens the copy —
 * so without this it would be a second, different answer to "you have unsaved
 * edits", and the two would drift.
 */
const request = (action: PendingAction): void => {
  if (dirty.value) {
    pending.value = action
    return
  }
  run(action)
}

// ─── The roster combobox ────────────────────────────────────────────────────
//
// A `<select>` could not do two things this screen needs. It cannot show the id
// beside the name — and the id is the identifier every quest, spawn table and
// save file uses, so somebody who arrived holding one had no way to look it up.
// And it cannot be searched: `MAX_PROFILES` is 64, and a city's worth of NPCs is
// exactly the case the roster exists for.
//
// So it is rebuilt by hand, and everything the native control supplied for free
// has to be supplied again on purpose:
//
//   * **Keyboard.** ↑ ↓ Home End move, Enter picks, Escape closes and returns
//     focus to the trigger, Tab closes. Typing filters. `aria-activedescendant`
//     keeps the reading order right while focus stays in the search field.
//   * **Scroll containment.** The list has its own `max-h` and
//     `overscroll-contain`, because this floats over a 3D canvas and a wheel
//     that ran off the end of the list would chain to whatever is behind it.
//   * **Never empty.** "New character" is an option like any other, so the list
//     has a row even on a first visit.
//
// Matching is not decided here — `filterProfiles` in `roster.ts` owns it, is
// pure, and is tested directly.

const rosterRoot = useTemplateRef<HTMLDivElement>('rosterRoot')
const rosterTrigger = useTemplateRef<HTMLButtonElement>('rosterTrigger')
const rosterSearch = useTemplateRef<HTMLInputElement>('rosterSearch')

const rosterOpen = ref(false)
const query = ref('')
/** Which row the keyboard is on. Enter picks this one. */
const cursor = ref(0)

/**
 * A row: a saved profile, or the draft.
 *
 * `id: null` is the draft, matching `activeId`'s own encoding of it, so the row
 * can be handed straight to `request({ kind: 'open', id })` with no translation
 * step where the sentinel could be got wrong.
 */
interface RosterOption {
  id: string | null
  label: string
}

/**
 * The draft is filtered by the same query as everything else.
 *
 * Pinning it would mean a query that matches nothing still leaves one row
 * highlighted, and Enter would then create a new character when the player was
 * trying to find an existing one. Filtering it uniformly makes "no matches"
 * true when it is true, and Enter unambiguous whenever a row is showing.
 */
const rosterOptions = computed<RosterOption[]>(() => {
  const label = t('characters.newCharacter')
  const tokens = foldForSearch(query.value).split(' ').filter(Boolean)
  const folded = foldForSearch(label)
  const draft: RosterOption[] = tokens.every(token => folded.includes(token)) ? [{ id: null, label }] : []
  return draft.concat(
    filterProfiles(profiles.value, query.value).map(entry => ({ id: entry.id, label: entryLabel(entry) }))
  )
})

/** What the closed trigger reads. The open character, not the query. */
const triggerLabel = computed(() => {
  const profile = activeId.value === null ? null : roster.profile(activeId.value)
  return profile ? entryLabel(profile) : t('characters.newCharacter')
})

const activeOptionId = computed(() =>
  rosterOpen.value && rosterOptions.value.length > 0 ? `roster-option-${cursor.value}` : undefined
)

const rosterRow = (index: number, selected: boolean): string =>
  [
    'flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs',
    index === cursor.value ? 'bg-sky-600/90 text-slate-50' : 'text-slate-200',
    selected && index !== cursor.value ? 'text-sky-300' : ''
  ]
    .filter(Boolean)
    .join(' ')

// Rows are addressed by index for scroll-into-view. A plain array rather than a
// ref-per-row: the list is rebuilt whole on every keystroke, and this is read
// only immediately after one.
const optionEls: (HTMLElement | null)[] = []
const setOptionRef = (el: unknown, index: number): void => {
  optionEls[index] = (el as HTMLElement | null) ?? null
}

/**
 * Keeps the cursor row visible without scrolling the page.
 *
 * `scrollIntoView({ block: 'nearest' })` on an element inside an
 * `overflow-y-auto` parent scrolls only that parent when the element is already
 * horizontally in view, which it always is here.
 */
const revealCursor = (): void => {
  void nextTick(() => optionEls[cursor.value]?.scrollIntoView({ block: 'nearest' }))
}

const moveCursor = (delta: number): void => {
  const count = rosterOptions.value.length
  if (count === 0) {
    return
  }
  // Wraps, like the native control does at both ends.
  cursor.value = (cursor.value + delta + count) % count
  revealCursor()
}

const closeRoster = (focusTrigger = false): void => {
  if (!rosterOpen.value) {
    return
  }
  rosterOpen.value = false
  query.value = ''
  optionEls.length = 0
  if (focusTrigger) {
    void nextTick(() => rosterTrigger.value?.focus())
  }
}

const openRoster = (): void => {
  if (rosterOpen.value) {
    return
  }
  rosterOpen.value = true
  query.value = ''
  // Open on the character that is loaded, so ↑/↓ walks away from where you are
  // rather than from the top of the list.
  const at = rosterOptions.value.findIndex(entry => entry.id === activeId.value)
  cursor.value = at < 0 ? 0 : at
  void nextTick(() => {
    rosterSearch.value?.focus()
    revealCursor()
  })
}

const toggleRoster = (): void => {
  if (rosterOpen.value) {
    closeRoster()
  } else {
    openRoster()
  }
}

const pickOption = (entry: RosterOption): void => {
  closeRoster(true)
  if (entry.id === activeId.value) {
    return
  }
  request({ kind: 'open', id: entry.id })
}

const onQuery = (event: Event): void => {
  query.value = (event.target as HTMLInputElement).value
  // The list under the cursor just changed. Row 0 is the best match by
  // `filterProfiles`' ranking, which is the row Enter should take.
  cursor.value = 0
  revealCursor()
}

const onSearchKey = (event: KeyboardEvent): void => {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      moveCursor(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      moveCursor(-1)
      break
    case 'Home':
      event.preventDefault()
      cursor.value = 0
      revealCursor()
      break
    case 'End':
      event.preventDefault()
      cursor.value = Math.max(0, rosterOptions.value.length - 1)
      revealCursor()
      break
    case 'Enter': {
      event.preventDefault()
      const entry = rosterOptions.value[cursor.value]
      if (entry) {
        pickOption(entry)
      }
      break
    }
    case 'Escape':
      event.preventDefault()
      closeRoster(true)
      break
    case 'Tab':
      // Let focus leave, but do not leave a popover open behind it.
      closeRoster()
      break
    default:
      break
  }
}

const onTriggerKey = (event: KeyboardEvent): void => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    openRoster()
  }
}

/**
 * Closes on a click anywhere else — including on the canvas, where the click is
 * the start of a drag to turn the figure and must still reach it. `pointerdown`
 * rather than `click` so the popover is gone before that drag begins.
 */
const onDocumentPointerDown = (event: PointerEvent): void => {
  if (!rosterOpen.value) {
    return
  }
  const target = event.target as Node | null
  if (target && rosterRoot.value?.contains(target)) {
    return
  }
  closeRoster()
}

const confirmSave = (): void => {
  const action = pending.value
  pending.value = null
  save()
  if (action) {
    run(action)
  }
}

const confirmDiscard = (): void => {
  const action = pending.value
  pending.value = null
  if (action) {
    run(action)
  }
}

const cancelPending = (): void => {
  pending.value = null
}

const pendingDeleteLabel = computed(() => {
  const profile = pendingDelete.value === null ? null : roster.profile(pendingDelete.value)
  return profile ? entryLabel(profile) : ''
})

const askDelete = (): void => {
  if (activeId.value === null) {
    return
  }
  pending.value = null
  pendingDelete.value = activeId.value
}

/**
 * Deletes, then opens whatever the store says is open now.
 *
 * No unsaved-changes guard: the player is deleting the thing those edits belong
 * to, so offering to save it first would be asking whether to write a character
 * out and then immediately erase it.
 */
const confirmDelete = (): void => {
  const id = pendingDelete.value
  pendingDelete.value = null
  if (id === null) {
    return
  }
  roster.remove(id)
  roster.save()
  const profile = roster.activeProfile()
  apply(profile ? { name: profile.name, appearance: profile.appearance, loadout: profile.loadout } : emptyDraft())
  refresh()
}

// ─── Appearance ─────────────────────────────────────────────────────────────

/**
 * Replaces the whole appearance rather than mutating a field.
 *
 * `shallowRef` only notices identity changes, and that is the point: one new
 * plain object per edit means there is never a proxy, and the watcher below
 * fires exactly once per click.
 */
const patch = (change: Partial<CharacterAppearance>): void => {
  appearance.value = { ...appearance.value, ...change }
}

const surprise = (): void => {
  appearance.value = randomAppearance()
}

const startOver = (): void => {
  appearance.value = { ...DEFAULT_APPEARANCE }
}

const onName = (event: Event): void => {
  // Raw while typing. `sanitiseName` collapses runs of spaces, and applying that
  // per keystroke eats the space between two words the moment it is pressed; the
  // store sanitises on commit instead.
  name.value = (event.target as HTMLInputElement).value
  justSaved.value = false
}

const toggleSpin = (): void => {
  spinning.value = !spinning.value
  scene.value?.setSpinning(spinning.value)
}

// ─── Equipment preview ──────────────────────────────────────────────────────

const isEquipped = (kind: ItemKind): boolean => loadout.value[ITEM_SLOT[kind]] === kind

const weaponDrawn = computed(() => loadout.value.drawn !== 'sheathed')
const canDrawWeapon = computed(() => canDraw(loadout.value, 'mainHand'))

/**
 * Equips or unequips one item.
 *
 * The drawn state is settled here as well as in the scene, because the button
 * has to be *drawn* correctly: unequip the sword while it is drawn and this
 * panel would keep showing "Draw weapon" pressed for a hand that is now empty.
 * `canDraw` is `inventory.ts`'s — the same rule the scene enforces, asked once
 * rather than reimplemented, because a UI that greys a button by one rule while
 * the scene obeys another is the whole failure that module's header warns about.
 */
const toggleItem = (kind: ItemKind): void => {
  const slot = ITEM_SLOT[kind]
  const next: EquipmentLoadout = { ...loadout.value }
  next[slot] = next[slot] === kind ? null : kind
  if (!canDraw(next, next.drawn)) {
    next.drawn = 'sheathed'
  }
  loadout.value = next
}

const toggleDrawn = (): void => {
  const target: DrawnState = weaponDrawn.value ? 'sheathed' : 'mainHand'
  if (!canDraw(loadout.value, target)) {
    return
  }
  loadout.value = { ...loadout.value, drawn: target }
}

let savedTimer: number | null = null

/**
 * Saves the open character, minting an id for a draft.
 *
 * `saveAppearance` is still called, and deliberately: that key is what says
 * "this is the character you play as", and the roster is the set that choice is
 * made from. Dropping it would leave the world showing whichever appearance was
 * saved before this screen grew a roster.
 */
const save = (): void => {
  const draft = editorDraft()
  // `update` returns null only when the id has gone — another tab deleted it
  // while this one was editing. Falling through to `create` keeps the player's
  // work rather than discarding it into a profile that no longer exists.
  const saved =
    activeId.value === null ? roster.create(draft) : (roster.update(activeId.value, draft) ?? roster.create(draft))
  roster.save()
  saveAppearance(appearance.value)
  // Re-read what was stored rather than trusting the editor: the store trims and
  // caps the name, so the field has to show what the dropdown will.
  apply({ name: saved.name, appearance: saved.appearance, loadout: saved.loadout })
  refresh()

  justSaved.value = true
  if (savedTimer !== null) {
    window.clearTimeout(savedTimer)
  }
  savedTimer = window.setTimeout(() => {
    justSaved.value = false
  }, SAVED_FEEDBACK_MS)
}

const back = (): void => {
  void router.push('/')
}

watch(appearance, value => {
  scene.value?.setAppearance(value)
  // Any edit invalidates the confirmation: leaving "Saved" on the button while
  // the figure has moved on says the wrong thing about what is in storage.
  justSaved.value = false
})

// The loadout is part of the profile now, so unlike before it *does* clear the
// confirmation — dressing the figure is an unsaved edit like any other.
watch(loadout, value => {
  scene.value?.setLoadout(value)
  justSaved.value = false
})

let observer: ResizeObserver | null = null

onMounted(() => {
  // Registered before the early return: the combobox is rendered whether or not
  // the canvas came up, so it has to close on an outside click either way.
  window.addEventListener('pointerdown', onDocumentPointerDown, true)

  const canvasElement = canvas.value
  const hostElement = host.value
  if (!canvasElement || !hostElement) {
    return
  }

  // Whatever the roster had open, or — on a first visit, and for every player
  // who used this screen before it had a roster — the single appearance the old
  // key still holds. That blob is never deleted, so downgrading a build does not
  // strand anybody.
  const open = roster.activeProfile()
  apply(
    open
      ? { name: open.name, appearance: open.appearance, loadout: open.loadout }
      : { ...emptyDraft(), appearance: loadAppearance() }
  )
  refresh()

  const instance = markRaw(new CreatorScene(canvasElement, appearance.value))
  instance.attach(canvasElement)
  instance.setLoadout(loadout.value)
  scene.value = instance

  if (import.meta.env.DEV) {
    // Dev-only handle, exactly as `WorldScene` and `WaterLabView` expose theirs,
    // so a CDP session can read the profiler and the measured rebuild cost
    // without a UI round-trip. Stripped from every production build by the gate.
    ;(window as unknown as { __creatorScene?: CreatorScene }).__creatorScene = instance
  }

  observer = new ResizeObserver(entries => {
    const entry = entries[0]
    if (!entry) {
      return
    }
    const { width, height } = entry.contentRect
    instance.setSize(width, height)
  })
  observer.observe(hostElement)
  instance.setSize(hostElement.clientWidth, hostElement.clientHeight)
  instance.start()
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onDocumentPointerDown, true)
  observer?.disconnect()
  observer = null
  if (savedTimer !== null) {
    window.clearTimeout(savedTimer)
  }
  scene.value?.dispose()
  scene.value = null
})
</script>

<style scoped lang="sass">
// Nothing here fights the utilities: the panel's scrollbar is the one thing
// Tailwind cannot express, and a default one over a dark panel is a bright bar.
aside
  scrollbar-width: thin
  scrollbar-color: rgba(148, 163, 184, 0.35) transparent

// The roster is a native `select` so it inherits the platform's keyboard and
// touch behaviour; its *dropped* list is drawn by the OS and takes no page
// styling, so the options are given an explicit dark ground rather than
// inheriting a white one on the platforms that do honour it.
select option
  background-color: #0f172a
  color: #e2e8f0
</style>
