// Languages enabled in the OptionsModal picker. Each entry MUST have a
// matching `src/i18n/locales/<code>.ts` file — the Vite glob in
// `i18n/index.ts` registers each one as its own dynamic-import chunk so
// they only ship when the player actually switches to that language.
/**
 * ─── The two languages this game ships in ───────────────────────────────────
 *
 * German and English, and — for now — no others.
 *
 * Authored content (spoken lines, `src/voice/`) is written in German with an
 * English translation beside it, so a third language means somebody
 * translating prose, not a build step.
 *
 * English stays first and stays the `fallbackLocale`, because it is the **source
 * of truth for the key shape** — `tests/i18nParity.test.ts` measures German
 * against it, and a key that exists in only one of them is a bug either way.
 * The game opens in the browser's language when it is one of these, else
 * English (`DEFAULT_LOCALE`).
 *
 * To add a third: drop a file under `locales/`, append the code here and its
 * autonym below. Nothing else in the pipeline is language-count-dependent.
 */
export const LANGUAGES: Array<string> = ['en', 'de']

/**
 * The language the game opens in when nothing else has decided.
 *
 * ── Why it lives here and not in `i18n/index.ts` ────────────────────────────
 *
 * It used to, and there was a *second* default hiding in
 * `use/useUser.ts` — `readString(LANGUAGE_KEY, 'en')`. That fallback is not
 * "no stored language"; it is a value, `useUser` hands it to `main.ts`, and
 * `main.ts` applies it over the resolver's answer. So a brand-new player booted
 * into English no matter what `DEFAULT_LOCALE` said, and `main.ts` carried a
 * comment asserting the opposite ("useUser.ts deliberately does NOT seed a
 * language default"), which is how it survived being looked at.
 *
 * `utils/enums.ts` has no imports, so both the i18n layer and the shared user
 * store can read it without a cycle. That is the whole reason it is here rather
 * than in the module that owns the rest of the locale logic.
 */
const browserLocale = (): string => {
  try {
    const code = (typeof navigator !== 'undefined' ? navigator.language : '') ?? ''
    return code.slice(0, 2).toLowerCase()
  } catch {
    return ''
  }
}

export const DEFAULT_LOCALE: string = LANGUAGES.includes(browserLocale()) ? browserLocale() : 'en'

export const LANGUAGE_AUTONYMS: Record<string, string> = {
  en: 'English',
  de: 'Deutsch'
}