<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { accuracyPct, clamp, compositeScore, mean, pick, type GameOutcome } from '@/training/engines'

const emit = defineEmits<{ (e: 'finish', outcome: GameOutcome): void }>()

const COLORS = [
  { key: 'red', hex: '#e05656', name: '红色' },
  { key: 'blue', hex: '#3f8ec4', name: '蓝色' },
  { key: 'green', hex: '#3f9a78', name: '绿色' },
  { key: 'yellow', hex: '#dfa521', name: '黄色' },
] as const

const N = 2
const TOTAL = 22

interface Stimulus {
  pos: number
  color: (typeof COLORS)[number]
  posTarget: boolean
  colorTarget: boolean
}

const sequence = ref<Stimulus[]>([])
const index = ref(0)
const visible = ref(false)
const finished = ref(false)
const respondedPos = ref(false)
const respondedColor = ref(false)
const posStats = ref({ hit: 0, miss: 0, falseAlarm: 0, correctReject: 0 })
const colorStats = ref({ hit: 0, miss: 0, falseAlarm: 0, correctReject: 0 })
const rtList = ref<number[]>([])
const stimulusAt = ref(0)
const flash = ref<'' | 'pos' | 'color'>('')

let timers: number[] = []

const current = computed(() => sequence.value[index.value])
const progress = computed(() => Math.round((index.value / TOTAL) * 100))

function buildSequence() {
  const list: Stimulus[] = []
  for (let i = 0; i < TOTAL; i++) {
    let pos = Math.floor(Math.random() * 9)
    let color = pick([...COLORS])
    let posTarget = false
    let colorTarget = false
    if (i >= N) {
      posTarget = Math.random() < 0.3
      colorTarget = Math.random() < 0.3
      if (posTarget) pos = list[i - N].pos
      else if (pos === list[i - N].pos) pos = (pos + 1 + Math.floor(Math.random() * 8)) % 9
      if (colorTarget) color = list[i - N].color
      else if (color.key === list[i - N].color.key) {
        color = pick(COLORS.filter((c) => c.key !== list[i - N].color.key))
      }
    }
    list.push({ pos, color, posTarget, colorTarget })
  }
  return list
}

function clearTimers() {
  timers.forEach((t) => clearTimeout(t))
  timers = []
}

function runTrial(i: number) {
  if (finished.value) return
  index.value = i
  respondedPos.value = false
  respondedColor.value = false
  visible.value = true
  stimulusAt.value = performance.now()

  const stimulus = sequence.value[i]
  timers.push(
    window.setTimeout(() => {
      visible.value = false
    }, 1000),
  )

  timers.push(
    window.setTimeout(() => {
      evaluateTrial(stimulus)
      if (i + 1 >= TOTAL) {
        finish()
      } else {
        runTrial(i + 1)
      }
    }, 1620),
  )
}

function evaluateTrial(stimulus: Stimulus) {
  if (stimulus.posTarget) {
    if (respondedPos.value) posStats.value.hit += 1
    else posStats.value.miss += 1
  } else if (respondedPos.value) {
    posStats.value.falseAlarm += 1
  } else {
    posStats.value.correctReject += 1
  }

  if (stimulus.colorTarget) {
    if (respondedColor.value) colorStats.value.hit += 1
    else colorStats.value.miss += 1
  } else if (respondedColor.value) {
    colorStats.value.falseAlarm += 1
  } else {
    colorStats.value.correctReject += 1
  }
}

function respond(kind: 'pos' | 'color') {
  if (finished.value || !visible.value) return
  const flag = kind === 'pos' ? respondedPos : respondedColor
  if (flag.value) return
  flag.value = true
  rtList.value.push(performance.now() - stimulusAt.value)
  flash.value = kind
  timers.push(
    window.setTimeout(() => {
      flash.value = ''
    }, 180),
  )
}

