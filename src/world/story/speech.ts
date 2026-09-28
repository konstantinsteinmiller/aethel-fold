import { watch } from 'vue'
import useUser from '@/use/useUser'
import { settings } from '@/use/useGameSettings'
import { prependBaseUrl } from '@/utils/function'
import { lineIdOf, voiceLineOf } from './lineIds'
import type { Line } from './script'

/**
 * ─── The chapter's voice-over, as a drag-and-drop folder ────────────────────
 *
 * A spoken line's audio lives at
 *
 *   `public/speech/<locale>/<speaker>/<LINE_ID>.ogg`
 *
 * and that is the whole interface. Record a line, save it as an `.ogg` named
 * exactly after its LINE_ID (`lineIds.ts`, or read one off `voice-over-todo.md`),
 * drop it in the speaker's folder, and it plays the next time that line fires.
 * There is no manifest to update, no import to add and no code change — which is
 * the point: the people who record lines are not the people who edit TypeScript,
 * and a pipeline that needs both is a pipeline that stalls.
 *
 * A **missing** file is not an error. `playStoryLine` resolves `null`, the
 * caller keeps its text-length hold timer, and the chapter plays exactly as it
 * did before any of this existed. That is also true of a locale nobody has
 * recorded, of a muted player, and of a browser that refuses to autoplay — three
 * cases that are indistinguishable to a caller and should be.
 *
 * ── The public API, precisely ───────────────────────────────────────────────
 *
 *   `playStoryLine(line, onEnded?) → Promise<number | null>`
 *       Play the voice-over for one scripted line. `line` is the very `Line`
 *       object the director is displaying — `SCRIPT[beat.script][i]` or the
 *       result of `banterFor(...)` — and the speaker folder and LINE_ID are
 *       resolved from it by identity (`lineIds.ts::voiceLineOf`).
 *
 *       Cuts whatever was playing first, unconditionally: one conversation, one
 *       voice.
 *
 *       Resolves as soon as the *outcome* is known, not when the clip ends:
 *         • a **number** — a clip is playing. The value is its length in
 *           milliseconds, or `0` when the browser has not reported a duration
 *           yet. Do not use it as a timer: wait for `onEnded`. It is there so a
 *           caller can decide whether to *extend* a hold, never to shorten one.
 *         • **`null`** — nothing is playing, for any of: no file on any
 *           candidate path, the line is not in the script, voice volume is zero,
 *           the game is muted, or the browser blocked autoplay. Fall back to the
 *           text timer.
 *
 *   `onEnded`
 *       Fires once, when the clip finishes on its own. It does **not** fire when
 *       the clip is cut by `stopStoryLine()` or by the next `playStoryLine()`,
 *       and it does not fire when the promise resolved `null` — so a caller can
 *       treat it as "the line is over, advance" without guarding.
 *
 *   `stopStoryLine() → void`
 *       Silence the channel now. Safe to call when nothing is playing.
 *
 *   `storyLineActive() → boolean`
 *       Whether a clip is currently on the channel. For a director that wants to
 *       refuse to auto-advance while a voice is still talking.
 *
 * ── One channel, shaped for two ─────────────────────────────────────────────
 *
 * There is exactly one channel here — the conversation — because the chapter has
 * exactly one thing that talks. The sibling project this comes from has a second
 * one for ambient barks, with distance attenuation and ducking under dialogue,
 * and none of that machinery is ported: there is nothing to attenuate and
 * nothing to duck under. What *is* kept is the shape — `makeChannel()` builds an
 * independent channel with its own volume function, so a second one is a
 * `const ambient = makeChannel(...)` and not a rewrite.
 *
 * ── Base URL: why every path goes through `prependBaseUrl` ──────────────────
 *
 * The platform builds (`build:itch`, `build:gamemonetize`, `build:playgama`, …)
 * all pass `--base=./`, because a portal serves the zip from a directory nobody
 * can predict. A hardcoded `/speech/de/gearn/x.ogg` resolves against the
 * *portal's* root there and 404s on every single line — silently, because a 404
 * on this path is indistinguishable from "not recorded yet". So the URL is built
 * by `@/utils/function::prependBaseUrl`, the same helper every image and sound
 * in the project already uses, which prefixes `import.meta.env.BASE_URL` in
 * production and passes the path through untouched in dev.
 *
 * ── Volume and mute ────────────────────────────────────────────────────────
 *
 * `masterVolume × voiceVolume`, zero when `muted` — all three from
 * `useGameSettings`, which is what the audio panel writes and what survives a
 * world being rebuilt. HTMLAudio sits outside any Web Audio graph, so this is
 * applied explicitly rather than inherited, and a change to any of the three is
 * pushed onto a *still-playing* clip by the watcher below. A player who drags
 * the slider mid-sentence should hear it move mid-sentence.
 *
 * ── Vue in `src/world/` ────────────────────────────────────────────────────
 *
 * The project's first rule is that no reactivity crosses into `src/world/`, and
 * this file imports `watch`. It is not the thing that rule forbids: nothing here
 * is a scene object, nothing here is in an update path, and the watcher's entire
 * effect is writing a float onto an `HTMLAudioElement` that lives in the DOM
 * rather than in the graph. It is the same seam `StoryPlayer` already sits on
 * when it reads `useKeybindings` — a settings value crossing in, not a Vue
 * object crossing out.
 *
 * ── Allocation ─────────────────────────────────────────────────────────────
 *
 * This allocates — a promise, an `Audio`, an array of candidate URLs. That is
 * fine and it is not a violation of the project's zero-allocation rule, which is
 * about *per-frame* work: a line change happens a few times a minute, on the
 * same event that already builds a speech bubble and re-aims a camera.
 */

