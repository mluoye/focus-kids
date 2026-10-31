import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Settings } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/constants'
import type { StoredSession } from '../store'

/** 可变 mock 状态：每个用例重置 */
type MockState = {
  settings: Settings
  sessions: StoredSession[]
  profiles: { id: string; name: string; ttsPrefs?: { order: string[]; voice: { edge?: string; openai?: string } } }[]
}

const mockState: MockState = {
  settings: structuredClone(DEFAULT_SETTINGS) as Settings,
  sessions: [],
  profiles: [],
}

vi.mock('../store', () => ({
  getState: () => mockState,
  saveState: vi.fn(async () => {}),
}))

/** 记录 Edge 合成入参，便于断言 SSML 转义与截断 */
const edgeCalls: { voice: string; text: string }[] = []

vi.mock('msedge-tts', () => {
  class MsEdgeTTS {
    private voice = ''
    async setMetadata(voice: string) {
      this.voice = voice
    }
    toStream(text: string) {
      edgeCalls.push({ voice: this.voice, text })
      const audioStream = (async function* () {
        yield Buffer.from('ID3fake-mp3-bytes')
      })()
      return { audioStream }
    }
  }
  return {
    MsEdgeTTS,
    OUTPUT_FORMAT: { AUDIO_24KHZ_96KBITRATE_MONO_MP3: 'AUDIO_24KHZ_96KBITRATE_MONO_MP3' },
  }
})

const { escapeXml } = await import('./tts')

/** 与生产装配一致：requireAuth + tts 路由 */
async function buildApp() {
  const { requireAuth } = await import('../middleware')
  const { ttsRoutes } = await import('./tts')
  const app = new Hono()
  app.route('/api/tts', ttsRoutes)
  // requireAuth 已在 ttsRoutes 内，此处仅确保 middleware 模块已加载
  void requireAuth
  return app
}

function authHeader(token = 'tok_test') {
  return { authorization: `Bearer ${token}` }
}

function useSession(expiresAt = Date.now() + 60_000): string {
  const token = 'tok_test'
  mockState.sessions = [{ token, role: 'parent', profileId: '', expiresAt } as StoredSession]
  return token
}

function useTts(overrides: Partial<Settings['tts']>) {
  mockState.settings = {
    ...structuredClone(DEFAULT_SETTINGS),
    tts: {
      ...structuredClone(DEFAULT_SETTINGS.tts),
      ...overrides,
      openai: {
        ...structuredClone(DEFAULT_SETTINGS.tts.openai),
        ...(overrides.openai ?? {}),
      },
    },
  } as Settings
}

/** 按当前配置给指定来源写「试听通过」记录，模拟家长在设置页点过试听 */
async function markVerified(sources: ('edge' | 'openai')[]) {
  const { ttsFingerprint } = await import('../tts-config')
  const tts = mockState.settings.tts
  const verified: Settings['tts']['verified'] = {}
  for (const source of sources) {
    verified[source] = { at: Date.now(), fingerprint: ttsFingerprint(tts, source) }
  }
  mockState.settings.tts.verified = verified
}

beforeEach(() => {
  edgeCalls.length = 0
  vi.restoreAllMocks()
  mockState.sessions = []
  mockState.profiles = []
  useTts({ enabled: ['native', 'edge'] })
})

describe('escapeXml', () => {
  it('转义 SSML 危险字符，防止注入', () => {
    expect(escapeXml('a <script>alert(1)</script> & "x" \'y\'')).toBe(
      'a &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot; &apos;y&apos;',
    )
  })
})

describe('normalizeOpenaiVoice', () => {
  it('SiliconFlow 裸音色名自动补模型前缀', async () => {
    const { normalizeOpenaiVoice } = await import('./tts')
    expect(normalizeOpenaiVoice('https://api.siliconflow.cn/v1', 'FunAudioLLM/CosyVoice2-0.5B', 'anna')).toBe(
      'FunAudioLLM/CosyVoice2-0.5B:anna',
    )
  })

  it('已含冒号或非 SiliconFlow 保持原样', async () => {
    const { normalizeOpenaiVoice } = await import('./tts')
    expect(normalizeOpenaiVoice('https://api.openai.com/v1', 'tts-1', 'alloy')).toBe('alloy')
    expect(normalizeOpenaiVoice('https://api.siliconflow.cn/v1', 'm', 'FunAudioLLM/CosyVoice2-0.5B:anna')).toBe(
      'FunAudioLLM/CosyVoice2-0.5B:anna',
    )
    expect(
      normalizeOpenaiVoice('https://api.siliconflow.cn/v1', 'm', 'speech:my-voice:cm01:mt01'),
    ).toBe('speech:my-voice:cm01:mt01')
  })
})

