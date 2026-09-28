#!/usr/bin/env python3
"""Synthesize MANY lines with ONE Piper voice — load the model once, reuse it.

    python scripts/tts/piper_batch.py <model.onnx> <manifest.json>

`manifest.json` is a list of jobs:

    [{ "text": "...", "wav": "out.wav", "speaker_id": 42 }, ...]

`speaker_id` is optional and only means anything for a multi-speaker model.

Loading a Piper ONNX model costs 1-2 s; rendering a short line costs 0.1-0.3 s.
So the generator groups every line that shares a voice and hands them here in one
batch — the difference between a few minutes for a game's script and a few hours.

One bad line must not sink the batch, so a synthesis failure is reported on
stderr and skipped; the exit code is the number of FAILED lines (0 = all good).
Progress prints every 20 lines so a long run is visibly alive.
"""
import json
import sys
import wave

from piper import PiperVoice, SynthesisConfig


def main() -> int:
    if len(sys.argv) != 3:
        sys.stderr.write("usage: piper_batch.py <model.onnx> <manifest.json>\n")
        return 255
    model_path, manifest_path = sys.argv[1], sys.argv[2]
    with open(manifest_path, encoding="utf-8") as fh:
        jobs = json.load(fh)

    voice = PiperVoice.load(model_path)
    failed = 0
    total = len(jobs)
    for i, job in enumerate(jobs, 1):
        text = (job.get("text") or "").strip()
        if not text:
            continue
        sid = job.get("speaker_id")
        cfg = SynthesisConfig(speaker_id=int(sid)) if sid is not None else None
        try:
            with wave.open(job["wav"], "wb") as wav:
                voice.synthesize_wav(text, wav, syn_config=cfg)
        except Exception as e:  # noqa: BLE001 — one bad line must not sink the batch
            sys.stderr.write(f"piper_batch: failed {job.get('wav')}: {e}\n")
            failed += 1
        if i % 20 == 0 or i == total:
            print(f"    {i}/{total}", flush=True)
    return min(failed, 254)


if __name__ == "__main__":
    sys.exit(main())
