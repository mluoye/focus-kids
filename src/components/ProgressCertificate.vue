<script setup lang="ts">
import { computed } from 'vue'
import { BADGES } from '@shared/constants'
import type { TrainingRecord } from '@shared/types'
import { streakDays } from '@/training/stats'

const props = defineProps<{
  records: TrainingRecord[]
  profileName: string
  profileAvatar: string
  badges: { id: string; unlockedAt: number }[]
}>()

const emit = defineEmits<{
  close: []
}>()

const totalRecords = computed(() => props.records.length)
const streak = computed(() => streakDays(props.records))
const ownedBadges = computed(() =>
  props.badges
    .map((b) => BADGES.find((badge) => badge.id === b.id))
    .filter(Boolean),
)

/** 证书编号（基于时间戳） */
const certificateNo = computed(() => {
  const now = new Date()
  return `FK-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(totalRecords.value).padStart(4, '0')}`
})

/** 签发日期 */
const issueDate = computed(() => {
  const now = new Date()
  return `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`
})

function print() {
  window.print()
}
</script>

<template>
  <div class="certificate-overlay" @click="emit('close')">
    <div class="certificate" @click.stop>
      <div class="certificate__border">
        <div class="certificate__content">
          <!-- 标题 -->
          <div class="certificate__header">
            <div class="certificate__logo">🧠</div>
            <h1 class="certificate__title">专注力小卫士</h1>
            <h2 class="certificate__subtitle">进步证书</h2>
            <p class="certificate__english">Certificate of Achievement</p>
          </div>

          <!-- 正文 -->
          <div class="certificate__body">
            <p class="certificate__intro">兹证明</p>
            <div class="certificate__name">
              <span class="certificate__avatar">{{ profileAvatar }}</span>
              <span class="certificate__name-text">{{ profileName }}</span>
            </div>
            <p class="certificate__text">
              在专注力训练中表现优异，已累计完成
              <strong>{{ totalRecords }}</strong> 次训练，
              连续训练 <strong>{{ streak }}</strong> 天，
              获得 <strong>{{ ownedBadges.length }}</strong> 枚徽章。
              特此发证，以资鼓励！
            </p>
          </div>

          <!-- 徽章展示 -->
          <div v-if="ownedBadges.length" class="certificate__badges">
            <span v-for="badge in ownedBadges" :key="badge!.id" class="certificate__badge">
              {{ badge!.emoji }}
            </span>
          </div>

          <!-- 签发信息 -->
          <div class="certificate__footer">
            <div class="certificate__date">
              <p class="certificate__label">签发日期</p>
              <p class="certificate__value">{{ issueDate }}</p>
            </div>
            <div class="certificate__no">
              <p class="certificate__label">证书编号</p>
              <p class="certificate__value">{{ certificateNo }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- 操作按钮（打印时隐藏） -->
      <div class="certificate__actions">
        <button class="btn btn--primary" @click="print">🖨️ 打印证书</button>
        <button class="btn" @click="emit('close')">关闭</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.certificate-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.certificate {
  background: #fff;
  border-radius: 1rem;
  max-width: 700px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.certificate__border {
  padding: 1.5rem;
  border: 8px double #d9a521;
  margin: 1rem;
  border-radius: 0.5rem;
}

.certificate__content {
  padding: 2rem;
  text-align: center;
}

.certificate__logo {
  font-size: 4rem;
  margin-bottom: 1rem;
}

.certificate__title {
  font-size: 2rem;
  font-weight: 700;
  color: #3d372f;
  margin: 0;
  letter-spacing: 0.1em;
}

.certificate__subtitle {
  font-size: 1.75rem;
  font-weight: 600;
  color: #d9a521;
  margin: 0.5rem 0 0;
}

.certificate__english {
  font-size: 0.875rem;
  color: #918779;
  margin: 0.25rem 0 0;
  font-style: italic;
}

.certificate__body {
  margin: 2rem 0;
}

.certificate__intro {
  font-size: 1rem;
  color: #5f574d;
  margin: 0 0 1rem;
}

.certificate__name {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
}

.certificate__avatar {
  font-size: 3rem;
}

.certificate__name-text {
  font-size: 2.5rem;
  font-weight: 700;
  color: #4eab8a;
  border-bottom: 3px solid #4eab8a;
  padding-bottom: 0.25rem;
}

.certificate__text {
  font-size: 1.125rem;
  line-height: 1.8;
  color: #3d372f;
  margin: 0;
  max-width: 500px;
  margin: 0 auto;
}

.certificate__badges {
  display: flex;
  justify-content: center;
  gap: 0.75rem;
  margin: 1.5rem 0;
  flex-wrap: wrap;
}

.certificate__badge {
  font-size: 2rem;
}

.certificate__footer {
  display: flex;
  justify-content: space-around;
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid #efe3d3;
}

.certificate__date,
.certificate__no {
  text-align: center;
}

.certificate__label {
  font-size: 0.75rem;
  color: #918779;
  margin: 0 0 0.25rem;
}

.certificate__value {
  font-size: 0.875rem;
  color: #3d372f;
  font-weight: 600;
  margin: 0;
}

.certificate__actions {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  padding: 1rem;
}

@media print {
  .certificate-overlay {
    position: static;
    background: none;
    padding: 0;
  }

  .certificate {
    box-shadow: none;
    max-width: none;
    max-height: none;
  }

  .certificate__actions {
    display: none;
  }
}
</style>
