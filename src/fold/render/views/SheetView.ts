/**
 * The sheet: one tessellated page that performs every page-level transition.
 *
 *   turn    — GDD §6 0:03 / §7: the page flips over the spine like a book,
 *             outer edge leading, bottom corner first.
 *   peel    — the "Layer Unfolding" storyboard panel: the finger drags the
 *             dog-eared corner and the page curls back around a cylinder,
 *             revealing the castle-core layer underneath.
 *   crumple — GDD §9: defeat crumples the page into a ball that is thrown
 *             away (the transform does the throw).
 *
 * Its front is textured with a snapshot of the *current frame*, projected
 * from the main camera (per-vertex screen UVs computed at snapshot time), so
 * at t = 0 it is pixel-identical to the live page it replaces — the swap from
 * live scene to sheet is invisible, pop-ups and all.
 */

import {
  BufferAttribute, DoubleSide, Mesh, PlaneGeometry, ShaderMaterial, Vector3, type Camera, type Texture
} from 'three'
import { PAGE_HALF_D, PAGE_HALF_W } from '../../logic/config'
import { paperGlobals } from '../paperMaterial'

export type SheetMode = 'hidden' | 'turn' | 'peel' | 'crumple'

const MODE_CODE: Record<SheetMode, number> = { hidden: 0, turn: 1, peel: 2, crumple: 3 }

const DEFORM = /* glsl */ `
uniform float uMode;
uniform float uT;
uniform float uSpineX;
const float PI_S = 3.14159265;

vec3 deform(vec3 p, inout vec3 n) {
  if (uMode < 0.5) return p;
  if (uMode < 1.5) {
    // Page turn around the spine (x = uSpineX, y = 0), outer edge leading.
    float W = ${(PAGE_HALF_W * 2 + 0.3).toFixed(3)};
    float r = max(0.0, p.x - uSpineX);
    float k = r / W;
    float corner = clamp((p.z / ${PAGE_HALF_D.toFixed(3)}) * 0.5 + 0.5, 0.0, 1.0);
    float bend = sin(uT * PI_S);
    float ang = clamp(uT * PI_S + bend * (0.42 * k + 0.22 * k * corner), 0.0, PI_S);
    float lift = bend * 0.35 * k;
    vec3 q = vec3(uSpineX + r * cos(ang), r * sin(ang) + lift, p.z);
    n = vec3(-sin(ang), cos(ang), 0.0);
    return q;
  }
  if (uMode < 2.5) {
    // Peel from the bottom-right corner around a cylinder.
    vec2 C = vec2(${PAGE_HALF_W.toFixed(3)}, ${PAGE_HALF_D.toFixed(3)});
    vec2 D = normalize(vec2(-0.62, -0.78));
    float R = 0.6;
    float s = dot(p.xz - C, D);
    float s0 = uT * 19.5;
    if (s < s0) {
      float u = s0 - s;
      float sn;
      float y;
      if (u < PI_S * R) {
        float phi = u / R;
        sn = s0 - R * sin(phi);
        y = R * (1.0 - cos(phi));
        n = normalize(vec3(D.x * sin(phi), cos(phi), D.y * sin(phi)));
      } else {
        sn = s0 + (u - PI_S * R);
        y = 2.0 * R;
        n = vec3(0.0, -1.0, 0.0);
      }
      p.xz += D * (sn - s);
      p.y = y;
    }
    return p;
  }
  // Crumple: squeeze the page onto a crinkled ball.
  float c = smoothstep(0.0, 1.0, uT);
  float az = atan(p.z, p.x);
  float rr = length(p.xz) / ${Math.hypot(PAGE_HALF_W, PAGE_HALF_D).toFixed(3)};
  float polar = rr * PI_S * 0.98;
  float crinkle = sin(p.x * 4.1 + p.z * 2.7) * 0.18 + sin(p.x * 9.7 - p.z * 6.3) * 0.09;
  float Rb = 1.25 * (1.0 + crinkle);
  vec3 sph = vec3(sin(polar) * cos(az), cos(polar), sin(polar) * sin(az)) * Rb + vec3(0.0, 1.25, 0.0);
  vec3 q = mix(p, sph, c);
  q.y += crinkle * sin(c * PI_S) * 0.9;
  n = normalize(mix(n, normalize(sph - vec3(0.0, 1.25, 0.0)), c));
  return q;
}
`

