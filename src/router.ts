import { createRouter, createWebHistory } from 'vue-router'
import { useSessionStore } from '@/stores/session'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home-redirect',
      component: () => import('@/views/HomeRedirect.vue'),
    },
    { path: '/login', name: 'parent-login', component: () => import('@/views/LoginView.vue') },
    { path: '/select', name: 'kid-select', component: () => import('@/views/KidSelectView.vue') },
    {
      path: '/kid',
      component: () => import('@/views/kid/KidLayout.vue'),
      meta: { role: 'child' },
      children: [
        { path: '', name: 'kid-home', component: () => import('@/views/kid/KidHome.vue') },
        { path: 'train', name: 'kid-train', component: () => import('@/views/kid/TrainListView.vue') },
        { path: 'train/:id', name: 'kid-play', component: () => import('@/views/kid/TrainPlayView.vue') },
        { path: 'homework', name: 'kid-homework', component: () => import('@/views/kid/HomeworkView.vue') },
        { path: 'growth', name: 'kid-growth', component: () => import('@/views/kid/GrowthView.vue') },
        { path: 'tutor', name: 'kid-tutor', component: () => import('@/views/kid/TutorView.vue') },
      ],
    },
    {
      path: '/parent',
      component: () => import('@/views/parent/ParentLayout.vue'),
      meta: { role: 'parent' },
      children: [
        { path: '', name: 'parent-overview', component: () => import('@/views/parent/ParentOverview.vue') },
        { path: 'records', name: 'parent-records', component: () => import('@/views/parent/ParentRecords.vue') },
        { path: 'limits', name: 'parent-limits', component: () => import('@/views/parent/ParentLimits.vue') },
        { path: 'profiles', name: 'parent-profiles', component: () => import('@/views/parent/ParentProfiles.vue') },
        { path: 'ai', name: 'parent-ai', component: () => import('@/views/parent/ParentAi.vue') },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach((to) => {
  const session = useSessionStore()
  const requiredRole = to.meta.role as 'parent' | 'child' | undefined
  if (!requiredRole) return true

  if (!session.loggedIn) {
    return requiredRole === 'child' ? '/select' : '/login'
  }
  if (session.role !== requiredRole) {
    return session.role === 'child' ? '/kid' : '/parent'
  }
  return true
})

export default router
