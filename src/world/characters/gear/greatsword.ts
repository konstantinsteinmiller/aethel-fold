import { EQUIPMENT_BUDGET } from '../equipment'
import type { GearModel } from './gearKit'
import { buildCruciform, type CruciformSpec } from './sword'

/**
 * ─── The greatsword ─────────────────────────────────────────────────────────
 *
 * Same frame and same shape language as `sword.ts` — grip at the origin, blade
 * down −Y, guard along ±Z, flats facing ±X — at 1.6× the blade length. It is
 * deliberately the *same* file's `buildCruciform`, because the moment the two
 * are authored separately they drift into two families and a character holding
 * one after the other looks like it swapped art styles.
 *
 * What 1.6× is measured on: the sword's blade is 440 mm, this one's is 687 mm
 * (−0.048 → −0.735). Everything else scales less than the length, which is the
 * whole point — a greatsword is a *longer* sword, not a bigger one. The blade is
 * 94 mm wide against the sword's 71 (1.32×) and 22 mm thick against 17 (1.29×),
 * so it reads as heavier without becoming a plank.
 *
 * ── The ricasso, and what it buys ───────────────────────────────────────────
 *
 * Between the guard and the blade proper the section holds at 60 mm wide for
 * 53 mm before flaring to full width. That is the unsharpened choke a real
 * two-hander has, and at this budget it costs **nothing**: it is two control
 * points on a spline that already existed, and the flare above it is a
 * silhouette event exactly where the eye is looking (the hands). Without it the
 * blade leaves the guard at full width and the whole weapon reads as a plank
 * with a crossbar taped on.
 *
 * ── The heavier guard ───────────────────────────────────────────────────────
 *
 * 270 mm of span against the sword's 200, and it is *thicker at the tips than
 * at the quarter points* — quillon knobs, authored as a bulge in the two extent
 * splines rather than as separate geometry. That non-monotone profile is what
 * stops a long guard reading as a dowel, and it is why the guard gets 9 control
 * points to the sword's 7 while spending only 24 more triangles.
 */

const GREATSWORD: CruciformSpec = {
  name: 'gear/greatsword',
  budget: EQUIPMENT_BUDGET.greatsword,
  //         base   ricasso ricasso-end flare   mid     taper   point    tip
  bladeY: [-0.048, -0.062, -0.115, -0.175, -0.4, -0.585, -0.68, -0.735],
  bladeThickness: [0.0, 0.0098, 0.0105, 0.0112, 0.0104, 0.0082, 0.004, 0.0],
  bladeWidth: [0.0, 0.03, 0.031, 0.0472, 0.047, 0.038, 0.017, 0.0],
  bladeStations: 9,
  guard: [
    [-0.135, -0.062],
    [-0.132, -0.061],
    [-0.12, -0.057],
    [-0.09, -0.048],
    [-0.045, -0.039],
    [0.0, -0.036],
    [0.045, -0.039],
    [0.09, -0.048],
    [0.12, -0.057],
    [0.132, -0.061],
    [0.135, -0.062]
  ],
  // The knobs: wider at ±0.120 than at ±0.090, which is what stops a 270 mm
  // guard reading as a dowel.
  guardThickness: [0.0, 0.009, 0.016, 0.0115, 0.014, 0.018, 0.014, 0.0115, 0.016, 0.009, 0.0],
  guardHeight: [0.0, 0.013, 0.022, 0.0165, 0.02, 0.026, 0.02, 0.0165, 0.022, 0.013, 0.0],
  guardStations: 7,
  // 173 mm of grip above the guard — two full chibi fists (each ~110 mm across)
  // will not fit, and should not: a two-hander's second hand rides the pommel.
  // Same wheel pommel as the sword, 76 mm across (see `sword.ts`).
  gripY: [0.173, 0.158, 0.14, 0.122, 0.098, 0.06, 0.01, -0.026, -0.038],
  gripThickness: [0.0, 0.03, 0.038, 0.032, 0.015, 0.0165, 0.0185, 0.021, 0.0],
  gripWidth: [0.0, 0.03, 0.038, 0.032, 0.017, 0.019, 0.022, 0.025, 0.0],
  gripStations: 9
}

export const buildGreatsword = (options: { seed?: number } = {}): GearModel =>
  buildCruciform(GREATSWORD, options.seed ?? 1)
