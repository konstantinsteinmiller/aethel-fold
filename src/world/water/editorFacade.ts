import { ref } from 'vue'
import { WATER_STYLES } from './styles'
import type { WaterPlacement } from './types'
import {
  hasStoredWater,
  STYLE_NUMBER_KEYS,
  WaterEditor,
  type WaterEditMode,
  type WaterEditorHost,
  type WaterStyleNumberKey,
  type WaterViewFactory
} from './WaterEditor'

/**
 * ─── Water editor façade ────────────────────────────────────────────────────
 *
 * The only surface `WaterEditorPanel.vue` is allowed to touch. Everything it
 * hands out is a primitive, a plain string or a plain copy; the scene graph,
 * the `WaterBodyView`s and the `WaterStyle` objects (which hold live `Color`s)
 * never leave this module. That is not tidiness — a geometry dropped into a
 * `ref` would have Vue deep-proxy every buffer behind it and the world would
 * quietly drop to a slideshow (GDD §0).
 *
 * This is deliberately **parallel to `world/editor/index.ts`**, not part of it:
 * a different schema, a different storage key, a different panel. The two are
 * live at the same time and share nothing but the canvas.
 *
 * Wiring, in `World`:
 *
 *   installWaterEditor(this)   // after the scene is built
 *   updateWaterEditor()        // once per frame, before render
 *   disposeWaterEditor()       // in dispose()
 *
 * The per-frame call is optional. Until it arrives the editor drives itself
 * from its own rAF so it is usable the moment it is installed; the first
 * external `updateWaterEditor` cancels that loop, so wiring it up properly can
 * never double-tick.
 */

/** Zeroed readouts, used before an editor exists and after one is torn down. */
const blankStyleValues = (): Record<WaterStyleNumberKey, number> => {
  const out = {} as Record<WaterStyleNumberKey, number>
  for (const key of STYLE_NUMBER_KEYS) {
    out[key] = 0
  }
  return out
}

/** True once `installWaterEditor` has run. The panel renders nothing before it. */
export const waterEditorReady = ref(false)
/** 'off' | 'pool' | 'river'. */
export const waterMode = ref<WaterEditMode>('off')
/** Style applied to the next body placed, and to the one under the crosshair. */
export const waterStyleId = ref('pond')
export const waterBodyCount = ref(0)
/** Extent of the aimed pool, or of the ghost previewing the next one, in metres. */
export const waterHalfX = ref(0)
export const waterHalfZ = ref(0)
/** Absolute surface Y, or — when `waterSurfaceRelative` is true — metres above the aimed ground. */
export const waterSurfaceY = ref(0)
export const waterSurfaceRelative = ref(true)
export const waterRotationDeg = ref(0)
/** Nodes in the run being laid, the one-node draft included. */
export const waterRiverNodes = ref(0)
/** Which node the width and height keys edit, or -1. */
export const waterActiveNode = ref(-1)
export const waterNodeHalfWidth = ref(0)
/** True while a run is open — a draft, or a river still being extended. */
export const waterBuilding = ref(false)
/** Body under the crosshair, '' when none. Updated off the aim, never the revision. */
export const waterAimedId = ref('')
export const waterAimedKind = ref('')
/** Transient status line (export results, clear confirmations). */
export const waterStatus = ref('')
/** The active style's tunable numbers. Plain numbers only — never the `WaterStyle`. */
export const waterStyleValues = ref<Record<WaterStyleNumberKey, number>>(blankStyleValues())

/** A style row for the panel: a flat projection, never the preset itself. */
export interface WaterStyleOption {
  id: string
  label: string
}

/**
 * Slider descriptors for the tunable `WaterStyle` numbers.
 *
 * The ranges are the useful ones, not the representable ones: `waveAmplitude`
 * stops at 1 m because a taller wave on a body this size stops reading as water
 * and starts reading as terrain, and `waveSpeed` stops at 3 because past that
 * every preset boils (`styles.ts` header). `waveAmplitude`'s step reaches 0
 * exactly — a still pond is a first-class value, and a slider that could only
 * approach zero would make the pond preset unreachable.
 */
