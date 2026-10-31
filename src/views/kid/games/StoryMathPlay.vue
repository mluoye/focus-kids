<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { STORY_MATH_GRADES } from '@shared/constants'
import type { StoryMathDetail, StoryMathGrade, StoryMathProblem } from '@shared/types'
import { accuracyPct, compositeScore, mean, type GameOutcome } from '@/training/engines'
import { useDataStore } from '@/stores/data'
import { useUiStore } from '@/stores/ui'
import { api } from '@/api/client'
import { speak, stopSpeak } from '@/utils/speech'

const emit = defineEmits<{ (e: 'finish', outcome: GameOutcome): void }>()

const data = useDataStore()
const ui = useUiStore()

/** 主轮题量；专项轮同样是 5 题 */
const TOTAL = 5
/** 专项训练最多累计轮数（含主轮）；超过后提示休息，不再出变式题 */
const MAX_ROUNDS = 2

interface AnswerRecord {
  /** 孩子最终提交的答案（拍照题取识别确认后的值；keypad 取输入值） */
  submitted: number | null
  /** 作答方式；未作答时为空 */
  mode: 'keypad' | 'photo' | ''
  /** 拍照题的识别结果（回显用） */
  recognized?: { answer: number; confidence: number }
}

const GRADE_LABEL: Record<StoryMathGrade, string> = {
  1: '一年级',
  2: '二年级',
  3: '三年级',
  4: '四年级',
  5: '五年级',
  6: '六年级',
}

const selected = ref<StoryMathGrade>(data.myProfile?.storymathGrade ?? 1)

const phase = ref<'pick' | 'loading' | 'play' | 'result' | 'error'>('pick')
const round = ref<'main' | 'remedial'>('main')
const problems = ref<StoryMathProblem[]>([])
const index = ref(0)
const rtList = ref<number[]>([])
const wrong = ref(0)
const tooSlow = ref(0)
const locked = ref(false)
const stimulusAt = ref(0)
const input = ref('')
const errorMsg = ref('')
/** 失败时的原始报错文本（AI 返回 / 上游错误，来自响应 detail），error 页折叠展示 */
const errorDetail = ref('')
const loading = ref(false)
const speaking = ref(false)
const done = ref(false)
/** 本轮是否正在判卷 */
const judging = ref(false)
/** 判卷结果（按出题顺序） */
const judgeItems = ref<{ correct: boolean; answer: number; errorStep?: string; solution: string; knowledgePoint: string }[]>([])
/** 每题的作答记录 */
const answers = ref<AnswerRecord[]>([])
/** 专项训练轮次计数（主轮=0；进入专项后=1、2） */
const remedialCount = ref(0)
/** 累计逐题明细（主轮 + 专项轮），结束时随 finish 上送持久化 */
const detailItems = ref<StoryMathDetail[]>([])
/** 拍照题：当前题是否在识别中 */
const recognizing = ref(false)
/** 拍照题：识别后回显是否显示 */
const showRecognized = ref(false)
/** 拍照题：识别出的答案（可修正） */
const recognizedInput = ref('')
/** 拍照题：识别置信度 */
const recognizedConfidence = ref(0)

const current = computed(() => problems.value[index.value])
/** 实际题目数（AI 可能不足 TOTAL 题，以此为准计算进度与正确率） */
const total = computed(() => Math.max(problems.value.length, 1))
const progress = computed(() => Math.round((index.value / total.value) * 100))
/** 已作答的题数（用于判断是否可提交判卷） */
const answeredCount = computed(() => answers.value.filter((a) => a.submitted !== null).length)
const correctCount = computed(() => judgeItems.value.filter((j) => j.correct).length)
const hasWrong = computed(() => judgeItems.value.some((j) => !j.correct))
/** 错题知识点（去重），专项训练按它出变式题 */
const wrongPoints = computed(() => {
  const pts: string[] = []
  for (const j of judgeItems.value) {
    if (!j.correct && j.knowledgePoint && !pts.includes(j.knowledgePoint)) pts.push(j.knowledgePoint)
  }
  return pts
})

