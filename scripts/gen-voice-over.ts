/**
 * ─── The TTS pass ───────────────────────────────────────────────────────────
 *
 *   pnpm voice-over:generate
 *
 * Renders a placeholder voice-over for every line of Chapter 1 that does not
 * have one yet, in every configured locale, with the local Piper voice cast in
 * `src/world/story/voices.ts`, and drops the `.ogg` where the runtime reads it:
 *
 *   `public/speech/<locale>/<speaker>/<LINE_ID>.ogg`
 *
 * ── Idempotent, and that is the load-bearing property ───────────────────────
 *
 * A file that already exists is **never** overwritten. That is what makes the
 * whole pipeline safe to re-run: a human recording dropped into the same folder
 * is indistinguishable from a generated one to this script, so it survives every
 * future pass forever. Re-running after adding three lines renders three files.
 *
 * To *replace* a generated file, delete it — and `VO_FILTER` exists so deleting
 * one character's folder and re-running is a two-command recast.
 *
 * ── No translation step ─────────────────────────────────────────────────────
 *
 * The pipeline this was ported from is English-first and machine-translates into
 * German with Argos, caching the result into a generated module for review. This
 * project is the opposite: every line in `script.ts` is hand-authored in **both**
 * German and English by the author, so German text is `line.de`, English is
 * `line.en`, and there is no translator, no cache and no generated module. That
 * is the one real difference between the two, and it removes about a third of
 * the moving parts.
 *
 * ── Env ─────────────────────────────────────────────────────────────────────
 *
 *   VO_LOCALES=de,en    which locales to render (default `de,en` — German first,
 *                       because German is this game's first language)
 *   VO_DRY_RUN=1        report the plan, touch nothing
 *   VO_LIMIT=N          cap NEW files per locale (0 = no cap) — a quick proof
 *   VO_FILTER=gearn     substring match on speaker / LINE_ID / scene — re-render
 *                       one part after a recast
 *   VO_PRUNE_DIRECTIONS=1  delete existing files for lines carrying a
 *                       `(stage direction)`, so they re-render from cleaned text
 *   PYTHON=python       the interpreter that has piper-tts installed (`py -3` on
 *                       a Windows box with the launcher and no `python` shim)
 *
 * Prerequisites: `pnpm voice-over:setup` (pip-installs piper-tts and downloads
 * the models into `tools/piper/`) and **ffmpeg on PATH** — checked up front, see
 * `requireFfmpeg`.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'vitest'
import {
  collectVoiceLines,
  hasDirection,
  modelFor,
  oggPathFlat,
  oggPathNested,
  speechText,
  textFor,
  type VoiceLine
} from './lib/voiceLines'

const ROOT = process.cwd()
const PIPER_DIR = resolve(ROOT, 'tools/piper')
const WAV_DIR = resolve(PIPER_DIR, '_wav')
const PY = process.env.PYTHON || 'python'
const LOCALES = (process.env.VO_LOCALES || 'de,en')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
const DRY = process.env.VO_DRY_RUN === '1' || process.env.VO_DRY_RUN === 'true'
const LIMIT = Number(process.env.VO_LIMIT || 0)
const FILTER = (process.env.VO_FILTER || '').trim()
const PRUNE_DIRECTIONS = process.env.VO_PRUNE_DIRECTIONS === '1' || process.env.VO_PRUNE_DIRECTIONS === 'true'

// vitest intercepts console.log and may swallow it depending on the reporter;
// this is the one output of the command, so it goes to stdout directly.
const log = (text = ''): void => {
  process.stdout.write(text + '\n')
}

const oggAbs = (locale: string, folder: string, lineId: string): string =>
  resolve(ROOT, oggPathNested(locale, folder, lineId))

/** Already recorded, in either place the runtime looks. Mirrors the checklist so
 *  `generate` can never write a second copy of a hand-recorded line. */
