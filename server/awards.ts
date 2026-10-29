import { BADGES, DIMENSIONS, DIMENSION_WINDOW, MODULES } from '../shared/constants'
import { POMODORO_POINTS } from '../shared/homework'
import type { AttentionDimension, HomeworkSession, TrainingRecord } from '../shared/types'
import type { AppState, ProfileRecord } from './store'

/** 游戏模块的固定积分；番茄钟单独按正/负计算 */
const MODULE_POINTS: Record<string, number> = {
  stroop: 8,
  capture: 8,
  nback: 10,
  switch: 8,
  tracking: 10,
}

/** 番茄钟：正 20 / 负 10。旧记录没有 passed 时按「正」处理（迁移已回填）。 */
function pointsOf(record: TrainingRecord): number {
  if (record.module === 'pomodoro') {
    return record.passed === false ? POMODORO_POINTS.fail : POMODORO_POINTS.pass
  }
  return MODULE_POINTS[record.module] ?? 6
}

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 积分完全由训练记录推导，重复同步不会重复加分。作业的 +20 已折算为番茄钟记录（`rec_hw_<会话id>`），不再单独累加。 */
export function recomputePoints(state: AppState) {
  for (const profile of state.profiles) {
    const records = state.records.filter((r) => r.profileId === profile.id)
    let points = 0
    for (const r of records) points += pointsOf(r)
    profile.points = points
  }
}

export function dimensionAverages(records: TrainingRecord[]): Partial<Record<AttentionDimension, number>> {
  const bucket = new Map<AttentionDimension, number[]>()
  for (const record of records) {
    for (const [key, value] of Object.entries(record.dimensionScores) as [AttentionDimension, number][]) {
      if (typeof value !== 'number' || Number.isNaN(value)) continue
      const list = bucket.get(key) ?? []
      list.push(value)
      bucket.set(key, list)
    }
  }
  // 只统计“最近 10 条”已由调用方控制；这里对各维度取平均
  const result: Partial<Record<AttentionDimension, number>> = {}
  for (const dim of DIMENSIONS) {
    const list = bucket.get(dim.key)
    if (list?.length) result[dim.key] = Math.round(list.reduce((a, b) => a + b, 0) / list.length)
  }
  return result
}

export function streakDays(records: TrainingRecord[]): number {
  if (!records.length) return 0
  const days = new Set(records.map((r) => startOfDay(r.startedAt)))
  let streak = 0
  let cursor = startOfDay(Date.now())
  // 今天没练也算：从昨天开始数，最多回看 60 天
  if (!days.has(cursor)) cursor -= 24 * 3600 * 1000
  while (days.has(cursor) && streak < 60) {
    streak += 1
    cursor -= 24 * 3600 * 1000
  }
  return streak
}

function badgesUnlockedToday(profile: ProfileRecord): number {
  const today = startOfDay(Date.now())
  return profile.badges.filter((b) => startOfDay(b.unlockedAt) === today).length
}

/** 服务端权威判定徽章，并执行“每日徽章上限”。 */
export function evaluateBadges(state: AppState, profile: ProfileRecord): string[] {
  const records = state.records.filter((r) => r.profileId === profile.id)
  const recent = [...records].sort((a, b) => b.startedAt - a.startedAt).slice(0, DIMENSION_WINDOW)
  const moduleCount: Partial<Record<string, number>> = {}
  for (const r of records) moduleCount[r.module] = (moduleCount[r.module] ?? 0) + 1
  const stats = {
    dimensionAvg: dimensionAverages(recent),
    moduleCount,
    totalRecords: records.length,
    streakDays: streakDays(records),
  }
  const owned = new Set(profile.badges.map((b) => b.id))
  const unlocked: string[] = []
  for (const badge of BADGES) {
    if (owned.has(badge.id)) continue
    // 解锁后立即 push 进 profile.badges，这里只需看今日实际条数；
    // 若再叠加 unlocked.length 会重复计数，导致同一次判定里「上限提前触发」。
    if (badgesUnlockedToday(profile) >= state.settings.limits.dailyBadgeLimit) break
    if (badge.check(stats)) {
      const entry = { id: badge.id, unlockedAt: Date.now() }
      profile.badges.push(entry)
      unlocked.push(badge.id)
    }
  }
  return unlocked
}

export function moduleName(id: string): string {
  return MODULES.find((m) => m.id === id)?.name ?? id
}

export function homeworkDoneCount(sessions: HomeworkSession[]): number {
  return sessions.filter((s) => s.status === 'done').length
}
