<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useDataStore } from '@/stores/data'
import { useUiStore } from '@/stores/ui'
import { api, ApiError, ttsPreview } from '@/api/client'
import { TTS_SOURCES, ttsVoiceVendor } from '@shared/constants'
import type { TtsSource } from '@shared/types'

const data = useDataStore()
const ui = useUiStore()

const form = reactive({
  enabled: false,
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  apiKey: '',
  temperature: 0.7,
  vision: {
    baseUrl: '',
    model: '',
    apiKey: '',
  },
  tts: {
    enabled: [] as TtsSource[],
    openaiBaseUrl: '',
    openaiModel: '',
    openaiApiKey: '',
    openaiDefaultVoice: '',
  },
})

interface TestResult {
  ok: boolean
  message: string
  hint?: string
  detail?: string
  code?: string
  field?: string
  /** 结果属于哪个朗读来源，用于在对应来源上标状态 */
  source?: TtsSource
}

const loaded = ref(false)
const saving = ref(false)
const testingChat = ref(false)
const testingVision = ref(false)
/** 正在试听的朗读来源；null 表示没有试听在跑 */
const previewingSource = ref<TtsSource | null>(null)
const chatTest = ref<TestResult | null>(null)
const visionTest = ref<TestResult | null>(null)
const ttsTest = ref<TestResult | null>(null)
const showChatDetail = ref(false)
const showVisionDetail = ref(false)
const showTtsDetail = ref(false)
/** 对话/视觉的 API Key 是否来自环境变量（环境变量优先级更高，页面填写不生效） */
const chatKeyFromEnv = ref(false)
const visionKeyFromEnv = ref(false)
const visionKeyFromEnvInherit = ref(false)
const fieldError = ref('')
/** 服务端已保存的朗读配置，用于「有未保存修改」提示 */
const savedTts = ref({
  enabled: [] as TtsSource[],
  openaiBaseUrl: '',
  openaiModel: '',
  openaiDefaultVoice: '',
})

/** 启用状态有未保存改动 */
const enabledDirty = computed(
  () => JSON.stringify([...form.tts.enabled].sort()) !== JSON.stringify([...savedTts.value.enabled].sort()),
)
/** OpenAI 兼容配置有未保存改动（密钥只看是否新填，掩码不可比） */
const openaiDirty = computed(
  () =>
    form.tts.openaiBaseUrl.trim() !== savedTts.value.openaiBaseUrl ||
    form.tts.openaiModel.trim() !== savedTts.value.openaiModel ||
    form.tts.openaiDefaultVoice.trim() !== savedTts.value.openaiDefaultVoice ||
    form.tts.openaiApiKey.trim() !== '',
)

/** 当前填的 OpenAI 地址属于哪家厂商；未知厂商需要家长填「默认音色」才能试听 */
const openaiVendor = computed(() => ttsVoiceVendor(form.tts.openaiBaseUrl.trim()))
/** 未知厂商且默认音色为空：试听按钮前置灰并提示 */
const openaiVoiceMissing = computed(
  () => openaiVendor.value === 'other' && form.tts.openaiDefaultVoice.trim() === '',
)

/** OpenAI 配置块默认收起；还没配好或没试听通过、没启用时展开，避免家长找不到入口 */
const openaiExpanded = ref(false)

/** 当前设备是否支持浏览器原生朗读（只代表这台设备，孩子设备另行探测） */
const nativeSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

function sourceMeta(source: TtsSource) {
  return TTS_SOURCES.find((s) => s.key === source) ?? { key: source, name: source, desc: '' }
}

function sourceName(source: TtsSource): string {
  return sourceMeta(source).name
}

function sourceDesc(source: TtsSource): string {
  return sourceMeta(source).desc
}

/**
 * 后端来源是否已试听通过。服务端只下发指纹有效的验证，
 * 因此改了服务地址 / 模型 / 密钥后会立刻变回「未试听」（改音色不影响）。
 */
function sourceVerified(source: TtsSource): boolean {
  if (source === 'native') return nativeSupported
  return !!data.settings?.tts.verified?.[source]
}

/** 已启用的来源集合（本地草稿，保存后才生效） */
const enabledSet = computed(() => new Set(form.tts.enabled))

function canEnable(source: TtsSource): boolean {
  return source === 'native' || sourceVerified(source)
}

function toggleSource(source: TtsSource, on: boolean) {
  if (on) {
    if (!canEnable(source)) {
      ui.toast(source === 'native' ? '这台设备不支持系统语音' : '请先试听通过再启用')
      return
    }
    if (!form.tts.enabled.includes(source)) form.tts.enabled.push(source)
  } else {
    form.tts.enabled = form.tts.enabled.filter((s) => s !== source)
  }
}

