import type { AttentionDimension, ArithmeticDifficulty, ArithmeticMode, LimitSettings, ModuleMeta, Settings, StoryMathGrade, TrainingCategory, TtsSource, TtsVoiceOption } from './types'

export const SCHEMA_VERSION = 19

export const APP_VERSION = '0.16.0'

/** 作业进行中草稿超过这个时间没有动作就自动作废（跨天基本必然超过） */
export const HOMEWORK_STALE_MS = 2 * 60 * 60 * 1000

/** 六维均值与徽章判定统一取最近多少条记录 */
export const DIMENSION_WINDOW = 10

export const DIMENSIONS: { key: AttentionDimension; name: string; desc: string; emoji: string }[] = [
  { key: 'sustained', name: '持续注意力', desc: '坐得住、不发呆、把一件事做完', emoji: '🕯️' },
  { key: 'selective', name: '选择性注意力', desc: '抗干扰、审题细心、不被带跑', emoji: '🎯' },
  { key: 'switching', name: '转换注意力', desc: '科目切换不卡顿、回头就接上', emoji: '🔀' },
  { key: 'divided', name: '分配注意力', desc: '边听边记、多线索同步处理', emoji: '🎧' },
  { key: 'workingMemory', name: '工作记忆', desc: '课堂记忆、按条件记住信息', emoji: '🧠' },
  { key: 'inhibition', name: '冲动抑制', desc: '不乱动、先想再答、忍住冲动', emoji: '🛑' },
]

/**
 * 训练小馆的分类（只影响孩子端展示，不改六维评估、积分与上限）。
 *
 * `logic`（逻辑思维）暂不列出：现有游戏没有真正练推理/找规律的内容，
 * 等新增图形规律、矩阵推理等模块后再加进这个数组。
 */
export const TRAINING_CATEGORIES: { key: TrainingCategory; name: string; emoji: string; desc: string }[] = [
  { key: 'focus', name: '专注力训练', emoji: '🎯', desc: '坐得住、看得准、不被带跑' },
  { key: 'memory', name: '记忆力训练', emoji: '🧠', desc: '边看边记，记住再动手' },
  { key: 'reaction', name: '反应力训练', emoji: '🔀', desc: '规则一变，马上跟上' },
  { key: 'logic', name: '逻辑思维训练', emoji: '🧮', desc: '算一算、想一想，脑子转起来' },
]

export const MODULES: ModuleMeta[] = [
  {
    id: 'pomodoro',
    name: '作业番茄钟',
    subtitle: '拆解任务 · 专注 25 分钟 · 自检闭环',
    emoji: '🍅',
    dimensions: ['sustained', 'inhibition'],
    category: 'tool',
    countsTowardDailyLimit: false,
    minutes: 30,
  },
  {
    id: 'stroop',
    name: '色词大挑战',
    subtitle: '字义和颜色打架，专挑颜色说出来',
    emoji: '🌈',
    dimensions: ['selective', 'inhibition'],
    category: 'focus',
    countsTowardDailyLimit: true,
    minutes: 4,
  },
  {
    id: 'capture',
    name: '抗干扰捕捉',
    subtitle: '只抓目标图形，干扰项一律不理',
    emoji: '🔍',
    dimensions: ['selective', 'sustained'],
    category: 'focus',
    countsTowardDailyLimit: true,
    minutes: 3,
  },
  {
    id: 'nback',
    name: 'N-Back 双任务',
    subtitle: '位置 + 颜色同时记，锻炼课堂记忆',
    emoji: '🧩',
    dimensions: ['workingMemory', 'divided'],
    category: 'memory',
    countsTowardDailyLimit: true,
    minutes: 5,
  },
  {
    id: 'switch',
    name: '分类切换',
    subtitle: '规则来回换，看你能不能马上跟上',
    emoji: '🔀',
    dimensions: ['switching', 'inhibition'],
    category: 'reaction',
    countsTowardDailyLimit: true,
    minutes: 4,
  },
  {
    id: 'tracking',
    name: '多线索追踪',
    subtitle: '盯住目标小球，同时记住听到的数字',
    emoji: '🎯',
    dimensions: ['divided', 'sustained'],
    category: 'focus',
    countsTowardDailyLimit: true,
    minutes: 4,
  },
  {
    id: 'arithmetic',
    name: '加减乘除速算',
    subtitle: '心算挑战：算得快又准，专注力也练到',
    emoji: '🧮',
    dimensions: ['workingMemory', 'inhibition'],
    category: 'logic',
    countsTowardDailyLimit: true,
    minutes: 3,
  },
  {
    id: 'storymath',
    name: 'AI 数学应用题',
    subtitle: 'AI 出题，列式拍照或直接给答案，错题再专项练',
    emoji: '📖',
    dimensions: ['workingMemory', 'inhibition'],
    category: 'logic',
    countsTowardDailyLimit: true,
    minutes: 10,
  },
]

