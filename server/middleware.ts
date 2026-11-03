import { createMiddleware } from 'hono/factory'
import { findSessionByToken, getFamilyCache, type FamilyCache } from './db/store'
import type { StoredSession } from './store/types'

export type AppEnv = {
  Variables: {
    session: StoredSession
    familyId: string
    cache: FamilyCache
  }
}

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) return c.json({ error: '请先登录', code: 'UNAUTHORIZED' }, 401)
  const found = findSessionByToken(token)
  if (!found) return c.json({ error: '登录已过期，请重新登录', code: 'UNAUTHORIZED' }, 401)
  const cache = getFamilyCacheSafe(found.familyId)
  if (!cache) return c.json({ error: '家庭数据不存在', code: 'UNAUTHORIZED' }, 401)
  c.set('session', found.session)
  c.set('familyId', found.familyId)
  c.set('cache', cache)
  await next()
})

export const requireParent = createMiddleware<AppEnv>(async (c, next) => {
  const session = c.get('session')
  if (!session || session.role !== 'parent') {
    return c.json({ error: '需要家长身份', code: 'FORBIDDEN' }, 403)
  }
  await next()
})

function getFamilyCacheSafe(familyId: string): FamilyCache | null {
  try {
    return getFamilyCache(familyId)
  } catch {
    return null
  }
}

const buckets = new Map<string, { count: number; resetAt: number }>()

/** 认证类接口的轻量限流：同一 IP 每分钟最多 15 次尝试。 */
export const authRateLimit = createMiddleware(async (c, next) => {
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'local'
  const now = Date.now()
  const bucket = buckets.get(ip)
  if (!bucket || bucket.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + 60_000 })
  } else {
    bucket.count += 1
    if (bucket.count > 15) {
      return c.json({ error: '尝试次数太多，请一分钟后再试', code: 'RATE_LIMITED' }, 429)
    }
  }
  if (buckets.size > 5000) {
    for (const [key, value] of buckets) if (value.resetAt < now) buckets.delete(key)
  }
  await next()
})
