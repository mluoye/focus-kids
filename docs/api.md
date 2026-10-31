# 接口文档

基础路径：`/api`。除标注「公开」外均需请求头：

```
Authorization: Bearer <token>
```

统一错误格式：

```json
{ "error": "人类可读的中文提示", "code": "MACHINE_CODE" }
```

常见状态码：`400` 参数错误、`401` 未登录/口令错误、`403` 需要家长身份、`404` 资源不存在、`409` 家庭已存在、`413` 请求体过大、`429` 尝试过于频繁、`501` 未实现、`502/503` AI 上游或未配置。

### 认证限流

`/api/auth/login`、`/register`、`/child/login`、`/parent/verify`、`/parent/check` 共用同一 IP 计数桶：**每 IP 每分钟最多 15 次**，超出返回：

```json
{ "error": "尝试次数太多，请一分钟后再试", "code": "RATE_LIMITED" }
```


---

## 健康检查

### GET /api/health（公开）

```json
{
  "ok": true,
  "version": "0.5.0",
  "schemaVersion": 7,
  "hasFamily": true,
  "profiles": 1,
  "records": 24,
  "aiEnabled": true,
  "dataFile": "./.data/app-state.json",
  "storage": {
    "ok": true,
    "lastWriteAt": 1790000000000,
    "lastWriteError": null,
    "lastLoadError": null,
    "corruptBackup": null
  },
  "uptimeSec": 128
}
```

- `dataFile` / `storage.corruptBackup` 仅在非生产环境返回。
- `storage.ok = false` 表示最近一次写盘失败（重试 3 次后仍失败）；此时所有响应都会带 `x-storage-health: degraded`。
- 数据损坏时的备份文件与恢复步骤见 [persistence.md](persistence.md)。

---

## 认证 `/api/auth`

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/bootstrap` | 公开 | 是否已创建家庭、版本号 |
| POST | `/register` | 公开 | 创建家长账号（仅首次），返回一次性恢复码 |
| POST | `/login` | 公开 | 家长登录 |
| POST | `/recover` | 公开（限流） | 凭恢复码重置密码并登录，不需要账号名 |
| POST | `/child/login` | 公开 | 孩子头像 + PIN 登录 |
| POST | `/parent/verify` | 公开 | 家长临时解锁，签发 15 分钟家长会话 |
| POST | `/parent/check` | 公开 | 仅校验家长密码，不签发会话 |
| POST | `/parent/password` | 家长 | 修改密码（需当前密码） |
| POST | `/parent/username` | 家长 | 修改账号名（需当前密码） |
| POST | `/parent/recovery` | 家长 | 重新生成恢复码（需当前密码） |
| GET | `/me` | 登录 | 当前身份与恢复码状态 |
| POST | `/logout` | 登录 | 注销当前 token |

### GET /bootstrap

```json
{ "hasFamily": true, "version": "0.5.0", "schemaVersion": 7, "serverTime": 1790000000000 }
```

### POST /register

```json
{ "username": "mama123", "password": "secret123" }
```

- `username` 3~20 字符，`password` ≥ 6 位
- 已存在家庭时返回 `409 FAMILY_EXISTS`
- 响应里的 `recoveryCode` **只返回这一次**，服务端只存 scrypt 哈希；家长必须自行抄写

响应：

```json
{
  "token": "…",
  "role": "parent",
  "expiresAt": 1792600000000,
  "username": "mama123",
  "recoveryCode": "K7QM-3XPD-9RTV-2W8F"
}
```

### POST /login

请求同上，失败返回 `401 INVALID_CREDENTIALS`，成功响应同注册（不含 `recoveryCode`）。

### POST /recover

忘记密码时使用，不需要账号名：

```json
{ "recoveryCode": "K7QM3XPD9RTV2W8F", "newPassword": "newsecret" }
```

- 恢复码忽略大小写、空格与 `-`，`I/L/O` 自动归一为 `1/0`
- 成功后旧的所有家长会话失效，孩子端会话保留；恢复码本身保持不变（家长可在「账号」页自行重新生成）
- 成功响应同 `/login`，额外带 `username`
- 失败：`401 INVALID_RECOVERY_CODE`（恢复码错误或账号未设置恢复码）、`400 WEAK_PASSWORD`
- 与登录共用认证限流（同一 IP 每分钟 15 次）

### POST /child/login

```json
{ "profileId": "kid_ab12…", "pin": "1234" }
```

响应：

```json
{ "token": "…", "role": "child", "profileId": "kid_ab12…", "expiresAt": 1792600000000 }
```

### POST /parent/verify

```json
{ "password": "secret123" }
```

用于孩子在的设备上进入家长中心，返回 15 分钟家长会话（`temporary: true`）。

### POST /parent/check

只返回 `{ "ok": true }` 或 `401`，用于“家长放行一次休息”等场景。

### POST /parent/password

```json
{ "currentPassword": "secret123", "newPassword": "newsecret" }
```

- 需要家长会话；`currentPassword` 校验失败返回 `401 INVALID_CREDENTIALS`
- `newPassword` ≥ 6 位（`400 WEAK_PASSWORD`），且不能与当前密码相同（`400 SAME_PASSWORD`）
- 成功后**其他家长会话全部失效**，当前设备保持登录；孩子端不受影响

### POST /parent/username

```json
{ "currentPassword": "secret123", "username": "mama2026" }
```

- 需要家长会话与当前密码；账号名 3~20 字符（`400 INVALID_USERNAME`）
- 成功后返回 `{ "ok": true, "username": "mama2026" }`，之后用新账号名登录

### POST /parent/recovery

```json
{ "currentPassword": "secret123" }
```

- 需要家长会话与当前密码
- 生成 16 位恢复码（`XXXX-XXXX-XXXX-XXXX`），旧码立即失效
- 响应：`{ "recoveryCode": "…", "recoveryUpdatedAt": 1792600000000 }`，明文只返回这一次

### GET /me

```json
{
  "role": "parent",
  "expiresAt": 1792600000000,
  "profile": null,
  "family": {
    "username": "mama123",
    "hasRecoveryCode": true,
    "recoveryUpdatedAt": 1792600000000
  }
}
```

孩子身份下 `family.username` 为空，`hasRecoveryCode` 为 `false`。

---

## 孩子档案 `/api/profiles`

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/picker` | 公开 | 登录选择页数据（无敏感字段） |
| POST | `/` | 家长 | 新建档案 |
| PATCH | `/:id` | 家长 | 改昵称 / 头像 / PIN / 口算速算偏好 |
| DELETE | `/:id` | 家长 | 删除档案及其训练记录 |

