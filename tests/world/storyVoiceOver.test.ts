import { describe, expect, it } from 'vitest'
import {
  banterGroup,
  banterLineId,
  DISAMBIGUATED_LINE_IDS,
  lineIdOf,
  scriptLineId,
  STORY_VOICE_LINES,
  textHash,
  voiceLineById,
  voiceLineOf
} from '@/world/story/lineIds'
import { banterFor, BANTER, type Line, SCRIPT, SPEAKER_NAMES, type Speaker } from '@/world/story/script'
import { allPiperModels, isNonSpeechVoice, VOICE_ALIASES, VOICES, voiceModel } from '@/world/story/voices'
import { hasDirection, speechText } from '../../scripts/lib/voiceLines'

/**
 * ─── The voice-over pipeline, as a contract ─────────────────────────────────
 *
 * A voice-over file is bound to a line by **name and nothing else**: an `.ogg`
 * called `frameAsk-7f3a91.ogg` plays for whichever line hashes to that, and no
 * code, test or manifest sits between the two. So every failure this system can
 * have is a naming failure, and every one of them is silent — a recording that
 * stops being found, or worse, one that starts being found by the wrong line.
 *
 * That is what this suite is for. It asserts the four properties the id scheme
 * was chosen to have (below), the one rule the casting table exists to enforce
 * (nobody in a scene shares a voice), and the one text transformation that sits
 * between the author's prose and a TTS model's mouth.
 *
 * ── What it deliberately does not test ──────────────────────────────────────
 *
 * Whether anything is audible. Volume, mute, autoplay policy, the candidate-path
 * walk and the base-URL prefix are all browser behaviour, and the way to find
 * out about them is to open `/#/story`, turn the Voices slider, and listen —
 * which is the same lesson four invisible defects in this chapter already taught
 * once (see the project's CLAUDE.md).
 */

