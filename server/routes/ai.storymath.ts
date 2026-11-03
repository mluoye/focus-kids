import { Hono } from 'hono'
import type { AppEnv } from '../middleware'
import { requireAuth } from '../middleware'
import { invalidJson, readJson } from '../json'
import { storyMathJudgePrompt, storyMathPrompt, storyMathRecognizePrompt } from '../ai/prompts'
import { listUnits } from '../ai/knowledge'
import { validateStoryMathQuestions } from '../ai/validate'
import { parseStoryMath, parseStoryMathJudge, parseStoryMathRecognize } from '../ai/storymath/parser'
import { resolveStoryMathContext } from '../ai/storymath/context'
import { resolveConfig, isConfigError, chatEndpoint, classifyUpstream, classifyNetwork } from '../ai/config'
import type { StoryMathGrade, StoryMathQuestionType } from '../../shared/types'

export const storyMathRoutes = new Hono<AppEnv>()

/**
 * AI 应用题拍照识题：从孩子列的竖式/计算过程照片里提取最终答案与置信度。
 * 需要视觉模型；未配置视觉时明确返回 `VISION_NOT_CONFIGURED`。
 */
storyMathRoutes.post('/recognize', requireAuth, async (c) => {
  const config = resolveConfig()
  if (isConfigError(config)) {
    return c.json({ error: config.error, code: config.code, hint: config.hint }, config.status === 400 ? 503 : config.status)
  }
  if (!config.vision.model) {
    return c.json(
      {
        error: '还没有配置拍照识题模型，请家长在「AI 设置 → 拍照识题模型」里填写',
        code: 'VISION_NOT_CONFIGURED',
        hint: '如 glm-4v-flash / qwen-vl-plus；地址与密钥留空则继承对话模型',
      },
      400,
    )
  }
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const image = typeof body?.image === 'string' ? body.image : ''
  if (!image.startsWith('data:image/')) return c.json({ error: '请上传一张图片', code: 'INVALID_IMAGE' }, 400)
  // 图片上限：判卷/识别都是单张，压缩后通常 <2MB，这里放宽到 4MB 兼容更大照片
  if (image.length > 4_000_000) return c.json({ error: '图片过大，请压缩后重拍', code: 'IMAGE_TOO_LARGE' }, 400)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)
  c.req.raw.signal.addEventListener('abort', () => controller.abort())

  try {
    const upstream = await fetch(chatEndpoint(config.vision.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.vision.apiKey}`,
      },
      body: JSON.stringify({
        model: config.vision.model,
        messages: [
          { role: 'system', content: '你是数学老师，只输出规定的 JSON 对象，不输出任何其他内容。' },
          {
            role: 'user',
            content: [
              { type: 'text', text: storyMathRecognizePrompt() },
              { type: 'image_url', image_url: { url: image.slice(0, 4_000_000) } },
            ],
          },
        ],
        temperature: 0.1,
        stream: false,
        max_tokens: 300,
      }),
      signal: controller.signal,
    })
    if (!upstream.ok) {
      const text = (await upstream.text().catch(() => '')).slice(0, 400)
      clearTimeout(timeout)
      // 配了视觉模型但上游仍拒图：引导检查模型是否真的支持视觉输入
      if (/image|vision|multimodal|图片|看图|识图|content.*invalid/i.test(text)) {
        return c.json(
          {
            error: '当前视觉模型不支持看图，请在「AI 设置」换一个支持视觉的模型（如 glm-4v-flash 或 qwen-vl-plus）',
            code: 'VISION_NOT_SUPPORTED',
            hint: '确认模型名正确，且该厂商支持图片输入',
          },
          400,
        )
      }
      const { code, message, hint } = classifyUpstream(upstream.status, text)
      return c.json({ error: `${message}：${text.slice(0, 200)}`, code, hint, detail: text }, 502)
    }
    const data: any = await upstream.json().catch(() => null)
    const content = String(data?.choices?.[0]?.message?.content ?? '')
    const parsed = parseStoryMathRecognize(content)
    if (!parsed) {
      return c.json(
        { error: 'AI 没能读出答案，请把算式拍清楚一点，或直接输入答案', code: 'AI_PARSE_ERROR', hint: '照片可能太糊、被裁切或拍歪' },
        502,
      )
    }
    return c.json(parsed)
  } catch (err: any) {
    clearTimeout(timeout)
    if (controller.signal.aborted) return new Response(null, { status: 499 })
    const { code, message, hint, status } = classifyNetwork(err)
    return c.json({ error: message, code, hint }, status)
  } finally {
    clearTimeout(timeout)
  }
})

/**
 * AI 应用题判卷：对整卷逐题判定对错，返回标准答案、错误位置与解题思路。
 */
storyMathRoutes.post('/judge', requireAuth, async (c) => {
  const config = resolveConfig()
  if (isConfigError(config)) {
    return c.json({ error: config.error, code: config.code, hint: config.hint }, config.status === 400 ? 503 : config.status)
  }
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const submissions = Array.isArray(body?.submissions) ? body.submissions : []
  if (submissions.length === 0) return c.json({ error: '没有可判卷的题目', code: 'EMPTY' }, 400)
  if (submissions.length > 20) return c.json({ error: '一次最多判卷 20 题', code: 'TOO_MANY' }, 400)
  for (const s of submissions) {
    if (typeof s?.text !== 'string' || !s.text.trim()) return c.json({ error: '存在缺题面文字的题', code: 'INVALID_ITEM' }, 400)
    const okSub = (typeof s?.submitted === 'number' && Number.isFinite(s.submitted)) || (typeof s?.submitted === 'string' && s.submitted.trim() !== '')
    if (!okSub) {
      return c.json({ error: '存在未作答的题', code: 'INVALID_ITEM' }, 400)
    }
  }

  const system = { role: 'system', content: '你是小学老师批改应用题，只输出规定的 JSON 对象，不输出任何其他内容。' }
  const user = { role: 'user', content: storyMathJudgePrompt() + '\n\n待判卷的题：\n' + JSON.stringify(submissions) }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)
  c.req.raw.signal.addEventListener('abort', () => controller.abort())

  try {
    const upstream = await fetch(chatEndpoint(config.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [system, user],
        temperature: 0.2,
        stream: false,
        max_tokens: 4000,
        reasoning_effort: 'none',
      }),
      signal: controller.signal,
    })
    if (!upstream.ok) {
      const text = (await upstream.text().catch(() => '')).slice(0, 400)
      clearTimeout(timeout)
      const { code, message, hint } = classifyUpstream(upstream.status, text)
      return c.json({ error: `${message}：${text.slice(0, 200)}`, code, hint, detail: text }, 502)
    }
    const data: any = await upstream.json().catch(() => null)
    const content = String(data?.choices?.[0]?.message?.content ?? '')
    const parsed = parseStoryMathJudge(content, submissions)
    if (!parsed) {
      return c.json(
        { error: 'AI 判卷结果无法解析，请重试', code: 'AI_PARSE_ERROR', hint: '模型可能返回了非 JSON 内容，稍后再试' },
        502,
      )
    }
    return c.json({ items: parsed })
  } catch (err: any) {
    clearTimeout(timeout)
    if (controller.signal.aborted) return new Response(null, { status: 499 })
    const { code, message, hint, status } = classifyNetwork(err)
    return c.json({ error: message, code, hint }, status)
  } finally {
    clearTimeout(timeout)
  }
})

/**
 * 单元列表（家长端 AI 应用题设置用）：返回某年级某学期全部单元，标注支持题型与是否含应用题。
 */
storyMathRoutes.get('/units', requireAuth, (c) => {
  const grade = Number(c.req.query('grade')) || 1
  const term = Number(c.req.query('term')) === 2 ? 2 : 1
  const units = listUnits(Math.min(6, Math.max(1, grade)) as StoryMathGrade, term)
  return c.json({
    units: units.map((u) => ({
      unitNo: u.unitNo,
      name: u.unitName,
      hasWord: u.questionTypes.includes('word'),
      questionTypes: u.questionTypes,
    })),
  })
})

/**
 * AI 生成应用题（storymath）：按年级/单元出 N 道题，一次返回整包。
 */
storyMathRoutes.post('/', requireAuth, async (c) => {
  const config = resolveConfig()
  if (isConfigError(config)) {
    return c.json({ error: config.error, code: config.code, hint: config.hint }, config.status === 400 ? 503 : config.status)
  }
  const body = await readJson(c)
  if (!body) return invalidJson(c)
  const grade = Number(body?.grade) || 1
  const count = Number(body?.count) || 5
  if (grade < 1 || grade > 6) return c.json({ error: '年级需为 1~6', code: 'INVALID_GRADE' }, 400)
  if (count < 1 || count > 20) return c.json({ error: '题量需为 1~20', code: 'INVALID_COUNT' }, 400)
  // 专项训练轮：可传 focusPoints（错题知识点），服务端按它出变式题；主轮不传
  const focusPoints: string[] = Array.isArray(body?.focusPoints)
    ? body.focusPoints.map((x: unknown) => String(x ?? '').trim()).filter(Boolean).slice(0, 6)
    : []

  const ctx = resolveStoryMathContext(body, grade)
  if (ctx.error) return c.json(ctx.error, ctx.status)
  const { unit, units, term, unitNo, constraints, forbidden } = ctx

  const kb = units ?? (unit ? [unit] : undefined)
  if (kb && !kb.some((u) => u.questionTypes.length)) {
    return c.json(
      { error: '该单元暂无可出的题型，请换一个单元', code: 'UNIT_NO_WORD', hint: '请换一个单元' },
      400,
    )
  }
  const allTypes: StoryMathQuestionType[] = ['word', 'calc', 'fill', 'choice']
  const questionTypes = kb ? [...new Set(kb.flatMap((u) => u.questionTypes))] : allTypes

  const system = { role: 'system', content: '你是小学数学应用题出题器，只输出规定的 JSON 数组，不输出任何其他内容。' }
  const user = { role: 'user', content: storyMathPrompt({ grade, count, unit, units, term, unitNo, focusPoints, questionTypes }) }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)
  c.req.raw.signal.addEventListener('abort', () => controller.abort())

  try {
    // 深度思考模型偶发把 token 预算全花在 reasoning 上导致 content 为空：重试几轮
    const MAX_RETRY = 3
    let content = ''
    let parsed: ReturnType<typeof parseStoryMath> = []
    for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
      const upstream = await fetch(chatEndpoint(config.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [system, user],
          temperature: 0.4,
          stream: false,
          max_tokens: 3000,
          reasoning_effort: 'none',
        }),
        signal: controller.signal,
      })
      if (!upstream.ok) {
        const text = (await upstream.text().catch(() => '')).slice(0, 400)
        const { code, message, hint } = classifyUpstream(upstream.status, text)
        return c.json({ error: `${message}：${text.slice(0, 200)}`, code, hint, detail: text }, 502)
      }
      const data: any = await upstream.json().catch(() => null)
      content = String(data?.choices?.[0]?.message?.content ?? '')
      parsed = parseStoryMath(content, count, questionTypes)
      if (parsed.length) break
      if (attempt < MAX_RETRY - 1) await new Promise((r) => setTimeout(r, 600))
    }
    if (!parsed.length) {
      return c.json(
        {
          error: 'AI 生成的题目无法解析，请重试',
          code: 'AI_PARSE_ERROR',
          hint: '模型可能返回了非 JSON 内容，稍后再试或换一个模型',
          detail: content.slice(0, 800),
        },
        502,
      )
    }
    // 红队校验：按单元/整合复习的硬性约束过滤超纲题
    const final = kb && constraints ? validateStoryMathQuestions(parsed, constraints, forbidden) : { kept: parsed, reasons: [] }
    if (!final.kept.length) {
      return c.json(
        {
          error: 'AI 生成的题目未通过进度校验，请重试',
          code: 'AI_VALIDATE_ERROR',
          hint: '题目疑似超纲（数字范围 / 禁止考点 / 负号），已拦截',
          detail: final.reasons.slice(0, 5).join('；').slice(0, 400),
        },
        502,
      )
    }
    const unitInfo = unit
      ? { unit: { term: unit.term, unitNo: unit.unitNo, name: unit.unitName } }
      : units && units.length
        ? {
            unitRange: {
              term: units[0].term,
              from: units[0].unitNo,
              to: units[units.length - 1].unitNo,
              name: units.map((u) => u.unitName).join('、'),
            },
          }
        : {}
    return c.json({ grade, questions: final.kept, ...unitInfo })
  } catch (err: any) {
    clearTimeout(timeout)
    if (controller.signal.aborted) return new Response(null, { status: 499 })
    const { code, message, hint, status } = classifyNetwork(err)
    return c.json({ error: message, code, hint }, status)
  } finally {
    clearTimeout(timeout)
  }
})
