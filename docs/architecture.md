# 架构说明

## 总体结构

```
┌─────────────────────────── 浏览器 ───────────────────────────┐
│  Vue3 SPA (Pinia)                                             │
│  ├─ 孩子端 /kid    训练引擎 + 游戏组件 + 防沉迷守卫            │
│  ├─ 家长端 /parent 报表 / 档案 / 限制 / AI 配置                │
│  └─ localStorage：会话 token、状态快照、离线待同步队列         │
└───────────────┬───────────────────────────────────────────────┘
                │ /api/*  (JSON + SSE)
┌───────────────▼───────────────────────────────────────────────┐
│  Node 进程 (Hono)                                              │
│  ├─ 静态托管 dist/（SPA 回退）                                 │
│  ├─ /api/auth      会话与口令（scrypt）                        │
│  ├─ /api/profiles  孩子档案                                    │
│  ├─ /api/state     快照 / 合并 / 记录 / 设置                    │
│  ├─ /api/ai        OpenAI 兼容代理（SSE 透传）                 │
│  └─ store.ts       单文件 JSON 持久化（原子写 + 迁移）          │
└───────────────┬───────────────────────────────────────────────┘
                │ 命名卷 focus-kids-data
        /data/app-state.json
```

## 设计原则

1. **单进程单镜像**：后端同时托管前端产物，NAS 上只需要一个容器、一个端口。
2. **服务端权威**：积分、徽章、防沉迷中的每日徽章上限由服务端计算，客户端只做乐观展示。
3. **离线优先但不冲突**：训练记录只追加（append-only），以 `id` 去重、`updatedAt` 做 LWW；积分由记录推导，重复同步不会重复加分。
4. **共享契约**：`shared/types.ts` + `shared/constants.ts` 同时被前后端引用，接口或枚举变更只改一处。
5. **口令与密钥不落前端**：`pinHash`、`passwordHash`、`apiKey` 永不出现在快照中。

## 目录职责

| 路径 | 职责 |
| --- | --- |
| `server/index.ts` | 应用装配、静态资源、错误出口、启动 |
| `server/store.ts` | 读写数据文件、空状态、迁移、LWW 合并、设置脱敏、写盘重试与损坏文件保留 |
| `server/json.ts` | 统一 JSON 请求体解析：畸形请求返回 400，不降级成空对象 |
| `server/records.ts` | 作业会话 → 番茄钟记录的派生、正/负判定与幂等同步 |
| `server/security.ts` | scrypt 口令散列、恢复码生成/归一、随机 token、id 生成 |
| `server/middleware.ts` | Bearer 会话校验、家长权限校验 |
| `server/awards.ts` | 积分推导、六维均值、连续天数、徽章判定与每日上限 |
| `server/snapshot.ts` | 按角色生成客户端可见快照 |
| `server/routes/*` | auth / profiles / state / ai 四组接口 |
| `server/ai/prompts.ts` | 各 AI 能力的提示词（孩子话术与家长话术分离） |
| `src/stores/session.ts` | 登录态、家长临时解锁与返回孩子模式 |
| `src/stores/data.ts` | 快照、离线队列、记录上报、设置保存 |
| `src/stores/guard.ts` | 每日上限、连续训练计时、强制休息、禁用时段 |
| `src/training/engines.ts` | 纯函数：随机、计分、加速分、综合分 |
| `src/training/stats.ts` | 六维均值、7 天趋势、模块统计、AI 摘要 |
| `src/views/kid/games/*` | 五个训练游戏（每个只负责产出 `GameOutcome`） |
| `src/views/kid/TrainPlayView.vue` | 介绍 → 游戏 → 结果 → 记录落库的统一外壳 |
| `shared/*` | 前后端共享契约：类型、模块 / 维度 / 徽章、版本号与默认限制 |
| `scripts/*` | 开发规范校验脚本（`npm run check:docs`）与离线密码重置（`npm run reset:password`） |
| `docs/*` | 架构、接口、数据模型、训练规则、开发规范 |

## 数据流

### 训练一次

1. `TrainPlayView` 检查 `guard.canStart()`（每日上限 / 禁用时段 / 强制休息）。
2. 游戏组件运行，结束时 `emit('finish', GameOutcome)`。
3. 外壳组装 `TrainingRecord`，调用 `data.saveRecord()`：
   - 在线：`POST /api/state/records` → 服务端合并 + 重算积分 + 判徽章 → 返回新快照
   - 离线：写入 `localStorage` 队列，界面乐观更新
