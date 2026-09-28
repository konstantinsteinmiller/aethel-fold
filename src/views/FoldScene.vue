<script setup lang="ts">
/**
 * Castle Fold — the game screen.
 *
 * No main menu (GDD §6): mounting drops the player straight onto their page —
 * page 1 for a new player, or the page they left off on (from `aethel_state`,
 * hydrated from the platform's cloud save before this component ever mounts).
 *
 * HUD layout (safe-area aware, fluid sizes, portrait and landscape):
 *   top-left   PageBadge + HeartsBadge
 *   top-centre ScoreBadge (+ BossMeter on the dragon's page)
 *   top-right  FMuteButton + settings (folded paper gear → cootie-catcher pause)
 * The bottom 60 % of the screen is left to the thumbs (GDD §4).
 */
import { computed, markRaw, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FoldEngine } from '@/fold/FoldEngine'
import type { FoldEvent } from '@/fold/logic/events'
import type { FoldGame } from '@/fold/logic/game'
import { PAGES, PAGE_COUNT } from '@/fold/logic/pages'
import { LESSON_IDS } from '@/fold/logic/lessons'
import { brokenCount } from '@/fold/logic/boss'
import type { LessonId, PageId } from '@/fold/logic/types'
import type { ScreenPoint } from '@/fold/render/GameView'
import PageBadge from '@/components/fold/PageBadge.vue'
import HeartsBadge from '@/components/fold/HeartsBadge.vue'
import ScoreBadge from '@/components/fold/ScoreBadge.vue'
import BossMeter from '@/components/fold/BossMeter.vue'
import FxLayer from '@/components/fold/FxLayer.vue'
import GhostHand from '@/components/fold/GhostHand.vue'
import CootieCatcherPause from '@/components/fold/CootieCatcherPause.vue'
import VictoryPanel from '@/components/fold/VictoryPanel.vue'
import FMuteButton from '@/components/atoms/FMuteButton.vue'
import FHudButton from '@/components/atoms/FHudButton.vue'
import OrigamiIcon from '@/components/icons/OrigamiIcon.vue'
import useUser from '@/use/useUser'
import { isGamePaused } from '@/use/useGamePause'
import { syncGameplayLifecycle } from '@/use/useGameplayLifecycle'
import {
  addStats, bankScore, checkpoint, foldSettings, learnLesson, lessons, progressRevision, recordVictory,
  records, resumePage, runCheckpoint, startNewRun
} from '@/use/useFoldProgress'
import { mobileCheck } from '@/utils/function'

const { t } = useI18n()
const { userSoundVolume, userMusicVolume } = useUser()

const canvas = ref<HTMLCanvasElement | null>(null)
const stage = ref<HTMLDivElement | null>(null)
const hudTop = ref<HTMLDivElement | null>(null)
const fx = ref<InstanceType<typeof FxLayer> | null>(null)
const ghost = ref<InstanceType<typeof GhostHand> | null>(null)
const engine = shallowRef<FoldEngine | null>(null)
const isTouch = mobileCheck() || (typeof window !== 'undefined' && 'ontouchstart' in window)

const hud = reactive({
  page: 1 as PageId,
  score: 0,
  hp: 3,
  maxHp: 3,
  boss: false,
  bossBroken: 0,
  bossExposed: false,
  victory: false,
  victoryScore: 0,
  victoryTime: 0,
  victoryHits: 0,
  newBest: false
})
const pauseOpen = ref(false)
const nameKey = computed(() => PAGES[hud.page].nameKey)

// ─── Engine hooks ────────────────────────────────────────────────────────────

const sp: ScreenPoint = { x: 0, y: 0, visible: false }
let statsBase = { launched: 0, crushed: 0, torn: 0, folds: 0, stamps: 0, blocks: 0 }

const bankStats = (g: FoldGame): void => {
  const s = g.stats
  addStats({
    launched: s.launched - statsBase.launched,
    crushed: s.crushed - statsBase.crushed,
    torn: s.torn - statsBase.torn,
    folds: s.folds - statsBase.folds,
    stamps: s.stamps - statsBase.stamps,
    blocks: s.blocks - statsBase.blocks
  })
  statsBase = { launched: s.launched, crushed: s.crushed, torn: s.torn, folds: s.folds, stamps: s.stamps, blocks: s.blocks }
}

