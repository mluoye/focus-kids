<script setup lang="ts">
import { computed } from 'vue'
import { BADGES } from '@shared/constants'

const props = defineProps<{
  /** 已获得的徽章 ID 列表 */
  ownedBadgeIds: string[]
}>()

/** 徽章列表（带获得状态） */
const badges = computed(() => {
  return BADGES.map((badge) => ({
    ...badge,
    owned: props.ownedBadgeIds.includes(badge.id),
  }))
})

/** 已获得数量 */
const ownedCount = computed(() => badges.value.filter((b) => b.owned).length)

/** 总数 */
const totalCount = computed(() => BADGES.length)

/** 完成度百分比 */
const completionPercent = computed(() => Math.round((ownedCount.value / totalCount.value) * 100))
</script>

<template>
  <div class="badge-wall">
    <div class="badge-wall__header">
      <h2 class="badge-wall__title">🏅 我的徽章墙</h2>
      <div class="badge-wall__progress">
        <span class="badge-wall__count">{{ ownedCount }}/{{ totalCount }}</span>
        <div class="badge-wall__progress-bar">
          <div class="badge-wall__progress-fill" :style="{ width: completionPercent + '%' }"></div>
        </div>
      </div>
    </div>

    <div class="badge-wall__grid">
      <div
        v-for="badge in badges"
        :key="badge.id"
        class="badge-wall__item"
        :class="{ 'badge-wall__item--owned': badge.owned }"
      >
        <div class="badge-wall__emoji">{{ badge.owned ? badge.emoji : '🔒' }}</div>
        <div class="badge-wall__name">{{ badge.name }}</div>
        <div class="badge-wall__desc">{{ badge.desc }}</div>
        <div v-if="badge.owned" class="badge-wall__owned-tag">已获得</div>
      </div>
    </div>

    <p v-if="ownedCount < totalCount" class="badge-wall__hint">
      继续训练，解锁更多徽章！还有 {{ totalCount - ownedCount }} 枚等你来拿 🌟
    </p>
    <p v-else class="badge-wall__hint badge-wall__hint--complete">
      太厉害了！你已经收集了所有徽章！🎉
    </p>
  </div>
</template>

<style scoped>
.badge-wall {
  padding: 1.5rem;
  background: linear-gradient(135deg, #fff8e2 0%, #f0eafb 100%);
  border-radius: 1.5rem;
}

.badge-wall__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.badge-wall__title {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0;
  color: #3d372f;
}

.badge-wall__progress {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.badge-wall__count {
  font-size: 1rem;
  font-weight: 600;
  color: #5f574d;
}

.badge-wall__progress-bar {
  width: 120px;
  height: 8px;
  background: rgba(0, 0, 0, 0.1);
  border-radius: 4px;
  overflow: hidden;
}

.badge-wall__progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #7ecfb0, #4eab8a);
  transition: width 0.3s ease;
}

.badge-wall__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 1rem;
  margin-bottom: 1rem;
}

.badge-wall__item {
  padding: 1rem;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 1rem;
  text-align: center;
  opacity: 0.5;
  transition: all 0.3s ease;
}

.badge-wall__item--owned {
  opacity: 1;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.badge-wall__emoji {
  font-size: 2.5rem;
  margin-bottom: 0.5rem;
}

.badge-wall__name {
  font-size: 0.875rem;
  font-weight: 600;
  color: #3d372f;
  margin-bottom: 0.25rem;
}

.badge-wall__desc {
  font-size: 0.75rem;
  color: #918779;
  line-height: 1.4;
}

.badge-wall__owned-tag {
  display: inline-block;
  margin-top: 0.5rem;
  padding: 0.25rem 0.5rem;
  background: #4eab8a;
  color: #fff;
  font-size: 0.625rem;
  border-radius: 999px;
}

.badge-wall__hint {
  font-size: 0.875rem;
  color: #5f574d;
  text-align: center;
  margin: 0;
}

.badge-wall__hint--complete {
  color: #4eab8a;
  font-weight: 600;
}
</style>
