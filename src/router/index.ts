import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  // Aethel Fold (aethel-fold-GDD.md) — the game. No main menu: booting drops
  // the player straight onto the first page (GDD §6), so it is the default
  // route every platform build opens.
  { path: '/', name: 'main', component: () => import('@/views/FoldScene.vue') },
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
