import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type {
  HomeworkPlan,
  HomeworkSession,
  LimitSettings,
  ProfileTtsPrefs,
  Settings,
  TrainingRecord,
  TtsSettings,
  TtsSource,
  TtsVerify,
} from '../shared/types'
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from '../shared/constants'
import { syncHomeworkRecords } from './records'
import { isTtsVerified, ttsFingerprint } from './tts-config'

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
  /** 该孩子的朗读偏好（顺序与音色）；0.13.0 起由孩子在设置页自管 */
  ttsPrefs?: ProfileTtsPrefs
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
  // 8 -> 9：朗读支持后端合成（Edge / OpenAI 兼容 TTS），settings 新增 tts 配置块。
  // 旧数据没有 tts，normalize 会用默认值补齐，无需改写已有字段。
  8: (s) => ({ ...s, schemaVersion: 9 }),
  // 9 -> 10：AI 设置新增可选 visionModel（视觉识题模型），历史数据没有该字段，
  // normalize 用默认空字符串补齐，无需改写已有字段。
  9: (s) => ({ ...s, schemaVersion: 10 }),
  // 10 -> 11：作业计划支持一天多份（按科目分组）。HomeworkPlan 新增可选 subject；
  // 历史单份计划没有 subject，按「未分类」处理，无需改写已有数据。
  10: (s) => ({ ...s, schemaVersion: 11 }),
  // 11 -> 12：视觉模型独立配置块 settings.ai.vision（可与对话模型不同厂商）。
  // 旧扁平字段 visionModel 迁入 vision.model，baseUrl/apiKey 留空表示继承对话配置；
  // 旧字段保留供回退读取，新代码不再写入。
  11: (s) => {
    const ai = s?.settings?.ai ?? {}
    const legacyVision = typeof ai.visionModel === 'string' ? ai.visionModel.trim() : ''
    const vision = ai.vision && typeof ai.vision === 'object' ? ai.vision : {}
    return {
      ...s,
      schemaVersion: 12,
      settings: {
        ...s?.settings,
        ai: {
          ...ai,
          vision: {
            baseUrl: String(vision.baseUrl ?? ''),
            model: String(vision.model ?? legacyVision),
            ...(vision.apiKey ? { apiKey: vision.apiKey } : {}),
            ...(vision.apiKeyMasked ? { apiKeyMasked: vision.apiKeyMasked } : {}),
          },
        },
      },
    }
  },
  // 12 -> 13：朗读从「单一合成服务」升级为「家长可编排的来源优先级」。
  // 旧 provider 挪到「原生之后」，并按旧配置算指纹直接标记为已试听——升级后孩子端读法与之前
  // 完全等价（原生可用仍走原生、缺失仍走原 provider），家长想改顺序再自己试听即可。
  12: (s) => {
    const tts = s?.settings?.tts ?? {}
    const provider: 'edge' | 'openai' = tts.provider === 'openai' ? 'openai' : 'edge'
    const openai = {
      baseUrl: String(tts.openai?.baseUrl ?? ''),
      model: String(tts.openai?.model ?? ''),
      voice: String(tts.openai?.voice ?? ''),
      apiKey: String(tts.openai?.apiKey ?? ''),
    }
    // 只有「升级前确实保存过这套配置」才视为已试听：旧数据里根本没有 tts 块的家庭
    // 本来就没走过后端合成，不能凭空给一个验证记录。
    const hadTtsBlock = !!s?.settings?.tts && typeof s.settings.tts === 'object'
    const edgeConfigured = hadTtsBlock && String(tts.voice ?? '') !== ''
    const openaiConfigured = !!openai.baseUrl && !!openai.model && !!openai.apiKey
    const record = (source: 'edge' | 'openai') => ({
      at: Date.now(),
      fingerprint: ttsFingerprint({ openai }, source),
    })
    const verified =
      provider === 'edge'
        ? edgeConfigured
          ? { edge: record('edge') }
          : {}
        : openaiConfigured
          ? { openai: record('openai') }
          : {}
    return {
      ...s,
      schemaVersion: 13,
      settings: {
        ...s?.settings,
        tts: {
          ...tts,
          provider,
          priority: ['native', provider],
          verified,
          lastFailure: null,
        },
      },
    }
  },
  // 13 -> 14：职责拆分——家长只管「启用哪几个来源」（enabled），顺序与音色迁到每个孩子的 ttsPrefs。
  // 旧 priority 整份复制为 enabled 与每个孩子的默认 order（升级后行为等价）；
  // 旧 voice / openai.voice 拷进各孩子 prefs，家长端不再编辑音色。
  // 指纹改为「只绑连接不绑音色」，这里按新算法重算 verified，避免升级后全员被迫重新试听。
  13: (s) => {
    const tts = s?.settings?.tts ?? {}
    const enabled = normalizeTtsEnabled(tts.priority)
    const openai = {
      baseUrl: String(tts.openai?.baseUrl ?? ''),
      model: String(tts.openai?.model ?? ''),
      apiKey: String(tts.openai?.apiKey ?? ''),
    }
    const edgeVoice = typeof tts.voice === 'string' && tts.voice ? tts.voice : undefined
    const openaiVoice = typeof tts.openai?.voice === 'string' && tts.openai.voice ? tts.openai.voice : undefined
    const recompute = (source: 'edge' | 'openai', old?: { at?: unknown; fingerprint?: unknown }) => {
      // 空指纹说明升级前就不是有效验证，不能凭空复活
      const oldFp = typeof old?.fingerprint === 'string' ? old.fingerprint : ''
      if (!old || !oldFp) return undefined
      return {
        at: Number(old.at) || Date.now(),
        fingerprint: ttsFingerprint({ openai }, source),
      }
    }
    const edgeRec = recompute('edge', tts.verified?.edge)
    const openaiRec = recompute('openai', tts.verified?.openai)
    const verified = {
      ...(edgeRec ? { edge: edgeRec } : {}),
      ...(openaiRec ? { openai: openaiRec } : {}),
    }
    const prefs: ProfileTtsPrefs = {
      order: [...enabled],
      voice: {
        ...(edgeVoice ? { edge: edgeVoice } : {}),
        ...(openaiVoice ? { openai: openaiVoice } : {}),
      },
    }
    return {
      ...s,
      schemaVersion: 14,
      settings: {
        ...s?.settings,
        tts: {
          ...tts,
          enabled,
          verified,
          lastFailure: null,
          // 旧字段保留一版供旧客户端回读，新代码不再写入
          priority: [...enabled],
        },
      },
      profiles: (Array.isArray(s?.profiles) ? s.profiles : []).map((p: any) => ({
        ...p,
        ttsPrefs: structuredClone(prefs),
      })),
    }
  },
  // 14 -> 15：未知厂商的默认音色由家长配置（openai.defaultVoice）。
  // 旧数据没有该字段，normalize 用空串补齐；已知厂商（SiliconFlow/官方）仍用内置默认，不受影响。
  14: (s) => ({
    ...s,
    schemaVersion: 15,
    settings: {
      ...s?.settings,
      tts: {
        ...(s?.settings?.tts ?? {}),
        openai: {
          ...(s?.settings?.tts?.openai ?? {}),
          defaultVoice: String(s?.settings?.tts?.openai?.defaultVoice ?? ''),
        },
      },
    },
  }),
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

