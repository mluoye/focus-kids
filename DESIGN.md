# SQLite 多家庭架构重构设计

## 目标

从单文件 JSON + 单家庭，迁移到 `better-sqlite3` + 多家庭多小孩。

## 核心决策

- **驱动**：`better-sqlite3`（原生绑定，同步 API，性能最好）
- **WAL 模式**：并发读不阻塞写，适合 NAS 单进程多请求
- **迁移**：启动时检测 `app-state.json` 存在且 DB 不存在 → 自动导入 → 旧文件重命名为 `.migrated`
- **缓存策略**：每个家庭一个内存缓存（`FamilyCache`），首次访问时从 SQLite 加载，写操作同步刷入 SQLite
- **API 契约不变**：前端 `src/api/client.ts` 无需改动

## SQLite Schema

```sql
-- 家庭索引（登录用，不加载完整数据）
CREATE TABLE families (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  recovery_hash TEXT,
  recovery_updated_at INTEGER,
  child_pin_length INTEGER NOT NULL DEFAULT 4,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- 孩子（属于某个家庭）
CREATE TABLE profiles (
  id                    TEXT PRIMARY KEY,
  family_id             TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  avatar                TEXT NOT NULL,
  pin_hash              TEXT NOT NULL,
  created_at            INTEGER NOT NULL,
  points                INTEGER NOT NULL DEFAULT 0,
  badges_json           TEXT NOT NULL DEFAULT '[]',
  tts_prefs_json        TEXT,
  arithmetic_mode       TEXT,
  arithmetic_difficulty INTEGER,
  storymath_grade       INTEGER,
  storymath_term        INTEGER,
  storymath_unit        TEXT,  -- TEXT 兼容 'fun'
  updated_at            INTEGER NOT NULL
);
CREATE INDEX idx_profiles_family ON profiles(family_id);

-- 训练记录
CREATE TABLE training_records (
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
  passed                 INTEGER,          -- nullable boolean
  storymath_detail_json  TEXT,
  updated_at             INTEGER NOT NULL
);
CREATE INDEX idx_records_profile ON training_records(profile_id, started_at DESC);
CREATE INDEX idx_records_family  ON training_records(family_id);

-- 作业会话
CREATE TABLE homework_sessions (
  id                   TEXT PRIMARY KEY,
  family_id            TEXT NOT NULL,
  profile_id           TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan_id              TEXT,
  task_title           TEXT NOT NULL,
  items_json           TEXT NOT NULL DEFAULT '[]',
  subtasks_json        TEXT,              -- deprecated
  planned_focus_minutes INTEGER NOT NULL,
  rounds_json          TEXT NOT NULL DEFAULT '[]',
  progress_json        TEXT,
  status               TEXT NOT NULL,
  verdict              TEXT,
  verdict_at           INTEGER,
  started_at           INTEGER NOT NULL,
  ended_at             INTEGER,
  updated_at           INTEGER NOT NULL
);
CREATE INDEX idx_homework_profile ON homework_sessions(profile_id, started_at DESC);

-- 作业计划
CREATE TABLE homework_plans (
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
CREATE INDEX idx_plans_profile ON homework_plans(profile_id, plan_date);

-- 设置（每家庭一份）
CREATE TABLE settings (
  family_id   TEXT PRIMARY KEY REFERENCES families(id) ON DELETE CASCADE,
  ai_json     TEXT NOT NULL,
  limits_json TEXT NOT NULL,
  tts_json    TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- 会话 token
CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  family_id  TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  profile_id TEXT,
  role       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
```

## 存储层 API

```typescript
// server/db/index.ts — 数据库初始化 + 迁移
export function initDb(dbPath: string): void
export function getDb(): Database

// server/db/store.ts — 替代原 store.ts
export function getFamilyCache(familyId: string): FamilyCache  // 懒加载
export function getFamilyByToken(token: string): { familyId, session } | null
export function getFamilyByUsername(username: string): FamilyRecord | null
export function createFamily(record: FamilyRecord): void
export function updateFamily(familyId: string, patch: Partial<FamilyRecord>): void
export function persistFamily(familyId: string): void  // 写缓存到 SQLite
export function listFamilies(): FamilyRecord[]
export function countFamilies(): number

// 缓存结构
interface FamilyCache {
  family: FamilyRecord
  profiles: ProfileRecord[]
  records: TrainingRecord[]
  homework: HomeworkSession[]
  homeworkPlans: HomeworkPlan[]
  settings: Settings
  sessions: StoredSession[]
}
```

## 路由层改动

| 路由文件 | 改什么 |
|----------|--------|
| `middleware.ts` | `requireAuth` 从 `sessions` 表查 token，注入 `familyId` 到 `c.var` |
| `auth.ts` | `register` 不再 409；`login` 按用户名查 `families` 表；session 带 `familyId` |
| `profiles.ts` | `getState()` → `getFamilyCache(familyId)` |
| `state.ts` | 同上；`saveState()` → `persistFamily(familyId)` |
| `ai.ts` / `ai.storymath.ts` | 无变化（不直接访问 store） |
| `tts.ts` | 同 state.ts |

## 业务逻辑改动

| 文件 | 改什么 |
|------|--------|
| `awards.ts` | 函数签名 `AppState` → `FamilyCache`；逻辑不变 |
| `snapshot.ts` | `buildSnapshot(role, profileId)` → `buildSnapshot(familyId, role, profileId)` |
| `records.ts` | `syncHomeworkRecords(state)` → `syncHomeworkRecords(cache)` |
| `store/normalizers.ts` | 不变 |
| `store/migrations.ts` | JSON → SQLite 一次性迁移脚本 |
| `store/types.ts` | 新增 `FamilyCache` 类型 |

## 前端改动

**无**。API 契约不变，前端 `src/api/client.ts`、Pinia stores 均不需要修改。

## 迁移策略

```
启动时 initDb():
  1. 打开/创建 app-state.db
  2. 执行 CREATE TABLE IF NOT EXISTS
  3. 检查 app-state.json 是否存在
     → 存在且 families 表为空 → 自动导入
     → 导入后 rename app-state.json → app-state.json.migrated
  4. WAL 模式 + foreign_keys ON
```

## 文件结构

```
server/
  db/
    index.ts        — 数据库初始化、WAL、迁移入口
    schema.ts       — CREATE TABLE 语句
    store.ts        — FamilyCache CRUD、懒加载、persistFamily
  store/
    types.ts        — FamilyCache、FamilyRecord、ProfileRecord 等类型（保留）
    normalizers.ts  — 不变
    migrations.ts   — JSON → SQLite 迁移逻辑（改造）
  routes/
    ...（路由文件，改 import + 函数调用）
```

## 不做的事

- 不做跨家庭数据共享
- 不做家庭间权限（每个家庭完全隔离）
- 不做 SQLite 全文搜索（数据量不需要）
- 不改前端 API 契约
