<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useSessionStore } from '@/stores/session'
import { useUiStore } from '@/stores/ui'
import { formatDateTime } from '@/utils/time'

const session = useSessionStore()
const ui = useUiStore()

const usernameInput = ref(session.familyUsername)
const usernamePwd = ref('')
const usernameError = ref('')
const usernameLoading = ref(false)

const currentPwd = ref('')
const nextPwd = ref('')
const confirmPwd = ref('')
const passwordError = ref('')
const passwordLoading = ref(false)

const recoveryPwd = ref('')
const recoveryError = ref('')
const recoveryLoading = ref(false)
const newCode = ref('')
const copied = ref(false)

const recoveryStatus = computed(() => {
  if (!session.familyHasRecoveryCode) return '还没有设置恢复码'
  if (!session.familyRecoveryUpdatedAt) return '已设置'
  return `已设置 · 更新于 ${formatDateTime(session.familyRecoveryUpdatedAt)}`
})

onMounted(async () => {
  try {
    await session.refreshMe()
  } catch {
    /* 离线时用本地已有状态，不阻塞页面 */
  }
  if (!usernameInput.value) usernameInput.value = session.familyUsername
})

async function saveUsername() {
  usernameError.value = ''
  if (usernameInput.value.trim().length < 3) {
    usernameError.value = '账号名至少 3 个字符'
    return
  }
  if (!usernamePwd.value) {
    usernameError.value = '请输入当前密码'
    return
  }
  usernameLoading.value = true
  try {
    await session.changeParentUsername(usernameInput.value.trim(), usernamePwd.value)
    usernameInput.value = session.familyUsername
    usernamePwd.value = ''
    ui.toast('账号名已更新，下次登录请用新账号名')
  } catch (err: any) {
    usernameError.value = err?.message ?? '修改账号名失败'
  } finally {
    usernameLoading.value = false
  }
}

async function savePassword() {
  passwordError.value = ''
  if (!currentPwd.value) {
    passwordError.value = '请输入当前密码'
    return
  }
  if (nextPwd.value.length < 6) {
    passwordError.value = '新密码至少 6 位'
    return
  }
  if (nextPwd.value !== confirmPwd.value) {
    passwordError.value = '两次输入的新密码不一致'
    return
  }
  if (nextPwd.value === currentPwd.value) {
    passwordError.value = '新密码不能和当前密码相同'
    return
  }
  passwordLoading.value = true
  try {
    await session.changeParentPassword(currentPwd.value, nextPwd.value)
    currentPwd.value = ''
    nextPwd.value = ''
    confirmPwd.value = ''
    ui.toast('密码已更新，其他家长设备已退出登录')
  } catch (err: any) {
    passwordError.value = err?.message ?? '修改密码失败'
  } finally {
    passwordLoading.value = false
  }
}

async function regenerateCode() {
  recoveryError.value = ''
  if (!recoveryPwd.value) {
    recoveryError.value = '请输入当前密码'
    return
  }
  recoveryLoading.value = true
  try {
    newCode.value = await session.regenerateRecoveryCode(recoveryPwd.value)
    recoveryPwd.value = ''
    copied.value = false
    ui.toast('已生成新的恢复码，旧码立即失效')
  } catch (err: any) {
    recoveryError.value = err?.message ?? '生成恢复码失败'
  } finally {
    recoveryLoading.value = false
  }
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(newCode.value)
    copied.value = true
    window.setTimeout(() => (copied.value = false), 2000)
  } catch {
    recoveryError.value = '浏览器不允许自动复制，请手动抄下来'
  }
}
</script>

