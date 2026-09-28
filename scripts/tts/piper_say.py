#!/usr/bin/env python3
"""Synthesize ONE line with Piper into a WAV file.

    echo "<text>" | python scripts/tts/piper_say.py <model.onnx> <out.wav> [speakerId]

The single-line counterpart to `piper_batch.py`, for auditioning a voice by hand
before committing it to `src/voice/voices.ts`:

    echo "Worueber soll ich dir denn alles erzaehlen, Junge?" | \
      python scripts/tts/piper_say.py tools/piper/de_DE-pavoque-low.onnx try.wav

Uses the piper-tts Python API rather than its CLI, because the API is stable
across releases and the CLI's flags are not — flag churn between versions must
not be able to break the pipeline. The text comes in on **stdin** so quotes,
umlauts and typographic dashes pass through untouched by any shell's quoting
rules, which matters more on Windows than anywhere else.

The optional speakerId picks one voice out of a multi-speaker model. This
project's casting deliberately uses none (see `voices.ts` on why), and the
argument stays because auditioning one is exactly what you would use this for.
"""
import sys
import wave

from piper import PiperVoice, SynthesisConfig


def main() -> int:
    if len(sys.argv) not in (3, 4):
        sys.stderr.write("usage: piper_say.py <model.onnx> <out.wav> [speakerId]  (text on stdin)\n")
        return 2
    model_path, out_path = sys.argv[1], sys.argv[2]
    speaker_id = int(sys.argv[3]) if len(sys.argv) == 4 and sys.argv[3] != "" else None
    text = sys.stdin.read().strip()
    if not text:
        sys.stderr.write("piper_say.py: empty text on stdin\n")
        return 3
    voice = PiperVoice.load(model_path)
    cfg = SynthesisConfig(speaker_id=speaker_id) if speaker_id is not None else None
    with wave.open(out_path, "wb") as wav:
        voice.synthesize_wav(text, wav, syn_config=cfg)
    return 0


if __name__ == "__main__":
    sys.exit(main())
