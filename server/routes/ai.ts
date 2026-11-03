import { Hono } from 'hono'
import { getState } from '../store'
import { requireAuth, type AppEnv } from '../middleware'
import { invalidJson, readJson } from '../json'
import { resolveConfig, isConfigError, chatEndpoint, classifyUpstream, classifyNetwork } from '../ai/config'
import { buildMessages } from '../ai/messages'
import type { AiConfig, AiConfigError } from '../ai/config'

type TestTarget = 'chat' | 'vision'

export const aiRoutes = new Hono<AppEnv>()

aiRoutes.get('/status', requireAuth, (c) => {
  const config = resolveConfig()
  if (isConfigError(config)) {
    return c.json({ ready: false, message: config.error, code: config.code, hint: config.hint })
  }
  return c.json({
    ready: true,
    enabled: config.enabled,
    model: config.model,
    baseUrl: config.baseUrl,
    keySource: config.keySource,
    vision: {
      configured: !!config.vision.model,
      model: config.vision.model,
      baseUrl: config.vision.baseUrl,
      keySource: config.vision.keySource,
    },
  })
})

aiRoutes.post('/test', requireAuth, async (c) => {
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const target: TestTarget = body?.target === 'vision' ? 'vision' : 'chat'

  // 视觉测试独立解析：视觉块自带 baseUrl/apiKey 时，不被对话配置的缺失卡住
  if (target === 'vision') {
    const state = getState()
    const ai = state.settings.ai
    const envVisionModel = (process.env.AI_VISION_MODEL || '').trim()
    const envVisionBaseUrl = (process.env.AI_VISION_BASE_URL || '').trim()
    const envVisionKey = (process.env.AI_VISION_API_KEY || '').trim()
    const visionModel = envVisionModel || (ai.vision?.model || '').trim()
    if (process.env.AI_ENABLED === 'false') {
      return c.json(
        {
          ok: false,
          code: 'AI_DISABLED',
          message: 'AI 功能已被服务器关闭',
          hint: '服务器环境变量 AI_ENABLED=false，需管理员修改后重启',
          error: 'AI 功能已被服务器关闭',
        },
        503,
      )
    }
    if (!visionModel) {
      return c.json(
        {
          ok: false,
          code: 'AI_NOT_CONFIGURED',
          message: '还没有配置拍照识题模型',
          hint: '在「拍照识题模型」填写模型名（如 glm-4v-flash / qwen-vl-plus）；地址与密钥留空则继承对话模型',
          field: 'vision.model',
          error: '还没有配置拍照识题模型',
        },
        400,
      )
    }
    const visionBaseUrl = (envVisionBaseUrl || (ai.vision?.baseUrl || '').trim() || (ai.baseUrl || process.env.AI_BASE_URL || '').trim()).replace(/\/+$/, '')
    const ownVisionKey = (ai.vision?.apiKey || '').trim()
    const chatKey = ((process.env.AI_API_KEY || '').trim() || (ai.apiKey || '').trim())
    const visionApiKey = envVisionKey || ownVisionKey || chatKey
    if (!visionBaseUrl) {
      return c.json(
        {
          ok: false,
          code: 'AI_NOT_CONFIGURED',
          message: '视觉服务地址为空',
          hint: '填写视觉厂商地址，或填写对话模型地址以便继承',
          field: 'vision.baseUrl',
          error: '视觉服务地址为空',
        },
        400,
      )
    }
    if (!visionApiKey) {
      return c.json(
        {
          ok: false,
          code: 'AI_NOT_CONFIGURED',
          message: '还没有配置视觉模型 API Key',
          hint: '填写视觉厂商密钥，或填写对话模型密钥以便继承',
          field: 'vision.apiKey',
          error: '还没有配置视觉模型 API Key',
        },
        400,
      )
    }
    return runTest(c, {
      model: visionModel,
      baseUrl: visionBaseUrl,
      apiKey: visionApiKey,
      target,
      keySource: envVisionKey ? 'env' : ownVisionKey ? 'settings' : 'inherit',
    })
  }

  // 对话模型测试：不受「启用 AI 能力」开关限制，方便家长先验证再开启
  const config = resolveConfig(true)
  if (isConfigError(config)) {
    // 配置类错误的 field 指向对话配置（vision 按字段继承它），原样透传
    return c.json(
      {
        ok: false,
        code: config.code,
        message: config.error,
        hint: config.hint,
        ...(config.field ? { field: config.field } : {}),
        error: config.error,
      },
      config.status,
    )
  }
  return runTest(c, {
    model: config.model,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    target,
    keySource: config.keySource,
  })
})

