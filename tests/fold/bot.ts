import { FoldGame } from '@/fold/logic/game'
import { isGrabbable, isStampable, onFootprint } from '@/fold/logic/folds'
import { SLING_GAIN } from '@/fold/logic/config'
import { LESSON_IDS } from '@/fold/logic/lessons'
import type { LessonId } from '@/fold/logic/types'

/** Every lesson already learned (no lesson slow-mo): for balance measurements. */
export const ALL_LESSONS_LEARNED = Object.fromEntries(LESSON_IDS.map((id) => [id, true])) as Record<LessonId, boolean>

/**
 * A scripted "perfect-ish" player: it does what the wordless lessons teach,
 * on the frame it becomes useful. If this bot can't finish a page, a human
 * can't either — so this is the balance/flow smoke test for all six pages.
 */
export const botStep = (g: FoldGame): void => {
  // Folds.
  for (let i = 0; i < g.folds.length; i++) {
    const f = g.folds[i]!
    const k = f.def.kind
    if (isStampable(f)) {
      const holding = g.enemies.some((e) => (e.state === 'blocked' || e.state === 'trapped') && e.fold === i)
      if (holding) g.stamp(i)
      continue
    }
    if (!isGrabbable(f)) continue
    const on = g.enemies.filter((e) => (e.state === 'march' || e.state === 'stand') && onFootprint(f, e.x, e.z, 0)).length
    if (k === 'wall' && f.def.structure === 'shield') {
      const incoming = g.projectiles.some((p) => p.alive && !p.stuck) || g.enemies.some((e) => e.state === 'stand' && e.windup > 0.3) ||
        g.boss.phase === 'breathCharge' || g.boss.phase === 'inkCharge'
      if (incoming) g.foldNow(i)
    } else if (k === 'wall' || k === 'valley') {
      if (on >= 1) g.foldNow(i)
    } else if (k === 'launch') {
      if (g.enemies.some((e) => e.type === 'catapult' && e.state === 'stand' && onFootprint(f, e.x, e.z, 0.2))) g.foldNow(i)
    } else if (k === 'boat') {
      // Book 3: sail when someone is wading the channel.
      if (on >= 1) g.foldNow(i)
    } else if (k === 'pleat') {
      // Book 3: shut the accordion on a column (or on anyone about to walk off its bottom).
      const late = g.enemies.some((e) => e.state === 'march' && onFootprint(f, e.x, e.z, 0) && e.z > f.def.bz - 1.2)
      if (on >= 2 || late) g.foldNow(i)
    } else if (k === 'ridge' || k === 'frog') {
      g.foldNow(i)
    } else if (k === 'ballista') {
      if (g.enemies.some((e) => e.state === 'march' && e.z > 0.5)) g.foldNow(i)
    }
  }
  // Tears.
  for (let i = 0; i < g.tears.length; i++) {
    const t = g.tears[i]!
    if (t.active && !t.torn) g.pullTear(i, 1)
  }
  // Boss weak points.
  const b = g.boss
  if (b.exposed >= 0) {
    const w = b.weakPoints[b.exposed]!
    g.pullWeak(1)
    if (w.mode === 'crease') g.releaseWeak()
  }
  // Peel.
  if (g.phase === 'peel') g.peelDrag(1)
  // Ballistas: shoot the enemy closest to the castle.
  for (let n = 0; n < 2; n++) {
    let lead = -1
    let lz = -Infinity
    for (let j = 0; j < g.enemies.length; j++) {
      const e = g.enemies[j]!
      if ((e.state === 'march' || e.state === 'blocked') && e.z > lz && e.z < 4.5) {
        lz = e.z
        lead = j
      }
    }
    if (lead < 0 || g.armedBallista(g.enemies[lead]!.x) < 0) break
    if (!g.fireBallista(g.enemies[lead]!.x, g.enemies[lead]!.z)) break
  }
  // Sling (book 2): leapers first, then whoever is closest to the keep.
  const s = g.sling
  if (s && s.cool <= 0 && g.acceptsInput()) {
    let best = -1
    let bestScore = -Infinity
    for (let j = 0; j < g.enemies.length; j++) {
      const e = g.enemies[j]!
      if (e.state !== 'march' && e.state !== 'stand' && e.state !== 'blocked') continue
      const sc = e.z + (e.type === 'leaper' ? 6 : e.type === 'runner' ? 2 : 0)
      if (e.z > -5.5 && sc > bestScore) {
        bestScore = sc
        best = j
      }
    }
    if (best >= 0) {
      const e = g.enemies[best]!
      const tz = e.state === 'march' ? e.z + e.speed * 0.8 : e.z
      g.grabSling()
      g.aimSling(-(e.x - s.def.x) / SLING_GAIN, -(tz - s.def.z) / SLING_GAIN)
      g.releaseSling()
    }
  }
}

export const run = (g: FoldGame, seconds: number, until: () => boolean, bot = true): boolean => {
  const dt = 1 / 60
  for (let t = 0; t < seconds; t += dt) {
    if (bot) botStep(g)
    g.update(dt)
    g.events.clear()
    if (until()) return true
  }
  return false
}
