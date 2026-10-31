<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDataStore } from '@/stores/data'
import { useUiStore } from '@/stores/ui'
import { ttsSpeak } from '@/api/client'
import type { TtsSource, TtsVoiceOption } from '@shared/types'

const data = useDataStore()
const ui = useUiStore()

const PREVIEW_SAMPLE = '你好，我是朗读小助手。这句话用来听听这个声音好不好听。'

const plan = computed(() => data.ttsPlan)
const enabled = computed(() => plan.value.enabled)
const backendEnabled = computed(() => enabled.value.filter((s): s is 'edge' | 'openai' => s !== 'native'))

/** 本地草稿：顺序与音色，点「保存」才提交 */
const draftOrder = ref<TtsSource[]>([])
const draftVoice = ref<{ edge?: string; openai?: string }>({})
const loadedFromPlan = ref(false)
const saving = ref(false)
const previewKey = ref<string | null>(null)

watch(
  () => plan.value,
  (p) => {
    if (loadedFromPlan.value) return
    draftOrder.value = [...p.order]
    draftVoice.value = { ...p.voice }
    loadedFromPlan.value = true
  },
  { immediate: true, deep: true },
)

const orderDirty = computed(() => {
  const a = draftOrder.value.join(',')
  const b = plan.value.order.join(',')
  return a !== b
})

const voiceDirty = computed(() => {
  const a = draftVoice.value
  const b = plan.value.voice
  return (a.edge ?? '') !== (b.edge ?? '') || (a.openai ?? '') !== (b.openai ?? '')
})

const dirty = computed(() => orderDirty.value || voiceDirty.value)

function move(index: number, delta: -1 | 1) {
  const target = index + delta
  const list = draftOrder.value
  if (target < 0 || target >= list.length) return
  const [item] = list.splice(index, 1)
  list.splice(target, 0, item)
}

function sourceName(source: TtsSource): string {
  if (source === 'native') return '系统语音'
  if (source === 'edge') return '微软 Edge'
  return '云端声音'
}

function sourceIcon(source: TtsSource): string {
  if (source === 'native') return '📱'
  if (source === 'edge') return '🌐'
  return '☁️'
}

/** 某来源当前选中的音色 value */
function selectedVoice(source: 'edge' | 'openai'): string {
  return draftVoice.value[source] ?? plan.value.voice[source] ?? defaultVoice(source)
}

/** 未选时的展示回落：优先内置候选第一个；未知厂商（候选为空）显示空，由家长配置的默认音色兜底 */
function defaultVoice(source: 'edge' | 'openai'): string {
  return plan.value.voices[source][0]?.value ?? (source === 'openai' ? '' : 'zh-CN-XiaoxiaoNeural')
}

function pickVoice(source: 'edge' | 'openai', value: string) {
  draftVoice.value = { ...draftVoice.value, [source]: value }
}

/** 自定义音色输入（候选清单外，比如自己上传的克隆音色） */
const customOpen = ref<{ edge?: boolean; openai?: boolean }>({})
const customDraft = ref<{ edge?: string; openai?: string }>({})

function isCustom(source: 'edge' | 'openai'): boolean {
  const current = selectedVoice(source)
  return !plan.value.voices[source].some((v) => v.value === current)
}

function ensureCustomOpen(source: 'edge' | 'openai') {
  if (customOpen.value[source] === undefined) {
    customOpen.value[source] = isCustom(source)
    customDraft.value[source] = selectedVoice(source)
  }
}

function toggleCustom(source: 'edge' | 'openai') {
  ensureCustomOpen(source)
  customOpen.value[source] = !customOpen.value[source]
  if (!customOpen.value[source]) {
    // 关掉自定义后回落到候选里的第一项，避免留下无效值
    pickVoice(source, defaultVoice(source))
  } else {
    customDraft.value[source] = selectedVoice(source)
  }
}

