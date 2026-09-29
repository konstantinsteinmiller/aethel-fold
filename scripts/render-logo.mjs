/**
 * Rasterise the logo (src/components/atoms/logoArt.ts) into the files the
 * manifest, the portals and the store pages use:
 *   public/images/logo/logo_512x512.png
 *   public/images/logo/logo_192x192.png
 *   public/images/logo/logo_256x256.webp
 *
 *   node scripts/render-logo.mjs
 *
 * Renders in the bundled Chromium with the real 'Angry' font embedded, on a
 * transparent background.
 */
import { transformWithEsbuild } from 'vite'
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const out = join(root, 'public/images/logo')
mkdirSync(out, { recursive: true })

const tmp = join(tmpdir(), `logoArt-${process.pid}.mjs`)
// logoArt.ts has no imports: a plain TS → JS transform is enough.
const src = join(root, 'src/components/atoms/logoArt.ts')
const { code } = await transformWithEsbuild(readFileSync(src, 'utf8'), src, { format: 'esm' })
writeFileSync(tmp, code)
const { logoSvg } = await import(tmp)

const font = readFileSync(join(root, 'src/assets/css/font/angrybirds-regular.ttf')).toString('base64')
const html = (size) => `<!doctype html><html><head><style>
  @font-face { font-family: 'Angry'; src: url(data:font/ttf;base64,${font}) format('truetype'); }
  html, body { margin: 0; background: transparent; }
  svg { width: ${size}px; height: ${size}px; display: block; }
</style></head><body>${logoSvg()}</body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1 })
const shoot = async (size) => {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(html(size))
  await page.evaluate(() => document.fonts.ready)
  return page.screenshot({ omitBackground: true, type: 'png', clip: { x: 0, y: 0, width: size, height: size } })
}
writeFileSync(join(out, 'logo_512x512.png'), await shoot(512))
writeFileSync(join(out, 'logo_192x192.png'), await shoot(192))
// WebP straight from the browser's encoder (keeps alpha).
const png256 = (await shoot(256)).toString('base64')
const webp = await page.evaluate(async (b64) => {
  const img = new Image()
  img.src = `data:image/png;base64,${b64}`
  await img.decode()
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  c.getContext('2d').drawImage(img, 0, 0)
  return c.toDataURL('image/webp', 0.92).split(',')[1]
}, png256)
writeFileSync(join(out, 'logo_256x256.webp'), Buffer.from(webp, 'base64'))
await browser.close()
console.log('logo written to', out)
