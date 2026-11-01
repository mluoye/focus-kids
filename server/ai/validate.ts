import type { StoryMathProblem } from '../../shared/types'
import type { MathUnitConstraints } from './knowledge/types'

export interface StoryMathValidation {
  kept: StoryMathProblem[]
  reasons: string[]
}

/**
 * 红队校验：对生成的应用题做硬性约束过滤（数字范围 / 禁止考点 / 负号 / 小数位）。
 * 单单元用该单元 constraints；多单元整合复习用 mergeUnitConstraints 合并后的约束。
 * 淘汰项直接丢弃（调用方可补出/重试），不静默放行超纲题。
 */
export function validateStoryMathQuestions(
  questions: StoryMathProblem[],
  constraints: MathUnitConstraints,
  forbidden: string[] = [],
): StoryMathValidation {
  const kept: StoryMathProblem[] = []
  const reasons: string[] = []
  for (const q of questions) {
    const reason = checkQuestion(q, constraints, forbidden)
    if (reason) {
      reasons.push(`第 ${kept.length + 1} 题：${reason}`)
      continue
    }
    kept.push(q)
  }
  return { kept, reasons }
}

function checkQuestion(q: StoryMathProblem, c: MathUnitConstraints, forbidden: string[]): string | null {
  const numericAnswer = q.type === 'word' || q.type === 'calc'
  // 数字范围：题干文字（word/calc/fill/choice 都校验，choice 题干不含选项）；数字答案仅 word/calc
  if (c.maxValue !== null) {
    const limit = c.maxValue
    const nums: number[] = (q.text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number)
    if (nums.some((n) => n > limit)) return '题干出现超上限数字'
    if (numericAnswer && typeof q.answer === 'number' && q.answer > limit) return `答案超上限（${q.answer} > ${limit}）`
  }
  if (numericAnswer && c.noNegative && typeof q.answer === 'number' && q.answer < 0) return '答案出现负数'
  if (forbidden.length) {
    const hay = `${q.text} ${String(q.answer)}${q.options ? ' ' + q.options.join(' ') : ''}`
    for (const f of forbidden) {
      if (f && hay.includes(f)) return `含禁止考点「${f}」`
    }
  }
  return null
}
