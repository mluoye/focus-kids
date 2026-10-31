<script setup lang="ts">
import { computed, ref } from 'vue'
import { MODULES } from '@shared/constants'
import { useDataStore } from '@/stores/data'
import { formatDateTime } from '@/utils/time'

const data = useDataStore()

const profileFilter = ref('')
const moduleFilter = ref('')

const filtered = computed(() =>
  data.records
    .filter((r) => (profileFilter.value ? r.profileId === profileFilter.value : true))
    .filter((r) => (moduleFilter.value ? r.module === moduleFilter.value : true))
    .sort((a, b) => b.startedAt - a.startedAt),
)

function nameOf(id: string) {
  return data.profiles.find((p) => p.id === id)?.name ?? '—'
}

function moduleName(id: string) {
  return MODULES.find((m) => m.id === id)?.name ?? id
}

/** 番茄钟只有正/负两种判定；旧记录没有 passed 时不显示 */
function verdictOf(record: { module: string; passed?: boolean }): '正' | '负' | '' {
  if (record.module !== 'pomodoro' || typeof record.passed !== 'boolean') return ''
  return record.passed ? '正' : '负'
}

function exportCsv() {
  const header = ['孩子', '训练', '开始时间', '时长(秒)', '难度', '正确率', '平均反应(ms)', '得分', '错误类型', '判定']
  const rows = filtered.value.map((r) => [
    nameOf(r.profileId),
    moduleName(r.module),
    new Date(r.startedAt).toLocaleString('zh-CN'),
    String(r.durationSec),
    String(r.difficulty),
    `${Math.round(r.accuracy * 100)}%`,
    String(r.avgReactionMs),
    String(r.score),
    (r.errors ?? []).map((e) => `${e.type}x${e.count}`).join(' / '),
    verdictOf(r),
  ])
  const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `训练记录_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="stack">
    <div class="row row--between row--wrap">
      <div>
        <h1 class="section-title" style="font-size: 22px">训练记录</h1>
        <p class="section-sub">共 {{ filtered.length }} 条记录，原始数据永久保存</p>
      </div>
      <button class="btn btn--small" :disabled="!filtered.length" @click="exportCsv">导出 CSV</button>
    </div>

    <div class="row row--wrap">
      <select v-model="profileFilter" class="input" style="max-width: 180px">
        <option value="">全部孩子</option>
        <option v-for="p in data.profiles" :key="p.id" :value="p.id">{{ p.avatar }} {{ p.name }}</option>
      </select>
      <select v-model="moduleFilter" class="input" style="max-width: 180px">
        <option value="">全部训练</option>
        <option v-for="m in MODULES" :key="m.id" :value="m.id">{{ m.emoji }} {{ m.name }}</option>
      </select>
    </div>

    <div class="card" style="padding: 8px 16px">
      <table v-if="filtered.length" class="table">
        <thead>
          <tr>
            <th>孩子</th>
            <th>训练</th>
            <th>难度</th>
            <th>得分</th>
            <th>正确率</th>
            <th>反应</th>
            <th>主要错误</th>
            <th>时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in filtered.slice(0, 200)" :key="r.id">
            <td>{{ nameOf(r.profileId) }}</td>
            <td>
              {{ moduleName(r.module) }}
              <span
                v-if="verdictOf(r)"
                class="pill"
                :class="verdictOf(r) === '负' ? 'pill--peach' : 'pill--mint'"
                style="margin-left: 6px; font-size: 11px"
              >
                {{ verdictOf(r) === '负' ? '未完成' : '完成' }}
              </span>
            </td>
            <td>
              <span v-if="r.module === 'arithmetic'" class="pill" style="font-size: 11px">
                {{ ['', '20以内', '100以内', '混合四则'][r.difficulty] ?? '—' }}
              </span>
              <span v-else class="muted">—</span>
            </td>
            <td><strong>{{ r.score }}</strong></td>
            <td>{{ Math.round(r.accuracy * 100) }}%</td>
            <td class="muted">{{ r.avgReactionMs ? r.avgReactionMs + 'ms' : '—' }}</td>
            <td class="muted">
              {{ (r.errors ?? []).slice(0, 2).map((e) => `${e.type}×${e.count}`).join('、') || '—' }}
            </td>
            <td class="muted">{{ formatDateTime(r.startedAt) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="hint center" style="padding: 30px 0">没有符合条件的记录</p>
    </div>
    <p v-if="filtered.length > 200" class="hint center">仅显示最近 200 条，导出 CSV 可获取全部。</p>
  </div>
</template>