const onEvent = (e: FoldEvent, g: FoldGame): void => {
  const eng = engine.value
  switch (e.type) {
    case 'score':
      if (eng && fx.value) {
        eng.project(e.x, 1.3, e.z, sp)
        fx.value.pop(sp.x, sp.y, e.b, e.c)
      }
      break
    case 'combo':
      break
    case 'heroHit':
      hud.hp = e.b
      break
    case 'pageIntro':
      hud.page = e.a as PageId
      hud.hp = g.hero.hp
      hud.maxHp = g.hero.maxHp
      hud.boss = e.a === 5
      hud.victory = false
      // Checkpoint: a reload resumes on this page with this score.
      checkpoint(e.a as PageId, { score: g.pageStartScore, hits: g.runHits, time: g.runTime }, g.pagesCleared)
      break
    case 'pageCleared':
      bankStats(g)
      bankScore(g.score)
      // Resume on the *next* page with everything banked so far.
      checkpoint(Math.min(6, e.a + 1) as PageId, { score: g.score, hits: g.runHits, time: g.runTime }, Math.max(g.pagesCleared, e.a))
      break
    case 'lesson':
      if (e.b === 0) {
        const id = LESSON_IDS[e.a] as LessonId | undefined
        if (id) learnLesson(id)
      }
      break
    case 'victory': {
      bankStats(g)
      const res = recordVictory(g.score, g.runTime)
      hud.victoryScore = g.score
      hud.victoryTime = g.runTime
      hud.victoryHits = g.runHits
      hud.newBest = res.newBest
      hud.victory = true
      break
    }
    case 'pageDrop':
      hud.hp = g.hero.hp
      break
  }
}

const word = (key: string, x: number, y: number, size: number, tone: string): void => {
  const g = engine.value?.game
  fx.value?.word(key, x, y, size, tone, { n: g?.combo ?? 0 })
}

const onFrame = (g: FoldGame): void => {
  if (hud.score !== g.score) hud.score = g.score
  if (hud.hp !== g.hero.hp) hud.hp = g.hero.hp
  if (g.pageId === 5) {
    const broken = brokenCount(g.boss)
    if (hud.bossBroken !== broken) hud.bossBroken = broken
    const exp = g.boss.exposed >= 0
    if (hud.bossExposed !== exp) hud.bossExposed = exp
  }
  const eng = engine.value
  if (eng && ghost.value) ghost.value.update(g.lesson, (x, y, z, out) => eng.project(x, y, z, out))
}

// ─── Layout ──────────────────────────────────────────────────────────────────

