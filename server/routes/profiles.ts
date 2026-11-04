import { Hono } from 'hono'
import { AVATARS } from '../../shared/constants'
import { getFamilyCache, persistFamily, countFamilies } from '../db/store'
import { getDb } from '../db'
import { hashSecret, newId } from '../security'
import { requireAuth, requireParent, type AppEnv } from '../middleware'
import { recomputePoints } from '../awards'
import { invalidJson, readJson } from '../json'
import type { ProfileRecord } from '../store/types'

export const profileRoutes = new Hono<AppEnv>()

/** 孩子登录选择页：单家庭时公开（孩子可独立登录），多家庭时需家长登录以限定家庭。 */
profileRoutes.get('/picker', async (c) => {
  // 单家庭 NAS 是主要部署形态：孩子单独打开应用就能选自己的头像。
  // 多家庭时孩子列表不能公开（会跨家庭枚举），必须家长先登录确定家庭。
  if (countFamilies() > 1) {
    const denied = await requireAuth(c, async () => undefined)
    if (denied) return denied
  }
  const db = getDb()
  const familyId =
    countFamilies() > 1
      ? c.get('familyId')
      : (db.prepare('SELECT id FROM families ORDER BY created_at LIMIT 1').get() as { id: string } | undefined)?.id
  if (!familyId) return c.json({ hasFamily: false, profiles: [], avatars: AVATARS })
  const cache = getFamilyCache(familyId)
  return c.json({
    hasFamily: true,
    profiles: cache.profiles.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar })),
    avatars: AVATARS,
  })
})

profileRoutes.post('/', requireAuth, requireParent, async (c) => {
  const familyId = c.get('familyId')
  const cache = getFamilyCache(familyId)
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const name = String(body.name ?? '').trim()
  const pin = String(body.pin ?? '').trim()
  if (name.length < 1 || name.length > 12) return c.json({ error: '昵称需为 1~12 个字符', code: 'INVALID_NAME' }, 400)
  if (!/^\d{4}$/.test(pin)) return c.json({ error: 'PIN 必须是 4 位数字', code: 'INVALID_PIN' }, 400)
  if (cache.profiles.length >= 8) return c.json({ error: '最多创建 8 个孩子档案', code: 'TOO_MANY_PROFILES' }, 400)
  const profile: ProfileRecord = {
    id: newId('kid'),
    name,
    avatar: AVATARS.includes(body.avatar) ? String(body.avatar) : AVATARS[0],
    pinHash: hashSecret(pin),
    createdAt: Date.now(),
    points: 0,
    badges: [],
  }
  cache.profiles.push(profile)
  persistFamily(familyId)
  return c.json({ id: profile.id, name: profile.name, avatar: profile.avatar, points: 0, badges: [] }, 201)
})

profileRoutes.patch('/:id', requireAuth, requireParent, async (c) => {
  const familyId = c.get('familyId')
  const cache = getFamilyCache(familyId)
  const profile = cache.profiles.find((p) => p.id === c.req.param('id'))
  if (!profile) return c.json({ error: '档案不存在', code: 'NOT_FOUND' }, 404)
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (name.length < 1 || name.length > 12) return c.json({ error: '昵称需为 1~12 个字符', code: 'INVALID_NAME' }, 400)
    profile.name = name
  }
  if (typeof body.avatar === 'string' && AVATARS.includes(body.avatar)) profile.avatar = body.avatar
  if (typeof body.pin === 'string' && body.pin) {
    if (!/^\d{4}$/.test(body.pin)) return c.json({ error: 'PIN 必须是 4 位数字', code: 'INVALID_PIN' }, 400)
    profile.pinHash = hashSecret(body.pin)
  }
  if (body.arithmeticMode === 'choice' || body.arithmeticMode === 'keypad') {
    profile.arithmeticMode = body.arithmeticMode
  }
  if (body.arithmeticDifficulty === 2 || body.arithmeticDifficulty === 3) {
    profile.arithmeticDifficulty = body.arithmeticDifficulty
  } else if (body.arithmeticDifficulty === 1) {
    profile.arithmeticDifficulty = 1
  }
  if (body.storymathGrade >= 1 && body.storymathGrade <= 6) {
    profile.storymathGrade = body.storymathGrade
  }
  if (body.storymathTerm === 1 || body.storymathTerm === 2) {
    profile.storymathTerm = body.storymathTerm
  }
  if (typeof body.storymathUnit === 'number' && Number.isInteger(body.storymathUnit) && body.storymathUnit >= 1) {
    profile.storymathUnit = body.storymathUnit
  } else if (body.storymathUnit === 'fun') {
    profile.storymathUnit = 'fun'
  }
  persistFamily(familyId)
  return c.json({
    id: profile.id,
    name: profile.name,
    avatar: profile.avatar,
    points: profile.points,
    badges: profile.badges,
    arithmeticMode: profile.arithmeticMode ?? 'choice',
    arithmeticDifficulty: profile.arithmeticDifficulty ?? 1,
    storymathGrade: profile.storymathGrade ?? 1,
    storymathTerm: profile.storymathTerm ?? 1,
    storymathUnit: profile.storymathUnit ?? 1,
  })
})

profileRoutes.delete('/:id', requireAuth, requireParent, async (c) => {
  const familyId = c.get('familyId')
  const cache = getFamilyCache(familyId)
  const id = c.req.param('id')
  if (!cache.profiles.some((p) => p.id === id)) return c.json({ error: '档案不存在', code: 'NOT_FOUND' }, 404)
  cache.profiles = cache.profiles.filter((p) => p.id !== id)
  cache.records = cache.records.filter((r) => r.profileId !== id)
  cache.homework = cache.homework.filter((h) => h.profileId !== id)
  cache.homeworkPlans = cache.homeworkPlans.filter((p) => p.profileId !== id)
  cache.sessions = cache.sessions.filter((s) => s.profileId !== id)
  recomputePoints(cache)
  persistFamily(familyId)
  return c.json({ ok: true })
})
