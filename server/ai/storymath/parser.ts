import type { StoryMathProblem, StoryMathQuestionType } from '@shared/types'

/**
 * AI 返回文本 → 结构化题目 / 判卷 / 识题结果。
 *
 * 本模块只做「解析」，不含任何 Hono 路由或 IO。
 * 真实模型输出形态多样（裸 JSON、markdown 代码块、对象包裹、说明文字夹杂），
 * 解析策略按优先级逐一尝试，不依赖贪婪正则。
 */

// ─── 题型归一化 ───────────────────────────────────────────────────────────────

/** 归一化题型：AI 返回非法/缺失时回退 word（1a 兼容）。 */
export function normalizeQuestionType(v: unknown): StoryMathQuestionType {
  const t = String(v ?? '').trim()
  return t === 'calc' || t === 'fill' || t === 'choice' || t === 'word' ? t : 'word'
}

// ─── 数字提取 ─────────────────────────────────────────────────────────────────

const CN_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}
const CN_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 }

/** 中文数字转阿拉伯数字；不认识或超范围返回 null。支持「八」「十五」「一百二十」「二千零五」。 */
function chineseToNumber(s: string): number | null {
  const normalized = s.replace(/[^零一二三四五六七八九十百千万负]/g, '')
  if (!normalized) return null
  let negative = false
  let body = normalized
  if (body.startsWith('负')) {
    negative = true
    body = body.slice(1)
  }
  if (body.length === 1 && CN_DIGITS[body] !== undefined) return CN_DIGITS[body]
  let total = 0
  let section = 0
  let number = 0
  for (const ch of body) {
    if (CN_DIGITS[ch] !== undefined) {
      number = CN_DIGITS[ch]
    } else if (CN_UNITS[ch] !== undefined) {
      const unit = CN_UNITS[ch]
      if (unit === 10000) {
        section = (section + number) * unit
        total += section
        section = 0
        number = 0
      } else {
        // 十五 = 10 + 5（十前无数 → 1 个十）
        section += (number || 1) * unit
        number = 0
      }
    } else {
      return null
    }
  }
  const result = total + section + number
  if (!Number.isFinite(result) || result <= 0) return null
  return negative ? -result : result
}

/** 把答案转成有限数字：数字 / 数字字符串 / 带单位字符串（如「8个」「3.5元」）/ 中文数字（「八」「十五」）。 */
function toFiniteNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const num = Number(trimmed)
  if (Number.isFinite(num)) return num
  // 带单位或约数：取前导数字部分（「8个」「3.5元」「约12」「8 个」）
  const match = trimmed.match(/^-?(\d+(\.\d+)?)/)
  if (match) {
    const parsed = Number(match[0])
    if (Number.isFinite(parsed)) return parsed
  }
  const cn = chineseToNumber(trimmed)
  if (cn !== null) return cn
  return null
}

// ─── JSON 提取工具 ────────────────────────────────────────────────────────────

