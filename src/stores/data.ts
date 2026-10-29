import { defineStore } from 'pinia'
import type {
  HomeworkPlan,
  HomeworkSession,
  ProfilePublic,
  Settings,
  StateSnapshot,
  TrainingRecord,
} from '@shared/types'
import { MODULES } from '@shared/constants'
import { homeworkDayKey } from '@shared/homework'
import { api } from '@/api/client'
import { useSessionStore } from './session'

const QUEUE_KEY = 'fk.pending'
const SNAPSHOT_KEY = 'fk.snapshot'

interface PendingQueue {
  records: TrainingRecord[]
  homework: HomeworkSession[]
}

export function todayStart(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch (err) {
    // 缓存损坏时清掉，否则每次启动都会重复失败，且脏数据会一直被当成有效快照
    console.warn(`[data] 本地缓存 ${key} 解析失败，已丢弃`, err)
    try {
      localStorage.removeItem(key)
    } catch {
      /* 存储不可用时忽略 */
    }
    return fallback
  }
}

export const useDataStore = defineStore('data', {
  state: () => ({
    snapshot: loadJSON<StateSnapshot | null>(SNAPSHOT_KEY, null),
    pending: loadJSON<PendingQueue>(QUEUE_KEY, { records: [], homework: [] }),
    offline: false,
    syncing: false,
    lastSyncAt: 0,
    loaded: false,
  }),
  getters: {
    records: (s): TrainingRecord[] => s.snapshot?.records ?? [],
    homework: (s): HomeworkSession[] => s.snapshot?.homework ?? [],
    homeworkPlans: (s): HomeworkPlan[] => s.snapshot?.homeworkPlans ?? [],
    profiles: (s): ProfilePublic[] => s.snapshot?.profiles ?? [],
    settings: (s): Settings | null => s.snapshot?.settings ?? null,
    limits: (s) => s.snapshot?.limits ?? s.snapshot?.settings?.limits ?? null,
    myProfile(): ProfilePublic | null {
      const session = useSessionStore()
      return this.profiles.find((p: ProfilePublic) => p.id === session.profileId) ?? null
    },
    myRecords(): TrainingRecord[] {
      const session = useSessionStore()
      return this.records.filter((r: TrainingRecord) => r.profileId === session.profileId)
    },
    myHomework(): HomeworkSession[] {
      const session = useSessionStore()
      return this.homework.filter((h: HomeworkSession) => h.profileId === session.profileId)
    },
    myHomeworkPlans(): HomeworkPlan[] {
      const session = useSessionStore()
      return this.homeworkPlans.filter((p: HomeworkPlan) => p.profileId === session.profileId && !p.archivedAt)
    },
    /** 孩子端当前可用的「今天的作业清单」；同一天理论上只有一份，取最近更新。 */
    myTodayPlan(): HomeworkPlan | null {
      const today = homeworkDayKey()
      return (
        this.myHomeworkPlans
          .filter((p: HomeworkPlan) => p.planDate === today)
          .sort((a: HomeworkPlan, b: HomeworkPlan) => b.updatedAt - a.updatedAt)[0] ?? null
      )
    },
    /** 今日已用训练分钟（番茄钟不计入；只统计当前登录孩子，避免兄弟姐妹互相挤占额度） */
    todayTrainingMinutes(): number {
      const since = todayStart()
      const session = useSessionStore()
      const all = [...this.records, ...this.pending.records]
      const unique = new Map<string, TrainingRecord>(all.map((r) => [r.id, r]))
      let seconds = 0
      for (const record of unique.values()) {
        if (record.startedAt < since) continue
        if (session.profileId && record.profileId !== session.profileId) continue
        const meta = MODULES.find((m) => m.id === record.module)
        if (!meta?.countsTowardDailyLimit) continue
        seconds += record.durationSec
      }
      return Math.round(seconds / 60)
    },
    recordById: (s) => (id: string) => s.snapshot?.records.find((r) => r.id === id),
  },
  actions: {
    setSnapshot(snapshot: StateSnapshot) {
      this.snapshot = snapshot
      this.lastSyncAt = Date.now()
      try {
        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot))
      } catch {
        /* 存储满时忽略缓存 */
      }
    },
    persistQueue(): boolean {
      try {
        localStorage.setItem(QUEUE_KEY, JSON.stringify(this.pending))
        return true
      } catch (err) {
        // 配额满 / 隐私模式：只保留内存队列，不要因为缓存失败把上报流程一起打断
        console.warn('[data] 离线队列写入 localStorage 失败，刷新页面可能丢失待同步记录', err)
        return false
      }
    },
    async fetchState() {
      try {
        const snapshot = await api.getState()
        this.setSnapshot(snapshot)
        this.offline = false
        this.loaded = true
        if (this.pending.records.length || this.pending.homework.length) await this.syncPending()
      } catch (err: any) {
        this.offline = err?.code === 'OFFLINE' || err?.status === 0
        this.loaded = true
        throw err
      }
    },
    /** 记录落库：在线直接提交，离线进队列，界面先乐观更新。 */
    async saveRecord(record: TrainingRecord): Promise<{ newBadges: string[]; offline: boolean; points: number | null }> {
      if (!this.snapshot) {
        this.snapshot = {
          schemaVersion: 1,
          serverTime: Date.now(),
          family: null,
          profiles: [],
          records: [],
          homework: [],
          homeworkPlans: [],
          limits: null,
          settings: null,
        }
      }
      this.snapshot.records = [record, ...this.snapshot.records.filter((r) => r.id !== record.id)]
      try {
        const res = await api.pushRecord(record)
        this.setSnapshot(res.snapshot)
        this.offline = false
        return { newBadges: (res.unlocked ?? []).map((b: any) => b.id), offline: false, points: res.points ?? null }
      } catch (err: any) {
        if (err?.status === 0 || err?.code === 'OFFLINE') {
          this.pending.records.push(record)
          this.persistQueue()
          this.offline = true
          return { newBadges: [], offline: true, points: null }
        }
        throw err
      }
    },
    async saveHomework(session: HomeworkSession) {
      if (this.snapshot) {
        this.snapshot.homework = [session, ...(this.snapshot.homework ?? []).filter((h) => h.id !== session.id)]
      }
      try {
        const res = await api.pushHomework(session)
        this.setSnapshot(res.snapshot)
        this.offline = false
      } catch (err: any) {
        if (err?.status === 0 || err?.code === 'OFFLINE') {
          this.pending.homework = this.pending.homework.filter((h) => h.id !== session.id).concat(session)
          this.persistQueue()
          this.offline = true
          return
        }
        throw err
      }
    },
    /**
     * 家长保存作业计划：必须在线完成，失败直接抛给界面。
     * 计划是家长刚录入的少量数据，不进入离线队列，避免「以为存上了其实没有」。
     */
    async saveHomeworkPlan(plan: Partial<HomeworkPlan> & { profileId: string; planDate: string }) {
      const res = await api.saveHomeworkPlan(plan)
      this.setSnapshot(res.snapshot)
      this.offline = false
    },
    async deleteHomeworkPlan(id: string) {
      const res = await api.deleteHomeworkPlan(id)
      this.setSnapshot(res.snapshot)
      this.offline = false
    },
    async syncPending() {
      if (this.syncing) return
      if (!this.pending.records.length && !this.pending.homework.length) return
      this.syncing = true
      try {
        // 分批提交，避免触及服务端单次上限；每批成功后才从队列移除，失败即可整体重试
        const RECORDS_PER_BATCH = 100
        const HOMEWORK_PER_BATCH = 50
        while (this.pending.records.length || this.pending.homework.length) {
          const records = this.pending.records.slice(0, RECORDS_PER_BATCH)
          const homework = this.pending.homework.slice(0, HOMEWORK_PER_BATCH)
          const res = await api.mergeState({ records, homework })
          const sentRecords = new Set(records.map((r) => r.id))
          const sentHomework = new Set(homework.map((h) => h.id))
          this.pending.records = this.pending.records.filter((r) => !sentRecords.has(r.id))
          this.pending.homework = this.pending.homework.filter((h) => !sentHomework.has(h.id))
          this.persistQueue()
          this.setSnapshot(res)
          this.offline = false
        }
      } catch (err) {
        console.warn('[data] 离线队列同步失败，保留待下次重试', err)
        this.offline = true
      } finally {
        this.syncing = false
      }
    },
    async updateSettings(payload: { ai?: any; limits?: any }) {
      const snapshot = await api.saveSettings(payload)
      this.setSnapshot(snapshot)
    },
    /** 家长档案管理后刷新全量快照 */
    async refreshProfiles() {
      await this.fetchState()
    },
    resetLocal() {
      this.snapshot = null
      this.pending = { records: [], homework: [] }
      localStorage.removeItem(SNAPSHOT_KEY)
      localStorage.removeItem(QUEUE_KEY)
    },
  },
})
