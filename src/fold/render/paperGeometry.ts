/**
 * Paper-craft geometry kit.
 *
 * Everything in Castle Fold is folded paper, so every model is built from
 * flat facets with per-face colour (vertex colours, flat normals). A tiny
 * builder with a transform stack keeps the model code declarative:
 *
 *   const b = new PaperBuilder()
 *   b.push().translate(0, 1, 0).box(1, 2, 1, 'stone').pop()
 *   const geo = b.build()
 *
 * Faceting is the *point* here: origami reads as crisp planes, and the ink
 * pass outlines every crease because each facet carries its own normal.
 */

import { BufferAttribute, BufferGeometry, Color, Euler, Matrix3, Matrix4, Quaternion, Vector3 } from 'three'
import { HEX, type PaletteKey } from './palette'

export type Col = PaletteKey | Color

const colorCache = new Map<string, Color>()
export const col = (c: Col): Color => {
  if (c instanceof Color) return c
  let v = colorCache.get(c)
  if (!v) {
    v = new Color(HEX[c])
    colorCache.set(c, v)
  }
  return v
}

/** Lighten (>1) or darken (<1) a palette colour — for facet variation. */
export const shade = (c: Col, k: number): Color => col(c).clone().multiplyScalar(k)

export class PaperBuilder {
  private pos: number[] = []
  private nrm: number[] = []
  private clr: number[] = []
  private uv: number[] = []
  private stack: Matrix4[] = [new Matrix4()]
  private readonly nm = new Matrix3()
  private readonly a = new Vector3()
  private readonly b = new Vector3()
  private readonly c = new Vector3()
  private readonly n = new Vector3()
  private readonly e1 = new Vector3()
  private readonly e2 = new Vector3()

  get matrix(): Matrix4 {
    return this.stack[this.stack.length - 1]!
  }

  push(): this {
    this.stack.push(this.matrix.clone())
    return this
  }

  pop(): this {
    if (this.stack.length > 1) this.stack.pop()
    return this
  }

  translate(x: number, y: number, z: number): this {
    this.matrix.multiply(new Matrix4().makeTranslation(x, y, z))
    return this
  }

  rotate(x: number, y: number, z: number): this {
    this.matrix.multiply(new Matrix4().makeRotationFromEuler(new Euler(x, y, z)))
    return this
  }

  scale(x: number, y = x, z = x): this {
    this.matrix.multiply(new Matrix4().makeScale(x, y, z))
    return this
  }