export const WATER_STYLE_SLIDERS: readonly {
  key: WaterStyleNumberKey
  label: string
  min: number
  max: number
  step: number
}[] = [
  { key: 'waveAmplitude', label: 'wave amp', min: 0, max: 1, step: 0.005 },
  { key: 'waveLength', label: 'wave len', min: 0.4, max: 30, step: 0.1 },
  { key: 'waveSpeed', label: 'wave speed', min: 0, max: 3, step: 0.02 },
  { key: 'flowSpeed', label: 'flow', min: 0, max: 8, step: 0.05 },
  { key: 'depthFalloff', label: 'depth ramp', min: 0.2, max: 20, step: 0.1 },
  { key: 'foamWidth', label: 'foam width', min: 0, max: 6, step: 0.05 },
  { key: 'crestFoam', label: 'crest foam', min: 0, max: 1, step: 0.01 },
  { key: 'opacity', label: 'opacity', min: 0.2, max: 1, step: 0.01 },
  { key: 'sparkle', label: 'sparkle', min: 0, max: 1, step: 0.01 },
  { key: 'rimStrength', label: 'rim', min: 0, max: 1, step: 0.01 }
]

let editor: WaterEditor | null = null
let rafId: number | null = null
let externallyDriven = false
/** Carries the revision across dispose/install so it never runs backwards. */
let revisionBase = 0

const stopSelfDrive = (): void => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

const startSelfDrive = (): void => {
  stopSelfDrive()
  const tick = (): void => {
    if (!editor || externallyDriven) {
      rafId = null
      return
    }
    rafId = requestAnimationFrame(tick)
    editor.update()
  }
  rafId = requestAnimationFrame(tick)
}

/** Refresh the slider readouts from the live preset. Plain numbers, copied out. */
const readStyleValues = (): void => {
  waterStyleValues.value = editor
    ? editor.styleValues(waterStyleId.value)
    : blankStyleValues()
}

export const installWaterEditor = (host: WaterEditorHost): WaterEditor => {
  if (editor) {
    return editor
  }
  const instance = new WaterEditor(host)
  instance.onStateChange = snapshot => {
    waterMode.value = snapshot.mode
    const styleChanged = waterStyleId.value !== snapshot.styleId
    waterStyleId.value = snapshot.styleId
    waterBodyCount.value = snapshot.bodyCount
    waterHalfX.value = snapshot.halfX
    waterHalfZ.value = snapshot.halfZ
    waterSurfaceY.value = snapshot.surfaceY
    waterSurfaceRelative.value = snapshot.surfaceRelative
    waterRotationDeg.value = snapshot.rotationDeg
    waterRiverNodes.value = snapshot.riverNodes
    waterActiveNode.value = snapshot.activeNode
    waterNodeHalfWidth.value = snapshot.nodeHalfWidth
    waterBuilding.value = snapshot.building
    if (styleChanged) {
      readStyleValues()
    }
  }
  instance.onAimChange = (id, kind) => {
    waterAimedId.value = id
    waterAimedKind.value = kind
  }
  editor = instance
  waterBodyCount.value = instance.bodyCount()
  waterStyleId.value = instance.currentStyleId()
  readStyleValues()
  waterEditorReady.value = true
  startSelfDrive()
  return instance
}

/**
 * Per-frame hook. Calling it once hands the editor over to the host loop.
 * No camera argument — the water editor owns no LOD nodes to tick.
 */
export const updateWaterEditor = (): void => {
  if (!externallyDriven) {
    externallyDriven = true
    stopSelfDrive()
  }
  editor?.update()
}

export const disposeWaterEditor = (): void => {
  stopSelfDrive()
  externallyDriven = false
  // +1 so a consumer polling across the teardown sees the change and re-reads
  // an empty list, instead of holding colliders for a scene that is gone.
  revisionBase = waterRevision() + 1
  editor?.dispose()
  editor = null
  waterEditorReady.value = false
  waterStyleValues.value = blankStyleValues()
  waterMode.value = 'off'
  waterBodyCount.value = 0
  waterRiverNodes.value = 0
  waterActiveNode.value = -1
  waterBuilding.value = false
  waterAimedId.value = ''
  waterAimedKind.value = ''
  waterStatus.value = ''
}

/** Is the editor installed? The panel renders nothing before it is. */
export const isWaterEditorInstalled = (): boolean => editor !== null

