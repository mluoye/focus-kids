<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { streamAi } from '@/api/client'
import { stripAiMarkup } from '@/utils/aiText'
import { useDataStore } from '@/stores/data'
import { useUiStore } from '@/stores/ui'

const data = useDataStore()
const ui = useUiStore()

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const messages = ref<Message[]>([])
const input = ref('')
const image = ref<string>('')
const sending = ref(false)
const reply = ref('')
const error = ref('')
const chatRef = ref<HTMLDivElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const aiReady = ref<boolean | null>(null)

const quickPrompts = [
  '这道题我看不懂，你能问我一个问题吗？',
  '我想自己先试试，给我一点提示就好。',
  '我算出来一个答案，帮我检查思路。',
  '我不想写了，怎么开始第一步？',
]

const canSend = computed(() => !sending.value && (input.value.trim().length > 0 || !!image.value))

onMounted(async () => {
  if (!data.loaded) data.fetchState().catch(() => {})
  try {
    const status = await fetch('/api/ai/status', {
      headers: { authorization: `Bearer ${localStorage.getItem('fk.token') ?? ''}` },
    }).then((r) => r.json())
    aiReady.value = !!status.ready
    if (!status.ready) error.value = status.message ?? 'AI 还没有配置好'
  } catch {
    aiReady.value = false
  }
})

function scrollToBottom() {
  nextTick(() => {
    if (chatRef.value) chatRef.value.scrollTop = chatRef.value.scrollHeight
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
  })
}

function pickPrompt(text: string) {
  input.value = text
}

async function send() {
  if (sending.value) return
  const text = input.value.trim()
  if (!text && !image.value) return
  error.value = ''
  const userMessage: Message = { role: 'user', content: text || '请看看这张题目图片' }
  messages.value.push(userMessage)
  input.value = ''
  const pendingImage = image.value
  image.value = ''
  // 先取历史（不含本轮空回复），避免把空的 assistant 消息发给模型
  const history = messages.value.slice(-10).map((m) => ({ role: m.role, content: m.content }))
  sending.value = true
  reply.value = ''
  scrollToBottom()

  try {
    await streamAi('tutor', {
      profileName: data.myProfile?.name ?? '小朋友',
      messages: history,
      image: pendingImage || undefined,
    }, (delta) => {
      reply.value += delta
      scrollToBottom()
    })
    if (reply.value) {
      messages.value.push({ role: 'assistant', content: reply.value })
    } else {
      // 模型只输出了思考过程时，不把孩子晾在一句“没听清”上
      error.value = 'AI 这次没答上来，再问一次试试'
    }
  } catch (err: any) {
    // 请求失败时撤回刚发出的那条，避免留下没有回复的孤零零提问
    if (messages.value[messages.value.length - 1]?.content === userMessage.content) messages.value.pop()
    error.value = err?.message ?? 'AI 小伙伴暂时联系不上'
    if (err?.status === 503) aiReady.value = false
  } finally {
    sending.value = false
    reply.value = ''
    scrollToBottom()
  }
}

async function onFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    ui.toast('请选择图片文件')
    return
  }
  if (file.size > 6 * 1024 * 1024) {
    ui.toast('图片太大了，请压缩后再试')
    return
  }
  try {
    image.value = await compressImage(file)
  } catch {
    ui.toast('读取图片失败')
  }
  ;(event.target as HTMLInputElement).value = ''
}

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const maxWidth = 1200
        const scale = Math.min(1, maxWidth / img.width)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(String(reader.result))
          return
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.8))
      }
      img.onerror = reject
      img.src = String(reader.result)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function clearChat() {
  messages.value = []
  error.value = ''
}
</script>

