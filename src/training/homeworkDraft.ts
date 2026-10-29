import { ref } from 'vue'
import type { HomeworkItem, HomeworkProgress, HomeworkRound } from '@shared/types'
import { HOMEWORK_STALE_MS } from '@shared/constants'

/** 作业页离开/刷新后的本地草稿，按孩子分别存放，互不干扰。 */
export interface HomeworkDraft extends HomeworkProgress {
  sessionId: string
  taskTitle: string
  items: HomeworkItem[]
  focusMinutes: number
  warmupEnabled?: boolean
  rounds: HomeworkRound[]
  sessionStartedAt: number
  savedAt: number
}

const KEY_PREFIX = 'fk.homeworkDraft.'

/** 每次写/删草稿时自增，让底栏等处的「进行中」标记能即时更新。 */
export const draftRevision = ref(0)

function storageKey(profileId: string): string {
  return `${KEY_PREFIX}${profileId}`
}

export function saveHomeworkDraft(profileId: string, draft: HomeworkDraft): void {
  try {
    localStorage.setItem(storageKey(profileId), JSON.stringify(draft))
    draftRevision.value += 1
  } catch (err) {
    // 存不下时服务端可能还没有任何进度（例如还在 setup 阶段），这里必须留下痕迹
    console.warn('[homeworkDraft] 本地草稿写入失败，刷新后可能无法恢复', err)
  }
}

export function loadHomeworkDraft(profileId: string): HomeworkDraft | null {
  try {
    const raw = localStorage.getItem(storageKey(profileId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as HomeworkDraft
    if (!parsed || typeof parsed !== 'object') return null
    // 还没点「开始热身」的清单也要能恢复，此时 sessionId 还是空的
    if (!parsed.sessionId && !parsed.items?.length && !parsed.taskTitle) return null
    return parsed
  } catch (err) {
    // 草稿损坏就清掉，否则每次进入作业页都会重复失败
    console.warn('[homeworkDraft] 草稿解析失败，已清除', err)
    try {
      localStorage.removeItem(storageKey(profileId))
    } catch {
      /* 忽略 */
    }
    return null
  }
}

export function clearHomeworkDraft(profileId: string): void {
  try {
    localStorage.removeItem(storageKey(profileId))
    draftRevision.value += 1
  } catch {
    /* 忽略 */
  }
}

/** 超过 2 小时没动过就视为过期，与后端同一口径。 */
export function isHomeworkDraftStale(draft: HomeworkDraft, now = Date.now()): boolean {
  return now - draft.savedAt > HOMEWORK_STALE_MS
}
