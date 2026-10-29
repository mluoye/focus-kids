<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { BlockedRange, LimitSettings } from '@shared/types'
import { DEFAULT_LIMITS } from '@shared/constants'
import { useDataStore } from '@/stores/data'
import { useUiStore } from '@/stores/ui'
import { blockedRangeNow } from '@/utils/time'

const data = useDataStore()
const ui = useUiStore()

const form = reactive<LimitSettings>({
  ...DEFAULT_LIMITS,
  blockedRanges: [...DEFAULT_LIMITS.blockedRanges],
})
const saving = ref(false)
const loaded = ref(false)

watch(
  () => data.settings,
  (settings) => {
    if (!settings || loaded.value) return
    Object.assign(form, settings.limits)
    form.blockedRanges = settings.limits.blockedRanges.map((r) => ({ ...r }))
    loaded.value = true
  },
  { immediate: true },
)

watch(
  () => data.settings?.limits,
  (limits) => {
    if (!limits || !loaded.value) return
    Object.assign(form, limits)
    form.blockedRanges = limits.blockedRanges.map((r) => ({ ...r }))
  },
  { deep: true },
)

const blockedNow = computed(() => blockedRangeNow(form))
const todayRows = computed(() =>
  data.profiles.map((p) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const records = data.records.filter((r) => r.profileId === p.id && r.startedAt >= today.getTime())
    const counted = records.filter((r) => r.module !== 'pomodoro')
    return {
      profile: p,
      minutes: Math.round(counted.reduce((a, b) => a + b.durationSec, 0) / 60),
      pomodoro: records.filter((r) => r.module === 'pomodoro').length,
    }
  }),
)

function addRange() {
  form.blockedRanges.push({ start: '21:30', end: '07:30', label: '休息时间' })
}

function removeRange(index: number) {
  form.blockedRanges.splice(index, 1)
}

async function save() {
  saving.value = true
  try {
    await data.updateSettings({ limits: { ...form } })
    ui.toast('防沉迷设置已保存')
  } catch (err: any) {
    ui.toast(err?.message ?? '保存失败')
  } finally {
    saving.value = false
  }
}

function restoreDefaults() {
  Object.assign(form, DEFAULT_LIMITS)
  form.blockedRanges = DEFAULT_LIMITS.blockedRanges.map((r) => ({ ...r }))
}
</script>

<template>
  <div class="stack">
    <div>
      <h1 class="section-title" style="font-size: 22px">防沉迷与节奏</h1>
      <p class="section-sub">限制的是训练类游戏，作业番茄钟永远可用</p>
    </div>

    <div class="card card--pad">
      <h2 class="section-title" style="font-size: 16px">每日与单次上限</h2>
      <div class="grid grid--2 mt-16">
        <div>
          <label class="label">每日训练总时长（分钟）</label>
          <input v-model.number="form.dailyTrainingMinutes" class="input" type="number" min="5" max="240" />
          <p class="hint mt-8">只统计训练游戏，番茄钟不计入。</p>
        </div>
        <div>
          <label class="label">连续训练多久后强制休息（分钟）</label>
          <input v-model.number="form.sessionMinutes" class="input" type="number" min="5" max="60" />
          <p class="hint mt-8">到时间会弹出不可跳过的休息倒计时。</p>
        </div>
        <div>
          <label class="label">每次休息时长（分钟）</label>
          <input v-model.number="form.breakMinutes" class="input" type="number" min="1" max="30" />
        </div>
        <div>
          <label class="label">每日徽章解锁上限（枚）</label>
          <input v-model.number="form.dailyBadgeLimit" class="input" type="number" min="1" max="30" />
          <p class="hint mt-8">服务端强制生效，防止一次刷完所有徽章。</p>
        </div>
      </div>

      <label class="row mt-16" style="gap: 10px; cursor: pointer">
        <input v-model="form.homeworkExempt" type="checkbox" style="width: 20px; height: 20px; accent-color: var(--mint-deep)" />
        <span>作业番茄钟不受每日训练上限限制（推荐开启）</span>
      </label>
    </div>

    <div class="card card--pad">
      <div class="row row--between">
        <div>
          <h2 class="section-title" style="font-size: 16px">禁用时段</h2>
          <p class="section-sub">例如睡觉前只允许做作业，不允许玩训练游戏</p>
        </div>
        <button class="btn btn--small" @click="addRange">添加时段</button>
      </div>

      <div v-if="!form.blockedRanges.length" class="hint mt-16">还没有设置禁用时段。</div>

      <div v-for="(range, i) in form.blockedRanges" :key="i" class="range-row mt-16">
        <input v-model="range.start" class="input" type="time" style="max-width: 130px" />
        <span class="muted">至</span>
        <input v-model="range.end" class="input" type="time" style="max-width: 130px" />
        <input v-model="range.label" class="input" placeholder="名称，如 睡觉时间" />
        <button class="btn btn--ghost btn--small" @click="removeRange(i)">删除</button>
      </div>

      <p v-if="blockedNow" class="pill pill--peach mt-16">现在是「{{ blockedNow.label }}」时段，训练游戏已锁定</p>
    </div>

    <div class="card card--pad">
      <h2 class="section-title" style="font-size: 16px">今天的使用情况</h2>
      <table class="table mt-8">
        <thead>
          <tr>
            <th>孩子</th>
            <th>已用训练</th>
            <th>额度</th>
            <th>番茄钟轮次</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in todayRows" :key="row.profile.id">
            <td>{{ row.profile.avatar }} {{ row.profile.name }}</td>
            <td>{{ row.minutes }} 分钟</td>
            <td>
              <div class="progress" style="max-width: 160px">
                <div class="progress__fill" :style="{ width: Math.min(100, (row.minutes / form.dailyTrainingMinutes) * 100) + '%' }"></div>
              </div>
            </td>
            <td class="muted">{{ row.pomodoro }} 次</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="row">
      <button class="btn grow" @click="restoreDefaults">恢复推荐默认值</button>
      <button class="btn btn--primary grow" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存设置' }}</button>
    </div>
  </div>
</template>

<style scoped>
.range-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.range-row .input {
  flex: none;
}

.range-row .input:last-of-type {
  flex: 1;
  min-width: 140px;
}
</style>
