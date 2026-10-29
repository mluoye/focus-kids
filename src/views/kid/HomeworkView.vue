<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { HomeworkItem, HomeworkPlan, HomeworkProgress, HomeworkRound, HomeworkSession, HomeworkStep } from '@shared/types'
import { homeworkDayKey, isHomeworkStale, homeworkOutcome } from '@shared/homework'
import { useDataStore } from '@/stores/data'
import { useSessionStore } from '@/stores/session'
import { useGuardStore } from '@/stores/guard'
import { useUiStore } from '@/stores/ui'
import { detectSubjectIcon } from '@/utils/subject'
import { speak } from '@/utils/speech'
import { pushHomeworkKeepalive, streamAi } from '@/api/client'
import { newSessionId } from '@/training/engines'
import {
  clearHomeworkDraft,
  isHomeworkDraftStale,
  loadHomeworkDraft,
  saveHomeworkDraft,
  type HomeworkDraft,
} from '@/training/homeworkDraft'
import { formatMinutes } from '@/utils/time'

const data = useDataStore()
const session = useSessionStore()
const guard = useGuardStore()
const ui = useUiStore()

type Step = 'setup' | 'warmup' | 'focus' | 'check' | 'break' | 'done'
const step = ref<Step>('setup')

const taskTitle = ref('')
const items = ref<HomeworkItem[]>([])
const newItemTitle = ref('')
const aiSplitting = ref(false)
/** 当前清单来自哪份家长计划；空字符串表示孩子自建 */
const planId = ref('')
/** 家长计划里的清单项 id：这些项不允许在 setup 阶段删除 */
const planItemIds = ref<string[]>([])
/** 孩子点过「不用这份」后，不再自动提示同一份计划 */
const planDismissed = ref(false)

const focusMinutes = ref(25)
const breakMinutes = 5
const FOCUS_PRESETS = [20, 25, 30]
const FOCUS_MIN = 5
const FOCUS_MAX = 60
/** 选了「自定义」时显示输入框；自定义值不在预设里 */
const useCustomFocus = ref(false)
const customFocusInput = ref<number | ''>('')
/** 大脑热身默认开启，孩子可以取消 */
const warmupEnabled = ref(true)

const warmupLeft = ref(60)
const warmupIndex = ref(0)
const warmupSteps = [
  { emoji: '🌬️', title: '慢慢吸气 4 秒，再呼气 6 秒', tip: '让身体先安静下来' },
  { emoji: '✋', title: '手指操：握拳、张开，来回 10 次', tip: '手指灵活，写字更稳' },
  { emoji: '📋', title: '说出今天要完成的 3 件事', tip: '心里有数，就不容易拖' },
]

const focusLeft = ref(0)
const breakLeft = ref(0)
const roundIndex = ref(0)
const rounds = ref<HomeworkRound[]>([])
const roundStart = ref(0)
const checks = ref<boolean[]>([])
const currentChecks = [
  '这一轮计划的小任务完成了',
  '不会的题已经做上标记',
  '桌面和文具收拾整齐',
  '站起来看了看远处',
]

const hint = ref('')
const saving = ref(false)
const savedPoints = ref<number | null>(null)
const sessionStartedAt = ref(0)
const sessionId = ref('')
const paused = ref(false)
const restored = ref(false)
/** 未完成时点「提前结束」的二次确认 */
const earlyConfirm = ref(false)

let ticker: number | undefined
let focusEndsAt = 0
let breakEndsAt = 0
let warmupEndsAt = 0
let syncTimer: number | undefined
let lastSyncAt = 0

const breakLeftText = computed(() => formatMinutes(breakLeft.value))
const focusLeftText = computed(() => formatMinutes(focusLeft.value))
const focusProgress = computed(() => {
  const total = focusMinutes.value * 60
  if (!total) return 0
  return Math.min(100, Math.max(0, Math.round(((total - focusLeft.value) / total) * 100)))
})
const warmupProgress = computed(() => Math.min(100, Math.max(0, Math.round(((60 - warmupLeft.value) / 60) * 100))))
const breakProgress = computed(() =>
  Math.min(
    100,
    Math.max(0, Math.round(((breakMinutes * 60 - breakLeft.value) / (breakMinutes * 60)) * 100)),
  ),
)
const totalFocusMinutes = computed(() =>
  Math.round(rounds.value.reduce((sum, r) => sum + r.focusMinutes, 0)),
)
const doneCount = computed(() => items.value.filter((item) => item.done).length)
const hasItems = computed(() => items.value.length > 0)
const allDone = computed(() => doneCount.value === items.value.length)
const pendingCount = computed(() => Math.max(0, items.value.length - doneCount.value))
/** 家长今天留的清单；auto-apply 只在进入页面且本地没有草稿时发生 */
const todayPlan = computed(() => data.myTodayPlan)
const usingPlan = computed(() => !!planId.value && !!todayPlan.value && planId.value === todayPlan.value.id)
/** 今天是否已经用这份计划完成过；避免再次进入页面又自动铺一份，鼓励重复刷积分 */
const planDoneToday = computed(() => {
  const plan = todayPlan.value
  if (!plan) return null
  const today = homeworkDayKey()
  return (
    data.myHomework.find(
      (hw) =>
        hw.planId === plan.id &&
        hw.status === 'done' &&
        homeworkDayKey(hw.verdictAt ?? hw.endedAt ?? hw.updatedAt) === today,
    ) ?? null
  )
})
/** 结算结果：与时间到那一刻的清单状态一致（check 页已锁定，不会再变） */
const outcome = computed(() =>
  homeworkOutcome({ items: items.value, plannedFocusMinutes: focusMinutes.value, rounds: rounds.value }),
)
const donePercent = computed(() =>
  items.value.length ? Math.round((doneCount.value / items.value.length) * 100) : 0,
)

// ---------- 专注时长：预设 + 自定义 ----------

function clampFocusMinutes(value: unknown): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return 25
  return Math.min(FOCUS_MAX, Math.max(FOCUS_MIN, n))
}

