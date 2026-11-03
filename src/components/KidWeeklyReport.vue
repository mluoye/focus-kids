<script setup lang="ts">
import { computed } from 'vue'
import type { TrainingRecord } from '@shared/types'
import { MODULES } from '@shared/constants'
import { streakDays, weeklyTrend } from '@/training/stats'

const props = defineProps<{
  records: TrainingRecord[]
  profileName: string
  profileAvatar: string
  badges: { id: string; unlockedAt: number }[]
}>()

const trend = computed(() => weeklyTrend(props.records, 7))
const streak = computed(() => streakDays(props.records))

/** 本周训练次数 */
const weekCount = computed(() => trend.value.reduce((a, b) => a + b.count, 0))

/** 本周训练分钟 */
const weekMinutes = computed(() => trend.value.reduce((a, b) => a + b.minutes, 0))

/** 本周平均分 */
const weekAvgScore = computed(() => {
  const weekRecords = props.records.filter((r) => {
    const d = new Date(r.startedAt)
    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000)
    return d >= weekAgo
  })
  if (weekRecords.length === 0) return 0
  return Math.round(weekRecords.reduce((a, b) => a + b.score, 0) / weekRecords.length)
})

/** 上周训练次数（用于对比） */
const lastWeekCount = computed(() => {
  const now = new Date()
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 3600 * 1000)
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000)
  const lastWeekRecords = props.records.filter((r) => {
    const d = new Date(r.startedAt)
    return d >= twoWeeksAgo && d < weekAgo
  })
  return lastWeekRecords.length
})

/** 进步百分比（与上周对比） */
const improvement = computed(() => {
  if (lastWeekCount.value === 0) return weekCount.value > 0 ? 100 : 0
  return Math.round(((weekCount.value - lastWeekCount.value) / lastWeekCount.value) * 100)
})

/** 本周最常玩的模块 */
const favoriteModule = computed(() => {
  const weekRecords = props.records.filter((r) => {
    const d = new Date(r.startedAt)
    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000)
    return d >= weekAgo
  })
  if (weekRecords.length === 0) return null
  const counts = new Map<string, number>()
  for (const r of weekRecords) {
    counts.set(r.module, (counts.get(r.module) ?? 0) + 1)
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  const meta = MODULES.find((m) => m.id === top[0])
  return meta?.name ?? null
})

/** 本周获得的徽章 */
const weekBadges = computed(() => {
  const now = Date.now()
  const weekAgo = now - 7 * 24 * 3600 * 1000
  return props.badges.filter((b) => b.unlockedAt >= weekAgo)
})

/** 鼓励语 */
const encouragement = computed(() => {
  if (weekCount.value === 0) return '这周还没有开始练习，来试试吧！'
  if (improvement.value > 0) return `比上周多练了 ${improvement.value}%，太棒了！`
  if (improvement.value === 0) return '和上周一样努力，继续保持！'
  return '这周辛苦了，下周继续加油！'
})

/** 星星数量（根据训练次数） */
const starCount = computed(() => {
  if (weekCount.value === 0) return 0
  return Math.min(5, Math.ceil(weekCount.value / 3))
})
</script>