/** 已保存配置里最近一次合成失败（后端来源），用于提示「其实一直在降级」 */
const lastFailure = computed(() => data.settings?.tts.lastFailure ?? null)

/**
 * 启用集里是否至少有一个来源当前可用：原生（由设备探测）+ 已验证通过的后端来源。
 * 全都没有时孩子端点读会直接失败，必须提前告警，别让家长以为设置生效了。
 */
const hasUsableSource = computed(() =>
  form.tts.enabled.some((source) => source === 'native' || sourceVerified(source)),
)

watch(
  () => data.settings,
  (settings) => {
    if (!settings || loaded.value) return
    form.enabled = settings.ai.enabled
    form.baseUrl = settings.ai.baseUrl
    form.model = settings.ai.model
    form.temperature = settings.ai.temperature
    form.vision.baseUrl = settings.ai.vision?.baseUrl ?? ''
    form.vision.model = settings.ai.vision?.model ?? ''
    form.tts.enabled = [...settings.tts.enabled]
    form.tts.openaiBaseUrl = settings.tts.openai.baseUrl
    form.tts.openaiModel = settings.tts.openai.model
    form.tts.openaiDefaultVoice = settings.tts.openai.defaultVoice ?? ''
    savedTts.value = {
      enabled: [...settings.tts.enabled],
      openaiBaseUrl: settings.tts.openai.baseUrl,
      openaiModel: settings.tts.openai.model,
      openaiDefaultVoice: settings.tts.openai.defaultVoice ?? '',
    }
    // 还没试听通过、或没启用时默认展开，省得家长先找折叠入口
    openaiExpanded.value = !settings.tts.verified?.openai || !settings.tts.enabled.includes('openai')
    loaded.value = true
  },
  { immediate: true },
)

async function loadKeySources() {
  try {
    const status = await api.aiStatus()
    chatKeyFromEnv.value = status?.keySource === 'env'
    visionKeyFromEnv.value = status?.vision?.keySource === 'env'
    visionKeyFromEnvInherit.value = status?.vision?.keySource === 'inherit'
  } catch {
    /* 状态仅用于提示，失败不打扰 */
  }
}
loadKeySources()

function fieldClass(name: string): string {
  return fieldError.value === name ? 'input input--error' : 'input'
}

function testErrorOf(err: any): TestResult {
  if (err instanceof ApiError) {
    return {
      ok: false,
      message: err.message,
      hint: err.hint,
      detail: err.detail,
      code: err.code,
      field: err.field,
    }
  }
  return { ok: false, message: err?.message ?? '测试失败' }
}

async function save() {
  saving.value = true
  chatTest.value = null
  visionTest.value = null
  fieldError.value = ''
  try {
    await data.updateSettings({
      ai: {
        enabled: form.enabled,
        baseUrl: form.baseUrl.trim(),
        model: form.model.trim(),
        temperature: form.temperature,
        ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
        vision: {
          baseUrl: form.vision.baseUrl.trim(),
          model: form.vision.model.trim(),
          ...(form.vision.apiKey.trim() ? { apiKey: form.vision.apiKey.trim() } : {}),
        },
      },
    })
    form.apiKey = ''
    form.vision.apiKey = ''
    ui.toast('设置已保存')
    void loadKeySources()
  } catch (err: any) {
    ui.toast(err?.message ?? '保存失败')
  } finally {
    saving.value = false
  }
}

/** 朗读设置按区块各自保存：只提交本块字段，避免把别处未保存的改动一起写进去 */
async function saveTtsBlock(patch: Record<string, unknown>, done: () => void, label: string) {
  saving.value = true
  ttsTest.value = null
  fieldError.value = ''
  try {
    await data.updateSettings({ tts: patch })
    done()
    ui.toast(`${label}已保存`)
  } catch (err: any) {
    ui.toast(err?.message ?? '保存失败')
  } finally {
    saving.value = false
  }
}

/** 保存启用状态；服务端会清洗（去重、非法值剔除），所以以回写为准 */
function saveTtsEnabled() {
  return saveTtsBlock(
    { enabled: [...form.tts.enabled] },
    () => {
      const saved = data.settings?.tts
      if (!saved) return
      form.tts.enabled = [...saved.enabled]
      savedTts.value.enabled = [...saved.enabled]
    },
    '朗读来源启用状态',
  )
}

