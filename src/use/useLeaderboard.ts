import { ref, computed, type ComputedRef, type Ref } from 'vue'
import { getState, setState, flushPersist } from '@/use/useTowerState'
import { SUBMITTED_SCORE_KEY, POSTED_NAME_KEY } from '@/keys'
import { resolveIdentity } from '@/use/usePlayerIdentity'
import { submitNativeScore } from '@/use/useNativeLeaderboard'

/**
 * ─── Leaderboard client ─────────────────────────────────────────────────────
 *
 * Talks to the Cloudflare Worker in `worker/`. Every call is optional: if the
 * endpoint is unset, unreachable, slow or broken, the game carries on and the
 * death screen simply shows no rank. A leaderboard is a garnish — it may never
 * be able to block, delay or break a run.
 *
 * Two rules keep the free tier comfortable, and both are deliberate:
 *
 *   * **Read once.** The board is fetched when nothing is cached, and reused
 *     from memory afterwards. It is a top-100 of a game the player is playing,
 *     not a live feed — it does not need to be current to the second.
 *   * **Write only on a personal record.** Submitting every run would spend the
 *     scarce quota (writes) on rows that change nothing, since the table stores
 *     one personal best per player.
 */

/** Endpoint root, e.g. `https://aethel-fold-leaderboard.you.workers.dev`. */
const ENDPOINT = (import.meta.env.VITE_LEADERBOARD_URL ?? '').replace(/\/+$/, '')
/** Optional shared secret; must match the Worker's `SCORE_SECRET`. */
const SECRET = import.meta.env.VITE_LEADERBOARD_SECRET ?? ''

/** Whether this build has a board at all. */
export const leaderboardEnabled = ENDPOINT.length > 0

/** Give up rather than make the player wait behind a dead endpoint. */
const TIMEOUT_MS = 6000

export interface BoardEntry {
  rank: number
  name: string
  score: number
  wave: number
}

export interface Board {
  updatedAt: number
  total: number
  entries: BoardEntry[]
}

const board: Ref<Board | null> = ref(null)
const rank = ref(0)
const total = ref(0)
const pending = ref(false)
/** The score the server's `rank` was an answer to. */
const submittedScore = ref(0)
/** Set when the last attempt failed, so the UI can say "unavailable" once and
 *  not pretend the player is unranked. */
const failed = ref(false)

export const leaderboard: ComputedRef<Board | null> = computed(() => board.value)
export const playerRank: ComputedRef<number> = computed(() => rank.value)
export const playerTotal: ComputedRef<number> = computed(() => total.value)
export const leaderboardPending: ComputedRef<boolean> = computed(() => pending.value)
export const leaderboardFailed: ComputedRef<boolean> = computed(() => failed.value)

