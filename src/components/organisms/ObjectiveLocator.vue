<template lang="pug">
  div(class="pointer-events-none absolute inset-0 z-20 overflow-hidden select-none" aria-hidden="true")
    //- Deliberately no `<transition>` wrapper. The near fade is an inline
    //- `opacity`, and an inline style beats any class a transition could add —
    //- the enter/leave rules would be silently dead. The fade that matters is
    //- the distance one, and it is a CSS transition on the element itself.
    div(
      v-if="marker"
      class="locator absolute"
      :class="marker.onScreen ? 'is-onscreen' : 'is-offscreen'"
      :style="style"
    )
      div(class="flex flex-col items-center")
        div(class="relative h-6 w-6")
          span(class="locator__pulse absolute inset-0 rounded-full ring-2 ring-amber-300/70")
          span(class="absolute inset-[3px] rounded-full bg-slate-950/40 ring-1 ring-amber-200/55")
          //- On screen: a solid core you can put a crosshair on.
          span(v-if="marker.onScreen" class="absolute inset-[8px] rotate-45 rounded-[1px] bg-amber-300")
          //- Off screen: an arrow orbiting the ring, at the ring's edge, in the
          //- direction of the target. One element does both jobs —
          //- `rotate() translateX()` puts it *there* and points it *that way*.
          svg(
            v-else
            class="locator__arrow absolute h-3 w-3 text-amber-300"
            viewBox="0 0 12 12"
            aria-hidden="true"
          )
            path(d="M2.4 1.1L10.2 6L2.4 10.9Z" fill="currentColor")
        span(class="mt-1 text-[10px] font-semibold tabular-nums text-amber-100") {{ metres }}
</template>

<!--
  The objective locator ping.

  ── Contract ────────────────────────────────────────────────────────────────

    props   screen  `{ x, y, onScreen, distance } | null`
                    · `x` / `y` — the objective's world position projected to
                      **normalised viewport coordinates, origin top-left**:
                      `x = 0` is the left edge, `x = 1` the right, `y = 0` the
                      top, `y = 1` the bottom. They are NOT clamped by the
                      caller — off-screen values may be anything, including
                      large negatives, and this component clamps them.
                    · `onScreen` — whether the target is actually in frame.
                      The caller decides; usually `x`,`y` inside 0..1 **and**
                      the point in front of the camera.
                    · `distance` — metres from the player, for the readout and
                      the near fade.
                    · `null` — nothing to point at; the ping fades out.
    emits   none

  Mount it inside the scene's `relative` host — the one the canvas fills — since
  every position here is a percentage of that box. `z-20`, one layer under
  `StoryOverlay`'s `z-30`, so a dialogue plate or the death screen covers it.

  ── No 3D maths lives here, and that is the point ───────────────────────────

  This component imports nothing from `world/`, and specifically not three.js.
  Projection needs the camera, the camera lives in the frame loop, and the frame
  loop is the one place in this project where an allocation costs something
  (GDD §0). So the scene projects — once per frame, into a struct it already
  owns — and this draws. The consequence worth stating: a `NaN` from an
  unwritten transform would land in a CSS `calc()`, invalidate the declaration
  and park the marker silently in the top-left corner, so every field is checked
  with `Number.isFinite` before it is allowed near a style.

  ── What the caller must get right for a point *behind* the camera ──────────

  A perspective projection mirrors points behind the camera through the origin:
  an objective directly behind you projects to the *opposite* side of the
  screen, so an arrow drawn from the raw value points exactly 180° wrong — the
  player turns away from the thing they are looking for. The caller must flip
  such a point (negate the projected x/y about the screen centre, then push it
  well outside 0..1) before handing it over. This component cannot detect the
  case: `onScreen: false` looks the same either way.

  ── The clamp is per-axis, not a ray/box intersection ───────────────────────

  `left` and `top` are each clamped independently into the viewport inset, so a
  target hard left and slightly high pins to the left edge at roughly its own
  height rather than to the exact point where the line from screen centre leaves
  the rectangle. The difference is a few degrees of position and none of
  direction — the arrow angle is computed from the true `x`/`y`, so it still
  points at the target — and it buys the whole thing being two CSS declarations
  that cost nothing per frame.
-->

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

interface ScreenPoint {
  x: number
  y: number
  onScreen: boolean
  distance: number
}

