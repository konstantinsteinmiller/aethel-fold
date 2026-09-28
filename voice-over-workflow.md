# Voice-over workflow

How a spoken line gets from a game's script into the game, in German and
English. The runtime and the registry live in `src/voice/` (see its
`README.md`); no game registers lines yet, so the checklist is empty until one
does.

The whole system is one rule:

> A line's audio is `public/speech/<locale>/<speaker>/<LINE_ID>.ogg`.
> If that file exists, it plays. If it does not, the game shows the text and
> holds it on a timer.

No manifest, no import, no code change. That is deliberate: the people who
record lines are not the people who edit TypeScript.

---

## 1. Get the list

```bash
pnpm voice-over:todo                # German (default)
VO_LOCALE=en pnpm voice-over:todo   # English
```

Writes `voice-over-todo.md` at the repo root: every registered line grouped by
speaker, in registration order, with a scene heading, the LINE_ID, the drop path, and **the text in
the language being recorded**. A box ticks itself the moment the file exists, so
re-running it is how you see what is left.

The command overwrites the same file for either locale — run it again with the
other `VO_LOCALE` when you switch languages.

## 2. Record a line by hand

1. Find the line in `voice-over-todo.md` and read it.
2. Save the recording as **`.ogg`** (Vorbis; anything a browser plays will do,
   but the extension must be `.ogg` because that is the name the loader asks
   for).
3. Name it **exactly** after the `LINE_ID` — `intro-4d1e07.ogg`, no prefix,
   no suffix, no spaces.
4. Drop it at the path the checklist shows:
   `public/speech/de/narrator/intro-4d1e07.ogg`.

   The **flat** folder works too — `public/speech/de/intro-4d1e07.ogg` —
   because LINE_IDs are globally unique. It is the right place for a batch of
   files somebody just sent you; the per-speaker folder is the right place once
   they are sorted.
5. Re-run `pnpm voice-over:todo`. The box ticks. Reload the game and the line
   speaks.

Nothing ever overwrites a file you put there. The TTS pass below skips any line
that already has audio, forever.

### One part, two names

A character may have two speaker ids (say, on screen and as a voice-over across
a cut). Declare them with `aliasVoices('a', 'b')` in `src/voice/voices.ts`; the
checklist lists these at the top so one performer records both sections.

## 3. Fill the gaps with TTS

Placeholder audio for everything nobody has recorded, using local Piper voices
cast in `src/voice/voices.ts` (anything uncast uses `narrator`).

**Once, per machine:**

```bash
pnpm voice-over:setup     # pip install piper-tts + download the models (a few hundred MB)
```

Needs Python 3 on PATH (`PYTHON=<full path to python.exe>` overrides which one)
and network. Models land in `tools/piper/`, which is git-ignored.

You also need **ffmpeg on PATH** — Piper writes WAV, the game plays `.ogg`.

```bash
winget install Gyan.FFmpeg   # Windows — then open a NEW terminal so PATH refreshes
brew install ffmpeg          # macOS
apt install ffmpeg           # Linux
```

**Then, whenever lines have been added or changed:**

```bash
pnpm voice-over:generate
```

It renders only what is missing, in German and English, and prints what it did.

| Env | Effect |
| --- | --- |
| `VO_DRY_RUN=1` | Report the plan, write nothing. Always try this first. |
| `VO_LOCALES=de` | Render one locale instead of `de,en`. |
| `VO_LIMIT=5` | Cap new files per locale — a quick proof the toolchain works. |
| `VO_FILTER=narrator` | Substring match on speaker / LINE_ID / scene. |
| `VO_PRUNE_DIRECTIONS=1` | Delete files for lines that have grown a `(stage direction)`, so they re-render from cleaned text. |
| `PYTHON=…` | Which interpreter has `piper-tts`. |

Both PowerShell and Git Bash work. In PowerShell set the variable first:
`$env:VO_DRY_RUN=1; pnpm voice-over:generate`.

### Re-casting a voice

Change the row in `src/voice/voices.ts` (or the game's `castVoices` call),
delete that speaker's folders (`public/speech/*/<speaker>/`), and run `pnpm voice-over:generate` again. Hand
recordings you want to keep should be moved out first — the generator cannot
tell them apart from its own output, which is the point.

### Auditioning a voice before committing to it

```bash
echo "Halt dich hinter mir, wenn es losgeht." | \
  python scripts/tts/piper_say.py tools/piper/de_DE-karlsson-low.onnx try.wav
```

---

## 4. Why a LINE_ID looks like that

`<group>-<6 hex>` — `intro-7f3a91`. The hex is a hash of the **German** text.

* **Inserting a line above it changes nothing.** An array index would have
  renumbered every recording after the insertion onto the wrong sentence,
  silently.
* **Rewriting a line changes its id**, so its old recording stops being found
  and the box un-ticks itself. That is correct — the recording is of a sentence
  the game no longer contains.
* It is derived from the registered text alone, so there is no side table to
  keep in sync and two people editing different scenes never conflict.

The scheme, and the one case where it is not insertion-invariant (two verbatim
identical German lines inside one group), is written up in
`src/voice/lines.ts`.

## 5. What the TTS actually says

Not quite what the bubble shows. `speechText()` in `scripts/lib/voiceLines.ts`
drops `(stage directions)` and quotation marks, and **unwraps** `*emphasis*` —
the markers go, the word stays. The caption keeps everything.

## 6. Where the pieces live

| | |
| --- | --- |
| `src/voice/lines.ts` | the registry and the id scheme (`registerVoiceLines`) |
| `src/voice/catalog.ts` | imports every module that registers lines, for the tools |
| `src/voice/voices.ts` | the casting table |
| `src/voice/speech.ts` | the runtime loader |
| `src/voice/lipSync.ts` | mouth movement from text |
| `scripts/lib/voiceLines.ts` | the one enumeration both tools read |
| `scripts/gen-voice-over-todo.ts` | the checklist |
| `scripts/gen-voice-over.ts` | the TTS pass |
| `scripts/vo-setup.ts` | the toolchain bootstrap |
| `public/speech/**` | the audio — **committed**, it is content, not build output |
| `tools/piper/` | the downloaded models — git-ignored, one command to rebuild |
| `tests/voice/*.test.ts` | the id, casting, loader and text-cleaning contracts |

## 7. Volume

The player's **Voices** slider is in the settings screen's audio panel (`AudioMenu.vue`). Voice-over
plays at `masterVolume × voiceVolume`, silenced by `muted`, and a slider moved
mid-sentence is heard mid-sentence.
