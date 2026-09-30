import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AD_PLATFORM_ENV_KEYS, resolveAdFlags } from '@/platforms/adFlags'

// Which builds get ads (roadmaps #9, #17, #19). Only platforms whose build
// resolves a real ad provider may carry them. The jury build is the itch.io
// build (`.env.itch.example`); it, the plain default web build and the other
// portals without an ad SDK never carry ads, whatever their `.env` says.

const ROOT = resolve(__dirname, '../..')

const parseEnv = (file: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const line of readFileSync(resolve(ROOT, file), 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m) out[m[1]!] = m[2]!.trim()
  }
  return out
}

/** Every template, and what it must resolve to. */
const MATRIX: Record<string, { rewarded: boolean; interstitials: boolean }> = {
  '.env.example': { rewarded: false, interstitials: false }, // plain default web
  '.env.itch.example': { rewarded: false, interstitials: false }, // itch.io = the jury build
  '.env.glitch.example': { rewarded: false, interstitials: false },
  '.env.wavedash.example': { rewarded: false, interstitials: false },
  '.env.crazy-web.example': { rewarded: true, interstitials: true },
  '.env.game-distribution.example': { rewarded: true, interstitials: true },
  '.env.gamemonetize.example': { rewarded: true, interstitials: true },
  '.env.gamepix.example': { rewarded: true, interstitials: true },
  '.env.playgama.example': { rewarded: true, interstitials: true },
  '.env.yandex.example': { rewarded: true, interstitials: true },
  '.env.poki.example': { rewarded: true, interstitials: true }
}

describe('ad flag matrix per platform template', () => {
  it('covers every .env.*.example in the repo', () => {
    const files = readdirSync(ROOT).filter((f) => /^\.env(\.[\w-]+)?\.example$/.test(f)).sort()
    expect(files).toEqual(Object.keys(MATRIX).sort())
  })

  it.each(Object.entries(MATRIX))('%s', (file, want) => {
    const env = parseEnv(file)
    // Every template states both flags explicitly.
    expect(env.VITE_APP_REWARDED).toBeDefined()
    expect(env.VITE_APP_INTERSTITIALS).toBeDefined()
    const got = resolveAdFlags(env)
    expect({ rewarded: got.rewarded, interstitials: got.interstitials }).toEqual(want)
  })

  it('the jury build (the itch.io template) has no ads, even with both flags forced on', () => {
    const env = parseEnv('.env.itch.example')
    expect(env.VITE_APP_ITCH).toBe('true')
    expect(resolveAdFlags(env)).toEqual({ adPlatform: false, rewarded: false, interstitials: false })
    expect(resolveAdFlags({ ...env, VITE_APP_REWARDED: 'true', VITE_APP_INTERSTITIALS: 'true' }))
      .toEqual({ adPlatform: false, rewarded: false, interstitials: false })
  })

  it('the plain default web build (no .env at all) has no ads', () => {
    expect(resolveAdFlags({})).toEqual({ adPlatform: false, rewarded: false, interstitials: false })
  })

  it.each(['VITE_APP_ITCH', 'VITE_APP_GLITCH', 'VITE_APP_WAVEDASH'])('%s ignores the flags even if set by mistake', (key) => {
    expect(resolveAdFlags({ [key]: 'true', VITE_APP_REWARDED: 'true', VITE_APP_INTERSTITIALS: 'true' }))
      .toEqual({ adPlatform: false, rewarded: false, interstitials: false })
  })

  it.each(AD_PLATFORM_ENV_KEYS.map((k) => [k]))('%s honours each flag on its own', (key) => {
    expect(resolveAdFlags({ [key]: 'true' })).toEqual({ adPlatform: true, rewarded: false, interstitials: false })
    expect(resolveAdFlags({ [key]: 'true', VITE_APP_REWARDED: 'true' }).rewarded).toBe(true)
    expect(resolveAdFlags({ [key]: 'true', VITE_APP_INTERSTITIALS: 'true' }).interstitials).toBe(true)
  })
})

describe('build constants', () => {
  afterEach(() => vi.unstubAllEnvs())

  const load = async () => {
    vi.resetModules()
    return import('@/platforms/adFlags')
  }

  it('are off in the plain default / test config', async () => {
    const f = await load()
    expect(f.REWARDED_ADS).toBe(false)
    expect(f.INTERSTITIAL_ADS).toBe(false)
    expect(f.ANY_FOLD_ADS).toBe(false)
  })

  it('are off in the jury (itch.io) build even with the flags set', async () => {
    vi.stubEnv('VITE_APP_ITCH', 'true')
    vi.stubEnv('VITE_APP_REWARDED', 'true')
    vi.stubEnv('VITE_APP_INTERSTITIALS', 'true')
    const f = await load()
    expect(f.REWARDED_ADS).toBe(false)
    expect(f.INTERSTITIAL_ADS).toBe(false)
  })

  it('agree with resolveAdFlags on an ad platform', async () => {
    vi.stubEnv('VITE_APP_YANDEX', 'true')
    vi.stubEnv('VITE_APP_INTERSTITIALS', 'true')
    const f = await load()
    expect(f.INTERSTITIAL_ADS).toBe(true)
    expect(f.REWARDED_ADS).toBe(false)
    expect(f.ANY_FOLD_ADS).toBe(true)
  })
})
