<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { BADGES, DIMENSIONS, moduleById } from '@shared/constants'
import type { StoryMathDetail, TrainingRecord } from '@shared/types'
import { useDataStore } from '@/stores/data'
import { useSessionStore } from '@/stores/session'
import { useGuardStore } from '@/stores/guard'
import { useUiStore } from '@/stores/ui'
import { newRecordId, scoreOfDimensions, type GameOutcome } from '@/training/engines'
import { speak } from '@/utils/speech'
import { api } from '@/api/client'
import StroopGame from './games/StroopGame.vue'
import CaptureGame from './games/CaptureGame.vue'
import NBackGame from './games/NBackGame.vue'
import SwitchGame from './games/SwitchGame.vue'
import TrackingGame from './games/TrackingGame.vue'
import ArithmeticPlay from './games/ArithmeticPlay.vue'
import StoryMathPlay from './games/StoryMathPlay.vue'

const route = useRoute()
const router = useRouter()
const data = useDataStore()
const session = useSessionStore()
const guard = useGuardStore()
const ui = useUiStore()

const moduleMeta = computed(() => moduleById(String(route.params.id)))
const GAMES: Record<string, any> = {
  stroop: StroopGame,
  capture: CaptureGame,
  nback: NBackGame,
  switch: SwitchGame,
  tracking: TrackingGame,
  arithmetic: ArithmeticPlay,
  storymath: StoryMathPlay,
}

/** 低年级可读性：把「怎么玩」规则逐条读出来。 */
async function readRules() {
  const meta = moduleMeta.value
  if (!meta) return
  const rulesText = (rules[meta.id] ?? []).join('。')
  const err = await speak(`${meta.name}，怎么玩：${rulesText}`)
  if (err) ui.toast(`朗读失败：${err}`)
}

const phase = ref<'intro' | 'play' | 'result'>('intro')
const outcome = ref<GameOutcome | null>(null)
const record = ref<TrainingRecord | null>(null)
const newBadges = ref<string[]>([])
const savedPoints = ref<number | null>(null)
const saving = ref(false)
const startedAt = ref(0)
const playKey = ref(0)
/** 游戏进行中离开时先确认，避免成绩悄悄作废。 */
const showLeaveConfirm = ref(false)
const leaveTarget = ref<string | null>(null)
/** AI 应用题：AI 是否已配置（未配置时禁用开始，引导家长去设置）。null=检测中 */
const storyAiReady = ref<boolean | null>(null)

const rules: Record<string, string[]> = {
  stroop: [
    '屏幕中间会出现一个颜色字，比如「红」。',
    '不要读它写的是什么，点出它真正的颜色。',
    '共 24 题，答得又快又准分数更高。',
  ],
  capture: [
    '屏幕上会不停冒出各种图形。',
    '只点顶部指定的目标图形，其他都不要碰。',
    '坚持 40 秒，误点会扣分哦。',
  ],
  nback: [
    '圆点会一个一个出现在九宫格里。',
    '位置和 2 个之前一样 → 点「位置一样」。',
    '颜色和 2 个之前一样 → 点「颜色一样」。',
    '都不一样就什么都不点。',
  ],
  switch: [
    '卡片上的数字和背景颜色会同时变化。',
    '每 4 张卡片换一次规则，注意顶部的提示。',
    '规则是「奇偶」就分奇数偶数，是「颜色」就分红蓝。',
  ],
  tracking: [
    '先记住橙色标记的小球。',
    '小球变蓝后开始移动，盯住你记住的那几个。',
    '停下来后点击你记住的球，再回忆听到的 4 个数字。',
  ],
  arithmetic: [
    '先选一个难度，再开始 20 道心算。',
    '先算乘除再算加减，有括号先算括号。',
    '点一个答案，或按数字键再点确定。',
  ],
  storymath: [
    '先选一个年级，AI 会出 5 道应用题。',
    '每题可以列式拍照，也可以直接给答案。',
    '答错的题会讲解错因和思路，还能针对错题专项练。',
  ],
}

