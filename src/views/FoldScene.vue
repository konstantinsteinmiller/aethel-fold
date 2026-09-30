<script setup lang="ts">
/**
 * Aethel Fold — the game screen.
 *
 * No main menu (GDD §6): mounting drops the player straight onto their page —
 * page 1 for a new player, or the page they left off on (from `aethel_state`,
 * hydrated from the platform's cloud save before this component ever mounts).
 *
 * HUD layout (safe-area aware, fluid sizes, portrait and landscape):
 *   top-left   PageBadge + HeartsBadge
 *   top-centre ScoreBadge (+ BossMeter on the dragon's page)
 *   top-right  FMuteButton + settings (folded paper gear → cootie-catcher pause),
 *              and under them, once a book has been won and the camera can't
 *              already see it, the zoom button out to the desk bookshelf
 * The bottom 60 % of the screen is left to the thumbs (GDD §4).
 *
 * Chapter select is the bookshelf on the desk (roadmap #2), not a menu: the
 * camera goes out to it (zoom button, a tap on it where it's in view, by
 * itself after a win, or by folding the won book shut) and a book opened
 * there comes back as a `shelfBook` event. The pause menu's bookshelf face
 * stays as the accessible fallback.
 *
 * Dragon Rush (roadmap #16): after a book is won, its dragon alone, faster,
 * against the clock — from the victory card or the dragon figurine on the
 * shelf. The HUD's score tag becomes the rush clock; the result card compares
 * the time with the par and the saved best. A rush writes nothing but its best
 * time: no checkpoint, no stars, no kindness memory. "Back to the story"
 * reopens the saved page.
 *
 * Page secrets (roadmap #15): the game reports each one (`secret`); the first
 * find of each is saved (`fold_secrets`), night mode (the desk lamp) is a
 * cosmetic setting.
 *
 * Looks (roadmaps #6, #17): the equipped paper cosmetics and the season's skin
 * go to the engine as one `Look` (art only). A page clear whose stars unlock a
 * cosmetic shows the wordless unlock card after the star ribbon; stars from
 * another device (boot, a late hydrate) unlock silently. The season comes from
 * the local date unless the player turned the decorations off; a DEV build
 * can force one with `?season=halloween|winter|none` or `__fold.setSeason`.
 */
import { computed, markRaw, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FoldEngine } from '@/fold/FoldEngine'
import type { FoldEvent } from '@/fold/logic/events'
import type { FoldGame } from '@/fold/logic/game'
import { PAGE_COUNT, asBookId, isBookId, pageDef } from '@/fold/logic/pages'
import { LESSON_IDS } from '@/fold/logic/lessons'
import { brokenCount } from '@/fold/logic/boss'
import { ALMOST } from '@/fold/logic/config'
import type { BookId, LessonId, PageDef, PageId } from '@/fold/logic/types'
import type { ScreenPoint } from '@/fold/render/GameView'
import PageBadge from '@/components/fold/PageBadge.vue'
import HeartsBadge from '@/components/fold/HeartsBadge.vue'
import ScoreBadge from '@/components/fold/ScoreBadge.vue'
import BossMeter from '@/components/fold/BossMeter.vue'
import FxLayer from '@/components/fold/FxLayer.vue'
import GhostHand from '@/components/fold/GhostHand.vue'
import CootieCatcherPause from '@/components/fold/CootieCatcherPause.vue'
import VictoryPanel from '@/components/fold/VictoryPanel.vue'
import AlmostRetry from '@/components/fold/AlmostRetry.vue'
import RushClock from '@/components/fold/RushClock.vue'
import RushResult from '@/components/fold/RushResult.vue'
import { SECRET_IDS } from '@/fold/logic/secrets'
import { activeSeason, parseSeason, type Season } from '@/fold/logic/seasons'
import type { Look } from '@/fold/logic/cosmetics'
import FMuteButton from '@/components/atoms/FMuteButton.vue'
import FHudButton from '@/components/atoms/FHudButton.vue'
import OrigamiIcon from '@/components/icons/OrigamiIcon.vue'
import useUser from '@/use/useUser'
import { isGamePaused } from '@/use/useGamePause'
import { syncGameplayLifecycle } from '@/use/useGameplayLifecycle'
import {
  addStats, bankScore, bookUnlocked, checkpoint, cosmetics, equipCosmetic, foldSettings, learnLesson, lessons, pageStars,
  pagesCleared, pagesCleared2, pagesCleared3, progressRevision, readKindness, recordRush, recordSecret, recordStars, recordVictory,
  recordsFor, resumePage, runCheckpoint, rushBest, rushBestOf, saveKindness, savedBook, secretsFound, setFoldSetting,
  shelfProgress, startNewRun, unlockCosmetics, wins, wins2, wins3, flushSaveNow, type FoldSettings
} from '@/use/useFoldProgress'
import { mobileCheck } from '@/utils/function'
import { BOOT, bootSnapshot, bootStage, markFirstInput, markGameReady, markInteractive, markPrecompiled } from '@/use/useBoot'

