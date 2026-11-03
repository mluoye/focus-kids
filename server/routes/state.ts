import { Hono } from 'hono'
import type { HomeworkPlan, HomeworkSession, TrainingRecord } from '../../shared/types'
import { homeworkDayKey, isHomeworkStale, homeworkOutcome } from '../../shared/homework'
import { mergeById, applySettingsPatch, applyTtsPrefs, writePruneBackup } from '../store'
import { getFamilyCache, persistFamily } from '../db/store'
import { requireAuth, requireParent, type AppEnv } from '../middleware'
import { evaluateBadges, recomputePoints } from '../awards'
import { buildSnapshot } from '../snapshot'
import { invalidJson, readJson } from '../json'
import { pomodoroRecordId, syncHomeworkRecords } from '../records'
import {
  MAX_RECORDS_PER_SYNC,
  MAX_HOMEWORK_PER_SYNC,
  sanitizeProgress,
  sanitizeRecord,
  sanitizeHomework,
  sanitizeHomeworkPlan,
  pruneHomeworkPlans,
  profileOf,
} from './state/sanitize'

export const stateRoutes = new Hono<AppEnv>()

/** 超过 2 小时没动作的进行中作业自动作废。 */
function expireStaleHomework(cache: ReturnType<typeof getFamilyCache>): boolean {
  const now = Date.now()
  let changed = false
  for (const hw of cache.homework) {
    if (!isHomeworkStale(hw, now)) continue
    hw.status = 'abandoned'
    hw.endedAt = hw.updatedAt
    delete hw.progress
    changed = true
  }
  return changed
}

stateRoutes.get('/', requireAuth, async (c) => {
  const session = c.get('session')
  const familyId = c.get('familyId')
  const cache = getFamilyCache(familyId)
  if (expireStaleHomework(cache)) persistFamily(familyId)
  return c.json(buildSnapshot(familyId, session.role, session.profileId))
})

/** 离线数据整包同步：记录级 LWW 合并，重复提交幂等。 */
stateRoutes.post('/', requireAuth, async (c) => {
  const session = c.get('session')
  const familyId = c.get('familyId')
  const state = getFamilyCache(familyId)
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const targetProfile = profileOf(state, session, typeof body.profileId === 'string' ? body.profileId : undefined)
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
    const hw = sanitizeHomework(raw, owner, state.homeworkPlans, state.homework.find((h) => h.id === raw?.id))
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
  persistFamily(familyId)
  return c.json(buildSnapshot(familyId, session.role, session.profileId))
})

/** 单条训练记录上报（在线主路径，服务端权威发积分/徽章）。 */
stateRoutes.post('/records', requireAuth, async (c) => {
  const session = c.get('session')
  const familyId = c.get('familyId')
  const state = getFamilyCache(familyId)
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
  persistFamily(familyId)
  return c.json({
    snapshot: buildSnapshot(familyId, session.role, session.profileId),
    unlocked: unlocked.map((id) => ({ id, isNew: !before.has(id) })),
    points: profile.points,
  })
})

stateRoutes.post('/homework', requireAuth, async (c) => {
  const session = c.get('session')
  const familyId = c.get('familyId')
  const state = getFamilyCache(familyId)
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const profileId = session.role === 'child' ? session.profileId : String(body?.session?.profileId ?? '')
  if (!profileId || !state.profiles.some((p) => p.id === profileId)) {
    return c.json({ error: '无效的孩子档案', code: 'NO_PROFILE' }, 400)
  }
  const hw = sanitizeHomework(body?.session, profileId, state.homeworkPlans, state.homework.find((h) => h.id === body?.session?.id))
  if (!hw) return c.json({ error: '作业记录格式不正确', code: 'INVALID_SESSION' }, 400)
  state.homework = mergeById(state.homework, [hw])
  syncHomeworkRecords(state)
  recomputePoints(state)
  const profile = state.profiles.find((p) => p.id === profileId)!
  const unlocked = evaluateBadges(state, profile)
  persistFamily(familyId)
  return c.json({ snapshot: buildSnapshot(familyId, session.role, session.profileId), unlocked, points: profile.points })
})

/** 家长录入/修改某天的作业清单：按 profileId + planDate 一天一份，upsert。 */
stateRoutes.put('/homework-plan', requireAuth, requireParent, async (c) => {
  const familyId = c.get('familyId')
  const state = getFamilyCache(familyId)
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const raw = body?.plan
  const profileId = String(raw?.profileId ?? '')
  if (!profileId || !state.profiles.some((p) => p.id === profileId)) {
    return c.json({ error: '无效的孩子档案', code: 'NO_PROFILE' }, 400)
  }
  const planDate = String(raw?.planDate ?? '').slice(0, 10)
  const subject = String(raw?.subject ?? '').slice(0, 20).trim()
  const existing = state.homeworkPlans.find(
    (p) => p.profileId === profileId && p.planDate === planDate && (p.subject ?? '') === subject,
  )
  const plan = sanitizeHomeworkPlan(raw, profileId, existing)
  if (!plan) {
    return c.json({ error: '作业清单格式不正确（1~12 项，日期需在前后 30 天内）', code: 'INVALID_PLAN' }, 400)
  }
  plan.archivedAt = undefined
  state.homeworkPlans = mergeById(state.homeworkPlans, [plan])
  pruneHomeworkPlans(state)
  persistFamily(familyId)
  return c.json({ snapshot: buildSnapshot(familyId, 'parent') })
})