### GET /picker

```json
{
  "hasFamily": true,
  "profiles": [{ "id": "kid_ab12…", "name": "小满", "avatar": "🦊" }],
  "avatars": ["🦊", "🐼", "…"]
}
```

### POST /

```json
{ "name": "小满", "avatar": "🦊", "pin": "1234" }
```

约束：昵称 1~12 字符、PIN 必须 4 位数字、最多 8 个档案。

### PATCH /:id

```json
{ "name": "小满", "avatar": "🐼", "pin": "4321", "arithmeticMode": "choice", "arithmeticDifficulty": 2, "storymathGrade": 3 }
```

字段均可选；`pin` 留空表示不修改；`arithmeticMode` 取 `choice`（选项四选一）/ `keypad`（键盘输入），`arithmeticDifficulty` 取 `1 | 2 | 3`（口算默认档），`storymathGrade` 取 `1~6`（应用题默认年级），非法值忽略、保留原值。响应回读全部字段（含 `arithmeticMode`、`arithmeticDifficulty` 与 `storymathGrade`）。

### DELETE /:id

```json
{ "ok": true }
```

会同时删除该孩子的训练记录、作业记录与相关会话。

---

## 状态同步 `/api/state`

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/` | 登录 | 获取当前角色可见快照（顺带把超过 2 小时的进行中作业置为 `abandoned`） |
| POST | `/` | 登录 | 离线队列合并（记录级 LWW）；单次最多 500 条记录 / 200 个作业会话，超出返回 `400 TOO_MANY_ITEMS` |
| POST | `/records` | 登录 | 上报单条训练记录（在线主路径） |
| POST | `/homework` | 登录 | 上报作业番茄钟会话 |
| PUT | `/homework-plan` | 家长 | 新增 / 修改某天的作业清单（按孩子 + 日期 + 科目 upsert，一天可多份） |
| DELETE | `/homework-plan/:id` | 家长 | 软删除作业清单（孩子已开始的会话不受影响） |
| PATCH | `/settings` | 家长 | 保存防沉迷与 AI 设置 |
| PATCH | `/tts-prefs` | 孩子 | 改自己的朗读顺序与音色（只能改自己） |
| POST | `/export` | 家长 | 按孩子/时间范围导出训练记录与作业会话（JSON，留档/迁移） |
| POST | `/prune` | 家长 | 清理 `before` 之前的记录/会话；先写服务器 `backup/` 备份再删 |

### GET / 响应（家长）

```json
{
  "schemaVersion": 18,
  "serverTime": 1790000000000,
  "family": { "id": "fam_…", "username": "mama123", "childPinLength": 4, "createdAt": 1790000000000, "version": "0.15.0" },
  "profiles": [
    { "id": "kid_…", "name": "小满", "avatar": "🦊", "createdAt": 1790000000000, "points": 86, "badges": [{ "id": "first-step", "unlockedAt": 1790000000000 }], "arithmeticMode": "choice", "arithmeticDifficulty": 1, "storymathGrade": 1 }
  ],
  "records": [ /* TrainingRecord[]，按 startedAt 倒序 */ ],
  "homework": [ /* HomeworkSession[] */ ],
  "homeworkPlans": [ /* HomeworkPlan[]，家长全部；孩子仅自己今天前后各一天未归档的 */ ],
  "limits": {
    "dailyTrainingMinutes": 40,
    "sessionMinutes": 15,
    "breakMinutes": 3,
    "dailyBadgeLimit": 5,
    "blockedRanges": [{ "start": "21:30", "end": "07:30", "label": "睡觉时间" }],
    "homeworkExempt": true
  },
  "settings": {
    "ai": {
      "enabled": true,
      "baseUrl": "https://api.deepseek.com/v1",
      "model": "deepseek-chat",
      "temperature": 0.7,
      "apiKeyMasked": "********abcd",
      "vision": { "baseUrl": "", "model": "glm-4v-flash", "apiKeyMasked": "" }
    },
    "limits": {
      "dailyTrainingMinutes": 40,
      "sessionMinutes": 15,
      "breakMinutes": 3,
      "dailyBadgeLimit": 5,
      "blockedRanges": [{ "start": "21:30", "end": "07:30", "label": "睡觉时间" }],
      "homeworkExempt": true
    },
    "tts": {
      "enabled": ["native", "edge"],
      "verified": { "edge": { "at": 1790000000000, "fingerprint": "a0c39c8c30de90c6" } },
      "lastFailure": null,
      "priority": ["native", "edge"],
      "voice": "zh-CN-XiaoxiaoNeural",
      "provider": "edge",
      "openai": { "baseUrl": "", "model": "", "defaultVoice": "", "voice": "alloy", "apiKeyMasked": "" }
    },
    "updatedAt": 1790000000000
  },
  "ttsPlan": {
    "enabled": ["native", "edge"],
    "order": ["native", "edge"],
    "voice": { "edge": "zh-CN-XiaoxiaoNeural" },
    "voices": {
      "edge": [{ "value": "zh-CN-XiaoxiaoNeural", "label": "晓晓" }],
      "openai": []
    }
  }
}
```

- 孩子身份：`profiles` 只含自己，`records` / `homework` 只含自己，`homeworkPlans` 只含自己今天前后各一天且未归档的，`settings` 为 `null`
- `limits` 对两种身份都下发（防沉迷守卫在孩子端本地执行，需要这些阈值）
- `ttsPlan` 对两种身份都下发（朗读链路在客户端推进，孩子端需要顺序与音色；只含来源名与音色标识，不含密钥）。`order` = 孩子偏好 ∩ 家长 `enabled`；空则用默认次序再与 `enabled` 取交集
- `settings.tts.enabled`：家长启用的来源；`verified` 只下发指纹仍然有效（= 当前连接配置）的验证记录。`priority` / `voice` / `openai.voice` / `provider` 已弃用，仅回读
- 任何身份都拿不到 `pinHash` / `passwordHash` / `apiKey`

### POST / （离线合并）

```json
{
  "records": [ /* TrainingRecord[] */ ],
  "homework": [ /* HomeworkSession[] */ ]
}
```

- 记录按 `id` 去重，`updatedAt` 较新者胜出
- 孩子身份下 `profileId` 会被强制改写为自己的 id
- 合并后服务端为已完成作业会话补齐/更新 `rec_hw_<会话id>` 番茄钟记录，再重算积分、判定徽章，返回新快照
- 单次最多 **500 条记录 / 200 个作业会话**；超出返回 `400 TOO_MANY_ITEMS`，不会静默截断。客户端按 100 条 / 50 个分批提交
- 请求体必须是合法 JSON 对象，否则返回 `400 INVALID_JSON`（空 body 视为 `{}`）

### POST /records

```json
{
  "record": {
    "id": "rec_1790000000000_a1b2c3",
    "module": "stroop",
    "startedAt": 1790000000000,
    "endedAt": 1790000000040,
    "durationSec": 40,
    "difficulty": 1,
    "accuracy": 0.92,
    "avgReactionMs": 820,
    "score": 88,
    "totalTrials": 24,
    "correctTrials": 22,
    "errors": [{ "type": "颜色点错", "count": 2 }],
    "dimensionScores": { "selective": 90, "inhibition": 86 },
    "updatedAt": 1790000000040
  }
}
```

响应：

```json
{
  "snapshot": { /* StateSnapshot */ },
  "unlocked": [{ "id": "sharp-eye", "isNew": true }],
  "points": 94
}
```

服务端会裁剪越界数值（`accuracy` 0~1、`score` 0~100、`dimensionScores` 每项 0~100 且丢弃未知维度）、过滤非法模块与超长数组。`module: pomodoro` 的记录只由服务端从作业会话派生，客户端直接上报会被丢弃（返回 `INVALID_RECORD`）。

### POST /homework

```json
{
  "session": {
    "id": "hw_1790000000000_a1b2c3",
    "taskTitle": "数学口算",
    "items": [
      { "id": "hi_1", "title": "读题", "icon": "📖", "done": true, "doneAt": 1790000300000 },
      { "id": "hi_2", "title": "做前 5 题", "icon": "📐", "done": true, "doneAt": 1790000900000 },
      { "id": "hi_3", "title": "检查一遍", "icon": "📌", "done": false }
    ],
    "plannedFocusMinutes": 25,
    "rounds": [
      {
        "index": 1,
        "focusMinutes": 25,
        "breakMinutes": 5,
        "startedAt": 1790000000000,
        "endedAt": 1790001500000,
        "selfChecks": [true, true, true, true]
      }
    ],
    "status": "done",
    "startedAt": 1790000000000,
    "endedAt": 1790002000000,
    "updatedAt": 1790002000000
  }
}
```

响应结构同 `/records`（`unlocked` / `points`）。`items` 最多 12 项，每项标题裁剪到 60 字；`plannedFocusMinutes` 裁剪到 5~60；为了兼容旧客户端，缺少 `items` 时会把 `subtasks` 转成 `done: false` 的清单项。

**清单锁定**：同一 `id` 的会话首次落库后，清单以已存版本为准——后续提交只接受 `items[].done` / `doneAt` 的变化，新增项、删除项、改标题都会被忽略（响应里也以锁定后的清单为准）。这样孩子无法在计时中途缩小清单来保证「正」。会话 `status = done` 后连勾选也冻结，`verdict` 不会再被后续提交改写。客户端在 `setup` 阶段（点「开始」之前）才能增删清单，且至少要有一项才允许开始。

当 `status` 变为 `done` 时，服务端会派生一条 `id = rec_hw_<会话id>`、`module = pomodoro` 的训练记录，并随快照返回。判定看结算时的清单：

- 全部完成 = `passed: true`，`score` 80~100，+20 分
- 有未完成项 = `passed: false`，`score` 40~70，+10 分

会话本身也会带上 `verdict: 'pass' | 'fail'` 与 `verdictAt`（由服务端按 `items` 计算，客户端传入的 verdict 会被忽略）。客户端不要自己提交这类记录；同一会话重复上报只会更新这条记录，不会重复加分。

进行中的会话也走这个接口，额外携带 `progress`（离开页面后的恢复状态）：

```json
{
  "session": {
    "id": "hw_1790000000000_a1b2c3",
    "taskTitle": "数学口算",
    "items": [{ "id": "hi_1", "title": "读题", "done": false }],
    "plannedFocusMinutes": 25,
    "rounds": [],
    "status": "running",
    "progress": {
      "step": "focus",
      "focusLeftSec": 892,
      "breakLeftSec": 300,
      "warmupLeftSec": 60,
      "roundIndex": 1,
      "roundStartedAt": 1790000000000,
      "checks": [false, false, false, false],
      "paused": true
    },
    "startedAt": 1790000000000,
    "endedAt": null,
    "updatedAt": 1790000600000
  }
}
```

`progress` 只在 `status: "running"` 时保存。会话超过 **2 小时**没有更新（或跨天），下次 `GET /api/state` 会自动把它置为 `abandoned` 并清掉 `progress`，避免家长端一直显示「正在写作业」。

会话可选携带 `planId`，表示清单来自哪份家长计划。服务端只在会话首次落库时校验它必须指向同一孩子的既有计划，之后不允许改写；孩子自建清单不传。计划被删除后会话仍保留 `planId`，用于家长端追溯。

### PUT /homework-plan

家长为某个孩子录入某天的作业清单。同一 `profileId + planDate + subject` 只有一份，重复保存会覆盖（`subject` 为空时保持「一天一份」的旧行为）；不同 `subject` 在同一天可并存，形成多份科目计划。

```json
{
  "plan": {
    "profileId": "kid_…",
    "planDate": "2026-10-29",
    "subject": "数学",
    "title": "数学作业",
    "items": [
      { "id": "hpi_1", "title": "数学口算第 1~20 题", "icon": "📐" },
      { "id": "hpi_2", "title": "订正错题", "icon": "📐" }
    ]
  }
}
```

- `planDate` 必须是 `YYYY-MM-DD`，且在服务端当前时间前后 30 天内；日期由客户端按家庭本地时区生成
- `subject` 可选（最多 20 字），用于一天多份计划分组；为空视为「未分类」单份
- `items` 至少 1 项、最多 12 项，标题裁剪到 60 字；空标题会被丢弃；`icon` 为可选科目 emoji（家长可改，孩子端缺失时按标题自动识别）
- 只能家长调用；孩子调用返回 `403 FORBIDDEN`
- 响应：`{ "snapshot": { /* StateSnapshot */ } }`
- 计划保留 60 天，保存时自动清理更早的记录

### DELETE /homework-plan/:id

软删除某份作业清单，写入 `archivedAt`；孩子端不再下发，家长「已录清单」列表也不再展示。已经开始的会话保留清单与 `planId`，判定与积分不变。

- 只能家长调用
- 响应：`{ "snapshot": { /* StateSnapshot */ } }`
- 计划不存在返回 `404 PLAN_NOT_FOUND`

### PATCH /settings

```json
{
  "limits": {
    "dailyTrainingMinutes": 40,
    "sessionMinutes": 15,
    "breakMinutes": 3,
    "dailyBadgeLimit": 5,
    "blockedRanges": [{ "start": "21:30", "end": "07:30", "label": "睡觉时间" }],
    "homeworkExempt": true
  },
  "ai": {
    "enabled": true,
    "baseUrl": "https://api.deepseek.com/v1",
    "model": "deepseek-chat",
    "temperature": 0.7,
    "apiKey": "sk-…"
  }
}
```

- 数值会被夹到安全区间（如每日上限 5~240 分钟）
- `apiKey` 含 `*` 或留空表示“不修改”，响应只返回掩码
- `tts` 子块：接受 `enabled`（清洗为有序去重的 1~3 项）、`openai` 连接配置（含可选 `defaultVoice`）；客户端写入的 `priority` / `voice` / `provider` / `verified` 一律忽略（0.13.0 起这些字段已弃用或只由服务端维护）

### PATCH /tts-prefs

孩子改自己的朗读顺序与音色（`PATCH /api/state/tts-prefs`）。只能改自己，家长调用返回 `403 FORBIDDEN`。

```json
{
  "order": ["native", "edge"],
  "voice": { "edge": "zh-CN-XiaoxiaoNeural", "openai": "anna" }
}
```

- `order`：清洗为 `TtsSource` 去重子集；与家长 `settings.tts.enabled` 取交集后写入 `ProfileRecord.ttsPrefs.order`（不在启用列表里的来源会被丢弃）
- `voice.edge` / `voice.openai`：截断后写入；缺省表示回退内置默认
- 响应为新快照（含更新后的 `ttsPlan`）

### POST /export

```json
{ "profileId": "profile_child1", "from": 0, "to": 1790000000000 }
```

- 只能家长调用；`profileId` 为空导出全部孩子；`from`/`to` 为毫秒时间戳，可省略（缺省取全部/至今）
- 响应：`{ "exportedAt", "scope": { profileId, from, to }, "counts": { records, homework }, "records": [...], "homework": [...] }`
- 孩子档案不存在返回 `400 NO_PROFILE`

### POST /prune

```json
{ "profileId": "profile_child1", "before": 1790000000000 }
```

- 只能家长调用；删除 `endedAt < before` 的训练记录，以及非 `running` 且结束时间早于 `before` 的作业会话（连带删除其派生的番茄钟记录 `rec_hw_*`，避免孤儿记录）
- **安全约定**：`before` 必须早于当前时间 24 小时，否则 `400 RANGE_TOO_RECENT`（防误删今天/进行中）；删除前服务端先把被删数据写入 `DATA_FILE` 同目录 `backup/`，响应返回备份文件名
- 响应：`{ "snapshot": {...}, "removed": { records, homework }, "backupFile": "backup/prune-….json", "before" }`
- 错误码：`400 INVALID_RANGE`（`before` 缺失/非法）、`400 RANGE_TOO_RECENT`、`400 NO_PROFILE`

---

## AI `/api/ai`

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/status` | 登录 | 是否可用的简要状态 |
| POST | `/test` | 登录 | 连通性测试（非流式，20s 超时） |
| POST | `/tutor` | 登录 | 作业启发式陪练（SSE） |
| POST | `/encourage` | 登录 | 孩子鼓励话术（SSE） |
| POST | `/insight` | 登录 | 家长分心归因（SSE） |
| POST | `/weekly-report` | 登录 | 家长周报（SSE） |
| POST | `/homework-parse` | 登录 | 家长作业智能解析：把老师通知拆成多份科目计划（SSE） |
| POST | `/storymath` | 登录 | AI 生成应用题：按年级出题（非流式，一次返回 JSON 数组）；`focusPoints` 专项轮 | 
| POST | `/storymath/recognize` | 登录 | AI 拍照识题：从列式照片提取答案（需视觉模型） |
| POST | `/storymath/judge` | 登录 | AI 判卷：整卷逐题判定对错 / 错因 / 思路 |
| POST | `/ocr` | 登录 | 占位，返回 `501 OCR_NOT_IMPLEMENTED` |