const { t, locale } = useI18n()
const { userSoundVolume, userMusicVolume } = useUser()

const canvas = ref<HTMLCanvasElement | null>(null)
const stage = ref<HTMLDivElement | null>(null)
const hudTop = ref<HTMLDivElement | null>(null)
const shelfBtn = ref<InstanceType<typeof FHudButton> | null>(null)
const fx = ref<InstanceType<typeof FxLayer> | null>(null)
const ghost = ref<InstanceType<typeof GhostHand> | null>(null)
const engine = shallowRef<FoldEngine | null>(null)
const isTouch = mobileCheck() || (typeof window !== 'undefined' && 'ontouchstart' in window)

const hud = reactive({
  book: 1 as BookId,
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
  newBest: false,
  /** The Almost! moment's Try-again button is up. */
  retry: false,
  /** The desk bookshelf: the zoom button is shown, the camera is out at it, the hand points at the button. */
  shelfButton: false,
  shelfOpen: false,
  shelfCue: false,
  /** Dragon Rush (roadmap #16): a rush is the run; its clock in tenths, par, and the saved best. */
  rush: false,
  rushTenths: 0,
  rushPar: 0,
  rushBest: 0,
  /** The result card: this run's time, whether it beat the best before it. */
  rushDone: false,
  rushTime: 0,
  rushNewBest: false
})
const pauseOpen = ref(false)
const nameKey = computed(() => pageDef(hud.book, hud.page).nameKey)
const best = computed(() => recordsFor(hud.book).score)
/** The books the pause bookshelf can open. */
const openBooks = computed((): BookId[] => ([1, 2, 3] as BookId[]).filter((b) => bookUnlocked(b)))

// ─── Looks (roadmaps #6, #17) ───────────────────────────────────────────────

/** Debug builds (and the cheat flag) may force a season. */
const debugAllowed = (): boolean => {
  if (import.meta.env.DEV) return true
  try {
    return localStorage.getItem('cheat') === 'true'
  } catch {
    return false
  }
}
/** `?season=halloween` (before or inside the hash), DEV only. */
const seasonFromUrl = (): Season | null => {
  if (typeof window === 'undefined' || !debugAllowed()) return null
  const hashQuery = window.location.hash.includes('?') ? window.location.hash.slice(window.location.hash.indexOf('?')) : ''
  return parseSeason(new URLSearchParams(window.location.search).get('season'))
    ?? parseSeason(new URLSearchParams(hashQuery).get('season'))
}
const seasonOverride = ref<Season | null>(seasonFromUrl())
/** The local date the season is read from (once per session: a skin never flips mid-page). */
const today = new Date()
const look = computed<Look>(() => ({
  ...cosmetics.value.equipped,
  season: activeSeason(today, foldSettings.value.seasonal, seasonOverride.value)
}))

// ─── Engine hooks ────────────────────────────────────────────────────────────

const sp: ScreenPoint = { x: 0, y: 0, visible: false }
const BANKED = ['launched', 'crushed', 'torn', 'folds', 'stamps', 'blocks', 'runners', 'leapers', 'shots', 'shotKills'] as const
type Banked = Record<(typeof BANKED)[number], number>
const zeroBase = (): Banked => ({ launched: 0, crushed: 0, torn: 0, folds: 0, stamps: 0, blocks: 0, runners: 0, leapers: 0, shots: 0, shotKills: 0 })
let statsBase = zeroBase()

