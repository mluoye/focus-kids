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
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
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
    throw new ApiError(data?.error ?? `请求失败（${res.status}）`, res.status, data?.code)
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

  aiStatus: () => request('/ai/status'),
  aiTest: () => request('/ai/test', { method: 'POST' }),
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
  feature: 'tutor' | 'encourage' | 'insight' | 'weekly-report',
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
