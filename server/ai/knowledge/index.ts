import type { StoryMathGrade } from '../../../shared/types'
import { BS_UNITS } from './bs'
import type { MathTerm, MathUnitKnowledge, MathUnitConstraints, MathUnitNo } from './types'

/** 深圳小学生熟悉的生活情境池（出题场景偏好，缺省用） */
export const DEFAULT_SCENE_HINTS = ['文具', '校园', '公园', '地铁', '超市', '排队', '分东西', '购物']

/** 某年级某学期全部单元（按单元序号升序，数学好玩最后） */
export function listUnits(grade: StoryMathGrade, term: MathTerm): MathUnitKnowledge[] {
  const list = BS_UNITS.filter((u) => u.grade === grade && u.term === term)
  return list.sort((a, b) => unitOrder(a.unitNo) - unitOrder(b.unitNo))
}

function unitOrder(no: MathUnitNo): number {
  return typeof no === 'number' ? no : 999
}

/** 按单元序号精确查找（含数学好玩） */
export function findUnit(grade: StoryMathGrade, term: MathTerm, unitNo: MathUnitNo): MathUnitKnowledge | undefined {
  return BS_UNITS.find((u) => u.grade === grade && u.term === term && u.unitNo === unitNo)
}

/** 连续数字单元范围（不含数学好玩）；from/to 须为数字 */
export function findUnitsInRange(
  grade: StoryMathGrade,
  term: MathTerm,
  from: number,
  to: number,
): MathUnitKnowledge[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) return []
  return listUnits(grade, term).filter((u) => typeof u.unitNo === 'number' && u.unitNo >= from && u.unitNo <= to)
}

/**
 * 多单元整合复习的约束合并（放宽而非收紧）：
 * - maxValue：范围内各单元取最大值；任一不限（null）则整体不限
 * - allowedOps：并集
 * - noNegative：所有单元都不允许负才保持（复习范围含负数单元则放开）
 */
export function mergeUnitConstraints(units: MathUnitKnowledge[]): MathUnitConstraints {
  const first = units[0]?.constraints
  if (!first || units.length === 1) return first
  const maxes = units.map((u) => u.constraints.maxValue)
  const maxValue = maxes.some((v) => v === null) ? null : Math.max(...(maxes as number[]))
  const ops = new Set<string>()
  for (const u of units) for (const op of u.constraints.allowedOps) ops.add(op)
  return {
    maxValue,
    allowedOps: [...ops] as MathUnitConstraints['allowedOps'],
    noNegative: units.every((u) => u.constraints.noNegative),
  }
}

/**
 * 多单元禁止考点合并：取交集（只有范围内所有单元都禁的才禁）。
 * 复习覆盖已学全部，高单元允许的内容不能被低单元的禁止项卡住。
 */
export function mergeForbidden(units: MathUnitKnowledge[]): string[] {
  if (!units.length) return []
  let acc = new Set(units[0].forbidden)
  for (const u of units.slice(1)) {
    const next = new Set<string>()
    for (const f of u.forbidden) if (acc.has(f)) next.add(f)
    acc = next
  }
  return [...acc]
}
