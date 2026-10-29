<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { clamp, type GameOutcome } from '@/training/engines'

const emit = defineEmits<{ (e: 'finish', outcome: GameOutcome): void }>()

const W = 360
const H = 300
const RADIUS = 15
const DOT_COUNT = 6
const TARGET_COUNT = 2

interface Dot {
  x: number
  y: number
  vx: number
  vy: number
  target: boolean
}

const canvasRef = ref<HTMLCanvasElement | null>(null)
const phase = ref<'watch' | 'track' | 'click' | 'audio' | 'done'>('watch')
const clickLeft = ref(7)
const dots = ref<Dot[]>([])
const selected = ref<number[]>([])
const audioDigits = ref<number[]>([])
const audioInput = ref('')
const audioVisible = ref(false)
const speechSupported = ref(typeof window !== 'undefined' && 'speechSynthesis' in window)
const feedbackText = ref('')
const replayUsed = ref(false)
const trackScore = ref(0)
const audioScore = ref(0)

let raf = 0
let lastTs = 0
let timers: number[] = []
let finished = false

const canClick = computed(() => phase.value === 'click' && selected.value.length < TARGET_COUNT)
const progress = computed(() => {
  if (phase.value === 'watch') return 8
  if (phase.value === 'track') return 35
  if (phase.value === 'click') return 60
  if (phase.value === 'audio') return 85
  return 100
})

function setupDots() {
  const list: Dot[] = []
  for (let i = 0; i < DOT_COUNT; i++) {
    list.push({
      x: 50 + Math.random() * (W - 100),
      y: 50 + Math.random() * (H - 100),
      vx: (Math.random() < 0.5 ? -1 : 1) * (70 + Math.random() * 40),
      vy: (Math.random() < 0.5 ? -1 : 1) * (70 + Math.random() * 40),
      target: false,
    })
  }
  // 均匀分布一些，避免重叠
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const dx = list[i].x - list[j].x
      const dy = list[i].y - list[j].y
      if (Math.hypot(dx, dy) < RADIUS * 4) {
        list[j].x = Math.max(RADIUS + 6, Math.min(W - RADIUS - 6, list[j].x + 60))
      }
    }
  }
  const targets = new Set<number>()
  while (targets.size < TARGET_COUNT) targets.add(Math.floor(Math.random() * DOT_COUNT))
  for (const index of targets) list[index].target = true
  dots.value = list
}

function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#fdf8f1'
  ctx.fillRect(0, 0, W, H)

  dots.value.forEach((dot, i) => {
    const isTargetHighlight = phase.value === 'watch' && dot.target
    const isSelected = selected.value.includes(i)
    ctx.beginPath()
    ctx.arc(dot.x, dot.y, RADIUS, 0, Math.PI * 2)
    if (isTargetHighlight) ctx.fillStyle = '#ef8a63'
    else if (isSelected) ctx.fillStyle = '#9b84d0'
    else ctx.fillStyle = phase.value === 'audio' ? '#d8cdbd' : '#6fb9d8'
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.stroke()
  })
}

function loop(ts: number) {
  if (!lastTs) lastTs = ts
  const dt = Math.min(0.05, (ts - lastTs) / 1000)
  lastTs = ts
  if (phase.value === 'track') {
    for (const dot of dots.value) {
      dot.x += dot.vx * dt
      dot.y += dot.vy * dt
      if (dot.x < RADIUS || dot.x > W - RADIUS) {
        dot.vx *= -1
        dot.x = clamp(dot.x, RADIUS, W - RADIUS)
      }
      if (dot.y < RADIUS || dot.y > H - RADIUS) {
        dot.vy *= -1
        dot.y = clamp(dot.y, RADIUS, H - RADIUS)
      }
    }
  }
  draw()
  raf = requestAnimationFrame(loop)
}

function canvasClick(event: PointerEvent) {
  if (!canClick.value) return
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * W
  const y = ((event.clientY - rect.top) / rect.height) * H
  let nearest = -1
  let nearestDist = Infinity
  dots.value.forEach((dot, i) => {
    const dist = Math.hypot(dot.x - x, dot.y - y)
    if (dist < nearestDist) {
      nearestDist = dist
      nearest = i
    }
  })
  if (nearest === -1 || nearestDist > RADIUS + 14) return
  if (selected.value.includes(nearest)) return
  selected.value.push(nearest)
  draw()
  if (selected.value.length >= TARGET_COUNT) {
    trackScore.value = selected.value.filter((i) => dots.value[i].target).length
    timers.push(window.setTimeout(() => startAudio(), 500))
  }
}

function startAudio() {
  if (finished) return
  phase.value = 'audio'
  audioDigits.value = Array.from({ length: 4 }, () => Math.floor(Math.random() * 10))
  audioInput.value = ''
  speakDigits()
}

function speakDigits() {
  if (!speechSupported.value) {
    audioVisible.value = true
    timers.push(
      window.setTimeout(() => {
        audioVisible.value = false
      }, 2200),
    )
    return
  }
  try {
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(audioDigits.value.join('，'))
    utter.lang = 'zh-CN'
    utter.rate = 0.8
    window.speechSynthesis.speak(utter)
  } catch {
    speechSupported.value = false
    audioVisible.value = true
  }
}

function pressDigit(d: string) {
  if (phase.value !== 'audio' || audioInput.value.length >= 4) return
  audioInput.value += d
  if (audioInput.value.length === 4) {
    timers.push(window.setTimeout(() => evaluateAudio(), 400))
  }
}

