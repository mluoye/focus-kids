<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import type { HomeworkPlan, HomeworkPlanItem } from '@shared/types'
import { homeworkDayKey, homeworkDayKeyOffset, isHomeworkStale } from '@shared/homework'
import { useDataStore } from '@/stores/data'
import { useUiStore } from '@/stores/ui'
import { formatDateTime } from '@/utils/time'
import { SUBJECT_ICONS, detectSubjectIcon } from '@/utils/subject'
import {
  parseHomeworkText,
  normalizeParsedPlans,
  extractJsonFromAi,
  type ParsedHomeworkPlan,
} from '@/utils/homeworkParse'
import { streamAi } from '@/api/client'

const data = useDataStore()
const ui = useUiStore()

/** 可编辑的一份科目计划（含本地新增、服务端已有）。 */
interface EditablePlan {
  key: string
  id?: string
  subject: string
  title: string
  items: HomeworkPlanItem[]
}

const selectedId = ref('')
const planDate = ref(homeworkDayKey())
/** 当前日期下的可编辑计划（服务端 + 已解析未保存） */
const plans = ref<EditablePlan[]>([])
/** 加载时来自服务端的计划 id：保存时被移除的要删除 */
const loadedServerIds = ref<string[]>([])
/** 解析出但日期不是当前所选、暂存待逐天保存的计划 */
const parsedCache = reactive<Record<string, EditablePlan[]>>({})
const saving = ref(false)
const error = ref('')

// ---- AI 解析 ----
const parseText = ref('')
const parseBusy = ref(false)
const parseResult = ref('')
/** 手动改过图标的项 id：之后编辑标题不再自动重识别，尊重家长的选择。 */
let manualIconIds = new Set<string>()

const todayKey = homeworkDayKey()
const tomorrowKey = homeworkDayKeyOffset(1)
/** 解析老师发的通知可能带前几天作业，允许回看过去 7 天；服务器端放宽到 ±30 天。 */
const minDate = homeworkDayKeyOffset(-7)
const maxDate = homeworkDayKeyOffset(7)

const profiles = computed(() => data.profiles)
const activeProfile = computed(() => profiles.value.find((p) => p.id === selectedId.value) ?? profiles.value[0] ?? null)

function isActivePlan(plan: HomeworkPlan): boolean {
  return plan.profileId === activeProfile.value?.id && plan.planDate === planDate.value && !plan.archivedAt
}

function serverToEditable(plan: HomeworkPlan): EditablePlan {
  return {
    key: plan.id,
    id: plan.id,
    subject: plan.subject ?? '',
    title: plan.title,
    items: plan.items.map((item) => {
      if (item.icon) manualIconIds.add(item.id)
      return { ...item, icon: item.icon || detectSubjectIcon(item.title) }
    }),
  }
}

