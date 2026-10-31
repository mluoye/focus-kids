import { createHash } from 'node:crypto'
import { TTS_EDGE_VOICES, TTS_VOICE_PRESETS, ttsVoiceVendor } from '../shared/constants'
import type { ProfileTtsPrefs, TtsOpenaiSettings, TtsSettings, TtsSource, TtsVoiceOption } from '../shared/types'

/** 后端来源（服务端能合成的只有这两个）；native 由浏览器自行探测，服务端不参与 */
export type BackendTtsSource = Exclude<TtsSource, 'native'>

/**
 * 指纹只看「连接配置」，不绑音色：试听只证明连得通，孩子换音色不该逼家长重新试听。
 * - edge 没有任何连接配置项，指纹为常量 → 试听通过即长期有效
 * - openai 只含 baseUrl | model | apiKey
 */
export function ttsFingerprint(tts: { openai?: Pick<TtsOpenaiSettings, 'baseUrl' | 'model' | 'apiKey'> }, source: BackendTtsSource): string {
  const material =
    source === 'edge'
      ? ['edge']
      : [
          'openai',
          tts.openai?.baseUrl ?? '',
          tts.openai?.model ?? '',
          tts.openai?.apiKey ?? '',
        ]
  return createHash('sha256').update(material.join('|')).digest('hex').slice(0, 16)
}

/**
 * 当前配置是否仍是「试听通过时的那份连接」。
 * 改过 baseUrl / model / apiKey 任意一项，旧验证自动失效，需要重新试听；改音色不影响。
 */
export function isTtsVerified(tts: TtsSettings, source: BackendTtsSource): boolean {
  const record = tts.verified?.[source]
  return !!record && record.fingerprint === ttsFingerprint(tts, source)
}

/** openai 兼容来源缺少的必填项；空数组表示齐全 */
export function missingOpenaiConfig(tts: TtsSettings): string[] {
  const missing: string[] = []
  if (!tts.openai.baseUrl) missing.push('baseUrl')
  if (!tts.openai.model) missing.push('model')
  if (!tts.openai.apiKey) missing.push('apiKey')
  return missing
}

/**
 * 按厂商裁剪后的音色候选：edge 固定 4 个中文神经语音；
 * openai 按 baseUrl 识别 SiliconFlow / 官方，识别不出只留自定义（空清单 + 前端可自填）。
 */
export function ttsVoiceOptions(tts: TtsSettings): { edge: TtsVoiceOption[]; openai: TtsVoiceOption[] } {
  const vendor = ttsVoiceVendor(tts.openai?.baseUrl ?? '')
  return {
    edge: TTS_EDGE_VOICES,
    openai: vendor === 'siliconflow' ? TTS_VOICE_PRESETS.siliconflow : vendor === 'openai' ? TTS_VOICE_PRESETS.openai : [],
  }
}

/**
 * 该来源的内置默认音色（不读 settings 里已弃用的音色字段）。
 * - edge：固定晓晓。
 * - openai 已知厂商：SiliconFlow 用 `anna`（不认 OpenAI 官方的 `alloy`，即使补了 `模型名:` 前缀仍 400）；
 *   OpenAI 官方用 `alloy`。
 * - openai 未知厂商：用家长配置的 `defaultVoice`；**没配则返回 null**（试听与合成需先报 `TTS_VOICE_NOT_SET`）。
 */
export function defaultTtsVoice(source: BackendTtsSource, tts: Pick<TtsSettings, 'openai'>): string | null {
  if (source === 'edge') return TTS_EDGE_VOICES[0]!.value
  const vendor = ttsVoiceVendor(tts.openai?.baseUrl ?? '')
  if (vendor === 'siliconflow') return TTS_VOICE_PRESETS.siliconflow[0]!.value
  if (vendor === 'openai') return 'alloy'
  // 未知厂商：只能依赖家长配置的默认音色，否则无法确定该厂商认哪个音色
  const fromDefault = typeof tts.openai?.defaultVoice === 'string' ? tts.openai.defaultVoice.trim() : ''
  return fromDefault || null
}

/** OpenAI 官方固定音色；SiliconFlow 对这些名字一律拒绝 */
const OPENAI_OFFICIAL_VOICES = new Set(TTS_VOICE_PRESETS.openai.map((v) => v.value))

/**
 * 解析最终音色：孩子选择 > settings 兜底 > 厂商内置默认；孩子传了空串视为未选。
 * 返回 null 表示「未知厂商且家长没配默认音色」，调用方应返回 `TTS_VOICE_NOT_SET`。
 */
export function resolveTtsVoice(
  source: BackendTtsSource,
  prefs: Pick<ProfileTtsPrefs, 'voice'> | undefined | null,
  tts: TtsSettings,
  raw?: string | null,
): string | null {
  const cleaned = typeof raw === 'string' ? raw.trim() : ''
  if (cleaned) return cleaned
  const fromPrefs = source === 'edge' ? prefs?.voice?.edge : prefs?.voice?.openai
  if (fromPrefs && String(fromPrefs).trim()) return String(fromPrefs).trim()
  if (source === 'edge') {
    const fromSettings = typeof tts.voice === 'string' ? tts.voice.trim() : ''
    return fromSettings || defaultTtsVoice('edge', tts)
  }
  const openaiVoice = typeof tts.openai?.voice === 'string' ? tts.openai.voice.trim() : ''
  if (openaiVoice && !OPENAI_OFFICIAL_VOICES.has(openaiVoice)) return openaiVoice
  // 空、或残留的 OpenAI 官方音色（含 DEFAULT 的 alloy）→ 按厂商挑默认
  return defaultTtsVoice('openai', tts)
}
