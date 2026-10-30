import type { AttentionDimension, LimitSettings, ModuleMeta, Settings, TrainingCategory } from './types'

export const SCHEMA_VERSION = 11

export const APP_VERSION = '0.10.1'

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
    visionModel: '',
    temperature: 0.7,
    apiKeyMasked: '',
  },
  limits: DEFAULT_LIMITS,
  tts: {
    provider: 'edge',
    voice: 'zh-CN-XiaoxiaoNeural',
    openai: { baseUrl: '', model: '', voice: 'alloy', apiKeyMasked: '' },
  },
  updatedAt: 0,
}

export const AVATARS = ['🦊', '🐼', '🐰', '🐯', '🐨', '🦄', '🐸', '🐧', '🐳', '🦁', '🐹', '🐢']

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
