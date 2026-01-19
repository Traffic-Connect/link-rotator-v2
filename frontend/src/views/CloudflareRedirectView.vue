<template>
  <div class="container-fluid mt-4">
    <div class="row">
      <div class="col-lg-5">
        <div class="card mb-4">
          <div class="card-header">
            <h5 class="mb-0">Cloudflare Worker Redirect</h5>
          </div>
          <div class="card-body">
            <div class="row mb-3">
              <div class="col">
                <label class="form-label">Origin URLs (one per line)</label>
                <textarea
                    class="form-control"
                    rows="5"
                    v-model="originUrlInput"
                    placeholder="https://origin.example.com"
                    :disabled="jobRunning"
                ></textarea>
              </div>
              <div class="col">
                <label class="form-label">Partner URLs (one per line)</label>
                <textarea
                    class="form-control"
                    rows="5"
                    v-model="partnerUrlInput"
                    placeholder="https://partner.example.com"
                    :disabled="jobRunning"
                ></textarea>
                <div class="form-text">Add one URL per line. Paired by order with Origin URLs.</div>
                <div v-if="pairMismatch && hasOrigins && hasPartners" class="text-danger small mt-1">
                  Counts must match (origins: {{ originCount }}, partners: {{ partnerCount }}).
                </div>
              </div>
            </div>
            <div class="mb-3">
              <label class="form-label">Bypass GEOs (comma separated)</label>
              <input
                  type="text"
                  class="form-control"
                  v-model="bypassGeos"
                  placeholder="US,CA"
                  :disabled="jobRunning"
              />
            </div>
            <div class="mb-3">
              <label class="form-label">WP paths (one per line, without domain)</label>
              <textarea
                  class="form-control"
                  rows="2"
                  v-model="wpPaths"
                  placeholder="/wp-admin"
                  :disabled="jobRunning"
              ></textarea>
            </div>
            <div class="form-check form-switch mb-2">
              <input class="form-check-input" type="checkbox" id="verifyDnsSwitch" v-model="verifyReverseDns" :disabled="jobRunning">
              <label class="form-check-label" for="verifyDnsSwitch">Verify Googlebot via reverse DNS</label>
            </div>
            <div class="form-check form-switch mb-3">
              <input class="form-check-input" type="checkbox" id="failOpenSwitch" v-model="failOpenOnDnsError" :disabled="jobRunning">
              <label class="form-check-label" for="failOpenSwitch">Fail open on DNS errors</label>
            </div>
            <div class="form-check form-switch mb-3">
              <input class="form-check-input" type="checkbox" id="treatMarkupSwitch" v-model="treatMarkupTestsAsGoogle" :disabled="jobRunning">
              <label class="form-check-label" for="treatMarkupSwitch">Allow Rich Results</label>
            </div>
            <div class="row mb-3">
              <div class="col">
                <label class="form-label">rDNS cache TTL (seconds)</label>
                <input
                    type="number"
                    min="0"
                    class="form-control"
                    v-model.number="rdnsCacheTtl"
                    :disabled="jobRunning"
                    placeholder="600"
                />
              </div>
            </div>
            <div class="d-flex gap-2">
              <button class="btn btn-primary" @click="startJob('create')" :disabled="jobRunning || !canCreate">
                <span v-if="jobRunning && currentJob?.action === 'create'" class="spinner-border spinner-border-sm me-2"></span>
                Create & Attach
              </button>
              <button class="btn btn-danger" @click="startJob('delete')" :disabled="jobRunning || !hasOrigins">
                <span v-if="jobRunning && currentJob?.action === 'delete'" class="spinner-border spinner-border-sm me-2"></span>
                Detach / Delete
              </button>
            </div>
            <p class="text-muted small mt-3 mb-0">
              One worker per domain (T6-Redirect-domain). Existing workers with the same name will be overwritten.
            </p>
          </div>
        </div>
      </div>
      <div class="col-lg-7">
        <div class="card mb-4">
          <div class="card-header d-flex justify-content-between align-items-center">
            <h5 class="mb-0">Progress</h5>
            <span class="badge bg-secondary text-uppercase">{{ currentJob?.status || 'idle' }}</span>
          </div>
          <div class="card-body">
            <div v-if="!currentJob || currentJob.status === 'idle'">
              <p class="text-muted mb-0">No active jobs.</p>
            </div>
            <div v-else>
              <div class="mb-3">
                <strong>Action:</strong> {{ formatAction(currentJob.action) }}<br>
                <strong>Progress:</strong> {{ currentJob.completed }} / {{ currentJob.total }}
              </div>
              <div class="progress mb-3" style="height: 8px;">
                <div
                    class="progress-bar"
                    role="progressbar"
                    :style="{ width: progressPercent + '%' }"
                    :aria-valuenow="progressPercent"
                    aria-valuemin="0"
                    aria-valuemax="100"
                ></div>
              </div>
              <div class="list-group">
                <div
                    v-for="item in currentJob.results"
                    :key="item.domain"
                    class="list-group-item d-flex justify-content-between align-items-center"
                >
                  <div class="flex-grow-1 me-3">
                    <strong>{{ item.domain }}</strong>
                    <div class="small text-muted mt-1">
                      <div v-if="item.message">{{ item.message }}</div>
                      <div v-if="item.errorStage" class="text-danger">Stage: {{ formatStageLabel(item.errorStage) }}</div>
                      <ul
                          v-if="visibleIssueLogs(item).length"
                          class="mb-0 mt-2 ps-3 small"
                      >
                        <li
                            v-for="log in visibleIssueLogs(item)"
                            :key="log.id"
                            :class="issueLogClass(log)"
                        >
                          <span v-if="log.timestamp" class="text-muted me-2">{{ formatLogTimestamp(log.timestamp) }}</span>
                          <span v-if="log.stage" class="me-1">[{{ formatStageLabel(log.stage) }}]</span>
                          <span>{{ log.message }}</span>
                        </li>
                      </ul>
                    </div>
                  </div>
                  <span :class="['badge flex-shrink-0', statusBadge(item.status)]">
                    {{ formatStatus(item.status) }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import apiClient from '../api/client'

const originUrlInput = ref('')
const partnerUrlInput = ref('')
const bypassGeos = ref('')
const wpPaths = ref('')
const verifyReverseDns = ref(true)
const failOpenOnDnsError = ref(true)
const rdnsCacheTtl = ref(600)
const treatMarkupTestsAsGoogle = ref(true)
const currentJob = ref(null)
const pollingTimer = ref(null)

const lineCount = (value) => {
  return (value || '')
    .split('\n')
    .map(v => v.trim())
    .filter(Boolean).length
}

const originCount = computed(() => lineCount(originUrlInput.value))
const partnerCount = computed(() => lineCount(partnerUrlInput.value))
const pairMismatch = computed(() => originCount.value !== partnerCount.value)

const jobRunning = computed(() => currentJob.value?.status === 'running')
const canCreate = computed(() =>
  originUrlInput.value.trim() &&
  partnerUrlInput.value.trim() &&
  !pairMismatch.value
)
const hasOrigins = computed(() => lineCount(originUrlInput.value) > 0)
const hasPartners = computed(() => lineCount(partnerUrlInput.value) > 0)

const progressPercent = computed(() => {
  if (!currentJob.value || currentJob.value.total === 0) return 0
  return Math.round((currentJob.value.completed / currentJob.value.total) * 100)
})

const statusBadge = (status) => {
  switch (status) {
    case 'success':
      return 'bg-success'
    case 'error':
      return 'bg-danger'
    case 'in_progress':
      return 'bg-warning text-dark'
    default:
      return 'bg-secondary'
  }
}

const formatStatus = (status) => {
  switch (status) {
    case 'success':
      return 'Done'
    case 'error':
      return 'Error'
    case 'in_progress':
      return 'Working'
    case 'pending':
      return 'Pending'
    default:
      return status
  }
}

const formatAction = (action) => {
  switch (action) {
    case 'delete':
      return 'Detach Domain / Delete Worker'
    case 'create':
    default:
      return 'Create & Attach Redirect Worker'
  }
}

const formatStageLabel = (stage) => {
  if (!stage) return 'process'
  return stage.replace(/_/g, ' ')
}

const formatLogTimestamp = (timestamp) => {
  try {
    return new Date(timestamp).toLocaleTimeString()
  } catch (error) {
    return timestamp
  }
}

const issueLogClass = (log) => {
  if (log.level === 'warning') {
    return 'text-warning'
  }
  return 'text-danger'
}

const visibleIssueLogs = (item) => {
  if (!item) {
    return []
  }

  if (Array.isArray(item.logs) && item.logs.length) {
    return item.logs.filter(log => log.level === 'warning' || log.level === 'error')
  }

  const extraLogs = []

  if (Array.isArray(item.warningMessages) && item.warningMessages.length) {
    extraLogs.push(...item.warningMessages.map((message, index) => ({
      id: `${item.domain}-warning-${index}`,
      level: 'warning',
      message
    })))
  }

  if (Array.isArray(item.errorMessages) && item.errorMessages.length) {
    extraLogs.push(...item.errorMessages.map((message, index) => ({
      id: `${item.domain}-error-${index}`,
      level: 'error',
      message
    })))
  }

  return extraLogs
}

const fetchStatus = async () => {
  try {
    const { data } = await apiClient.get('/cloudflare-redirect/status')
    currentJob.value = data.job
  } catch (error) {
    console.error('Failed to fetch job status', error)
  }
}

const startJob = async (action) => {
  if (action === 'create' && !canCreate.value) {
    return
  }

  try {
    await apiClient.post('/cloudflare-redirect/jobs', {
      action,
      originUrls: originUrlInput.value,
      partnerUrls: partnerUrlInput.value,
      config: {
        bypassGeos: bypassGeos.value,
        wpPaths: wpPaths.value,
        verifyReverseDns: verifyReverseDns.value,
        failOpenOnDnsError: failOpenOnDnsError.value,
        rdnsCacheTtl: rdnsCacheTtl.value,
        treatMarkupTestsAsGoogle: treatMarkupTestsAsGoogle.value
      }
    })
    if (action === 'create') {
      originUrlInput.value = ''
      partnerUrlInput.value = ''
    }
    await fetchStatus()
  } catch (error) {
    alert(error.response?.data?.error || 'Failed to start job')
  }
}

onMounted(() => {
  fetchStatus()
  pollingTimer.value = setInterval(fetchStatus, 5000)
})

onUnmounted(() => {
  if (pollingTimer.value) {
    clearInterval(pollingTimer.value)
  }
})
</script>