配置优先级：环境变量 `AI_BASE_URL/AI_MODEL/AI_API_KEY` > 家长中心保存的配置。视觉模型对称：`AI_VISION_BASE_URL/AI_VISION_MODEL/AI_VISION_API_KEY` > `settings.ai.vision` 字段；`vision.baseUrl` / `vision.apiKey` 留空时按字段继承对话配置。

开关语义：

- `AI_ENABLED=false`（环境变量）→ 全部 AI 接口返回 `503`
- 家长中心「启用 AI 能力」关闭 → `/status` 返回 `ready: false`，四个生成接口返回 `503 AI_NOT_READY`；`/test` 仍然可用，方便先验证密钥再开启

### GET /status

已配置：

```json
{
  "ready": true,
  "enabled": true,
  "model": "deepseek-chat",
  "baseUrl": "https://api.deepseek.com/v1",
  "keySource": "env",
  "vision": {
    "configured": true,
    "model": "glm-4v-flash",
    "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
    "keySource": "inherit"
  }
}
```

- `keySource`：对话模型密钥来源，`env`（环境变量，页面填写不生效）| `settings`
- `vision.configured`：是否已配置视觉模型（`vision.model` 非空）；孩子端拍题入口据此禁用/启用
- `vision.keySource`：`env` | `settings` | `inherit`（未单独配 key，继承对话密钥）

