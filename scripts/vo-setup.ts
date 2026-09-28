/**
 * ─── The voice-over toolchain, bootstrapped ─────────────────────────────────
 *
 *   pnpm voice-over:setup
 *
 * One-time and idempotent. Two steps:
 *
 *   1. `pip install piper-tts` into whatever Python is on PATH (`PYTHON`
 *      overrides it — `PYTHON="py -3"` will *not* work, it is one executable
 *      name; use the full path to `python.exe` if the launcher is all you have).
 *   2. Download every distinct Piper model `src/voice/voices.ts` casts
 *      into `tools/piper/`, skipping anything already there.
 *
 * There is no translation model to install. The pipeline this was ported from
 * pulls Argos down here to machine-translate its English into German; this
 * registry carries both languages as authored text, so that step does not exist.
 *
 * Wants network and a few hundred MB. Run under vitest only to reuse the `@/`
 * alias, so the model list stays derived from the casting table instead of being
 * a second copy of it that drifts.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'vitest'
import { allPiperModels } from '@/voice/voices'

const ROOT = process.cwd()
const PIPER_DIR = resolve(ROOT, 'tools/piper')
const PY = process.env.PYTHON || 'python'
const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main'

const log = (text = ''): void => {
  process.stdout.write(text + '\n')
}

/** `de_DE-pavoque-low` → `de/de_DE/pavoque/low/de_DE-pavoque-low` — the layout
 *  of the `rhasspy/piper-voices` repository. */
const hfBase = (model: string): string => {
  const [region, name, quality] = model.split('-')
  const lang = (region as string).split('_')[0]
  return `${lang}/${region}/${name}/${quality}/${model}`
}

const run = (cmd: string, args: string[]): boolean => {
  const result = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT })
  if (result.error) {
    log(`  x ${cmd} failed: ${result.error.message}`)
    return false
  }
  return result.status === 0
}

/**
 * Fetch one file, curl first.
 *
 * HuggingFace answers a model download with a 307 to an LFS CDN, and curl
 * follows it with retries far more reliably than a bare `fetch` did in the
 * project this came from — which half-failed a model set silently, leaving
 * zero-byte `.onnx` files that Piper then refused with an unhelpful error. Hence
 * the size check as well as the existence check. `curl.exe` ships with Windows
 * 10+, and the `fetch` path is the fallback for a box without it.
 */
const download = async (url: string, dest: string): Promise<void> => {
  if (existsSync(dest) && statSync(dest).size > 0) {
    log(`  . exists ${dest.replace(ROOT, '.')}`)
    return
  }
  const curl = spawnSync('curl', ['-fsSL', '--retry', '3', '--retry-delay', '2', '-o', dest, url], { stdio: 'inherit' })
  if (!curl.error && curl.status === 0 && existsSync(dest) && statSync(dest).size > 0) {
    log(`  v ${dest.replace(ROOT, '.')}`)
    return
  }
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} — ${url}`)
  }
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
  log(`  v ${dest.replace(ROOT, '.')} (fetch)`)
}

test(
  'voice-over toolchain setup',
  async () => {
    mkdirSync(PIPER_DIR, { recursive: true })

    log('> installing piper-tts ...')
    if (!run(PY, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'piper-tts'])) {
      log(`  ! pip install failed. Is "${PY}" a Python 3 on PATH? Set PYTHON=<full path to python.exe>.`)
    }

    const models = allPiperModels()
    log(`> downloading ${models.length} Piper voice model(s) -> tools/piper/ ...`)
    for (const model of models) {
      const base = hfBase(model)
      try {
        await download(`${HF}/${base}.onnx`, resolve(PIPER_DIR, `${model}.onnx`))
        await download(`${HF}/${base}.onnx.json`, resolve(PIPER_DIR, `${model}.onnx.json`))
      } catch (err) {
        log(
          `  x ${model}: ${(err as Error).message}\n` +
            '    (check the model id in src/voice/voices.ts against huggingface.co/rhasspy/piper-voices —\n' +
            '     a mis-typed or retired id is the only way this line prints, and swapping it is the whole fix)'
        )
      }
    }
    log('> setup done — run `pnpm voice-over:generate` (ffmpeg must be on PATH).')
  },
  3_600_000
)
