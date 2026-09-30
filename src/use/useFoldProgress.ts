import { ref, watch, type Ref } from 'vue'
import {
  BEST2_KEY, BEST_KEY, BOOK_KEY, CLEARED2_KEY, CLEARED_KEY, LESSONS_KEY, PAGE_KEY, RUN_KEY, RUNS_KEY, RUSH_KEY,
  SECRETS_KEY, SETTINGS_KEY, STARS_KEY, STATS_KEY, WINS2_KEY, WINS_KEY
} from '@/keys'
import { aethelState, getState, setState, setStates } from '@/use/useAethelState'
import { saveDataVersion, flushSaveNow } from '@/use/useSaveStatus'
import { HIGHLIGHT_MODES, type BookId, type HighlightMode, type LessonId, type PageId, type Stars } from '@/fold/logic/types'
import { PAGE_COUNT, pageDef } from '@/fold/logic/pages'
import { asStars, isRated, readStarRecord, starKey } from '@/fold/logic/stars'
import { emptyStats, type GameStats } from '@/fold/logic/game'
import { type KindMemory, readKindMemory } from '@/fold/logic/difficulty'
import { bookUnlockedBy, type ShelfProgress } from '@/fold/logic/shelf'
import { SECRET_TOTAL, countFound, readSecretList, secretsInBook, type SecretId } from '@/fold/logic/secrets'
import { readRushRecord, rushKey, rushResult, type RushRecord, type RushResult } from '@/fold/logic/rush'

/**
 * Aethel Fold progress — a module-level singleton view over the fields of
 * `aethel_state` that belong to the game (see `src/keys.ts`).
 *
 * Every ref here is re-read whenever the blob is replaced (`aethelState`
 * identity change) and whenever a cloud hydrate lands (`saveDataVersion`), so
 * a player whose SDK save arrives late is never left playing as a fresh user.
 */

export type Quality = 'auto' | 'high' | 'low'

export interface FoldSettings {
  haptics: boolean
  shake: boolean
  quality: Quality
  /** Accessibility (roadmap #14): press and hold on a fold instead of swiping. */
  holdToFold: boolean
  /** Accessibility: the world runs at 0.75× (the player's folds don't). */
  slowMode: boolean
  /** Accessibility: how actionable things are marked. */
  highlightMode: HighlightMode
  /** Night mode — the desk lamp's secret (roadmap #15). Cosmetic: the lamp's pool on a periwinkle desk. */
  night: boolean
}

export interface RunCheckpoint {
  score: number
  hits: number
  time: number
  /**
   * "The book is kind" memory (roadmap #8), stored inside `fold_run` and only
   * when it carries something: crumples per page this run (`b1p3: 2`), the
   * perfect-page streak, and the sticky boss ease.
   */
  crumples?: Record<string, number>
  streak?: number
  bossEase?: boolean
}

export interface Records {
  score: number
  /** Fastest full run in seconds (0 = never won). */
  time: number
}

const DEFAULT_SETTINGS: FoldSettings = {
  haptics: true, shake: true, quality: 'auto', holdToFold: false, slowMode: false, highlightMode: 'standard', night: false
}

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : fallback
}

const asPage = (v: unknown): PageId => {
  const n = Math.round(num(v, 1))
  return (n >= 1 && n <= 6 ? n : 1) as PageId
}

const obj = <T extends object>(v: unknown, fallback: T): T =>
  v && typeof v === 'object' && !Array.isArray(v) ? { ...fallback, ...(v as Partial<T>) } : { ...fallback }

const asBook = (v: unknown): BookId => (Math.round(num(v, 1)) === 2 ? 2 : 1)

const readSettings = (): FoldSettings => {
  const s = obj<FoldSettings>(getState(SETTINGS_KEY), DEFAULT_SETTINGS)
  if (s.quality !== 'auto' && s.quality !== 'high' && s.quality !== 'low') s.quality = 'auto'
  s.haptics = s.haptics !== false
  s.shake = s.shake !== false
  s.holdToFold = s.holdToFold === true
  s.slowMode = s.slowMode === true
  if (!HIGHLIGHT_MODES.includes(s.highlightMode)) s.highlightMode = 'standard'
  s.night = s.night === true
  return s
}

