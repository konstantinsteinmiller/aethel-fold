/**
 * One fold line on the page, drawn: its paper panel(s) on hinge pivots, the
 * glowing dotted guide, and — for walls — the pop-up that SNAPs out of the
 * crease (tower, battlement or heraldic shield).
 *
 *   wall   — one panel lifts to 90°; the pop-up springs up on the hinge.
 *   valley — two panels dip into a V (the ravine), stretched so they meet.
 *   launch — one panel flips 180° over its hinge.
 *   ridge  — two panels rise into a ∧ mountain.
 *   ballista — no panel: a ballista lies folded on a castle tower and flips
 *            upright (t → 1), turning toward each bolt's aim point.
 *   boat   — book 3: the dock flap lifts and shrinks into a paper boat that
 *            grows at the dock (t → 1), then sails the channel out and back
 *            (`sail`, the bow at `boatPoint`), and unfolds into the flap again.
 *   pleat  — book 3: an accordion of 2 × n half-panels. Section k is a ∧
 *            (two half-panels rising to a mountain crease in its middle) that
 *            closes as `pleatFold(k)` goes 0 → 1; the closed sections bunch up
 *            toward the strip's bottom edge, which stays put, so the top of
 *            the strip opens onto the layer beneath as the accordion shuts.
 *
 * A lesson's first-encounter demonstration (roadmap #4) draws a *ghost* of the
 * flap — a translucent, ink-free copy sharing the real geometry — posed by the
 * demo's progress, so the paper shows the move in sync with the ghost hand
 * while the real flap stays exactly where the game has it.
 */

import { Group, Mesh, type BufferGeometry, type Texture } from 'three'
import type { FoldState } from '../../logic/types'
import { boatAlong, grabLength, isSailing, pleatCount, pleatFold } from '../../logic/folds'
import { clamp01, easeOutBack } from '../../logic/math'
import { createPaperMaterial, type PaperMaterial } from '../paperMaterial'
import { ballistaGeometry, paperBoatGeometry, shieldGeometry, snowyGeometry, towerGeometry, wallGeometry } from '../models'
import { CASTLE } from '../../logic/config'
import { buildFlapGeometry } from './flapGeometry'
import { GuideLine } from './GuideLine'
import { HEX } from '../palette'

const VALLEY_MAX = (24 * Math.PI) / 180
const RIDGE_MAX = (52 * Math.PI) / 180

class Panel {
  readonly pivot = new Group()
  readonly hinge = new Group()
  readonly mesh: Mesh
  private readonly sgn: number

  constructor(
    readonly ax: number, readonly az: number, private readonly ux: number, private readonly uz: number,
    len: number, private readonly w: number, mats: PaperMaterial[] | PaperMaterial, geometry?: BufferGeometry
  ) {
    this.sgn = Math.sign(w) || 1
    this.pivot.position.set(ax, 0.002, az)
    this.pivot.rotation.y = Math.atan2(-uz, ux)
    this.mesh = new Mesh(geometry ?? buildFlapGeometry(len, w, ax, az, ux, uz), mats)
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true
    this.hinge.add(this.mesh)
    this.pivot.add(this.hinge)
  }

  /** Positive angle lifts the far edge; negative dips it. */
  set(angle: number, stretch = 1): void {
    this.hinge.rotation.x = -this.sgn * angle
    this.mesh.scale.z = stretch
  }

  /** A panel on the same hinge sharing this one's geometry (the demo ghost; never disposed on its own). */
  twin(mat: PaperMaterial): Panel {
    return new Panel(this.ax, this.az, this.ux, this.uz, 0, this.w, mat, this.mesh.geometry)
  }

  dispose(): void {
    this.mesh.geometry.dispose()
  }
}

/** Pose a flap's panels for fold progress `t` (`extra` adds a wobble, radians). */
const posePanels = (panels: readonly Panel[], kind: string, t: number, extra = 0): void => {
  if (kind === 'wall') panels[0]!.set(t * (Math.PI / 2) + extra)
  else if (kind === 'launch') panels[0]!.set(t * Math.PI + extra)
  else if (kind === 'valley') {
    const a = t * VALLEY_MAX
    const st = 1 / Math.cos(a)
    panels[0]!.set(-a, st)
    panels[1]!.set(-a, st)
  } else if (kind === 'ridge') {
    const a = t * RIDGE_MAX
    const st = 1 / Math.cos(a)
    panels[0]!.set(a, st)
    panels[1]!.set(a, st)
  }
}

