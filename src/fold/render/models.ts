/**
 * Paper-craft model factories. Each returns a BufferGeometry (vertex-coloured,
 * flat-faceted) standing on y = 0, facing +z (toward the camera/player).
 * Geometries are cached — every tower on every page shares one.
 */

import { BufferGeometry, IcosahedronGeometry, Vector3 } from 'three'
import { PaperBuilder, assertFinite, col, shade, type Col } from './paperGeometry'

const cache = new Map<string, BufferGeometry>()
const cached = (key: string, make: () => BufferGeometry): BufferGeometry => {
  let g = cache.get(key)
  if (!g) {
    g = assertFinite(make(), key)
    // Shared across views: owners must not dispose it.
    g.userData.shared = true
    cache.set(key, g)
  }
  return g
}

// ─── Pop-up structures (rise from a wall fold) ─────────────────────────────

/** Round pop-up tower with a cone roof and a flag (GDD §6 "massive paper castle tower"). */
export const towerGeometry = (): BufferGeometry => cached('tower', () => {
  const b = new PaperBuilder()
  const r = 0.62
  b.drum(r, 1.75, 10, 'stone', 'stoneLight')
  // Brick bands.
  for (let y = 0.35; y < 1.7; y += 0.45) b.push().translate(0, y, 0).drum(r + 0.012, 0.05, 10, 'stoneDark').pop()
  // Crenellated crown.
  b.push().translate(0, 1.75, 0).drum(r + 0.1, 0.16, 10, 'stoneLight').pop()
  for (let i = 0; i < 10; i += 2) {
    const a = (i / 10) * Math.PI * 2
    b.push().translate(Math.cos(a) * (r + 0.02), 1.91, -Math.sin(a) * (r + 0.02)).rotate(0, a, 0).box(0.24, 0.2, 0.16, 'stone').pop()
  }
  // Roof.
  b.push().translate(0, 1.95, 0).cone(r + 0.2, 1.05, 10, 'roofRed', 'roofRedDark').pop()
  b.push().translate(0, 2.98, 0).flag(0.55, 'flagYellow').pop()
  // Door and windows (front, +z).
  b.push().translate(0, 0, r - 0.02).sheet([-0.2, 0, 0.2, 0, 0.2, 0.42, 0, 0.55, -0.2, 0.42], 'woodDark', 'woodDark').pop()
  b.push().translate(-0.22, 1.1, r - 0.08).rotate(0, 0.35, 0).sheet([-0.07, 0, 0.07, 0, 0.07, 0.22, -0.07, 0.22], 'ink').pop()
  b.push().translate(0.22, 1.1, r - 0.08).rotate(0, -0.35, 0).sheet([-0.07, 0, 0.07, 0, 0.07, 0.22, -0.07, 0.22], 'ink').pop()
  return b.build()
})

/** A crenellated wall segment `len` long (centred on x = 0). */
export const wallGeometry = (len: number): BufferGeometry => cached(`wall:${len.toFixed(2)}`, () => {
  const b = new PaperBuilder()
  const h = 0.95
  b.box(len, h, 0.3, 'stone', 'stoneLight', 'stoneDark', 'stone')
  // Brick courses on the front face.
  for (let y = 0.2; y < h; y += 0.24) {
    b.push().translate(0, y, 0.152).box(len * 0.98, 0.035, 0.01, 'stoneDark').pop()
  }
  const merlons = Math.max(3, Math.round(len / 0.5))
  b.crenels(len, 0.3, h, 0.24, merlons, 'stoneLight')
  // Little banner in the middle.
  b.push().translate(0, h + 0.24, 0).flag(0.7, 'enemyRed').pop()
  return b.build()
})

