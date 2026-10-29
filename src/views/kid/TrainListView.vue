<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { DIMENSIONS, MODULES } from '@shared/constants'
import { useDataStore } from '@/stores/data'
import { useGuardStore } from '@/stores/guard'
import { moduleStats } from '@/training/stats'
import { formatDate } from '@/utils/time'

const router = useRouter()
const data = useDataStore()
const guard = useGuardStore()

const stats = computed(() => moduleStats(data.myRecords))
const used = computed(() => data.todayTrainingMinutes)
const limit = computed(() => data.limits?.dailyTrainingMinutes ?? 40)

function statOf(id: string) {
  return stats.value.find((s) => s.id === id)!
}

function dimNames(keys: string[]) {
  return keys.map((k) => DIMENSIONS.find((d) => d.key === k)?.name ?? k).join(' · ')
}

function open(mod: (typeof MODULES)[number]) {
  if (mod.id === 'pomodoro') {
    router.push({ name: 'kid-homework' })
    return
  }
  // 训练页会再次调用守卫，被限制时展示对应的说明页
  router.push({ name: 'kid-play', params: { id: mod.id } })
}

onMounted(() => {
  guard.ensureTimer()
  if (!data.loaded) data.fetchState().catch(() => {})
})
</script>

<template>
  <div class="page">
    <div class="row row--between">
      <div>
        <h1 class="section-title" style="font-size: 22px">训练小馆</h1>
        <p class="section-sub">六种训练，练的是六种不同的注意力</p>
      </div>
      <span class="pill pill--mint">今日 {{ used }}/{{ limit }} 分钟</span>
    </div>

    <div class="grid grid--auto mt-16">
      <button v-for="mod in MODULES" :key="mod.id" class="card module-tile" @click="open(mod)">
        <div class="row row--between">
          <span class="emoji-lg">{{ mod.emoji }}</span>
          <span class="pill" :class="mod.id === 'pomodoro' ? 'pill--peach' : 'pill--mint'">
            {{ mod.id === 'pomodoro' ? '不计入上限' : mod.minutes + ' 分钟' }}
          </span>
        </div>
        <strong class="module-tile__name">{{ mod.name }}</strong>
        <span class="hint">{{ mod.subtitle }}</span>
        <span class="pill pill--lav">{{ dimNames(mod.dimensions) }}</span>
        <div class="module-tile__foot">
          <span v-if="statOf(mod.id).count" class="hint">练过 {{ statOf(mod.id).count }} 次 · 均分 {{ statOf(mod.id).avgScore }}</span>
          <span v-else class="hint">还没练过，试试看</span>
          <span v-if="statOf(mod.id).lastAt" class="hint">{{ formatDate(statOf(mod.id).lastAt!) }}</span>
        </div>
      </button>
    </div>

    <p class="hint mt-24 center">
      💡 每天练 15~20 分钟就够啦，练完记得去玩一会儿。
    </p>
  </div>
</template>

<style scoped>
.module-tile {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  color: var(--ink);
  transition: transform 0.16s ease, box-shadow 0.16s ease;
}

.module-tile:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow);
}

.module-tile__name {
  font-size: 18px;
}

.module-tile__foot {
  width: 100%;
  display: flex;
  justify-content: space-between;
  border-top: 1px dashed var(--line);
  padding-top: 8px;
  margin-top: 4px;
}
</style>