/** 统一入口：预设值显示为选中按钮，其他值自动切到「自定义」。 */
function setFocusMinutes(value: unknown) {
  const minutes = clampFocusMinutes(value)
  focusMinutes.value = minutes
  useCustomFocus.value = !FOCUS_PRESETS.includes(minutes)
  customFocusInput.value = useCustomFocus.value ? minutes : ''
}

function pickPreset(minutes: number) {
  useCustomFocus.value = false
  customFocusInput.value = ''
  focusMinutes.value = minutes
  persistDraft()
}

function enterCustomFocus() {
  if (useCustomFocus.value) return
  useCustomFocus.value = true
  customFocusInput.value = focusMinutes.value
}

function onCustomInput() {
  useCustomFocus.value = true
  const raw = String(customFocusInput.value).trim()
  if (!raw) return
  const n = Number(raw)
  if (Number.isFinite(n) && n >= FOCUS_MIN && n <= FOCUS_MAX) {
    focusMinutes.value = Math.round(n)
  }
  persistDraft()
}

function onCustomBlur() {
  if (!useCustomFocus.value) return
  customFocusInput.value = clampFocusMinutes(customFocusInput.value)
  focusMinutes.value = clampFocusMinutes(customFocusInput.value)
  persistDraft()
}

/** 开始前校验自定义值，返回 null 表示需要提示孩子。 */
function resolveFocusMinutes(): number | null {
  if (!useCustomFocus.value) return clampFocusMinutes(focusMinutes.value)
  if (String(customFocusInput.value).trim() === '') {
    ui.toast(`自定义时长请填 ${FOCUS_MIN}~${FOCUS_MAX} 分钟`)
    return null
  }
  const minutes = clampFocusMinutes(customFocusInput.value)
  customFocusInput.value = minutes
  focusMinutes.value = minutes
  return minutes
}

// ---------- 计时器：用结束时间戳驱动，避免后台标签页被节流后走慢 ----------

function clearTicker() {
  if (ticker) {
    clearInterval(ticker)
    ticker = undefined
  }
}

function refreshLeftFromClock() {
  const now = Date.now()
  if (step.value === 'focus' && focusEndsAt) {
    focusLeft.value = Math.max(0, Math.ceil((focusEndsAt - now) / 1000))
  }
  if (step.value === 'break' && breakEndsAt) {
    breakLeft.value = Math.max(0, Math.ceil((breakEndsAt - now) / 1000))
  }
  if (step.value === 'warmup' && warmupEndsAt) {
    warmupLeft.value = Math.max(0, Math.ceil((warmupEndsAt - now) / 1000))
  }
}

function tick() {
  if (paused.value) return
  const now = Date.now()
  if (step.value === 'warmup' && warmupEndsAt) {
    warmupLeft.value = Math.max(0, Math.ceil((warmupEndsAt - now) / 1000))
    warmupIndex.value = Math.min(2, Math.floor((60 - warmupLeft.value) / 20))
    if (warmupLeft.value <= 0) {
      clearTicker()
      warmupEndsAt = 0
      beginFocus()
    }
    return
  }
  if (step.value === 'focus' && focusEndsAt) {
    focusLeft.value = Math.max(0, Math.ceil((focusEndsAt - now) / 1000))
    if (focusLeft.value <= 0) {
      clearTicker()
      focusEndsAt = 0
      toCheck()
    }
    return
  }
  if (step.value === 'break' && breakEndsAt) {
    breakLeft.value = Math.max(0, Math.ceil((breakEndsAt - now) / 1000))
    if (breakLeft.value <= 0) {
      clearTicker()
      breakEndsAt = 0
      beginFocus()
    }
  }
}

function startTicker() {
  clearTicker()
  ticker = window.setInterval(tick, 500)
}

/** 离开页面或手动暂停：把剩余时间从时钟上摘下来，存成静态秒数。 */
function pauseTimers() {
  if (step.value !== 'warmup' && step.value !== 'focus' && step.value !== 'break') return
  refreshLeftFromClock()
  focusEndsAt = 0
  breakEndsAt = 0
  warmupEndsAt = 0
  paused.value = true
  clearTicker()
}

function resume() {
  if (step.value !== 'warmup' && step.value !== 'focus' && step.value !== 'break') return
  const now = Date.now()
  if (step.value === 'warmup') warmupEndsAt = now + Math.max(1, warmupLeft.value) * 1000
  if (step.value === 'focus') focusEndsAt = now + Math.max(1, focusLeft.value) * 1000
  if (step.value === 'break') breakEndsAt = now + Math.max(1, breakLeft.value) * 1000
  paused.value = false
  startTicker()
  guard.noteActivity()
  persistDraft()
  scheduleSync(true)
}

function pause() {
  if (paused.value) return
  pauseTimers()
  persistDraft()
  scheduleSync(true)
}

// ---------- 草稿与服务端同步 ----------

function currentProgress(): HomeworkProgress {
  const safeStep: HomeworkStep =
    step.value === 'done' ? 'check' : (step.value as HomeworkStep)
  return {
    step: safeStep,
    focusLeftSec: focusLeft.value,
    breakLeftSec: breakLeft.value,
    warmupLeftSec: warmupLeft.value,
    roundIndex: roundIndex.value,
    roundStartedAt: roundStart.value,
    checks: [...checks.value],
    paused: paused.value,
  }
}

function buildSession(status: HomeworkSession['status'], endedAt = Date.now()): HomeworkSession {
  const build: HomeworkSession = {
    id: sessionId.value || newSessionId(),
    profileId: session.profileId,
    ...(planId.value ? { planId: planId.value } : {}),
    taskTitle: taskTitle.value.trim() || '今天的小任务',
    items: items.value.map((item) => ({ ...item })),
    plannedFocusMinutes: focusMinutes.value,
    rounds: rounds.value.map((round) => ({ ...round, selfChecks: [...round.selfChecks] })),
    status,
    startedAt: sessionStartedAt.value || endedAt,
    endedAt: status === 'running' ? null : endedAt,
    updatedAt: endedAt,
  }
  if (status === 'running') build.progress = currentProgress()
  if (status === 'done') {
    // 服务端会用同一口径重算，这里先写一份，离线时本地快照也能显示判定
    const result = homeworkOutcome(build)
    build.verdict = result.passed ? 'pass' : 'fail'
    build.verdictAt = endedAt
  }
  return build
}