4. 结果页展示分数、维度条、积分、新徽章。

作业番茄钟不经过这条路径：客户端只提交 `HomeworkSession`（`POST /api/state/homework`），服务端在会话完成时派生 `rec_hw_<会话id>` 的番茄钟记录，积分统一按记录计算，重复上报不会双计。

### 离线恢复

- 监听 `online` 事件与每次 `GET /api/state` 前自动 `syncPending()`
- 队列提交 `POST /api/state`，服务端按 `id + updatedAt` 合并
- 成功后清空队列并覆盖本地快照

### 进行中作业的恢复

- 番茄钟的计时状态以「结束时间戳」驱动，切页或手动暂停时换算成剩余秒数，写入 `localStorage` 的 `fk.homeworkDraft.<profileId>`。
- 同一份状态以 `status: 'running'` + `progress` 上报服务端（开始/暂停/勾选节流 5 秒/离开/完成），家长端据此展示「正在写作业」。
- 回到作业页优先用本地草稿恢复；没有草稿时回退到服务端最近一条 2 小时内的 `running` 会话。恢复后统一暂停，点「继续」才继续倒计时。
- 超过 2 小时的 `running` 会话在 `GET /api/state` 时自动置为 `abandoned`。
- 训练小游戏不做中途恢复，离开前弹窗确认「本次成绩会作废」。

### AI 请求

1. 前端 `streamAi()` 带 Bearer token 调用 `/api/ai/{feature}`。
2. 服务端解析配置（页面配置或环境变量）、拼装系统提示词与上下文。
3. 以 `stream: true` 转发到 OpenAI 兼容接口，SSE 原样透传。
4. 前端逐块解析 `data: {...}` 并增量渲染，支持中止。

## 防沉迷执行点

| 规则 | 执行位置 | 说明 |
| --- | --- | --- |
| 每日训练上限 | 前端守卫（`guard.canStart`） | 统计**当前孩子**今日 `countsTowardDailyLimit` 模块的 `durationSec` 之和（兄弟姐妹额度互不影响） |
| 连续训练强制休息 | 前端守卫 + 全局遮罩 | 15 分钟（可配）触发，倒计时结束才恢复；家长可密码放行一次 |
| 每日徽章上限 | **服务端** | `evaluateBadges` 按当日已解锁数量截断 |
| 禁用时段 | 前端守卫 | 跨午夜区间正确判定；番茄钟始终可用 |

> 每日时长与禁用时段属于“体验约束”，家长可在同一台服务器上直接修改配置，因此不做服务端强制；徽章与积分涉及记录完整性，故放服务端。

> 孩子端 `settings` 为 `null`，但快照单独下发 `limits`，守卫依赖它工作——改动快照字段时不要删掉。

## 可靠性与运维

- **原子写**：先写 `app-state.json.<pid>.tmp` 再 `rename`，避免断电产生半截文件
- **写队列**：所有写入串行化，避免并发请求互相覆盖
- **写盘重试**：失败自动重试 3 次（200/400ms 退避），仍失败则记 `storage.lastWriteError` 并给所有响应加 `x-storage-health: degraded`
- **损坏不覆盖**：读取或迁移失败时把原文件改名保留为 `app-state.json.corrupt-<ts>`，再以空状态启动，避免「空状态覆盖唯一副本」
- **迁移**：`schemaVersion` 低于当前版本时按迁移表升级；升级前建议先备份数据卷
- **健康检查**：`GET /api/health` 返回版本、家庭是否创建、档案/记录数量、运行时长，以及 `storage` 写盘状态
- **会话清理**：启动时清理过期会话
- **认证限流**：登录/注册/家长校验类接口按 IP 每分钟 15 次，超限返回 `429 RATE_LIMITED`，防止弱 PIN 被暴力尝试

> 存储层完整行为（重试、损坏恢复、localStorage 键、离线队列、备份）见 [persistence.md](persistence.md)。

## 已知边界

- 单家庭：一个实例只允许一个家长账号（`POST /api/auth/register` 在已有家庭时返回 409）
- 无 HTTPS：内网 http；公网使用必须加反向代理
- 快照按全量返回，家庭数据量在数万条记录内无压力；更大规模需要分页接口
