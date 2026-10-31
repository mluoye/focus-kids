<script setup lang="ts">
import { computed, ref } from 'vue'
import { ARITHMETIC_DIFFICULTIES, ARITHMETIC_MODES, AVATARS, STORY_MATH_GRADES } from '@shared/constants'
import type { ArithmeticDifficulty, ArithmeticMode, StoryMathGrade } from '@shared/types'
import { api } from '@/api/client'
import { useDataStore } from '@/stores/data'
import { useUiStore } from '@/stores/ui'
import { formatDate } from '@/utils/time'

const data = useDataStore()
const ui = useUiStore()

const showForm = ref(false)
const editingId = ref('')
const name = ref('')
const avatar = ref(AVATARS[0])
const pin = ref('')
const arithmeticMode = ref<ArithmeticMode>('choice')
const arithmeticDifficulty = ref<ArithmeticDifficulty>(1)
const storymathGrade = ref<StoryMathGrade>(1)
const submitting = ref(false)
const error = ref('')

const isEditing = computed(() => !!editingId.value)

const profileRows = computed(() =>
  data.profiles.map((p) => ({
    ...p,
    recordCount: data.records.filter((r) => r.profileId === p.id).length,
    homeworkCount: data.homework.filter((h) => h.profileId === p.id && h.status === 'done').length,
  })),
)

function openCreate() {
  editingId.value = ''
  name.value = ''
  avatar.value = AVATARS[0]
  pin.value = ''
  arithmeticMode.value = 'choice'
  arithmeticDifficulty.value = 1
  storymathGrade.value = 1
  error.value = ''
  showForm.value = true
}

function openEdit(id: string) {
  const profile = data.profiles.find((p) => p.id === id)
  if (!profile) return
  editingId.value = id
  name.value = profile.name
  avatar.value = profile.avatar
  pin.value = ''
  arithmeticMode.value = profile.arithmeticMode ?? 'choice'
  arithmeticDifficulty.value = profile.arithmeticDifficulty ?? 1
  storymathGrade.value = profile.storymathGrade ?? 1
  error.value = ''
  showForm.value = true
}

async function submit() {
  error.value = ''
  if (!name.value.trim()) {
    error.value = '请填写孩子昵称'
    return
  }
  if (!isEditing.value && !/^\d{4}$/.test(pin.value)) {
    error.value = '请设置 4 位数字 PIN'
    return
  }
  if (isEditing.value && pin.value && !/^\d{4}$/.test(pin.value)) {
    error.value = 'PIN 必须是 4 位数字'
    return
  }
  submitting.value = true
  try {
    if (isEditing.value) {
      const payload: Record<string, unknown> = {
        name: name.value.trim(),
        avatar: avatar.value,
        arithmeticMode: arithmeticMode.value,
        arithmeticDifficulty: arithmeticDifficulty.value,
        storymathGrade: storymathGrade.value,
      }
      if (pin.value) payload.pin = pin.value
      await api.updateProfile(editingId.value, payload)
      ui.toast('档案已更新')
    } else {
      await api.createProfile({ name: name.value.trim(), avatar: avatar.value, pin: pin.value })
      ui.toast('档案创建成功')
    }
    await data.refreshProfiles()
    showForm.value = false
  } catch (err: any) {
    error.value = err?.message ?? '保存失败'
  } finally {
    submitting.value = false
  }
}

async function remove(id: string) {
  const profile = data.profiles.find((p) => p.id === id)
  if (!profile) return
  if (!window.confirm(`确定删除「${profile.name}」吗？该孩子的训练记录会一起删除，无法恢复。`)) return
  try {
    await api.deleteProfile(id)
    await data.refreshProfiles()
    ui.toast('档案已删除')
  } catch (err: any) {
    ui.toast(err?.message ?? '删除失败')
  }
}
</script>

