/**
 * FoldRenderer — owns the WebGL context and the frame pipeline:
 *
 *   scene (layer 0, PaperMaterial) ──► MRT [colour, normal+id] + depth
 *                                   └► composite (ink, glow, tilt-shift) ──► canvas
 *   overlay scene (additive glows, no depth) ──────────────────────────────► canvas
 *
 * Adaptive resolution: the drawing-buffer scale follows the p90 frame time so
 * a phone that can't hold 60 fps trades pixels, never gameplay.
 */

import {
  DepthTexture, LinearFilter, Mesh, NearestFilter, OrthographicCamera, PCFShadowMap, PlaneGeometry,
  Scene, SRGBColorSpace, UnsignedByteType, UnsignedIntType, WebGLRenderTarget, WebGLRenderer,
  type Camera, type ShaderMaterial
} from 'three'
import { createCompositeMaterial } from './compositeShader'

export interface RendererOptions {
  canvas: HTMLCanvasElement
  /** Max device-pixel ratio (the adaptive scale multiplies under it). */
  maxDpr?: number
}

export class FoldRenderer {
  readonly renderer: WebGLRenderer
  readonly composite: ShaderMaterial
  readonly overlay = new Scene()
  private mrt: WebGLRenderTarget
  private readonly quadScene = new Scene()
  private readonly quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private width = 1
  private height = 1
  private dpr = 1
  private readonly maxDpr: number
  /** Adaptive scale 0.55…1 applied on top of the DPR. */
  scale = 1
  /** Lock the scale (settings "quality: high/low"). null = adaptive. */
  scaleLock: number | null = null
  private frameTimes = new Float32Array(90)
  private frameIdx = 0
  private lastAdapt = 0
  readonly isMobile: boolean

  constructor(o: RendererOptions) {
    this.isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
    this.maxDpr = o.maxDpr ?? (this.isMobile ? 2 : 2)
    this.renderer = new WebGLRenderer({
      canvas: o.canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false
    })
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFShadowMap
    this.renderer.autoClear = true
    this.mrt = this.makeTarget(1, 1)
    this.composite = createCompositeMaterial()
    const quad = new Mesh(new PlaneGeometry(2, 2), this.composite)
    quad.frustumCulled = false
    this.quadScene.add(quad)
  }

  private makeTarget(w: number, h: number): WebGLRenderTarget {
    const depth = new DepthTexture(w, h, UnsignedIntType)
    const rt = new WebGLRenderTarget(w, h, {
      count: 2,
      type: UnsignedByteType,
      depthBuffer: true,
      depthTexture: depth,
      minFilter: NearestFilter,
      magFilter: NearestFilter
    })
    // Colour is sampled by the tilt-shift blur: linear filtering reads smoother.
    rt.textures[0]!.minFilter = LinearFilter
    rt.textures[0]!.magFilter = LinearFilter
    rt.textures[0]!.name = 'fold.colour'
    rt.textures[1]!.name = 'fold.normalId'
    return rt
  }

  get drawingWidth(): number {
    return Math.max(1, Math.round(this.width * this.dpr * this.effectiveScale))
  }

  get drawingHeight(): number {
    return Math.max(1, Math.round(this.height * this.dpr * this.effectiveScale))
  }

  get effectiveScale(): number {
    return this.scaleLock ?? this.scale
  }

