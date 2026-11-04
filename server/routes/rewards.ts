import { Hono } from 'hono'
import { getDb } from '../db'
import { getFamilyCache, persistFamily } from '../db/store'
import { requireAuth, requireParent, type AppEnv } from '../middleware'
import { newId } from '../security'
import { readJson, invalidJson } from '../json'
import { availablePoints, recomputePoints, streakDays } from '../awards'
import type { ProfileRecord } from '../store/types'
import type { TrainingRecord } from '../../shared/types'

export const rewardRoutes = new Hono<AppEnv>()

/** 某孩子某条件类型的当前进度（服务端权威，客户端不可信）。 */
function conditionProgress(
  profile: ProfileRecord,
  records: TrainingRecord[],
  conditionType: string,
): number {
  switch (conditionType) {
    case 'training_count':
      return records.length
    case 'streak_days':
      return streakDays(records)
    case 'points':
      return availablePoints(profile, records)
    default:
      return 0
  }
}

/** 生成随机兑换码（8位大写字母+数字） */
function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

// 创建奖励（家长）
rewardRoutes.post('/', requireAuth, requireParent, async (c) => {
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const familyId = c.get('familyId')

  const db = getDb()
  const now = Date.now()
  const id = newId('reward')

  db.prepare(`
    INSERT INTO rewards (id, family_id, profile_id, name, description, emoji, condition_type, condition_value, requires_approval, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    familyId,
    body.profileId,
    body.name,
    body.description ?? '',
    body.emoji ?? '🎁',
    body.conditionType ?? 'manual',
    body.conditionValue ?? 0,
    body.requiresApproval ? 1 : 0,
    now,
    now,
  )

  return c.json({ ok: true, id })
})

// 获取奖励列表（家长/孩子）
rewardRoutes.get('/', requireAuth, (c) => {
  const familyId = c.get('familyId')
  const db = getDb()

  const rewards = db.prepare(`
    SELECT * FROM rewards WHERE family_id = ?
  `).all(familyId)

  return c.json({ rewards })
})

// 更新奖励（家长）
rewardRoutes.patch('/:id', requireAuth, requireParent, async (c) => {
  const id = c.req.param('id')
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const familyId = c.get('familyId')

  const db = getDb()
  const now = Date.now()

  db.prepare(`
    UPDATE rewards SET
      name = ?, description = ?, emoji = ?,
      condition_type = ?, condition_value = ?,
      requires_approval = ?, updated_at = ?
    WHERE id = ? AND family_id = ?
  `).run(
    body.name,
    body.description ?? '',
    body.emoji ?? '🎁',
    body.conditionType ?? 'manual',
    body.conditionValue ?? 0,
    body.requiresApproval ? 1 : 0,
    now,
    id,
    familyId,
  )

  return c.json({ ok: true })
})

// 删除奖励（家长）
rewardRoutes.delete('/:id', requireAuth, requireParent, (c) => {
  const id = c.req.param('id')
  const familyId = c.get('familyId')
  const db = getDb()

  db.prepare('DELETE FROM rewards WHERE id = ? AND family_id = ?').run(id, familyId)

  return c.json({ ok: true })
})

// 领取奖励（孩子）——服务端权威校验达成条件，points 类扣除积分
rewardRoutes.post('/:id/claim', requireAuth, (c) => {
  const id = c.req.param('id')
  const familyId = c.get('familyId')
  const session = c.get('session')
  if (session.role !== 'child') {
    return c.json({ error: '孩子身份才能领取奖励' }, 403)
  }
  const profileId = session.profileId
  if (!profileId) return c.json({ error: '缺少 profileId' }, 400)

  const db = getDb()
  const cache = getFamilyCache(familyId)
  const now = Date.now()

  const reward = db.prepare('SELECT * FROM rewards WHERE id = ? AND family_id = ?').get(id, familyId) as any
  if (!reward) return c.json({ error: '奖励不存在' }, 404)
  if (reward.profile_id !== profileId) return c.json({ error: '这个奖励不是给你的' }, 403)

  // 已领取过（被拒的可重试）
  const existing = db.prepare(`
    SELECT id FROM reward_claims
    WHERE reward_id = ? AND profile_id = ? AND status != 'rejected'
  `).get(id, profileId)
  if (existing) return c.json({ error: '已经领取过了' }, 400)

  const profile = cache.profiles.find((p) => p.id === profileId)
  if (!profile) return c.json({ error: '孩子档案不存在' }, 400)
  const records = cache.records.filter((r) => r.profileId === profileId)

  const conditionType = String(reward.condition_type)
  const isManual = conditionType === 'manual'

  // manual 类没有客观条件，必须经家长审批，避免孩子自助领取
  const needsApproval = reward.requires_approval === 1 || isManual

  // 客观条件：服务端校验是否达成
  let progress = 0
  if (!isManual) {
    progress = conditionProgress(profile, records, conditionType)
    if (progress < Number(reward.condition_value)) {
      return c.json(
        { error: '还没达成目标，继续加油！', code: 'NOT_ACHIEVED', progress, target: Number(reward.condition_value) },
        400,
      )
    }
  }

  // points 类：领取即扣除积分（被拒时退回）
  const pointsCost = conditionType === 'points' ? Number(reward.condition_value) : 0
  if (pointsCost > 0) {
    profile.pointsSpent = (profile.pointsSpent ?? 0) + pointsCost
    recomputePoints(cache)
  }

  const claimId = newId('claim')
  const status = needsApproval ? 'pending' : 'approved'

  db.prepare(`
    INSERT INTO reward_claims (id, family_id, reward_id, profile_id, status, claimed_at, approved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    claimId,
    familyId,
    id,
    profileId,
    status,
    now,
    needsApproval ? null : now,
  )
  persistFamily(familyId)

  return c.json({
    ok: true,
    claimId,
    status,
    requiresApproval: needsApproval,
    pointsSpent: pointsCost,
    availablePoints: profile.points,
  })
})

// 审批奖励领取（家长）——拒绝 points 类奖励时退回已扣积分
rewardRoutes.post('/claims/:id/approve', requireAuth, requireParent, async (c) => {
  const id = c.req.param('id')
  const familyId = c.get('familyId')
  const body = await readJson(c)
  if (!body) return invalidJson(c)

  const db = getDb()
  const now = Date.now()
  const approved = body.approved !== false
  const status = approved ? 'approved' : 'rejected'

  const claim = db.prepare('SELECT * FROM reward_claims WHERE id = ? AND family_id = ?').get(id, familyId) as any
  if (!claim) return c.json({ error: '领取记录不存在' }, 404)
  if (claim.status !== 'pending') return c.json({ error: '该领取请求已处理' }, 400)

  db.prepare(`
    UPDATE reward_claims SET
      status = ?, approved_at = ?, approved_by = ?, note = ?
    WHERE id = ? AND family_id = ?
  `).run(
    status,
    now,
    'parent',
    body.note ?? '',
    id,
    familyId,
  )

  let refunded = 0
  if (!approved) {
    const reward = db.prepare('SELECT * FROM rewards WHERE id = ?').get(claim.reward_id) as any
    if (reward && String(reward.condition_type) === 'points') {
      const cost = Number(reward.condition_value)
      if (cost > 0) {
        const cache = getFamilyCache(familyId)
        const profile = cache.profiles.find((p) => p.id === claim.profile_id)
        if (profile) {
          profile.pointsSpent = Math.max(0, (profile.pointsSpent ?? 0) - cost)
          recomputePoints(cache)
          refunded = cost
          persistFamily(familyId)
        }
      }
    }
  }

  return c.json({ ok: true, status, refunded })
})

// 获取某孩子的条件进度（供前端展示达成进度条）
rewardRoutes.get('/progress/:profileId', requireAuth, (c) => {
  const familyId = c.get('familyId')
  const profileId = c.req.param('profileId')
  const cache = getFamilyCache(familyId)
  const profile = cache.profiles.find((p) => p.id === profileId)
  if (!profile) return c.json({ error: '孩子档案不存在' }, 404)
  const records = cache.records.filter((r) => r.profileId === profileId)
  return c.json({
    profileId,
    trainingCount: records.length,
    streakDays: streakDays(records),
    availablePoints: availablePoints(profile, records),
  })
})

// 获取领取记录列表
rewardRoutes.get('/claims', requireAuth, (c) => {
  const familyId = c.get('familyId')
  const db = getDb()

  const claims = db.prepare(`
    SELECT rc.*, r.name, r.emoji, r.description
    FROM reward_claims rc
    JOIN rewards r ON rc.reward_id = r.id
    WHERE rc.family_id = ?
    ORDER BY rc.claimed_at DESC
  `).all(familyId)

  return c.json({ claims })
})

// 生成兑换码（家长）
rewardRoutes.post('/codes', requireAuth, requireParent, async (c) => {
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const familyId = c.get('familyId')

  const db = getDb()
  const now = Date.now()
  const id = newId('code')
  const code = generateCode()

  db.prepare(`
    INSERT INTO reward_codes (id, family_id, code, reward_name, reward_desc, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    familyId,
    code,
    body.rewardName,
    body.rewardDesc ?? '',
    now,
  )

  return c.json({ ok: true, code })
})

// 使用兑换码（孩子）
rewardRoutes.post('/codes/redeem', requireAuth, async (c) => {
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const familyId = c.get('familyId')
  const session = c.get('session')
  if (session.role !== 'child') {
    return c.json({ error: '孩子身份才能使用兑换码' }, 403)
  }
  const profileId = session.profileId

  const db = getDb()
  const now = Date.now()

  // 查找兑换码
  const code = db.prepare(`
    SELECT * FROM reward_codes
    WHERE code = ? AND family_id = ? AND used_at IS NULL
  `).get(body.code, familyId) as any

  if (!code) return c.json({ error: '兑换码无效或已被使用' }, 400)

  // 标记兑换码已使用
  db.prepare(`
    UPDATE reward_codes SET used_at = ?, used_by = ?
    WHERE id = ?
  `).run(now, profileId, code.id)

  return c.json({
    ok: true,
    rewardName: code.reward_name,
    rewardDesc: code.reward_desc,
  })
})

// 获取兑换码列表（家长）
rewardRoutes.get('/codes', requireAuth, requireParent, (c) => {
  const familyId = c.get('familyId')
  const db = getDb()

  const codes = db.prepare(`
    SELECT * FROM reward_codes WHERE family_id = ? ORDER BY created_at DESC
  `).all(familyId)

  return c.json({ codes })
})