/** 发起一次非流式连通性测试并分类错误。 */
async function runTest(
  c: any,
  opts: { model: string; baseUrl: string; apiKey: string; target: TestTarget; keySource: string },
) {
  const { model, baseUrl, apiKey, target, keySource } = opts
  const fieldPrefix = target === 'vision' ? 'vision.' : ''
  try {
    const res = await fetch(chatEndpoint(baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '只回复两个字：可用' }],
        max_tokens: 16,
        stream: false,
      }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 300)
      const { code, message, hint } = classifyUpstream(res.status, text)
      return c.json(
        {
          ok: false,
          code,
          message,
          hint,
          detail: text,
          field: `${fieldPrefix}apiKey`,
          error: message,
        },
        502,
      )
    }
    const data: any = await res.json().catch(() => null)
    const reply = String(data?.choices?.[0]?.message?.content ?? '连接成功').slice(0, 100)
    return c.json({ ok: true, message: reply, target, model, keySource })
  } catch (err: any) {
    const { code, message, hint, status } = classifyNetwork(err)
    return c.json(
      {
        ok: false,
        code,
        message,
        hint,
        detail: String(err?.cause?.code ?? err?.message ?? err).slice(0, 200),
        error: message,
      },
      status,
    )
  }
}

for (const feature of ['tutor', 'encourage', 'insight', 'weekly-report', 'homework-parse'] as const) {
  aiRoutes.post(`/${feature}`, requireAuth, async (c) => {
    const config = resolveConfig()
    if (isConfigError(config)) {
      return c.json({ error: config.error, code: config.code, hint: config.hint }, config.status === 400 ? 503 : config.status)
    }
    const payload = await readJson(c)
    if (!payload) return invalidJson(c)
    const messages = buildMessages(feature, payload)
    if (!messages || messages.length === 0) return c.json({ error: '没有可发送的内容', code: 'EMPTY' }, 400)

    // 拍照题目：图片以 data URL 传给视觉子配置指定的模型；未配置视觉时明确拒绝而不是静默回退
    const isVisionRequest =
      feature === 'tutor' && typeof payload.image === 'string' && payload.image.startsWith('data:image/')
    let useBaseUrl = config.baseUrl
    let useModel = config.model
    let useApiKey = config.apiKey
    if (isVisionRequest) {
      if (!config.vision.model) {
        return c.json(
          {
            error: '还没有配置拍照识题模型，请家长在「AI 设置 → 拍照识题模型」里填写',
            code: 'VISION_NOT_CONFIGURED',
            hint: '如 glm-4v-flash / qwen-vl-plus；地址与密钥留空则继承对话模型',
          },
          400,
        )
      }
      useBaseUrl = config.vision.baseUrl
      useModel = config.vision.model
      useApiKey = config.vision.apiKey
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
      const upstream = await fetch(chatEndpoint(useBaseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${useApiKey}`,
        },
        body: JSON.stringify({
          model: useModel,
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
        // 配了视觉模型但上游仍拒图：引导检查模型是否真的支持视觉输入
        if (isVisionRequest && /image|vision|multimodal|图片|看图|识图|content.*invalid/i.test(text)) {
          return c.json(
            {
              error: '当前视觉模型不支持看图，请在「AI 设置」换一个支持视觉的模型（如 glm-4v-flash 或 qwen-vl-plus）',
              code: 'VISION_NOT_SUPPORTED',
              hint: '确认模型名正确，且该厂商支持图片输入',
            },
            400,
          )
        }
        const { code, message, hint } = classifyUpstream(upstream.status, text)
        return c.json({ error: `${message}：${text.slice(0, 200)}`, code, hint, detail: text }, 502)
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
      const { code, message, hint, status } = classifyNetwork(err)
      return c.json({ error: message, code, hint }, status)
    }
  })
}

/** 拍照识题二期能力占位：接口先定稿，避免前端返工。 */
aiRoutes.post('/ocr', requireAuth, (c) =>
  c.json({ error: '拍照识题将在下一阶段上线，请先用文字输入题目', code: 'OCR_NOT_IMPLEMENTED' }, 501),
)

