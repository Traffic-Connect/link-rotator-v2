<template>
  <div class="container-fluid mt-4">
    <div class="row align-items-center mb-4">
      <div class="col">
        <h2 class="mb-1">
          <i class="bi bi-diagram-3"></i>
          Subdomain Manager
        </h2>
        <p class="text-muted mb-0">
          Quickly create, review and maintain Cloudflare subdomains mirrored from existing domains.
        </p>
      </div>
      <div class="col-auto d-flex gap-2">
        <button class="btn btn-outline-secondary" @click="fetchSubdomains" :disabled="loading">
          <span v-if="loading" class="spinner-border spinner-border-sm me-2"></span>
          Refresh
        </button>
        <button class="btn btn-primary" @click="toggleCreateForm">
          <i class="bi" :class="showCreateForm ? 'bi-dash-lg' : 'bi-plus-lg'"></i>
          {{ showCreateForm ? 'Hide form' : 'Create subdomain' }}
        </button>
      </div>
    </div>

    <transition name="fade">
      <div v-if="showCreateForm" class="card shadow-sm mb-4">
        <div class="card-header d-flex justify-content-between align-items-center">
          <h5 class="mb-0">New Subdomain</h5>
          <small class="text-muted">One subdomain · multiple domains</small>
        </div>
        <div class="card-body">
          <div v-if="createError" class="alert alert-danger">{{ createError }}</div>
          <form @submit.prevent="createSubdomains" class="row g-3">
            <div class="col-lg-4">
              <label class="form-label">Subdomain</label>
              <div class="input-group">
                <span class="input-group-text">https://</span>
                <input
                    type="text"
                    class="form-control"
                    placeholder="promo"
                    v-model="createForm.subdomain"
                    required
                >
              </div>
              <div class="form-text">
                Letters, numbers, hyphen. No dots or spaces.
              </div>
            </div>
            <div class="col-lg-8">
              <label class="form-label">Domains (one per line)</label>
              <textarea
                  class="form-control"
                  rows="5"
                  placeholder="example.com&#10;another-domain.com"
                  v-model="createForm.domains"
                  required
              ></textarea>
              <div class="form-text">
                You can paste URLs — we will extract root domains automatically.
              </div>
            </div>
            <div class="col-12 d-flex justify-content-end">
              <button type="button" class="btn btn-link text-muted me-2" @click="resetCreateForm" :disabled="creating">
                Clear
              </button>
              <button type="submit" class="btn btn-primary" :disabled="creating">
                <span v-if="creating" class="spinner-border spinner-border-sm me-2"></span>
                Create
              </button>
            </div>
          </form>
        </div>
      </div>
    </transition>

    <div class="card shadow-sm">
      <div class="card-header d-flex flex-wrap justify-content-between align-items-center gap-3">
        <div>
          <h5 class="mb-0">Managed Subdomains</h5>
          <small class="text-muted">Click header to sort by Subdomain or Domain</small>
        </div>
        <div class="d-flex gap-2">
          <button
              class="btn btn-outline-danger"
              :disabled="!hasSelection || deletingBulk"
              @click="bulkDelete"
          >
            <span v-if="deletingBulk" class="spinner-border spinner-border-sm me-2"></span>
            Delete selected ({{ selectedIds.length }})
          </button>
        </div>
      </div>
      <div class="card-body p-0">
        <div v-if="loading" class="text-center py-5">
          <div class="spinner-border"></div>
          <p class="text-muted mt-3 mb-0">Loading subdomains...</p>
        </div>
        <div v-else-if="sortedSubdomains.length === 0" class="text-center py-5">
          <i class="bi bi-cloud-plus display-5 text-muted"></i>
          <p class="mt-3 mb-1">No subdomains yet</p>
          <p class="text-muted">Create your first subdomain to see it here.</p>
        </div>
        <div v-else class="table-responsive">
          <table class="table align-middle mb-0 table-hover">
            <thead class="table-light">
            <tr>
              <th style="width: 40px;">
                <input
                    class="form-check-input"
                    type="checkbox"
                    :checked="allSelected"
                    @change="toggleSelectAll"
                >
              </th>
              <th class="sortable" @click="setSort('subdomain')">
                Subdomain
                <i class="bi ms-1" :class="sortIcon('subdomain')"></i>
              </th>
              <th class="sortable" @click="setSort('domain')">
                Domain
                <i class="bi ms-1" :class="sortIcon('domain')"></i>
              </th>
              <th>FQDN</th>
              <th>DNS Type</th>
              <th>Created</th>
              <th class="text-end">Actions</th>
            </tr>
            </thead>
            <tbody>
            <tr v-for="record in sortedSubdomains" :key="record._id">
              <td>
                <input
                    class="form-check-input"
                    type="checkbox"
                    :value="record._id"
                    :checked="selectedIds.includes(record._id)"
                    @change="toggleSelection(record._id)"
                >
              </td>
              <td>
                <strong>{{ record.subdomain }}</strong>
                <div class="small text-muted">proxied: {{ record.proxied ? 'yes' : 'no' }}</div>
              </td>
              <td>{{ record.domain }}</td>
              <td>
                <code class="text-break">{{ record.fqdn }}</code>
              </td>
              <td>
                <span class="badge bg-dark">{{ record.dnsRecordType }}</span>
              </td>
              <td>{{ formatDate(record.createdAt) }}</td>
              <td class="text-end">
                <div class="btn-group">
                  <button
                      class="btn btn-sm btn-outline-primary"
                      title="Rename subdomain"
                      @click="openEditModal(record)"
                  >
                    <i class="bi bi-pencil"></i>
                  </button>
                  <button
                      class="btn btn-sm btn-outline-danger"
                      title="Delete"
                      @click="deleteSubdomain(record)"
                  >
                    <i class="bi bi-trash"></i>
                  </button>
                </div>
              </td>
            </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="toast-container position-fixed top-0 end-0 p-3">
      <div class="toast" ref="toastRef" role="alert" aria-live="assertive" aria-atomic="true">
        <div class="toast-header">
          <span class="badge me-2" :class="toastVariantClass">{{ toastType.toUpperCase() }}</span>
          <strong class="me-auto">Subdomains</strong>
          <small>{{ new Date().toLocaleTimeString() }}</small>
          <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
        <div class="toast-body">
          {{ toastMessage }}
        </div>
      </div>
    </div>

    <div class="modal fade" tabindex="-1" ref="editModalRef">
      <div class="modal-dialog">
        <form class="modal-content" @submit.prevent="updateSubdomain">
          <div class="modal-header">
            <h5 class="modal-title">Rename subdomain</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div v-if="editError" class="alert alert-danger">{{ editError }}</div>
            <div class="mb-3">
              <label class="form-label">Current domain</label>
              <input type="text" class="form-control" :value="`${editForm.subdomainPreview}.${editForm.domain}`" disabled>
            </div>
            <div class="mb-3">
              <label class="form-label">New subdomain</label>
              <input type="text" class="form-control" v-model="editForm.subdomain" required>
              <div class="form-text">This will recreate the DNS record in Cloudflare.</div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-link text-muted" data-bs-dismiss="modal">Cancel</button>
            <button type="submit" class="btn btn-primary" :disabled="updating">
              <span v-if="updating" class="spinner-border spinner-border-sm me-2"></span>
              Save changes
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import apiClient from '../api/client'
import { Modal, Toast } from 'bootstrap'

