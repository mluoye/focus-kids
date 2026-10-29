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

/** 登录 / 恢复码重置 */
const mode = ref<'login' | 'recover'>('login')
/** 创建账号后展示一次恢复码，确认后再进家长中心 */
const issuedCode = ref('')
const copied = ref(false)

const recoveryCode = ref('')
const newPassword = ref('')
const newPasswordConfirm = ref('')

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
      router.replace('/parent')
    } else {
      const code = await session.registerParent(username.value.trim(), password.value)
      hasFamily.value = true
      if (code) {
        // 先展示恢复码，不直接进家长中心
        issuedCode.value = code
        password.value = ''
        confirm.value = ''
      } else {
        router.replace('/parent')
      }
    }
  } catch (err: any) {
    error.value = err?.message ?? '登录失败，请稍后重试'
  } finally {
    submitting.value = false
  }
}

async function submitRecover() {
  error.value = ''
  if (!recoveryCode.value.trim()) {
    error.value = '请输入恢复码'
    return
  }
  if (newPassword.value.length < 6) {
    error.value = '新密码至少 6 位'
    return
  }
  if (newPassword.value !== newPasswordConfirm.value) {
    error.value = '两次输入的新密码不一致'
    return
  }
  submitting.value = true
  try {
    await session.recoverParent(recoveryCode.value, newPassword.value)
    router.replace('/parent')
  } catch (err: any) {
    error.value = err?.message ?? '重置失败，请检查恢复码'
  } finally {
    submitting.value = false
  }
}

function openRecover() {
  error.value = ''
  recoveryCode.value = ''
  newPassword.value = ''
  newPasswordConfirm.value = ''
  mode.value = 'recover'
}

function backToLogin() {
  error.value = ''
  mode.value = 'login'
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(issuedCode.value)
    copied.value = true
    window.setTimeout(() => (copied.value = false), 2000)
  } catch {
    error.value = '浏览器不允许自动复制，请手动抄下来'
  }
}

function enterAfterRegister() {
  router.replace('/parent')
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

      <!-- 创建账号后：只显示一次的恢复码 -->
      <template v-else-if="issuedCode">
        <div class="center">
          <p class="pill pill--mint" style="margin: 0 auto">重要 · 只显示这一次</p>
          <h2 class="section-title mt-8">请抄下恢复码</h2>
          <p class="section-sub">忘记密码时，它就是找回账号的唯一凭证。</p>
        </div>

        <div class="recovery-code mt-16">{{ issuedCode }}</div>

        <div class="row mt-8" style="justify-content: center">
          <button class="btn btn--small" @click="copyCode">{{ copied ? '已复制 ✓' : '复制恢复码' }}</button>
        </div>

        <ul class="hint mt-16" style="padding-left: 18px; line-height: 1.8">
          <li>抄在纸上或拍照，别只存在这台电脑里。</li>
          <li>以后可在「家长中心 → 账号」重新生成，旧码会立即失效。</li>
          <li>恢复码也丢了，可在 NAS 上停服务后运行 <code>npm run reset:password</code>。</li>
        </ul>

        <p v-if="error" class="hint mt-8" style="color: var(--rose-deep)">{{ error }}</p>

        <button class="btn btn--primary btn--block btn--lg mt-16" @click="enterAfterRegister">
          我已保存，进入家长中心
        </button>
      </template>

      <!-- 忘记密码：恢复码重置 -->
      <template v-else-if="mode === 'recover'">
        <h2 class="section-title">用恢复码重置密码</h2>
        <p class="section-sub">不需要账号名，输入恢复码和新密码即可。重置后所有家长设备需要重新登录。</p>

        <div class="stack mt-16">
          <div>
            <label class="label" for="recovery-code">恢复码</label>
            <input
              id="recovery-code"
              v-model="recoveryCode"
              class="input recovery-input"
              placeholder="XXXX-XXXX-XXXX-XXXX"
              autocomplete="one-time-code"
              autocapitalize="characters"
              spellcheck="false"
              maxlength="24"
            />
          </div>
          <div>
            <label class="label" for="new-password">新密码</label>
            <input
              id="new-password"
              v-model="newPassword"
              class="input"
              type="password"
              placeholder="至少 6 位"
              autocomplete="new-password"
            />
          </div>
          <div>
            <label class="label" for="new-password-confirm">确认新密码</label>
            <input
              id="new-password-confirm"
              v-model="newPasswordConfirm"
              class="input"
              type="password"
              placeholder="再输一次"
              autocomplete="new-password"
              @keyup.enter="submitRecover"
            />
          </div>

          <p v-if="error" class="hint" style="color: var(--rose-deep)">{{ error }}</p>

          <button class="btn btn--primary btn--block btn--lg" :disabled="submitting" @click="submitRecover">
            {{ submitting ? '处理中…' : '重置密码并登录' }}
          </button>

          <button class="btn btn--ghost btn--block" :disabled="submitting" @click="backToLogin">
            返回登录
          </button>

          <p class="hint center">
            恢复码也丢了？在 NAS 上停止服务后运行 <code>npm run reset:password</code>，会生成临时密码（见 README）。
          </p>
        </div>
      </template>

      <!-- 登录 / 首次注册 -->
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
              :autocomplete="hasFamily ? 'current-password' : 'new-password'"
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

          <button v-if="hasFamily" class="btn btn--ghost btn--small" :disabled="submitting" @click="openRecover">
            忘记密码？用恢复码重置
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

<style scoped>
.recovery-code {
  padding: 16px 12px;
  border: 2px dashed var(--line);
  border-radius: 14px;
  background: var(--cream);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 2px;
  text-align: center;
  word-break: break-all;
}

.recovery-input {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 1px;
  text-transform: uppercase;
}
</style>
