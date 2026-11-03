import { speak } from '@/utils/speech'
import { ref } from 'vue'

/**
 * 语音引导 composable
 * 提供训练前、中、后的鼓励语音反馈
 */

const enabled = ref(true)

/** 训练前的鼓励语音 */
const PRE_TRAINING_PHRASES = [
  '准备好了吗？我们开始吧！',
  '加油，你一定可以的！',
  '深呼吸，集中注意力，开始啦！',
  '准备好了就点击开始吧！',
]

/** 训练中的实时反馈语音（每隔一段时间随机触发） */
const DURING_TRAINING_PHRASES = [
  '做得很好！',
  '继续保持！',
  '真棒！',
  '你越来越厉害了！',
  '加油！',
  '太棒了！',
]

/** 训练后的庆祝语音 */
const POST_TRAINING_PHRASES = [
  '太棒了！你完成了！',
  '哇，你真厉害！',
  '恭喜你，训练完成啦！',
  '干得好，给自己一个大大的赞！',
  '你是最棒的专注力小明星！',
]

/** 高分庆祝语音（分数 >= 90） */
const HIGH_SCORE_PHRASES = [
  '哇！这个分数太高了！',
  '不可思议！你做得太好了！',
  '天哪，你简直是专注力大师！',
]

/** 低分鼓励语音（分数 < 60，但不打击信心） */
const LOW_SCORE_PHRASES = [
  '没关系，多练习就会更好！',
  '这次已经很不错了，下次会更好的！',
  '练习让你变得更强大，继续加油！',
]

export function useVoiceGuidance() {
  /**
   * 随机选择一条语音
   */
  function randomPhrase(phrases: string[]): string {
    return phrases[Math.floor(Math.random() * phrases.length)]
  }

  /**
   * 训练开始前的鼓励语音
   */
  async function speakBeforeTraining() {
    if (!enabled.value) return
    const phrase = randomPhrase(PRE_TRAINING_PHRASES)
    await speak(phrase)
  }

  /**
   * 训练中的实时反馈语音（可以间隔调用）
   * @param intervalMs 最小间隔（毫秒），避免过于频繁
   */
  async function speakDuringTraining(intervalMs = 30000) {
    if (!enabled.value) return
    const now = Date.now()
    const lastSpeak = (window as any).__lastGuidanceSpeak ?? 0
    if (now - lastSpeak < intervalMs) return

    ;(window as any).__lastGuidanceSpeak = now
    const phrase = randomPhrase(DURING_TRAINING_PHRASES)
    await speak(phrase)
  }

  /**
   * 训练完成后的庆祝语音
   * @param score 训练分数（0-100）
   */
  async function speakAfterTraining(score: number) {
    if (!enabled.value) return
    let phrase: string
    if (score >= 90) {
      phrase = randomPhrase(HIGH_SCORE_PHRASES)
    } else if (score < 60) {
      phrase = randomPhrase(LOW_SCORE_PHRASES)
    } else {
      phrase = randomPhrase(POST_TRAINING_PHRASES)
    }
    await speak(phrase)
  }

  /**
   * 连续天数里程碑庆祝（3 天、7 天、14 天、30 天等）
   */
  async function speakStreakMilestone(days: number) {
    if (!enabled.value) return
    const milestones: Record<number, string> = {
      3: '哇，你已经连续练习 3 天了！继续保持！',
      7: '太厉害了！连续 7 天！你是最棒的！',
      14: '连续 14 天！你太专注了！',
      30: '连续 30 天！你简直是专注力小明星！',
    }
    const phrase = milestones[days]
    if (phrase) {
      await speak(phrase)
    }
  }

  /**
   * 开关语音引导
   */
  function toggle() {
    enabled.value = !enabled.value
  }

  return {
    enabled,
    speakBeforeTraining,
    speakDuringTraining,
    speakAfterTraining,
    speakStreakMilestone,
    toggle,
  }
}