const subdomains = ref([])
const loading = ref(false)
const showCreateForm = ref(false)
const creating = ref(false)
const createError = ref('')
const createForm = ref({
  subdomain: '',
  domains: ''
})

const sortKey = ref('createdAt')
const sortOrder = ref('desc')
const selectedIds = ref([])
const deletingBulk = ref(false)

const toastRef = ref(null)
const toastMessage = ref('')
const toastType = ref('success')
let toastInstance = null

const editModalRef = ref(null)
let editModal = null
const editForm = ref({
  id: '',
  subdomain: '',
  subdomainPreview: '',
  domain: ''
})
const updating = ref(false)
const editError = ref('')

const toggleCreateForm = () => {
  showCreateForm.value = !showCreateForm.value
}

const resetCreateForm = () => {
  createForm.value = { subdomain: '', domains: '' }
  createError.value = ''
}

const fetchSubdomains = async () => {
  loading.value = true
  try {
    const { data } = await apiClient.get('/subdomains')
    subdomains.value = data.subdomains || []
    selectedIds.value = []
  } catch (error) {
    console.error('Failed to fetch subdomains', error)
  } finally {
    loading.value = false
  }
}

const createSubdomains = async () => {
  createError.value = ''
  creating.value = true
  try {
    await apiClient.post('/subdomains', {
      subdomain: createForm.value.subdomain,
      domains: createForm.value.domains
    })
    showToast('Subdomains created successfully')
    resetCreateForm()
    await fetchSubdomains()
  } catch (error) {
    createError.value = error.response?.data?.error
        || error.response?.data?.errors?.[0]?.msg
        || 'Failed to create subdomains'
  } finally {
    creating.value = false
  }
}