/**
 * Pose a pleat's half-panels (A then B per section, top section first) for
 * fold progress `t`. The strip's bottom edge stays put; each section's width
 * along the strip is 2·h·cos θ, so the shut sections bunch up toward it.
 * Allocation-free.
 */
const posePleat = (panels: readonly Panel[], f: FoldState, t: number): void => {
  const n = pleatCount(f)
  const hs = f.len / (n * 2)
  let bottom = f.len
  for (let k = n - 1; k >= 0; k--) {
    const a = pleatFold(f, k, t) * PLEAT_MAX
    const w = 2 * hs * Math.cos(a)
    const top = bottom - w
    const A = panels[k * 2]
    const B = panels[k * 2 + 1]
    if (A && B) {
      // Each panel keeps its hinge line's across position; only the along-strip offset moves.
      A.pivot.position.x = A.ax + f.ux * (top - k * 2 * hs)
      A.pivot.position.z = A.az + f.uz * (top - k * 2 * hs)
      B.pivot.position.x = B.ax + f.ux * (bottom - (k + 1) * 2 * hs)
      B.pivot.position.z = B.az + f.uz * (bottom - (k + 1) * 2 * hs)
      A.set(a)
      B.set(a)
    }
    bottom = top
  }
}

/** A pleat section shuts to nearly upright (paper has thickness). */
const PLEAT_MAX = (84 * Math.PI) / 180

/**
 * Pose the boat's dock flap and the boat for fold progress `t`: the flap lifts
 * and shrinks away as the boat grows at the dock. Sailing, the boat rides the
 * channel (`along` is its bow's along-channel position, `dir` +1 outward).
 */
const poseBoat = (flap: Panel, boat: Group, f: FoldState, t: number, along: number, dir: number, time: number): void => {
  const k = clamp01(t)
  flap.set(k * (Math.PI / 2))
  const shrink = Math.max(0.001, 1 - k * k)
  flap.pivot.scale.set(shrink, 1, shrink)
  flap.pivot.visible = shrink > 0.01
  const grow = easeOutBack(clamp01((k - 0.25) / 0.75), 1.8)
  boat.visible = grow > 0.01
  boat.scale.setScalar(Math.max(0.001, grow))
  boat.position.set(f.def.ax + f.ux * along, 0.02 + Math.sin(time * 5.2) * 0.03 * k, f.def.az + f.uz * along)
  boat.rotation.set(Math.sin(time * 3.1) * 0.06 * k, Math.atan2(-f.uz * dir, f.ux * dir), Math.sin(time * 4.3) * 0.08 * k)
}

/** Pop-up rise for fold progress `t` when nothing snapped it (the demo's ghost). */
const ghostRise = (t: number): number => clamp01((t - 0.2) / 0.6)

export class FoldView {
  readonly group = new Group()
  private readonly panels: Panel[] = []
  private readonly guide: GuideLine
  private readonly artMat: PaperMaterial
  private readonly paperMat: PaperMaterial
  private structure: Group | null = null
  private structMat: PaperMaterial | null = null
  private wobble = 0
  private wobbleV = 0
  private lastRev = 0
  private lastHp: number
  private hitFlash = 0
  private jolt = 0
  private reveal = 0

  /**
   * `pageId` is the outline id of the page this flap is cut from. While the
   * flap lies flat (and isn't asking to be touched) it borrows that id, so the
   * ink pass doesn't draw a heavy box around every fold line; the printed cut
   * line and the dotted guide mark it instead.
   */
  private readonly ownId: number
  private readonly pageId: number

  /** The pop-up's meshes with their everyday geometry and its Winter name (roadmap #17). */
  private readonly dressable: { mesh: Mesh; geo: BufferGeometry; name: string }[] = []

