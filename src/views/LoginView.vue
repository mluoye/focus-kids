<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/api/client'
import { useSessionStore } from '@/stores/session'
import { useDataStore } from '@/stores/data'

const router = useRouter()
const session = useSessionStore()
const data = useDataStore()

const loading = ref(true)
const hasFamily = ref(false)
const username = ref('')
const password = ref('')
const confirm = ref('')
const error = ref('')
const submitting = ref(false)
const version = ref('')

onMounted(async () => {
  try {
    const info = await api.bootstrap()
    hasFamily.value = info.hasFamily
    version.value = info.version
  } catch {
    error.value = '服务器连接不上，请确认后端服务已启动'
  } finally {
    loading.value = false
  }
})

async function submit() {
  error.value = ''
  if (username.value.trim().length < 3) {
    error.value = '家长账号至少 3 个字符'
    return
  }
  if (password.value.length < 6) {
    error.value = '密码至少 6 位'
    return
  }
  if (!hasFamily.value && password.value !== confirm.value) {
    error.value = '两次输入的密码不一致'
    return
  }
  submitting.value = true
  try {
    if (hasFamily.value) {
      await session.loginParent(username.value.trim(), password.value)
    } else {
      await session.registerParent(username.value.trim(), password.value)
      hasFamily.value = true
    }
    router.replace('/parent')
  } catch (err: any) {
    error.value = err?.message ?? '登录失败，请稍后重试'
  } finally {
    submitting.value = false
  }
}

function goKid() {
  data.resetLocal()
  router.push('/select')
}
</script>

<template>
  <div class="page page--narrow" style="padding-top: 6vh">
    <div class="center stack" style="align-items: center; gap: 8px">
      <div class="brand__logo" style="width: 64px; height: 64px; font-size: 34px; border-radius: 22px">🧠</div>
      <h1 style="font-size: 26px; letter-spacing: 1px">专注力小卫士</h1>
      <p class="hint">为 6~10 岁小朋友准备的专注力成长基地</p>
    </div>

    <div class="card card--pad mt-24">
      <p v-if="loading" class="center muted">正在连接服务器…</p>

      <template v-else>
        <h2 class="section-title">{{ hasFamily ? '家长登录' : '创建家庭账号' }}</h2>
        <p class="section-sub">
          {{ hasFamily ? '登录后可以管理孩子档案、查看报表与设置防沉迷。' : '第一次使用，请先创建家长账号，之后为孩子建立专属档案。' }}
        </p>

        <div class="stack mt-16">
          <div>
            <label class="label" for="username">家长账号</label>
            <input id="username" v-model="username" class="input" placeholder="例如：mama123" autocomplete="username" />
          </div>
          <div>
            <label class="label" for="password">密码</label>
            <input
              id="password"
              v-model="password"
              class="input"
              type="password"
              placeholder="至少 6 位"
              autocomplete="current-password"
              @keyup.enter="submit"
            />
          </div>
          <div v-if="!hasFamily">
            <label class="label" for="confirm">确认密码</label>
            <input id="confirm" v-model="confirm" class="input" type="password" placeholder="再输一次" @keyup.enter="submit" />
          </div>

          <p v-if="error" class="hint" style="color: var(--rose-deep)">{{ error }}</p>

          <button class="btn btn--primary btn--block btn--lg" :disabled="submitting" @click="submit">
            {{ submitting ? '处理中…' : hasFamily ? '登录' : '创建并开始' }}
          </button>

          <button class="btn btn--ghost btn--block" :disabled="!hasFamily" @click="goKid">
            我是小朋友，去选头像 →
          </button>
        </div>
      </template>
    </div>

    <p class="hint center mt-16">
      家长入口 · 数据保存在你自己的服务器上
      <span v-if="version"> · v{{ version }}</span>
    </p>
  </div>
</template>
