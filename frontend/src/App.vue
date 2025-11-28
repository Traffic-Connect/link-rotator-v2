<template>
  <div id="app">
    <Navbar v-if="authStore.isAuthenticated" />
    <router-view />
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import Navbar from './components/Navbar.vue'
import { useAuthStore } from './stores/auth'

const authStore = useAuthStore()

onMounted(() => {
  authStore.checkAuth()
})
</script>

<style>
body {
  background-color: #f8f9fa;
}
</style>