/** 软删除某份作业清单；孩子已经开始的会话不受影响。 */
stateRoutes.delete('/homework-plan/:id', requireAuth, requireParent, async (c) => {
  const familyId = c.get('familyId')
  const state = getFamilyCache(familyId)
  const plan = state.homeworkPlans.find((p) => p.id === c.req.param('id'))
  if (!plan) return c.json({ error: '作业清单不存在', code: 'PLAN_NOT_FOUND' }, 404)
  plan.archivedAt = Date.now()
  plan.updatedAt = plan.archivedAt
  persistFamily(familyId)
  return c.json({ snapshot: buildSnapshot(familyId, 'parent') })
})

stateRoutes.patch('/settings', requireAuth, requireParent, async (c) => {
  const familyId = c.get('familyId')
  const state = getFamilyCache(familyId)
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const limits = body?.limits ?? {}
  const clamp = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
  }
  state.settings = applySettingsPatch(state.settings, {
    ai: body?.ai,
    tts: body?.tts,
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
  persistFamily(familyId)
  return c.json(buildSnapshot(familyId, 'parent', sessionProfile(c)))
})

stateRoutes.patch('/tts-prefs', requireAuth, async (c) => {
  const session = c.get('session')
  const familyId = c.get('familyId')
  if (session.role !== 'child') {
    return c.json({ error: '只有孩子账号能改自己的朗读偏好', code: 'FORBIDDEN' }, 403)
  }
  const profileId = session.profileId
  if (!profileId) return c.json({ error: '无效的孩子档案', code: 'NO_PROFILE' }, 400)
  const state = getFamilyCache(familyId)
  const profile = state.profiles.find((p) => p.id === profileId)
  if (!profile) return c.json({ error: '档案不存在', code: 'NOT_FOUND' }, 404)
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  profile.ttsPrefs = applyTtsPrefs(profile, {
    ...(body?.order !== undefined ? { order: body.order } : {}),
    ...(body?.voice !== undefined ? { voice: body.voice } : {}),
  })
  persistFamily(familyId)
  return c.json(buildSnapshot(familyId, 'child', profileId))
})

/** 数据导出（家长）：按孩子/时间范围导出训练记录与作业会话。 */
stateRoutes.post('/export', requireAuth, requireParent, async (c) => {
  const familyId = c.get('familyId')
  const state = getFamilyCache(familyId)
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const profileId = typeof body.profileId === 'string' ? body.profileId : ''
  const from = Number.isFinite(Number(body.from)) ? Number(body.from) : 0
  const to = Number.isFinite(Number(body.to)) ? Number(body.to) : Date.now() + 1
  if (profileId && !state.profiles.some((p) => p.id === profileId)) {
    return c.json({ error: '无效的孩子档案', code: 'NO_PROFILE' }, 400)
  }
  const inScope = (pid: string, t: number) => (!profileId || pid === profileId) && t >= from && t <= to
  const records = state.records.filter((r) => inScope(r.profileId, r.startedAt))
  const homework = state.homework.filter((h) => inScope(h.profileId, h.startedAt))
  return c.json({
    exportedAt: Date.now(),
    scope: { profileId: profileId || null, from, to },
    counts: { records: records.length, homework: homework.length },
    records,
    homework,
  })
})

/** 数据清理（家长）：删除 `before` 之前的记录与作业会话。 */
stateRoutes.post('/prune', requireAuth, requireParent, async (c) => {
  const familyId = c.get('familyId')
  const state = getFamilyCache(familyId)
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const profileId = typeof body.profileId === 'string' ? body.profileId : ''
  const before = Number(body.before)
  if (!Number.isFinite(before) || before <= 0) {
    return c.json({ error: '请指定清理截止时间 before（毫秒时间戳）', code: 'INVALID_RANGE' }, 400)
  }
  if (before > Date.now() - 24 * 3600 * 1000) {
    return c.json({ error: '只能清理 24 小时之前的数据，防止误删最近记录', code: 'RANGE_TOO_RECENT' }, 400)
  }
  if (profileId && !state.profiles.some((p) => p.id === profileId)) {
    return c.json({ error: '无效的孩子档案', code: 'NO_PROFILE' }, 400)
  }
  const matches = (pid: string, t: number) => (!profileId || pid === profileId) && t < before
  const removedSessions = state.homework.filter(
    (h) => h.status !== 'running' && matches(h.profileId, h.endedAt ?? h.updatedAt),
  )
  const removedRecords = state.records.filter((r) => matches(r.profileId, r.endedAt))
  const derivedIds = new Set(removedSessions.map((s) => pomodoroRecordId(s.id)))
  const recordsToRemove = new Set([...removedRecords.map((r) => r.id), ...derivedIds])
  const backupFile = await writePruneBackup(
    {
      exportedAt: Date.now(),
      before,
      profileId: profileId || null,
      records: state.records.filter((r) => recordsToRemove.has(r.id)),
      homework: removedSessions,
    },
    profileId || 'all',
  )
  state.records = state.records.filter((r) => !recordsToRemove.has(r.id))
  state.homework = state.homework.filter((h) => !removedSessions.some((x) => x.id === h.id))
  recomputePoints(state)
  for (const profile of state.profiles) evaluateBadges(state, profile)
  persistFamily(familyId)
  return c.json({
    snapshot: buildSnapshot(familyId, 'parent'),
    removed: { records: recordsToRemove.size, homework: removedSessions.length },
    backupFile,
    before,
  })
})

function sessionProfile(c: any): string | undefined {
  return c.get('session').profileId
}
