<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { DIMENSIONS, MODULES } from '@shared/constants'
import { isHomeworkStale } from '@shared/homework'
import type { TrainingRecord } from '@shared/types'
import { useDataStore } from '@/stores/data'
import { streamAi } from '@/api/client'
import { aiSummary, dimensionAverages, moduleStats, recentRecords, streakDays, weeklyTrend } from '@/training/stats'
import { formatDateTime, todayStart } from '@/utils/time'
import { renderAiText } from '@/utils/aiText'
import EChart from '@/components/EChart.vue'

const data = useDataStore()
const selectedId = ref('')
const tab = ref<'week' | 'all'>('week')

const profiles = computed(() => data.profiles)
const activeProfile = computed(() => profiles.value.find((p) => p.id === selectedId.value) ?? profiles.value[0] ?? null)

const profileRecords = computed<TrainingRecord[]>(() =>
  data.records.filter((r) => r.profileId === activeProfile.value?.id),
)

const filteredRecords = computed(() => {
  if (tab.value === 'all') return profileRecords.value
  const since = Date.now() - 7 * 24 * 3600 * 1000
  return profileRecords.value.filter((r) => r.startedAt >= since)
})

const dims = computed(() => dimensionAverages(profileRecords.value, 12))
const trend = computed(() => weeklyTrend(profileRecords.value, 7))
const stats = computed(() => moduleStats(profileRecords.value))
const streak = computed(() => streakDays(profileRecords.value))
const weekMinutes = computed(() => trend.value.reduce((a, b) => a + b.minutes, 0))
const weekCount = computed(() => trend.value.reduce((a, b) => a + b.count, 0))
const todayRecords = computed(() => profileRecords.value.filter((r) => r.startedAt >= todayStart()))
const todayMinutes = computed(() => {
  const counted = todayRecords.value.filter((r) => MODULES.find((m) => m.id === r.module)?.countsTowardDailyLimit)
  return Math.round(counted.reduce((a, b) => a + b.durationSec, 0) / 60)
})
const dailyLimit = computed(() => data.settings?.limits.dailyTrainingMinutes ?? 40)

const now = ref(Date.now())
let nowTimer: number | undefined

/** 家长端「正在写作业」卡片：只看当前孩子、2 小时内还在进行的会话。 */
const runningHomework = computed(() => {
  const pid = activeProfile.value?.id
  if (!pid) return null
  return (
    data.homework
      .filter((h) => h.profileId === pid && h.status === 'running' && !isHomeworkStale(h, now.value))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
  )
})
const runningDone = computed(() => runningHomework.value?.items.filter((i) => i.done).length ?? 0)
const runningTotal = computed(() => runningHomework.value?.items.length ?? 0)
const runningPercent = computed(() =>
  runningTotal.value ? Math.round((runningDone.value / runningTotal.value) * 100) : 0,
)
const runningRound = computed(
  () => runningHomework.value?.progress?.roundIndex ?? runningHomework.value?.rounds.length ?? 0,
)
const runningFocusMinutes = computed(() => {
  const hw = runningHomework.value
  if (!hw) return 0
  const finished = hw.rounds.reduce((sum, r) => sum + r.focusMinutes, 0)
  const progress = hw.progress
  if (!progress) return Math.round(finished)
  let current = 0
  if (progress.step === 'focus') {
    current = Math.max(0, (hw.plannedFocusMinutes * 60 - progress.focusLeftSec) / 60)
    // 进行中且没暂停：把上次同步到现在的时间也算上，家长看到的分钟数不会停在 0
    if (!progress.paused) current += Math.max(0, (now.value - hw.updatedAt) / 60000)
    current = Math.min(current, hw.plannedFocusMinutes)
  }
  return Math.round(finished + current)
})
const runningPaused = computed(() => runningHomework.value?.progress?.paused === true)

