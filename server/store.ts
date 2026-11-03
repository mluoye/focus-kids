import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { LimitSettings, Settings } from '../shared/types'
import { isTtsVerified } from './tts-config'
import { migrate as migrateRaw } from './store/migrations'
import {
  normalizeArithmeticDifficulty,
  normalizeArithmeticMode,
  normalizeStoryMathGrade,
  normalizeStoryMathTerm,
  normalizeStoryMathUnit,
  normalizeTtsEnabled,
  normalizeTtsPrefs,
  normalizeTtsVerified,
} from './store/normalizers'
import type { AppState } from './store/types'

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

/** 迁移 + 清洗一步到位（JSON → AppState），供 db/migrate.ts 使用。 */
export function migrate(raw: any): AppState {
  return migrateRaw(raw)
}

// ─── 存储健康 ────────────────────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE || './.data/app-state.db'

export interface StorageHealth {
  dataFile: string
  ok: boolean
  lastWriteAt: number
  lastWriteError: string | null
  lastLoadError: string | null
  corruptBackup: string | null
}

let lastWriteError: string | null = null

export function setWriteError(err: string | null): void {
  lastWriteError = err
}

export function getStorageHealth(): StorageHealth {
  return {
    dataFile: DB_FILE,
    ok: !lastWriteError,
    lastWriteAt: 0,
    lastWriteError,
    lastLoadError: null,
    corruptBackup: null,
  }
}

// ─── 清理备份 ────────────────────────────────────────────────────────────────

/** 清理前的强制备份：写入 DB_FILE 同目录 backup/ 下。 */
export async function writePruneBackup(payload: unknown, tag: string): Promise<string> {
  const backupDir = resolve(dirname(resolve(DB_FILE)), 'backup')
  await mkdir(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const name = `prune-${stamp}-${tag || 'all'}.json`
  await writeFile(resolve(backupDir, name), JSON.stringify(payload, null, 2), 'utf8')
  return `backup/${name}`
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
        defaultVoice:
          patch.tts?.openai?.defaultVoice === undefined
            ? current.tts.openai.defaultVoice
            : String(patch.tts.openai.defaultVoice).trim().slice(0, 80),
      },
      verified: current.tts.verified,
      lastFailure: current.tts.lastFailure,
      enabled:
        patch.tts?.enabled === undefined
          ? current.tts.enabled
          : normalizeTtsEnabled(patch.tts.enabled),
      priority: current.tts.priority,
      voice: current.tts.voice,
      provider: current.tts.provider,
    },
    updatedAt: Date.now(),
  }
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

/** 记录级 LWW 合并：以 id 去重，保留 updatedAt 较新的版本。已有序时跳过排序。 */
export function mergeById<T extends { id: string; updatedAt: number }>(base: T[], incoming: T[]): T[] {
  const map = new Map<string, T>()
  for (const item of base) map.set(item.id, item)
  for (const item of incoming) {
    const existing = map.get(item.id)
    if (!existing || (item.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
      map.set(item.id, item)
    }
  }
  const result = [...map.values()]
  let sorted = true
  for (let i = 1; i < result.length; i++) {
    if ((result[i].updatedAt ?? 0) < (result[i - 1].updatedAt ?? 0)) { sorted = false; break }
  }
  if (!sorted) result.sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0))
  return result
}

export { DB_FILE }
