import { afterEach, describe, expect, it } from 'vitest'
import useUser from '@/use/useUser'
import { DEFAULT_SETTINGS, sanitiseSettings, setSetting, settings } from '@/use/useGameSettings'
import { registerVoiceLines } from '@/voice/lines'
import { playVoiceLine, speechCandidates, speechLocale, speechUrl, voiceVolume } from '@/voice/speech'

/**
 * ─── The speech loader's decisions, minus the browser ───────────────────────
 *
 * Everything here is a decision made *before* an `<audio>` element exists: which
 * locale folder, which candidate paths and in which order, and whether to play
 * at all. Those are the parts that can be wrong without making a sound, so they
 * are the parts worth a test.
 *
 * What happens after the element exists — autoplay policy, a 404 falling through
 * to the next candidate, `onEnded` firing — is browser behaviour that jsdom does
 * not implement (`HTMLMediaElement.play` throws "Not implemented" there), and
 * mocking it would only assert that the mock was written to match the code. The
 * way to find out about those is to play a registered line in a browser and
 * listen.
 */

const { userLanguage } = useUser()
const originalLanguage = userLanguage.value

afterEach(() => {
  userLanguage.value = originalLanguage
  settings.value = { ...DEFAULT_SETTINGS }
})

describe('speech paths', () => {
  it('folds a locale tag down to its two-letter folder', () => {
    userLanguage.value = 'de'
    expect(speechLocale()).toBe('de')
    userLanguage.value = 'de-AT'
    expect(speechLocale()).toBe('de')
    userLanguage.value = 'EN-GB'
    expect(speechLocale()).toBe('en')
  })

  it('falls back to en for a locale nobody recorded', () => {
    userLanguage.value = 'pt'
    expect(speechUrl('narrator', 'x')).toContain('/speech/pt/')
    userLanguage.value = ''
    expect(speechLocale()).toBe('en')
  })

  it('builds the drop path a voice actor is given', () => {
    userLanguage.value = 'de'
    // Ends with the documented layout. It does NOT start with a hardcoded `/`
    // in a platform build: the URL goes through `prependBaseUrl`, which prefixes
    // `import.meta.env.BASE_URL` in production and passes the path through in
    // dev, which is what these tests see. Every `--base=./` build depends on it.
    expect(speechUrl('narrator', 'intro-abc123')).toMatch(/speech\/de\/narrator\/intro-abc123\.ogg$/)
    expect(speechUrl('', 'intro-abc123')).toMatch(/speech\/de\/intro-abc123\.ogg$/)
  })

  it('tries the speaker folder first and the flat folder last', () => {
    userLanguage.value = 'de'
    const candidates = speechCandidates('narrator', 'intro-abc123')
    expect(candidates).toHaveLength(2)
    expect(candidates[0]).toMatch(/speech\/de\/narrator\/intro-abc123\.ogg$/)
    expect(candidates[1]).toMatch(/speech\/de\/intro-abc123\.ogg$/)
  })

  it('walks each parent of a nested folder before the flat one', () => {
    // Nothing uses a nested folder today; the walk is what would let a second
    // channel (`ambient/<voice>/`) drop files at either level without a change
    // here. Asserted so that stays true.
    userLanguage.value = 'en'
    const candidates = speechCandidates('ambient/narrator', 'x')
    expect(candidates).toHaveLength(3)
    expect(candidates[0]).toMatch(/speech\/en\/ambient\/narrator\/x\.ogg$/)
    expect(candidates[1]).toMatch(/speech\/en\/ambient\/x\.ogg$/)
    expect(candidates[2]).toMatch(/speech\/en\/x\.ogg$/)
  })
})

describe('voice volume', () => {
  it('is master times voice', () => {
    setSetting('masterVolume', 0.5)
    setSetting('voiceVolume', 0.5)
    expect(voiceVolume()).toBeCloseTo(0.25)
  })

  it('is zero when muted, whatever the sliders say', () => {
    setSetting('masterVolume', 1)
    setSetting('voiceVolume', 1)
    setSetting('muted', true)
    expect(voiceVolume()).toBe(0)
  })

  it('defaults loud, because dialogue is the content', () => {
    expect(DEFAULT_SETTINGS.voiceVolume).toBe(1)
    expect(DEFAULT_SETTINGS.voiceVolume).toBeGreaterThanOrEqual(DEFAULT_SETTINGS.effectsVolume)
  })

  it('survives a settings blob written before the slider existed', () => {
    // Every stored blob in the wild predates `voiceVolume`. `sanitiseSettings`
    // has to fill it rather than leave `undefined` in a number field, or the
    // first multiplication produces NaN and the channel is silently silent.
    const repaired = sanitiseSettings({ masterVolume: 0.4, musicVolume: 0.2, effectsVolume: 0.3, muted: false })
    expect(repaired.voiceVolume).toBe(DEFAULT_SETTINGS.voiceVolume)
    expect(Number.isFinite(repaired.voiceVolume)).toBe(true)
    expect(sanitiseSettings({ voiceVolume: 5 }).voiceVolume).toBe(1)
    expect(sanitiseSettings({ voiceVolume: -1 }).voiceVolume).toBe(0)
    expect(sanitiseSettings({ voiceVolume: 'loud' }).voiceVolume).toBe(DEFAULT_SETTINGS.voiceVolume)
  })
})

const [sample] = registerVoiceLines('speechTest', [{ speaker: 'narrator', de: 'Ein Test.', en: 'A test.' }])

describe('playVoiceLine', () => {
  it('resolves null while muted, without touching the network', async () => {
    setSetting('muted', true)
    await expect(playVoiceLine(sample!.source)).resolves.toBeNull()
    await expect(playVoiceLine(sample!.id)).resolves.toBeNull()
  })

  it('resolves null at zero volume', async () => {
    setSetting('voiceVolume', 0)
    await expect(playVoiceLine(sample!)).resolves.toBeNull()
  })

  it('resolves null for a line that was never registered', async () => {
    // A line built at runtime cannot have been recorded, so asking the network
    // about it would be a guess with a 404 at the end of it.
    await expect(playVoiceLine({ speaker: 'narrator', de: 'improvisiert', en: 'improvised' })).resolves.toBeNull()
    await expect(playVoiceLine('no-such-id')).resolves.toBeNull()
  })
})
