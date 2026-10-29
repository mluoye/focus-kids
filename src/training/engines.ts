export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)]
}

export function shuffle<T>(list: T[]): T[] {
  const arr = [...list]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export function mean(list: number[]): number {
  if (!list.length) return 0
  return list.reduce((a, b) => a + b, 0) / list.length
}

/** 速度分：反应时越接近参照值分越高，超过 2 倍参照值归零。 */
export function speedScore(avgReactionMs: number, targetMs: number): number {
  if (!avgReactionMs || avgReactionMs <= 0) return 0
  const ratio = avgReactionMs / targetMs
  if (ratio <= 1) return 100
  return clamp(Math.round(100 - (ratio - 1) * 55), 0, 100)
}

/** 综合分：正确率 75% + 速度 25%。 */
export function compositeScore(accuracyPct: number, avgReactionMs: number, targetMs: number): number {
  const acc = clamp(accuracyPct, 0, 100)
  const speed = speedScore(avgReactionMs, targetMs)
  return clamp(Math.round(acc * 0.75 + speed * 0.25), 0, 100)
}

export function accuracyPct(correct: number, total: number): number {
  if (!total) return 0
  return Math.round((correct / total) * 100)
}

export function newRecordId(): string {
  return `rec_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
}

export function newSessionId(): string {
  return `hw_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
}

export interface GameOutcome {
  totalTrials: number
  correctTrials: number
  avgReactionMs: number
  accuracy: number
  dimensionScores: Partial<Record<string, number>>
  errors: { type: string; count: number }[]
  difficulty: number
  extra?: Record<string, unknown>
}

export function scoreOfDimensions(dims: Partial<Record<string, number>>): number {
  const values = Object.values(dims).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (!values.length) return 0
  return clamp(Math.round(values.reduce((a, b) => a + b, 0) / values.length), 0, 100)
}

