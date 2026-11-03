import { ref } from 'vue'
import { streamAi } from '@/api/client'
import type { TrainingRecord } from '@shared/types'

/**
 * AI 个性化鼓励 composable
 * 根据小朋友的训练表现生成个性化鼓励语
 */

/** 预设的鼓励语（AI 不可用时的降级方案） */
const FALLBACK_PHRASES = [
  '你做得很好，继续保持！',
  '每次练习都让你变得更强！',
  '专注力小明星，加油！',
  '你的进步看得见，真棒！',
]

export function useAiEncouragement() {
  const generating = ref(false)
  const encouragement = ref('')

  /**
   * 生成个性化鼓励语
   * @param record 训练记录
   * @param profileName 小朋友的名字
   * @param isNewBadge 是否获得了新徽章
   * @param streakDays 连续训练天数
   */
  async function generate(
    record: TrainingRecord,
    profileName: string,
    isNewBadge = false,
    streakDays = 0,
  ): Promise<string> {
    generating.value = true
    encouragement.value = ''

    try {
      // 构建上下文信息
      const context = {
        profileName,
        module: record.module,
        score: record.score,
        accuracy: record.accuracy,
        durationSec: record.durationSec,
        isNewBadge,
        streakDays,
        recentTrend: 'improving', // 可以根据历史数据判断
      }

      let fullText = ''
      await streamAi('encourage', context, (delta) => {
        fullText += delta
        encouragement.value = fullText
      })

      return fullText
    } catch (err) {
      console.warn('[aiEncouragement] AI 鼓励生成失败，使用预设鼓励语', err)
      const fallback = FALLBACK_PHRASES[Math.floor(Math.random() * FALLBACK_PHRASES.length)]
      encouragement.value = fallback
      return fallback
    } finally {
      generating.value = false
    }
  }

  return {
    generating,
    encouragement,
    generate,
  }
}
