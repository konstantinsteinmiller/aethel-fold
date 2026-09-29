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

// ─── Book 2: the hero's keep, the sling, and the new scenery ───────────────

/**
 * The player's castle along the bottom edge of every page (origin = page
 * centre line at the castle's z; see CASTLE in logic/config):
 *   keep in the middle — the hero stands on its flat, crenellated roof;
 *   two low ballista towers at ±towerX with flat tops (the ballistas mount there);
 *   low curtain walls between them and small corner towers at the edges.
 * Nothing is taller than ~1 unit: from the steep desk camera a higher castle
 * would hide the enemies and folds just above it.
 */
export const playerCastleGeometry = (keepZ: number, towerX: number, towerZ: number, keepTop: number, towerTop: number): BufferGeometry =>
  cached(`playerCastle:${keepZ}:${towerX}:${towerZ}`, () => {
    const b = new PaperBuilder()
    const wallZ = 6.62
    // Keep: a squat square tower, door facing the page, flag at the back.
    b.push().translate(0, 0, keepZ).box(1.35, keepTop, 0.95, 'stone', 'stoneLight', 'stoneDark', 'stone').pop()
    b.push().translate(0, keepTop, keepZ + 0.38).crenels(1.35, 0.14, 0, 0.16, 5, 'stoneLight').pop()
    b.push().translate(0, keepTop, keepZ - 0.38).crenels(1.35, 0.14, 0, 0.16, 5, 'stoneLight').pop()
    b.push().translate(0, 0.02, keepZ - 0.48).box(0.36, 0.5, 0.02, 'woodDark').pop()
    b.push().translate(0, 0.52, keepZ - 0.49).box(0.44, 0.06, 0.02, 'heroBlueDark').pop()
    b.push().translate(0.5, keepTop, keepZ + 0.3).flag(0.75, 'heroBlue').pop()
    for (const s of [-1, 1]) {
      // Ballista tower: flat top, blue band.
      b.push().translate(s * towerX, 0, towerZ).drum(0.42, towerTop, 8, 'stone', 'stoneLight').pop()
      b.push().translate(s * towerX, towerTop - 0.16, towerZ).drum(0.45, 0.1, 8, 'heroBlue').pop()
      // Curtain walls: keep → tower, tower → corner.
      const inner0 = 0.68
      const inner1 = towerX - 0.4
      b.push().translate(s * (inner0 + inner1) / 2, 0, wallZ).box(inner1 - inner0, 0.4, 0.3, 'stone', 'stoneLight', 'stoneDark', 'stone').pop()
      const outer0 = towerX + 0.4
      const outer1 = 4.55
      b.push().translate(s * (outer0 + outer1) / 2, 0, wallZ).box(outer1 - outer0, 0.4, 0.3, 'stone', 'stoneLight', 'stoneDark', 'stone').pop()
      b.push().translate(s * (outer0 + outer1) / 2, 0.4, wallZ).crenels(outer1 - outer0, 0.12, 0, 0.13, 4, 'stoneLight').pop()
      // Corner tower.
      b.push().translate(s * 4.72, 0, wallZ).drum(0.26, 0.62, 7, 'stone', 'stoneLight').pop()
      b.push().translate(s * 4.72, 0.62, wallZ).cone(0.33, 0.36, 7, 'roofBlue', 'heroBlueDark').pop()
    }
    return b.build()
  })

/**
 * The rest of the player's castle, unfolding out past the bottom edge of the
 * page (decorative — nothing plays there). A fold-out card level with the page
 * carries the courtyard: side walls running back from the front wall's corner
 * towers, a big keep with corner turrets in the middle, two houses, and a back
 * wall with a gatehouse and corner towers. The screen may cut it off.
 *
 * Height budget: from the steep desk camera, a point at depth z and height y
 * lands on screen where `0.53·y − 0.85·z` puts it; everything here stays below
 * the page's bottom edge (z = 7, y = 0), so it never covers the page, the
 * ballista towers or the hero. That's why the front of the keep is lower than
 * its roof ridge further back.
 */