/** JSON.parse 安全封装：失败返回 null。 */
function tryParseJson(s: string): any {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/** 从 start 位置起按成对符号截取平衡子串；不匹配返回 null。 */
function sliceBalanced(src: string, start: number, open: string, close: string): string | null {
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (inString) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return null
}

/** 校验数组确实是「题目对象数组」：非空且至少一项是含 text 或 answer 的对象。 */
function isProblemArray(arr: any[]): boolean {
  return arr.some((it) => it && typeof it === 'object' && (typeof it.text === 'string' || it.answer !== undefined))
}

/** 从「可能是数组 / 含 questions 的对象 / questions 为字符串」的结构里取出题目数组；取不到返回 null。 */
function arrayFromParsed(v: any): any[] | null {
  let arr: any[] | null = null
  if (Array.isArray(v)) {
    arr = v
  } else if (v && typeof v === 'object') {
    if (Array.isArray(v.questions)) arr = v.questions
    // 模型偶尔把数组序列化成字符串（如 `"questions": "[{...}]"`），再解析一层
    else if (typeof v.questions === 'string' && v.questions.trim()) {
      const inner = tryParseJson(v.questions.trim())
      if (Array.isArray(inner)) arr = inner
      else if (inner && typeof inner === 'object' && Array.isArray(inner.questions)) arr = inner.questions
    }
  }
  return arr && isProblemArray(arr) ? arr : null
}

/**
 * 从 AI 返回的文本里稳健地取出一个对象（判卷 / 识题用）。
 * 形态：裸对象、markdown 代码块包裹、对象外面包了说明文字、对象被序列化成字符串。
 */
function extractStoryMathObject(content: string): any | null {
  if (!content) return null
  const stripped = content
    .replace(/````?json/gi, '')
    .replace(/````?/g, '')
    .trim()
  const direct = tryParseJson(stripped)
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct
  let objFrom = 0
  while (objFrom < stripped.length) {
    const objStart = stripped.indexOf('{', objFrom)
    if (objStart === -1) break
    const candidate = sliceBalanced(stripped, objStart, '{', '}')
    if (candidate) {
      const obj = tryParseJson(candidate)
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj
    }
    objFrom = objStart + 1
  }
  return null
}

/**
 * 从 AI 返回的文本里稳健地取出题目数组。
 *
 * 按优先级逐一尝试：
 * 1. 剥离 markdown 代码块后直接 JSON.parse（裸数组 / 对象包裹均可）
 * 2. 逐个 `[` 位置用平衡括号截取，找第一个能解析成题目数组的候选
 * 3. 对象包裹（单题对象 { text, answer, ... }）
 */
function extractStoryMathArray(content: string): any[] {
  if (!content) return []
  const stripped = content
    .replace(/````?json/gi, '')
    .replace(/````?/g, '')
    .trim()

  // 1. 直接解析
  const direct = tryParseJson(stripped)
  const fromDirect = arrayFromParsed(direct)
  if (fromDirect) return fromDirect

  // 2. 逐个 `[` 位置平衡截取
  let searchFrom = 0
  while (searchFrom < stripped.length) {
    const arrayStart = stripped.indexOf('[', searchFrom)
    if (arrayStart === -1) break
    const candidate = sliceBalanced(stripped, arrayStart, '[', ']')
    if (candidate) {
      const arr = arrayFromParsed(tryParseJson(candidate))
      if (arr && isProblemArray(arr)) return arr
    }
    searchFrom = arrayStart + 1
  }

  // 3. 对象包裹（单题）
  let objFrom = 0
  while (objFrom < stripped.length) {
    const objStart = stripped.indexOf('{', objFrom)
    if (objStart === -1) break
    const candidate = sliceBalanced(stripped, objStart, '{', '}')
    if (candidate) {
      const obj = tryParseJson(candidate)
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const arr = arrayFromParsed(obj)
        if (arr) return arr
        if (typeof obj.text === 'string' && obj.answer !== undefined) return [obj]
      }
    }
    objFrom = objStart + 1
  }

  return []
}

// ─── 题目解析 ─────────────────────────────────────────────────────────────────

/** 题面含看图表述时，纯文本链路无法作答，命中即弃题；不含「图书」「图形」「地图」等普通词。 */
const IMAGE_REF_RE = /图中|下图|右图|左图|上图|看图|图略|如图所示|图中有|如右图|如左图|图里|图上有/

/** 提取答案单位：优先取显式 unit 字段，否则从「8个」「3.5元」这类答案字符串里剥出来。 */
function extractUnit(item: any): string {
  const explicit = String(item?.unit ?? '').trim().slice(0, 12)
  if (explicit) return explicit
  if (typeof item?.answer === 'string') {
    const m = item.answer.trim().match(/^[+-]?\d+(\.\d+)?\s*(.*)$/)
    if (m && m[2]) return m[2].trim().slice(0, 12)
  }
  return ''
}

/**
 * 解析 AI 返回的题目 JSON。
 * 按题型过滤非法项（word/calc 数字答案、fill 文字、choice 索引+4 选项），裁剪到 count。
 * allowedTypes 白名单：模型偶发出白名单外题型时跳过，保证不偏离单元约束。
 */
