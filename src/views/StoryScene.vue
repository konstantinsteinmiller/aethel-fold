<template lang="pug">
  div(ref="host" class="relative h-full w-full overflow-hidden bg-slate-900 select-none")
    canvas(
      ref="canvas"
      class="block h-full w-full touch-none outline-none"
    )

    StoryOverlay(
      v-if="state"
      :state="state"
      :settling="settling"
      @advance="onAdvance"
      @retry="onRetry"
      @restart="onRestart"
    )

    //- ── The chapter's own HUD ────────────────────────────────────────────
    //-
    //- All of it is `pointer-events-none` bar the controls panel's own minimise
    //- button: a click anywhere on the canvas has to reach the canvas, because
    //- that is how the pointer lock is taken back after a menu closes.
    ObjectiveTracker(v-if="state" :objectives="objectiveRows")
    ObjectiveLocator(:screen="locatorPoint")
    NpcBillboard(:target="talkLabel" :screen="talkPoint")
    SeatBillboard(:target="seatLabel" :screen="seatPoint")

    ControlsOverlay(
      ref="controls"
      :visible="controlsVisible"
      :weapon="state?.weapon ?? 'none'"
    )

    FpsMeter

    //- ── Pause ────────────────────────────────────────────────────────────
    //-
    //- Mounted always and gated on `open`, not `v-if`: it holds the app-wide
    //- pause while it is up and releases it on close *and* on unmount, and a
    //- `v-if` would make that lifecycle depend on a boolean two components away.
    PauseMenu(
      :open="paused"
      @close="onResume"
      @continue="onResume"
      @newGame="onNewGame"
      @save="onSave"
      @load="onLoad"
      @blockInput="onBlockInput"
    )

    //- The perf panel is a dev surface and self-gates; a chapter is exactly the
    //- kind of scene whose draw calls need watching, so it stays available.
    //-
    //- `WorldSettingsPanel` is deliberately NOT here. Its graphics controls now
    //- live in `GraphicsMenu`, reached through Settings in the pause screen,
    //- which is where a player looks for them — and a floating panel with a
    //- second copy of the same six switches is a way for the two to disagree.
    //- The sandbox route still mounts it: `/` has no pause menu, and there the
    //- panel is the only way to reach those switches.
    //-
    //- It also used to be what pushed the player's settings into the renderer.
    //- `onMounted` below does that directly now, so dropping the panel costs the
    //- chapter nothing.
    WorldPerfPanel(:world="world")
</template>

<!--
  `/story` — Chroniken von Arlaan, Chapter 1: *Die Trollschweinjagd*.

  The same shell as `WorldScene.vue` with three differences, and each of them is
  a consequence of the chapter rather than a preference:

    * the `World` is built in **story mode** (`WorldOptions.mode`), so it brings
      the terrain, scatter, grass, lighting and LOD and brings none of the
      editor, the saved level, the demo characters or the pooled crowd;
    * a `StoryDirector` is constructed *after* the world, because it needs the
      world's own ground sampler and collision world, and it is driven from the
      world's per-frame hook so it lands at one fixed point in a frame whose
      order is load-bearing;
    * the HUD **polls** a revision counter and copies a flat snapshot out. It
      never holds the director. `StoryDirector` owns a `CombatDirector`, which
      owns fourteen `Character`s, which own skeletons, skinned meshes and their
      buffers — handing any of that to Vue's reactive proxy is the single
      easiest way to destroy this project's performance, and it fails silently
      (GDD §0).
-->

