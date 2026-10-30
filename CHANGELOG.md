# Changelog

遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.10.1] - 2026-10-30

### 新增

- 孩子端「训练小馆」按能力分区平铺：🎯 专注力训练（色词大挑战、抗干扰捕捉、多线索追踪）、🧠 记忆力训练（N-Back 双任务）、🔀 反应力训练（分类切换）；🍅 作业番茄钟单独一区「作业工具」，不参与训练分类
- `ModuleMeta` 新增 `category`、新增 `TRAINING_CATEGORIES`（`shared/constants.ts`），`logic`（逻辑思维）作为预留类目；分类只影响孩子端展示，不改六维评估、积分、上限与徽章
- 孩子端首页新增醒目的「今天有作业」提醒卡（hero 下方首屏位置）：按科目列出各科进度与剩余项，未开始 / 进行中 / 部分完成显示不同文案，带「去写作业 / 继续写作业」与「🔊 听一下」按需朗读
- 孩子端底栏「作业」新增科目数角标，与首页提醒同步；作业全部做完后卡片与角标一起消失
- 新增 `shared/homework.ts` 的 `homeworkReminder()`：纯派生的提醒状态（不落库、不加字段），只认「进行中 / 已完成」会话的勾选，放弃的尝试与超过 2 小时的进行中会话不计入；家长新增/改项后旧会话没覆盖，提醒自动重新出现
- 孩子端首页改为每次进入都拉一次快照，家长刚留/改过的作业能立刻提醒（离线仍用本地缓存）

### 文档

- `docs/training-specs.md` 补「训练小馆分类」与「首页作业提醒」规则（判定口径、消失条件、角标与语音）
- `README.md` 补孩子端首页作业提醒说明

## [0.10.0] - 2026-10-30

### 新增

- 家长中心顶部栏新增版本号小字（vX.Y.Z），随时可见当前部署版本
- 家长「数据管理」页新增「关于 / 版本」卡片：展示当前版本 + 「检查更新」按钮
- 新增纯前端版本更新检查：直连 GitHub Releases API（仓库 `mluoye/focus-kids`），进家长端每天自动检查一次（本地节流），也可手动刷新；发现新版本只提示版本号，不提供跳转
- 新增 `src/utils/updateCheck.ts`（版本比较 + 检查 + 节流）、`src/stores/update.ts`（家长端共享检查状态）
- 家长「作业」页新增「📋 粘贴老师作业，AI 一键解析」：把班级群整段通知拆成多份科目计划（含内嵌日期、温馨提示并项），优先用大模型（`POST /api/ai/homework-parse`），失败/未配置用本地规则兜底（`src/utils/homeworkParse.ts`）
- 作业计划支持一天多份：`HomeworkPlan` 新增可选 `subject`，按 `profileId + planDate + subject` upsert；孩子端把当天多份合并成一份清单（分科目小节），统一进度与判定
- 家长「作业」页日期范围由「今天起 7 天」放宽到「今天前后 7 天」：老师发的通知可能含前几天作业，解析出过去日期也能确认保存（服务器端仍放宽到 ±30 天）

### 变更

- `SCHEMA_VERSION` 10 → 11：`HomeworkPlan.subject` 为可选字段，历史数据无需改写；upsert 键扩展为 `profileId + planDate + subject`
- 孩子端作业页「家长留的清单」改为把当天多份科目计划合并成一份清单（分科目小节展示，准备页与开始后一致；`data.myTodayPlan` → `myTodayPlans`）；`HomeworkItem` 新增可选 `subject` 标记所属科目
- 孩子端朗读作业先报所属科目与该科内序号（如「语文作业，一：学习园地四…」），「读全部」按科目分段，未分类报「作业」前缀

### 文档

- `docs/architecture.md` 注明版本检查直连 GitHub（浏览器端、公网依赖、国内可能不可达）
- `docs/development-standards.md` 发版节奏补充：发版提交后推 `vX.Y.Z` 标签，`.github/workflows/release.yml` 自动创建 GitHub Release（家长端「检查更新」据此提示新版本）
- `docs/api.md` 补 `POST /api/ai/homework-parse`、`PUT /api/state/homework-plan` 的 `subject` upsert
- `docs/data-model.md` 补 `HomeworkPlan.subject` 与 10→11 迁移
- `docs/training-specs.md` 补家长智能解析与一天多份说明
- `README.md` 家长端补充版本号显示、更新检查与作业智能解析说明

