import type { BlockedRange, LimitSettings } from '@shared/types'

export function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function formatClock(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function isWithinRange(nowMinutes: number, start: string, end: string): boolean {
  const s = toMinutes(start)
  const e = toMinutes(end)
  if (s === e) return true
  if (s < e) return nowMinutes >= s && nowMinutes < e
  // 跨午夜，例如 21:30 -> 07:30
  return nowMinutes >= s || nowMinutes < e
}

export function blockedRangeNow(limits: LimitSettings | null, date = new Date()): BlockedRange | null {
  if (!limits) return null
  const minutes = date.getHours() * 60 + date.getMinutes()
  for (const range of limits.blockedRanges ?? []) {
    if (isWithinRange(minutes, range.start, range.end)) return range
  }
  return null
}

export function formatMinutes(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${pad(m)}:${pad(s)}`
}

export function todayKey(ts = Date.now()): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function todayStart(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function dateKeyOffset(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return todayKey(d.getTime())
}