/**
 * 清洗家长启用的朗读来源：只留合法来源、去重、最多 3 项。
 * 传入空值/非法值时回落到默认启用集（原生 + Edge），保证旧数据与旧客户端都能拿到可用集合。
 */
export function normalizeTtsEnabled(raw: unknown): TtsSource[] {
  const list = Array.isArray(raw) ? raw : []
  const out: TtsSource[] = []
  for (const item of list) {
    if (item !== 'native' && item !== 'edge' && item !== 'openai') continue
    if (out.includes(item)) continue
    out.push(item)
    if (out.length === 3) break
  }
  return out.length ? out : [...DEFAULT_SETTINGS.tts.enabled]
}

/** 清洗孩子端朗读偏好：order 只留合法来源去重；voice 只收字符串并截断 */
export function normalizeTtsPrefs(raw: unknown): ProfileTtsPrefs {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const order: TtsSource[] = []
  for (const item of Array.isArray(src.order) ? src.order : []) {
    if (item !== 'native' && item !== 'edge' && item !== 'openai') continue
    if (order.includes(item)) continue
    order.push(item)
    if (order.length === 3) break
  }
  const voiceSrc = src.voice && typeof src.voice === 'object' ? (src.voice as Record<string, unknown>) : {}
  const edge = typeof voiceSrc.edge === 'string' && voiceSrc.edge.trim() ? voiceSrc.edge.trim().slice(0, 80) : undefined
  const openai = typeof voiceSrc.openai === 'string' && voiceSrc.openai.trim() ? voiceSrc.openai.trim().slice(0, 80) : undefined
  return {
    order,
    voice: {
      ...(edge ? { edge } : {}),
      ...(openai ? { openai } : {}),
    },
  }
}

/** 孩子在设置页保存自己的朗读偏好；order 会与家长 enabled 取交集的清洗在 snapshot 计算时做 */
export function applyTtsPrefs(current: ProfileRecord, patch: Partial<ProfileTtsPrefs>): ProfileTtsPrefs {
  const base = normalizeTtsPrefs(current.ttsPrefs)
  const nextOrder = patch.order === undefined ? base.order : normalizeTtsPrefs({ order: patch.order }).order
  const nextVoice = patch.voice === undefined ? base.voice : normalizeTtsPrefs({ voice: patch.voice }).voice
  return { order: nextOrder, voice: nextVoice }
}

function normalizeTtsVerified(raw: unknown): TtsSettings['verified'] {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: TtsSettings['verified'] = {}
  for (const key of ['edge', 'openai'] as const) {
    const rec = src[key] as { at?: unknown; fingerprint?: unknown } | undefined
    const fingerprint = typeof rec?.fingerprint === 'string' ? rec.fingerprint : ''
    if (!fingerprint) continue
    out[key] = { at: Number(rec?.at) || 0, fingerprint } satisfies TtsVerify
  }
  return out
}

function normalizeTtsFailure(raw: unknown): TtsSettings['lastFailure'] {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as { source?: unknown; at?: unknown; message?: unknown }
  return {
    source: rec.source === 'openai' ? 'openai' : 'edge',
    at: Number(rec.at) || 0,
    message: String(rec.message ?? '').slice(0, 160),
  }
}

/** 迁移函数导出供测试：单测需要直接喂入旧版本数据验证迁移结果。 */
export function migrate(raw: any): AppState {
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
  // 客户端提交掩码值表示“不修改”
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
