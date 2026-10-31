import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Settings } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/constants'
import type { StoredSession } from '../store'

type MockState = {
  settings: Settings
  sessions: StoredSession[]
}

const mockState: MockState = {
  settings: structuredClone(DEFAULT_SETTINGS) as Settings,
  sessions: [],
}

vi.mock('../store', () => ({
  getState: () => mockState,
  saveState: vi.fn(async () => {}),
}))

async function buildApp() {
  const { aiRoutes } = await import('./ai')
  const { requireAuth } = await import('../middleware')
  const app = new Hono()
  app.route('/api/ai', aiRoutes)
  void requireAuth
  return app
}

beforeEach(() => {
  mockState.settings = structuredClone(DEFAULT_SETTINGS) as Settings
  // 默认开启 AI，填好对话配置
  mockState.settings.ai = {
    enabled: true,
    baseUrl: 'https://api.example.com/v1',
    model: 'test-model',
    temperature: 0.7,
    apiKey: 'sk-test',
    apiKeyMasked: '****',
    vision: { baseUrl: '', model: '', apiKeyMasked: '' },
  }
  mockState.sessions = [
    { token: 'tok_parent', role: 'parent', createdAt: 1, expiresAt: Date.now() + 60_000 },
  ]
})

function authHeaders(body?: unknown) {
  return {
    authorization: 'Bearer tok_parent',
    ...(body ? { 'content-type': 'application/json' } : {}),
  }
}

