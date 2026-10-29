import type { Context } from 'hono'

/**
 * 读取 JSON 请求体。
 *
 * 返回 `null` 表示请求体不是合法的 JSON 对象，调用方必须返回 400。
 * 不能退化成 `{}`：否则畸形请求会被当成「空操作」返回 200，
 * 客户端据此清空离线队列，等于静默丢数据。
 * 空请求体仍然返回 `{}`，兼容无 body 的 POST。
 */
export async function readJson(c: Context): Promise<Record<string, any> | null> {
  let text = ''
  try {
    text = await c.req.text()
  } catch {
    return null
  }
  if (!text.trim()) return {}
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, any>
  } catch {
    return null
  }
}

export function invalidJson(c: Context) {
  return c.json({ error: '请求体不是合法的 JSON 对象', code: 'INVALID_JSON' }, 400)
}