const lockReason = computed(() => {
  if (!moduleMeta.value) return null
  const reason = guard.canStart(moduleMeta.value.id, moduleMeta.value.countsTowardDailyLimit)
  return reason.allowed ? null : reason
})

/** AI 应用题模块：开始前必须先确认 AI 已配置（否则孩子端会白等出题失败） */
const storyAiBlocked = computed(() => moduleMeta.value?.id === 'storymath' && storyAiReady.value === false)

async function checkStoryAi() {
  if (moduleMeta.value?.id !== 'storymath') return
  storyAiReady.value = null
  try {
    const status = await api.aiStatus()
    storyAiReady.value = !!status?.ready
  } catch {
    storyAiReady.value = false
  }
}

const dimensionRows = computed(() => {
  if (!outcome.value) return []
  return Object.entries(outcome.value.dimensionScores).map(([key, value]) => ({
    key,
    name: DIMENSIONS.find((d) => d.key === key)?.name ?? key,
    value: Math.round(Number(value)),
  }))
})

const pointDelta = computed(() => {
  const map: Record<string, number> = { stroop: 8, capture: 8, nback: 10, switch: 8, tracking: 10, arithmetic: 8, storymath: 10 }
  return moduleMeta.value ? map[moduleMeta.value.id] ?? 6 : 0
})

function startPlay() {
  if (lockReason.value) return
  if (storyAiBlocked.value) return
  guard.noteActivity()
  phase.value = 'play'
  playKey.value += 1
  startedAt.value = Date.now()
}

async function onFinish(result: GameOutcome) {
  if (!moduleMeta.value) return
  showLeaveConfirm.value = false
  leaveTarget.value = null
  phase.value = 'result'
  outcome.value = result
  saving.value = true

  const endedAt = Date.now()
  const storyDetail = result.extra?.storymathDetail as StoryMathDetail[] | undefined
  const rec: TrainingRecord = {
    id: newRecordId(),
    profileId: session.profileId,
    module: moduleMeta.value.id,
    startedAt: startedAt.value || endedAt - 1000,
    endedAt,
    durationSec: Math.max(1, Math.round((endedAt - (startedAt.value || endedAt - 1000)) / 1000)),
    difficulty: result.difficulty,
    accuracy: Math.max(0, Math.min(1, result.accuracy)),
    avgReactionMs: Math.round(result.avgReactionMs),
    score: scoreOfDimensions(result.dimensionScores),
    totalTrials: result.totalTrials,
    correctTrials: result.correctTrials,
    errors: result.errors,
    dimensionScores: result.dimensionScores as TrainingRecord['dimensionScores'],
    // AI 应用题：主轮 + 专项轮逐题明细随记录持久化，供家长端回看
    ...(storyDetail && storyDetail.length ? { storymathDetail: storyDetail } : {}),
    updatedAt: endedAt,
  }
  record.value = rec

  try {
    const res = await data.saveRecord(rec)
    newBadges.value = res.newBadges
    savedPoints.value = res.points
    if (res.offline) ui.toast('已离线保存，联网后自动同步')
  } catch (err: any) {
    ui.toast(err?.message ?? '保存记录失败')
  } finally {
    saving.value = false
  }
}

function replay() {
  outcome.value = null
  record.value = null
  newBadges.value = []
  phase.value = 'intro'
}

function backToList() {
  router.push({ name: 'kid-train' })
}

function cancelLeave() {
  showLeaveConfirm.value = false
  leaveTarget.value = null
}

function confirmLeave() {
  const target = leaveTarget.value
  showLeaveConfirm.value = false
  leaveTarget.value = null
  phase.value = 'intro'
  outcome.value = null
  record.value = null
  if (target) router.push(target)
}

