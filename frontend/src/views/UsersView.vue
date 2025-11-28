<template>
  <div class="container-fluid mt-4">
    <!-- Header -->
    <div class="row mb-4">
      <div class="col">
        <h2><i class="bi bi-people"></i> Users Management</h2>
      </div>
      <div class="col-auto">
        <button class="btn btn-primary" data-bs-toggle="modal" data-bs-target="#createUserModal">
          <i class="bi bi-plus-lg"></i> Create User
        </button>
      </div>
    </div>

    <!-- Users Table -->
    <div class="card">
      <div class="card-header">
        <h5 class="mb-0">All Users</h5>
      </div>
      <div class="card-body">
        <div v-if="loading" class="text-center py-5">
          <div class="spinner-border" role="status"></div>
        </div>

        <div v-else class="table-responsive">
          <table class="table table-hover">
            <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
            </thead>
            <tbody>
            <tr v-for="user in users" :key="user._id">
              <td>{{ user.name }}</td>
              <td>{{ user.email }}</td>
              <td>
                  <span :class="['badge', user.role === 'admin' ? 'bg-danger' : 'bg-primary']">
                    {{ user.role }}
                  </span>
              </td>
              <td>{{ formatDate(user.createdAt) }}</td>
              <td>
                <button
                    class="btn btn-sm btn-warning"
                    @click="openEditModal(user)"
                    title="Edit"
                >
                  <i class="bi bi-pencil"></i>
                </button>
                <button
                    class="btn btn-sm btn-danger"
                    @click="deleteUser(user._id)"
                    :disabled="user._id === currentUserId"
                    title="Delete"
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

    <!-- Toast Notification -->
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

    <!-- Create User Modal -->
    <div class="modal fade" id="createUserModal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Create New User</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <form @submit.prevent="createUser">
            <div class="modal-body">
              <div class="mb-3">
                <label class="form-label">Name</label>
                <input type="text" class="form-control" v-model="newUser.name" required>
              </div>

              <div class="mb-3">
                <label class="form-label">Email</label>
                <input type="email" class="form-control" v-model="newUser.email" required>
              </div>

              <div class="mb-3">
                <label class="form-label">Password</label>
                <input type="password" class="form-control" v-model="newUser.password" required minlength="6">
              </div>

              <div class="mb-3">
                <label class="form-label">Role</label>
                <select class="form-select" v-model="newUser.role" required>
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="submit" class="btn btn-primary">Create User</button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <!-- Edit User Modal -->
    <div class="modal fade" id="editUserModal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Edit User</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <form @submit.prevent="updateUser">
            <div class="modal-body">
              <div class="mb-3">
                <label class="form-label">Name</label>
                <input type="text" class="form-control" v-model="editingUser.name" required>
              </div>

              <div class="mb-3">
                <label class="form-label">Email</label>
                <input type="email" class="form-control" v-model="editingUser.email" required>
              </div>

              <div class="mb-3">
                <label class="form-label">Password (leave empty to keep current)</label>
                <input type="password" class="form-control" v-model="editingUser.password" minlength="6">
                <small class="text-muted">Only fill this if you want to change the password</small>
              </div>

              <div class="mb-3">
                <label class="form-label">Role</label>
                <select class="form-select" v-model="editingUser.role" required>
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
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
import { ref, onMounted, computed } from 'vue'
import apiClient from '../api/client'
import { useAuthStore } from '../stores/auth'
import { Modal, Toast } from 'bootstrap'

const authStore = useAuthStore()
const users = ref([])
const loading = ref(true)

const newUser = ref({
  name: '',
  email: '',
  password: '',
  role: 'user'
})

const editingUser = ref({
  _id: '',
  name: '',
  email: '',
  password: '',
  role: 'user'
})

const toastMessage = ref('')
const toast = ref(null)

const currentUserId = computed(() => authStore.user?._id)

const fetchUsers = async () => {
  loading.value = true
  try {
    const response = await apiClient.get('/users')
    users.value = response.data.users || []
  } catch (error) {
    console.error('Failed to fetch users:', error)
  } finally {
    loading.value = false
  }
}

const createUser = async () => {
  try {
    await apiClient.post('/users', newUser.value)

    const modalEl = document.getElementById('createUserModal')
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

    newUser.value = { name: '', email: '', password: '', role: 'user' }

    await fetchUsers()
    showToast('User created successfully!')
  } catch (error) {
    alert(error.response?.data?.error || 'Failed to create user')
  }
}

const openEditModal = (user) => {
  editingUser.value = {
    _id: user._id,
    name: user.name,
    email: user.email,
    password: '',
    role: user.role
  }

  const modal = new Modal(document.getElementById('editUserModal'))
  modal.show()
}

const updateUser = async () => {
  try {
    const updateData = {
      name: editingUser.value.name,
      email: editingUser.value.email,
      role: editingUser.value.role
    }

    if (editingUser.value.password && editingUser.value.password.trim() !== '') {
      updateData.password = editingUser.value.password
    }

    await apiClient.put(`/users/${editingUser.value._id}`, updateData)

    const modalEl = document.getElementById('editUserModal')
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

    await fetchUsers()
    showToast('User updated successfully!')
  } catch (error) {
    alert(error.response?.data?.error || 'Failed to update user')
  }
}

const deleteUser = async (id) => {
  if (id === currentUserId.value) {
    alert('You cannot delete yourself!')
    return
  }

  if (!confirm('Are you sure you want to delete this user?')) return

  try {
    await apiClient.delete(`/users/${id}`)
    await fetchUsers()
    showToast('User deleted successfully!')
  } catch (error) {
    alert('Failed to delete user')
  }
}

const formatDate = (date) => {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

const showToast = (message) => {
  toastMessage.value = message
  const toastEl = new Toast(toast.value)
  toastEl.show()
}

onMounted(() => {
  fetchUsers()
})
</script>

<style scoped>
.toast-container {
  z-index: 9999;
}
</style>