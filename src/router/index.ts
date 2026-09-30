import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const loadGame = () => import('@/views/FoldScene.vue')

/**
 * Start fetching the game's chunk (three.js + the game) at the very top of the
 * boot, so its download and parse overlap the save hydrate, i18n and the app
 * mount instead of starting after them (roadmap #13). Only when the boot is
 * headed for the game route; the router's own import then resolves at once.
 */
export const prefetchGame = (): void => {
  const route = typeof location === 'undefined' ? '' : location.hash.replace(/^#\/?/, '')
  if (route === '' || route.startsWith('?')) void loadGame().catch(() => undefined)
}

const routes: RouteRecordRaw[] = [
  // Aethel Fold (aethel-fold-GDD.md) — the game. No main menu: booting drops
  // the player straight onto the first page (GDD §6), so it is the default
  // route every platform build opens.
  { path: '/', name: 'main', component: loadGame },
  // Meadowfall, the open-world engine the game grew out of. A lazy dev bench,
  // never on the player's path: it stays out of the entry chunk.
  { path: '/world', name: 'world', component: () => import('@/views/WorldScene.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes
})

export default router
