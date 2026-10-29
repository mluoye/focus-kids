import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type {
  HomeworkPlan,
  HomeworkSession,
  LimitSettings,
  Settings,
  TrainingRecord,
} from '../shared/types'
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from '../shared/constants'
import { syncHomeworkRecords } from './records'

export interface FamilyRecord {
  id: string
  username: string
  passwordHash: string
  /** 恢复码的 scrypt 哈希（不含分隔符的大写形式）；未生成过时为空。0.4.0 新增 */
  recoveryHash?: string
  /** 最近一次生成/更换恢复码的时间 */
  recoveryUpdatedAt?: number
  childPinLength: number
  createdAt: number
}

export interface ProfileRecord {
  id: string
  name: string
  avatar: string
  pinHash: string
  createdAt: number
  points: number
  badges: { id: string; unlockedAt: number }[]
}

export interface StoredSession {
  token: string
  role: 'parent' | 'child'
  profileId?: string
  createdAt: number
  expiresAt: number
}

export interface AppState {
  schemaVersion: number
  meta: { createdAt: number; updatedAt: number }
  family: FamilyRecord | null
  profiles: ProfileRecord[]
  records: TrainingRecord[]
  homework: HomeworkSession[]
  homeworkPlans: HomeworkPlan[]
  settings: Settings
  sessions: StoredSession[]
}

const DATA_FILE = process.env.DATA_FILE || './.data/app-state.json'

function emptyState(): AppState {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: { createdAt: Date.now(), updatedAt: Date.now() },
    family: null,
    profiles: [],
    records: [],
    homework: [],
    homeworkPlans: [],
    settings: structuredClone(DEFAULT_SETTINGS),
    sessions: [],
  }
}

/** 迁移函数表：结构变更必须新增条目并更新 SCHEMA_VERSION。 */
const migrations: Record<number, (s: any) => any> = {
  // 0 -> 1：初始结构
  0: () => emptyState(),
  // 1 -> 2：作业子步骤 subtasks 升级为可勾选的清单 items
  1: (s) => ({
    ...s,
    schemaVersion: 2,
    homework: (Array.isArray(s?.homework) ? s.homework : []).map((h: any) => {
      const legacy = Array.isArray(h?.subtasks) ? h.subtasks : []
      const items = Array.isArray(h?.items) ? h.items : legacy.map((title: any, i: number) => ({
        id: `item_${h?.id ?? 'h'}_${i}`,
        title: String(title).slice(0, 60),
        done: false,
      }))
      const { subtasks, ...rest } = h ?? {}
      return { ...rest, items }
    }),
  }),
  // 2 -> 3：作业会话新增可选的 progress（离开页面后的恢复状态），旧数据保持 undefined
  2: (s) => ({ ...s, schemaVersion: 3 }),
  // 3 -> 4：已完成的作业会话补一条番茄钟训练记录（rec_hw_<会话id>），积分随之由记录统一推导
  3: (s) => {
    const next = {
      ...s,
      schemaVersion: 4,
      records: Array.isArray(s?.records) ? [...s.records] : [],
      homework: Array.isArray(s?.homework) ? s.homework : [],
    }
    syncHomeworkRecords(next as unknown as AppState)
    return next
  },
  // 4 -> 5：番茄钟引入「正/负」判定。历史已完成会话按旧规则视为 pass（不追溯扣分），
  // 新会话由服务端按清单完成情况判定；已有派生记录回填 passed。
  4: (s) => ({
    ...s,
    schemaVersion: 5,
    records: (Array.isArray(s?.records) ? s.records : []).map((r: any) =>
      r?.module === 'pomodoro' ? { ...r, passed: r.passed ?? true } : r,
    ),
    homework: (Array.isArray(s?.homework) ? s.homework : []).map((h: any) =>
      h?.status === 'done'
        ? { ...h, verdict: h.verdict ?? 'pass', verdictAt: h.verdictAt ?? h.endedAt ?? h.updatedAt }
        : h,
    ),
  }),
  // 5 -> 6：家长账号支持恢复码。历史账号没有恢复码（recoveryHash 为空），
  // 需要在家长中心「账号」页生成，或用 npm run reset:password 重置；不改动已有数据。
  5: (s) => ({ ...s, schemaVersion: 6 }),
  // 6 -> 7：家长可提前录入当天作业清单。历史数据没有计划，补空数组即可；
  // 已有会话不带 planId，按「孩子自建清单」处理，判定与积分口径不变。
  6: (s) => ({ ...s, schemaVersion: 7, homeworkPlans: [] }),
  // 7 -> 8：低年级可读性。作业清单项可带科目 emoji（icon），可选字段；
  // 历史清单没有 icon，前端按标题自动识别，无需改写已有数据。
  7: (s) => ({ ...s, schemaVersion: 8 }),
}

let state: AppState = emptyState()
let writeChain: Promise<void> = Promise.resolve()
let loaded = false

/** 写入重试次数；失败不会中断请求，但会记录并在 /api/health 与响应头暴露。 */
const WRITE_RETRY = 3

let lastWriteAt = 0
let lastWriteError: string | null = null
let lastLoadError: string | null = null
let corruptBackup: string | null = null

export interface StorageHealth {
  dataFile: string
  ok: boolean
  lastWriteAt: number
  lastWriteError: string | null
  lastLoadError: string | null
  /** 数据文件损坏时保留的副本路径，便于人工恢复 */
  corruptBackup: string | null
}