const alreadyHave = (locale: string, folder: string, lineId: string): boolean =>
  existsSync(oggAbs(locale, folder, lineId)) || existsSync(resolve(ROOT, oggPathFlat(locale, lineId)))

const modelPath = (model: string): string => resolve(PIPER_DIR, `${model}.onnx`)

/** `de_DE-mls-medium#42` → `{ base, speaker: '42' }`; a plain id → `speaker: ''`. */
const parseModel = (model: string): { base: string; speaker: string } => {
  const [base, speaker = ''] = model.split('#')
  return { base: base as string, speaker }
}

/**
 * Fail early and legibly when ffmpeg is missing.
 *
 * Piper writes WAV; the runtime plays `.ogg`; ffmpeg is the bridge and it is not
 * bundled. Without this check a full run loads every voice model, synthesizes
 * every line, fails to encode all of them, and reports a wall of per-file errors
 * — several minutes to say "install ffmpeg". `spawnSync` with a bare command
 * name resolves `ffmpeg.exe` through PATH on Windows and `ffmpeg` on a POSIX
 * shell, so this works the same under PowerShell and Git Bash.
 */
const requireFfmpeg = (): void => {
  const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) {
    throw new Error(
      'ffmpeg is not on PATH — it encodes Piper\'s WAV output to the .ogg the game plays.\n' +
        '  Windows : winget install Gyan.FFmpeg   (then open a NEW terminal so PATH refreshes)\n' +
        '  macOS   : brew install ffmpeg\n' +
        '  Linux   : apt install ffmpeg\n' +
        '  Then re-run `pnpm voice-over:generate`.'
    )
  }
}

interface Job {
  text: string
  speaker: string
  ogg: string
}

/**
 * Render every job that shares one base model in a single Piper process.
 *
 * Loading a Piper ONNX model costs 1–2 s and rendering a short line costs
 * 0.1–0.3 s, so the model load dominates by an order of magnitude. Grouping by
 * model turns "load the model 148 times" into "load it once" — the difference
 * between a few minutes and a few hours. Returns how many `.ogg` files landed.
 */
const runModelBatch = (base: string, jobs: Job[]): number => {
  mkdirSync(WAV_DIR, { recursive: true })
  const manifest = jobs.map((job, i) => ({
    text: job.text,
    wav: resolve(WAV_DIR, `${i}.wav`),
    speaker_id: job.speaker || null
  }))
  const manifestPath = resolve(WAV_DIR, 'manifest.json')
  // UTF-8 explicitly: the German lines carry umlauts and typographic dashes, and
  // a mis-encoded manifest is a voice reading mojibake rather than a crash.
  writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8')

  const piper = spawnSync(PY, [resolve(ROOT, 'scripts/tts/piper_batch.py'), modelPath(base), manifestPath], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
  })
  if (piper.error) {
    log(`  x piper batch (${base}): ${piper.error.message}`)
  }

  let made = 0
  jobs.forEach((job, i) => {
    const wav = (manifest[i] as { wav: string }).wav
    if (!existsSync(wav)) {
      return // this one line failed to synthesize; the rest of the batch stands
    }
    mkdirSync(dirname(job.ogg), { recursive: true })
    const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libvorbis', '-q:a', '4', job.ogg], {
      encoding: 'utf8'
    })
    rmSync(wav, { force: true })
    if (ff.status === 0) {
      made++
    } else {
      log(`  x ffmpeg ${job.ogg}: ${ff.stderr || ff.error?.message || 'failed'}`)
    }
  })
  rmSync(manifestPath, { force: true })
  return made
}

const matchesFilter = (line: VoiceLine): boolean =>
  !FILTER || line.folder.includes(FILTER) || line.id.includes(FILTER) || line.group.includes(FILTER)

