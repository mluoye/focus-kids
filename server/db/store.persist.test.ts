import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * 回归：persistFamily 必须「更新不抹级联、删除真落库」。
 *
 * 历史 bug 1：profiles 用 `INSERT OR REPLACE` 更新，REPLACE = 先删后插；
 * `foreign_keys = ON` 下删除 profile 行触发 `ON DELETE CASCADE`，
 * 把不在 upsert 列表里的 rewards / reward_claims 整表清空
 * （claim 返回 200 但行随即被删 → GET /claims 为 0、approve 404）。
 *
 * 历史 bug 2：只 upsert 不删除，删除档案 / prune 只改内存缓存，
 * DB 行留存，重启后数据复活。
 *
 * 用内存 SQLite 跑真实 SQL，不调用 initDb()（避免碰真实 .data）。
 */
vi.mock('./index', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { createTables } = await import('./schema')
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  createTables(db)
  return { getDb: () => db, initDb: () => db, closeDb: () => db.close() }
})

const NOW = Date.now()

async function db() {
  const { getDb } = await import('./index')
  return getDb()
}

function seedFamily(database: Awaited<ReturnType<typeof db>>, familyId: string, kids: string[]): void {
  database
    .prepare(
      'INSERT INTO families (id, username, password_hash, child_pin_length, created_at, updated_at) VALUES (?, ?, ?, 4, ?, ?)',
    )
    .run(familyId, `u_${familyId}`, 'x', NOW, NOW)
  for (const kid of kids) {
    database
      .prepare(
        "INSERT INTO profiles (id, family_id, name, avatar, pin_hash, created_at, updated_at) VALUES (?, ?, ?, '🦊', 'x', ?, ?)",
      )
      .run(kid, familyId, kid, NOW, NOW)
  }
}

beforeAll(async () => {
  const database = await db()
  // 家庭 1：奖励 + 领取 + 孩子会话（验证更新不抹级联）
  seedFamily(database, 'fam_upsert', ['kid_up'])
  database
    .prepare(
      `INSERT INTO rewards (id, family_id, profile_id, name, emoji, condition_type, condition_value, requires_approval, created_at, updated_at)
       VALUES ('rew_up', 'fam_upsert', 'kid_up', '贴纸', '⭐', 'manual', 0, 1, ?, ?)`,
    )
    .run(NOW, NOW)
  database
    .prepare(
      `INSERT INTO reward_claims (id, family_id, reward_id, profile_id, status, claimed_at)
       VALUES ('claim_up', 'fam_upsert', 'rew_up', 'kid_up', 'pending', ?)`,
    )
    .run(NOW)
  database
    .prepare(
      "INSERT INTO sessions (token, family_id, profile_id, role, created_at, expires_at) VALUES ('tok_up', 'fam_upsert', 'kid_up', 'child', ?, ?)",
    )
    .run(NOW, NOW + 60_000)

  // 家庭 2：两个孩子 + 记录 + 奖励 + 孩子会话（验证删除真落库）
  seedFamily(database, 'fam_del', ['kid_keep', 'kid_gone'])
  database
    .prepare(
      `INSERT INTO training_records (id, family_id, profile_id, module, started_at, ended_at, duration_sec,
        difficulty, accuracy, avg_reaction_ms, score, total_trials, correct_trials, updated_at)
       VALUES ('rec_gone', 'fam_del', 'kid_gone', 'schulte', ?, ?, 60, 1, 0.9, 800, 90, 10, 9, ?)`,
    )
    .run(NOW, NOW, NOW)
  database
    .prepare(
      `INSERT INTO rewards (id, family_id, profile_id, name, emoji, condition_type, condition_value, requires_approval, created_at, updated_at)
       VALUES ('rew_gone', 'fam_del', 'kid_gone', '贴纸', '⭐', 'manual', 0, 1, ?, ?)`,
    )
    .run(NOW, NOW)
  database
    .prepare(
      "INSERT INTO sessions (token, family_id, profile_id, role, created_at, expires_at) VALUES ('tok_gone', 'fam_del', 'kid_gone', 'child', ?, ?)",
    )
    .run(NOW, NOW + 60_000)

  // 家庭 3：prune 清理（验证只增不减的子表同步删除）
  seedFamily(database, 'fam_prune', ['kid_prune'])
  for (const id of ['rec_p1', 'rec_p2']) {
    database
      .prepare(
        `INSERT INTO training_records (id, family_id, profile_id, module, started_at, ended_at, duration_sec,
          difficulty, accuracy, avg_reaction_ms, score, total_trials, correct_trials, updated_at)
         VALUES (?, 'fam_prune', 'kid_prune', 'schulte', ?, ?, 60, 1, 0.9, 800, 90, 10, 9, ?)`,
      )
      .run(id, NOW, NOW, NOW)
  }
})

