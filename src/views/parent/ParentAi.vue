<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useDataStore } from '@/stores/data'
import { useUiStore } from '@/stores/ui'
import { api } from '@/api/client'

const data = useDataStore()
const ui = useUiStore()

const form = reactive({
  enabled: false,
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  visionModel: '',
  apiKey: '',
  temperature: 0.7,
  tts: {
    provider: 'edge' as 'edge' | 'openai',
    voice: 'zh-CN-XiaoxiaoNeural',
    openaiBaseUrl: '',
    openaiModel: '',
    openaiVoice: 'alloy',
    openaiApiKey: '',
  },
})
const loaded = ref(false)
const saving = ref(false)
const testing = ref(false)
const testResult = ref<{ ok: boolean; message: string } | null>(null)
const envKey = ref(false)

watch(
  () => data.settings,
  (settings) => {
    if (!settings || loaded.value) return
    form.enabled = settings.ai.enabled
    form.baseUrl = settings.ai.baseUrl
    form.model = settings.ai.model
    form.visionModel = settings.ai.visionModel
    form.temperature = settings.ai.temperature
    form.tts.provider = settings.tts.provider
    form.tts.voice = settings.tts.voice
    form.tts.openaiBaseUrl = settings.tts.openai.baseUrl
    form.tts.openaiModel = settings.tts.openai.model
    form.tts.openaiVoice = settings.tts.openai.voice
    loaded.value = true
  },
  { immediate: true },
)

async function save() {
  saving.value = true
  testResult.value = null
  try {
    await data.updateSettings({
      ai: {
        enabled: form.enabled,
        baseUrl: form.baseUrl.trim(),
        model: form.model.trim(),
        visionModel: form.visionModel.trim(),
        temperature: form.temperature,
        ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
      },
      tts: {
        provider: form.tts.provider,
        voice: form.tts.voice,
        openai: {
          baseUrl: form.tts.openaiBaseUrl.trim(),
          model: form.tts.openaiModel.trim(),
          voice: form.tts.openaiVoice.trim() || 'alloy',
          ...(form.tts.openaiApiKey.trim() ? { apiKey: form.tts.openaiApiKey.trim() } : {}),
        },
      },
    })
    form.apiKey = ''
    form.tts.openaiApiKey = ''
    ui.toast('设置已保存')
  } catch (err: any) {
    ui.toast(err?.message ?? '保存失败')
  } finally {
    saving.value = false
  }
}

async function test() {
  testing.value = true
  testResult.value = null
  try {
    const res = await api.aiTest()
    testResult.value = { ok: !!res.ok, message: res.message ?? '' }
  } catch (err: any) {
    testResult.value = { ok: false, message: err?.message ?? '测试失败' }
  } finally {
    testing.value = false
  }
}

const presets = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', visionModel: '' },
  { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', visionModel: 'qwen-vl-plus' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', visionModel: 'glm-4v-flash' },
  { name: '本地 Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b', visionModel: '' },
]