const bankStats = (g: FoldGame): void => {
  const s = g.stats
  const delta = zeroBase()
  for (const k of BANKED) {
    delta[k] = s[k] - statsBase[k]
    statsBase[k] = s[k]
  }
  addStats(delta)
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
      hud.book = g.book
      hud.page = e.a as PageId
      hud.hp = g.hero.hp
      hud.maxHp = g.hero.maxHp
      hud.boss = g.page.exit === 'boss'
      hud.victory = false
      hud.rush = g.rushing
      // Checkpoint: a reload resumes on this page with this score. A rush is not the story: it never moves the bookmark.
      if (!g.rushing) {
        checkpoint(e.a as PageId, { score: g.pageStartScore, hits: g.runHits, time: g.runTime }, g.pagesCleared, g.book)
      }
      break
    case 'pageCleared':
      // The stars fold in on the page-turn beat (c = 1…3); the best per page is
      // banked before the checkpoint below, whose flushSaveNow carries it.
      roomForRibbon()
      fx.value?.stars(e.c)
      recordStars(g.book, e.a as PageId, e.c)
      {
        // New stars may unlock a paper cosmetic (roadmap #6): the wordless card follows the ribbon.
        const fresh = unlockCosmetics()
        if (fresh.length > 0) fx.value?.unlocked(fresh)
      }
      bankStats(g)
      bankScore(g.score, g.book)
      // The kindness memory (streak, boss ease) first: the checkpoint keeps it.
      saveKindness(g.kind)
      // Resume on the *next* page with everything banked so far.
      checkpoint(
        Math.min(PAGE_COUNT, e.a + 1) as PageId, { score: g.score, hits: g.runHits, time: g.runTime },
        Math.max(g.pagesCleared, e.a), g.book
      )
      break
    case 'lesson':
      if (e.b === 0) {
        const id = LESSON_IDS[e.a] as LessonId | undefined
        if (id) learnLesson(id)
      }
      break
    case 'shelfBook':
      // Opened from the desk bookshelf: another book starts on page 1 (the current one just carries on).
      // From a rush, the story's own book goes back to its saved page.
      if (g.rushing && e.a === savedBook()) backToStory()
      else if (e.b === 0) pickBook(e.a as BookId)
      break
    case 'secret': {
      // First find ever (b = 1): saved at once. A replay is only the little show.
      const id = SECRET_IDS[e.a]
      if (e.b === 1 && id) recordSecret(id)
      break
    }
    case 'night':
      // The desk lamp: night mode is a cosmetic setting, kept with the others.
      if (foldSettings.value.night !== (e.a === 1)) {
        setFoldSetting('night', e.a === 1)
        // A tap on a lamp is rare and deliberate: keep it even if the tab closes right after.
        void flushSaveNow()
      }
      break
    case 'rushStart':
      hud.rush = true
      hud.rushDone = false
      hud.victory = false
      hud.retry = false
      hud.rushTenths = 0
      hud.rushPar = e.b
      hud.rushBest = rushBestOf(e.a as BookId)
      fx.value?.clearStars()
      fx.value?.clearAlmost()
      // The rush's own stats are never banked; the next story run counts from zero.
      statsBase = zeroBase()
      break
    case 'rushDone': {
      const res = recordRush(e.a as BookId, e.b, e.c)
      hud.rushTime = res.time
      hud.rushTenths = Math.round(res.time * 10)
      hud.rushBest = res.best
      hud.rushNewBest = res.newBest
      hud.rushDone = true
      break
    }
    case 'victory': {
      bankStats(g)
      hud.book = g.book
      const res = recordVictory(g.score, g.runTime, g.book)
      hud.victoryScore = g.score
      hud.victoryTime = g.runTime
      hud.victoryHits = g.runHits
      hud.newBest = res.newBest
      hud.victory = true
      break
    }
    case 'crumple':
      // A defeat (b = 1): remember it for the kind book (never in a rush), and show how close it was.
      if (e.b === 1) {
        if (!g.rushing) saveKindness(g.kind)
        fx.value?.almost(e.a, e.c === 1)
      }
      break
    case 'pageDrop':
      hud.hp = g.hero.hp
      hud.retry = false
      fx.value?.clearAlmost()
      break
  }
}

/**
 * The star ribbon hangs between the HUD strip and whatever is under it; on a
 * short landscape screen that is the desk bookshelf right of the book, so the
 * ribbon gets `--ribbon-room` (px from the HUD's bottom to the shelf's top) to
 * size itself into (roadmap #1, #2).
 */
