<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { BADGES, DIMENSIONS, MODULES } from '@shared/constants'
import { useDataStore } from '@/stores/data'
import { useSessionStore } from '@/stores/session'
import { useGuardStore } from '@/stores/guard'
import { streamAi } from '@/api/client'
import { stripAiMarkup } from '@/utils/aiText'
import { aiSummary, dimensionAverages, streakDays, weeklyTrend } from '@/training/stats'

const router = useRouter()
const data = useDataStore()
const session = useSessionStore()
const guard = useGuardStore()

const name = computed(() => data.myProfile?.name ?? session.profile?.name ?? '小朋友')
const avatar = computed(() => data.myProfile?.avatar ?? session.profile?.avatar ?? '🙂')
const points = computed(() => data.myProfile?.points ?? 0)
const streak = computed(() => streakDays(data.myRecords))
const dims = computed(() => dimensionAverages(data.myRecords, 8))
const trend = computed(() => weeklyTrend(data.myRecords, 7))
const limits = computed(() => data.limits)

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 11) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
})

const weakDimension = computed(() => {
  const list = DIMENSIONS.map((d) => ({ ...d, value: dims.value[d.key] })).filter((d) => d.value > 0)
  if (!list.length) return null
  return list.sort((a, b) => a.value - b.value)[0]
})

const recommended = computed(() => {
  if (!weakDimension.value) return MODULES.filter((m) => m.id !== 'pomodoro').slice(0, 3)
  const dim = weakDimension.value.key
  const matched = MODULES.filter((m) => m.id !== 'pomodoro' && m.dimensions.includes(dim))
  const rest = MODULES.filter((m) => m.id !== 'pomodoro' && !matched.includes(m))
  return [...matched, ...rest].slice(0, 3)
})

const recentBadges = computed(() => {
  const owned = new Set(data.myProfile?.badges.map((b) => b.id) ?? [])
  return BADGES.filter((b) => owned.has(b.id)).slice(-4).reverse()
})

const usedMinutes = computed(() => data.todayTrainingMinutes)
const dailyLimit = computed(() => limits.value?.dailyTrainingMinutes ?? 40)

const praise = ref('')
const praiseLoading = ref(false)
const praiseError = ref('')

async function getPraise() {
  if (praiseLoading.value) return
  if (!data.myRecords.length) {
    praise.value = '先完成一次训练，我就能看到你的厉害之处啦。'
    return
  }
  praiseLoading.value = true
  praiseError.value = ''
  praise.value = ''
  try {
    await streamAi('encourage', {
      profileName: name.value,
      stats: aiSummary(data.myRecords, name.value),
    }, (delta) => {
      praise.value += delta
    })
  } catch (err: any) {
    praiseError.value = err?.message ?? 'AI 小伙伴暂时不在线'
  } finally {
    praiseLoading.value = false
  }
}

function goTrain(id: string) {
  if (id === 'pomodoro') {
    router.push({ name: 'kid-homework' })
    return
  }
  router.push({ name: 'kid-play', params: { id } })
}

onMounted(() => {
  guard.ensureTimer()
  if (!data.loaded) data.fetchState().catch(() => {})
})
</script>

