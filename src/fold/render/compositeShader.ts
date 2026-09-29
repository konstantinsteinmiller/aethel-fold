/**
 * The single full-screen pass that turns the flat toon render into the
 * Aethel Fold look (aethel-fold-GDD §2, §9, §10.1):
 *
 * 1. Sobel edge detection over view normals, linear depth and object ids →
 *    fine ink outlines of constant screen width, tinted by what they outline;
 * 2. the "actionable" id bit → a pulsing yellow glow along those outlines;
 * 3. tilt-shift: the top and bottom 15 % of the frame blur like a macro lens;
 * 4. warm lamp vignette, a whisper of screen grain, hit flashes and the
 *    pause desaturation.
 */

import { Color, ShaderMaterial, Vector2, type Texture } from 'three'
import { HEX } from './palette'

export const createCompositeMaterial = (): ShaderMaterial =>
  new ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tColor: { value: null as Texture | null },
      tNormal: { value: null as Texture | null },
      tDepth: { value: null as Texture | null },
      uRes: { value: new Vector2(1, 1) },
      uNear: { value: 0.1 },
      uFar: { value: 100 },
      uInk: { value: new Color(HEX.ink) },
      uInkWidth: { value: 2.2 },
      uHighlight: { value: new Color(HEX.highlight) },
      uHighlightHot: { value: new Color(HEX.highlightHot) },
      uPulse: { value: 0 },
      uTiltBand: { value: 0.15 },
      uTiltRadius: { value: 5 },
      uVignette: { value: 0.32 },
      uGrain: { value: 0.035 },
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uFlashColor: { value: new Color(HEX.danger) },
      uWhite: { value: 0 },
      uDesat: { value: 0 },
      uFocus: { value: 0 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tColor;
      uniform sampler2D tNormal;
      uniform sampler2D tDepth;
      uniform vec2 uRes;
      uniform float uNear;
      uniform float uFar;
      uniform vec3 uInk;
      uniform float uInkWidth;
      uniform vec3 uHighlight;
      uniform vec3 uHighlightHot;
      uniform float uPulse;
      uniform float uTiltBand;
      uniform float uTiltRadius;
      uniform float uVignette;
      uniform float uGrain;
      uniform float uTime;
      uniform float uFlash;
      uniform vec3 uFlashColor;
      uniform float uWhite;
      uniform float uDesat;
      uniform float uFocus;
      varying vec2 vUv;

      float linDepth(vec2 uv) {
        float d = texture2D(tDepth, uv).r;
        float z = d * 2.0 - 1.0;
        return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
      }

      float idOf(float a) { return floor(a * 255.0 / 2.0 + 0.01); }
      float hlOf(float a) { return mod(floor(a * 255.0 + 0.01), 2.0); }

      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      // Id 127 = "no ink" (confetti, flames): never outlined, never outlines.
      const float NO_INK = 126.5;

      vec3 inkAt(vec2 uv, vec3 base, out float edgeOut, out float hlOut) {
        vec2 px = uInkWidth * 0.5 / uRes;
        vec4 n4 = texture2D(tNormal, uv);
        float d4 = linDepth(uv);
        float c = idOf(n4.a);
        if (c > NO_INK) {
          edgeOut = 0.0;
          hlOut = 0.0;
          return uInk;
        }
        vec2 offs[8] = vec2[8](
          vec2(-px.x, -px.y), vec2(0.0, -px.y), vec2(px.x, -px.y), vec2(-px.x, 0.0),
          vec2(px.x, 0.0), vec2(-px.x, px.y), vec2(0.0, px.y), vec2(px.x, px.y)
        );
        vec4 n[8];
        float d[8];
        for (int i = 0; i < 8; i++) {
          vec4 s = texture2D(tNormal, uv + offs[i]);
          if (idOf(s.a) > NO_INK) {
            n[i] = n4;
            d[i] = d4;
          } else {
            n[i] = s;
            d[i] = linDepth(uv + offs[i]);
          }
        }
        // Sobel over normals (layout: 0 1 2 / 3 c 4 / 5 6 7).
        vec3 gx = -n[0].rgb - 2.0 * n[3].rgb - n[5].rgb + n[2].rgb + 2.0 * n[4].rgb + n[7].rgb;
        vec3 gy = -n[0].rgb - 2.0 * n[1].rgb - n[2].rgb + n[5].rgb + 2.0 * n[6].rgb + n[7].rgb;
        float ne = length(gx) + length(gy);
        float dgx = -d[0] - 2.0 * d[3] - d[5] + d[2] + 2.0 * d[4] + d[7];
        float dgy = -d[0] - 2.0 * d[1] - d[2] + d[5] + 2.0 * d[6] + d[7];
        float de = (abs(dgx) + abs(dgy)) / max(d4, 0.001);

        float ie = 0.0;
        ie = max(ie, step(0.5, abs(idOf(n[1].a) - c)));
        ie = max(ie, step(0.5, abs(idOf(n[3].a) - c)));
        ie = max(ie, step(0.5, abs(idOf(n[4].a) - c)));
        ie = max(ie, step(0.5, abs(idOf(n[6].a) - c)));

        float hl = max(max(hlOf(n4.a), hlOf(n[1].a)), max(max(hlOf(n[3].a), hlOf(n[4].a)), hlOf(n[6].a)));

        // Silhouettes and real creases only: the thresholds sit above the
        // angle between two facets of a low-poly tree, so props read as paper
        // shapes with a clean outline instead of a web of black lines.
        float edge = max(smoothstep(0.8, 1.5, ne), smoothstep(0.025, 0.07, de));
        edge = max(edge, ie * 0.85);
        edgeOut = edge;
        hlOut = hl * edge;
        // Ink keeps a trace of the colour it outlines, so lines read as ink on paper, not as holes.
        return mix(uInk, base * 0.45, 0.3);
      }

      void main() {
        vec2 uv = vUv;
        vec3 col = texture2D(tColor, uv).rgb;

        // Tilt-shift (top & bottom bands).
        float tilt = max(smoothstep(1.0 - uTiltBand, 1.0, uv.y), 1.0 - smoothstep(0.0, uTiltBand, uv.y));
        tilt = max(tilt, uFocus * 0.35 * max(smoothstep(0.72, 1.0, uv.y), 1.0 - smoothstep(0.0, 0.28, uv.y)));
        vec3 blurred = col;
        if (tilt > 0.01) {
          float r = tilt * uTiltRadius;
          vec3 acc = col;
          float wsum = 1.0;
          for (int i = 0; i < 12; i++) {
            float fi = float(i);
            float ang = fi * 2.39996;
            float rad = sqrt((fi + 0.5) / 12.0) * r;
            vec2 o = vec2(cos(ang), sin(ang)) * rad / uRes;
            acc += texture2D(tColor, uv + o).rgb;
            wsum += 1.0;
          }
          blurred = acc / wsum;
        }

        float edge;
        float hl;
        vec3 ink = inkAt(uv, col, edge, hl);
        vec3 inked = mix(col, ink, edge);

        // GDD §9: actionable things glow with a pulsing yellow highlight along the black outline.
        if (hl > 0.0) {
          vec3 glow = mix(uHighlight, uHighlightHot, uPulse);
          inked = mix(inked, glow, hl * (0.55 + 0.45 * uPulse));
        }

        col = mix(inked, blurred, smoothstep(0.0, 1.0, tilt) * 0.92);

        // Lamp vignette: warm centre, cool dim corners.
        vec2 q = uv - 0.5;
        float vig = smoothstep(0.85, 0.2, length(q * vec2(1.0, 0.85)));
        col *= mix(1.0 - uVignette, 1.0, vig);

        // Hit flash from the edges inward.
        float edgeMask = smoothstep(0.25, 0.75, length(q) * 1.4);
        col = mix(col, uFlashColor, uFlash * edgeMask * 0.6);
        col = mix(col, vec3(1.0), uWhite);

        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(col, vec3(lum) * vec3(1.02, 0.98, 0.93), uDesat);

        col += (hash12(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * uGrain;
        gl_FragColor = vec4(col, 1.0);
      }
    `
  })