function newEditable(subject = '', title = ''): EditablePlan {
  return {
    key: `pe_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    subject,
    title,
    items: [],
  }
}

/** 家长在页面里可管理的日期窗口（今天前后 7 天）内已录的清单，方便看清哪天录了哪几科。 */
const upcomingPlans = computed(() =>
  data.homeworkPlans
    .filter(
      (p) =>
        p.profileId === activeProfile.value?.id &&
        !p.archivedAt &&
        p.planDate >= minDate &&
        p.planDate <= maxDate,
    )
    .sort((a, b) => a.planDate.localeCompare(b.planDate) || (a.subject ?? '').localeCompare(b.subject ?? '')),
)

/** 今天（所选孩子）所有科目的计划，用于使用情况汇总。 */
const todayPlanList = computed(() =>
  data.homeworkPlans.filter(
    (p) => p.profileId === activeProfile.value?.id && p.planDate === todayKey && !p.archivedAt,
  ),
)

const planSessions = computed(() => {
  const ids = new Set(todayPlanList.value.map((p) => p.id))
  return data.homework
    .filter((h) => h.profileId === activeProfile.value?.id && h.planId && ids.has(h.planId))
    .sort((a, b) => b.updatedAt - a.updatedAt)
})

const runningSession = computed(
  () => planSessions.value.find((h) => h.status === 'running' && !isHomeworkStale(h)) ?? null,
)
const doneSession = computed(() => planSessions.value.find((h) => h.status === 'done') ?? null)

const status = computed(() => {
  if (!todayPlanList.value.length) return 'empty'
  if (runningSession.value) return 'running'
  if (doneSession.value) return doneSession.value.verdict === 'pass' ? 'pass' : 'fail'
  return 'idle'
})

const latestSession = computed(() => runningSession.value ?? doneSession.value ?? null)
const extraItems = computed(() => {
  if (!todayPlanList.value.length || !latestSession.value) return []
  const planned = new Set(todayPlanList.value.flatMap((p) => p.items.map((item) => item.id)))
  return latestSession.value.items.filter((item) => !planned.has(item.id)).map((item) => item.title)
})

const isToday = computed(() => planDate.value === todayKey)
/** 当前日期是否有编辑中的计划（含未保存解析结果） */
const hasEditablePlans = computed(() => plans.value.some((p) => p.items.some((it) => it.title.trim())))

function sessionProgress(session: { items: { done: boolean }[] } | null): string {
  if (!session) return ''
  const done = session.items.filter((item) => item.done).length
  return `${done}/${session.items.length}`
}

function loadForm() {
  const serverPlans = data.homeworkPlans.filter(isActivePlan).map(serverToEditable)
  loadedServerIds.value = serverPlans.map((p) => p.key)
  const cached = parsedCache[planDate.value] ?? []
  const merged = [...serverPlans]
  // 已解析未保存的计划优先：同科目覆盖服务端同名计划
  for (const cp of cached) {
    const idx = merged.findIndex((x) => x.subject === cp.subject)
    if (idx >= 0) merged[idx] = cp
    else merged.push(cp)
  }
  plans.value = merged
  error.value = ''
}

function newPlanItem(): HomeworkPlanItem {
  return {
    id: `hpi_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    title: '',
    icon: detectSubjectIcon(''),
  }
}

function markManualIcon(id: string) {
  manualIconIds.add(id)
}

function onTitleChange(item: HomeworkPlanItem) {
  if (!manualIconIds.has(item.id)) item.icon = detectSubjectIcon(item.title)
}

function addItem(plan: EditablePlan) {
  if (plan.items.length >= 12) {
    error.value = '一份清单最多 12 项'
    return
  }
  plan.items.push(newPlanItem())
}

function removeItem(plan: EditablePlan, id: string) {
  plan.items = plan.items.filter((item) => item.id !== id)
}

function addSubjectPlan() {
  plans.value.push(newEditable())
}

/** 删除某份计划：有服务端 id 立即删除；否则仅从当前编辑列表移除。 */
async function removePlan(plan: EditablePlan) {
  if (plan.id) {
    if (!window.confirm(`确定删除这份「${plan.subject || '作业'}」清单吗？孩子已经开始的会话不受影响。`)) return
    try {
      await data.deleteHomeworkPlan(plan.id)
      await data.fetchState()
      loadForm()
      ui.toast('已删除')
    } catch (err: any) {
      error.value = err?.message ?? '删除失败，请稍后重试'
    }
  } else {
    plans.value = plans.value.filter((p) => p.key !== plan.key)
  }
}

function validDate(d: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= minDate && d <= maxDate
}