test('generate voice-overs', () => {
  const lines = collectVoiceLines()
  const speakable = lines.filter(line => !line.nonSpeech).filter(matchesFilter)

  log('')
  log(
    `> voice-over:generate ${DRY ? '(DRY RUN)' : ''} — ${lines.length} line(s)` +
      `${lines.length - speakable.length ? `, ${lines.length - speakable.length} skipped (non-speech / filtered)` : ''}` +
      `, locales: ${LOCALES.join(', ')}`
  )
  if (FILTER) {
    log(`> filter "${FILTER}" -> ${speakable.length} matching line(s)`)
  }
  log('')

  if (!DRY) {
    requireFfmpeg()
  }

  let totalNew = 0
  const missingModels = new Set<string>()

  for (const locale of LOCALES) {
    // Prune first: a line that has grown a (stage direction) since it was
    // rendered is speaking the direction out loud right now, and the only way
    // back is to delete the file so the idempotency rule stops protecting it.
    if (PRUNE_DIRECTIONS && !DRY) {
      let pruned = 0
      for (const line of speakable) {
        if (!modelFor(line, locale)) {
          continue
        }
        if (!hasDirection(textFor(line, locale))) {
          continue
        }
        const file = oggAbs(locale, line.folder, line.id)
        if (existsSync(file)) {
          rmSync(file, { force: true })
          pruned++
        }
      }
      if (pruned) {
        log(`> ${locale.toUpperCase()}: pruned ${pruned} direction-tainted file(s) for re-render`)
      }
    }

    let exist = 0
    let toGen = 0
    let noText = 0
    let noModel = 0
    let directionOnly = 0
    let collected = 0
    const samples: string[] = []
    const byModel = new Map<string, Job[]>()

    for (const line of speakable) {
      const model = modelFor(line, locale)
      if (!model) {
        noModel++
        continue
      }
      const raw = textFor(line, locale)
      if (!raw) {
        noText++
        continue
      }
      if (alreadyHave(locale, line.folder, line.id)) {
        exist++
        continue
      }
      const text = speechText(raw)
      if (!text) {
        directionOnly++ // the whole line was a direction — there is nothing to say
        continue
      }
      toGen++
      if (samples.length < 6) {
        samples.push(`${line.folder}/${line.id}.ogg  ·  ${model}`)
      }
      if (DRY) {
        continue
      }
      if (LIMIT && collected >= LIMIT) {
        continue
      }
      const { base, speaker } = parseModel(model)
      if (!existsSync(modelPath(base))) {
        missingModels.add(base)
        continue
      }
      const bucket = byModel.get(base)
      if (bucket) {
        bucket.push({ text, speaker, ogg: oggAbs(locale, line.folder, line.id) })
      } else {
        byModel.set(base, [{ text, speaker, ogg: oggAbs(locale, line.folder, line.id) }])
      }
      collected++
    }

    let made = 0
    if (!DRY && byModel.size) {
      const jobs = [...byModel.values()].reduce((n, list) => n + list.length, 0)
      log(`> ${locale.toUpperCase()}: rendering ${jobs} line(s) across ${byModel.size} voice model(s) ...`)
      for (const [base, list] of byModel) {
        log(`   . ${base} — ${list.length} line(s)`)
        made += runModelBatch(base, list)
      }
      totalNew += made
    }

    log(
      `-- ${locale.toUpperCase()} -- existing: ${exist} · ${DRY ? 'to generate' : 'generated'}: ` +
        `${DRY ? toGen : `${made}/${toGen}`} · no-text: ${noText} · direction-only: ${directionOnly} · no-model: ${noModel}`
    )
    for (const sample of samples) {
      log(`     ${DRY ? '·' : '+'} ${sample}`)
    }
    log('')
  }

  rmSync(WAV_DIR, { recursive: true, force: true })

  if (missingModels.size) {
    log(`! ${missingModels.size} voice model(s) missing from tools/piper/ — run \`pnpm voice-over:setup\`:`)
    for (const model of missingModels) {
      log(`   ${model}`)
    }
  }
  log(DRY ? 'dry run complete — no files written.' : `done — ${totalNew} new voice-over file(s).`)
})