let ro: ResizeObserver | null = null
const layout = (): void => {
  const eng = engine.value
  const el = stage.value
  if (!eng || !el) return
  const w = el.clientWidth
  const h = el.clientHeight
  // Keep the page clear of the HUD strip at the top.
  const topPx = (hudTop.value?.getBoundingClientRect().bottom ?? 0) - el.getBoundingClientRect().top
  eng.resize(w, h, {
    top: Math.min(0.24, Math.max(0.06, (topPx + 6) / Math.max(1, h))),
    bottom: 0.02,
    side: 0.015
  })
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

const learnedMap = (): Partial<Record<LessonId, boolean>> => ({ ...lessons.value })

const bootPage = (): { page: PageId; score: number } => {
  const page = resumePage.value
  const score = page > 1 ? runCheckpoint.value?.score ?? 0 : 0
  return { page, score }
}

onMounted(() => {
  const c = canvas.value
  if (!c) return
  const { page, score } = bootPage()
  if (page === 1) startNewRun()
  const eng = markRaw(new FoldEngine(c, { onEvent, word, onFrame }, { learned: learnedMap(), startPage: page, startScore: score }))
  engine.value = eng
  eng.attach()
  eng.setVolumes(userSoundVolume.value, userMusicVolume.value)
  eng.setQuality(foldSettings.value.quality)
  eng.setShake(foldSettings.value.shake)
  eng.setHaptics(foldSettings.value.haptics)
  hud.page = page
  hud.score = score
  ro = new ResizeObserver(layout)
  if (stage.value) ro.observe(stage.value)
  if (hudTop.value) ro.observe(hudTop.value)
  layout()
  eng.start()
  publishDebugHandle(eng)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  engine.value?.dispose()
  engine.value = null
  syncGameplayLifecycle(false)
  delete (window as unknown as { __fold?: unknown }).__fold
})

// ─── Settings & pause ────────────────────────────────────────────────────────

watch([userSoundVolume, userMusicVolume], ([s, m]) => engine.value?.setVolumes(s, m))
watch(foldSettings, (s) => {
  const eng = engine.value
  if (!eng) return
  eng.setQuality(s.quality)
  eng.setShake(s.shake)
  eng.setHaptics(s.haptics)
})

const paused = computed(() => pauseOpen.value || isGamePaused.value)
watch(paused, (p) => engine.value?.setPaused(p))
// Platform "gameplay" signal: live while the player is actually playing.
const live = computed(() => !paused.value && !hud.victory)
watch(live, (v) => syncGameplayLifecycle(v), { immediate: true })

const openPause = (): void => {
  pauseOpen.value = true
}
const resume = (): void => {
  pauseOpen.value = false
}
const restartPage = (): void => {
  pauseOpen.value = false
  engine.value?.restartPage()
}
const newGame = (): void => {
  pauseOpen.value = false
  startNewRun()
  statsBase = { launched: 0, crushed: 0, torn: 0, folds: 0, stamps: 0, blocks: 0 }
  engine.value?.newRun()
}
const playAgain = (): void => {
  hud.victory = false
  newGame()
}

const onKey = (e: KeyboardEvent): void => {
  if (pauseOpen.value) return
  if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
    e.preventDefault()
    openPause()
  } else if (e.key === 'Enter' && hud.victory) {
    playAgain()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// ─── Late cloud hydration ────────────────────────────────────────────────────
//
// `main.ts` awaits the SDK hydrate before this view mounts, so the normal path
// already boots on the right page. But a hydrate can also *recover* later (the
// strategy's retry ladder after a slow or failed first read). If it brings
// back progress while this session is still sitting at the start of a fresh
// book, jump to the saved page instead of letting the player continue as a
// false "fresh user".
watch(progressRevision, () => {
  const eng = engine.value
  if (!eng) return
  const g = eng.game
  for (const id of LESSON_IDS) if (lessons.value[id]) g.learned[id] = true
  const saved = resumePage.value
  const early = g.pageId === 1 && g.runTime < 90 && g.pagesCleared === 0
  if (saved > g.pageId && early) eng.jumpTo(saved, runCheckpoint.value?.score ?? 0)
})

// ─── Debug / e2e handle ──────────────────────────────────────────────────────

const publishDebugHandle = (eng: FoldEngine): void => {
  let cheat = false
  try {
    cheat = localStorage.getItem('cheat') === 'true'
  } catch {
    /* storage blocked */
  }
  if (!import.meta.env.DEV && !cheat) return
  ;(window as unknown as Record<string, unknown>).__fold = {
    engine: eng,
    game: eng.game,
    jumpTo: (p: number) => eng.jumpTo(Math.max(1, Math.min(PAGE_COUNT, p)) as PageId),
    clearPage: () => eng.game.debugClearPage(),
    state: () => ({
      page: eng.game.pageId,
      phase: eng.game.phase,
      score: eng.game.score,
      hp: eng.game.hero.hp,
      lesson: eng.game.lesson.id,
      timeScale: eng.game.timeScale,
      folds: eng.game.folds.map((f) => ({ id: f.def.id, kind: f.def.kind, phase: f.phase, t: f.t })),
      enemies: eng.game.aliveCount(),
      boss: eng.game.boss.phase
    }),
    /** Screen position (CSS px) of a page point — lets tests aim real pointer gestures. */
    screenOf: (x: number, z: number, y = 0) => {
      const out = { x: 0, y: 0, visible: false }
      eng.project(x, y, z, out)
      return { x: out.x, y: out.y }
    }
  }
}

const pageAria = computed(() => t('fold.a11y.board'))
</script>

<template lang="pug">
  div.fold-scene(ref="stage")
    canvas.fold-canvas(ref="canvas" :aria-label="pageAria" role="img" tabindex="-1")

    FxLayer(ref="fx")
    GhostHand(ref="ghost" :touch="isTouch")

    //- ── HUD ──
    div.hud-top(ref="hudTop")
      div.hud-left.flex.flex-col.items-start
        PageBadge(:page="hud.page" :total="PAGE_COUNT" :name-key="nameKey" :boss="hud.boss")
        HeartsBadge(:hp="hud.hp" :max="hud.maxHp")
      div.hud-centre.flex.flex-col.items-center
        ScoreBadge(:score="hud.score" :best="records.score")
        BossMeter(v-if="hud.boss" :total="5" :broken="hud.bossBroken" :exposed="hud.bossExposed")
      div.hud-right.flex.items-start
        FMuteButton
        FHudButton(tone="gold" :aria-label="t('fold.hud.settings')" @click="openPause")
          OrigamiIcon(name="gear" tone="yellow")

    VictoryPanel(
      :open="hud.victory"
      :score="hud.victoryScore"
      :best="records.score"
      :time="hud.victoryTime"
      :hits="hud.victoryHits"
      :new-best="hud.newBest"
      @again="playAgain"
    )

    CootieCatcherPause(
      :open="pauseOpen"
      @resume="resume"
      @restart-page="restartPage"
      @new-game="newGame"
    )
</template>

<style scoped lang="sass">
.fold-scene
  position: relative
  width: 100%
  height: 100%
  overflow: hidden
  background: #3a2416
  touch-action: none
  -webkit-touch-callout: none

.fold-canvas
  position: absolute
  inset: 0
  width: 100%
  height: 100%
  display: block
  touch-action: none
  outline: none

.hud-top
  position: absolute
  top: 0
  left: 0
  right: 0
  z-index: 20
  display: grid
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)
  align-items: start
  gap: clamp(0.3rem, 1.5vw, 0.8rem)
  padding: calc(clamp(0.35rem, 1.6vh, 0.75rem) + env(safe-area-inset-top, 0px)) calc(clamp(0.4rem, 2vw, 0.9rem) + env(safe-area-inset-right, 0px)) 0 calc(clamp(0.4rem, 2vw, 0.9rem) + env(safe-area-inset-left, 0px))
  pointer-events: none
  > *
    pointer-events: auto

.hud-left
  gap: clamp(0.25rem, 1vh, 0.45rem)
  min-width: 0

.hud-centre
  gap: clamp(0.2rem, 0.9vh, 0.4rem)

.hud-right
  justify-self: end
  gap: clamp(0.3rem, 1.4vw, 0.55rem)

// Landscape phones: keep the top strip thin so the page stays big.
@media (max-height: 520px) and (orientation: landscape)
  .hud-left
    flex-direction: row
    align-items: center
</style>
