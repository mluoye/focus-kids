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
| PATCH | `/:id` | 家长 | 改昵称 / 头像 / PIN |
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
{ "name": "小满", "avatar": "🐼", "pin": "4321" }
```

字段均可选；`pin` 留空表示不修改。

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
| PUT | `/homework-plan` | 家长 | 新增 / 修改某天的作业清单（按孩子 + 日期 upsert） |
| DELETE | `/homework-plan/:id` | 家长 | 软删除作业清单（孩子已开始的会话不受影响） |
| PATCH | `/settings` | 家长 | 保存防沉迷与 AI 设置 |
| POST | `/export` | 家长 | 按孩子/时间范围导出训练记录与作业会话（JSON，留档/迁移） |
| POST | `/prune` | 家长 | 清理 `before` 之前的记录/会话；先写服务器 `backup/` 备份再删 |

### GET / 响应（家长）

```json
{
  "schemaVersion": 7,
  "serverTime": 1790000000000,
  "family": { "id": "fam_…", "username": "mama123", "childPinLength": 4, "createdAt": 1790000000000, "version": "0.5.0" },
  "profiles": [
    { "id": "kid_…", "name": "小满", "avatar": "🦊", "createdAt": 1790000000000, "points": 86, "badges": [{ "id": "first-step", "unlockedAt": 1790000000000 }] }
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
    "ai": { "enabled": true, "baseUrl": "https://api.deepseek.com/v1", "model": "deepseek-chat", "temperature": 0.7, "apiKeyMasked": "********abcd" },
    "limits": {
      "dailyTrainingMinutes": 40,
      "sessionMinutes": 15,
      "breakMinutes": 3,
      "dailyBadgeLimit": 5,
      "blockedRanges": [{ "start": "21:30", "end": "07:30", "label": "睡觉时间" }],
      "homeworkExempt": true
    },
    "updatedAt": 1790000000000
  }
}
```

- 孩子身份：`profiles` 只含自己，`records` / `homework` 只含自己，`homeworkPlans` 只含自己今天前后各一天且未归档的，`settings` 为 `null`
- `limits` 对两种身份都下发（防沉迷守卫在孩子端本地执行，需要这些阈值）
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

家长为某个孩子录入某天的作业清单。同一 `profileId + planDate` 只有一份，重复保存会覆盖。

```json
{
  "plan": {
    "profileId": "kid_…",
    "planDate": "2026-10-29",
    "title": "数学口算 + 语文抄写",
    "items": [
      { "id": "hpi_1", "title": "数学口算第 1~20 题", "icon": "📐" },
      { "id": "hpi_2", "title": "语文抄写第 3 段", "icon": "📖" }
    ]
  }
}
```

- `planDate` 必须是 `YYYY-MM-DD`，且在服务端当前时间前后 30 天内；日期由客户端按家庭本地时区生成
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
| POST | `/ocr` | 登录 | 占位，返回 `501 OCR_NOT_IMPLEMENTED` |

配置优先级：环境变量 `AI_BASE_URL/AI_MODEL/AI_API_KEY` > 家长中心保存的配置。

开关语义：

- `AI_ENABLED=false`（环境变量）→ 全部 AI 接口返回 `503`
- 家长中心「启用 AI 能力」关闭 → `/status` 返回 `ready: false`，四个生成接口返回 `503 AI_NOT_READY`；`/test` 仍然可用，方便先验证密钥再开启

### GET /status

```json
{ "ready": true, "enabled": true, "model": "deepseek-chat", "baseUrl": "https://api.deepseek.com/v1" }
```

未配置或已被家长关闭时：

```json
{ "ready": false, "message": "家长还没有开启 AI 能力，可以在「AI 设置」里打开" }
```

### POST /test

成功：

```json
{ "ok": true, "message": "可用" }
```

失败（响应体同时含 `message` 与 `error`，前端统一取 `error` 展示）：

```json
{ "ok": false, "message": "还没有配置大模型 API Key，请家长在「AI 设置」里填写", "error": "还没有配置大模型 API Key，请家长在「AI 设置」里填写" }
```

未配置时返回 `400`，上游报错返回 `502`。

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
- 带 `image` 时请求的模型为「视觉模型」（`settings.ai.visionModel`），未填则回退用 `model`；若上游不支持图片输入，返回 `400 VISION_NOT_SUPPORTED`，提示在 AI 设置填写视觉模型（如 glm-4v-flash / qwen-vl-plus）
- 系统提示词强制“不直接给答案、先给引导问题、每次 ≤80 字”
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

## 朗读合成 `/api/tts`

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/` | 登录 | 合成一段文字的 mp3 音频 |

### POST /

请求体：

```json
{ "text": "今天有语文和数学作业" }
```

- `text` 最长 500 字；空文本返回 `400 EMPTY`
- 合成失败返回 `502 TTS_FAILED`
- 成功响应为 `audio/mpeg`（mp3 音频流），`cache-control: no-store`

合成服务由家长中心「朗读（TTS）设置」配置：

- `provider: 'edge'`（默认）：微软 Edge Read Aloud，免费、无需 key；该接口自 2025-12 起浏览器端仅 Edge 可用，服务端始终可用
- `provider: 'openai'`：请求 `Base URL/audio/speech`（OpenAI 音频接口兼容，如 SiliconFlow），需家长中心填 baseUrl / model / voice / apiKey