export function getStorageHealth(): StorageHealth {
  return {
    dataFile: DATA_FILE,
    ok: !lastWriteError,
    lastWriteAt,
    lastWriteError,
    lastLoadError,
    corruptBackup,
  }
}

function migrate(raw: any): AppState {
  let current = raw
  let version = Number(current?.schemaVersion ?? 0)
  while (version < SCHEMA_VERSION) {
    const fn = migrations[version]
    if (!fn) break
    current = fn(current)
    version = Number(current?.schemaVersion ?? version + 1)
  }
  return normalize(current)
}

function normalize(raw: any): AppState {
  const base = emptyState()
  const merged: AppState = {
    ...base,
    ...raw,
    meta: { ...base.meta, ...(raw?.meta ?? {}) },
    settings: {
      ...base.settings,
      ...(raw?.settings ?? {}),
      ai: { ...base.settings.ai, ...(raw?.settings?.ai ?? {}) },
      limits: { ...base.settings.limits, ...(raw?.settings?.limits ?? {}) },
    },
    profiles: Array.isArray(raw?.profiles) ? raw.profiles : [],
    records: Array.isArray(raw?.records) ? raw.records : [],
    homework: (Array.isArray(raw?.homework) ? raw.homework : []).map((h: any) => ({
      ...h,
      items: Array.isArray(h?.items) ? h.items : [],
    })),
    homeworkPlans: (Array.isArray(raw?.homeworkPlans) ? raw.homeworkPlans : []).map((p: any) => ({
      ...p,
      items: Array.isArray(p?.items) ? p.items : [],
    })),
    sessions: Array.isArray(raw?.sessions) ? raw.sessions : [],
  }
  return merged
}

export async function loadState(): Promise<AppState> {
  if (loaded) return state
  try {
    const text = await readFile(DATA_FILE, 'utf8')
    state = migrate(JSON.parse(text))
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      state = emptyState()
    } else {
      // 解析或迁移失败时绝不能「用空状态覆盖原文件」：先把原文件改名保留下来。
      lastLoadError = err?.message ?? String(err)
      console.error(`[store] 读取数据文件失败：${lastLoadError}`)
      try {
        const backup = `${DATA_FILE}.corrupt-${Date.now()}`
        await rename(DATA_FILE, backup)
        corruptBackup = backup
        console.error(`[store] 原文件已保留为 ${backup}，请人工检查后再决定是否恢复`)
      } catch (backupErr: any) {
        if (backupErr?.code !== 'ENOENT') console.error('[store] 保留损坏文件失败：', backupErr)
      }
      state = emptyState()
    }
  }
  loaded = true
  // 清理过期会话
  const now = Date.now()
  const before = state.sessions.length
  state.sessions = state.sessions.filter((s) => s.expiresAt > now)
  if (state.sessions.length !== before) await saveState()
  return state
}

export function getState(): AppState {
  return state
}

export function touchState() {
  state.meta.updatedAt = Date.now()
}

async function writePayload(payload: string): Promise<void> {
  await mkdir(dirname(DATA_FILE), { recursive: true })
  const tmp = `${DATA_FILE}.${process.pid}.tmp`
  await writeFile(tmp, payload, 'utf8')
  await rename(tmp, DATA_FILE)
}

/** 原子写入：先写临时文件再 rename，避免容器中断导致数据损坏；失败自动重试。 */
export function saveState(): Promise<void> {
  touchState()
  const payload = JSON.stringify(state, null, 2)
  writeChain = writeChain.then(async () => {
    let lastErr: any = null
    for (let attempt = 1; attempt <= WRITE_RETRY; attempt += 1) {
      try {
        await writePayload(payload)
        lastWriteAt = Date.now()
        lastWriteError = null
        return
      } catch (err) {
        lastErr = err
        if (attempt < WRITE_RETRY) await delay(200 * attempt)
      }
    }
    lastWriteError = lastErr?.message ?? String(lastErr)
    console.error(`[store] 写入数据文件失败（已重试 ${WRITE_RETRY} 次）：${lastWriteError}`)
  })
  return writeChain
}

export function sanitizeSettings(settings: Settings): Settings {
  const apiKey = process.env.AI_API_KEY || settings.ai.apiKey || ''
  return {
    ...settings,
    ai: {
      ...settings.ai,
      apiKey: undefined,
      apiKeyMasked: apiKey ? `${'*'.repeat(Math.max(0, apiKey.length - 4))}${apiKey.slice(-4)}` : '',
    },
  }
}

export function applySettingsPatch(current: Settings, patch: Partial<Settings>): Settings {
  const next: Settings = {
    ...current,
    ...patch,
    ai: { ...current.ai, ...(patch.ai ?? {}) },
    limits: { ...current.limits, ...(patch.limits ?? {}) } as LimitSettings,
    updatedAt: Date.now(),
  }
  // 客户端提交掩码值表示“不修改”
  if (patch.ai?.apiKey && !patch.ai.apiKey.includes('*')) {
    next.ai.apiKey = patch.ai.apiKey.trim()
  } else {
    next.ai.apiKey = current.ai.apiKey
  }
  return next
}

/** 记录级 LWW 合并：以 id 去重，保留 updatedAt 较新的版本。 */
export function mergeById<T extends { id: string; updatedAt: number }>(base: T[], incoming: T[]): T[] {
  const map = new Map<string, T>()
  for (const item of base) map.set(item.id, item)
  for (const item of incoming) {
    const existing = map.get(item.id)
    if (!existing || (item.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
      map.set(item.id, item)
    }
  }
  return [...map.values()].sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0))
}

export { DATA_FILE }
