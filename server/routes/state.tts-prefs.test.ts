import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { DEFAULT_SETTINGS } from '../../shared/constants'
import type { Settings } from '../../shared/types'
import type { ProfileRecord, StoredSession } from '../store'

type MockState = {
  settings: Settings
  sessions: StoredSession[]
  family: unknown
  profiles: ProfileRecord[]
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
  }
})

beforeEach(() => {
  mockState.settings = structuredClone(DEFAULT_SETTINGS) as Settings
  mockState.profiles = [
    {
      id: 'kid1',
      name: '小明',
      avatar: '🦊',
      pinHash: 'x',
      createdAt: 1,
      points: 0,
      badges: [],
      ttsPrefs: { order: ['edge', 'native'], voice: { edge: 'zh-CN-YunxiNeural' } },
    },
  ]
  mockState.sessions = [
    { token: 'tok_child', role: 'child', profileId: 'kid1', createdAt: 1, expiresAt: Date.now() + 60_000 },
    { token: 'tok_parent', role: 'parent', createdAt: 1, expiresAt: Date.now() + 60_000 },
  ]
})

async function buildApp() {
  const { stateRoutes } = await import('./state')
  const app = new Hono()
  app.route('/api/state', stateRoutes)
  return app
}

describe('PATCH /api/state/tts-prefs', () => {
  it('孩子可以改自己的朗读顺序与音色', async () => {
    const app = await buildApp()
    const res = await app.request('/api/state/tts-prefs', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer tok_child',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        order: ['native', 'edge'],
        voice: { edge: 'zh-CN-XiaoxiaoNeural', openai: 'anna' },
      }),
    })
    expect(res.status).toBe(200)
    expect(mockState.profiles[0].ttsPrefs?.order).toEqual(['native', 'edge'])
    expect(mockState.profiles[0].ttsPrefs?.voice.edge).toBe('zh-CN-XiaoxiaoNeural')
    expect(mockState.profiles[0].ttsPrefs?.voice.openai).toBe('anna')
    const data = await res.json()
    // 快照 ttsPlan 已按新偏好计算（enabled 默认 native+edge）
    expect(data.ttsPlan.order).toEqual(['native', 'edge'])
    expect(data.ttsPlan.voice.edge).toBe('zh-CN-XiaoxiaoNeural')
  })

  it('家长身份不能改孩子偏好（403）', async () => {
    const app = await buildApp()
    const res = await app.request('/api/state/tts-prefs', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer tok_parent',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ order: ['openai'] }),
    })
    expect(res.status).toBe(403)
    expect(mockState.profiles[0].ttsPrefs?.order).toEqual(['edge', 'native'])
  })

  it('order 清洗：非法来源剔除、重复合并；只传 voice 时不动 order', async () => {
    const app = await buildApp()
    const res = await app.request('/api/state/tts-prefs', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer tok_child',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ order: ['bogus', 'openai', 'openai', 'native'] }),
    })
    expect(res.status).toBe(200)
    expect(mockState.profiles[0].ttsPrefs?.order).toEqual(['openai', 'native'])

    const res2 = await app.request('/api/state/tts-prefs', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer tok_child',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ voice: { edge: '  zh-CN-YunyangNeural  ' } }),
    })
    expect(res2.status).toBe(200)
    expect(mockState.profiles[0].ttsPrefs?.order).toEqual(['openai', 'native'])
    expect(mockState.profiles[0].ttsPrefs?.voice.edge).toBe('zh-CN-YunyangNeural')
  })

  it('ttsPlan.order 已与家长 enabled 取交集：关掉的来源不会出现在孩子顺序里', async () => {
    // 家长只启用 edge（不含 native / openai）
    mockState.settings.tts.enabled = ['edge']
    mockState.profiles[0].ttsPrefs = {
      order: ['native', 'openai', 'edge'],
      voice: {},
    }
    const app = await buildApp()
    const res = await app.request('/api/state', {
      method: 'GET',
      headers: { authorization: 'Bearer tok_child' },
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ttsPlan.enabled).toEqual(['edge'])
    expect(data.ttsPlan.order).toEqual(['edge'])
  })
})
