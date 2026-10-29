/**
 * 低年级可读性：按标题关键词识别科目，给孩子端配 emoji 图标。
 * 纯前端推导，不依赖服务端；家长可在录入时手动改成固定科目组里的任意一项。
 */
export interface SubjectIcon {
  icon: string
  name: string
  keywords: string[]
}

/** 固定科目组：家长选择器只提供这些，避免乱选；顺序即识别优先级。 */
export const SUBJECT_ICONS: SubjectIcon[] = [
  {
    icon: '📐',
    name: '数学',
    keywords: ['数学', '口算', '计算', '算术', '奥数', '应用题', '加减', '乘除', '算式', '数', '题'],
  },
  {
    icon: '📖',
    name: '语文',
    keywords: ['语文', '抄写', '课文', '背诵', '背', '朗读', '读', '拼音', '生字', '词语', '造句', '古诗', '阅读', '作文', '写话', '练字', '字帖', '听写', '词', '句'],
  },
  {
    icon: '🔤',
    name: '英语',
    keywords: ['英语', '英文', '单词', '听力', '字母', '拼读', 'abc', 'letter'],
  },
  {
    icon: '🎨',
    name: '美术',
    keywords: ['美术', '画画', '绘画', '手工', '涂色', '折纸', '剪纸', '素描', '水彩', '画'],
  },
  {
    icon: '🎵',
    name: '音乐',
    keywords: ['音乐', '唱歌', '歌曲', '乐器', '钢琴', '古筝', '视唱', '练琴', '唱'],
  },
  {
    icon: '🏃',
    name: '体育',
    keywords: ['体育', '跳绳', '跑步', '运动', '广播操', '课间操', '立定', '跳远', '仰卧起坐', '足球', '篮球', '跳'],
  },
  {
    icon: '🧪',
    name: '科学',
    keywords: ['科学', '实验', '观察', '自然', '种植', '制作'],
  },
]

export const SUBJECT_FALLBACK = { icon: '📌', name: '其他' } as const

/** 按标题自动识别科目 emoji；识别不到归「其他」。 */
export function detectSubjectIcon(title: string): string {
  const t = (title || '').toLowerCase()
  if (!t) return SUBJECT_FALLBACK.icon
  for (const s of SUBJECT_ICONS) {
    if (s.keywords.some((k) => t.includes(k))) return s.icon
  }
  return SUBJECT_FALLBACK.icon
}
