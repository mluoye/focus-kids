import { Hono } from 'hono'
import { getState } from '../store'
import { requireAuth, type AppEnv } from '../middleware'
import { invalidJson, readJson } from '../json'
import { encouragePrompt, homeworkParsePrompt, insightPrompt, storyMathJudgePrompt, storyMathPrompt, storyMathRecognizePrompt, tutorSystem, weeklyReportPrompt } from '../ai/prompts'
import { findUnit, findUnitsInRange, listUnits, mergeForbidden, mergeUnitConstraints } from '../ai/knowledge'
import { validateStoryMathQuestions } from '../ai/validate'
import type { MathUnitConstraints, MathUnitKnowledge, MathUnitNo, MathTerm } from '../ai/knowledge/types'
import type { StoryMathGrade, StoryMathProblem, StoryMathQuestionType } from '../../shared/types'

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

/**
 * AI 应用题拍照识题：从孩子列的竖式/计算过程照片里提取最终答案与置信度。
 * 0.16.0 起「AI 数学应用题」支持列式拍照，识别结果先回显让孩子确认或修正，再进判卷。
 * 需要视觉模型；未配置视觉时明确返回 `VISION_NOT_CONFIGURED`。
 */
aiRoutes.post('/storymath/recognize', requireAuth, async (c) => {
  const config = resolveConfig()
  if (isConfigError(config)) {
    return c.json({ error: config.error, code: config.code, hint: config.hint }, config.status === 400 ? 503 : config.status)
  }
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
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const image = typeof body?.image === 'string' ? body.image : ''
  if (!image.startsWith('data:image/')) return c.json({ error: '请上传一张图片', code: 'INVALID_IMAGE' }, 400)
  // 图片上限：判卷/识别都是单张，压缩后通常 <2MB，这里放宽到 4MB 兼容更大照片
  if (image.length > 4_000_000) return c.json({ error: '图片过大，请压缩后重拍', code: 'IMAGE_TOO_LARGE' }, 400)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)
  c.req.raw.signal.addEventListener('abort', () => controller.abort())

  try {
    const upstream = await fetch(chatEndpoint(config.vision.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.vision.apiKey}`,
      },
      body: JSON.stringify({
        model: config.vision.model,
        messages: [
          { role: 'system', content: '你是数学老师，只输出规定的 JSON 对象，不输出任何其他内容。' },
          {
            role: 'user',
            content: [
              { type: 'text', text: storyMathRecognizePrompt() },
              { type: 'image_url', image_url: { url: image.slice(0, 4_000_000) } },
            ],
          },
        ],
        temperature: 0.1,
        stream: false,
        max_tokens: 300,
      }),
      signal: controller.signal,
    })
    if (!upstream.ok) {
      const text = (await upstream.text().catch(() => '')).slice(0, 400)
      clearTimeout(timeout)
      // 配了视觉模型但上游仍拒图：引导检查模型是否真的支持视觉输入
      if (/image|vision|multimodal|图片|看图|识图|content.*invalid/i.test(text)) {
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
    const data: any = await upstream.json().catch(() => null)
    const content = String(data?.choices?.[0]?.message?.content ?? '')
    const parsed = parseStoryMathRecognize(content)
    if (!parsed) {
      return c.json(
        { error: 'AI 没能读出答案，请把算式拍清楚一点，或直接输入答案', code: 'AI_PARSE_ERROR', hint: '照片可能太糊、被裁切或拍歪' },
        502,
      )
    }
    return c.json(parsed)
  } catch (err: any) {
    clearTimeout(timeout)
    if (controller.signal.aborted) return new Response(null, { status: 499 })
    const { code, message, hint, status } = classifyNetwork(err)
    return c.json({ error: message, code, hint }, status)
  } finally {
    clearTimeout(timeout)
  }
})

/**
 * AI 应用题判卷：对整卷逐题判定对错，返回标准答案、错误位置与解题思路。
 * 一次性接收整卷（主轮 5 题 + 可能拍照题），前端在全部作答后提交。
 */
aiRoutes.post('/storymath/judge', requireAuth, async (c) => {
  const config = resolveConfig()
  if (isConfigError(config)) {
    return c.json({ error: config.error, code: config.code, hint: config.hint }, config.status === 400 ? 503 : config.status)
  }
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const submissions = Array.isArray(body?.submissions) ? body.submissions : []
  if (submissions.length === 0) return c.json({ error: '没有可判卷的题目', code: 'EMPTY' }, 400)
  if (submissions.length > 20) return c.json({ error: '一次最多判卷 20 题', code: 'TOO_MANY' }, 400)
  for (const s of submissions) {
    if (typeof s?.text !== 'string' || !s.text.trim()) return c.json({ error: '存在缺题面文字的题', code: 'INVALID_ITEM' }, 400)
    // 答案值：数字（word/calc/choice 索引）或非空字符串（fill）
    const okSub = (typeof s?.submitted === 'number' && Number.isFinite(s.submitted)) || (typeof s?.submitted === 'string' && s.submitted.trim() !== '')
    if (!okSub) {
      return c.json({ error: '存在未作答的题', code: 'INVALID_ITEM' }, 400)
    }
  }

  const system = { role: 'system', content: '你是小学老师批改应用题，只输出规定的 JSON 对象，不输出任何其他内容。' }
  const user = { role: 'user', content: storyMathJudgePrompt() + '\n\n待判卷的题：\n' + JSON.stringify(submissions) }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)
  c.req.raw.signal.addEventListener('abort', () => controller.abort())

  try {
    const upstream = await fetch(chatEndpoint(config.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [system, user],
        temperature: 0.2,
        stream: false,
        max_tokens: 4000,
        reasoning_effort: 'none',
      }),
      signal: controller.signal,
    })
    if (!upstream.ok) {
      const text = (await upstream.text().catch(() => '')).slice(0, 400)
      clearTimeout(timeout)
      const { code, message, hint } = classifyUpstream(upstream.status, text)
      return c.json({ error: `${message}：${text.slice(0, 200)}`, code, hint, detail: text }, 502)
    }
    const data: any = await upstream.json().catch(() => null)
    const content = String(data?.choices?.[0]?.message?.content ?? '')
    const parsed = parseStoryMathJudge(content, submissions)
    if (!parsed) {
      return c.json(
        { error: 'AI 判卷结果无法解析，请重试', code: 'AI_PARSE_ERROR', hint: '模型可能返回了非 JSON 内容，稍后再试' },
        502,
      )
    }
    return c.json({ items: parsed })
  } catch (err: any) {
    clearTimeout(timeout)
    if (controller.signal.aborted) return new Response(null, { status: 499 })
    const { code, message, hint, status } = classifyNetwork(err)
    return c.json({ error: message, code, hint }, status)
  } finally {
    clearTimeout(timeout)
  }
})

/**
 * 单元列表（家长端 AI 应用题设置用）：返回某年级某学期全部单元，标注支持题型与是否含应用题。
 * 多题型（0.17.0）：`questionTypes` 是该单元可出的全部题型（calc/fill/choice/word），前端据此
 * 决定哪些单元可选（无任何题型的单元置灰）；`hasWord` 为兼容旧客户端的冗余字段。2~6 年级无数据时返回空数组。
 */
aiRoutes.get('/storymath/units', requireAuth, (c) => {
  const grade = Number(c.req.query('grade')) || 1
  const term = Number(c.req.query('term')) === 2 ? 2 : 1
  const units = listUnits(Math.min(6, Math.max(1, grade)) as StoryMathGrade, term)
  return c.json({
    units: units.map((u) => ({
      unitNo: u.unitNo,
      name: u.unitName,
      hasWord: u.questionTypes.includes('word'),
      questionTypes: u.questionTypes,
    })),
  })
})

/**
 * AI 生成应用题（storymath）：按年级出 N 道题，返回完整 JSON 数组。
 * 独立 POST 接口（非 SSE），一次返回整包，方便前端组装后逐题作答。
 */
aiRoutes.post('/storymath', requireAuth, async (c) => {
  const config = resolveConfig()
  if (isConfigError(config)) {
    return c.json({ error: config.error, code: config.code, hint: config.hint }, config.status === 400 ? 503 : config.status)
  }
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const grade = Number(body?.grade) || 1
  const count = Number(body?.count) || 5
  if (grade < 1 || grade > 6) return c.json({ error: '年级需为 1~6', code: 'INVALID_GRADE' }, 400)
  if (count < 1 || count > 20) return c.json({ error: '题量需为 1~20', code: 'INVALID_COUNT' }, 400)
  // 专项训练轮：可传 focusPoints（错题知识点），服务端按它出变式题；主轮不传
  const focusPoints: string[] = Array.isArray(body?.focusPoints)
    ? body.focusPoints.map((x: unknown) => String(x ?? '').trim()).filter(Boolean).slice(0, 6)
    : []

  // 单元/整合复习上下文（0.17.0 起）：不传则按年级出题（旧客户端兼容）
  const ctx = resolveStoryMathContext(body, grade)
  if (ctx.error) return c.json(ctx.error, ctx.status)
  const { unit, units, term, unitNo, constraints, forbidden } = ctx

  // 1a 只出应用题：单元不含 word 题型时，明确提示（该单元以图形/认数/操作题为主）
  const kb = units ?? (unit ? [unit] : undefined)
  if (kb && !kb.some((u) => u.questionTypes.length)) {
    return c.json(
      { error: '该单元暂无可出的题型，请换一个单元', code: 'UNIT_NO_WORD', hint: '请换一个单元' },
      400,
    )
  }
  // 多题型：单单元=该单元题型，整合复习=范围内并集，按年级=全题型
  const allTypes: StoryMathQuestionType[] = ['word', 'calc', 'fill', 'choice']
  const questionTypes = kb ? [...new Set(kb.flatMap((u) => u.questionTypes))] : allTypes

  const system = { role: 'system', content: '你是小学数学应用题出题器，只输出规定的 JSON 数组，不输出任何其他内容。' }
  const user = { role: 'user', content: storyMathPrompt({ grade, count, unit, units, term, unitNo, focusPoints, questionTypes }) }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)
  c.req.raw.signal.addEventListener('abort', () => controller.abort())

  try {
    // 深度思考模型（如 sensenova-6.8-flash-lite）偶发把 token 预算全花在 reasoning 上，
    // 导致 message.content 为空：重试几轮，仍失败才报解析错误。
    const MAX_RETRY = 3
    let content = ''
    let parsed: ReturnType<typeof parseStoryMath> = []
    for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
      const upstream = await fetch(chatEndpoint(config.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [system, user],
          temperature: 0.4,
          stream: false,
          max_tokens: 3000,
          // 关闭深度思考：思考模式会把 token 预算花在 reasoning 上导致 content 为空，且响应慢 10 倍+
          reasoning_effort: 'none',
        }),
        signal: controller.signal,
      })
      if (!upstream.ok) {
        const text = (await upstream.text().catch(() => '')).slice(0, 400)
        const { code, message, hint } = classifyUpstream(upstream.status, text)
        return c.json({ error: `${message}：${text.slice(0, 200)}`, code, hint, detail: text }, 502)
      }
      const data: any = await upstream.json().catch(() => null)
      content = String(data?.choices?.[0]?.message?.content ?? '')
      parsed = parseStoryMath(content, count, questionTypes)
      if (parsed.length) break
      if (attempt < MAX_RETRY - 1) await new Promise((r) => setTimeout(r, 600))
    }
    if (!parsed.length) {
      // detail 带回原始返回内容（截断），家长可在 AI 设置页看到具体形态，便于定位解析失败
      return c.json(
        {
          error: 'AI 生成的题目无法解析，请重试',
          code: 'AI_PARSE_ERROR',
          hint: '模型可能返回了非 JSON 内容，稍后再试或换一个模型',
          detail: content.slice(0, 800),
        },
        502,
      )
    }
    // 红队校验（0.17.0）：按单元/整合复习的硬性约束过滤超纲题，淘汰项丢弃
    const final = kb && constraints ? validateStoryMathQuestions(parsed, constraints, forbidden) : { kept: parsed, reasons: [] }
    if (!final.kept.length) {
      return c.json(
        {
          error: 'AI 生成的题目未通过进度校验，请重试',
          code: 'AI_VALIDATE_ERROR',
          hint: '题目疑似超纲（数字范围 / 禁止考点 / 负号），已拦截',
          detail: final.reasons.slice(0, 5).join('；').slice(0, 400),
        },
        502,
      )
    }
    // 返回当前出题上下文，供前端展示「当前单元 / 复习范围」
    const unitInfo = unit
      ? { unit: { term: unit.term, unitNo: unit.unitNo, name: unit.unitName } }
      : units && units.length
        ? {
            unitRange: {
              term: units[0].term,
              from: units[0].unitNo,
              to: units[units.length - 1].unitNo,
              name: units.map((u) => u.unitName).join('、'),
            },
          }
        : {}
    return c.json({ grade, questions: final.kept, ...unitInfo })
  } catch (err: any) {
    clearTimeout(timeout)
    // 孩子离开页面时连接被 abort，无需当作错误上报（与其它生成接口一致）
    if (controller.signal.aborted) return new Response(null, { status: 499 })
    const { code, message, hint, status } = classifyNetwork(err)
    return c.json({ error: message, code, hint }, status)
  } finally {
    clearTimeout(timeout)
  }
})

/**
 * 解析出题上下文：单单元（term+unitNo）/ 整合复习（term+unitRange）/ 无（按年级）。
 * 旧客户端不传新字段 → 返回空对象，走按年级出题，保持兼容。
 */
function resolveStoryMathContext(
  body: any,
  grade: number,
):
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
  | { error: { error: string; code: string; hint?: string }; status: 400 } {
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
    // 纯文本链路自洽：范围内跳过无可出题型的看图/观察单元（questionTypes 为空，待配图支持），只从可出题单元出题
    const playable = us.filter((u) => u.questionTypes.length > 0)
    if (!playable.length) {
      return { error: { error: '该范围内暂无可出题的单元（看图题待配图），请换一个范围', code: 'UNIT_NO_WORD' }, status: 400 }
    }
    return { units: playable, term, constraints: mergeUnitConstraints(playable), forbidden: mergeForbidden(playable) }
  }
  // 无单元上下文：按年级（旧客户端）
  return {}
}

/** 归一化题型：AI 返回非法/缺失时回退 word（1a 兼容）。 */
function normalizeQuestionType(v: unknown): StoryMathQuestionType {
  const t = String(v ?? '').trim()
  return t === 'calc' || t === 'fill' || t === 'choice' || t === 'word' ? t : 'word'
}

/** 题面含看图表述（图中/下图/看图等）时，纯文本链路无法作答，命中即弃题；不含「图书」「图形」「地图」等普通词。 */
const IMAGE_REF_RE = /图中|下图|右图|左图|上图|看图|图略|如图所示|图中有|如右图|如左图|图里|图上有/

/** 解析 AI 返回的题目 JSON；按题型过滤非法项（word/calc 数字答案、fill 文字、choice 索引+4 选项），并裁剪到 count。 */
function parseStoryMath(content: string, count: number, allowedTypes?: StoryMathQuestionType[]): StoryMathProblem[] {
  const list = extractStoryMathArray(content)
  // 题型白名单：模型偶发出白名单外题型（如 word 单元出 choice），跳过以保证不偏离单元 questionTypes 约束
  const allow = allowedTypes && allowedTypes.length ? new Set(allowedTypes) : null
  const out: StoryMathProblem[] = []
  for (const item of list) {
    const text = String(item?.text ?? '').trim()
    if (!text) continue
    // 纯文本链路无插图：题面含「图中/下图/看图」等看图表述时孩子无法作答，整题丢弃（prompt 已禁图，这里兜底）
    if (IMAGE_REF_RE.test(text)) continue
    const type = normalizeQuestionType(item?.type)
    if (allow && !allow.has(type)) continue
    let answer: number | string | null = null
    let options: string[] | undefined
    if (type === 'choice') {
      const opts = Array.isArray(item?.options) ? item.options.map((o: unknown) => String(o).trim()).filter(Boolean) : []
      if (opts.length !== 4) continue
      const idx = toFiniteNumber(item?.answer)
      if (idx === null || !Number.isInteger(idx) || idx < 0 || idx > 3) continue
      answer = idx
      options = opts
    } else if (type === 'fill') {
      const a = String(item?.answer ?? '').trim()
      if (!a) continue
      answer = a.slice(0, 40)
    } else {
      // word / calc：数字答案（含「8个」「3.5元」这类带单位字符串，提取数字部分）
      const a = toFiniteNumber(item?.answer)
      if (a === null) continue
      answer = a
    }
    // 知识点标签：出题与判卷都依赖它做专项训练，缺失则按「未标注」兜底（不丢弃整题）
    const knowledgePoint = String(item?.knowledgePoint ?? '').trim().slice(0, 40) || '未标注'
    const unit = type === 'word' || type === 'calc' ? extractUnit(item) : ''
    out.push({
      text: text.slice(0, 400),
      type,
      ...(options ? { options } : {}),
      answer,
      unit,
      knowledgePoint,
      ...(item?.hint ? { hint: String(item.hint).slice(0, 120) } : {}),
    })
    if (out.length >= count) break
  }
  return out
}

/** 解析拍照识题结果：{ answer, confidence }。看不清时 answer=0 且 confidence=0，前端提示重拍。 */
function parseStoryMathRecognize(content: string): { answer: number; confidence: number } | null {
  const obj = extractStoryMathObject(content)
  if (!obj) return null
  const answer = toFiniteNumber(obj?.answer)
  if (answer === null) return null
  let confidence = Number(obj?.confidence)
  if (!Number.isFinite(confidence)) confidence = 0.5
  return { answer, confidence: Math.max(0, Math.min(1, confidence)) }
}

/** 解析判卷结果：{ items: [...] }。逐题按题型解析答案（word/calc 数字、fill 文字、choice 索引），缺项/缺答案按「无法判定」丢弃整卷。 */
function parseStoryMathJudge(content: string, submissions: any[]): any[] | null {
  const obj = extractStoryMathObject(content)
  if (!obj) return null
  const raw = Array.isArray(obj?.items) ? obj.items : null
  if (!raw) return null
  // 判卷必须逐题齐全：缺任何一项都视为解析失败，避免静默丢题导致正确率失真
  const items: any[] = []
  for (let i = 0; i < submissions.length; i++) {
    const sub = submissions[i]
    const item = raw[i]
    if (!item || typeof item !== 'object') return null
    const type = normalizeQuestionType(sub?.type)
    let answer: number | string | null = null
    if (type === 'choice') {
      const idx = toFiniteNumber(item?.answer)
      if (idx === null || !Number.isInteger(idx) || idx < 0 || idx > 3) return null
      answer = idx
    } else if (type === 'fill') {
      const a = String(item?.answer ?? '').trim()
      if (!a) return null
      answer = a.slice(0, 40)
    } else {
      const a = toFiniteNumber(item?.answer)
      if (a === null) return null
      answer = a
    }
    items.push({
      index: i,
      correct: item?.correct === true,
      answer,
      ...(sub?.type ? { type: normalizeQuestionType(sub?.type) } : {}),
      ...(Array.isArray(sub?.options) && sub.options.length ? { options: sub.options } : {}),
      solution: String(item?.solution ?? '').trim().slice(0, 200),
      knowledgePoint: String(item?.knowledgePoint ?? '').trim().slice(0, 40) || '未标注',
      ...(item?.errorStep ? { errorStep: String(item.errorStep).trim().slice(0, 120) } : {}),
    })
  }
  return items
}

/**
 * 从 AI 返回的文本里稳健地取出一个对象（判卷 / 识题用）。
 * 形态：裸对象、markdown 代码块包裹、对象外面包了说明文字、对象被序列化成字符串。
 * 用平衡括号截取，不依赖贪婪正则；多个 `{...}` 时取第一个能解析成目标对象的。
 */
function extractStoryMathObject(content: string): any | null {
  if (!content) return null
  const stripped = content
    .replace(/````?json/gi, '')
    .replace(/````?/g, '')
    .trim()
  const direct = tryParseJson(stripped)
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct
  let objFrom = 0
  while (objFrom < stripped.length) {
    const objStart = stripped.indexOf('{', objFrom)
    if (objStart === -1) break
    const candidate = sliceBalanced(stripped, objStart, '{', '}')
    if (candidate) {
      const obj = tryParseJson(candidate)
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj
    }
    objFrom = objStart + 1
  }
  return null
}

/**
 * 从 AI 返回的文本里稳健地取出题目数组。
 *
 * 真实模型输出形态多样，按优先级逐一尝试：
 * 1. 剥离 markdown 代码块（含 ``` 与 ```` 围栏）后直接 JSON.parse（裸数组 / 对象包裹均可）
 * 2. 对象包裹的 `questions` 字段（可能是数组，也可能是「被序列化成字符串的数组」）
 * 3. 从大文本里逐个 `[` 位置用「平衡括号」截取，取第一个能解析成题目数组的候选
 *    （不依赖贪婪正则，避免题面里的 `]` 截断；多个 `[...]` 时跳过说明文字里的假 `[`）
 */
function extractStoryMathArray(content: string): any[] {
  if (!content) return []
  const stripped = content
    .replace(/````?json/gi, '')
    .replace(/````?/g, '')
    .trim()

  // 1. 直接解析（裸数组或含数组的对象）
  const direct = tryParseJson(stripped)
  const fromDirect = arrayFromParsed(direct)
  if (fromDirect) return fromDirect

  // 2. 逐个 `[` 位置用平衡括号截取，找第一个能解析成题目数组的候选
  //    （跳过说明文字里的假数组如「这里有[2]道题」——它们不是题目对象数组）
  let searchFrom = 0
  while (searchFrom < stripped.length) {
    const arrayStart = stripped.indexOf('[', searchFrom)
    if (arrayStart === -1) break
    const candidate = sliceBalanced(stripped, arrayStart, '[', ']')
    if (candidate) {
      const arr = arrayFromParsed(tryParseJson(candidate))
      if (arr && isProblemArray(arr)) return arr
    }
    searchFrom = arrayStart + 1
  }

  // 3. 对象包裹（text/answer 直接作为单题，模型可能只出 1 题时这样返回）
  let objFrom = 0
  while (objFrom < stripped.length) {
    const objStart = stripped.indexOf('{', objFrom)
    if (objStart === -1) break
    const candidate = sliceBalanced(stripped, objStart, '{', '}')
    if (candidate) {
      const obj = tryParseJson(candidate)
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const arr = arrayFromParsed(obj)
        if (arr) return arr
        // 单题对象：{ text, answer, ... }
        if (typeof obj.text === 'string' && obj.answer !== undefined) return [obj]
      }
    }
    objFrom = objStart + 1
  }

  return []
}

/** JSON.parse 安全封装：失败返回 null。 */
function tryParseJson(s: string): any {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/** 从「可能是数组 / 含 questions 的对象 / questions 为字符串」的结构里取出题目数组；取不到返回 null。 */
function arrayFromParsed(v: any): any[] | null {
  let arr: any[] | null = null
  if (Array.isArray(v)) {
    arr = v
  } else if (v && typeof v === 'object') {
    if (Array.isArray(v.questions)) arr = v.questions
    // 模型偶尔把数组序列化成字符串（如 `"questions": "[{...}]"`），再解析一层
    else if (typeof v.questions === 'string' && v.questions.trim()) {
      const inner = tryParseJson(v.questions.trim())
      if (Array.isArray(inner)) arr = inner
      else if (inner && typeof inner === 'object' && Array.isArray(inner.questions)) arr = inner.questions
    }
  }
  // 必须是题目对象数组（至少一项含 text/answer），否则视为假数组跳过
  return arr && isProblemArray(arr) ? arr : null
}

/** 校验数组确实是「题目对象数组」：非空且至少一项是含 text 或 answer 的对象。 */
function isProblemArray(arr: any[]): boolean {
  return arr.some((it) => it && typeof it === 'object' && (typeof it.text === 'string' || it.answer !== undefined))
}

/** 从 start 位置起按成对符号截取平衡子串；不匹配返回 null。 */
function sliceBalanced(src: string, start: number, open: string, close: string): string | null {
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (inString) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return null
}

/** 把答案转成有限数字：数字 / 数字字符串 / 带单位字符串（如「8个」「3.5元」）/ 中文数字（「八」「十五」）。 */
function toFiniteNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const num = Number(trimmed)
  if (Number.isFinite(num)) return num
  // 带单位或约数：取前导数字部分（「8个」「3.5元」「约12」「8 个」）
  const match = trimmed.match(/^-?(\d+(\.\d+)?)/)
  if (match) {
    const parsed = Number(match[0])
    if (Number.isFinite(parsed)) return parsed
  }
  // 中文数字（零一二三…十百千），如「八」「十五」「一百二十」；阿拉伯数字混排也可
  const cn = chineseToNumber(trimmed)
  if (cn !== null) return cn
  return null
}

const CN_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}
const CN_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 }