function resetAnswers() {
  answers.value = problems.value.map(() => ({ submitted: null, mode: '' as const }))
  judgeItems.value = []
  input.value = ''
  recognizedInput.value = ''
  recognizedConfidence.value = 0
  showRecognized.value = false
}

/** 最近一次出题用的专项知识点（失败后「重试」沿用）；空 = 主轮 */
let lastFocusPoints: string[] = []

async function generate(remedialPoints: string[] = []) {
  if (loading.value) return
  loading.value = true
  errorMsg.value = ''
  errorDetail.value = ''
  lastFocusPoints = remedialPoints
  // 主轮（无专项知识点）开始前清空累计明细、重置轮次；专项轮保留已累积的主轮明细
  if (remedialPoints.length === 0) {
    detailItems.value = []
    round.value = 'main'
    remedialCount.value = 0
  }
  phase.value = 'loading'
  try {
    const res = await api.storymath(selected.value, TOTAL, remedialPoints)
    const list: StoryMathProblem[] = (res?.questions ?? []).map((q: any) => ({
      text: String(q?.text ?? ''),
      answer: Number(q?.answer),
      unit: String(q?.unit ?? ''),
      knowledgePoint: String(q?.knowledgePoint ?? '未标注'),
      ...(q?.hint ? { hint: String(q.hint) } : {}),
    }))
    if (!list.length) throw new Error('AI 没有出题，请重试')
    problems.value = list
    index.value = 0
    rtList.value = []
    wrong.value = 0
    tooSlow.value = 0
    locked.value = false
    done.value = false
    phase.value = 'play'
    resetAnswers()
    showTrial()
  } catch (err: any) {
    errorMsg.value = err?.message ?? 'AI 生成题目失败'
    // 原始报错文本（AI 返回内容 / 上游错误 / 网络错误），供定位
    errorDetail.value = typeof err?.detail === 'string' && err.detail ? err.detail : ''
    phase.value = 'error'
    ui.toast(errorMsg.value)
  } finally {
    loading.value = false
  }
}

/** 失败后重试：沿用上一次的出题参数（主轮/专项轮知识点不变） */
function retryGenerate() {
  generate(lastFocusPoints)
}

function showTrial() {
  locked.value = false
  input.value = ''
  recognizedInput.value = ''
  recognizedConfidence.value = 0
  showRecognized.value = false
  stimulusAt.value = performance.now()
}

async function readAloud() {
  const q = current.value
  if (!q) return
  if (speaking.value) {
    stopSpeak()
    speaking.value = false
    return
  }
  speaking.value = true
  const err = await speak(q.text)
  speaking.value = false
  if (err) ui.toast(err)
}

function onKey(key: string) {
  if (locked.value || done.value) return
  if (showRecognized.value) return
  if (key === 'C') {
    input.value = ''
    return
  }
  if (key === '⌫') {
    input.value = input.value.slice(0, -1)
    return
  }
  if (input.value.length >= 12) return
  if (key === '-' && input.value.includes('-')) return
  if (key === '.' && input.value.includes('.')) return
  input.value += key
}

function submitKeypad() {
  if (input.value === '' || input.value === '-' || input.value === '.') return
  const value = Number(input.value)
  if (!Number.isFinite(value)) return
  answers.value[index.value] = { submitted: value, mode: 'keypad' }
  advance()
}

/** 选择本题作答方式：keypad 直接输入 / photo 列式拍照 */
function pickMode(mode: 'keypad' | 'photo') {
  if (locked.value || done.value) return
  answers.value[index.value] = { submitted: null, mode }
  if (mode === 'keypad') {
    stimulusAt.value = performance.now()
  }
}

/** 拍照题：重新拍照（清空识别结果，回到拍照态） */
function retakePhoto() {
  if (locked.value || done.value) return
  recognizedInput.value = ''
  recognizedConfidence.value = 0
  showRecognized.value = false
  answers.value[index.value] = { submitted: null, mode: 'photo' }
}

