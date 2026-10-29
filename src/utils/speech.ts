/**
 * 系统 TTS：给识字量有限的孩子朗读清单/规则。
 * 优先浏览器原生 speechSynthesis；原生缺失（微信内、无 GMS 国产 ROM 等）时
 * 降级到后端 /api/tts 合成 mp3 播放，保证移动端也能朗读。
 *
 * 移动端兼容要点：
 * - getVoices() 首次常返回空数组，要等 voiceschanged 事件异步加载，故用 initSpeech() 预载并缓存。
 * - iOS 上 speechSynthesis 可能处于 paused，speak 前需 resume()，否则不出声。
 */

import { getToken } from '@/api/client'

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
 * 朗读一段文字；自动打断上一条，避免连点串音。
 * 原生 speechSynthesis 可用走原生，否则降级到后端 /api/tts。
 * 返回 `null` 表示成功，否则返回失败原因（调用方可直接展示）。
 */
export async function speak(text: string): Promise<string | null> {
  const clean = readableText(text)
  if (!clean) return '没有可朗读的内容'
  if (speechSupported()) {
    const synth = window.speechSynthesis
    // iOS 可能处于 paused；先 resume 再 cancel，避免新朗读被旧状态吞掉。
    if (synth.paused) synth.resume()
    synth.cancel()
    const utter = new SpeechSynthesisUtterance(clean)
    utter.lang = 'zh-CN'
    utter.rate = 0.95
    utter.pitch = 1
    const voice = pickVoice()
    if (voice) utter.voice = voice
    synth.speak(utter)
    return null
  }
  return playBackendTts(clean)
}

const audioCache = new Map<string, HTMLAudioElement>()
const AUDIO_CACHE_MAX = 8

/** 后端合成 mp3 并播放；按文本缓存最近几条，避免重复合成。返回 null 或失败原因。 */
async function playBackendTts(text: string): Promise<string | null> {
  let audio = audioCache.get(text)
  try {
    if (!audio) {
      const token = getToken()
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text }),
      })
      if (!res.ok) {
        let message = `请求失败（${res.status}）`
        try {
          const data = await res.json()
          if (data?.error) message = data.error
        } catch {
          /* 响应非 JSON 时保留状态码信息 */
        }
        console.warn('[speech] 后端朗读失败：', message)
        return message
      }
      const blob = await res.blob()
      audio = new Audio(URL.createObjectURL(blob))
      // 部分移动 WebView 要求音频元素挂到文档里才能播放。
      audio.style.display = 'none'
      document.body.appendChild(audio)
      audioCache.set(text, audio)
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
    console.warn('[speech] 后端朗读播放失败：', err?.name, err?.message)
    if (err?.name === 'NotAllowedError') return '浏览器拦截了自动播放，请再点一次'
    return err?.message ?? String(err)
  }
}

export function stopSpeak() {
  if (speechSupported()) window.speechSynthesis.cancel()
  for (const audio of audioCache.values()) audio.pause()
}