未配置或已被家长关闭时：

```json
{ "ready": false, "message": "家长还没有开启 AI 能力，可以在「AI 设置」里打开", "code": "AI_NOT_READY", "hint": "打开「家长中心 → AI 设置 → 启用 AI 能力」" }
```

### POST /test

请求体（可选，缺省 `chat`）：

```json
{ "target": "chat" }
```

`target: "vision"` 时独立解析视觉配置（视觉块自带地址/密钥时不被对话配置缺失卡住）。

成功：

```json
{ "ok": true, "message": "可用", "target": "chat", "model": "deepseek-chat", "keySource": "settings" }
```

失败时在 `message`/`error` 之外返回结构化字段，前端按 `field` 标红输入框、按 `hint` 给建议、`detail` 折叠展示上游原始报文：

```json
{
  "ok": false,
  "code": "AI_AUTH_ERROR",
  "message": "API Key 校验失败",
  "hint": "检查密钥是否复制完整、是否已过期，或该密钥无权访问此模型",
  "field": "apiKey",
  "detail": "{\"error\":{...}}",
  "error": "API Key 校验失败"
}
```

`code` 取值：

| code | HTTP | 含义 |
| --- | --- | --- |
| `AI_DISABLED` | 503 | 环境变量 `AI_ENABLED=false` |
| `AI_NOT_CONFIGURED` | 400 | Key / 地址 / 模型名为空（视觉目标时对应 `vision.*` 字段） |
| `AI_NETWORK_ERROR` | 502 | DNS 解析失败 / 连接拒绝 / 证书错误等 |
| `AI_TIMEOUT` | 504 | 20 秒无响应 |
| `AI_AUTH_ERROR` | 502 | 上游 401/403 |
| `AI_MODEL_NOT_FOUND` | 502 | 上游 404（地址路径或模型名不对） |
| `AI_QUOTA_EXCEEDED` | 502 | 上游 402/429 |
| `AI_UPSTREAM_ERROR` | 502 | 其余上游错误 |

