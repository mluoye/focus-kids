<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { ARITHMETIC_DIFFICULTIES } from '@shared/constants'
import type { ArithmeticDifficulty } from '@shared/types'
import { accuracyPct, compositeScore, mean, randInt, shuffle, type GameOutcome } from '@/training/engines'
import { useDataStore } from '@/stores/data'

const emit = defineEmits<{ (e: 'finish', outcome: GameOutcome): void }>()

const data = useDataStore()

const TOTAL = 20

type Op = '+' | '-' | '×' | '÷'

interface Trial {
  /** 可朗读/展示的表达式 */
  text: string
  answer: number
  choices: number[]
  op: Op
}

const DIFF_LABEL: Record<ArithmeticDifficulty, string> = {
  1: '20以内加减',
  2: '100以内+乘法表',
  3: '混合四则（含括号）',
}

/** 当前孩子档案的作答方式；家长在档案编辑里设置，缺省选项四选一 */
const mode = computed<'choice' | 'keypad'>(() => data.myProfile?.arithmeticMode ?? 'choice')

/** 本次难度：默认取家长配置，孩子进入后可临时切换 */
const selected = ref<ArithmeticDifficulty>(data.myProfile?.arithmeticDifficulty ?? 1)

/** 选难度阶段 / 作答阶段 */
const phase = ref<'pick' | 'play'>('pick')

const trials = ref<Trial[]>([])
const index = ref(0)
const rtList = ref<number[]>([])
const wrong = ref(0)
const tooSlow = ref(0)
const feedback = ref<'correct' | 'wrong' | ''>('')
const locked = ref(false)
const stimulusAt = ref(0)
const done = ref(false)
const input = ref('')

const current = computed(() => trials.value[index.value])
const progress = computed(() => Math.round((index.value / TOTAL) * 100))
const difficulty = computed(() => selected.value)

function start(diff: ArithmeticDifficulty) {
  selected.value = diff
  trials.value = buildTrials(diff)
  index.value = 0
  rtList.value = []
  wrong.value = 0
  tooSlow.value = 0
  feedback.value = ''
  input.value = ''
  done.value = false
  phase.value = 'play'
  showTrial()
}

/** 生成一道 20 以内加减法题 */
function easyAddSub(): Trial {
  const add = Math.random() < 0.5
  if (add) {
    const a = randInt(1, 12)
    const b = randInt(1, 20 - a)
    return makeTrial(`${a} + ${b}`, a + b, '+')
  }
  const a = randInt(5, 20)
  const b = randInt(1, a - 1)
  return makeTrial(`${a} - ${b}`, a - b, '-')
}

/** 生成一道 100 以内加减法或九九乘法题 */
function midLevel(): Trial {
  const kind = Math.random()
  if (kind < 0.4) {
    // 100 以内加法
    const a = randInt(11, 60)
    const b = randInt(11, 99 - a)
    return makeTrial(`${a} + ${b}`, a + b, '+')
  }
  if (kind < 0.7) {
    // 100 以内减法
    const a = randInt(30, 99)
    const b = randInt(5, a - 1)
    return makeTrial(`${a} - ${b}`, a - b, '-')
  }
  // 九九乘法（2~9）
  const a = randInt(2, 9)
  const b = randInt(2, 9)
  return makeTrial(`${a} × ${b}`, a * b, '×')
}

/** 生成一道混合四则（先乘除后加减，含括号）题 */
function hardLevel(): Trial {
  const withParen = Math.random() < 0.5
  if (withParen) {
    // (a ± b) × c 型
    const a = randInt(3, 12)
    const b = randInt(2, a - 1)
    const c = randInt(2, 9)
    if (Math.random() < 0.5) {
      const inner = a + b
      return makeTrial(`(${a} + ${b}) × ${c}`, inner * c, '×')
    }
    const inner = a - b
    return makeTrial(`(${a} - ${b}) × ${c}`, inner * c, '×')
  }
  // a + b × c 型（先乘除后加减）
  const a = randInt(2, 20)
  const b = randInt(2, 9)
  const c = randInt(2, 9)
  return makeTrial(`${a} + ${b} × ${c}`, a + b * c, '+')
}

