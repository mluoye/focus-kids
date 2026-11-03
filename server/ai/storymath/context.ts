import { findUnit, findUnitsInRange, listUnits, mergeForbidden, mergeUnitConstraints } from '../knowledge'
import type { MathUnitConstraints, MathUnitKnowledge, MathUnitNo, MathTerm } from '../knowledge/types'
import type { StoryMathGrade } from '@shared/types'

/**
 * 从请求体解析单元上下文（单单元 / 复习范围 / 按年级），供提示词组装与校验使用。
 * 本模块只做「请求 → 知识库上下文」的映射，不含 Hono 路由或 IO。
 */
export type StoryMathContext =
  | {
      unit?: MathUnitKnowledge
      units?: MathUnitKnowledge[]
      term?: MathTerm
      unitNo?: MathUnitNo
      constraints?: MathUnitConstraints
      forbidden?: string[]
      error?: never
      status?: never
    }
  | { error: { error: string; code: string; hint?: string }; status: 400 }

export function resolveStoryMathContext(body: any, grade: number): StoryMathContext {
  const term: MathTerm | undefined = Number(body?.term) === 2 ? 2 : Number(body?.term) === 1 ? 1 : undefined
  const g = grade as StoryMathGrade

  // 单单元（含数学好玩）
  if (term && body?.unitNo !== undefined) {
    const raw = body.unitNo
    const no: MathUnitNo | undefined = raw === 'fun' ? 'fun' : typeof raw === 'number' && Number.isInteger(raw) ? raw : undefined
    if (no === undefined) return { error: { error: '单元序号不合法', code: 'INVALID_UNIT' }, status: 400 }
    const u = findUnit(g, term, no)
    if (!u) {
      // 该年级/学期暂无知识库数据（2~6 年级待补）→ 回退按年级出题，保持兼容
      if (!listUnits(g, term).length) return {}
      return { error: { error: '未找到该单元，请检查所选学期/单元', code: 'UNIT_NOT_FOUND' }, status: 400 }
    }
    return { unit: u, term, unitNo: no, constraints: u.constraints, forbidden: u.forbidden }
  }

  // 整合复习范围（连续数字单元）
  const range = body?.unitRange
  if (term && range && typeof range === 'object') {
    const from = Number(range?.from)
    const to = Number(range?.to)
    if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) {
      return { error: { error: '复习范围不合法', code: 'INVALID_RANGE' }, status: 400 }
    }
    const us = findUnitsInRange(g, term, from, to)
    if (!us.length) {
      if (!listUnits(g, term).length) return {}
      return { error: { error: '该范围内没有可出题的单元', code: 'UNIT_NOT_FOUND' }, status: 400 }
    }
    // 纯文本链路自洽：范围内跳过无可出题型的看图/观察单元，只从可出题单元出题
    const playable = us.filter((u) => u.questionTypes.length > 0)
    if (!playable.length) {
      return { error: { error: '该范围内暂无可出题的单元（看图题待配图），请换一个范围', code: 'UNIT_NO_WORD' }, status: 400 }
    }
    return { units: playable, term, constraints: mergeUnitConstraints(playable), forbidden: mergeForbidden(playable) }
  }

  // 无单元上下文：按年级（旧客户端）
  return {}
}