afterAll(async () => {
  const { closeDb } = await import('./index')
  closeDb()
})

describe('persistFamily 更新路径：不得触发级联抹除', () => {
  it('改档案后再落库，rewards / reward_claims 行仍在', async () => {
    const { getFamilyCache, persistFamily } = await import('./store')
    const database = await db()

    const cache = getFamilyCache('fam_upsert')
    expect(cache.profiles).toHaveLength(1)
    // 模拟任意一次状态写入（改名 / 上报记录 / 改设置都会走到这里）
    cache.profiles[0].name = '改过名'
    persistFamily('fam_upsert')

    const rewards = database.prepare("SELECT id FROM rewards WHERE family_id = 'fam_upsert'").all() as { id: string }[]
    const claims = database.prepare("SELECT id FROM reward_claims WHERE family_id = 'fam_upsert'").all() as { id: string }[]
    expect(rewards.map((r) => r.id)).toEqual(['rew_up'])
    expect(claims.map((c) => c.id)).toEqual(['claim_up'])
    // 孩子会话不能被顺带清掉（token 是独立表，但同属「更新不抹」语义）
    const session = database.prepare("SELECT token FROM sessions WHERE token = 'tok_up'").get()
    expect(session).toBeTruthy()
    // 改名本身也要落库
    const row = database.prepare("SELECT name FROM profiles WHERE id = 'kid_up'").get() as { name: string }
    expect(row.name).toBe('改过名')
  })
})

describe('persistFamily 删除路径：缓存删掉的行必须从 DB 消失', () => {
  it('删除孩子档案后 profiles / records / rewards / 会话行都不复活', async () => {
    const { getFamilyCache, persistFamily } = await import('./store')
    const database = await db()

    const cache = getFamilyCache('fam_del')
    // 与 profiles 路由的删除逻辑一致：只改内存缓存
    cache.profiles = cache.profiles.filter((p) => p.id !== 'kid_gone')
    cache.records = cache.records.filter((r) => r.profileId !== 'kid_gone')
    cache.homework = cache.homework.filter((h) => h.profileId !== 'kid_gone')
    cache.homeworkPlans = cache.homeworkPlans.filter((p) => p.profileId !== 'kid_gone')
    cache.sessions = cache.sessions.filter((s) => s.profileId !== 'kid_gone')
    persistFamily('fam_del')

    const profiles = database.prepare("SELECT id FROM profiles WHERE family_id = 'fam_del'").all() as { id: string }[]
    expect(profiles.map((p) => p.id)).toEqual(['kid_keep'])
    expect(database.prepare("SELECT id FROM training_records WHERE id = 'rec_gone'").get()).toBeUndefined()
    expect(database.prepare("SELECT id FROM rewards WHERE id = 'rew_gone'").get()).toBeUndefined()
    expect(database.prepare("SELECT token FROM sessions WHERE token = 'tok_gone'").get()).toBeUndefined()
    // 留下的孩子数据不受影响
    expect(database.prepare("SELECT id FROM profiles WHERE id = 'kid_keep'").get()).toBeTruthy()
  })

  it('prune 清掉的训练记录同步删除，保留的仍在', async () => {
    const { getFamilyCache, persistFamily } = await import('./store')
    const database = await db()

    const cache = getFamilyCache('fam_prune')
    expect(cache.records).toHaveLength(2)
    cache.records = cache.records.filter((r) => r.id !== 'rec_p2')
    persistFamily('fam_prune')

    const ids = (database
      .prepare("SELECT id FROM training_records WHERE family_id = 'fam_prune'")
      .all() as { id: string }[]
    ).map((r) => r.id)
    expect(ids).toEqual(['rec_p1'])
  })
})
