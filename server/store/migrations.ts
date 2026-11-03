import { DEFAULT_SETTINGS, SCHEMA_VERSION } from '../../shared/constants'
import type { ProfileTtsPrefs } from '../../shared/types'
import type { AppState } from './types'
import { syncHomeworkRecords } from '../records'
import { ttsFingerprint } from '../tts-config'
import {
  normalizeArithmeticDifficulty,
  normalizeArithmeticMode,
  normalizeStoryMathGrade,
  normalizeStoryMathTerm,
  normalizeStoryMathUnit,
  normalizeTtsEnabled,
} from './normalizers'

export function emptyState(): AppState {
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
  // 4 -> 5：番茄钟引入「正/负」判定。历史已完成会话按旧规则视为 pass（不追溯扣分）
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
  // 5 -> 6：家长账号支持恢复码。历史账号没有恢复码，不改动已有数据。
  5: (s) => ({ ...s, schemaVersion: 6 }),
  // 6 -> 7：家长可提前录入当天作业清单，历史数据补空数组即可。
  6: (s) => ({ ...s, schemaVersion: 7, homeworkPlans: [] }),
  // 7 -> 8：作业清单项可带科目 emoji（icon），历史清单前端自动识别，无需改写。
  7: (s) => ({ ...s, schemaVersion: 8 }),
  // 8 -> 9：朗读支持后端合成（Edge / OpenAI 兼容 TTS），settings 新增 tts 配置块。
  8: (s) => ({ ...s, schemaVersion: 9 }),
  // 9 -> 10：AI 设置新增可选 visionModel（视觉识题模型）。
  9: (s) => ({ ...s, schemaVersion: 10 }),
  // 10 -> 11：作业计划支持一天多份（按科目分组），HomeworkPlan 新增可选 subject。
  10: (s) => ({ ...s, schemaVersion: 11 }),
  // 11 -> 12：视觉模型独立配置块 settings.ai.vision（可与对话模型不同厂商）。
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
  12: (s) => {
    const tts = s?.settings?.tts ?? {}
    const provider: 'edge' | 'openai' = tts.provider === 'openai' ? 'openai' : 'edge'
    const openai = {
      baseUrl: String(tts.openai?.baseUrl ?? ''),
      model: String(tts.openai?.model ?? ''),
      voice: String(tts.openai?.voice ?? ''),
      apiKey: String(tts.openai?.apiKey ?? ''),
    }
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
  // 15 -> 16：口算速算作答方式按孩子设置（arithmeticMode）。
  15: (s) => ({
    ...s,
    schemaVersion: 16,
    profiles: (Array.isArray(s?.profiles) ? s.profiles : []).map((p: any) => ({
      ...p,
      arithmeticMode: normalizeArithmeticMode(p?.arithmeticMode),
    })),
  }),
  // 16 -> 17：口算速算默认难度按孩子设置（arithmeticDifficulty）。
  16: (s) => ({
    ...s,
    schemaVersion: 17,
    profiles: (Array.isArray(s?.profiles) ? s.profiles : []).map((p: any) => ({
      ...p,
      arithmeticDifficulty: normalizeArithmeticDifficulty(p?.arithmeticDifficulty),
    })),
  }),
  // 17 -> 18：AI 应用题默认年级按孩子设置（storymathGrade）。
  17: (s) => ({
    ...s,
    schemaVersion: 18,
    profiles: (Array.isArray(s?.profiles) ? s.profiles : []).map((p: any) => ({
      ...p,
      storymathGrade: normalizeStoryMathGrade(p?.storymathGrade),
    })),
  }),
  // 18 -> 19：AI 应用题逐题明细（storymathDetail）可选字段。
  18: (s) => ({ ...s, schemaVersion: 19 }),
  // 19 -> 20：AI 应用题教材学期/当前单元按孩子设置（storymathTerm/storymathUnit）。
  19: (s) => ({
    ...s,
    schemaVersion: 20,
    profiles: (Array.isArray(s?.profiles) ? s.profiles : []).map((p: any) => ({
      ...p,
      storymathTerm: normalizeStoryMathTerm(p?.storymathTerm),
      storymathUnit: normalizeStoryMathUnit(p?.storymathUnit),
    })),
  }),
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
  return current as AppState
}
