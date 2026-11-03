import type {
  HomeworkItem,
  HomeworkPlan,
  HomeworkPlanItem,
  HomeworkProgress,
  HomeworkSession,
  HomeworkStep,
  TrainingRecord,
} from '../../../shared/types'
import { DIMENSIONS, MODULES } from '../../../shared/constants'
import { homeworkDayKey, homeworkDayKeyOffset, homeworkOutcome } from '../../../shared/homework'
import { getState } from '../../store'

const MODULE_IDS = new Set(MODULES.map((m) => m.id))
const DIMENSION_KEYS = new Set<string>(DIMENSIONS.map((d) => d.key))
const HOMEWORK_STEPS = new Set<HomeworkStep>(['setup', 'warmup', 'focus', 'check', 'break'])

/** 单次整包同步上限；超过必须分批，不能静默截断（会丢离线数据）。 */
export const MAX_RECORDS_PER_SYNC = 500
export const MAX_HOMEWORK_PER_SYNC = 200

export function sanitizeProgress(input: any): HomeworkProgress | undefined {
  if (!input || typeof input !== 'object') return undefined
  const step = HOMEWORK_STEPS.has(input.step) ? (input.step as HomeworkStep) : 'focus'
  const sec = (v: unknown, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(24 * 3600, Math.max(0, Math.round(n))) : fallback
  }
  const checks = Array.isArray(input.checks)
    ? Array.from({ length: 4 }, (_, i) => !!input.checks[i])
    : [false, false, false, false]
  return {
    step,
    focusLeftSec: sec(input.focusLeftSec, 0),
    breakLeftSec: sec(input.breakLeftSec, 0),
    warmupLeftSec: sec(input.warmupLeftSec, 0),
    roundIndex: Math.max(0, Math.round(Number(input.roundIndex) || 0)),
    roundStartedAt: Math.max(0, Math.round(Number(input.roundStartedAt) || 0)),
    checks,
    paused: input.paused !== false,
  }
}

