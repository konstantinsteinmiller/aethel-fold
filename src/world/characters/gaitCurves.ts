/**
 * ─── Joint angles from gait analysis ────────────────────────────────────────
 *
 * Sagittal-plane hip, knee and ankle angles over one gait cycle, in degrees,
 * following the shape of standard clinical gait data (Winter, *Biomechanics and
 * Motor Control of Human Movement*). Not invented curves — the whole point is
 * that a human walk has a specific, recognisable shape that nothing sinusoidal
 * reproduces.
 *
 * ── The cycle ───────────────────────────────────────────────────────────────
 *
 * `t = 0` is **heel strike** of the leg in question. The other leg is half a
 * cycle behind.
 *
 *   walk   0.00  heel strike, hip flexed ~25°, knee nearly straight
 *          0.12  loading response — knee flexes ~18° to absorb bodyweight
 *          0.30  mid-stance, leg vertical, body at its highest
 *          0.50  heel off, hip at full extension
 *          0.60  toe off — ankle plantarflexes hard, this is the push
 *          0.72  mid-swing, knee at its ~62° peak to clear the ground
 *          0.90  terminal swing, knee extending for the next strike
 *
 * The loading-response dip at 0.12 is the single most important feature. It is
 * the knee absorbing the body's weight, it is what makes a walk look *heavy*,
 * and it is entirely absent from any curve built out of one sine wave.
 *
 * ── Running is not a fast walk ──────────────────────────────────────────────
 *
 * The differences are structural, not amplitudes:
 *
 * * **Flight.** A walk always has a foot down; a run has an airborne phase, so
 *   stance is only ~35 % of the cycle instead of ~60 %.
 * * **The body's vertical motion inverts.** Walking, the pelvis is *highest* at
 *   mid-stance — it vaults over a straight leg. Running, it is *lowest* at
 *   mid-stance, because the knee flexes ~45° to absorb landing, and highest in
 *   mid-flight. Reusing the walk's vertical curve at a higher amplitude is what
 *   makes a run read as a hurried walk.
 * * **Knee flexion roughly doubles**, peaking near 125° as the heel comes up
 *   toward the buttock.
 */

/** `[phase, degrees]`, ascending phase, implicitly wrapping at 1. */
export type Curve = readonly (readonly [number, number])[]

/**
 * Hip flexion. **Positive is the thigh swinging forward.**
 *
 * Sign convention matters more than the numbers here, and it is the thing this
 * file got wrong the first time: rotating a downward-pointing bone about +X
 * moves its tip *backwards* (measured, not assumed). So every angle below is a
 * flexion magnitude and `poses.ts` negates it exactly once, in one place.
 */
export const WALK_HIP: Curve = [
  [0.0, 25],
  [0.12, 18],
  [0.3, 5],
  [0.45, -8],
  [0.55, -15],
  [0.62, -10],
  [0.75, 12],
  [0.88, 27],
  [0.95, 28]
]

/** Knee flexion. Positive folds the shin backwards, heel toward the buttock. */
export const WALK_KNEE: Curve = [
  [0.0, 5],
  [0.12, 18],
  [0.28, 8],
  [0.42, 5],
  [0.55, 22],
  [0.65, 48],
  [0.73, 62],
  [0.85, 38],
  [0.95, 8]
]

/** Ankle. Positive is dorsiflexion — toes toward the shin. */
export const WALK_ANKLE: Curve = [
  [0.0, 0],
  [0.08, -5],
  [0.3, 5],
  [0.45, 12],
  [0.55, 5],
  [0.62, -18],
  [0.7, -8],
  [0.85, 2],
  [0.95, 0]
]

export const RUN_HIP: Curve = [
  [0.0, 35],
  [0.1, 22],
  [0.22, 2],
  [0.35, -20],
  [0.45, -12],
  [0.6, 15],
  [0.75, 38],
  [0.9, 42],
  [0.97, 38]
]

export const RUN_KNEE: Curve = [
  [0.0, 22],
  [0.1, 45],
  [0.22, 32],
  [0.35, 38],
  [0.48, 85],
  [0.6, 125],
  [0.72, 95],
  [0.85, 45],
  [0.95, 25]
]

export const RUN_ANKLE: Curve = [
  [0.0, -8],
  [0.08, 6],
  [0.22, 14],
  [0.33, -22],
  [0.45, -12],
  [0.6, 5],
  [0.8, 8],
  [0.95, -4]
]