`field` 取值：`baseUrl` / `model` / `apiKey` / `vision.baseUrl` / `vision.model` / `vision.apiKey`。

### POST /tutor

```json
{
  "profileName": "小满",
  "messages": [
    { "role": "user", "content": "3 个苹果分给 4 个人怎么分？" }
  ],
  "image": "data:image/jpeg;base64,…"
}
```

- `messages` 仅取最近 12 条，支持 `user` / `assistant`
- `image` 可选，仅接受 `data:image/*`，上限约 2MB 字符串；会作为 `image_url` 附加到最后一条用户消息
- 带图时使用视觉子配置（`settings.ai.vision` 或 `AI_VISION_*` 环境变量）：`vision.model` 未配置时返回 `400 VISION_NOT_CONFIGURED`（**不再回退对话模型**），孩子端拍题入口在视觉未配置时置灰；上游拒图时返回 `400 VISION_NOT_SUPPORTED`，提示换支持视觉的模型
- 系统提示词强制“不直接给答案、先给引导问题、每次 ≤80 字”
- 生成接口失败时的 `code` 与 `/test` 错误码体系统一（`AI_NETWORK_ERROR` / `AI_TIMEOUT` / `AI_AUTH_ERROR` 等）
- 四个生成接口都会向上游传 `stream: true` 与 `max_tokens: 2048`：推理型模型会先输出 `reasoning`，预算太小会导致正文为空
- 上游返回的 SSE 原样转发（`text/event-stream`），客户端按 `choices[0].delta.content` 取增量；连接被客户端中断时服务端返回 `499`

