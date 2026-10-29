<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { accuracyPct, clamp, compositeScore, mean, randInt, type GameOutcome } from '@/training/engines'

const emit = defineEmits<{ (e: 'finish', outcome: GameOutcome): void }>()

const TOTAL = 24
const BLOCK = 4

interface Trial {
  number: number
  color: 'red' | 'blue'
  rule: 'parity' | 'color'
  isSwitch: boolean
}

const trials = ref<Trial[]>([])
const index = ref(0)
const wrong = ref(0)
const rtAll = ref<number[]>([])
const rtSwitch = ref<number[]>([])
const rtRepeat = ref<number[]>([])
const feedback = ref<'' | 'correct' | 'wrong'>('')
const locked = ref(false)
const done = ref(false)
const showRuleChange = ref(false)
const stimulusAt = ref(0)

let timer: number | undefined

const current = computed(() => trials.value[index.value])
const ruleLabel = computed(() => (current.value?.rule === 'parity' ? '看数字：奇数还是偶数？' : '看颜色：红还是蓝？'))
const progress = computed(() => Math.round((index.value / TOTAL) * 100))

const colorHex = computed(() => (current.value?.color === 'red' ? '#e05656' : '#3f8ec4'))

function buildTrials(): Trial[] {
  const list: Trial[] = []
  for (let i = 0; i < TOTAL; i++) {
    const rule: 'parity' | 'color' = Math.floor(i / BLOCK) % 2 === 0 ? 'parity' : 'color'
    list.push({
      number: randInt(1, 9),
      color: Math.random() < 0.5 ? 'red' : 'blue',
      rule,
      isSwitch: i > 0 && i % BLOCK === 0,
    })
  }
  return list
}

function showTrial() {
  feedback.value = ''
  locked.value = false
  const trial = current.value
  if (trial?.isSwitch) {
    showRuleChange.value = true
    window.setTimeout(() => {
      showRuleChange.value = false
    }, 700)
  }
  stimulusAt.value = performance.now()
}

function answer(value: string) {
  if (locked.value || done.value || !current.value) return
  locked.value = true
  const rt = performance.now() - stimulusAt.value
  const trial = current.value
  const correct =
    trial.rule === 'parity'
      ? (value === 'odd' && trial.number % 2 === 1) || (value === 'even' && trial.number % 2 === 0)
      : value === trial.color

  rtAll.value.push(rt)
  if (trial.isSwitch) rtSwitch.value.push(rt)
  else rtRepeat.value.push(rt)
  if (!correct) wrong.value += 1
  feedback.value = correct ? 'correct' : 'wrong'

  timer = window.setTimeout(() => {
    if (index.value + 1 >= TOTAL) {
      finish()
      return
    }
    index.value += 1
    showTrial()
  }, 340)
}

function finish() {
  if (done.value) return
  done.value = true
  const correct = TOTAL - wrong.value
  const acc = accuracyPct(correct, TOTAL)
  const avgRt = Math.round(mean(rtAll.value))
  const switchCost = Math.round(Math.max(0, mean(rtSwitch.value) - mean(rtRepeat.value)))
  const switchPenalty = clamp(switchCost / 1200, 0, 1)
  const switching = clamp(Math.round(acc * 0.7 + (1 - switchPenalty) * 30), 0, 100)

  emit('finish', {
    totalTrials: TOTAL,
    correctTrials: correct,
    avgReactionMs: avgRt,
    accuracy: correct / TOTAL,
    difficulty: 1,
    errors: [
      { type: '规则用错', count: wrong.value },
      { type: '切换变慢', count: switchCost > 700 ? 1 : 0 },
    ].filter((e) => e.count > 0),
    dimensionScores: {
      switching,
      inhibition: compositeScore(acc, avgRt, 1000),
    },
    extra: { switchCostMs: switchCost },
  })
}

function start() {
  if (timer) clearTimeout(timer)
  trials.value = buildTrials()
  index.value = 0
  wrong.value = 0
  rtAll.value = []
  rtSwitch.value = []
  rtRepeat.value = []
  done.value = false
  showTrial()
}

onMounted(start)
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <div class="stack">
    <div class="game-hud">
      <span class="game-hud__pill">第 {{ Math.min(index + 1, TOTAL) }} / {{ TOTAL }} 张</span>
      <span class="game-hud__pill" style="color: var(--rose-deep)">答错 {{ wrong }}</span>
      <div class="grow"></div>
      <span class="game-hud__pill">每 4 张换一次规则</span>
    </div>
    <div class="progress">
      <div class="progress__fill" :style="{ width: progress + '%' }"></div>
    </div>

    <div class="rule-banner" :class="current?.rule === 'parity' ? 'rule-banner--mint' : 'rule-banner--sky'">
      {{ ruleLabel }}
      <span v-if="showRuleChange" class="rule-flash">规则换了！</span>
    </div>

    <div class="game-stage switch-stage">
      <div v-if="current" class="switch-card" :style="{ background: colorHex }">
        <span class="switch-card__number">{{ current.number }}</span>
      </div>
      <div v-if="feedback" class="feedback">{{ feedback === 'correct' ? '✅' : '❌' }}</div>
    </div>

    <div v-if="current" class="grid grid--2">
      <template v-if="current.rule === 'parity'">
        <button class="btn choice" :disabled="locked" @click="answer('odd')">奇数</button>
        <button class="btn choice" :disabled="locked" @click="answer('even')">偶数</button>
      </template>
      <template v-else>
        <button class="btn choice" :disabled="locked" style="color: #e05656" @click="answer('red')">红色</button>
        <button class="btn choice" :disabled="locked" style="color: #3f8ec4" @click="answer('blue')">蓝色</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.rule-banner {
  border-radius: 18px;
  padding: 14px 18px;
  font-size: 18px;
  font-weight: 800;
  display: flex;
  align-items: center;
  gap: 10px;
  position: relative;
}

.rule-banner--mint {
  background: var(--mint-soft);
  color: var(--mint-deep);
}

.rule-banner--sky {
  background: var(--sky-soft);
  color: var(--sky-deep);
}

.rule-flash {
  margin-left: auto;
  font-size: 13px;
  padding: 4px 12px;
  border-radius: 999px;
  background: var(--butter);
  color: var(--ink);
  animation: pop 0.7s ease;
}

.switch-stage {
  min-height: 280px;
  display: grid;
  place-items: center;
}

.switch-card {
  width: min(200px, 56vw);
  aspect-ratio: 1;
  border-radius: 26px;
  display: grid;
  place-items: center;
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.14);
}

.switch-card__number {
  font-size: clamp(64px, 18vw, 110px);
  font-weight: 800;
  color: #fff;
  text-shadow: 0 4px 0 rgba(0, 0, 0, 0.08);
}
</style>