<template>
  <div class="kid-weekly-report">
    <!-- 头部 -->
    <div class="kid-weekly-report__header">
      <span class="kid-weekly-report__avatar">{{ profileAvatar }}</span>
      <div>
        <h2 class="kid-weekly-report__title">{{ profileName }}的一周报告</h2>
        <p class="kid-weekly-report__subtitle">看看这周你有多棒！</p>
      </div>
    </div>

    <!-- 星星展示 -->
    <div class="kid-weekly-report__stars">
      <span
        v-for="i in 5"
        :key="i"
        class="kid-weekly-report__star"
        :class="{ 'kid-weekly-report__star--lit': i <= starCount }"
      >
        ⭐
      </span>
    </div>

    <!-- 数据卡片 -->
    <div class="kid-weekly-report__stats">
      <div class="kid-weekly-report__stat">
        <span class="kid-weekly-report__stat-value">{{ weekCount }}</span>
        <span class="kid-weekly-report__stat-label">次练习</span>
      </div>
      <div class="kid-weekly-report__stat">
        <span class="kid-weekly-report__stat-value">{{ streak }}</span>
        <span class="kid-weekly-report__stat-label">连续天数</span>
      </div>
      <div class="kid-weekly-report__stat">
        <span class="kid-weekly-report__stat-value">{{ weekMinutes }}</span>
        <span class="kid-weekly-report__stat-label">分钟</span>
      </div>
    </div>

    <!-- 进步对比 -->
    <div class="kid-weekly-report__improvement">
      <div class="kid-weekly-report__improvement-icon">
        {{ improvement > 0 ? '📈' : improvement === 0 ? '➡️' : '💪' }}
      </div>
      <p class="kid-weekly-report__improvement-text">{{ encouragement }}</p>
    </div>

    <!-- 本周最爱 -->
    <div v-if="favoriteModule" class="kid-weekly-report__favorite">
      <span class="kid-weekly-report__favorite-label">本周最爱</span>
      <span class="kid-weekly-report__favorite-value">{{ favoriteModule }}</span>
    </div>

    <!-- 本周徽章 -->
    <div v-if="weekBadges.length" class="kid-weekly-report__badges">
      <span class="kid-weekly-report__badges-label">这周获得了 {{ weekBadges.length }} 个徽章</span>
      <div class="kid-weekly-report__badges-list">
        <span
          v-for="badge in weekBadges"
          :key="badge.id"
          class="kid-weekly-report__badge"
        >
          🏅
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kid-weekly-report {
  padding: 1.5rem;
  background: linear-gradient(135deg, #eaf7f0 0%, #fff4e6 55%, #f3ecfd 100%);
  border-radius: 1.5rem;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.kid-weekly-report__header {
  display: flex;
  gap: 1rem;
  align-items: center;
  margin-bottom: 1.5rem;
}

.kid-weekly-report__avatar {
  font-size: 3rem;
}

.kid-weekly-report__title {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0;
  color: #3d372f;
}

.kid-weekly-report__subtitle {
  font-size: 1rem;
  color: #5f574d;
  margin: 0.25rem 0 0;
}

.kid-weekly-report__stars {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
}

.kid-weekly-report__star {
  font-size: 2rem;
  opacity: 0.3;
  filter: grayscale(100%);
}

.kid-weekly-report__star--lit {
  opacity: 1;
  filter: none;
}

.kid-weekly-report__stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.kid-weekly-report__stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 1rem;
}

.kid-weekly-report__stat-value {
  font-size: 2rem;
  font-weight: 700;
  color: #4eab8a;
  line-height: 1;
}

.kid-weekly-report__stat-label {
  font-size: 0.875rem;
  color: #5f574d;
  margin-top: 0.25rem;
}

.kid-weekly-report__improvement {
  display: flex;
  gap: 1rem;
  align-items: center;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 1rem;
  margin-bottom: 1rem;
}

.kid-weekly-report__improvement-icon {
  font-size: 2rem;
}

.kid-weekly-report__improvement-text {
  font-size: 1rem;
  margin: 0;
  color: #3d372f;
}

.kid-weekly-report__favorite {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 1rem;
  margin-bottom: 1rem;
}

.kid-weekly-report__favorite-label {
  font-size: 0.875rem;
  color: #5f574d;
}

.kid-weekly-report__favorite-value {
  font-size: 1rem;
  font-weight: 600;
  color: #3d372f;
}

.kid-weekly-report__badges {
  padding: 1rem;
  background: rgba(255, 248, 226, 0.9);
  border-radius: 1rem;
}

.kid-weekly-report__badges-label {
  display: block;
  font-size: 0.875rem;
  color: #92400e;
  margin-bottom: 0.5rem;
}

.kid-weekly-report__badges-list {
  display: flex;
  gap: 0.5rem;
}

.kid-weekly-report__badge {
  font-size: 1.5rem;
}
</style>
