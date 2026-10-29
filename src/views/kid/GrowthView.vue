<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { BADGES, DIMENSIONS, MODULES, dimensionName } from '@shared/constants'
import type { AttentionDimension } from '@shared/types'
import { useDataStore } from '@/stores/data'
import { dimensionAverages, moduleStats, recentRecords, streakDays, weeklyTrend } from '@/training/stats'
import { formatDateTime } from '@/utils/time'
import EChart from '@/components/EChart.vue'

const data = useDataStore()

const records = computed(() => data.myRecords)
const dims = computed(() => dimensionAverages(records.value, 12))
const trend = computed(() => weeklyTrend(records.value, 7))
const stats = computed(() => moduleStats(records.value))
const streak = computed(() => streakDays(records.value))
const recent = computed(() => recentRecords(records.value, 6))

const ownedBadges = computed(() => new Set(data.myProfile?.badges.map((b) => b.id) ?? []))

const radarOption = computed(() => ({
  tooltip: {},
  radar: {
    indicator: DIMENSIONS.map((d) => ({ name: d.name, max: 100 })),
    radius: '62%',
    splitNumber: 4,
    axisName: { color: '#6b6257', fontSize: 11 },
    splitArea: { areaStyle: { color: ['#fffdf9', '#f9f3ea'] } },
    splitLine: { lineStyle: { color: '#ecdfce' } },
    axisLine: { lineStyle: { color: '#ecdfce' } },
  },
  series: [
    {
      type: 'radar',
      symbolSize: 5,
      data: [
        {
          value: DIMENSIONS.map((d) => dims.value[d.key] ?? 0),
          name: '最近表现',
          areaStyle: { color: 'rgba(126, 207, 176, 0.35)' },
          lineStyle: { color: '#4eab8a', width: 2 },
          itemStyle: { color: '#4eab8a' },
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
      lineStyle: { color: '#4eab8a', width: 3 },
      itemStyle: { color: '#4eab8a' },
      areaStyle: { color: 'rgba(126, 207, 176, 0.22)' },
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

const moduleOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  grid: { left: 104, right: 34, top: 20, bottom: 24 },
  xAxis: { type: 'value', max: 100, splitLine: { lineStyle: { color: '#f4ebdf' } }, axisLabel: { color: '#918779' } },
  yAxis: {
    type: 'category',
    data: stats.value.map((s) => s.name),
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: '#6b6257', fontSize: 12 },
  },
  series: [
    {
      type: 'bar',
      data: stats.value.map((s) => s.avgScore),
      barWidth: 14,
      itemStyle: { color: '#c9b8e8', borderRadius: [0, 8, 8, 0] },
      label: { show: true, position: 'right', color: '#8b8279', fontSize: 11 },
    },
  ],
}))

function dimScore(key: AttentionDimension) {
  return dims.value[key] ?? 0
}

onMounted(() => {
  if (!data.loaded) data.fetchState().catch(() => {})
})
</script>

<template>
  <div class="page">
    <div class="row row--between">
      <div>
        <h1 class="section-title" style="font-size: 22px">我的成长</h1>
        <p class="section-sub">看看六种注意力正在怎么长高</p>
      </div>
      <span class="pill pill--butter">🔥 连续 {{ streak }} 天</span>
    </div>

    <div class="grid grid--2 mt-16">
      <div class="card">
        <h2 class="section-title" style="font-size: 16px">六维注意力雷达</h2>
        <EChart :option="radarOption" height="300px" />
      </div>
      <div class="card">
        <h2 class="section-title" style="font-size: 16px">最近七天</h2>
        <EChart :option="trendOption" height="300px" />
      </div>
    </div>

    <div class="card mt-16">
      <h2 class="section-title" style="font-size: 16px">各训练平均分</h2>
      <EChart :option="moduleOption" height="260px" />
    </div>

    <div class="grid grid--3 mt-16">
      <div v-for="d in DIMENSIONS" :key="d.key" class="card dim-card">
        <div class="row row--between">
          <span class="emoji-lg">{{ d.emoji }}</span>
          <strong class="dim-card__value">{{ dimScore(d.key) }}</strong>
        </div>
        <strong>{{ d.name }}</strong>
        <span class="hint">{{ d.desc }}</span>
        <div class="progress mt-8">
          <div class="progress__fill" :style="{ width: dimScore(d.key) + '%' }"></div>
        </div>
      </div>
    </div>

    <section class="mt-24">
      <h2 class="section-title">徽章墙</h2>
      <p class="section-sub">已点亮 {{ ownedBadges.size }} / {{ BADGES.length }} 枚</p>
      <div class="grid grid--auto mt-8">
        <div
          v-for="badge in BADGES"
          :key="badge.id"
          class="card badge-card"
          :class="{ 'is-locked': !ownedBadges.has(badge.id) }"
        >
          <span class="emoji-lg">{{ ownedBadges.has(badge.id) ? badge.emoji : '🔒' }}</span>
          <strong>{{ badge.name }}</strong>
          <span class="hint">{{ badge.desc }}</span>
        </div>
      </div>
    </section>

    <section class="mt-24">
      <h2 class="section-title">最近的训练</h2>
      <div v-if="recent.length" class="card mt-8" style="padding: 8px 16px">
        <table class="table">
          <thead>
            <tr>
              <th>训练</th>
              <th>得分</th>
              <th>正确率</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in recent" :key="r.id">
              <td>{{ MODULES.find((m) => m.id === r.module)?.emoji }} {{ MODULES.find((m) => m.id === r.module)?.name ?? r.module }}</td>
              <td><strong>{{ r.score }}</strong></td>
              <td>{{ Math.round(r.accuracy * 100) }}%</td>
              <td class="muted">{{ formatDateTime(r.startedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="hint mt-8">还没有训练记录，先去练一次吧。</p>
    </section>

    <p class="hint center mt-24">
      小提示：单项分数有高有低很正常，看一周的整体趋势才更准。
    </p>
  </div>
</template>

<style scoped>
.dim-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dim-card__value {
  font-size: 24px;
  color: var(--mint-deep);
}

.badge-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: left;
}

.badge-card.is-locked {
  opacity: 0.55;
  filter: grayscale(0.4);
}
</style>
