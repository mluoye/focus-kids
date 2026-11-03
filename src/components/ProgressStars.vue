<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  /** 今天完成的训练次数 */
  todayCount: number
  /** 连续训练天数 */
  streakDays: number
  /** 今日目标（默认 3 次） */
  goal?: number
}>()

const goalCount = computed(() => props.goal ?? 3)

/** 星星数量：完成次数占目标的比例，最多 5 颗星 */
const starCount = computed(() => {
  if (props.todayCount === 0) return 0
  return Math.min(5, Math.ceil((props.todayCount / goalCount.value) * 3))
})

/** 鼓励语 */
const encouragement = computed(() => {
  if (props.todayCount === 0) return '今天还没有开始，来练一个吧！'
  if (props.todayCount < goalCount.value) return '做得好，再练一个就更棒了！'
  if (props.todayCount === goalCount.value) return '太棒了，今天的目标完成了！'
  return '哇，你超额完成啦，真是专注力小明星！'
})

/** 星星列表 */
const stars = computed(() => {
  return Array.from({ length: 5 }, (_, i) => i < starCount.value)
})
</script>

<template>
  <div class="progress-stars">
    <div class="progress-stars__header">
      <span class="progress-stars__title">今日进步</span>
      <span class="progress-stars__streak">🔥 连续 {{ streakDays }} 天</span>
    </div>

    <div class="progress-stars__content">
      <div class="progress-stars__count">
        <span class="progress-stars__number">{{ todayCount }}</span>
        <span class="progress-stars__label">次训练</span>
      </div>

      <div class="progress-stars__stars">
        <span
          v-for="(lit, i) in stars"
          :key="i"
          class="progress-stars__star"
          :class="{ 'progress-stars__star--lit': lit }"
        >
          ⭐
        </span>
      </div>
    </div>

    <p class="progress-stars__message">{{ encouragement }}</p>
  </div>
</template>

<style scoped>
.progress-stars {
  padding: 1.25rem;
  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
  border-radius: 1rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.progress-stars__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.progress-stars__title {
  font-size: 1rem;
  font-weight: 600;
  color: #78350f;
}

.progress-stars__streak {
  font-size: 0.875rem;
  color: #92400e;
  background: rgba(255, 255, 255, 0.5);
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
}

.progress-stars__content {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  margin-bottom: 0.75rem;
}

.progress-stars__count {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.progress-stars__number {
  font-size: 2rem;
  font-weight: 700;
  color: #78350f;
  line-height: 1;
}

.progress-stars__label {
  font-size: 0.75rem;
  color: #92400e;
  margin-top: 0.25rem;
}

.progress-stars__stars {
  display: flex;
  gap: 0.25rem;
  flex: 1;
}

.progress-stars__star {
  font-size: 1.5rem;
  opacity: 0.3;
  filter: grayscale(100%);
  transition: all 0.3s ease;
}

.progress-stars__star--lit {
  opacity: 1;
  filter: none;
  animation: starPop 0.4s ease;
}

@keyframes starPop {
  0% {
    transform: scale(0.8);
  }
  50% {
    transform: scale(1.2);
  }
  100% {
    transform: scale(1);
  }
}

.progress-stars__message {
  font-size: 0.875rem;
  color: #92400e;
  margin: 0;
  text-align: center;
}
</style>
