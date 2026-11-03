import { computed, onBeforeUnmount, ref } from 'vue'
import { formatMinutes } from '@/utils/time'

/**
 * 番茄钟计时机制：用「结束时间戳」驱动，避免后台标签页被浏览器节流后走慢。
 *
 * 本模块只负责「倒计时怎么走」（warmup / focus / break 三段共用一套 ticker），
 * 不负责「一段结束以后去哪儿」——那是作业流程的状态机，由调用方通过回调接管。
 *
 * 组件保留 step（setup/check/done 等非计时阶段）与业务编排；本模块只认计时阶段。
 */
export type TimerPhase = 'warmup' | 'focus' | 'break'

export interface FocusTimerOptions {
  /** 专注时长（分钟），开始专注且未显式给秒数时用于换算 */
  focusMinutes: () => number
  /** 休息时长（分钟），用于休息进度条 */
  breakMinutes: () => number
  /** 热身/休息结束 → 下一轮专注；专注结束 → 自检。去向由调用方决定 */
  onWarmupEnd: () => void
  onFocusEnd: () => void
  onBreakEnd: () => void
}

const WARMUP_SEC = 60

export function useFocusTimer(options: FocusTimerOptions) {
  const focusLeft = ref(0)
  const breakLeft = ref(0)
  const warmupLeft = ref(WARMUP_SEC)
  /** 热身页顶部三句口诀的索引，随剩余秒数推进 */
  const warmupIndex = ref(0)
  const paused = ref(false)
  /** 当前正在倒计时的阶段；null 表示不在任何计时阶段（setup/check/done） */
  const activePhase = ref<TimerPhase | null>(null)

  let ticker: number | undefined
  let focusEndsAt = 0
  let breakEndsAt = 0
  let warmupEndsAt = 0

  const focusLeftText = computed(() => formatMinutes(focusLeft.value))
  const breakLeftText = computed(() => formatMinutes(breakLeft.value))
  const focusProgress = computed(() => {
    const total = options.focusMinutes() * 60
    if (!total) return 0
    return Math.min(100, Math.max(0, Math.round(((total - focusLeft.value) / total) * 100)))
  })
  const warmupProgress = computed(() =>
    Math.min(100, Math.max(0, Math.round(((WARMUP_SEC - warmupLeft.value) / WARMUP_SEC) * 100))),
  )
  const breakProgress = computed(() => {
    const total = options.breakMinutes() * 60
    if (!total) return 0
    return Math.min(100, Math.max(0, Math.round(((total - breakLeft.value) / total) * 100)))
  })

  function clearTicker() {
    if (ticker) {
      clearInterval(ticker)
      ticker = undefined
    }
  }

  /** 不判断归零，只把界面上的剩余秒数对齐到时钟。暂停前 / 写草稿前调用。 */
  function refreshLeftFromClock() {
    const now = Date.now()
    if (focusEndsAt) focusLeft.value = Math.max(0, Math.ceil((focusEndsAt - now) / 1000))
    if (breakEndsAt) breakLeft.value = Math.max(0, Math.ceil((breakEndsAt - now) / 1000))
    if (warmupEndsAt) warmupLeft.value = Math.max(0, Math.ceil((warmupEndsAt - now) / 1000))
  }

  function tick() {
    if (paused.value) return
    const now = Date.now()
    if (activePhase.value === 'warmup' && warmupEndsAt) {
      warmupLeft.value = Math.max(0, Math.ceil((warmupEndsAt - now) / 1000))
      warmupIndex.value = Math.min(2, Math.floor((WARMUP_SEC - warmupLeft.value) / 20))
      if (warmupLeft.value <= 0) {
        clearTicker()
        warmupEndsAt = 0
        activePhase.value = null
        options.onWarmupEnd()
      }
      return
    }
    if (activePhase.value === 'focus' && focusEndsAt) {
      focusLeft.value = Math.max(0, Math.ceil((focusEndsAt - now) / 1000))
      if (focusLeft.value <= 0) {
        clearTicker()
        focusEndsAt = 0
        activePhase.value = null
        options.onFocusEnd()
      }
      return
    }
    if (activePhase.value === 'break' && breakEndsAt) {
      breakLeft.value = Math.max(0, Math.ceil((breakEndsAt - now) / 1000))
      if (breakLeft.value <= 0) {
        clearTicker()
        breakEndsAt = 0
        activePhase.value = null
        options.onBreakEnd()
      }
    }
  }

  function startTicker() {
    clearTicker()
    ticker = window.setInterval(tick, 500)
  }

  /** 开始/重置一段倒计时。秒数省略时用专注时长换算。 */
  function start(phase: TimerPhase, seconds?: number) {
    const sec = seconds ?? options.focusMinutes() * 60
    if (phase === 'focus') {
      focusLeft.value = sec
      focusEndsAt = Date.now() + sec * 1000
    } else if (phase === 'break') {
      breakLeft.value = sec
      breakEndsAt = Date.now() + sec * 1000
    } else {
      warmupLeft.value = sec
      warmupIndex.value = 0
      warmupEndsAt = Date.now() + sec * 1000
    }
    activePhase.value = phase
    paused.value = false
    startTicker()
  }

  /** 离开页面或手动暂停：把剩余时间从时钟上摘下来，存成静态秒数。 */
  function pause() {
    if (!activePhase.value) return
    refreshLeftFromClock()
    focusEndsAt = 0
    breakEndsAt = 0
    warmupEndsAt = 0
    paused.value = true
    clearTicker()
  }

  /** 从暂停恢复：按剩余秒数重算结束时间戳，继续走 ticker。 */
  function resume() {
    if (!activePhase.value) return
    const now = Date.now()
    if (activePhase.value === 'warmup') warmupEndsAt = now + Math.max(1, warmupLeft.value) * 1000
    if (activePhase.value === 'focus') focusEndsAt = now + Math.max(1, focusLeft.value) * 1000
    if (activePhase.value === 'break') breakEndsAt = now + Math.max(1, breakLeft.value) * 1000
    paused.value = false
    startTicker()
  }

  /** 流程切换到非计时阶段（自检/完成/跳过）时调用：停表并清空结束时间戳。 */
  function stop() {
    clearTicker()
    focusEndsAt = 0
    breakEndsAt = 0
    warmupEndsAt = 0
    activePhase.value = null
  }

  /** 直接写入某段剩余秒数（恢复草稿/会话前用），不启动 ticker、不改暂停态。 */
  function setLeft(phase: TimerPhase, seconds: number) {
    if (phase === 'focus') focusLeft.value = seconds
    else if (phase === 'break') breakLeft.value = seconds
    else warmupLeft.value = seconds
  }

  /**
   * 恢复草稿/会话：写入三段剩余秒数，把「焦点段」设为待续阶段并进入暂停态。
   * 调用方随后用 resume() 继续倒计时，或先改 setup/check 再 stop()。
   */
  function restore(left: { focusSec: number; breakSec: number; warmupSec: number }, phase: TimerPhase) {
    setLeft('focus', left.focusSec)
    setLeft('break', left.breakSec)
    setLeft('warmup', left.warmupSec)
    activePhase.value = phase
    paused.value = true
    focusEndsAt = 0
    breakEndsAt = 0
    warmupEndsAt = 0
    clearTicker()
  }

  /** 回到起点（重新开始整份作业）：清零三段秒数、退出计时阶段、进入非暂停态。 */
  function reset() {
    clearTicker()
    focusLeft.value = 0
    breakLeft.value = 0
    warmupLeft.value = WARMUP_SEC
    warmupIndex.value = 0
    focusEndsAt = 0
    breakEndsAt = 0
    warmupEndsAt = 0
    activePhase.value = null
    paused.value = false
  }

  onBeforeUnmount(clearTicker)

  return {
    focusLeft,
    breakLeft,
    warmupLeft,
    warmupIndex,
    paused,
    activePhase,
    focusLeftText,
    breakLeftText,
    focusProgress,
    warmupProgress,
    breakProgress,
    refreshLeftFromClock,
    start,
    pause,
    resume,
    stop,
    setLeft,
    restore,
    reset,
  }
}
