import { HOMEWORK_STALE_MS } from './constants'
import type { HomeworkSession } from './types'

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
