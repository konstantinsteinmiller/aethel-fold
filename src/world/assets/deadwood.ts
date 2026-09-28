import type { BufferGeometry } from 'three'
import { Color, Matrix4, Vector3 } from 'three'
import { C } from '../art/palette'
import type { Rng } from '../geometry/rng'
import { ensureColorAttribute } from '../geometry/vertexColor'

/**
 * ─── Shared kit for dead and cut wood ───────────────────────────────────────
 *
 * `stump.ts` and `deadTree.ts` are the same material seen twice — a bole with
 * no leaves on it — and they need the same four things: a frame to launch a
 * root or a limb in, a weathered-wood colour, a fissure pass keyed to the
 * section's own valleys, and the pale exposed wood of a break. This file is
 * where those live so the two props cannot drift apart.
 *
 * They must not drift, because in the world they stand *next to each other*.
 * A stump is what is left of the tree the snag beside it is turning into, and
 * two files carrying two slightly different browns is the one mistake that
 * makes a set of props read as assembled rather than art-directed. The tree
 * generator already makes the same argument for keeping two species in one
 * table (`tree.ts`, "the colours carry as much of the read as the geometry").
 *
 * ── The palette gains nothing here, on purpose ──────────────────────────────
 *
 * Dead wood is a *state* of an existing material, not a new one, so every
 * colour below is a mix of entries that already exist (GDD §3 — the palette is
 * a single source of truth, and a state that only ever appears at 55 % strength
 * is not worth an entry). `barkOldBase` toward `birchBase` is sun-bleached
 * silver; `sand` toward `birchLit` is the cream of a fresh cut. Both were tried
 * as literal greys first and read as *stone* — the warmth is what keeps a snag
 * reading as wood at 40 m, where its silhouette is a vertical bar either way.
 */

const TAU = Math.PI * 2

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t)

// ─── Colours ────────────────────────────────────────────────────────────────

/**
 * Sun-bleached standing deadwood. Not `birchBase` outright: a snag stripped to
 * pale grey is a birch trunk with no canopy, which is a different tree rather
 * than a dead one, and the two stand in the same wood.
 */
export const DEADWOOD_LIT = C.barkOldBase.clone().lerp(C.birchBase, 0.55)

/** The shaded flank and the fissure floor. Stays brown — see `DEADWOOD_LIT`. */
export const DEADWOOD_DARK = C.barkOldDark.clone().lerp(C.barkOldBase, 0.35)

/**
 * Freshly exposed wood: a saw cut, an axe notch, the torn end of a break.
 *
 * The single most valuable colour in this file. It is the only surface in the
 * forest that is *paler than the ground it stands on*, which is what makes a
 * stump readable from above at forty metres for zero triangles (GDD R1) — the
 * bark silhouette of a stump is a boulder's silhouette, and the cut face is the
 * whole difference.
 */
export const SAPWOOD = C.sand.clone().lerp(C.birchLit, 0.3)

/** Heartwood: the darker growth rings inside the sapwood ring. */
export const HEARTWOOD = C.barkBase.clone().lerp(C.sand, 0.34)

const _paint = new Color()

// ─── The launch frame for a root or a limb ──────────────────────────────────

const _x = new Vector3()
const _y = new Vector3()
const _z = new Vector3()

/**
 * Local → object for one branch, root or limb. Local **+Y is the direction the
 * branch leaves the bole in**; +X is the outward horizontal bearing
 * orthogonalised against it, so a plain `+X` offset in the loft curls the
 * branch toward (or past) the horizontal.
 *
 * This exists because `tubeGeometry` cannot build a branch at all: its rings are
 * horizontal circles by construction (`y = ring.center.y` for the whole ring),
 * so the horizontal section of a tube tilted `τ` from vertical comes out
 * `1/cos τ` too wide — 22 % at 35°, **2.4×** at 65°, and a root leaving at 80°
 * is a flat ribbon rather than a root. `oldOak.ts` reached the same conclusion
 * for its limbs; this is that argument applied to everything that is not a
 * trunk.
 *
 * `tilt` past π/2 points the branch **downward**, which is what a root wants and
 * the reason this is not clamped.
 */
