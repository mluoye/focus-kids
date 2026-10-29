import { Hono } from 'hono'
import type {
  HomeworkItem,
  HomeworkPlan,
  HomeworkPlanItem,
  HomeworkProgress,
  HomeworkSession,
  HomeworkStep,
  TrainingRecord,
} from '../../shared/types'
import { DIMENSIONS, MODULES } from '../../shared/constants'
import { homeworkDayKey, homeworkDayKeyOffset, isHomeworkStale, homeworkOutcome } from '../../shared/homework'
import { getState, saveState, mergeById, applySettingsPatch } from '../store'
import { requireAuth, requireParent, type AppEnv } from '../middleware'
import { evaluateBadges, recomputePoints } from '../awards'
import { buildSnapshot } from '../snapshot'
import { invalidJson, readJson } from '../json'
import { syncHomeworkRecords } from '../records'

const MODULE_IDS = new Set(MODULES.map((m) => m.id))
const DIMENSION_KEYS = new Set<string>(DIMENSIONS.map((d) => d.key))
const HOMEWORK_STEPS = new Set<HomeworkStep>(['setup', 'warmup', 'focus', 'check', 'break'])

/** 单次整包同步上限；超过必须分批，不能静默截断（会丢离线数据）。 */
const MAX_RECORDS_PER_SYNC = 500
const MAX_HOMEWORK_PER_SYNC = 200

function sanitizeProgress(input: any): HomeworkProgress | undefined {
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

function sanitizeRecord(input: any, profileId: string): TrainingRecord | null {
  if (!input || typeof input !== 'object') return null
  if (!MODULE_IDS.has(input.module)) return null
  // 番茄钟记录只能由服务端从作业会话派生（rec_hw_<会话id>），不接受客户端直接上报：
  // 否则孩子可以伪造番茄钟记录刷积分/徽章。
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
  const record: TrainingRecord = {
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
  return record
}

function sanitizeHomework(input: any, profileId: string, existing?: HomeworkSession): HomeworkSession | null {
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
    }
  })
  let items: HomeworkItem[] = parsed
  // 开始后锁定清单：已存在的会话不允许增删项或改标题，只接受 done / doneAt 变化。
  // 这样孩子无法在计时中途缩小清单来保证「正」。
  // 会话一旦结算（status=done，判定已落库），清单连 done 也冻结，避免事后翻盘改判定。
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
  // 会话首次落库时绑定家长计划，之后不允许改写（避免事后把自建清单挂到家长计划上）。
  const rawPlanId = typeof input.planId === 'string' ? input.planId.slice(0, 40) : ''
  const knownPlan = rawPlanId ? getState().homeworkPlans.find((p) => p.id === rawPlanId) : undefined
  // 已落库的会话以既有 planId 为准：自建清单之后补传 planId 也不会被接受。
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
  // 判定由服务端按清单状态计算，客户端传来的 verdict 一律忽略；
  // 历史会话在 4→5 迁移里已按旧规则记为 pass，不受影响。
  if (session.status === 'done') {
    const outcome = homeworkOutcome(session)
    session.verdict = outcome.passed ? 'pass' : 'fail'
    session.verdictAt = session.endedAt ?? session.updatedAt
  }
  return session
}