<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import FpsMeter from '@/components/atoms/FpsMeter.vue'
import ControlsOverlay from '@/components/organisms/ControlsOverlay.vue'
import NpcBillboard from '@/components/organisms/NpcBillboard.vue'
import ObjectiveLocator from '@/components/organisms/ObjectiveLocator.vue'
import ObjectiveTracker from '@/components/organisms/ObjectiveTracker.vue'
import SeatBillboard from '@/components/organisms/SeatBillboard.vue'
import PauseMenu from '@/components/organisms/PauseMenu.vue'
import StoryOverlay from '@/components/organisms/StoryOverlay.vue'
import WorldPerfPanel from '@/components/organisms/WorldPerfPanel.vue'
import { actionForCode, keybindings } from '@/use/useKeybindings'
import { applySettingsTo, settings } from '@/use/useGameSettings'
import { readSlot, type SaveSlotId, writeSlot } from '@/use/useStorySave'
import { World } from '@/world/core/World'
import { speakerName, type Speaker } from '@/world/story/script'
import { makeScreenPoint, projectToScreen, type ScreenPoint } from '@/world/story/project'
import { StoryDirector, type StoryState } from '@/world/story/StoryDirector'
import { campPlacements, CAMP } from '@/world/story/camp'
import { framePlacements, ISLE, seaPlacement } from '@/world/story/frame'
import { grassFootprints, packFootprints, scatterFootprints } from '@/world/story/footprints'
import { setGrassExclusions } from '@/world/grass/grassPlacement'
import { arlaPlacement, chapterOnePlacements, PALISADE_A } from '@/world/story/level'
import { bakeStoryTerrain } from '@/world/story/terrain'
import { createWaterView } from '@/world/water/view'

const host = useTemplateRef<HTMLDivElement>('host')
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')

const world = shallowRef<World | null>(null)
const director = shallowRef<StoryDirector | null>(null)
/**
 * True until `onPlaceablesReady`, i.e. until the chapter's buildings exist.
 *
 * `StoryOverlay`'s `settling` prop documents why this is needed at all. It is a
 * plain `ref<boolean>` flipped exactly once, so it costs Vue one patch for the
 * whole chapter.
 */
const settling = ref(true)
/**
 * The HUD's copy of the chapter's state.
 *
 * A plain `ref` holding a plain object, refreshed from `director.state` only
 * when the director's revision counter moves. That is the same polling pattern
 * `LevelEditorPanel` and the perf panel use, and for the same reason: a `ref`
 * that pointed at the director would proxy the whole scene graph behind it.
 */
const state = ref<StoryState | null>(null)

let observer: ResizeObserver | null = null
let lastRevision = -1
/** Tears down the three watchers started in `onMounted`. */
let stopWatchers: (() => void) | null = null

const { t, locale } = useI18n()

const paused = ref(false)
/** True while a menu is capturing keys — the rebind screen. Input stands down. */
const inputBlocked = ref(false)

/**
 * The projections, as plain refs holding **mutated** structs.
 *
 * The struct identity never changes; `refreshScreenPoints` writes into it and
 * bumps `screenTick` so the computeds re-run. That is deliberate and it is the
 * same trade the state snapshot makes above: a new object per frame for two
 * indicators is 120 objects a second for a UI that changes what it draws maybe
 * twice a minute.
 */
const locatorRaw = makeScreenPoint()
const talkRaw = makeScreenPoint()
const seatRaw = makeScreenPoint()
const screenTick = ref(0)
const hasLocator = ref(false)
const hasTalk = ref(false)
const hasSeat = ref(false)

/**
 * ─── The label's *content*, copied out as primitives ────────────────────────
 *
 * `state.talkTarget` and `state.seat` are single structs the director rewrites
 * in place every frame — deliberately, so nine cast members do not cost nine
 * objects a frame (see `StoryDirector.talkSlot`). The snapshot then re-points at
 * the same reference each frame, so `state.value.talkTarget` **never changes
 * identity**, and neither struct is reactive.
 *
 * A `computed` reading `state.value?.talkTarget?.nameKey` therefore has no
 * dependency on the name at all. It re-runs only when `state.value` is replaced
 * on a revision bump, when `hasTalk` flips, or when the locale changes — and the
 * consequence was reported from the forest: the three companions walk in
 * formation, so the prompt never drops, `hasTalk` never flips, and **every one
 * of them showed "Jester"** — whoever happened to be focused the first time the
 * prompt appeared.
 *
 * So the two fields the labels actually read are copied out as primitives. A
 * `ref` assignment with an unchanged string or boolean is a no-op for Vue's
 * dependency tracking (it compares with `Object.is`), so this costs nothing on
 * the frames where nothing changed — unlike `screenTick`, which the *points*
 * legitimately bump every frame because a moving head is a moving pixel.
 */