describe('POST /api/ai/storymath', () => {
  it('AI 未开启时返回 503 AI_NOT_READY', async () => {
    mockState.settings.ai.enabled = false
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ grade: 2, count: 10 }),
    })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.code).toBe('AI_NOT_READY')
  })

  it('AI 未配 key 时返回 503（按服务不可用处理）', async () => {
    mockState.settings.ai.apiKey = ''
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ grade: 2, count: 10 }),
    })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.code).toBe('AI_NOT_CONFIGURED')
  })

  it('年级超范围返回 400 INVALID_GRADE', async () => {
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ grade: 7, count: 10 }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('INVALID_GRADE')
  })

  it('上游返回合法 JSON 时，解析出题目并裁剪到 count', async () => {
    const upstream = vi.fn(async () => {
      const content = JSON.stringify([
        { text: '小明有 5 个苹果，又买了 3 个，一共几个？', answer: 8, unit: '个', knowledgePoint: '20以内加法' },
        { text: '每盒 4 支笔，3 盒共几支？', answer: 12, unit: '支', knowledgePoint: '表内乘法' },
        { text: '无效题（缺答案）', unit: '个' },
        { text: '也无效（空文本）', answer: 1 },
      ])
      return new Response(
        JSON.stringify({ choices: [{ message: { content } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', upstream)
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ grade: 2, count: 2 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.grade).toBe(2)
    expect(body.questions).toHaveLength(2)
    expect(body.questions[0]).toEqual({ text: expect.any(String), answer: 8, unit: '个', knowledgePoint: '20以内加法' })
    expect(body.questions[1].answer).toBe(12)
    // 无效项被过滤
    expect(body.questions.every((q: any) => typeof q.answer === 'number')).toBe(true)
    vi.unstubAllGlobals()
  })

  it('答案带单位字符串（如「8个」「3.5元」）也能解析成数字，不丢弃题目', async () => {
    const upstream = vi.fn(async () => {
      const content = JSON.stringify([
        { text: '小明有 5 个苹果，又买了 3 个，一共几个？', answer: '8个', knowledgePoint: '20以内加法' },
        { text: '每千克 3.5 元，买 2 千克多少钱？', answer: '7元', knowledgePoint: '小数乘法' },
        { text: '数字字符串也能解析', answer: '12' },
      ])
      return new Response(
        JSON.stringify({ choices: [{ message: { content } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', upstream)
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ grade: 3, count: 10 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.questions).toHaveLength(3)
    expect(body.questions[0]).toEqual({ text: expect.any(String), answer: 8, unit: '个', knowledgePoint: '20以内加法' })
    expect(body.questions[1].answer).toBe(7)
    expect(body.questions[1].unit).toBe('元')
    expect(body.questions[2].answer).toBe(12)
    vi.unstubAllGlobals()
  })

  it('答案带空格单位（如「8 个」）也能解析', async () => {
    const upstream = vi.fn(async () => {
      const content = JSON.stringify([{ text: '共有多少个？', answer: '8 个' }])
      return new Response(
        JSON.stringify({ choices: [{ message: { content } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', upstream)
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ grade: 1, count: 10 }),
    })
    const body = await res.json()
    expect(body.questions[0].answer).toBe(8)
    expect(body.questions[0].unit).toBe('个')
    vi.unstubAllGlobals()
  })

  it('markdown 代码块包裹的数组也能解析', async () => {
    const content = '```json\n' + JSON.stringify([
      { text: '小明有 5 个苹果，又买了 3 个，一共几个？', answer: 8, unit: '个' },
      { text: '每盒 4 支笔，3 盒共几支？', answer: 12, unit: '支' },
    ]) + '\n```'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ grade: 2, count: 10 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.questions).toHaveLength(2)
    expect(body.questions[0].answer).toBe(8)
    vi.unstubAllGlobals()
  })

  it('对象包裹 {"questions":[...]} 也能解析', async () => {
    const content = JSON.stringify({
      questions: [
        { text: '一辆车每小时 60 千米，3 小时走多少千米？', answer: 180, unit: '千米' },
      ],
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ grade: 4, count: 10 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.questions).toHaveLength(1)
    expect(body.questions[0].answer).toBe(180)
    vi.unstubAllGlobals()
  })

  it('题面文本含 [ ] 符号（如第[2]题）时，用平衡括号截取不被截断', async () => {
    const content = '以下是题目：\n' + JSON.stringify([
      { text: '书架有 [2] 层，每层 5 本，共几本？', answer: 10, unit: '本' },
      { text: '第二题', answer: 3 },
    ])
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ grade: 2, count: 10 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.questions).toHaveLength(2)
    expect(body.questions[0].text).toContain('[2]')
    expect(body.questions[0].answer).toBe(10)
    vi.unstubAllGlobals()
  })

  it('前置说明文字 + 裸数组也能解析', async () => {
    const content = '好的，以下是为你准备的题目：\n' + JSON.stringify([
      { text: '有 12 个橘子，平均分给 3 个小朋友，每人几个？', answer: 4, unit: '个' },
    ])
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ grade: 3, count: 10 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.questions).toHaveLength(1)
    expect(body.questions[0].answer).toBe(4)
    vi.unstubAllGlobals()
  })

  it('上游返回非 JSON 内容时报 AI_PARSE_ERROR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '这根本不是题目，只是一段废话' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ grade: 2, count: 10 }),
    })
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.code).toBe('AI_PARSE_ERROR')
    vi.unstubAllGlobals()
  })

  it('答案用中文数字（如「八」「十五」）也能解析成数字', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify([
        { text: '小明有 5 个苹果，又买了 3 个，一共几个？', answer: '八', unit: '个', knowledgePoint: '20以内加法' },
        { text: '每盒 4 支笔，3 盒共几支？', answer: '十五', unit: '支', knowledgePoint: '表内乘法' },
      ]) } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ grade: 2, count: 10 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.questions[0].answer).toBe(8)
    expect(body.questions[1].answer).toBe(15)
    vi.unstubAllGlobals()
  })

  it('questions 被序列化成字符串（"questions": "[{...}]"）也能解析', async () => {
    const inner = JSON.stringify([
      { text: '小明有 5 个苹果，又买了 3 个，一共几个？', answer: 8, unit: '个', knowledgePoint: '20以内加法' },
    ])
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({ questions: inner }) } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ grade: 2, count: 10 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.questions[0].answer).toBe(8)
    vi.unstubAllGlobals()
  })

  it('四反引号围栏包裹的数组也能解析', async () => {
    const content = '````json\n' + JSON.stringify([
      { text: '有 12 个橘子，平均分给 3 人，每人几个？', answer: 4, unit: '个', knowledgePoint: '表内除法' },
    ]) + '\n````'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ grade: 3, count: 10 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.questions[0].answer).toBe(4)
    vi.unstubAllGlobals()
  })

  it('题目前说明文字含假 [ ]（如「第[2]题」）时跳过假数组取真数组', async () => {
    const content = '这里有[2]道题：\n' + JSON.stringify([
      { text: '书架有 [2] 层，每层 5 本，共几本？', answer: 10, unit: '本', knowledgePoint: '表内乘法' },
      { text: '第二题', answer: 3, knowledgePoint: '20以内加法' },
    ])
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ grade: 2, count: 10 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.questions).toHaveLength(2)
    expect(body.questions[0].text).toContain('[2]')
    expect(body.questions[0].answer).toBe(10)
    vi.unstubAllGlobals()
  })

  it('失败时返回 detail 携带原始 content 供定位', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: '完全无法解析的一坨文字' } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ grade: 2, count: 10 }),
    })
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.code).toBe('AI_PARSE_ERROR')
    expect(body.detail).toContain('完全无法解析')
    vi.unstubAllGlobals()
  })
})

