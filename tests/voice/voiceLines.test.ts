import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  allVoiceLines,
  clearVoiceLines,
  DISAMBIGUATED_LINE_IDS,
  lineIdOf,
  registerVoiceLines,
  textHash,
  type VoiceLineInput,
  voiceLineById,
  voiceLineOf,
  voiceText
} from '@/voice/lines'
import {
  aliasVoices,
  allPiperModels,
  castVoices,
  DEFAULT_SPEAKER,
  isNonSpeechVoice,
  speakerDisplayName,
  VOICE_ALIASES,
  VOICES,
  voiceModel
} from '@/voice/voices'
import { collectVoiceLines, hasDirection, speechText } from '../../scripts/lib/voiceLines'

/**
 * ─── The voice-over pipeline, as a contract ─────────────────────────────────
 *
 * A voice-over file is bound to a line by **name and nothing else**, so every
 * failure this system can have is a naming failure, and every one is silent: a
 * recording that stops being found, or one found by the wrong line. This suite
 * asserts the id scheme's properties, the casting table's shape, and the text
 * cleaning that sits between authored prose and a TTS model.
 */

const SAMPLE: VoiceLineInput[] = [
  { speaker: 'narrator', de: '„Großvater, erzähl!"', en: '"Grandpa, tell us!"' },
  { speaker: 'narrator', de: 'Ach. *Die* Geschichte meinst du.', en: 'Ah. You mean *that* story.' },
  { speaker: 'guard', de: 'Halt!', en: 'Halt!' }
]

beforeEach(() => {
  clearVoiceLines()
})

afterEach(() => {
  clearVoiceLines()
})

describe('line ids', () => {
  it('is a pure function of group and German text, so inserting a line moves nothing', () => {
    const lines = registerVoiceLines('intro', SAMPLE)
    for (const line of lines) {
      expect(line.id).toBe(`intro-${textHash(line.de)}`)
    }
    // Inserting a line in front changes no existing id.
    clearVoiceLines()
    const inserted = registerVoiceLines('intro', [{ speaker: 'narrator', de: 'Neu.', en: 'New.' }, ...SAMPLE])
    expect(inserted.slice(1).map(line => line.id)).toEqual(lines.map(line => line.id))
  })

  it('re-derives the same hash from the same text, forever', () => {
    // FNV-1a is written out rather than imported so it cannot change under a
    // version bump. A failure here means every recording on disk is orphaned.
    expect(textHash('')).toBe('1c9dc5')
    expect(textHash('a')).toBe('0c292c')
    expect(textHash('Grandpa')).toBe('90dc02')
    expect(textHash('Großvater')).toBe('a52542')
    expect(textHash('Grandpa')).not.toBe(textHash('Grandpaa'))
    expect(textHash('Großvater')).not.toBe(textHash('Grossvater'))
  })

  it('suffixes a verbatim duplicate inside one group and reports it', () => {
    const lines = registerVoiceLines('dup', [
      { speaker: 'narrator', de: 'Ja.', en: 'Yes.' },
      { speaker: 'narrator', de: 'Ja.', en: 'Yes!' }
    ])
    expect(lines[1]!.id).toBe(`${lines[0]!.id}-2`)
    expect(DISAMBIGUATED_LINE_IDS).toEqual([lines[1]!.id])
  })

  it('keeps two groups with the same text apart', () => {
    const [a] = registerVoiceLines('one', [{ speaker: 'narrator', de: 'Ja.', en: 'Yes.' }])
    const [b] = registerVoiceLines('two', [{ speaker: 'narrator', de: 'Ja.', en: 'Yes.' }])
    expect(a!.id).not.toBe(b!.id)
    expect(DISAMBIGUATED_LINE_IDS).toEqual([])
  })

  it('rejects a group name that is not id-safe', () => {
    expect(() => registerVoiceLines('a b', SAMPLE)).toThrow()
    expect(() => registerVoiceLines('a/b', SAMPLE)).toThrow()
  })

  it('resolves the very objects that were registered, and round-trips ids', () => {
    const lines = registerVoiceLines('intro', SAMPLE)
    expect(lineIdOf(SAMPLE[0]!)).toBe(lines[0]!.id)
    expect(voiceLineOf(SAMPLE[2]!)?.folder).toBe('guard')
    for (const line of allVoiceLines()) {
      expect(voiceLineById(line.id)).toBe(line)
    }
    expect(voiceLineById('no-such-id')).toBeNull()
    // A line built at runtime cannot have been recorded.
    expect(lineIdOf({ speaker: 'narrator', de: '„Großvater, erzähl!"', en: 'x' })).toBeNull()
  })

  it('registers the same object once', () => {
    registerVoiceLines('intro', SAMPLE)
    registerVoiceLines('intro', SAMPLE)
    expect(allVoiceLines()).toHaveLength(SAMPLE.length)
  })

  it('files a line under its speaker', () => {
    for (const line of registerVoiceLines('intro', SAMPLE)) {
      expect(line.folder).toBe(line.speaker)
    }
  })

  it('reads German for every German locale tag', () => {
    const line = SAMPLE[2]!
    expect(voiceText(line, 'de-AT')).toBe(line.de)
    expect(voiceText(line, 'fr')).toBe(line.en)
  })
})

