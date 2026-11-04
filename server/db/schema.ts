import type { Database } from 'better-sqlite3'

/** 建表语句；幂等，启动时执行。 */
export function createTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS families (
      id            TEXT PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      recovery_hash TEXT,
      recovery_updated_at INTEGER,
      child_pin_length INTEGER NOT NULL DEFAULT 4,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id                    TEXT PRIMARY KEY,
      family_id             TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      name                  TEXT NOT NULL,
      avatar                TEXT NOT NULL,
      pin_hash              TEXT NOT NULL,
      created_at            INTEGER NOT NULL,
      points                INTEGER NOT NULL DEFAULT 0,
      points_spent          INTEGER NOT NULL DEFAULT 0,
      badges_json           TEXT NOT NULL DEFAULT '[]',
      tts_prefs_json        TEXT,
      arithmetic_mode       TEXT,
      arithmetic_difficulty INTEGER,
      storymath_grade       INTEGER,
      storymath_term        INTEGER,
      storymath_unit        TEXT,
      updated_at            INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_profiles_family ON profiles(family_id);

    CREATE TABLE IF NOT EXISTS training_records (
      id                     TEXT PRIMARY KEY,
      family_id              TEXT NOT NULL,
      profile_id             TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      module                 TEXT NOT NULL,
      started_at             INTEGER NOT NULL,
      ended_at               INTEGER NOT NULL,
      duration_sec           INTEGER NOT NULL,
      difficulty             INTEGER NOT NULL,
      accuracy               REAL NOT NULL,
      avg_reaction_ms        INTEGER NOT NULL,
      score                  REAL NOT NULL,
      total_trials           INTEGER NOT NULL,
      correct_trials         INTEGER NOT NULL,
      errors_json            TEXT NOT NULL DEFAULT '[]',
      dimension_scores_json  TEXT NOT NULL DEFAULT '{}',
      passed                 INTEGER,
      storymath_detail_json  TEXT,
      updated_at             INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_records_profile ON training_records(profile_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_records_family  ON training_records(family_id);

    CREATE TABLE IF NOT EXISTS homework_sessions (
      id                    TEXT PRIMARY KEY,
      family_id             TEXT NOT NULL,
      profile_id            TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      plan_id               TEXT,
      task_title            TEXT NOT NULL,
      items_json            TEXT NOT NULL DEFAULT '[]',
      subtasks_json         TEXT,
      planned_focus_minutes INTEGER NOT NULL,
      rounds_json           TEXT NOT NULL DEFAULT '[]',
      progress_json         TEXT,
      status                TEXT NOT NULL,
      verdict               TEXT,
      verdict_at            INTEGER,
      started_at            INTEGER NOT NULL,
      ended_at              INTEGER,
      updated_at            INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_homework_profile ON homework_sessions(profile_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_homework_family  ON homework_sessions(family_id);

    CREATE TABLE IF NOT EXISTS homework_plans (
      id          TEXT PRIMARY KEY,
      family_id   TEXT NOT NULL,
      profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      plan_date   TEXT NOT NULL,
      subject     TEXT,
      title       TEXT NOT NULL,
      items_json  TEXT NOT NULL DEFAULT '[]',
      created_by  TEXT NOT NULL DEFAULT 'parent',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      archived_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_plans_profile ON homework_plans(profile_id, plan_date);
    CREATE INDEX IF NOT EXISTS idx_plans_family  ON homework_plans(family_id);

    CREATE TABLE IF NOT EXISTS settings (
      family_id   TEXT PRIMARY KEY REFERENCES families(id) ON DELETE CASCADE,
      ai_json     TEXT NOT NULL,
      limits_json TEXT NOT NULL,
      tts_json    TEXT NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      family_id  TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      profile_id TEXT,
      role       TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS rewards (
      id                TEXT PRIMARY KEY,
      family_id         TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      profile_id        TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      name              TEXT NOT NULL,
      description       TEXT,
      emoji             TEXT NOT NULL,
      condition_type    TEXT NOT NULL,
      condition_value   INTEGER NOT NULL,
      requires_approval INTEGER NOT NULL DEFAULT 0,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rewards_profile ON rewards(profile_id);
    CREATE INDEX IF NOT EXISTS idx_rewards_family  ON rewards(family_id);

    CREATE TABLE IF NOT EXISTS reward_claims (
      id          TEXT PRIMARY KEY,
      family_id   TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      reward_id   TEXT NOT NULL REFERENCES rewards(id) ON DELETE CASCADE,
      profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      status      TEXT NOT NULL,
      claimed_at  INTEGER NOT NULL,
      approved_at INTEGER,
      approved_by TEXT,
      note        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_claims_profile ON reward_claims(profile_id, status);
    CREATE INDEX IF NOT EXISTS idx_claims_family  ON reward_claims(family_id);

    CREATE TABLE IF NOT EXISTS reward_codes (
      id          TEXT PRIMARY KEY,
      family_id   TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      code        TEXT NOT NULL UNIQUE,
      reward_name TEXT NOT NULL,
      reward_desc TEXT,
      created_at  INTEGER NOT NULL,
      used_at     INTEGER,
      used_by     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_codes_family ON reward_codes(family_id);
  `)

  // 老库升级：points_spent 列（已消费积分账本）在 CREATE TABLE IF NOT EXISTS 下不会补齐
  const profileCols = (db.prepare('PRAGMA table_info(profiles)').all() as { name: string }[]).map((c) => c.name)
  if (!profileCols.includes('points_spent')) {
    db.exec('ALTER TABLE profiles ADD COLUMN points_spent INTEGER NOT NULL DEFAULT 0;')
  }
}
