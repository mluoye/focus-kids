# 数据模型

## 存储位置

- 默认：`./.data/app-state.json`（开发）
- 容器：`/data/app-state.json`（命名卷 `focus-kids-data`）
- 通过 `DATA_FILE` 覆盖

整个家庭的数据保存在 **一个 JSON 文件** 中，写入采用「临时文件 + rename」的原子方式，并通过串行写队列避免并发覆盖；失败会重试 3 次并暴露到 `/api/health`。

文件损坏、写盘失败、本地缓存与离线队列的完整处置见 [persistence.md](persistence.md)。

## 顶层结构（服务端 `AppState`）

```ts
interface AppState {
  schemaVersion: number          // 当前 18
  meta: { createdAt: number; updatedAt: number }
  family: FamilyRecord | null    // 单家庭
  profiles: ProfileRecord[]
  records: TrainingRecord[]
  homework: HomeworkSession[]
  homeworkPlans: HomeworkPlan[]  // 家长提前录入的作业清单
  settings: Settings
  sessions: StoredSession[]      // 服务端专用，绝不下发
}
```

### FamilyRecord（服务端专用）

```ts
{
  id: string
  username: string
  passwordHash: string   // "scrypt$<salt>$<hash>"
  recoveryHash?: string  // 恢复码的 scrypt 哈希（去分隔符的大写形式）；0.4.0 新增
  recoveryUpdatedAt?: number // 最近一次生成/更换恢复码的时间
  childPinLength: 4
  createdAt: number
}
```

恢复码与密码一样**只存哈希**，明文只在创建账号 / 重新生成时返回一次。旧账号升级后 `recoveryHash` 为空，需在「账号」页生成。

会话：家长会话签发后 30 天有效；临时解锁 15 分钟。`POST /auth/recover` 与「修改密码」会删除所有 `role: 'parent'` 的会话（修改密码保留当前 token），孩子会话不动。

### ProfileRecord

```ts
{
  id: string
  name: string
  avatar: string          // emoji
  pinHash: string         // scrypt，孩子 4 位 PIN
  createdAt: number
  points: number          // 由记录推导，见下
  badges: { id: string; unlockedAt: number }[]
  /** 每个孩子的朗读偏好（0.13.0 / schema 14）；缺省时用默认顺序与默认音色 */
  ttsPrefs?: {
    order: ('native' | 'edge' | 'openai')[]  // 只会从家长 enabled 里取；空数组 = 用默认次序 ∩ enabled
    voice: { edge?: string; openai?: string } // 孩子选的音色；缺省回落内置默认
  }
  /** 口算速算作答方式（0.14.0 / schema 16）；缺省 'choice'（选项四选一） */
  arithmeticMode?: 'choice' | 'keypad'
  /** 口算速算默认难度（0.14.0 / schema 17）；缺省 1（20 以内加减）。孩子每次进入仍可临时切换 */
  arithmeticDifficulty?: 1 | 2 | 3
  /** AI 应用题默认年级（0.15.0 / schema 18）；缺省 1（一年级）。孩子每次进入仍可临时切换 */
  storymathGrade?: 1 | 2 | 3 | 4 | 5 | 6
}
```

### StoredSession（服务端专用）

```ts
{ token: string; role: 'parent' | 'child'; profileId?: string; createdAt: number; expiresAt: number }
```

## 客户端快照 `StateSnapshot`

`GET /api/state` 返回的快照按角色裁剪：

| 字段 | 家长 | 孩子 |
| --- | --- | --- |
| `family` | 含 `username` | `username` 为空 |
| `profiles` | 全部孩子 | 仅自己 |
| `records` | 全部 | 仅自己 |
| `homework` | 全部 | 仅自己 |
| `homeworkPlans` | 全部（含已归档） | 仅自己、未归档、今天前后各一天 |
| `limits` | 完整 | 完整（防沉迷守卫需要） |
| `ttsPlan` | `{ enabled, order, voice, voices }` | `{ enabled, order, voice, voices }`（朗读链路在客户端推进，孩子端要知道顺序与音色；不含任何密钥） |
| `settings` | 脱敏后完整返回 | `null` |