describe('defaultTtsVoice / resolveTtsVoice 厂商默认音色', () => {
  it('SiliconFlow 用 anna，不用 OpenAI 的 alloy（否则上游 400）', async () => {
    const { defaultTtsVoice, resolveTtsVoice } = await import('../tts-config')
    useTts({
      enabled: ['native', 'edge', 'openai'],
      openai: {
        baseUrl: 'https://api.siliconflow.cn/v1',
        model: 'FunAudioLLM/CosyVoice2-0.5B',
        // DEFAULT 里残留的 alloy：SiliconFlow 不认，解析时必须换成 anna
        voice: 'alloy',
        apiKey: 'sk-x',
      },
    })
    const tts = mockState.settings.tts
    expect(defaultTtsVoice('openai', tts)).toBe('anna')
    expect(resolveTtsVoice('openai', null, tts)).toBe('anna')
    // 孩子显式选了 SiliconFlow 音色时仍然尊重
    expect(resolveTtsVoice('openai', { voice: { openai: 'diana' } }, tts)).toBe('diana')
  })

  it('OpenAI 官方仍用 alloy；edge 默认晓晓', async () => {
    const { defaultTtsVoice, resolveTtsVoice } = await import('../tts-config')
    useTts({
      openai: {
        baseUrl: 'https://api.openai.com/v1',
        model: 'tts-1',
        voice: '',
        apiKey: 'sk-x',
      },
    })
    const tts = mockState.settings.tts
    expect(defaultTtsVoice('openai', tts)).toBe('alloy')
    expect(resolveTtsVoice('openai', null, tts)).toBe('alloy')
    expect(defaultTtsVoice('edge', tts)).toBe('zh-CN-XiaoxiaoNeural')
  })

  it('未知厂商：家长配了 defaultVoice 才可用，否则返回 null（TTS_VOICE_NOT_SET）', async () => {
    const { defaultTtsVoice, resolveTtsVoice } = await import('../tts-config')
    useTts({
      openai: {
        baseUrl: 'https://api.my-vendor.com/v1',
        model: 'my-tts',
        voice: 'alloy',
        apiKey: 'sk-x',
      },
    })
    let tts = mockState.settings.tts
    // 没配 → null
    expect(defaultTtsVoice('openai', tts)).toBeNull()
    expect(resolveTtsVoice('openai', null, tts)).toBeNull()
    // 配了 → 用家长的默认音色
    mockState.settings.tts.openai.defaultVoice = 'my-voice-01'
    tts = mockState.settings.tts
    expect(defaultTtsVoice('openai', tts)).toBe('my-voice-01')
    expect(resolveTtsVoice('openai', null, tts)).toBe('my-voice-01')
    // 孩子显式选了仍优先
    expect(resolveTtsVoice('openai', { voice: { openai: 'kid-pick' } }, tts)).toBe('kid-pick')
  })
})

