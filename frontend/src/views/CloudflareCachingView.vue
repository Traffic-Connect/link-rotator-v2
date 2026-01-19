<template>
  <div class="container-fluid mt-4">
    <div class="row">
      <div class="col-lg-5">
        <div class="card mb-4">
          <div class="card-header">
            <h5 class="mb-0">Cloudflare Caching</h5>
          </div>
          <div class="card-body">
            <div class="mb-3">
              <label class="form-label">Domains (one per line)</label>
              <textarea
                  class="form-control"
                  rows="10"
                  v-model="domainsInput"
                  placeholder="example.com&#10;another-domain.com"
                  :disabled="jobRunning"
              ></textarea>
            </div>
            <div class="d-flex gap-2">
              <button class="btn btn-primary" @click="startJob('create')" :disabled="jobRunning || !domainsInput.trim()">
                <span v-if="jobRunning && currentJob?.action === 'create'" class="spinner-border spinner-border-sm me-2"></span>
                Create Cache Rules
              </button>
              <button class="btn btn-danger" @click="startJob('purge')" :disabled="jobRunning || !domainsInput.trim()">
                <span v-if="jobRunning && currentJob?.action === 'purge'" class="spinner-border spinner-border-sm me-2"></span>
                Purge Cache
              </button>
              <button class="btn btn-warning text-dark" @click="startJob('disable')" :disabled="jobRunning || !domainsInput.trim()">
                <span v-if="jobRunning && currentJob?.action === 'disable'" class="spinner-border spinner-border-sm me-2"></span>
                Disable Cache (T6)
              </button>
            </div>
            <p class="text-muted small mt-3 mb-0">
              Only one job can run at a time. Progress will remain visible while the job is running.
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

const domainsInput = ref('')
const currentJob = ref(null)
const pollingTimer = ref(null)

const jobRunning = computed(() => currentJob.value?.status === 'running')
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
    case 'purge':
      return 'Purge Cache'
    case 'disable':
      return 'Disable Cache (T6 Rules)'
    case 'create':
    default:
      return 'Create Cache Rules'
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
    const { data } = await apiClient.get('/cloudflare-cache/status')
    currentJob.value = data.job
  } catch (error) {
    console.error('Failed to fetch job status', error)
  }
}

const startJob = async (action) => {
  try {
    await apiClient.post('/cloudflare-cache/jobs', {
      action,
      domains: domainsInput.value
    })
    domainsInput.value = ''
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