function sanitizeHomeworkPlan(input: any, profileId: string, existing?: HomeworkPlan): HomeworkPlan | null {
  if (!input || typeof input !== 'object') return null
  const planDate = String(input.planDate ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(planDate)) return null
  const parsed = new Date(`${planDate}T00:00:00`)
  if (Number.isNaN(parsed.getTime()) || homeworkDayKey(parsed.getTime()) !== planDate) return null
  const now = Date.now()
  // 允许今天起前后 30 天，兼容容器 UTC 与家庭本地时区的日界差；超出多半是客户端算错。
  if (parsed.getTime() < now - 30 * 24 * 3600 * 1000 || parsed.getTime() > now + 30 * 24 * 3600 * 1000) {
    return null
  }
  const rawItems = Array.isArray(input.items) ? input.items : []
  // 上限要么报错要么分批，不能静默截断后当作全部保存
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
    title: String(input.title ?? '').slice(0, 80).trim() || '今天的作业',
    items,
    createdBy: 'parent',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

/** 作业计划只用于当天录入，保留 60 天后清理；会话已经复制了清单，不受影响。 */
const HOMEWORK_PLAN_RETENTION_DAYS = 60

function pruneHomeworkPlans(): void {
  const state = getState()
  const cutoff = homeworkDayKeyOffset(-HOMEWORK_PLAN_RETENTION_DAYS)
  const before = state.homeworkPlans.length
  state.homeworkPlans = state.homeworkPlans.filter((p) => p.planDate >= cutoff)
  if (state.homeworkPlans.length !== before) {
    console.info(`[homeworkPlan] 清理 ${before - state.homeworkPlans.length} 份超过 ${HOMEWORK_PLAN_RETENTION_DAYS} 天的作业计划`)
  }
}

function profileOf(session: { role: string; profileId?: string }, requested: string | undefined): string | null {
  if (session.role === 'child') return session.profileId ?? null
  if (requested) return requested
  return getState().profiles[0]?.id ?? null
}

export const stateRoutes = new Hono<AppEnv>()

/** 超过 2 小时没动作的进行中作业自动作废，避免家长端一直显示「正在写作业」。 */
async function expireStaleHomework(): Promise<void> {
  const state = getState()
  const now = Date.now()
  let changed = false
  for (const hw of state.homework) {
    if (!isHomeworkStale(hw, now)) continue
    hw.status = 'abandoned'
    hw.endedAt = hw.updatedAt
    delete hw.progress
    changed = true
  }
  if (changed) await saveState()
}

stateRoutes.get('/', requireAuth, async (c) => {
  const session = c.get('session')
  await expireStaleHomework()
  return c.json(buildSnapshot(session.role, session.profileId))
})

/** 离线数据整包同步：记录级 LWW 合并，重复提交幂等。 */
stateRoutes.post('/', requireAuth, async (c) => {
  const session = c.get('session')
  const state = getState()
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const targetProfile = profileOf(session, typeof body.profileId === 'string' ? body.profileId : undefined)
  if (!targetProfile) return c.json({ error: '还没有孩子档案', code: 'NO_PROFILE' }, 400)

  const rawRecords = Array.isArray(body.records) ? body.records : []
  const rawHomework = Array.isArray(body.homework) ? body.homework : []
  if (rawRecords.length > MAX_RECORDS_PER_SYNC || rawHomework.length > MAX_HOMEWORK_PER_SYNC) {
    return c.json(
      {
        error: `单次同步最多 ${MAX_RECORDS_PER_SYNC} 条记录 / ${MAX_HOMEWORK_PER_SYNC} 个作业会话，请分批提交`,
        code: 'TOO_MANY_ITEMS',
        maxRecords: MAX_RECORDS_PER_SYNC,
        maxHomework: MAX_HOMEWORK_PER_SYNC,
      },
      400,
    )
  }

  const incomingRecords: TrainingRecord[] = []
  for (const raw of rawRecords) {
    const record = sanitizeRecord(raw, session.role === 'child' ? targetProfile : String(raw?.profileId ?? targetProfile))
    if (record) incomingRecords.push(record)
  }
  const incomingHomework: HomeworkSession[] = []
  for (const raw of rawHomework) {
    const owner = session.role === 'child' ? targetProfile : String(raw?.profileId ?? targetProfile)
    const hw = sanitizeHomework(raw, owner, state.homework.find((h) => h.id === raw?.id))
    if (hw) incomingHomework.push(hw)
  }

  state.records = mergeById(state.records, incomingRecords)
  state.homework = mergeById(state.homework, incomingHomework)
  syncHomeworkRecords(state)
  recomputePoints(state)
  for (const profile of state.profiles) {
    if (session.role === 'child' && profile.id !== targetProfile) continue
    evaluateBadges(state, profile)
  }
  await saveState()
  return c.json(buildSnapshot(session.role, session.profileId))
})

/** 单条训练记录上报（在线主路径，服务端权威发积分/徽章）。 */
stateRoutes.post('/records', requireAuth, async (c) => {
  const session = c.get('session')
  const state = getState()
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const profileId = session.role === 'child' ? session.profileId : String(body?.record?.profileId ?? body?.profileId ?? '')
  if (!profileId || !state.profiles.some((p) => p.id === profileId)) {
    return c.json({ error: '无效的孩子档案', code: 'NO_PROFILE' }, 400)
  }
  const record = sanitizeRecord(body?.record, profileId)
  if (!record) return c.json({ error: '训练记录格式不正确', code: 'INVALID_RECORD' }, 400)
  state.records = mergeById(state.records, [record])
  recomputePoints(state)
  const profile = state.profiles.find((p) => p.id === profileId)!
  const before = new Set(profile.badges.map((b) => b.id))
  const unlocked = evaluateBadges(state, profile)
  await saveState()
  return c.json({
    snapshot: buildSnapshot(session.role, session.profileId),
    unlocked: unlocked.map((id) => ({ id, isNew: !before.has(id) })),
    points: profile.points,
  })
})

stateRoutes.post('/homework', requireAuth, async (c) => {
  const session = c.get('session')
  const state = getState()
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const profileId = session.role === 'child' ? session.profileId : String(body?.session?.profileId ?? '')
  if (!profileId || !state.profiles.some((p) => p.id === profileId)) {
    return c.json({ error: '无效的孩子档案', code: 'NO_PROFILE' }, 400)
  }
  const hw = sanitizeHomework(body?.session, profileId, state.homework.find((h) => h.id === body?.session?.id))
  if (!hw) return c.json({ error: '作业记录格式不正确', code: 'INVALID_SESSION' }, 400)
  state.homework = mergeById(state.homework, [hw])
  syncHomeworkRecords(state)
  recomputePoints(state)
  const profile = state.profiles.find((p) => p.id === profileId)!
  const unlocked = evaluateBadges(state, profile)
  await saveState()
  return c.json({ snapshot: buildSnapshot(session.role, session.profileId), unlocked, points: profile.points })
})

/** 家长录入/修改某天的作业清单：按 profileId + planDate 一天一份，upsert。 */
stateRoutes.put('/homework-plan', requireAuth, requireParent, async (c) => {
  const state = getState()
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const raw = body?.plan
  const profileId = String(raw?.profileId ?? '')
  if (!profileId || !state.profiles.some((p) => p.id === profileId)) {
    return c.json({ error: '无效的孩子档案', code: 'NO_PROFILE' }, 400)
  }
  const planDate = String(raw?.planDate ?? '').slice(0, 10)
  const existing = state.homeworkPlans.find((p) => p.profileId === profileId && p.planDate === planDate)
  const plan = sanitizeHomeworkPlan(raw, profileId, existing)
  if (!plan) {
    return c.json({ error: '作业清单格式不正确（1~12 项，日期需在前后 30 天内）', code: 'INVALID_PLAN' }, 400)
  }
  // 重新保存同一天的清单视为恢复，清掉软删除标记
  plan.archivedAt = undefined
  state.homeworkPlans = mergeById(state.homeworkPlans, [plan])
  pruneHomeworkPlans()
  await saveState()
  return c.json({ snapshot: buildSnapshot('parent') })
})

/** 软删除某份作业清单；孩子已经开始的会话不受影响。 */
stateRoutes.delete('/homework-plan/:id', requireAuth, requireParent, async (c) => {
  const state = getState()
  const plan = state.homeworkPlans.find((p) => p.id === c.req.param('id'))
  if (!plan) return c.json({ error: '作业清单不存在', code: 'PLAN_NOT_FOUND' }, 404)
  plan.archivedAt = Date.now()
  plan.updatedAt = plan.archivedAt
  await saveState()
  return c.json({ snapshot: buildSnapshot('parent') })
})

stateRoutes.patch('/settings', requireAuth, requireParent, async (c) => {
  const state = getState()
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const limits = body?.limits ?? {}
  const clamp = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
  }
  state.settings = applySettingsPatch(state.settings, {
    ai: body?.ai,
    limits: {
      dailyTrainingMinutes: clamp(limits.dailyTrainingMinutes, 5, 240, state.settings.limits.dailyTrainingMinutes),
      sessionMinutes: clamp(limits.sessionMinutes, 5, 60, state.settings.limits.sessionMinutes),
      breakMinutes: clamp(limits.breakMinutes, 1, 30, state.settings.limits.breakMinutes),
      dailyBadgeLimit: clamp(limits.dailyBadgeLimit, 1, 30, state.settings.limits.dailyBadgeLimit),
      blockedRanges: Array.isArray(limits.blockedRanges)
        ? limits.blockedRanges
            .slice(0, 6)
            .map((r: any) => ({
              start: String(r?.start ?? '21:30').slice(0, 5),
              end: String(r?.end ?? '07:30').slice(0, 5),
              label: String(r?.label ?? '禁用时段').slice(0, 20),
            }))
        : state.settings.limits.blockedRanges,
      homeworkExempt: limits.homeworkExempt !== false,
    },
  })
  await saveState()
  return c.json(buildSnapshot('parent', sessionProfile(c)))
})

function sessionProfile(c: any): string | undefined {
  return c.get('session').profileId
}
