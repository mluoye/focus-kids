import type {
  HomeworkPlan,
  HomeworkSession,
  Settings,
  TrainingRecord,
} from '../../shared/types'
import type { FamilyRecord, ProfileRecord, StoredSession } from '../store/types'
import { getDb } from './index'

// ─── FamilyCache ──────────────────────────────────────────────────────────────

export interface FamilyCache {
  family: FamilyRecord
  profiles: ProfileRecord[]
  records: TrainingRecord[]
  homework: HomeworkSession[]
  homeworkPlans: HomeworkPlan[]
  settings: Settings
  sessions: StoredSession[]
}

const cacheMap = new Map<string, FamilyCache>()

// ─── Row → Object 映射 ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

function rowToFamily(r: Row): FamilyRecord {
  return {
    id: r.id,
    username: r.username,
    passwordHash: r.password_hash,
    recoveryHash: r.recovery_hash ?? undefined,
    recoveryUpdatedAt: r.recovery_updated_at ?? undefined,
    childPinLength: r.child_pin_length,
    createdAt: r.created_at,
  }
}

function rowToProfile(r: Row): ProfileRecord {
  return {
    id: r.id,
    name: r.name,
    avatar: r.avatar,
    pinHash: r.pin_hash,
    createdAt: r.created_at,
    points: r.points,
    pointsSpent: r.points_spent ?? 0,
    badges: JSON.parse(r.badges_json ?? '[]'),
    ttsPrefs: r.tts_prefs_json ? JSON.parse(r.tts_prefs_json) : undefined,
    arithmeticMode: r.arithmetic_mode ?? undefined,
    arithmeticDifficulty: r.arithmetic_difficulty ?? undefined,
    storymathGrade: r.storymath_grade ?? undefined,
    storymathTerm: r.storymath_term ?? undefined,
    storymathUnit: r.storymath_unit !== null ? (r.storymath_unit === 'fun' ? 'fun' : Number(r.storymath_unit)) : undefined,
  }
}

function rowToRecord(r: Row): TrainingRecord {
  return {
    id: r.id,
    profileId: r.profile_id,
    module: r.module,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationSec: r.duration_sec,
    difficulty: r.difficulty,
    accuracy: r.accuracy,
    avgReactionMs: r.avg_reaction_ms,
    score: r.score,
    totalTrials: r.total_trials,
    correctTrials: r.correct_trials,
    errors: JSON.parse(r.errors_json ?? '[]'),
    dimensionScores: JSON.parse(r.dimension_scores_json ?? '{}'),
    passed: r.passed === null ? undefined : r.passed === 1,
    storymathDetail: r.storymath_detail_json ? JSON.parse(r.storymath_detail_json) : undefined,
    updatedAt: r.updated_at,
  }
}

function rowToHomework(r: Row): HomeworkSession {
  return {
    id: r.id,
    profileId: r.profile_id,
    planId: r.plan_id ?? undefined,
    taskTitle: r.task_title,
    items: JSON.parse(r.items_json ?? '[]'),
    subtasks: r.subtasks_json ? JSON.parse(r.subtasks_json) : undefined,
    plannedFocusMinutes: r.planned_focus_minutes,
    rounds: JSON.parse(r.rounds_json ?? '[]'),
    progress: r.progress_json ? JSON.parse(r.progress_json) : undefined,
    status: r.status,
    verdict: r.verdict ?? undefined,
    verdictAt: r.verdict_at ?? undefined,
    startedAt: r.started_at,
    endedAt: r.ended_at ?? null,
    updatedAt: r.updated_at,
  }
}

function rowToPlan(r: Row): HomeworkPlan {
  return {
    id: r.id,
    profileId: r.profile_id,
    planDate: r.plan_date,
    subject: r.subject ?? undefined,
    title: r.title,
    items: JSON.parse(r.items_json ?? '[]'),
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archivedAt: r.archived_at ?? undefined,
  }
}

function rowToSession(r: Row): StoredSession {
  return {
    token: r.token,
    familyId: r.family_id,
    role: r.role,
    profileId: r.profile_id ?? undefined,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  }
}

// ─── SQLite → FamilyCache 加载 ───────────────────────────────────────────────

