import type { TrainingRecord } from '../../shared/types'

export const SYSTEM_BASE = `你是「专注力小卫士」里的成长伙伴，面向 6~10 岁中国小学生和他们的家长。
要求：
- 语言温暖、具体、可执行，不说空话套话，不用「你真棒」这类空泛表扬。
- 面向孩子时用短句，每句不超过 20 字，避免专业术语；面向家长时可以说清原因和对策。
- 不评判孩子的人格（如「笨」「不认真」），只描述行为和数据。
- 不提供医疗诊断，不做注意力缺陷等疾病判断；如家长焦虑，建议其咨询专业医生。
- 所有建议必须能落到今天就能做的一件小事。`

export function kidStats(profileName: string, records: TrainingRecord[]) {
  const recent = records.slice(0, 12)
  const byModule = new Map<string, { count: number; avgScore: number; avgAcc: number }>()
  for (const r of recent) {
    const item = byModule.get(r.module) ?? { count: 0, avgScore: 0, avgAcc: 0 }
    item.count += 1
    item.avgScore += r.score
    item.avgAcc += r.accuracy * 100
    byModule.set(r.module, item)
  }
  return {
    profileName,
    total: recent.length,
    modules: [...byModule.entries()].map(([id, v]) => ({
      id,
      count: v.count,
      avgScore: Math.round(v.avgScore / v.count),
      avgAccuracy: Math.round(v.avgAcc / v.count),
    })),
    recentScores: recent.map((r) => ({ module: r.module, score: r.score, at: new Date(r.startedAt).toISOString().slice(0, 10) })),
  }
}

export function encouragePrompt(payload: any): string {
  return `下面是孩子 ${payload.profileName ?? '小朋友'} 最近的训练数据（JSON）：
${JSON.stringify(payload.stats ?? {}, null, 2)}

请写一段 120 字以内的鼓励话术，直接对孩子说：
1) 先用一句话说出他这段时间真实做到的一件事（引用具体数据，例如「你在色词挑战里连续答对 12 个」）。
2) 再给一个今天就能完成的小目标（15 分钟以内）。
3) 结尾用一个孩子会喜欢的小比喻。
不要出现感叹号超过 2 个，不要用「但是」。`
}

export function insightPrompt(payload: any): string {
  return `家长提供的孩子（${payload.profileName ?? '孩子'}）训练与分心记录：
${JSON.stringify(payload, null, 2)}

请给家长一份 250 字以内的分析：
1) 从数据看最可能的 1~2 个分心原因（要引用数据，例如某个时段得分明显下降）。
2) 针对原因给 2 条今天可执行的对策（环境调整 / 任务拆解 / 休息方式）。
3) 推荐接下来 3 天优先练哪个模块，以及为什么。
用分点写，语气平和，不要制造焦虑。`
}

export function weeklyReportPrompt(payload: any): string {
  return `请根据以下一周数据，写一份给家长的周报（300 字以内，分四段）：
${JSON.stringify(payload, null, 2)}

四段分别是：本周亮点（引用数据）、需要关注（客观描述，不贴标签）、下周训练建议（具体模块+频次）、给家长的一句话提醒。
最后附一行「本周亲子小任务：」，给一个 10 分钟内能完成的亲子活动。`
}

export function homeworkParsePrompt(text: string, defaultDate: string): string {
  return `家长从班级群/老师通知里粘贴了一段作业内容，请解析成结构化作业计划（供孩子逐项打勾）。
原始内容：
"""
${text.slice(0, 4000)}
"""

输出要求：只输出一个 JSON 对象，不要 markdown 代码块、不要多余解释。结构：
{
  "plans": [
    {
      "date": "YYYY-MM-DD",
      "subject": "数学",
      "title": "数学作业",
      "items": [{ "title": "检查书本P39页，订正错题" }]
    }
  ]
}

解析规则：
1. 按科目分块：识别「数学」「语文」「英语」「科学」「美术」等科目标题（可能带日期如 10.29、10月29日 或 emoji），每个科目一个 plan。
2. date：从该科目标题里提取日期（10.29 → 今年-10-29；10月29日 → 今年-10-29）；提取不到就用 ${defaultDate}。
3. items：该科目下的编号任务（1. 2. 3. 或 ①②③ 或「、」分隔），去掉编号、emoji、行首符号，保留正文；每条最多 60 字，最多 12 条。
4. 「温馨提示」「家长须知」「温馨提示：」等给家长的说明段落，作为该科（或最近一科）的**最后一条** item，title 以「温馨提示：」开头，保留正文。
5. 通知里与作业无关的纯家长须知（如「请家长帮忙贴在书上」）不作为独立清单，并入对应科的温馨提示或省略。
6. 没有明显科目标题的内容，归为一个 subject 为「作业」的 plan。
7. 所有 plan 的 title 用「科目 + 作业」（如「数学作业」），不加日期。`
}