function makeTrial(text: string, answer: number, op: Op): Trial {
  return { text, answer, choices: makeChoices(text, answer, op), op }
}

/** 干扰项：正确答案 ± 小偏移，以及（对难度 3 而言）有教学意义的「运算顺序错」结果 */
function makeChoices(text: string, answer: number, op: Op): number[] {
  const set = new Set<number>([answer])
  const candidates = [answer - 1, answer + 1, answer + 2, answer - 2, answer + 3]
  // 对「a + b × c」型，把误算成 (a+b)×c 的结果作为干扰项（先加后乘是常见错误）
  const wrongOrder = wrongOrderAnswer(text)
  if (wrongOrder !== null && wrongOrder >= 0) candidates.push(wrongOrder)
  for (const c of candidates) {
    if (set.size >= 4) break
    if (c >= 0 && c !== answer) set.add(c)
  }
  // 保底填充（极端情况，理论上用不到）
  let filler = answer + 1
  while (set.size < 4) {
    set.add(filler++)
  }
  // 随机打乱，避免正确答案固定出现在同一位置（孩子会记住位置而非心算）
  return shuffle([...set])
}

/** 尝试算出「运算顺序搞错」的结果；只在 `a + b × c` 这类题上有意义，否则返回 null */
function wrongOrderAnswer(text: string): number | null {
  // 形如 "A + B × C" 或 "A - B × C"
  const m = text.match(/^(\d+) ([+-]) (\d+) × (\d+)$/)
  if (!m) return null
  const [, a, s, b, c] = m
  const left = Number(a)
  const right = Number(b) * Number(c)
  return s === '+' ? left + right : left - right
}

/** 按选定难度生成 20 道同档题 */
function buildTrials(diff: ArithmeticDifficulty): Trial[] {
  const list: Trial[] = []
  for (let i = 0; i < TOTAL; i++) {
    if (diff === 1) list.push(easyAddSub())
    else if (diff === 2) list.push(midLevel())
    else list.push(hardLevel())
  }
  return list
}

function showTrial() {
  locked.value = false
  feedback.value = ''
  input.value = ''
  stimulusAt.value = performance.now()
}

function answer(value: number) {
  if (locked.value || done.value || !current.value) return
  locked.value = true
  const rt = performance.now() - stimulusAt.value
  rtList.value.push(rt)
  const correct = value === current.value.answer
  if (correct) {
    feedback.value = 'correct'
  } else {
    wrong.value += 1
    feedback.value = 'wrong'
  }
  if (rt > 5000) tooSlow.value += 1
  advance()
}

function submitKeypad() {
  if (input.value === '') return
  const value = Number(input.value)
  if (!Number.isFinite(value)) return
  answer(value)
}

function advance() {
  window.setTimeout(() => {
    if (index.value + 1 >= TOTAL) {
      finish()
      return
    }
    index.value += 1
    showTrial()
  }, 400)
}

function finish() {
  if (done.value) return
  done.value = true
  const correct = TOTAL - wrong.value
  const acc = accuracyPct(correct, TOTAL)
  const avgRt = Math.round(mean(rtList.value))
  const errors = [
    { type: '算错', count: wrong.value },
    { type: '反应超时', count: tooSlow.value },
  ].filter((e) => e.count > 0)
  // 心算要记住中间结果 → workingMemory；忍住不抢答、不靠猜 → inhibition
  emit('finish', {
    totalTrials: TOTAL,
    correctTrials: correct,
    avgReactionMs: avgRt,
    accuracy: correct / TOTAL,
    difficulty: difficulty.value,
    errors,
    dimensionScores: {
      workingMemory: compositeScore(acc, avgRt, 2500),
      inhibition: compositeScore(acc, avgRt, 3000),
    },
  })
}

function onKey(key: string) {
  if (locked.value || done.value) return
  if (key === 'C') {
    input.value = ''
    return
  }
  if (key === '⌫') {
    input.value = input.value.slice(0, -1)
    return
  }
  if (input.value.length >= 4) return
  input.value += key
}

onBeforeUnmount(() => {
  /* 无定时器需要清理（advance 用一次性 setTimeout） */
})
</script>

