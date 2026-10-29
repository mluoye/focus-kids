import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  HomeworkSession,
  LimitSettings,
  Settings,
  TrainingRecord,
} from '../shared/types'
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from '../shared/constants'

export interface FamilyRecord {
  id: string
  username: string
  passwordHash: string
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
}

let state: AppState = emptyState()
let writeChain: Promise<void> = Promise.resolve()
let loaded = false

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
    if (err?.code !== 'ENOENT') {
      console.error('[store] 读取数据文件失败，使用空状态：', err)
    }
    state = emptyState()
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

/** 原子写入：先写临时文件再 rename，避免容器中断导致数据损坏。 */
export function saveState(): Promise<void> {
  touchState()
  const payload = JSON.stringify(state, null, 2)
  writeChain = writeChain.then(async () => {
    await mkdir(dirname(DATA_FILE), { recursive: true })
    const tmp = `${DATA_FILE}.${process.pid}.tmp`
    await writeFile(tmp, payload, 'utf8')
    await rename(tmp, DATA_FILE)
  }).catch((err) => {
    console.error('[store] 写入数据文件失败：', err)
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