/** 保存 OpenAI 兼容配置（只提交该子块；孩子端仍可在设置页按自己喜好选音色） */
function saveOpenaiConfig() {
  const openai = {
    baseUrl: form.tts.openaiBaseUrl.trim(),
    model: form.tts.openaiModel.trim(),
    // 未知厂商必须提供默认音色，否则试听会报 TTS_VOICE_NOT_SET
    defaultVoice: form.tts.openaiDefaultVoice.trim(),
    ...(form.tts.openaiApiKey.trim() ? { apiKey: form.tts.openaiApiKey.trim() } : {}),
  }
  return saveTtsBlock(
    { openai },
    () => {
      form.tts.openaiApiKey = ''
      const saved = data.settings?.tts
      if (!saved) return
      form.tts.openaiBaseUrl = saved.openai.baseUrl
      form.tts.openaiModel = saved.openai.model
      form.tts.openaiDefaultVoice = saved.openai.defaultVoice ?? ''
      savedTts.value.openaiBaseUrl = saved.openai.baseUrl
      savedTts.value.openaiModel = saved.openai.model
      savedTts.value.openaiDefaultVoice = saved.openai.defaultVoice ?? ''
    },
    'OpenAI 兼容配置',
  )
}

const PREVIEW_SAMPLE = '你好，我是孩子的朗读助手。这句话用来确认这个朗读来源能正常出声。'

async function playBlob(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  const cleanup = () => URL.revokeObjectURL(url)
  audio.addEventListener('ended', cleanup, { once: true })
  audio.addEventListener('error', cleanup, { once: true })
  await audio.play()
}

/** 该来源最近一次试听结果；用于在配置块里就地显示结论（不必滚回上面的顺序卡） */
function previewResultOf(source: TtsSource): TestResult | null {
  return ttsTest.value && ttsTest.value.source === source ? ttsTest.value : null
}

/** 该来源的试听结论一行文本（没有结果时为空串，模板据此隐藏） */
function previewLine(source: TtsSource): string {
  const result = previewResultOf(source)
  if (!result) return ''
  return `${result.ok ? '✅ ' : '❌ '}${result.message}${result.hint ? ` —— ${result.hint}` : ''}`
}

function previewOk(source: TtsSource): boolean {
  return previewResultOf(source)?.ok === true
}

/** 该来源有未保存改动时，按钮上提示「先保存」——试听用的是已保存配置 */
function previewTitle(source: TtsSource): string {
  if (source === 'openai' && openaiDirty.value) return '先保存 OpenAI 配置再试听'
  return ''
}

/** 试听一律使用服务端已保存的配置：先保存再试听，避免表单与线上配置不一致。 */
async function previewTts(source: TtsSource) {
  if (source === 'native') {
    await previewNative()
    return
  }
  previewingSource.value = source
  ttsTest.value = null
  fieldError.value = ''
  try {
    const blob = await ttsPreview(source)
    await playBlob(blob)
    ttsTest.value = {
      ok: true,
      source,
      message: `${sourceName(source)}试听通过（使用已保存的配置），现在可以启用了`,
    }
    // 服务端已把该来源记为已验证，刷新快照让界面与库里一致
    try {
      await data.refreshProfiles()
    } catch (err) {
      console.warn('[parent] 试听成功后刷新设置失败，界面可能仍显示未试听', err)
    }
  } catch (err: any) {
    ttsTest.value = { ...testErrorOf(err), source }
    if (ttsTest.value.field?.startsWith('openai.')) {
      fieldError.value = ttsTest.value.field
      // 红框在折叠块里等于没提示，失败时直接把 OpenAI 配置展开
      openaiExpanded.value = true
    }
  } finally {
    previewingSource.value = null
  }
}

/**
 * 原生试听直接在浏览器里播：服务端合成不了它，能不能出声只取决于当前这台设备。
 * 结果仅作参考、不写入验证记录——孩子设备会自行探测。
 */