function backspace() {
  audioInput.value = audioInput.value.slice(0, -1)
}

function evaluateAudio() {
  if (finished) return
  const answer = audioInput.value
  const correct = audioDigits.value.filter((d, i) => String(d) === answer[i]).length
  audioScore.value = correct
  finish()
}

function replay() {
  if (replayUsed.value || phase.value !== 'audio') return
  replayUsed.value = true
  audioInput.value = ''
  speakDigits()
}

function finish() {
  if (finished) return
  finished = true
  phase.value = 'done'
  timers.forEach((t) => clearTimeout(t))
  cancelAnimationFrame(raf)
  const trackAcc = trackScore.value / TARGET_COUNT
  const audioAcc = audioScore.value / 4
  const accPct = Math.round((trackAcc * 0.5 + audioAcc * 0.5) * 100)
  const effectiveTrackAcc = trackScore.value > 0 ? trackAcc : selected.value.length === 0 ? 0 : trackAcc

  emit('finish', {
    totalTrials: 6,
    correctTrials: trackScore.value + audioScore.value,
    avgReactionMs: 0,
    accuracy: accPct / 100,
    difficulty: 1,
    errors: [
      { type: '追踪认错球', count: TARGET_COUNT - trackScore.value },
      { type: '数字记错', count: 4 - audioScore.value },
    ].filter((e) => e.count > 0),
    dimensionScores: {
      divided: clamp(Math.round(effectiveTrackAcc * 45 + audioAcc * 45 + 10), 0, 100),
      sustained: clamp(Math.round(effectiveTrackAcc * 70 + (selected.value.length ? 30 : 0)), 0, 100),
    },
    extra: { trackScore: trackScore.value, audioScore: audioScore.value },
  })
}

onMounted(() => {
  setupDots()
  raf = requestAnimationFrame(loop)
  timers.push(
    window.setTimeout(() => {
      phase.value = 'track'
    }, 2200),
  )
  timers.push(
    window.setTimeout(() => {
      phase.value = 'click'
      clickLeft.value = 7
      const tick = window.setInterval(() => {
        clickLeft.value -= 1
        if (clickLeft.value <= 0) {
          clearInterval(tick)
          if (phase.value === 'click') startAudio()
        }
      }, 1000)
      timers.push(tick)
    }, 8600),
  )
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  timers.forEach((t) => clearTimeout(t))
  if (speechSupported.value) window.speechSynthesis.cancel()
})
</script>

<template>
  <div class="stack">
    <div class="game-hud">
      <span class="game-hud__pill">
        {{ phase === 'watch' ? '记住橙色小球' : phase === 'track' ? '盯住它们' : phase === 'click' ? `点击 ${TARGET_COUNT} 个目标球` : phase === 'audio' ? '回忆听到的数字' : '完成' }}
      </span>
      <div class="grow"></div>
      <span v-if="phase === 'click'" class="game-hud__pill">{{ clickLeft }} 秒</span>
    </div>
    <div class="progress">
      <div class="progress__fill" :style="{ width: progress + '%' }"></div>
    </div>

    <div class="game-stage" style="padding: 12px">
      <canvas ref="canvasRef" :width="W" :height="H" class="track-canvas" @pointerdown="canvasClick"></canvas>
      <p v-if="phase === 'audio'" class="hint center mt-8">刚才听到的 4 个数字是？</p>
      <p v-if="audioVisible && phase === 'audio'" class="fallback-digits">{{ audioDigits.join(' · ') }}</p>
    </div>

    <div v-if="phase === 'audio'" class="stack">
      <div class="row" style="justify-content: center; gap: 10px">
        <span v-for="i in 4" :key="i" class="pin-dot" :class="{ 'is-filled': audioInput.length >= i }"></span>
      </div>
      <div class="keypad">
        <button v-for="n in ['1', '2', '3', '4', '5', '6', '7', '8', '9']" :key="n" class="keypad__key" @click="pressDigit(n)">
          {{ n }}
        </button>
        <button class="keypad__key keypad__key--ghost" @click="replay">{{ replayUsed ? '已重听' : '再听一次' }}</button>
        <button class="keypad__key" @click="pressDigit('0')">0</button>
        <button class="keypad__key keypad__key--ghost" @click="backspace">⌫</button>
      </div>
      <button class="btn btn--primary btn--block" :disabled="audioInput.length < 4" @click="evaluateAudio">提交答案</button>
      <p v-if="!speechSupported" class="hint center">这台设备不支持语音播报，数字已经短暂显示在屏幕上了。</p>
    </div>
  </div>
</template>

<style scoped>
.track-canvas {
  width: 100%;
  height: auto;
  border-radius: 18px;
  display: block;
  touch-action: none;
  cursor: pointer;
}

.pin-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--cream-deep);
  border: 2px solid #e8d8c4;
}

.pin-dot.is-filled {
  background: var(--mint-deep);
  border-color: var(--mint-deep);
}

.fallback-digits {
  text-align: center;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: 8px;
  color: var(--sky-deep);
  margin: 8px 0 0;
}

.keypad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  max-width: 320px;
  margin: 0 auto;
}

.keypad__key {
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 16px;
  font-size: 21px;
  font-weight: 700;
  padding: 13px 0;
  box-shadow: var(--shadow-soft);
}

.keypad__key--ghost {
  font-size: 13px;
  color: var(--muted);
  background: transparent;
  box-shadow: none;
}
</style>