export const castleBaileyGeometry = (): BufferGeometry => cached('castleBailey', () => {
  const b = new PaperBuilder()
  const z0 = 7.02
  const z1 = 11.2
  // The fold-out card: level with the page, a paper edge all round.
  b.push().translate(0, -0.05, (z0 + z1) / 2).box(10, 0.05, z1 - z0, 'parchmentEdge', 'stoneLight', 'parchmentShade', 'parchmentEdge').pop()
  // A paved path from the gatehouse on the page to the keep.
  b.push().translate(0, 0.002, 7.45).box(0.9, 0.01, 0.8, 'stone').pop()
  const wallH = 0.5
  const backZ = 10.7
  for (const s of [-1, 1]) {
    // Side wall, running back from the front corner tower.
    const len = backZ - 6.7
    b.push().translate(s * 4.72, 0, (6.7 + backZ) / 2).rotate(0, Math.PI / 2, 0)
      .box(len, wallH, 0.28, 'stone', 'stoneLight', 'stoneDark', 'stone')
      .push().translate(0, wallH, 0).crenels(len, 0.12, 0, 0.13, 9, 'stoneLight').pop()
      .pop()
    // Back corner tower.
    b.push().translate(s * 4.72, 0, backZ).drum(0.36, 0.95, 8, 'stone', 'stoneLight').pop()
    b.push().translate(s * 4.72, 0.95, backZ).cone(0.46, 0.55, 8, 'roofBlue', 'heroBlueDark').pop()
    // A house either side of the keep.
    b.push().translate(s * 2.75, 0, 9.1).box(1.1, 0.5, 0.8, 'paperWhite', 'parchment', 'parchmentShade', 'paperWhite').pop()
    b.push().translate(s * 2.75, 0.5, 9.1).pyramid(1.2, 0.9, 0.45, 'roofRed').pop()
    b.push().translate(s * 2.75, 0.02, 8.69).box(0.22, 0.32, 0.02, 'woodDark').pop()
  }
  // Back wall with a gatehouse in the middle.
  b.push().translate(0, 0, backZ).box(9.44, wallH + 0.1, 0.3, 'stone', 'stoneLight', 'stoneDark', 'stone').pop()
  b.push().translate(0, wallH + 0.1, backZ).crenels(9.44, 0.12, 0, 0.14, 15, 'stoneLight').pop()
  b.push().translate(0, 0, backZ).box(1.5, 1.05, 0.6, 'stone', 'stoneLight', 'stoneDark', 'stone').pop()
  b.push().translate(0, 1.05, backZ).pyramid(1.6, 0.7, 0.45, 'roofRed').pop()
  // The keep: a tall hall with four corner turrets and a blue roof.
  const kz = 8.85
  b.push().translate(0, 0, kz).box(2.3, 1.45, 1.5, 'stone', 'stoneLight', 'stoneDark', 'stone').pop()
  b.push().translate(0, 1.45, kz).pyramid(2.1, 1.3, 0.75, 'roofBlue').pop()
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const tx = sx * 1.12
      const tz = kz + sz * 0.72
      b.push().translate(tx, 0, tz).drum(0.26, 1.75, 7, 'stoneLight', 'stone').pop()
      b.push().translate(tx, 1.75, tz).cone(0.33, 0.5, 7, 'roofBlue', 'heroBlueDark').pop()
    }
  }
  // Door and windows on the keep's face toward the page.
  b.push().translate(0, 0.01, kz - 0.76).box(0.45, 0.62, 0.02, 'woodDark').pop()
  for (const wx of [-0.6, 0.6]) b.push().translate(wx, 0.85, kz - 0.76).box(0.2, 0.28, 0.02, 'ink').pop()
  b.push().translate(0.2, 2.2, kz).flag(0.7, 'heroBlue').pop()
  return b.build()
})

/**
 * A paper ballista, standing on its mount (origin), shooting toward -z: a
 * stock with a bolt in the groove and a bow across the front.
 */
export const ballistaGeometry = (): BufferGeometry => cached('ballista', () => {
  const b = new PaperBuilder()
  b.drum(0.2, 0.12, 6, 'woodDark', 'wood')
  b.push().translate(0, 0.12, 0).box(0.1, 0.18, 0.1, 'woodDark').pop()
  // Stock along -z.
  b.push().translate(0, 0.3, -0.1).box(0.16, 0.1, 0.8, 'wood', 'wood', 'woodDark').pop()
  // Bolt, with a blue fletching.
  b.push().translate(0, 0.38, -0.12).box(0.04, 0.04, 0.86, 'paperWhite').pop()
  b.push().translate(0, 0.38, -0.6).rotate(-Math.PI / 2, 0, 0).cone(0.05, 0.12, 4, 'steelDark').pop()
  b.push().translate(0, 0.38, 0.26).box(0.14, 0.02, 0.1, 'heroBlue').pop()
  // Bow arms, swept back.
  for (const s of [-1, 1]) {
    b.push().translate(s * 0.26, 0.33, -0.44).rotate(0, s * 0.45, 0).box(0.5, 0.07, 0.07, 'heroBlue', 'heroBlueDark').pop()
  }
  return b.build()
})

