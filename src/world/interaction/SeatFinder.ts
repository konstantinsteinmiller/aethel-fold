import type { Placement } from '../level/types'
import { buildWorldSeats, type WorldSeat } from './seats'

/**
 * ─── Which seat the player is looking at ────────────────────────────────────
 *
 * **Aim beats proximity.** Candidates are scored by how
 * near the middle of the screen they are, not by how near the player they are,
 * because four benches ring a fire pit at the same distance and the only thing
 * that can break that tie is where the player is pointing the camera. Distance
 * gates candidacy (`SIT_RANGE`) and separates two seats the camera covers
 * equally, and cannot outrank the aim.
 *
 * The scoring constants are the talk scan's own — `facing * 10 − distance * 0.1`
 * — and that is on purpose rather than by accident. Two interaction prompts
 * that pick their target by different curves would swap places at different
 * moments, and the player would have no way to learn either.
 *
 * ── Keeping the per-frame scan short ────────────────────────────────────────
 *
 * `findTalkTarget` gets away with a flat loop because its candidate list is
 * nine cast members written out by hand. A seat list cannot be: it is derived
 * from the level, and the level is ~2 000 placements of which the chapter's
 * seats are thirteen — four benches at der Treff, one in the island yard, six
 * stools, a chair and a bed.
 *
 * So there are two filters, and the first does nearly all the work:
 *
 *   1. **The catalogue.** `buildWorldSeats` runs once and keeps only the
 *      placements whose `defId` is a seat. 2 000 → 13. That alone is the
 *      equivalent of `talkable`.
 *   2. **A uniform grid**, because (1) does not *scale*: an inn with forty
 *      stools and a market square with twenty benches is a plausible level and
 *      would put sixty entries in a loop that runs sixty times a second for the
 *      whole chapter. Seats are static, so they are bucketed once into 16 m
 *      cells and the scan visits the nine around the player — with a range of
 *      4.2 m that is two cells' worth of slack in every direction.
 *
 * The grid's buckets are built at load and only ever read, so a query allocates
 * nothing: `Map.get` hands back the stored array and the loop indexes it (GDD
 * §5.2).
 */

/** How close a seat has to be before its prompt appears, in metres. */
export const SIT_RANGE = 3.4
/**
 * How near the middle of the screen it has to be, as a cosine.
 *
 * `TALK_CONE`'s 0.55, i.e. about 57° off the camera's heading. The same number
 * for the same reason — a prompt that only appears for a target centred exactly
 * feels like the game refusing to let you use something you are standing in
 * front of — and because two prompts with different cones would appear and
 * vanish at different angles for no reason a player could ever infer.
 */
export const SIT_CONE = 0.55

/**
 * Cell size for the broadphase, metres.
 *
 * Comfortably larger than `SIT_RANGE` so the 3×3 neighbourhood around the
 * player is guaranteed to contain every seat in range, and large enough that a
 * room's worth of furniture lands in one or two buckets rather than being
 * spread over a dozen half-empty ones.
 */
const CELL = 16

/**
 * Cell key from a cell coordinate pair.
 *
 * Offset into the positive range before packing, because the chapter is played
 * at x = −74 and x = +1 400 and a naive `cx * K + cz` collides across the sign.
 * ±32 768 cells is ±524 km, which is four hundred times the distance between
 * the chapter's two timeframes.
 */
const key = (cx: number, cz: number): number => (cx + 32768) * 65536 + (cz + 32768)

const cellOf = (v: number): number => Math.floor(v / CELL)

/** What the finder hands back. One struct, rewritten in place. */
export interface SeatFocus {
  seat: WorldSeat
  /** Flat metres from the player to the seat. */
  distance: number
}

export class SeatFinder {
  /** Every seat in the level, flat. Read by the tests and by the grid build. */
  readonly seats: readonly WorldSeat[]

  private readonly cells = new Map<number, WorldSeat[]>()

  /**
   * The one result struct.
   *
   * Filled and returned; never allocated per frame and never per candidate. The
   * loop is allowed to change its mind several times before it settles, exactly
   * as `findTalkTarget`'s does, which is why the winner is written into this
   * rather than remembered as an index and looked up afterwards.
   */
  private readonly slot: SeatFocus = { seat: null as unknown as WorldSeat, distance: 0 }

  constructor(placements: readonly Placement[], groundAt: (x: number, z: number) => number) {
    this.seats = buildWorldSeats(placements, groundAt)
    for (const seat of this.seats) {
      const k = key(cellOf(seat.x), cellOf(seat.z))
      const bucket = this.cells.get(k)
      if (bucket) {
        bucket.push(seat)
      } else {
        this.cells.set(k, [seat])
      }
    }
  }

  /**
   * The seat the interact key would take, or null.
   *
   * The direction is the **camera's**, not the character's: the brief for the
   * talk prompt was "the one the camera is pointing at has priority", and a
   * third-person character whose facing lags the camera by up to 9.5 rad/s
   * would otherwise pick a different seat from the one the player is looking
   * at, for the length of every turn.
   *
   * ── Why this takes a vector and not a yaw ─────────────────────────────────
   *
   * Because "yaw" means two opposite things in this project, and the two
   * callers of this method are one of each. `StoryPlayer` builds its forward as
   * `(+sin, +cos)` (see the basis it derives in `fillIntent`); `PlayerController`
   * builds its as `(-sin, -cos)` (`groundForward`). They differ by exactly half a
   * turn.
   *
   * This took a yaw first, in the story's convention, and the sandbox handed it
   * the walker's — so the prompt appeared for benches **behind** the player, and
   * then the billboard silently drew nothing because the point it was told to
   * project was off-screen behind the camera. Nothing threw and nothing looked
   * broken; the feature simply did not appear.
   *
   * A direction has no convention to get wrong. Both callers already own a
   * function that produces theirs, so neither has to know this one exists.
   */
  find(x: number, z: number, forwardX: number, forwardZ: number): SeatFocus | null {
    const cx = cellOf(x)
    const cz = cellOf(z)
    let best: SeatFocus | null = null
    let bestScore = -1

    for (let ix = -1; ix <= 1; ix++) {
      for (let iz = -1; iz <= 1; iz++) {
        const bucket = this.cells.get(key(cx + ix, cz + iz))
        if (!bucket) {
          continue
        }
        for (let i = 0; i < bucket.length; i++) {
          const seat = bucket[i]!
          const dx = seat.x - x
          const dz = seat.z - z
          const distance = Math.hypot(dx, dz)
          if (distance > SIT_RANGE || distance < 1e-3) {
            continue
          }
          // cos of the angle between the camera's heading and the line to it.
          const facing = (dx * forwardX + dz * forwardZ) / distance
          if (facing < SIT_CONE) {
            continue
          }
          const score = facing * 10 - distance * 0.1
          if (score > bestScore) {
            bestScore = score
            this.slot.seat = seat
            this.slot.distance = distance
            best = this.slot
          }
        }
      }
    }
    return best
  }

  /** Looks one up by identity, for a save that names the seat somebody is in. */
  byPlacement(placementId: string, anchorIndex = 0): WorldSeat | null {
    for (const seat of this.seats) {
      if (seat.placementId === placementId && seat.anchorIndex === anchorIndex) {
        return seat
      }
    }
    return null
  }
}
