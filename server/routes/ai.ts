import { Hono } from 'hono'
import { getState } from '../store'
import { requireAuth, type AppEnv } from '../middleware'
import { invalidJson, readJson } from '../json'
import { encouragePrompt, homeworkParsePrompt, insightPrompt, tutorSystem, weeklyReportPrompt } from '../ai/prompts'

/** 测试目标：对话模型 or 拍照识题视觉模型 */
type TestTarget = 'chat' | 'vision'

interface AiVisionResolved {
  baseUrl: string
  model: string
  apiKey: string
  /** key 实际来源，供 /status 展示「环境变量覆盖」提示 */
  keySource: 'env' | 'settings' | 'inherit'
}

interface AiConfig {
  baseUrl: string
  model: string
  apiKey: string
  keySource: 'env' | 'settings'
  vision: AiVisionResolved
  temperature: number
  enabled: boolean
}

/** 配置类错误：给家长可执行的下一步，field 用于前端标红对应输入框 */
interface AiConfigError {
  error: string
  code: string
  hint?: string
  field?: 'baseUrl' | 'model' | 'apiKey' | 'vision.baseUrl' | 'vision.model' | 'vision.apiKey'
  status: 400 | 503
}

function isConfigError(v: AiConfig | AiConfigError): v is AiConfigError {
  return 'code' in v && 'status' in v
}

/**
 * 解析 AI 配置。
 * `allowDisabled` 用于「测试连接」：家长可以先验证密钥再决定是否开启。
 *
 * 视觉配置按字段继承对话配置：vision.model 有值即启用视觉，
 * vision.baseUrl / vision.apiKey 留空时逐字段回退对话配置。
 */
function resolveConfig(allowDisabled = false): AiConfig | AiConfigError {
  const state = getState()
  const ai = state.settings.ai
  if (process.env.AI_ENABLED === 'false') {
    return {
      error: 'AI 功能已被服务器关闭',
      code: 'AI_DISABLED',
      hint: '服务器环境变量 AI_ENABLED=false，需管理员修改后重启',
      status: 503,
    }
  }
  const enabled = ai.enabled !== false
  if (!enabled && !allowDisabled) {
    return {
      error: '家长还没有开启 AI 能力，可以在「AI 设置」里打开',
      code: 'AI_NOT_READY',
      hint: '打开「家长中心 → AI 设置 → 启用 AI 能力」',
      status: 503,
    }
  }

  const envKey = (process.env.AI_API_KEY || '').trim()
  const apiKey = (envKey || ai.apiKey || '').trim()
  const baseUrl = (ai.baseUrl || process.env.AI_BASE_URL || '').trim()
  const model = (ai.model || process.env.AI_MODEL || '').trim()

  if (!apiKey) {
    return {
      error: '还没有配置大模型 API Key',
      code: 'AI_NOT_CONFIGURED',
      hint: '请在下方「API Key」输入密钥；若用环境变量部署，检查 AI_API_KEY 是否已设置',
      field: 'apiKey',
      status: 400,
    }
  }
  if (!baseUrl || !model) {
    return {
      error: '大模型地址或模型名称为空',
      code: 'AI_NOT_CONFIGURED',
      hint: !baseUrl ? '填写服务地址（如 https://api.deepseek.com/v1）' : '填写模型名（如 deepseek-chat）',
      field: !baseUrl ? 'baseUrl' : 'model',
      status: 400,
    }
  }

  const visionModel = ((process.env.AI_VISION_MODEL || '').trim() || (ai.vision?.model || '').trim())
  const visionBaseUrl = ((process.env.AI_VISION_BASE_URL || '').trim() || (ai.vision?.baseUrl || '').trim() || baseUrl)
  const envVisionKey = (process.env.AI_VISION_API_KEY || '').trim()
  const ownVisionKey = (ai.vision?.apiKey || '').trim()
  const visionApiKey = envVisionKey || ownVisionKey || apiKey
  const visionKeySource: AiVisionResolved['keySource'] = envVisionKey ? 'env' : ownVisionKey ? 'settings' : 'inherit'

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model,
    apiKey,
    keySource: envKey ? 'env' : 'settings',
    vision: {
      baseUrl: visionBaseUrl.replace(/\/+$/, ''),
      model: visionModel,
      apiKey: visionApiKey,
      keySource: visionKeySource,
    },
    temperature: Number(ai.temperature) || 0.7,
    enabled,
  }
}

function chatEndpoint(baseUrl: string): string {
  return baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`
}

/** 上游 HTTP 状态 → 家长可理解的错误分类 */
function classifyUpstream(status: number, bodyText: string): { code: string; message: string; hint: string } {
  if (status === 401 || status === 403) {
    return {
      code: 'AI_AUTH_ERROR',
      message: 'API Key 校验失败',
      hint: '检查密钥是否复制完整、是否已过期，或该密钥无权访问此模型',
    }
  }
  if (status === 404) {
    return {
      code: 'AI_MODEL_NOT_FOUND',
      message: '服务地址或模型名不正确',
      hint: '检查 Base URL 是否包含 /v1 等版本路径，模型名是否为厂商支持的精确名称',
    }
  }
  if (status === 402 || status === 429) {
    return {
      code: 'AI_QUOTA_EXCEEDED',
      message: '账户欠费或触发限流',
      hint: '到服务商控制台检查余额与配额，稍后再试',
    }
  }
  return {
    code: 'AI_UPSTREAM_ERROR',
    message: `模型服务返回 ${status}`,
    hint: '稍后重试；若持续失败，检查服务商状态页或更换模型',
  }
}

/** Node fetch 网络错误 → 分类（DNS / 拒绝连接 / 超时等） */
function classifyNetwork(err: any): { code: string; message: string; hint: string; status: 502 | 504 } {
  const name = String(err?.name ?? '')
  const causeCode = String(err?.cause?.code ?? err?.code ?? '')
  if (name === 'TimeoutError' || name === 'AbortError' || causeCode.includes('TIMEOUT') || causeCode === 'ETIMEDOUT') {
    return {
      code: 'AI_TIMEOUT',
      message: '连接模型服务超时（20 秒无响应）',
      hint: '稍后重试，或换一个更快的服务地址',
      status: 504,
    }
  }
  if (causeCode === 'ENOTFOUND' || causeCode === 'EAI_AGAIN') {
    return {
      code: 'AI_NETWORK_ERROR',
      message: '找不到该服务地址（域名解析失败）',
      hint: '检查 Base URL 拼写；NAS 容器内无法解析外网域名时，确认容器网络与 DNS',
      status: 502,
    }
  }
  if (causeCode === 'ECONNREFUSED') {
    return {
      code: 'AI_NETWORK_ERROR',
      message: '连接被拒绝，服务未在该地址监听',
      hint: '本地 Ollama 请填宿主机 IP（容器内 127.0.0.1 不是宿主机）；云端检查地址与端口',
      status: 502,
    }
  }
  if (causeCode === 'CERT_HAS_EXPIRED' || causeCode === 'DEPTH_ZERO_SELF_SIGNED_CERT' || causeCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || causeCode.includes('CERT')) {
    return {
      code: 'AI_NETWORK_ERROR',
      message: 'TLS 证书校验失败',
      hint: '内网自签证书的服务需确认地址为 https 且证书受信；或改用 http 内网地址',
      status: 502,
    }
  }
  return {
    code: 'AI_NETWORK_ERROR',
    message: '连不上模型服务',
    hint: '检查服务地址、NAS 出网与防火墙；确认服务商地址可从这台服务器访问',
    status: 502,
  }
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
