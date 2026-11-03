import { ref, onMounted, onUnmounted } from 'vue'

/**
 * 网络状态监测 composable
 * 主动监听网络变化，网络恢复时自动触发回调
 */
export function useNetworkStatus(onOnline?: () => void, onOffline?: () => void) {
  const isOnline = ref(navigator.onLine)
  const wasOffline = ref(false)

  function handleOnline() {
    isOnline.value = true
    if (wasOffline.value) {
      wasOffline.value = false
      onOnline?.()
    }
  }

  function handleOffline() {
    isOnline.value = false
    wasOffline.value = true
    onOffline?.()
  }

  onMounted(() => {
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
  })

  onUnmounted(() => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
  })

  return { isOnline }
}