<template>
  <div class="stack" style="gap: 16px">
    <div>
      <h1 class="section-title">账号与安全</h1>
      <p class="section-sub">家长账号只用于登录家长中心；孩子端使用各自的 PIN，不受影响。</p>
    </div>

    <!-- 账号名 -->
    <div class="card card--pad">
      <h2 class="section-title" style="font-size: 18px">家长账号</h2>
      <p class="hint mt-8">
        当前账号：<strong>{{ session.familyUsername || '—' }}</strong>
      </p>

      <div class="grid grid--2 mt-16" style="gap: 12px">
        <div>
          <label class="label" for="account-username">新账号名</label>
          <input
            id="account-username"
            v-model="usernameInput"
            class="input"
            maxlength="20"
            autocomplete="username"
            placeholder="3~20 个字符"
          />
        </div>
        <div>
          <label class="label" for="account-username-pwd">当前密码</label>
          <input
            id="account-username-pwd"
            v-model="usernamePwd"
            class="input"
            type="password"
            autocomplete="current-password"
            placeholder="确认是你本人"
          />
        </div>
      </div>

      <p v-if="usernameError" class="hint mt-8" style="color: var(--rose-deep)">{{ usernameError }}</p>

      <button class="btn btn--primary mt-16" :disabled="usernameLoading" @click="saveUsername">
        {{ usernameLoading ? '保存中…' : '保存账号名' }}
      </button>
    </div>

    <!-- 密码 -->
    <div class="card card--pad">
      <h2 class="section-title" style="font-size: 18px">修改密码</h2>
      <p class="hint mt-8">改完后其他家长设备会退出登录，当前设备保持登录。</p>

      <div class="stack mt-16" style="gap: 12px">
        <div>
          <label class="label" for="account-current-pwd">当前密码</label>
          <input
            id="account-current-pwd"
            v-model="currentPwd"
            class="input"
            type="password"
            autocomplete="current-password"
          />
        </div>
        <div class="grid grid--2" style="gap: 12px">
          <div>
            <label class="label" for="account-next-pwd">新密码</label>
            <input
              id="account-next-pwd"
              v-model="nextPwd"
              class="input"
              type="password"
              placeholder="至少 6 位"
              autocomplete="new-password"
            />
          </div>
          <div>
            <label class="label" for="account-confirm-pwd">确认新密码</label>
            <input
              id="account-confirm-pwd"
              v-model="confirmPwd"
              class="input"
              type="password"
              autocomplete="new-password"
            />
          </div>
        </div>
      </div>

      <p v-if="passwordError" class="hint mt-8" style="color: var(--rose-deep)">{{ passwordError }}</p>

      <button class="btn btn--primary mt-16" :disabled="passwordLoading" @click="savePassword">
        {{ passwordLoading ? '保存中…' : '保存新密码' }}
      </button>
    </div>

    <!-- 恢复码 -->
    <div class="card card--pad">
      <h2 class="section-title" style="font-size: 18px">恢复码</h2>
      <p class="hint mt-8">
        忘记密码时，在登录页用恢复码重置（不需要账号名）。恢复码只保存哈希，生成后无法再次查看。
      </p>
      <p class="hint mt-8">状态：<strong>{{ recoveryStatus }}</strong></p>

      <div v-if="newCode" class="recovery-code mt-16">
        <p class="hint" style="margin-bottom: 8px">新的恢复码（只显示这一次）</p>
        <div class="recovery-code__value">{{ newCode }}</div>
        <div class="row mt-8" style="justify-content: center">
          <button class="btn btn--small" @click="copyCode">{{ copied ? '已复制 ✓' : '复制' }}</button>
        </div>
        <p class="hint mt-8">抄在纸上或拍照保存。旧码已经失效。</p>
      </div>

      <div class="row row--wrap mt-16" style="align-items: flex-end; gap: 12px">
        <div class="grow" style="min-width: 180px">
          <label class="label" for="account-recovery-pwd">当前密码</label>
          <input
            id="account-recovery-pwd"
            v-model="recoveryPwd"
            class="input"
            type="password"
            autocomplete="current-password"
          />
        </div>
        <button class="btn btn--primary" :disabled="recoveryLoading" @click="regenerateCode">
          {{ recoveryLoading ? '生成中…' : session.familyHasRecoveryCode ? '重新生成恢复码' : '生成恢复码' }}
        </button>
      </div>

      <p v-if="recoveryError" class="hint mt-8" style="color: var(--rose-deep)">{{ recoveryError }}</p>

      <p class="hint mt-16">
        连恢复码也丢了？在 NAS 上停止服务后运行 <code>npm run reset:password</code>，会打印一个临时密码；登录后在这里改成自己的密码。详见 README。
      </p>
    </div>
  </div>
</template>

<style scoped>
.recovery-code {
  padding: 14px;
  border: 2px dashed var(--line);
  border-radius: 14px;
  background: var(--cream);
  text-align: center;
}

.recovery-code__value {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 2px;
  word-break: break-all;
}
</style>
