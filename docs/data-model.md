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
  schemaVersion: number          // 当前 6
  meta: { createdAt: number; updatedAt: number }
  family: FamilyRecord | null    // 单家庭
  profiles: ProfileRecord[]
  records: TrainingRecord[]
  homework: HomeworkSession[]
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
| `limits` | 完整 | 完整（防沉迷守卫需要） |
| `settings` | 脱敏后完整返回 | `null` |

`ProfilePublic` 不含 `pinHash`；`Settings.ai` 不含 `apiKey`，只含 `apiKeyMasked`。

## TrainingRecord

```ts
{
  id: string                  // rec_<ts>_<rand>，全局唯一
  profileId: string
  module: 'pomodoro' | 'stroop' | 'capture' | 'nback' | 'switch' | 'tracking'
  startedAt: number
  endedAt: number
  durationSec: number
  difficulty: number          // 1=基础；N-Back 为 N（当前 2）
  accuracy: number            // 0~1
  avgReactionMs: number       // 0 表示该模块不统计反应时
  score: number               // 0~100，由维度分平均
  totalTrials: number
  correctTrials: number
  errors: { type: string; count: number }[]
  dimensionScores: Partial<Record<AttentionDimension, number>>  // 每项 0~100，服务端裁剪
  passed?: boolean            // 仅 pomodoro：结算时清单是否全部完成
  updatedAt: number
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
  taskTitle: string
  items: {                      // 作业清单，逐项手动勾选；开始后锁定，只允许改 done / doneAt
    id: string
    title: string
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
  }
  limits: {
    dailyTrainingMinutes: number   // 默认 40
    sessionMinutes: number         // 默认 15
    breakMinutes: number           // 默认 3
    dailyBadgeLimit: number        // 默认 5
    blockedRanges: { start: string; end: string; label: string }[]  // 支持跨午夜
    homeworkExempt: boolean        // 默认 true
  }
  updatedAt: number
}
```

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
- 作业会话的清单锁定：会话首次落库后，服务端只接受 `items[].done` / `doneAt` 变化，增删项与改标题一律忽略（以已存清单为准，避免中途缩小清单篡改正/负判定）；`status = done` 后连 `done` 也冻结，判定与派生记录不再变化
- 服务端不信任客户端传入的 `profileId`（孩子身份强制为自己）
- 客户端不得直接上报 `module: pomodoro` 的记录（派生记录只能由服务端生成）
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
}
```

3→4 迁移调用 `server/records.ts` 的 `syncHomeworkRecords()`，为每个 `status: 'done'` 的会话补一条 `module: 'pomodoro'` 记录。迁移前后积分总额不变（原先按会话 +20 的部分转移到记录上），但「番茄钟」模块次数与相关徽章从此可达。

4→5 迁移为历史数据回填 `passed` / `verdict`：升级前已完成的会话一律记为 `pass`（维持旧积分，不追溯扣分），已有派生记录回填 `passed: true`。新会话由服务端按清单完成情况判定。

5→6 只是给家长账号增加可选的 `recoveryHash` / `recoveryUpdatedAt`，历史数据一个字段都不改。升级后旧账号没有恢复码，家长可在「账号」页生成；忘记密码时也可用 `npm run reset:password` 重置（会清空恢复码并踢掉家长会话）。

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
