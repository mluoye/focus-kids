import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

/**
 * 回归：奖励接口必须同时挂 requireAuth + requireParent。
 *
 * 历史 bug：6 条家长路由只挂了 requireParent，而 requireParent 只读
 * requireAuth 写入的 session，导致这些接口无论带什么 token 都恒返 403。
 * 这里用纯内存 SQLite 跑真实 SQL 与中间件，不调用 initDb()——
 * initDb 会触发 migrateFromJson 去碰真实的 .data/app-state.json。
 */
vi.mock('../db', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { createTables } = await import('../db/schema')
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  createTables(db)
  return { getDb: () => db, initDb: () => db, closeDb: () => db.close() }
})

const FAMILY_ID = 'fam_test'
const KID_ID = 'kid1'
const PARENT_TOKEN = 'tok_parent'
const CHILD_TOKEN = 'tok_child'

async function db() {
  const { getDb } = await import('../db')
  return getDb()
}

beforeAll(async () => {
  const database = await db()
  const now = Date.now()
  database
    .prepare(
      'INSERT INTO families (id, username, password_hash, child_pin_length, created_at, updated_at) VALUES (?, ?, ?, 4, ?, ?)',
    )
    .run(FAMILY_ID, 'tester', 'x', now, now)
  database
    .prepare(
      "INSERT INTO profiles (id, family_id, name, avatar, pin_hash, created_at, updated_at) VALUES (?, ?, '测试娃', '🦊', 'x', ?, ?)",
    )
    .run(KID_ID, FAMILY_ID, now, now)
  database
    .prepare(
      "INSERT INTO sessions (token, family_id, profile_id, role, created_at, expires_at) VALUES (?, ?, NULL, 'parent', ?, ?)",
    )
    .run(PARENT_TOKEN, FAMILY_ID, now, now + 60_000)
  database
    .prepare(
      "INSERT INTO sessions (token, family_id, profile_id, role, created_at, expires_at) VALUES (?, ?, ?, 'child', ?, ?)",
    )
    .run(CHILD_TOKEN, FAMILY_ID, KID_ID, now, now + 60_000)
})

beforeEach(async () => {
  const database = await db()
  database.prepare('DELETE FROM reward_claims').run()
  database.prepare('DELETE FROM reward_codes').run()
  database.prepare('DELETE FROM rewards').run()
})

afterAll(async () => {
  const { closeDb } = await import('../db')
  closeDb()
})

async function buildApp() {
  const { rewardRoutes } = await import('./rewards')
  const app = new Hono()
  app.route('/api/rewards', rewardRoutes)
  return app
}

function headers(token?: string, body?: unknown) {
  return {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
  }
}

const rewardBody = {
  profileId: KID_ID,
  name: '贴纸一张',
  emoji: '⭐',
  conditionType: 'points',
  conditionValue: 50,
}

async function createReward(app: Awaited<ReturnType<typeof buildApp>>) {
  const res = await app.request('/api/rewards', {
    method: 'POST',
    headers: headers(PARENT_TOKEN, rewardBody),
    body: JSON.stringify(rewardBody),
  })
  expect(res.status).toBe(200)
  return (await res.json()).id as string
}

