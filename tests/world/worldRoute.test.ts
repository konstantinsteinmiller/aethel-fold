import { describe, expect, it } from 'vitest'
import router from '@/router'

describe('the /world bench route', () => {
  it('resolves, and is lazy', () => {
    const route = router.resolve('/world')
    expect(route.name).toBe('world')
    // A lazy route's component is a function; an eagerly imported one would
    // pull the whole Meadowfall engine into the entry chunk every player loads.
    expect(typeof route.matched[0]?.components?.default).toBe('function')
  })

  it('no longer serves the removed water lab or character creator', () => {
    for (const path of ['/water', '/characters']) {
      expect(router.resolve(path).name, path).not.toBe('world')
      expect(router.resolve(path).matched[0]?.path, path).toBe('/:pathMatch(.*)*')
    }
  })
})