async function save() {
  error.value = ''
  if (!activeProfile.value) {
    error.value = '先创建孩子档案'
    return
  }
  if (!validDate(planDate.value)) {
    error.value = '请选择今天前后 7 天内的日期'
    return
  }
  const profileId = activeProfile.value.id
  const toSave = plans.value.filter((p) => p.items.some((it) => it.title.trim()))
  if (!toSave.length) {
    error.value = '至少写一项作业'
    return
  }
  for (const p of toSave) {
    if (p.items.filter((it) => it.title.trim()).length > 12) {
      error.value = `「${p.subject || '作业'}」清单最多 12 项`
      return
    }
  }
  saving.value = true
  try {
    const kept = new Set<string>()
    for (const p of toSave) {
      const clean = p.items
        .map((item) => ({
          id: item.id,
          title: item.title.trim(),
          icon: item.icon || detectSubjectIcon(item.title),
        }))
        .filter((item) => item.title.length > 0)
      if (!clean.length) continue
      const subject = p.subject.trim() || ''
      await data.saveHomeworkPlan({
        profileId,
        planDate: planDate.value,
        subject: subject || undefined,
        title: p.title.trim() || (subject ? `${subject}作业` : '今天的作业'),
        items: clean,
      })
      // 保存后从最新快照反查真实落库 id：upsert 按 (profileId, planDate, subject) 命中时
      // 会保留原服务端 id，不能再用可编辑 key（解析替换后为 pp_…）判断「保留」，
      // 否则清理循环会把刚保存的同科计划误删。
      const saved = data.homeworkPlans.find(
        (x) =>
          x.profileId === profileId &&
          x.planDate === planDate.value &&
          (x.subject ?? '') === subject &&
          !x.archivedAt,
      )
      if (saved) kept.add(saved.id)
    }
    // 删除已被移除的服务端计划
    for (const id of loadedServerIds.value) {
      if (!kept.has(id)) await data.deleteHomeworkPlan(id)
    }
    delete parsedCache[planDate.value]
    await data.fetchState()
    loadForm()
    ui.toast('作业清单已保存，孩子打开作业页就能看到')
  } catch (err: any) {
    error.value = err?.message ?? '保存失败，请检查网络后重试'
  } finally {
    saving.value = false
  }
}