/**
 * Pelvis height over the cycle, normalised to ±1.
 *
 * Walking: highest at mid-stance (0.3), lowest at the double-support handovers.
 * Running: lowest at mid-stance (0.15) where the knee is absorbing, highest in
 * mid-flight (0.42). Two oscillations per stride in both cases, but a quarter
 * cycle out of phase with each other — which is the inversion described above.
 */
export const WALK_RISE: Curve = [
  [0.0, -1],
  [0.15, 0.4],
  [0.3, 1],
  [0.45, 0.2],
  [0.5, -1],
  [0.65, 0.4],
  [0.8, 1],
  [0.95, 0.2]
]

export const RUN_RISE: Curve = [
  [0.0, 0.2],
  [0.15, -1],
  [0.3, 0.3],
  [0.42, 1],
  [0.5, 0.7],
  [0.65, -1],
  [0.8, 0.3],
  [0.92, 1]
]

/** Shoulder flexion, positive forward. Opposes the leg on the same side. */
export const WALK_SHOULDER: Curve = [
  [0.0, -22],
  [0.25, -8],
  [0.5, 20],
  [0.75, 4],
  [0.95, -20]
]

export const RUN_SHOULDER: Curve = [
  [0.0, -40],
  [0.22, -10],
  [0.5, 45],
  [0.75, 8],
  [0.95, -36]
]

/**
 * Elbow flexion. **Positive folds the hand forward, in front of the body.**
 *
 * The opposite of a knee, and the reason the arms were inverted for two
 * revisions: a knee folds the shin *backwards* (heel toward the buttock), an
 * elbow folds the forearm *forwards* (hand toward the chest). Both were written
 * with the same sign. Stand with your arms at your sides and bend one — the hand
 * comes up in front of you, not behind.
 *
 * Walking, the elbow hovers near 25° and tightens slightly on the forward
 * swing. Running, it is held near 90° throughout — a runner's arms are folded
 * levers, and an extended arm is the clearest possible tell that a "run" is
 * really a fast walk.
 */
export const WALK_ELBOW: Curve = [
  [0.0, 30],
  [0.3, 20],
  [0.6, 38],
  [0.85, 28]
]

export const RUN_ELBOW: Curve = [
  [0.0, 95],
  [0.25, 80],
  [0.5, 100],
  [0.75, 85]
]

/**
 * Wrist flexion, positive folding the hand forward like the elbow.
 *
 * Small, and present because a hand rigidly continuing the line of the forearm
 * is one of the strongest tells of a puppet. A real hand hangs slightly flexed
 * and lags the forearm through a swing.
 */
export const WALK_WRIST: Curve = [
  [0.0, 10],
  [0.3, 4],
  [0.6, 16],
  [0.85, 8]
]

/** Running holds a loose fist, carried higher and more flexed than a walk. */
export const RUN_WRIST: Curve = [
  [0.0, 26],
  [0.25, 18],
  [0.5, 32],
  [0.75, 22]
]

export const JUMP_WRIST: Curve = [
  [0.0, 10],
  [0.18, 24],
  [0.3, -8],
  [0.55, 4],
  [0.86, 22],
  [1.0, 10]
]

const DEG = Math.PI / 180

/**
 * Samples a cyclic curve with Catmull–Rom interpolation.
 *
 * Catmull–Rom rather than linear because the curves below are sparse — nine
 * keys for a whole gait cycle — and linear segments put a corner at every key.
 * A corner in a joint angle is an infinite acceleration, and it reads on screen
 * as a tick at exactly the moments the eye is most attentive: heel strike and
 * toe-off.
 *
 * Allocation-free: this runs a few times per joint per character per frame.
 */
export const sampleCurveRaw = (curve: Curve, phase: number): number => {
  const n = curve.length
  const t = phase - Math.floor(phase)

  // Segment containing `t`, wrapping. Linear scan — n is under ten, and a
  // binary search here would cost more in branches than it saves.
  let i1 = n - 1
  for (let i = 0; i < n; i++) {
    if (curve[i]![0] > t) {
      i1 = (i - 1 + n) % n
      break
    }
  }
  const i0 = (i1 - 1 + n) % n
  const i2 = (i1 + 1) % n
  const i3 = (i1 + 2) % n

  let t1 = curve[i1]![0]
  let t2 = curve[i2]![0]
  if (t2 <= t1) {
    t2 += 1
  }
  let at = t
  if (at < t1) {
    at += 1
  }
  const u = (at - t1) / (t2 - t1)

  const p0 = curve[i0]![1]
  const p1 = curve[i1]![1]
  const p2 = curve[i2]![1]
  const p3 = curve[i3]![1]

  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u)
  )
}

