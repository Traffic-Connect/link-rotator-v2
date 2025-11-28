import { defineStore } from 'pinia'
import apiClient from '../api/client'

export const useAuthStore = defineStore('auth', {
    state: () => ({
        user: null,
        token: localStorage.getItem('token') || null
    }),

    getters: {
        isAuthenticated: (state) => !!state.token,
        isAdmin: (state) => state.user?.role === 'admin'
    },

    actions: {
        async login(email, password) {
            try {
                const response = await apiClient.post('/auth/login', { email, password })
                this.token = response.data.token
                this.user = response.data.user
                localStorage.setItem('token', this.token)
                return response.data
            } catch (error) {
                throw error
            }
        },

        async checkAuth() {
            if (!this.token) return

            try {
                const response = await apiClient.get('/auth/me')
                this.user = response.data.user
            } catch (error) {
                this.logout()
            }
        },

        logout() {
            this.token = null
            this.user = null
            localStorage.removeItem('token')
        }
    }
})