/** The kindness fields of a `fold_run`, omitting the defaults so plain checkpoints stay `{ score, hits, time }`. */
const kindFields = (mem: KindMemory): Pick<RunCheckpoint, 'crumples' | 'streak' | 'bossEase'> => {
  const out: Pick<RunCheckpoint, 'crumples' | 'streak' | 'bossEase'> = {}
  if (Object.keys(mem.crumples).length > 0) out.crumples = { ...mem.crumples }
  if (mem.streak > 0) out.streak = mem.streak
  if (mem.bossEase) out.bossEase = true
  return out
}

const readCheckpoint = (): RunCheckpoint | null => {
  const v = getState<unknown>(RUN_KEY)
  if (!v || typeof v !== 'object') return null
  const r = v as Partial<RunCheckpoint>
  return {
    score: Math.max(0, num(r.score)), hits: Math.max(0, num(r.hits)), time: Math.max(0, num(r.time)),
    ...kindFields(readKindMemory(v))
  }
}

/** The persisted kindness memory (a fresh object: the game mutates its own copy). */
export const readKindness = (): KindMemory => readKindMemory(getState<unknown>(RUN_KEY))

/** Kindness that outlives a run: the streak and the boss ease stay, the crumples go. */
const carryKindness = (): Pick<RunCheckpoint, 'streak' | 'bossEase'> => {
  const { streak, bossEase } = kindFields(readKindness())
  return { ...(streak ? { streak } : {}), ...(bossEase ? { bossEase } : {}) }
}

const readCleared = (key: string): number => Math.max(0, Math.min(6, num(getState(key))))

export const resumePage: Ref<PageId> = ref(asPage(getState(PAGE_KEY)))
/** The book `resumePage` belongs to. */
export const resumeBook: Ref<BookId> = ref(asBook(getState(BOOK_KEY)))
export const pagesCleared: Ref<number> = ref(readCleared(CLEARED_KEY))
export const records: Ref<Records> = ref(obj<Records>(getState(BEST_KEY), { score: 0, time: 0 }))
export const wins: Ref<number> = ref(num(getState(WINS_KEY)))
/** Book 2 ("The Homefront") progress. */
export const pagesCleared2: Ref<number> = ref(readCleared(CLEARED2_KEY))
export const records2: Ref<Records> = ref(obj<Records>(getState(BEST2_KEY), { score: 0, time: 0 }))
export const wins2: Ref<number> = ref(num(getState(WINS2_KEY)))
export const runs: Ref<number> = ref(num(getState(RUNS_KEY)))
export const lessons: Ref<Partial<Record<LessonId, boolean>>> = ref(obj(getState(LESSONS_KEY), {}))
export const lifetime: Ref<GameStats> = ref(obj<GameStats>(getState(STATS_KEY), emptyStats()))
export const foldSettings: Ref<FoldSettings> = ref(readSettings())
export const runCheckpoint: Ref<RunCheckpoint | null> = ref(readCheckpoint())
/** Best origami stars per page (roadmap #1), keyed `b<book>p<page>`. */
export const pageStars: Ref<Record<string, Stars>> = ref(readStarRecord(getState(STARS_KEY)))
/** Page secrets found (roadmap #15), in `SECRETS` order. */
export const secretsFound: Ref<SecretId[]> = ref(readSecretList(getState(SECRETS_KEY)))
/** Dragon Rush best times (roadmap #16), `b<book>` → seconds. */
export const rushBest: Ref<RushRecord> = ref(readRushRecord(getState(RUSH_KEY)))
/** Bumped when a cloud hydrate replaced the progress under a running game. */
export const progressRevision = ref(0)

const refresh = (): void => {
  resumePage.value = asPage(getState(PAGE_KEY))
  resumeBook.value = asBook(getState(BOOK_KEY))
  pagesCleared.value = readCleared(CLEARED_KEY)
  records.value = obj<Records>(getState(BEST_KEY), { score: 0, time: 0 })
  wins.value = num(getState(WINS_KEY))
  pagesCleared2.value = readCleared(CLEARED2_KEY)
  records2.value = obj<Records>(getState(BEST2_KEY), { score: 0, time: 0 })
  wins2.value = num(getState(WINS2_KEY))
  runs.value = num(getState(RUNS_KEY))
  lessons.value = obj(getState(LESSONS_KEY), {})
  lifetime.value = obj<GameStats>(getState(STATS_KEY), emptyStats())
  foldSettings.value = readSettings()
  runCheckpoint.value = readCheckpoint()
  pageStars.value = readStarRecord(getState(STARS_KEY))
  secretsFound.value = readSecretList(getState(SECRETS_KEY))
  rushBest.value = readRushRecord(getState(RUSH_KEY))
}

