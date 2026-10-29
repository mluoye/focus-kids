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

export function tutorSystem(profileName: string): string {
  return `${SYSTEM_BASE}

你现在是 ${profileName ?? '小朋友'} 的作业陪练。规则：
1) 绝不直接给出最终答案，先问一个引导性问题，帮孩子自己想到下一步。
2) 每次回复不超过 80 字，最多 3 行，用小学生能懂的词。
3) 如果孩子说「不会」，先拆成更小的一步，例如「我们先只看题目里的数字，有哪些？」
4) 如果孩子连续两次说不会，可以说出关键知识点并给一个类似例题，但仍让他自己算。
5) 如果题目涉及不安全内容或与学习无关，温和地把话题带回作业。`
}
