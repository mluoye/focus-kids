/**
 * 音效反馈工具
 * 使用 Web Audio API 合成轻快音效，无需外部音频文件
 * 兼容性：移动端 AudioContext 需要用户交互后才能播放
 */

let audioContext: AudioContext | null = null
let userInteracted = false

/** 初始化 AudioContext（必须在用户交互后调用） */
function initAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!('AudioContext' in window) && !('webkitAudioContext' in window)) {
    console.warn('[sounds] 当前浏览器不支持 Web Audio API，音效已禁用')
    return null
  }
  if (!audioContext) {
    try {
      const AudioContextClass = window.AudioContext ?? (window as any).webkitAudioContext
      audioContext = new AudioContextClass()
    } catch (err) {
      console.warn('[sounds] Web Audio API 初始化失败，音效已禁用：', err)
      return null
    }
  }
  if (audioContext.state === 'suspended') {
    void audioContext.resume()
  }
  return audioContext
}

/** 标记用户已交互（移动端解锁 AudioContext） */
export function markUserInteraction(): void {
  userInteracted = true
  initAudioContext()
}

/** 播放一个音符 */
function playTone(
  freq: number,
  duration: number,
  type: OscillatorType = 'sine',
  volume = 0.3,
  delay = 0,
): void {
  if (!userInteracted) {
    console.warn('[sounds] 用户尚未交互，跳过音效播放（移动端限制）')
    return
  }
  const ctx = initAudioContext()
  if (!ctx) return

  const startTime = ctx.currentTime + delay
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = type
  osc.frequency.setValueAtTime(freq, startTime)

  // 音量包络：快速淡入，缓慢淡出
  gain.gain.setValueAtTime(0, startTime)
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration)

  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(startTime)
  osc.stop(startTime + duration)
}

/**
 * 答对音效：上升的叮咚声
 */
export function playCorrectSound(): void {
  playTone(523.25, 0.15, 'sine', 0.3) // C5
  playTone(659.25, 0.15, 'sine', 0.3, 0.1) // E5
  playTone(783.99, 0.2, 'sine', 0.3, 0.2) // G5
}

/**
 * 答错音效：低沉的嗡嗡声（不刺耳）
 */
export function playWrongSound(): void {
  playTone(220, 0.2, 'sine', 0.2) // A3
  playTone(196, 0.25, 'sine', 0.2, 0.1) // G3
}

/**
 * 徽章获得音效：欢快的和弦
 */
export function playBadgeSound(): void {
  playTone(523.25, 0.3, 'triangle', 0.25) // C5
  playTone(659.25, 0.3, 'triangle', 0.25, 0.05) // E5
  playTone(783.99, 0.3, 'triangle', 0.25, 0.1) // G5
  playTone(1046.5, 0.4, 'triangle', 0.25, 0.15) // C6
}

/**
 * 完成训练音效：欢快的旋律
 */
export function playCompleteSound(): void {
  const melody = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5] // C-E-G-C-G-C
  melody.forEach((freq, i) => {
    playTone(freq, 0.2, 'sine', 0.25, i * 0.12)
  })
}

/**
 * 按钮点击音效：轻微的咔嚓声
 */
export function playClickSound(): void {
  playTone(1000, 0.05, 'square', 0.1)
}

/**
 * 连续天数里程碑音效：胜利的号角
 */
export function playMilestoneSound(): void {
  const melody = [523.25, 523.25, 523.25, 659.25, 783.99, 1046.5] // C-C-C-E-G-C
  melody.forEach((freq, i) => {
    playTone(freq, i === 5 ? 0.5 : 0.15, 'triangle', 0.3, i * 0.15)
  })
}

/** 是否支持音效 */
export function soundSupported(): boolean {
  return typeof window !== 'undefined' && 'AudioContext' in window
}
