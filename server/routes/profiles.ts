import { Hono } from 'hono'
import { AVATARS } from '../../shared/constants'
import { getState, saveState } from '../store'
import { hashSecret, newId } from '../security'
import { requireAuth, requireParent, type AppEnv } from '../middleware'
import { recomputePoints } from '../awards'
import { invalidJson, readJson } from '../json'

export const profileRoutes = new Hono<AppEnv>()

/** 孩子登录选择页使用的公开信息，不含任何口令。 */
profileRoutes.get('/picker', (c) => {
  const state = getState()
  return c.json({
    hasFamily: !!state.family,
    profiles: state.profiles.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar })),
    avatars: AVATARS,
  })
})

profileRoutes.post('/', requireAuth, requireParent, async (c) => {
  const state = getState()
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const name = String(body.name ?? '').trim()
  const pin = String(body.pin ?? '').trim()
  if (name.length < 1 || name.length > 12) return c.json({ error: '昵称需为 1~12 个字符', code: 'INVALID_NAME' }, 400)
  if (!/^\d{4}$/.test(pin)) return c.json({ error: 'PIN 必须是 4 位数字', code: 'INVALID_PIN' }, 400)
  if (state.profiles.length >= 8) return c.json({ error: '最多创建 8 个孩子档案', code: 'TOO_MANY_PROFILES' }, 400)
  const profile = {
    id: newId('kid'),
    name,
    avatar: AVATARS.includes(body.avatar) ? String(body.avatar) : AVATARS[0],
    pinHash: hashSecret(pin),
    createdAt: Date.now(),
    points: 0,
    badges: [],
  }
  state.profiles.push(profile)
  await saveState()
  return c.json({ id: profile.id, name: profile.name, avatar: profile.avatar, points: 0, badges: [] }, 201)
})

profileRoutes.patch('/:id', requireAuth, requireParent, async (c) => {
  const state = getState()
  const profile = state.profiles.find((p) => p.id === c.req.param('id'))
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
  await saveState()
  return c.json({ id: profile.id, name: profile.name, avatar: profile.avatar, points: profile.points, badges: profile.badges })
})

profileRoutes.delete('/:id', requireAuth, requireParent, async (c) => {
  const state = getState()
  const id = c.req.param('id')
  if (!state.profiles.some((p) => p.id === id)) return c.json({ error: '档案不存在', code: 'NOT_FOUND' }, 404)
  state.profiles = state.profiles.filter((p) => p.id !== id)
  state.records = state.records.filter((r) => r.profileId !== id)
  state.homework = state.homework.filter((h) => h.profileId !== id)
  state.sessions = state.sessions.filter((s) => s.profileId !== id)
  recomputePoints(state)
  await saveState()
  return c.json({ ok: true })
})
