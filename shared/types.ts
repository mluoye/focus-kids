/** 共享类型：前后端同源，修改时必须同步 docs/data-model.md */

export type AttentionDimension =
  | 'sustained' // 持续注意力
  | 'selective' // 选择性注意力
  | 'switching' // 交替/转换注意力
  | 'divided' // 分配注意力
  | 'workingMemory' // 工作记忆
  | 'inhibition' // 冲动抑制

export type TrainingModuleId = 'pomodoro' | 'stroop' | 'capture' | 'nback' | 'switch' | 'tracking'

/**
 * 训练小馆的孩子端分类。
 *
 * - `focus` 专注力 / `memory` 记忆力 / `reaction` 反应力：训练游戏
 * - `logic` 逻辑思维：预留类目，等有真正练推理/找规律的游戏再启用
 * - `tool` 作业工具：不是训练游戏，不参与分类、不计入每日上限
 */
export type TrainingCategory = 'focus' | 'memory' | 'reaction' | 'logic' | 'tool'

export interface ModuleMeta {
  id: TrainingModuleId
  name: string
  subtitle: string
  emoji: string
  dimensions: AttentionDimension[]
  /** 孩子端「训练小馆」的分类；只影响展示，不影响六维评估与判定 */
  category: TrainingCategory
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
  /** 番茄钟判定：结算时清单是否全部完成。仅 `module = pomodoro` 的派生记录有值 */
  passed?: boolean
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
  /** 低年级可读性：科目 emoji，家长可改；为空时前端按标题自动识别。0.7.0 新增 */
  icon?: string
  /** 所属科目（孩子端把当天多份家长计划合并成一份清单时写入），用于分科目小节展示；为空视为未分类。0.10.0 新增 */
  subject?: string
  done: boolean
  doneAt?: number
}

/** 家长预先录入的作业项；孩子开始时会复制成 HomeworkItem */
export interface HomeworkPlanItem {
  id: string
  title: string
  /** 低年级可读性：科目 emoji，家长可改；为空时前端按标题自动识别。0.7.0 新增 */
  icon?: string
}

/**
 * 家长提前录入的当天作业清单。
 *
 * 与 HomeworkSession 独立：计划可改可删，会话一旦开始就以复制过去的清单为准，
 * 计划变更不会回写运行中或已结算的会话。
 */
export interface HomeworkPlan {
  id: string
  profileId: string
  /** `YYYY-MM-DD`，按家庭本地时区由客户端生成，服务端只校验格式与范围 */
  planDate: string
  /** 科目名（如「数学」「语文」「英语」），用于一天多份计划分组；为空视为未分类单份。0.10.0 新增 */
  subject?: string
  title: string
  items: HomeworkPlanItem[]
  createdBy: 'parent'
  createdAt: number
  updatedAt: number
  /** 软删除时间；归档后家长端不再展示，孩子端也不再下发 */
  archivedAt?: number
}

