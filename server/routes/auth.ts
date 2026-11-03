import { Hono } from 'hono'
import { APP_VERSION, SCHEMA_VERSION } from '../../shared/constants'
import type { StoredSession } from '../store/types'
import {
  getFamilyCache, getFamilyByUsername, getFamilyById, countFamilies,
  createFamilyRecord, updateFamilyRecord,
  insertSession, deleteSessionByToken, revokeParentSessions,
  persistFamily,
} from '../db/store'
import { getDb } from '../db/index'
import { hashSecret, newId, newRecoveryCode, newToken, normalizeRecoveryCode, formatRecoveryCode, verifySecret } from '../security'
import { requireAuth, requireParent, type AppEnv } from '../middleware'
import { invalidJson, readJson } from '../json'

const PARENT_SESSION_MS = 30 * 24 * 3600 * 1000
const CHILD_SESSION_MS = 30 * 24 * 3600 * 1000
const UNLOCK_SESSION_MS = 15 * 60 * 1000

const USERNAME_MIN = 3
const USERNAME_MAX = 20
const PASSWORD_MIN = 6

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

export const authRoutes = new Hono<AppEnv>()

authRoutes.get('/bootstrap', (_c) => {
  return _c.json({
    hasFamily: countFamilies() > 0,
    version: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    serverTime: Date.now(),
  })
})

authRoutes.post('/register', async (c) => {
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const username = String(body.username ?? '').trim()
  const password = String(body.password ?? '')
  const nameErr = usernameError(username)
  if (nameErr) return c.json({ error: nameErr, code: 'INVALID_USERNAME' }, 400)
  const pwdErr = passwordError(password)
  if (pwdErr) return c.json({ error: pwdErr, code: 'WEAK_PASSWORD' }, 400)
  if (getFamilyByUsername(username)) {
    return c.json({ error: '这个用户名已被使用，请换一个', code: 'USERNAME_TAKEN' }, 409)
  }
  const recoveryCode = newRecoveryCode()
  const family: import('../store/types').FamilyRecord = {
    id: newId('fam'),
    username,
    passwordHash: hashSecret(password),
    recoveryHash: hashSecret(normalizeRecoveryCode(recoveryCode)),
    recoveryUpdatedAt: Date.now(),
    childPinLength: 4,
    createdAt: Date.now(),
  }
  createFamilyRecord(family)
  const session: StoredSession = {
    token: newToken(),
    familyId: family.id,
    role: 'parent',
    createdAt: Date.now(),
    expiresAt: Date.now() + PARENT_SESSION_MS,
  }
  insertSession(family.id, session)
  return c.json({
    token: session.token,
    role: 'parent',
    expiresAt: session.expiresAt,
    username,
    recoveryCode: formatRecoveryCode(recoveryCode),
  })
})

authRoutes.post('/login', async (c) => {
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const username = String(body.username ?? '').trim()
  const password = String(body.password ?? '')
  const family = getFamilyByUsername(username)
  if (!family || !verifySecret(password, family.passwordHash)) {
    return c.json({ error: '账号或密码不正确', code: 'INVALID_CREDENTIALS' }, 401)
  }
  const session: StoredSession = {
    token: newToken(),
    familyId: family.id,
    role: 'parent',
    createdAt: Date.now(),
    expiresAt: Date.now() + PARENT_SESSION_MS,
  }
  insertSession(family.id, session)
  return c.json({ token: session.token, role: 'parent', expiresAt: session.expiresAt })
})

authRoutes.post('/recover', async (c) => {
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const newPassword = String(body.newPassword ?? '')
  const pwdErr = passwordError(newPassword)
  if (pwdErr) return c.json({ error: pwdErr, code: 'WEAK_PASSWORD' }, 400)
  const code = normalizeRecoveryCode(String(body.recoveryCode ?? ''))
  // 恢复码不绑定用户名：遍历所有家庭匹配
  const db = getDb()
  const rows = db.prepare('SELECT id, username, recovery_hash FROM families WHERE recovery_hash IS NOT NULL').all() as { id: string; username: string; recovery_hash: string }[]
  const match = rows.find((r) => code.length >= 8 && verifySecret(code, r.recovery_hash))
  if (!match) {
    return c.json({ error: '恢复码不正确，或这个账号还没有设置恢复码', code: 'INVALID_RECOVERY_CODE' }, 401)
  }
  updateFamilyRecord(match.id, { passwordHash: hashSecret(newPassword) })
  const cache = getFamilyCache(match.id)
  cache.family.passwordHash = hashSecret(newPassword)
  revokeParentSessions(match.id)
  const session: StoredSession = {
    token: newToken(),
    familyId: match.id,
    role: 'parent',
    createdAt: Date.now(),
    expiresAt: Date.now() + PARENT_SESSION_MS,
  }
  insertSession(match.id, session)
  return c.json({
    token: session.token,
    role: 'parent',
    expiresAt: session.expiresAt,
    username: match.username,
  })
})

authRoutes.post('/parent/password', requireAuth, requireParent, async (c) => {
  const session = c.get('session')
  const familyId = c.get('familyId')
  const cache = getFamilyCache(familyId)
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const current = String(body.currentPassword ?? '')
  const next = String(body.newPassword ?? '')
  if (!verifySecret(current, cache.family.passwordHash)) {
    return c.json({ error: '当前密码不正确', code: 'INVALID_CREDENTIALS' }, 401)
  }
  const pwdErr = passwordError(next)
  if (pwdErr) return c.json({ error: pwdErr, code: 'WEAK_PASSWORD' }, 400)
  if (next === current) return c.json({ error: '新密码不能和当前密码相同', code: 'SAME_PASSWORD' }, 400)
  const newHash = hashSecret(next)
  cache.family.passwordHash = newHash
  updateFamilyRecord(familyId, { passwordHash: newHash })
  revokeParentSessions(familyId, session.token)
  return c.json({ ok: true })
})