export function parseStoryMath(
  content: string,
  count: number,
  allowedTypes?: StoryMathQuestionType[],
): StoryMathProblem[] {
  const list = extractStoryMathArray(content)
  const allow = allowedTypes && allowedTypes.length ? new Set(allowedTypes) : null
  const out: StoryMathProblem[] = []
  for (const item of list) {
    const text = String(item?.text ?? '').trim()
    if (!text) continue
    // 纯文本链路无插图：含看图表述的题面孩子无法作答，整题丢弃（prompt 已禁图，这里兜底）
    if (IMAGE_REF_RE.test(text)) continue
    const type = normalizeQuestionType(item?.type)
    if (allow && !allow.has(type)) continue
    let answer: number | string | null = null
    let options: string[] | undefined
    if (type === 'choice') {
      const opts = Array.isArray(item?.options) ? item.options.map((o: unknown) => String(o).trim()).filter(Boolean) : []
      if (opts.length !== 4) continue
      const idx = toFiniteNumber(item?.answer)
      if (idx === null || !Number.isInteger(idx) || idx < 0 || idx > 3) continue
      answer = idx
      options = opts
    } else if (type === 'fill') {
      const a = String(item?.answer ?? '').trim()
      if (!a) continue
      answer = a.slice(0, 40)
    } else {
      // word / calc：数字答案（含「8个」「3.5元」这类带单位字符串，提取数字部分）
      const a = toFiniteNumber(item?.answer)
      if (a === null) continue
      answer = a
    }
    const knowledgePoint = String(item?.knowledgePoint ?? '').trim().slice(0, 40) || '未标注'
    const unit = type === 'word' || type === 'calc' ? extractUnit(item) : ''
    out.push({
      text: text.slice(0, 400),
      type,
      ...(options ? { options } : {}),
      answer,
      unit,
      knowledgePoint,
      ...(item?.hint ? { hint: String(item.hint).slice(0, 120) } : {}),
    })
    if (out.length >= count) break
  }
  return out
}

/** 解析拍照识题结果：{ answer, confidence }。看不清时 answer=0 且 confidence=0，前端提示重拍。 */
export function parseStoryMathRecognize(content: string): { answer: number; confidence: number } | null {
  const obj = extractStoryMathObject(content)
  if (!obj) return null
  const answer = toFiniteNumber(obj?.answer)
  if (answer === null) return null
  let confidence = Number(obj?.confidence)
  if (!Number.isFinite(confidence)) confidence = 0.5
  return { answer, confidence: Math.max(0, Math.min(1, confidence)) }
}

/**
 * 解析判卷结果：{ items: [...] }。逐题按题型解析答案，缺项/缺答案按「无法判定」丢弃整卷。
 * 判卷必须逐题齐全：缺任何一项都视为解析失败，避免静默丢题导致正确率失真。
 */
export function parseStoryMathJudge(content: string, submissions: any[]): any[] | null {
  const obj = extractStoryMathObject(content)
  if (!obj) return null
  const raw = Array.isArray(obj?.items) ? obj.items : null
  if (!raw) return null
  const items: any[] = []
  for (let i = 0; i < submissions.length; i++) {
    const sub = submissions[i]
    const item = raw[i]
    if (!item || typeof item !== 'object') return null
    const type = normalizeQuestionType(sub?.type)
    let answer: number | string | null = null
    if (type === 'choice') {
      const idx = toFiniteNumber(item?.answer)
      if (idx === null || !Number.isInteger(idx) || idx < 0 || idx > 3) return null
      answer = idx
    } else if (type === 'fill') {
      const a = String(item?.answer ?? '').trim()
      if (!a) return null
      answer = a.slice(0, 40)
    } else {
      const a = toFiniteNumber(item?.answer)
      if (a === null) return null
      answer = a
    }
    items.push({
      index: i,
      correct: item?.correct === true,
      answer,
      ...(sub?.type ? { type: normalizeQuestionType(sub?.type) } : {}),
      ...(Array.isArray(sub?.options) && sub.options.length ? { options: sub.options } : {}),
      solution: String(item?.solution ?? '').trim().slice(0, 200),
      knowledgePoint: String(item?.knowledgePoint ?? '').trim().slice(0, 40) || '未标注',
      ...(item?.errorStep ? { errorStep: String(item.errorStep).trim().slice(0, 120) } : {}),
    })
  }
  return items
}