/** The keep's sling: a sturdy paper Y-fork on a block. Band tips at (±0.3, 0.95, 0). */
export const slingForkGeometry = (): BufferGeometry => cached('slingFork', () => {
  const b = new PaperBuilder()
  b.box(0.62, 0.18, 0.46, 'woodDark', 'wood')
  b.push().translate(0, 0.18, 0).box(0.14, 0.38, 0.14, 'wood').pop()
  for (const s of [-1, 1]) {
    b.push().translate(s * 0.15, 0.5, 0).rotate(0, 0, -s * 0.5).box(0.11, 0.5, 0.11, 'wood').pop()
    b.push().translate(s * 0.3, 0.9, 0).box(0.14, 0.1, 0.14, 'heroBlue').pop()
  }
  b.push().translate(-0.26, 0.16, 0.24).flag(0.62, 'heroBlue').pop()
  return b.build()
})

/** A wadded paper ball — the sling's stone (white, with a blue stripe). */
export const paperBallGeometry = (): BufferGeometry => cached('paperBall', () => {
  const b = new PaperBuilder()
  const ico = new IcosahedronGeometry(0.2, 1).toNonIndexed()
  const p = ico.getAttribute('position')
  const v = new Vector3()
  const jitter = (x: number, y: number, z: number): number => 1 + Math.sin(x * 17.1 + y * 9.7) * 0.12 + Math.cos(z * 13.3 - x * 6.1) * 0.1
  for (let i = 0; i < p.count; i += 3) {
    const tri: number[] = []
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(p, i + k)
      const j = jitter(v.x, v.y, v.z)
      tri.push(v.x * j, v.y * j, v.z * j)
    }
    const f = i / 3
    b.tri(tri[0]!, tri[1]!, tri[2]!, tri[3]!, tri[4]!, tri[5]!, tri[6]!, tri[7]!, tri[8]!, f % 7 === 0 ? 'heroBlue' : f % 2 ? 'paperWhite' : 'parchmentShade')
  }
  ico.dispose()
  return b.build()
})

/** An orchard tree: a round folded crown dotted with red paper apples. */
export const appleTreeGeometry = (): BufferGeometry => cached('appleTree', () => {
  const b = new PaperBuilder()
  b.box(0.16, 0.42, 0.16, 'woodDark')
  const ico = new IcosahedronGeometry(0.52, 0).toNonIndexed()
  const p = ico.getAttribute('position')
  const v = new Vector3()
  const colors: Col[] = ['meadowDark', 'forest', 'meadow']
  for (let i = 0; i < p.count; i += 3) {
    const tri: number[] = []
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(p, i + k)
      tri.push(v.x, v.y * 0.85 + 0.8, v.z)
    }
    b.tri(tri[0]!, tri[1]!, tri[2]!, tri[3]!, tri[4]!, tri[5]!, tri[6]!, tri[7]!, tri[8]!, colors[(i / 3) % 3]!)
  }
  ico.dispose()
  for (let k = 0; k < 6; k++) {
    const a = k * 1.9
    b.push().translate(Math.cos(a) * 0.42, 0.62 + (k % 3) * 0.2, Math.sin(a) * 0.42 + 0.08).box(0.12, 0.12, 0.12, 'c1', 'enemyRed').pop()
  }
  return b.build()
})

/** A striped enemy tent (the siege camp). */
export const tentGeometry = (): BufferGeometry => cached('tent', () => {
  const b = new PaperBuilder()
  const n = 8
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2
    const a1 = ((i + 1) / n) * Math.PI * 2
    const c: Col = i % 2 ? 'enemyRed' : 'paperWhite'
    b.tri(Math.cos(a0) * 0.62, 0, -Math.sin(a0) * 0.62, Math.cos(a1) * 0.62, 0, -Math.sin(a1) * 0.62, 0, 0.95, 0, c)
  }
  b.push().translate(0, 0.9, 0).flag(0.4, 'enemyRed').pop()
  return b.build()
})

/** Windmill tower (the sails are a separate geometry so they can turn). */
export const millTowerGeometry = (): BufferGeometry => cached('millTower', () => {
  const b = new PaperBuilder()
  b.drum(0.55, 1.5, 8, 'paperWhite', 'parchmentShade')
  b.push().translate(0, 1.5, 0).cone(0.68, 0.6, 8, 'roofRed', 'roofRedDark').pop()
  b.push().translate(0, 0, 0.5).box(0.3, 0.5, 0.1, 'woodDark').pop()
  return b.build()
})

/** Four paper sails around the origin, in the XY plane. */
export const millSailsGeometry = (): BufferGeometry => cached('millSails', () => {
  const b = new PaperBuilder()
  for (let k = 0; k < 4; k++) {
    b.push().rotate(0, 0, (k * Math.PI) / 2)
      .sheet([0.08, 0.1, 0.3, 0.12, 0.3, 1.05, 0.08, 1.05], k % 2 ? 'parchment' : 'paperWhite', 'parchmentShade', 0.02)
      .pop()
  }
  b.push().translate(0, 0, 0.02).drum(0.09, 0.08, 6, 'woodDark').pop()
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