authRoutes.post('/parent/username', requireAuth, requireParent, async (c) => {
  const familyId = c.get('familyId')
  const cache = getFamilyCache(familyId)
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const username = String(body.username ?? '').trim()
  if (!verifySecret(String(body.currentPassword ?? ''), cache.family.passwordHash)) {
    return c.json({ error: '当前密码不正确', code: 'INVALID_CREDENTIALS' }, 401)
  }
  const nameErr = usernameError(username)
  if (nameErr) return c.json({ error: nameErr, code: 'INVALID_USERNAME' }, 400)
  const existing = getFamilyByUsername(username)
  if (existing && existing.id !== familyId) {
    return c.json({ error: '这个用户名已被使用', code: 'USERNAME_TAKEN' }, 409)
  }
  cache.family.username = username
  updateFamilyRecord(familyId, { username })
  return c.json({ ok: true, username })
})

authRoutes.post('/parent/recovery', requireAuth, requireParent, async (c) => {
  const familyId = c.get('familyId')
  const cache = getFamilyCache(familyId)
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  if (!verifySecret(String(body.currentPassword ?? ''), cache.family.passwordHash)) {
    return c.json({ error: '当前密码不正确', code: 'INVALID_CREDENTIALS' }, 401)
  }
  const code = newRecoveryCode()
  const recoveryHash = hashSecret(normalizeRecoveryCode(code))
  const recoveryUpdatedAt = Date.now()
  cache.family.recoveryHash = recoveryHash
  cache.family.recoveryUpdatedAt = recoveryUpdatedAt
  updateFamilyRecord(familyId, { recoveryHash, recoveryUpdatedAt })
  return c.json({ recoveryCode: formatRecoveryCode(code), recoveryUpdatedAt })
})

authRoutes.post('/child/login', async (c) => {
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  // 按 profileId 在所有家庭中查找
  const db = getDb()
  const row = db.prepare('SELECT family_id FROM profiles WHERE id = ?').get(body.profileId) as { family_id: string } | undefined
  if (!row) return c.json({ error: '没有找到这个小朋友的档案', code: 'NO_PROFILE' }, 404)
  const cache = getFamilyCache(row.family_id)
  const profile = cache.profiles.find((p) => p.id === body.profileId)
  if (!profile || !verifySecret(String(body.pin ?? ''), profile.pinHash)) {
    return c.json({ error: 'PIN 码不对，再试一次吧', code: 'INVALID_PIN' }, 401)
  }
  const session: StoredSession = {
    token: newToken(),
    familyId: row.family_id,
    role: 'child',
    profileId: profile.id,
    createdAt: Date.now(),
    expiresAt: Date.now() + CHILD_SESSION_MS,
  }
  insertSession(row.family_id, session)
  return c.json({ token: session.token, role: 'child', profileId: profile.id, expiresAt: session.expiresAt })
})

authRoutes.post('/parent/verify', async (c) => {
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const password = String(body.password ?? '')
  // 按密码遍历所有家庭（NAS 场景家庭数少，可接受）
  const db = getDb()
  const rows = db.prepare('SELECT id, password_hash FROM families').all() as { id: string; password_hash: string }[]
  const match = rows.find((r) => verifySecret(password, r.password_hash))
  if (!match) {
    return c.json({ error: '家长密码不正确', code: 'INVALID_CREDENTIALS' }, 401)
  }
  const session: StoredSession = {
    token: newToken(),
    familyId: match.id,
    role: 'parent',
    createdAt: Date.now(),
    expiresAt: Date.now() + UNLOCK_SESSION_MS,
  }
  insertSession(match.id, session)
  return c.json({ token: session.token, role: 'parent', expiresAt: session.expiresAt, temporary: true })
})

authRoutes.post('/parent/check', async (c) => {
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const db = getDb()
  const rows = db.prepare('SELECT id, password_hash FROM families').all() as { id: string; password_hash: string }[]
  const match = rows.find((r) => verifySecret(String(body.password ?? ''), r.password_hash))
  if (!match) {
    return c.json({ error: '家长密码不正确', code: 'INVALID_CREDENTIALS' }, 401)
  }
  return c.json({ ok: true })
})

authRoutes.get('/me', requireAuth, (c) => {
  const session = c.get('session')
  const familyId = c.get('familyId')
  const cache = getFamilyCache(familyId)
  const profile = session.profileId ? cache.profiles.find((p) => p.id === session.profileId) : null
  return c.json({
    role: session.role,
    expiresAt: session.expiresAt,
    profile: profile ? { id: profile.id, name: profile.name, avatar: profile.avatar, points: profile.points } : null,
    family: {
      username: cache.family.username,
      hasRecoveryCode: !!cache.family.recoveryHash,
      recoveryUpdatedAt: cache.family.recoveryUpdatedAt ?? null,
    },
  })
})

authRoutes.post('/logout', requireAuth, async (c) => {
  const token = c.get('session').token
  deleteSessionByToken(token)
  return c.json({ ok: true })
})
