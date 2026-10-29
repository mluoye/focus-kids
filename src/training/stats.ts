import type { AttentionDimension, TrainingRecord } from '@shared/types'
import { DIMENSIONS, MODULES } from '@shared/constants'
import { dateKeyOffset } from '@/utils/time'

export function recentRecords(records: TrainingRecord[], n = 12): TrainingRecord[] {
  return [...records].sort((a, b) => b.startedAt - a.startedAt).slice(0, n)
}

export function dimensionAverages(records: TrainingRecord[], n = 12): Record<AttentionDimension, number> {
  const recent = recentRecords(records, n)
  const result = Object.fromEntries(DIMENSIONS.map((d) => [d.key, 0])) as Record<AttentionDimension, number>
  for (const dim of DIMENSIONS) {
    const values: number[] = []
    for (const record of recent) {
      const value = record.dimensionScores?.[dim.key]
      if (typeof value === 'number' && !Number.isNaN(value)) values.push(value)
    }
    result[dim.key] = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0
  }
  return result
}

export interface ModuleStat {
  id: string
  name: string
  count: number
  avgScore: number
  bestScore: number
  lastAt: number | null
}

export function moduleStats(records: TrainingRecord[]): ModuleStat[] {
  return MODULES.map((meta) => {
    const list = records.filter((r) => r.module === meta.id)
    const avg = list.length ? Math.round(list.reduce((a, b) => a + b.score, 0) / list.length) : 0
    return {
      id: meta.id,
      name: meta.name,
      count: list.length,
      avgScore: avg,
      bestScore: list.length ? Math.max(...list.map((r) => r.score)) : 0,
      lastAt: list.length ? Math.max(...list.map((r) => r.startedAt)) : null,
    }
  })
}

export interface DayStat {
  key: string
  label: string
  minutes: number
  score: number
  count: number
}

export function weeklyTrend(records: TrainingRecord[], days = 7): DayStat[] {
  const stats: DayStat[] = []
  for (let i = days - 1; i >= 0; i--) {
    const key = dateKeyOffset(i)
    const dayRecords = records.filter((r) => {
      const d = new Date(r.startedAt)
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      return k === key
    })
    const minutes = Math.round(dayRecords.reduce((a, b) => a + b.durationSec, 0) / 60)
    const score = dayRecords.length
      ? Math.round(dayRecords.reduce((a, b) => a + b.score, 0) / dayRecords.length)
      : 0
    stats.push({ key, label: key.slice(5).replace('-', '/'), minutes, score, count: dayRecords.length })
  }
  return stats
}

export function streakDays(records: TrainingRecord[]): number {
  const days = new Set(
    records.map((r) => {
      const d = new Date(r.startedAt)
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    }),
  )
  let streak = 0
  const cursor = new Date()
  if (!days.has(`${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`)) {
    cursor.setDate(cursor.getDate() - 1)
  }
  while (streak < 60 && days.has(`${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`)) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

/** 汇总给 AI 的精简数据，避免把原始记录整包发给模型。 */
export function aiSummary(records: TrainingRecord[], profileName: string) {
  const recent = recentRecords(records, 12)
  return {
    profileName,
    total: records.length,
    recentScores: recent.map((r) => ({
      module: MODULES.find((m) => m.id === r.module)?.name ?? r.module,
      score: r.score,
      accuracy: Math.round(r.accuracy * 100),
      avgReactionMs: r.avgReactionMs,
      date: new Date(r.startedAt).toISOString().slice(0, 10),
    })),
    dimensions: dimensionAverages(records, 12),
    modules: moduleStats(records).map((m) => ({ name: m.name, count: m.count, avgScore: m.avgScore })),
    streakDays: streakDays(records),
  }
}