describe('POST /api/tts 契约', () => {
  it('未登录返回 401 UNAUTHORIZED', async () => {
    const app = await buildApp()
    const res = await app.request('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '你好' }),
    })
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.code).toBe('UNAUTHORIZED')
  })

  it('空文本返回 400 EMPTY', async () => {
    useSession()
    const app = await buildApp()
    const res = await app.request('/api/tts', {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ text: '   \n\t  ' }),
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.code).toBe('EMPTY')
  })

  it('非法 JSON 返回 400 INVALID_JSON', async () => {
    useSession()
    const app = await buildApp()
    const res = await app.request('/api/tts', {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: '{not-json',
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.code).toBe('INVALID_JSON')
  })

  it('Edge 成功返回 audio/mpeg，并对文本做 SSML 转义', async () => {
    useSession()
    const app = await buildApp()
    const res = await app.request('/api/tts', {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ text: '作业 <数学> & "英语"' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('audio/mpeg')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const buf = new Uint8Array(await res.arrayBuffer())
    expect(buf.length).toBeGreaterThan(0)
    expect(edgeCalls).toHaveLength(1)
    expect(edgeCalls[0].voice).toBe('zh-CN-XiaoxiaoNeural')
    expect(edgeCalls[0].text).toContain('&lt;数学&gt;')
    expect(edgeCalls[0].text).toContain('&amp;')
  })

  it('超长文本截断到 500 字后再合成', async () => {
    useSession()
    const app = await buildApp()
    const long = '朗'.repeat(600)
    const res = await app.request('/api/tts', {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ text: long }),
    })
    expect(res.status).toBe(200)
    expect(edgeCalls[0].text.length).toBe(500)
  })

  it('openai 配置不全返回 400 TTS_NOT_CONFIGURED，并建议改用 Edge', async () => {
    useSession()
    useTts({
      enabled: ['native', 'openai'],
      openai: { baseUrl: 'https://api.example.com/v1', model: '', voice: 'alloy', apiKey: '' },
    })
    const app = await buildApp()
    const res = await app.request('/api/tts', {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ text: '你好', source: 'openai' }),
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.code).toBe('TTS_NOT_CONFIGURED')
    expect(data.field).toBe('openai.model')
    expect(String(data.hint)).toMatch(/Edge/)
    // 不得静默回退 Edge
    expect(edgeCalls).toHaveLength(0)
  })

  it('openai 缺 apiKey 同样 400，不打上游', async () => {
    useSession()
    useTts({
      enabled: ['native', 'openai'],
      openai: { baseUrl: 'https://api.example.com/v1', model: 'cosy', voice: 'alloy', apiKey: '' },
    })
    const app = await buildApp()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const res = await app.request('/api/tts', {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ text: '你好', source: 'openai' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('TTS_NOT_CONFIGURED')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('openai 配置齐全时请求 /audio/speech 并返回 mp3', async () => {
    useSession()
    useTts({
      enabled: ['native', 'openai'],
      openai: {
        baseUrl: 'https://api.example.com/v1/',
        model: 'cosyvoice',
        voice: 'anna',
        apiKey: 'sk-test',
      },
    })
    await markVerified(['openai'])
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      }),
    )
    const app = await buildApp()
    const res = await app.request('/api/tts', {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ text: '试听', source: 'openai' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('audio/mpeg')
    expect(edgeCalls).toHaveLength(0)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(String(url)).toBe('https://api.example.com/v1/audio/speech')
    const body = JSON.parse(String(init?.body))
    expect(body.model).toBe('cosyvoice')
    expect(body.voice).toBe('anna')
    expect(body.input).toBe('试听')
    expect(body.response_format).toBe('mp3')
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer sk-test')
  })

  it('SiliconFlow 裸音色在请求体中自动补成 模型名:音色', async () => {
    useSession()
    useTts({
      enabled: ['native', 'openai'],
      openai: {
        baseUrl: 'https://api.siliconflow.cn/v1',
        model: 'FunAudioLLM/CosyVoice2-0.5B',
        voice: 'anna',
        apiKey: 'sk-test',
      },
    })
    await markVerified(['openai'])
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      }),
    )
    const app = await buildApp()
    const res = await app.request('/api/tts', {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ text: '你好', source: 'openai' }),
    })
    expect(res.status).toBe(200)
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))
    expect(body.voice).toBe('FunAudioLLM/CosyVoice2-0.5B:anna')
  })

  it('openai 上游失败返回 502 TTS_FAILED，并给出可操作 hint', async () => {
    useSession()
    useTts({
      enabled: ['native', 'openai'],
      openai: {
        baseUrl: 'https://api.example.com/v1',
        model: 'cosyvoice',
        voice: 'alloy',
        apiKey: 'sk-bad',
        defaultVoice: 'cosy-01',
      },
    })
    await markVerified(['openai'])
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    )
    const app = await buildApp()
    const res = await app.request('/api/tts', {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ text: '你好', source: 'openai' }),
    })
    expect(res.status).toBe(502)
    const data = await res.json()
    expect(data.code).toBe('TTS_FAILED')
    expect(data.field).toBe('openai.apiKey')
    expect(String(data.error)).toContain('401')
    expect(String(data.detail)).toContain('unauthorized')
    // 失败留痕：家长端要能看到「其实一直在降级」
    expect(mockState.settings.tts.lastFailure?.source).toBe('openai')
  })
})

