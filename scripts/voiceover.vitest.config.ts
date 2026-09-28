import path from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * `pnpm voice-over:todo` — runs ONLY the checklist generator.
 *
 * Its own config so the generator never rides along with `pnpm test` (it writes
 * a file, which a test must not) and so `pnpm test` never runs the generator.
 *
 * ── Why `node` and not `jsdom` ──────────────────────────────────────────────
 *
 * The tooling path is pure data: `lineIds.ts` → `script.ts` → nothing. No Vue,
 * no three.js, no composable, no DOM. Running it under jsdom would only add the
 * one landmine jsdom brings to this project — a `localStorage` stub whose
 * methods are all `undefined` (see `tests/save/setup.ts`) — in exchange for
 * nothing. If something in this path ever grows a `window` dependency, that is
 * the signal to move it, not to change this line.
 *
 * `APP_VERSION` is mirrored from `vitest.config.ts` anyway: it is injected by
 * `vite.config.ts` at build time, and any module that reads it at import time
 * throws a bare ReferenceError without it — a failure mode worth one line to
 * pre-empt.
 */
export default defineConfig({
  define: { APP_VERSION: JSON.stringify('tools') },
  resolve: {
    alias: { '@': path.resolve(__dirname, '../src') },
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.vue']
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['scripts/gen-voice-over-todo.ts']
  }
})