  constructor(private f: FoldState, art: Texture, pageId = -1, winter = false) {
    const d = f.def
    this.lastHp = f.hp
    this.artMat = createPaperMaterial({ map: art, vertexColors: true, grain: 0.05 })
    this.paperMat = createPaperMaterial({ vertexColors: true, grain: 0.06 })
    const mats = [this.artMat, this.paperMat]
    // Both materials share one outline id so the flap reads as a single card.
    this.paperMat.uniforms.uObjectId.value = this.artMat.uniforms.uObjectId.value
    this.ownId = this.artMat.uniforms.uObjectId.value
    this.pageId = pageId

    const { ux, uz, nx, nz, len } = f
    if (d.kind === 'wall' || d.kind === 'launch') {
      const p = new Panel(d.ax, d.az, ux, uz, len, d.side * d.depth, mats)
      this.panels.push(p)
      this.group.add(p.pivot)
    } else if (d.kind === 'valley' || d.kind === 'ridge') {
      // Panel A hinged on the far (−n) edge reaching toward the centre, panel B mirrored.
      const aX = d.ax - nx * d.depth
      const aZ = d.az - nz * d.depth
      const bX = d.ax + nx * d.depth
      const bZ = d.az + nz * d.depth
      const pa = new Panel(aX, aZ, ux, uz, len, d.side * d.depth, mats)
      const pb = new Panel(bX, bZ, ux, uz, len, -d.side * d.depth, mats)
      this.panels.push(pa, pb)
      this.group.add(pa.pivot, pb.pivot)
    } else if (d.kind === 'boat') {
      // The dock square, hinged on its far (−n) edge: it covers −depth…depth across the channel.
      const dock = grabLength(f)
      const p = new Panel(d.ax - nx * d.depth, d.az - nz * d.depth, ux, uz, dock, d.side * d.depth * 2, mats)
      this.panels.push(p)
      this.group.add(p.pivot)
    } else if (d.kind === 'pleat') {
      // Two half-panels per section, hinged on lines across the strip. Panel A hangs from the
      // section's top edge down the strip (+u), panel B from its bottom edge back up (−u).
      const n = pleatCount(f)
      const hs = len / (n * 2)
      // Hinge direction across the strip, chosen so a positive width runs down the strip.
      const hx = uz
      const hz = -ux
      for (let k = 0; k < n; k++) {
        const topS = k * 2 * hs
        const botS = (k + 1) * 2 * hs
        const ta = d.ax + ux * topS - hx * d.depth
        const tz = d.az + uz * topS - hz * d.depth
        const ba = d.ax + ux * botS - hx * d.depth
        const bz = d.az + uz * botS - hz * d.depth
        const A = new Panel(ta, tz, hx, hz, d.depth * 2, hs, mats)
        const B = new Panel(ba, bz, hx, hz, d.depth * 2, -hs, mats)
        // Eight low panels: they receive shadows but cast none (a shut accordion is knee-high),
        // which keeps a pleat page's shadow pass within the book 1–2 pages' draw budget.
        A.mesh.castShadow = false
        B.mesh.castShadow = false
        this.panels.push(A, B)
        this.group.add(A.pivot, B.pivot)
      }
    }

    if (d.kind === 'wall' && d.structure !== 'none') this.buildStructure()
    if (d.kind === 'ballista') this.buildBallista()
    if (d.kind === 'boat') this.buildBoat()
    if (winter) this.setWinter(true)

    // Guide path.
    const c = { x: f.cx, z: f.cz }
    let pts: number[]
    let twoWay = false
    if (d.kind === 'valley') {
      pts = [c.x - ux * len * 0.36, c.z - uz * len * 0.36, c.x + ux * len * 0.36, c.z + uz * len * 0.36]
      twoWay = true
    } else if (d.kind === 'launch') {
      pts = [
        c.x + nx * d.depth * 0.86, c.z + nz * d.depth * 0.86,
        c.x + nx * d.depth * 0.35 + ux * 0.35, c.z + nz * d.depth * 0.35 + uz * 0.35,
        c.x - nx * 0.55, c.z - nz * 0.55
      ]
    } else if (d.kind === 'ridge') {
      pts = [c.x + nx * d.depth * 0.95, c.z + nz * d.depth * 0.95, c.x - nx * d.depth * 0.95, c.z - nz * d.depth * 0.95]
    } else if (d.kind === 'boat') {
      // From the dock along the channel: the way the boat will sail.
      const dock = grabLength(f)
      pts = [
        d.ax + ux * dock * 0.12, d.az + uz * dock * 0.12,
        d.ax + ux * dock * 0.6 + nx * 0.18, d.az + uz * dock * 0.6 + nz * 0.18,
        d.ax + ux * (dock + 1.0), d.az + uz * (dock + 1.0)
      ]
    } else if (d.kind === 'pleat') {
      // Down the strip: the accordion shuts behind the finger.
      pts = [d.ax + ux * 0.25, d.az + uz * 0.25, d.ax + ux * len * 0.5, d.az + uz * len * 0.5, d.ax + ux * len * 0.9, d.az + uz * len * 0.9]
    } else {
      pts = [
        c.x + nx * 0.2, c.z + nz * 0.2,
        c.x + nx * d.depth * 0.55 + ux * 0.4, c.z + nz * d.depth * 0.55 + uz * 0.4,
        c.x + nx * d.depth * 0.92, c.z + nz * d.depth * 0.92
      ]
    }
    this.guide = new GuideLine({ points: pts, twoWay }, 0.014, d.structure === 'shield' ? 0.26 : 0.32)
    this.group.add(this.guide.mesh)
    this.group.userData.perfTag = `fold.${d.kind}`
  }