function previewNative(): Promise<void> {
  ttsTest.value = null
  if (!nativeSupported) {
    ttsTest.value = {
      ok: false,
      source: 'native',
      message: '这台设备的浏览器不支持系统语音',
      hint: '建议把「微软 Edge」排在第一位，这样孩子端一定有声音。',
    }
    return Promise.resolve()
  }
  previewingSource.value = 'native'
  return new Promise<void>((resolve) => {
    let settled = false
    const finish = (result: TestResult) => {
      if (settled) return
      settled = true
      previewingSource.value = null
      ttsTest.value = result
      resolve()
    }
    const synth = window.speechSynthesis
    if (synth.paused) synth.resume()
    synth.cancel()
    const utter = new SpeechSynthesisUtterance(PREVIEW_SAMPLE)
    utter.lang = 'zh-CN'
    utter.rate = 0.95
    utter.onend = () =>
      finish({
        ok: true,
        source: 'native',
        message: '系统原生语音已播放（仅代表这台设备，孩子设备会自行探测）',
      })
    utter.onerror = (event) =>
      finish({
        ok: false,
        source: 'native',
        message: `系统语音播放失败（${event?.error || '未知原因'}）`,
        hint: '这台设备可能没有中文语音包，建议把「微软 Edge」排在前面。',
      })
    synth.speak(utter)
    // 个别 WebView 不触发 onend：兜底收尾，避免按钮一直转圈
    setTimeout(
      () =>
        finish({
          ok: true,
          source: 'native',
          message: '已尝试播放系统语音，但没收到播放结束事件（可能没出声）',
          hint: '不确定有没有声音的话，建议把「微软 Edge」排在前面。',
        }),
      8000,
    )
  })
}

async function testChat() {
  testingChat.value = true
  chatTest.value = null
  fieldError.value = ''
  try {
    const res = await api.aiTest('chat')
    chatTest.value = { ok: !!res.ok, message: res.message ?? '可用' }
  } catch (err: any) {
    chatTest.value = testErrorOf(err)
    if (chatTest.value.field) fieldError.value = chatTest.value.field
  } finally {
    testingChat.value = false
  }
}

async function testVision() {
  testingVision.value = true
  visionTest.value = null
  fieldError.value = ''
  try {
    const res = await api.aiTest('vision')
    visionTest.value = { ok: !!res.ok, message: res.message ?? '可用' }
  } catch (err: any) {
    visionTest.value = testErrorOf(err)
    if (visionTest.value.field) fieldError.value = visionTest.value.field
  } finally {
    testingVision.value = false
  }
}

const presets = [
  {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    vision: { baseUrl: '', model: '' },
  },
  {
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    vision: { baseUrl: '', model: 'qwen-vl-plus' },
  },
  {
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    vision: { baseUrl: '', model: 'glm-4v-flash' },
  },
  {
    // 跨厂商组合：DeepSeek 对话便宜，拍题走智谱视觉
    name: 'DeepSeek+智谱看图',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    vision: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4v-flash' },
  },
  {
    name: '本地 Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b',
    vision: { baseUrl: '', model: '' },
  },
]

function applyPreset(preset: (typeof presets)[number]) {
  form.baseUrl = preset.baseUrl
  form.model = preset.model
  form.vision.baseUrl = preset.vision.baseUrl
  form.vision.model = preset.vision.model
}
</script>

