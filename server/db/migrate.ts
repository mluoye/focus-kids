import type { Database } from 'better-sqlite3'
import { existsSync, readFileSync, renameSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { AppState } from '../store/types'
import type { FamilyRecord, ProfileRecord, StoredSession } from '../store/types'
import type { TrainingRecord, HomeworkSession, HomeworkPlan, Settings } from '../../shared/types'
import { hashSecret } from '../security'

const JSON_FILE = './.data/app-state.json'

/**
 * 启动时自动迁移：检测旧 JSON 文件存在且 families 表为空时，导入全部数据。
 * 迁移成功后旧文件重命名为 .migrated，不会删除。
 */
export function migrateFromJson(db: Database, dbPath: string): void {
  // 旧 JSON 与 DB 同目录（./.data/app-state.json）；回退到历史硬编码位置
  const jsonPath = resolve(dirname(resolve(dbPath)), 'app-state.json')
  const absJsonPath = resolve(JSON_FILE)

  for (const p of [absJsonPath, jsonPath]) {
    if (!existsSync(p)) continue

    const familyCount = (db.prepare('SELECT COUNT(*) AS n FROM families').get() as { n: number }).n
    if (familyCount > 0) {
      // 已有数据，不重复迁移
      renameIfExists(p)
      return
    }

    console.log(`[db] 检测到旧版 JSON 数据文件 ${p}，开始迁移...`)
    try {
      // 去掉可能的 UTF-8 BOM，否则 JSON.parse 直接失败
      const text = readFileSync(p, 'utf8').replace(/^\uFEFF/, '')
      const raw = JSON.parse(text) as AppState
      importJsonToDb(db, raw)
      renameIfExists(p)
      console.log('[db] JSON → SQLite 迁移完成')
    } catch (err) {
      console.error('[db] JSON 迁移失败，原文件未删除：', err)
    }
    return
  }
}

function renameIfExists(filePath: string): void {
  try {
    const backup = `${filePath}.migrated`
    renameSync(filePath, backup)
    console.log(`[db] 旧文件已重命名为 ${backup}`)
  } catch {
    // 文件可能已被重命名或不存在
  }
}

function importJsonToDb(db: Database, raw: AppState): void {
  const now = Date.now()
  // family 为 null 但有孩子/记录时，补一个默认家庭行，否则子表外键无处指向
  const familyId = raw.family?.id ?? (raw.profiles.length || raw.records.length || raw.homework.length ? 'fam_default' : null)

  db.transaction(() => {
    // family
    if (raw.family) {
      const f = raw.family
      db.prepare(`
        INSERT OR REPLACE INTO families (id, username, password_hash, recovery_hash, recovery_updated_at, child_pin_length, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(f.id, f.username, f.passwordHash, f.recoveryHash ?? null, f.recoveryUpdatedAt ?? null, f.childPinLength, f.createdAt, now)
    } else if (familyId) {
      db.prepare(`
        INSERT OR REPLACE INTO families (id, username, password_hash, child_pin_length, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(familyId, 'family', '', 4, now, now)
    }

    // profiles
    const insertProfile = db.prepare(`
      INSERT OR REPLACE INTO profiles
        (id, family_id, name, avatar, pin_hash, created_at, points, badges_json, tts_prefs_json,
         arithmetic_mode, arithmetic_difficulty, storymath_grade, storymath_term, storymath_unit, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const p of raw.profiles) {
      insertProfile.run(
        p.id, familyId, p.name, p.avatar, p.pinHash, p.createdAt, p.points,
        JSON.stringify(p.badges ?? []),
        p.ttsPrefs ? JSON.stringify(p.ttsPrefs) : null,
        p.arithmeticMode ?? null, p.arithmeticDifficulty ?? null,
        p.storymathGrade ?? null, p.storymathTerm ?? null,
        p.storymathUnit !== undefined ? String(p.storymathUnit) : null,
        now,
      )
    }

    // training_records
    const insertRecord = db.prepare(`
      INSERT OR REPLACE INTO training_records
        (id, family_id, profile_id, module, started_at, ended_at, duration_sec, difficulty, accuracy,
         avg_reaction_ms, score, total_trials, correct_trials, errors_json, dimension_scores_json,
         passed, storymath_detail_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const r of raw.records) {
      insertRecord.run(
        r.id, familyId, r.profileId, r.module, r.startedAt, r.endedAt, r.durationSec,
        r.difficulty, r.accuracy, r.avgReactionMs, r.score, r.totalTrials, r.correctTrials,
        JSON.stringify(r.errors ?? []),
        JSON.stringify(r.dimensionScores ?? {}),
        r.passed === undefined ? null : r.passed ? 1 : 0,
        r.storymathDetail ? JSON.stringify(r.storymathDetail) : null,
        r.updatedAt,
      )
    }

    // homework_sessions
    const insertHomework = db.prepare(`
      INSERT OR REPLACE INTO homework_sessions
        (id, family_id, profile_id, plan_id, task_title, items_json, subtasks_json,
         planned_focus_minutes, rounds_json, progress_json, status, verdict, verdict_at,
         started_at, ended_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const h of raw.homework) {
      insertHomework.run(
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

    // homework_plans
    const insertPlan = db.prepare(`
      INSERT OR REPLACE INTO homework_plans
        (id, family_id, profile_id, plan_date, subject, title, items_json,
         created_by, created_at, updated_at, archived_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const p of raw.homeworkPlans) {
      insertPlan.run(
        p.id, familyId, p.profileId, p.planDate, p.subject ?? null, p.title,
        JSON.stringify(p.items ?? []),
        p.createdBy, p.createdAt, p.updatedAt, p.archivedAt ?? null,
      )
    }

    // settings
    if (raw.settings) {
      db.prepare(`
        INSERT OR REPLACE INTO settings (family_id, ai_json, limits_json, tts_json, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(familyId, JSON.stringify(raw.settings.ai), JSON.stringify(raw.settings.limits), JSON.stringify(raw.settings.tts), now)
    }

    // sessions
    const insertSession = db.prepare(`
      INSERT OR REPLACE INTO sessions (token, family_id, profile_id, role, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const s of raw.sessions) {
      insertSession.run(s.token, familyId, s.profileId ?? null, s.role, s.createdAt, s.expiresAt)
    }
  })()
}