## [0.9.1] - 2026-10-30

### 文档

- `docs/persistence.md` 第 9 节补充数据管理：`POST /api/state/export` 导出、`POST /api/state/prune` 清理（清理前自动写 `backup/` 备份、只允许清理 24 小时前数据）
- `docs/persistence.md` 第 10 节补充说明：清理备份 `backup/prune-*.json` 在本数据卷内，长期留档请用家长端导出到本地

## [0.9.0] - 2026-10-30

### 新增

- 家长中心新增「数据管理」页：数据量概览（训练记录/作业会话/体积/按孩子分布）、按孩子与时间范围导出 JSON 备份、清理历史数据
- 新增 `POST /api/state/export`：按孩子/时间范围导出训练记录与作业会话 JSON，用于留档或迁移
- 新增 `POST /api/state/prune`：删除指定时间之前的记录与作业会话；清理前服务端自动把被删数据写入 `backup/` 备份，只允许清理 24 小时之前的数据（防误删今天，`RANGE_TOO_RECENT`）

## [0.8.1] - 2026-10-30

### 文档

- 开发规范收紧：版本五处不一致改为硬错误（`npm run check` 直接失败），新增发版前强制关卡 `npm run check:release`
- 新增规则：系统能力改动须目标移动环境真机验证、新增鉴权路由前端须带 `Authorization`、服务端运行时依赖须放 `dependencies`、模型/能力开关须校验能力并定义明确错误码
- `check:docs` 新增两项检查：前端裸 `fetch('/api/...')` 未注入鉴权、`server/` 依赖误放 devDependencies
- `docker-compose.yml` 镜像标签同步至 `0.8.1`

## [0.8.0] - 2026-10-29

### 新增

- 拍照识题支持独立视觉模型：`settings.ai.visionModel`，带图请求优先用它，未配回退 `model`；模型不支持看图时返回明确提示，引导家长填视觉模型（如 glm-4v-flash / qwen-vl-plus）
- 家长「AI 设置」快速填充改为厂商级预设：一键配好服务地址 + 对话模型 + 视觉模型
- 朗读后端降级：新增 `POST /api/tts`，用微软 Edge Read Aloud（或家长配置的 OpenAI 兼容 TTS）把文字合成 mp3；孩子端点读在系统语音缺失时自动改用该接口，移动端（微信内、无 GMS 国产 ROM）也能朗读
- 家长中心新增「朗读（TTS）设置」：选择 Edge（免费）或 OpenAI 兼容服务，配置语音与密钥

### 变更

- `settings.ai` 新增可选 `visionModel`；`SCHEMA_VERSION` 9 → 10，历史数据用默认值补齐，无需改写
- `settings` 新增可选 `tts` 配置块；`SCHEMA_VERSION` 8 → 9，历史数据用默认值补齐，无需改写

### 修复

- 移动端点读入口不再因 `speechSynthesis` 检测失败而整体消失：作业清单、「读全部」、训练「读规则」的 🔊 按钮改为始终显示，点击时若设备不支持则给出提示；语音列表改为 `voiceschanged` 异步预载并缓存，`speak` 前先 `resume()` 兼容 iOS

### 文档

- 新增 `docs/remote-repo.md`：远程仓库用途、私有权限边界、如何拉取到 NAS 部署与升级、数据与代码分离说明；README「部署到 NAS」前补充入口链接

## [0.7.0] - 2026-10-29

### 新增

- 低年级可读性：作业清单每项自动配科目图标（📐数学 📖语文 🔤英语 🎨美术 🎵音乐 🏃体育 🧪科学 📌其他），家长可手动改
- 作业清单支持点读：每项一个「🔊」逐项念，标题旁「🔊 读全部」连起来念（系统语音，无需后端）
- 训练游戏「怎么玩」规则旁新增「🔊 读规则」，把玩法逐条读出来
- 作业清单与训练规则字号加大，方便识字量有限的孩子看清

### 变更

- `HomeworkItem` / `HomeworkPlanItem` 新增可选 `icon` 字段；历史清单没有图标，前端按标题自动识别
- `SCHEMA_VERSION` 7 → 8：`icon` 为可选字段，历史数据无需改写