const toggleSelection = (id) => {
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter(item => item !== id)
  } else {
    selectedIds.value = [...selectedIds.value, id]
  }
}

const toggleSelectAll = (event) => {
  if (event.target.checked) {
    selectedIds.value = subdomains.value.map(item => item._id)
  } else {
    selectedIds.value = []
  }
}

const hasSelection = computed(() => selectedIds.value.length > 0)
const allSelected = computed(() =>
    subdomains.value.length > 0 &&
    selectedIds.value.length === subdomains.value.length
)

const setSort = (key) => {
  if (sortKey.value === key) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortOrder.value = 'asc'
  }
}

const sortIcon = (key) => {
  if (sortKey.value !== key) {
    return 'bi-arrow-down-up text-muted'
  }
  return sortOrder.value === 'asc' ? 'bi-arrow-up' : 'bi-arrow-down'
}

const sortedSubdomains = computed(() => {
  const list = [...subdomains.value]
  list.sort((a, b) => {
    let left = a[sortKey.value]
    let right = b[sortKey.value]

    if (typeof left === 'string') {
      left = left.toLowerCase()
    }
    if (typeof right === 'string') {
      right = right.toLowerCase()
    }

    if (left < right) return sortOrder.value === 'asc' ? -1 : 1
    if (left > right) return sortOrder.value === 'asc' ? 1 : -1
    return 0
  })
  return list
})

const formatDate = (value) => {
  if (!value) return '-'
  return new Date(value).toLocaleString('uk-UA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const showToast = (message, type = 'success') => {
  toastMessage.value = message
  toastType.value = type
  if (toastInstance) {
    toastInstance.hide()
  }
  toastInstance = new Toast(toastRef.value)
  toastInstance.show()
}

const toastVariantClass = computed(() => {
  return toastType.value === 'success' ? 'bg-success' : 'bg-danger'
})

const openEditModal = (record) => {
  editForm.value = {
    id: record._id,
    subdomain: record.subdomain,
    subdomainPreview: record.subdomain,
    domain: record.domain
  }
  editError.value = ''
  if (!editModal && editModalRef.value) {
    editModal = new Modal(editModalRef.value, { backdrop: 'static' })
  }
  editModal?.show()
}

const updateSubdomain = async () => {
  if (!editForm.value.id) {
    return
  }
  updating.value = true
  editError.value = ''
  try {
    await apiClient.put(`/subdomains/${editForm.value.id}`, {
      subdomain: editForm.value.subdomain
    })
    showToast('Subdomain updated')
    editModal?.hide()
    await fetchSubdomains()
  } catch (error) {
    editError.value = error.response?.data?.error
        || error.response?.data?.errors?.[0]?.msg
        || 'Failed to update subdomain'
  } finally {
    updating.value = false
  }
}

const deleteSubdomain = async (record) => {
  if (!confirm(`Delete ${record.fqdn}?`)) {
    return
  }
  try {
    await apiClient.delete(`/subdomains/${record._id}`)
    showToast('Subdomain deleted', 'success')
    await fetchSubdomains()
  } catch (error) {
    showToast(error.response?.data?.error || 'Failed to delete subdomain', 'error')
  }
}

const bulkDelete = async () => {
  if (!hasSelection.value) {
    return
  }
  if (!confirm(`Delete ${selectedIds.value.length} selected subdomains?`)) {
    return
  }
  deletingBulk.value = true
  try {
    await apiClient.post('/subdomains/bulk-delete', { ids: selectedIds.value })
    selectedIds.value = []
    showToast('Selected subdomains deleted')
    await fetchSubdomains()
  } catch (error) {
    showToast(error.response?.data?.error || 'Failed to delete selected subdomains', 'error')
  } finally {
    deletingBulk.value = false
  }
}

onMounted(async () => {
  await fetchSubdomains()
  if (toastRef.value) {
    toastInstance = new Toast(toastRef.value)
  }
  if (editModalRef.value) {
    editModal = new Modal(editModalRef.value, { backdrop: 'static' })
  }
})
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.sortable {
  cursor: pointer;
  user-select: none;
}

.sortable:hover {
  color: var(--bs-primary);
}

code {
  font-size: 0.9rem;
}
</style>