### POST /encourage

```json
{
  "profileName": "小满",
  "stats": {
    "total": 12,
    "modules": [{ "id": "stroop", "count": 3, "avgScore": 88, "avgAccuracy": 91 }],
    "recentScores": [{ "module": "stroop", "score": 88, "at": "2026-10-28" }]
  }
}
```

### POST /insight

```json
{
  "profileName": "小满",
  "stats": { /* 同上 */ },
  "weeklyTrend": [{ "key": "2026-10-28", "label": "10/28", "minutes": 18, "score": 82, "count": 4 }],
  "modules": [{ "name": "色词大挑战", "count": 3, "avgScore": 88 }],
  "distractions": [{ "type": "颜色点错", "count": 6 }],
  "todayMinutes": 18
}
```

### POST /weekly-report

```json
{
  "profileName": "小满",
  "week": [ /* 7 天趋势 */ ],
  "dimensions": { "sustained": 78, "selective": 86, "switching": 70, "divided": 65, "workingMemory": 80, "inhibition": 82 },
  "modules": [{ "name": "N-Back 双任务", "count": 2, "avgScore": 74 }],
  "streakDays": 5,
  "badgeCount": 4
}
```

### SSE 响应格式

所有流式接口返回 `text/event-stream`，逐块透传上游：

```
data: {"choices":[{"delta":{"content":"你"}}]}

data: {"choices":[{"delta":{"content":"好"}}]}

data: [DONE]
```

失败时返回 JSON（非流）：

```json
{ "error": "模型服务返回 401：…", "code": "UPSTREAM_ERROR" }
```

前端 `src/api/client.ts` 的 `streamAi()` 已实现解析与中止。

### POST /homework-parse

家长粘贴老师发的整段作业通知，解析成多份科目计划（供「作业」页逐科录入）。请求：

```json
{ "text": "📖10.29数学学习建议：\n1. 检查书本P39页…", "defaultDate": "2026-10-30" }
```

响应为 SSE 文本流，内容是模型返回的 JSON（可能被 markdown 代码块包裹，前端用 `extractJsonFromAi()` 提取）：

```json
{
  "plans": [
    { "date": "2026-10-29", "subject": "数学", "title": "数学作业", "items": [{ "title": "检查书本P39页，订正错题" }] }
  ]
}
```

- 前端优先调用本接口；失败或未配置 AI 时用本地规则 `src/utils/homeworkParse.ts` 兜底（按科目标题分块、取日期、去编号、温馨提示并项）。
- 该接口只做解析，**不落库**；解析结果由家长在「作业」页逐科确认后走 `PUT /api/state/homework-plan` 保存。