function persistDraft() {
  if (!session.profileId) return
  if (step.value === 'done') return
  if (step.value === 'setup' && !items.value.length && !taskTitle.value.trim() && !sessionId.value) {
    clearHomeworkDraft(session.profileId)
    return
  }
  refreshLeftFromClock()
  const draft: HomeworkDraft = {
    ...currentProgress(),
    sessionId: sessionId.value,
    planId: planId.value || undefined,
    planItemIds: [...planItemIds.value],
    planDismissed: planDismissed.value || undefined,
    taskTitle: taskTitle.value,
    items: items.value.map((item) => ({ ...item })),
    focusMinutes: focusMinutes.value,
    warmupEnabled: warmupEnabled.value,
    rounds: rounds.value.map((round) => ({ ...round, selfChecks: [...round.selfChecks] })),
    sessionStartedAt: sessionStartedAt.value,
    savedAt: Date.now(),
  }
  saveHomeworkDraft(session.profileId, draft)
}

function clearSyncTimer() {
  if (syncTimer) {
    clearTimeout(syncTimer)
    syncTimer = undefined
  }
}

async function pushSession(status: HomeworkSession['status']) {
  if (!sessionId.value) return
  try {
    await data.saveHomework(buildSession(status))
  } catch (err: any) {
    if (status === 'done') ui.toast(err?.message ?? '保存作业记录失败')
  }
}

/** 勾选等高频动作合并成 5 秒一次，开始/暂停/完成立即同步。 */
function scheduleSync(immediate = false) {
  if (!sessionId.value) return
  if (immediate) {
    clearSyncTimer()
    lastSyncAt = Date.now()
    void pushSession('running')
    return
  }
  if (syncTimer) return
  const wait = Math.max(0, 5000 - (Date.now() - lastSyncAt))
  syncTimer = window.setTimeout(() => {
    syncTimer = undefined
    lastSyncAt = Date.now()
    void pushSession('running')
  }, wait)
}

// ---------- 恢复 ----------

function applyDraft(draft: HomeworkDraft) {
  sessionId.value = draft.sessionId
  planId.value = draft.planId ?? ''
  planItemIds.value = Array.isArray(draft.planItemIds) ? [...draft.planItemIds] : []
  planDismissed.value = draft.planDismissed === true
  taskTitle.value = draft.taskTitle
  items.value = draft.items.map((item) => ({ ...item }))
  setFocusMinutes(draft.focusMinutes)
  warmupEnabled.value = draft.warmupEnabled !== false
  rounds.value = draft.rounds.map((round) => ({ ...round, selfChecks: [...round.selfChecks] }))
  sessionStartedAt.value = draft.sessionStartedAt
  roundIndex.value = draft.roundIndex
  roundStart.value = draft.roundStartedAt
  checks.value = Array.from({ length: 4 }, (_, i) => !!draft.checks?.[i])
  step.value = draft.step
  paused.value = true
  focusEndsAt = 0
  breakEndsAt = 0
  warmupEndsAt = 0
  // 如果上次是被强制关页（草稿还是「运行中」），按保存时间扣掉已经过去的部分
  const elapsed = draft.paused ? 0 : Math.max(0, Math.floor((Date.now() - draft.savedAt) / 1000))
  focusLeft.value = Math.max(1, draft.focusLeftSec - (draft.step === 'focus' ? elapsed : 0))
  breakLeft.value = Math.max(1, draft.breakLeftSec - (draft.step === 'break' ? elapsed : 0))
  warmupLeft.value = Math.max(1, draft.warmupLeftSec - (draft.step === 'warmup' ? elapsed : 0))
}

function applySession(hw: HomeworkSession) {
  sessionId.value = hw.id
  planId.value = hw.planId ?? ''
  const plan = hw.planId ? data.homeworkPlans.find((p) => p.id === hw.planId) : undefined
  planItemIds.value = plan ? plan.items.map((item) => item.id) : []
  taskTitle.value = hw.taskTitle
  items.value = hw.items.map((item) => ({ ...item }))
  setFocusMinutes(hw.plannedFocusMinutes)
  rounds.value = hw.rounds.map((round) => ({ ...round, selfChecks: [...round.selfChecks] }))
  sessionStartedAt.value = hw.startedAt
  const progress = hw.progress
  step.value = progress?.step ?? 'focus'
  roundIndex.value = progress?.roundIndex ?? hw.rounds.length
  roundStart.value = progress?.roundStartedAt ?? Date.now()
  checks.value = Array.from({ length: 4 }, (_, i) => !!progress?.checks?.[i])
  paused.value = true
  focusEndsAt = 0
  breakEndsAt = 0
  warmupEndsAt = 0
  focusLeft.value = Math.max(1, progress?.focusLeftSec || hw.plannedFocusMinutes * 60)
  breakLeft.value = Math.max(1, progress?.breakLeftSec || breakMinutes * 60)
  warmupLeft.value = Math.max(1, progress?.warmupLeftSec || 60)
}

async function abandonServer(hw: HomeworkSession) {
  try {
    await data.saveHomework({ ...hw, status: 'abandoned', endedAt: hw.updatedAt, progress: undefined })
  } catch {
    /* 离线时留给下次同步 */
  }
}

const bootDraft = session.profileId ? loadHomeworkDraft(session.profileId) : null
const validBoot = bootDraft && !isHomeworkDraftStale(bootDraft) ? bootDraft : null
/** 只有已经开始的会话才算「进行中」；只填了清单的草稿不显示恢复卡片。 */
const hasRunningDraft = !!validBoot?.sessionId
if (validBoot) {
  applyDraft(validBoot)
  restored.value = hasRunningDraft
}
const restoring = ref(!hasRunningDraft)

