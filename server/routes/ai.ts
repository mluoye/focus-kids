import { Hono } from 'hono'
import { getState } from '../store'
import { requireAuth, type AppEnv } from '../middleware'
import { invalidJson, readJson } from '../json'
import { encouragePrompt, homeworkParsePrompt, insightPrompt, tutorSystem, weeklyReportPrompt } from '../ai/prompts'

interface AiConfig {
  baseUrl: string
  model: string
  visionModel: string
  apiKey: string
  temperature: number
  enabled: boolean
}

/**
 * 解析 AI 配置。
 * `allowDisabled` 用于「测试连接」：家长可以先验证密钥再决定是否开启。
 */
function resolveConfig(allowDisabled = false): AiConfig | { error: string } {
  const state = getState()
  const ai = state.settings.ai
  const apiKey = (ai.apiKey || process.env.AI_API_KEY || '').trim()
  const baseUrl = (ai.baseUrl || process.env.AI_BASE_URL || '').trim()
  const model = (ai.model || process.env.AI_MODEL || '').trim()
  if (process.env.AI_ENABLED === 'false') return { error: 'AI 功能已被服务器关闭' }
  const enabled = ai.enabled !== false
  if (!enabled && !allowDisabled) return { error: '家长还没有开启 AI 能力，可以在「AI 设置」里打开' }
  if (!apiKey) return { error: '还没有配置大模型 API Key，请家长在「AI 设置」里填写' }
  if (!baseUrl || !model) return { error: '大模型地址或模型名称为空，请家长检查 AI 设置' }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model,
    visionModel: (ai.visionModel || '').trim(),
    apiKey,
    temperature: Number(ai.temperature) || 0.7,
    enabled,
  }
}

function chatEndpoint(baseUrl: string): string {
  return baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`
}

function buildMessages(feature: string, payload: any) {
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

export const aiRoutes = new Hono<AppEnv>()

aiRoutes.get('/status', requireAuth, (c) => {
  const config = resolveConfig()
  if ('error' in config) return c.json({ ready: false, message: config.error })
  return c.json({ ready: true, enabled: config.enabled, model: config.model, baseUrl: config.baseUrl })
})

aiRoutes.post('/test', requireAuth, async (c) => {
  // 测试连接不受「启用 AI 能力」开关限制，方便家长先验证再开启
  const config = resolveConfig(true)
  if ('error' in config) return c.json({ ok: false, message: config.error, error: config.error }, 400)
  try {
    const res = await fetch(chatEndpoint(config.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: '只回复两个字：可用' }],
        max_tokens: 16,
        stream: false,
      }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300)
      const message = `模型返回 ${res.status}：${text}`
      return c.json({ ok: false, message, error: message }, 502)
    }
    const data: any = await res.json()
    return c.json({ ok: true, message: String(data?.choices?.[0]?.message?.content ?? '连接成功').slice(0, 100) })
  } catch (err: any) {
    const message = `连接失败：${err?.message ?? err}`
    return c.json({ ok: false, message, error: message }, 502)
  }
})

for (const feature of ['tutor', 'encourage', 'insight', 'weekly-report', 'homework-parse'] as const) {
  aiRoutes.post(`/${feature}`, requireAuth, async (c) => {
    const config = resolveConfig()
    if ('error' in config) return c.json({ error: config.error, code: 'AI_NOT_READY' }, 503)
    const payload = await readJson(c)
    if (!payload) return invalidJson(c)
    const messages = buildMessages(feature, payload)
    if (!messages || messages.length === 0) return c.json({ error: '没有可发送的内容', code: 'EMPTY' }, 400)

    // 拍照题目：首版直接把图片以 data URL 传给支持视觉的模型；不支持时由模型自行忽略
    const isVisionRequest =
      feature === 'tutor' && typeof payload.image === 'string' && payload.image.startsWith('data:image/')
    if (isVisionRequest) {
      const last = messages[messages.length - 1]
      messages[messages.length - 1] = {
        role: 'user',
        content: [
          { type: 'text', text: typeof last.content === 'string' ? last.content : '请看看这道题' },
          { type: 'image_url', image_url: { url: payload.image.slice(0, 2_000_000) } },
        ],
      } as any
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)
    c.req.raw.signal.addEventListener('abort', () => controller.abort())

    try {
      const upstream = await fetch(chatEndpoint(config.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: isVisionRequest ? config.visionModel || config.model : config.model,
          messages,
          temperature: config.temperature,
          stream: true,
          // 推理类模型会先输出 reasoning，预留足够预算避免正文被截断成空
          max_tokens: 2048,
        }),
        signal: controller.signal,
      })
      if (!upstream.ok || !upstream.body) {
        const text = (await upstream.text().catch(() => '')).slice(0, 400)
        clearTimeout(timeout)
        // 带图但模型不支持视觉输入时，给出可操作的引导，而不是让孩子干等
        if (isVisionRequest && /image|vision|multimodal|图片|看图|识图|content.*invalid/i.test(text)) {
          return c.json(
            {
              error: '当前模型不支持看图，请在「AI 设置」填写视觉模型（如 glm-4v-flash 或 qwen-vl-plus）',
              code: 'VISION_NOT_SUPPORTED',
            },
            400,
          )
        }
        return c.json({ error: `模型服务返回 ${upstream.status}：${text}`, code: 'UPSTREAM_ERROR' }, 502)
      }
      return new Response(upstream.body, {
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        },
      })
    } catch (err: any) {
      clearTimeout(timeout)
      // 孩子/家长中途离开页面时连接会被 abort，无需当作错误上报
      if (controller.signal.aborted) return new Response(null, { status: 499 })
      return c.json({ error: `连接大模型失败：${err?.message ?? err}`, code: 'AI_REQUEST_FAILED' }, 502)
    }
  })
}

/** 拍照识题二期能力占位：接口先定稿，避免前端返工。 */
aiRoutes.post('/ocr', requireAuth, (c) =>
  c.json({ error: '拍照识题将在下一阶段上线，请先用文字输入题目', code: 'OCR_NOT_IMPLEMENTED' }, 501),
)
