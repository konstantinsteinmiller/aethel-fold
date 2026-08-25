import { C } from '../art/palette'
import type { WaterStyle } from './types'

/**
 * ─── Water presets ──────────────────────────────────────────────────────────
 *
 * Points in the `WaterStyle` space, not special cases — nothing downstream
 * branches on which one it was given. They exist so the editor has sane
 * starting values and so the four bodies of water the reference asks for
 * (pond, sea, river, fall) are one dial-set apart rather than four systems.
 *
 * The numbers are the art direction, so they carry their reasoning:
 *
 * **`pond` has `waveAmplitude: 0` exactly.** Not 0.01. A pond in the reference
 * is a mirror, and the failure mode of a nearly-still surface is specific and
 * bad — on a body only a few metres across, any vertical motion at all has a
 * wavelength comparable to the pond itself, so the whole sheet heaves and reads
 * as jelly. Stillness is a look, not the absence of one.
 *
 * **`sea` moves but barely drifts.** Real open water bobs far more than it
 * travels, and a sea given river-like `flowSpeed` reads as a conveyor belt.
 * Its long wavelength is what sells scale: shorten it and the sea becomes a
 * puddle no matter how large the plane is.
 *
 * **`river` is mostly flow, with a short wavelength and real crest foam.** The
 * eye reads current from the *pattern travelling*, not from the surface moving
 * up and down, so amplitude stays low and `flowSpeed` does the work.
 *
 * **`fall` is nearly all foam.** A waterfall in this reference is white with
 * blue in the gaps, not blue with white on top — so its shallow/mid stops are
 * pushed toward the foam colour and `crestFoam` is high. Its `flowSpeed` is an
 * order above the river's, because falling water is the one place in the world
 * where fast reads as correct rather than as boiling.
 */

export const WATER_STYLES: Record<string, WaterStyle> = {
  pond: {
    id: 'pond',
    label: 'Pond (still)',
    waveAmplitude: 0,
    waveLength: 3.2,
    waveSpeed: 0.18,
    // A mirror has no crests to sharpen. Also load-bearing: at 0 the Gerstner
    // path reduces to the sinusoidal one exactly, which is what keeps
    // `motion[pond] = 0.000` bit-exact.
    steepness: 0,
    flowSpeed: 0,
    shallow: C.waterShallow,
    mid: C.waterMid,
    deep: C.waterDeep,
    foam: C.waterFoam,
    // Shallow by definition — a pond that grades to open-sea blue in the middle
    // reads as a hole rather than as a pool.
    depthFalloff: 1.6,
    foamWidth: 0.5,
    crestFoam: 0,
    opacity: 0.72,
    // A mirror is *all* specular, and with no reflection probe the banded glint
    // is the only thing standing in for one. Highest in the set on purpose.
    sparkle: 0.9,
    rimStrength: 0.5
  },

  sea: {
    id: 'sea',
    label: 'Sea (drifting)',
    waveAmplitude: 0.16,
    waveLength: 11,
    waveSpeed: 0.42,
    // The headline case. Open water is where a sine swell most obviously reads
    // as fabric rather than as sea, because the eye knows a real crest is
    // narrow and a real trough is broad. High, but under the loop clamp.
    steepness: 0.78,
    flowSpeed: 0.05,
    shallow: C.waterShallow,
    mid: C.waterMid,
    deep: C.waterDeep,
    depthFalloff: 7,
    foam: C.waterFoam,
    foamWidth: 1.5,
    crestFoam: 0.18,
    opacity: 0.8,
    // Raised from 0.65 after the shader's glitter pass measured out as "a lane
    // of glints" rather than the reference's hard bright road to the horizon.
    // With no reflection probe the quantised glint is the *only* stand-in for a
    // sun reflection, so the sea is the one body that wants it near the top of
    // its range — a pond is small enough that its whole surface is the
    // highlight, while a sea has to draw a path across kilometres.
    sparkle: 0.88,
    rimStrength: 0.45
  },

  river: {
    id: 'river',
    label: 'River (flowing)',
    waveAmplitude: 0.055,
    waveLength: 1.9,
    waveSpeed: 1.1,
    // Lower than the sea's, and not because a river is calmer — its amplitude is
    // already a third of the sea's, and steepness is what turns that little
    // amplitude into standing chop over a bed. Pushed higher it bunches vertices
    // across a channel only a few metres wide and the banks visibly breathe.
    steepness: 0.45,
    flowSpeed: 1.35,
    shallow: C.waterShallow,
    mid: C.waterMid,
    deep: C.waterDeep,
    foam: C.waterFoam,
    depthFalloff: 1.9,
    // Wide relative to a river's half-width on purpose: a channel three metres
    // across should be foaming most of the way over, which is what makes it
    // read as shallow and fast rather than as a blue ribbon lying on the grass.
    foamWidth: 0.8,
    crestFoam: 0.4,
    opacity: 0.7,
    sparkle: 0.5,
    rimStrength: 0.5
  },

  fall: {
    id: 'fall',
    label: 'Waterfall',
    waveAmplitude: 0.03,
    waveLength: 1.1,
    waveSpeed: 1.6,
    // A curtain is vertical. Horizontal bunching would drag the sheet sideways
    // off the rock it hangs on, and the churn a fall needs comes from the atlas,
    // not from displacement.
    steepness: 0,
    flowSpeed: 5.5,
    // **Not** pushed toward foam, which is where this preset started and it was
    // measured wrong on screen. `aDepth` on a curtain is the sheet's thickness,
    // and a strand is thin nearly everywhere — so mapping the shallow end to
    // `waterFoam` put white across almost the entire fall. Rendered against the
    // world's haze the falls came out as pale grey ribbons that read as cloth,
    // with none of the reference's cyan anywhere in them.
    //
    // The white the reference actually shows is an *edge*: every strand is rimmed
    // and the lip and splash are bright, all of which arrive through `aShore` and
    // `foam` — a channel this ramp does not control. So the depth ramp is free to
    // stay properly blue, and the two together give cyan strands with white edges
    // instead of white strands with nothing.
    shallow: C.waterShallow,
    mid: C.waterMid,
    deep: C.waterDeep,
    foam: C.waterFoam,
    depthFalloff: 0.9,
    foamWidth: 0.35,
    crestFoam: 0.75,
    // Raised from 0.82. Rendered against the sky the curtains read as pale
    // translucent veils rather than as the reference's solid bright water —
    // a fall is the one body of water in the set the eye expects to be *opaque*,
    // because there is nothing behind it to see through to. Everything else here
    // earns its translucency by showing a bottom; a curtain hanging in front of
    // a cliff face has only the cliff to show, and showing it is the artifact.
    opacity: 0.94,
    sparkle: 0.4,
    rimStrength: 0.7
  }
}

export const DEFAULT_WATER_STYLE = 'pond'

/** Falls back to the pond rather than throwing — a bad id must not blank the world. */
export const waterStyle = (id: string): WaterStyle => WATER_STYLES[id] ?? WATER_STYLES[DEFAULT_WATER_STYLE]!

export const waterStyleIds = (): string[] => Object.keys(WATER_STYLES)
