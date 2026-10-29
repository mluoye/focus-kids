<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDataStore } from '@/stores/data'
import { useUiStore } from '@/stores/ui'
import { api } from '@/api/client'

const data = useDataStore()
const ui = useUiStore()

const profileId = ref('') // '' = 全部孩子
const exportRange = ref('all') // all | 30 | 90 | 365 | custom
const exportFrom = ref('')
const exportTo = ref('')
const pruneDays = ref('90')
const busy = ref(false)
const confirmPrune = ref(false)
const lastResult = ref('')

function nameOf(id: string) {
  return data.profiles.find((p) => p.id === id)?.name ?? '—'
}

const totalBytes = computed(() => {
  const bytes =
    JSON.stringify(data.records).length +
    JSON.stringify(data.homework).length +
    JSON.stringify(data.homeworkPlans).length
  return bytes
})
const bytesLabel = computed(() =>
  totalBytes.value > 1024 * 1024
    ? `${(totalBytes.value / 1024 / 1024).toFixed(1)} MB`
    : `${(totalBytes.value / 1024).toFixed(0)} KB`,
)

const byProfile = computed(() =>
  data.profiles.map((p) => ({
    ...p,
    records: data.records.filter((r) => r.profileId === p.id).length,
    homework: data.homework.filter((h) => h.profileId === p.id).length,
  })),
)

function rangeBounds() {
  const now = Date.now()
  if (exportRange.value === 'all') return { from: 0, to: now }
  const days = Number(exportRange.value)
  if (Number.isFinite(days) && days > 0) return { from: now - days * 24 * 3600 * 1000, to: now }
  const f = exportFrom.value ? new Date(`${exportFrom.value}T00:00:00`).getTime() : 0
  const t = exportTo.value ? new Date(`${exportTo.value}T23:59:59`).getTime() : now
  return { from: Number.isFinite(f) ? f : 0, to: Number.isFinite(t) ? t : now }
}