export function sanitizeRecord(input: any, profileId: string): TrainingRecord | null {
  if (!input || typeof input !== 'object') return null
  if (!MODULE_IDS.has(input.module)) return null
  // 番茄钟记录只能由服务端从作业会话派生（rec_hw_<会话id>），不接受客户端直接上报
  if (input.module === 'pomodoro') return null
  const numeric = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  // 维度分同样要裁剪：客户端传 999 / 负数会直接抬高六维均值与徽章判定
  const dimensionScores: TrainingRecord['dimensionScores'] = {}
  if (input.dimensionScores && typeof input.dimensionScores === 'object') {
    for (const [key, value] of Object.entries(input.dimensionScores)) {
      if (!DIMENSION_KEYS.has(key)) continue
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      dimensionScores[key as keyof typeof dimensionScores] = Math.min(100, Math.max(0, Math.round(value)))
    }
  }
  return {
    id: typeof input.id === 'string' && input.id ? input.id : `rec_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    profileId,
    module: input.module,
    startedAt: numeric(input.startedAt, Date.now()),
    endedAt: numeric(input.endedAt, Date.now()),
    durationSec: Math.max(0, numeric(input.durationSec)),
    difficulty: numeric(input.difficulty, 1),
    accuracy: Math.min(1, Math.max(0, numeric(input.accuracy))),
    avgReactionMs: Math.max(0, numeric(input.avgReactionMs)),
    score: Math.min(100, Math.max(0, numeric(input.score))),
    totalTrials: Math.max(0, numeric(input.totalTrials)),
    correctTrials: Math.max(0, numeric(input.correctTrials)),
    errors: Array.isArray(input.errors)
      ? input.errors.slice(0, 12).map((e: any) => ({ type: String(e?.type ?? 'unknown'), count: numeric(e?.count) }))
      : [],
    dimensionScores,
    updatedAt: numeric(input.updatedAt, Date.now()),
  }
}

export function sanitizeHomework(input: any, profileId: string, existing?: HomeworkSession): HomeworkSession | null {
  if (!input || typeof input !== 'object' || typeof input.id !== 'string') return null
  // 兼容旧客户端：没有 items 时把 subtasks 转成未完成项
  const legacy = Array.isArray(input.subtasks) ? input.subtasks : []
  const rawItems = Array.isArray(input.items) ? input.items : legacy
  const parsed: HomeworkItem[] = (rawItems as any[]).slice(0, 12).map((raw: any, i: number): HomeworkItem => {
    const isObject = raw && typeof raw === 'object'
    const title = String(isObject ? raw.title ?? '' : raw).slice(0, 60).trim()
    return {
      id: String(isObject && raw.id ? raw.id : `${input.id}_i${i}`).slice(0, 40),
      title: title || '未命名作业',
      done: isObject ? !!raw.done : false,
      ...(isObject && typeof raw.doneAt === 'number' ? { doneAt: raw.doneAt } : {}),
      ...(isObject && typeof raw.icon === 'string' && raw.icon ? { icon: raw.icon.slice(0, 8) } : {}),
      ...(isObject && typeof raw.subject === 'string' && raw.subject ? { subject: raw.subject.slice(0, 20) } : {}),
    }
  })
  let items: HomeworkItem[] = parsed
  // 开始后锁定清单：已存在的会话不允许增删项或改标题，只接受 done / doneAt 变化。
  // 会话一旦结算（status=done），清单连 done 也冻结，避免事后翻盘改判定。
  if (existing && existing.items.length) {
    const frozen = existing.status === 'done'
    const incoming = new Map(items.map((item) => [item.id, item]))
    items = existing.items.map((locked) => {
      const next = incoming.get(locked.id)
      if (frozen || !next) return { ...locked }
      const merged: HomeworkItem = { ...locked, done: next.done }
      if (next.done && next.doneAt) merged.doneAt = next.doneAt
      return merged
    })
  }
  const rawStatus = ['running', 'done', 'abandoned'].includes(input.status) ? input.status : 'running'
  // 终态不可回退：已结算或已作废的会话不会被迟到的 running 提交重新拉回进行中
  const status =
    existing && existing.status !== 'running' && rawStatus === 'running' ? existing.status : rawStatus
  // 会话首次落库时绑定家长计划，之后不允许改写
  const rawPlanId = typeof input.planId === 'string' ? input.planId.slice(0, 40) : ''
  const knownPlan = rawPlanId ? getState().homeworkPlans.find((p) => p.id === rawPlanId) : undefined
  const planId = existing
    ? existing.planId
    : knownPlan && !knownPlan.archivedAt && knownPlan.profileId === profileId
      ? rawPlanId
      : undefined
  const session: HomeworkSession = {
    id: input.id,
    profileId,
    ...(planId ? { planId } : {}),
    taskTitle: String(input.taskTitle ?? '作业').slice(0, 80),
    items,
    plannedFocusMinutes: Math.min(60, Math.max(5, Math.round(Number(input.plannedFocusMinutes) || 25))),
    rounds: Array.isArray(input.rounds) ? input.rounds.slice(0, 8) : [],
    ...(status === 'running' ? { progress: sanitizeProgress(input.progress) } : {}),
    status,
    startedAt: Number(input.startedAt) || Date.now(),
    endedAt: typeof input.endedAt === 'number' ? input.endedAt : null,
    updatedAt: Number(input.updatedAt) || Date.now(),
  }
  // 判定由服务端按清单状态计算，客户端传来的 verdict 一律忽略
  if (session.status === 'done') {
    const outcome = homeworkOutcome(session)
    session.verdict = outcome.passed ? 'pass' : 'fail'
    session.verdictAt = session.endedAt ?? session.updatedAt
  }
  return session
}

export function sanitizeHomeworkPlan(input: any, profileId: string, existing?: HomeworkPlan): HomeworkPlan | null {
  if (!input || typeof input !== 'object') return null
  const planDate = String(input.planDate ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(planDate)) return null
  const parsed = new Date(`${planDate}T00:00:00`)
  if (Number.isNaN(parsed.getTime()) || homeworkDayKey(parsed.getTime()) !== planDate) return null
  const now = Date.now()
  // 允许今天起前后 30 天，兼容容器 UTC 与家庭本地时区的日界差
  if (parsed.getTime() < now - 30 * 24 * 3600 * 1000 || parsed.getTime() > now + 30 * 24 * 3600 * 1000) {
    return null
  }
  const rawItems = Array.isArray(input.items) ? input.items : []
  if (!rawItems.length || rawItems.length > 12) return null
  const items: HomeworkPlanItem[] = rawItems
    .map((raw: any, i: number): HomeworkPlanItem => ({
      id: String(raw?.id ? raw.id : `hpi_${now}_${i}`).slice(0, 40),
      title: String(raw?.title ?? '').slice(0, 60).trim(),
      ...(typeof raw?.icon === 'string' && raw.icon ? { icon: raw.icon.slice(0, 8) } : {}),
    }))
    .filter((item: HomeworkPlanItem) => item.title.length > 0)
  if (!items.length) return null
  return {
    id: existing?.id ?? `hp_${now}_${Math.random().toString(16).slice(2, 8)}`,
    profileId,
    planDate,
    subject: String(input.subject ?? '').slice(0, 20).trim() || undefined,
    title: String(input.title ?? '').slice(0, 80).trim() || '今天的作业',
    items,
    createdBy: 'parent',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

/** 作业计划只用于当天录入，保留 60 天后清理；会话已经复制了清单，不受影响。 */
const HOMEWORK_PLAN_RETENTION_DAYS = 60

export function pruneHomeworkPlans(): void {
  const state = getState()
  const cutoff = homeworkDayKeyOffset(-HOMEWORK_PLAN_RETENTION_DAYS)
  const before = state.homeworkPlans.length
  state.homeworkPlans = state.homeworkPlans.filter((p) => p.planDate >= cutoff)
  if (state.homeworkPlans.length !== before) {
    console.info(`[homeworkPlan] 清理 ${before - state.homeworkPlans.length} 份超过 ${HOMEWORK_PLAN_RETENTION_DAYS} 天的作业计划`)
  }
}

export function profileOf(session: { role: string; profileId?: string }, requested: string | undefined): string | null {
  if (session.role === 'child') return session.profileId ?? null
  if (requested) return requested
  return getState().profiles[0]?.id ?? null
}