function applyCustom(source: 'edge' | 'openai') {
  const value = (customDraft.value[source] ?? '').trim()
  if (!value) {
    ui.toast('请输入音色名')
    return
  }
  pickVoice(source, value)
}

async function save() {
  saving.value = true
  try {
    const payload: { order?: TtsSource[]; voice?: { edge?: string; openai?: string } } = {}
    if (orderDirty.value) payload.order = [...draftOrder.value]
    if (voiceDirty.value) {
      const voice: { edge?: string; openai?: string } = {}
      if (backendEnabled.value.includes('edge') && draftVoice.value.edge) voice.edge = draftVoice.value.edge
      if (backendEnabled.value.includes('openai') && draftVoice.value.openai) voice.openai = draftVoice.value.openai
      payload.voice = voice
    }
    await data.updateTtsPrefs(payload)
    ui.toast('声音设置已保存')
  } catch (err: any) {
    ui.toast(err?.message ?? '保存失败')
  } finally {
    saving.value = false
  }
}

/** 试听某个音色：成功才算选中生效前提；失败标红且不保存该项 */
const previewError = ref<string | null>(null)
const previewOkKey = ref<string | null>(null)

async function previewVoice(source: 'edge' | 'openai', voice: string) {
  const key = `${source}:${voice}`
  previewKey.value = key
  previewError.value = null
  previewOkKey.value = null
  try {
    const blob = await ttsSpeak(PREVIEW_SAMPLE, source, undefined, voice)
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    const cleanup = () => URL.revokeObjectURL(url)
    audio.addEventListener('ended', cleanup, { once: true })
    audio.addEventListener('error', cleanup, { once: true })
    await audio.play()
    previewOkKey.value = key
    // 试听通过才把选中项切到这个音色
    pickVoice(source, voice)
  } catch (err: any) {
    previewError.value = err?.message ?? '试听失败，换一个声音试试'
  } finally {
    previewKey.value = null
  }
}

function voiceLabel(source: 'edge' | 'openai', value: string): string {
  return plan.value.voices[source].find((v: TtsVoiceOption) => v.value === value)?.label ?? value
}
</script>

