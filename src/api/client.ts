const TOKEN_KEY = 'fk.token'
const ROLE_KEY = 'fk.role'
const PROFILE_KEY = 'fk.profileId'

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? ''
}
export function setSession(token: string, role: string, profileId?: string) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(ROLE_KEY, role)
  if (profileId) localStorage.setItem(PROFILE_KEY, profileId)
  else localStorage.removeItem(PROFILE_KEY)
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(ROLE_KEY)
  localStorage.removeItem(PROFILE_KEY)
}
export function storedRole(): string {
  return localStorage.getItem(ROLE_KEY) ?? ''
}
export function storedProfileId(): string {
  return localStorage.getItem(PROFILE_KEY) ?? ''
}

export class ApiError extends Error {
  status: number
  code?: string
  /** 服务端给出的可操作建议（AI 测试等接口） */
  hint?: string
  /** 出错的表单字段名，用于前端标红输入框 */
  field?: string
  /** 技术细节（上游原始报文等），供折叠展示 */
  detail?: string
  constructor(
    message: string,
    status: number,
    code?: string,
    extra?: { hint?: string; field?: string; detail?: string },
  ) {
    super(message)
    this.status = status
    this.code = code
    this.hint = extra?.hint
    this.field = extra?.field
    this.detail = extra?.detail
  }
}

interface RequestOptions {
  method?: string
  body?: unknown
  signal?: AbortSignal
}

export async function request<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err
    throw new ApiError('网络连接不上，已切换到离线模式', 0, 'OFFLINE')
  }
  const text = await res.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { error: text }
  }
  if (!res.ok) {
    if (res.status === 401) clearSession()
    throw new ApiError(data?.error ?? `请求失败（${res.status}）`, res.status, data?.code, {
      hint: typeof data?.hint === 'string' ? data.hint : undefined,
      field: typeof data?.field === 'string' ? data.field : undefined,
      detail: typeof data?.detail === 'string' ? data.detail : undefined,
    })
  }
  return data as T
}

export const api = {
  bootstrap: () => request('/auth/bootstrap'),
  registerParent: (username: string, password: string) =>
    request('/auth/register', { method: 'POST', body: { username, password } }),
  loginParent: (username: string, password: string) =>
    request('/auth/login', { method: 'POST', body: { username, password } }),
  loginChild: (profileId: string, pin: string) =>
    request('/auth/child/login', { method: 'POST', body: { profileId, pin } }),
  recoverParent: (recoveryCode: string, newPassword: string) =>
    request('/auth/recover', { method: 'POST', body: { recoveryCode, newPassword } }),
  changeParentPassword: (currentPassword: string, newPassword: string) =>
    request('/auth/parent/password', { method: 'POST', body: { currentPassword, newPassword } }),
  changeParentUsername: (currentPassword: string, username: string) =>
    request('/auth/parent/username', { method: 'POST', body: { currentPassword, username } }),
  regenerateRecoveryCode: (currentPassword: string) =>
    request('/auth/parent/recovery', { method: 'POST', body: { currentPassword } }),
  parentUnlock: (password: string) => request('/auth/parent/verify', { method: 'POST', body: { password } }),
  parentCheck: (password: string) => request('/auth/parent/check', { method: 'POST', body: { password } }),
  me: () => request('/auth/me'),
  logout: () => request('/auth/logout', { method: 'POST' }),

  picker: () => request('/profiles/picker'),
  createProfile: (payload: { name: string; avatar: string; pin: string }) =>
    request('/profiles', { method: 'POST', body: payload }),
  updateProfile: (id: string, payload: Record<string, unknown>) =>
    request(`/profiles/${id}`, { method: 'PATCH', body: payload }),
  deleteProfile: (id: string) => request(`/profiles/${id}`, { method: 'DELETE' }),

  getState: () => request('/state'),
  mergeState: (payload: unknown) => request('/state', { method: 'POST', body: payload }),
  pushRecord: (record: unknown) => request('/state/records', { method: 'POST', body: { record } }),
  pushHomework: (session: unknown) => request('/state/homework', { method: 'POST', body: { session } }),
  saveHomeworkPlan: (plan: unknown) => request('/state/homework-plan', { method: 'PUT', body: { plan } }),
  deleteHomeworkPlan: (id: string) => request(`/state/homework-plan/${id}`, { method: 'DELETE' }),
  saveSettings: (payload: unknown) => request('/state/settings', { method: 'PATCH', body: payload }),
  saveTtsPrefs: (payload: { order?: string[]; voice?: { edge?: string; openai?: string } }) =>
    request('/state/tts-prefs', { method: 'PATCH', body: payload }),
  exportState: (payload: { profileId?: string; from?: number; to?: number }) =>
    request('/state/export', { method: 'POST', body: payload }),
  pruneState: (payload: { profileId?: string; before: number }) =>
    request('/state/prune', { method: 'POST', body: payload }),

  aiStatus: () => request('/ai/status'),
  aiTest: (target: 'chat' | 'vision' = 'chat') => request('/ai/test', { method: 'POST', body: { target } }),
  /**
   * AI 生成应用题：返回 { grade, questions: [{text, answer, unit, knowledgePoint, hint?}] }。
   * `focusPoints` 非空时是专项训练轮（只出这些知识点范围内的变式题）。
   */
  storymath: (grade: number, count = 5, focusPoints: string[] = []) =>
    request('/ai/storymath', { method: 'POST', body: { grade, count, ...(focusPoints.length ? { focusPoints } : {}) } }),
  /** AI 拍照识题：从孩子列的竖式照片里提取答案，返回 { answer, confidence } */
  storymathRecognize: (image: string) =>
    request('/ai/storymath/recognize', { method: 'POST', body: { image } }),
  /** AI 判卷：对整卷逐题判定，返回 { items: [{index, correct, answer, errorStep?, solution, knowledgePoint}] } */
  storymathJudge: (submissions: unknown[]) =>
    request('/ai/storymath/judge', { method: 'POST', body: { submissions } }),
}