/** 拍照题：选择拍照后调 recognize 识别答案 */
async function takePhoto(e: Event) {
  const inputEl = e.target as HTMLInputElement
  const file = inputEl.files?.[0]
  inputEl.value = ''
  if (!file) return
  if (locked.value || done.value) return
  recognizing.value = true
  try {
    const base64 = await fileToDataUrl(file)
    const res = await api.storymathRecognize(base64)
    recognizedInput.value = String(res?.answer ?? '')
    recognizedConfidence.value = Number(res?.confidence ?? 0)
    showRecognized.value = true
  } catch (err: any) {
    ui.toast(err?.message ?? '识别失败，请重拍或直接输入答案')
  } finally {
    recognizing.value = false
  }
}

/** 拍照题：确认识别出的答案（可先修正） */
function confirmRecognized() {
  if (locked.value || done.value) return
  const value = Number(recognizedInput.value)
  if (!Number.isFinite(value)) return
  answers.value[index.value] = { submitted: value, mode: 'photo', recognized: { answer: value, confidence: recognizedConfidence.value } }
  advance()
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

function advance() {
  window.setTimeout(() => {
    if (index.value + 1 >= total.value) {
      submitJudge()
      return
    }
    index.value += 1
    showTrial()
  }, 300)
}

/** 全部作答后：调 AI 判卷，得到逐题结果 */
async function submitJudge() {
  if (judging.value || done.value) return
  judging.value = true
  locked.value = true
  try {
    const submissions = problems.value.map((p, i) => ({
      text: p.text,
      unit: p.unit,
      knowledgePoint: p.knowledgePoint,
      submitted: answers.value[i]?.submitted,
      mode: answers.value[i]?.mode,
    }))
    const res = await api.storymathJudge(submissions)
    const items: any[] = res?.items ?? []
    if (items.length < total.value) throw new Error('AI 判卷结果不完整，请重试')
    judgeItems.value = items
    // 计分：以判卷结果为准（拍照题可能因过程错被 AI 判错）
    const c = items.filter((j) => j.correct).length
    wrong.value = total.value - c
    // 累积本轮逐题明细（主轮 + 专项轮），结束时随 finish 上送持久化
    detailItems.value.push({
      total: total.value,
      correct: c,
      round: round.value,
      items: items.map((j: any, i: number) => ({
        text: problems.value[i]?.text ?? '',
        submitted: answers.value[i]?.submitted ?? 0,
        answer: Number(j.answer),
        correct: j.correct === true,
        unit: problems.value[i]?.unit ?? '',
        mode: answers.value[i]?.mode === 'photo' ? ('photo' as const) : ('keypad' as const),
        knowledgePoint: String(j.knowledgePoint ?? problems.value[i]?.knowledgePoint ?? '未标注'),
        ...(j.errorStep ? { errorStep: String(j.errorStep) } : {}),
        ...(j.solution ? { solution: String(j.solution) } : {}),
      })),
    })
    phase.value = 'result'
  } catch (err: any) {
    errorMsg.value = err?.message ?? 'AI 判卷失败'
    phase.value = 'error'
    ui.toast(errorMsg.value)
  } finally {
    judging.value = false
    locked.value = false
  }
}

/** 进入专项训练：按错题知识点出变式题，最多 2 轮 */
function startRemedial() {
  if (remedialCount.value >= MAX_ROUNDS) {
    remedialLimitReached()
    return
  }
  // 先捕获当前错题知识点再清空 judgeItems，避免 computed 被清空后 focusPoints 丢失
  const points = wrongPoints.value
  remedialCount.value += 1
  round.value = 'remedial'
  judgeItems.value = []
  generate(points)
}

/** 专项训练达到上限：提示孩子休息（不自动继续） */
function remedialLimitReached() {
  ui.toast('错题专项已经练了 2 轮，先休息一下，剩下的错题下次再练')
}

/** 结束本轮：主轮成绩计入本次训练；专项轮逐题明细一并持久化（不稀释主轮正确率） */
function finish() {
  if (done.value) return
  done.value = true
  // 主轮为准：专项轮是巩固，若计入会掩盖孩子第一次面对题目的真实水平
  const main = detailItems.value[0]
  const mainTotal = main?.total ?? total.value
  const mainCorrect = main?.correct ?? mainTotal - wrong.value
  const acc = accuracyPct(mainCorrect, mainTotal)
  const avgRt = Math.round(mean(rtList.value))
  const errors = [
    { type: '算错', count: mainTotal - mainCorrect },
    { type: '反应超时', count: tooSlow.value },
  ].filter((e) => e.count > 0)
  // 读懂题意、分步列式 → workingMemory；不抢答、认真读题 → inhibition
  emit('finish', {
    totalTrials: mainTotal,
    correctTrials: mainCorrect,
    avgReactionMs: avgRt,
    accuracy: mainCorrect / mainTotal,
    difficulty: selected.value,
    errors,
    dimensionScores: {
      workingMemory: compositeScore(acc, avgRt, 4000),
      inhibition: compositeScore(acc, avgRt, 5000),
    },
    extra: {
      storymathDetail: detailItems.value,
    },
  })
}

onBeforeUnmount(() => {
  stopSpeak()
})
</script>

<template>
  <div class="stack">
    <!-- 选年级 -->
    <div v-if="phase === 'pick'" class="story-pick">
      <p class="hint center">选一个年级，AI 会按这个水平出 5 道应用题</p>
      <div class="story-grade-list">
        <button
          v-for="g in STORY_MATH_GRADES"
          :key="g.key"
          class="story-grade"
          :class="{ 'is-active': selected === g.key }"
          @click="selected = g.key"
        >
          <strong>{{ g.name }}</strong>
          <span>{{ g.desc }}</span>
        </button>
      </div>
      <button class="btn btn--primary btn--lg btn--block" :disabled="loading" @click="generate()">
        {{ loading ? 'AI 出题中…' : '开始挑战' }}
      </button>
      <p class="hint center mt-8">每题可以列式拍照，也可以直接给答案；答错的题会给你讲解并专项练</p>
    </div>

    <!-- 加载中 -->
    <div v-else-if="phase === 'loading'" class="story-loading">
      <p class="emoji-lg">📖</p>
      <p class="hint mt-8">AI 正在{{ round === 'remedial' ? '出专项变式题' : '出题' }}，稍等一下…</p>
    </div>

    <!-- 出错 -->
    <div v-else-if="phase === 'error'" class="story-loading">
      <p class="emoji-lg">😵</p>
      <p class="hint mt-8">{{ errorMsg }}</p>
      <!-- 原始报错文本（AI 返回 / 上游错误），默认折叠，供家长/定位 -->
      <details v-if="errorDetail" class="story-error-detail">
        <summary>查看原始报错文本</summary>
        <pre class="story-error-pre">{{ errorDetail }}</pre>
      </details>
      <div class="row mt-16" style="justify-content: center">
        <button class="btn" :disabled="loading" @click="retryGenerate">{{ loading ? '重试中…' : '🔄 重试' }}</button>
        <button class="btn btn--primary" @click="phase = 'pick'">返回重选</button>
      </div>
    </div>

    <!-- 答题 -->
    <template v-else-if="phase === 'play'">
      <div class="game-hud">
        <span class="game-hud__pill">第 {{ Math.min(index + 1, total) }} / {{ total }} 题</span>
        <span class="game-hud__pill" style="color: var(--rose-deep)">已答 {{ answeredCount }}</span>
        <div class="grow"></div>
        <span class="game-hud__pill" style="color: var(--mint-deep)">{{ GRADE_LABEL[selected] }}</span>
        <span v-if="round === 'remedial'" class="game-hud__pill" style="color: var(--butter-deep)">专项练 {{ remedialCount }}/{{ MAX_ROUNDS }}</span>
      </div>
      <div class="progress">
        <div class="progress__fill" :style="{ width: progress + '%' }"></div>
      </div>

      <div class="game-stage story-stage">
        <button class="btn btn--small story-read" @click="readAloud">
          {{ speaking ? '⏸ 停止' : '🔊 读题' }}
        </button>
        <p v-if="current" class="story-text">{{ current.text }}</p>
        <p v-if="current?.unit" class="hint">答案单位：{{ current.unit }}</p>

        <!-- 作答方式二选一（未作答时显示） -->
        <div v-if="answers[index]?.mode === ''" class="story-mode-pick">
          <button class="btn story-mode-btn" :disabled="locked || recognizing" @click="pickMode('keypad')">
            🔢 直接给答案
          </button>
          <button class="btn story-mode-btn" :disabled="locked || recognizing" @click="pickMode('photo')">
            📷 列式拍照
          </button>
        </div>

        <!-- 键盘输入 -->
        <div v-else-if="answers[index]?.mode === 'keypad'" class="story-keypad">
          <div class="arith-display" :class="{ 'is-answer': false }">
            {{ input || '?' }}
          </div>
          <div class="keypad-grid">
            <button
              v-for="key in ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫', '-', '.', '确定']"
              :key="key"
              class="keypad-key"
              :class="{ 'keypad-key--enter': key === '确定' }"
              :disabled="locked"
              @click="key === '确定' ? submitKeypad() : onKey(key)"
            >
              {{ key }}
            </button>
          </div>
        </div>

        <!-- 拍照 -->
        <div v-else-if="answers[index]?.mode === 'photo'" class="story-photo">
          <div v-if="recognizing" class="hint">AI 正在看你的算式…</div>
          <template v-else-if="showRecognized">
            <p class="hint">AI 读出你的答案是：</p>
            <div class="arith-display story-recog-display">
              <input v-model="recognizedInput" class="recog-input" inputmode="decimal" placeholder="?" />
            </div>
            <p class="hint" :style="{ color: recognizedConfidence < 0.5 ? 'var(--rose-deep)' : 'var(--muted)' }">
              {{ recognizedConfidence < 0.5 ? '看不太清，请核对一下' : '请确认对不对' }}
            </p>
            <div class="row" style="justify-content: center">
              <button class="btn" :disabled="locked" @click="retakePhoto">重拍</button>
              <button class="btn btn--primary" :disabled="locked" @click="confirmRecognized">确认</button>
            </div>
          </template>
          <template v-else>
            <p class="hint">把你的竖式/计算过程拍下来</p>
            <label class="btn btn--primary story-photo-label">
              {{ recognizing ? '识别中…' : '拍照上传' }}
              <input type="file" accept="image/*" capture="environment" class="story-photo-input" :disabled="locked" @change="takePhoto" />
            </label>
          </template>
        </div>

        <div v-if="locked && answers[index]?.submitted !== null && answers[index]?.mode !== ''" class="feedback">✅</div>
      </div>
    </template>

    <!-- 结果页 -->
    <div v-else-if="phase === 'result'" class="story-result">
      <div class="card card--pad center">
        <p class="pill pill--mint" style="margin: 0 auto">{{ round === 'remedial' ? '专项练完成' : '本轮完成' }}</p>
        <div class="result-big">
          <strong>{{ correctCount }} / {{ total }}</strong>
          <span>答对</span>
        </div>
        <p class="hint mt-8">
          {{ correctCount === total ? '全对，真棒！' : hasWrong ? '错了 ' + (total - correctCount) + ' 题，看看讲解，再专项练一练' : '' }}
        </p>

        <!-- 逐题讲解 -->
        <div class="story-solutions mt-16">
          <details v-for="(item, i) in judgeItems" :key="i" class="story-solution">
            <summary>
              <span :class="['dot', item.correct ? 'dot--ok' : 'dot--bad']"></span>
              <span class="story-solution__q">{{ problems[i]?.text }}</span>
              <span class="story-solution__mark">{{ item.correct ? '✓' : '✗' }}</span>
            </summary>
            <div class="story-solution__body">
              <p v-if="!item.correct && item.errorStep" class="story-solution__err">错因：{{ item.errorStep }}</p>
              <p class="story-solution__ans">标准答案：{{ item.answer }}<template v-if="problems[i]?.unit"> {{ problems[i]?.unit }}</template></p>
              <p v-if="item.solution" class="story-solution__sol">思路：{{ item.solution }}</p>
              <p class="story-solution__kp">知识点：{{ item.knowledgePoint }}</p>
            </div>
          </details>
        </div>

        <div class="row mt-24" style="justify-content: center">
          <button v-if="hasWrong && remedialCount < MAX_ROUNDS" class="btn btn--primary" @click="startRemedial">
            🎯 专项训练错题（{{ wrongPoints.length }} 个知识点）
          </button>
          <button v-else class="btn btn--primary" @click="finish">完成</button>
        </div>
        <p v-if="hasWrong && remedialCount >= MAX_ROUNDS" class="hint mt-8">
          专项已练 {{ MAX_ROUNDS }} 轮，先休息一下，剩下的错题下次再练
        </p>
        <button v-if="remedialCount < MAX_ROUNDS" class="btn mt-8" @click="finish">先结束（下次再练）</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.story-pick {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px 0;
}

.story-grade-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.story-grade {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 14px 16px;
  border-radius: 14px;
  border: 2px solid var(--line);
  background: #fff;
  box-shadow: var(--shadow-soft);
  text-align: left;
}

.story-grade strong {
  font-size: 17px;
}

.story-grade span {
  font-size: 13px;
  color: var(--muted);
}

.story-grade.is-active {
  border-color: var(--mint-deep);
  background: var(--mint-soft);
}

.story-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 60px 20px;
}