### POST /storymath

AI 生成小学 1~6 年级应用题（孩子端「AI 数学应用题」训练用）。非流式，一次返回整包 JSON 数组，方便前端组装后逐题作答。请求：

```json
{ "grade": 2, "count": 5, "focusPoints": ["两位数乘一位数"] }
```

- `grade`：1~6（超出返回 `400 INVALID_GRADE`）。
- `count`：1~20（默认 5；超出返回 `400 INVALID_COUNT`）。
- `focusPoints`（可选）：专项训练轮知识点数组（最多 6 个），非空时只出这些知识点范围内的变式题（不重复原题）。

成功响应：

```json
{
  "grade": 2,
  "questions": [
    { "text": "小明有 5 个苹果，又买了 3 个，一共几个？", "answer": 8, "unit": "个", "knowledgePoint": "20以内加法", "hint": "把两次的数量加起来" }
  ]
}
```

- `answer` 必须是数字（整数或有限小数），`unit` 是答案单位（无则为空串），`knowledgePoint` 是该题知识点标签（用于错题专项训练，缺失时服务端补「未标注」，不丢弃整题），`hint` 可选。
- 模型返回非 JSON、或题目缺答案/空文本时，服务端跳过该题并重试补足到 `count`；仍不足返回 `502 AI_PARSE_ERROR`。
- 解析器覆盖多种真实输出形态：裸数组 / 对象包裹 `questions` / `questions` 被序列化成字符串 / markdown 围栏（含四反引号）/ 说明文字里的假 `[ ]` / 答案带单位或中文数字。**仍失败时 `detail` 携带原始返回内容（截断到 800 字）供家长定位**。
- 与其它生成接口一致：未开启 AI 返回 `503 AI_NOT_READY`，未配 key 返回 `503 AI_NOT_CONFIGURED`。

### POST /storymath/recognize

AI 从孩子列的竖式/计算过程照片里提取最终答案（「AI 数学应用题」拍照作答用）。需要视觉模型（`vision.model`）。请求：

```json
{ "image": "data:image/jpeg;base64,……" }
```

- `image`：data URL 图片（非 `data:image/` 开头返回 `400 INVALID_IMAGE`；超 4MB 返回 `400 IMAGE_TOO_LARGE`）。
- 未配置视觉模型返回 `400 VISION_NOT_CONFIGURED`（提示家长到「AI 设置 → 拍照识题模型」填写）；配了但上游拒图返回 `400 VISION_NOT_SUPPORTED`。

成功响应：

```json
{ "answer": 8, "confidence": 0.9 }
```

- `answer`：孩子列式算出的最终答案（数字，可负、可两位小数）。
- `confidence`：0~1，AI 对「没看错」的把握；`< 0.5` 前端提示孩子核对（可能字迹潦草 / 被裁切 / 拍歪）。
- 模型返回非 JSON、或答案无法解析时返回 `502 AI_PARSE_ERROR`（前端提示「拍清楚一点，或直接输入答案」）。

### POST /storymath/judge

AI 判卷：一次性接收整卷（主轮 5 题 + 可能拍照题），逐题判定对错。请求：

```json
{
  "submissions": [
    { "text": "小明有 5 个苹果，又买了 3 个，一共几个？", "unit": "个", "knowledgePoint": "20以内加法", "submitted": 8, "mode": "keypad" }
  ]
}
```

- `submissions`：1~20 条；每条须有非空 `text` 与有限数字 `submitted`，否则 `400 INVALID_ITEM`。**不传标准答案**——AI 按题意独立批改（拍照题只传 `mode: "photo"`，AI 会检查列式过程）。
- 空数组返回 `400 EMPTY`；超过 20 条返回 `400 TOO_MANY`。

成功响应：

```json
{
  "items": [
    {
      "index": 0,
      "correct": true,
      "answer": 8,
      "solution": "先算小明买的总数：5+3=8，单位是个。",
      "knowledgePoint": "20以内加法",
      "errorStep": ""
    }
  ]
}
```

- `index` 与提交顺序一致；`correct` 是否答对（拍照题若列式过程有错但最终答案碰巧对，也判错并在 `errorStep` 写明过程错误）。
- `answer` 本次标准答案；`errorStep` 错在哪个步骤（全对为空）；`solution` 分步解题思路（50 字内，全对也给出）；`knowledgePoint` 照抄输入。
- 模型返回非 JSON、或判卷结果缺项（逐题不齐）时返回 `502 AI_PARSE_ERROR`（不静默丢题，避免正确率失真）。

---

## 请求体限制

- 全 `/api/*`：8MB（拍照图片请压缩后上传）
- 训练记录单次合并最多 500 条，作业会话最多 200 条
- 学生档案最多 8 个、禁用时段最多 6 个

## 通用错误与响应头

| 状态 | code | 触发 |
| --- | --- | --- |
| 400 | `INVALID_JSON` | 请求体不是合法 JSON 对象（空 body 除外） |
| 400 | `INVALID_PLAN` | 作业清单没有有效项、日期格式错误或超出前后 30 天 |
| 400 | `TOO_MANY_ITEMS` | 单次同步超过 500 条记录 / 200 个作业会话 |
| 404 | `PLAN_NOT_FOUND` | 删除不存在的作业清单 |
| 429 | `RATE_LIMITED` | 认证类接口同 IP 超过 15 次/分钟 |