`ProfilePublic` 不含 `pinHash`；`Settings.ai` 不含 `apiKey`，只含 `apiKeyMasked`。`ProfilePublic` 含 `arithmeticMode`（缺省 `choice`）、`arithmeticDifficulty`（缺省 1）与 `storymathGrade`（缺省 1），供家长端回显与孩子端选择作答 UI / 默认难度。

## TrainingRecord

```ts
{
  id: string                  // rec_<ts>_<rand>，全局唯一
  profileId: string
  module: 'pomodoro' | 'stroop' | 'capture' | 'nback' | 'switch' | 'tracking' | 'arithmetic' | 'storymath'
  startedAt: number
  endedAt: number
  durationSec: number
  difficulty: number          // 1=基础；N-Back 为 N（当前 2）；arithmetic 为 1~3；storymath 为 1~6（年级）
  accuracy: number            // 0~1
  avgReactionMs: number       // 0 表示该模块不统计反应时
  score: number               // 0~100，由维度分平均
  totalTrials: number
  correctTrials: number
  errors: { type: string; count: number }[]
  dimensionScores: Partial<Record<AttentionDimension, number>>  // 每项 0~100，服务端裁剪
  passed?: boolean            // 仅 pomodoro：结算时清单是否全部完成
  storymathDetail?: StoryMathDetail[]  // 仅 storymath：主轮 + 专项轮逐题结果（0.16.0 新增）
  updatedAt: number
}
```

`StoryMathDetail`（0.16.0 新增，随 `storymath` 记录持久化，供家长端回看）：

```ts
{
  total: number               // 本轮实际题数
  correct: number             // 本轮答对数（以 AI 判卷结果为准）
  round: 'main' | 'remedial'  // main 主轮 / remedial 专项训练轮
  items: {
    text: string
    submitted: number         // 孩子最终提交的答案（拍照题取识别确认后的值）
    answer: number            // 服务端判定标准答案
    correct: boolean
    unit: string
    mode: 'keypad' | 'photo'  // 作答方式：直接输入 / 拍照识别
    knowledgePoint: string
    errorStep?: string        // 错在哪个步骤（全对无）
    solution?: string         // 分步解题思路
  }[]
}
```

记录有两个来源：