<template>
  <div class="stack">
    <div>
      <h1 class="section-title" style="font-size: 22px">AI 设置</h1>
      <p class="section-sub">兼容 OpenAI 接口的任意服务都可以接入，密钥只保存在你的服务器</p>
    </div>

    <div class="card card--pad">
      <div class="row row--between row--wrap">
        <div>
          <h2 class="section-title" style="font-size: 16px">启用 AI 能力</h2>
          <p class="section-sub">关闭后孩子端的 AI 鼓励、作业陪练、家长分析都不可用，训练本身不受影响</p>
        </div>
        <label class="switch">
          <input v-model="form.enabled" type="checkbox" />
          <span class="switch__slider"></span>
        </label>
      </div>
    </div>

    <div class="card card--pad">
      <h2 class="section-title" style="font-size: 16px">对话模型</h2>
      <p class="section-sub">AI 鼓励、作业陪练、家长分析、作业解析都用这个模型</p>
      <div class="stack mt-24">
        <div>
          <label class="label">服务地址 Base URL</label>
          <input v-model="form.baseUrl" :class="fieldClass('baseUrl')" placeholder="https://api.deepseek.com/v1" />
          <p class="hint mt-8">会请求 <code>Base URL/chat/completions</code>。内网可用 Ollama 的 /v1 地址。</p>
        </div>
        <div>
          <label class="label">模型名称</label>
          <input v-model="form.model" :class="fieldClass('model')" placeholder="deepseek-chat" />
        </div>
        <div>
          <label class="label">API Key</label>
          <input
            v-model="form.apiKey"
            :class="fieldClass('apiKey')"
            type="password"
            :placeholder="data.settings?.ai.apiKeyMasked ? `已保存：${data.settings.ai.apiKeyMasked}（留空不修改）` : 'sk-...'"
          />
          <p v-if="chatKeyFromEnv" class="hint mt-8">当前使用环境变量 AI_API_KEY 中的密钥，页面填写的不会生效。</p>
        </div>
        <div>
          <label class="label">回复温度：{{ form.temperature.toFixed(1) }}</label>
          <input v-model.number="form.temperature" type="range" min="0.1" max="1" step="0.1" style="width: 100%" />
          <p class="hint mt-8">越低越稳定，越高越活泼。儿童内容建议 0.6~0.8。</p>
        </div>
      </div>
      <div class="row row--wrap mt-24">
        <button class="btn" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存设置' }}</button>
        <button class="btn btn--lav" :disabled="testingChat" @click="testChat">
          {{ testingChat ? '测试中…' : '测试对话模型' }}
        </button>
      </div>
      <div v-if="chatTest" class="test-result mt-8" :class="chatTest.ok ? 'test-result--ok' : 'test-result--err'">
        <p class="hint" :style="{ color: chatTest.ok ? 'var(--mint-deep)' : 'var(--rose-deep)' }">
          {{ chatTest.ok ? '✅ ' : '❌ ' }}{{ chatTest.message }}
        </p>
        <p v-if="chatTest.hint" class="hint mt-8">{{ chatTest.hint }}</p>
        <button v-if="chatTest.detail" class="btn btn--ghost btn--small mt-8" @click="showChatDetail = !showChatDetail">
          {{ showChatDetail ? '收起技术详情' : '查看技术详情' }}
        </button>
        <p v-if="showChatDetail && chatTest.detail" class="hint detail-text mt-8">{{ chatTest.detail }}</p>
      </div>
    </div>

    <div class="card card--pad">
      <h2 class="section-title" style="font-size: 16px">拍照识题模型</h2>
      <p class="section-sub">孩子拍题目照片时专用，可以和上面的对话模型用不同厂商（不同地址和密钥）</p>
      <div class="stack mt-24">
        <div>
          <label class="label">模型名称</label>
          <input v-model="form.vision.model" :class="fieldClass('vision.model')" placeholder="如 glm-4v-flash / qwen-vl-plus" />
          <p class="hint mt-8">留空 = 未配置，孩子端拍题按钮会提示先来配置。DeepSeek 对话模型不支持看图，需另配视觉模型。</p>
        </div>
        <div>
          <label class="label">服务地址 Base URL（可选）</label>
          <input v-model="form.vision.baseUrl" :class="fieldClass('vision.baseUrl')" placeholder="留空则继承对话模型的服务地址" />
          <p class="hint mt-8">视觉厂商与对话不同厂商时必须填写（如对话用 DeepSeek、拍题用智谱）。</p>
        </div>
        <div>
          <label class="label">API Key（可选）</label>
          <input
            v-model="form.vision.apiKey"
            :class="fieldClass('vision.apiKey')"
            type="password"
            :placeholder="data.settings?.ai.vision?.apiKeyMasked ? `已保存：${data.settings.ai.vision.apiKeyMasked}（留空不修改）` : '留空则继承对话模型的密钥'"
          />
          <p v-if="visionKeyFromEnv" class="hint mt-8">当前使用环境变量 AI_VISION_API_KEY 中的密钥，页面填写的不会生效。</p>
          <p v-else-if="visionKeyFromEnvInherit && form.vision.model" class="hint mt-8">未单独填密钥，实际使用对话模型的密钥（环境变量或已保存的 Key）。</p>
        </div>
      </div>
      <div class="row row--wrap mt-24">
        <button class="btn" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存拍照设置' }}</button>
        <button
          class="btn btn--lav"
          :disabled="testingVision || !form.vision.model.trim()"
          :title="form.vision.model.trim() ? '' : '先填写视觉模型名'"
          @click="testVision"
        >
          {{ testingVision ? '测试中…' : '测试拍照模型' }}
        </button>
      </div>
      <div v-if="visionTest" class="test-result mt-8" :class="visionTest.ok ? 'test-result--ok' : 'test-result--err'">
        <p class="hint" :style="{ color: visionTest.ok ? 'var(--mint-deep)' : 'var(--rose-deep)' }">
          {{ visionTest.ok ? '✅ ' : '❌ ' }}{{ visionTest.message }}
        </p>
        <p v-if="visionTest.hint" class="hint mt-8">{{ visionTest.hint }}</p>
        <button v-if="visionTest.detail" class="btn btn--ghost btn--small mt-8" @click="showVisionDetail = !showVisionDetail">
          {{ showVisionDetail ? '收起技术详情' : '查看技术详情' }}
        </button>
        <p v-if="showVisionDetail && visionTest.detail" class="hint detail-text mt-8">{{ visionTest.detail }}</p>
      </div>
    </div>

    <div class="card card--pad">
      <h2 class="section-title" style="font-size: 16px">快速填充</h2>
      <div class="row row--wrap mt-8">
        <button v-for="preset in presets" :key="preset.name" class="pill pill--sky" style="cursor: pointer; border: none" @click="applyPreset(preset)">
          {{ preset.name }}
        </button>
      </div>
      <p class="hint mt-16">
        安全说明：API Key 保存在服务端数据文件中，前端只看到掩码。请勿在公共设备上使用共享密钥。
      </p>
    </div>

    <div class="card card--pad">
      <h2 class="section-title" style="font-size: 16px">朗读来源</h2>
      <p class="section-sub">
        家长只决定<strong>开哪些来源</strong>；每个来源先<strong>试听通过</strong>才能启用。朗读顺序和音色由孩子在「设置」页自己选。
      </p>

      <div class="stack mt-16">
        <div v-for="source in TTS_SOURCES" :key="source.key" class="row row--between row--wrap">
          <div style="flex: 1 1 260px">
            <strong>{{ sourceName(source.key) }}</strong>
            <span
              class="hint"
              style="margin-left: 8px"
              :style="{ color: sourceVerified(source.key) ? 'var(--mint-deep)' : 'var(--rose-deep)' }"
            >
              {{
                source.key === 'native'
                  ? nativeSupported
                    ? '本机可用'
                    : '本机不支持'
                  : sourceVerified(source.key)
                    ? '已验证'
                    : '未试听'
              }}
            </span>
            <p class="hint mt-8">{{ sourceDesc(source.key) }}</p>
            <p v-if="source.key !== 'native' && enabledSet.has(source.key) && !sourceVerified(source.key)" class="hint mt-8" style="color: var(--rose-deep)">
              这一项刚改过连接配置、验证已失效：孩子端会跳过它。重新试听通过后自动恢复。
            </p>
          </div>
          <div class="row row--wrap" style="align-items: center">
            <label class="switch" :title="canEnable(source.key) ? '' : source.key === 'native' ? '这台设备不支持系统语音' : '请先试听通过'">
              <input
                type="checkbox"
                :checked="enabledSet.has(source.key)"
                :disabled="!canEnable(source.key) && !enabledSet.has(source.key)"
                @change="toggleSource(source.key, ($event.target as HTMLInputElement).checked)"
              />
              <span class="switch__slider"></span>
            </label>
            <button
              class="btn btn--small"
              :disabled="previewingSource !== null || saving"
              :title="previewTitle(source.key)"
              @click="previewTts(source.key)"
            >
              {{ previewingSource === source.key ? '试听中…' : '试听' }}
            </button>
          </div>
        </div>
      </div>

      <div class="row mt-24 row--wrap">
        <button class="btn btn--primary" :disabled="saving" @click="saveTtsEnabled">
          {{ saving ? '保存中…' : '保存启用状态' }}
        </button>
        <span v-if="enabledDirty" class="hint" style="align-self: center; color: var(--rose-deep)">
          有未保存修改：孩子端仍按已保存的启用状态
        </span>
      </div>
      <p v-if="!form.tts.enabled.length" class="hint mt-8" style="color: var(--rose-deep)">
        现在一个来源都没启用：孩子端点读会直接失败，并提示「让家长打开一个声音」。
      </p>
      <p v-else-if="!hasUsableSource" class="hint mt-8" style="color: var(--rose-deep)">
        当前启用的来源里没有任何已就绪的：孩子端点读会直接失败并提示「请家长试听」。请先给某个后端来源做一次试听，或启用「系统原生语音」。
      </p>

      <p v-if="lastFailure" class="hint mt-8" style="color: var(--rose-deep)">
        {{ sourceName(lastFailure.source) }} 最近一次合成失败（{{ new Date(lastFailure.at).toLocaleString() }}）：{{
          lastFailure.message
        }}
        —— 孩子端已自动改用下一项，重新试听该来源成功后会清除这条记录。
      </p>
      <div v-if="ttsTest" class="test-result mt-8" :class="ttsTest.ok ? 'test-result--ok' : 'test-result--err'">
        <p class="hint" :style="{ color: ttsTest.ok ? 'var(--mint-deep)' : 'var(--rose-deep)' }">
          {{ ttsTest.ok ? '✅ ' : '❌ ' }}{{ ttsTest.message }}
        </p>
        <p v-if="ttsTest.hint" class="hint mt-8">{{ ttsTest.hint }}</p>
        <button v-if="ttsTest.detail" class="btn btn--ghost btn--small mt-8" @click="showTtsDetail = !showTtsDetail">
          {{ showTtsDetail ? '收起技术详情' : '查看技术详情' }}
        </button>
        <p v-if="showTtsDetail && ttsTest.detail" class="hint detail-text mt-8">{{ ttsTest.detail }}</p>
      </div>
    </div>

    <div class="card card--pad">
      <h2 class="section-title" style="font-size: 16px">朗读来源设置</h2>
      <p class="section-sub">
        每个来源的连接配置各自保存。填完先保存，再点「试听」——试听用的是<strong>已保存</strong>的配置。音色不在这里选，由每个孩子在自己端的「设置」页挑选。
      </p>

      <div class="stack mt-16">
        <div class="tts-block">
          <div class="row row--wrap" style="align-items: baseline">
            <strong>系统原生语音</strong>
            <span class="hint" :style="{ color: nativeSupported ? 'var(--mint-deep)' : 'var(--rose-deep)' }">
              {{ nativeSupported ? '本机可用' : '本机不支持' }}
            </span>
            <button class="btn btn--small" :disabled="previewingSource !== null || saving" @click="previewTts('native')">
              {{ previewingSource === 'native' ? '试听中…' : '试听' }}
            </button>
          </div>
          <p
            v-if="previewLine('native')"
            class="hint mt-8"
            :style="{ color: previewOk('native') ? 'var(--mint-deep)' : 'var(--rose-deep)' }"
          >
            {{ previewLine('native') }}
          </p>
          <p class="hint mt-8">
            无需任何配置，直接使用设备自带的朗读引擎，不走网络、不花钱。微信 WebView 与无 GMS 的安卓机常缺中文语音，
            这类设备建议启用「微软 Edge」作为兜底。能不能出声由孩子设备自己探测，这里的「本机可用」只代表你现在用的这台。
          </p>
        </div>

        <div class="tts-block">
          <div class="row row--wrap" style="align-items: baseline">
            <strong>微软 Edge</strong>
            <span class="hint" :style="{ color: sourceVerified('edge') ? 'var(--mint-deep)' : 'var(--rose-deep)' }">
              {{ sourceVerified('edge') ? '已验证' : '未试听' }}
            </span>
            <button
              class="btn btn--small"
              :disabled="previewingSource !== null || saving"
              :title="previewTitle('edge')"
              @click="previewTts('edge')"
            >
              {{ previewingSource === 'edge' ? '试听中…' : '试听' }}
            </button>
          </div>
          <p
            v-if="previewLine('edge')"
            class="hint mt-8"
            :style="{ color: previewOk('edge') ? 'var(--mint-deep)' : 'var(--rose-deep)' }"
          >
            {{ previewLine('edge') }}
          </p>
          <p class="hint mt-8">
            服务端免费合成，无需密钥、无需配置。孩子端可在「设置」页从内置中文音色里挑选自己喜欢的。
          </p>
        </div>

        <div class="tts-block">
          <div class="row row--wrap" style="align-items: baseline">
            <strong>OpenAI 兼容 TTS</strong>
            <span class="hint" :style="{ color: sourceVerified('openai') ? 'var(--mint-deep)' : 'var(--rose-deep)' }">
              {{ sourceVerified('openai') ? '已验证' : '未试听' }}
            </span>
            <button
              class="btn btn--small"
              :disabled="previewingSource !== null || saving || openaiVoiceMissing"
              :title="previewTitle('openai') || (openaiVoiceMissing ? '请先填写默认音色（按厂商文档）' : '')"
              @click="previewTts('openai')"
            >
              {{ previewingSource === 'openai' ? '试听中…' : '试听' }}
            </button>
            <button class="btn btn--ghost btn--small" @click="openaiExpanded = !openaiExpanded">
              {{ openaiExpanded ? '收起配置' : '展开配置' }}
            </button>
          </div>
          <p
            v-if="previewLine('openai')"
            class="hint mt-8"
            :style="{ color: previewOk('openai') ? 'var(--mint-deep)' : 'var(--rose-deep)' }"
          >
            {{ previewLine('openai') }}
          </p>
          <p class="hint mt-8">
            可接 OpenAI 官方或国产云（如 SiliconFlow）。地址、模型、密钥三项齐全并保存后才能试听；改任一项都要重新试听。
          </p>          <template v-if="openaiExpanded">
            <div class="mt-16">
              <label class="label">服务地址 Base URL</label>
              <input
                v-model="form.tts.openaiBaseUrl"
                :class="fieldClass('openai.baseUrl')"
                placeholder="https://api.siliconflow.cn/v1"
              />
              <p class="hint mt-8">会请求 <code>Base URL/audio/speech</code>，需支持 OpenAI 音频接口的厂商。</p>
            </div>
            <div class="mt-16">
              <label class="label">模型名称</label>
              <input
                v-model="form.tts.openaiModel"
                :class="fieldClass('openai.model')"
                placeholder="如 FunAudioLLM/CosyVoice2-0.5B"
              />
            </div>
            <div class="mt-16">
              <label class="label">API Key</label>
              <input
                v-model="form.tts.openaiApiKey"
                :class="fieldClass('openai.apiKey')"
                type="password"
                :placeholder="data.settings?.tts.openai.apiKeyMasked ? `已保存：${data.settings.tts.openai.apiKeyMasked}（留空不修改）` : 'sk-...'"
              />
            </div>
            <div class="mt-16">
              <label class="label">默认音色（可选）</label>
              <input
                v-model="form.tts.openaiDefaultVoice"
                :class="fieldClass('openai.defaultVoice')"
                :placeholder="
                  openaiVendor === 'siliconflow'
                    ? '留空用内置默认 anna'
                    : openaiVendor === 'openai'
                      ? '留空用内置默认 alloy'
                      : '按厂商文档填写，如 my-voice-01'
                "
              />
              <p class="hint mt-8">
                <template v-if="openaiVendor === 'siliconflow'">
                  已在内置清单里，留空即可用默认音色；想用其它音色可在这里填（试听将用它验证）。
                </template>
                <template v-else-if="openaiVendor === 'openai'">
                  已在内置清单里，留空即可用默认音色。
                </template>
                <template v-else>
                  该厂商不在内置音色清单内，<strong>必须填一个它认得的音色</strong>（按厂商文档），否则无法试听。
                </template>
              </p>
            </div>
            <div class="row mt-16 row--wrap">
              <button class="btn" :disabled="saving" @click="saveOpenaiConfig">
                {{ saving ? '保存中…' : '保存 OpenAI 配置' }}
              </button>
              <span v-if="openaiDirty" class="hint" style="align-self: center; color: var(--rose-deep)">
                有未保存修改
              </span>
            </div>
          </template>
        </div>
      </div>
    </div>

    <div class="card card--pad card--sky">
      <h2 class="section-title" style="font-size: 16px">AI 会做什么</h2>
      <ul class="ai-list">
        <li>用孩子听得懂的话解读训练结果，给一个小目标。</li>
        <li>结合错误类型与时段，给家长分心归因和对策。</li>
        <li>作业陪练：只给启发式提问，不直接给答案。</li>
        <li>每周生成成长周报，含下周训练建议。</li>
      </ul>
      <p class="hint mt-8">AI 不做任何疾病判断；如对注意力发展有疑虑，请咨询专业医生。</p>
    </div>
  </div>
