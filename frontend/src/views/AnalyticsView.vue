<template>
  <div class="container-fluid mt-4">
    <div class="row mb-4">
      <div class="col">
        <h2><i class="bi bi-graph-up"></i> Analytics Dashboard</h2>
      </div>
    </div>

    <div class="card mb-4">
      <div class="card-body">
        <div class="row align-items-center">
          <div class="col-md-3">
            <label class="form-label">Start Date</label>
            <input type="date" class="form-control" v-model="filters.startDate" @change="onDateChange">
          </div>
          <div class="col-md-3">
            <label class="form-label">End Date</label>
            <input type="date" class="form-control" v-model="filters.endDate" @change="onDateChange">
          </div>
          <div class="col-md-3">
            <label class="form-label">Period</label>
            <select class="form-select" v-model="filters.period" @change="setPeriod">
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div class="col-md-3 d-flex align-items-end">
            <button class="btn btn-primary w-100" @click="loadAnalytics">
              <i class="bi bi-arrow-clockwise"></i> Refresh
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="loading" class="text-center py-5">
      <div class="spinner-border" role="status"></div>
      <p class="mt-3">Loading analytics...</p>
    </div>

    <div v-else>
      <div class="row mb-4">
        <div class="col-md-3">
          <div class="card bg-primary text-white">
            <div class="card-body">
              <h6 class="card-subtitle mb-2">Total Clicks</h6>
              <h2 class="card-title">{{ stats.totalClicks }}</h2>
              <small>in selected period</small>
            </div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-success text-white">
            <div class="card-body">
              <h6 class="card-subtitle mb-2">Unique Links</h6>
              <h2 class="card-title">{{ stats.uniqueLinks }}</h2>
              <small>with clicks</small>
            </div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-info text-white">
            <div class="card-body">
              <h6 class="card-subtitle mb-2">Avg Clicks/Day</h6>
              <h2 class="card-title">{{ stats.avgClicksPerDay }}</h2>
              <small>daily average</small>
            </div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-warning text-white">
            <div class="card-body">
              <h6 class="card-subtitle mb-2">Peak Day</h6>
              <h2 class="card-title">{{ stats.peakClicks }}</h2>
              <small>{{ stats.peakDate }}</small>
            </div>
          </div>
        </div>
      </div>

      <div class="row mb-4">
        <div class="col-md-8">
          <div class="card">
            <div class="card-header">
              <h5 class="mb-0">Clicks Over Time</h5>
            </div>
            <div class="card-body">
              <div style="position: relative; height: 300px;">
                <canvas ref="clicksChart"></canvas>
              </div>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card">
            <div class="card-header">
              <h5 class="mb-0">Top 5 Links</h5>
            </div>
            <div class="card-body">
              <div style="position: relative; height: 300px;">
                <canvas ref="topLinksChart"></canvas>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="row mb-4">
        <div class="col-md-12">
          <div class="card">
            <div class="card-header">
              <h5 class="mb-0">Detailed Statistics</h5>
            </div>
            <div class="card-body">
              <div class="table-responsive">
                <table class="table table-hover">
                  <thead>
                  <tr>
                    <th>Link Key</th>
                    <th>Link Name</th>
                    <th>Total Clicks</th>
                    <th>Period Clicks</th>
                    <th>Redirects</th>
                    <th>Avg per Redirect</th>
                  </tr>
                  </thead>
                  <tbody>
                  <tr v-for="link in detailedStats" :key="link._id">
                    <td><code>{{ link.key }}</code></td>
                    <td>{{ link.name || '-' }}</td>
                    <td><span class="badge bg-primary">{{ link.totalClicks }}</span></td>
                    <td><span class="badge bg-info">{{ link.periodClicks }}</span></td>
                    <td>{{ link.redirectCount }}</td>
                    <td>{{ link.avgPerRedirect }}</td>
                  </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import apiClient from '../api/client'
import Chart from 'chart.js/auto'

const loading = ref(true)
const clicksChart = ref(null)
const topLinksChart = ref(null)
let clicksChartInstance = null
let topLinksChartInstance = null

const filters = ref({
  startDate: getDateDaysAgo(7),
  endDate: getTodayDate(),
  period: '7d'
})

const stats = ref({
  totalClicks: 0,
  uniqueLinks: 0,
  avgClicksPerDay: 0,
  peakClicks: 0,
  peakDate: '-'
})

const clicksData = ref([])
const topLinks = ref([])
const detailedStats = ref([])

function getTodayDate() {
  return new Date().toISOString().split('T')[0]
}

function getDateDaysAgo(days) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().split('T')[0]
}

function setPeriod() {
  const period = filters.value.period
  if (period === '7d') {
    filters.value.startDate = getDateDaysAgo(7)
    filters.value.endDate = getTodayDate()
    loadAnalytics()
  } else if (period === '30d') {
    filters.value.startDate = getDateDaysAgo(30)
    filters.value.endDate = getTodayDate()
    loadAnalytics()
  } else if (period === '90d') {
    filters.value.startDate = getDateDaysAgo(90)
    filters.value.endDate = getTodayDate()
    loadAnalytics()
  }
}

function onDateChange() {
  filters.value.period = 'custom'
  loadAnalytics()
}

async function loadAnalytics() {
  loading.value = true
  try {
    const response = await apiClient.get('/stats/analytics', {
      params: {
        startDate: filters.value.startDate,
        endDate: filters.value.endDate
      }
    })

    const data = response.data

    stats.value = {
      totalClicks: data.totalClicks || 0,
      uniqueLinks: data.uniqueLinks || 0,
      avgClicksPerDay: data.avgClicksPerDay || 0,
      peakClicks: data.peakClicks || 0,
      peakDate: data.peakDate || '-'
    }

    clicksData.value = data.clicksByDay || []
    topLinks.value = data.topLinks || []
    detailedStats.value = data.detailedStats || []

    loading.value = false

    await nextTick()
    updateCharts()
  } catch (error) {
    console.error('Failed to load analytics:', error)
    loading.value = false
  }
}

function updateCharts() {
  if (clicksChartInstance) {
    clicksChartInstance.destroy()
  }
  if (topLinksChartInstance) {
    topLinksChartInstance.destroy()
  }

  if (clicksChart.value && clicksData.value.length > 0) {
    const ctx = clicksChart.value.getContext('2d')
    clicksChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: clicksData.value.map(d => d.date),
        datasets: [{
          label: 'Clicks',
          data: clicksData.value.map(d => d.count),
          borderColor: '#0d6efd',
          backgroundColor: 'rgba(13, 110, 253, 0.1)',
          tension: 0.4,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              precision: 0
            }
          }
        }
      }
    })
  }

  if (topLinksChart.value && topLinks.value.length > 0) {
    const ctx = topLinksChart.value.getContext('2d')
    topLinksChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: topLinks.value.map(l => l.key),
        datasets: [{
          data: topLinks.value.map(l => l.clicks),
          backgroundColor: [
            '#0d6efd',
            '#198754',
            '#ffc107',
            '#dc3545',
            '#6c757d'
          ]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom'
          }
        }
      }
    })
  }
}

onMounted(() => {
  loadAnalytics()
})

onUnmounted(() => {
  if (clicksChartInstance) {
    clicksChartInstance.destroy()
  }
  if (topLinksChartInstance) {
    topLinksChartInstance.destroy()
  }
})
</script>

<style scoped>
.card {
  box-shadow: 0 0.125rem 0.25rem rgba(0, 0, 0, 0.075);
}
</style>