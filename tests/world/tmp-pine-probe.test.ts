import { it } from 'vitest'
import { createPineAsset } from '@/world/assets/pine'

it('tier agreement', () => {
  for (const form of ['spruce', 'fir'] as const) {
    const a = createPineAsset({ seed: 7, form, height: 7.5 })
    const out: string[] = []
    for (const tier of [0, 1, 2, 3]) {
      const g = a.tiers[tier]!
      const p = g.getAttribute('position')
      // projected silhouette width, averaged over 36 view azimuths
      let sum = 0
      for (let k = 0; k < 36; k++) {
        const th = (k / 36) * Math.PI * 2
        let lo = 9, hi = -9
        for (let i = 0; i < p.count; i++) {
          if (p.getY(i) < 1.7) continue
          const d = p.getX(i) * Math.cos(th) + p.getZ(i) * Math.sin(th)
          lo = Math.min(lo, d); hi = Math.max(hi, d)
        }
        sum += hi - lo
      }
      let maxR = 0
      for (let i = 0; i < p.count; i++) maxR = Math.max(maxR, Math.hypot(p.getX(i), p.getZ(i)))
      out.push(`LOD${tier} avgWidth=${(sum / 36).toFixed(3)} maxR=${maxR.toFixed(3)}`)
    }
    console.log(`${form}: ${out.join('  |  ')}`)
  }
  // leader thinness
  const a = createPineAsset({ seed: 7, height: 7.5 })
  const p = a.tiers[0]!.getAttribute('position')
  let leaderR = 0
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 6.0 && p.getY(i) < 7.4) leaderR = Math.max(leaderR, Math.hypot(p.getX(i), p.getZ(i)))
  console.log(`leader max radius between y=6.0 and 7.4: ${leaderR.toFixed(3)} m`)
})