const distraction = computed(() => {
  const map = new Map<string, number>()
  for (const record of recentRecords(profileRecords.value, 12)) {
    for (const error of record.errors ?? []) {
      map.set(error.type, (map.get(error.type) ?? 0) + error.count)
    }
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
})

const radarOption = computed(() => ({
  radar: {
    indicator: DIMENSIONS.map((d) => ({ name: d.name, max: 100 })),
    radius: '62%',
    splitNumber: 4,
    axisName: { color: '#6b6257', fontSize: 11 },
    splitArea: { areaStyle: { color: ['#fffdf9', '#f9f3ea'] } },
    splitLine: { lineStyle: { color: '#ecdfce' } },
    axisLine: { lineStyle: { color: '#ecdfce' } },
  },
  tooltip: {},
  series: [
    {
      type: 'radar',
      data: [
        {
          value: DIMENSIONS.map((d) => dims.value[d.key] ?? 0),
          name: '平均表现',
          areaStyle: { color: 'rgba(201, 184, 232, 0.4)' },
          lineStyle: { color: '#8f76cc', width: 2 },
          itemStyle: { color: '#8f76cc' },
        },
      ],
    },
  ],
}))

const trendOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  grid: { left: 42, right: 44, top: 30, bottom: 28 },
  legend: { data: ['平均分', '训练分钟'], top: 0, textStyle: { fontSize: 11, color: '#8b8279' } },
  xAxis: {
    type: 'category',
    data: trend.value.map((d) => d.label),
    axisLine: { lineStyle: { color: '#ecdfce' } },
    axisLabel: { color: '#918779', fontSize: 11 },
  },
  yAxis: [
    { type: 'value', max: 100, splitLine: { lineStyle: { color: '#f4ebdf' } }, axisLabel: { color: '#918779', fontSize: 11 } },
    { type: 'value', splitLine: { show: false }, axisLabel: { color: '#918779', fontSize: 11 } },
  ],
  series: [
    {
      name: '平均分',
      type: 'line',
      smooth: true,
      data: trend.value.map((d) => d.score),
      lineStyle: { color: '#8f76cc', width: 3 },
      itemStyle: { color: '#8f76cc' },
      areaStyle: { color: 'rgba(201, 184, 232, 0.25)' },
    },
    {
      name: '训练分钟',
      type: 'bar',
      yAxisIndex: 1,
      barWidth: 12,
      itemStyle: { color: '#ffd8a8', borderRadius: [6, 6, 0, 0] },
      data: trend.value.map((d) => d.minutes),
    },
  ],
}))

const insight = ref('')
const insightLoading = ref(false)
const insightError = ref('')
const report = ref('')
const reportLoading = ref(false)
const reportError = ref('')

async function generateInsight() {
  if (!activeProfile.value || insightLoading.value) return
  insight.value = ''
  insightError.value = ''
  insightLoading.value = true
  try {
    await streamAi('insight', {
      profileName: activeProfile.value.name,
      stats: aiSummary(profileRecords.value, activeProfile.value.name),
      weeklyTrend: trend.value,
      modules: stats.value.map((s) => ({ name: s.name, count: s.count, avgScore: s.avgScore })),
      distractions: distraction.value.map(([type, count]) => ({ type, count })),
      todayMinutes: todayMinutes.value,
    }, (delta) => {
      insight.value += delta
    })
  } catch (err: any) {
    insightError.value = err?.message ?? 'AI 分析失败'
  } finally {
    insightLoading.value = false
  }
}

async function generateReport() {
  if (!activeProfile.value || reportLoading.value) return
  report.value = ''
  reportError.value = ''
  reportLoading.value = true
  try {
    await streamAi('weekly-report', {
      profileName: activeProfile.value.name,
      week: trend.value,
      dimensions: dims.value,
      modules: stats.value.map((s) => ({ name: s.name, count: s.count, avgScore: s.avgScore })),
      streakDays: streak.value,
      badgeCount: activeProfile.value.badges.length,
    }, (delta) => {
      report.value += delta
    })
  } catch (err: any) {
    reportError.value = err?.message ?? '周报生成失败'
  } finally {
    reportLoading.value = false
  }
}

function copyText(text: string) {
  if (!text) return
  navigator.clipboard?.writeText(text)
}

onMounted(() => {
  if (!data.loaded) data.fetchState().catch(() => {})
  if (!selectedId.value && profiles.value[0]) selectedId.value = profiles.value[0].id
  nowTimer = window.setInterval(() => {
    now.value = Date.now()
  }, 30_000)
})

