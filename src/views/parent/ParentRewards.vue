<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useDataStore } from '@/stores/data'
import { useSessionStore } from '@/stores/session'
import { useUiStore } from '@/stores/ui'
import { api } from '@/api/client'

const data = useDataStore()
const session = useSessionStore()
const ui = useUiStore()

const showForm = ref(false)
const formData = ref({
  name: '',
  description: '',
  emoji: '🎁',
  conditionType: 'training_count' as 'training_count' | 'streak_days' | 'points' | 'manual',
  conditionValue: 10,
  requiresApproval: false,
})

const selectedProfileId = ref(data.profiles[0]?.id ?? '')

const emojiOptions = ['🎁', '🏆', '🌟', '🎯', '🎮', '📚', '🍕', '🍦', '🎪', '🎨']

const conditionTypeOptions = [
  { value: 'training_count', label: '累计训练次数' },
  { value: 'streak_days', label: '连续训练天数' },
  { value: 'points', label: '成长积分' },
  { value: 'manual', label: '手动标记完成' },
]

// 奖励列表
const rewards = ref<any[]>([])
const pendingClaims = ref<any[]>([])
const showCodeForm = ref(false)
const codeForm = ref({ rewardName: '', rewardDesc: '' })
const generatedCode = ref('')
const generatedCodeList = ref<any[]>([])

async function loadRewards() {
  try {
    const res = await api.getRewards()
    rewards.value = res.rewards ?? []
  } catch (err: any) {
    ui.toast(err?.message ?? '加载奖励失败')
  }
}

async function loadPendingClaims() {
  try {
    const res = await api.getRewardClaims()
    pendingClaims.value = (res.claims ?? []).filter((c: any) => c.status === 'pending')
  } catch (err: any) {
    ui.toast(err?.message ?? '加载领取记录失败')
  }
}

async function loadRewardCodes() {
  try {
    const res = await api.getRewardCodes()
    generatedCodeList.value = res.codes ?? []
  } catch (err: any) {
    ui.toast(err?.message ?? '加载兑换码失败')
  }
}

onMounted(async () => {
  await Promise.all([loadRewards(), loadPendingClaims(), loadRewardCodes()])
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
  if (formData.value.conditionValue < 1 && formData.value.conditionType !== 'manual') {
    ui.toast('达成条件至少为 1')
    return
  }

  try {
    await api.createReward({
      profileId: selectedProfileId.value,
      name: formData.value.name.trim(),
      description: formData.value.description.trim(),
      emoji: formData.value.emoji,
      conditionType: formData.value.conditionType,
      conditionValue: formData.value.conditionValue,
      requiresApproval: formData.value.requiresApproval,
    })
    ui.toast('奖励已添加！')
    resetForm()
    showForm.value = false
    await loadRewards()
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
    requiresApproval: false,
  }
}

async function handleDelete(rewardId: string) {
  if (confirm('确定要删除这个奖励吗？')) {
    try {
      await api.deleteReward(rewardId)
      ui.toast('奖励已删除')
      await loadRewards()
    } catch (err: any) {
      ui.toast(err?.message ?? '删除奖励失败')
    }
  }
}

async function handleApprove(claimId: string, approved: boolean) {
  try {
    await api.approveRewardClaim(claimId, approved)
    ui.toast(approved ? '已批准领取' : '已拒绝领取')
    await loadPendingClaims()
  } catch (err: any) {
    ui.toast(err?.message ?? '审批失败')
  }
}

async function generateCode() {
  if (!codeForm.value.rewardName.trim()) {
    ui.toast('请填写奖励名称')
    return
  }
  try {
    const res = await api.generateRewardCode({
      rewardName: codeForm.value.rewardName.trim(),
      rewardDesc: codeForm.value.rewardDesc.trim(),
    })
    generatedCode.value = res.code
    ui.toast('兑换码已生成！')
    codeForm.value = { rewardName: '', rewardDesc: '' }
    await loadRewardCodes()
  } catch (err: any) {
    ui.toast(err?.message ?? '生成兑换码失败')
  }
}

async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code)
    ui.toast('已复制到剪贴板')
  } catch {
    ui.toast('复制失败，请手动复制')
  }
}

function getConditionText(reward: any): string {
  const typeLabels: Record<string, string> = {
    training_count: '累计训练',
    streak_days: '连续训练',
    points: '成长积分',
    manual: '手动发放',
  }
  const label = typeLabels[reward.condition_type] ?? ''
  if (reward.condition_type === 'manual') return label
  return `${label} ${reward.condition_value}`
}

/** manual 类没有客观条件，服务端强制家长审批 */
function onConditionTypeChange() {
  if (formData.value.conditionType === 'manual') {
    formData.value.requiresApproval = true
  }
}
</script>