function loadFromDb(familyId: string): FamilyCache {
  const db = getDb()

  const familyRow = db.prepare('SELECT * FROM families WHERE id = ?').get(familyId) as Row | undefined
  if (!familyRow) throw new Error(`[db] 家庭不存在: ${familyId}`)
  const family = rowToFamily(familyRow)

  const profiles = (db.prepare('SELECT * FROM profiles WHERE family_id = ? ORDER BY created_at').all(familyId) as Row[]).map(rowToProfile)
  const records = (db.prepare('SELECT * FROM training_records WHERE family_id = ? ORDER BY started_at').all(familyId) as Row[]).map(rowToRecord)
  const homework = (db.prepare('SELECT * FROM homework_sessions WHERE family_id = ? ORDER BY started_at').all(familyId) as Row[]).map(rowToHomework)
  const homeworkPlans = (db.prepare('SELECT * FROM homework_plans WHERE family_id = ? ORDER BY plan_date DESC, updated_at DESC').all(familyId) as Row[]).map(rowToPlan)
  const sessions = (db.prepare('SELECT * FROM sessions WHERE family_id = ? AND expires_at > ?').all(familyId, Date.now()) as Row[]).map(rowToSession)

  const settingsRow = db.prepare('SELECT * FROM settings WHERE family_id = ?').get(familyId) as Row | undefined
  const settings: Settings = settingsRow
    ? {
        ai: JSON.parse(settingsRow.ai_json),
        limits: JSON.parse(settingsRow.limits_json),
        tts: JSON.parse(settingsRow.tts_json),
        updatedAt: settingsRow.updated_at,
      }
    : { ai: { enabled: false, baseUrl: '', model: '', temperature: 0.7, vision: { baseUrl: '', model: '' } }, limits: { dailyTrainingMinutes: 30, sessionMinutes: 15, breakMinutes: 5, dailyBadgeLimit: 5, blockedRanges: [], homeworkExempt: true }, tts: { enabled: ['native'], verified: {}, lastFailure: null, openai: { baseUrl: '', model: '' } }, updatedAt: 0 }

  return { family, profiles, records, homework, homeworkPlans, settings, sessions }
}

export function getFamilyCache(familyId: string): FamilyCache {
  let cache = cacheMap.get(familyId)
  if (!cache) {
    cache = loadFromDb(familyId)
    cacheMap.set(familyId, cache)
  }
  return cache
}

export function invalidateCache(familyId: string): void {
  cacheMap.delete(familyId)
}

// ─── Family CRUD ──────────────────────────────────────────────────────────────

export function getFamilyByUsername(username: string): FamilyRecord | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM families WHERE username = ?').get(username) as Row | undefined
  return row ? rowToFamily(row) : null
}

export function getFamilyById(familyId: string): FamilyRecord | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM families WHERE id = ?').get(familyId) as Row | undefined
  return row ? rowToFamily(row) : null
}

export function countFamilies(): number {
  const db = getDb()
  return (db.prepare('SELECT COUNT(*) AS n FROM families').get() as { n: number }).n
}

export function createFamilyRecord(record: FamilyRecord): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO families (id, username, password_hash, recovery_hash, recovery_updated_at, child_pin_length, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(record.id, record.username, record.passwordHash, record.recoveryHash ?? null, record.recoveryUpdatedAt ?? null, record.childPinLength, record.createdAt, Date.now())
}

export function updateFamilyRecord(familyId: string, patch: Omit<Partial<FamilyRecord>, 'recoveryHash' | 'recoveryUpdatedAt'> & { recoveryHash?: string | null; recoveryUpdatedAt?: number | null }): void {
  const db = getDb()
  const sets: string[] = []
  const vals: unknown[] = []
  if (patch.username !== undefined) { sets.push('username = ?'); vals.push(patch.username) }
  if (patch.passwordHash !== undefined) { sets.push('password_hash = ?'); vals.push(patch.passwordHash) }
  // recoveryHash / recoveryUpdatedAt 传 null 表示清空（区别于 undefined = 不修改）
  if (patch.recoveryHash !== undefined) { sets.push('recovery_hash = ?'); vals.push(patch.recoveryHash ?? null) }
  if (patch.recoveryUpdatedAt !== undefined) { sets.push('recovery_updated_at = ?'); vals.push(patch.recoveryUpdatedAt ?? null) }
  if (patch.childPinLength !== undefined) { sets.push('child_pin_length = ?'); vals.push(patch.childPinLength) }
  if (sets.length === 0) return
  sets.push('updated_at = ?'); vals.push(Date.now())
  db.prepare(`UPDATE families SET ${sets.join(', ')} WHERE id = ?`).run(...vals, familyId)
  const cache = cacheMap.get(familyId)
  if (cache) {
    if (patch.recoveryHash !== undefined) cache.family.recoveryHash = patch.recoveryHash ?? undefined
    if (patch.recoveryUpdatedAt !== undefined) cache.family.recoveryUpdatedAt = patch.recoveryUpdatedAt ?? undefined
    const { recoveryHash: _rh, recoveryUpdatedAt: _ru, ...rest } = patch
    Object.assign(cache.family, rest)
  }
}