/**
 * Samples a curve authored in **degrees** and returns radians.
 *
 * The raw and converted samplers are separate functions rather than one with a
 * flag because the curves in this file are not all in the same unit: joint
 * angles are degrees, `*_RISE` is normalised or metres. Undoing a degree
 * conversion at the call site — which is what the first version did, with a
 * `180 / Math.PI` sitting in the poser — is exactly the kind of thing that
 * survives review and then produces a character bobbing 57 metres.
 */
export const sampleCurve = (curve: Curve, phase: number): number => sampleCurveRaw(curve, phase) * DEG

/** Non-cyclic sample, clamped at both ends. For one-shot clips like the jump. */
export const sampleClipRaw = (curve: Curve, t: number): number => {
  const n = curve.length
  if (t <= curve[0]![0]) {
    return curve[0]![1]
  }
  if (t >= curve[n - 1]![0]) {
    return curve[n - 1]![1]
  }
  let i = 0
  while (i < n - 1 && curve[i + 1]![0] < t) {
    i++
  }
  const [t1, p1] = curve[i]!
  const [t2, p2] = curve[i + 1]!
  const u = (t - t1) / (t2 - t1)
  // Smoothstep between keys: a one-shot clip has no neighbours to build a
  // Catmull–Rom tangent from at its ends, and linear would tick at every key.
  const s = u * u * (3 - 2 * u)
  return p1 + (p2 - p1) * s
}

/** Degrees-to-radians variant of `sampleClipRaw`. See `sampleCurve`. */
export const sampleClip = (curve: Curve, t: number): number => sampleClipRaw(curve, t) * DEG

/**
 * ─── Jump ───────────────────────────────────────────────────────────────────
 *
 * A one-shot clip with the five beats a jump needs to read as *effort* rather
 * than as a vertical translation with legs attached:
 *
 *   0.00–0.18  anticipation — crouch, arms swing back
 *   0.18–0.28  drive — hips and knees extend explosively, arms throw up
 *   0.28–0.55  rise — legs tuck slightly under
 *   0.55–0.78  fall — legs reach forward and down for the ground
 *   0.78–1.00  landing — knees absorb deeply, then recover
 *
 * Anticipation and recovery are most of the clip. A jump without them is the
 * thing that reads as weightless no matter how the physics is tuned.
 */
export const JUMP_HIP: Curve = [
  [0.0, 0],
  [0.18, 42],
  [0.28, -12],
  [0.45, 18],
  [0.62, 30],
  [0.78, 20],
  [0.86, 40],
  [1.0, 0]
]

export const JUMP_KNEE: Curve = [
  [0.0, 5],
  [0.18, 75],
  [0.28, 8],
  [0.45, 45],
  [0.62, 30],
  [0.78, 12],
  [0.86, 70],
  [1.0, 5]
]

export const JUMP_ANKLE: Curve = [
  [0.0, 0],
  [0.18, 16],
  [0.26, -30],
  [0.45, -8],
  [0.62, 6],
  [0.78, -2],
  [0.86, 14],
  [1.0, 0]
]

export const JUMP_SHOULDER: Curve = [
  [0.0, 0],
  [0.18, -50],
  [0.3, 70],
  [0.5, 55],
  [0.7, 30],
  [0.86, -20],
  [1.0, 0]
]

export const JUMP_ELBOW: Curve = [
  [0.0, 25],
  [0.18, 55],
  [0.3, 20],
  [0.55, 30],
  [0.86, 60],
  [1.0, 25]
]

/** Pelvis height through the jump, in metres relative to standing. */
export const JUMP_RISE: Curve = [
  [0.0, 0],
  [0.18, -0.16],
  [0.28, 0.06],
  [0.45, 0.34],
  [0.55, 0.4],
  [0.68, 0.28],
  [0.78, 0.0],
  [0.86, -0.18],
  [1.0, 0]
]

/** Forward trunk lean through the jump, degrees. */
export const JUMP_LEAN: Curve = [
  [0.0, 2],
  [0.18, 26],
  [0.3, -6],
  [0.55, 2],
  [0.78, 14],
  [0.86, 24],
  [1.0, 2]
]