export interface HomeworkSession {
  id: string
  profileId: string
  /** 从哪份家长计划开始；孩子自建清单时为空。0.5.0 新增 */
  planId?: string
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
  /** 仅 status=done：结算时清单是否全部完成（时间到或提前结束时冻结） */
  verdict?: 'pass' | 'fail'
  verdictAt?: number
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

/** 拍照识题视觉模型子配置；可与对话模型使用不同厂商（不同 baseUrl / apiKey）。0.11.0 新增 */
export interface AiVisionSettings {
  /** 视觉服务地址；留空继承对话模型的 baseUrl */
  baseUrl: string
  /** 视觉模型名；留空视为未配置，孩子端拍题入口禁用 */
  model: string
  /** 仅写：客户端提交新 key；读取时服务端返回掩码。留空继承对话模型的 key */
  apiKey?: string
  apiKeyMasked?: string
}

export interface AiSettings {
  enabled: boolean
  baseUrl: string
  model: string
  temperature: number
  /** 仅写：客户端提交新 key；读取时服务端返回掩码 */
  apiKey?: string
  apiKeyMasked?: string
  /** 拍照识题视觉子配置（独立厂商时填齐 baseUrl/model/apiKey） */
  vision: AiVisionSettings
  /**
   * @deprecated 0.10.x 扁平视觉模型名，0.11.0 起迁入 `vision.model`；仅保留一个版本供旧客户端读取
   */
  visionModel?: string
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

export interface TtsOpenaiSettings {
  baseUrl: string
  model: string
  /**
   * 家长配置的连接默认音色（0.13.0 / schema 15 新增，可选）。
   * 已知厂商（SiliconFlow / OpenAI 官方）留空时用内置默认；
   * 未知厂商**必须填**，否则试听与孩子端合成都会报 `TTS_VOICE_NOT_SET`。
   */
  defaultVoice?: string
  /** 仅写：客户端提交新 key；读取时服务端返回掩码 */
  apiKey?: string
  apiKeyMasked?: string
  /**
   * @deprecated 0.13.0 起朗读音色由孩子端选择（`ProfileRecord.ttsPrefs.voice.openai`），
   * 这里只留一个兜底默认值，家长端不再编辑。
   */
  voice?: string
}

/** 一个可选音色；`value` 是传给厂商的音色标识，`label` 是给孩子/家长看的描述 */
export interface TtsVoiceOption {
  value: string
  label: string
}

/** 某个孩子的朗读偏好（顺序与音色都由孩子自己定） */
export interface ProfileTtsPrefs {
  /** 孩子排的顺序，只会从家长启用的来源里取；空数组表示用默认次序 */
  order: TtsSource[]
  /** 孩子选的音色；缺省时回落到内置默认 */
  voice: { edge?: string; openai?: string }
}

export interface TtsSettings {
  /** 家长决定哪几个来源对孩子可用；未试听通过的后端来源不允许启用 */
  enabled: TtsSource[]
  /** 试听通过的来源及其当时连接配置的指纹；native 不在此列 */
  verified: { edge?: TtsVerify; openai?: TtsVerify }
  /** 最近一次后端来源合成失败；试听该来源成功后清空 */
  lastFailure: TtsFailure | null
  /**
   * @deprecated 0.13.0 起朗读顺序由孩子自己决定（`ProfileRecord.ttsPrefs.order`），
   * 仅保留一个版本供旧客户端回读，新代码不再写入。
   */
  priority?: TtsSource[]
  /**
   * @deprecated 0.13.0 起朗读音色由孩子自己选，仅保留一个版本供旧客户端回读。
   */
  voice?: string
  /**
   * @deprecated 0.12.0 起由 `enabled` 取代，仅保留一个版本供旧客户端读取。
   */
  provider?: 'edge' | 'openai'
  openai: TtsOpenaiSettings
}

/** 朗读来源：native（浏览器原生 speechSynthesis）| edge（微软 Edge）| openai（OpenAI 兼容云） */
export type TtsSource = 'native' | 'edge' | 'openai'

/** 同一来源的已验证配置指纹；改过相关字段后指纹对不上，验证自动失效、需重新试听 */
export interface TtsVerify {
  at: number
  fingerprint: string
}

/** 后端来源最近一次合成失败，用于「已临时走下一项」的提示；不含密钥与请求体 */
export interface TtsFailure {
  source: 'edge' | 'openai'
  at: number
  message: string
}

/** 孩子端拿到的朗读方案：顺序与音色都是孩子自己选的，服务端已与家长启用项取交集 */
export interface TtsPlan {
  /** 家长启用的来源（孩子端只能在这几个里选） */
  enabled: TtsSource[]
  /** 该孩子生效的顺序（已剔除家长未启用的来源） */
  order: TtsSource[]
  /** 该孩子选的音色；缺省时前端用默认 */
  voice: { edge?: string; openai?: string }
  /** 可播音色候选（服务端按 baseUrl 识别厂商后裁剪） */
  voices: { edge: TtsVoiceOption[]; openai: TtsVoiceOption[] }
}

export interface Settings {
  ai: AiSettings
  limits: LimitSettings
  tts: TtsSettings
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
  /** 家长提前录入的作业计划（按 profileId + planDate 一天一份） */
  homeworkPlans: HomeworkPlan[]
  /** 防沉迷限制：孩子端也需要，用于本地守卫 */
  limits: LimitSettings | null
  /** 朗读来源优先级（不含密钥），孩子端本地按此链尝试；家长端与 settings.tts.priority 同值 */
  ttsPlan: TtsPlan
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
