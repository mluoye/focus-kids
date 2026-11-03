<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterView } from 'vue-router'
import { useUiStore } from '@/stores/ui'
import { useDataStore } from '@/stores/data'

const ui = useUiStore()
const data = useDataStore()

const pendingCount = computed(() => data.pending.records.length + data.pending.homework.length)

onMounted(() => {
  const onOnline = () => ui.setOnline(true)
  const onOffline = () => ui.setOnline(false)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  ui.setOnline(navigator.onLine)
})
</script>

<template>
  <RouterView />

  <!-- 离线状态指示器 -->
  <div v-if="!ui.online || data.offline" class="offline-indicator">
    <span class="offline-dot"></span>
    <span v-if="pendingCount > 0">
      离线中 · {{ pendingCount }} 条记录待同步
    </span>
    <span v-else>离线模式</span>
  </div>

  <div class="toast-wrap">
    <div v-for="toast in ui.toasts" :key="toast.id" class="toast">{{ toast.text }}</div>
  </div>
</template>

<style scoped>
.offline-indicator {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background: #fbbf24;
  color: #78350f;
  font-size: 0.875rem;
  font-weight: 500;
}

.offline-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: #78350f;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
</style>
