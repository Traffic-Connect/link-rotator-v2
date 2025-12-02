<template>
  <div>
    <div class="container-fluid mt-4">
      <div class="row mb-4">
        <div class="col">
          <h2><i class="bi bi-link-45deg"></i> Links Dashboard</h2>
        </div>
        <div class="col-auto">
          <button class="btn btn-success me-2" data-bs-toggle="modal" data-bs-target="#exportCsvModal">
            <i class="bi bi-download"></i> Export CSV
          </button>
          <button class="btn btn-primary" data-bs-toggle="modal" data-bs-target="#createLinkModal">
            <i class="bi bi-plus-lg"></i> Create Link
          </button>
        </div>
      </div>

      <div class="card mb-4">
        <div class="card-body">
          <div class="row align-items-center">
            <div class="col-md-4">
              <label class="form-label me-2">Date Filter:</label>
              <div class="input-group">
                <input
                    type="date"
                    class="form-control"
                    v-model="dateFilter"
                    @change="fetchLinks"
                >
                <button class="btn btn-outline-secondary" @click="setToday">
                  Today
                </button>
              </div>
            </div>
            <div class="col-md-8 text-end">
              <small class="text-muted">
                Showing statistics for: <strong>{{ formatDateFull(dateFilter) }}</strong>
              </small>
            </div>
          </div>
        </div>
      </div>

      <div class="row mb-4">
        <div class="col-md-3">
          <div class="card bg-primary text-white">
            <div class="card-body">
              <h6 class="card-subtitle mb-2">Total Links</h6>
              <h2 class="card-title">{{ stats.totalLinks }}</h2>
            </div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-success text-white">
            <div class="card-body">
              <h6 class="card-subtitle mb-2">Total Clicks (All Time)</h6>
              <h2 class="card-title">{{ stats.totalClicks }}</h2>
            </div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-info text-white">
            <div class="card-body">
              <h6 class="card-subtitle mb-2">Clicks ({{ formatDateShort(dateFilter) }})</h6>
              <h2 class="card-title">{{ stats.dailyClicks }}</h2>
            </div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-warning text-white">
            <div class="card-body">
              <h6 class="card-subtitle mb-2">Active Links</h6>
              <h2 class="card-title">{{ stats.activeLinks }}</h2>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h5 class="mb-0">All Links</h5>
        </div>
        <div class="card-body">
          <div v-if="loading" class="text-center py-5">
            <div class="spinner-border" role="status"></div>
          </div>

          <div v-else-if="links.length === 0" class="text-center py-5 text-muted">
            <i class="bi bi-link-45deg fs-1"></i>
            <p>No links yet. Create your first link!</p>
          </div>

          <div v-else class="table-responsive">
            <table class="table table-hover">
              <thead>
              <tr>
                <th>Key</th>
                <th>Name</th>
                <th>Redirects</th>
                <th>Total Clicks</th>
                <th>{{ formatDateShort(dateFilter) }}</th>
                <th>Actions</th>
              </tr>
              </thead>
              <tbody>
              <tr v-for="link in links" :key="link._id">
                <td>
                  <code>{{ link.key }}</code>
                  <br>
                  <small class="text-muted">
                    <a :href="getRedirectUrl(link.key)" target="_blank">
                      {{ getRedirectUrl(link.key) }}
                    </a>
                  </small>
                </td>
                <td>{{ link.name || '-' }}</td>
                <td>{{ link.redirects?.length || 0 }}</td>
                <td><span class="badge bg-primary">{{ link.totalClicks || 0 }}</span></td>
                <td><span class="badge bg-info">{{ link.dailyClicks || 0 }}</span></td>
                <td>
                  <button class="btn btn-sm btn-success" @click="copyLink(link.key)" title="Copy Link">
                    <i class="bi bi-clipboard"></i>
                  </button>
                  <button class="btn btn-sm btn-warning" @click="openEditModal(link)" title="Edit">
                    <i class="bi bi-pencil"></i>
                  </button>
                  <button class="btn btn-sm btn-danger" @click="deleteLink(link._id)" title="Delete">
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

    <div class="toast-container position-fixed top-0 end-0 p-3">
      <div class="toast" ref="toast" role="alert">
        <div class="toast-header">
          <strong class="me-auto">Success</strong>
          <button type="button" class="btn-close" data-bs-dismiss="toast"></button>
        </div>
        <div class="toast-body">
          {{ toastMessage }}
        </div>
      </div>
    </div>

    <div class="modal fade" id="exportCsvModal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Export to CSV</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">Start Date</label>
              <input type="date" class="form-control" v-model="exportData.startDate" required>
            </div>
            <div class="mb-3">
              <label class="form-label">End Date</label>
              <input type="date" class="form-control" v-model="exportData.endDate" required>
            </div>
            <div class="alert alert-info mb-0">
              <small>
                <i class="bi bi-info-circle"></i> Export will include all links with clicks data for the selected period.
              </small>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-success" @click="exportCsv" :disabled="exporting">
              <span v-if="exporting" class="spinner-border spinner-border-sm me-2"></span>
              <i v-else class="bi bi-download"></i>
              {{ exporting ? 'Exporting...' : 'Export' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="modal fade" id="createLinkModal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Create New Link</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <form @submit.prevent="createLink">
            <div class="modal-body">
              <div class="mb-3">
                <label class="form-label">Key (unique identifier)</label>
                <input type="text" class="form-control" v-model="newLink.key" required>
                <small class="text-muted">Will be: /api/links/r/{{ newLink.key }}</small>
              </div>

              <div class="mb-3">
                <label class="form-label">Name (optional)</label>
                <input type="text" class="form-control" v-model="newLink.name">
              </div>

              <div class="mb-3">
                <label class="form-label">Redirect URLs (one per line)</label>
                <textarea
                    class="form-control"
                    rows="5"
                    v-model="newLink.redirectsText"
                    placeholder="https://example.com/page1&#10;https://example.com/page2&#10;https://example.com/page3"
                    required
                ></textarea>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="submit" class="btn btn-primary">Create Link</button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <div class="modal fade" id="editLinkModal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Edit Link</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <form @submit.prevent="updateLink">
            <div class="modal-body">
              <div class="mb-3">
                <label class="form-label">Key</label>
                <input type="text" class="form-control" v-model="editingLink.key" required>
              </div>

              <div class="mb-3">
                <label class="form-label">Name (optional)</label>
                <input type="text" class="form-control" v-model="editingLink.name">
              </div>

              <div class="mb-3">
                <label class="form-label">Redirect URLs (one per line)</label>
                <textarea
                    class="form-control"
                    rows="5"
                    v-model="editingLink.redirectsText"
                    required
                ></textarea>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="submit" class="btn btn-primary">Save Changes</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import apiClient from '../api/client'
import { Modal, Toast } from 'bootstrap'

const links = ref([])
const loading = ref(true)
const dateFilter = ref(getTodayDate())
const exporting = ref(false)

const stats = ref({
  totalLinks: 0,
  totalClicks: 0,
  dailyClicks: 0,
  activeLinks: 0
})

const newLink = ref({
  key: '',
  name: '',
  redirectsText: ''
})

const editingLink = ref({
  _id: '',
  key: '',
  name: '',
  redirectsText: ''
})

const exportData = ref({
  startDate: getFirstDayOfMonth(),
  endDate: getTodayDate()
})

const toastMessage = ref('')
const toast = ref(null)

function getTodayDate() {
  const today = new Date()
  return today.toISOString().split('T')[0]
}

function getFirstDayOfMonth() {
  const date = new Date()
  date.setDate(1)
  return date.toISOString().split('T')[0]
}

function setToday() {
  dateFilter.value = getTodayDate()
  fetchLinks()
}

const fetchLinks = async () => {
  loading.value = true
  try {
    const response = await apiClient.get('/links', {
      params: { date: dateFilter.value }
    })

    links.value = response.data.links || []

    stats.value = {
      totalLinks: links.value.length,
      totalClicks: links.value.reduce((sum, link) => sum + (link.totalClicks || 0), 0),
      dailyClicks: response.data.totalClicks || 0,
      activeLinks: links.value.filter(l => (l.totalClicks || 0) > 0).length
    }
  } catch (error) {
    console.error('Failed to fetch links:', error)
  } finally {
    loading.value = false
  }
}

const exportCsv = async () => {
  if (!exportData.value.startDate || !exportData.value.endDate) {
    alert('Please select both start and end dates')
    return
  }

  if (new Date(exportData.value.startDate) > new Date(exportData.value.endDate)) {
    alert('Start date must be before end date')
    return
  }

  exporting.value = true

  try {
    const response = await apiClient.get('/links/export/csv', {
      params: {
        startDate: exportData.value.startDate,
        endDate: exportData.value.endDate
      },
      responseType: 'blob'
    })

    const blob = new Blob([response.data], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `links_export_${exportData.value.startDate}_${exportData.value.endDate}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)

    const modalEl = document.getElementById('exportCsvModal')
    const modal = Modal.getInstance(modalEl)
    if (modal) {
      modal.hide()
    }

    const backdrop = document.querySelector('.modal-backdrop')
    if (backdrop) {
      backdrop.remove()
    }

    document.body.classList.remove('modal-open')
    document.body.style.removeProperty('overflow')
    document.body.style.removeProperty('padding-right')

    showToast('CSV exported successfully!')
  } catch (error) {
    console.error('Export failed:', error)
    alert('Failed to export CSV')
  } finally {
    exporting.value = false
  }
}

const createLink = async () => {
  try {
    const redirects = newLink.value.redirectsText
        .split('\n')
        .map(url => url.trim())
        .filter(url => url.length > 0)

    await apiClient.post('/links', {
      key: newLink.value.key,
      name: newLink.value.name,
      redirects
    })

    const modalEl = document.getElementById('createLinkModal')
    const modal = Modal.getInstance(modalEl)
    if (modal) {
      modal.hide()
    }

    const backdrop = document.querySelector('.modal-backdrop')
    if (backdrop) {
      backdrop.remove()
    }

    document.body.classList.remove('modal-open')
    document.body.style.removeProperty('overflow')
    document.body.style.removeProperty('padding-right')

    newLink.value = { key: '', name: '', redirectsText: '' }

    await fetchLinks()
    showToast('Link created successfully!')
  } catch (error) {
    alert(error.response?.data?.error || 'Failed to create link')
  }
}

const openEditModal = (link) => {
  editingLink.value = {
    _id: link._id,
    key: link.key,
    name: link.name || '',
    redirectsText: link.redirects?.map(r => r.url).join('\n') || ''
  }

  const modal = new Modal(document.getElementById('editLinkModal'))
  modal.show()
}

const updateLink = async () => {
  try {
    const redirects = editingLink.value.redirectsText
        .split('\n')
        .map(url => url.trim())
        .filter(url => url.length > 0)

    await apiClient.put(`/links/${editingLink.value._id}`, {
      key: editingLink.value.key,
      name: editingLink.value.name,
      redirects
    })

    const modal = Modal.getInstance(document.getElementById('editLinkModal'))
    modal.hide()

    await fetchLinks()
    showToast('Link updated successfully!')
  } catch (error) {
    alert(error.response?.data?.error || 'Failed to update link')
  }
}

const deleteLink = async (id) => {
  if (!confirm('Are you sure you want to delete this link?')) return

  try {
    await apiClient.delete(`/links/${id}`)
    await fetchLinks()
    showToast('Link deleted successfully!')
  } catch (error) {
    alert('Failed to delete link')
  }
}

const copyLink = (key) => {
  const url = getRedirectUrl(key)
  navigator.clipboard.writeText(url).then(() => {
    showToast('Link copied to clipboard!')
  }).catch(() => {
    alert('Failed to copy link')
  })
}

const getRedirectUrl = (key) => {
  return `${window.location.origin}/api/links/r/${key}`
}

const formatDateShort = (date) => {
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const formatDateFull = (date) => {
  return new Date(date).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

const showToast = (message) => {
  toastMessage.value = message
  const toastEl = new Toast(toast.value)
  toastEl.show()
}

onMounted(() => {
  fetchLinks()
})
</script>

<style scoped>
.toast-container {
  z-index: 9999;
}
</style>