/** A heraldic paper shield on a fold-out stand. */
export const shieldGeometry = (): BufferGeometry => cached('shield', () => {
  const b = new PaperBuilder()
  const outline: number[] = []
  const w = 0.95
  const top = 1.35
  outline.push(-w, top, w, top, w, 0.62)
  for (let i = 1; i < 8; i++) {
    const t = i / 8
    outline.push(w * Math.cos(t * Math.PI / 2), 0.62 - Math.sin(t * Math.PI / 2) * 0.6)
  }
  outline.push(0, 0.0)
  for (let i = 7; i >= 1; i--) {
    const t = i / 8
    outline.push(-w * Math.cos(t * Math.PI / 2), 0.62 - Math.sin(t * Math.PI / 2) * 0.6)
  }
  outline.push(-w, 0.62)
  // Rim (gold) then field (blue) slightly in front.
  b.sheet(outline, 'gold', 'parchmentShade', 0.05)
  const inner = outline.map((v, i) => (i % 2 === 0 ? v * 0.86 : 0.06 + v * 0.9))
  b.push().translate(0, 0, 0.03).sheet(inner, 'heroBlue', 'heroBlue').pop()
  // Star emblem.
  const star: number[] = []
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i / 10) * Math.PI * 2
    const r = i % 2 ? 0.14 : 0.34
    star.push(Math.cos(a) * r, 0.78 + Math.sin(a) * r)
  }
  b.push().translate(0, 0, 0.045).sheet(star, 'flagYellow', 'flagYellow').pop()
  // Fold-out stand behind it.
  b.push().translate(0, 0, -0.35).rotate(-0.45, 0, 0).box(0.5, 0.9, 0.04, 'parchmentShade').pop()
  return b.build()
})

// ─── Scenery ───────────────────────────────────────────────────────────────

/** Pop-up pine: three stacked paper cones on a trunk. */
export const pineGeometry = (): BufferGeometry => cached('pine', () => {
  const b = new PaperBuilder()
  b.box(0.14, 0.32, 0.14, 'woodDark')
  b.push().translate(0, 0.22, 0).cone(0.62, 0.8, 7, 'forest', 'forestDark').pop()
  b.push().translate(0, 0.6, 0).cone(0.5, 0.72, 7, 'forest', 'forestDark').pop()
  b.push().translate(0, 0.98, 0).cone(0.36, 0.62, 7, 'meadowDark', 'forestDark').pop()
  return b.build()
})

/** Round folded tree (a faceted ball on a trunk). */
export const roundTreeGeometry = (): BufferGeometry => cached('roundTree', () => {
  const b = new PaperBuilder()
  b.box(0.16, 0.45, 0.16, 'woodDark')
  const ico = new IcosahedronGeometry(0.5, 0).toNonIndexed()
  const p = ico.getAttribute('position')
  const v = new Vector3()
  const colors: Col[] = ['forest', 'meadowDark', 'forestDark']
  for (let i = 0; i < p.count; i += 3) {
    const tri: number[] = []
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(p, i + k)
      tri.push(v.x, v.y * 0.9 + 0.82, v.z)
    }
    b.tri(tri[0]!, tri[1]!, tri[2]!, tri[3]!, tri[4]!, tri[5]!, tri[6]!, tri[7]!, tri[8]!, colors[(i / 3) % 3]!)
  }
  ico.dispose()
  return b.build()
})

export const bushGeometry = (): BufferGeometry => cached('bush', () => {
  const b = new PaperBuilder()
  b.push().scale(1, 0.7, 1).cone(0.32, 0.45, 6, 'meadowDark', 'forest').pop()
  b.push().translate(0.22, 0, 0.05).scale(1, 0.7, 1).cone(0.24, 0.36, 6, 'forest', 'meadowDark').pop()
  return b.build()
})

export const rockGeometry = (): BufferGeometry => cached('rock', () => {
  const b = new PaperBuilder()
  const ico = new IcosahedronGeometry(0.3, 0).toNonIndexed()
  const p = ico.getAttribute('position')
  const v = new Vector3()
  for (let i = 0; i < p.count; i += 3) {
    const tri: number[] = []
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(p, i + k)
      tri.push(v.x * 1.3, Math.max(0, v.y * 0.8 + 0.14), v.z)
    }
    b.tri(tri[0]!, tri[1]!, tri[2]!, tri[3]!, tri[4]!, tri[5]!, tri[6]!, tri[7]!, tri[8]!, (i / 3) % 2 ? 'rock' : 'rockDark')
  }
  ico.dispose()
  return b.build()
})

/** Battlement strip the page-3 archers stand on. */
export const battlementGeometry = (len: number): BufferGeometry => cached(`battlement:${len}`, () => {
  const b = new PaperBuilder()
  b.box(len, 0.55, 0.9, 'stone', 'stoneLight', 'stoneDark', 'stone')
  b.push().translate(0, 0, 0.38).crenels(len, 0.14, 0.55, 0.22, Math.round(len / 0.45), 'stoneLight').pop()
  for (let x = -len / 2 + 0.6; x < len / 2; x += 1.6) b.push().translate(x, 0.75, -0.4).flag(0.8, 'enemyRed').pop()
  return b.build()
})