const { userLanguage } = useUser()

/** The two-letter folder under `public/speech/`. Falls back to `en`, which is
 *  also what `storyLine()` falls back to — one locale rule, not two. */
export const speechLocale = (): string => (userLanguage?.value || 'en').slice(0, 2).toLowerCase()

/** The URL of one candidate file, base-url aware. See the header. */
export const speechUrl = (folder: string, lineId: string): string =>
  prependBaseUrl(`/speech/${speechLocale()}/${folder ? folder + '/' : ''}${lineId}.ogg`)

/**
 * Where to look for a line's audio, most specific first.
 *
 * The speaker's folder, then each parent of it, then the **flat** locale folder.
 * The flat fallback exists because LINE_IDs are globally unique, so
 * `public/speech/de/frameAsk-7f3a91.ogg` is unambiguous — and somebody who has
 * just been handed twelve `.ogg` files has one obvious place to put them. The
 * checklist ticks off either location for the same reason.
 */
export const speechCandidates = (folder: string, lineId: string): string[] => {
  const urls: string[] = []
  const segments = folder ? folder.split('/').filter(Boolean) : []
  for (let n = segments.length; n >= 1; n--) {
    urls.push(speechUrl(segments.slice(0, n).join('/'), lineId))
  }
  urls.push(speechUrl('', lineId))
  return urls
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

/** What a voice clip should play at, right now. Zero silences the channel and
 *  makes `playStoryLine` resolve `null` rather than start a silent element. */
export const voiceVolume = (): number => {
  const value = settings.value
  return value.muted ? 0 : clamp01(value.masterVolume * value.voiceVolume)
}

interface Channel {
  play: (folder: string, lineId: string, onEnded?: () => void) => Promise<number | null>
  stop: () => void
  active: () => boolean
  /** Re-apply the current volume to a clip that is still playing. */
  refresh: () => void
}

const makeChannel = (volumeOf: () => number): Channel => {
  let current: HTMLAudioElement | null = null
  /**
   * Which `play()` call owns the channel.
   *
   * Every callback below captures the value it was started under and does
   * nothing if it has moved on. Without it, tearing down a superseded attempt
   * re-enters the candidate walk: `stop()` assigns `src = ''`, which some
   * browsers report as a media error on the element being discarded, whose
   * `error` handler would then helpfully try the *next* candidate path of the
   * line that was just cancelled — and start playing it over the new one.
   */
  let generation = 0

  const stop = (): void => {
    generation++
    if (current) {
      current.pause()
      current.src = ''
      current = null
    }
  }

  const refresh = (): void => {
    if (current) {
      current.volume = clamp01(volumeOf())
    }
  }

  const play = (folder: string, lineId: string, onEnded?: () => void): Promise<number | null> => {
    stop()
    const mine = generation
    if (volumeOf() <= 0) {
      return Promise.resolve(null) // muted or the slider is at zero
    }
    const urls = speechCandidates(folder, lineId)
    return new Promise(resolve => {
      let settled = false
      const settle = (ms: number | null): void => {
        if (!settled) {
          settled = true
          resolve(ms)
        }
      }
      let index = 0
      const tryNext = (): void => {
        if (mine !== generation) {
          settle(null) // superseded while we were probing — see `generation`
          return
        }
        if (index >= urls.length) {
          settle(null) // no file on any path → the caller keeps its text timer
          return
        }
        const audio = new Audio(urls[index++])
        audio.volume = clamp01(volumeOf())
        audio.preload = 'auto'
        current = audio
        let done = false
        const fail = (): void => {
          if (done || mine !== generation) {
            return
          }
          done = true
          if (current === audio) {
            current = null
          }
          tryNext()
        }
        audio.addEventListener(
          'ended',
          () => {
            if (mine !== generation) {
              return
            }
            if (current === audio) {
              current = null
            }
            onEnded?.()
          },
          { once: true }
        )
        // This path holds no file → walk on to the next candidate. A 404 here is
        // the normal, expected case for an unrecorded line, not a failure.
        audio.addEventListener('error', fail, { once: true })
        audio
          .play()
          .then(() => {
            if (done || mine !== generation) {
              return
            }
            done = true
            settle(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : 0)
          })
          .catch(fail) // autoplay blocked, or the element was torn down
      }
      tryNext()
    })
  }

  return { play, stop, active: () => current !== null, refresh }
}

/** The conversation channel. The only one, for now — see the header. */
const dialogue = makeChannel(voiceVolume)

// Push a slider move or a mute onto a clip that is already talking. HTMLAudio is
// outside any Web Audio gain node, so nothing else would.
watch(
  () => voiceVolume(),
  () => dialogue.refresh()
)

/**
 * Play the voice-over for one scripted line. See the header for the contract.
 *
 * Returns `null` immediately for a `Line` that is not part of `SCRIPT` or
 * `BANTER` — a line built at runtime cannot have been recorded, and asking the
 * network about it would be a guess.
 */
export const playStoryLine = (line: Line, onEnded?: () => void): Promise<number | null> => {
  const entry = voiceLineOf(line)
  if (!entry) {
    return Promise.resolve(null)
  }
  return dialogue.play(entry.folder, entry.id, onEnded)
}

/** Cut the conversation channel. `onEnded` will not fire for what was cut. */
export const stopStoryLine = (): void => dialogue.stop()

/** True while a clip is playing on the conversation channel. */
export const storyLineActive = (): boolean => dialogue.active()

/**
 * Play a clip by explicit folder and id.
 *
 * The seam under `playStoryLine`, exported for the cases that do not have a
 * `Line` in hand — a future ambient channel, a barked reaction, a tool. Callers
 * with a `Line` should use `playStoryLine`, which cannot get the id wrong.
 */
export const playSpeech = (folder: string, lineId: string, onEnded?: () => void): Promise<number | null> =>
  dialogue.play(folder, lineId, onEnded)

export { lineIdOf, voiceLineOf }
