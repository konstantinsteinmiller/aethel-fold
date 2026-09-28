import path from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * `pnpm voice-over:generate` — runs ONLY the TTS pass.
 *
 * Same shape as `voiceover.vitest.config.ts` (see its header on the `node`
 * environment), with an hour-long timeout: a cold full run loads a dozen ONNX
 * voice models and spawns ffmpeg once per line, and vitest's five-second default
 * would kill it somewhere in the middle of the first model with no explanation.
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
    include: ['scripts/gen-voice-over.ts'],
    testTimeout: 3_600_000,
    hookTimeout: 3_600_000
  }
})
