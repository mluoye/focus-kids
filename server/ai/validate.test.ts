import { describe, expect, it } from 'vitest'
import { mergeForbidden, mergeUnitConstraints, findUnitsInRange, findUnit, listUnits } from './knowledge'
import { validateStoryMathQuestions } from './validate'
import type { MathUnitConstraints, MathUnitKnowledge } from './knowledge/types'
import type { StoryMathProblem } from '../../shared/types'

function unit(over: Partial<MathUnitKnowledge> = {}): MathUnitKnowledge {
  return {
    grade: 1,
    term: 1,
    unitNo: 1,
    unitName: '测试单元',
    knowledgePoints: ['测试点'],
    questionTypes: ['word'],
    constraints: { maxValue: 10, allowedOps: ['+', '-'], noNegative: true },
    forbidden: [],
    ...over,
  }
}

const q = (text: string, answer: number | string, extra: Partial<StoryMathProblem> = {}): StoryMathProblem => ({
  text,
  type: 'word',
  answer,
  unit: '个',
  knowledgePoint: '测试',
  ...extra,
})

describe('mergeUnitConstraints（多单元整合复习 · 放宽合并）', () => {
  it('单单元直接返回自身约束', () => {
    const u = unit()
    expect(mergeUnitConstraints([u])).toBe(u.constraints)
  })

  it('maxValue 取各单元最大值', () => {
    const merged = mergeUnitConstraints([unit({ constraints: { maxValue: 10, allowedOps: ['+'], noNegative: true } }), unit({ constraints: { maxValue: 20, allowedOps: ['-'], noNegative: true } })])
    expect(merged.maxValue).toBe(20)
  })

  it('任一单元不限（null）则整体不限', () => {
    const merged = mergeUnitConstraints([unit({ constraints: { maxValue: 10, allowedOps: ['+'], noNegative: true } }), unit({ constraints: { maxValue: null, allowedOps: ['-'], noNegative: true } })])
    expect(merged.maxValue).toBeNull()
  })

  it('allowedOps 取并集', () => {
    const merged = mergeUnitConstraints([unit({ constraints: { maxValue: 10, allowedOps: ['+'], noNegative: true } }), unit({ constraints: { maxValue: 10, allowedOps: ['×'], noNegative: true } })])
    expect(merged.allowedOps).toEqual(['+', '×'])
  })

})

describe('mergeForbidden（多单元禁止考点 · 交集）', () => {
  it('只有都禁的才保留', () => {
    const merged = mergeForbidden([unit({ forbidden: ['三位数', '小数'] }), unit({ forbidden: ['三位数', '除法'] })])
    expect(merged).toEqual(['三位数'])
  })
})

describe('findUnitsInRange / findUnit / listUnits（知识库查询）', () => {
  it('范围查询返回连续数字单元，且不含数学好玩', () => {
    const units = findUnitsInRange(1, 1, 1, 3)
    expect(units.map((u) => u.unitNo)).toEqual([1, 2, 3])
  })

  it('精确查找数学好玩', () => {
    const fun = findUnit(1, 1, 'fun')
    expect(fun).toBeDefined()
    expect(fun?.unitNo).toBe('fun')
  })

  it('listUnits 一年级上册含 8 个数字单元 + 数学好玩，按序排列', () => {
    const units = listUnits(1, 1)
    expect(units.map((u) => u.unitNo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 'fun'])
  })
})

describe('validateStoryMathQuestions（红队校验）', () => {
  const c: MathUnitConstraints = { maxValue: 10, allowedOps: ['+', '-'], noNegative: true }

  it('答案超上限 → 淘汰', () => {
    const { kept } = validateStoryMathQuestions([q('小明有 5 个苹果，又买了 3 个，一共几个？', 8), q('超上限题', 15)], c)
    expect(kept.length).toBe(1)
  })

  it('题干数字超上限 → 淘汰', () => {
    const { kept } = validateStoryMathQuestions([q('这里有 25 个橘子，分给 5 人，每人几个？', 5)], c)
    expect(kept.length).toBe(0)
  })

  it('含禁止考点 → 淘汰', () => {
    const { kept } = validateStoryMathQuestions([q('进位加法题：个位相加满十要进位', 12)], c, ['进位'])
    expect(kept.length).toBe(0)
  })

  it('答案负数且 noNegative → 淘汰', () => {
    const { kept } = validateStoryMathQuestions([q('温度题', -3)], c)
    expect(kept.length).toBe(0)
  })

  it('合法题全部保留', () => {
    const { kept } = validateStoryMathQuestions([q('小明有 5 个苹果，又买了 3 个，一共几个？', 8), q('小红有 10 个，分给 2 人，每人几个？', 5)], c)
    expect(kept.length).toBe(2)
  })

  it('choice 题：选项索引不参与数字范围，题干数字超限仍淘汰', () => {
    const choice = (text: string, answer: number, options: string[]): StoryMathProblem => q(text, answer, { type: 'choice', options })
    const { kept } = validateStoryMathQuestions([choice('从正面看到的是？', 1, ['A 圆形', 'B 正方形', 'C 三角形', 'D 圆环'])], c)
    expect(kept.length).toBe(1)
    // 题干数字超上限（25 > 10）→ 淘汰
    const { kept: k2 } = validateStoryMathQuestions([choice('这里有 25 个图形', 0, ['A', 'B', 'C', 'D'])], c)
    expect(k2.length).toBe(0)
  })

  it('fill 题：文字答案不参与数字范围/负数校验，题干数字超限仍淘汰', () => {
    const { kept } = validateStoryMathQuestions([q('和是____', '61', { type: 'fill' })], c)
    expect(kept.length).toBe(1)
    const { kept: k2 } = validateStoryMathQuestions([q('这里有 25 个橘子', '二十五', { type: 'fill' })], c)
    expect(k2.length).toBe(0)
  })
})
