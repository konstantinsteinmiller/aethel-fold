/**
 * ─── `world/interaction/` ───────────────────────────────────────────────────
 *
 * Things in the world the player can use, as a layer that knows nothing about
 * who is using them. Three files and a hard rule between them:
 *
 *   `seats.ts`         which placeables are seats, and where on each of them a
 *                      person sits. Data plus one pure function.
 *   `SeatFinder.ts`    which seat the camera is pointing at. A grid and a scan.
 *   `SitController.ts` the five-state machine that gets somebody into one and,
 *                      more importantly, back out of one.
 *
 * **Nothing in here may know that a chapter exists**, the same rule `combat/`
 * lives under and for the same payoff: the story route and the sandbox route
 * drive the identical state machine, so a bug in the sit is a bug in one place
 * and can be reproduced from either.
 *
 * The only things it imports are `combat/postures` (for `SeatKind`, which is
 * the vocabulary the two layers share) and `level/types` (for `Placement`,
 * which is what a level *is*).
 */

export { buildWorldSeats, resolveSeatFacing, SEAT_CATALOGUE } from './seats'
export type { SeatAnchor, SeatDefinition, SeatFacingMode, WorldSeat } from './seats'
export { SeatFinder, SIT_CONE, SIT_RANGE } from './SeatFinder'
export type { SeatFocus } from './SeatFinder'
export { seatRootLift, SitController } from './SitController'
export type { SitActor, SitPhase } from './SitController'
