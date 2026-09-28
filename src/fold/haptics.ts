/**
 * Haptics (aethel-fold-GDD §5): light, continuous vibration while dragging a
 * fold; a hard, sharp burst on a SNAP or a Stamp. `navigator.vibrate` is a
 * no-op where unsupported (iOS Safari, desktop), so every call is safe.
 */

let enabled = true
let lastTick = 0

const canVibrate = (): boolean => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'

const buzz = (pattern: number | number[]): void => {
  if (!enabled || !canVibrate()) return
  try {
    navigator.vibrate(pattern)
  } catch {
    /* some webviews throw without a user gesture */
  }
}

export const haptics = {
  setEnabled(on: boolean): void {
    enabled = on
  },
  /** While a fold follows the finger: a feather tick, throttled. */
  dragTick(): void {
    const now = performance.now()
    if (now - lastTick < 55) return
    lastTick = now
    buzz(6)
  },
  grab(): void {
    buzz(10)
  },
  snap(): void {
    buzz([0, 24, 18, 10])
  },
  stamp(heavy: boolean): void {
    buzz(heavy ? [0, 45, 25, 25] : [0, 32])
  },
  tear(): void {
    buzz([0, 14, 10, 14, 10, 40])
  },
  hit(): void {
    buzz([0, 60, 40, 30])
  },
  success(): void {
    buzz([0, 20, 60, 20, 60, 40])
  }
}