/**
 * Hands the real surface generator to the editor. Every body is rebuilt through
 * it immediately, so this may be called at any point after install — and until
 * it is, the editor draws its own flat proxy so the tool is still usable.
 */
export const setWaterViewFactory = (factory: WaterViewFactory | null): void => {
  editor?.setViewFactory(factory)
}

export const setWaterMode = (mode: WaterEditMode): void => {
  editor?.setMode(mode)
}

export const waterStyleOptions = (): WaterStyleOption[] =>
  Object.values(WATER_STYLES).map(style => ({ id: style.id, label: style.label }))

export const selectWaterStyle = (id: string): void => {
  editor?.setStyle(id)
  if (editor) {
    waterStyleId.value = editor.currentStyleId()
    readStyleValues()
  }
}

/**
 * Live-tune one number of the active preset. Cheap on purpose: the water
 * material's `applyStyle` is designed to be called every frame without
 * recompiling, so dragging a slider costs a uniform write per body.
 */
export const setWaterStyleParam = (key: WaterStyleNumberKey, value: number): void => {
  if (!editor) {
    return
  }
  editor.setStyleParam(waterStyleId.value, key, value)
  readStyleValues()
}

export const deleteAimedWater = (): boolean => (editor?.deleteAimed() ?? null) !== null

export const undoWaterNode = (): number => editor?.undoNode() ?? 0

export const finishWaterRun = (): boolean => editor?.finishRun() ?? false

export const closeWaterRun = (): boolean => editor?.closeRun() ?? false

/**
 * Monotonic mutation counter for the water layout. Plain number, no `ref` —
 * this is read from the frame loop, which must never touch Vue.
 *
 * `waterPlacements()` allocates: it deep-copies and sorts, because that is what
 * an export and a persist need. A per-frame consumer (a swim/wade volume, say)
 * polls this integer instead and only re-reads when it changes:
 *
 *   if (waterRevision() !== this.lastRevision) {
 *     this.lastRevision = waterRevision()
 *     this.rebuildVolumes(waterPlacements())
 *   }
 */
export const waterRevision = (): number => revisionBase + (editor?.revision() ?? 0)

/** Plain deep copies of every body of water, sorted by kind then style then position. */
export const waterPlacements = (): WaterPlacement[] => editor?.snapshot() ?? []

/** Does this browser already have a water layout, stored or live? */
export const hasStoredWaterLayout = (): boolean => (editor?.bodyCount() ?? 0) > 0 || hasStoredWater()

const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Denied, or the document is not focused — fall through to the legacy path
    // rather than losing the export.
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

/**
 * One clean export: the whole layout as a JSON `WaterPlacement[]`, copied to the
 * clipboard and logged — the same shape and the same affordance as the prop
 * editor's `exportPlacements`, so the two are learned once.
 *
 * Style tuning is *not* folded into the array. It is a change to the presets in
 * `styles.ts`, not to a placement, and mixing the two would produce a file that
 * neither a `seedWater()` nor a code review could consume. Tuned values are
 * logged separately so they can be pasted back into `styles.ts` by hand.
 */
export const exportWaterLayout = async (): Promise<string> => {
  const placements = waterPlacements()
  const text = JSON.stringify(placements, null, 2)
  console.log(text)
  const overrides = editor?.styleOverrides() ?? {}
  if (Object.keys(overrides).length > 0) {
    console.log('[water] tuned style values (paste into styles.ts):', overrides)
  }
  const ok = await copyToClipboard(text)
  const message = `${ok ? 'Copied' : 'In console (copy failed)'} · ${placements.length} body(s) of water`
  waterStatus.value = message
  return message
}

/**
 * Lay down the water a shipped patch carries, on a fresh install only.
 *
 * The decision itself lives in `WaterEditor.seed` — it is the only thing that
 * knows whether this browser already has water — so this is just the door.
 */
export const seedWater = (placements: readonly unknown[] | undefined): number =>
  placements && placements.length > 0 ? (editor?.seed(placements) ?? 0) : 0

export const clearWaterBodies = (): string => {
  const removed = editor?.clearAll() ?? 0
  const message = `Cleared ${removed} body(s) of water`
  waterStatus.value = message
  return message
}

export type { WaterEditMode, WaterEditorHost, WaterStyleNumberKey, WaterViewFactory }
export type { WaterPlacement }
