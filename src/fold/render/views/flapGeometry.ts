/**
 * Geometry for a paper flap: a thin card `len` along its hinge and `w` wide
 * across it (w signed: which side of the hinge it lies on). The top face
 * carries the page illustration (UVs taken from where the flap lies flat on
 * the page, so it's seamless until it lifts); the back and the cut edges are
 * plain paper in vertex colour.
 *
 * Local frame: x along the hinge (0…len), z across it (0…w), y up. Group 0 =
 * top (art material), group 1 = back + edges (paper material).
 */

import { BufferAttribute, BufferGeometry, Color, Vector3 } from 'three'
import { pageUV } from '../art/pageArt'
import { HEX } from '../palette'

const TOP = 0.004
const BOTTOM = -0.022

export const buildFlapGeometry = (
  len: number, w: number,
  ax: number, az: number, ux: number, uz: number,
  segments = 1
): BufferGeometry => {
  // Local z axis in world: (-uz, 0, ux).
  const zx = -uz
  const zz = ux
  const pos: number[] = []
  const nrm: number[] = []
  const uv: number[] = []
  const clr: number[] = []
  const back = new Color(HEX.parchmentShade)
  const edge = new Color(HEX.parchmentEdge)
  const tmpA = new Vector3()
  const tmpB = new Vector3()
  const tmpN = new Vector3()

  const worldUV = (x: number, z: number): [number, number] => pageUV(ax + ux * x + zx * z, az + uz * x + zz * z)

  const push = (
    p: [number, number, number][], want: [number, number, number], uvs: [number, number][] | null, c: Color
  ): void => {
    // Two triangles p0 p1 p2 / p0 p2 p3, flipped if they face away from `want`.
    tmpA.set(p[1]![0] - p[0]![0], p[1]![1] - p[0]![1], p[1]![2] - p[0]![2])
    tmpB.set(p[2]![0] - p[0]![0], p[2]![1] - p[0]![1], p[2]![2] - p[0]![2])
    tmpN.crossVectors(tmpA, tmpB)
    let order = [0, 1, 2, 0, 2, 3]
    if (tmpN.x * want[0] + tmpN.y * want[1] + tmpN.z * want[2] < 0) order = [0, 2, 1, 0, 3, 2]
    for (const i of order) {
      pos.push(p[i]![0], p[i]![1], p[i]![2])
      nrm.push(want[0], want[1], want[2])
      const u: [number, number] = uvs ? uvs[i]! : [0, 0]
      uv.push(u[0], u[1])
      clr.push(c.r, c.g, c.b)
    }
  }

  const white = new Color(1, 1, 1)
  const segs = Math.max(1, segments)
  // Top (art), optionally split along x so long flaps bend smoothly if needed.
  for (let s = 0; s < segs; s++) {
    const x0 = (len * s) / segs
    const x1 = (len * (s + 1)) / segs
    push(
      [[x0, TOP, 0], [x1, TOP, 0], [x1, TOP, w], [x0, TOP, w]],
      [0, 1, 0],
      [worldUV(x0, 0), worldUV(x1, 0), worldUV(x1, w), worldUV(x0, w)],
      white
    )
  }
  const topCount = pos.length / 3
  // Back.
  push([[0, BOTTOM, 0], [len, BOTTOM, 0], [len, BOTTOM, w], [0, BOTTOM, w]], [0, -1, 0], null, back)
  const sz = Math.sign(w) || 1
  // Edges.
  push([[0, BOTTOM, w], [len, BOTTOM, w], [len, TOP, w], [0, TOP, w]], [0, 0, sz], null, edge)
  push([[0, BOTTOM, 0], [len, BOTTOM, 0], [len, TOP, 0], [0, TOP, 0]], [0, 0, -sz], null, edge)
  push([[0, BOTTOM, 0], [0, BOTTOM, w], [0, TOP, w], [0, TOP, 0]], [-1, 0, 0], null, edge)
  push([[len, BOTTOM, 0], [len, BOTTOM, w], [len, TOP, w], [len, TOP, 0]], [1, 0, 0], null, edge)

  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  g.setAttribute('color', new BufferAttribute(new Float32Array(clr), 3))
  g.addGroup(0, topCount, 0)
  g.addGroup(topCount, pos.length / 3 - topCount, 1)
  g.computeBoundingSphere()
  return g
}