const talkKey = ref<Speaker | ''>('')
const seatSeated = ref(false)

const locatorPoint = computed<ScreenPoint | null>(() => {
  screenTick.value
  return hasLocator.value ? { ...locatorRaw } : null
})

const talkPoint = computed<ScreenPoint | null>(() => {
  screenTick.value
  return hasTalk.value ? { ...talkRaw } : null
})

const seatPoint = computed<ScreenPoint | null>(() => {
  screenTick.value
  return hasSeat.value ? { ...seatRaw } : null
})

/**
 * Whether the seat prompt is up, and which of its two states it is in.
 *
 * All the work is the director's: it decides which seat the camera is on, and
 * whether the player is in one. This copies out the single boolean the
 * component branches on, and holds no reference to anything on the three.js
 * side — the same rule the talk label follows and for the same reason.
 */
const seatLabel = computed(() => {
  if (!hasSeat.value) {
    return null
  }
  return { seated: seatSeated.value }
})

/**
 * The name over an NPC's head, and whether the camera is actually on them.
 *
 * The director resolves *who* by aim (`findTalkTarget`); this only resolves what
 * their name says in the language being read. `focused` is always true today —
 * the director hands back a single winner — and the prop exists so a future
 * version that shows a dimmed label for a second nearby NPC does not need the
 * component changed.
 */
const talkLabel = computed(() => {
  const key = talkKey.value
  if (!key || !hasTalk.value) {
    return null
  }
  return { name: speakerName(key, locale.value), focused: true }
})

/**
 * The objective list, with its i18n keys resolved.
 *
 * The director deals in keys because it has no business knowing which language
 * the player reads (see `StoryState.objectives`), and this is where that is
 * turned into text — one place, so a missing key shows up once rather than in
 * two components with different fallbacks.
 */
const objectiveRows = computed(() =>
  (state.value?.objectives ?? []).map(objective => ({
    id: objective.id,
    label: t(`story.objective.${objective.key}`),
    done: objective.done,
    distance: objective.distance
  }))
)

/**
 * The controls panel disappears once the player is past chapter 1.
 *
 * The brief, and the reasoning behind it is sound: a controls list is teaching
 * material, and a player who has finished a chapter has either learned the
 * controls or is about to go looking for them in the settings. It stays
 * reachable from the `toggleControls` key either way.
 */
const controlsVisible = computed(() => !paused.value && (state.value?.chapter ?? 1) < 2)

const onAdvance = (): void => {
  director.value?.advanceLine()
  refresh()
}

const onRetry = (): void => {
  director.value?.retry()
  refresh()
}

const onRestart = (): void => {
  director.value?.begin()
  refresh()
}

const refresh = (): void => {
  const instance = director.value
  if (instance) {
    state.value = instance.state
    lastRevision = instance.stateRevision
  }
}

// ── Pause, saves, and the keys that reach them ──────────────────────────────

/**
 * Freezes the chapter and lets go of the pointer.
 *
 * The lock release is the part that is easy to forget and impossible to miss:
 * without it the menu is up, the mouse is still captured by the canvas, and the
 * player cannot click anything on it.
 */
const onPause = (): void => {
  if (paused.value) {
    return
  }
  paused.value = true
  director.value?.player.setEnabled(false)
  if (document.pointerLockElement) {
    document.exitPointerLock()
  }
}

const onResume = (): void => {
  if (!paused.value) {
    return
  }
  paused.value = false
  // Only the *chapter* decides whether input comes back: resuming into a
  // dialogue beat must leave the player switched off, and the director already
  // knows which of those it is.
  refresh()
  const instance = director.value
  if (instance && state.value?.phase === 'playing') {
    instance.player.setEnabled(true)
  }
}

const onNewGame = (): void => {
  paused.value = false
  director.value?.begin()
  refresh()
}