// ─── Units & projectiles ───────────────────────────────────────────────────

/** Paper catapult: base, wheels, throwing arm (arm is a separate geometry). */
export const catapultBaseGeometry = (): BufferGeometry => cached('catapultBase', () => {
  const b = new PaperBuilder()
  b.push().translate(0, 0.12, 0).box(0.9, 0.16, 1.1, 'wood', 'wood', 'woodDark').pop()
  for (const x of [-0.5, 0.5]) {
    for (const z of [-0.38, 0.38]) {
      b.push().translate(x, 0.2, z).rotate(0, 0, Math.PI / 2).drum(0.2, 0.08, 8, 'woodDark', 'wood').pop()
    }
  }
  // Uprights + crossbar.
  b.push().translate(-0.34, 0.28, -0.1).box(0.1, 0.62, 0.1, 'woodDark').pop()
  b.push().translate(0.34, 0.28, -0.1).box(0.1, 0.62, 0.1, 'woodDark').pop()
  b.push().translate(0, 0.86, -0.1).box(0.78, 0.1, 0.12, 'wood').pop()
  // Red pennant.
  b.push().translate(0.34, 0.9, -0.1).flag(0.45, 'enemyRed').pop()
  return b.build()
})

export const catapultArmGeometry = (): BufferGeometry => cached('catapultArm', () => {
  const b = new PaperBuilder()
  // Pivot at origin, arm points toward +z (the player) at rest, cup at the tip.
  b.push().translate(0, 0, 0.35).box(0.1, 0.08, 0.95, 'woodDark', 'wood').pop()
  b.push().translate(0, 0.02, 0.82).cone(0.18, 0.14, 7, 'wood', 'woodDark').pop()
  return b.build()
})

export const arrowGeometry = (): BufferGeometry => cached('arrow', () => {
  const b = new PaperBuilder()
  // Along +z, centred.
  b.push().translate(0, -0.02, -0.34).box(0.035, 0.035, 0.7, 'wood', 'wood').pop()
  b.push().translate(0, 0, 0.36).rotate(Math.PI / 2, 0, 0).cone(0.06, 0.16, 4, 'steelDark').pop()
  b.push().translate(0, 0, -0.3).sheet([-0.1, 0, 0, 0.12, 0.1, 0, 0, -0.02], 'enemyRed', 'enemyRed').pop()
  return b.build()
})

/** A crumpled paper ball — the catapult's boulder (and the crumpled page in miniature). */
export const boulderGeometry = (): BufferGeometry => cached('boulder', () => {
  const b = new PaperBuilder()
  const ico = new IcosahedronGeometry(0.3, 1).toNonIndexed()
  const p = ico.getAttribute('position')
  const v = new Vector3()
  const jitter = (x: number, y: number, z: number): number => 1 + Math.sin(x * 13.1 + y * 7.7) * 0.14 + Math.cos(z * 11.3 - x * 5.1) * 0.12
  for (let i = 0; i < p.count; i += 3) {
    const tri: number[] = []
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(p, i + k)
      const j = jitter(v.x, v.y, v.z)
      tri.push(v.x * j, v.y * j, v.z * j)
    }
    b.tri(tri[0]!, tri[1]!, tri[2]!, tri[3]!, tri[4]!, tri[5]!, tri[6]!, tri[7]!, tri[8]!, (i / 3) % 3 === 0 ? 'stone' : (i / 3) % 3 === 1 ? 'stoneDark' : 'rock')
  }
  ico.dispose()
  return b.build()
})

/** Heart for the hero's banner / lens bursts. */
export const heartGeometry = (): BufferGeometry => cached('heart', () => {
  const b = new PaperBuilder()
  const pts: [number, number][] = []
  for (let i = 0; i < 24; i++) {
    const t = (i / 24) * Math.PI * 2
    const x = 16 * Math.pow(Math.sin(t), 3)
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
    pts.push([x / 34, y / 34 + 0.5])
  }
  // The parametric curve runs clockwise; sheets want counter-clockwise.
  pts.reverse()
  b.sheet(pts.flat(), 'danger', 'enemyRedDark', 0.04)
  return b.build()
})