### 文档

- `docs/data-model.md` 补 `icon` 字段与 7→8 迁移
- `docs/api.md` 补快照项 `icon` 字段说明
- `docs/training-specs.md` 补低年级可读性（图标 / 点读 / 大字号）说明
- `README.md` 孩子端功能补可读性说明

## [0.6.0] - 2026-10-29

### 新增

- 孩子端顶部新增「🔁 切换小朋友」：多孩家庭不用退到家长端，点一下即可换人
- 切换时若当前孩子有进行中的番茄钟，先弹确认「去结束 / 放弃并切换」，避免两个孩子的作业或判定混在一起
- 切换会重置连续训练与强制休息计时（换人等于新会话），并把上一个孩子的进行中会话标为 `abandoned`（离线则进待同步队列）
- 选人页默认高亮上次登录的孩子（本地键 `fk.lastKidId`），少一步选择

### 变更

- 孩子端切到另一个孩子需输入对方的 4 位 PIN，不能免验证直接换（防止看兄弟姐妹数据或冒名刷分）
- 家长中心维持现状，不新增「以某个孩子身份进入」

### 文档

- `README.md` 孩子端功能补「切换小朋友」
- `docs/persistence.md` 本地键表补 `fk.lastKidId`

## [0.5.0] - 2026-10-29

### 新增

- 家长中心新增「作业」页：按孩子、按日期提前录入作业清单（今天起 7 天，一天一份），可修改、可删除
- 孩子进入作业页时自动带出家长当天留的清单，也可以点「不用这份，我自己列」
- 清单项标记「家长」，孩子可以追加自己的任务，但不能删除家长留的项；家长页能看到孩子额外加了什么
- 家长页显示当天使用情况：未开始 / 进行中 / 已完成（正·负），以及最近更新时间
- `GET /api/state` 快照新增 `homeworkPlans`；孩子端只下发自己今天前后各一天的计划
- 新增 `PUT /api/state/homework-plan`（按孩子 + 日期 upsert）与 `DELETE /api/state/homework-plan/:id`（软删除），仅家长可用
- 家长总览新增「作业清单」入口

### 变更

- `HomeworkSession` 新增可选 `planId`，记录清单来自哪份家长计划；已有会话保持 `undefined`，按孩子自建清单处理
- 孩子端进入作业页时主动刷新一次快照，家长刚留的清单不用等本地缓存过期
- 作业计划必须在线保存，失败直接提示家长，不进入离线队列；运行中或已结算的会话不受计划修改影响
- Docker compose 镜像 tag 更新为 `0.5.0`

### 迁移

- `SCHEMA_VERSION` 6 → 7：顶层状态新增 `homeworkPlans: []`，历史数据一个字段都不改；旧会话没有 `planId`，判定与积分口径不变
- 作业计划保留 60 天，家长保存计划时清理更早的记录；孩子已经开始的会话已复制清单，不受清理影响

### 文档

- `docs/api.md` 新增作业计划接口、快照字段与错误码
- `docs/data-model.md` 新增 `HomeworkPlan` 结构、快照裁剪规则、合并规则与 6→7 迁移
- `docs/training-specs.md` 补「家长预录清单 → 孩子使用」的流程与清单锁定细则
- `README.md` 家长中心功能列表补「作业清单」

## [0.4.0] - 2026-10-29

### 新增

- 家长账号支持恢复码：创建账号时显示一次 16 位恢复码（`XXXX-XXXX-XXXX-XXXX`），忘记密码时可在登录页凭码重置，不需要账号名
- 家长中心新增「账号」页：修改账号名、修改密码、重新生成恢复码，三项都要输入当前密码
- `npm run reset:password` 离线兜底脚本：恢复码也丢失时在 NAS 上重置，打印临时密码、先备份数据、清空恢复码并踢掉家长会话
- 修改密码 / 恢复码重置后自动踢掉其他家长会话，孩子端会话保留

### 变更

- `POST /auth/register` 响应新增 `username` 与一次性的 `recoveryCode`
- `GET /auth/me` 的 `family` 增加 `hasRecoveryCode` / `recoveryUpdatedAt`
- 登录页新增「忘记密码？」入口；创建账号成功后先进入恢复码确认页，确认后才进家长中心
- Docker 镜像补拷 `scripts/`（离线重置脚本需要），compose 镜像 tag 更新为 0.4.0

