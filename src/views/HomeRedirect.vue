<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionStore } from '@/stores/session'
import { useDataStore } from '@/stores/data'

const session = useSessionStore()
const data = useDataStore()
const router = useRouter()

onMounted(async () => {
  if (!session.loggedIn) {
    router.replace(session.role === 'child' ? '/select' : '/login')
    return
  }
  try {
    await session.refreshMe()
    await data.fetchState()
  } catch {
    /* 离线时使用本地缓存继续 */
  }
  router.replace(session.role === 'parent' ? '/parent' : '/kid')
})
</script>

<template>
  <div class="page page--narrow center" style="padding-top: 30vh">
    <div class="emoji-xl">🌱</div>
    <p class="muted mt-16">正在准备你的成长小天地…</p>
  </div>
</template>