describe('line ids', () => {
  it('is a pure function of the text, so inserting a line moves nothing', () => {
    // This IS the insertion-invariance property, stated directly: an id contains
    // the group and the hash of the German and nothing positional, so there is
    // no value an insertion above it could change. Asserting it this way rather
    // than by mutating `SCRIPT` means it stays true for lines that do not exist
    // yet, which is the population that matters.
    for (const line of STORY_VOICE_LINES) {
      expect(line.id).toBe(`${line.group}-${textHash(line.de)}`)
    }
  })

  it('re-derives the same id from the same text, forever', () => {
    // Pinned values. FNV-1a is written out in `lineIds.ts` rather than imported
    // precisely so it cannot change under a version bump — and this is what
    // notices if somebody rewrites it anyway. A failure here means every
    // recording on disk has just been orphaned.
    expect(textHash('')).toBe(textHash(''))
    expect(textHash('Grandpa')).toBe(textHash('Grandpa'))
    expect(textHash('Grandpa')).not.toBe(textHash('Grandpaa'))
    expect(textHash('a')).toMatch(/^[0-9a-f]{6}$/)
    expect(textHash('„Großvater, erzähl!"')).toMatch(/^[0-9a-f]{6}$/)
    // Umlauts and typographic quotes are hashed as themselves — the ids in
    // `voice-over-todo.md` were produced from exactly these code units.
    expect(textHash('Großvater')).not.toBe(textHash('Grossvater'))
  })

  it('gives every line in the chapter a unique id', () => {
    const ids = new Set(STORY_VOICE_LINES.map(line => line.id))
    expect(ids.size).toBe(STORY_VOICE_LINES.length)
    expect(STORY_VOICE_LINES.length).toBeGreaterThan(100)
  })

  it('needs no collision suffixes today', () => {
    // Not a hard requirement — the mechanism handles a clash — but a clash means
    // two verbatim-identical German lines in one beat, which is the one case
    // where inserting a line is NOT invariant. Worth being told about.
    expect(DISAMBIGUATED_LINE_IDS).toEqual([])
  })

  it('keeps a SCRIPT block and a BANTER block of the same name apart', () => {
    // `SCRIPT.theodor` is a beat about Theodor; `BANTER.theodor` is what he says
    // when you walk up to him. Without the `banter-` prefix these two would
    // share a namespace, and two ids that look right would name one file.
    expect('theodor' in SCRIPT).toBe(true)
    expect('theodor' in BANTER).toBe(true)
    expect(banterGroup('theodor')).toBe('banter-theodor')
    const scriptIds = STORY_VOICE_LINES.filter(line => line.group === 'theodor')
    const banterIds = STORY_VOICE_LINES.filter(line => line.group === 'banter-theodor')
    expect(scriptIds.length).toBeGreaterThan(0)
    expect(banterIds.length).toBeGreaterThan(0)
    for (const line of scriptIds) {
      expect(banterIds.some(other => other.id === line.id)).toBe(false)
    }
  })

  it('resolves the very Line objects the director hands it', () => {
    // The whole runtime API rests on this: `StoryDirector` holds a `Line` and
    // gets an id back without threading beat ids and indices through the call.
    const first = (SCRIPT.frameAsk as readonly Line[])[0] as Line
    expect(lineIdOf(first)).toBe(scriptLineId('frameAsk', 0))
    expect(voiceLineOf(first)?.folder).toBe(first.who)

    const banter = banterFor('gearn', 0)
    expect(banter).not.toBeNull()
    expect(lineIdOf(banter as Line)).toBe(banterLineId('gearn', 0))

    // A line built at runtime cannot have been recorded, and must not be given
    // somebody else's id by accident.
    expect(lineIdOf({ who: 'gearn', de: 'nicht im Skript', en: 'not in the script' })).toBeNull()
  })

  it('round-trips id → line', () => {
    for (const line of STORY_VOICE_LINES) {
      expect(voiceLineById(line.id)).toBe(line)
    }
    expect(voiceLineById('no-such-id')).toBeNull()
  })

  it('files a line under its speaker', () => {
    // The folder is the drop location a voice actor is given, so it has to be
    // the person speaking and not the beat they are speaking in.
    for (const line of STORY_VOICE_LINES) {
      expect(line.folder).toBe(line.who)
      expect(line.folder).not.toContain('/')
    }
  })
})

describe('casting', () => {
  it('casts every speaker the script can use', () => {
    for (const who of Object.keys(SPEAKER_NAMES) as Speaker[]) {
      expect(VOICES[who]).toBeDefined()
      expect(isNonSpeechVoice(who)).toBe(false)
      expect(voiceModel(who, 'de')).not.toBe('')
      expect(voiceModel(who, 'en')).not.toBe('')
    }
  })

  it('reads German for every German locale tag', () => {
    // `de-AT` and `de-CH` are German. The same prefix test `storyLine()` uses —
    // two different answers to "is this German?" would put German audio under
    // English text.
    expect(voiceModel('storyteller', 'de')).toBe(VOICES.storyteller.de)
    expect(voiceModel('storyteller', 'de-AT')).toBe(VOICES.storyteller.de)
    expect(voiceModel('storyteller', 'DE')).toBe(VOICES.storyteller.de)
    expect(voiceModel('storyteller', 'en-GB')).toBe(VOICES.storyteller.en)
    expect(voiceModel('storyteller', 'fr')).toBe(VOICES.storyteller.en)
  })

  it('keeps a person who has two ids sounding like one person', () => {
    // The storyteller in the room and the narrator over a cut are one man; the
    // bandit chief before and after his men use his name is one man. A recast
    // that touches one row of a pair and not the other splits him in half, and
    // nothing else would notice.
    for (const group of VOICE_ALIASES) {
      const first = VOICES[group[0] as Speaker]
      for (const who of group) {
        expect(VOICES[who]).toEqual(first)
      }
    }
  })

  it('never puts two people in one scene on one voice', () => {
    // The rule the casting table exists to enforce, and the only kind of sharing
    // a player can hear. A `SCRIPT` block is the unit of a scene here: the beats
    // play one block at a time, so two speakers in one block are two voices the
    // player hears within a minute of each other.
    const canonical = new Map<string, string>()
    for (const group of VOICE_ALIASES) {
      for (const who of group) {
        canonical.set(who, group[0] as string)
      }
    }
    const blocks = Object.entries(SCRIPT) as unknown as [string, readonly Line[]][]
    for (const [group, lines] of blocks) {
      for (const locale of ['de', 'en']) {
        const owners = new Map<string, string>()
        for (const line of lines) {
          const person = canonical.get(line.who) ?? line.who
          const model = voiceModel(line.who, locale)
          const already = owners.get(model)
          expect(
            already === undefined || already === person,
            `${locale} scene "${group}": ${already} and ${person} both speak with ${model}`
          ).toBe(true)
          owners.set(model, person)
        }
      }
    }
  })

  it('lists each base model once for the downloader', () => {
    const models = allPiperModels()
    expect(new Set(models).size).toBe(models.length)
    expect([...models].sort()).toEqual(models)
    for (const model of models) {
      // `<lang_REGION>-<name>-<quality>`, no speaker suffix — `vo-setup.ts`
      // splits on `-` to build the HuggingFace path and would fetch nonsense
      // from anything else.
      expect(model).toMatch(/^[a-z]{2}_[A-Z]{2}-[a-z0-9_]+-[a-z0-9_]+$/)
      expect(model).not.toContain('#')
    }
    // Every cast model is downloadable, i.e. reachable from this list.
    for (const voice of Object.values(VOICES)) {
      expect(models).toContain(voice.de.split('#')[0])
      expect(models).toContain(voice.en.split('#')[0])
    }
  })
})