  /**
   * Winter's dress on the pop-up (roadmap #17): snow on its tops and a thick
   * cap on a tower's roof — a geometry swap on the same material (no new
   * draw, no new program). The ghost copy of the pop-up keeps the plain one.
   */
  setWinter(on: boolean): void {
    for (const d of this.dressable) d.mesh.geometry = on ? snowyGeometry(d.geo, d.name) : d.geo
  }

  /** The page was repainted in another look (roadmap #6): the flap prints the new art. */
  setArt(art: Texture): void {
    this.artMat.uniforms.map!.value = art
  }

  private buildStructure(): void {
    const f = this.f
    const d = f.def
    const s = new Group()
    this.structMat = createPaperMaterial({ vertexColors: true, grain: 0.06 })
    const m = this.structMat
    const add = (geo: ReturnType<typeof towerGeometry>, x: number, scale = 1, name = ''): void => {
      const mesh = new Mesh(geo, m)
      if (name) this.dressable.push({ mesh, geo, name })
      mesh.position.x = x
      mesh.scale.setScalar(scale)
      mesh.castShadow = true
      mesh.receiveShadow = true
      s.add(mesh)
    }
    if (d.structure === 'tower') {
      add(towerGeometry(), 0, 1, 'tower')
      const side = (f.len - 1.45) / 2
      if (side > 0.35) {
        const len = side.toFixed(2)
        add(wallGeometry(Number(len)), -(0.72 + side / 2), 1, `wall:${len}`)
        add(wallGeometry(Number(len)), 0.72 + side / 2, 1, `wall:${len}`)
      }
    } else if (d.structure === 'wall') {
      const len = (f.len * 0.96).toFixed(2)
      add(wallGeometry(Number(len)), 0, 1, `wall:${len}`)
    } else if (d.structure === 'shield') {
      add(shieldGeometry(), 0, Math.min(1.25, f.len / 2.6), 'shield')
    }
    // Stand on the hinge, a hair toward the player, facing the player.
    s.position.set(f.cx - f.nx * 0.16, 0, f.cz - f.nz * 0.16)
    s.rotation.y = Math.atan2(-f.uz, f.ux) + (d.side > 0 ? Math.PI : 0)
    s.scale.set(1, 0.001, 1)
    s.visible = false
    this.structure = s
    this.group.add(s)
  }

  private readonly ballistaYaw = { value: 0 }
  private ballistaKick = 0