<template>
  <div class="page">
    <div class="row row--between">
      <div>
        <h1 class="section-title">奖励管理</h1>
        <p class="section-sub">为孩子设置奖励目标，激励他们坚持训练</p>
      </div>
      <div class="row">
        <button class="btn btn--ghost" @click="showCodeForm = !showCodeForm">兑换码</button>
        <button class="btn btn--primary" @click="showForm = !showForm">
          {{ showForm ? '取消' : '+ 添加奖励' }}
        </button>
      </div>
    </div>

    <!-- 待审批的领取请求 -->
    <div v-if="pendingClaims.length" class="card card--pad mt-16">
      <h2 class="section-title" style="font-size: 18px">⏳ 待审批的领取请求 ({{ pendingClaims.length }})</h2>
      <div class="stack mt-16">
        <div v-for="claim in pendingClaims" :key="claim.id" class="claim-item">
          <span class="claim-item__emoji">{{ claim.emoji }}</span>
          <div class="grow">
            <p class="claim-item__name">{{ claim.name }}</p>
            <p class="claim-item__time">{{ new Date(claim.claimed_at).toLocaleString() }}</p>
          </div>
          <div class="row">
            <button class="btn btn--primary btn--small" @click="handleApprove(claim.id, true)">批准</button>
            <button class="btn btn--ghost btn--small" @click="handleApprove(claim.id, false)">拒绝</button>
          </div>
        </div>
      </div>
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
          <select v-model="formData.conditionType" class="input" @change="onConditionTypeChange">
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
            placeholder="例如：10"
          />
          <p v-if="formData.conditionType === 'points'" class="hint" style="margin-top: 0.35rem">
            孩子需积累到该积分才能领取，领取后扣除相应积分。
          </p>
        </div>

        <div>
          <label class="row">
            <input v-model="formData.requiresApproval" type="checkbox" :disabled="formData.conditionType === 'manual'" />
            <span>{{ formData.conditionType === 'manual' ? '手动发放需家长审批（已自动勾选）' : '需要家长审批' }}</span>
          </label>
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
              <p v-if="reward.requires_approval" class="reward-card__requires-approval">需要家长审批</p>
            </div>
            <button class="btn btn--ghost btn--small" @click="handleDelete(reward.id)">删除</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 兑换码管理 -->
    <div v-if="showCodeForm" class="card card--pad mt-24">
      <h2 class="section-title" style="font-size: 18px">🎫 兑换码管理</h2>

      <div class="stack mt-16">
        <div>
          <label class="label">奖励名称</label>
          <input v-model="codeForm.rewardName" class="input" placeholder="例如：冰淇淋一支" />
        </div>

        <div>
          <label class="label">奖励描述（可选）</label>
          <input v-model="codeForm.rewardDesc" class="input" placeholder="详细描述" />
        </div>

        <button class="btn btn--primary" @click="generateCode">生成兑换码</button>

        <div v-if="generatedCode" class="generated-code">
          <p class="label">生成的兑换码：</p>
          <p class="generated-code__value">{{ generatedCode }}</p>
          <button class="btn btn--small" @click="copyCode(generatedCode)">复制</button>
        </div>
      </div>

      <div v-if="generatedCodeList.length" class="mt-24">
        <h3 class="section-title" style="font-size: 16px">已生成的兑换码 ({{ generatedCodeList.length }})</h3>
        <div class="stack mt-16">
          <div v-for="code in generatedCodeList" :key="code.id" class="code-item">
            <span class="code-item__code">{{ code.code }}</span>
            <span class="code-item__name">{{ code.reward_name }}</span>
            <span v-if="code.used_at" class="code-item__used">已使用</span>
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

.reward-card__requires-approval {
  font-size: 0.75rem;
  color: var(--butter-deep);
  margin: 0.25rem 0 0;
}

.claim-item {
  display: flex;
  gap: 1rem;
  align-items: center;
  padding: 0.75rem;
  background: var(--butter-soft);
  border-radius: 0.5rem;
}

.claim-item__emoji {
  font-size: 1.5rem;
}

.claim-item__name {
  font-size: 0.875rem;
  font-weight: 600;
  margin: 0;
  color: var(--ink);
}

.claim-item__time {
  font-size: 0.75rem;
  color: var(--muted);
  margin: 0.25rem 0 0;
}

.generated-code {
  padding: 1rem;
  background: var(--mint-soft);
  border-radius: 0.5rem;
}

.generated-code__value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--mint-deep);
  margin: 0.5rem 0;
  letter-spacing: 0.1em;
}

.code-item {
  display: flex;
  gap: 1rem;
  align-items: center;
  padding: 0.5rem;
  background: var(--cream);
  border-radius: 0.25rem;
}

.code-item__code {
  font-family: monospace;
  font-weight: 600;
  color: var(--mint-deep);
}

.code-item__name {
  flex: 1;
  font-size: 0.875rem;
  color: var(--ink);
}

.code-item__used {
  font-size: 0.75rem;
  color: var(--muted);
}
</style>
