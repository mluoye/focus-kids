import { getFamilyCache } from '../db/store'
/**
 * AI 配置解析与上游错误分类。
 * 本模块不含 Hono 路由，供 ai.ts 路由层与测试连接逻辑共用。
 */

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export interface AiVisionResolved {
  baseUrl: string
  model: string
  apiKey: string
  /** key 实际来源，供 /status 展示「环境变量覆盖」提示 */
  keySource: 'env' | 'settings' | 'inherit'
}

export interface AiConfig {
  baseUrl: string
  model: string
  apiKey: string
  keySource: 'env' | 'settings'
  vision: AiVisionResolved
  temperature: number
  enabled: boolean
}

/** 配置类错误：给家长可执行的下一步，field 用于前端标红对应输入框 */
export interface AiConfigError {
  error: string
  code: string
  hint?: string
  field?: 'baseUrl' | 'model' | 'apiKey' | 'vision.baseUrl' | 'vision.model' | 'vision.apiKey'
  status: 400 | 503
}

export function isConfigError(v: AiConfig | AiConfigError): v is AiConfigError {
  return 'code' in v && 'status' in v
}

// ─── 配置解析 ─────────────────────────────────────────────────────────────────

/**
 * 解析 AI 配置。
 * `allowDisabled` 用于「测试连接」：家长可以先验证密钥再决定是否开启。
 *
 * 视觉配置按字段继承对话配置：vision.model 有值即启用视觉，
 * vision.baseUrl / vision.apiKey 留空时逐字段回退对话配置。
 */
export function resolveConfig(familyId: string, allowDisabled = false): AiConfig | AiConfigError {
  const ai = getFamilyCache(familyId).settings.ai
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

// ─── 上游错误分类 ─────────────────────────────────────────────────────────────

export function chatEndpoint(baseUrl: string): string {
  return baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`
}

/** 上游 HTTP 状态 → 家长可理解的错误分类 */
export function classifyUpstream(status: number, bodyText: string): { code: string; message: string; hint: string } {
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
export function classifyNetwork(err: any): { code: string; message: string; hint: string; status: 502 | 504 } {
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
  if (
    causeCode === 'CERT_HAS_EXPIRED' ||
    causeCode === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    causeCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    causeCode.includes('CERT')
  ) {
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
