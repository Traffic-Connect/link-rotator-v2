import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
    history: createWebHistory(),
    routes: [
        {
            path: '/login',
            name: 'Login',
            component: () => import('../views/LoginView.vue'),
            meta: { guest: true }
        },
        {
            path: '/',
            redirect: '/links'
        },
        {
            path: '/links',
            name: 'Links',
            component: () => import('../views/LinksView.vue'),
            meta: { requiresAuth: true }
        },
        {
            path: '/analytics',
            name: 'Analytics',
            component: () => import('../views/AnalyticsView.vue'),
            meta: { requiresAuth: true, requiresAdmin: true }
        },
        {
            path: '/users',
            name: 'Users',
            component: () => import('../views/UsersView.vue'),
            meta: { requiresAuth: true, requiresAdmin: true }
        }
    ]
})

router.beforeEach(async (to, from, next) => {
    const authStore = useAuthStore()

    if (to.meta.requiresAuth || to.meta.requiresAdmin) {
        if (!authStore.user && authStore.token) {
            await authStore.checkAuth()
        }
    }

    if (to.meta.requiresAuth && !authStore.isAuthenticated) {
        next('/login')
    } else if (to.meta.guest && authStore.isAuthenticated) {
        next('/links')
    } else if (to.meta.requiresAdmin && !authStore.isAdmin) {
        next('/links')
    } else {
        next()
    }
})

export default router