const roomForRibbon = (): void => {
  const eng = engine.value
  const el = stage.value
  if (!eng || !el) return
  const top = eng.shelfTop()
  if (!Number.isFinite(top)) {
    el.style.removeProperty('--ribbon-room')
    return
  }
  const hudPx = (hudTop.value?.getBoundingClientRect().bottom ?? 0) - el.getBoundingClientRect().top
  el.style.setProperty('--ribbon-room', `${Math.max(0, Math.round(top - hudPx))}px`)
}

const word = (key: string, x: number, y: number, size: number, tone: string): void => {
  const g = engine.value?.game
  fx.value?.word(key, x, y, size, tone, { n: g?.combo ?? 0 })
}

/** The storybook line printed on each page (`fold.story.b<book>p<page>`). */
const caption = (def: PageDef): string => t(`fold.story.b${def.book}p${def.id}`)

let interactive = false
const onFrame = (g: FoldGame): void => {
  if (!interactive) {
    // The first frame is on screen and the canvas listens: boot telemetry's boot_ms.
    interactive = true
    markInteractive()
  }
  if (hud.score !== g.score) hud.score = g.score
  if (g.rush.running) {
    const tenths = Math.floor(g.rush.time * 10)
    if (hud.rushTenths !== tenths) hud.rushTenths = tenths
  }
  if (hud.hp !== g.hero.hp) hud.hp = g.hero.hp
  const retry = g.phase === 'crumple' && g.defeated && g.phaseTime >= ALMOST.button
  if (hud.retry !== retry) hud.retry = retry
  if (hud.boss) {
    const broken = brokenCount(g.boss)
    if (hud.bossBroken !== broken) hud.bossBroken = broken
    const exp = g.boss.exposed >= 0
    if (hud.bossExposed !== exp) hud.bossExposed = exp
  }
  const s = g.shelf
  const btn = s.available && !s.inView
  if (hud.shelfButton !== btn) hud.shelfButton = btn
  if (hud.shelfOpen !== s.open) hud.shelfOpen = s.open
  const cue = g.lesson.id === 'shelf' && g.lesson.hand.anchor === 'zoom'
  if (hud.shelfCue !== cue) hud.shelfCue = cue
  const eng = engine.value
  if (eng && ghost.value) ghost.value.update(g.lesson, projectFn, anchorFn)
}

const projectFn = (x: number, y: number, z: number, out: ScreenPoint): ScreenPoint =>
  engine.value ? engine.value.project(x, y, z, out) : out
