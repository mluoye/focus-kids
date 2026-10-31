import { Hono } from 'hono'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import type { TtsSettings } from '../../shared/types'
import { getState, saveState } from '../store'
import { requireAuth, requireParent, type AppEnv } from '../middleware'
import { invalidJson, readJson } from '../json'
import { isTtsVerified, missingOpenaiConfig, resolveTtsVoice, defaultTtsVoice, ttsFingerprint, type BackendTtsSource } from '../tts-config'

const MAX_TEXT = 500
const TIMEOUT_MS = 20_000

/** 家长试听的固定样例句：长度适中，能听出音色、语速与断句都正常。 */
const PREVIEW_TEXT = '你好，我是孩子的朗读助手。这句话用来确认这个朗读来源能正常出声。'

/** 把用户文本安全放进 SSML：转义 XML 特殊字符，防止 SSML 注入。 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 微软 Edge Read Aloud 合成 mp3。该接口自 2025-12 起浏览器端仅 Edge 可用，服务端始终可用。 */
async function edgeSpeech(voice: string, text: string): Promise<Uint8Array> {
  const tts = new MsEdgeTTS()
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)
  const { audioStream } = tts.toStream(escapeXml(text))
  const chunks: Buffer[] = []
  for await (const chunk of audioStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/**
 * SiliconFlow 系统音色必须写成 `模型名:音色`（文档 §2.1）；裸名如 `anna` 会 400。
 * 其它厂商（OpenAI 官方 `alloy` 等）保持原样；已含 `:` 或 `speech:` 的自定义音色不动。
 */
export function normalizeOpenaiVoice(baseUrl: string, model: string, voice: string): string {
  if (!voice || voice.includes(':')) return voice
  if (/siliconflow/i.test(baseUrl) && model) return `${model}:${voice}`
  return voice
}

/** OpenAI 兼容 /audio/speech 端点（SiliconFlow 等国产云常提供），返回 mp3。 */
async function openaiSpeech(
  baseUrl: string,
  apiKey: string,
  model: string,
  voice: string,
  text: string,
): Promise<Uint8Array> {
  const url = baseUrl.replace(/\/+$/, '') + '/audio/speech'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      input: text,
      voice: normalizeOpenaiVoice(baseUrl, model, voice),
      response_format: 'mp3',
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    let detail = ''
    try {
      const bodyText = await res.text()
      detail = bodyText.slice(0, 500)
    } catch {
      /* 读体失败时只报状态码 */
    }
    const err = new Error(`TTS 服务返回 ${res.status}`) as Error & { status?: number; detail?: string }
    err.status = res.status
    err.detail = detail
    throw err
  }
  return new Uint8Array(await res.arrayBuffer())
}

function sourceLabel(source: BackendTtsSource): string {
  return source === 'openai' ? 'OpenAI 兼容 TTS' : '微软 Edge'
}

async function synthesize(tts: TtsSettings, source: BackendTtsSource, text: string, voice: string): Promise<Uint8Array> {
  if (source === 'openai') {
    return openaiSpeech(tts.openai.baseUrl, tts.openai.apiKey!, tts.openai.model, voice || 'alloy', text)
  }
  return edgeSpeech(voice || 'zh-CN-XiaoxiaoNeural', text)
}

/**
 * 合成失败留痕：孩子端会自动落到下一个来源，家长端要能看到「哪个来源坏了」，
 * 否则顺序看上去正常但实际一直在降级。
 */
async function recordFailure(source: BackendTtsSource, err: unknown) {
  const message = String((err as { message?: unknown })?.message ?? err).slice(0, 160)
  const state = getState()
  state.settings.tts.lastFailure = { source, at: Date.now(), message }
  await saveState()
}

/** 未知厂商且家长没配默认音色：试听与合成都无法进行 */
function voiceNotSet(c: any, source: BackendTtsSource) {
  return c.json(
    {
      error: `${sourceLabel(source)} 没有可用音色`,
      code: 'TTS_VOICE_NOT_SET',
      hint: '该厂商不在内置音色清单内，请家长在「AI 设置 → 朗读来源」的 OpenAI 配置里填写「默认音色」（按厂商文档），先保存再试听。',
      field: 'openai.defaultVoice',
    },
    400,
  )
}

/** 合成失败响应：区分鉴权/参数/其它，并明确告知孩子端会降级到下一项 */
function failureBody(source: BackendTtsSource, err: any) {
  const message = String(err?.message ?? err)
  const detail = typeof err?.detail === 'string' && err.detail ? err.detail : undefined
  const status = Number(err?.status) || 0
  const authLike =
    status === 401 ||
    status === 403 ||
    /\b(401|403)\b/.test(message) ||
    /unauthorized|forbidden|invalid api key| authentication/i.test(message)
  const badRequest = status === 400 || /\b400\b/.test(message)
  const fallbackNote = '孩子端会自动改用下一个优先级来源，请在家长端试听确认。'
  return {
    error: `朗读合成失败：${message}`,
    code: 'TTS_FAILED',
    hint: authLike
      ? `请检查 API Key 是否正确、是否已开通音频合成服务。${fallbackNote}`
      : badRequest && source === 'openai'
        ? `上游拒绝了本次请求：请核对模型名、音色（voice）是否与厂商文档一致；改完配置需先保存再试听。${fallbackNote}`
        : fallbackNote,
    ...(authLike && source === 'openai' ? { field: 'openai.apiKey' } : {}),
    ...(badRequest && source === 'openai' ? { field: 'openai.model' } : {}),
    ...(detail ? { detail } : {}),
  }
}

