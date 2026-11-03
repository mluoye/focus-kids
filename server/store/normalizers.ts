import type {
  ArithmeticDifficulty,
  ArithmeticMode,
  MathTerm,
  MathUnitNo,
  ProfileTtsPrefs,
  StoryMathGrade,
  TtsSettings,
  TtsSource,
  TtsVerify,
} from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/constants'

/**
 * 持久化字段的运行时清洗：只收合法枚举、去重、截断，不抛异常。
 * 供 store 迁移和路由层共用，保证旧数据 / 畸形请求不会把脏值写进 app-state.json。
 */

// ─── TTS ─────────────────────────────────────────────────────────────────────

/** 家长端「启用了哪些合成来源」：只留合法枚举、去重、上限 3 项，空则回落默认。 */
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

/** 清洗孩子端朗读偏好：order 只留合法来源去重；voice 只收字符串并截断。 */
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

/** 孩子在设置页保存自己的朗读偏好；order 与家长 enabled 的交集清洗在 snapshot 计算时做。 */
export function applyTtsPrefs(
  current: { ttsPrefs?: ProfileTtsPrefs },
  patch: Partial<ProfileTtsPrefs>,
): ProfileTtsPrefs {
  const base = normalizeTtsPrefs(current.ttsPrefs)
  const nextOrder = patch.order === undefined ? base.order : normalizeTtsPrefs({ order: patch.order }).order
  const nextVoice = patch.voice === undefined ? base.voice : normalizeTtsPrefs({ voice: patch.voice }).voice
  return { order: nextOrder, voice: nextVoice }
}

// ─── 口算速算 ─────────────────────────────────────────────────────────────────

/** 作答方式：只收合法枚举，缺省 choice（选项四选一）。 */
export function normalizeArithmeticMode(raw: unknown): ArithmeticMode {
  return raw === 'keypad' ? 'keypad' : 'choice'
}

/** 默认难度：只收 1/2/3，缺省 1（20 以内加减）。 */
export function normalizeArithmeticDifficulty(raw: unknown): ArithmeticDifficulty {
  return raw === 2 || raw === 3 ? raw : 1
}

// ─── AI 应用题 ────────────────────────────────────────────────────────────────

/** 默认年级：只收 1~6，缺省 1（一年级）。 */
export function normalizeStoryMathGrade(raw: unknown): StoryMathGrade {
  return raw === 2 || raw === 3 || raw === 4 || raw === 5 || raw === 6 ? raw : 1
}

/** 教材学期：只收 1/2，缺省 1（上册）。 */
export function normalizeStoryMathTerm(raw: unknown): MathTerm {
  return raw === 2 ? 2 : 1
}

/** 当前单元：数字（≥1）或「fun」；缺省 1（上册第 1 单元）。 */
export function normalizeStoryMathUnit(raw: unknown): MathUnitNo {
  if (raw === 'fun') return 'fun'
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 ? raw : 1
}

// ─── TTS 内部字段（normalize 用，不导出到路由层） ─────────────────────────────

export function normalizeTtsVerified(raw: unknown): TtsSettings['verified'] {
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

export function normalizeTtsFailure(raw: unknown): TtsSettings['lastFailure'] {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as { source?: unknown; at?: unknown; message?: unknown }
  return {
    source: rec.source === 'openai' ? 'openai' : 'edge',
    at: Number(rec.at) || 0,
    message: String(rec.message ?? '').slice(0, 160),
  }
}
