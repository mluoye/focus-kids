<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()

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
  <div class="toast-wrap">
    <div v-for="toast in ui.toasts" :key="toast.id" class="toast">{{ toast.text }}</div>
  </div>
</template>
