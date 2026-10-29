import type { SessionRole, StateSnapshot, ProfilePublic } from '../shared/types'
import { SCHEMA_VERSION, APP_VERSION } from '../shared/constants'
import { homeworkDayKeyOffset } from '../shared/homework'
import { getState, sanitizeSettings } from './store'

export function publicProfile(p: { id: string; name: string; avatar: string; createdAt: number; points: number; badges: { id: string; unlockedAt: number }[] }): ProfilePublic {
  return { id: p.id, name: p.name, avatar: p.avatar, createdAt: p.createdAt, points: p.points, badges: p.badges }
}

export function buildSnapshot(role: SessionRole, profileId?: string): StateSnapshot {
  const state = getState()
  const isParent = role === 'parent'
  const visibleProfiles = isParent
    ? state.profiles
    : state.profiles.filter((p) => p.id === profileId)
  // 孩子端只需要今天前后各一天的计划：够跨午夜恢复，也不会把历史计划全量下发。
  const planFrom = homeworkDayKeyOffset(-1)
  const planTo = homeworkDayKeyOffset(1)

  return {
    schemaVersion: SCHEMA_VERSION,
    serverTime: Date.now(),
    family: state.family
      ? {
          id: state.family.id,
          username: isParent ? state.family.username : '',
          childPinLength: state.family.childPinLength,
          createdAt: state.family.createdAt,
          version: APP_VERSION,
        }
      : null,
    profiles: visibleProfiles.map(publicProfile),
    records: (isParent ? state.records : state.records.filter((r) => r.profileId === profileId)).sort(
      (a, b) => b.startedAt - a.startedAt,
    ),
    homework: (isParent ? state.homework : state.homework.filter((h) => h.profileId === profileId)).sort(
      (a, b) => b.startedAt - a.startedAt,
    ),
    homeworkPlans: (
      isParent
        ? state.homeworkPlans
        : state.homeworkPlans.filter(
            (p) => p.profileId === profileId && !p.archivedAt && p.planDate >= planFrom && p.planDate <= planTo,
          )
    ).sort((a, b) => b.planDate.localeCompare(a.planDate) || b.updatedAt - a.updatedAt),
    settings: isParent ? sanitizeSettings(state.settings) : null,
    // 限制项不含敏感信息，孩子端本地守卫必须拿到
    limits: state.settings.limits,
  }
}
