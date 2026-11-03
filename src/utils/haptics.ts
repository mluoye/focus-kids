/**
 * 触觉反馈工具
 * 使用 Vibration API 提供触觉反馈
 * 兼容性：Android 支持，iOS 不支持（自动降级为无操作）
 */

/** 检查是否支持震动 */
function vibrationSupported(): boolean {
  return typeof navigator !== 'undefined' && 'vibrate' in navigator
}

/**
 * 轻微震动（按钮点击）
 * iOS 不支持 Vibration API，自动跳过
 */
export function vibrateLight(): void {
  if (!vibrationSupported()) return
  try {
    navigator.vibrate(10)
  } catch {
    /* 忽略 */
  }
}

/**
 * 中等震动（训练完成、获得徽章）
 * iOS 不支持 Vibration API，自动跳过
 */
export function vibrateMedium(): void {
  if (!vibrationSupported()) return
  try {
    navigator.vibrate([20, 50, 20])
  } catch {
    /* 忽略 */
  }
}

/**
 * 强烈震动（连续天数里程碑、高分庆祝）
 * iOS 不支持 Vibration API，自动跳过
 */
export function vibrateStrong(): void {
  if (!vibrationSupported()) return
  try {
    navigator.vibrate([30, 50, 30, 50, 30])
  } catch {
    /* 忽略 */
  }
}

/** 是否支持触觉反馈（用于 UI 提示） */
export function hapticsSupported(): boolean {
  return vibrationSupported()
}