function accuracyOf(stats: { hit: number; miss: number; falseAlarm: number; correctReject: number }) {
  const total = stats.hit + stats.miss + stats.falseAlarm + stats.correctReject
  return total ? accuracyPct(stats.hit + stats.correctReject, total) : 0
}

function finish() {
  if (finished.value) return
  finished.value = true
  clearTimers()
  const posAcc = accuracyOf(posStats.value)
  const colorAcc = accuracyOf(colorStats.value)
  const overall = Math.round((posAcc + colorAcc) / 2)
  const avgRt = Math.round(mean(rtList.value))
  const correctTrials = Math.round(((posAcc + colorAcc) / 200) * TOTAL * 2)

  emit('finish', {
    totalTrials: TOTAL * 2,
    correctTrials,
    avgReactionMs: avgRt,
    accuracy: overall / 100,
    difficulty: N,
    errors: [
      { type: '位置漏报', count: posStats.value.miss },
      { type: '位置误报', count: posStats.value.falseAlarm },
      { type: '颜色漏报', count: colorStats.value.miss },
      { type: '颜色误报', count: colorStats.value.falseAlarm },
    ].filter((e) => e.count > 0),
    dimensionScores: {
      workingMemory: compositeScore(overall, avgRt, 1300),
      divided: compositeScore(Math.min(posAcc, colorAcc), avgRt, 1400),
    },
  })
}

function start() {
  clearTimers()
  sequence.value = buildSequence()
  posStats.value = { hit: 0, miss: 0, falseAlarm: 0, correctReject: 0 }
  colorStats.value = { hit: 0, miss: 0, falseAlarm: 0, correctReject: 0 }
  rtList.value = []
  index.value = 0
  finished.value = false
  runTrial(0)
}

onMounted(start)
onBeforeUnmount(clearTimers)
</script>

<template>
  <div class="stack">
    <div class="game-hud">
      <span class="game-hud__pill">{{ N }}-Back · 第 {{ Math.min(index + 1, TOTAL) }} / {{ TOTAL }} 个</span>
      <div class="grow"></div>
      <span class="game-hud__pill">和 {{ N }} 个之前比</span>
    </div>
    <div class="progress">
      <div class="progress__fill" :style="{ width: progress + '%' }"></div>
    </div>

    <div class="game-stage nback-stage">
      <div class="nback-grid">
        <div v-for="cell in 9" :key="cell" class="nback-cell">
          <span
            v-if="visible && current && current.pos === cell - 1"
            class="nback-dot"
            :style="{ background: current.color.hex }"
          ></span>
        </div>
      </div>
    </div>

    <div class="grid grid--2">
      <button class="btn nback-btn" :class="{ 'is-on': flash === 'pos' }" @click="respond('pos')">
        📍 位置一样
      </button>
      <button class="btn nback-btn" :class="{ 'is-on': flash === 'color' }" @click="respond('color')">
        🎨 颜色一样
      </button>
    </div>
    <p class="hint center">
      圆点出现时，如果位置和 {{ N }} 个之前一样就点左边；如果颜色一样就点右边；都不一样就都不点。
    </p>
  </div>
</template>

<style scoped>
.nback-stage {
  min-height: 320px;
  display: grid;
  place-items: center;
  padding: 18px;
}

.nback-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  width: min(300px, 74vw);
}

.nback-cell {
  aspect-ratio: 1;
  border-radius: 18px;
  background: var(--cream-deep);
  display: grid;
  place-items: center;
}

.nback-dot {
  width: 62%;
  height: 62%;
  border-radius: 50%;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  animation: dotIn 0.16s ease;
}

@keyframes dotIn {
  from {
    transform: scale(0.6);
    opacity: 0.4;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

.nback-btn {
  min-height: 58px;
  font-size: 16px;
}

.nback-btn.is-on {
  border-color: var(--mint-deep);
  background: var(--mint-soft);
  transform: scale(0.97);
}
</style>