export const DEFAULT_LIMITS: LimitSettings = {
  dailyTrainingMinutes: 40,
  sessionMinutes: 15,
  breakMinutes: 3,
  dailyBadgeLimit: 5,
  blockedRanges: [{ start: '21:30', end: '07:30', label: '睡觉时间' }],
  homeworkExempt: true,
}

export const DEFAULT_SETTINGS: Settings = {
  ai: {
    enabled: false,
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    temperature: 0.7,
    apiKeyMasked: '',
    vision: { baseUrl: '', model: '', apiKeyMasked: '' },
  },
  limits: DEFAULT_LIMITS,
  tts: {
    enabled: ['native', 'edge'],
    verified: {},
    lastFailure: null,
    openai: { baseUrl: '', model: '', defaultVoice: '', voice: 'alloy', apiKeyMasked: '' },
  },
  updatedAt: 0,
}

/** 朗读来源清单：家长端排序、服务端校验、孩子端链式解析共用同一份取值与文案 */
export const TTS_SOURCES: { key: TtsSource; name: string; desc: string }[] = [
  { key: 'native', name: '系统原生语音', desc: '浏览器自带朗读，不走网络、零费用；部分手机与微信内不支持' },
  { key: 'edge', name: '微软 Edge', desc: '服务端免费合成，音质稳定，无需密钥' },
  { key: 'openai', name: 'OpenAI 兼容 TTS', desc: '需填服务地址、模型与密钥，可接国产云' },
]

/** 孩子没设偏好时的默认次序：与家长启用项取交集后生效 */
export const DEFAULT_TTS_ORDER: TtsSource[] = ['native', 'edge', 'openai']

/** Edge 后端合成的内置音色候选（微软神经语音，zh-CN） */
export const TTS_EDGE_VOICES = [
  { value: 'zh-CN-XiaoxiaoNeural', label: '晓晓（女声·活泼）' },
  { value: 'zh-CN-YunxiNeural', label: '云希（男声·阳光）' },
  { value: 'zh-CN-YunjianNeural', label: '云健（男声·沉稳）' },
  { value: 'zh-CN-XiaoyiNeural', label: '晓伊（女声·温柔）' },
] satisfies TtsVoiceOption[]

/**
 * OpenAI 兼容 TTS 的音色候选。
 *
 * 这套协议**没有「列出全部音色」的标准端点**，所以只能用厂商文档里的固定集合：
 * - SiliconFlow：系统预置 8 个，且必须写成 `模型名:音色`（服务端 `normalizeOpenaiVoice` 会自动补前缀）；
 *   其 `GET /audio/voice/list` 只返回用户自己上传的克隆音色，不列系统音色。
 * - OpenAI 官方：固定集合、无列表接口；`ash` 及之后几个属于 gpt-4o-mini-tts，以厂商文档为准。
 * - 其它厂商：各自不同，前端只给自定义输入。
 */
export const TTS_VOICE_PRESETS: { edge: TtsVoiceOption[]; siliconflow: TtsVoiceOption[]; openai: TtsVoiceOption[] } = {
  edge: TTS_EDGE_VOICES,
  siliconflow: [
    { value: 'anna', label: 'anna（女声·沉稳）' },
    { value: 'bella', label: 'bella（女声·热情）' },
    { value: 'claire', label: 'claire（女声·温柔）' },
    { value: 'diana', label: 'diana（女声·活泼）' },
    { value: 'alex', label: 'alex（男声·沉稳）' },
    { value: 'benjamin', label: 'benjamin（男声·低沉）' },
    { value: 'charles', label: 'charles（男声·磁性）' },
    { value: 'david', label: 'david（男声·开朗）' },
  ],
  openai: [
    { value: 'alloy', label: 'alloy（中性）' },
    { value: 'echo', label: 'echo（男声）' },
    { value: 'fable', label: 'fable（旁白感）' },
    { value: 'onyx', label: 'onyx（低沉男声）' },
    { value: 'nova', label: 'nova（明亮女声）' },
    { value: 'shimmer', label: 'shimmer（柔和女声）' },
    { value: 'ash', label: 'ash（gpt-4o-mini-tts）' },
    { value: 'ballad', label: 'ballad（gpt-4o-mini-tts）' },
    { value: 'coral', label: 'coral（gpt-4o-mini-tts）' },
    { value: 'sage', label: 'sage（gpt-4o-mini-tts）' },
    { value: 'verse', label: 'verse（gpt-4o-mini-tts）' },
  ],
}

/** 按服务地址识别 TTS 厂商；识别不出时只能让家长自定义填音色 */
export function ttsVoiceVendor(baseUrl: string): 'siliconflow' | 'openai' | 'other' {
  const url = (baseUrl || '').toLowerCase()
  if (url.includes('siliconflow')) return 'siliconflow'
  if (url.includes('api.openai.com')) return 'openai'
  return 'other'
}

