# Voice-over workflow

How a spoken line gets from the manuscript into the game. Chapter 1 —
*Chroniken von Arlaan* — has **148 lines** across 19 speaking parts, in German
and English.

The whole system is one rule:

> A line's audio is `public/speech/<locale>/<speaker>/<LINE_ID>.ogg`.
> If that file exists, it plays. If it does not, the chapter shows the text and
> holds it on a timer, exactly as it did before any of this existed.

No manifest, no import, no code change. That is deliberate: the people who
record lines are not the people who edit TypeScript.

---

## 1. Get the list

```bash
pnpm voice-over:todo                # German — the manuscript's own language
VO_LOCALE=en pnpm voice-over:todo   # English
```

Writes `voice-over-todo.md` at the repo root: every line grouped by speaker, in
play order, with a scene heading, the LINE_ID, the drop path, and **the text in
the language being recorded**. A box ticks itself the moment the file exists, so
re-running it is how you see what is left.

The command overwrites the same file for either locale — run it again with the
other `VO_LOCALE` when you switch languages.

## 2. Record a line by hand

1. Find the line in `voice-over-todo.md` and read it.
2. Save the recording as **`.ogg`** (Vorbis; anything a browser plays will do,
   but the extension must be `.ogg` because that is the name the loader asks
   for).
3. Name it **exactly** after the `LINE_ID` — `boarChase-4d1e07.ogg`, no prefix,
   no suffix, no spaces.
4. Drop it at the path the checklist shows:
   `public/speech/de/gearn/boarChase-4d1e07.ogg`.

   The **flat** folder works too — `public/speech/de/boarChase-4d1e07.ogg` —
   because LINE_IDs are globally unique. It is the right place for a batch of
   files somebody just sent you; the per-speaker folder is the right place once
   they are sorted.
5. Re-run `pnpm voice-over:todo`. The box ticks. Reload `/#/story` and the line
   speaks.

Nothing ever overwrites a file you put there. The TTS pass below skips any line
that already has audio, forever.

### One part, two names

Six people in the script have two speaker ids — the storyteller is
`storyteller` in the room and `narrator` over a cut; the bandit chief is
`banditLeader` until his men use his name and `brutos` after. The checklist
lists these at the top. One performer records both sections.

## 3. Fill the gaps with TTS

Placeholder audio for everything nobody has recorded, using local Piper voices
cast in `src/world/story/voices.ts`.

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
| `VO_FILTER=gearn` | Substring match on speaker / LINE_ID / scene. |
| `VO_PRUNE_DIRECTIONS=1` | Delete files for lines that have grown a `(stage direction)`, so they re-render from cleaned text. |
| `PYTHON=…` | Which interpreter has `piper-tts`. |

Both PowerShell and Git Bash work. In PowerShell set the variable first:
`$env:VO_DRY_RUN=1; pnpm voice-over:generate`.

### Re-casting a voice

Change the row in `src/world/story/voices.ts`, delete that speaker's folders
(`public/speech/*/gearn/`), and run `pnpm voice-over:generate` again. Hand
recordings you want to keep should be moved out first — the generator cannot
tell them apart from its own output, which is the point.

### Auditioning a voice before committing to it

```bash
echo "Halt dich hinter mir, wenn es losgeht." | \
  python scripts/tts/piper_say.py tools/piper/de_DE-karlsson-low.onnx try.wav
```

---

## 4. Why a LINE_ID looks like that

`<scene>-<6 hex>` — `frameAsk-7f3a91`. The hex is a hash of the **German** text.

* **Inserting a line above it changes nothing.** An array index would have
  renumbered every recording after the insertion onto the wrong sentence,
  silently.
* **Rewriting a line changes its id**, so its old recording stops being found
  and the box un-ticks itself. That is correct — the recording is of a sentence
  the game no longer contains.
* It is derived from `script.ts` alone, so there is no side table to keep in
  sync and two people editing different beats never conflict.

The scheme, and the one case where it is not insertion-invariant (two verbatim
identical German lines inside one beat), is written up in
`src/world/story/lineIds.ts`.

## 5. What the TTS actually says

Not quite what the bubble shows. `speechText()` in `scripts/lib/voiceLines.ts`
drops `(stage directions)` and quotation marks, and **unwraps** `*emphasis*` —
the markers go, the word stays. The caption keeps everything.

## 6. Where the pieces live

| | |
| --- | --- |
| `src/world/story/script.ts` | the prose, German + English, hand-authored |
| `src/world/story/lineIds.ts` | the id scheme |
| `src/world/story/voices.ts` | the casting table |
| `src/world/story/speech.ts` | the runtime loader |
| `scripts/lib/voiceLines.ts` | the one enumeration both tools read |
| `scripts/gen-voice-over-todo.ts` | the checklist |
| `scripts/gen-voice-over.ts` | the TTS pass |
| `scripts/vo-setup.ts` | the toolchain bootstrap |
| `public/speech/**` | the audio — **committed**, it is content, not build output |
| `tools/piper/` | the downloaded models — git-ignored, one command to rebuild |
| `tests/world/storyVoiceOver.test.ts` | the id, casting and text-cleaning contracts |

## 7. Volume

The player's **Voices** slider is in the pause screen's audio panel. Voice-over
plays at `masterVolume × voiceVolume`, silenced by `muted`, and a slider moved
mid-sentence is heard mid-sentence.
