import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { LimitSettings, Settings } from '../shared/types'
import { isTtsVerified } from './tts-config'
import { migrate as migrateRaw, emptyState } from './store/migrations'
import {
  normalizeArithmeticDifficulty,
  normalizeArithmeticMode,
  normalizeStoryMathGrade,
  normalizeStoryMathTerm,
  normalizeStoryMathUnit,
  normalizeTtsEnabled,
  normalizeTtsFailure,
  normalizeTtsPrefs,
  normalizeTtsVerified,
} from './store/normalizers'
import type { AppState, FamilyRecord, ProfileRecord, StoredSession } from './store/types'

// ─── 类型与清洗函数 re-export（向后兼容） ─────────────────────────────────────

export type { AppState, FamilyRecord, ProfileRecord, StoredSession } from './store/types'
export {
  applyTtsPrefs,
  normalizeArithmeticDifficulty,
  normalizeArithmeticMode,
  normalizeStoryMathGrade,
  normalizeStoryMathTerm,
  normalizeStoryMathUnit,
  normalizeTtsEnabled,
  normalizeTtsPrefs,
} from './store/normalizers'

/** 迁移 + 清洗一步到位，与重构前 store.ts 的 migrate() 行为一致。 */
export function migrate(raw: any): AppState {
  return normalize(migrateRaw(raw))
}

// ─── 常量与运行时状态 ─────────────────────────────────────────────────────────

const DATA_FILE = process.env.DATA_FILE || './.data/app-state.json'

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

// ─── 状态清洗 ─────────────────────────────────────────────────────────────────