watch(aethelState, refresh, { deep: false })
watch(saveDataVersion, () => {
  refresh()
  progressRevision.value++
})

/** Is there anything worth resuming (a run past page 1)? */
export const hasProgress = (): boolean =>
  resumePage.value > 1 || resumeBook.value > 1 || pagesCleared.value > 0 || wins.value > 0 || pagesCleared2.value > 0

/** Book n opens once book n − 1 has been won (the rule lives in `logic/shelf.ts`). */
export const bookUnlocked = (book: BookId): boolean =>
  bookUnlockedBy(book, [wins.value, wins2.value], [pagesCleared.value, pagesCleared2.value])

/** Records for a book. */
export const recordsFor = (book: BookId): Records => (book === 2 ? records2.value : records.value)

const bookKeys = (book: BookId) => book === 2
  ? { cleared: CLEARED2_KEY, best: BEST2_KEY, wins: WINS2_KEY, clearedRef: pagesCleared2, bestRef: records2, winsRef: wins2 }
  : { cleared: CLEARED_KEY, best: BEST_KEY, wins: WINS_KEY, clearedRef: pagesCleared, bestRef: records, winsRef: wins }

// ─── Writers ───────────────────────────────────────────────────────────────

/** A new run starts on page 1 of a book. */
export const startNewRun = (book: BookId = resumeBook.value): void => {
  setStates({
    [PAGE_KEY]: 1,
    [BOOK_KEY]: book,
    [RUN_KEY]: { score: 0, hits: 0, time: 0, ...carryKindness() },
    [RUNS_KEY]: runs.value + 1
  })
}

/**
 * Checkpoint at the start of a page: a reload resumes here with this score.
 * `cleared` is the highest page finished so far.
 */
export const checkpoint = (page: PageId, run: RunCheckpoint, cleared: number, book: BookId = 1): void => {
  const k = bookKeys(book)
  setStates({
    [PAGE_KEY]: page,
    [BOOK_KEY]: book,
    [RUN_KEY]: {
      score: Math.round(run.score), hits: run.hits, time: Math.round(run.time * 10) / 10,
      ...kindFields(readKindness())
    },
    [k.cleared]: Math.max(k.clearedRef.value, Math.min(6, cleared))
  })
  // A hard checkpoint: don't wait for the debounce, or a tab closed right after
  // a page turn resumes one page too early.
  void flushSaveNow()
}

/**
 * Store the game's kindness memory into `fold_run` (after a crumple or a
 * cleared page), keeping the run checkpoint beside it untouched.
 */
export const saveKindness = (mem: KindMemory): void => {
  const v = getState<unknown>(RUN_KEY)
  const base = v && typeof v === 'object' ? (v as Partial<RunCheckpoint>) : {}
  setState(RUN_KEY, {
    score: Math.max(0, num(base.score)), hits: Math.max(0, num(base.hits)), time: Math.max(0, num(base.time)),
    ...kindFields(mem)
  })
}

export const learnLesson = (id: LessonId): void => {
  if (lessons.value[id]) return
  setState(LESSONS_KEY, { ...lessons.value, [id]: true })
}

export const addStats = (delta: Partial<GameStats>): void => {
  const next = { ...lifetime.value }
  let changed = false
  for (const [k, v] of Object.entries(delta)) {
    if (typeof v !== 'number' || v === 0) continue
    const key = k as keyof GameStats
    next[key] = (next[key] ?? 0) + v
    changed = true
  }
  if (changed) setState(STATS_KEY, next)
}

/**
 * The book is won: bank its records and reset the resume point. Winning book 1
 * moves the bookmark on to book 2 (which it unlocks); winning book 2 keeps it
 * there. The victory panel lets the player pick either book next.
 */
export const recordVictory = (score: number, time: number, book: BookId = 1): { newBest: boolean; newFastest: boolean } => {
  const k = bookKeys(book)
  const r = k.bestRef.value
  const newBest = score > r.score
  const newFastest = time > 0 && (r.time === 0 || time < r.time)
  setStates({
    [k.best]: { score: Math.max(r.score, Math.round(score)), time: newFastest ? Math.round(time * 10) / 10 : r.time },
    [k.wins]: k.winsRef.value + 1,
    [k.cleared]: 6,
    [PAGE_KEY]: 1,
    [BOOK_KEY]: 2,
    [RUN_KEY]: { score: 0, hits: 0, time: 0, ...carryKindness() }
  })
  void flushSaveNow()
  return { newBest, newFastest }
}

