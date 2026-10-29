<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/api/client'
import { useSessionStore } from '@/stores/session'
import { useDataStore } from '@/stores/data'
import { useUiStore } from '@/stores/ui'

interface PickerProfile {
  id: string
  name: string
  avatar: string
}

const router = useRouter()
const session = useSessionStore()
const data = useDataStore()
const ui = useUiStore()

const loading = ref(true)
const profiles = ref<PickerProfile[]>([])
const hasFamily = ref(true)
const selected = ref<PickerProfile | null>(null)
const pin = ref('')
const error = ref('')
const submitting = ref(false)

const pinDots = computed(() => [0, 1, 2, 3])

onMounted(async () => {
  try {
    const res = await api.picker()
    profiles.value = res.profiles
    hasFamily.value = res.hasFamily
  } catch {
    ui.toast('连不上服务器，请稍后再试')
  } finally {
    loading.value = false
  }
})

function choose(profile: PickerProfile) {
  selected.value = profile
  pin.value = ''
  error.value = ''
}

function press(n: string) {
  if (submitting.value || !selected.value) return
  if (pin.value.length >= 4) return
  pin.value += n
  error.value = ''
  if (pin.value.length === 4) submitPin()
}

function backspace() {
  pin.value = pin.value.slice(0, -1)
  error.value = ''
}

async function submitPin() {
  if (!selected.value) return
  submitting.value = true
  try {
    await session.loginChild(selected.value.id, pin.value)
    data.resetLocal()
    try {
      await data.fetchState()
    } catch {
      /* 离线也能继续 */
    }
    router.replace('/kid')
  } catch (err: any) {
    error.value = err?.message ?? 'PIN 码不正确'
    pin.value = ''
  } finally {
    submitting.value = false
  }
}

function goParent() {
  session.reset()
  router.push('/login')
}
</script>

<template>
  <div class="page page--narrow" style="padding-top: 5vh">
    <div class="center stack" style="align-items: center; gap: 6px">
      <div class="emoji-xl">🛡️</div>
      <h1 style="font-size: 24px">今天是谁来训练呀？</h1>
      <p class="hint">选一个头像，再输入你的 4 位小密码</p>
    </div>

    <div v-if="loading" class="card mt-24 center muted">正在找你的头像…</div>

    <template v-else>
      <div v-if="profiles.length" class="grid grid--auto mt-24">
        <button
          v-for="p in profiles"
          :key="p.id"
          class="card avatar-card"
          :class="{ 'is-selected': selected?.id === p.id }"
          @click="choose(p)"
        >
          <span class="emoji-xl">{{ p.avatar }}</span>
          <strong>{{ p.name }}</strong>
        </button>
      </div>

      <div v-else class="card card--pad mt-24 center">
        <p class="emoji-lg">🙋</p>
        <h2 class="section-title mt-8">还没有小朋友档案</h2>
        <p class="hint mt-8">请家长先登录，创建孩子档案并设置 4 位 PIN。</p>
        <button class="btn btn--primary mt-16" @click="goParent">家长去创建</button>
      </div>

      <div v-if="selected" class="card card--pad mt-24 center">
        <p class="hint">{{ selected.avatar }} {{ selected.name }} 的专属密码</p>
        <div class="pin-dots mt-16">
          <span v-for="i in pinDots" :key="i" class="pin-dot" :class="{ 'is-filled': pin.length > i }"></span>
        </div>
        <p v-if="error" class="hint mt-8" style="color: var(--rose-deep)">{{ error }}</p>

        <div class="keypad mt-16">
          <button v-for="n in ['1', '2', '3', '4', '5', '6', '7', '8', '9']" :key="n" class="keypad__key" @click="press(n)">
            {{ n }}
          </button>
          <button class="keypad__key keypad__key--ghost" @click="selected = null">取消</button>
          <button class="keypad__key" @click="press('0')">0</button>
          <button class="keypad__key keypad__key--ghost" @click="backspace">⌫</button>
        </div>
      </div>

      <button class="btn btn--ghost btn--block mt-24" @click="goParent">家长登录 / 管理</button>
    </template>
  </div>
</template>

<style scoped>
.avatar-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px 10px;
  border-radius: var(--radius);
  transition: transform 0.16s ease, border-color 0.16s ease;
}

.avatar-card:hover {
  transform: translateY(-3px);
}

.avatar-card.is-selected {
  border-color: var(--mint-deep);
  box-shadow: 0 0 0 4px rgba(168, 221, 201, 0.35);
}

.pin-dots {
  display: flex;
  justify-content: center;
  gap: 14px;
}

.pin-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--cream-deep);
  border: 2px solid #e8d8c4;
  transition: background 0.16s ease, transform 0.16s ease;
}

.pin-dot.is-filled {
  background: var(--mint-deep);
  border-color: var(--mint-deep);
  transform: scale(1.1);
}

.keypad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  max-width: 300px;
  margin: 0 auto;
}

.keypad__key {
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 16px;
  font-size: 22px;
  font-weight: 700;
  padding: 14px 0;
  box-shadow: var(--shadow-soft);
}

.keypad__key:active {
  transform: scale(0.95);
  background: var(--mint-soft);
}

.keypad__key--ghost {
  font-size: 15px;
  color: var(--muted);
  background: transparent;
  box-shadow: none;
}
</style>