<template>
  <div class="page">
    <section class="hero">
      <div>
        <p class="hint">{{ greeting }}，{{ name }} {{ avatar }}</p>
        <h1 class="hero__title">
          今天也来练一点，<br />
          让大脑更听你的话 ✨
        </h1>
      </div>
      <div class="hero__grid">
        <div class="mini-stat">
          <span class="mini-stat__value">{{ points }}</span>
          <span class="mini-stat__label">成长积分</span>
        </div>
        <div class="mini-stat">
          <span class="mini-stat__value">{{ streak }}</span>
          <span class="mini-stat__label">连续天数</span>
        </div>
        <div class="mini-stat">
          <span class="mini-stat__value">{{ usedMinutes }}<small>/{{ dailyLimit }}</small></span>
          <span class="mini-stat__label">今日训练（分）</span>
        </div>
        <div class="mini-stat">
          <span class="mini-stat__value">{{ data.myRecords.length }}</span>
          <span class="mini-stat__label">累计训练</span>
        </div>
      </div>
    </section>

    <section v-if="weakDimension" class="card card--mint mt-16">
      <div class="row row--between">
        <div>
          <p class="pill pill--mint">今天的小重点</p>
          <h2 class="section-title mt-8">{{ weakDimension.emoji }} {{ weakDimension.name }}还有进步空间</h2>
          <p class="section-sub">{{ weakDimension.desc }}</p>
        </div>
        <span class="emoji-xl">🎯</span>
      </div>
    </section>

    <section class="mt-24">
      <div class="row row--between">
        <h2 class="section-title">今天练什么</h2>
        <RouterLink :to="{ name: 'kid-train' }" class="btn btn--ghost btn--small">全部训练 →</RouterLink>
      </div>
      <div class="grid grid--3 mt-8">
        <button v-for="mod in recommended" :key="mod.id" class="card module-card" @click="goTrain(mod.id)">
          <span class="emoji-lg">{{ mod.emoji }}</span>
          <strong>{{ mod.name }}</strong>
          <span class="hint">{{ mod.subtitle }}</span>
          <span class="pill pill--mint">{{ mod.minutes }} 分钟</span>
        </button>
      </div>
    </section>

    <section class="grid grid--2 mt-24">
      <div class="card card--peach">
        <div class="row row--between">
          <div>
            <h3 class="section-title">作业番茄钟 🍅</h3>
            <p class="section-sub">拆小任务，专注一段，自检一次</p>
          </div>
        </div>
        <button class="btn btn--warm btn--block mt-16" @click="router.push({ name: 'kid-homework' })">去写作业</button>
      </div>
      <div class="card card--sky">
        <div class="row row--between">
          <div>
            <h3 class="section-title">问问 AI 小伙伴 🤖</h3>
            <p class="section-sub">卡住的题目，一起想下一步</p>
          </div>
        </div>
        <button class="btn btn--block mt-16" @click="router.push({ name: 'kid-tutor' })">开始提问</button>
      </div>
    </section>

    <section class="card mt-24">
      <div class="row row--between">
        <div>
          <h2 class="section-title">给我一点鼓励</h2>
          <p class="section-sub">AI 会看看你最近的训练，说一句只属于你的话</p>
        </div>
        <button class="btn btn--small" :disabled="praiseLoading" @click="getPraise">
          {{ praiseLoading ? '想想中…' : '听一听' }}
        </button>
      </div>
      <p v-if="praise" class="praise mt-16">{{ stripAiMarkup(praise) }}</p>
      <p v-if="praiseLoading && !praise" class="hint mt-16">正在翻你的训练记录…</p>
      <p v-if="praiseError" class="hint mt-16" style="color: var(--rose-deep)">{{ praiseError }}</p>
    </section>

    <section class="mt-24">
      <div class="row row--between">
        <h2 class="section-title">最近七天</h2>
        <span class="pill">{{ trend.reduce((a, b) => a + b.minutes, 0) }} 分钟</span>
      </div>
      <div class="week-strip mt-8">
        <div v-for="day in trend" :key="day.key" class="week-day">
          <div class="week-day__bar">
            <div class="week-day__fill" :style="{ height: Math.max(6, Math.min(100, day.score)) + '%' }"></div>
          </div>
          <span class="week-day__label">{{ day.label }}</span>
        </div>
      </div>
    </section>

    <section class="mt-24">
      <div class="row row--between">
        <h2 class="section-title">我的徽章</h2>
        <RouterLink :to="{ name: 'kid-growth' }" class="btn btn--ghost btn--small">看全部 →</RouterLink>
      </div>
      <div v-if="recentBadges.length" class="row row--wrap mt-8">
        <span v-for="badge in recentBadges" :key="badge.id" class="pill pill--butter">
          {{ badge.emoji }} {{ badge.name }}
        </span>
      </div>
      <p v-else class="hint mt-8">还没有徽章，完成第一次训练就能点亮第一枚 🌟</p>
    </section>
  </div>
</template>

<style scoped>
.hero {
  background: linear-gradient(135deg, #eaf7f0 0%, #fff4e6 55%, #f3ecfd 100%);
  border-radius: var(--radius-lg);
  padding: 26px;
  border: 1px solid #f0e4d3;
  box-shadow: var(--shadow-soft);
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  justify-content: space-between;
  align-items: center;
}

.hero__title {
  font-size: 24px;
  line-height: 1.45;
  margin-top: 8px;
  letter-spacing: 0.3px;
}

.hero__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(110px, 1fr));
  gap: 10px;
}

.mini-stat {
  background: rgba(255, 255, 255, 0.8);
  border-radius: 16px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 110px;
  border: 1px solid #f2e7d8;
}

.mini-stat__value {
  font-size: 24px;
  font-weight: 800;
  color: var(--mint-deep);
}

.mini-stat__value small {
  font-size: 13px;
  color: var(--muted);
  font-weight: 600;
}

.mini-stat__label {
  font-size: 12px;
  color: var(--muted);
}

.module-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  text-align: left;
  border-radius: var(--radius);
  transition: transform 0.16s ease, box-shadow 0.16s ease;
  cursor: pointer;
  font-family: inherit;
  color: var(--ink);
}

.module-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow);
}

.praise {
  background: var(--butter-soft);
  border-radius: 16px;
  padding: 14px 16px;
  line-height: 1.8;
  font-size: 15px;
  white-space: pre-wrap;
}

.week-strip {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  height: 120px;
  padding: 12px 4px 0;
}

.week-day {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  height: 100%;
}

.week-day__bar {
  flex: 1;
  width: 100%;
  max-width: 42px;
  background: var(--cream-deep);
  border-radius: 12px;
  display: flex;
  align-items: flex-end;
  overflow: hidden;
}

.week-day__fill {
  width: 100%;
  border-radius: 12px;
  background: linear-gradient(180deg, #9ad9c2, #6cc0a0);
  transition: height 0.4s ease;
}

.week-day__label {
  font-size: 11.5px;
  color: var(--muted);
}
</style>
