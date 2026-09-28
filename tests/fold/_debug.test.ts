import { it } from 'vitest'
import { FoldGame } from '@/fold/logic/game'
import { isGrabbable, isStampable, onFootprint } from '@/fold/logic/folds'
const botStep = (g: FoldGame): void => {
  for (let i = 0; i < g.folds.length; i++) {
    const f = g.folds[i]!
    const k = f.def.kind
    if (isStampable(f)) { if (g.enemies.some((e) => (e.state === 'blocked' || e.state === 'trapped') && e.fold === i)) g.stamp(i); continue }
    if (!isGrabbable(f)) continue
    const on = g.enemies.filter((e) => (e.state === 'march' || e.state === 'stand') && onFootprint(f, e.x, e.z, 0)).length
    if (k === 'wall' && f.def.structure === 'shield') {
      const incoming = g.projectiles.some((p) => p.alive && !p.stuck) || g.enemies.some((e) => e.state === 'stand' && e.windup > 0.3) || g.boss.phase === 'breathCharge'
      if (incoming) g.foldNow(i)
    } else if (k === 'wall' || k === 'valley') {
      if (on >= 1) g.foldNow(i)
    } else if (k === 'launch') {
      if (g.enemies.some((e) => e.type === 'catapult' && e.state === 'stand' && onFootprint(f, e.x, e.z, 0.2))) g.foldNow(i)
    } else if (k === 'ridge' || k === 'frog') g.foldNow(i)
  }
  for (let i = 0; i < g.tears.length; i++) { const t = g.tears[i]!; if (t.active && !t.torn) g.pullTear(i, 1) }
  const b = g.boss
  if (b.exposed >= 0) { const w = b.weakPoints[b.exposed]!; g.pullWeak(1); if (w.mode === 'crease') g.releaseWeak() }
  if (g.phase === 'peel') g.peelDrag(1)
}
it('debug boss', () => {
  const g = new FoldGame({ seed: 99 })
  g.startRun(5)
  const dt = 1/60
  let last = ''
  for (let t = 0; t < 200; t += dt) {
    botStep(g)
    g.update(dt)
    for (let i = 0; i < g.events.count; i++) { const e = g.events.items[i]!; if (e.type==='heroHit'||e.type==='bossHurt'||e.type==='crumple'||e.type==='breach'||e.type==='victory') console.log(t.toFixed(2), e.type, e.a, e.b, e.x.toFixed(1), e.z.toFixed(1)) }
    g.events.clear()
    const b = g.boss
    const s = `${g.phase} ${b.phase} exp${b.exposed} hp${g.hero.hp} alive${g.aliveCount()}`
    if (s !== last) { console.log(t.toFixed(2), s); last = s }
    if (g.phase === 'victory') break
  }
})
it('debug page4', () => {
  const g = new FoldGame({ seed: 11 })
  g.startRun(4)
  const dt = 1/60
  for (let t = 0; t < 240; t += dt) {
    botStep(g)
    g.update(dt)
    g.events.clear()
    if (g.pageId !== 4) { console.log('left page 4 at', t.toFixed(1)); return }
  }
  console.log('stuck', g.phase, g.waveIndex, g.enemies.filter(e=>e.state!=='dead').map(e=>`${e.type}:${e.state}@${e.x.toFixed(1)},${e.z.toFixed(1)} f${e.fold}`).join(' | '), g.folds.map(f=>f.def.id+':'+f.phase+':'+f.t.toFixed(2)).join(' '))
})