所有写接口都会先校验 JSON：畸形请求不会再被当成空对象返回 200，避免客户端误判同步成功后清空离线队列。

响应头 `x-storage-health: degraded` 表示服务端最近一次写盘失败（已重试 3 次），此时接口仍返回数据，但持久化可能落后于内存；处置见 [persistence.md](persistence.md)。

## 朗读 `/api/tts`

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/` | 登录 | 按指定来源合成一段文字的 mp3 音频 |
| POST | `/preview` | 家长 | 试听某个后端来源，通过则把该来源记为「已验证」 |

朗读链路**在客户端推进**：孩子端按 `ttsPlan.order` 逐个来源尝试（`native` 由浏览器探测，`edge` / `openai` 各发一次 `POST /api/tts?source=`），音色取 `ttsPlan.voice`，某个来源失败自动落到下一项。整条链前端总预算 25s，超时放弃并提示「文字已经显示在屏幕上」。

职责划分（0.13.0）：家长只管「哪些来源启用」+ 连接配置试听；顺序与音色全部在孩子端「设置 → 声音」里自己选（`PATCH /api/state/tts-prefs`）。

### POST /

请求体：

```json
{ "text": "今天有语文和数学作业", "source": "edge", "voice": "zh-CN-XiaoxiaoNeural" }
```

- `text` 最长 500 字；空文本返回 `400 EMPTY`
- `source` 可选，取值 `edge` / `openai`；其它值（含 `native`）返回 `400 TTS_BAD_SOURCE`
- `voice` 可选：本次合成音色；截断后走 `resolveTtsVoice`（请求体 > 当前会话孩子 prefs > settings 兜底 > 厂商内置默认）
- **未知厂商且无 `openai.defaultVoice`**：返回 `400 TTS_VOICE_NOT_SET`（`field: openai.defaultVoice`），不发上游请求
- **不传 `source`**：按已弃用的 `settings.tts.provider` 兼容 0.11.x 客户端，且不做试听/enabled 闸门；该兼容路径下个版本移除
- 指定 `source` 但该来源不在 `settings.tts.enabled` 时返回 `403 TTS_NOT_ENABLED`（家长没给孩子开这个来源）
- 该来源未试听通过、或连接配置改过导致指纹失效时返回 `409 TTS_NOT_VERIFIED`（`hint` 指向家长端试听入口），**不合成**
- openai 三项（baseUrl / model / apiKey）缺任一项返回 `400 TTS_NOT_CONFIGURED`（带 `field` 与 `hint`，建议改用 Edge），**不会**静默回退 Edge
- 合成失败返回 `502 TTS_FAILED`（可能附带 `hint` / `field`，如密钥无效时 `field: openai.apiKey`；上游 4xx/5xx 时附带 `detail` 为上游响应体前 500 字，便于排查模型/音色参数）；同时把本次失败写入 `settings.tts.lastFailure`，家长端据此提示「已自动改用下一项」
- 成功响应为 `audio/mpeg`（mp3 音频流），`cache-control: no-store`，并带 `x-tts-source` 头标明实际来源

后端来源由家长中心「朗读来源」启用开关控制，音色由孩子在设置页选择：

- `edge`：微软 Edge Read Aloud，免费、无需 key；该接口自 2025-12 起浏览器端仅 Edge 可用，服务端始终可用；音色候选见 `TTS_EDGE_VOICES`
- `openai`：请求 `Base URL/audio/speech`（OpenAI 音频接口兼容，如 SiliconFlow），需填 baseUrl / model / apiKey；音色可从内置候选选或手填

### POST /preview

请求体 `{ "source": "edge" }`（只接受 `edge` / `openai`，`native` 由浏览器自行试听）。合成一句固定样例句；成功时写入 `settings.tts.verified[source] = { at, fingerprint }` 并清除该来源的 `lastFailure`，响应同样是 `audio/mpeg`。失败不写验证，返回 `502 TTS_FAILED`。

**试听音色**（0.13.0）：只用厂商内置默认——edge 为晓晓；openai 按 `baseUrl` 识别厂商（SiliconFlow → `anna`，OpenAI 官方 → `alloy`，未知厂商 → 家长配置的 `openai.defaultVoice`）。不读 settings 里已弃用的 `voice`，也不绑孩子偏好。原因是 SiliconFlow 对 OpenAI 官方音色 `alloy`（即使自动补 `模型名:` 前缀）一律 400；未知厂商若连 `defaultVoice` 都没配，返回 `400 TTS_VOICE_NOT_SET`。

**指纹只绑连接不绑音色**（0.13.0）：edge 指纹为常量（试听通过即长期有效）；openai 指纹为 `baseUrl|model|apiKey`。改音色不会导致旧验证失效；改 baseUrl / model / apiKey 才需要重新试听。

家长端试听必须先保存配置：试听读取的是已保存的配置，与表单上的未保存修改无关。

**已知限制**：系统原生语音「API 存在但不出声」（部分微信 WebView、无中文语音包的设备）无法判定，客户端仍视为成功；这类设备请在孩子设置页把 `edge` 排在 `native` 之前。