export const branchFrame = (origin: Vector3, bearing: number, tilt: number, out: Matrix4): Matrix4 => {
  const sin = Math.sin(tilt)
  const cos = Math.cos(tilt)
  _y.set(sin * Math.cos(bearing), cos, sin * Math.sin(bearing))
  _x.set(Math.cos(bearing), 0, Math.sin(bearing)).addScaledVector(_y, -sin)
  // A branch leaving dead horizontal makes `_x` the zero vector, because the
  // bearing it is being orthogonalised against *is* the branch axis. The axis's
  // own vertical component is the only direction left that is still horizontal
  // in object space, and at `tilt = π/2` exactly it is straight down — which is
  // the correct place for a root's droop to point.
  if (_x.lengthSq() < 1e-10) {
    _x.set(0, -1, 0)
  }
  _x.normalize()
  _z.crossVectors(_x, _y)
  out.makeBasis(_x, _y, _z)
  out.setPosition(origin.x, origin.y, origin.z)
  return out
}

// ─── Bark fissures ──────────────────────────────────────────────────────────

/**
 * Bearing → groove depth, 0 on a crest and 1 in the deepest fissure.
 *
 * Copied in spirit from `oldOak.ts::makeBarkGroove` and kept to the same two
 * rules, both of which are about tiers agreeing rather than about bark:
 *
 *   • **integer harmonics only**, at or below the 4th. These boles are sampled
 *     at 6 or 8 bearings at their finest tier, so a 7th harmonic aliases into a
 *     *different* pattern on every tier — the colour equivalent of the flute
 *     jitter `makeFlutes` was written to avoid.
 *   • **a floor under the valley term.** The coarsest tiers sample only the
 *     crests, where the section term is exactly 0, so without the floor a bole
 *     would jump a whole shade lighter across the LOD1→LOD2 crossfade.
 */
export const makeWoodGrain = (rng: Rng, sectionAt: (theta: number) => number): ((theta: number) => number) => {
  let low = Number.POSITIVE_INFINITY
  for (let i = 0; i < 256; i++) {
    low = Math.min(low, sectionAt((i / 256) * TAU))
  }
  const span = Math.max(1e-3, 1 - low)

  const f1 = rng.int(2, 3)
  const f2 = rng.int(3, 4)
  const p1 = rng.range(0, TAU)
  const p2 = rng.range(0, TAU)

  return theta => {
    const valley = clamp01((1 - sectionAt(theta)) / span)
    const grain = 0.5 + 0.5 * Math.cos(f1 * theta + p1)
    const cross = 0.5 + 0.5 * Math.cos(f2 * theta + p2)
    return clamp01(0.22 + 0.48 * valley + 0.2 * grain + 0.1 * cross)
  }
}

const _axis = new Vector3()

/**
 * Darkens the valleys of a bole's section toward `DEADWOOD_DARK`.
 *
 * The bearing is measured against the bole's **jogged** axis at that height, not
 * against the object origin, so the grooves stay on the flutes when the bole
 * leans or a fallen log bends. `loftGeometry` writes `x = cosθ·r + offsetX`, so
 * this recovers exactly the θ the section was evaluated at, on every tier.
 */
export const paintWoodGrain = (
  geometry: BufferGeometry,
  axisAt: (y: number, out: Vector3) => Vector3,
  grooveAt: (theta: number) => number,
  strength: number
): BufferGeometry => {
  const position = geometry.getAttribute('position')
  const attribute = ensureColorAttribute(geometry)
  const array = attribute.array as Float32Array

  for (let i = 0; i < position.count; i++) {
    axisAt(position.getY(i), _axis)
    const dx = position.getX(i) - _axis.x
    const dz = position.getZ(i) - _axis.z
    if (dx * dx + dz * dz < 1e-10) {
      continue
    }
    const t = grooveAt(Math.atan2(dz, dx)) * strength
    const r = array[i * 3]!
    const g = array[i * 3 + 1]!
    const b = array[i * 3 + 2]!
    array[i * 3] = r + (DEADWOOD_DARK.r - r) * t
    array[i * 3 + 1] = g + (DEADWOOD_DARK.g - g) * t
    array[i * 3 + 2] = b + (DEADWOOD_DARK.b - b) * t
  }
  attribute.needsUpdate = true
  return geometry
}

