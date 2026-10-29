import { Hono } from 'hono'
import { APP_VERSION, SCHEMA_VERSION } from '../../shared/constants'
import { getState, saveState, type StoredSession } from '../store'
import { hashSecret, newId, newToken, verifySecret } from '../security'
import { requireAuth, type AppEnv } from '../middleware'
import { invalidJson, readJson } from '../json'

const PARENT_SESSION_MS = 30 * 24 * 3600 * 1000
const CHILD_SESSION_MS = 30 * 24 * 3600 * 1000
const UNLOCK_SESSION_MS = 15 * 60 * 1000

function issueSession(session: StoredSession) {
  const state = getState()
  state.sessions = state.sessions.filter((s) => s.expiresAt > Date.now())
  state.sessions.push(session)
  return session
}

export const authRoutes = new Hono<AppEnv>()

authRoutes.get('/bootstrap', (c) => {
  const state = getState()
  return c.json({
    hasFamily: !!state.family,
    version: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    serverTime: Date.now(),
  })
})

authRoutes.post('/register', async (c) => {
  const state = getState()
  if (state.family) return c.json({ error: '这台服务器已经创建过家庭账号了', code: 'FAMILY_EXISTS' }, 409)
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const username = String(body.username ?? '').trim()
  const password = String(body.password ?? '')
  if (username.length < 3 || username.length > 20) {
    return c.json({ error: '家长账号需 3~20 个字符', code: 'INVALID_USERNAME' }, 400)
  }
  if (password.length < 6) {
    return c.json({ error: '密码至少 6 位', code: 'WEAK_PASSWORD' }, 400)
  }
  state.family = {
    id: newId('fam'),
    username,
    passwordHash: hashSecret(password),
    childPinLength: 4,
    createdAt: Date.now(),
  }
  await saveState()
  const session = issueSession({
    token: newToken(),
    role: 'parent',
    createdAt: Date.now(),
    expiresAt: Date.now() + PARENT_SESSION_MS,
  })
  await saveState()
  return c.json({ token: session.token, role: 'parent', expiresAt: session.expiresAt })
})

authRoutes.post('/login', async (c) => {
  const state = getState()
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const username = String(body.username ?? '').trim()
  const password = String(body.password ?? '')
  if (!state.family || state.family.username !== username || !verifySecret(password, state.family.passwordHash)) {
    return c.json({ error: '账号或密码不正确', code: 'INVALID_CREDENTIALS' }, 401)
  }
  const session = issueSession({
    token: newToken(),
    role: 'parent',
    createdAt: Date.now(),
    expiresAt: Date.now() + PARENT_SESSION_MS,
  })
  await saveState()
  return c.json({ token: session.token, role: 'parent', expiresAt: session.expiresAt })
})

authRoutes.post('/child/login', async (c) => {
  const state = getState()
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const profile = state.profiles.find((p) => p.id === body.profileId)
  if (!profile) return c.json({ error: '没有找到这个小朋友的档案', code: 'NO_PROFILE' }, 404)
  if (!verifySecret(String(body.pin ?? ''), profile.pinHash)) {
    return c.json({ error: 'PIN 码不对，再试一次吧', code: 'INVALID_PIN' }, 401)
  }
  const session = issueSession({
    token: newToken(),
    role: 'child',
    profileId: profile.id,
    createdAt: Date.now(),
    expiresAt: Date.now() + CHILD_SESSION_MS,
  })
  await saveState()
  return c.json({ token: session.token, role: 'child', profileId: profile.id, expiresAt: session.expiresAt })
})

/** 家长在孩子的设备上临时解锁家长中心（15 分钟）。 */
authRoutes.post('/parent/verify', async (c) => {
  const state = getState()
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const password = String(body.password ?? '')
  if (!state.family || !verifySecret(password, state.family.passwordHash)) {
    return c.json({ error: '家长密码不正确', code: 'INVALID_CREDENTIALS' }, 401)
  }
  const session = issueSession({
    token: newToken(),
    role: 'parent',
    createdAt: Date.now(),
    expiresAt: Date.now() + UNLOCK_SESSION_MS,
  })
  await saveState()
  return c.json({ token: session.token, role: 'parent', expiresAt: session.expiresAt, temporary: true })
})

/** 只校验家长密码，不签发会话（用于“放行休息”等轻量场景）。 */
authRoutes.post('/parent/check', async (c) => {
  const state = getState()
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  if (!state.family || !verifySecret(String(body.password ?? ''), state.family.passwordHash)) {
    return c.json({ error: '家长密码不正确', code: 'INVALID_CREDENTIALS' }, 401)
  }
  return c.json({ ok: true })
})

authRoutes.get('/me', requireAuth, (c) => {
  const session = c.get('session')
  const state = getState()
  const profile = session.profileId ? state.profiles.find((p) => p.id === session.profileId) : null
  return c.json({
    role: session.role,
    expiresAt: session.expiresAt,
    profile: profile ? { id: profile.id, name: profile.name, avatar: profile.avatar, points: profile.points } : null,
    family: state.family ? { username: state.family.username } : null,
  })
})

authRoutes.post('/logout', requireAuth, async (c) => {
  const token = c.get('session').token
  const state = getState()
  state.sessions = state.sessions.filter((s) => s.token !== token)
  await saveState()
  return c.json({ ok: true })
})