<template>
  <div class="stack">
    <!-- 选难度 -->
    <div v-if="phase === 'pick'" class="arith-pick">
      <p class="hint center">先选一个难度，再开始 20 道心算</p>
      <div class="arith-diff-list">
        <button
          v-for="d in ARITHMETIC_DIFFICULTIES"
          :key="d.key"
          class="arith-diff"
          :class="{ 'is-active': selected === d.key }"
          @click="selected = d.key"
        >
          <strong>{{ d.name }}</strong>
          <span>{{ d.desc }}</span>
        </button>
      </div>
      <button class="btn btn--primary btn--lg btn--block" @click="start(selected)">开始挑战</button>
    </div>

    <!-- 作答 -->
    <template v-else>
      <div class="game-hud">
        <span class="game-hud__pill">第 {{ Math.min(index + 1, TOTAL) }} / {{ TOTAL }} 题</span>
        <span class="game-hud__pill" style="color: var(--rose-deep)">答错 {{ wrong }}</span>
        <div class="grow"></div>
        <span class="game-hud__pill" style="color: var(--mint-deep)">{{ DIFF_LABEL[difficulty] }}</span>
      </div>
      <div class="progress">
        <div class="progress__fill" :style="{ width: progress + '%' }"></div>
      </div>

      <div class="game-stage arith-stage">
        <p class="hint">心算下面这道题，算对了得一分</p>
        <div v-if="current" class="arith-expression">{{ current.text }}</div>
        <div class="feedback" v-if="feedback">{{ feedback === 'correct' ? '✅' : '❌' }}</div>

        <!-- 选项四选一 -->
        <div v-if="mode === 'choice'" class="arith-choices">
          <button
            v-for="choice in current?.choices"
            :key="choice"
            class="arith-choice"
            :disabled="locked"
            @click="answer(choice)"
          >
            {{ choice }}
          </button>
        </div>

        <!-- 键盘直接输入 -->
        <div v-else class="arith-keypad">
          <div class="arith-display" :class="{ 'is-answer': feedback === 'correct' }">
            {{ input || '?' }}
          </div>
          <div class="keypad-grid">
            <button
              v-for="key in ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫']"
              :key="key"
              class="keypad-key"
              :disabled="locked"
              @click="onKey(key)"
            >
              {{ key }}
            </button>
            <button class="keypad-key keypad-key--enter" :disabled="locked || input === ''" @click="submitKeypad">
              确定
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.arith-pick {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px 0;
}

.arith-diff-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.arith-diff {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 16px;
  border-radius: 16px;
  border: 2px solid var(--line);
  background: #fff;
  box-shadow: var(--shadow-soft);
  text-align: left;
}

.arith-diff strong {
  font-size: 18px;
}

.arith-diff span {
  font-size: 13px;
  color: var(--muted);
}

.arith-diff.is-active {
  border-color: var(--mint-deep);
  background: var(--mint-soft);
}

.arith-stage {
  min-height: 360px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 24px;
}

.arith-expression {
  font-size: clamp(40px, 11vw, 72px);
  font-weight: 800;
  letter-spacing: 2px;
  font-variant-numeric: tabular-nums;
}

.arith-choices {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  width: min(340px, 100%);
}

.arith-choice {
  padding: 18px 12px;
  border-radius: 16px;
  border: 2px solid var(--line);
  background: #fff;
  font-size: 28px;
  font-weight: 700;
  box-shadow: var(--shadow-soft);
  font-variant-numeric: tabular-nums;
}

.arith-choice:active {
  transform: scale(0.96);
}

.arith-keypad {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: min(320px, 100%);
}

.arith-display {
  min-height: 64px;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed var(--line);
  border-radius: 14px;
  font-size: 44px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.arith-display.is-answer {
  border-color: var(--mint-deep);
  color: var(--mint-deep);
}

.keypad-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  width: 100%;
}

.keypad-key {
  padding: 16px 0;
  border-radius: 12px;
  border: 1.5px solid var(--line);
  background: #fff;
  font-size: 22px;
  font-weight: 700;
}

.keypad-key:active {
  transform: scale(0.95);
}

.keypad-key--enter {
  grid-column: span 3;
  background: var(--mint-deep);
  color: #fff;
  border-color: var(--mint-deep);
}
</style>