  private buildBallista(): void {
    const s = new Group()
    this.structMat = createPaperMaterial({ vertexColors: true, grain: 0.05 })
    const mesh = new Mesh(ballistaGeometry(), this.structMat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    // Pivot at the back of the stock, so it flips up from lying flat.
    mesh.position.z = -0.1
    s.add(mesh)
    s.position.set(this.f.cx, CASTLE.towerTop, CASTLE.towerZ)
    this.structure = s
    this.group.add(s)
  }

  /** The paper boat the dock flap folds into (book 3). */
  private buildBoat(): void {
    const s = new Group()
    this.structMat = createPaperMaterial({ vertexColors: true, grain: 0.05 })
    const mesh = new Mesh(paperBoatGeometry(), this.structMat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    s.add(mesh)
    s.visible = false
    this.structure = s
    this.group.add(s)
  }

  /** Re-point at a fresh fold state (same definition) — page restarts reuse the view. */
  bind(f: FoldState): void {
    this.f = f
    this.lastRev = f.rev
    this.lastHp = f.hp
    this.wobble = 0
    this.wobbleV = 0
    this.reveal = 0
  }

  /** How far below the page a point inside a dipped valley sits (for trapped enemies). */
  dipAt(x: number, z: number): number {
    const f = this.f
    if (f.def.kind !== 'valley') return 0
    const d = (x - f.def.ax) * f.nx + (z - f.def.az) * f.nz
    const a = f.t * VALLEY_MAX
    const depth = f.def.depth * Math.tan(a)
    return -depth * (1 - Math.min(1, Math.abs(d) / f.def.depth))
  }

  /** Height of a ridge's surface at a point (enemies being swept ride it). */
  ridgeAt(x: number, z: number): number {
    const f = this.f
    if (f.def.kind !== 'ridge') return 0
    const d = (x - f.def.ax) * f.nx + (z - f.def.az) * f.nz
    const a = f.t * RIDGE_MAX
    return f.def.depth * Math.tan(a) * (1 - Math.min(1, Math.abs(d) / f.def.depth))
  }

  update(time: number, dt: number, highlight: boolean, rise = 1): void {
    const f = this.f
    const k = f.def.kind
    if (k === 'ballista') {
      this.updateBallista(time, dt, highlight, rise)
      return
    }
    // Snap/stamp wobble (a spring kicked on every snap).
    if (f.rev !== this.lastRev) {
      this.lastRev = f.rev
      this.wobbleV += f.phase === 'up' ? 9 : -6
    }
    this.wobbleV += (-160 * this.wobble - 11 * this.wobbleV) * dt
    this.wobble += this.wobbleV * dt
    if (f.hp < this.lastHp) {
      this.hitFlash = 1
      this.jolt = 1
    }
    this.lastHp = f.hp
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4)
    this.jolt = Math.max(0, this.jolt - dt * 5)

    const t = f.t
    posePanels(this.panels, k, t, k === 'wall' ? this.wobble * 0.08 : k === 'launch' && f.phase === 'spent' ? this.wobble * 0.05 : 0)
    if (k === 'pleat') posePleat(this.panels, f, t)
    else if (k === 'boat') {
      const sailing = isSailing(f)
      const along = sailing ? boatAlong(f, f.sail) : grabLength(f) / 2
      poseBoat(this.panels[0]!, this.structure!, f, t, along, sailing && f.sail > 0.5 ? -1 : 1, time)
    }

    // Pop-up.
    const s = k === 'boat' ? null : this.structure
    if (s) {
      let p: number
      if (f.phase === 'snapping' || f.phase === 'up') p = easeOutBack(clamp01((t - 0.35) / 0.65), 2.2)
      else p = clamp01(t * 1.15)
      p += this.wobble * 0.06
      s.visible = p > 0.01
      const squash = 1 + (1 - clamp01(p)) * 0.35
      s.scale.set(squash, Math.max(0.001, p), squash)
      s.rotation.z = Math.sin(time * 40) * 0.04 * this.jolt
      // A battered wall leans.
      const wear = 1 - f.hp / f.def.hp
      s.rotation.x = f.phase === 'up' ? wear * 0.12 * Math.sin(time * 3) : 0
    }

    // Guide visibility.
    let op = 0
    let active = false
    if (f.phase === 'ready') {
      this.reveal = Math.min(1, this.reveal + dt * 3)
      op = this.reveal
      active = true
    } else if (f.phase === 'dragging') {
      op = Math.max(0, 1 - f.drag * 2.6)
      active = true
    } else if (f.phase === 'cooldown') {
      op = 0.55
    } else {
      this.reveal = f.phase === 'hidden' ? 0 : this.reveal
    }
    this.guide.update(time, op, active)

    const hl = highlight ? 1 : 0
    const flash = Math.max(f.flash * 0.35, this.hitFlash * 0.5)
    const flat = t < 0.02 && !highlight && this.pageId >= 0
    const id = flat ? this.pageId : this.ownId
    for (let i = 0; i < 2; i++) {
      const m = i === 0 ? this.artMat : this.paperMat
      m.uniforms.uHighlight.value = hl
      m.uniforms.uFlash.value = f.flash * 0.25
      m.uniforms.uObjectId.value = id
    }
    if (this.structMat) {
      this.structMat.uniforms.uHighlight.value = hl
      this.structMat.uniforms.uFlash.value = flash
    }
  }

  // ─── Lesson demonstration ghost (roadmap #4) ───────────────────────────────

  private ghostGroup: Group | null = null
  private ghostPanels: Panel[] = []
  private ghostMat: PaperMaterial | null = null
  private ghostStruct: Group | null = null

  /** Built on the first demo that needs it (once per flap, never per frame). */
  private buildGhost(): Group {
    const g = new Group()
    // Ink-free (id 127) guide-blue paper, dithered translucent.
    const m = createPaperMaterial({ unlit: true, color: HEX.guideGlow, grain: 0, id: 127, opacity: 0.55, doubleSided: true })
    this.ghostMat = m
    for (const p of this.panels) {
      const gp = p.twin(m)
      gp.mesh.castShadow = false
      gp.mesh.receiveShadow = false
      this.ghostPanels.push(gp)
      g.add(gp.pivot)
    }
    // Never quite coplanar with the real flap (flat on the page, or stood up).
    g.position.set(0, 0.018, 0.02)
    const s = this.structure
    if (s && (this.f.def.kind === 'wall' || this.f.def.kind === 'boat')) {
      const c = s.clone()
      c.traverse((o) => {
        if (o instanceof Mesh) {
          o.material = m
          o.castShadow = false
          o.receiveShadow = false
        }
      })
      this.ghostStruct = c
      g.add(c)
    }
    g.userData.perfTag = 'fold.ghost'
    this.group.add(g)
    this.ghostGroup = g
    return g
  }

  /**
   * Pose the ghost at demo progress `t` with visibility `alpha` (0 hides it).
   * The real flap is untouched: this is choreography, not gameplay.
   */
  ghost(t: number, alpha: number): void {
    if (alpha <= 0.01 || this.panels.length === 0) {
      if (this.ghostGroup) this.ghostGroup.visible = false
      return
    }
    const g = this.ghostGroup ?? this.buildGhost()
    g.visible = true
    const k = this.f.def.kind
    posePanels(this.ghostPanels, k, t)
    if (k === 'pleat') posePleat(this.ghostPanels, this.f, t)
    else if (k === 'boat' && this.ghostStruct) {
      // The ghost folds the boat at the dock, then pushes it off a little along the channel.
      const dock = grabLength(this.f) / 2
      poseBoat(this.ghostPanels[0]!, this.ghostStruct, this.f, t, dock + clamp01((t - 0.7) / 0.3) * 0.9, 1, 0)
    }
    const s = k === 'boat' ? null : this.ghostStruct
    if (s) {
      const p = ghostRise(t)
      s.visible = p > 0.01
      const squash = 1 + (1 - p) * 0.35
      s.scale.set(squash, Math.max(0.001, p), squash)
      s.rotation.x = 0
    }
    this.ghostMat!.uniforms.uOpacity.value = 0.6 * Math.min(1, alpha)
  }

  private updateBallista(time: number, dt: number, highlight: boolean, rise: number): void {
    const f = this.f
    const s = this.structure!
    // Sits on the tower top, which rises with the page.
    s.position.y = CASTLE.towerTop * Math.max(0.001, rise)
    s.visible = rise > 0.01
    // Folded: lying back over the tower top, pointing at the player. Flipping
    // open swings it over the top until it aims up the page.
    const t = f.t
    if (f.flash > 0.95) this.ballistaKick = 1
    this.ballistaKick = Math.max(0, this.ballistaKick - dt * 6)
    // Aim: turn toward the last target (open), rest straight up the page.
    const dx = f.aimX - f.cx
    const dz = f.aimZ - s.position.z
    const want = f.phase === 'up' ? Math.atan2(-dx, -dz) : 0
    this.ballistaYaw.value += (want - this.ballistaYaw.value) * Math.min(1, dt * 14)
    s.rotation.set((1 - t) * Math.PI * 0.92 + this.ballistaKick * 0.25, this.ballistaYaw.value, 0)
    s.scale.setScalar(0.9 + t * 0.25)
    // Guide arrow on the strip in front of the tower.
    let op = 0
    let active = false
    if (f.phase === 'ready') {
      this.reveal = Math.min(1, this.reveal + dt * 3)
      op = this.reveal
      active = true
    } else if (f.phase === 'dragging') {
      op = Math.max(0, 1 - f.drag * 2.6)
      active = true
    } else if (f.phase === 'cooldown') op = 0.4
    this.guide.update(time, op * Math.min(1, rise), active)
    // Loaded and waiting for a tap: keep the actionable outline pulsing.
    const armed = f.phase === 'up' && f.ammo > 0
    this.structMat!.uniforms.uHighlight.value = highlight || armed ? 1 : 0
    this.structMat!.uniforms.uFlash.value = f.flash * 0.4
  }

  dispose(): void {
    for (const p of this.panels) p.dispose()
    this.guide.dispose()
    this.artMat.dispose()
    this.paperMat.dispose()
    this.structMat?.dispose()
    this.ghostMat?.dispose()
  }
}
