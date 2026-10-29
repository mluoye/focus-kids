/**
 * 系统 TTS：给识字量有限的孩子朗读清单/规则。
 * 纯浏览器能力（speechSynthesis），零后端、零上传；个别设备可能没有中文语音，调用前用 speechSupported() 判断。
 *
 * 移动端兼容要点：
 * - getVoices() 首次常返回空数组，要等 voiceschanged 事件异步加载，故用 initSpeech() 预载并缓存。
 * - iOS 上 speechSynthesis 可能处于 paused，speak 前需 resume()，否则不出声。
 */

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

/** 朗读一段文字；自动打断上一条，避免连点串音。返回是否成功发起了朗读。 */
export function speak(text: string): boolean {
  const clean = readableText(text)
  if (!speechSupported() || !clean) return false
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
  return true
}

export function stopSpeak() {
  if (speechSupported()) window.speechSynthesis.cancel()
}
