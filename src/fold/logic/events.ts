/**
 * A pooled, allocation-free event queue from the simulation to its observers
 * (renderer VFX, audio, haptics, HUD).
 *
 * The simulation `emit`s during `update`; the engine drains the queue once per
 * frame, after the tick, and every consumer reads the same slice. Event slots
 * are recycled — consumers must copy what they need and never keep the object.
 */

export type FoldEventType =
  | 'foldGrab'      // a = fold index
  | 'foldDrag'      // a = fold index, b = progress 0…1
  | 'foldRelease'   // a = fold index, b = progress (sprung back)
  | 'foldSnap'      // a = fold index, x/z = hinge centre, b = launched count
  | 'foldStamp'     // a = fold index, x/z = centre, b = crushed count, c = 1 if hit-stop
  | 'foldLower'     // a = fold index
  | 'foldBreak'     // a = fold index (bashed/burnt through)
  | 'foldReady'     // a = fold index (cooldown over / newly introduced)
  | 'launch'        // a = enemy slot, x/z = where
  | 'lensHit'       // a = enemy slot — a launched knight bursts at the camera
  | 'crush'         // a = enemy slot, x/z, b = score
  | 'tear'          // a = tear index, x/z, b = score
  | 'tearPull'      // a = tear index, b = progress
  | 'tearRelease'   // a = tear index
  | 'kill'          // a = enemy slot, x/z, b = score, c = kind code (see KILL_*)
  | 'spawn'         // a = enemy slot
  | 'shoot'         // a = projectile slot, c = type code
  | 'blocked'       // a = projectile slot, x/z, b = fold index
  | 'impact'        // a = projectile slot, x/z (hit the ground / a target)
  | 'heroHit'       // x/z, b = hearts left
  | 'heroDown'
  | 'breach'        // a = enemy slot, x/z
  | 'score'         // x/z = page position, b = points, c = multiplier ×100
  | 'combo'         // b = count
  | 'waveStart'     // a = wave index
  | 'pageIntro'     // a = page id
  | 'pageCleared'   // a = page id, b = 1 if perfect
  | 'pageTurn'      // a = from page, b = to page
  | 'crumple'
  | 'pageDrop'
  | 'peelStart'
  | 'peelDone'
  | 'lesson'        // a = lesson code (LESSON_CODES), b = 1 start / 0 done
  | 'bossPhase'     // a = BossPhase code
  | 'bossHurt'      // a = weak point index, x/z
  | 'bossBreath'    // x/z = aim
  | 'bossStomp'     // x/z
  | 'frog'          // the finale fold completed
  | 'victory'
  | 'tap'           // x/z — a tap that hit nothing (little ripple)

export const KILL_LAUNCH = 1
export const KILL_CRUSH = 2
export const KILL_TEAR = 3
export const KILL_FLING = 4
export const KILL_RIDGE = 5

export interface FoldEvent {
  type: FoldEventType
  a: number
  b: number
  c: number
  x: number
  z: number
}

export class EventQueue {
  private readonly pool: FoldEvent[] = []
  /** Live events for this frame: `items[0 … count-1]`. */
  readonly items: FoldEvent[] = []
  count = 0

  constructor(capacity = 256) {
    for (let i = 0; i < capacity; i++) {
      const e: FoldEvent = { type: 'tap', a: 0, b: 0, c: 0, x: 0, z: 0 }
      this.pool.push(e)
      this.items.push(e)
    }
  }

  emit(type: FoldEventType, a = 0, b = 0, c = 0, x = 0, z = 0): void {
    if (this.count >= this.items.length) {
      // Grow rather than drop: a dropped 'kill' would lose a score. Growth only
      // happens on a pathological frame and is amortised forever after.
      const e: FoldEvent = { type, a, b, c, x, z }
      this.pool.push(e)
      this.items.push(e)
      this.count++
      return
    }
    const e = this.items[this.count++]!
    e.type = type
    e.a = a
    e.b = b
    e.c = c
    e.x = x
    e.z = z
  }

  clear(): void {
    this.count = 0
  }

  /** Test helper: the types emitted this frame (allocates — never in the loop). */
  types(): FoldEventType[] {
    const out: FoldEventType[] = []
    for (let i = 0; i < this.count; i++) out.push(this.items[i]!.type)
    return out
  }
}