/** 中文数字转阿拉伯数字；不认识或超范围返回 null。支持「八」「十五」「一百二十」「二千零五」。 */
function chineseToNumber(s: string): number | null {
  // 只保留中文数字 + 单位 + 负号
  const normalized = s.replace(/[^零一二三四五六七八九十百千万负]/g, '')
  if (!normalized) return null
  let negative = false
  let body = normalized
  if (body.startsWith('负')) {
    negative = true
    body = body.slice(1)
  }
  // 纯个位数（一~九）
  if (body.length === 1 && CN_DIGITS[body] !== undefined) return CN_DIGITS[body]
  let total = 0
  let section = 0
  let number = 0
  for (const ch of body) {
    if (CN_DIGITS[ch] !== undefined) {
      number = CN_DIGITS[ch]
    } else if (CN_UNITS[ch] !== undefined) {
      const unit = CN_UNITS[ch]
      if (unit === 10000) {
        section = (section + number) * unit
        total += section
        section = 0
        number = 0
      } else {
        // 十五 = 10 + 5（十前无数 → 1 个十）
        section += (number || 1) * unit
        number = 0
      }
    } else {
      return null
    }
  }
  const result = total + section + number
  if (!Number.isFinite(result) || result <= 0) return null
  return negative ? -result : result
}

/** 提取答案单位：优先取显式 unit 字段，否则从「8个」「3.5元」这类答案字符串里剥出来。 */
function extractUnit(item: any): string {
  const explicit = String(item?.unit ?? '').trim().slice(0, 12)
  if (explicit) return explicit
  if (typeof item?.answer === 'string') {
    const m = item.answer.trim().match(/^[+-]?\d+(\.\d+)?\s*(.*)$/)
    if (m && m[2]) return m[2].trim().slice(0, 12)
  }
  return ''
}
