import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { DEFAULT_SETTINGS } from '../../shared/constants'
import type { Settings } from '../../shared/types'
import type { StoredSession } from '../store'

type MockState = {
  settings: Settings
  sessions: StoredSession[]
  family: unknown
  profiles: unknown[]
  records: unknown[]
  homework: unknown[]
  homeworkPlans: unknown[]
}

const mockState: MockState = {
  settings: structuredClone(DEFAULT_SETTINGS) as Settings,
  sessions: [],
  family: { id: 'f1', username: 'u', passwordHash: 'x', childPinLength: 4, createdAt: 1 },
  profiles: [],
  records: [],
  homework: [],
  homeworkPlans: [],
}

vi.mock('../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store')>()
  return {
    ...actual,
    getState: () => mockState,
    saveState: vi.fn(async () => {}),
    writePruneBackup: vi.fn(async () => {}),
  }
})

beforeEach(() => {
  mockState.settings = structuredClone(DEFAULT_SETTINGS) as Settings
  mockState.sessions = [
    { token: 'tok_parent', role: 'parent', createdAt: 1, expiresAt: Date.now() + 60_000 },
  ]
})

async function buildApp() {
  const { stateRoutes } = await import('./state')
  const app = new Hono()
  app.route('/api/state', stateRoutes)
  return app
}

describe('PATCH /api/state/settings 合并 tts', () => {
  it('写入 enabled/openai 连接配置，不再接受客户端写 provider/priority/voice', async () => {
    const app = await buildApp()
    const res = await app.request('/api/state/settings', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer tok_parent',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        tts: {
          enabled: ['native', 'openai'],
          // 以下为 deprecated 字段，客户端提交应被忽略
          provider: 'openai',
          priority: ['openai'],
          voice: 'zh-CN-HackedNeural',
          openai: {
            baseUrl: 'https://api.example.com/v1',
            model: 'cosyvoice',
            voice: 'anna',
            apiKey: 'sk-new-key',
          },
        },
      }),
    })
    expect(res.status).toBe(200)
    expect(mockState.settings.tts.enabled).toEqual(['native', 'openai'])
    expect(mockState.settings.tts.openai.baseUrl).toBe('https://api.example.com/v1')
    expect(mockState.settings.tts.openai.model).toBe('cosyvoice')
    expect(mockState.settings.tts.openai.apiKey).toBe('sk-new-key')
    // deprecated 字段不被客户端改写
    expect(mockState.settings.tts.provider).toBeUndefined()
    expect(mockState.settings.tts.priority).toBeUndefined()
    expect(mockState.settings.tts.voice).toBeUndefined()
  })

  it('不传 tts 时保留原配置，只更新 ai', async () => {
    mockState.settings.tts.enabled = ['openai']
    mockState.settings.tts.openai.model = 'keep-me'
    const app = await buildApp()
    const res = await app.request('/api/state/settings', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer tok_parent',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ai: { enabled: false, baseUrl: '', model: '', temperature: 0.7 } }),
    })
    expect(res.status).toBe(200)
    expect(mockState.settings.tts.enabled).toEqual(['openai'])
    expect(mockState.settings.tts.openai.model).toBe('keep-me')
    expect(mockState.settings.ai.enabled).toBe(false)
  })
})

describe('PATCH /api/state/settings enabled 清洗', () => {
  it('写入 enabled，并剔除非法值与重复项', async () => {
    const app = await buildApp()
    const res = await app.request('/api/state/settings', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer tok_parent',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        tts: { enabled: ['openai', 'bogus', 'edge', 'openai', 'native'] },
      }),
    })
    expect(res.status).toBe(200)
    expect(mockState.settings.tts.enabled).toEqual(['openai', 'edge', 'native'])
  })

  it('enabled 为空时回落到默认启用集（原生 + Edge）', async () => {
    mockState.settings.tts.enabled = ['openai']
    const app = await buildApp()
    const res = await app.request('/api/state/settings', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer tok_parent',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ tts: { enabled: [] } }),
    })
    expect(res.status).toBe(200)
    expect(mockState.settings.tts.enabled).toEqual(['native', 'edge'])
  })

  it('客户端提交 verified / lastFailure 一律忽略（只能由试听与合成接口写入）', async () => {
    mockState.settings.tts.verified = { edge: { at: 1, fingerprint: 'real' } }
    const app = await buildApp()
    const res = await app.request('/api/state/settings', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer tok_parent',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        tts: {
          verified: { edge: { at: 999, fingerprint: 'forged' } },
          lastFailure: { source: 'edge', at: 999, message: '伪造' },
        },
      }),
    })
    expect(res.status).toBe(200)
    expect(mockState.settings.tts.verified).toEqual({ edge: { at: 1, fingerprint: 'real' } })
    expect(mockState.settings.tts.lastFailure).toBeNull()
  })
})
