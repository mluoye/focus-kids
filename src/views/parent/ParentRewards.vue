<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDataStore } from '@/stores/data'
import { useUiStore } from '@/stores/ui'
import { addReward, deleteReward, loadRewards, type Reward } from '@/utils/rewards'
import { getKidFriendlyError } from '@/utils/errorMessages'

const data = useDataStore()
const ui = useUiStore()

const showForm = ref(false)
const formData = ref({
  name: '',
  description: '',
  emoji: '🎁',
  conditionType: 'training_count' as Reward['conditionType'],
  conditionValue: 10,
})

const selectedProfileId = ref(data.profiles[0]?.id ?? '')

const emojiOptions = ['🎁', '🏆', '🌟', '🎯', '🎮', '📚', '🍕', '🍦', '🎪', '🎨']

const conditionTypeOptions = [
  { value: 'training_count', label: '累计训练次数' },
  { value: 'streak_days', label: '连续训练天数' },
  { value: 'points', label: '成长积分' },
  { value: 'manual', label: '手动标记完成' },
]

/** 当前孩子的奖励列表 */
const rewards = computed(() => {
  if (!selectedProfileId.value) return []
  return loadRewards(selectedProfileId.value)
})

/** 当前孩子的进度值 */
const currentValue = computed(() => {
  const profile = data.profiles.find((p) => p.id === selectedProfileId.value)
  if (!profile) return 0

  switch (formData.value.conditionType) {
    case 'training_count':
      return data.records.filter((r) => r.profileId === selectedProfileId.value).length
    case 'streak_days':
      return 0 // 需要从 stats 获取，简化处理
    case 'points':
      return profile.points
    default:
      return 0
  }
})

async function submitForm() {
  if (!selectedProfileId.value) {
    ui.toast('请先选择孩子')
    return
  }
  if (!formData.value.name.trim()) {
    ui.toast('请填写奖励名称')
    return
  }
  if (formData.value.conditionValue < 1) {
    ui.toast('达成条件至少为 1')
    return
  }

  try {
    addReward(selectedProfileId.value, {
      name: formData.value.name.trim(),
      description: formData.value.description.trim(),
      emoji: formData.value.emoji,
      conditionType: formData.value.conditionType,
      conditionValue: formData.value.conditionValue,
    })
    ui.toast('奖励已添加！')
    resetForm()
    showForm.value = false
  } catch (err: any) {
    ui.toast(err?.message ?? '添加奖励失败')
  }
}

function resetForm() {
  formData.value = {
    name: '',
    description: '',
    emoji: '🎁',
    conditionType: 'training_count',
    conditionValue: 10,
  }
}

function handleDelete(rewardId: string) {
  if (confirm('确定要删除这个奖励吗？')) {
    deleteReward(selectedProfileId.value, rewardId)
    ui.toast('奖励已删除')
  }
}

function getConditionText(reward: Reward): string {
  const typeLabel = conditionTypeOptions.find((o) => o.value === reward.conditionType)?.label ?? ''
  return `${typeLabel}达到 ${reward.conditionValue}`
}
</script>

<template>
  <div class="page">
    <div class="row row--between">
      <div>
        <h1 class="section-title">奖励管理</h1>
        <p class="section-sub">为孩子设置奖励目标，激励他们坚持训练</p>
      </div>
      <button class="btn btn--primary" @click="showForm = !showForm">
        {{ showForm ? '取消' : '+ 添加奖励' }}
      </button>
    </div>

    <!-- 选择孩子 -->
    <div class="card card--pad mt-16">
      <label class="label">选择孩子</label>
      <select v-model="selectedProfileId" class="input">
        <option value="">请选择</option>
        <option v-for="p in data.profiles" :key="p.id" :value="p.id">
          {{ p.avatar }} {{ p.name }}
        </option>
      </select>
    </div>

    <!-- 添加奖励表单 -->
    <div v-if="showForm" class="card card--pad mt-16">
      <h2 class="section-title" style="font-size: 18px">添加新奖励</h2>

      <div class="stack mt-16">
        <div>
          <label class="label">奖励图标</label>
          <div class="row row--wrap">
            <button
              v-for="emoji in emojiOptions"
              :key="emoji"
              class="emoji-picker"
              :class="{ 'emoji-picker--selected': formData.emoji === emoji }"
              @click="formData.emoji = emoji"
            >
              {{ emoji }}
            </button>
          </div>
        </div>

        <div>
          <label class="label">奖励名称</label>
          <input v-model="formData.name" class="input" placeholder="例如：看一场电影" />
        </div>

        <div>
          <label class="label">奖励描述（可选）</label>
          <textarea v-model="formData.description" class="input" rows="2" placeholder="详细描述这个奖励" />
        </div>

        <div>
          <label class="label">达成条件</label>
          <select v-model="formData.conditionType" class="input">
            <option v-for="opt in conditionTypeOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <div v-if="formData.conditionType !== 'manual'">
          <label class="label">目标数值</label>
          <input
            v-model.number="formData.conditionValue"
            class="input"
            type="number"
            min="1"
            :placeholder="formData.conditionType === 'training_count' ? '例如：10' : formData.conditionType === 'streak_days' ? '例如：7' : '例如：100'"
          />
        </div>

        <button class="btn btn--primary btn--block" @click="submitForm">保存奖励</button>
      </div>
    </div>

    <!-- 奖励列表 -->
    <div v-if="selectedProfileId" class="mt-24">
      <h2 class="section-title" style="font-size: 18px">已设置的奖励 ({{ rewards.length }})</h2>

      <div v-if="rewards.length === 0" class="card card--pad center mt-16">
        <p class="muted">还没有设置奖励，点击右上角「添加奖励」开始吧！</p>
      </div>

      <div v-else class="grid grid--2 mt-16">
        <div v-for="reward in rewards" :key="reward.id" class="card card--pad reward-card">
          <div class="row row--between">
            <div class="grow">
              <div class="row">
                <span class="reward-card__emoji">{{ reward.emoji }}</span>
                <div>
                  <p class="reward-card__name">{{ reward.name }}</p>
                  <p v-if="reward.description" class="reward-card__desc">{{ reward.description }}</p>
                </div>
              </div>
              <p class="reward-card__condition">{{ getConditionText(reward) }}</p>
              <p v-if="reward.claimed" class="reward-card__claimed">✓ 已领取</p>
            </div>
            <button class="btn btn--ghost btn--small" @click="handleDelete(reward.id)">删除</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.emoji-picker {
  font-size: 1.5rem;
  padding: 0.5rem;
  border: 2px solid var(--line);
  border-radius: 0.5rem;
  background: #fff;
  cursor: pointer;
  transition: all 0.2s;
}

.emoji-picker--selected {
  border-color: var(--mint-deep);
  background: var(--mint-soft);
  transform: scale(1.1);
}

.reward-card {
  position: relative;
}

.reward-card__emoji {
  font-size: 2rem;
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
  padding: 0.25rem 0.5rem;
  background: var(--mint-soft);
  border-radius: 0.25rem;
  display: inline-block;
}

.reward-card__claimed {
  font-size: 0.75rem;
  color: var(--mint-deep);
  margin: 0.5rem 0 0;
  font-weight: 600;
}
</style>
