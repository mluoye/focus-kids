/**
 * 系统 TTS：给识字量有限的孩子朗读清单/规则。
 * 按家长在「AI 设置 → 朗读来源」里排的顺序逐个尝试：native（浏览器原生）、edge、openai，
 * 某个来源失败自动落到下一个。原生只有浏览器知道能不能用（微信内、无 GMS 国产 ROM 常缺失），
 * 所以链路必须在客户端推进，服务端一次请求只负责一个来源。
 *
 * 移动端兼容要点：
 * - getVoices() 首次常返回空数组，要等 voiceschanged 事件异步加载，故用 initSpeech() 预载并缓存。
 * - iOS 上 speechSynthesis 可能处于 paused，speak 前需 resume()，否则不出声。
 */

import type { TtsSource } from '@shared/types'
import { DEFAULT_TTS_ORDER } from '@shared/constants'
import { ttsSpeak } from '@/api/client'
import { useDataStore } from '@/stores/data'

/** 整条链的总时间预算：孩子等不了 40 秒，超时就放弃并让界面上的文字承担表达。 */
const CHAIN_BUDGET_MS = 25_000
/** 单次后端合成上限；服务端自身超时 20s，这里保持一致即可 */
const BACKEND_TIMEOUT_MS = 20_000
/** 兜底：剩余预算低于这个值就不值得再发请求了 */
const MIN_ATTEMPT_MS = 1_500

let cachedVoices: SpeechSynthesisVoice[] = []

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** 页面加载时预载语音列表；移动端 getVoices() 首次为空，必须等 voiceschanged。 */
export function initSpeech() {
  if (!speechSupported()) return
  const load = () => {
    cachedVoices = window.speechSynthesis.getVoices()
  }
  load()
  window.speechSynthesis.addEventListener?.('voiceschanged', load)
  // 个别浏览器不触发 voiceschanged，延迟再取一次兜底。
  setTimeout(load, 400)
}

function pickVoice(): SpeechSynthesisVoice | null {
  if (!speechSupported()) return null
  const voices = cachedVoices.length ? cachedVoices : window.speechSynthesis.getVoices()
  return (
    voices.find((v) => v.lang.toLowerCase() === 'zh-cn') ??
    voices.find((v) => v.lang.toLowerCase().startsWith('zh')) ??
    null
  )
}

/** 该孩子生效的朗读顺序（服务端已与家长 enabled 取交集）；读不到时退回默认「原生 → Edge」 */
export function ttsOrder(): TtsSource[] {
  try {
    const order = useDataStore().ttsPriority
    return order.length ? order : DEFAULT_TTS_ORDER.filter((s) => s !== 'openai')
  } catch (err) {
    console.warn('[speech] 读取朗读顺序失败，退回默认顺序', err)
    return DEFAULT_TTS_ORDER.filter((s) => s !== 'openai')
  }
}

/** 某个后端来源当前生效的音色（孩子偏好优先，缺省时服务端自己会兜底） */
export function ttsVoiceFor(source: 'edge' | 'openai'): string | undefined {
  try {
    return useDataStore().ttsPlan.voice[source]
  } catch {
    return undefined
  }
}

/**
 * 朗读前剔除 emoji / 符号，只留可读文字。
 * 科目图标是给眼睛看的，AI 或家长也可能在标题里粘了 emoji，一律不念。
 */
const NON_READABLE_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}\u{2300}-\u{23FF}]/gu

export function readableText(text: string): string {
  return text.replace(NON_READABLE_RE, '').replace(/\s+/g, ' ').trim()
}

/**
 * 朗读一段文字：按优先级链逐个来源尝试，自动打断上一条避免连点串音。
 * 返回 `null` 表示成功，否则返回最后一处失败原因（调用方可直接展示）。
 *
 * 已知限制：原生 API 存在但不出声（部分微信 WebView）时无法判定，本轮仍视为成功；
 * 这类设备请把 Edge 排在原生之前。
 */
export async function speak(text: string): Promise<string | null> {
  const clean = readableText(text)
  if (!clean) return '没有可朗读的内容'
  const deadline = Date.now() + CHAIN_BUDGET_MS
  let lastError = ''
  for (const source of ttsOrder()) {
    if (source === 'native') {
      const err = speakNative(clean)
      if (!err) return null
      lastError = err
      continue
    }
    const remaining = deadline - Date.now()
    if (remaining < MIN_ATTEMPT_MS) {
      lastError = lastError || '朗读超时，已跳过剩余来源'
      continue
    }
    const voice = ttsVoiceFor(source)
    const err = await playBackendTts(clean, source, Math.min(remaining, BACKEND_TIMEOUT_MS), voice)
    if (!err) return null
    lastError = err
  }
  console.warn('[speech] 所有朗读来源都失败：', lastError)
  return lastError || '这台设备暂时无法朗读，文字已经显示在屏幕上'
}

/** 浏览器原生朗读；API 缺失时返回原因，由调用方继续下一来源 */
function speakNative(text: string): string | null {
  if (!speechSupported()) return '这台设备不支持系统语音'
  const synth = window.speechSynthesis
  // iOS 可能处于 paused；先 resume 再 cancel，避免新朗读被旧状态吞掉。
  if (synth.paused) synth.resume()
  synth.cancel()
  const utter = new SpeechSynthesisUtterance(text)
  utter.lang = 'zh-CN'
  utter.rate = 0.95
  utter.pitch = 1
  const voice = pickVoice()
  if (voice) utter.voice = voice
  synth.speak(utter)
  return null
}

const audioCache = new Map<string, HTMLAudioElement>()
const AUDIO_CACHE_MAX = 16

/**
 * 后端合成 mp3 并播放；按「来源 + 文本」缓存最近几条，避免重复合成。
 * 缓存键带来源：不同来源音色不同，不能互相顶替。
 */
async function playBackendTts(
  text: string,
  source: 'edge' | 'openai',
  timeoutMs: number,
  voice?: string,
): Promise<string | null> {
  // 缓存键带音色：孩子换音色后同文本不能复用旧音频
  const cacheKey = `${source}:${voice ?? ''}:${text}`
  let audio = audioCache.get(cacheKey)
  try {
    if (!audio) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), Math.max(MIN_ATTEMPT_MS, timeoutMs))
      let blob: Blob
      try {
        blob = await ttsSpeak(text, source, controller.signal, voice)
      } finally {
        clearTimeout(timer)
      }
      audio = new Audio(URL.createObjectURL(blob))
      // 部分移动 WebView 要求音频元素挂到文档里才能播放。
      audio.style.display = 'none'
      document.body.appendChild(audio)
      audioCache.set(cacheKey, audio)
      if (audioCache.size > AUDIO_CACHE_MAX) {
        const oldest = audioCache.keys().next().value
        if (oldest !== undefined) {
          const evicted = audioCache.get(oldest)
          audioCache.delete(oldest)
          if (evicted) {
            URL.revokeObjectURL(evicted.src)
            evicted.remove()
          }
        }
      }
    }
    audio.currentTime = 0
    await audio.play()
    return null
  } catch (err: any) {
    if (err?.name === 'AbortError') return '这次合成超时了'
    if (err?.name === 'NotAllowedError') return '浏览器拦截了自动播放，请再点一次'
    const message = err?.message ?? String(err)
    console.warn(`[speech] ${source} 朗读失败：`, message)
    return message
  }
}

export function stopSpeak() {
  if (speechSupported()) window.speechSynthesis.cancel()
  for (const audio of audioCache.values()) audio.pause()
}
