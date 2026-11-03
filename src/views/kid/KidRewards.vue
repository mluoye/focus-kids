<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDataStore } from '@/stores/data'
import { useSessionStore } from '@/stores/session'
import { useUiStore } from '@/stores/ui'
import { claimReward, loadRewards, type Reward } from '@/utils/rewards'
import { playBadgeSound } from '@/utils/sounds'
import { vibrateMedium } from '@/utils/haptics'

const data = useDataStore()
const session = useSessionStore()
const ui = useUiStore()

const selectedProfileId = ref(data.profiles[0]?.id ?? '')

/** 当前孩子的奖励列表 */
const rewards = computed(() => {
  if (!selectedProfileId.value) return []
  return loadRewards(selectedProfileId.value)
})

/** 未领取的奖励 */
const unclaimedRewards = computed(() => rewards.value.filter((r) => !r.claimed))

/** 已领取的奖励 */
const claimedRewards = computed(() => rewards.value.filter((r) => r.claimed))

/** 当前孩子的训练次数 */
const trainingCount = computed(() => {
  if (!selectedProfileId.value) return 0
  return data.records.filter((r) => r.profileId === selectedProfileId.value).length
})

/** 当前孩子的积分 */
const points = computed(() => {
  const profile = data.profiles.find((p) => p.id === selectedProfileId.value)
  return profile?.points ?? 0
})

/** 获取当前进度值 */
function getCurrentValue(reward: Reward): number {
  switch (reward.conditionType) {
    case 'training_count':
      return trainingCount.value
    case 'points':
      return points.value
    case 'streak_days':
      return 0 // 简化处理
    case 'manual':
      return reward.conditionValue // 手动标记的奖励视为已达成
    default:
      return 0
  }
}

/** 是否已达成 */
function isAchieved(reward: Reward): boolean {
  return getCurrentValue(reward) >= reward.conditionValue
}

/** 进度百分比 */
function getProgress(reward: Reward): number {
  if (reward.conditionType === 'manual') return 100
  const current = getCurrentValue(reward)
  return Math.min(100, Math.round((current / reward.conditionValue) * 100))
}

/** 领取奖励 */
function handleClaim(reward: Reward) {
  if (!selectedProfileId.value) return
  claimReward(selectedProfileId.value, reward.id)
  playBadgeSound()
  vibrateMedium()
  ui.toast(`🎉 恭喜你获得了「${reward.name}」！`)
}

/** 获取条件文本 */
function getConditionText(reward: Reward): string {
  const typeLabels: Record<Reward['conditionType'], string> = {
    training_count: '累计训练',
    streak_days: '连续训练',
    points: '成长积分',
    manual: '家长手动标记',
  }
  if (reward.conditionType === 'manual') return typeLabels[reward.conditionType]
  return `${typeLabels[reward.conditionType]} ${getCurrentValue(reward)}/${reward.conditionValue}`
}
</script>

<template>
  <div class="page">
    <div class="row row--between">
      <div>
        <h1 class="section-title">🎁 我的奖励</h1>
        <p class="section-sub">完成训练目标，领取爸爸妈妈准备的奖励吧！</p>
      </div>
    </div>

    <!-- 选择孩子（家长临时解锁时使用） -->
    <div v-if="!session.profileId" class="card card--pad mt-16">
      <label class="label">选择孩子</label>
      <select v-model="selectedProfileId" class="input">
        <option value="">请选择</option>
        <option v-for="p in data.profiles" :key="p.id" :value="p.id">
          {{ p.avatar }} {{ p.name }}
        </option>
      </select>
    </div>

    <!-- 未领取的奖励 -->
    <div v-if="selectedProfileId" class="mt-24">
      <h2 class="section-title" style="font-size: 18px">🎯 待领取 ({{ unclaimedRewards.length }})</h2>

      <div v-if="unclaimedRewards.length === 0" class="card card--pad center mt-16">
        <p class="muted">暂时没有待领取的奖励，继续加油！</p>
      </div>

      <div v-else class="grid grid--2 mt-16">
        <div v-for="reward in unclaimedRewards" :key="reward.id" class="card card--pad reward-card">
          <div class="reward-card__header">
            <span class="reward-card__emoji">{{ reward.emoji }}</span>
            <div class="grow">
              <p class="reward-card__name">{{ reward.name }}</p>
              <p v-if="reward.description" class="reward-card__desc">{{ reward.description }}</p>
            </div>
          </div>

          <div class="reward-card__progress">
            <p class="reward-card__condition">{{ getConditionText(reward) }}</p>
            <div class="progress">
              <div class="progress__fill" :style="{ width: getProgress(reward) + '%' }"></div>
            </div>
          </div>

          <button
            v-if="isAchieved(reward)"
            class="btn btn--primary btn--block mt-16"
            @click="handleClaim(reward)"
          >
            🎉 领取奖励
          </button>
        </div>
      </div>
    </div>

    <!-- 已领取的奖励 -->
    <div v-if="selectedProfileId && claimedRewards.length" class="mt-24">
      <h2 class="section-title" style="font-size: 18px">✅ 已领取 ({{ claimedRewards.length }})</h2>

      <div class="grid grid--3 mt-16">
        <div v-for="reward in claimedRewards" :key="reward.id" class="card card--pad reward-card reward-card--claimed">
          <span class="reward-card__emoji">{{ reward.emoji }}</span>
          <p class="reward-card__name">{{ reward.name }}</p>
          <p class="reward-card__claimed-date">
            {{ reward.claimedAt ? new Date(reward.claimedAt).toLocaleDateString() : '' }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.reward-card {
  position: relative;
}

.reward-card--claimed {
  opacity: 0.7;
  background: var(--mint-soft);
}

.reward-card__header {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
}

.reward-card__emoji {
  font-size: 2.5rem;
}

.reward-card__name {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0;
  color: var(--ink);
}

.reward-card__desc {
  font-size: 0.75rem;
  color: var(--muted);
  margin: 0.25rem 0 0;
}

.reward-card__progress {
  margin-top: 1rem;
}

.reward-card__condition {
  font-size: 0.75rem;
  color: var(--ink-soft);
  margin: 0 0 0.5rem;
}

.reward-card__claimed-date {
  font-size: 0.75rem;
  color: var(--mint-deep);
  margin: 0.5rem 0 0;
  font-weight: 600;
}
</style>