  setSize(cssW: number, cssH: number): void {
    this.width = Math.max(1, cssW)
    this.height = Math.max(1, cssH)
    this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr)
    this.applySize()
  }

  private applySize(): void {
    const w = this.drawingWidth
    const h = this.drawingHeight
    this.renderer.setPixelRatio(1)
    this.renderer.setSize(w, h, false)
    this.mrt.setSize(w, h)
    const u = this.composite.uniforms
    u.uRes!.value.set(w, h)
    // Ink width in drawing pixels: bold, and constant on screen whatever the scale.
    u.uInkWidth!.value = Math.max(1.1, 2.1 * this.dpr * this.effectiveScale)
    u.uTiltRadius!.value = 5.5 * this.dpr * this.effectiveScale
  }

  /** Record a frame's wall time (ms) and adapt resolution. */
  sample(frameMs: number, now: number): void {
    this.frameTimes[this.frameIdx++ % this.frameTimes.length] = frameMs
    if (this.scaleLock !== null || now - this.lastAdapt < 1500 || this.frameIdx < this.frameTimes.length) return
    this.lastAdapt = now
    const sorted = Array.from(this.frameTimes).sort((a, b) => a - b)
    const p90 = sorted[Math.floor(sorted.length * 0.9)]!
    const prev = this.scale
    if (p90 > 22) this.scale = Math.max(0.65, this.scale - 0.1)
    else if (p90 < 15 && this.scale < 1) this.scale = Math.min(1, this.scale + 0.05)
    if (this.scale !== prev) this.applySize()
  }

  /** Render one frame of `scene` through the ink pipeline to the canvas. */
  render(scene: Scene, camera: Camera & { near: number; far: number }, time: number): void {
    const r = this.renderer
    r.setRenderTarget(this.mrt)
    r.render(scene, camera)
    const u = this.composite.uniforms
    u.tColor!.value = this.mrt.textures[0]
    u.tNormal!.value = this.mrt.textures[1]
    u.tDepth!.value = this.mrt.depthTexture
    u.uNear!.value = camera.near
    u.uFar!.value = camera.far
    u.uTime!.value = time
    r.setRenderTarget(null)
    r.render(this.quadScene, this.quadCam)
    if (this.overlay.children.length > 0) {
      r.autoClear = false
      r.render(this.overlay, camera)
      r.autoClear = true
    }
  }

  /**
   * Render `scene` from `camera` through the full ink pipeline into `target`
   * (used to snapshot the page for page turns, peels and crumples).
   */
  renderTo(scene: Scene, camera: Camera & { near: number; far: number }, target: WebGLRenderTarget, mrt: WebGLRenderTarget): void {
    const r = this.renderer
    const u = this.composite.uniforms
    const res = u.uRes!.value.clone()
    const ink = u.uInkWidth!.value
    const tilt = u.uTiltBand!.value
    const vig = u.uVignette!.value
    const grain = u.uGrain!.value
    const flash = u.uFlash!.value
    const white = u.uWhite!.value
    const desat = u.uDesat!.value
    r.setRenderTarget(mrt)
    r.render(scene, camera)
    u.tColor!.value = mrt.textures[0]
    u.tNormal!.value = mrt.textures[1]
    u.tDepth!.value = mrt.depthTexture
    u.uNear!.value = camera.near
    u.uFar!.value = camera.far
    u.uRes!.value.set(target.width, target.height)
    u.uInkWidth!.value = Math.max(1.5, target.width / 520)
    u.uTiltBand!.value = 0
    u.uVignette!.value = 0
    u.uGrain!.value = 0
    u.uFlash!.value = 0
    u.uWhite!.value = 0
    u.uDesat!.value = 0
    r.setRenderTarget(target)
    r.render(this.quadScene, this.quadCam)
    r.setRenderTarget(null)
    u.uRes!.value.copy(res)
    u.uInkWidth!.value = ink
    u.uTiltBand!.value = tilt
    u.uVignette!.value = vig
    u.uGrain!.value = grain
    u.uFlash!.value = flash
    u.uWhite!.value = white
    u.uDesat!.value = desat
  }

  /** An MRT target shaped like the main one, for off-screen pipeline renders. */
  createPipelineTarget(w: number, h: number): WebGLRenderTarget {
    return this.makeTarget(w, h)
  }

  /** A plain colour target (the snapshot the sheet samples). */
  createColorTarget(w: number, h: number): WebGLRenderTarget {
    const rt = new WebGLRenderTarget(w, h, { type: UnsignedByteType, depthBuffer: false })
    rt.texture.name = 'fold.snapshot'
    return rt
  }

  dispose(): void {
    this.mrt.dispose()
    this.composite.dispose()
    this.renderer.dispose()
  }
}