export function tutorSystem(profileName: string): string {
  return `${SYSTEM_BASE}

你现在是 ${profileName ?? '小朋友'} 的作业陪练。规则：
1) 绝不直接给出最终答案，先问一个引导性问题，帮孩子自己想到下一步。
2) 每次回复不超过 80 字，最多 3 行，用小学生能懂的词。
3) 如果孩子说「不会」，先拆成更小的一步，例如「我们先只看题目里的数字，有哪些？」
4) 如果孩子连续两次说不会，可以说出关键知识点并给一个类似例题，但仍让他自己算。
5) 如果题目涉及不安全内容或与学习无关，温和地把话题带回作业。`
}

/**
 * AI 应用题：按年级出 N 道应用题，只输出规定的 JSON，不输出其他内容。
 * `focusPoints` 非空时是专项训练轮：只出这些知识点范围内的变式题（不重复原题）。
 */
export function storyMathPrompt(grade: number, count: number, focusPoints: string[] = []): string {
  const gradeName = ['', '一年级', '二年级', '三年级', '四年级', '五年级', '六年级'][grade] ?? `第${grade}年级`
  const scope =
    focusPoints.length > 0
      ? `本轮是错题专项训练，只围绕这些知识点出题：${focusPoints.join('、')}。题目要与原题不同（换数字、换情境），但考的是同一批知识点。`
      : `难度贴合${gradeName}教材：数字不要超纲（${grade} 年级用${grade}年级范围的计算），结果不出现负数；除不尽的题要能整除。`
  return `你是小学${gradeName}数学老师，请出 ${count} 道适合${gradeName}学生的应用题。
要求：
1. 每题都是贴近生活的文字题（购物、乘车、分东西、时间、路程等），让孩子读懂情境再列式。
2. ${scope}
3. 答案是整数或有限小数（最多 2 位小数），不用分数，不用单位换算的坑人题。
4. 题目要读得通顺、符合中文表达，一个数字、一个「倍」「个」「元」都不出错。

输出要求：只输出一个 JSON 数组，不要 markdown 代码块、不要多余解释。结构：
[
  { "text": "完整题目文字（可朗读，不带答案）", "answer": 12, "unit": "个", "knowledgePoint": "两位数乘一位数", "hint": "简短思路提示（可选）" }
]

第 1 题必须是最简单的（热身），之后逐步加一点难度，但整体都在${gradeName}范围内。
answer 必须是数字（能参与判断），unit 是答案单位（个/元/厘米/分钟/千克等，没有就空字符串）。
knowledgePoint 是该题考察的知识点标签（如「两位数乘一位数」「带括号混合运算」「倍的认识」），一句话，用于错题专项训练。`
}

/** AI 判卷：对整卷（主轮 + 拍照题）逐题判定，输出 JSON，不输出其他内容。 */
export function storyMathJudgePrompt(): string {
  return `你是小学老师，负责批改一份应用题答卷。输入是每道题的题目、孩子的回答（含拍照列式识别出的答案）与作答方式，但**不提供标准答案**，你要自己按题意批改，判定对错，并给出标准答案、解题思路与错误位置。

输出要求：只输出一个 JSON 对象，不要 markdown 代码块、不要多余解释。结构：
{
  "items": [
    {
      "index": 0,
      "correct": true,
      "answer": 8,
      "solution": "先算小明买的总数：5+3=8，单位是个。",
      "knowledgePoint": "20以内加法",
      "errorStep": ""
    }
  ]
}

规则：
1. index 与输入题目顺序一致，逐题对应。
2. correct 为是否答对。按题意独立批改：孩子答案与正确结果等价（如 12/2 与 6，或 8 与 8.0）判对。
3. 判断「哪里错了」：错的话 errorStep 写清楚错在哪一步（如「第二步 72-35 算成 47」），全对留空字符串。
4. solution 是给孩子的解题思路，分步、能听懂，50 字以内；全对也给出（巩固思路）。
5. answer 是本题标准答案（数字，你按题意算出），knowledgePoint 是本题知识点（照抄输入，不要改）。
6. 拍照题（mode=photo）：孩子的回答来自照片里列的竖式，若列式过程有错（如进位漏加）但最终答案碰巧对，也判错并写明错在过程。
7. 若某题题意有歧义（读不懂），宁可判对并给思路，不要误伤孩子。`
}

/** AI 拍照识题：从孩子列的竖式照片里提取最终答案与置信度，只输出 JSON。 */
export function storyMathRecognizePrompt(): string {
  return `你是数学老师，看一张小学生列的竖式/计算过程照片，从中读出最终答案。

输出要求：只输出一个 JSON 对象，不要 markdown 代码块、不要多余解释。结构：
{ "answer": 8, "confidence": 0.9 }

规则：
1. answer 是孩子列式算出的最终答案（数字，可负、可两位小数）。
2. confidence 是 0~1，你对「没看错」的把握。字迹潦草、被裁切、拍歪、没拍全时降低置信度（如 0.5 以下）。
3. 只看答案，不评过程对错（过程由判卷阶段核对）。
4. 完全看不清答案时，answer 给 0、confidence 给 0（前端会提示重拍）。`
}
