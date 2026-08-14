import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  // The cel-shaded 3D open world (see GDD.md) — this project's actual game, and
  // therefore the route every platform build boots into.
  { path: '/', name: 'main', component: () => import('@/views/WorldScene.vue') },
  // The original 2D tower-siege game. Kept reachable and fully intact; it still
  // owns `tower_state` and the whole save/ads pipeline that the 3D world
  // inherits. Move it back to '/' to ship it again.
  { path: '/tower', name: 'tower', component: () => import('@/views/GameScene.vue') },
  // Design bench for the monster art direction. Lazy, so it costs a player who
  // never visits it nothing.
  { path: '/monsters', name: 'monsters', component: () => import('@/views/MonsterLab.vue') },
  // Kept so existing links and docs that pointed at /world still resolve.
  { path: '/world', redirect: '/' },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes
})

export default router
