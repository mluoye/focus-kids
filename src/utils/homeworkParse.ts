/**
 * 家长端作业智能解析：把老师发在群里的多科目作业通知，解析成一份份科目计划。
 * 规则解析（本地、无 AI 依赖）：按科目标题分块 → 每科取日期 → 编号任务去 emoji/编号 → 温馨提示并项。
 * 优先用大模型（/api/ai/homework-parse），失败或未配置时用这里的规则兜底。
 */
import { detectSubjectIcon, SUBJECT_FALLBACK } from '@/utils/subject'

export interface ParsedHomeworkItem {
  title: string
  icon: string
}

export interface ParsedHomeworkPlan {
  subject: string
  /** YYYY-MM-DD，从科目标题内嵌日期提取，取不到用 defaultDate */
  date: string
  title: string
  items: ParsedHomeworkItem[]
}

/** 科目关键词表：顺序即识别优先级；标题与条目都用它判断科目。 */
const SUBJECT_RULES: { name: string; re: RegExp }[] = [
  { name: '数学', re: /数学|口算|计算|算术|奥数|应用题|作业/ },
  { name: '语文', re: /语文|抄写|课文|背诵|朗读|拼音|生字|词语|古诗|阅读|作文|写话|练字|字帖|听写/ },
  { name: '英语', re: /英语|英文|单词|听力|字母|拼读/ },
  { name: '科学', re: /科学|实验|观察|自然/ },
  { name: '美术', re: /美术|画画|绘画|手工/ },
  { name: '音乐', re: /音乐|唱歌|歌曲|乐器/ },
  { name: '体育', re: /体育|跳绳|跑步|运动/ },
]

function subjectOf(line: string): string {
  for (const s of SUBJECT_RULES) {
    if (s.re.test(line)) return s.name
  }
  return SUBJECT_FALLBACK.name
}

/** 行首是否「列表编号」（1. 1、 ① 一、），这类行不是科目标题；「10.28」这类日期不算编号。 */
function isListStart(line: string): boolean {
  return /^\s*(?:\d{1,2}\.(?!\d)|[\u2776-\u277F]|[一二三四五六七八九十]+[、.．)])/u.test(line)
}

/** 是否为科目标题行：含科目词，且是「短标签」样式，不是任务条目。 */
function isSubjectHeader(line: string): boolean {
  if (isListStart(line)) return false
  if (!SUBJECT_RULES.some((s) => s.re.test(line))) return false
  // 任务条目即使含科目词（如「指读课本…拼音」「背诵《悯农》」）也不算标题，
  // 只有「短标签」才算：冒号结尾，或以建议/安排/任务/作业等词结尾，或以日期开头。
  if (/[:：]$/.test(line)) return true
  if (/^(?:[\u{1F000}-\u{1FAFF}]\s*)*\d{1,2}[.月]\d{1,2}日?/u.test(line)) return true
  return line.length <= 14 && /(建议|安排|任务|作业|学习|复习|预习|计划|内容|要求|清单|布置)/.test(line)
}

function isNoteLine(line: string): boolean {
  return /温馨提示|家长须知|注意事项|特别提醒|注意[:：]|请家长|请有需要的家长|帮忙贴在|已下发|下发了/u.test(line)
}

/** 提取标题内嵌日期：10.29 / 10月29日 → 今年-MM-DD；取不到返回 defaultDate。 */
function extractDate(header: string, defaultDate: string): string {
  const m = header.match(/(\d{1,2})[.月](\d{1,2})日?/)
  if (!m) return defaultDate
  const month = parseInt(m[1], 10)
  const day = parseInt(m[2], 10)
  if (month < 1 || month > 12 || day < 1 || day > 31) return defaultDate
  const year = new Date(defaultDate).getFullYear()
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** 去掉行首 emoji / 编号 / 符号，只留正文。 */
function cleanItemTitle(raw: string): string {
  return raw
    .replace(/^[\s\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]+/u, '')
    .replace(/^\s*\d{1,2}[.、．)]\s*/, '')
    .replace(/^\s*[\u2776-\u277F]\s*/, '')
    .replace(/^\s*[一二三四五六七八九十]+[、.．)]\s*/, '')
    .trim()
}

