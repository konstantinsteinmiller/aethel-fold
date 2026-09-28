import { watch } from 'vue'
import useUser from '@/use/useUser'
import { settings } from '@/use/useGameSettings'
import { prependBaseUrl } from '@/utils/function'
import { type VoiceLine, type VoiceLineInput, voiceLineById, voiceLineOf } from './lines'

/**
 * ─── Voice-over playback, as a drag-and-drop folder ─────────────────────────
 *
 * A spoken line's audio lives at
 *
 *   `public/speech/<locale>/<speaker>/<LINE_ID>.ogg`
 *
 * (or flat at `public/speech/<locale>/<LINE_ID>.ogg`), and that is the whole
 * interface. Record a line, save it as an `.ogg` named exactly after its LINE_ID
 * (`lines.ts`, or read one off `voice-over-todo.md`), drop it in the speaker's
 * folder, and it plays the next time that line fires. No manifest, no import.
 *
 * A **missing** file is not an error. `playVoiceLine` resolves `null`, the
 * caller keeps its text-length hold timer, and the game plays as if voice-over
 * did not exist. The same is true of an unrecorded locale, a muted player and
 * a browser that refuses to autoplay — indistinguishable to a caller, as they
 * should be.
 *
 * ── The public API ─────────────────────────────────────────────────────────
 *
 *   `playVoiceLine(line, onEnded?) → Promise<number | null>`
 *       Play a registered line — the very `VoiceLineInput` object passed to
 *       `registerVoiceLines`, or its resolved `VoiceLine`, or a LINE_ID string.
 *       Cuts whatever was playing first: one conversation, one voice.
 *
 *       Resolves as soon as the *outcome* is known, not when the clip ends:
 *         • a **number** — a clip is playing; its length in ms, or `0` when the
 *           browser has not reported a duration yet. Use it to *extend* a hold,
 *           never to shorten one; wait for `onEnded` to advance.
 *         • **`null`** — nothing is playing (no file, unregistered line, zero
 *           volume, muted, autoplay blocked). Fall back to the text timer.
 *
 *   `onEnded` fires once when the clip finishes on its own — not when it is cut
 *   by `stopSpeech()` or the next play, and not when the promise resolved null.
 *
 *   `playSpeech(folder, lineId, onEnded?)` — the same by explicit folder/id.
 *   `stopSpeech()` — silence the channel now. Safe when nothing plays.
 *   `speechActive()` — whether a clip is currently on the channel.
 *   `makeChannel(volumeOf)` — an independent channel (e.g. ambient barks).
 *
 * ── Base URL ───────────────────────────────────────────────────────────────
 *
 * Platform builds pass `--base=./`, so a hardcoded `/speech/...` would 404 on
 * every line — silently, since a 404 here means "not recorded yet". URLs go
 * through `prependBaseUrl`, like every other asset in the project.
 *
 * ── Volume and mute ────────────────────────────────────────────────────────
 *
 * `masterVolume × voiceVolume`, zero when `muted` — all from `useGameSettings`
 * (the audio menu's Voices slider). A watcher pushes changes onto a clip that
 * is still playing, so dragging the slider mid-sentence is audible.
 *
 * ── Allocation ─────────────────────────────────────────────────────────────
 *
 * This allocates (a promise, an `Audio`, candidate URLs). Fine: it runs a few
 * times a minute on a line change, never per frame.
 */

const { userLanguage } = useUser()

/** The two-letter folder under `public/speech/`. Falls back to `en`. */
export const speechLocale = (): string => (userLanguage?.value || 'en').slice(0, 2).toLowerCase()

/** The URL of one candidate file, base-url aware. See the header. */
export const speechUrl = (folder: string, lineId: string): string =>
  prependBaseUrl(`/speech/${speechLocale()}/${folder ? folder + '/' : ''}${lineId}.ogg`)

/**
 * Where to look for a line's audio, most specific first.
 *
 * The speaker's folder, then each parent of it, then the **flat** locale folder.
 * The flat fallback exists because LINE_IDs are globally unique, so
 * `public/speech/de/intro-7f3a91.ogg` is unambiguous — and somebody who has
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
 *  makes a play resolve `null` rather than start a silent element. */
export const voiceVolume = (): number => {
  const value = settings.value
  return value.muted ? 0 : clamp01(value.masterVolume * value.voiceVolume)
}

export interface Channel {
  play: (folder: string, lineId: string, onEnded?: () => void) => Promise<number | null>
  stop: () => void
  active: () => boolean
  /** Re-apply the current volume to a clip that is still playing. */
  refresh: () => void
}

export const makeChannel = (volumeOf: () => number): Channel => {
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

/** The conversation channel. */
const dialogue = makeChannel(voiceVolume)

// Push a slider move or a mute onto a clip that is already talking. HTMLAudio is
// outside any Web Audio gain node, so nothing else would.
watch(
  () => voiceVolume(),
  () => dialogue.refresh()
)

const resolveLine = (line: VoiceLineInput | VoiceLine | string): VoiceLine | null => {
  if (typeof line === 'string') {
    return voiceLineById(line)
  }
  if ('id' in line && 'folder' in line && voiceLineById(line.id) === line) {
    return line
  }
  return voiceLineOf(line)
}

/**
 * Play the voice-over for one registered line. See the header for the contract.
 *
 * Resolves `null` immediately for a line that was never registered — it cannot
 * have been recorded, and asking the network about it would be a guess.
 */
export const playVoiceLine = (
  line: VoiceLineInput | VoiceLine | string,
  onEnded?: () => void
): Promise<number | null> => {
  const entry = resolveLine(line)
  if (!entry) {
    return Promise.resolve(null)
  }
  return dialogue.play(entry.folder, entry.id, onEnded)
}

/** Play a clip by explicit folder and id, on the conversation channel. */
export const playSpeech = (folder: string, lineId: string, onEnded?: () => void): Promise<number | null> =>
  dialogue.play(folder, lineId, onEnded)

/** Cut the conversation channel. `onEnded` will not fire for what was cut. */
export const stopSpeech = (): void => dialogue.stop()

/** True while a clip is playing on the conversation channel. */
export const speechActive = (): boolean => dialogue.active()