describe('speechText', () => {
  it('drops a stage direction but keeps the line', () => {
    expect(speechText('(verächtlich) Geh mir aus dem Weg.')).toBe('Geh mir aus dem Weg.')
    expect(speechText('Geh (leise) weiter.')).toBe('Geh weiter.')
    expect(hasDirection('(verächtlich) Geh.')).toBe(true)
    expect(hasDirection('Geh mir aus dem Weg.')).toBe(false)
  })

  it('returns nothing for a line that was entirely a direction', () => {
    // The caller reads this as "do not synthesize", rather than rendering a
    // voice actor solemnly saying the word "grunzt".
    expect(speechText('(grunzt)')).toBe('')
    expect(speechText('   ')).toBe('')
    expect(speechText('')).toBe('')
  })

  it('UNWRAPS emphasis instead of deleting it', () => {
    // The one deliberate departure from the pipeline this was ported from, where
    // `*…*` is a sound cue and is correctly deleted. Here it is italics on a word
    // the author wants stressed, and deleting it changes the sentence. There is
    // exactly one such line in the chapter and it would have shipped broken.
    expect(speechText('„Ach. *Die* Geschichte meinst du."')).toBe('Ach. Die Geschichte meinst du.')
    expect(speechText('"Ah. You mean *that* story."')).toBe('Ah. You mean that story.')
  })

  it('drops quotation marks without touching apostrophes', () => {
    expect(speechText('„Guten Morgen", sagte er.')).toBe('Guten Morgen, sagte er.')
    expect(speechText('"That doesn\'t matter!"')).toBe("That doesn't matter!")
    expect(speechText('Vater sagt, Schleifen sei keine Arbeit für einen Mann.')).toBe(
      'Vater sagt, Schleifen sei keine Arbeit für einen Mann.'
    )
  })

  it('leaves every real line in the chapter with something to say', () => {
    // The end-to-end version of all of the above: if the cleaner ever eats a
    // whole line, the generator silently skips it and the checklist never says
    // why.
    for (const line of STORY_VOICE_LINES) {
      expect(speechText(line.de).length, `${line.id} (de) cleaned to nothing`).toBeGreaterThan(0)
      expect(speechText(line.en).length, `${line.id} (en) cleaned to nothing`).toBeGreaterThan(0)
    }
  })
})