</template>

<style scoped>
.switch {
  position: relative;
  width: 56px;
  height: 32px;
  display: inline-block;
  flex: none;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.switch__slider {
  position: absolute;
  inset: 0;
  background: #e6d9c8;
  border-radius: 999px;
  transition: background 0.2s ease;
  cursor: pointer;
}

.switch__slider::before {
  content: '';
  position: absolute;
  width: 24px;
  height: 24px;
  left: 4px;
  top: 4px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s ease;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}

.switch input:checked + .switch__slider {
  background: var(--mint-deep);
}

.switch input:checked + .switch__slider::before {
  transform: translateX(24px);
}

.ai-list {
  margin: 10px 0 0;
  padding-left: 20px;
  line-height: 2;
  color: var(--ink-soft);
  font-size: 14.5px;
}

code {
  background: var(--cream-deep);
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 12.5px;
}

.input--error {
  border-color: var(--rose-deep) !important;
  box-shadow: 0 0 0 2px rgba(190, 90, 90, 0.15);
}

.detail-text {
  word-break: break-all;
  background: var(--cream-deep);
  padding: 8px 10px;
  border-radius: 8px;
  max-height: 120px;
  overflow-y: auto;
}

/* 朗读来源配置按来源分块：每块自带标题、状态与保存按钮，块间用虚线分隔 */
.tts-block {
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px dashed var(--cream-deep);
}

.tts-block:first-child {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}
</style>
