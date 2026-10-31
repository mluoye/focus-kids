import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { StoredSession, ProfileRecord } from '../store'

type MockState = {
  profiles: ProfileRecord[]
  records: unknown[]
  homework: unknown[]
  homeworkPlans: unknown[]
  sessions: StoredSession[]
  family: unknown
}

const mockState: MockState = {
  profiles: [],
  records: [],
  homework: [],
  homeworkPlans: [],
  sessions: [],
  family: { id: 'f1', username: 'u', passwordHash: 'x', childPinLength: 4, createdAt: 1 },
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
  mockState.profiles = [
    {
      id: 'kid1',
      name: '小明',
      avatar: '🦊',
      pinHash: 'x',
      createdAt: 1,
      points: 0,
      badges: [],
    },
  ]
  mockState.sessions = [
    { token: 'tok_parent', role: 'parent', createdAt: 1, expiresAt: Date.now() + 60_000 },
  ]
})

async function buildApp() {
  const { profileRoutes } = await import('./profiles')
  const app = new Hono()
  app.route('/api/profiles', profileRoutes)
  return app
}

function authHeaders(body?: unknown) {
  return {
    authorization: 'Bearer tok_parent',
    ...(body ? { 'content-type': 'application/json' } : {}),
  }
}

describe('PATCH /api/profiles/:id 口算速算偏好', () => {
  it('写入 arithmeticMode 与 arithmeticDifficulty，并回读默认值', async () => {
    const app = await buildApp()
    const res = await app.request('/api/profiles/kid1', {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ arithmeticMode: 'keypad', arithmeticDifficulty: 3 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.arithmeticMode).toBe('keypad')
    expect(body.arithmeticDifficulty).toBe(3)
    expect(mockState.profiles[0].arithmeticMode).toBe('keypad')
    expect(mockState.profiles[0].arithmeticDifficulty).toBe(3)
  })

  it('非法 arithmeticMode / arithmeticDifficulty 不写入，保留原值', async () => {
    const app = await buildApp()
    const res = await app.request('/api/profiles/kid1', {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ arithmeticMode: 'bogus', arithmeticDifficulty: 99 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.arithmeticMode).toBe('choice')
    expect(body.arithmeticDifficulty).toBe(1)
    expect(mockState.profiles[0].arithmeticMode).toBeUndefined()
    expect(mockState.profiles[0].arithmeticDifficulty).toBeUndefined()
  })

  it('未登录返回 401', async () => {
    const app = await buildApp()
    const res = await app.request('/api/profiles/kid1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ arithmeticMode: 'keypad' }),
    })
    expect(res.status).toBe(401)
  })
})
