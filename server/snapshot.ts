import type { SessionRole, StateSnapshot, ProfilePublic, Settings, TtsPlan, TtsSource, TtsVoiceOption } from '../shared/types'
import { SCHEMA_VERSION, APP_VERSION, DEFAULT_TTS_ORDER } from '../shared/constants'
import { homeworkDayKeyOffset } from '../shared/homework'
import { getState, sanitizeSettings, type ProfileRecord } from './store'
import { ttsVoiceOptions } from './tts-config'

export function publicProfile(p: { id: string; name: string; avatar: string; createdAt: number; points: number; badges: { id: string; unlockedAt: number }[] }): ProfilePublic {
  return { id: p.id, name: p.name, avatar: p.avatar, createdAt: p.createdAt, points: p.points, badges: p.badges }
}

/** 某个孩子的朗读方案：order 与家长 enabled 取交集，音色候选拨到对应厂商 */
export function buildTtsPlan(settings: Settings, profile: ProfileRecord | undefined): TtsPlan {
  const tts = settings.tts
  const enabled = [...tts.enabled]
  const enabledSet = new Set(enabled)
  const preferred = (profile?.ttsPrefs?.order ?? []).filter((s) => enabledSet.has(s))
  // 孩子没设过顺序（或顺序里来源全被家长关掉）时，按默认次序从启用集里排
  const ordered: TtsSource[] = preferred.length
    ? preferred
    : DEFAULT_TTS_ORDER.filter((s) => enabledSet.has(s))
  // 默认次序也可能漏掉（例如家长启用了默认清单外的组合）：按 enabled 原序补全
  for (const s of enabled) {
    if (!ordered.includes(s)) ordered.push(s)
  }
  const voices: { edge: TtsVoiceOption[]; openai: TtsVoiceOption[] } = ttsVoiceOptions(tts)
  return {
    enabled,
    order: ordered,
    voice: {
      ...(profile?.ttsPrefs?.voice?.edge ? { edge: profile.ttsPrefs.voice.edge } : {}),
      ...(profile?.ttsPrefs?.voice?.openai ? { openai: profile.ttsPrefs.voice.openai } : {}),
    },
    voices,
  }
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
  const activeProfile = profileId ? state.profiles.find((p) => p.id === profileId) : undefined

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
    // 朗读链路孩子端要自己走（原生只有浏览器知道能不能用），顺序与音色候必须一起下发，且不含任何密钥
    ttsPlan: buildTtsPlan(state.settings, activeProfile),
  }
}