/**
 * Writes the chapter into a slot.
 *
 * The label is resolved here rather than stored as a key, because
 * `useStorySave` renders the row in whatever language is current *when the list
 * is drawn* and a key would need the whole i18n stack inside a storage module.
 * The trade is that a save made in German shows a German label after switching
 * to English — which is a save-game timestamp, not a game string, and reads as
 * a record of what you were doing rather than as an untranslated leak.
 */
const onSave = (slot: SaveSlotId): void => {
  const instance = director.value
  const live = state.value
  if (!instance || !live) {
    return
  }
  writeSlot(slot, {
    chapter: live.chapter,
    beatId: live.beatId,
    label: live.objective ? t(`story.objective.${live.objective}`) : live.beatId,
    payload: instance.snapshot()
  })
}

const onLoad = (slot: SaveSlotId): void => {
  const record = readSlot(slot)
  const instance = director.value
  if (!record || !instance) {
    return
  }
  if (instance.restore(record.payload)) {
    paused.value = false
    refresh()
  }
}

/**
 * The rebind screen is capturing keys, so this one stops listening.
 *
 * Without it, pressing Escape to leave the rebind screen also opens or closes
 * the pause menu underneath it, and binding a key to `F5` quick-saves on the
 * way past.
 */
const onBlockInput = (blocked: boolean): void => {
  inputBlocked.value = blocked
}

/**
 * The three keys the shell owns: pause, quick save, quick load.
 *
 * Everything else goes through `StoryPlayer`, which reads the same binding
 * table. These three are here because they act on the *session* rather than on
 * the character — the input layer has no idea what a save slot is, and giving it
 * one would put `localStorage` inside the frame loop.
 */
const onWindowKey = (event: KeyboardEvent): void => {
  if (event.repeat || inputBlocked.value) {
    return
  }
  const action = actionForCode(event.code)
  if (action === 'pause') {
    // `PauseMenu` swallows Escape while it is open and handles going back a
    // screen itself, so this only ever has to open it.
    event.preventDefault()
    // ── The chapter gets first refusal ──────────────────────────────────
    //
    // Escape is "get me out of whatever I am in", and being sat on a bench is
    // something to get out of. `StoryDirector.escape` answers true when it used
    // the press, which is this shell's cue to stop — without the handshake the
    // one key that means "out" would stand the player up *and* open the pause
    // menu over the top of them on the same press.
    if (director.value?.escape()) {
      refresh()
      return
    }
    onPause()
  } else if (action === 'quickSave') {
    event.preventDefault()
    onSave(0)
  } else if (action === 'quickLoad') {
    event.preventDefault()
    onLoad(0)
  }
}

/**
 * Projects the two world-anchored indicators, once per frame.
 *
 * Called from inside `onUpdate`, after the director has run, so both points are
 * this frame's. The camera's own matrices are one frame old at that moment —
 * they refresh during `render` — and a one-frame lag on a HUD marker is a
 * fraction of a pixel at walking speed.
 */
const refreshScreenPoints = (camera: Parameters<typeof projectToScreen>[0], live: StoryState): void => {
  const objective = live.objectiveAt
  hasLocator.value = objective !== null
  if (objective) {
    projectToScreen(camera, objective.x, objective.y, objective.z, locatorRaw)
    locatorRaw.distance = live.objectiveDistance ?? locatorRaw.distance
  }

  const talk = live.talkTarget
  if (talk) {
    projectToScreen(camera, talk.at.x, talk.at.y, talk.at.z, talkRaw)
    // A prompt for somebody who is off the edge of the screen is not useful and
    // there is no arrow here to point with, so it simply does not appear.
    hasTalk.value = talkRaw.onScreen
    // The name, as a primitive. See `talkKey` — the struct this came off is the
    // same object every frame, so the label cannot depend on it.
    talkKey.value = talk.nameKey
  } else {
    hasTalk.value = false
    talkKey.value = ''
  }

  const seat = live.seat
  if (seat) {
    projectToScreen(camera, seat.at.x, seat.at.y, seat.at.z, seatRaw)
    hasSeat.value = seatRaw.onScreen
    seatSeated.value = seat.seated
  } else {
    hasSeat.value = false
  }
  screenTick.value++
}

