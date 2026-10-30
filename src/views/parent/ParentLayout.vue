<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { APP_VERSION } from '@shared/constants'
import { useSessionStore } from '@/stores/session'
import { useDataStore } from '@/stores/data'
import { useUiStore } from '@/stores/ui'
import { useUpdateStore } from '@/stores/update'

const session = useSessionStore()
const data = useDataStore()
const ui = useUiStore()
const update = useUpdateStore()
const router = useRouter()
const route = useRoute()

const tabs = [
  { name: 'parent-overview', label: '总览', icon: '📊' },
  { name: 'parent-homework', label: '作业', icon: '📝' },
  { name: 'parent-records', label: '训练记录', icon: '📋' },
  { name: 'parent-limits', label: '防沉迷', icon: '⏳' },
  { name: 'parent-profiles', label: '孩子档案', icon: '👦' },
  { name: 'parent-ai', label: 'AI 设置', icon: '🤖' },
  { name: 'parent-data', label: '数据管理', icon: '🗂️' },
  { name: 'parent-account', label: '账号', icon: '🔐' },
]

const loading = ref(true)

/** 进家长端自动查一次更新（本地每天最多一次）；发现新版才提示，不打扰。 */
async function checkUpdate() {
  await update.autoCheck()
  if (update.updateAvailable) ui.toast(`发现新版本 v${update.latest}`)
}

onMounted(async () => {
  try {
    await data.fetchState()
  } catch (err: any) {
    ui.toast(err?.message ?? '加载数据失败，已使用本地缓存')
  } finally {
    loading.value = false
  }
  // 版本检查不阻塞页面
  void checkUpdate()
})

function backToChild() {
  if (session.returnToChild()) {
    router.push('/kid')
  } else {
    router.push('/select')
  }
}

async function logout() {
  await session.logout()
  data.resetLocal()
  router.replace('/login')
}
</script>

<template>
  <div class="parent-shell">
    <header class="topbar">
      <div class="topbar__inner">
        <div class="brand">
          <span class="brand__logo">🛡️</span>
          <span>专注力小卫士 · 家长中心</span>
          <span class="topbar__ver" title="当前版本">v{{ APP_VERSION }}</span>
        </div>
        <div class="grow"></div>
        <span v-if="data.offline" class="pill pill--peach">离线</span>
        <button v-if="session.temporaryParent" class="btn btn--small" @click="backToChild">回到孩子模式</button>
        <button class="btn btn--ghost btn--small" @click="logout">退出</button>
      </div>
    </header>

    <div class="tabs">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.name"
        :to="{ name: tab.name }"
        class="tab"
        :class="{ 'is-active': route.name === tab.name }"
      >
        <span>{{ tab.icon }}</span> {{ tab.label }}
      </RouterLink>
    </div>

    <main class="page">
      <p v-if="loading" class="hint center mt-24">正在同步数据…</p>
      <RouterView v-else />
    </main>
  </div>
</template>

<style scoped>
.topbar__ver {
  color: var(--muted);
  font-size: 12px;
  font-weight: 500;
  margin-left: 10px;
}

.tabs {
  position: sticky;
  top: 63px;
  z-index: 15;
  display: flex;
  gap: 6px;
  padding: 10px 18px;
  max-width: 1040px;
  margin: 0 auto;
  overflow-x: auto;
  background: rgba(253, 247, 239, 0.9);
  backdrop-filter: blur(10px);
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  color: var(--muted);
  white-space: nowrap;
  border: 1px solid transparent;
}

.tab.is-active {
  background: #fff;
  color: var(--mint-deep);
  border-color: var(--line);
  box-shadow: var(--shadow-soft);
}

.parent-shell .page {
  padding-bottom: 60px;
}
</style>