<template>
  <div class="stack">
    <div>
      <h1 class="section-title" style="font-size: 22px">我的设置</h1>
      <p class="section-sub">选你喜欢的朗读声音，之后点读课文、看规则都会用它</p>
    </div>

    <!-- 第一组：声音（预留后续分组） -->
    <section class="card card--pad">
      <h2 class="section-title" style="font-size: 16px">🔊 声音</h2>

      <p v-if="!enabled.length" class="hint mt-16" style="color: var(--rose-deep)">
        现在还没有打开任何朗读声音。请让家长在「AI 设置 → 朗读来源」里启用一个，再回来选顺序和音色。
      </p>

      <template v-else>
        <p class="label mt-16">朗读顺序</p>
        <p class="hint mt-8">点读时先用第 1 个，失败了自动换下一个</p>
        <div class="stack mt-12">
          <div v-for="(source, index) in draftOrder" :key="source" class="row row--between row--wrap order-row">
            <div>
              <strong>{{ sourceIcon(source) }} {{ index + 1 }}. {{ sourceName(source) }}</strong>
              <p class="hint mt-8" style="margin: 0">
                {{
                  source === 'native'
                    ? '用手机/平板自带的朗读'
                    : source === 'edge'
                      ? '稳定好听的免费声音'
                      : '爸爸妈妈配好的云端声音'
                }}
              </p>
            </div>
            <div class="row" style="gap: 8px">
              <button class="btn btn--ghost btn--small" :disabled="index === 0" @click="move(index, -1)">⬆️ 上移</button>
              <button
                class="btn btn--ghost btn--small"
                :disabled="index === draftOrder.length - 1"
                @click="move(index, 1)"
              >
                ⬇️ 下移
              </button>
            </div>
          </div>
        </div>

        <template v-for="source in backendEnabled" :key="source">
          <div class="voice-block mt-24">
            <div class="row row--wrap" style="align-items: baseline">
              <strong>{{ sourceIcon(source) }} {{ sourceName(source) }}的声音</strong>
            </div>
            <p class="hint mt-8">点一下听听，喜欢就选它</p>

            <p v-if="source === 'openai' && !plan.voices.openai.length" class="hint mt-8" style="color: var(--mint-deep)">
              这个云端声音的厂商不在内置清单里，默认用家长配好的音色；想换的话在下面自己输入厂商文档里的音色名。
            </p>

            <div class="voice-grid mt-12">
              <button
                v-for="option in plan.voices[source]"
                :key="option.value"
                class="voice-card"
                :class="{ 'is-active': selectedVoice(source) === option.value && !isCustom(source) }"
                type="button"
                @click="pickVoice(source, option.value)"
              >
                <span class="voice-card__name">{{ option.label }}</span>
                <span
                  class="voice-card__preview"
                  @click.stop="previewVoice(source, option.value)"
                >
                  {{
                    previewKey === `${source}:${option.value}`
                      ? '试听中…'
                      : previewOkKey === `${source}:${option.value}`
                        ? '✓ 好听'
                        : '▶ 听一下'
                  }}
                </span>
              </button>
            </div>

            <div class="row mt-12 row--wrap" style="align-items: center">
              <button class="btn btn--ghost btn--small" @click="toggleCustom(source)">
                {{ customOpen[source] || isCustom(source) ? '用列表里的' : '自己输入音色' }}
              </button>
              <span v-if="isCustom(source) && !customOpen[source]" class="hint">当前：{{ selectedVoice(source) }}</span>
            </div>

            <div v-if="customOpen[source]" class="mt-12">
              <input
                v-model="customDraft[source]"
                class="input"
                :placeholder="source === 'openai' ? '厂商文档里的音色名' : '如 zh-CN-YunyangNeural'"
                @keyup.enter="applyCustom(source)"
              />
              <div class="row mt-8 row--wrap">
                <button class="btn btn--small" @click="applyCustom(source)">确定</button>
                <button
                  class="btn btn--small btn--ghost"
                  :disabled="previewKey !== null"
                  @click="previewVoice(source, (customDraft[source] ?? '').trim())"
                >
                  {{ previewKey === `${source}:${(customDraft[source] ?? '').trim()}` ? '试听中…' : '听一下这个' }}
                </button>
              </div>
              <p class="hint mt-8">试听成功才会用这个声音；失败会提示原因，不会保存。</p>
            </div>

            <p
              v-if="previewError"
              class="hint mt-8"
              style="color: var(--rose-deep)"
            >
              ❌ {{ previewError }}
            </p>
          </div>
        </template>

        <div class="row mt-24 row--wrap">
          <button class="btn btn--primary" :disabled="saving || !dirty" @click="save">
            {{ saving ? '保存中…' : '保存我的声音' }}
          </button>
          <span v-if="!dirty" class="hint" style="align-self: center">已经是最新啦</span>
          <span v-else class="hint" style="align-self: center; color: var(--rose-deep)">有点改动，记得保存</span>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.order-row {
  padding: 12px 14px;
  background: var(--cream-deep, #f7f1e6);
  border-radius: 12px;
}

.voice-block {
  padding-top: 18px;
  border-top: 1px dashed var(--cream-deep, #e8dfd0);
}

.voice-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}

.voice-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 2px solid transparent;
  background: var(--cream-deep, #f7f1e6);
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: inherit;
  transition: border-color 0.15s ease, transform 0.15s ease;
}

.voice-card:hover {
  transform: translateY(-1px);
}

.voice-card.is-active {
  border-color: var(--mint-deep, #3d9a7a);
  background: color-mix(in srgb, var(--mint-deep, #3d9a7a) 12%, white);
}

.voice-card__name {
  font-weight: 700;
  font-size: 14px;
  line-height: 1.3;
}

.voice-card__preview {
  font-size: 12px;
  color: var(--mint-deep, #3d9a7a);
  font-weight: 700;
}
</style>