1. **五个训练小游戏**：客户端在 `TrainPlayView` 组装并 `POST /api/state/records`，`id` 形如 `rec_<ts>_<rand>`。
2. **作业番茄钟**：由服务端在会话变为 `done` 时派生，`id = rec_hw_<会话id>`、`module = pomodoro`。客户端**不**提交这类记录（服务端会丢弃），重复同步同一个会话不会产生第二条。派生规则与正/负判定见 [training-specs.md](training-specs.md#-作业番茄钟-pomodoro)。

`AttentionDimension`：

| key | 名称 |
| --- | --- |
| `sustained` | 持续注意力 |
| `selective` | 选择性注意力 |
| `switching` | 转换注意力 |
| `divided` | 分配注意力 |
| `workingMemory` | 工作记忆 |
| `inhibition` | 冲动抑制 |

## HomeworkSession

```ts
{
  id: string
  profileId: string
  planId?: string               // 从哪份家长计划开始；自建清单为空（0.5.0 新增）
  taskTitle: string
  items: {                      // 作业清单，逐项手动勾选；开始后锁定，只允许改 done / doneAt
    id: string
    title: string
    icon?: string               // 科目 emoji（0.7.0 新增，可选）；前端按标题自动识别
    subject?: string            // 所属科目，孩子端把当天多份家长计划合并成一份清单时写入，用于分科目小节（0.10.0 新增，可选）
    done: boolean
    doneAt?: number
  }[]
  plannedFocusMinutes: number   // 5~60，常用 20 / 25 / 30
  rounds: {
    index: number
    focusMinutes: number
    breakMinutes: number
    startedAt: number
    endedAt: number
    selfChecks: boolean[]       // 4 项自检
  }[]
  status: 'running' | 'done' | 'abandoned'
  /** 仅 status=done：结算时清单是否全部完成 */
  verdict?: 'pass' | 'fail'
  verdictAt?: number
  /** 仅 status=running 时存在：离开页面后的恢复状态 */
  progress?: {
    step: 'setup' | 'warmup' | 'focus' | 'check' | 'break'
    focusLeftSec: number          // 暂停时的剩余秒数
    breakLeftSec: number
    warmupLeftSec: number
    roundIndex: number            // 当前第几轮
    roundStartedAt: number
    checks: boolean[]             // 本轮 4 项自检
    paused: boolean
  }
  startedAt: number
  endedAt: number | null
  updatedAt: number
}
```

允许部分完成：`items` 里可以有 `done: false` 的项，会话仍可记为 `done`，但会判为「负」，派生记录只给 10 分；全部完成才是「正」20 分。`schemaVersion` 1→2 迁移会把旧的 `subtasks: string[]` 转成 `items`（`done: false`）；2→3 只是允许会话携带可选的 `progress`，旧数据保持 `undefined`；3→4 给所有已完成的会话补派生番茄钟记录；4→5 为番茄钟引入正/负判定，历史会话按旧规则记为 `pass`（不追溯扣分）。

### 进行中会话的生命周期

- 开始、暂停、勾选清单（5 秒节流）、离开页面都会上报 `status: 'running'` 的会话，完成时上报 `done`；服务端按 `updatedAt` 做 LWW。
- 孩子端同时在 `localStorage` 的 `fk.homeworkDraft.<profileId>` 保存草稿，切页、刷新、关标签页都能恢复；关标签页时还会用 `keepalive` 补一笔「已暂停」。恢复后默认暂停，点「继续」才继续倒计时。
- `status: 'running'` 超过 **2 小时**没有更新会被判定为过期：`GET /api/state` 时自动改成 `abandoned` 并清掉 `progress`，孩子下次进入作业页会提示重新开始。
- 家长端总览据此展示「正在写作业」卡片（清单完成数、轮次、已专注分钟）。

## HomeworkPlan

家长提前录入的作业清单，与 `HomeworkSession` 独立保存：

```ts
{
  id: string                    // hp_<ts>_<rand>
  profileId: string
  planDate: string              // YYYY-MM-DD，客户端按家庭本地时区生成
  subject?: string              // 科目名（如 数学/语文/英语），一天多份计划分组；空视为未分类单份（0.10.0 新增，可选）
  title: string
  items: { id: string; title: string; icon?: string }[]   // 1~12 项，标题最多 60 字；icon 为科目 emoji（0.7.0 新增，可选）
  createdBy: 'parent'
  createdAt: number
  updatedAt: number
  archivedAt?: number           // 软删除；孩子端不再下发
}
```

- **一天多份**：按 `profileId + planDate + subject` upsert，同一科目重复保存覆盖，不同科目并存（`subject` 为空时保持「一天一份」的旧行为）。孩子端把当天多份合并成一份清单，按科目分小节展示，统一进度与判定（会话项 `HomeworkItem.subject` 标记所属科目，可选）。
- **可改可删**：计划本身不影响已经存在的会话；孩子开始时把清单**复制**到会话并写入 `planId`，此后清单按会话的锁定规则冻结。计划在运行中被修改，不会回写会话。
- **删除**：`DELETE` 只写 `archivedAt`，历史会话的 `planId` 仍可追溯；孩子端与家长「已录清单」列表都不再展示。
- **保留期**：保存计划时清理 `planDate` 早于 60 天的记录；会话已复制清单，清理不会丢作业结果。
- **日期口径**：`planDate` 只由客户端生成，服务端校验 `YYYY-MM-DD` 格式与前后 30 天范围，不自行推断「今天」。因此 Docker 默认 UTC 不会导致跨日错位。
- **家长智能解析**：`POST /api/ai/homework-parse` 把老师通知拆成多份科目计划（含内嵌日期、温馨提示），家长确认后逐科保存；本地规则 `src/utils/homeworkParse.ts` 兜底。

## Settings

```ts
{
  ai: {
    enabled: boolean
    baseUrl: string
    model: string
    temperature: number
    apiKey?: string         // 仅写入；读取被替换为 apiKeyMasked
    apiKeyMasked?: string
    vision: {               // 拍照识题视觉子配置（0.11.0 / schema 12）
      baseUrl: string       // 留空继承对话 baseUrl
      model: string         // 留空 = 未配置，拍题禁用（不再回退对话 model）
      apiKey?: string       // 仅写入；留空继承对话 key
      apiKeyMasked?: string
    }
    /** @deprecated 0.10.x 扁平字段，已迁入 vision.model；保留一个版本供旧客户端读取 */
    visionModel?: string
  }
  limits: {
    dailyTrainingMinutes: number   // 默认 40
    sessionMinutes: number         // 默认 15
    breakMinutes: number           // 默认 3
    dailyBadgeLimit: number        // 默认 5
    blockedRanges: { start: string; end: string; label: string }[]  // 支持跨午夜
    homeworkExempt: boolean        // 默认 true
  }
  tts: {                           // 朗读来源（0.13.0 / schema 14）
    enabled: ('native' | 'edge' | 'openai')[]  // 家长启用的来源，有序去重；未验证的后端来源不允许启用
    verified: {                    // 试听通过的来源 + 当时连接配置的指纹（native 不在此列；指纹不绑音色）
      edge?: { at: number; fingerprint: string }
      openai?: { at: number; fingerprint: string }
    }
    lastFailure: { source: 'edge' | 'openai'; at: number; message: string } | null
    /** @deprecated 0.13.0 起顺序由孩子 prefs.order 决定；保留一个版本供旧客户端回读 */
    priority?: ('native' | 'edge' | 'openai')[]
    /** @deprecated 0.13.0 起 edge 音色由孩子 prefs.voice.edge 决定；保留一个版本供旧客户端回读 */
    voice?: string
    /** @deprecated 0.12.0 起由 enabled 取代；保留一个版本供旧客户端回读 */
    provider?: 'edge' | 'openai'
    openai: {
      baseUrl: string
      model: string
      /** 家长配置的连接默认音色（0.13.0 / schema 15，可选）；未知厂商必填，已知厂商留空用内置默认 */
      defaultVoice?: string
      /** @deprecated 0.13.0 起音色由孩子 prefs.voice.openai 决定 */
      voice?: string
      apiKey?: string              // 仅写入；读取被替换为 apiKeyMasked
      apiKeyMasked?: string
    }
  }
  updatedAt: number
}
```

`verified` 的指纹**只绑连接不绑音色**（0.13.0）：edge 为常量指纹（试听通过即长期有效），openai 覆盖 baseUrl / model / apiKey。任何一项变了，指纹就对不上，服务端在 `sanitizeSettings` 里把它过滤掉（库里仍保留原记录，改回原配置会自动复活），家长端因此看到「未试听」。改音色不会导致验证失效。

## 积分与徽章（服务端推导）

**积分**：完全由 `records` 推导，重复同步幂等。作业的 20 分不再单独按会话累加，而是体现在服务端派生的 `rec_hw_<会话id>` 记录上。

```
points = Σ(每条记录的模块基础分)
模块基础分：nback 10 / tracking 10 / stroop 8 / capture 8 / switch 8
番茄钟：正 20 / 负 10（见 training-specs）
```

**六维均值**：取最近 `DIMENSION_WINDOW`（当前 10）条记录的 `dimensionScores` 分维度平均。前端雷达、家长总览、孩子首页、AI 摘要与服务端徽章共用同一个常量。

**连续天数**：从今天（若今天没练则从昨天）向前连续有记录的天数，最多回看 60 天。

**徽章**：条件见 `shared/constants.ts` 的 `BADGES`；服务端 `evaluateBadges` 判定，并执行 `dailyBadgeLimit`。

## 合并规则

- 记录与作业会话：按 `id` 去重，`updatedAt` 大者保留
- 作业计划：`PUT /api/state/homework-plan` 按 `profileId + planDate` upsert；同一份计划重新保存会清掉 `archivedAt`，视为恢复
- 作业会话的清单锁定：会话首次落库后，服务端只接受 `items[].done` / `doneAt` 变化，增删项与改标题一律忽略（以已存清单为准，避免中途缩小清单篡改正/负判定）；`status = done` 后连 `done` 也冻结，判定与派生记录不再变化
- `planId` 只在会话首次落库时校验：必须指向同一孩子的既有计划，之后不允许改写；计划被删后会话保留 `planId`
- 服务端不信任客户端传入的 `profileId`（孩子身份强制为自己）
- 客户端不得直接上报 `module: pomodoro` 的记录（派生记录只能由服务端生成）
- 作业计划只能由家长写入；孩子端只读，写接口返回 `403 FORBIDDEN`
- 数值裁剪：`accuracy` 0~1、`score` 0~100、`dimensionScores` 每项 0~100（未知维度丢弃）、数组长度限制
- 合并后重算 `points` 并重新判定徽章

## 版本迁移

`server/store.ts` 的迁移表按 `旧版本号 → 新结构` 逐级执行，**每一级都必须有函数**：

```ts
const migrations: Record<number, (s: any) => any> = {
  0: () => emptyState(),                       // 0 -> 1：初始结构
  1: (s) => ({ ...s, schemaVersion: 2, ... }), // 1 -> 2：subtasks → items
  2: (s) => ({ ...s, schemaVersion: 3 }),      // 2 -> 3：作业会话支持 progress
  3: (s) => { /* 3 -> 4：为已完成会话补 rec_hw_<会话id> 番茄钟记录 */ },
  4: (s) => { /* 4 -> 5：番茄钟引入正/负判定，历史会话回填 verdict: 'pass' */ },
  5: (s) => ({ ...s, schemaVersion: 6 }),      // 5 -> 6：家长账号支持恢复码（旧账号留空）
  6: (s) => ({ ...s, schemaVersion: 7, homeworkPlans: [] }), // 6 -> 7：家长预录作业清单
  7: (s) => ({ ...s, schemaVersion: 8 }),                    // 7 -> 8：清单项可选 icon，历史数据不改写
  8: (s) => ({ ...s, schemaVersion: 9 }),                    // 8 -> 9：settings 新增 tts 配置块
  9: (s) => ({ ...s, schemaVersion: 10 }),                   // 9 -> 10：settings.ai 新增可选 visionModel
  10: (s) => ({ ...s, schemaVersion: 11 }),                  // 10 -> 11：作业计划支持一天多份（可选 subject）
  11: (s) => ({ ...s, schemaVersion: 12, /* visionModel → vision.model */ }), // 11 -> 12：视觉模型独立配置块
  12: (s) => ({ ...s, schemaVersion: 13, /* provider → priority + verified */ }), // 12 -> 13：朗读来源优先级
  13: (s) => ({ ...s, schemaVersion: 14, /* priority → enabled + 孩子 ttsPrefs */ }), // 13 -> 14：顺序/音色移到孩子端
  14: (s) => ({ ...s, schemaVersion: 15, /* openai.defaultVoice */ }), // 14 -> 15：未知厂商默认音色
  15: (s) => ({ ...s, schemaVersion: 16, /* 孩子 arithmeticMode */ }), // 15 -> 16：口算作答方式
  16: (s) => ({ ...s, schemaVersion: 17, /* 孩子 arithmeticDifficulty */ }), // 16 -> 17：口算默认难度
  17: (s) => ({ ...s, schemaVersion: 18, /* 孩子 storymathGrade */ }), // 17 -> 18：应用题默认年级
  18: (s) => ({ ...s, schemaVersion: 19 }), // 18 -> 19：训练记录 storymathDetail 可选字段
}
```

3→4 迁移调用 `server/records.ts` 的 `syncHomeworkRecords()`，为每个 `status: 'done'` 的会话补一条 `module: 'pomodoro'` 记录。迁移前后积分总额不变（原先按会话 +20 的部分转移到记录上），但「番茄钟」模块次数与相关徽章从此可达。

4→5 迁移为历史数据回填 `passed` / `verdict`：升级前已完成的会话一律记为 `pass`（维持旧积分，不追溯扣分），已有派生记录回填 `passed: true`。新会话由服务端按清单完成情况判定。

5→6 只是给家长账号增加可选的 `recoveryHash` / `recoveryUpdatedAt`，历史数据一个字段都不改。升级后旧账号没有恢复码，家长可在「账号」页生成；忘记密码时也可用 `npm run reset:password` 重置（会清空恢复码并踢掉家长会话）。

6→7 新增顶层 `homeworkPlans: []`，历史数据一个字段都不改。旧会话没有 `planId`，继续按「孩子自建清单」处理，判定与积分口径不变；回退到 6 时 `homeworkPlans` 会被旧代码忽略，不会影响历史会话。

7→8 清单项新增可选 `icon`（科目 emoji），历史清单没有该字段，前端按标题自动识别；会话/计划项都不需要改写。回退到 7 时 `icon` 被旧代码忽略，不影响判定。

8→9 `settings` 新增可选 `tts` 配置块（朗读合成服务：`provider`、`voice`、`openai`），历史数据没有该字段，`normalize` 用默认值补齐（`provider: 'edge'`）。回退到 8 时 `tts` 被旧代码忽略，不影响任何判定。

9→10 `settings.ai` 新增可选 `visionModel`（拍照识题视觉模型），历史数据没有该字段，`normalize` 用默认空字符串补齐；带图请求优先用它，留空回退 `model`。回退到 9 时 `visionModel` 被旧代码忽略，不影响判定。

10→11 作业计划支持一天多份：`HomeworkPlan` 新增可选 `subject`（科目名），历史单份计划没有该字段，按「未分类」处理；upsert 键由 `profileId + planDate` 扩展为 `profileId + planDate + subject`。历史数据无需改写，回退到 10 时 `subject` 被旧代码忽略（同一天多份会合并显示为最新一份，判定与积分口径不变）。

11→12 视觉模型独立配置：`settings.ai.visionModel`（扁平字符串）迁入 `settings.ai.vision.model`；`vision.baseUrl` / `vision.apiKey` 留空表示按字段继承对话配置。旧 `visionModel` 字段保留在数据中（类型标 `@deprecated`）供回退读取，新代码只读写 `vision` 子块。带图请求不再回退对话 `model`：`vision.model` 为空时返回 `400 VISION_NOT_CONFIGURED`。环境变量 `AI_VISION_BASE_URL` / `AI_VISION_MODEL` / `AI_VISION_API_KEY` 优先级最高。

12→13 朗读从「单一合成服务」升级为「家长可编排的来源优先级」。旧 `tts.provider` 转成 `priority = ['native', 原 provider]`（与升级前「原生优先、后端兜底」等价）；只有**升级前确实保存过该来源配置**（edge 有 `voice`、或 openai 三项齐全）才按当时配置写 `verified`，从未配过朗读的家庭不写任何验证记录——它们本来就没走过后端合成，不能凭空"已验证"。`provider` 旧字段保留在数据中（`@deprecated`）供回退读取，新代码只回读不写入。新增字段 `priority` / `verified` / `lastFailure` 回退到 12 时会被旧代码忽略，判定与积分口径不变。

13→14 朗读职责拆分：家长只管「是否启用」，顺序与音色全部移到孩子端。旧 `tts.priority` 照抄为 `tts.enabled`；每个 profile 写入 `ttsPrefs = { order: 旧 priority, voice: { edge: 旧 voice, openai: 旧 openai.voice } }`，升级后孩子听到的顺序与音色与升级前一致。`verified` 按新指纹算法（去音色）重算：edge 指纹变为常量，openai 指纹只含 baseUrl|model|apiKey——升级后无需被迫重新试听；空指纹不复活。`priority` / `voice` / `openai.voice` / `provider` 旧字段保留在数据中（`@deprecated`）供回退读取；回退到 13 时 `enabled` / `ttsPrefs` 会被旧代码忽略，判定与积分口径不变。

14→15 未知厂商默认音色：`settings.tts.openai` 新增可选 `defaultVoice`（家长配置的连接默认音色）。内置音色清单只覆盖 SiliconFlow / OpenAI 官方；其余厂商必须填一个它认得的音色，否则试听与合成返回 `400 TTS_VOICE_NOT_SET`。旧数据无此字段，normalize 补空串；已知厂商不受影响，仍用内置默认。回退到 14 时 `defaultVoice` 被旧代码忽略，判定与积分口径不变。

15→16 口算作答方式：每个 `ProfileRecord` 新增可选 `arithmeticMode`（`'choice' | 'keypad'`），缺省 `choice`（选项四选一，低年级友好）。旧数据无此字段，各孩子补默认 `choice`；家长可在档案编辑里随时改，孩子端据此选作答 UI。回退到 15 时该字段被旧代码忽略，不影响判定与积分。

16→17 口算默认难度：每个 `ProfileRecord` 新增可选 `arithmeticDifficulty`（`1 | 2 | 3`），缺省 `1`（20 以内加减）。旧数据无此字段，各孩子补默认 `1`；家长可在档案编辑里设默认档，孩子每次进入仍可临时切换，训练记录保存本次实际难度。回退到 16 时该字段被旧代码忽略，不影响判定与积分。

17→18 应用题默认年级：每个 `ProfileRecord` 新增可选 `storymathGrade`（`1 | 2 | 3 | 4 | 5 | 6`），缺省 `1`（一年级）。旧数据无此字段，各孩子补默认 `1`；家长可在档案编辑里设默认档，孩子每次进入仍可临时切换，训练记录保存本次实际年级。回退到 17 时该字段被旧代码忽略，不影响判定与积分。

18→19 应用题逐题明细：`TrainingRecord` 新增可选 `storymathDetail`（`StoryMathDetail[]`，仅 `module = storymath` 的记录有值），随记录持久化主轮 + 专项轮逐题结果（提交值 / 标准答案 / 对错 / 错因 / 思路 / 知识点 / 作答方式），供家长端回看。旧记录无此字段，保持 `undefined`，无数据改写；回退到 18 时该字段被旧代码忽略，不影响判定与积分。

**规则**：任何破坏性结构变更必须

1. `bump SCHEMA_VERSION`（`shared/constants.ts`）
2. 在 `migrations` 增加 `旧版本号 -> 新结构` 的转换函数
3. 同步更新本文档与 `CHANGELOG.md`
4. 升级前备份数据卷

迁移失败时服务端不会用空状态覆盖原文件，而是把原文件改名保留为 `app-state.json.corrupt-<时间戳>`，详见 [persistence.md](persistence.md)。

## 备份与恢复

```bash
# 备份
docker run --rm -v focus-kids-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/focus-kids-backup.tar.gz -C /data .

# 恢复
docker run --rm -v focus-kids-data:/data -v "$PWD":/backup alpine \
  sh -c "rm -f /data/app-state.json && tar xzf /backup/focus-kids-backup.tar.gz -C /data"
```
