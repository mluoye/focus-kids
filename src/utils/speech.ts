/**
 * 系统 TTS：给识字量有限的孩子朗读清单/规则。
 * 纯浏览器能力（speechSynthesis），零后端、零上传；个别设备可能没有中文语音，调用前用 speechSupported() 判断。
 */
export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

function pickVoice(): SpeechSynthesisVoice | null {
  if (!speechSupported()) return null
  const voices = window.speechSynthesis.getVoices()
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

/** 朗读一段文字；自动打断上一条，避免连点串音。 */
export function speak(text: string) {
  const clean = readableText(text)
  if (!speechSupported() || !clean) return
  window.speechSynthesis.cancel()
  const utter = new SpeechSynthesisUtterance(clean)
  utter.lang = 'zh-CN'
  utter.rate = 0.95
  utter.pitch = 1
  const voice = pickVoice()
  if (voice) utter.voice = voice
  window.speechSynthesis.speak(utter)
}

export function stopSpeak() {
  if (speechSupported()) window.speechSynthesis.cancel()
}