  /** One flat-shaded triangle (counter-clockwise = front). */
  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, c: Col,
    uvA: [number, number] = [0, 0], uvB: [number, number] = [1, 0], uvC: [number, number] = [0, 1]): this {
    const m = this.matrix
    this.a.set(ax, ay, az).applyMatrix4(m)
    this.b.set(bx, by, bz).applyMatrix4(m)
    this.c.set(cx, cy, cz).applyMatrix4(m)
    this.e1.subVectors(this.b, this.a)
    this.e2.subVectors(this.c, this.a)
    this.n.crossVectors(this.e1, this.e2)
    if (this.n.lengthSq() < 1e-14) return this
    this.n.normalize()
    const k = col(c)
    for (const v of [this.a, this.b, this.c]) {
      this.pos.push(v.x, v.y, v.z)
      this.nrm.push(this.n.x, this.n.y, this.n.z)
      this.clr.push(k.r, k.g, k.b)
    }
    this.uv.push(uvA[0], uvA[1], uvB[0], uvB[1], uvC[0], uvC[1])
    return this
  }

  /** Planar quad a-b-c-d (counter-clockwise). */
  quad(
    a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number],
    k: Col, uv?: [[number, number], [number, number], [number, number], [number, number]]
  ): this {
    const u = uv ?? [[0, 0], [1, 0], [1, 1], [0, 1]]
    this.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], k, u[0], u[1], u[2])
    this.tri(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2], k, u[0], u[2], u[3])
    return this
  }

  /** Axis-aligned box centred on (0, h/2, 0) — i.e. standing on y = 0. */
  box(w: number, h: number, d: number, side: Col, top: Col = side, bottom: Col = side, front: Col = side): this {
    const x = w / 2
    const z = d / 2
    this.quad([-x, 0, z], [x, 0, z], [x, h, z], [-x, h, z], front) // +z
    this.quad([x, 0, -z], [-x, 0, -z], [-x, h, -z], [x, h, -z], side) // -z
    this.quad([x, 0, z], [x, 0, -z], [x, h, -z], [x, h, z], shade(side, 0.93)) // +x
    this.quad([-x, 0, -z], [-x, 0, z], [-x, h, z], [-x, h, -z], shade(side, 0.93)) // -x
    this.quad([-x, h, z], [x, h, z], [x, h, -z], [-x, h, -z], top) // +y
    this.quad([-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z], bottom) // -y
    return this
  }

  /** Vertical prism over a convex/concave polygon (x, z pairs, CCW seen from above), y0 → y1. */
  prism(poly: number[], y0: number, y1: number, side: Col, cap: Col = side, capBottom = false): this {
    const n = poly.length / 2
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const ax = poly[i * 2]!
      const az = poly[i * 2 + 1]!
      const bx = poly[j * 2]!
      const bz = poly[j * 2 + 1]!
      this.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], i % 2 ? shade(side, 0.94) : side)
    }
    // Fan caps (fine for the convex shapes we build).
    for (let i = 1; i < n - 1; i++) {
      this.tri(poly[0]!, y1, poly[1]!, poly[i * 2]!, y1, poly[i * 2 + 1]!, poly[(i + 1) * 2]!, y1, poly[(i + 1) * 2 + 1]!, cap)
      if (capBottom) this.tri(poly[0]!, y0, poly[1]!, poly[(i + 1) * 2]!, y0, poly[(i + 1) * 2 + 1]!, poly[i * 2]!, y0, poly[i * 2 + 1]!, cap)
    }
    return this
  }

  /** Regular n-gon prism (a paper tower drum). */
  drum(r: number, h: number, sides: number, side: Col, cap: Col = side): this {
    const poly: number[] = []
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + Math.PI / sides
      poly.push(Math.cos(a) * r, -Math.sin(a) * r)
    }
    return this.prism(poly, 0, h, side, cap)
  }

  /** Faceted cone (a folded paper roof), base on y = 0. */
  cone(r: number, h: number, sides: number, c: Col, alt?: Col): this {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2
      const a1 = ((i + 1) / sides) * Math.PI * 2
      this.tri(Math.cos(a0) * r, 0, -Math.sin(a0) * r, Math.cos(a1) * r, 0, -Math.sin(a1) * r, 0, h, 0,
        alt && i % 2 ? alt : i % 2 ? shade(c, 0.9) : c)
    }
    return this
  }

  /** Pyramid with a rectangular base (roof over a keep). */
  pyramid(w: number, d: number, h: number, c: Col): this {
    const x = w / 2
    const z = d / 2
    this.tri(-x, 0, z, x, 0, z, 0, h, 0, c)
    this.tri(x, 0, z, x, 0, -z, 0, h, 0, shade(c, 0.86))
    this.tri(x, 0, -z, -x, 0, -z, 0, h, 0, shade(c, 0.8))
    this.tri(-x, 0, -z, -x, 0, z, 0, h, 0, shade(c, 0.9))
    return this
  }

  /** A row of merlons along x on top of a wall of width w (crenellations). */
  crenels(w: number, depth: number, y: number, merlonH: number, count: number, c: Col): this {
    const step = w / (count * 2 - 1)
    for (let i = 0; i < count; i++) {
      const x0 = -w / 2 + i * 2 * step
      this.push().translate(x0 + step / 2, y, 0).box(step, merlonH, depth, c).pop()
    }
    return this
  }

  /** A little flag on a pole (pole base at origin). */
  flag(h: number, c: Col, pole: Col = 'woodDark'): this {
    this.push().box(0.05, h, 0.05, pole).pop()
    this.tri(0.02, h, 0, 0.42, h - 0.12, 0, 0.02, h - 0.26, 0, c)
    this.tri(0.02, h, 0, 0.02, h - 0.26, 0, 0.42, h - 0.12, 0, shade(c, 0.8))
    return this
  }

  /** Double-sided flat polygon in the XY plane (a paper cut-out). */
  sheet(poly: number[], front: Col, back: Col = front, thickness = 0): this {
    const n = poly.length / 2
    const z = thickness / 2
    for (let i = 1; i < n - 1; i++) {
      this.tri(poly[0]!, poly[1]!, z, poly[i * 2]!, poly[i * 2 + 1]!, z, poly[(i + 1) * 2]!, poly[(i + 1) * 2 + 1]!, z, front)
      this.tri(poly[0]!, poly[1]!, -z, poly[(i + 1) * 2]!, poly[(i + 1) * 2 + 1]!, -z, poly[i * 2]!, poly[i * 2 + 1]!, -z, back)
    }
    if (thickness > 0) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        this.quad([poly[i * 2]!, poly[i * 2 + 1]!, z], [poly[i * 2]!, poly[i * 2 + 1]!, -z], [poly[j * 2]!, poly[j * 2 + 1]!, -z], [poly[j * 2]!, poly[j * 2 + 1]!, z], shade(front, 0.85))
      }
    }
    return this
  }

  get vertexCount(): number {
    return this.pos.length / 3
  }

  build(): BufferGeometry {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3))
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3))
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.clr), 3))
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2))
    g.computeBoundingSphere()
    g.computeBoundingBox()
    return g
  }
}

/** Assert a built geometry is finite (NaN compares false, so obvious guards pass silently). */
export const assertFinite = (g: BufferGeometry, name: string): BufferGeometry => {
  const p = g.getAttribute('position').array as Float32Array
  for (let i = 0; i < p.length; i++) {
    if (!Number.isFinite(p[i]!)) throw new Error(`[fold] non-finite vertex in ${name} at ${i}`)
  }
  return g
}

// Shared scratch objects for per-frame instance composition (never escape).
export const TMP = {
  m: new Matrix4(),
  q: new Quaternion(),
  e: new Euler(),
  p: new Vector3(),
  s: new Vector3(1, 1, 1),
  c: new Color()
}
