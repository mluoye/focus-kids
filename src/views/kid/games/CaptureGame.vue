<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { accuracyPct, clamp, compositeScore, mean, pick, randInt, type GameOutcome } from '@/training/engines'

const emit = defineEmits<{ (e: 'finish', outcome: GameOutcome): void }>()

const SHAPES = [
  { key: 'circle', glyph: '●', name: '圆形' },
  { key: 'square', glyph: '■', name: '方形' },
  { key: 'triangle', glyph: '▲', name: '三角形' },
  { key: 'star', glyph: '★', name: '星星' },
] as const

const COLORS = [
  { key: 'blue', hex: '#3f8ec4', name: '蓝色' },
  { key: 'red', hex: '#e05656', name: '红色' },
  { key: 'green', hex: '#3f9a78', name: '绿色' },
  { key: 'yellow', hex: '#dfa521', name: '黄色' },
] as const

interface Item {
  id: number
  shape: (typeof SHAPES)[number]
  color: (typeof COLORS)[number]
  x: number
  y: number
  isTarget: boolean
  spawnedAt: number
  clicked: boolean
}

const DURATION = 40
const target = ref({ shape: pick([...SHAPES]), color: pick([...COLORS]) })
const items = ref<Item[]>([])
const remaining = ref(DURATION)
const hits = ref(0)
const misses = ref(0)
const falseHits = ref(0)
const rtList = ref<number[]>([])
const done = ref(false)
const lastFeedback = ref<'' | 'hit' | 'bad'>('')

let seq = 0
let spawnTimer: number | undefined
let tickTimer: number | undefined
let lastClickAt = 0

const targetText = computed(() => `${target.value.color.name}${target.value.shape.name}`)
const progress = computed(() => ((DURATION - remaining.value) / DURATION) * 100)

function spawn() {
  if (done.value) return
  const isTarget = Math.random() < 0.36
  let shape = pick([...SHAPES])
  let color = pick([...COLORS])
  if (isTarget) {
    shape = target.value.shape
    color = target.value.color
  } else {
    // 保证干扰项不是目标组合
    while (shape.key === target.value.shape.key && color.key === target.value.color.key) {
      shape = pick([...SHAPES])
      color = pick([...COLORS])
    }
  }
  const item: Item = {
    id: ++seq,
    shape,
    color,
    x: randInt(6, 88),
    y: randInt(8, 84),
    isTarget,
    spawnedAt: performance.now(),
    clicked: false,
  }
  items.value.push(item)

  window.setTimeout(() => {
    const idx = items.value.findIndex((i) => i.id === item.id)
    if (idx === -1) return
    const current = items.value[idx]
    if (!current.clicked) {
      if (current.isTarget) misses.value += 1
      items.value.splice(idx, 1)
    }
  }, 1250)
}

function clickItem(item: Item) {
  if (done.value) return
  const idx = items.value.findIndex((i) => i.id === item.id)
  if (idx === -1) return
  items.value.splice(idx, 1)
  if (item.isTarget) {
    hits.value += 1
    rtList.value.push(performance.now() - item.spawnedAt)
    lastFeedback.value = 'hit'
  } else {
    falseHits.value += 1
    lastFeedback.value = 'bad'
  }
  lastClickAt = Date.now()
  window.setTimeout(() => {
    lastFeedback.value = ''
  }, 260)
}

function finish() {
  if (done.value) return
  done.value = true
  if (spawnTimer) clearInterval(spawnTimer)
  if (tickTimer) clearInterval(tickTimer)
  items.value = []
  const totalTargets = hits.value + misses.value
  const totalActions = hits.value + misses.value + falseHits.value
  const acc = accuracyPct(hits.value, totalActions)
  const hitRate = totalTargets ? accuracyPct(hits.value, totalTargets) : 0
  const avgRt = Math.round(mean(rtList.value))

  emit('finish', {
    totalTrials: Math.max(totalActions, 1),
    correctTrials: hits.value,
    avgReactionMs: avgRt,
    accuracy: (hits.value / Math.max(1, totalActions)),
    difficulty: 1,
    errors: [
      { type: '漏掉目标', count: misses.value },
      { type: '误点干扰项', count: falseHits.value },
    ].filter((e) => e.count > 0),
    dimensionScores: {
      selective: clamp(Math.round(acc * 0.6 + hitRate * 0.4), 0, 100),
      sustained: compositeScore(hitRate, avgRt, 900),
    },
  })
}

onMounted(() => {
  spawn()
  spawnTimer = window.setInterval(spawn, 950)
  tickTimer = window.setInterval(() => {
    remaining.value -= 1
    if (remaining.value <= 0) finish()
  }, 1000)
})

onBeforeUnmount(() => {
  if (spawnTimer) clearInterval(spawnTimer)
  if (tickTimer) clearInterval(tickTimer)
})
</script>

<template>
  <div class="stack">
    <div class="game-hud">
      <span class="game-hud__pill">⏱ {{ remaining }} 秒</span>
      <span class="game-hud__pill">只点 <strong :style="{ color: target.color.hex }">{{ targetText }}</strong></span>
      <div class="grow"></div>
      <span class="game-hud__pill" style="color: var(--mint-deep)">抓到 {{ hits }}</span>
      <span class="game-hud__pill" style="color: var(--rose-deep)">误点 {{ falseHits }}</span>
    </div>
    <div class="progress">
      <div class="progress__fill" :style="{ width: progress + '%' }"></div>
    </div>

    <div class="game-stage capture-stage">
      <button
        v-for="item in items"
        :key="item.id"
        class="capture-item"
        :style="{ left: item.x + '%', top: item.y + '%', color: item.color.hex }"
        @click="clickItem(item)"
      >
        {{ item.shape.glyph }}
      </button>
      <div v-if="lastFeedback" class="feedback" style="font-size: 54px">
        {{ lastFeedback === 'hit' ? '✨' : '💥' }}
      </div>
      <p v-if="!items.length" class="hint">准备好，图形马上出现…</p>
    </div>
  </div>
</template>

<style scoped>
.capture-stage {
  min-height: 380px;
  display: grid;
  place-items: center;
  background: linear-gradient(180deg, #ffffff, #fbf7f0);
  touch-action: manipulation;
}

.capture-item {
  position: absolute;
  transform: translate(-50%, -50%);
  border: none;
  background: transparent;
  font-size: 44px;
  line-height: 1;
  padding: 8px;
  transition: transform 0.1s ease;
  animation: appear 0.14s ease;
}

.capture-item:active {
  transform: translate(-50%, -50%) scale(0.9);
}

@keyframes appear {
  from {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.6);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}
</style>