function audioResponse(audio: Uint8Array, source: BackendTtsSource): Response {
  // Node 运行时接受 Uint8Array 作为响应体；类型层面绕开 ArrayBufferLike 与 ArrayBuffer 的泛型差异。
  return new Response(audio as unknown as BodyInit, {
    headers: {
      'content-type': 'audio/mpeg',
      'cache-control': 'no-store',
      'x-tts-source': source,
    },
  })
}

export const ttsRoutes = new Hono<AppEnv>()

ttsRoutes.post('/', requireAuth, async (c) => {
  const payload = await readJson(c)
  if (!payload) return invalidJson(c)
  const text = String(payload?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
  if (!text) return c.json({ error: '没有可朗读的内容', code: 'EMPTY' }, 400)

  const session = c.get('session')
  const state = getState()
  const tts = state.settings.tts
  const profile = session.profileId ? state.profiles.find((p) => p.id === session.profileId) : undefined
  const rawSource = payload?.source
  let source: BackendTtsSource
  let legacy = false
  if (rawSource === 'edge' || rawSource === 'openai') {
    source = rawSource
  } else if (rawSource === undefined || rawSource === null) {
    // 0.11.x 及更早的客户端不带 source：按已弃用的 provider 兼容一个版本，不做试听闸门，
    // 下一版本移除这条路径（见 docs/api.md）。
    legacy = true
    source = tts.provider === 'openai' ? 'openai' : 'edge'
  } else {
    return c.json(
      {
        error: '朗读来源不合法',
        code: 'TTS_BAD_SOURCE',
        hint: 'source 只能是 edge 或 openai；系统原生语音由浏览器直接朗读，不走这个接口。',
      },
      400,
    )
  }

  // 家长没启用的来源不合成：孩子端只会从 enabled 里选，这里再拦一层防直连绕过
  if (!legacy && !tts.enabled.includes(source)) {
    return c.json(
      {
        error: '该朗读来源未启用',
        code: 'TTS_NOT_ENABLED',
        hint: '请家长在「AI 设置 → 朗读来源」启用并试听通过后再使用。',
      },
      403,
    )
  }

  // 选了 openai 却缺配置时不静默回退 Edge：回退会让家长以为自定义云已生效。
  if (source === 'openai') {
    const missing = missingOpenaiConfig(tts)
    if (missing.length) {
      return c.json(
        {
          error: 'OpenAI 兼容 TTS 配置不完整',
          code: 'TTS_NOT_CONFIGURED',
          hint: '请补全服务地址、模型与 API Key 后先保存再试听；若暂时不需要自定义云服务，建议改用免费的「微软 Edge」朗读。',
          field: `openai.${missing[0]}`,
        },
        400,
      )
    }
  }

  // 未试听通过（或改过连接配置导致验证失效）的来源不合成：避免把一份从没出声的配置排进孩子端链路。
  if (!legacy && !isTtsVerified(tts, source)) {
    return c.json(
      {
        error: `${sourceLabel(source)} 朗读尚未试听通过`,
        code: 'TTS_NOT_VERIFIED',
        hint: '请家长在「AI 设置 → 朗读来源」点该来源的「试听」，通过后即可启用；刚改过服务地址、模型或密钥时需重新试听。',
      },
      409,
    )
  }

  // 音色：请求里带了就用请求的，否则用该孩子的偏好，再不行用内置默认（试听验证不绑音色）
  const voice = resolveTtsVoice(source, profile?.ttsPrefs, tts, typeof payload?.voice === 'string' ? payload.voice : undefined)
  if (!voice) return voiceNotSet(c, source)

  try {
    const audio = await synthesize(tts, source, text, voice)
    return audioResponse(audio, source)
  } catch (err: any) {
    await recordFailure(source, err)
    return c.json(failureBody(source, err), 502)
  }
})

/**
 * 家长试听某个后端来源。试听成功即视为「该来源的当前配置可出声」，写盘记录指纹；
 * 之后任何影响合成的字段变了，指纹就对不上，需要重新试听。
 */
ttsRoutes.post('/preview', requireAuth, requireParent, async (c) => {
  const payload = await readJson(c)
  if (!payload) return invalidJson(c)
  const source = payload?.source
  if (source !== 'edge' && source !== 'openai') {
    return c.json(
      {
        error: '试听只支持后端来源',
        code: 'TTS_BAD_SOURCE',
        hint: '系统原生语音由浏览器自带，直接在家长端界面上试听，不走服务端合成。',
      },
      400,
    )
  }
  const tts = getState().settings.tts
  if (source === 'openai') {
    const missing = missingOpenaiConfig(tts)
    if (missing.length) {
      return c.json(
        {
          error: 'OpenAI 兼容 TTS 配置不完整',
          code: 'TTS_NOT_CONFIGURED',
          hint: '请补全服务地址、模型与 API Key 并先保存，再点试听。',
          field: `openai.${missing[0]}`,
        },
        400,
      )
    }
  }

  try {
    // 家长试听用厂商内置默认音色（SiliconFlow → anna，官方 → alloy，未知厂商 → 家长配置的 defaultVoice）：
    // 只验证连接，不绑孩子偏好，也不读 settings 里已弃用的 voice（默认 alloy 会被 SiliconFlow 拒掉）
    const voice = defaultTtsVoice(source, tts)
    if (!voice) return voiceNotSet(c, source)
    const audio = await synthesize(tts, source, PREVIEW_TEXT, voice)
    const state = getState()
    state.settings.tts.verified = {
      ...state.settings.tts.verified,
      [source]: { at: Date.now(), fingerprint: ttsFingerprint(tts, source) },
    }
    if (state.settings.tts.lastFailure?.source === source) {
      state.settings.tts.lastFailure = null
    }
    await saveState()
    return audioResponse(audio, source)
  } catch (err: any) {
    await recordFailure(source, err)
    return c.json(failureBody(source, err), 502)
  }
})
