import { Hono } from 'hono'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { getState } from '../store'
import { requireAuth, type AppEnv } from '../middleware'
import { invalidJson, readJson } from '../json'

const MAX_TEXT = 500
const TIMEOUT_MS = 20_000

/** 把用户文本安全放进 SSML：转义 XML 特殊字符，防止 SSML 注入。 */
function escapeXml(text: string): string {
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
    body: JSON.stringify({ model, input: text, voice, response_format: 'mp3' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`TTS 服务返回 ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

export const ttsRoutes = new Hono<AppEnv>()

ttsRoutes.post('/', requireAuth, async (c) => {
  const payload = await readJson(c)
  if (!payload) return invalidJson(c)
  const text = String(payload?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
  if (!text) return c.json({ error: '没有可朗读的内容', code: 'EMPTY' }, 400)

  const tts = getState().settings.tts
  try {
    const audio =
      tts.provider === 'openai' && tts.openai.baseUrl && tts.openai.apiKey && tts.openai.model
        ? await openaiSpeech(tts.openai.baseUrl, tts.openai.apiKey, tts.openai.model, tts.openai.voice || 'alloy', text)
        : await edgeSpeech(tts.voice || 'zh-CN-XiaoxiaoNeural', text)
    // Node 运行时接受 Uint8Array 作为响应体；类型层面绕开 ArrayBufferLike 与 ArrayBuffer 的泛型差异。
    return new Response(audio as unknown as BodyInit, {
      headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' },
    })
  } catch (err: any) {
    return c.json({ error: `朗读合成失败：${err?.message ?? err}`, code: 'TTS_FAILED' }, 502)
  }
})
