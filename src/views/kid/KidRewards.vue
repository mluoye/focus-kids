<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useDataStore } from '@/stores/data'
import { useSessionStore } from '@/stores/session'
import { useUiStore } from '@/stores/ui'
import { api } from '@/api/client'
import { playBadgeSound } from '@/utils/sounds'
import { vibrateMedium } from '@/utils/haptics'

const data = useDataStore()
const session = useSessionStore()
const ui = useUiStore()

const rewards = ref<any[]>([])
const claims = ref<any[]>([])
const progress = ref<{ trainingCount: number; streakDays: number; availablePoints: number } | null>(null)
const showRedeemForm = ref(false)
const redeemCode = ref('')

async function loadRewards() {
  try {
    const res = await api.getRewards()
    rewards.value = (res.rewards ?? []).filter((r: any) => r.profile_id === session.profileId)
  } catch (err: any) {
    ui.toast(err?.message ?? '加载奖励失败')
  }
}

async function loadClaims() {
  try {
    const res = await api.getRewardClaims()
    claims.value = res.claims ?? []
  } catch (err: any) {
    ui.toast(err?.message ?? '加载领取记录失败')
  }
}

async function loadProgress() {
  if (!session.profileId) return
  try {
    progress.value = await api.getRewardProgress(session.profileId)
  } catch (err: any) {
    ui.toast(err?.message ?? '加载进度失败')
  }
}

onMounted(async () => {
  await Promise.all([loadRewards(), loadClaims(), loadProgress()])
})

/** 获取奖励的领取状态 */
function getClaimStatus(rewardId: string): 'none' | 'pending' | 'approved' | 'rejected' {
  const claim = claims.value.find((c) => c.reward_id === rewardId && c.profile_id === session.profileId)
  return claim?.status ?? 'none'
}

/** 未领取的奖励 */
const unclaimedRewards = computed(() =>
  rewards.value.filter((r) => {
    const status = getClaimStatus(r.id)
    return status === 'none' || status === 'rejected'
  }),
)

/** 待审批的奖励 */
const pendingRewards = computed(() =>
  rewards.value.filter((r) => getClaimStatus(r.id) === 'pending'),
)

/** 已领取的奖励 */
const approvedRewards = computed(() =>
  rewards.value.filter((r) => getClaimStatus(r.id) === 'approved'),
)

/** 某奖励当前的达成进度（服务端权威值） */
function currentProgress(reward: any): number {
  if (!progress.value) return 0
  if (reward.condition_type === 'training_count') return progress.value.trainingCount
  if (reward.condition_type === 'streak_days') return progress.value.streakDays
  if (reward.condition_type === 'points') return progress.value.availablePoints
  return reward.condition_value
}

/** 达成进度百分比（0~100） */
function progressPercent(reward: any): number {
  if (reward.condition_type === 'manual') return 100
  const target = Number(reward.condition_value) || 1
  return Math.min(100, Math.round((currentProgress(reward) / target) * 100))
}

/** 是否已达成（manual 类交由家长审批，视为可提交） */
function isAchieved(reward: any): boolean {
  if (reward.condition_type === 'manual') return true
  return currentProgress(reward) >= Number(reward.condition_value)
}

/** 领取奖励 */
async function handleClaim(rewardId: string) {
  try {
    const res = await api.claimReward(rewardId)
    if (res.requiresApproval) {
      ui.toast('已提交领取请求，等待家长审批')
    } else {
      playBadgeSound()
      vibrateMedium()
      ui.toast('🎉 恭喜你获得了奖励！')
    }
    await Promise.all([loadClaims(), loadProgress()])
  } catch (err: any) {
    ui.toast(err?.message ?? '领取失败')
  }
}

/** 使用兑换码 */
async function handleRedeem() {
  if (!redeemCode.value.trim()) {
    ui.toast('请输入兑换码')
    return
  }
  try {
    const res = await api.redeemRewardCode(redeemCode.value.trim())
    playBadgeSound()
    vibrateMedium()
    ui.toast(`🎉 兑换成功！获得「${res.rewardName}」`)
    redeemCode.value = ''
    showRedeemForm.value = false
  } catch (err: any) {
    ui.toast(err?.message ?? '兑换失败')
  }
}

/** 获取条件文本 */
function getConditionText(reward: any): string {
  const typeLabels: Record<string, string> = {
    training_count: '累计训练',
    streak_days: '连续训练',
    points: '成长积分',
    manual: '爸爸妈妈手动发放',
  }
  const label = typeLabels[reward.condition_type] ?? ''
  if (reward.condition_type === 'manual') return label
  return `${label} ${reward.condition_value} ${reward.condition_type === 'points' ? '分' : reward.condition_type === 'streak_days' ? '天' : '次'}`
}
</script>

