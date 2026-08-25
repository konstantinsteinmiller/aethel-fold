import { ref } from 'vue'
import type { World } from '../core/World'
import {
  MAX_SCULPT_RADIUS,
  MIN_SCULPT_RADIUS,
  SCULPT_FALLOFFS,
  SCULPT_TOOLS,
  type SculptFalloff,
  type SculptTool
} from '../terrain/SculptField'
import {
  DEFAULT_SCULPT_RADIUS,
  DEFAULT_SCULPT_STRENGTH,
  MAX_SCULPT_STRENGTH,
  MIN_SCULPT_STRENGTH,
  TerrainSculptor
} from './TerrainSculptor'
import { editorMode } from './toggle'

/**
 * ─── Terrain sculpting façade ───────────────────────────────────────────────
 *
 * The only surface `TerrainSculptPanel.vue` is allowed to touch. Everything it
 * hands out is a primitive or a plain string; the `SculptField`, its
 * `Float32Array` tiles and the gizmo's geometry never leave this module. That
 * is not tidiness — a tile dropped into a `ref` would have Vue proxy a 4 096-
 * element typed array that the player's collision reads every frame (GDD §0).
 *
 * Deliberately **parallel to `world/editor/index.ts`** rather than part of it,
 * for the same reason the water editor is: a different schema, a different
 * storage key, a different panel. It rides the same `editorMode` toggle,
 * because both are the same dev tool from the user's side.
 *
 * Wiring lives in `editor/index.ts` next to the prop editor's, so the two are
 * installed, ticked and torn down together.
 */

export type { SculptFalloff, SculptTool } from '../terrain/SculptField'

/** True once `installTerrainSculptor` has run. The panel renders nothing before it. */
export const sculptReady = ref(false)
/** Armed tool, or `'off'` — with `'off'`, left-drag belongs to the camera again. */
export const sculptTool = ref<SculptTool | 'off'>('off')
export const sculptRadius = ref(DEFAULT_SCULPT_RADIUS)
export const sculptStrength = ref(DEFAULT_SCULPT_STRENGTH)
export const sculptFalloffCurve = ref<SculptFalloff>('smooth')
/** Absolute world Y the flatten tool converges on. */
export const sculptFlattenTarget = ref(0)
/** Resident delta tiles, and roughly what they cost in memory. */
export const sculptTiles = ref(0)
export const sculptBytes = ref(0)
export const sculptUndoDepth = ref(0)
export const sculptPainting = ref(false)
/** Transient status line (undo results, clear confirmations). */
export const sculptStatus = ref('')

export const SCULPT_TOOL_IDS = SCULPT_TOOLS
export const SCULPT_FALLOFF_IDS = SCULPT_FALLOFFS
export const SCULPT_RADIUS_RANGE = [MIN_SCULPT_RADIUS, MAX_SCULPT_RADIUS] as const
export const SCULPT_STRENGTH_RANGE = [MIN_SCULPT_STRENGTH, MAX_SCULPT_STRENGTH] as const

let sculptor: TerrainSculptor | null = null
let rafId: number | null = null
let externallyDriven = false

const stopSelfDrive = (): void => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

const startSelfDrive = (): void => {
  stopSelfDrive()
  const tick = (): void => {
    if (!sculptor || externallyDriven) {
      rafId = null
      return
    }
    rafId = requestAnimationFrame(tick)
    sculptor.update()
  }
  rafId = requestAnimationFrame(tick)
}

export const installTerrainSculptor = (world: World): TerrainSculptor => {
  if (sculptor) {
    return sculptor
  }
  const instance = new TerrainSculptor(world)
  instance.onStateChange = snapshot => {
    sculptTool.value = snapshot.tool
    sculptRadius.value = snapshot.radius
    sculptStrength.value = snapshot.strength
    sculptFalloffCurve.value = snapshot.falloff
    sculptFlattenTarget.value = snapshot.flattenTarget
    sculptTiles.value = snapshot.tiles
    sculptBytes.value = snapshot.bytes
    sculptUndoDepth.value = snapshot.undoDepth
    sculptPainting.value = snapshot.painting
  }
  // The mode may already be on from a previous session (it is persisted), so
  // the scene-side flag is pushed once here rather than waiting for a toggle.
  instance.setActive(editorMode.value)
  sculptor = instance
  const snapshot = instance.snapshot()
  sculptTiles.value = snapshot.tiles
  sculptBytes.value = snapshot.bytes
  sculptReady.value = true
  startSelfDrive()
  return instance
}

/** Mirrors `editorMode` onto the scene side. Called by the prop editor's toggle. */
export const setSculptActive = (on: boolean): void => {
  sculptor?.setActive(on)
}

/** Per-frame hook. Calling it once hands the sculptor over to the host loop. */
export const updateTerrainSculptor = (): void => {
  if (!externallyDriven) {
    externallyDriven = true
    stopSelfDrive()
  }
  sculptor?.update()
}

export const disposeTerrainSculptor = (): void => {
  stopSelfDrive()
  externallyDriven = false
  sculptor?.dispose()
  sculptor = null
  sculptReady.value = false
  sculptTool.value = 'off'
  sculptPainting.value = false
  sculptStatus.value = ''
}

export const isTerrainSculptorInstalled = (): boolean => sculptor !== null

export const selectSculptTool = (tool: SculptTool | 'off'): void => {
  sculptor?.setTool(tool)
}

export const setSculptRadius = (metres: number): void => {
  sculptor?.setRadius(metres)
}

export const setSculptStrength = (value: number): void => {
  sculptor?.setStrength(value)
}

export const selectSculptFalloff = (curve: SculptFalloff): void => {
  sculptor?.setFalloff(curve)
}

/** Pins the flatten height to the ground under the crosshair. */
export const sampleSculptTarget = (): string => {
  const ok = sculptor?.sampleFlattenTarget() ?? false
  const message = ok ? `Flatten height ${sculptFlattenTarget.value.toFixed(2)} m` : 'Aim at the ground first'
  sculptStatus.value = message
  return message
}

export const undoSculpt = (): string => {
  const ok = sculptor?.undo() ?? false
  const message = ok ? `Undid a stroke · ${sculptUndoDepth.value} left` : 'Nothing to undo'
  sculptStatus.value = message
  return message
}

export const clearSculpt = (): string => {
  const tiles = sculptor?.clearAll() ?? 0
  const message = tiles > 0 ? `Cleared ${tiles} tile(s) — undo restores them` : 'Terrain is already unsculpted'
  sculptStatus.value = message
  return message
}