/** The hero's banner: a pole with a long blue pennant. */
export const bannerGeometry = (): BufferGeometry => cached('banner', () => {
  const b = new PaperBuilder()
  b.box(0.06, 1.9, 0.06, 'woodDark')
  b.push().translate(0, 1.92, 0).cone(0.08, 0.14, 5, 'gold').pop()
  b.push().translate(0.03, 1.8, 0).sheet([0, 0, 0.8, -0.12, 0.62, -0.3, 0.8, -0.5, 0, -0.62], 'heroBlue', 'heroBlueDark', 0.02).pop()
  b.push().translate(0.25, 1.49, 0.02).sheet([-0.08, -0.08, 0.08, -0.08, 0.08, 0.08, -0.08, 0.08], 'flagYellow', 'flagYellow').pop()
  return b.build()
})

// ─── Desk props (seen in landscape) ────────────────────────────────────────

/** Classic origami crane — the game's mascot, resting on the desk. */
export const craneGeometry = (c: Col = 'c3'): BufferGeometry => cached(`crane:${String(c)}`, () => {
  const b = new PaperBuilder()
  const k = col(c)
  const dk = shade(c, 0.78)
  const lt = shade(c, 1.15)
  // Body (diamond).
  b.tri(0, 0.35, 0.5, -0.28, 0.2, 0, 0, 0, 0, k)
  b.tri(0, 0.35, 0.5, 0, 0, 0, 0.28, 0.2, 0, dk)
  b.tri(0, 0.35, -0.5, 0, 0, 0, -0.28, 0.2, 0, dk)
  b.tri(0, 0.35, -0.5, 0.28, 0.2, 0, 0, 0, 0, k)
  // Wings (up).
  b.tri(-0.28, 0.2, 0, -1.05, 0.95, -0.1, 0, 0.38, 0.1, lt)
  b.tri(-0.28, 0.2, 0, 0, 0.38, 0.1, -1.05, 0.95, -0.1, dk)
  b.tri(0.28, 0.2, 0, 0, 0.38, 0.1, 1.05, 0.95, -0.1, lt)
  b.tri(0.28, 0.2, 0, 1.05, 0.95, -0.1, 0, 0.38, 0.1, dk)
  // Neck + head.
  b.tri(0, 0.35, 0.5, 0.04, 0.95, 0.85, -0.04, 0.3, 0.4, k)
  b.tri(0, 0.35, 0.5, -0.04, 0.3, 0.4, 0.04, 0.95, 0.85, dk)
  b.tri(0.04, 0.95, 0.85, 0, 0.82, 1.08, -0.02, 0.9, 0.82, lt)
  // Tail.
  b.tri(0, 0.35, -0.5, -0.04, 0.3, -0.4, 0.04, 0.88, -0.95, k)
  b.tri(0, 0.35, -0.5, 0.04, 0.88, -0.95, -0.04, 0.3, -0.4, dk)
  return b.build()
})

/** A folded paper boat for the desk. */
export const boatGeometry = (): BufferGeometry => cached('boat', () => {
  const b = new PaperBuilder()
  b.quad([-0.9, 0.28, 0.25], [0.9, 0.28, 0.25], [0.55, 0, 0], [-0.55, 0, 0], 'paperWhite')
  b.quad([0.9, 0.28, -0.25], [-0.9, 0.28, -0.25], [-0.55, 0, 0], [0.55, 0, 0], 'parchmentShade')
  b.tri(-0.5, 0.28, 0.22, 0.5, 0.28, 0.22, 0, 0.85, 0, 'paperWhite')
  b.tri(0.5, 0.28, -0.22, -0.5, 0.28, -0.22, 0, 0.85, 0, 'parchmentShade')
  return b.build()
})

export const pencilGeometry = (): BufferGeometry => cached('pencil', () => {
  const b = new PaperBuilder()
  b.push().rotate(0, 0, Math.PI / 2).drum(0.09, 2.6, 6, 'flagYellow', 'wood').pop()
  b.push().translate(0, 0, 0).rotate(0, 0, -Math.PI / 2).cone(0.09, 0.32, 6, 'wood').pop()
  b.push().translate(-2.6, 0, 0).rotate(0, 0, Math.PI / 2).drum(0.095, 0.2, 6, 'c7').pop()
  return b.build()
})

export const disposeModelCache = (): void => {
  for (const g of cache.values()) g.dispose()
  cache.clear()
}
