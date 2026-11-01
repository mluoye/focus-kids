import type { MathTerm, MathUnitNo, StoryMathGrade, StoryMathQuestionType } from '../../../shared/types'

export type { MathTerm, MathUnitNo, StoryMathQuestionType }

/** 教材版本：北师大（深圳主流） / 人教（二期预留） */
export type MathBookEdition = 'bs' | 'rj'

/**
 * 单元硬性出题约束（红队校验用）。
 * 单单元用本单元值；多单元整合复习用 mergeUnitConstraints 合并（放宽）。
 */
export interface MathUnitConstraints {
  /** 题干与答案中出现的数字上限；null=不限 */
  maxValue: number | null
  /** 允许的运算符号；空数组=纯认数不计算（如一年级「生活中的数」） */
  allowedOps: ('+' | '-' | '×' | '÷')[]
  /** 结果不得为负；小学阶段默认 true */
  noNegative: boolean
}

/** 一个单元的结构化知识库记录（由深圳北师大版教材整理） */
export interface MathUnitKnowledge {
  grade: StoryMathGrade
  term: MathTerm
  unitNo: MathUnitNo
  unitName: string
  /** 核心知识点（出题白名单，prompt 只出这些） */
  knowledgePoints: string[]
  questionTypes: StoryMathQuestionType[]
  constraints: MathUnitConstraints
  /** 禁止考点（词/运算类型，不用裸数字——数字上限交给 constraints.maxValue） */
  forbidden: string[]
  /** 情境偏好；缺省用默认深圳场景池 */
  sceneHints?: string[]
}