const props = defineProps<{ screen: ScreenPoint | null }>()

const { t } = useI18n()

/**
 * Below this the marker starts to go, and by `NEAR_FADE_GONE` it is invisible.
 *
 * Three metres is roughly where the interact prompt takes over and where the
 * thing itself fills enough of the frame to be its own signpost; a ping still
 * sitting on top of it at that range is just something in the way.
 */
const NEAR_FADE_FULL = 3
const NEAR_FADE_GONE = 1.2

/**
 * The prop, once it has been proven safe to put in a `calc()`.
 *
 * A single NaN here is not a visible error — it invalidates the declaration and
 * the marker parks in the corner, which reads as "the locator is broken" rather
 * than "the position was never written". Same guard, same reason, as the LOD
 * generators.
 */
const marker = computed<ScreenPoint | null>(() => {
  const screen = props.screen
  if (!screen) {
    return null
  }
  if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y) || !Number.isFinite(screen.distance)) {
    return null
  }
  return screen
})

const nearFade = computed(() => {
  const distance = marker.value?.distance ?? Number.POSITIVE_INFINITY
  if (distance >= NEAR_FADE_FULL) {
    return 1
  }
  if (distance <= NEAR_FADE_GONE) {
    return 0
  }
  return (distance - NEAR_FADE_GONE) / (NEAR_FADE_FULL - NEAR_FADE_GONE)
})

/**
 * `--x` / `--y` are handed to CSS raw and unclamped.
 *
 * Everything positional is then one declaration each: the clamp is a `clamp()`
 * and the arrow angle is an `atan2()` of the same two numbers. Doing it in
 * script instead would mean recomputing a transform string on every projection
 * update, which is every frame the player is moving.
 */
const style = computed(() => {
  const screen = marker.value
  if (!screen) {
    return undefined
  }
  return {
    '--x': String(screen.x),
    '--y': String(screen.y),
    opacity: String(nearFade.value)
  }
})

const metres = computed(() =>
  marker.value ? t('story.metres', { n: Math.max(0, Math.round(marker.value.distance)) }) : ''
)
</script>

<style scoped lang="sass">
.locator
  // How close to the viewport edge a clamped marker is allowed to sit. Wide
  // enough that the orbiting arrow and the metres readout both stay inside it.
  --edge: 2.75rem
  left: calc(var(--x) * 100%)
  top: calc(var(--y) * 100%)
  transform: translate(-50%, -50%)
  transition: opacity 200ms ease
  filter: drop-shadow(0 1px 3px rgba(2, 6, 23, 0.8))

// `top`'s percentage resolves against the host's height and `left`'s against
// its width, which is exactly what normalised viewport coordinates want.
.locator.is-offscreen
  left: clamp(var(--edge), calc(var(--x) * 100%), calc(100% - var(--edge)))
  top: clamp(var(--edge), calc(var(--y) * 100%), calc(100% - var(--edge)))

// The direction from screen centre to the target. CSS rotation is clockwise and
// the y axis points down, which is the same handedness the projected `y` is
// already in — so `atan2(dy, dx)` is the angle with no correction term, and an
// arrow drawn pointing along +x needs no offset either.
//
// `translateX` after `rotate` reads in the rotated frame, so this places the
// arrow on the ring's edge in the target's direction *and* orients it outward
// with one transform.
//
// The first declaration is the fallback: a browser without `atan2()` drops the
// second as invalid and would otherwise lose the `translateX` with it, leaving
// the arrow stacked underneath the ring where it reads as nothing at all.
.locator__arrow
  left: 50%
  top: 50%
  margin: -0.375rem 0 0 -0.375rem
  transform: translateX(1rem)
  transform: rotate(atan2(calc(var(--y) - 0.5), calc(var(--x) - 0.5))) translateX(1rem)

.locator__pulse
  animation: locator-pulse 1900ms ease-out infinite

@keyframes locator-pulse
  0%
    transform: scale(0.8)
    opacity: 0.85
  70%
    transform: scale(1.55)
    opacity: 0
  100%
    transform: scale(1.55)
    opacity: 0

@media (prefers-reduced-motion: reduce)
  // A steady ring rather than no ring: the pulse is what makes the marker
  // findable, so switching it off has to leave something with the same weight.
  .locator__pulse
    animation: none
    opacity: 0.6
</style>