describe('casting', () => {
  it('has a narrator every uncast speaker falls back to', () => {
    expect(VOICES[DEFAULT_SPEAKER]).toBeDefined()
    expect(voiceModel('somebody-uncast', 'de')).toBe(VOICES[DEFAULT_SPEAKER]!.de)
    expect(isNonSpeechVoice('somebody-uncast')).toBe(false)
    expect(speakerDisplayName('somebody-uncast', 'en')).toBe('somebody-uncast')
  })

  it('reads German for every German locale tag', () => {
    const voice = VOICES[DEFAULT_SPEAKER]!
    expect(voiceModel(DEFAULT_SPEAKER, 'de')).toBe(voice.de)
    expect(voiceModel(DEFAULT_SPEAKER, 'de-AT')).toBe(voice.de)
    expect(voiceModel(DEFAULT_SPEAKER, 'DE')).toBe(voice.de)
    expect(voiceModel(DEFAULT_SPEAKER, 'en-GB')).toBe(voice.en)
    expect(voiceModel(DEFAULT_SPEAKER, 'fr')).toBe(voice.en)
  })

  it('treats an empty cast row as non-speech', () => {
    castVoices({ testBeast: { de: '', en: '' } })
    expect(isNonSpeechVoice('testBeast')).toBe(true)
    expect(voiceModel('testBeast', 'de')).toBe('')
    delete VOICES.testBeast
  })

  it('keeps a person who has two ids sounding like one person', () => {
    castVoices({ testA: { de: 'de_DE-karlsson-low', en: 'en_US-joe-medium' } })
    castVoices({ testB: { de: 'de_DE-karlsson-low', en: 'en_US-joe-medium' } })
    aliasVoices('testA', 'testB')
    for (const group of VOICE_ALIASES) {
      const first = VOICES[group[0]!]
      for (const who of group) {
        expect(VOICES[who]?.de).toBe(first?.de)
        expect(VOICES[who]?.en).toBe(first?.en)
      }
    }
    VOICE_ALIASES.pop()
    delete VOICES.testA
    delete VOICES.testB
  })

  it('lists each base model once for the downloader', () => {
    const models = allPiperModels()
    expect(new Set(models).size).toBe(models.length)
    expect([...models].sort()).toEqual(models)
    for (const model of models) {
      // `vo-setup.ts` splits on `-` to build the HuggingFace path.
      expect(model).toMatch(/^[a-z]{2}_[A-Z]{2}-[a-z0-9_]+-[a-z0-9_]+$/)
    }
  })
})

describe('tool enumeration', () => {
  it('casts and names every registered line', () => {
    registerVoiceLines('intro', SAMPLE)
    const collected = collectVoiceLines()
    expect(collected).toHaveLength(SAMPLE.length)
    for (const line of collected) {
      expect(line.piperDe).not.toBe('')
      expect(line.piperEn).not.toBe('')
      expect(line.nonSpeech).toBe(false)
    }
    expect(collected[0]!.nameEn).toBe('Narrator')
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
    expect(speechText('(grunzt)')).toBe('')
    expect(speechText('   ')).toBe('')
    expect(speechText('')).toBe('')
  })

  it('UNWRAPS emphasis instead of deleting it', () => {
    expect(speechText('„Ach. *Die* Geschichte meinst du."')).toBe('Ach. Die Geschichte meinst du.')
    expect(speechText('"Ah. You mean *that* story."')).toBe('Ah. You mean that story.')
  })

  it('drops quotation marks without touching apostrophes', () => {
    expect(speechText('„Guten Morgen", sagte er.')).toBe('Guten Morgen, sagte er.')
    expect(speechText('"That doesn\'t matter!"')).toBe("That doesn't matter!")
  })
})
