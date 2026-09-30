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
  | 'impact'        // a = projectile slot, x/z, b = kind (1 fling, 2 catapult, 3 arrow, 4 boulder, 5 sling stone)
  | 'heroHit'       // x/z, b = hearts left
  | 'heroDown'
  | 'breach'        // a = enemy slot, x/z
  | 'score'         // x/z = page position, b = points, c = multiplier ×100
  | 'combo'         // b = count
  | 'waveStart'     // a = wave index
  | 'pageIntro'     // a = page id
  | 'pageCleared'   // a = page id, b = 1 if perfect, c = stars earned (1…3, roadmap #1)
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
  | 'outro'         // the boss outro cutscene (C9b): a = 1 started / 0 ended, b = 1 if the end was a skip
  | 'outroBeat'     // a cutscene beat fired: a = beat index in the script, b = 1 if fired by the skip
  | 'firework'      // a = slot, b = 0 launch / 1 burst, c = tint index (FIREWORK_TINTS), x/z = page point
  | 'tap'           // x/z — a tap that hit nothing (little ripple)
  | 'slingGrab'     // the sling's cup was taken
  | 'slingFire'     // a = projectile slot, x/z = where it will land
  | 'slingCancel'   // let go without enough pull
  | 'slingReady'    // reloaded
  | 'bossHit'       // a sling stone hit the dragon's body: x/z, b = hits so far, c = 1 if it interrupted the breath
  | 'ballistaFire'  // a = fold index, b = projectile slot, x/z = aim point
  | 'leap'          // a = enemy slot, c = 1 vaulting a wall / 0 a lane hop, x/z = take-off
  | 'shelf'         // the desk bookshelf: a = 1 camera out to it / 0 back to the book, b = reason (SHELF_REASONS)
  | 'shelfSelect'   // a = slot, b = 1 pulled out to inspect / 0 locked (it only shakes)
  | 'shelfBook'     // a book was opened from the shelf: a = book, b = 1 continue the current run / 0 start it on page 1
  | 'secret'        // a page secret went off (roadmap #15): a = secret code (SECRET_IDS), b = 1 found for the first time / 0 again, x/z
  | 'night'         // the desk lamp was tapped: a = 1 night mode on / 0 off
  | 'rushStart'     // a Dragon Rush dragon drops (roadmap #16): a = book, b = par (s), c = attempt (1 = first)
  | 'rushDone'      // the rush dragon is beaten: a = book, b = time (s), c = par (s)
  | 'pleat'         // book 3: a pleat section shut: a = fold index, b = crushed on it, c = section (0 = top), x/z = its centre
  | 'capsize'       // book 3: the boat capsized a wader: a = enemy slot, b = fold index, x/z
  | 'lastChance'    // the last heart went and the world holds for a second-chance offer (roadmap #19): a = seconds offered
  | 'heartRestored' // the second chance was taken: b = hearts now

export const KILL_LAUNCH = 1
export const KILL_CRUSH = 2
export const KILL_TEAR = 3
export const KILL_FLING = 4
export const KILL_RIDGE = 5
export const KILL_SHOT = 6
export const KILL_BOLT = 7
/** Book 3: capsized by the boat. */
export const KILL_CAPSIZE = 8

/**
 * `blocked` with c = BLOCK_BEARER (C12): a ballista bolt glanced off a
 * shield-bearer's shield and was spent. a = projectile slot, b = 1 on the
 * first such block of the page (the view's big word), x/z = the shield.
 * (c = 1 arrow, 2 boulder on a raised wall; 3 the dragon's fire, 5 the kraken's ink.)
 */
export const BLOCK_BEARER = 6

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
