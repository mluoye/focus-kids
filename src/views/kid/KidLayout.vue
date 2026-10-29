<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { api } from '@/api/client'
import { useSessionStore } from '@/stores/session'
import { useDataStore } from '@/stores/data'
import { useGuardStore } from '@/stores/guard'
import { useUiStore } from '@/stores/ui'
import { formatMinutes } from '@/utils/time'
import { draftRevision, isHomeworkDraftStale, loadHomeworkDraft } from '@/training/homeworkDraft'

const session = useSessionStore()
const data = useDataStore()
const guard = useGuardStore()
const ui = useUiStore()
const router = useRouter()
const route = useRoute()

const navItems = [
  { name: 'kid-home', label: '首页', icon: '🏡' },
  { name: 'kid-train', label: '训练', icon: '🎮' },
  { name: 'kid-homework', label: '作业', icon: '🍅' },
  { name: 'kid-growth', label: '成长', icon: '🌱' },
  { name: 'kid-tutor', label: '问AI', icon: '🤖' },
]

const showUnlock = ref(false)
const parentPassword = ref('')
const unlockError = ref('')
const unlocking = ref(false)
const releaseAfterUnlock = ref(false)

const profile = computed(() => data.myProfile ?? session.profile)
const points = computed(() => data.myProfile?.points ?? session.profile?.points ?? 0)
const breakProgress = computed(() => {
  if (!guard.breakTotalSec) return 0
  return Math.round(((guard.breakTotalSec - guard.breakRemainingSec) / guard.breakTotalSec) * 100)
})
const breakText = computed(() => formatMinutes(guard.breakRemainingSec))
/** 底栏「作业」上的进行中标记：离开作业页但草稿还在时亮起。 */
const homeworkRunning = computed(() => {
  void draftRevision.value
  const pid = session.profileId
  if (!pid) return false
  if (route.name === 'kid-homework') return false
  const draft = loadHomeworkDraft(pid)
  if (!draft || isHomeworkDraftStale(draft)) return false
  return !!draft.sessionId && draft.step !== 'setup'
})

onMounted(async () => {
  guard.ensureTimer()
  if (!data.loaded) {
    try {
      await data.fetchState()
    } catch {
      ui.toast('暂时离线，已使用本地记录')
    }
  }
  await session.refreshMe()
})

// 只有真正进入训练/作业页才开始连续计时，回首页即暂停
watch(
  () => route.name,
  (name) => {
    if (name === 'kid-play' || name === 'kid-homework') guard.noteActivity()
    else guard.pauseActivity()
  },
  { immediate: true },
)

async function submitUnlock() {
  unlocking.value = true
  unlockError.value = ''
  try {
    if (releaseAfterUnlock.value) {
      await api.parentCheck(parentPassword.value)
      guard.parentRelease()
      ui.toast('已放行，本次休息提前结束')
      releaseAfterUnlock.value = false
      showUnlock.value = false
      parentPassword.value = ''
      return
    }
    await session.unlockParent(parentPassword.value)
    showUnlock.value = false
    parentPassword.value = ''
    router.push('/parent')
  } catch (err: any) {
    unlockError.value = err?.message ?? '密码不正确'
  } finally {
    unlocking.value = false
  }
}

function releaseBreak() {
  releaseAfterUnlock.value = true
  parentPassword.value = ''
  unlockError.value = ''
  showUnlock.value = true
}
</script>

<template>
  <div class="kid-shell">
    <header class="topbar">
      <div class="topbar__inner">
        <div class="brand">
          <span class="brand__logo">🛡️</span>
          <span>专注力小卫士</span>
        </div>
        <div class="grow"></div>
        <span v-if="data.offline" class="pill pill--peach">离线中</span>
        <span class="pill pill--butter">⭐ {{ points }}</span>
        <button class="avatar-chip" @click="showUnlock = true">
          <span class="avatar-chip__face">{{ profile?.avatar ?? '🙂' }}</span>
          <span>{{ profile?.name ?? '小朋友' }}</span>
          <span class="muted" style="font-size: 12px">家长</span>
        </button>
      </div>
    </header>

    <main>
      <RouterView />
    </main>

    <nav class="bottom-nav">
      <RouterLink
        v-for="item in navItems"
        :key="item.name"
        :to="{ name: item.name }"
        class="bottom-nav__item"
        :class="{ 'is-active': route.name === item.name || (item.name === 'kid-train' && route.name === 'kid-play') }"
      >
        <span class="bottom-nav__icon">
          {{ item.icon }}
          <span v-if="item.name === 'kid-homework' && homeworkRunning" class="nav-dot"></span>
        </span>
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>

    <div v-if="guard.onBreak" class="overlay">
      <div class="modal center">
        <p class="emoji-xl">🌤️</p>
        <h2 class="section-title mt-8">休息一下眼睛和肩膀</h2>
        <p class="hint mt-8">连续训练了 {{ guard.limits?.sessionMinutes ?? 15 }} 分钟，站起来喝口水、看看远处吧。</p>
        <div class="rest-timer mt-16">{{ breakText }}</div>
        <div class="progress mt-16">
          <div class="progress__fill" :style="{ width: breakProgress + '%' }"></div>
        </div>
        <p class="hint mt-16">倒计时结束自动继续</p>
        <button class="btn btn--ghost btn--small mt-16" @click="releaseBreak">家长放行一次</button>
      </div>
    </div>

    <div v-if="showUnlock" class="overlay" @click.self="showUnlock = false">
      <div class="modal">
        <h2 class="section-title">家长验证</h2>
        <p class="section-sub">进入家长中心需要输入家长密码</p>
        <input
          v-model="parentPassword"
          class="input mt-16"
          type="password"
          placeholder="家长密码"
          @keyup.enter="submitUnlock"
        />
        <p v-if="unlockError" class="hint mt-8" style="color: var(--rose-deep)">{{ unlockError }}</p>
        <div class="row mt-16">
          <button class="btn btn--ghost grow" @click="showUnlock = false">取消</button>
          <button class="btn btn--primary grow" :disabled="unlocking" @click="submitUnlock">
            {{ unlocking ? '验证中…' : '进入家长中心' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bottom-nav__icon {
  position: relative;
  line-height: 1;
}

.nav-dot {
  position: absolute;
  top: -3px;
  right: -7px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--peach-deep, #e2734a);
  box-shadow: 0 0 0 2px var(--card, #fff);
}

.rest-timer {
  font-size: 44px;
  font-weight: 800;
  letter-spacing: 2px;
  color: var(--mint-deep);
}
</style>