describe('POST /api/tts 来源闸门', () => {
  it('指定 source 但未试听通过时 409 TTS_NOT_VERIFIED，且不合成', async () => {
    useSession()
    const app = await buildApp()
    const res = await app.request('/api/tts', {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ text: '你好', source: 'edge' }),
    })
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.code).toBe('TTS_NOT_VERIFIED')
    expect(String(data.hint)).toMatch(/试听/)
    expect(edgeCalls).toHaveLength(0)
  })

  it('source 非法值返回 400 TTS_BAD_SOURCE', async () => {
    useSession()
    const app = await buildApp()
    const res = await app.request('/api/tts', {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ text: '你好', source: 'native' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('TTS_BAD_SOURCE')
  })

  it('已试听且指纹匹配时按 source 合成，并回 x-tts-source', async () => {
    useSession()
    useTts({ enabled: ['native', 'edge'] })
    await markVerified(['edge'])
    const app = await buildApp()
    const res = await app.request('/api/tts', {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ text: '你好', source: 'edge' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('x-tts-source')).toBe('edge')
    expect(edgeCalls).toHaveLength(1)
  })

  it('家长未启用的来源返回 403 TTS_NOT_ENABLED（防直连绕过）', async () => {
    useSession()
    useTts({
      enabled: ['native', 'edge'],
      openai: {
        baseUrl: 'https://api.example.com/v1',
        model: 'cosy',
        voice: 'alloy',
        apiKey: 'sk-test',
      },
    })
    // openai 已验证但未启用
    await markVerified(['openai'])
    const app = await buildApp()
    const res = await app.request('/api/tts', {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ text: '你好', source: 'openai' }),
    })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('TTS_NOT_ENABLED')
  })

  it('改过 voice 之后验证仍有效（指纹只绑连接，不绑音色）', async () => {
    useSession()
    useTts({ enabled: ['native', 'edge'], voice: 'zh-CN-XiaoxiaoNeural' })
    await markVerified(['edge'])
    // 孩子换音色，连接配置没变
    mockState.settings.tts.voice = 'zh-CN-YunxiNeural'
    const app = await buildApp()
    const res = await app.request('/api/tts', {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ text: '你好', source: 'edge' }),
    })
    expect(res.status).toBe(200)
    expect(edgeCalls).toHaveLength(1)
    expect(edgeCalls[0].voice).toBe('zh-CN-YunxiNeural')
  })

  it('请求体带 voice 时优先使用该音色（孩子端试听/临时指定）', async () => {
    useSession()
    useTts({ enabled: ['native', 'edge'], voice: 'zh-CN-XiaoxiaoNeural' })
    await markVerified(['edge'])
    const app = await buildApp()
    const res = await app.request('/api/tts', {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ text: '你好', source: 'edge', voice: 'zh-CN-YunjianNeural' }),
    })
    expect(res.status).toBe(200)
    expect(edgeCalls[0].voice).toBe('zh-CN-YunjianNeural')
  })

  it('孩子会话未带 voice 时回落到该孩子 ttsPrefs.voice', async () => {
    const token = 'tok_child'
    mockState.sessions = [{ token, role: 'child', profileId: 'p1', expiresAt: Date.now() + 60_000 } as StoredSession]
    mockState.profiles = [
      { id: 'p1', name: '小明', ttsPrefs: { order: ['edge'], voice: { edge: 'zh-CN-YunxiNeural' } } },
    ]
    useTts({ enabled: ['native', 'edge'], voice: 'zh-CN-XiaoxiaoNeural' })
    await markVerified(['edge'])
    const app = await buildApp()
    const res = await app.request('/api/tts', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: '你好', source: 'edge' }),
    })
    expect(res.status).toBe(200)
    expect(edgeCalls[0].voice).toBe('zh-CN-YunxiNeural')
  })
})