.story-error-detail {
  max-width: 90%;
  text-align: left;
  font-size: 12px;
  color: var(--muted);
}

.story-error-detail summary {
  cursor: pointer;
}

.story-error-pre {
  max-height: 160px;
  overflow: auto;
  margin-top: 8px;
  padding: 10px;
  background: var(--paper-soft, #f7f7f8);
  border-radius: 8px;
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 11px;
}

.story-stage {
  min-height: 420px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding: 24px;
}

.story-read {
  align-self: flex-end;
}

.story-text {
  font-size: clamp(19px, 5.2vw, 26px);
  line-height: 1.7;
  font-weight: 600;
  max-width: 560px;
  text-align: center;
}

.story-mode-pick {
  display: flex;
  gap: 14px;
  width: min(360px, 100%);
}

.story-mode-btn {
  flex: 1;
  padding: 18px 0;
  font-size: 16px;
  font-weight: 700;
  border-radius: 14px;
}

.story-keypad {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: min(320px, 100%);
}

.arith-display {
  min-height: 60px;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed var(--line);
  border-radius: 14px;
  font-size: 42px;
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
  padding: 15px 0;
  border-radius: 12px;
  border: 1.5px solid var(--line);
  background: #fff;
  font-size: 20px;
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

.story-photo {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: min(360px, 100%);
}

.story-photo-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 16px 28px;
}

.story-photo-input {
  display: none;
}

.story-recog-display {
  min-height: 64px;
  border-style: solid;
}

.recog-input {
  width: 80%;
  font-size: 36px;
  font-weight: 800;
  text-align: center;
  border: none;
  outline: none;
  background: transparent;
  font-variant-numeric: tabular-nums;
}

.story-result {
  padding: 8px 0;
}

.result-big {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin-top: 12px;
}

.result-big strong {
  font-size: 42px;
  color: var(--mint-deep);
}

.result-big span {
  font-size: 14px;
  color: var(--muted);
}

.story-solutions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
}

.story-solution {
  border: 1.5px solid var(--line);
  border-radius: 12px;
  padding: 10px 14px;
  background: #fff;
}

.story-solution summary {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  list-style: none;
}

.story-solution__q {
  flex: 1;
  font-size: 14px;
  line-height: 1.5;
}

.story-solution__mark {
  font-size: 18px;
  font-weight: 800;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot--ok {
  background: var(--mint-deep);
}

.dot--bad {
  background: var(--rose-deep);
}

.story-solution__body {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--line);
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}

.story-solution__err {
  color: var(--rose-deep);
  font-weight: 600;
}

.story-solution__ans {
  color: var(--ink);
  font-weight: 600;
}

.story-solution__sol {
  color: var(--muted);
}

.story-solution__kp {
  color: var(--muted);
  font-size: 12px;
}
</style>
