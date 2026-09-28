/**
 * Sprite textures for the additive overlay pass: glowing 2D toon gears
 * (aethel-fold-GDD §2 "magic/energy … glowing 2D toon-style gears radiating
 * warm yellow light from inside paper folds"), a soft glow disc, and a
 * sparkle star.
 */

import type { CanvasTexture } from 'three'
import { HEX, css } from '../palette'
import { makeCanvas, toTexture } from './canvas'

export interface SpriteTextures {
  gear: CanvasTexture
  glow: CanvasTexture
  star: CanvasTexture
  ring: CanvasTexture
  dispose(): void
}

const gearPath = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, teeth: number): void => {
  ctx.beginPath()
  const n = teeth * 4
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    const phase = i % 4
    const rr = phase === 1 || phase === 2 ? r * 1.22 : r
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
  }
  ctx.closePath()
}

export const createSpriteTextures = (): SpriteTextures => {
  // Gear: warm yellow toon gear with a glow halo baked in.
  const [gc, g] = makeCanvas(256, 256)
  const halo = g.createRadialGradient(128, 128, 30, 128, 128, 128)
  halo.addColorStop(0, css('gearGlow', 0.85))
  halo.addColorStop(0.55, css('gear', 0.35))
  halo.addColorStop(1, css('gear', 0))
  g.fillStyle = halo
  g.fillRect(0, 0, 256, 256)
  gearPath(g, 128, 128, 70, 10)
  g.fillStyle = HEX.gear
  g.fill()
  g.lineWidth = 7
  g.strokeStyle = HEX.goldDark
  g.stroke()
  g.beginPath()
  g.arc(128, 128, 26, 0, Math.PI * 2)
  g.fillStyle = HEX.gearGlow
  g.fill()
  g.stroke()
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    g.beginPath()
    g.arc(128 + Math.cos(a) * 48, 128 + Math.sin(a) * 48, 9, 0, Math.PI * 2)
    g.fillStyle = HEX.goldDark
    g.fill()
  }

  const [oc, o] = makeCanvas(128, 128)
  const og = o.createRadialGradient(64, 64, 0, 64, 64, 64)
  og.addColorStop(0, 'rgba(255,255,255,1)')
  og.addColorStop(0.35, 'rgba(255,255,255,0.55)')
  og.addColorStop(1, 'rgba(255,255,255,0)')
  o.fillStyle = og
  o.fillRect(0, 0, 128, 128)

  const [sc, s] = makeCanvas(128, 128)
  s.translate(64, 64)
  s.beginPath()
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const r = i % 2 ? 12 : 60
    s.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  s.closePath()
  s.fillStyle = 'rgba(255,255,255,0.95)'
  s.fill()

  const [rc, r] = makeCanvas(256, 256)
  r.beginPath()
  r.arc(128, 128, 110, 0, Math.PI * 2)
  r.lineWidth = 14
  r.strokeStyle = 'rgba(255,255,255,0.9)'
  r.stroke()

  const gear = toTexture(gc)
  const glow = toTexture(oc)
  const star = toTexture(sc)
  const ring = toTexture(rc)
  return {
    gear, glow, star, ring,
    dispose() {
      gear.dispose()
      glow.dispose()
      star.dispose()
      ring.dispose()
    }
  }
}
