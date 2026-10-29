/** 共享类型：前后端同源，修改时必须同步 docs/data-model.md */

export type AttentionDimension =
  | 'sustained' // 持续注意力
  | 'selective' // 选择性注意力
  | 'switching' // 交替/转换注意力
  | 'divided' // 分配注意力
  | 'workingMemory' // 工作记忆
  | 'inhibition' // 冲动抑制

export type TrainingModuleId = 'pomodoro' | 'stroop' | 'capture' | 'nback' | 'switch' | 'tracking'

export interface ModuleMeta {
  id: TrainingModuleId
  name: string
  subtitle: string
  emoji: string
  dimensions: AttentionDimension[]
  /** 是否计入每日训练时长上限（番茄钟不计入） */
  countsTowardDailyLimit: boolean
  minutes: number
}

export interface TrainingError {
  type: string
  count: number
}

export interface TrainingRecord {
  id: string
  profileId: string
  module: TrainingModuleId
  startedAt: number
  endedAt: number
  durationSec: number
  difficulty: number
  accuracy: number
  avgReactionMs: number
  score: number
  totalTrials: number
  correctTrials: number
  errors: TrainingError[]
  dimensionScores: Partial<Record<AttentionDimension, number>>
  updatedAt: number
}

export interface HomeworkRound {
  index: number
  focusMinutes: number
  breakMinutes: number
  startedAt: number
  endedAt: number
  selfChecks: boolean[]
}

/** 番茄钟当前进行到哪一步，用于离开页面后恢复 */
export type HomeworkStep = 'setup' | 'warmup' | 'focus' | 'check' | 'break'

export interface HomeworkProgress {
  step: HomeworkStep
  /** 暂停/离开时保存的剩余秒数 */
  focusLeftSec: number
  breakLeftSec: number
  warmupLeftSec: number
  roundIndex: number
  roundStartedAt: number
  /** 本轮 4 项自检的勾选状态 */
  checks: boolean[]
  paused: boolean
}

/** 一条作业清单项，孩子做完一项手动勾选 */
export interface HomeworkItem {
  id: string
  title: string
  done: boolean
  doneAt?: number
}

export interface HomeworkSession {
  id: string
  profileId: string
  taskTitle: string
  /** 作业清单（v1 的 subtasks 迁移而来） */
  items: HomeworkItem[]
  /** @deprecated v1 旧字段，仅用于读取旧快照；服务端迁移后不再写入 */
  subtasks?: string[]
  plannedFocusMinutes: number
  rounds: HomeworkRound[]
  /** 进行中的界面状态；仅 status 为 running 时存在 */
  progress?: HomeworkProgress
  status: 'running' | 'done' | 'abandoned'
  startedAt: number
  endedAt: number | null
  updatedAt: number
}

export interface BadgeUnlock {
  id: string
  unlockedAt: number
}

export interface ProfilePublic {
  id: string
  name: string
  avatar: string
  createdAt: number
  points: number
  badges: BadgeUnlock[]
}

export interface AiSettings {
  enabled: boolean
  baseUrl: string
  model: string
  temperature: number
  /** 仅写：客户端提交新 key；读取时服务端返回掩码 */
  apiKey?: string
  apiKeyMasked?: string
}

export interface BlockedRange {
  start: string // "21:30"
  end: string // "07:30"
  label: string
}

export interface LimitSettings {
  dailyTrainingMinutes: number
  sessionMinutes: number
  breakMinutes: number
  dailyBadgeLimit: number
  blockedRanges: BlockedRange[]
  homeworkExempt: boolean
}

export interface Settings {
  ai: AiSettings
  limits: LimitSettings
  updatedAt: number
}

export type SessionRole = 'parent' | 'child'

export interface SessionInfo {
  token: string
  role: SessionRole
  profileId?: string
  expiresAt: number
}

export interface FamilyInfo {
  id: string
  username: string
  childPinLength: number
  createdAt: number
  version: string
}

/** 客户端拿到的状态快照（不含任何口令散列/密钥明文） */
export interface StateSnapshot {
  schemaVersion: number
  serverTime: number
  family: FamilyInfo | null
  profiles: ProfilePublic[]
  records: TrainingRecord[]
  homework: HomeworkSession[]
  /** 防沉迷限制：孩子端也需要，用于本地守卫 */
  limits: LimitSettings | null
  /** 完整设置（含脱敏后的 AI 配置），仅家长可见 */
  settings: Settings | null
}

export interface MergePayload {
  records?: TrainingRecord[]
  homework?: HomeworkSession[]
}

export interface ApiError {
  error: string
  code?: string
}