/** Screen centre of a HUD target the ghost hand points at (the shelf zoom button). */
const anchorFn = (_name: 'zoom', out: ScreenPoint): boolean => {
  const el = (shelfBtn.value?.$el as HTMLElement | undefined) ?? null
  const host = stage.value
  if (!el || !host) return false
  const r = el.getBoundingClientRect()
  const o = host.getBoundingClientRect()
  out.x = r.left - o.left + r.width * 0.5
  out.y = r.top - o.top + r.height * 0.6
  out.visible = true
  return true
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
  // Overlays that share the screen with the HUD (the victory ribbon) start below it.
  el.style.setProperty('--hud-h', `${Math.max(0, Math.round(topPx))}px`)
  eng.resize(w, h, {
    top: Math.min(0.24, Math.max(0.06, (topPx + 6) / Math.max(1, h))),
    bottom: 0.02,
    side: 0.015
  })
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

const learnedMap = (): Partial<Record<LessonId, boolean>> => ({ ...lessons.value })

const bootPage = (): { page: PageId; score: number; book: BookId } => {
  const page = resumePage.value
  // A bookmark in a book that isn't unlocked (a hand-edited or torn save) falls back to book 1.
  const book: BookId = savedBook()
  const score = page > 1 ? runCheckpoint.value?.score ?? 0 : 0
  return { page, score, book }
}

onMounted(() => {
  const c = canvas.value
  if (!c) return
  bootStage(BOOT.scene)
  const { page, score, book } = bootPage()
  if (page === 1) startNewRun(book)
  // Stars earned before this build (or on another device) unlock their cosmetics quietly.
  unlockCosmetics()
  const eng = markRaw(new FoldEngine(
    c, { onEvent, word, onFrame, caption, onFirstInput: markFirstInput },
    {
      learned: learnedMap(), startPage: page, startScore: score, book, kind: readKindness(),
      secrets: secretsFound.value, night: foldSettings.value.night, look: { ...look.value }
    }
  ))
  engine.value = eng
  eng.attach()
  eng.setVolumes(userSoundVolume.value, userMusicVolume.value)
  applySettings(eng, foldSettings.value)
  hud.book = book
  hud.page = page
  hud.score = score
  ro = new ResizeObserver(layout)
  if (stage.value) ro.observe(stage.value)
  if (hudTop.value) ro.observe(hudTop.value)
  layout()
  bootStage(BOOT.engine)
  eng.setShelfProgress(shelfProgress())
  publishDebugHandle(eng)
  // Behind the splash: build page 1 and compile its shaders (without blocking
  // where the GPU allows), then start the loop (roadmap #13).
  void eng.prewarm().then(({ ms, parallel }) => {
    if (engine.value !== eng) return
    markPrecompiled(ms, parallel)
    eng.start()
    // Two frames later the first page is on screen: the splash may go.
    requestAnimationFrame(() => requestAnimationFrame(() => markGameReady()))
  })
  // The printed story lines use the Angry font: repaint once it has loaded.
  void document.fonts?.load('40px Angry').then(() => engine.value?.refreshCaptions()).catch(() => undefined)
})

watch(locale, () => engine.value?.refreshCaptions())
// An equip on the settings face, the seasonal switch, or a cloud hydrate: the engine repaints without a hitch.
watch(look, (l) => engine.value?.setLook({ ...l }))
// The shelf shows the saved progress (wins unlock books, stars go on the spines).
watch([wins, wins2, wins3, pagesCleared, pagesCleared2, pagesCleared3, pageStars, rushBest], () => engine.value?.setShelfProgress(shelfProgress()))

onBeforeUnmount(() => {
  ro?.disconnect()
  engine.value?.dispose()
  engine.value = null
  syncGameplayLifecycle(false)
  delete (window as unknown as { __fold?: unknown }).__fold
})

// ─── Settings & pause ────────────────────────────────────────────────────────

watch([userSoundVolume, userMusicVolume], ([s, m]) => engine.value?.setVolumes(s, m))
const applySettings = (eng: FoldEngine, s: FoldSettings): void => {
  eng.setQuality(s.quality)
  eng.setShake(s.shake)
  eng.setHaptics(s.haptics)
  eng.setHoldToFold(s.holdToFold)
  eng.setSlowMode(s.slowMode)
  eng.setHighlightMode(s.highlightMode)
  eng.setNight(s.night)
}
watch(foldSettings, (s) => {
  const eng = engine.value
  if (eng) applySettings(eng, s)
})

const paused = computed(() => pauseOpen.value || isGamePaused.value)
watch(paused, (p) => engine.value?.setPaused(p))
// Platform "gameplay" signal: live while the player is actually playing.
const live = computed(() => !paused.value && !hud.victory && !hud.shelfOpen && !hud.rushDone)
watch(live, (v) => syncGameplayLifecycle(v), { immediate: true })

const openPause = (): void => {
  pauseOpen.value = true
}
/** The HUD's zoom button: out to the desk bookshelf and back. */
const toggleShelf = (): void => {
  engine.value?.toggleShelf()
}
const resume = (): void => {
  pauseOpen.value = false
}
const restartPage = (): void => {
  pauseOpen.value = false
  engine.value?.restartPage()
}
/** The Almost! moment's Try again: the page drops straight back. */
const tryAgain = (): void => {
  if (engine.value?.tryAgain()) hud.retry = false
}
/** Start a book from its first page (restart, play again, or a pick from the shelf). */
const openBook = (book: BookId): void => {
  pauseOpen.value = false
  hud.victory = false
  fx.value?.clearStars()
  startNewRun(book)
  statsBase = zeroBase()
  engine.value?.newRun(book)
}
const newGame = (): void => openBook(hud.book)

// ─── Dragon Rush (roadmap #16) ───────────────────────────────────────────────


/** A book's Dragon Rush (the victory card's button; the shelf figurine starts it inside the game). */
const startRush = (book: BookId): void => {
  pauseOpen.value = false
  hud.victory = false
  fx.value?.clearStars()
  engine.value?.startRush(book)
}
const rushAgain = (): void => {
  hud.rushDone = false
  engine.value?.restartRush()
}
/** Leave the rush: the story reopens on its saved page, exactly as the save has it. */
const backToStory = (): void => {
  const eng = engine.value
  if (!eng) return
  hud.rushDone = false
  hud.rush = false
  pauseOpen.value = false
  statsBase = zeroBase()
  const page = resumePage.value
  eng.jumpTo(page, page > 1 ? runCheckpoint.value?.score ?? 0 : 0, savedBook())
}
const playAgain = (): void => openBook(hud.book)
const pickBook = (book: BookId): void => {
  if (!bookUnlocked(book)) return
  hud.rushDone = false
  openBook(book)
}

const onKey = (e: KeyboardEvent): void => {
  if (pauseOpen.value) return
  if (e.key === 'Escape' && engine.value?.closeShelf()) {
    e.preventDefault()
    return
  }
  if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
    e.preventDefault()
    openPause()
  } else if (e.key === 'Enter' && hud.victory) {
    playAgain()
  } else if (e.key === 'Enter' && hud.rushDone) {
    rushAgain()
  } else if ((e.key === 'Enter' || e.key === ' ') && hud.retry) {
    e.preventDefault()
    tryAgain()
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
  // Secrets found on another device count here too (a replay never pays twice).
  eng.setSecretsFound(secretsFound.value)
  // …and stars from there unlock their cosmetics (quietly).
  unlockCosmetics()
  const saved = resumePage.value
  const book: BookId = savedBook()
  const early = g.book === 1 && g.pageId === 1 && g.runTime < 90 && g.pagesCleared === 0
  if (early && (saved > g.pageId || book !== g.book)) {
    // The restored run's kindness memory comes with it (in place: the game holds this object).
    Object.assign(g.kind, readKindness())
    eng.jumpTo(saved, runCheckpoint.value?.score ?? 0, book)
  }
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
    jumpTo: (p: number, book?: number) =>
      eng.jumpTo(Math.max(1, Math.min(PAGE_COUNT, p)) as PageId, eng.game.score, isBookId(book) ? book : eng.game.book),
    clearPage: () => eng.game.debugClearPage(),
    /** The desk bookshelf: toggle it, and where a slot's spine is on screen. */
    toggleShelf: () => eng.toggleShelf(),
    shelfScreen: (slot: number) => {
      const out = { x: 0, y: 0, visible: false }
      eng.shelfScreen(slot, out)
      return { x: out.x, y: out.y }
    },
    tryAgain: () => eng.tryAgain(),
    /** Dragon Rush (roadmap #16) and the page secrets (roadmap #15). */
    startRush: (book: number) => eng.startRush(asBookId(book)),
    lampScreen: () => {
      const out = { x: 0, y: 0, visible: false }
      eng.lampScreen(out)
      return { x: out.x, y: out.y }
    },
    /** Screen point of this page's tap secret's target, as it appears (tests). */
    secretScreen: () => {
      const s = eng.game.secrets
      const out = { x: 0, y: 0, visible: false }
      eng.project(s.spotX, 0, s.spotZ, out)
      return { x: out.x, y: out.y }
    },
    /** Boot telemetry (roadmap #13): boot_ms, first_input_ms, precompile and stage times, and the atlas paints. */
    boot: () => ({ ...bootSnapshot(), paint: { ...eng.view.paintMs } }),
    /** Looks (roadmaps #6, #17): force a season ('halloween' | 'winter' | 'none', or null for the date's), equip an owned cosmetic, read what is shown. */
    setSeason: (s: string | null) => {
      seasonOverride.value = s === null ? null : parseSeason(s)
      return look.value.season
    },
    equip: (id: string) => equipCosmetic(id),
    look: () => ({
      want: { ...eng.view.currentLook }, page: eng.view.printedLook, bats: eng.view.bats.group.visible, confetti: eng.view.effects.confettiShape,
      snow: eng.view.snow.visible, snowFlakes: eng.view.snow.count
    }),
    fastForward: (s: number) => eng.fastForward(s),
    state: () => ({
      book: eng.game.book,
      page: eng.game.pageId,
      phase: eng.game.phase,
      score: eng.game.score,
      hp: eng.game.hero.hp,
      lesson: eng.game.lesson.id,
      timeScale: eng.game.timeScale,
      folds: eng.game.folds.map((f) => ({ id: f.def.id, kind: f.def.kind, phase: f.phase, t: f.t })),
      enemies: eng.game.aliveCount(),
      enemiesLeft: eng.game.enemiesLeft(),
      difficulty: eng.game.difficulty,
      mode: eng.game.mode,
      rush: { time: eng.game.rush.time, par: eng.game.rush.par, done: eng.game.rush.done, attempts: eng.game.rush.attempts },
      secrets: { found: eng.game.secretsFound(), night: eng.game.secrets.night, page: eng.game.secrets.def?.id ?? null },
      boss: eng.game.boss.phase,
      sling: eng.game.sling ? { x: eng.game.sling.def.x, z: eng.game.sling.def.z, cool: eng.game.sling.cool, shots: eng.game.sling.shots } : null,
      shelf: {
        available: eng.game.shelf.available,
        inView: eng.game.shelf.inView,
        open: eng.game.shelf.open,
        selected: eng.game.shelf.selected,
        highlight: eng.game.shelf.highlight,
        slots: eng.game.shelf.slots.filter((s) => s.kind === 'book').map((s) => s.state),
        rush: eng.game.shelf.slots.filter((s) => s.kind === 'rush').map((s) => s.state),
        camera: eng.view.desk.shelfK
      }
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
    GhostHand(ref="ghost" :touch="isTouch" :hold="foldSettings.holdToFold")

    //- ── HUD ──
    div.hud-top(ref="hudTop")
      div.hud-left.flex.flex-col.items-start
        PageBadge(:page="hud.page" :total="PAGE_COUNT" :name-key="nameKey" :boss="hud.boss" :book="hud.book")
        HeartsBadge(:hp="hud.hp" :max="hud.maxHp")
      div.hud-centre.flex.flex-col.items-center
        RushClock(v-if="hud.rush" :tenths="hud.rushTenths" :par="hud.rushPar" :best="hud.rushBest")
        ScoreBadge(v-else :score="hud.score" :best="best")
        BossMeter(v-if="hud.boss" :total="5" :broken="hud.bossBroken" :exposed="hud.bossExposed" :kraken="hud.book === 3")
      div.hud-right
        div.hud-right__row.flex.items-start
          FMuteButton
          FHudButton(tone="gold" :aria-label="t('fold.hud.settings')" @click="openPause")
            OrigamiIcon(name="gear" tone="yellow")
        //- Out to the desk bookshelf and back (only where the camera can't already see it).
        FHudButton.hud-shelf(
          v-if="hud.shelfButton"
          ref="shelfBtn"
          tone="blue"
          data-testid="shelf-zoom"
          :attention="hud.shelfCue"
          :aria-label="t(hud.shelfOpen ? 'fold.hud.backToBook' : 'fold.hud.shelf')"
          @click="toggleShelf"
        )
          OrigamiIcon(:name="hud.shelfOpen ? 'book' : 'shelf'" :tone="hud.shelfOpen ? 'paper' : 'blue'")

    VictoryPanel(
      :open="hud.victory && !hud.shelfOpen"
      :book="hud.book"
      :score="hud.victoryScore"
      :best="best"
      :time="hud.victoryTime"
      :hits="hud.victoryHits"
      :new-best="hud.newBest"
      @again="playAgain"
      @book="pickBook"
      @rush="startRush"
    )

    RushResult(
      :open="hud.rushDone && !hud.shelfOpen && !pauseOpen"
      :book="hud.book"
      :time="hud.rushTime"
      :par="hud.rushPar"
      :best="hud.rushBest"
      :new-best="hud.rushNewBest"
      @again="rushAgain"
      @back="backToStory"
    )

    AlmostRetry(:open="hud.retry && !pauseOpen" @retry="tryAgain")

    CootieCatcherPause(
      :open="pauseOpen"
      :book="hud.book"
      :unlocked="openBooks"
      @resume="resume"
      @restart-page="restartPage"
      @new-game="newGame"
      @pick-book="pickBook"
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
  // Children (page badge, hearts) are clamped to the column, never past it.
  > *
    max-width: 100%

.hud-centre
  gap: clamp(0.2rem, 0.9vh, 0.4rem)

.hud-right
  justify-self: end
  display: flex
  flex-direction: column
  align-items: flex-end
  gap: clamp(0.25rem, 1vh, 0.45rem)
  min-width: 0

.hud-right__row
  gap: clamp(0.3rem, 1.4vw, 0.55rem)

// Landscape phones: keep the top strip thin so the page stays big.
@media (max-height: 520px) and (orientation: landscape)
  .hud-left
    flex-direction: row
    align-items: center
</style>