describe('POST /api/ai/storymath/judge', () => {
  const submissions = [
    { text: '小明有 5 个苹果，又买了 3 个，一共几个？', answer: 8, unit: '个', knowledgePoint: '20以内加法', submitted: 8, mode: 'keypad' },
    { text: '每盒 4 支笔，3 盒共几支？', answer: 12, unit: '支', knowledgePoint: '表内乘法', submitted: 10, mode: 'keypad' },
  ]

  it('AI 未开启时返回 503 AI_NOT_READY', async () => {
    mockState.settings.ai.enabled = false
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath/judge', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ submissions }),
    })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.code).toBe('AI_NOT_READY')
  })

  it('无提交内容返回 400 EMPTY', async () => {
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath/judge', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ submissions: [] }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('EMPTY')
  })

  it('缺答案的题返回 400 INVALID_ITEM', async () => {
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath/judge', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ submissions: [{ text: '题', submitted: null }] }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('INVALID_ITEM')
  })

  it('上游返回合法判卷结果时，逐题返回标准答案与思路', async () => {
    const content = JSON.stringify({
      items: [
        { index: 0, correct: true, answer: 8, solution: '5+3=8，共 8 个。', knowledgePoint: '20以内加法', errorStep: '' },
        { index: 1, correct: false, answer: 12, solution: '4×3=12，共 12 支。', knowledgePoint: '表内乘法', errorStep: '第二步 4×3 算成 10' },
      ],
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath/judge', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ submissions }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(2)
    expect(body.items[0]).toEqual({ index: 0, correct: true, answer: 8, solution: '5+3=8，共 8 个。', knowledgePoint: '20以内加法' })
    expect(body.items[1].correct).toBe(false)
    expect(body.items[1].errorStep).toBe('第二步 4×3 算成 10')
    vi.unstubAllGlobals()
  })

  it('判卷结果缺项时返回 AI_PARSE_ERROR（不静默丢题）', async () => {
    const content = JSON.stringify({ items: [{ index: 0, correct: true, answer: 8, solution: 'x', knowledgePoint: 'y' }] })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath/judge', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ submissions }),
    })
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.code).toBe('AI_PARSE_ERROR')
    vi.unstubAllGlobals()
  })

  it('markdown 代码块包裹的判卷结果也能解析', async () => {
    const content = '```json\n' + JSON.stringify({
      items: [
        { index: 0, correct: true, answer: 8, solution: '5+3=8', knowledgePoint: '20以内加法' },
        { index: 1, correct: true, answer: 12, solution: '4×3=12', knowledgePoint: '表内乘法' },
      ],
    }) + '\n```'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath/judge', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ submissions }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items[0].correct).toBe(true)
    vi.unstubAllGlobals()
  })
})

describe('POST /api/ai/storymath/recognize', () => {
  beforeEach(() => {
    mockState.settings.ai.vision = { baseUrl: '', model: 'vision-model', apiKeyMasked: '' }
  })

  it('未配置视觉模型时返回 400 VISION_NOT_CONFIGURED', async () => {
    mockState.settings.ai.vision = { baseUrl: '', model: '', apiKeyMasked: '' }
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath/recognize', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ image: 'data:image/png;base64,xxxx' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('VISION_NOT_CONFIGURED')
  })

  it('图片非 data URL 返回 400 INVALID_IMAGE', async () => {
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath/recognize', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ image: 'http://x/y.png' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('INVALID_IMAGE')
  })

  it('上游返回合法识别结果时，返回答案与置信度', async () => {
    const content = JSON.stringify({ answer: 8, confidence: 0.9 })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath/recognize', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ image: 'data:image/png;base64,xxxx' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.answer).toBe(8)
    expect(body.confidence).toBe(0.9)
    vi.unstubAllGlobals()
  })

  it('上游返回非 JSON 时报 AI_PARSE_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: '看不清' } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    const app = await buildApp()
    const res = await app.request('/api/ai/storymath/recognize', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ image: 'data:image/png;base64,xxxx' }),
    })
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.code).toBe('AI_PARSE_ERROR')
    vi.unstubAllGlobals()
  })
})
