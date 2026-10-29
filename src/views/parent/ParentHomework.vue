<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { HomeworkPlan, HomeworkPlanItem } from '@shared/types'
import { homeworkDayKey, homeworkDayKeyOffset, isHomeworkStale } from '@shared/homework'
import { useDataStore } from '@/stores/data'
import { useUiStore } from '@/stores/ui'
import { formatDateTime } from '@/utils/time'

const data = useDataStore()
const ui = useUiStore()

const selectedId = ref('')
const planDate = ref(homeworkDayKey())
const title = ref('')
const items = ref<HomeworkPlanItem[]>([])
const saving = ref(false)
const error = ref('')

const todayKey = homeworkDayKey()
const tomorrowKey = homeworkDayKeyOffset(1)
const maxDate = homeworkDayKeyOffset(7)

const profiles = computed(() => data.profiles)
const activeProfile = computed(() => profiles.value.find((p) => p.id === selectedId.value) ?? profiles.value[0] ?? null)

function isActivePlan(plan: HomeworkPlan): boolean {
  return (
    plan.profileId === activeProfile.value?.id && plan.planDate === planDate.value && !plan.archivedAt
  )
}

const currentPlan = computed(
  () => data.homeworkPlans.filter(isActivePlan).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null,
)

/** 家长在页面里可管理的未来 7 天清单，方便看清已经录了哪几天。 */
const upcomingPlans = computed(() =>
  data.homeworkPlans
    .filter(
      (p) =>
        p.profileId === activeProfile.value?.id &&
        !p.archivedAt &&
        p.planDate >= todayKey &&
        p.planDate <= maxDate,
    )
    .sort((a, b) => a.planDate.localeCompare(b.planDate)),
)

const planSessions = computed(() => {
  if (!currentPlan.value) return []
  return data.homework
    .filter((h) => h.profileId === activeProfile.value?.id && h.planId === currentPlan.value!.id)
    .sort((a, b) => b.updatedAt - a.updatedAt)
})

const runningSession = computed(
  () => planSessions.value.find((h) => h.status === 'running' && !isHomeworkStale(h)) ?? null,
)
const doneSession = computed(() => planSessions.value.find((h) => h.status === 'done') ?? null)

const status = computed(() => {
  if (!currentPlan.value) return 'empty'
  if (runningSession.value) return 'running'
  if (doneSession.value) return doneSession.value.verdict === 'pass' ? 'pass' : 'fail'
  return 'idle'
})

const latestSession = computed(() => runningSession.value ?? doneSession.value ?? null)
const extraItems = computed(() => {
  if (!currentPlan.value || !latestSession.value) return []
  const planned = new Set(currentPlan.value.items.map((item) => item.id))
  return latestSession.value.items.filter((item) => !planned.has(item.id)).map((item) => item.title)
})

const isToday = computed(() => planDate.value === todayKey)

function sessionProgress(session: { items: { done: boolean }[] } | null): string {
  if (!session) return ''
  const done = session.items.filter((item) => item.done).length
  return `${done}/${session.items.length}`
}

function loadForm() {
  const plan = currentPlan.value
  title.value = plan?.title ?? ''
  items.value = plan?.items.map((item) => ({ ...item })) ?? []
  error.value = ''
}

function newPlanItem(): HomeworkPlanItem {
  return { id: `hpi_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`, title: '' }
}

function addItem() {
  if (items.value.length >= 12) {
    error.value = '清单最多 12 项'
    return
  }
  items.value.push(newPlanItem())
}

function removeItem(id: string) {
  items.value = items.value.filter((item) => item.id !== id)
}