// ---------- 流程 ----------

function startSession() {
  const minutes = resolveFocusMinutes()
  if (minutes === null) return
  // 没有清单就没有判定依据（空清单会被当成全部完成），开始前至少列一项
  if (!items.value.length) {
    ui.toast('先列一项作业再开始吧')
    return
  }
  focusMinutes.value = minutes
  if (!taskTitle.value.trim()) taskTitle.value = '今天的小任务'
  sessionStartedAt.value = Date.now()
  sessionId.value = newSessionId()
  roundIndex.value = 0
  rounds.value = []
  roundStart.value = 0
  checks.value = []
  restored.value = false

  if (!warmupEnabled.value) {
    // 跳过热身：直接进入第一轮专注
    beginFocus()
    return
  }

  step.value = 'warmup'
  warmupLeft.value = 60
  warmupIndex.value = 0
  paused.value = false
  warmupEndsAt = Date.now() + 60_000
  startTicker()
  guard.noteActivity()
  persistDraft()
  scheduleSync(true)
}

function skipWarmup() {
  clearTicker()
  warmupEndsAt = 0
  beginFocus()
}

function beginFocus() {
  step.value = 'focus'
  focusLeft.value = focusMinutes.value * 60
  roundStart.value = Date.now()
  roundIndex.value += 1
  checks.value = currentChecks.map(() => false)
  paused.value = false
  earlyConfirm.value = false
  focusEndsAt = Date.now() + focusLeft.value * 1000
  startTicker()
  guard.noteActivity()
  persistDraft()
  scheduleSync(true)
}

function toCheck() {
  clearTicker()
  focusEndsAt = 0
  paused.value = false
  earlyConfirm.value = false
  step.value = 'check'
  persistDraft()
  scheduleSync(true)
}

/** 结束本轮先去自检，再由自检决定进入休息还是继续下一轮。 */
function finishFocusEarly() {
  // 清单没做完就提前结束，先确认；确认后同样记为「未完成」
  if (!allDone.value) {
    earlyConfirm.value = true
    return
  }
  toCheck()
}

function confirmEarlyEnd() {
  earlyConfirm.value = false
  toCheck()
}

function saveRound(): HomeworkRound {
  const endedAt = Date.now()
  const round: HomeworkRound = {
    index: roundIndex.value,
    focusMinutes: Math.round((endedAt - roundStart.value) / 60000),
    breakMinutes,
    startedAt: roundStart.value,
    endedAt,
    selfChecks: [...checks.value],
  }
  rounds.value.push(round)
  return round
}

function toBreak() {
  saveRound()
  step.value = 'break'
  breakLeft.value = breakMinutes * 60
  paused.value = false
  breakEndsAt = Date.now() + breakLeft.value * 1000
  startTicker()
  persistDraft()
  scheduleSync(true)
}

function skipBreak() {
  clearTicker()
  breakEndsAt = 0
  beginFocus()
}

async function finishSession() {
  if (step.value === 'done') return
  saveRound()
  step.value = 'done'
  paused.value = false
  clearTicker()
  clearSyncTimer()
  focusEndsAt = 0
  breakEndsAt = 0
  warmupEndsAt = 0
  const endedAt = Date.now()
  saving.value = true
  try {
    await data.saveHomework(buildSession('done', endedAt))
    savedPoints.value = data.myProfile?.points ?? null
    if (session.profileId) clearHomeworkDraft(session.profileId)
  } catch (err: any) {
    ui.toast(err?.message ?? '保存作业记录失败')
  } finally {
    saving.value = false
  }
}

async function aiSplit() {
  if (aiSplitting.value) return
  if (!taskTitle.value.trim()) {
    ui.toast('先写下今天的作业名称吧')
    return
  }
  aiSplitting.value = true
  hint.value = ''
  let buffer = ''
  try {
    await streamAi('tutor', {
      profileName: data.myProfile?.name ?? '小朋友',
      messages: [
        {
          role: 'user',
          content: `我要完成「${taskTitle.value.trim()}」。请帮我拆成 3~6 项可以逐项打勾的作业清单，每项 15 分钟内能做完，写得具体一点（例如：数学口算第 1~20 题）。每行只写一项，不要编号，不要解释，不要给答案。`,
        },
      ],
    }, (delta) => {
      buffer += delta
      hint.value = buffer
    })
    const lines = buffer
      .split('\n')
      .map((line) => line.replace(/^[-*\d.、\s]+/, '').trim())
      .filter((line) => line.length > 1)
      .slice(0, 8)
    if (lines.length) {
      addItems(lines)
      hint.value = '已经列好啦，做完一项就勾一项'
    }
  } catch (err: any) {
    hint.value = err?.message ?? 'AI 暂时不在线，先用下面的示例清单吧'
    if (!items.value.length) {
      addItems(['先读一遍题目要求', '完成前 5 题', '不会的做标记', '检查一遍并收拾桌面'])
    }
  } finally {
    aiSplitting.value = false
  }
}

