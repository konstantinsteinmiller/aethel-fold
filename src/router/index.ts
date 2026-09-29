import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  // Aethel Fold (aethel-fold-GDD.md) — the game. No main menu: booting drops
  // the player straight onto the first page (GDD §6), so it is the default
  // route every platform build opens.
  { path: '/', name: 'main', component: () => import('@/views/FoldScene.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes
})

export default router
