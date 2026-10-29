import { defineStore } from 'pinia'
import type { BlockedRange, LimitSettings } from '@shared/types'
import { useDataStore } from './data'
import { blockedRangeNow } from '@/utils/time'

const SESSION_KEY = 'fk.continuousStart'

function readStart(): number | null {
  const raw = sessionStorage.getItem(SESSION_KEY)
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) ? n : null
}

export interface GuardReason {
  allowed: boolean
  title: string
  detail: string
  kind: 'daily-limit' | 'blocked-time' | 'break' | null
}

export const useGuardStore = defineStore('guard', {
  state: () => ({
    continuousStart: readStart(),
    now: Date.now(),
    breakUntil: 0,
    breakTotalSec: 0,
    timer: 0 as number | 0,
  }),
  getters: {
    limits(): LimitSettings | null {
      return useDataStore().limits
    },
    continuousMinutes(state): number {
      if (!state.continuousStart) return 0
      return Math.floor((state.now - state.continuousStart) / 60000)
    },
    breakRemainingSec(state): number {
      return Math.max(0, Math.ceil((state.breakUntil - state.now) / 1000))
    },
    onBreak(): boolean {
      return this.breakRemainingSec > 0
    },
    blockedRange(): BlockedRange | null {
      return blockedRangeNow(this.limits ?? null, new Date(this.now))
    },
  },
  actions: {
    ensureTimer() {
      if (this.timer) return
      this.timer = window.setInterval(() => {
        this.now = Date.now()
        if (this.breakUntil && this.now >= this.breakUntil) {
          this.breakUntil = 0
          this.breakTotalSec = 0
          this.continuousStart = null
          sessionStorage.removeItem(SESSION_KEY)
        }
        const limits = this.limits
        if (limits && this.continuousStart && !this.breakUntil) {
          if (this.now - this.continuousStart >= limits.sessionMinutes * 60000) {
            this.startBreak(limits.breakMinutes)
          }
        }
      }, 1000)
    },
    noteActivity() {
      this.ensureTimer()
      this.now = Date.now()
      if (!this.continuousStart) {
        this.continuousStart = this.now
        sessionStorage.setItem(SESSION_KEY, String(this.now))
      }
    },
    /** 离开训练页时暂停连续计时（避免孩子挂在首页也被强制休息）。 */
    pauseActivity() {
      this.continuousStart = null
      sessionStorage.removeItem(SESSION_KEY)
    },
    startBreak(minutes?: number) {
      const limitMinutes = minutes ?? this.limits?.breakMinutes ?? 3
      this.breakUntil = Date.now() + limitMinutes * 60000
      this.breakTotalSec = limitMinutes * 60
      this.continuousStart = null
      sessionStorage.removeItem(SESSION_KEY)
    },
    /** 家长放行一次：只重置连续计时，不改变每日上限 */
    parentRelease() {
      this.breakUntil = 0
      this.breakTotalSec = 0
      this.continuousStart = null
      sessionStorage.removeItem(SESSION_KEY)
    },
    /** 切换孩子：换人等于新会话，重置连续计时与强制休息，避免把上一个孩子的休息算到头上。 */
    resetActivity() {
      this.breakUntil = 0
      this.breakTotalSec = 0
      this.continuousStart = null
      sessionStorage.removeItem(SESSION_KEY)
    },
    canStart(moduleId: string, moduleCountsTowardLimit: boolean): GuardReason {
      const data = useDataStore()
      if (this.onBreak) {
        return {
          allowed: false,
          kind: 'break',
          title: '先休息一下眼睛',
          detail: `连续训练有点久了，休息 ${this.breakRemainingSec} 秒后就能继续啦。`,
        }
      }
      const blocked = this.blockedRange
      if (blocked && moduleId !== 'pomodoro') {
        return {
          allowed: false,
          kind: 'blocked-time',
          title: `${blocked.label ?? '休息时段'}到了`,
          detail: `现在 ${blocked.start}~${blocked.end} 是休息时间，只能做作业番茄钟哦。`,
        }
      }
      const limits = this.limits
      if (limits && moduleCountsTowardLimit) {
        const used = data.todayTrainingMinutes
        if (used >= limits.dailyTrainingMinutes) {
          return {
            allowed: false,
            kind: 'daily-limit',
            title: '今天的训练时间用完啦',
            detail: `每天最多训练 ${limits.dailyTrainingMinutes} 分钟，今天已经练了 ${used} 分钟。明天再来吧，还可以去做作业番茄钟。`,
          }
        }
      }
      return { allowed: true, title: '', detail: '', kind: null }
    },
  },
})
