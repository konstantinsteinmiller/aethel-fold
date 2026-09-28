/**
 * The glowing blue dotted line with an arrow (aethel-fold-GDD §4.1, §6 0:01):
 * "A thick, glowing blue dotted line appears … curving upwards."
 *
 * A flat ribbon on the page whose fragment shader cuts it into round dots
 * that flow toward the arrowhead, pulse, and fade away as the fold lifts.
 * Writes the MRT normal/id like every other surface so the ink pass rings each
 * dot with a crisp outline.
 */

import { BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, ShaderMaterial } from 'three'
import { HEX } from '../palette'

const material = (): ShaderMaterial =>
  new ShaderMaterial({
    side: DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uActive: { value: 1 },
      uColor: { value: new Color(HEX.guide) },
      uGlow: { value: new Color(HEX.guideGlow) },
      uIdle: { value: new Color(HEX.parchmentEdge) },
      uSpacing: { value: 0.46 },
      uWidth: { value: 0.2 }
    },
    vertexShader: /* glsl */ `
      attribute float aHead;
      varying vec2 vUv;
      varying float vHead;
      varying vec3 vViewNormal;
      void main() {
        vUv = uv;
        vHead = aHead;
        vViewNormal = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      layout(location = 1) out highp vec4 gNormal;
      uniform float uTime;
      uniform float uOpacity;
      uniform float uActive;
      uniform vec3 uColor;
      uniform vec3 uGlow;
      uniform vec3 uIdle;
      uniform float uSpacing;
      uniform float uWidth;
      varying vec2 vUv;
      varying float vHead;
      varying vec3 vViewNormal;

      float bayer4(vec2 p) {
        vec2 q = mod(floor(p), 4.0);
        int i = int(q.x) + int(q.y) * 4;
        float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
        return (m[i] + 0.5) / 16.0;
      }

      vec3 toSRGB(vec3 c) {
        c = clamp(c, 0.0, 1.0);
        return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
      }

      void main() {
        if (uOpacity < 0.999 && bayer4(gl_FragCoord.xy) > uOpacity) discard;
        float glow;
        if (vHead > 0.5) {
          glow = 1.0;
        } else {
          // Round dots flowing toward the arrow.
          float along = (vUv.x - uTime * 0.55 * uActive) / uSpacing;
          vec2 q = vec2((fract(along) - 0.5) * uSpacing, (vUv.y - 0.5) * uWidth);
          float r = length(q) / (uWidth * 0.5);
          if (r > 0.92) discard;
          glow = 1.0 - smoothstep(0.0, 0.9, r);
        }
        float pulse = 0.75 + 0.25 * sin(uTime * 5.5);
        vec3 c = mix(uColor, uGlow, glow * 0.6 * pulse);
        c = mix(uIdle, c, uActive);
        gl_FragColor = vec4(toSRGB(c), 1.0);
        gNormal = vec4(vViewNormal * 0.5 + 0.5, (125.0 * 2.0) / 255.0);
      }
    `
  })

export interface GuidePath {
  /** Page-space points (x, z pairs). */
  points: number[]
  /** Arrowheads at the end (and the start, for two-way valley lines). */
  twoWay?: boolean
}

export class GuideLine {
  readonly mesh: Mesh
  readonly mat: ShaderMaterial

  constructor(path: GuidePath, y = 0.012, width = 0.2) {
    this.mat = material()
    this.mat.uniforms.uWidth!.value = width
    this.mesh = new Mesh(buildGuideGeometry(path, y, width), this.mat)
    this.mesh.renderOrder = 2
    this.mesh.frustumCulled = false
  }

  update(time: number, opacity: number, active: boolean): void {
    const u = this.mat.uniforms
    u.uTime!.value = time
    u.uOpacity!.value = opacity
    u.uActive!.value = active ? 1 : 0
    this.mesh.visible = opacity > 0.02
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.mat.dispose()
  }
}

