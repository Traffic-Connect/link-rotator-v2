<template>
  <nav class="navbar navbar-expand-lg navbar-dark bg-dark">
    <div class="container-fluid">
      <router-link class="navbar-brand" to="/links">
        <i class="bi bi-link-45deg"></i> Link Rotator
      </router-link>

      <button
          class="navbar-toggler"
          type="button"
          data-bs-toggle="collapse"
          data-bs-target="#navbarNav"
      >
        <span class="navbar-toggler-icon"></span>
      </button>

      <div class="collapse navbar-collapse" id="navbarNav">
        <ul class="navbar-nav me-auto">
          <li class="nav-item">
            <router-link class="nav-link" to="/links">
              <i class="bi bi-list-ul"></i> Links
            </router-link>
          </li>
          <li class="nav-item" v-if="authStore.isAdmin">
            <router-link class="nav-link" to="/analytics">
              <i class="bi bi-graph-up"></i> Analytics
            </router-link>
          </li>
          <li class="nav-item" v-if="authStore.isAdmin">
            <router-link class="nav-link" to="/users">
              <i class="bi bi-people"></i> Users
            </router-link>
          </li>
        </ul>

        <ul class="navbar-nav">
          <li class="nav-item dropdown" @click.stop>
            <a
                class="nav-link dropdown-toggle"
                href="#"
                @click.prevent="toggleDropdown"
                :class="{ show: isDropdownOpen }"
            >
              <i class="bi bi-person-circle"></i> {{ authStore.user?.name }}
            </a>
            <ul
                class="dropdown-menu dropdown-menu-end"
                :class="{ show: isDropdownOpen }"
                @click.stop
            >
              <li>
                <span class="dropdown-item-text small text-muted">
                  {{ authStore.user?.email }}
                </span>
              </li>
              <li><hr class="dropdown-divider"></li>
              <li>
                <a class="dropdown-item" href="#" @click.prevent="handleLogout">
                  <i class="bi bi-box-arrow-right"></i> Logout
                </a>
              </li>
            </ul>
          </li>
        </ul>
      </div>
    </div>
  </nav>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useRouter } from 'vue-router'

const authStore = useAuthStore()
const router = useRouter()
const isDropdownOpen = ref(false)

const toggleDropdown = () => {
  isDropdownOpen.value = !isDropdownOpen.value
}

const closeDropdown = () => {
  isDropdownOpen.value = false
}

const handleClickOutside = (event) => {
  const dropdown = event.target.closest('.dropdown')
  if (!dropdown) {
    closeDropdown()
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})

const handleLogout = async () => {
  try {
    closeDropdown()
    authStore.logout()
    await router.push('/login')
  } catch (error) {
    console.error('Logout error:', error)
    router.push('/login')
  }
}
</script>

<style scoped>
.dropdown {
  position: relative;
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  left: auto;
  z-index: 1050;
  min-width: 200px;
  margin-top: 0.125rem;
}

.dropdown-menu.show {
  display: block;
}

.dropdown-toggle::after {
  margin-left: 0.255em;
  vertical-align: 0.255em;
  content: "";
  border-top: 0.3em solid;
  border-right: 0.3em solid transparent;
  border-bottom: 0;
  border-left: 0.3em solid transparent;
}

.nav-link.router-link-active {
  font-weight: 500;
}
</style>