<template>
  <div class="page">
    <div class="row row--between">
      <div>
        <h1 class="section-title">🎁 我的奖励</h1>
        <p class="section-sub">完成训练目标，领取爸爸妈妈准备的奖励吧！</p>
      </div>
      <button class="btn btn--ghost btn--small" @click="showRedeemForm = !showRedeemForm">
        🎫 使用兑换码
      </button>
    </div>

    <!-- 使用兑换码 -->
    <div v-if="showRedeemForm" class="card card--pad mt-16">
      <h2 class="section-title" style="font-size: 18px">🎫 使用兑换码</h2>
      <div class="stack mt-16">
        <div>
          <label class="label">兑换码</label>
          <input
            v-model="redeemCode"
            class="input"
            placeholder="输入 8 位兑换码"
            maxlength="8"
            style="text-transform: uppercase; font-family: monospace; letter-spacing: 0.1em"
          />
        </div>
        <button class="btn btn--primary btn--block" @click="handleRedeem">兑换</button>
      </div>
    </div>

    <!-- 待审批 -->
    <div v-if="pendingRewards.length" class="card card--pad mt-16">
      <h2 class="section-title" style="font-size: 18px">⏳ 等待家长审批 ({{ pendingRewards.length }})</h2>
      <div class="stack mt-16">
        <div v-for="reward in pendingRewards" :key="reward.id" class="reward-item reward-item--pending">
          <span class="reward-item__emoji">{{ reward.emoji }}</span>
          <div class="grow">
            <p class="reward-item__name">{{ reward.name }}</p>
            <p class="reward-item__condition">{{ getConditionText(reward) }}</p>
          </div>
          <span class="reward-item__status">等待审批中...</span>
        </div>
      </div>
    </div>

    <!-- 待领取 -->
    <div v-if="unclaimedRewards.length" class="mt-24">
      <h2 class="section-title" style="font-size: 18px">🎯 可领取 ({{ unclaimedRewards.length }})</h2>

      <div class="grid grid--2 mt-16">
        <div v-for="reward in unclaimedRewards" :key="reward.id" class="card card--pad reward-card">
          <div class="reward-card__header">
            <span class="reward-card__emoji">{{ reward.emoji }}</span>
            <div class="grow">
              <p class="reward-card__name">{{ reward.name }}</p>
              <p v-if="reward.description" class="reward-card__desc">{{ reward.description }}</p>
            </div>
          </div>

          <p class="reward-card__condition">{{ getConditionText(reward) }}</p>

          <!-- 达成进度 -->
          <div v-if="reward.condition_type !== 'manual'" class="reward-card__progress">
            <div class="progress-track">
              <div class="progress-fill" :style="{ width: progressPercent(reward) + '%' }"></div>
            </div>
            <p class="progress-text">
              {{ isAchieved(reward) ? '🎉 目标达成！' : `还差 ${Number(reward.condition_value) - currentProgress(reward)} 就达成` }}
            </p>
          </div>

          <button
            class="btn btn--primary btn--block mt-16"
            :disabled="!isAchieved(reward)"
            @click="handleClaim(reward.id)"
          >
            {{ isAchieved(reward) ? '🎉 领取奖励' : '继续加油～' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 已领取 -->
    <div v-if="approvedRewards.length" class="mt-24">
      <h2 class="section-title" style="font-size: 18px">✅ 已领取 ({{ approvedRewards.length }})</h2>

      <div class="grid grid--3 mt-16">
        <div v-for="reward in approvedRewards" :key="reward.id" class="card card--pad reward-card reward-card--claimed">
          <span class="reward-card__emoji">{{ reward.emoji }}</span>
          <p class="reward-card__name">{{ reward.name }}</p>
          <span class="reward-card__claimed-badge">已领取</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.reward-item {
  display: flex;
  gap: 1rem;
  align-items: center;
  padding: 0.75rem;
  background: var(--butter-soft);
  border-radius: 0.5rem;
}

.reward-item--pending {
  background: var(--cream);
}

.reward-item__emoji {
  font-size: 1.5rem;
}

.reward-item__name {
  font-size: 0.875rem;
  font-weight: 600;
  margin: 0;
  color: var(--ink);
}

.reward-item__condition {
  font-size: 0.75rem;
  color: var(--muted);
  margin: 0.25rem 0 0;
}

.reward-item__status {
  font-size: 0.75rem;
  color: var(--butter-deep);
  font-weight: 600;
}

.reward-card--claimed {
  opacity: 0.7;
  background: var(--mint-soft);
  text-align: center;
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
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
  color: var(--ink);
}

.reward-card__desc {
  font-size: 0.75rem;
  color: var(--muted);
  margin: 0.25rem 0 0;
}

.reward-card__condition {
  font-size: 0.75rem;
  color: var(--ink-soft);
  margin: 0.75rem 0 0;
}

.reward-card__progress {
  margin-top: 0.75rem;
}

.progress-track {
  height: 10px;
  background: var(--cream);
  border-radius: 999px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--mint-deep);
  border-radius: 999px;
  transition: width 0.3s ease;
}

.progress-text {
  margin: 0.35rem 0 0;
  font-size: 0.75rem;
  color: var(--muted);
}

.reward-card__claimed-badge {
  display: inline-block;
  margin-top: 0.5rem;
  padding: 0.25rem 0.5rem;
  background: var(--mint-deep);
  color: #fff;
  font-size: 0.625rem;
  border-radius: 999px;
}
</style>