// ─── Session CRUD ─────────────────────────────────────────────────────────────

export function findSessionByToken(token: string): { session: StoredSession; familyId: string } | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?').get(token, Date.now()) as Row | undefined
  if (!row) return null
  return { session: rowToSession(row), familyId: row.family_id }
}

export function insertSession(familyId: string, session: StoredSession): void {
  const db = getDb()
  db.prepare('INSERT OR REPLACE INTO sessions (token, family_id, profile_id, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(session.token, familyId, session.profileId ?? null, session.role, session.createdAt, session.expiresAt)
  const cache = cacheMap.get(familyId)
  if (cache) {
    cache.sessions = cache.sessions.filter(s => s.expiresAt > Date.now())
    cache.sessions.push(session)
  }
}

export function deleteSessionByToken(token: string): void {
  const db = getDb()
  const row = db.prepare('SELECT family_id FROM sessions WHERE token = ?').get(token) as { family_id: string } | undefined
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
  if (row) {
    const cache = cacheMap.get(row.family_id)
    if (cache) cache.sessions = cache.sessions.filter(s => s.token !== token)
  }
}

export function revokeParentSessions(familyId: string, exceptToken?: string): void {
  const db = getDb()
  const rows = db.prepare("SELECT token FROM sessions WHERE family_id = ? AND role = 'parent'").all(familyId) as { token: string }[]
  for (const r of rows) {
    if (exceptToken && r.token === exceptToken) continue
    db.prepare('DELETE FROM sessions WHERE token = ?').run(r.token)
  }
  const cache = cacheMap.get(familyId)
  if (cache) cache.sessions = cache.sessions.filter(s => s.role !== 'parent' || (!!exceptToken && s.token === exceptToken))
}

export function cleanExpiredSessions(): void {
  const db = getDb()
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
}

// ─── persistFamily: 写缓存到 SQLite ───────────────────────────────────────────

export function persistFamily(familyId: string): void {
  const cache = cacheMap.get(familyId)
  if (!cache) return
  const db = getDb()
  const now = Date.now()

  db.transaction(() => {
    // 删除同步：缓存是权威全量状态，DB 里多出来的行 = 已被删除
    // （删除孩子档案 / prune 清理 / 作废旧作业）。必须先删后插：
    // 先删 profiles 会级联清掉它的子表行，再删子表残留，最后统一 upsert。
    const profileIds = new Set(cache.profiles.map((p) => p.id))
    const orphanProfiles = db.prepare('SELECT id FROM profiles WHERE family_id = ?').all(familyId) as { id: string }[]
    const delProfile = db.prepare('DELETE FROM profiles WHERE id = ?')
    for (const row of orphanProfiles) {
      if (!profileIds.has(row.id)) delProfile.run(row.id)
    }

    // 子表：DB 有而缓存没有的行删掉（表名来自代码常量，非用户输入）
    const syncDeleted = (table: string, keepIds: string[]) => {
      const keep = new Set(keepIds)
      const rows = db.prepare(`SELECT id FROM ${table} WHERE family_id = ?`).all(familyId) as { id: string }[]
      const del = db.prepare(`DELETE FROM ${table} WHERE id = ?`)
      for (const row of rows) {
        if (!keep.has(row.id)) del.run(row.id)
      }
    }
    syncDeleted('training_records', cache.records.map((r) => r.id))
    syncDeleted('homework_sessions', cache.homework.map((h) => h.id))
    syncDeleted('homework_plans', cache.homeworkPlans.map((p) => p.id))

    // 已删除孩子的登录会话一并作废（sessions.profile_id 无外键，不会被级联带走）
    const sessions = db.prepare('SELECT token, profile_id FROM sessions WHERE family_id = ?').all(familyId) as {
      token: string
      profile_id: string | null
    }[]
    const delSession = db.prepare('DELETE FROM sessions WHERE token = ?')
    for (const s of sessions) {
      if (s.profile_id && !profileIds.has(s.profile_id)) delSession.run(s.token)
    }

    // profiles
    // 注意：这里绝不能用 INSERT OR REPLACE——REPLACE = 先 DELETE 再 INSERT，
    // foreign_keys=ON 下删除 profile 行会触发 ON DELETE CASCADE，
    // 把不在本函数 upsert 列表里的 rewards / reward_claims 整表清空。
    const upsertProfile = db.prepare(`
      INSERT INTO profiles
        (id, family_id, name, avatar, pin_hash, created_at, points, points_spent, badges_json, tts_prefs_json,
         arithmetic_mode, arithmetic_difficulty, storymath_grade, storymath_term, storymath_unit, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, avatar = excluded.avatar, pin_hash = excluded.pin_hash,
        created_at = excluded.created_at, points = excluded.points, points_spent = excluded.points_spent,
        badges_json = excluded.badges_json, tts_prefs_json = excluded.tts_prefs_json,
        arithmetic_mode = excluded.arithmetic_mode, arithmetic_difficulty = excluded.arithmetic_difficulty,
        storymath_grade = excluded.storymath_grade, storymath_term = excluded.storymath_term,
        storymath_unit = excluded.storymath_unit, updated_at = excluded.updated_at
    `)
    for (const p of cache.profiles) {
      upsertProfile.run(
        p.id, familyId, p.name, p.avatar, p.pinHash, p.createdAt, p.points, p.pointsSpent ?? 0,
        JSON.stringify(p.badges ?? []),
        p.ttsPrefs ? JSON.stringify(p.ttsPrefs) : null,
        p.arithmeticMode ?? null, p.arithmeticDifficulty ?? null,
        p.storymathGrade ?? null, p.storymathTerm ?? null,
        p.storymathUnit !== undefined ? String(p.storymathUnit) : null,
        now,
      )
    }

    // records
    const upsertRecord = db.prepare(`
      INSERT OR REPLACE INTO training_records
        (id, family_id, profile_id, module, started_at, ended_at, duration_sec, difficulty, accuracy,
         avg_reaction_ms, score, total_trials, correct_trials, errors_json, dimension_scores_json,
         passed, storymath_detail_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const r of cache.records) {
      upsertRecord.run(
        r.id, familyId, r.profileId, r.module, r.startedAt, r.endedAt, r.durationSec,
        r.difficulty, r.accuracy, r.avgReactionMs, r.score, r.totalTrials, r.correctTrials,
        JSON.stringify(r.errors ?? []),
        JSON.stringify(r.dimensionScores ?? {}),
        r.passed === undefined ? null : r.passed ? 1 : 0,
        r.storymathDetail ? JSON.stringify(r.storymathDetail) : null,
        r.updatedAt,
      )
    }

    // homework
    const upsertHomework = db.prepare(`
      INSERT OR REPLACE INTO homework_sessions
        (id, family_id, profile_id, plan_id, task_title, items_json, subtasks_json,
         planned_focus_minutes, rounds_json, progress_json, status, verdict, verdict_at,
         started_at, ended_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const h of cache.homework) {
      upsertHomework.run(
        h.id, familyId, h.profileId, h.planId ?? null, h.taskTitle,
        JSON.stringify(h.items ?? []),
        h.subtasks ? JSON.stringify(h.subtasks) : null,
        h.plannedFocusMinutes,
        JSON.stringify(h.rounds ?? []),
        h.progress ? JSON.stringify(h.progress) : null,
        h.status, h.verdict ?? null, h.verdictAt ?? null,
        h.startedAt, h.endedAt ?? null, h.updatedAt,
      )
    }

    // plans
    const upsertPlan = db.prepare(`
      INSERT OR REPLACE INTO homework_plans
        (id, family_id, profile_id, plan_date, subject, title, items_json,
         created_by, created_at, updated_at, archived_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const p of cache.homeworkPlans) {
      upsertPlan.run(
        p.id, familyId, p.profileId, p.planDate, p.subject ?? null, p.title,
        JSON.stringify(p.items ?? []),
        p.createdBy, p.createdAt, p.updatedAt, p.archivedAt ?? null,
      )
    }

    // settings
    db.prepare(`
      INSERT OR REPLACE INTO settings (family_id, ai_json, limits_json, tts_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(familyId, JSON.stringify(cache.settings.ai), JSON.stringify(cache.settings.limits), JSON.stringify(cache.settings.tts), cache.settings.updatedAt || now)
  })()
}