function applyPreset(preset: (typeof presets)[number]) {
  form.baseUrl = preset.baseUrl
  form.model = preset.model
  form.visionModel = preset.visionModel
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

      <div class="stack mt-24">
        <div>
          <label class="label">服务地址 Base URL</label>
          <input v-model="form.baseUrl" class="input" placeholder="https://api.deepseek.com/v1" />
          <p class="hint mt-8">会请求 <code>Base URL/chat/completions</code>。内网可用 Ollama 的 /v1 地址。</p>
        </div>
        <div>
          <label class="label">模型名称</label>
          <input v-model="form.model" class="input" placeholder="deepseek-chat" />
        </div>
        <div>
          <label class="label">视觉模型（拍照识题）</label>
          <input v-model="form.visionModel" class="input" placeholder="如 glm-4v-flash / qwen-vl-plus，留空则用上面的模型" />
          <p class="hint mt-8">孩子拍题时会用这个模型看图；留空则尝试上面的模型（DeepSeek 不支持看图）。视觉模型需与上方服务地址同厂商，用「快速填充」可一键配好。</p>
        </div>
        <div>
          <label class="label">API Key</label>
          <input
            v-model="form.apiKey"
            class="input"
            type="password"
            :placeholder="data.settings?.ai.apiKeyMasked ? `已保存：${data.settings.ai.apiKeyMasked}（留空不修改）` : 'sk-...'"
          />
          <p v-if="envKey" class="hint mt-8">当前使用环境变量中的密钥。</p>
        </div>
        <div>
          <label class="label">回复温度：{{ form.temperature.toFixed(1) }}</label>
          <input v-model.number="form.temperature" type="range" min="0.1" max="1" step="0.1" style="width: 100%" />
          <p class="hint mt-8">越低越稳定，越高越活泼。儿童内容建议 0.6~0.8。</p>
        </div>
      </div>

      <div class="row row--wrap mt-24">
        <button class="btn" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存设置' }}</button>
        <button class="btn btn--lav" :disabled="testing" @click="test">{{ testing ? '测试中…' : '测试连接' }}</button>
      </div>
      <p v-if="testResult" class="hint mt-8" :style="{ color: testResult.ok ? 'var(--mint-deep)' : 'var(--rose-deep)' }">
        {{ testResult.ok ? '✅ ' : '❌ ' }}{{ testResult.message }}
      </p>
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
      <h2 class="section-title" style="font-size: 16px">朗读（TTS）设置</h2>
      <p class="section-sub">孩子端点读的降级语音。系统语音可用时优先用系统语音；系统不支持时，用这里配置的服务合成音频。</p>
      <div class="row row--wrap mt-16">
        <button class="btn" :class="{ 'btn--primary': form.tts.provider === 'edge' }" @click="form.tts.provider = 'edge'">
          微软 Edge（免费，无需 key）
        </button>
        <button class="btn" :class="{ 'btn--primary': form.tts.provider === 'openai' }" @click="form.tts.provider = 'openai'">
          OpenAI 兼容 TTS（可填国产云）
        </button>
      </div>
      <template v-if="form.tts.provider === 'edge'">
        <div class="mt-16">
          <label class="label">中文语音</label>
          <select v-model="form.tts.voice" class="input">
            <option value="zh-CN-XiaoxiaoNeural">小晓（女声，推荐）</option>
            <option value="zh-CN-XiaoyiNeural">晓伊（女声）</option>
            <option value="zh-CN-YunxiNeural">云希（男声）</option>
            <option value="zh-CN-YunyangNeural">云扬（男声）</option>
          </select>
        </div>
      </template>
      <template v-else>
        <div class="mt-16">
          <label class="label">服务地址 Base URL</label>
          <input v-model="form.tts.openaiBaseUrl" class="input" placeholder="https://api.siliconflow.cn/v1" />
          <p class="hint mt-8">会请求 <code>Base URL/audio/speech</code>，需支持 OpenAI 音频接口的厂商。</p>
        </div>
        <div class="mt-16">
          <label class="label">模型名称</label>
          <input v-model="form.tts.openaiModel" class="input" placeholder="如 FunAudioLLM/CosyVoice2-0.5B" />
        </div>
        <div class="mt-16">
          <label class="label">音色 voice</label>
          <input v-model="form.tts.openaiVoice" class="input" placeholder="alloy" />
        </div>
        <div class="mt-16">
          <label class="label">API Key</label>
          <input
            v-model="form.tts.openaiApiKey"
            class="input"
            type="password"
            :placeholder="data.settings?.tts.openai.apiKeyMasked ? `已保存：${data.settings.tts.openai.apiKeyMasked}（留空不修改）` : 'sk-...'"
          />
        </div>
      </template>
      <div class="row mt-24">
        <button class="btn btn--primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存朗读设置' }}</button>
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
</style>