onBeforeUnmount(() => {
  if (nowTimer) clearInterval(nowTimer)
})
</script>

<template>
  <div v-if="!profiles.length" class="card card--pad center">
    <p class="emoji-xl">👶</p>
    <h2 class="section-title mt-8">还没有孩子档案</h2>
    <p class="hint mt-8">先创建一个档案，孩子才能开始训练。</p>
    <RouterLink :to="{ name: 'parent-profiles' }" class="btn btn--primary mt-16">去创建</RouterLink>
  </div>

  <div v-else class="stack">
    <div class="row row--between row--wrap">
      <div class="row row--wrap">
        <button
          v-for="p in profiles"
          :key="p.id"
          class="btn btn--small"
          :class="{ 'btn--primary': activeProfile?.id === p.id }"
          @click="selectedId = p.id"
        >
          {{ p.avatar }} {{ p.name }}
        </button>
      </div>
      <div class="row">
        <button class="btn btn--small" :class="{ 'btn--primary': tab === 'week' }" @click="tab = 'week'">近 7 天</button>
        <button class="btn btn--small" :class="{ 'btn--primary': tab === 'all' }" @click="tab = 'all'">全部</button>
      </div>
    </div>

    <div class="grid grid--auto">
      <div class="card stat-card">
        <span class="stat-icon">⭐</span>
        <div>
          <strong class="big-number">{{ activeProfile?.points ?? 0 }}</strong>
          <p class="hint">累计积分</p>
        </div>
      </div>
      <div class="card stat-card">
        <span class="stat-icon">⏱</span>
        <div>
          <strong class="big-number">{{ weekMinutes }}</strong>
          <p class="hint">近 7 天分钟</p>
        </div>
      </div>
      <div class="card stat-card">
        <span class="stat-icon">🎯</span>
        <div>
          <strong class="big-number">{{ weekCount }}</strong>
          <p class="hint">近 7 天训练次数</p>
        </div>
      </div>
      <div class="card stat-card">
        <span class="stat-icon">🔥</span>
        <div>
          <strong class="big-number">{{ streak }}</strong>
          <p class="hint">连续训练天数</p>
        </div>
      </div>
      <div class="card stat-card">
        <span class="stat-icon">⏳</span>
        <div>
          <strong class="big-number">{{ todayMinutes }}<small class="muted">/{{ dailyLimit }}</small></strong>
          <p class="hint">今日已用训练额度</p>
        </div>
      </div>
      <div class="card stat-card">
        <span class="stat-icon">🏅</span>
        <div>
          <strong class="big-number">{{ activeProfile?.badges.length ?? 0 }}</strong>
          <p class="hint">已点亮徽章</p>
        </div>
      </div>
    </div>

    <div v-if="runningHomework" class="card running-card">
      <div class="row row--between row--wrap">
        <div class="row">
          <span class="running-dot"></span>
          <div>
            <strong>{{ activeProfile?.name }} 正在写作业</strong>
            <p class="hint mt-8">
              {{ runningPaused ? '计时暂停中' : '第 ' + runningRound + ' 轮' }} ·
              清单 {{ runningDone }}/{{ runningTotal }} 项 · 已专注 {{ runningFocusMinutes }} 分钟
            </p>
            <p class="hint">最近更新 {{ formatDateTime(runningHomework.updatedAt) }}</p>
          </div>
        </div>
        <span class="pill pill--mint">进行中</span>
      </div>
      <div class="progress mt-16">
        <div class="progress__fill" :style="{ width: runningPercent + '%' }"></div>
      </div>
    </div>

    <div class="grid grid--2">
      <div class="card">
        <h2 class="section-title" style="font-size: 16px">六维注意力</h2>
        <EChart :option="radarOption" height="290px" />
      </div>
      <div class="card">
        <h2 class="section-title" style="font-size: 16px">近 7 天趋势</h2>
        <EChart :option="trendOption" height="290px" />
      </div>
    </div>

    <div class="grid grid--2">
      <div class="card">
        <div class="row row--between">
          <div>
            <h2 class="section-title" style="font-size: 16px">分心归因与对策</h2>
            <p class="section-sub">AI 根据错误类型和时段给建议</p>
          </div>
          <button class="btn btn--small btn--lav" :disabled="insightLoading" @click="generateInsight">
            {{ insightLoading ? '分析中…' : '生成分析' }}
          </button>
        </div>

        <div v-if="distraction.length" class="row row--wrap mt-16">
          <span v-for="[type, count] in distraction" :key="type" class="pill pill--peach">{{ type }} × {{ count }}</span>
        </div>
        <p v-else class="hint mt-16">暂无错误类型数据，多练几次会更准。</p>

        <div v-if="insight" class="ai-panel mt-16">
          <div class="ai-text" v-html="renderAiText(insight)"></div>
          <button class="btn btn--ghost btn--small mt-8" @click="copyText(insight)">复制</button>
        </div>
        <p v-if="insightError" class="hint mt-16" style="color: var(--rose-deep)">{{ insightError }}</p>
      </div>

      <div class="card">
        <div class="row row--between">
          <div>
            <h2 class="section-title" style="font-size: 16px">本周成长周报</h2>
            <p class="section-sub">自动整理成可分享的文字</p>
          </div>
          <button class="btn btn--small btn--primary" :disabled="reportLoading" @click="generateReport">
            {{ reportLoading ? '生成中…' : '生成周报' }}
          </button>
        </div>
        <div v-if="report" class="ai-panel mt-16">
          <div class="ai-text" v-html="renderAiText(report)"></div>
          <button class="btn btn--ghost btn--small mt-8" @click="copyText(report)">复制</button>
        </div>
        <p v-else class="hint mt-16">周报包含本周亮点、需要关注、下周训练建议和亲子小任务。</p>
        <p v-if="reportError" class="hint mt-8" style="color: var(--rose-deep)">{{ reportError }}</p>
      </div>
    </div>

    <div class="card">
      <div class="row row--between">
        <h2 class="section-title" style="font-size: 16px">最近训练记录</h2>
        <RouterLink :to="{ name: 'parent-records' }" class="btn btn--ghost btn--small">查看全部 →</RouterLink>
      </div>
      <table v-if="filteredRecords.length" class="table mt-8">
        <thead>
          <tr>
            <th>孩子</th>
            <th>训练</th>
            <th>得分</th>
            <th>正确率</th>
            <th>时长</th>
            <th>时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in filteredRecords.slice(0, 8)" :key="r.id">
            <td>{{ profiles.find((p) => p.id === r.profileId)?.name ?? '—' }}</td>
            <td>{{ MODULES.find((m) => m.id === r.module)?.name ?? r.module }}</td>
            <td><strong>{{ r.score }}</strong></td>
            <td>{{ Math.round(r.accuracy * 100) }}%</td>
            <td>{{ Math.round(r.durationSec / 60) }} 分</td>
            <td class="muted">{{ formatDateTime(r.startedAt) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="hint mt-8">这个时间段还没有训练记录。</p>
    </div>
  </div>
</template>

<style scoped>
.stat-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
}

.stat-icon {
  font-size: 26px;
}

.running-card {
  background: linear-gradient(160deg, #f3fbf6, #e8f6ee 90%);
  border: 1px solid rgba(63, 154, 120, 0.22);
}

.running-dot {
  flex: none;
  width: 10px;
  height: 10px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--mint-deep, #3f9a78);
  box-shadow: 0 0 0 4px rgba(63, 154, 120, 0.16);
  animation: running-pulse 1.8s ease-in-out infinite;
}

@keyframes running-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}

.big-number small {
  font-size: 14px;
  font-weight: 600;
}

.ai-panel {
  background: var(--lav-soft);
  border-radius: 16px;
  padding: 14px 16px;
  line-height: 1.85;
  font-size: 14.5px;
}

.ai-text :deep(.ai-line) {
  line-height: 1.85;
}

.ai-text :deep(.ai-line--li) {
  padding-left: 1.05em;
  text-indent: -1.05em;
}

.ai-text :deep(.ai-line--li)::before {
  content: '· ';
  color: var(--lav-deep, #7d6bb5);
}

.ai-text :deep(.ai-line--h) {
  font-weight: 700;
  color: var(--ink);
}

.ai-text :deep(.ai-gap) {
  height: 0.55em;
}

.ai-text :deep(strong) {
  color: var(--ink);
}
</style>