function subjectIcon(subject: string): string {
  return detectSubjectIcon(subject) || SUBJECT_FALLBACK.icon
}

/** 把某个科目的行列表整理成清单项（温馨提示合并为一条）。 */
function buildItems(lines: string[], subject: string): ParsedHomeworkItem[] {
  const items: ParsedHomeworkItem[] = []
  let noteBuf: string[] = []
  const flushNote = () => {
    const text = noteBuf
      .map((s) => s.trim())
      .filter(Boolean)
      .join('，')
      .replace(/^温馨提示[:：]?/, '')
      .trim()
    if (text) {
      items.push({ title: `温馨提示：${text}`.slice(0, 60), icon: '💡' })
    }
    noteBuf = []
  }
  for (const line of lines) {
    if (isNoteLine(line)) {
      if (noteBuf.length) flushNote()
      noteBuf.push(line.replace(/^[\s\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]*/u, '').replace(/^温馨提示[:：]?\s*/u, ''))
    } else if (noteBuf.length) {
      noteBuf.push(line)
    } else {
      const title = cleanItemTitle(line)
      if (title) items.push({ title: title.slice(0, 60), icon: subjectIcon(subject) })
    }
  }
  flushNote()
  return items.slice(0, 12)
}

/**
 * 规则解析主入口。
 * @param text 老师发的原始作业通知
 * @param defaultDate 家长所选日期（YYYY-MM-DD），科目没写日期时用它
 */
export function parseHomeworkText(text: string, defaultDate: string): ParsedHomeworkPlan[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  const blocks: { subject: string; header: string; lines: string[] }[] = []
  const preamble: string[] = []
  let current: { subject: string; header: string; lines: string[] } | null = null

  for (const line of lines) {
    if (isSubjectHeader(line)) {
      current = { subject: subjectOf(line), header: line, lines: [] }
      blocks.push(current)
    } else if (current) {
      current.lines.push(line)
    } else {
      preamble.push(line)
    }
  }

  const plans: ParsedHomeworkPlan[] = []
  if (preamble.length) {
    const subject = subjectOf(preamble.join(' '))
    const items = buildItems(preamble, subject)
    if (items.length) plans.push({ subject, date: defaultDate, title: `${subject}作业`, items })
  }
  for (const block of blocks) {
    const items = buildItems(block.lines, block.subject)
    if (!items.length) continue
    plans.push({
      subject: block.subject,
      date: extractDate(block.header, defaultDate),
      title: `${block.subject}作业`,
      items,
    })
  }
  return plans
}

/** 供 AI 结果兜底：把 AI 返回的 plans 归一化成标准结构。 */
export function normalizeParsedPlans(raw: any, defaultDate: string): ParsedHomeworkPlan[] {
  const plans: ParsedHomeworkPlan[] = []
  const list = Array.isArray(raw?.plans) ? raw.plans : []
  for (const p of list) {
    const subject = String(p?.subject ?? '').trim() || SUBJECT_FALLBACK.name
    const items: ParsedHomeworkItem[] = (Array.isArray(p?.items) ? p.items : [])
      .map((it: any) => {
        const title = String(it?.title ?? '').trim()
        if (!title) return null
        const isNote = /温馨提示|家长须知|注意/u.test(title)
        return { title: title.slice(0, 60), icon: isNote ? '💡' : subjectIcon(subject) }
      })
      .filter(Boolean) as ParsedHomeworkItem[]
    if (!items.length) continue
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(p?.date ?? '')) ? String(p.date) : defaultDate
    plans.push({
      subject,
      date,
      title: String(p?.title ?? '').trim().slice(0, 80) || `${subject}作业`,
      items,
    })
  }
  return plans
}

/** 从 AI 流式文本里提取 JSON（模型可能包了 markdown 代码块）。 */
export function extractJsonFromAi(buffer: string): any {
  const text = String(buffer || '')
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    return JSON.parse(m[0])
  } catch {
    return null
  }
}