/**
 * 朗读合成：请求体 JSON，成功返回 mp3 blob，失败抛 ApiError（含 code / hint / detail）。
 * 与 SSE/二进制同类：`request()` 只解析 JSON，这里显式带 token 原始 fetch（AGENTS.md 允许）。
 */
async function ttsFetch(path: string, body: unknown, signal?: AbortSignal): Promise<Blob> {
  const token = getToken()
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  })
  const contentType = res.headers.get('content-type') ?? ''
  if (!res.ok || contentType.includes('application/json')) {
    let message = `朗读请求失败（${res.status}）`
    let code: string | undefined
    let hint: string | undefined
    let field: string | undefined
    let detail: string | undefined
    try {
      const data = await res.json()
      message = data?.error ?? message
      code = data?.code
      hint = typeof data?.hint === 'string' ? data.hint : undefined
      field = typeof data?.field === 'string' ? data.field : undefined
      detail = typeof data?.detail === 'string' ? data.detail : undefined
    } catch {
      /* 非 JSON 错误体，保留状态码文案 */
    }
    if (res.status === 401) clearSession()
    throw new ApiError(message, res.status, code, { hint, field, detail })
  }
  return res.blob()
}

/** 合成并播放用：`source` 指定后端来源，省略时服务端按旧 provider 兼容老客户端；`voice` 可指定本次音色（孩子试听用）。 */
export async function ttsSpeak(
  text: string,
  source?: 'edge' | 'openai',
  signal?: AbortSignal,
  voice?: string,
): Promise<Blob> {
  const body: Record<string, unknown> = source ? { text, source } : { text }
  if (voice) body.voice = voice
  return ttsFetch('/api/tts', body, signal)
}

/** 家长试听某个后端来源；成功后服务端把该来源记为已试听（并写入当时配置的指纹）。 */
export async function ttsPreview(source: 'edge' | 'openai'): Promise<Blob> {
  return ttsFetch('/api/tts/preview', { source })
}

/** 关标签页/刷新时用 keepalive 补一笔暂停状态，避免家长端一直显示「正在写作业」。 */
export function pushHomeworkKeepalive(session: unknown): void {
  try {
    void fetch('/api/state/homework', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ session }),
      keepalive: true,
    }).catch(() => {
      /* 页面已关闭，失败就交给本地草稿 */
    })
  } catch {
    /* 忽略 */
  }
}

/** 读取 OpenAI 兼容 SSE 流，把增量文本交给回调。 */
export async function streamAi(
  feature: 'tutor' | 'encourage' | 'insight' | 'weekly-report' | 'homework-parse',
  body: unknown,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = getToken()
  const res = await fetch(`/api/ai/${feature}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    let message = `AI 请求失败（${res.status}）`
    try {
      const data = await res.json()
      message = data?.error ?? message
    } catch {
      /* ignore */
    }
    throw new ApiError(message, res.status, 'AI_ERROR')
  }
  if (!res.body) throw new ApiError('AI 没有返回内容', 502)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      for (const line of part.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const json = JSON.parse(payload)
          const delta = json?.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta) onDelta(delta)
        } catch {
          /* 忽略不完整片段 */
        }
      }
    }
  }
}
