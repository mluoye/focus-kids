import { Hono } from 'hono'
import { APP_VERSION, SCHEMA_VERSION } from '../../shared/constants'
import { getState, saveState, type StoredSession } from '../store'
import { hashSecret, newId, newRecoveryCode, newToken, normalizeRecoveryCode, formatRecoveryCode, verifySecret } from '../security'
import { requireAuth, requireParent, type AppEnv } from '../middleware'
import { invalidJson, readJson } from '../json'

const PARENT_SESSION_MS = 30 * 24 * 3600 * 1000
const CHILD_SESSION_MS = 30 * 24 * 3600 * 1000
const UNLOCK_SESSION_MS = 15 * 60 * 1000

const USERNAME_MIN = 3
const USERNAME_MAX = 20
const PASSWORD_MIN = 6

/** 踢掉家长会话；传入 token 时保留当前设备。孩子端会话不受影响。 */
function revokeParentSessions(exceptToken?: string) {
  const state = getState()
  state.sessions = state.sessions.filter((s) => s.role !== 'parent' || (!!exceptToken && s.token === exceptToken))
}

function usernameError(username: string): string | null {
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return `家长账号需 ${USERNAME_MIN}~${USERNAME_MAX} 个字符`
  }
  return null
}

function passwordError(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `密码至少 ${PASSWORD_MIN} 位`
  return null
}

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
  const nameErr = usernameError(username)
  if (nameErr) return c.json({ error: nameErr, code: 'INVALID_USERNAME' }, 400)
  const pwdErr = passwordError(password)
  if (pwdErr) return c.json({ error: pwdErr, code: 'WEAK_PASSWORD' }, 400)
  const recoveryCode = newRecoveryCode()
  state.family = {
    id: newId('fam'),
    username,
    passwordHash: hashSecret(password),
    recoveryHash: hashSecret(normalizeRecoveryCode(recoveryCode)),
    recoveryUpdatedAt: Date.now(),
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
  // recoveryCode 只在创建账号时返回一次；服务端只存哈希，之后无法再查看
  return c.json({
    token: session.token,
    role: 'parent',
    expiresAt: session.expiresAt,
    username,
    recoveryCode: formatRecoveryCode(recoveryCode),
  })
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

/**
 * 忘记密码：凭恢复码重置。
 *
 * - 恢复码不绑定账号名：账号名也忘了照样能重置。
 * - 成功后恢复码保持不变，家长可在「账号」页自行重新生成（0.4.0 决策）。
 * - 所有家长会话立即失效，孩子端会话保留。
 */
authRoutes.post('/recover', async (c) => {
  const state = getState()
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const newPassword = String(body.newPassword ?? '')
  const pwdErr = passwordError(newPassword)
  if (pwdErr) return c.json({ error: pwdErr, code: 'WEAK_PASSWORD' }, 400)
  const code = normalizeRecoveryCode(String(body.recoveryCode ?? ''))
  const family = state.family
  if (!family || !family.recoveryHash || code.length < 8 || !verifySecret(code, family.recoveryHash)) {
    return c.json(
      { error: '恢复码不正确，或这个账号还没有设置恢复码', code: 'INVALID_RECOVERY_CODE' },
      401,
    )
  }
  family.passwordHash = hashSecret(newPassword)
  revokeParentSessions()
  const session = issueSession({
    token: newToken(),
    role: 'parent',
    createdAt: Date.now(),
    expiresAt: Date.now() + PARENT_SESSION_MS,
  })
  await saveState()
  return c.json({
    token: session.token,
    role: 'parent',
    expiresAt: session.expiresAt,
    username: family.username,
  })
})

/** 修改密码：需要当前密码；其他家长设备下线，当前设备保持登录。 */
authRoutes.post('/parent/password', requireAuth, requireParent, async (c) => {
  const state = getState()
  const session = c.get('session')
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const current = String(body.currentPassword ?? '')
  const next = String(body.newPassword ?? '')
  if (!state.family || !verifySecret(current, state.family.passwordHash)) {
    return c.json({ error: '当前密码不正确', code: 'INVALID_CREDENTIALS' }, 401)
  }
  const pwdErr = passwordError(next)
  if (pwdErr) return c.json({ error: pwdErr, code: 'WEAK_PASSWORD' }, 400)
  if (next === current) return c.json({ error: '新密码不能和当前密码相同', code: 'SAME_PASSWORD' }, 400)
  state.family.passwordHash = hashSecret(next)
  revokeParentSessions(session.token)
  await saveState()
  return c.json({ ok: true })
})

/** 修改家长账号名：需要当前密码；改完用新账号名登录。 */
authRoutes.post('/parent/username', requireAuth, requireParent, async (c) => {
  const state = getState()
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const username = String(body.username ?? '').trim()
  if (!state.family || !verifySecret(String(body.currentPassword ?? ''), state.family.passwordHash)) {
    return c.json({ error: '当前密码不正确', code: 'INVALID_CREDENTIALS' }, 401)
  }
  const nameErr = usernameError(username)
  if (nameErr) return c.json({ error: nameErr, code: 'INVALID_USERNAME' }, 400)
  state.family.username = username
  await saveState()
  return c.json({ ok: true, username })
})

/** 重新生成恢复码：需要当前密码；旧码立即失效，新码只返回这一次。 */
authRoutes.post('/parent/recovery', requireAuth, requireParent, async (c) => {
  const state = getState()
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  if (!state.family || !verifySecret(String(body.currentPassword ?? ''), state.family.passwordHash)) {
    return c.json({ error: '当前密码不正确', code: 'INVALID_CREDENTIALS' }, 401)
  }
  const code = newRecoveryCode()
  state.family.recoveryHash = hashSecret(normalizeRecoveryCode(code))
  state.family.recoveryUpdatedAt = Date.now()
  await saveState()
  return c.json({ recoveryCode: formatRecoveryCode(code), recoveryUpdatedAt: state.family.recoveryUpdatedAt })
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
    family: state.family
      ? {
          username: state.family.username,
          hasRecoveryCode: !!state.family.recoveryHash,
          recoveryUpdatedAt: state.family.recoveryUpdatedAt ?? null,
        }
      : null,
  })
})

authRoutes.post('/logout', requireAuth, async (c) => {
  const token = c.get('session').token
  const state = getState()
  state.sessions = state.sessions.filter((s) => s.token !== token)
  await saveState()
  return c.json({ ok: true })
})
