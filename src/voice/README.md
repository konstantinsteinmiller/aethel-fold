# src/voice — voice-over, game-agnostic

Spoken lines for any game in this repo: a registry of lines with stable ids,
a drag-and-drop audio loader, a text-driven lip-sync envelope, and a Piper TTS
casting table for placeholder audio. Nothing here knows about a particular game.

| File | What it is |
| --- | --- |
| `lines.ts` | the line registry and the `<group>-<hash>` id scheme |
| `speech.ts` | the runtime loader/player (`playVoiceLine`, `playSpeech`, `makeChannel`) |
| `lipSync.ts` | `planUtterance` / `openAt` — mouth openness from text |
| `voices.ts` | Piper model per speaker (`castVoices`), `narrator` as the default |
| `catalog.ts` | side-effect imports of every module that registers lines, for the tools |

## Register lines

```ts
import { registerVoiceLines, castVoices } from '@/voice'

export const INTRO = registerVoiceLines('intro', [
  { speaker: 'narrator', de: 'Es war einmal ein Schloss aus Papier.', en: 'Once there was a castle made of paper.' },
  { speaker: 'guard', de: 'Halt! Wer da?', en: 'Halt! Who goes there?' }
])

castVoices({
  guard: { de: 'de_DE-karlsson-low', en: 'en_US-joe-medium', name: { de: 'Wache', en: 'Guard' } }
})
```

A LINE_ID is `<group>-<6 hex of FNV-1a over the German text>` (e.g.
`intro-7f3a91`). Inserting a line moves no other id; rewriting a line's German
changes its id on purpose, so its stale recording stops playing. Group names are
letters, digits, `-` and `_`. Uncast speakers fall back to `narrator`.

Then add `import '<your module>'` to `catalog.ts` so the voice-over tools see it.

## Play them

```ts
import { playVoiceLine, stopSpeech, planUtterance, openAt, voiceText } from '@/voice'

const line = INTRO[0]!
const ms = await playVoiceLine(line, () => advance()) // number = playing, null = no audio
if (ms === null) holdForTextTimer()                   // missing file, muted, blocked: fall back

const mouth = planUtterance(voiceText(line, locale))  // drive Character.setMouthOpen(openAt(mouth, t))
```

`playVoiceLine` accepts the registered input object, the resolved `VoiceLine`, or
a LINE_ID string. Audio is looked up at
`public/speech/<locale>/<speaker>/<LINE_ID>.ogg`, then flat at
`public/speech/<locale>/<LINE_ID>.ogg`. Volume is `masterVolume × voiceVolume`
from `useGameSettings` (the Voices slider in the audio menu), silenced by `muted`.

## Record or generate audio

See [`voice-over-workflow.md`](../../voice-over-workflow.md):
`pnpm voice-over:todo` (checklist), `pnpm voice-over:setup` (Piper + models),
`pnpm voice-over:generate` (TTS placeholders for everything unrecorded).
