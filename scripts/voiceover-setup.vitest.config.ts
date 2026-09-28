import path from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * `pnpm voice-over:setup` — runs ONLY the toolchain bootstrap.
 *
 * Node environment (it shells out to pip and curl and touches no DOM) and an
 * hour-long timeout, because it pip-installs and then pulls a few hundred
 * megabytes of voice models over the network.
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
    include: ['scripts/vo-setup.ts'],
    testTimeout: 3_600_000,
    hookTimeout: 3_600_000
  }
})