<template>
  <div class="page page--narrow tutor-page">
    <div class="row row--between">
      <div>
        <h1 class="section-title" style="font-size: 22px">AI 作业陪练</h1>
        <p class="section-sub">它不会直接告诉你答案，会陪你想出下一步</p>
      </div>
      <button v-if="messages.length" class="btn btn--ghost btn--small" @click="clearChat">重新开始</button>
    </div>

    <div ref="chatRef" class="chat card mt-16">
      <div v-if="!messages.length" class="chat-empty">
        <p class="emoji-xl">🤖</p>
        <p class="section-title mt-8" style="font-size: 17px">今天哪道题卡住啦？</p>
        <p class="hint mt-8">把题目打出来，或者拍张照片给我。我会先问你一个问题。</p>
        <div class="row row--wrap mt-16" style="justify-content: center">
          <button v-for="p in quickPrompts" :key="p" class="pill pill--sky quick" @click="pickPrompt(p)">{{ p }}</button>
        </div>
      </div>

      <div v-for="(m, i) in messages" :key="i" class="bubble-row" :class="m.role">
        <span class="bubble-avatar">{{ m.role === 'user' ? (data.myProfile?.avatar ?? '🙂') : '🤖' }}</span>
        <div class="bubble" :class="m.role">
          <span style="white-space: pre-wrap">{{ stripAiMarkup(m.content) }}</span>
        </div>
      </div>

      <div v-if="sending" class="bubble-row assistant">
        <span class="bubble-avatar">🤖</span>
        <div class="bubble assistant">
          <span v-if="!reply" class="typing">正在想一想…</span>
          <span v-else style="white-space: pre-wrap">{{ stripAiMarkup(reply) }}</span>
        </div>
      </div>
    </div>

    <p v-if="error" class="hint mt-8" style="color: var(--rose-deep)">{{ error }}</p>
    <p v-if="aiReady === false" class="hint mt-8">
      需要家长在「家长中心 → AI 设置」里填写 API Key 才能使用 AI 陪练。
    </p>

    <div v-if="image" class="image-preview mt-8">
      <img :src="image" alt="题目预览" />
      <button class="btn btn--small" @click="image = ''">移除</button>
      <span class="hint">拍照识题会先把图片发给支持视觉的模型；若模型不支持，请用文字描述题目。</span>
    </div>

    <div class="composer">
      <button class="btn composer__photo" title="上传题目照片" @click="fileInput?.click()">📷</button>
      <input ref="fileInput" type="file" accept="image/*" class="sr-only" @change="onFile" />
      <textarea
        v-model="input"
        class="textarea composer__input"
        placeholder="把题目打出来，或者说说你卡在哪一步…"
        rows="1"
        @keydown.enter.exact.prevent="send"
      ></textarea>
      <button class="btn btn--primary composer__send" :disabled="!canSend" @click="send">
        {{ sending ? '…' : '发送' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.tutor-page {
  padding-bottom: 160px;
}

.chat {
  min-height: 320px;
  max-height: 58vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: linear-gradient(180deg, #fffdf9, #fbf6ee);
}

.chat-empty {
  margin: auto;
  text-align: center;
  padding: 26px 10px;
}

.quick {
  cursor: pointer;
  border: none;
  font-family: inherit;
}

.bubble-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.bubble-row.user {
  flex-direction: row-reverse;
}

.bubble-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: #fff;
  border: 1px solid var(--line);
  font-size: 17px;
  flex: none;
}

.bubble {
  max-width: 78%;
  padding: 12px 16px;
  border-radius: 18px;
  font-size: 15px;
  line-height: 1.75;
}

.bubble.assistant {
  background: #fff;
  border: 1px solid var(--line);
  border-top-left-radius: 6px;
}

.bubble.user {
  background: var(--mint-soft);
  border: 1px solid #d3ece1;
  border-top-right-radius: 6px;
}

.typing {
  color: var(--muted);
  font-size: 13px;
}

.image-preview {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 10px;
}

.image-preview img {
  width: 84px;
  height: 64px;
  object-fit: cover;
  border-radius: 10px;
}

.composer {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: 84px;
  width: min(620px, calc(100% - 24px));
  display: flex;
  align-items: flex-end;
  gap: 8px;
  background: rgba(255, 253, 249, 0.95);
  backdrop-filter: blur(12px);
  border: 1px solid var(--line);
  border-radius: 22px;
  padding: 8px;
  box-shadow: var(--shadow);
  z-index: 25;
}

.composer__photo {
  min-height: 42px;
  padding: 0 12px;
  font-size: 18px;
}

.composer__input {
  min-height: 42px;
  max-height: 120px;
  border-radius: 14px;
  padding: 10px 12px;
  resize: none;
  border-color: transparent;
  background: var(--cream);
}

.composer__send {
  min-height: 42px;
  padding: 0 18px;
}

@media (min-width: 721px) {
  .composer {
    bottom: 96px;
  }
}
</style>
