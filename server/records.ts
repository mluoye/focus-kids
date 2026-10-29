import type { HomeworkSession, TrainingRecord } from '../shared/types'
import { homeworkOutcome } from '../shared/homework'
import type { AppState } from './store'

/** 番茄钟记录使用确定性 id，重复同步不会产生第二条。 */
export function pomodoroRecordId(sessionId: string): string {
  return `rec_hw_${sessionId}`
}

/**
 * 作业会话 → 番茄钟训练记录。
 *
 * 判定口径（与前端 `homeworkOutcome` 一致）：
 * - 清单全部完成 = 正，分数 80~100（按提前量）
 * - 有未完成项 = 负，分数 40~70（按完成率）
 * - 维度分同时计入持续注意力与冲动抑制
 * - durationSec 取各轮实际专注时长之和，取不到时退回会话总时长
 */
export function recordFromHomework(session: HomeworkSession): TrainingRecord {
  const outcome = homeworkOutcome(session)
  const sessionEnd = session.endedAt ?? session.updatedAt
  const fallbackSec = Math.max(1, Math.round((sessionEnd - session.startedAt) / 1000))

  return {
    id: pomodoroRecordId(session.id),
    profileId: session.profileId,
    module: 'pomodoro',
    startedAt: session.startedAt,
    endedAt: sessionEnd,
    durationSec: Math.max(1, Math.round(outcome.usedSec) || fallbackSec),
    difficulty: 1,
    accuracy: Math.min(1, Math.max(0, outcome.completion)),
    avgReactionMs: 0,
    score: outcome.score,
    totalTrials: Math.max(1, outcome.total),
    correctTrials: outcome.total ? outcome.done : 1,
    errors: [],
    dimensionScores: { sustained: outcome.score, inhibition: outcome.score },
    passed: outcome.passed,
    updatedAt: session.updatedAt,
  }
}

/**
 * 为所有已完成的作业会话补齐/更新番茄钟记录。
 *
 * 服务端权威：客户端只提交 HomeworkSession，不自己造记录，
 * 避免离线重放或重复提交时出现两条记录、重复加分。
 */
export function syncHomeworkRecords(state: AppState): boolean {
  const index = new Map(state.records.map((r, i) => [r.id, i]))
  let changed = false
  for (const session of state.homework) {
    if (session.status !== 'done') continue
    const record = recordFromHomework(session)
    const at = index.get(record.id)
    if (at === undefined) {
      state.records.push(record)
      index.set(record.id, state.records.length - 1)
      changed = true
    } else if ((record.updatedAt ?? 0) > (state.records[at].updatedAt ?? 0)) {
      state.records[at] = record
      changed = true
    }
  }
  return changed
}