onBeforeRouteLeave((to) => {
  if (phase.value !== 'play') return true
  if (leaveTarget.value) return true
  leaveTarget.value = to.fullPath
  showLeaveConfirm.value = true
  return false
})

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (phase.value !== 'play') return
  e.preventDefault()
  e.returnValue = ''
}

onMounted(() => {
  window.addEventListener('beforeunload', onBeforeUnload)
  checkStoryAi()
})

function badgeName(id: string) {
  return BADGES.find((b) => b.id === id)?.name ?? id
}
function badgeEmoji(id: string) {
  return BADGES.find((b) => b.id === id)?.emoji ?? '🏅'
}

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  guard.noteActivity()
})
</script>

<template>
  <div class="page page--narrow">
    <div v-if="!moduleMeta" class="card center">
      <p class="emoji-lg">🤔</p>
      <p class="mt-8">没有找到这个训练</p>
      <button class="btn btn--primary mt-16" @click="backToList">返回训练馆</button>
    </div>

    <template v-else>
      <!-- 被限制 -->
      <div v-if="lockReason && phase === 'intro'" class="card card--pad center">
        <p class="emoji-xl">{{ lockReason.kind === 'break' ? '🌤️' : lockReason.kind === 'daily-limit' ? '🌙' : '😴' }}</p>
        <h2 class="section-title mt-8">{{ lockReason.title }}</h2>
        <p class="hint mt-8">{{ lockReason.detail }}</p>
        <div class="row mt-16" style="justify-content: center">
          <button class="btn" @click="backToList">回训练馆</button>
          <button class="btn btn--primary" @click="router.push({ name: 'kid-homework' })">去写作业</button>
        </div>
      </div>

      <!-- 介绍 -->
      <div v-else-if="phase === 'intro'" class="stack">
        <div class="card card--pad intro">
          <div class="row row--between">
            <div>
              <span class="emoji-xl">{{ moduleMeta.emoji }}</span>
              <h1 class="section-title mt-8" style="font-size: 24px">{{ moduleMeta.name }}</h1>
              <p class="section-sub">{{ moduleMeta.subtitle }}</p>
            </div>
            <span class="pill pill--mint">{{ moduleMeta.minutes }} 分钟</span>
          </div>

          <div class="row row--wrap mt-16">
            <span v-for="dim in moduleMeta.dimensions" :key="dim" class="pill pill--lav">
              {{ DIMENSIONS.find((d) => d.key === dim)?.name }}
            </span>
          </div>

          <div class="mt-24">
            <div class="row row--between row--wrap">
              <h3 class="section-title" style="font-size: 16px">怎么玩</h3>
              <button class="btn btn--small" @click="readRules">🔊 读规则</button>
            </div>
            <ol class="rules">
              <li v-for="(rule, i) in rules[moduleMeta.id] ?? []" :key="i">{{ rule }}</li>
            </ol>
          </div>

          <template v-if="storyAiBlocked">
            <div class="card card--pad" style="background: var(--peach-soft)">
              <p class="emoji-xl" style="text-align: center">🔌</p>
              <p class="hint mt-8" style="text-align: center">
                这个训练需要 AI 出题，家长还没配置好 AI。请先让家长到「家长中心 → AI 设置」打开 AI 能力并填入密钥。
              </p>
            </div>
          </template>
          <template v-else>
            <button class="btn btn--primary btn--lg btn--block mt-24" @click="startPlay">开始训练</button>
            <p class="hint center mt-8">坐直、放松、慢慢来，准确比快更重要</p>
          </template>
        </div>
      </div>

      <!-- 游戏 -->
      <div v-else-if="phase === 'play'">
        <component :is="GAMES[moduleMeta.id]" :key="playKey" @finish="onFinish" />
      </div>

      <!-- 结果 -->
      <div v-else-if="phase === 'result' && outcome" class="stack">
        <div class="card card--pad center">
          <p class="pill pill--mint" style="margin: 0 auto">训练完成</p>
          <div class="score-ring" :style="{ '--pct': scoreOfDimensions(outcome.dimensionScores) }">
            <div class="score-ring__inner">
              <span class="score-ring__value">{{ scoreOfDimensions(outcome.dimensionScores) }}</span>
              <span class="score-ring__label">综合分</span>
            </div>
          </div>
          <div class="grid grid--3 mt-16">
            <div class="result-stat">
              <strong>{{ Math.round(outcome.accuracy * 100) }}%</strong>
              <span>正确率</span>
            </div>
            <div class="result-stat">
              <strong>{{ outcome.avgReactionMs || '—' }}</strong>
              <span>平均反应(ms)</span>
            </div>
            <div class="result-stat">
              <strong>{{ outcome.totalTrials }}</strong>
              <span>完成题量</span>
            </div>
          </div>

          <div class="stack mt-24" style="gap: 10px">
            <div v-for="row in dimensionRows" :key="row.key" class="dim-row">
              <span>{{ row.name }}</span>
              <div class="progress grow">
                <div class="progress__fill" :style="{ width: row.value + '%' }"></div>
              </div>
              <strong>{{ row.value }}</strong>
            </div>
          </div>

          <div v-if="newBadges.length" class="badge-pop mt-24">
            <p class="hint">点亮新徽章</p>
            <div class="row row--wrap" style="justify-content: center">
              <span v-for="id in newBadges" :key="id" class="pill pill--butter">
                {{ badgeEmoji(id) }} {{ badgeName(id) }}
              </span>
            </div>
          </div>

          <div class="row mt-24" style="justify-content: center">
            <button class="btn" @click="replay">再玩一次</button>
            <button class="btn btn--primary" @click="backToList">回训练馆</button>
          </div>
          <p class="hint mt-8">
            <template v-if="saving">正在保存成绩…</template>
            <template v-else>本次获得 +{{ pointDelta }} 积分<template v-if="savedPoints !== null">，当前共 {{ savedPoints }} 分</template></template>
          </p>
        </div>
      </div>
    </template>

    <div v-if="showLeaveConfirm" class="overlay">
      <div class="modal center">
        <p class="emoji-xl">🎮</p>
        <h2 class="section-title mt-8">这次训练还没结束</h2>
        <p class="hint mt-8">离开后本次成绩会作废，需要重新开始。要不要先玩完这一轮？</p>
        <div class="row mt-16">
          <button class="btn btn--primary grow" @click="cancelLeave">继续训练</button>
          <button class="btn btn--ghost grow" @click="confirmLeave">放弃本次</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.intro {
  background: linear-gradient(160deg, #fffdf9, #f3faf6 90%);
}

.rules {
  margin: 10px 0 0;
  padding-left: 20px;
  color: var(--ink-soft);
  font-size: 16px;
  line-height: 2;
}

.score-ring {
  --pct: 60;
  width: 168px;
  height: 168px;
  margin: 18px auto 0;
  border-radius: 50%;
  background: conic-gradient(var(--mint-deep) calc(var(--pct) * 1%), var(--cream-deep) 0);
  display: grid;
  place-items: center;
}

.score-ring__inner {
  width: 132px;
  height: 132px;
  border-radius: 50%;
  background: var(--card);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 2px 10px rgba(0, 0, 0, 0.04);
}

.score-ring__value {
  font-size: 44px;
  font-weight: 800;
  color: var(--mint-deep);
  line-height: 1;
}

.score-ring__label {
  font-size: 12px;
  color: var(--muted);
  margin-top: 4px;
}

.result-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--cream-deep);
  border-radius: 16px;
  padding: 12px 8px;
}

.result-stat strong {
  font-size: 20px;
}

.result-stat span {
  font-size: 12px;
  color: var(--muted);
}

.dim-row {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
}

.dim-row span {
  width: 82px;
  text-align: left;
  color: var(--ink-soft);
}

.badge-pop {
  background: var(--butter-soft);
  border-radius: 16px;
  padding: 14px;
}
</style>