describe('奖励接口鉴权（requireAuth + requireParent）', () => {
  it('家长创建奖励成功（此前缺 requireAuth 恒 403）', async () => {
    const app = await buildApp()
    const res = await app.request('/api/rewards', {
      method: 'POST',
      headers: headers(PARENT_TOKEN, rewardBody),
      body: JSON.stringify(rewardBody),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('家长生成并读取兑换码成功', async () => {
    const app = await buildApp()
    const create = await app.request('/api/rewards/codes', {
      method: 'POST',
      headers: headers(PARENT_TOKEN, { rewardName: '贴纸一张' }),
      body: JSON.stringify({ rewardName: '贴纸一张', rewardDesc: '完成目标' }),
    })
    expect(create.status).toBe(200)
    const { code } = (await create.json()) as { code: string }
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)

    const list = await app.request('/api/rewards/codes', { headers: headers(PARENT_TOKEN) })
    expect(list.status).toBe(200)
    const { codes } = (await list.json()) as { codes: { code: string }[] }
    expect(codes.map((c) => c.code)).toContain(code)
  })

  it('家长编辑与删除奖励成功', async () => {
    const app = await buildApp()
    const id = await createReward(app)

    const patch = await app.request(`/api/rewards/${id}`, {
      method: 'PATCH',
      headers: headers(PARENT_TOKEN, rewardBody),
      body: JSON.stringify({ ...rewardBody, name: '贴纸两张' }),
    })
    expect(patch.status).toBe(200)

    const remove = await app.request(`/api/rewards/${id}`, {
      method: 'DELETE',
      headers: headers(PARENT_TOKEN),
    })
    expect(remove.status).toBe(200)

    const list = await app.request('/api/rewards', { headers: headers(PARENT_TOKEN) })
    expect(((await list.json()).rewards as unknown[]).length).toBe(0)
  })

  it('家长审批领取成功', async () => {
    const app = await buildApp()
    const rewardId = await createReward(app)
    const database = await db()
    database
      .prepare(
        `INSERT INTO reward_claims (id, family_id, reward_id, profile_id, status, claimed_at)
         VALUES ('claim1', ?, ?, ?, 'pending', ?)`,
      )
      .run(FAMILY_ID, rewardId, KID_ID, Date.now())

    const res = await app.request('/api/rewards/claims/claim1/approve', {
      method: 'POST',
      headers: headers(PARENT_TOKEN, { approved: true }),
      body: JSON.stringify({ approved: true }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('approved')
  })

  it('未登录访问 6 条家长路由均返回 401（证明 requireAuth 生效）', async () => {
    const app = await buildApp()
    const cases: { path: string; method: string; body?: unknown }[] = [
      { path: '/api/rewards', method: 'POST', body: rewardBody },
      { path: '/api/rewards/r1', method: 'PATCH', body: rewardBody },
      { path: '/api/rewards/r1', method: 'DELETE' },
      { path: '/api/rewards/claims/c1/approve', method: 'POST', body: { approved: true } },
      { path: '/api/rewards/codes', method: 'POST', body: { rewardName: 'x' } },
      { path: '/api/rewards/codes', method: 'GET' },
    ]
    for (const c of cases) {
      const res = await app.request(c.path, {
        method: c.method,
        headers: headers(undefined, c.body),
        body: c.body !== undefined ? JSON.stringify(c.body) : undefined,
      })
      expect(res.status, `${c.method} ${c.path}`).toBe(401)
    }
  })

  it('孩子身份访问家长路由返回 403（requireParent 仍在生效）', async () => {
    const app = await buildApp()
    const res = await app.request('/api/rewards', {
      method: 'POST',
      headers: headers(CHILD_TOKEN, rewardBody),
      body: JSON.stringify(rewardBody),
    })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('FORBIDDEN')
  })
})

/**
 * 回归：领取链路必须真实落库。
 *
 * 历史 bug：claim 路由里的 persistFamily 用 `INSERT OR REPLACE` 更新 profiles，
 * REPLACE 的删除动作触发 rewards / reward_claims 的 ON DELETE CASCADE，
 * 把刚写入的领取记录（连同奖励本身）整表清空 → claim 200 却查不到、approve 404。
 */
describe('领取链路落库（persistFamily 不抹 rewards）', () => {
  it('孩子领取后家长能查到领取记录并审批成功', async () => {
    const app = await buildApp()
    const body = { ...rewardBody, conditionType: 'manual', conditionValue: 0, requiresApproval: true }
    const create = await app.request('/api/rewards', {
      method: 'POST',
      headers: headers(PARENT_TOKEN, body),
      body: JSON.stringify(body),
    })
    expect(create.status).toBe(200)
    const rewardId = (await create.json()).id as string

    const claimRes = await app.request(`/api/rewards/${rewardId}/claim`, {
      method: 'POST',
      headers: headers(CHILD_TOKEN, {}),
      body: JSON.stringify({}),
    })
    expect(claimRes.status).toBe(200)
    const { claimId } = (await claimRes.json()) as { claimId: string }

    const list = await app.request('/api/rewards/claims', { headers: headers(PARENT_TOKEN) })
    expect(list.status).toBe(200)
    const { claims } = (await list.json()) as { claims: { id: string; status: string }[] }
    expect(claims.map((c) => c.id)).toContain(claimId)

    const approve = await app.request(`/api/rewards/claims/${claimId}/approve`, {
      method: 'POST',
      headers: headers(PARENT_TOKEN, { approved: true }),
      body: JSON.stringify({ approved: true }),
    })
    expect(approve.status).toBe(200)
    expect((await approve.json()).status).toBe('approved')

    // 重复领取应被识别为「已经领取过了」，而不是「奖励不存在」
    const again = await app.request(`/api/rewards/${rewardId}/claim`, {
      method: 'POST',
      headers: headers(CHILD_TOKEN, {}),
      body: JSON.stringify({}),
    })
    expect(again.status).toBe(400)
    expect((await again.json()).error).toBe('已经领取过了')
  })
})
