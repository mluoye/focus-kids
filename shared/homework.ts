import { HOMEWORK_STALE_MS } from './constants'
import type { HomeworkSession } from './types'

/** 家庭本地日 `YYYY-MM-DD`。跨时区/容器部署时，日期一律由客户端生成，服务端只存字符串。 */
export function homeworkDayKey(ts = Date.now()): string {
  const d = new Date(ts)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/** 以某个时间点为基准偏移若干天，用于「今天/明天」与快照日期窗口。 */
export function homeworkDayKeyOffset(days: number, from = Date.now()): string {
  return homeworkDayKey(from + days * 24 * 60 * 60 * 1000)
}

/** 进行中的作业超过 2 小时没有动作就视为过期，前后端共用同一口径。 */
export function isHomeworkStale(session: HomeworkSession, now = Date.now()): boolean {
  return session.status === 'running' && now - (session.updatedAt || 0) > HOMEWORK_STALE_MS
}

export function homeworkDoneCount(session: HomeworkSession): number {
  return session.items.filter((item) => item.done).length
}

export function homeworkRoundCount(session: HomeworkSession): number {
  return session.progress?.roundIndex ?? session.rounds.length
}

/** 番茄钟判定结果：清单全部完成才算「正」 */
export interface HomeworkOutcome {
  done: number
  total: number
  /** 完成率 0~1；没有清单时视为 1 */
  completion: number
  passed: boolean
  score: number
  points: number
  /** 各轮实际专注秒数之和 */
  usedSec: number
  /** 计划专注秒数（按轮累计，至少 60 秒） */
  plannedSec: number
}

export const POMODORO_POINTS = { pass: 20, fail: 10 } as const

/**
 * 作业结算：时间到（或提前结束）那一刻清单是否全部完成。
 *
 * - 正：80~100，按「还剩多少计划时间」给分（刚好到点完成 = 80，提前越多越高）
 * - 负：40~70，按完成率给分（一项没做 = 40）
 *
 * 前后端共用同一口径；服务端派生记录时以它为准。
 */
export function homeworkOutcome(
  input: Pick<HomeworkSession, 'items' | 'plannedFocusMinutes' | 'rounds'>,
): HomeworkOutcome {
  const items = Array.isArray(input.items) ? input.items : []
  const rounds = Array.isArray(input.rounds) ? input.rounds : []
  const total = items.length
  const done = items.filter((item) => item.done).length
  const completion = total ? done / total : 1
  const passed = done === total

  const usedSec = rounds.reduce((sum, round) => {
    const span = Math.max(0, (Number(round.endedAt) || 0) - (Number(round.startedAt) || 0))
    return sum + Math.min(span, 4 * 3600 * 1000) / 1000
  }, 0)
  const plannedSec = Math.max(60, (Number(input.plannedFocusMinutes) || 25) * 60) * Math.max(1, rounds.length)
  const ratio = plannedSec > 0 ? Math.min(1, Math.max(0, usedSec / plannedSec)) : 1

  const score = passed
    ? Math.round(Math.min(100, Math.max(80, 80 + 20 * (1 - ratio))))
    : Math.round(Math.min(70, Math.max(40, 40 + 30 * completion)))

  return {
    done,
    total,
    completion,
    passed,
    score,
    points: passed ? POMODORO_POINTS.pass : POMODORO_POINTS.fail,
    usedSec,
    plannedSec,
  }
}
