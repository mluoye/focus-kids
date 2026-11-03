import {
  encouragePrompt,
  homeworkParsePrompt,
  insightPrompt,
  tutorSystem,
  weeklyReportPrompt,
} from './prompts'

/**
 * 按功能名组装 OpenAI 兼容 messages 数组。
 * 本模块只做「feature → messages」的映射，不含路由或 IO。
 */
export function buildMessages(feature: string, payload: any) {
  switch (feature) {
    case 'tutor': {
      const messages = Array.isArray(payload.messages) ? payload.messages.slice(-12) : []
      const cleaned = messages
        .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
        .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 2000) }))
      const system = { role: 'system', content: tutorSystem(payload.profileName) }
      return [system, ...cleaned]
    }
    case 'encourage':
      return [
        { role: 'system', content: '你是温柔的小学老师，擅长把训练数据翻译成孩子听得懂的鼓励。' },
        { role: 'user', content: encouragePrompt(payload) },
      ]
    case 'insight':
      return [
        { role: 'system', content: '你是儿童注意力训练顾问，只基于数据给建议，不做医学判断。' },
        { role: 'user', content: insightPrompt(payload) },
      ]
    case 'weekly-report':
      return [
        { role: 'system', content: '你是专注力训练营的成长规划师，写给家长看。' },
        { role: 'user', content: weeklyReportPrompt(payload) },
      ]
    case 'homework-parse':
      return [
        { role: 'system', content: '你是作业信息解析器，只输出规定的 JSON，不输出其他内容。' },
        { role: 'user', content: homeworkParsePrompt(String(payload?.text ?? ''), String(payload?.defaultDate ?? '')) },
      ]
    default:
      return null
  }
}