async function doExport() {
  if (busy.value) return
  busy.value = true
  lastResult.value = ''
  try {
    const { from, to } = rangeBounds()
    const res = await api.exportState({ profileId: profileId.value || undefined, from, to })
    if (!res.records.length && !res.homework.length) {
      lastResult.value = '该范围内没有数据，未生成备份'
      ui.toast('该范围内没有数据')
      return
    }
    const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const who = profileId.value ? nameOf(profileId.value) : '全部孩子'
    a.href = url
    a.download = `专注力数据备份_${who}_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    lastResult.value = `已导出 ${res.counts.records} 条训练记录、${res.counts.homework} 个作业会话`
    ui.toast('备份已下载')
  } catch (err: any) {
    lastResult.value = `导出失败：${err?.message ?? err}`
    ui.toast(err?.message ?? '导出失败')
  } finally {
    busy.value = false
  }
}

const cutoff = computed(() => Date.now() - Number(pruneDays.value || 90) * 24 * 3600 * 1000)
const preview = computed(() => {
  const pid = profileId.value
  const before = cutoff.value
  const m = (owner: string, t: number) => (!pid || owner === pid) && t < before
  const records = data.records.filter((r) => m(r.profileId, r.endedAt)).length
  const homework = data.homework.filter((h) => h.status !== 'running' && m(h.profileId, h.endedAt ?? h.updatedAt)).length
  return { records, homework }
})

async function doPrune() {
  if (busy.value) return
  if (!confirmPrune.value) {
    confirmPrune.value = true
    return
  }
  busy.value = true
  lastResult.value = ''
  try {
    const res = await api.pruneState({ profileId: profileId.value || undefined, before: cutoff.value })
    lastResult.value = `已清理 ${res.removed.records} 条记录、${res.removed.homework} 个作业会话；服务器备份：${res.backupFile}`
    confirmPrune.value = false
    ui.toast('清理完成，数据已备份')
    await data.fetchState()
  } catch (err: any) {
    lastResult.value = `清理失败：${err?.message ?? err}`
    ui.toast(err?.message ?? '清理失败')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="stack">
    <div>
      <h1 class="section-title" style="font-size: 22px">数据管理</h1>
      <p class="section-sub">训练记录与作业会话只增不减，建议定期导出备份；清理前服务端会先自动备份</p>
    </div>

    <div class="card card--pad">
      <h2 class="section-title" style="font-size: 16px">数据概览</h2>
      <p class="section-sub">
        共 <b>{{ data.records.length }}</b> 条训练记录、<b>{{ data.homework.length }}</b> 个作业会话，约 <b>{{ bytesLabel }}</b>
      </p>
      <table v-if="byProfile.length" class="table" style="margin-top: 12px">
        <thead>
          <tr>
            <th>孩子</th>
            <th>训练记录</th>
            <th>作业会话</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in byProfile" :key="p.id">
            <td>{{ p.avatar }} {{ p.name }}</td>
            <td>{{ p.records }}</td>
            <td>{{ p.homework }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card card--pad">
      <h2 class="section-title" style="font-size: 16px">导出 JSON 备份</h2>
      <p class="section-sub">按孩子与时间范围导出完整记录（训练 + 作业），用于留档、迁移或清理前备份</p>
      <div class="row row--wrap" style="margin-top: 12px">
        <select v-model="profileId" class="input" style="max-width: 180px">
          <option value="">全部孩子</option>
          <option v-for="p in data.profiles" :key="p.id" :value="p.id">{{ p.avatar }} {{ p.name }}</option>
        </select>
        <select v-model="exportRange" class="input" style="max-width: 180px">
          <option value="all">全部时间</option>
          <option value="30">最近 30 天</option>
          <option value="90">最近 90 天</option>
          <option value="365">最近 1 年</option>
          <option value="custom">自定义范围</option>
        </select>
        <template v-if="exportRange === 'custom'">
          <input v-model="exportFrom" type="date" class="input" style="max-width: 170px" />
          <span>至</span>
          <input v-model="exportTo" type="date" class="input" style="max-width: 170px" />
        </template>
        <button class="btn btn--small" :disabled="busy" @click="doExport">导出 JSON 备份</button>
      </div>
    </div>

    <div class="card card--pad">
      <h2 class="section-title" style="font-size: 16px">清理历史数据</h2>
      <p class="section-sub">
        删除指定日期之前的记录与作业会话（进行中的会话不受影响）。<b>清理前服务端会自动把被删数据写入
        backup/ 目录</b>，可在 NAS 上访问；如需长期留档请先用上方「导出 JSON 备份」。
      </p>
      <div class="row row--wrap" style="margin-top: 12px">
        <select v-model="profileId" class="input" style="max-width: 180px">
          <option value="">全部孩子</option>
          <option v-for="p in data.profiles" :key="p.id" :value="p.id">{{ p.avatar }} {{ p.name }}</option>
        </select>
        <select v-model="pruneDays" class="input" style="max-width: 180px">
          <option value="30">清理 30 天前</option>
          <option value="90">清理 90 天前</option>
          <option value="180">清理 180 天前</option>
          <option value="365">清理 1 年前</option>
        </select>
        <button class="btn btn--small" :class="{ 'btn--danger': confirmPrune }" :disabled="busy" @click="doPrune">
          {{ confirmPrune ? `确认删除 ${preview.records} 条记录 / ${preview.homework} 个会话？` : `清理 ${pruneDays} 天前数据` }}
        </button>
      </div>
      <p v-if="confirmPrune" class="hint" style="margin-top: 8px; color: var(--danger, #d64541)">
        点击「确认删除」将真正删除（约 {{ preview.records }} 条记录、{{ preview.homework }} 个会话），服务端会先备份
      </p>
    </div>

    <p v-if="lastResult" class="hint">{{ lastResult }}</p>
  </div>
</template>