const material = (): ShaderMaterial =>
  new ShaderMaterial({
    side: DoubleSide,
    uniforms: {
      tSnap: { value: null as Texture | null },
      tBack: { value: null as Texture | null },
      uMode: { value: 0 },
      uT: { value: 0 },
      uSpineX: { value: -PAGE_HALF_W - 0.28 },
      uLampPos: paperGlobals.uLampPos,
      uLampColor: paperGlobals.uLampColor,
      uShadowColor: paperGlobals.uShadowColor
    },
    vertexShader: /* glsl */ `
      attribute vec2 aSnapUv;
      varying vec2 vSnapUv;
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vViewNormal;
      ${DEFORM}
      void main() {
        vec3 n = vec3(0.0, 1.0, 0.0);
        vec3 p = deform(position, n);
        vSnapUv = aSnapUv;
        vUv = uv;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * n);
        vViewNormal = normalize(normalMatrix * n);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      layout(location = 1) out highp vec4 gNormal;
      uniform sampler2D tSnap;
      uniform sampler2D tBack;
      uniform vec3 uLampPos;
      uniform vec3 uLampColor;
      uniform vec3 uShadowColor;
      uniform float uMode;
      varying vec2 vSnapUv;
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vViewNormal;

      vec3 fromSRGB(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
      vec3 toSRGB(vec3 c) {
        c = clamp(c, 0.0, 1.0);
        return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
      }

      void main() {
        vec3 n = normalize(vWorldNormal);
        vec3 vn = normalize(vViewNormal);
        vec3 col;
        if (gl_FrontFacing) {
          // The snapshot already carries the lamp's light — only add the change of angle.
          col = fromSRGB(texture2D(tSnap, vSnapUv).rgb);
          float ndl = dot(n, normalize(uLampPos - vWorldPos));
          float flat0 = dot(vec3(0.0, 1.0, 0.0), normalize(uLampPos - vWorldPos));
          float lit = smoothstep(-0.05, 0.1, ndl);
          col *= mix(uShadowColor, vec3(1.0), lit) * mix(0.85, 1.05, clamp(ndl / max(flat0, 0.2), 0.0, 1.0));
        } else {
          n = -n;
          vn = -vn;
          col = texture2D(tBack, vec2(1.0 - vUv.x, vUv.y)).rgb;
          float ndl = dot(n, normalize(uLampPos - vWorldPos));
          float lit = smoothstep(0.0, 0.05, ndl) * 0.4 + smoothstep(0.32, 0.37, ndl) * 0.6;
          col *= mix(uShadowColor * 0.9, uLampColor, lit);
        }
        gl_FragColor = vec4(toSRGB(col), 1.0);
        gNormal = vec4(vn * 0.5 + 0.5, (124.0 * 2.0) / 255.0);
      }
    `
  })

const depthMaterial = (uniforms: ShaderMaterial['uniforms']): ShaderMaterial =>
  new ShaderMaterial({
    side: DoubleSide,
    uniforms: { uMode: uniforms.uMode!, uT: uniforms.uT!, uSpineX: uniforms.uSpineX! },
    vertexShader: /* glsl */ `
      ${DEFORM}
      void main() {
        vec3 n = vec3(0.0, 1.0, 0.0);
        vec3 p = deform(position, n);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      #include <packing>
      void main() { gl_FragColor = packDepthToRGBA(gl_FragCoord.z); }
    `
  })

export class SheetView {
  readonly mesh: Mesh
  readonly mat: ShaderMaterial
  private readonly snapUv: BufferAttribute
  private readonly flat: Float32Array
  private readonly tmp = new Vector3()
  mode: SheetMode = 'hidden'
  t = 0

  constructor(back: Texture) {
    const g = new PlaneGeometry(PAGE_HALF_W * 2, PAGE_HALF_D * 2, 48, 64)
    g.rotateX(-Math.PI / 2)
    g.translate(0, 0.02, 0)
    const pos = g.getAttribute('position')
    this.flat = new Float32Array(pos.array as Float32Array)
    this.snapUv = new BufferAttribute(new Float32Array(pos.count * 2), 2)
    g.setAttribute('aSnapUv', this.snapUv)
    this.mat = material()
    this.mat.uniforms.tBack!.value = back
    this.mesh = new Mesh(g, this.mat)
    this.mesh.customDepthMaterial = depthMaterial(this.mat.uniforms)
    this.mesh.castShadow = true
    this.mesh.frustumCulled = false
    this.mesh.visible = false
    this.mesh.renderOrder = 5
    this.mesh.userData.perfTag = 'fold.sheet'
  }

  /** Bind a snapshot of the camera's current frame and compute projective UVs. */
  bind(snapshot: Texture, camera: Camera): void {
    this.mat.uniforms.tSnap!.value = snapshot
    const uv = this.snapUv.array as Float32Array
    const f = this.flat
    camera.updateMatrixWorld()
    for (let i = 0; i < f.length / 3; i++) {
      this.tmp.set(f[i * 3]!, f[i * 3 + 1]!, f[i * 3 + 2]!).project(camera)
      uv[i * 2] = this.tmp.x * 0.5 + 0.5
      uv[i * 2 + 1] = this.tmp.y * 0.5 + 0.5
    }
    this.snapUv.needsUpdate = true
  }

  start(mode: SheetMode): void {
    this.mode = mode
    this.t = 0
    this.mesh.visible = mode !== 'hidden'
    this.mesh.position.set(0, 0, 0)
    this.mesh.rotation.set(0, 0, 0)
    this.mesh.scale.setScalar(1)
    this.mat.uniforms.uMode!.value = MODE_CODE[mode]
    this.mat.uniforms.uT!.value = 0
  }

  set(t: number): void {
    this.t = t
    this.mat.uniforms.uT!.value = t
  }

  hide(): void {
    this.mode = 'hidden'
    this.mesh.visible = false
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.mat.dispose()
    ;(this.mesh.customDepthMaterial as ShaderMaterial).dispose()
  }
}