### 迁移

- `SCHEMA_VERSION` 5 → 6：`FamilyRecord` 新增可选的 `recoveryHash` / `recoveryUpdatedAt`；历史账号留空（需在「账号」页生成恢复码），其余数据一个字段都不改

### 文档

- `README.md` 新增「忘记家长密码」一节与 Docker 重置命令
- `docs/api.md` 新增 `/auth/recover`、`/auth/parent/password`、`/auth/parent/username`、`/auth/parent/recovery` 与错误码
- `docs/data-model.md` 补恢复码字段、会话失效规则与 5→6 迁移
- `docs/persistence.md` 新增离线重置脚本的行为与「必须先停服务」注意事项
- `docs/architecture.md` 补 `security.ts` 与 `scripts/` 的职责

## [0.3.1] - 2026-10-29

### 修复

- 作业番茄钟在点「开始」后锁定清单：只能勾选，不能增删项或改标题，堵住「中途删掉没做的项，把负判成正」的漏洞
- 服务端对已存在的会话只接受 `items[].done` / `doneAt` 变化，增删项与改标题一律忽略；锁定的清单同时用于 `verdict` 判定
- 会话结算后清单与 `verdict` 一并冻结，事后重报不能再改判定；已结算/已作废的会话也不会被迟到的 `running` 提交拉回进行中
- 清单为空时不允许开始，避免「没有清单会被视为全部完成」直接拿到正

### 变更

- 孩子端点「开始」前会提示「清单锁定」，专注页清单提示改为「做完一项就勾一项（清单已锁定）」

### 文档

- `docs/training-specs.md` 补清单锁定规则与「至少 1 项才能开始」
- `docs/data-model.md` 补 `items` 锁定说明与合并规则
- `docs/api.md` 补 `POST /homework` 的清单锁定行为

## [0.3.0] - 2026-10-29

### 新增

- 作业番茄钟改为「正/负」判定：专注倒计时归零（或点「提前结束这一轮」）那一刻冻结清单，全部完成 = 正，否则 = 负；自检页清单只读，不能再勾
- 正：`score` 80~100（按提前量），+20 分；负：`score` 40~70（按完成率），+10 分；`sustained` / `inhibition` 维度同分
- 多轮作业按整个会话判一次：中途休息后继续，最终全部完成仍算正
- 家长记录页与 CSV 导出新增番茄钟判定（完成 / 未完成）
- 未完成时点「提前结束这一轮」会先二次确认，避免误触

### 变更

- 客户端不得直接上报 `module: pomodoro` 的记录，服务端只接受从作业会话派生的记录（堵住伪造番茄钟刷积分/徽章的口子）
- `POST /api/state/homework` 由服务端按 `items` 计算 `verdict` / `verdictAt`，忽略客户端传值

### 迁移

- `SCHEMA_VERSION` 4 → 5：历史 `done` 会话回填 `verdict: 'pass'`，已有派生记录回填 `passed: true`。升级前完成的作业按旧规则保留 20 分，不追溯扣分；新会话按正/负计分

### 文档

- `docs/training-specs.md` 重写番茄钟判定、计分与暂停策略
- `docs/data-model.md` 补 `passed` / `verdict` 字段、积分口径与 4→5 迁移
- `docs/api.md` 更新 `schemaVersion`、判定说明与「拒绝客户端 pomodoro 记录」

## [0.2.2] - 2026-10-29

### 修复

- 作业番茄钟从不写 `TrainingRecord`，导致 `homework-hero`（番茄钟 ≥3 次）与 `all-round`（六个模块各一次）两枚徽章永远无法解锁；现在服务端在会话完成后派生 `rec_hw_<会话id>` 记录，两枚徽章恢复可达
- `MODULE_POINTS.pomodoro = 20` 与家长端「番茄钟次数」因此一直是死代码 / 恒为 0；现在分别由派生记录与 `records` 统计生效
- 六维均值存在 8 / 10 / 12 三套窗口，同一孩子在不同页面看到不同雷达值，文档也自相矛盾；统一为 `DIMENSION_WINDOW = 10`，前端雷达、家长总览、孩子首页、AI 摘要与服务端徽章共用
- 服务端只裁剪 `accuracy` / `score`，`dimensionScores` 原样收下；现在每项裁剪到 0~100，未知维度丢弃，避免单个越界值抬高均值与徽章判定
- `docs/data-model.md` 的积分公式写成「模块基础分 + 20 × 已完成作业会话数」，读起来像番茄钟记录也加分；改为全部由 `records` 推导
- `evaluateBadges` 里「今日已解锁数」被重复计算（`profile.badges` 已 push，又叠加 `unlocked.length`），导致同一次判定中每日徽章上限提前触发、本可解锁的徽章被跳过；现在只按今日实际条数判断

