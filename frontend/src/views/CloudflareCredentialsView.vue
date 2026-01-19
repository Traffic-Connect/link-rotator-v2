<template>
  <div class="container-fluid mt-4">
    <div class="row">
      <div class="col-lg-7 mb-4">
        <div class="card h-100">
          <div class="card-header d-flex align-items-center justify-content-between">
            <h5 class="mb-0">Cloudflare Workers Credentials</h5>
            <button class="btn btn-outline-secondary btn-sm" @click="fetchCredentials" :disabled="loading">
              <span v-if="loading" class="spinner-border spinner-border-sm"></span>
              <span v-else><i class="bi bi-arrow-clockwise"></i></span>
            </button>
          </div>
          <div class="card-body">
            <div v-if="loading" class="text-center py-5">
              <div class="spinner-border"></div>
            </div>
            <div v-else-if="credentials.length === 0" class="text-center py-5 text-muted">
              <i class="bi bi-cloud-slash fs-1"></i>
              <p class="mt-3">No credentials saved yet.</p>
            </div>
            <div v-else class="table-responsive">
              <table class="table align-middle">
                <thead>
                <tr>
                  <th>Label</th>
                  <th>Login</th>
                  <th>Account</th>
                  <th>Verified</th>
                  <th class="text-end">Actions</th>
                </tr>
                </thead>
                <tbody>
                <tr v-for="credential in credentials" :key="credential._id">
                  <td>
                    <strong>{{ credential.label }}</strong>
                  </td>
                  <td>
                    <code>{{ credential.login }}</code>
                  </td>
                  <td>
                    <div class="d-flex flex-column">
                      <span>{{ credential.accountName || '-' }}</span>
                      <small class="text-muted">{{ credential.accountId }}</small>
                    </div>
                  </td>
                  <td>
                    <span class="badge bg-light text-dark">
                      {{ formatDate(credential.lastVerifiedAt || credential.updatedAt) }}
                    </span>
                  </td>
                  <td class="text-end">
                    <button
                        class="btn btn-sm btn-outline-danger"
                        @click="deleteCredential(credential._id)"
                    >
                      <i class="bi bi-trash"></i>
                    </button>
                  </td>
                </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      <div class="col-lg-5 mb-4">
        <div class="card">
          <div class="card-header">
            <h5 class="mb-0">Add New Credentials</h5>
          </div>
          <div class="card-body">
            <form @submit.prevent="createCredential">
              <div class="mb-3">
                <label class="form-label">Label</label>
                <input type="text" class="form-control" v-model="form.label" placeholder="e.g. Main Account">
              </div>
              <div class="mb-3">
                <label class="form-label">Login / Email</label>
                <input type="text" class="form-control" v-model="form.login" required>
              </div>
              <div class="mb-3">
                <label class="form-label">Password</label>
                <input type="password" class="form-control" v-model="form.password" required>
              </div>
              <div class="mb-3">
                <label class="form-label">API Token</label>
                <input type="text" class="form-control" v-model="form.apiToken" required>
                <small class="text-muted">Requires a token with Workers and Zones:Read permissions.</small>
              </div>
              <div v-if="feedback.message" :class="['alert', feedback.type === 'error' ? 'alert-danger' : 'alert-success']">
                {{ feedback.message }}
              </div>
              <div class="d-grid">
                <button class="btn btn-primary" type="submit" :disabled="saving">
                  <span v-if="saving" class="spinner-border spinner-border-sm me-2"></span>
                  {{ saving ? 'Validating...' : 'Save' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import apiClient from '../api/client'

const credentials = ref([])
const loading = ref(false)
const saving = ref(false)
const feedback = ref({ message: '', type: '' })

const form = ref({
  label: '',
  login: '',
  password: '',
  apiToken: ''
})

const fetchCredentials = async () => {
  loading.value = true
  try {
    const { data } = await apiClient.get('/cloudflare/credentials')
    credentials.value = data.credentials || []
  } catch (error) {
    feedback.value = { message: error.response?.data?.error || 'Failed to load credentials', type: 'error' }
  } finally {
    loading.value = false
  }
}

const createCredential = async () => {
  saving.value = true
  feedback.value = { message: '', type: '' }
  try {
    await apiClient.post('/cloudflare/credentials', {
      label: form.value.label,
      login: form.value.login,
      password: form.value.password,
      apiToken: form.value.apiToken
    })
    feedback.value = { message: 'Credentials saved and verified', type: 'success' }
    form.value = { label: '', login: '', password: '', apiToken: '' }
    await fetchCredentials()
  } catch (error) {
    feedback.value = { message: error.response?.data?.error || 'Failed to create credential', type: 'error' }
  } finally {
    saving.value = false
  }
}

const deleteCredential = async (id) => {
  if (!confirm('Delete these credentials?')) {
    return
  }
  try {
    await apiClient.delete(`/cloudflare/credentials/${id}`)
    await fetchCredentials()
  } catch (error) {
    feedback.value = { message: error.response?.data?.error || 'Failed to delete credential', type: 'error' }
  }
}

const formatDate = (value) => {
  if (!value) {
    return '-'
  }
  return new Date(value).toLocaleString('uk-UA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

onMounted(() => {
  fetchCredentials()
})
</script>
