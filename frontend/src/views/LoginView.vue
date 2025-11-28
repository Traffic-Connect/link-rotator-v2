<template>
  <div class="container">
    <div class="row justify-content-center mt-5">
      <div class="col-md-5">
        <div class="card shadow">
          <div class="card-body p-5">
            <h3 class="card-title text-center mb-4">
              <i class="bi bi-link-45deg fs-1"></i>
              <br>
              Link Rotator
            </h3>

            <div v-if="error" class="alert alert-danger" role="alert">
              <i class="bi bi-exclamation-triangle"></i> {{ error }}
            </div>

            <form @submit.prevent="handleLogin">
              <div class="mb-3">
                <label for="email" class="form-label">Email</label>
                <input
                    type="email"
                    class="form-control"
                    id="email"
                    v-model="form.email"
                    required
                    :disabled="loading"
                >
              </div>

              <div class="mb-3">
                <label for="password" class="form-label">Password</label>
                <input
                    type="password"
                    class="form-control"
                    id="password"
                    v-model="form.password"
                    required
                    :disabled="loading"
                >
              </div>

              <button
                  type="submit"
                  class="btn btn-primary w-100"
                  :disabled="loading"
              >
                <span v-if="loading" class="spinner-border spinner-border-sm me-2"></span>
                {{ loading ? 'Logging in...' : 'Login' }}
              </button>
            </form>

          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const form = ref({
  email: '',
  password: ''
})

const loading = ref(false)
const error = ref('')

const handleLogin = async () => {
  loading.value = true
  error.value = ''

  try {
    await authStore.login(form.value.email, form.value.password)
    router.push('/links')
  } catch (err) {
    error.value = err.response?.data?.error || 'Login failed. Please try again.'
  } finally {
    loading.value = false
  }
}
</script>