const buildGuideGeometry = (path: GuidePath, y: number, width: number): BufferGeometry => {
  // Resample the path smoothly (quadratic through midpoints).
  const src = path.points
  const pts: number[] = []
  if (src.length <= 4) {
    for (let t = 0; t <= 1.0001; t += 1 / 16) {
      pts.push(src[0]! + (src[2]! - src[0]!) * t, src[1]! + (src[3]! - src[1]!) * t)
    }
  } else {
    // Quadratic Bézier through p0, p1 (control), p2.
    for (let t = 0; t <= 1.0001; t += 1 / 24) {
      const a = (1 - t) * (1 - t)
      const b = 2 * (1 - t) * t
      const c = t * t
      pts.push(a * src[0]! + b * src[2]! + c * src[4]!, a * src[1]! + b * src[3]! + c * src[5]!)
    }
  }
  const pos: number[] = []
  const uv: number[] = []
  const head: number[] = []
  const hw = width / 2
  let acc = 0
  const n = pts.length / 2
  // Stop the dots short of the arrowhead.
  const headLen = width * 2.1
  let total = 0
  for (let i = 1; i < n; i++) total += Math.hypot(pts[i * 2]! - pts[i * 2 - 2]!, pts[i * 2 + 1]! - pts[i * 2 - 1]!)
  const start = path.twoWay ? headLen : 0
  const end = total - headLen
  for (let i = 0; i < n - 1; i++) {
    const x0 = pts[i * 2]!
    const z0 = pts[i * 2 + 1]!
    const x1 = pts[i * 2 + 2]!
    const z1 = pts[i * 2 + 3]!
    const seg = Math.hypot(x1 - x0, z1 - z0)
    const a0 = acc
    const a1 = acc + seg
    acc = a1
    if (a1 < start || a0 > end) continue
    const dx = (x1 - x0) / (seg || 1)
    const dz = (z1 - z0) / (seg || 1)
    const px = -dz * hw
    const pz = dx * hw
    const quad = [
      [x0 - px, z0 - pz, a0, 0], [x1 - px, z1 - pz, a1, 0], [x1 + px, z1 + pz, a1, 1],
      [x0 - px, z0 - pz, a0, 0], [x1 + px, z1 + pz, a1, 1], [x0 + px, z0 + pz, a0, 1]
    ]
    for (const q of quad) {
      pos.push(q[0]!, y, q[1]!)
      uv.push(q[2]!, q[3]!)
      head.push(0)
    }
  }
  const arrow = (tipX: number, tipZ: number, dirX: number, dirZ: number): void => {
    const L = headLen
    const W = width * 1.25
    const bx = tipX - dirX * L
    const bz = tipZ - dirZ * L
    const px = -dirZ * W
    const pz = dirX * W
    // CCW seen from above (+y): tip, left, right.
    const tri = [[tipX, tipZ], [bx + px, bz + pz], [bx - px, bz - pz]]
    // Ensure upward winding.
    const cross = (tri[1]![0]! - tri[0]![0]!) * (tri[2]![1]! - tri[0]![1]!) - (tri[1]![1]! - tri[0]![1]!) * (tri[2]![0]! - tri[0]![0]!)
    const order = cross < 0 ? [0, 1, 2] : [0, 2, 1]
    for (const i of order) {
      pos.push(tri[i]![0]!, y + 0.001, tri[i]![1]!)
      uv.push(0, 0.5)
      head.push(1)
    }
  }
  const lx = pts[(n - 1) * 2]!
  const lz = pts[(n - 1) * 2 + 1]!
  const px2 = pts[(n - 2) * 2]!
  const pz2 = pts[(n - 2) * 2 + 1]!
  const dl = Math.hypot(lx - px2, lz - pz2) || 1
  arrow(lx, lz, (lx - px2) / dl, (lz - pz2) / dl)
  if (path.twoWay) {
    const fx = pts[0]!
    const fz = pts[1]!
    const sx = pts[2]!
    const sz = pts[3]!
    const df = Math.hypot(fx - sx, fz - sz) || 1
    arrow(fx, fz, (fx - sx) / df, (fz - sz) / df)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  g.setAttribute('aHead', new BufferAttribute(new Float32Array(head), 1))
  g.computeBoundingSphere()
  return g
}