onMounted(() => {
  const canvasElement = canvas.value
  const hostElement = host.value
  if (!canvasElement || !hostElement) {
    return
  }

  // ── The terrain shaping ─────────────────────────────────────────────────
  //
  // Baked before the world exists, because the world needs it at construction:
  // the heightfield takes it as a delta and the chunk workers are handed it as
  // a patch before a single chunk is built. Doing it afterwards means the first
  // chunks are built from unshaped ground and the player can see them.
  // Two regions: Arlaan's valley and the storyteller's island. See
  // `story/terrain.ts` on why they are baked separately rather than as one
  // rectangle containing both.
  const sculpt = bakeStoryTerrain({ seed: STORY_SEED, amplitude: 17, featureSize: 190, plainRadius: 34 })

  const instance = markRaw(
    new World(canvasElement, {
      mode: 'story',
      seed: STORY_SEED,
      // Gentler than Meadowfall's 30 m of relief. Nimmerschein sits in farmland
      // on a river, not on a hero landscape, and a village on a 30 m hillside
      // needs a retaining wall rather than a palisade.
      heightfield: { amplitude: 17, featureSize: 190, plainRadius: 34 },
      sculpt: sculpt.field,
      // Clear the whole village plus its skirt, or the procedural forest grows
      // through the market square.
      scatterClearRadius: PALISADE_A + 18,
      // And the island, which the origin-relative radius above cannot reach.
      // 58 m clears the hamlet and the road and stops just inside the shore
      // trees `frame.ts` places by hand — so the island keeps an edge of wood
      // and loses the forest that was growing through the storyteller's kitchen.
      scatterClearZones: [{ x: ISLE.x, z: ISLE.z, radius: 58 }],
      // Early afternoon. `dayCycle.ts` maps 0.5 to noon and 0.75 to sunset, so
      // 0.58 is a couple of hours past midday — which is where the chapter
      // starts (they set the trap in the morning and are "hours" out by the time
      // it springs) and, more practically, the last point on the arc where the
      // sun is still high enough to light a forest floor. 0.72 was tried first
      // and is 40 minutes before sunset: the distant canopy was lit and
      // everything at ground level, the whole cast included, was a silhouette.
      startTime: 0.58
    })
  )
  instance.attach(canvasElement)
  instance.setCameraMode('story')
  // Both places at once. They are 1.7 km apart and the batcher cells by a 48 m
  // grid (`PlacementBatcher`), so the island's props and Arlaan's never share a
  // cell and only whatever is near the camera is ever drawn — there is no cost
  // to holding both, and no moment where the chapter has to load anything.
  // Three places, all resident. They are hundreds of metres apart and the
  // batcher cells by a 48 m grid (`PlacementBatcher`), so no two of them ever
  // share a cell and only whatever is near the camera is drawn.
  const placements = [...chapterOnePlacements(), ...framePlacements(), ...campPlacements()]
  instance.setStoryPlacements(placements)

  // ── Nothing procedural grows through a building ──────────────────────────
  //
  // Deferred until the catalogue exists, because a footprint is derived from a
  // prop's registered *collider* and the catalogue drains over the ~30 frames
  // after the first one. Asking earlier returns nothing and the exclusion list
  // comes out empty — silently, which is the whole reason `onPlaceablesReady`
  // exists rather than a timer.
  instance.onPlaceablesReady = () => {
    // First, because everything below it is scatter bookkeeping and the curtain
    // is what the player is looking at.
    settling.value = false

    const forest = scatterFootprints(placements)
    instance.setScatterClearZones([
      // The island's own blanket circle stays: it clears the hamlet's road and
      // yards as well as its buildings, which per-building circles would not.
      { x: ISLE.x, z: ISLE.z, radius: 58 },
      // And the bandits' clearing, for the same reason: a camp is not a building
      // and `scatterFootprints` only knows about buildings, so without this the
      // procedural wood grows straight through the fire the chapter is staged
      // around. 8.5 m is the seating ring plus a pace, and everything outside it
      // is left to the scatter — see the note in `camp.ts` on why the treeline
      // is not hand-placed.
      { x: CAMP.x, z: CAMP.z, radius: 8.5 },
      ...forest
    ])
    setGrassExclusions(packFootprints(grassFootprints(placements)))
    // Grass is placed per terrain chunk and the chunks standing right now were
    // built before the exclusions existed, so they still have blades coming up
    // through the floorboards. Rebuilding is the same call the sculptor uses.
    instance.grass.rebuild()
    if (import.meta.env.DEV) {
      console.debug(`[story] ${forest.length} building footprints kept clear of scatter and grass`)
    }
  }
  world.value = instance

  // ── The water: the Arla, and the sea round the storyteller's island ──────
  //
  // Built straight from the water view factory rather than through the water
  // *editor*, which is a sandbox tool with a persisted store. Water in a chapter
  // is content: the same mesh, the same material and the same wave shader, with
  // nothing that can be edited or saved.
  //
  // Two bodies, 1.7 km apart, and both are added to the scene for the whole
  // session. A `Mesh` outside the frustum costs one bounding-sphere test, so the
  // alternative — swapping them at the cut — would be a lifecycle to get wrong
  // in exchange for nothing.
  const waterBodies = [arlaPlacement(), seaPlacement()]
  const water = waterBodies
    .map(placement => createWaterView(placement, (x, z) => instance.terrain.heightAt(x, z)))
    .filter((view): view is NonNullable<typeof view> => view !== null)
  for (const view of water) {
    instance.scene.add(view.object)
  }
  // ── And the scatter is told where they are ───────────────────────────────
  //
  // Before the first chunk streams, because the water only bites where scatter
  // is *generated*. Without it the world's single `minHeight` constant has to
  // serve a sea at y = 2.0 and a river at y = 1.7 falling to −1.7 seventeen
  // hundred metres apart, and it cannot: what shipped was full-size oaks
  // standing in the sea off the storyteller's island, trunks submerged, out to
  // the horizon. `World.setWaterPlanes` is the narrow seam — the engine learns
  // the geometry and never learns that a chapter exists.
  instance.setWaterPlanes(waterBodies)

  const story = markRaw(
    new StoryDirector({
      camera: instance.camera,
      groundAt: (x, z) => instance.terrain.heightAt(x, z),
      collision: () => instance.player.propCollision,
      // The same list the world is drawing, so the chapter's benches, stools
      // and chairs can carry an [E] prompt. `world/interaction/seats.ts` picks
      // the sittable ones out of it once, here, rather than every frame — see
      // `SeatFinder`.
      placements,
      // Lets the chapter open the storyteller's roof when the player goes
      // indoors. See `StoryDirector.updateRoofVeil` — this is the whole of the
      // wiring, because the veil rides on the instanced field's existing
      // crossfade rather than on a material of its own.
      setPlacementVeil: (defId, value) => instance.setPlacementVeil(defId, value),
      // ── The chapter drives the sun ─────────────────────────────────────
      //
      // `World` has already frozen the cycle for story mode (`timeScale = 0`,
      // and the comment there records the session that rolled from 0.58 to
      // 0.84 while the player was still setting the trap). This is what moves
      // it instead: a beat names a time and the sky goes there, snapped for a
      // cut and slid for a scene that contains the passage of time.
      //
      // `blendTo` deliberately ignores `timeScale`, so a frozen sky is exactly
      // the sky this can still drive — see `dayCycle.ts`.
      setTimeOfDay: (time, blendSeconds) => {
        if (blendSeconds > 0) {
          instance.dayCycle.blendTo(time, blendSeconds)
        } else {
          instance.dayCycle.setTime(time)
        }
      }
    })
  )
  instance.scene.add(story.group)
  instance.profiler.registerRoot(story.group, 'story')
  story.player.attach(canvasElement)
  story.begin()
  director.value = story

  // The one place the chapter is ticked. Before the camera matrices refresh,
  // so the LOD systems and the shadow cascades see where the story has just
  // put the view rather than where it was last frame.
  instance.onUpdate = dt => {
    story.update(dt)
    // Read **once** a frame. `story.state` is a getter that builds a fresh
    // object, so two reads is two allocations sixty times a second — the exact
    // shape of per-frame garbage GDD §5 rules out, and it slipped in the moment
    // a second consumer needed the same data.
    const live = story.state
    if (story.stateRevision !== lastRevision) {
      refresh()
    } else if (state.value) {
      // Vitals and the draw ring change every frame and carry no revision — a
      // counter bumped 60 times a second is not a change notification. They are
      // copied into the existing snapshot in place, which costs Vue one patch
      // of a few numbers rather than a new object per frame.
      state.value.hp = live.hp
      state.value.stamina = live.stamina
      state.value.aim = live.aim
      state.value.foes = live.foes
      state.value.canInteract = live.canInteract
      state.value.needsPointerLock = live.needsPointerLock
      state.value.aiming = live.aiming
      state.value.weapon = live.weapon
      // `talkTarget` is one struct the director rewrites in place, so the
      // snapshot has to be re-pointed at it every frame — copying the fields
      // would need a null check per field and would still be the same object.
      state.value.talkTarget = live.talkTarget
      // Same treatment, same reason: the director rewrites one seat struct in
      // place and hands back either it or null, so the snapshot is re-pointed
      // at it rather than having its fields copied.
      state.value.seat = live.seat
      state.value.objectiveAt = live.objectiveAt
      state.value.objectiveDistance = live.objectiveDistance
    }
    refreshScreenPoints(instance.camera, live)
  }
  refresh()

  // ── The player's own settings, pushed into the scene ────────────────────
  //
  // The chapter's only path from `useGameSettings` to the renderer, now that
  // `WorldSettingsPanel` is not mounted here. `GraphicsMenu` writes the setting
  // and this watch applies it; `World.applySettings` early-outs on an unchanged
  // value, so pushing all six on every change costs nothing.
  applySettingsTo(instance)
  const stopSettings = watch(settings, () => applySettingsTo(instance), { deep: true })

  // The input layer holds a frozen copy, never the reactive object (GDD §0).
  story.player.setBindings(keybindings.value)
  const stopBindings = watch(keybindings, next => story.player.setBindings(next), { deep: true })

  // The mouth is timed off the text the player is actually reading — German runs
  // about 15 % longer than the same line in English.
  story.locale = locale.value
  const stopLocale = watch(locale, next => {
    story.locale = String(next)
  })

  stopWatchers = () => {
    stopSettings()
    stopBindings()
    stopLocale()
  }
  window.addEventListener('keydown', onWindowKey)

  if (import.meta.env.DEV) {
    ;(window as unknown as { __world?: World; __story?: StoryDirector }).__world = instance
    ;(window as unknown as { __story?: StoryDirector }).__story = story
    console.debug(`[story] terrain shaped in ${sculpt.ms} ms (${sculpt.cells} cells)`)
    console.debug(`[story] the island is at ${ISLE.x}, ${ISLE.z}`)
  }

  observer = new ResizeObserver(entries => {
    const entry = entries[0]
    if (!entry) {
      return
    }
    instance.setSize(entry.contentRect.width, entry.contentRect.height)
  })
  observer.observe(hostElement)
  instance.setSize(hostElement.clientWidth, hostElement.clientHeight)

  // Same warmup as the sandbox: link every program into a 1x1 buffer before the
  // loop presents anything, so the driver's compile lands behind the splash
  // rather than on the first frame of a boar charge.
  void instance.warmUp().then(() => {
    if (world.value === instance) {
      instance.start()
    }
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKey)
  stopWatchers?.()
  stopWatchers = null
  observer?.disconnect()
  observer = null
  const instance = world.value
  if (instance) {
    instance.onUpdate = null
  }
  director.value?.dispose()
  director.value = null
  instance?.dispose()
  world.value = null
})

/**
 * The chapter's terrain seed.
 *
 * Fixed, and it must stay fixed: the village, the road, the river and the trap
 * clearing are all authored against the ground this seed produces, and changing
 * it moves the ground out from under two hundred hand-placed props.
 */
const STORY_SEED = 4711
</script>
