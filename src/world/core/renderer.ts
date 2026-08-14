import { NeutralToneMapping, PCFSoftShadowMap, SRGBColorSpace, WebGLRenderer } from 'three'

/**
 * ─── Renderer setup ─────────────────────────────────────────────────────────
 *
 * Three choices here are art-direction decisions, not defaults:
 *
 * **`NeutralToneMapping`, not ACES.** ACES is built to make physically-lit
 * renders filmic, and it does that by desaturating and crushing the top end —
 * the exact opposite of what a cel-shaded world wants. The Khronos PBR Neutral
 * curve rolls off highlights without touching saturation, so the toon bands stay
 * as punchy as they were authored while nothing blows out to white.
 *
 * **MSAA on by default.** Cel shading lives and dies on silhouettes, and the
 * inverted-hull outlines are 1.6 px wide — aliasing eats them. This is the one
 * place worth spending fill rate; the render-scale slider is the mobile escape
 * hatch, not turning AA off.
 *
 * **DPR hard-capped at 2.** Above that the pixels are invisible and the cost is
 * quadratic. A 3× phone display would otherwise render 2.25× more pixels than a
 * 2× one for no perceptible gain (GDD §5.2).
 */

export interface RendererOptions {
  canvas: HTMLCanvasElement
  antialias?: boolean
  /** User-facing quality slider, 0.6–1.0. Multiplies the capped DPR. */
  renderScale?: number
  shadows?: boolean
  shadowMapSize?: number
}

export const MAX_PIXEL_RATIO = 2

export const createRenderer = (options: RendererOptions): WebGLRenderer => {
  const { canvas, antialias = true, shadows = true } = options

  const renderer = new WebGLRenderer({
    canvas,
    antialias,
    // The world is fully opaque with a sky dome behind it, so there's nothing to
    // composite against the page — and an opaque buffer lets the driver skip the
    // alpha blend on present.
    alpha: false,
    powerPreference: 'high-performance',
    // Depth-only prepass isn't used, and stencil costs bandwidth on tilers.
    stencil: false
  })

  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = NeutralToneMapping
  renderer.toneMappingExposure = 1

  renderer.shadowMap.enabled = shadows
  renderer.shadowMap.type = PCFSoftShadowMap
  // Shadows only move when the sun rig moves, but the sun rig follows the
  // camera, so this stays on. Flipping to manual updates is the first thing to
  // try if the shadow pass exceeds its 2 ms budget (GDD §5.1).
  renderer.shadowMap.autoUpdate = true

  return renderer
}

/**
 * Resizes to the element's CSS box at the effective pixel ratio.
 * Returns true when the drawing buffer actually changed, so callers can skip
 * recomputing LOD bias and outline width on the ~99 % of frames that don't.
 */
export const resizeRenderer = (
  renderer: WebGLRenderer,
  width: number,
  height: number,
  renderScale = 1
): boolean => {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO) * renderScale
  const targetWidth = Math.max(1, Math.floor(width * pixelRatio))
  const targetHeight = Math.max(1, Math.floor(height * pixelRatio))

  const buffer = renderer.getContext().canvas
  if (buffer.width === targetWidth && buffer.height === targetHeight) {
    return false
  }

  renderer.setPixelRatio(pixelRatio)
  // `false` — never let three write inline styles onto the canvas; the Vue
  // layer owns layout, and a renderer-set `style.width` fights CSS sizing and
  // safe-area insets.
  renderer.setSize(width, height, false)
  return true
}
