<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { accuracyPct, compositeScore, mean, pick, type GameOutcome } from '@/training/engines'

const emit = defineEmits<{ (e: 'finish', outcome: GameOutcome): void }>()

const COLORS = [
  { key: 'red', name: '红色', hex: '#e05656' },
  { key: 'yellow', name: '黄色', hex: '#e0a92a' },
  { key: 'blue', name: '蓝色', hex: '#3f8ec4' },
  { key: 'green', name: '绿色', hex: '#3f9a78' },
] as const

const TOTAL = 24

interface Trial {
  word: (typeof COLORS)[number]
  ink: (typeof COLORS)[number]
  congruent: boolean
}

const trials = ref<Trial[]>([])
const index = ref(0)
const rtList = ref<number[]>([])
const wrong = ref(0)
const tooSlow = ref(0)
const congruentStats = ref({ total: 0, correct: 0 })
const feedback = ref<'correct' | 'wrong' | ''>('')
const locked = ref(false)
const startedAt = ref(0)
const stimulusAt = ref(0)
const done = ref(false)

const current = computed(() => trials.value[index.value])
const progress = computed(() => Math.round((index.value / TOTAL) * 100))

let timer: number | undefined

function buildTrials() {
  const list: Trial[] = []
  for (let i = 0; i < TOTAL; i++) {
    const ink = pick([...COLORS])
    let word = ink
    const congruent = Math.random() < 0.25
    if (!congruent) {
      const others = COLORS.filter((c) => c.key !== ink.key)
      word = pick(others)
    }
    list.push({ word, ink, congruent })
  }
  return list
}

function showTrial() {
  locked.value = false
  feedback.value = ''
  stimulusAt.value = performance.now()
}

function answer(color: (typeof COLORS)[number]) {
  if (locked.value || done.value || !current.value) return
  locked.value = true
  const rt = performance.now() - stimulusAt.value
  const correct = color.key === current.value.ink.key
  rtList.value.push(rt)
  if (current.value.congruent) congruentStats.value.total += 1
  if (correct) {
    if (current.value.congruent) congruentStats.value.correct += 1
    feedback.value = 'correct'
  } else {
    wrong.value += 1
    feedback.value = 'wrong'
  }
  if (rt > 3000) tooSlow.value += 1

  timer = window.setTimeout(() => {
    if (index.value + 1 >= TOTAL) {
      finish()
      return
    }
    index.value += 1
    showTrial()
  }, 380)
}

function finish() {
  if (done.value) return
  done.value = true
  const correct = TOTAL - wrong.value
  const acc = accuracyPct(correct, TOTAL)
  const avgRt = Math.round(mean(rtList.value))
  const congruentAcc = congruentStats.value.total
    ? (congruentStats.value.correct / congruentStats.value.total) * 100
    : 100
  const errors = [
    { type: '颜色点错', count: wrong.value },
    { type: '反应超时', count: tooSlow.value },
  ].filter((e) => e.count > 0)

  emit('finish', {
    totalTrials: TOTAL,
    correctTrials: correct,
    avgReactionMs: avgRt,
    accuracy: correct / TOTAL,
    difficulty: 1,
    errors,
    dimensionScores: {
      selective: compositeScore(acc, avgRt, 950),
      inhibition: compositeScore(congruentAcc, avgRt, 1100),
    },
  })
}

function restart() {
  if (timer) clearTimeout(timer)
  trials.value = buildTrials()
  index.value = 0
  rtList.value = []
  wrong.value = 0
  tooSlow.value = 0
  congruentStats.value = { total: 0, correct: 0 }
  done.value = false
  startedAt.value = Date.now()
  showTrial()
}

onMounted(restart)
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <div class="stack">
    <div class="game-hud">
      <span class="game-hud__pill">第 {{ Math.min(index + 1, TOTAL) }} / {{ TOTAL }} 题</span>
      <span class="game-hud__pill" style="color: var(--rose-deep)">答错 {{ wrong }}</span>
      <div class="grow"></div>
    </div>
    <div class="progress">
      <div class="progress__fill" :style="{ width: progress + '%' }"></div>
    </div>

    <div class="game-stage stroop-stage">
      <p class="hint">点出这个字的<strong>颜色</strong>，不要读它写的是什么</p>
      <div v-if="current" class="stroop-word" :style="{ color: current.ink.hex }">
        {{ current.word.name[0] }}
      </div>
      <div class="feedback" v-if="feedback">{{ feedback === 'correct' ? '✅' : '❌' }}</div>
    </div>

    <div class="color-buttons">
      <button
        v-for="color in COLORS"
        :key="color.key"
        class="color-btn"
        :disabled="locked"
        :style="{ borderColor: color.hex, color: color.hex }"
        @click="answer(color)"
      >
        <span class="dot" :style="{ background: color.hex }"></span>
        {{ color.name }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.stroop-stage {
  min-height: 300px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding: 24px;
}

.stroop-word {
  font-size: clamp(64px, 16vw, 120px);
  font-weight: 800;
  line-height: 1;
  letter-spacing: 6px;
  text-shadow: 0 6px 0 rgba(0, 0, 0, 0.04);
}

.color-buttons {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.color-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 6px;
  border-radius: 18px;
  border: 2px solid var(--line);
  background: #fff;
  font-size: 15px;
  font-weight: 700;
  box-shadow: var(--shadow-soft);
}

.color-btn:active {
  transform: scale(0.96);
}

.color-btn .dot {
  width: 18px;
  height: 18px;
}
</style>