/**
 * Moss on the up-facing, shaded flank of low wood.
 *
 * Gated on the normal's upness *and* on height *and* on bearing, all three, for
 * the reason `oldOak.ts::paintMoss` records: upness alone greens every surface
 * that faces the sky, and upness plus height paints a continuous collar that
 * reads as a stripe of paint rather than as something growing on one side.
 *
 * Held to 0.42 at its strongest here against the oak's 0.3, because a fallen log
 * is the one piece of wood in the world that has been lying in the damp — and
 * because the moss is the second-strongest cue, after the horizontal
 * silhouette, that it *is* fallen rather than felled.
 */
export const paintMoss = (
  geometry: BufferGeometry,
  bearing: Vector3,
  maxY: number,
  amount: number
): BufferGeometry => {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const attribute = ensureColorAttribute(geometry)
  const array = attribute.array as Float32Array

  for (let i = 0; i < position.count; i++) {
    const up = normal.getY(i)
    if (up < 0.08) {
      continue
    }
    const fade = 1 - clamp01(position.getY(i) / maxY)
    if (fade <= 0) {
      continue
    }
    const face = Math.max(0, normal.getX(i) * bearing.x + normal.getZ(i) * bearing.z)
    const t = up ** 1.5 * fade * (0.32 + 0.68 * face) * amount
    _paint.setRGB(array[i * 3]!, array[i * 3 + 1]!, array[i * 3 + 2]!).lerp(C.grassCapBase, t)
    array[i * 3] = _paint.r
    array[i * 3 + 1] = _paint.g
    array[i * 3 + 2] = _paint.b
  }
  attribute.needsUpdate = true
  return geometry
}

/**
 * Growth rings on an exposed cut, as a **continuous function of radius**.
 *
 * The rings are colour, not geometry (GDD R1), and the function is what makes
 * them LOD-safe: every tier samples the same `ringsAt` at whatever radii its
 * rings happen to sit at, so a 4-ring cut face and a 2-ring one agree on the
 * colour at every radius they share. Modelling the rings — or painting them
 * per-vertex-index — would put a different pattern on every tier and the
 * crossfade would show it.
 *
 * `harmonics` is an integer for the same reason the bark grain's are: a cut face
 * is sampled at 2–4 radii, and a fractional ring count lands the outermost ring
 * mid-band on one tier and on a crest on the next.
 */
export const ringsAt = (r: number, harmonics: number): number => {
  const t = clamp01(r)
  // Rings crowd toward the bark, which is what makes a stump read as *old*
  // rather than as a painted disc: `t²` is the cheapest available version of
  // "later years are thinner", and it is total, so the loft's central
  // differences can sample it outside [0, 1] without producing NaN.
  return 0.5 + 0.5 * Math.cos(harmonics * Math.PI * (t * t))
}

/**
 * Paints a cut face: pale sapwood at the rim, ringed heartwood inside.
 *
 * `sapwoodFrom` is where the pale outer ring begins as a fraction of the rim
 * radius. 0.78 rather than 0.9: at the coarsest tier the cut face has one
 * interior ring, and a sapwood band narrower than the gap between two rings can
 * miss every vertex — the pale ring would then exist at LOD0 and vanish at
 * LOD2, which is exactly the "both tiers look wrong at 50 % coverage" failure
 * the crossfade cannot hide (GDD §4.3).
 */
export const paintCutFace = (
  geometry: BufferGeometry,
  center: Vector3,
  rimRadius: number,
  harmonics: number,
  sapwoodFrom = 0.78
): BufferGeometry => {
  const position = geometry.getAttribute('position')
  const attribute = ensureColorAttribute(geometry)
  const array = attribute.array as Float32Array
  const inverse = 1 / (rimRadius || 1)

  for (let i = 0; i < position.count; i++) {
    const dx = position.getX(i) - center.x
    const dz = position.getZ(i) - center.z
    const t = clamp01(Math.hypot(dx, dz) * inverse)
    _paint.copy(HEARTWOOD).lerp(DEADWOOD_DARK, ringsAt(t, harmonics) * 0.55)
    // Smootherstep rather than a step: the sapwood boundary is a *material*
    // change and the bevel rule (GDD R2) applies to paint as much as to a cut —
    // a hard edge here reads as a decal at 3 m.
    const sap = clamp01((t - sapwoodFrom) / (1 - sapwoodFrom))
    _paint.lerp(SAPWOOD, sap * sap * (3 - 2 * sap))
    array[i * 3] = _paint.r
    array[i * 3 + 1] = _paint.g
    array[i * 3 + 2] = _paint.b
  }
  attribute.needsUpdate = true
  return geometry
}