### 变更

- 作业完成时服务端派生番茄钟记录：`score = 60 + 40 × 清单完成率`，`dimensionScores.sustained` / `inhibition` 同分，`durationSec` 取各轮专注时长之和；客户端仍只提交 `HomeworkSession`，重复上报幂等、不双计
- `recomputePoints` 不再单独累加作业会话的 20 分，改为完全按记录计分；迁移前后积分总额不变
- 新增 `server/records.ts`：`pomodoroRecordId` / `recordFromHomework` / `syncHomeworkRecords`
- `POST /api/state` 与 `POST /api/state/homework` 在合并后自动补齐/更新番茄钟记录

### 迁移

- `SCHEMA_VERSION` 3 → 4：启动时为所有 `status: 'done'` 的作业会话补一条 `module: 'pomodoro'` 记录。积分总额不变（原按会话 +20 的部分转移到记录），番茄钟次数与相关徽章从此可达。迁移函数幂等，重复执行不会产生重复记录

### 文档

- `docs/training-specs.md` 补番茄钟记录字段表与 10 条窗口说明
- `docs/data-model.md` 说明记录的两个来源、积分公式、维度裁剪与 3→4 迁移
- `docs/api.md` 更新 `schemaVersion` 示例，补派生记录与维度裁剪说明

## [0.2.1] - 2026-10-29

### 修复

- 数据文件解析或迁移失败时，原先会以空状态启动并在下次写入时覆盖原文件；现在把原文件改名保留为 `app-state.json.corrupt-<时间戳>`，日志与 `/api/health` 均可见
- 写盘失败原先只打一行日志；现在自动重试 3 次（200/400ms 退避），仍失败则记录 `storage.lastWriteError` 并给所有响应加 `x-storage-health: degraded`
- 畸形 JSON 请求体原先被 `.catch(() => ({}))` 当成空对象返回 200；现在统一走 `server/json.ts` 返回 `400 INVALID_JSON`，避免客户端误判同步成功后清空离线队列
- `POST /api/state` 超过 500 条记录 / 200 个作业会话时原先静默 `slice()` 截断；现在返回 `400 TOO_MANY_ITEMS`，客户端改为 100 条 / 50 个分批提交，每批成功后才从队列移除
- 离线队列写 `localStorage` 失败会抛错并打断上报流程；现在改为警告并保留内存队列
- `fk.snapshot`、`fk.pending`、作业草稿解析失败时不清除坏键，导致每次启动重复失败；现在删除坏键并输出警告
- 离线状态下 `refreshMe()` 也会清空登录态，离线模式形同虚设；现在只在 401/403 时登出
- 家长临时解锁时，暂存孩子会话到 `localStorage` 失败会连带让解锁失败；现在只警告并继续

### 变更

- `/api/health` 新增 `storage` 字段（`ok` / `lastWriteAt` / `lastWriteError` / `lastLoadError` / `corruptBackup`）
- 数据加载失败时进程以退出码 1 结束，不再静默启动一个空数据的服务

### 文档

- 新增 `docs/persistence.md`：写盘路径、重试与损坏恢复、同步上限、请求体校验、localStorage 键清单、离线队列边界、健康检查与备份流程
- `docs/data-model.md` 修正过时的迁移示例（只有 `0: emptyState` 一条），补损坏文件保留说明与 persistence 链接
- `docs/api.md` 补 `INVALID_JSON`、`TOO_MANY_ITEMS`、`storage` 字段、`x-storage-health` 响应头
- `docs/architecture.md` 更新可靠性与运维小节，补充 `server/json.ts` 职责
- `docs/development-standards.md` 新增「3.1 编码底线」：禁止静默吞错、假成功、覆盖唯一副本、静默截断
- `README.md` 补 `HOST` 环境变量与持久化文档入口

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