<template>
  <div class="stack">
    <div class="row row--between">
      <div>
        <h1 class="section-title" style="font-size: 22px">孩子档案</h1>
        <p class="section-sub">每个孩子独立的积分、徽章与训练数据</p>
      </div>
      <button class="btn btn--primary btn--small" @click="openCreate">+ 新建档案</button>
    </div>

    <div v-if="!profileRows.length" class="card card--pad center">
      <p class="emoji-xl">🧒</p>
      <p class="hint mt-8">还没有档案，创建一个吧。</p>
    </div>

    <div class="grid grid--auto">
      <div v-for="p in profileRows" :key="p.id" class="card profile-card">
        <div class="row row--between">
          <span class="emoji-xl">{{ p.avatar }}</span>
          <span class="pill pill--butter">⭐ {{ p.points }}</span>
        </div>
        <strong style="font-size: 18px">{{ p.name }}</strong>
        <p class="hint">创建于 {{ formatDate(p.createdAt) }}</p>
        <div class="row row--wrap">
          <span class="pill">{{ p.recordCount }} 次训练</span>
          <span class="pill">{{ p.homeworkCount }} 次作业</span>
          <span class="pill pill--lav">{{ p.badges.length }} 枚徽章</span>
        </div>
        <div class="row mt-8">
          <button class="btn btn--small grow" @click="openEdit(p.id)">编辑 / 重置 PIN</button>
          <button class="btn btn--ghost btn--small" style="color: var(--rose-deep)" @click="remove(p.id)">删除</button>
        </div>
      </div>
    </div>

    <div v-if="showForm" class="overlay" @click.self="showForm = false">
      <div class="modal">
        <h2 class="section-title">{{ isEditing ? '编辑档案' : '新建孩子档案' }}</h2>
        <p class="section-sub">PIN 用于孩子自己登录，请选一个孩子记得住的数字</p>

        <div class="stack mt-16">
          <div>
            <label class="label">昵称</label>
            <input v-model="name" class="input" maxlength="12" placeholder="例如：小满" />
          </div>
          <div>
            <label class="label">头像</label>
            <div class="avatar-grid">
              <button
                v-for="a in AVATARS"
                :key="a"
                class="avatar-option"
                :class="{ 'is-active': avatar === a }"
                @click="avatar = a"
              >
                {{ a }}
              </button>
            </div>
          </div>
          <div>
            <label class="label">{{ isEditing ? '新的 4 位 PIN（留空则不修改）' : '4 位数字 PIN' }}</label>
            <input
              v-model="pin"
              class="input"
              inputmode="numeric"
              maxlength="4"
              placeholder="例如 1234"
            />
          </div>
          <div v-if="isEditing">
            <label class="label">口算速算 · 作答方式</label>
            <select v-model="arithmeticMode" class="input">
              <option v-for="m in ARITHMETIC_MODES" :key="m.key" :value="m.key">{{ m.name }}（{{ m.desc }}）</option>
            </select>
          </div>
          <div v-if="isEditing">
            <label class="label">口算速算 · 默认难度</label>
            <select v-model="arithmeticDifficulty" class="input">
              <option v-for="d in ARITHMETIC_DIFFICULTIES" :key="d.key" :value="d.key">{{ d.name }}（{{ d.desc }}）</option>
            </select>
            <p class="hint mt-4">孩子每次进入速算仍可临时换难度，这里是默认档</p>
          </div>
          <div v-if="isEditing">
            <label class="label">AI 应用题 · 默认年级</label>
            <select v-model="storymathGrade" class="input">
              <option v-for="g in STORY_MATH_GRADES" :key="g.key" :value="g.key">{{ g.name }}（{{ g.desc }}）</option>
            </select>
            <p class="hint mt-4">孩子每次进入应用题仍可临时换年级，这里是默认档；需在「AI 设置」开启 AI 能力</p>
          </div>
          <p v-if="error" class="hint" style="color: var(--rose-deep)">{{ error }}</p>
          <div class="row">
            <button class="btn grow" @click="showForm = false">取消</button>
            <button class="btn btn--primary grow" :disabled="submitting" @click="submit">
              {{ submitting ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.avatar-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 8px;
}

.avatar-option {
  font-size: 22px;
  padding: 8px 0;
  border-radius: 12px;
  border: 2px solid var(--line);
  background: #fff;
}

.avatar-option.is-active {
  border-color: var(--mint-deep);
  background: var(--mint-soft);
}
</style>