/** Keep the best score even for runs that never finish. */
export const bankScore = (score: number, book: BookId = 1): void => {
  const k = bookKeys(book)
  if (score <= k.bestRef.value.score) return
  setState(k.best, { ...k.bestRef.value, score: Math.round(score) })
}

// ─── Stars (roadmap #1) ───────────────────────────────────────────────────

/** Best stars ever earned on one page (0 = never cleared). */
export const starsOf = (book: BookId, page: PageId): Stars => pageStars.value[starKey(book, page)] ?? 0

export interface BookStars {
  /** Best stars per rated page, in page order (the finale is unrated and left out). */
  pages: Stars[]
  earned: number
  /** 3 × rated pages. */
  max: number
}

/**
 * A book's stars for the shelf, pause bookshelf and victory card. Reads
 * `pageStars`, so it is reactive inside a `computed`. Allocates: UI only.
 */
export const starsForBook = (book: BookId): BookStars => {
  const pages: Stars[] = []
  let earned = 0
  for (let p = 1; p <= PAGE_COUNT; p++) {
    const id = p as PageId
    if (!isRated(pageDef(book, id))) continue
    const s = starsOf(book, id)
    pages.push(s)
    earned += s
  }
  return { pages, earned, max: pages.length * 3 }
}

/**
 * Everything the desk bookshelf (roadmap #2) shows, one entry per book. Reads
 * the refs, so it is reactive inside a `watch`. Allocates: UI only.
 */
export const shelfProgress = (): ShelfProgress => ({
  wins: [wins.value, wins2.value],
  cleared: [pagesCleared.value, pagesCleared2.value],
  stars: [starsForBook(1).pages, starsForBook(2).pages],
  rush: [rushBestOf(1), rushBestOf(2)]
})

/** Stars over every book. */
export const totalStars = (): { earned: number; max: number } => {
  const a = starsForBook(1)
  const b = starsForBook(2)
  return { earned: a.earned + b.earned, max: a.max + b.max }
}

/**
 * Bank a cleared page's stars. Only ever raises a page's best; returns true
 * when it did (a new best). Call it before the page-clear `checkpoint`, whose
 * `flushSaveNow` then carries the stars to the cloud with the rest.
 */
export const recordStars = (book: BookId, page: PageId, stars: number): boolean => {
  const s = asStars(stars)
  if (s <= starsOf(book, page)) return false
  const next = { ...pageStars.value, [starKey(book, page)]: s }
  // Mirror at once (the aethelState watcher runs a tick later), so two clears in one tick both count.
  pageStars.value = next
  setState(STARS_KEY, next)
  return true
}

// ─── Page secrets (roadmap #15) ────────────────────────────────────────────

/**
 * Bank a secret found for the first time. Returns true when it is new. The
 * save is flushed at once: a secret is rare, and finding one is a moment the
 * player remembers — it must not vanish with a closed tab.
 */
export const recordSecret = (id: SecretId): boolean => {
  if (secretsFound.value.includes(id)) return false
  const next = readSecretList([...secretsFound.value, id])
  // Mirror at once (the aethelState watcher runs a tick later).
  secretsFound.value = next
  setState(SECRETS_KEY, next)
  void flushSaveNow()
  return true
}

/** Secrets found, over every book or in one, and how many there are. Reactive inside a `computed`. */
export const secretCount = (book?: BookId): { found: number; total: number } => ({
  found: countFound(secretsFound.value, book),
  total: book === undefined ? SECRET_TOTAL : secretsInBook(book)
})

// ─── Dragon Rush (roadmap #16) ─────────────────────────────────────────────

/** A book's best rush time, seconds (0 = never finished). */
export const rushBestOf = (book: BookId): number => rushBest.value[rushKey(book)] ?? 0

/**
 * A finished rush: compare with the par and the saved best, keep a faster
 * time. A new best is a hard checkpoint (`flushSaveNow`).
 */
export const recordRush = (book: BookId, time: number, par: number): RushResult => {
  const res = rushResult(time, par, rushBestOf(book))
  if (res.newBest) {
    const next = { ...rushBest.value, [rushKey(book)]: res.time }
    rushBest.value = next
    setState(RUSH_KEY, next)
    void flushSaveNow()
  }
  return res
}

export const setFoldSetting = <K extends keyof FoldSettings>(key: K, value: FoldSettings[K]): void => {
  setState(SETTINGS_KEY, { ...foldSettings.value, [key]: value })
}

export { flushSaveNow }
