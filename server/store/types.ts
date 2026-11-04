import type {
  ArithmeticDifficulty,
  ArithmeticMode,
  HomeworkPlan,
  HomeworkSession,
  MathTerm,
  MathUnitNo,
  ProfileTtsPrefs,
  Settings,
  StoryMathGrade,
  TrainingRecord,
} from '../../shared/types'

export interface FamilyRecord {
  id: string
  username: string
  passwordHash: string
  /** 恢复码的 scrypt 哈希（不含分隔符的大写形式）；未生成过时为空。0.4.0 新增 */
  recoveryHash?: string
  /** 最近一次生成/更换恢复码的时间 */
  recoveryUpdatedAt?: number
  childPinLength: number
  createdAt: number
}

export interface ProfileRecord {
  id: string
  name: string
  avatar: string
  pinHash: string
  createdAt: number
  points: number
  /** 已消费积分（兑换 points 类奖励时累加）；可用积分 = points - pointsSpent */
  pointsSpent?: number
  badges: { id: string; unlockedAt: number }[]
  /** 该孩子的朗读偏好（顺序与音色）；0.13.0 起由孩子在设置页自管 */
  ttsPrefs?: ProfileTtsPrefs
  /** 口算速算作答方式（家长按孩子设置）；缺省 choice */
  arithmeticMode?: ArithmeticMode
  /** 口算速算默认难度（家长按孩子设置，孩子每次进入仍可临时切换）；缺省 1 */
  arithmeticDifficulty?: ArithmeticDifficulty
  /** AI 应用题默认年级（1~6，家长按孩子设置，孩子每次进入仍可临时切换）；缺省 1 */
  storymathGrade?: StoryMathGrade
  /** AI 应用题教材学期（1=上册/2=下册，家长按孩子进度设置）；缺省 1 */
  storymathTerm?: MathTerm
  /** AI 应用题当前单元（数字或「fun」数学好玩）；缺省 1（上册第 1 单元） */
  storymathUnit?: MathUnitNo
}

export interface StoredSession {
  token: string
  familyId: string
  role: 'parent' | 'child'
  profileId?: string
  createdAt: number
  expiresAt: number
}

export interface AppState {
  schemaVersion: number
  meta: { createdAt: number; updatedAt: number }
  family: FamilyRecord | null
  profiles: ProfileRecord[]
  records: TrainingRecord[]
  homework: HomeworkSession[]
  homeworkPlans: HomeworkPlan[]
  settings: Settings
  sessions: StoredSession[]
}