async function save() {
  error.value = ''
  if (!activeProfile.value) {
    error.value = '先创建孩子档案'
    return
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(planDate.value) || planDate.value < todayKey || planDate.value > maxDate) {
    error.value = '请选择今天起 7 天内的日期'
    return
  }
  const clean = items.value
    .map((item) => ({ id: item.id, title: item.title.trim() }))
    .filter((item) => item.title.length > 0)
  if (!clean.length) {
    error.value = '至少写一项作业'
    return
  }
  if (clean.length > 12) {
    error.value = '清单最多 12 项'
    return
  }
  saving.value = true
  try {
    await data.saveHomeworkPlan({
      profileId: activeProfile.value.id,
      planDate: planDate.value,
      title: title.value.trim() || '今天的作业',
      items: clean,
    })
    loadForm()
    ui.toast('作业清单已保存，孩子打开作业页就能看到')
  } catch (err: any) {
    // 计划是家长刚录入的数据，必须在线保存；失败要明确告诉家长，不能假装成功
    error.value = err?.message ?? '保存失败，请检查网络后重试'
  } finally {
    saving.value = false
  }
}

async function archive() {
  const plan = currentPlan.value
  if (!plan) return
  if (!window.confirm(`确定删除 ${plan.planDate} 的作业清单吗？孩子已经开始的会话不受影响。`)) return
  try {
    await data.deleteHomeworkPlan(plan.id)
    loadForm()
    ui.toast('作业清单已删除')
  } catch (err: any) {
    error.value = err?.message ?? '删除失败，请稍后重试'
  }
}

watch([() => activeProfile.value?.id, planDate], loadForm)

onMounted(async () => {
  if (!data.loaded) {
    try {
      await data.fetchState()
    } catch (err: any) {
      ui.toast(err?.message ?? '加载数据失败，已使用本地缓存')
    }
  }
  if (!selectedId.value && profiles.value[0]) selectedId.value = profiles.value[0].id
  loadForm()
})
</script>

