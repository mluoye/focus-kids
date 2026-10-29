# Changelog

遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

（暂无改动。新改动先写在这里，按 `docs/development-standards.md` 第 4 节发版时落到版本号下。）

## [0.2.0] - 2026-10-29

### 新增

- 作业番茄钟支持中途离开后恢复：切页、刷新、关标签页都会保留清单勾选、轮次、剩余时间与自检进度，回来默认暂停，点「继续」才继续倒计时
- 作业专注时长改为 20 / 25 / 30 分钟预设 + 5~60 分钟自定义；大脑热身改为可选项并默认开启
- 进行中的作业会话以 `status: 'running'` + `progress` 同步到服务端（开始/暂停/勾选节流 5 秒/离开/完成），家长总览新增「正在写作业」卡片
- 底栏「作业」在离开作业页后显示进行中小圆点
- 进行中会话超过 2 小时没有动作自动作废，下次进入作业页提示重新开始
- 训练小游戏进行中切换页面时弹窗确认，避免成绩静默作废
- 新增 `docs/development-standards.md`：改动分类 A~H、影响半径对照表、版本与弃用规则、提交流程与自查清单
- 新增根目录 `AGENTS.md`：AI 与新成员的必读入口与硬约束
- 新增 `scripts/check-docs.ts` 与 `npm run check:docs`：校验版本三处一致、CHANGELOG 完整性、`schemaVersion` 迁移链、接口文档覆盖、模块与状态字段文档覆盖、`@deprecated` 登记

### 变更

- 版本号策略改为「每次改动即发版」：`APP_VERSION` 按语义化升位，`SCHEMA_VERSION` 独立递增，二者不再绑定
- `npm run build` 构建前自动执行规范校验；`npm run check` = 类型检查 + 规范校验
- 规范校验默认只警告不阻断，`--strict` 时警告即失败，预留给后续 CI
- 接口与字段改为「只增不删 + 弃用期」：标记 `@deprecated` 后至少保留一个发布版本

### 弃用

- `HomeworkSession.subtasks` 标记 `@deprecated`：v1 旧字段，仅供读取旧快照，服务端迁移后不再写入，至少保留一个发布版本后再移除

### 迁移

- `schemaVersion` 2→3：作业会话新增可选的 `progress`，旧数据保持 `undefined`，启动时自动迁移，无需手动处理

### 文档

- `docs/data-model.md`、`docs/api.md`、`docs/architecture.md`、`docs/training-specs.md` 补充进行中会话与恢复规则
- `README.md` 更新「文档与版本约定」与脚本说明，指向新的开发规范
- 初始化 git 仓库，采用 `type(scope): 说明` 提交格式

## [0.1.0] - 2026-10-29

### 新增

- 工程骨架：Vue 3 + Vite + Pinia + ECharts；Node + Hono 单进程托管静态产物与 API
- 账号体系：家长账号（scrypt 加盐）、孩子档案头像 + 4 位 PIN、家长临时解锁
- 状态同步：`GET/POST /api/state` 记录级 LWW 合并，离线队列，`schemaVersion` 迁移
- 六大训练模块：作业番茄钟、Stroop 色词、抗干扰捕捉、N-Back 双任务、分类切换、多线索追踪
- 成长可视化：六维雷达、7 天趋势、模块均分、徽章墙
- 家长中心：总览、训练记录 + CSV 导出、防沉迷设置、孩子档案管理、AI 设置
- 防沉迷：每日训练上限、连续训练强制休息、每日徽章上限、禁用时段（番茄钟豁免）
- AI 能力：鼓励话术、分心归因、启发式作业陪练（文本 + 拍照直传）、家长周报，SSE 流式输出
- 作业清单：多项作业逐项手动勾选，专注页与自检页都能勾，允许部分完成并如实记录（积分仍固定 +20）
- 数据迁移：`schemaVersion` 1→2，旧 `subtasks` 转为 `done: false` 的 `items`
- Docker Compose 部署：命名卷 `focus-kids-data` 持久化，健康检查
- 认证接口限流：同一 IP 每分钟 15 次，超限 `429 RATE_LIMITED`
- 文档：`docs/architecture.md`、`docs/api.md`、`docs/data-model.md`、`docs/training-specs.md`

### 修复

- 家长中心「启用 AI 能力」开关此前未真正生效，关闭后四个生成接口仍可调用；现改为开关关闭时 `/status` 返回不可用、生成接口返回 `503 AI_NOT_READY`，`/test` 仍可用于验证密钥
- 作业陪练多轮对话会把空的 assistant 消息一起发给模型，导致模型返回空回复；改为先取历史再发起请求，流式结果单独渲染
- 推理型模型（如 SenseNova）默认输出预算会被思考过程占满，正文被截断成空；流式请求显式使用 `max_tokens: 2048`
- 家长端 AI 分析与周报直接显示 `**加粗**`、`- 列表` 等 Markdown 记号；新增极简渲染，孩子端则去掉记号
- 家长中途离开页面导致上游连接中断时，服务端不再打印 `AbortError` 堆栈

### 已知限制

- 拍照识题未接入 OCR，依赖模型自身视觉能力；`/api/ai/ocr` 为占位接口
- 分数与维度分在客户端计算，服务端只做范围裁剪与积分/徽章推导；家庭内部使用场景下不做防作弊校验
- 单家庭部署（一个服务实例只有一个家长账号）
- 无 HTTPS，建议仅在内网使用或自行加反向代理