function newItemId(): string {
  return `hi_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
}

/** 低年级可读性：优先用已保存的科目图标，没有就按标题自动识别。 */
function itemIcon(item: { icon?: string; title: string }): string {
  return item.icon || detectSubjectIcon(item.title)
}

/** 朗读时只念标题文字，不念图标 emoji；图标是给眼睛看的。 */
async function readOne(item: HomeworkItem) {
  const err = await speak(item.title)
  if (err) ui.toast(`朗读失败：${err}`)
}

async function readAllItems() {
  const text = items.value.map((it) => it.title).join('，')
  const err = await speak(`${taskTitle.value.trim() || '今天的作业'}：${text}`)
  if (err) ui.toast(`朗读失败：${err}`)
}

/** 使用家长留的清单：复制标题、清单项与 planId；已勾选状态一律重置。 */
function applyPlan(plan: HomeworkPlan, silent = false) {
  if (step.value !== 'setup') return
  planId.value = plan.id
  planItemIds.value = plan.items.map((item) => item.id)
  planDismissed.value = false
  taskTitle.value = plan.title
  items.value = plan.items.map((item) => ({ id: item.id, title: item.title, icon: item.icon || detectSubjectIcon(item.title), done: false }))
  persistDraft()
  if (!silent) ui.toast(`用上家长留的 ${plan.items.length} 项清单啦`)
}

/** 「不用这份，我自己列」：清空家长清单，本次进入页面不再自动弹回。 */
function dismissPlan() {
  planId.value = ''
  planItemIds.value = []
  planDismissed.value = true
  taskTitle.value = ''
  items.value = []
  newItemTitle.value = ''
  persistDraft()
  ui.toast('那你自己列一份清单吧')
}

/** 按标题去重后追加清单项，AI 与手动添加共用。清单在开始后锁定，只允许在 setup 阶段增删。 */
function addItems(titles: string[]) {
  if (step.value !== 'setup') return
  const existing = new Set(items.value.map((item) => item.title))
  const added = titles
    .map((title) => title.trim())
    .filter((title) => title && !existing.has(title))
    .map((title) => {
      existing.add(title)
      return { id: newItemId(), title, done: false, icon: detectSubjectIcon(title) }
    })
  items.value = [...items.value, ...added].slice(0, 12)
  persistDraft()
}

function addItem() {
  const value = newItemTitle.value.trim()
  if (!value) return
  if (items.value.length >= 12) {
    ui.toast('清单最多 12 项，先删掉几项吧')
    return
  }
  addItems([value])
  newItemTitle.value = ''
}

function removeItem(id: string) {
  if (step.value !== 'setup') return
  // 家长留的项不允许删：孩子可以追加自己的任务，但不能缩小家长清单来拿「正」
  if (planItemIds.value.includes(id)) {
    ui.toast('这是家长留的作业，不能删；可以在下面加自己的任务')
    return
  }
  items.value = items.value.filter((item) => item.id !== id)
  persistDraft()
  scheduleSync()
}

/** 勾选/取消：专注页和自检页共用同一个动作。 */
function toggleItem(id: string) {
  const item = items.value.find((x) => x.id === id)
  if (!item) return
  item.done = !item.done
  if (item.done) {
    item.doneAt = Date.now()
  } else {
    delete item.doneAt
  }
  persistDraft()
  scheduleSync()
}

function restartAll() {
  clearTicker()
  clearSyncTimer()
  step.value = 'setup'
  rounds.value = []
  roundIndex.value = 0
  roundStart.value = 0
  checks.value = []
  focusLeft.value = 0
  breakLeft.value = 0
  paused.value = false
  focusEndsAt = 0
  breakEndsAt = 0
  warmupEndsAt = 0
  savedPoints.value = null
  hint.value = ''
  sessionId.value = ''
  sessionStartedAt.value = 0
  restored.value = false
  items.value = items.value.map(({ id, title }) => ({ id, title, done: false }))
  if (session.profileId) clearHomeworkDraft(session.profileId)
}

async function abandonAndRestart() {
  clearSyncTimer()
  if (sessionId.value) await pushSession('abandoned')
  restartAll()
  ui.toast('这次作业先收起来了')
}

function onVisibility() {
  if (document.visibilityState === 'hidden') persistDraft()
}

/** 刷新/关标签页：本地草稿照旧，同时用 keepalive 把「已暂停」补到服务端。 */
function onPageHide() {
  if (step.value === 'done') return
  pauseTimers()
  persistDraft()
  if (sessionId.value) pushHomeworkKeepalive(buildSession('running'))
}

onMounted(async () => {
  guard.noteActivity()
  window.addEventListener('pagehide', onPageHide)
  document.addEventListener('visibilitychange', onVisibility)

  if (hasRunningDraft) {
    scheduleSync(true)
    return
  }

  const pid = session.profileId
  const stale = pid ? loadHomeworkDraft(pid) : null
  // 过期草稿直接丢掉；只有「仅清单」的有效草稿要保留
  if (stale && pid && !validBoot) clearHomeworkDraft(pid)
  try {
    // 作业页需要看到家长刚留的清单，进入页面就拉一次快照；离线时继续用本地缓存。
    await data.fetchState()
  } catch {
    /* 离线时用本地快照 */
  }

  const now = Date.now()
  const running = data.myHomework
    .filter((hw) => hw.status === 'running' && !isHomeworkStale(hw, now))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]

  if (running) {
    applySession(running)
    restored.value = true
    persistDraft()
    scheduleSync(true)
    ui.toast('已恢复上次的作业，计时暂停中')
  } else if (stale && !validBoot) {
    if (stale.sessionId) {
      const old = data.myHomework.find((hw) => hw.id === stale.sessionId)
      if (old && old.status === 'running') await abandonServer(old)
    }
    ui.toast('上次的作业超过 2 小时没动，已经收起来了，重新开始吧')
  }

  // 本地没有草稿、也没有正在进行的会话时，自动带出家长今天留的清单。
  // 只做一次：孩子点「不用这份」会清空并记住，不会再次自动填入。
  if (
    !sessionId.value &&
    step.value === 'setup' &&
    !planDismissed.value &&
    !planDoneToday.value &&
    !taskTitle.value.trim() &&
    !items.value.length &&
    todayPlan.value
  ) {
    applyPlan(todayPlan.value, true)
    ui.toast('家长已经帮你列好今天的作业，开始前还可以再加几项')
  }
  restoring.value = false
})

onBeforeUnmount(() => {
  clearTicker()
  clearSyncTimer()
  window.removeEventListener('pagehide', onPageHide)
  document.removeEventListener('visibilitychange', onVisibility)
  if (step.value === 'done') return
  pauseTimers()
  persistDraft()
  if (sessionId.value) void pushSession('running')
})
</script>

<template>
  <div class="page page--narrow">
    <div v-if="restoring" class="card card--pad center">
      <p class="emoji-xl">🍅</p>
      <p class="hint mt-8">正在看看上次写到哪儿了…</p>
    </div>

    <template v-else>
      <div
        v-if="restored && paused && step !== 'setup' && step !== 'done'"
        class="card card--pad restore-card"
        style="margin-bottom: 16px"
      >
        <div class="row row--between row--wrap">
          <div>
            <span class="pill pill--mint">已回到上次的进度</span>
            <p class="hint mt-8">计时已经暂停，点「继续」接着写。离开期间不计入专注时间。</p>
          </div>
          <button class="btn btn--ghost btn--small" @click="abandonAndRestart">重新开始</button>
        </div>
      </div>

      <!-- 准备 -->
      <template v-if="step === 'setup'">
        <div class="card card--pad card--peach">
          <div class="row row--between">
            <div>
              <h1 class="section-title" style="font-size: 22px">作业番茄钟 🍅</h1>
              <p class="section-sub">把大作业拆成小任务，一次只做一件</p>
            </div>
            <span class="pill">不计入训练上限</span>
          </div>
        </div>

        <div v-if="todayPlan && usingPlan" class="card card--mint mt-16 plan-note">
          <div class="row row--between row--wrap">
            <div>
              <strong>📝 这份清单是家长留的</strong>
              <p class="hint mt-8">
                {{ todayPlan.title }} · 共 {{ todayPlan.items.length }} 项 · 开始后清单锁定，只能逐项勾选
              </p>
            </div>
            <button class="btn btn--ghost btn--small" @click="dismissPlan">不用这份，我自己列</button>
          </div>
        </div>
        <div v-else-if="todayPlan" class="card card--mint mt-16 plan-note">
          <div class="row row--between row--wrap">
            <div>
              <strong>📝 家长给你留了今天的作业</strong>
              <p class="hint mt-8">{{ todayPlan.title }} · 共 {{ todayPlan.items.length }} 项</p>
              <p v-if="planDismissed" class="hint">你已经选了「自己列」；想换回来点右边的按钮就行。</p>
              <p v-if="planDoneToday" class="hint">今天已经用这份清单完成过一次啦，想再练一次也可以。</p>
            </div>
            <button class="btn btn--primary btn--small" @click="applyPlan(todayPlan)">用这份清单</button>
          </div>
        </div>

        <div class="card card--pad mt-16">
          <label class="label">今天的作业是什么？</label>
          <input v-model="taskTitle" class="input" placeholder="例如：数学口算 + 语文抄写" @change="persistDraft" />

          <div class="row row--between mt-24">
            <label class="label" style="margin: 0">
              作业清单
              <span v-if="hasItems" class="hint">（{{ doneCount }}/{{ items.length }} 项完成）</span>
            </label>
            <div class="row">
              <button v-if="hasItems" class="btn btn--small" @click="readAllItems">
                🔊 读全部
              </button>
              <button class="btn btn--small" :disabled="aiSplitting" @click="aiSplit">
                {{ aiSplitting ? 'AI 正在列…' : '✨ AI 帮我列清单' }}
              </button>
            </div>
          </div>

          <div v-if="hasItems" class="stack mt-8" style="gap: 8px">
            <div v-for="(item, i) in items" :key="item.id" class="subtask" :class="{ 'is-done': item.done }">
              <span class="pill pill--mint">{{ i + 1 }}</span>
              <span class="subtask__icon">{{ itemIcon(item) }}</span>
              <span class="grow">{{ item.title }}</span>
              <span v-if="planItemIds.includes(item.id)" class="pill pill--butter" style="font-size: 11px">家长</span>
              <button class="btn btn--ghost btn--small" @click="readOne(item)">🔊</button>
              <button
                v-if="!planItemIds.includes(item.id)"
                class="btn btn--ghost btn--small"
                @click="removeItem(item.id)"
              >
                删
              </button>
            </div>
          </div>
          <div class="row mt-8">
            <input v-model="newItemTitle" class="input" placeholder="再加一项作业，例如：背诵课文第 3 段" @keyup.enter="addItem" />
            <button class="btn" @click="addItem">添加</button>
          </div>
          <p v-if="hint" class="hint mt-8" style="white-space: pre-wrap">{{ hint }}</p>

          <label class="label mt-24">这一轮专注多久？</label>
          <div class="row row--wrap focus-choices">
            <button
              v-for="m in FOCUS_PRESETS"
              :key="m"
              class="btn"
              :class="{ 'btn--primary': !useCustomFocus && focusMinutes === m }"
              @click="pickPreset(m)"
            >
              {{ m }} 分钟
            </button>
            <label class="custom-focus" :class="{ 'is-on': useCustomFocus }">
              <input
                v-model.number="customFocusInput"
                class="input custom-focus__input"
                type="number"
                inputmode="numeric"
                :min="FOCUS_MIN"
                :max="FOCUS_MAX"
                placeholder="自定义"
                @focus="enterCustomFocus"
                @input="onCustomInput"
                @blur="onCustomBlur"
              />
              <span class="hint">分钟</span>
            </label>
          </div>
          <p class="hint mt-8">可选 {{ FOCUS_MIN }}~{{ FOCUS_MAX }} 分钟，建议一次不超过 30 分钟。</p>

          <label class="warmup-option mt-24">
            <input v-model="warmupEnabled" type="checkbox" @change="persistDraft" />
            <span class="warmup-option__text">
              <strong>开始前做 1 分钟大脑热身</strong>
              <span class="hint">呼吸 + 手指操，能更快坐得住（默认开启）</span>
            </span>
          </label>

          <button class="btn btn--warm btn--lg btn--block mt-24" @click="startSession">
            {{ warmupEnabled ? '开始大脑热身' : `直接开始 ${focusMinutes} 分钟专注` }}
          </button>
          <p class="hint center mt-8">点开始后清单就锁定了，中途不能再增删，请先确认项目列全了。</p>
          <p class="hint center mt-8">
            {{ warmupEnabled ? '先热身 1 分钟，坐下来更容易进入状态' : '已跳过热身，点开始就进入专注计时' }}
          </p>
          <p class="hint center mt-8">中途切到别的页面也没关系，回来还能接着写。</p>
        </div>
      </template>

      <!-- 热身 -->
      <template v-else-if="step === 'warmup'">
        <div class="card card--pad center">
          <p class="pill pill--mint" style="margin: 0 auto">大脑热身</p>
          <div class="warmup-emoji">{{ warmupSteps[warmupIndex].emoji }}</div>
          <h2 class="section-title">{{ warmupSteps[warmupIndex].title }}</h2>
          <p class="hint mt-8">{{ warmupSteps[warmupIndex].tip }}</p>
          <div class="big-number mt-16" style="color: var(--mint-deep)">{{ warmupLeft }}s</div>
          <div class="progress mt-16">
            <div class="progress__fill" :style="{ width: warmupProgress + '%' }"></div>
          </div>
          <div class="row mt-24" style="justify-content: center">
            <button v-if="paused" class="btn btn--primary" @click="resume">继续热身</button>
            <button v-else class="btn" @click="pause">暂停</button>
            <button class="btn btn--ghost" @click="skipWarmup">跳过热身</button>
          </div>
        </div>
      </template>

      <!-- 专注 -->
      <template v-else-if="step === 'focus'">
        <div class="card card--pad center focus-card">
          <p class="pill pill--peach" style="margin: 0 auto">第 {{ roundIndex }} 轮 · {{ taskTitle }}</p>
          <div class="focus-ring" :style="{ '--pct': focusProgress }">
            <div class="focus-ring__inner">
              <span class="focus-ring__time">{{ focusLeftText }}</span>
              <span class="hint">{{ paused ? '已暂停' : '专注中' }}</span>
            </div>
          </div>
          <div v-if="hasItems" class="focus-tasks">
            <div class="row row--between">
              <p class="hint">做完一项就勾一项（清单已锁定）</p>
              <p class="hint">{{ doneCount }}/{{ items.length }}</p>
            </div>
            <div class="stack mt-8" style="gap: 8px">
              <div v-for="item in items" :key="item.id" class="focus-row">
                <button
                  class="check-item focus-item grow"
                  :class="{ 'is-on': item.done }"
                  @click="toggleItem(item.id)"
                >
                  <span class="tick">{{ item.done ? '✓' : '' }}</span>
                  <span class="subtask__icon">{{ itemIcon(item) }}</span>
                  <span class="grow">{{ item.title }}</span>
                </button>
                <button class="btn btn--ghost btn--small" @click="readOne(item)">🔊</button>
              </div>
            </div>
          </div>
          <p v-if="hasItems && allDone" class="hint mt-8 center">清单全部完成啦，可以提前结束这一轮 🎉</p>
          <div class="row mt-24" style="justify-content: center">
            <button class="btn" :class="{ 'btn--primary': paused }" @click="paused ? resume() : pause()">
              {{ paused ? '继续' : '暂停' }}
            </button>
            <button v-if="!earlyConfirm" class="btn btn--warm" @click="finishFocusEarly">提前结束这一轮</button>
          </div>
          <div v-if="earlyConfirm" class="early-confirm mt-16">
            <p class="hint">
              还有 {{ pendingCount }} 项没勾上，现在结束会记为「未完成」。要不要再写一会儿？
            </p>
            <div class="row mt-8" style="justify-content: center">
              <button class="btn btn--primary" @click="earlyConfirm = false">回去继续写</button>
              <button class="btn btn--ghost" @click="confirmEarlyEnd">仍然结束</button>
            </div>
          </div>
        </div>
      </template>

      <!-- 自检 -->
      <template v-else-if="step === 'check'">
        <div class="card card--pad">
          <h2 class="section-title">做一个自检 ✅</h2>
          <p class="section-sub">检查不是找错，是确认自己真的完成了</p>

          <div v-if="hasItems" class="mt-24">
            <div class="row row--between">
              <label class="label" style="margin: 0">时间到时的作业清单</label>
              <span class="hint">{{ doneCount }}/{{ items.length }} 项完成</span>
            </div>
            <div class="stack mt-8" style="gap: 8px">
              <div v-for="item in items" :key="item.id" class="check-item" :class="{ 'is-on': item.done }">
                <span class="tick">{{ item.done ? '✓' : '' }}</span>
                <span class="subtask__icon">{{ itemIcon(item) }}</span>
                <span class="grow">{{ item.title }}</span>
              </div>
            </div>
            <p v-if="allDone" class="hint mt-8">清单全部完成，这次记为「正」🎉</p>
            <p v-else class="hint mt-8">
              还有 {{ pendingCount }} 项没做完，这次记为「未完成」。下次把清单拆小一点会更容易完成。
            </p>
            <p class="hint">清单已经在时间到的那一刻锁定，不能再改啦。</p>
          </div>

          <div class="stack mt-16" style="gap: 10px">
            <label v-for="(item, i) in currentChecks" :key="i" class="check-item" :class="{ 'is-on': checks[i] }">
              <input v-model="checks[i]" type="checkbox" />
              <span>{{ item }}</span>
            </label>
          </div>
          <div class="row mt-24">
            <button class="btn grow" @click="toBreak">休息一下再继续</button>
            <button class="btn btn--primary grow" :disabled="checks.some((c) => !c)" @click="finishSession">完成作业</button>
          </div>
          <p class="hint mt-8 center">四项都勾选后才能完成哦</p>
        </div>
      </template>

      <!-- 休息 -->
      <template v-else-if="step === 'break'">
        <div class="card card--pad center card--sky">
          <p class="emoji-xl">🌤️</p>
          <h2 class="section-title mt-8">休息 {{ breakMinutes }} 分钟</h2>
          <p class="hint mt-8">站起来走走、喝口水、看看窗外</p>
          <div class="big-number mt-16" style="color: var(--sky-deep)">{{ breakLeftText }}</div>
          <div class="progress mt-16">
            <div class="progress__fill" :style="{ width: breakProgress + '%' }"></div>
          </div>
          <div class="row mt-24" style="justify-content: center">
            <button v-if="paused" class="btn btn--primary" @click="resume">继续休息</button>
            <button class="btn btn--ghost" @click="skipBreak">不等了，继续下一轮</button>
          </div>
        </div>
      </template>

      <!-- 完成 -->
      <template v-else>
        <div class="card card--pad center" :class="outcome.passed ? 'card--mint' : 'card--sky'">
          <p class="pill" :class="outcome.passed ? 'pill--mint' : 'pill--peach'" style="margin: 0 auto">
            {{ outcome.passed ? '按时完成 · 正' : '未全部完成 · 负' }}
          </p>
          <p class="emoji-xl">{{ outcome.passed ? '🎉' : '🌱' }}</p>
          <h2 class="section-title mt-8">{{ outcome.passed ? '今天的作业完成啦' : '这次时间到了' }}</h2>
          <p class="section-sub">{{ taskTitle }}</p>
          <div class="grid grid--3 mt-16">
            <div class="result-stat">
              <strong>{{ rounds.length }}</strong>
              <span>完成轮次</span>
            </div>
            <div class="result-stat">
              <strong>{{ totalFocusMinutes }}</strong>
              <span>专注分钟</span>
            </div>
            <div class="result-stat">
              <strong>{{ hasItems ? `${doneCount}/${items.length}` : '—' }}</strong>
              <span>清单完成</span>
            </div>
          </div>
          <div v-if="hasItems" class="items-summary mt-16">
            <div class="row row--between">
              <span>作业清单</span>
              <strong>{{ doneCount }}/{{ items.length }} 项完成</strong>
            </div>
            <div class="progress mt-8">
              <div class="progress__fill" :style="{ width: donePercent + '%' }"></div>
            </div>
            <p v-if="!outcome.passed" class="hint mt-8">
              完成了 {{ doneCount }} 项，还差 {{ pendingCount }} 项。下次把清单拆小一点，会更容易在时间内做完。
            </p>
          </div>
          <p class="hint mt-16">
            {{
              saving
                ? '正在保存…'
                : savedPoints !== null
                  ? `当前积分 ${savedPoints}，这次番茄钟 +${outcome.points} 分（得分 ${outcome.score}）`
                  : '记录已保存'
            }}
          </p>
          <div class="row mt-16" style="justify-content: center">
            <button class="btn" @click="restartAll">再做一次</button>
            <RouterLink :to="{ name: 'kid-home' }" class="btn btn--primary">回首页</RouterLink>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.subtask {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--cream);
  border-radius: 14px;
  padding: 8px 12px;
  font-size: 16px;
}

.subtask .grow {
  line-height: 1.45;
}

.subtask__icon {
  font-size: 22px;
  line-height: 1;
  flex-shrink: 0;
}

.subtask.is-done .grow {
  color: var(--muted);
  text-decoration: line-through;
}

.focus-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.focus-choices {
  align-items: center;
}

.early-confirm {
  background: var(--cream);
  border-radius: 14px;
  padding: 12px 14px;
  text-align: left;
}

.custom-focus {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px 3px 3px;
  border-radius: 14px;
  border: 1.5px dashed var(--line);
  background: #fff;
  transition: border-color 0.16s ease, background 0.16s ease;
}

.custom-focus.is-on {
  border-color: var(--peach-deep);
  background: var(--peach-soft, #fff3ea);
}

.custom-focus__input {
  width: 86px;
  padding: 8px 6px;
  border: none;
  background: transparent;
  text-align: center;
  font-size: 15px;
}

.custom-focus__input:focus {
  outline: none;
}

.custom-focus__input::-webkit-outer-spin-button,
.custom-focus__input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.custom-focus__input {
  appearance: textfield;
  -moz-appearance: textfield;
}

.warmup-option {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 16px;
  border: 1.5px solid var(--line);
  background: #fff;
  cursor: pointer;
}

.warmup-option input {
  flex: none;
  width: 20px;
  height: 20px;
  margin-top: 2px;
  accent-color: var(--mint-deep);
}

.warmup-option__text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 15px;
}

.tick {
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 8px;
  border: 1.5px solid var(--line);
  background: #fff;
  display: grid;
  place-items: center;
  font-size: 15px;
  font-weight: 800;
  color: var(--mint-deep);
}

.check-item.is-on .tick {
  background: var(--mint-deep);
  border-color: var(--mint-deep);
  color: #fff;
}

.focus-item {
  width: 100%;
}

.items-summary {
  background: rgba(255, 255, 255, 0.7);
  border-radius: 16px;
  padding: 12px 16px;
  font-size: 15px;
}

.restore-card {
  background: var(--mint-soft);
}

.focus-card {
  background: linear-gradient(165deg, #fffdf9, #fff3ea 85%);
}

.warmup-emoji {
  font-size: 68px;
  margin: 18px 0 8px;
  animation: breathe 4s ease-in-out infinite;
}

@keyframes breathe {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.14);
  }
}

.focus-ring {
  --pct: 0;
  width: min(240px, 66vw);
  aspect-ratio: 1;
  border-radius: 50%;
  margin: 20px auto 0;
  background: conic-gradient(var(--peach-deep) calc(var(--pct) * 1%), #f5e5d9 0);
  display: grid;
  place-items: center;
}

.focus-ring__inner {
  width: 84%;
  height: 84%;
  border-radius: 50%;
  background: var(--card);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.focus-ring__time {
  font-size: clamp(36px, 11vw, 52px);
  font-weight: 800;
  letter-spacing: 2px;
  color: var(--peach-deep);
}

.focus-tasks {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px dashed var(--line);
}

.check-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 16px;
  border: 1.5px solid var(--line);
  background: #fff;
  font-family: inherit;
  font-size: 15px;
  text-align: left;
  cursor: pointer;
  transition: background 0.16s ease, border-color 0.16s ease;
}

.check-item.is-on {
  background: var(--mint-soft);
  border-color: var(--mint-deep);
}

.check-item input {
  width: 20px;
  height: 20px;
  accent-color: var(--mint-deep);
}

.result-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 16px;
  padding: 12px 8px;
}

.result-stat strong {
  font-size: 22px;
}

.result-stat span {
  font-size: 12px;
  color: var(--muted);
}
</style>