<template>
  <div class="stack">
    <div>
      <h1 class="section-title" style="font-size: 22px">作业清单</h1>
      <p class="section-sub">提前把孩子今天的作业录好，孩子进作业页会自动带出；开始后清单锁定</p>
    </div>

    <div v-if="!profiles.length" class="card card--pad center">
      <p class="emoji-xl">🧒</p>
      <p class="hint mt-8">还没有孩子档案，先创建一个吧。</p>
      <RouterLink :to="{ name: 'parent-profiles' }" class="btn btn--primary mt-16">去创建</RouterLink>
    </div>

    <template v-else>
      <div class="row row--wrap">
        <button
          v-for="p in profiles"
          :key="p.id"
          class="btn btn--small"
          :class="{ 'btn--primary': activeProfile?.id === p.id }"
          @click="selectedId = p.id"
        >
          {{ p.avatar }} {{ p.name }}
        </button>
      </div>

      <div class="card card--pad">
        <div class="row row--between row--wrap">
          <div>
            <h2 class="section-title" style="font-size: 17px">这是哪天的作业？</h2>
            <p class="hint mt-8">支持今天起 7 天，一天一份；同一天再保存会覆盖原清单。</p>
          </div>
          <div class="row">
            <button
              class="btn btn--small"
              :class="{ 'btn--primary': planDate === todayKey }"
              @click="planDate = todayKey"
            >
              今天
            </button>
            <button
              class="btn btn--small"
              :class="{ 'btn--primary': planDate === tomorrowKey }"
              @click="planDate = tomorrowKey"
            >
              明天
            </button>
            <input v-model="planDate" class="input date-input" type="date" :min="todayKey" :max="maxDate" />
          </div>
        </div>
      </div>

      <div class="card card--pad">
        <label class="label">作业名称</label>
        <input v-model="title" class="input" placeholder="例如：数学口算 + 语文抄写" maxlength="80" />

        <div class="row row--between mt-24">
          <label class="label" style="margin: 0">作业清单</label>
          <span class="hint">{{ items.length }}/12 项</span>
        </div>

        <div v-if="items.length" class="stack mt-8 plan-editor">
          <div v-for="(item, i) in items" :key="item.id" class="row plan-editor__row">
            <span class="pill pill--mint">{{ i + 1 }}</span>
            <input v-model="item.title" class="input grow" maxlength="60" placeholder="例如：数学口算第 1~20 题" />
            <button class="btn btn--ghost btn--small" @click="removeItem(item.id)">删</button>
          </div>
        </div>
        <p v-else class="hint mt-8">还没有清单项，先加一项。</p>

        <div class="row mt-16">
          <button class="btn btn--small" :disabled="items.length >= 12" @click="addItem">+ 加一项</button>
          <span class="grow"></span>
          <button v-if="currentPlan" class="btn btn--ghost btn--small" style="color: var(--rose-deep)" @click="archive">
            删除这天的清单
          </button>
          <button class="btn btn--primary" :disabled="saving" @click="save">
            {{ saving ? '保存中…' : currentPlan ? '保存修改' : '保存清单' }}
          </button>
        </div>
        <p v-if="error" class="hint mt-8" style="color: var(--rose-deep)">{{ error }}</p>
        <p class="hint mt-8">
          孩子开始后清单会锁定并复制到会话里；之后再改这里，只影响下一次开始，不会改动正在写或已完成的会话。
        </p>
      </div>

      <div v-if="isToday && currentPlan" class="card card--pad" :class="{ 'card--mint': status === 'pass' }">
        <div class="row row--between row--wrap">
          <div>
            <h2 class="section-title" style="font-size: 17px">今天的使用情况</h2>
            <p v-if="status === 'running'" class="hint mt-8">
              {{ activeProfile?.name }} 正在写作业 · 清单 {{ sessionProgress(runningSession) }} 项已完成
            </p>
            <p v-else-if="status === 'pass'" class="hint mt-8">
              {{ activeProfile?.name }} 已完成并全部勾选 · 清单 {{ sessionProgress(doneSession) }} 项
            </p>
            <p v-else-if="status === 'fail'" class="hint mt-8">
              {{ activeProfile?.name }} 已结束，还有项没完成 · 清单 {{ sessionProgress(doneSession) }} 项
            </p>
            <p v-else class="hint mt-8">{{ activeProfile?.name }} 还没开始，清单已经准备好了</p>
            <p v-if="latestSession" class="hint">最近更新 {{ formatDateTime(latestSession.updatedAt) }}</p>
            <p v-if="extraItems.length" class="hint mt-8">孩子额外加了：{{ extraItems.join('、') }}</p>
          </div>
          <span
            class="pill"
            :class="{
              'pill--mint': status === 'pass',
              'pill--peach': status === 'fail',
              'pill--sky': status === 'running',
              'pill--butter': status === 'idle',
            }"
          >
            {{ status === 'running' ? '进行中' : status === 'pass' ? '完成 · 正' : status === 'fail' ? '完成 · 负' : '未开始' }}
          </span>
        </div>
      </div>

      <div v-if="upcomingPlans.length" class="card card--pad">
        <h2 class="section-title" style="font-size: 17px">已经录好的清单</h2>
        <p class="hint mt-8">点一行可以继续修改；删除后孩子端当天不再显示。</p>
        <div class="stack mt-16" style="gap: 8px">
          <button
            v-for="plan in upcomingPlans"
            :key="plan.id"
            class="plan-row"
            :class="{ 'is-active': plan.planDate === planDate }"
            @click="planDate = plan.planDate"
          >
            <span class="pill pill--butter">{{ plan.planDate === todayKey ? '今天' : plan.planDate }}</span>
            <span class="grow" style="text-align: left">{{ plan.title }}</span>
            <span class="hint">{{ plan.items.length }} 项</span>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.date-input {
  width: 150px;
}

.plan-editor__row {
  gap: 8px;
}

.plan-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 14px;
  padding: 10px 14px;
  color: var(--ink);
  font-family: inherit;
  cursor: pointer;
}

.plan-row:hover {
  border-color: var(--mint);
  background: var(--mint-soft);
}

.plan-row.is-active {
  border-color: var(--mint-deep);
  background: var(--mint-soft);
}

@media (max-width: 560px) {
  .date-input {
    width: 100%;
  }
}
</style>