/** 解析出的计划转成可编辑项。 */
function parsedToEditable(p: ParsedHomeworkPlan): EditablePlan {
  return {
    key: `pp_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    subject: p.subject,
    title: p.title,
    items: p.items.map((it) => ({ id: `hpi_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`, title: it.title, icon: it.icon })),
  }
}

/** 把解析结果合并进编辑区（当前日期）或暂存（其它日期）。 */
function mergeParsed(parsed: ParsedHomeworkPlan[]) {
  for (const p of parsed) {
    const editable = parsedToEditable(p)
    if (p.date === planDate.value) {
      const idx = plans.value.findIndex((x) => x.subject === p.subject)
      if (idx >= 0) plans.value[idx] = editable
      else plans.value.push(editable)
    } else {
      if (!parsedCache[p.date]) parsedCache[p.date] = []
      const cache = parsedCache[p.date]
      const idx = cache.findIndex((x) => x.subject === p.subject)
      if (idx >= 0) cache[idx] = editable
      else cache.push(editable)
    }
  }
}

async function runParse() {
  if (parseBusy.value) return
  const text = parseText.value.trim()
  if (!text) {
    ui.toast('先粘贴老师发的作业内容')
    return
  }
  parseBusy.value = true
  parseResult.value = ''
  let parsed: ParsedHomeworkPlan[] | null = null
  let source = '规则'
  // AI 优先：家长已开启并配置好才试，失败静默落到规则兜底
  if (data.settings?.ai?.enabled) {
    try {
      let buf = ''
      await streamAi('homework-parse', { text, defaultDate: planDate.value }, (d) => {
        buf += d
      })
      const json = extractJsonFromAi(buf)
      if (json) {
        parsed = normalizeParsedPlans(json, planDate.value)
        source = 'AI'
      }
    } catch {
      parsed = null
    }
  }
  if (!parsed) parsed = parseHomeworkText(text, planDate.value)
  if (!parsed.length) {
    parseResult.value = '没解析出作业项，检查一下粘贴的内容'
    parseBusy.value = false
    return
  }
  mergeParsed(parsed)
  parseText.value = ''
  const summary = parsed.map((p) => `${p.subject}（${p.date}）`).join('、')
  parseResult.value = `用${source}解析出 ${parsed.length} 份：${summary}。已按各自日期填入，逐天确认保存。`
  parseBusy.value = false
  ui.toast(`已填入 ${parsed.length} 份作业`)
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

      <!-- AI 一键解析 -->
      <div class="card card--pad">
        <h2 class="section-title" style="font-size: 17px">📋 粘贴老师发的作业，AI 一键解析</h2>
        <p class="hint mt-8">把班级群里的整段通知贴进来，自动按科目拆成一份份作业；可逐天确认保存。</p>
        <textarea
          v-model="parseText"
          class="input mt-16"
          rows="5"
          placeholder="例如：10.29数学学习建议：1. 检查书本P39页…（支持多科目、日期、温馨提示）"
        ></textarea>
        <div class="row mt-16">
          <button class="btn btn--small" :disabled="parseBusy" @click="runParse">
            {{ parseBusy ? '解析中…' : '✨ AI 一键解析并填入' }}
          </button>
          <span class="grow"></span>
        </div>
        <p v-if="parseResult" class="hint mt-8">{{ parseResult }}</p>
        <p class="hint mt-8">优先用大模型解析（需在「AI 设置」开启）；未配置或失败时用本地规则按科目拆分。</p>
      </div>

      <div class="card card--pad">
        <div class="row row--between row--wrap">
          <div>
            <h2 class="section-title" style="font-size: 17px">这是哪天的作业？</h2>
            <p class="hint mt-8">支持今天前后 7 天（老师发的通知可能含前几天作业）；同一天可录多个科目，按科目分组保存。</p>
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
            <input v-model="planDate" class="input date-input" type="date" :min="minDate" :max="maxDate" />
          </div>
        </div>
      </div>

      <!-- 科目计划编辑器（一天多份） -->
      <div class="card card--pad">
        <div class="row row--between">
          <label class="label" style="margin: 0">作业清单（{{ plans.length }} 份）</label>
          <button class="btn btn--small" @click="addSubjectPlan">+ 加一科</button>
        </div>

        <div v-if="plans.length" class="stack mt-16 plan-list">
          <div v-for="(plan, pi) in plans" :key="plan.key" class="plan-card">
            <div class="row plan-card__head">
              <input
                v-model="plan.subject"
                class="input subject-input"
                placeholder="科目（如 数学）"
                maxlength="20"
              />
              <input
                v-model="plan.title"
                class="input grow"
                placeholder="作业名称（如 数学作业）"
                maxlength="80"
              />
              <button class="btn btn--ghost btn--small" style="color: var(--rose-deep)" @click="removePlan(plan)">
                删这科
              </button>
            </div>

            <div class="stack mt-8" style="gap: 8px">
              <div v-for="(item, i) in plan.items" :key="item.id" class="row plan-editor__row">
                <span class="pill pill--mint">{{ i + 1 }}</span>
                <select
                  v-model="item.icon"
                  class="icon-select"
                  title="科目图标（自动识别，可改）"
                  @change="markManualIcon(item.id)"
                >
                  <option v-for="s in SUBJECT_ICONS" :key="s.icon" :value="s.icon">{{ s.icon }} {{ s.name }}</option>
                  <option value="📌">📌 其他</option>
                </select>
                <input
                  v-model="item.title"
                  class="input grow"
                  maxlength="60"
                  placeholder="例如：数学口算第 1~20 题"
                  @input="onTitleChange(item)"
                />
                <button class="btn btn--ghost btn--small" @click="removeItem(plan, item.id)">删</button>
              </div>
            </div>
            <p v-if="!plan.items.length" class="hint mt-8">这科还没有清单项，点「+ 加一项」。</p>

            <button class="btn btn--small mt-8" :disabled="plan.items.length >= 12" @click="addItem(plan)">
              + 加一项
            </button>
          </div>
        </div>
        <p v-else class="hint mt-8">还没有清单，先「+ 加一科」或在上方用 AI 一键解析。</p>

        <div class="row mt-16">
          <span class="grow"></span>
          <button class="btn btn--primary" :disabled="saving" @click="save">
            {{ saving ? '保存中…' : '保存清单' }}
          </button>
        </div>
        <p v-if="error" class="hint mt-8" style="color: var(--rose-deep)">{{ error }}</p>
        <p class="hint mt-8">
          孩子开始后清单会锁定并复制到会话里；之后再改这里，只影响下一次开始，不会改动正在写或已完成的会话。
        </p>
      </div>

      <div v-if="isToday && todayPlanList.length" class="card card--pad" :class="{ 'card--mint': status === 'pass' }">
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
            <span class="pill pill--mint">{{ plan.subject || '作业' }}</span>
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

.plan-list {
  gap: 14px;
}

.plan-card {
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 12px 14px;
  background: var(--cream);
}

.plan-card__head {
  gap: 8px;
}

.subject-input {
  max-width: 120px;
}

.plan-editor__row {
  gap: 8px;
}

.icon-select {
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fff;
  font-family: inherit;
  font-size: 13px;
  padding: 6px 4px;
  max-width: 96px;
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