const withTimeout = async (input: string, init?: RequestInit): Promise<Response> => {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(input, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

const hmacHex = async (secret: string, message: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Remember the high-water mark across sessions, so the next run knows there is
 * nothing new to say. This is what keeps the write quota spent only on
 * improvements — for the Worker and the portal board alike.
 */
const rememberPosted = (score: number): void => {
  if (Number(getState<number>(SUBMITTED_SCORE_KEY, 0)) >= score) return
  setState(SUBMITTED_SCORE_KEY, score)
  flushPersist()
}

/** Fetch the table, but only if we do not already have one. */
export const ensureBoard = async (): Promise<void> => {
  if (!leaderboardEnabled || board.value || pending.value) return
  pending.value = true
  try {
    const res = await withTimeout(`${ENDPOINT}/top`)
    if (!res.ok) throw new Error(`status ${res.status}`)
    const data = (await res.json()) as Board
    if (Array.isArray(data?.entries)) {
      board.value = data
      total.value = data.total ?? data.entries.length
      failed.value = false
    }
  } catch {
    // Offline, blocked by CSP, endpoint down — all the same to the player.
    failed.value = true
  } finally {
    pending.value = false
  }
}

/**
 * Post a score and take the rank back.
 *
 * Only called for a personal record; see `reportRun`.
 */
export const submitScore = async (score: number, wave: number): Promise<void> => {
  if (!leaderboardEnabled || score <= 0) return
  pending.value = true
  try {
    const who = await resolveIdentity()
    const body: Record<string, unknown> = { id: who.id, name: who.name, score, wave }
    if (SECRET) body.sig = await hmacHex(SECRET, `${who.id}:${score}:${wave}`)

    const res = await withTimeout(`${ENDPOINT}/score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) throw new Error(`status ${res.status}`)
    const data = (await res.json()) as { rank: number; total: number; board: Board }
    rank.value = data.rank ?? 0
    submittedScore.value = score
    rememberPosted(score)
    if (getState<string>(POSTED_NAME_KEY, '') !== who.name) {
      setState(POSTED_NAME_KEY, who.name)
      flushPersist()
    }
    total.value = data.total ?? total.value
    // The POST already returns the rebuilt table, so a record costs one round
    // trip rather than a submit followed by a re-fetch.
    if (Array.isArray(data.board?.entries)) board.value = data.board
    failed.value = false
  } catch {
    failed.value = true
  } finally {
    pending.value = false
  }
}

/**
 * Rank for a score without asking the server.
 *
 * A run that is not a personal record never posts, so the server never tells us
 * where the player stands — and asking would spend the request the "submit only
 * on a record" rule exists to save. The cached table answers it for free
 * whenever the score is good enough to be IN that table.
 *
 * Returns the rank, `OUTSIDE_BOARD` for a score below the whole cached top-N
 * (position unknowable, but its bracket is), or 0 for "no idea yet".
 */
export const OUTSIDE_BOARD = -1

export const rankFor = (score: number): number => {
  // A rank we were TOLD beats one we inferred — but only for the score it was
  // an answer to. Reusing it for a later, weaker run would print that run's
  // score beside the standing of a much better one.
  if (rank.value > 0 && score >= submittedScore.value) return rank.value
  const entries = board.value?.entries
  if (!entries || entries.length === 0 || score <= 0) return 0
  const above = entries.filter((e) => e.score > score).length
  if (above >= entries.length) return OUTSIDE_BOARD
  return above + 1
}

/** How many entries the cached board holds — the "top N" the UI names. */
export const boardSize = (): number => board.value?.entries.length ?? 0

/**
 * What the death screen calls.
 *
 * `best` is the player's HIGHEST score ever, not this run's — the board holds
 * one personal best per player, so that is the only number worth sending, and
 * it is the number the rank must be computed from.
 *
 * A write happens when the best has moved past whatever this device last got
 * onto the board. That covers the obvious case (the run set a record) and the
 * one that is easy to miss: a cloud save arriving from another device with a
 * higher best, which would otherwise never be posted from here at all. Every
 * other run just reads the cached table.
 */
export const reportRun = async (best: number, wave: number): Promise<void> => {
  const posted = Number(getState<number>(SUBMITTED_SCORE_KEY, 0)) || 0
  const improved = best > posted

  // The portal's own board, where the platform has one. Independent of the
  // Worker: it is worth doing even on a build that ships without an endpoint,
  // and it must not be able to hold up or fail the custom submission.
  if (improved) void submitNativeScore(best)

  if (!leaderboardEnabled) {
    // On a build with no endpoint the portal board is the only one there is,
    // and nothing else would move the high-water mark it is gated on.
    if (improved) rememberPosted(best)
    return
  }

  if (improved) {
    await submitScore(best, wave)
    return
  }

  // Not a better score — but possibly a better NAME. A portal SDK resolves its
  // username asynchronously, so the first submission of a session can easily go
  // up as the generated one; without this the row keeps that name until the
  // player beats their own record, which might be never.
  const shown = getState<string>(POSTED_NAME_KEY, '')
  if (posted > 0 && shown) {
    const who = await resolveIdentity()
    if (who.name !== shown) {
      await submitScore(posted, wave)
      return
    }
  }

  await ensureBoard()
}
