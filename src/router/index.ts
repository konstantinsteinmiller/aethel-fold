import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  // Castle Fold (aethel-fold-GDD.md) — the game. No main menu: booting drops
  // the player straight onto the first page (GDD §6), so it is the default
  // route every platform build opens.
  { path: '/', name: 'main', component: () => import('@/views/FoldScene.vue') },
  // The Meadowfall open-world engine bench (GDD.md). Lazy: a player who never
  // opens it pays for none of it.
  { path: '/world', name: 'world', component: () => import('@/views/WorldScene.vue') },
  // Bench for the water system. Lazy, for the same reason.
  { path: '/water', name: 'water', component: () => import('@/views/WaterLabView.vue') },
  // Character creation bench. Lazy for the same reason.
  { path: '/characters', name: 'characters', component: () => import('@/views/CharacterCreator.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes
})

export default router