export const AVATARS = ['🦊', '🐼', '🐰', '🐯', '🐨', '🦄', '🐸', '🐧', '🐳', '🦁', '🐹', '🐢']

/** 口算速算作答方式：选项四选一（默认，低年级友好）/ 键盘直接输入 */
export const ARITHMETIC_MODES: { key: ArithmeticMode; name: string; desc: string }[] = [
  { key: 'choice', name: '选项四选一', desc: '每题给 4 个答案，点一个，误触少' },
  { key: 'keypad', name: '键盘直接输入', desc: '自己按数字再确认，更像口算练习' },
]

/** 口算速算难度档位：孩子端每次进入可临时切换；家长按孩子设默认档 */
export const ARITHMETIC_DIFFICULTIES: { key: ArithmeticDifficulty; name: string; desc: string }[] = [
  { key: 1, name: '20 以内加减法', desc: '只加只减，不超 20' },
  { key: 2, name: '100 以内加减 + 九九乘法', desc: '两位数加减与乘法口诀' },
  { key: 3, name: '混合四则（含括号）', desc: '先乘除后加减，括号最优先' },
]

/** AI 应用题年级档位（1~6 年级）：孩子端每次进入可临时切换；家长按孩子设默认档 */
export const STORY_MATH_GRADES: { key: StoryMathGrade; name: string; desc: string }[] = [
  { key: 1, name: '一年级', desc: '20 以内加减、比大小' },
  { key: 2, name: '二年级', desc: '表内乘除、100 以内加减' },
  { key: 3, name: '三年级', desc: '三位数加减、乘除法、时分秒' },
  { key: 4, name: '四年级', desc: '多位数乘除、运算律、小数初步' },
  { key: 5, name: '五年级', desc: '小数四则、简易方程、分数' },
  { key: 6, name: '六年级', desc: '分数/百分数、比例、圆' },
]

export interface BadgeDef {
  id: string
  name: string
  desc: string
  emoji: string
  dimension?: AttentionDimension
  /** 判定条件：某维度累计分或某模块次数 */
  check: (stats: { dimensionAvg: Partial<Record<AttentionDimension, number>>; moduleCount: Partial<Record<string, number>>; totalRecords: number; streakDays: number }) => boolean
}

export const BADGES: BadgeDef[] = [
  { id: 'first-step', name: '专注启程', desc: '完成第一次训练', emoji: '🌟', check: (s) => s.totalRecords >= 1 },
  { id: 'warm-up', name: '热身达人', desc: '累计完成 5 次训练', emoji: '🔥', check: (s) => s.totalRecords >= 5 },
  { id: 'persist-3', name: '三日坚持', desc: '连续 3 天来训练', emoji: '📅', check: (s) => s.streakDays >= 3 },
  { id: 'persist-7', name: '七日不辍', desc: '连续 7 天来训练', emoji: '🏅', check: (s) => s.streakDays >= 7 },
  { id: 'steady', name: '稳如小山', desc: '持续注意力达到 75 分', emoji: '⛰️', dimension: 'sustained', check: (s) => (s.dimensionAvg.sustained ?? 0) >= 75 },
  { id: 'sharp-eye', name: '火眼金睛', desc: '选择性注意力达到 75 分', emoji: '👀', dimension: 'selective', check: (s) => (s.dimensionAvg.selective ?? 0) >= 75 },
  { id: 'quick-switch', name: '切换高手', desc: '转换注意力达到 75 分', emoji: '🔁', dimension: 'switching', check: (s) => (s.dimensionAvg.switching ?? 0) >= 75 },
  { id: 'multi-mind', name: '一心多用', desc: '分配注意力达到 75 分', emoji: '🎪', dimension: 'divided', check: (s) => (s.dimensionAvg.divided ?? 0) >= 75 },
  { id: 'memory-master', name: '记忆大师', desc: '工作记忆达到 75 分', emoji: '🧠', dimension: 'workingMemory', check: (s) => (s.dimensionAvg.workingMemory ?? 0) >= 75 },
  { id: 'calm-heart', name: '沉住气', desc: '冲动抑制达到 75 分', emoji: '🛑', dimension: 'inhibition', check: (s) => (s.dimensionAvg.inhibition ?? 0) >= 75 },
  { id: 'homework-hero', name: '作业小当家', desc: '完成 3 次番茄钟作业', emoji: '🍅', check: (s) => (s.moduleCount.pomodoro ?? 0) >= 3 },
  { id: 'all-round', name: '全能小卫士', desc: '六个训练各完成一次', emoji: '🏆', check: (s) => ['pomodoro', 'stroop', 'capture', 'nback', 'switch', 'tracking'].every((m) => (s.moduleCount[m] ?? 0) >= 1) },
]

export function moduleById(id: string): ModuleMeta | undefined {
  return MODULES.find((m) => m.id === id)
}

export function dimensionName(key: AttentionDimension): string {
  return DIMENSIONS.find((d) => d.key === key)?.name ?? key
}