function normalize(raw: any): AppState {
  const base = emptyState()
  const merged: AppState = {
    ...base,
    ...raw,
    meta: { ...base.meta, ...(raw?.meta ?? {}) },
    settings: {
      ...base.settings,
      ...(raw?.settings ?? {}),
      ai: {
        ...base.settings.ai,
        ...(raw?.settings?.ai ?? {}),
        vision: {
          ...base.settings.ai.vision,
          ...(raw?.settings?.ai?.vision ?? {}),
        },
      },
      limits: { ...base.settings.limits, ...(raw?.settings?.limits ?? {}) },
      tts: {
        ...base.settings.tts,
        ...(raw?.settings?.tts ?? {}),
        enabled: normalizeTtsEnabled(raw?.settings?.tts?.enabled ?? raw?.settings?.tts?.priority),
        verified: normalizeTtsVerified(raw?.settings?.tts?.verified),
        lastFailure: normalizeTtsFailure(raw?.settings?.tts?.lastFailure),
        openai: {
          ...base.settings.tts.openai,
          ...(raw?.settings?.tts?.openai ?? {}),
          defaultVoice: String(raw?.settings?.tts?.openai?.defaultVoice ?? '').trim().slice(0, 80),
        },
      },
    },
    profiles: (Array.isArray(raw?.profiles) ? raw.profiles : []).map((p: any) => ({
      ...p,
      ttsPrefs: normalizeTtsPrefs(p?.ttsPrefs),
      arithmeticMode: normalizeArithmeticMode(p?.arithmeticMode),
      arithmeticDifficulty: normalizeArithmeticDifficulty(p?.arithmeticDifficulty),
      storymathGrade: normalizeStoryMathGrade(p?.storymathGrade),
      storymathTerm: normalizeStoryMathTerm(p?.storymathTerm),
      storymathUnit: normalizeStoryMathUnit(p?.storymathUnit),
    })),
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

// ─── 加载 / 保存 ──────────────────────────────────────────────────────────────

export async function loadState(): Promise<AppState> {
  if (loaded) return state
  try {
    const text = await readFile(DATA_FILE, 'utf8')
    state = normalize(migrate(JSON.parse(text)))
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

/** 清理前的强制备份：写入 DATA_FILE 同目录 backup/ 下，返回相对文件名（如 backup/prune-….json）。 */
export async function writePruneBackup(payload: unknown, tag: string): Promise<string> {
  const backupDir = resolve(dirname(DATA_FILE), 'backup')
  await mkdir(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const name = `prune-${stamp}-${tag || 'all'}.json`
  await writeFile(resolve(backupDir, name), JSON.stringify(payload, null, 2), 'utf8')
  return `backup/${name}`
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

// ─── 设置脱敏与补丁 ───────────────────────────────────────────────────────────

function maskKey(key: string): string {
  return key ? `${'*'.repeat(Math.max(0, key.length - 4))}${key.slice(-4)}` : ''
}

export function sanitizeSettings(settings: Settings): Settings {
  const apiKey = process.env.AI_API_KEY || settings.ai.apiKey || ''
  const visionKey = process.env.AI_VISION_API_KEY || settings.ai.vision?.apiKey || ''
  const ttsKey = settings.tts.openai.apiKey || ''
  return {
    ...settings,
    ai: {
      ...settings.ai,
      apiKey: undefined,
      apiKeyMasked: maskKey(apiKey),
      vision: {
        baseUrl: settings.ai.vision?.baseUrl ?? '',
        model: settings.ai.vision?.model ?? '',
        apiKey: undefined,
        apiKeyMasked: maskKey(visionKey),
      },
    },
    tts: {
      ...settings.tts,
      // 指纹对不上的验证不下发：家长端因此显示「未试听」，而库里仍留着旧记录，
      // 配置改回原值时验证自动复活，不需要重新试听。
      verified: normalizeTtsVerified({
        ...(isTtsVerified(settings.tts, 'edge') ? { edge: settings.tts.verified?.edge } : {}),
        ...(isTtsVerified(settings.tts, 'openai') ? { openai: settings.tts.verified?.openai } : {}),
      }),
      openai: {
        ...settings.tts.openai,
        apiKey: undefined,
        apiKeyMasked: maskKey(ttsKey),
      },
    },
  }
}

export function applySettingsPatch(current: Settings, patch: Partial<Settings>): Settings {
  const next: Settings = {
    ...current,
    ...patch,
    ai: {
      ...current.ai,
      ...(patch.ai ?? {}),
      vision: {
        ...current.ai.vision,
        ...(patch.ai?.vision ?? {}),
      },
    },
    limits: { ...current.limits, ...(patch.limits ?? {}) } as LimitSettings,
    tts: {
      ...current.tts,
      ...(patch.tts ?? {}),
      openai: {
        ...current.tts.openai,
        ...(patch.tts?.openai ?? {}),
        // 未知厂商默认音色由家长填；清洗为截断字符串（空串=留空，走内置/后续校验）
        defaultVoice:
          patch.tts?.openai?.defaultVoice === undefined
            ? current.tts.openai.defaultVoice
            : String(patch.tts.openai.defaultVoice).trim().slice(0, 80),
      },
      // 验证记录、失败记录、孩子端偏好由服务端独占，客户端提交一律忽略
      verified: current.tts.verified,
      lastFailure: current.tts.lastFailure,
      enabled:
        patch.tts?.enabled === undefined
          ? current.tts.enabled
          : normalizeTtsEnabled(patch.tts.enabled),
      // 0.13.0 起旧字段只读；客户端若仍提交，忽略以免污染 deprecated 回读路径
      priority: current.tts.priority,
      voice: current.tts.voice,
      provider: current.tts.provider,
    },
    updatedAt: Date.now(),
  }
  // 客户端提交掩码值表示"不修改"
  if (patch.ai?.apiKey && !patch.ai.apiKey.includes('*')) {
    next.ai.apiKey = patch.ai.apiKey.trim()
  } else {
    next.ai.apiKey = current.ai.apiKey
  }
  const visionKey = patch.ai?.vision?.apiKey
  if (visionKey && !visionKey.includes('*')) {
    next.ai.vision.apiKey = visionKey.trim()
  } else {
    next.ai.vision.apiKey = current.ai.vision?.apiKey
  }
  const ttsKey = patch.tts?.openai?.apiKey
  if (ttsKey && !ttsKey.includes('*')) {
    next.tts.openai.apiKey = ttsKey.trim()
  } else {
    next.tts.openai.apiKey = current.tts.openai.apiKey
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