describe('POST /api/tts/preview 试听', () => {
  it('家长试听 edge 成功后写入验证指纹', async () => {
    useSession()
    useTts({ enabled: ['native', 'edge'], voice: 'zh-CN-XiaoxiaoNeural' })
    const app = await buildApp()
    const res = await app.request('/api/tts/preview', {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'edge' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('audio/mpeg')
    const { ttsFingerprint } = await import('../tts-config')
    const record = mockState.settings.tts.verified.edge
    expect(record?.fingerprint).toBe(ttsFingerprint(mockState.settings.tts, 'edge'))
  })

  it('孩子身份不能试听（403 FORBIDDEN）', async () => {
    const token = 'tok_child'
    mockState.sessions = [{ token, role: 'child', profileId: 'p1', expiresAt: Date.now() + 60_000 } as StoredSession]
    const app = await buildApp()
    const res = await app.request('/api/tts/preview', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'edge' }),
    })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('FORBIDDEN')
  })

  it('试听 openai 配置不全返回 400 TTS_NOT_CONFIGURED', async () => {
    useSession()
    useTts({ openai: { baseUrl: '', model: '', voice: 'alloy', apiKey: '' } })
    const app = await buildApp()
    const res = await app.request('/api/tts/preview', {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'openai' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('TTS_NOT_CONFIGURED')
  })

  it('原生来源不走服务端试听（400 TTS_BAD_SOURCE）', async () => {
    useSession()
    const app = await buildApp()
    const res = await app.request('/api/tts/preview', {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'native' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('TTS_BAD_SOURCE')
  })

  it('试听失败不写验证，只记录 lastFailure', async () => {
    useSession()
    useTts({
      openai: {
        baseUrl: 'https://api.example.com/v1',
        model: 'cosyvoice',
        voice: 'alloy',
        apiKey: 'sk-bad',
        defaultVoice: 'cosy-01',
      },
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    )
    const app = await buildApp()
    const res = await app.request('/api/tts/preview', {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'openai' }),
    })
    expect(res.status).toBe(502)
    expect(mockState.settings.tts.verified.openai).toBeUndefined()
    expect(mockState.settings.tts.lastFailure?.source).toBe('openai')
  })

  it('SiliconFlow 试听用 anna 而不是残留的 alloy', async () => {
    useSession()
    useTts({
      enabled: ['native', 'edge', 'openai'],
      openai: {
        baseUrl: 'https://api.siliconflow.cn/v1',
        model: 'FunAudioLLM/CosyVoice2-0.5B',
        voice: 'alloy',
        apiKey: 'sk-x',
      },
    })
    const bodies: unknown[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    })
    const app = await buildApp()
    const res = await app.request('/api/tts/preview', {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'openai' }),
    })
    expect(res.status).toBe(200)
    expect(bodies[0]).toMatchObject({
      model: 'FunAudioLLM/CosyVoice2-0.5B',
      voice: 'FunAudioLLM/CosyVoice2-0.5B:anna',
    })
  })

  it('未知厂商且没配 defaultVoice：试听返回 400 TTS_VOICE_NOT_SET，不发上游请求', async () => {
    useSession()
    useTts({
      enabled: ['native', 'edge', 'openai'],
      openai: {
        baseUrl: 'https://api.my-vendor.com/v1',
        model: 'my-tts',
        voice: 'alloy',
        apiKey: 'sk-x',
      },
    })
    const spy = vi.spyOn(globalThis, 'fetch')
    const app = await buildApp()
    const res = await app.request('/api/tts/preview', {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'openai' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('TTS_VOICE_NOT_SET')
    expect(spy).not.toHaveBeenCalled()
  })

  it('未知厂商配了 defaultVoice：试听用它，并写入验证指纹', async () => {
    useSession()
    useTts({
      enabled: ['native', 'edge', 'openai'],
      openai: {
        baseUrl: 'https://api.my-vendor.com/v1',
        model: 'my-tts',
        voice: 'alloy',
        apiKey: 'sk-x',
        defaultVoice: 'my-voice-01',
      },
    })
    const bodies: unknown[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    })
    const app = await buildApp()
    const res = await app.request('/api/tts/preview', {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'openai' }),
    })
    expect(res.status).toBe(200)
    expect(bodies[0]).toMatchObject({ model: 'my-tts', voice: 'my-voice-01' })
    const { ttsFingerprint } = await import('../tts-config')
    expect(mockState.settings.tts.verified.openai?.fingerprint).toBe(
      ttsFingerprint(mockState.settings.tts, 'openai'),
    )
  })
})
