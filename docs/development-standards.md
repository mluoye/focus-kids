# 开发规范

> **一句话铁律：代码改了，契约、文档、版本号、变更记录必须在同一次改动里一起改到位。**
> 只改代码不改说明的改动，一律视为**未完成**，不得提交、不得部署。

本文档对所有改动者生效：项目维护者、未来接手的人、以及任何在此仓库工作的 AI。

---

## 1. 适用范围

- 覆盖全部改动，包括功能、修复、重构、样式、文案、依赖升级、部署配置。
- 唯一例外：本地临时调试且**不会提交、不会部署**的试验（调试完必须还原）。
- 规范不是建议。第 12 节写明了违反后的处理方式。

## 2. 五条铁律

1. **一次改动 = 一次完整交付**：代码 + 共享契约 + 文档 + 版本号 + `CHANGELOG.md`，缺一不可。
2. **版本号必须变**，且 `package.json`、`shared/constants.ts` 的 `APP_VERSION`、`CHANGELOG.md` 三处完全一致。
3. **持久化结构变了**：`SCHEMA_VERSION` +1 + `server/store.ts` 新增迁移函数 + `docs/data-model.md` 更新，三者同时存在才允许发布。
4. **接口只增不删**：字段废弃必须先标记 `@deprecated` 并保留至少一个发布版本。
5. **交付前必须跑 `npm run check`**：警告要逐条处理或写明不处理的理由。

## 3. 改动分类与影响半径（强制对照表）

先判定改动属于哪一类，再按「必须同步」列逐项完成。一行命中即触发，多行命中就都要做。

| 编号 | 分类 | 判定标准 | 必须同步 |
| --- | --- | --- | --- |
| A | 功能 / 行为 | 用户能感知的新能力或行为变化 | `CHANGELOG`（新增 / 变更）+ 版本 + 对应主题文档 |
| B | 缺陷修复 | 修 bug，不新增接口、不改结构 | `CHANGELOG`（修复）+ patch 版本 |
| C | 接口契约 | 路由、请求/响应字段、错误码、鉴权、SSE 格式 | `docs/api.md` + `shared/types.ts` + `CHANGELOG` + 第 5 节兼容规则 |
| D | 数据结构 | 持久化字段、默认值、枚举值、迁移 | `SCHEMA_VERSION` + 迁移函数 + `docs/data-model.md` + `CHANGELOG`（写明迁移） |
| E | 玩法 / 计分 | 训练规则、题目生成、评分公式、维度权重、徽章条件 | `docs/training-specs.md` + `CHANGELOG` + 版本 |
| F | 架构 / 部署 | 目录结构、依赖、环境变量、Docker、端口、数据文件位置 | `docs/architecture.md` + `README.md` + `CHANGELOG` |
| G | 样式 / 文案 | 无逻辑变化的视觉或文字调整 | `CHANGELOG`（变更）+ patch 版本 |
| H | 纯文档 / 注释 | 只改说明文字，不影响任何行为 | `CHANGELOG`（文档）+ patch 版本 |

补充规则：

- **未命中任何一行**时，必须在提交说明里写「影响面：无」并给出一句理由。
- 命中 D 时同时命中 C 和 A：结构变更往往伴随接口变化，不要漏。
- 分类判定结果写进提交说明，方便回溯。

## 4. 版本规则

### 4.1 发版节奏

**每次改动即发版**：改完就把 `CHANGELOG` 的 `Unreleased` 内容落到新版本号并重启服务，保证「版本号 = 线上代码」。不允许长期存在「代码比版本号新」的状态。

### 4.2 `APP_VERSION`（语义化版本）

| 改动 | 升位 | 示例 |
| --- | --- | --- |
| 新功能、新页面、新接口 | minor | `0.2.0` → `0.3.0` |
| 修复、样式、文案、文档、依赖、重构 | patch | `0.2.0` → `0.2.1` |
| 破坏性变更（0.x 阶段） | minor + `BREAKING` 标注 | `0.3.0`，`CHANGELOG` 条目加 **BREAKING** |
| 发布 1.0.0 之后 | 严格 semver：破坏性 → major | — |

### 4.3 `SCHEMA_VERSION`（独立递增）

- 只有**持久化结构**（`app-state.json` 里实际存储的字段/类型/语义）变化时才 +1。
- 纯前端状态、纯接口字段、纯计算逻辑变化，不碰它。
- 递增必须同时提供：迁移函数、`normalize()` 兜底、`docs/data-model.md` 的迁移记录。
- 不允许为了「看起来整齐」而空跳版本。

### 4.4 `CHANGELOG.md` 格式

```markdown
## [Unreleased]            ← 永远保留，最新改动先写这里

## [0.2.1] - 2026-11-02    ← 发布时落版本，日期为发布当天
### 新增
- ...
```

- 小节只使用固定词表：`新增` / `变更` / `修复` / `弃用` / `移除` / `安全` / `文档` / `迁移` / `已知限制`。
- 每条写「用户/维护者能感知的差异」，不写「修改了某文件」。
- 结构变更必须单独写「迁移」小节，说明旧数据会发生什么。

## 5. 接口兼容与弃用

适用范围：`server/routes/**`、`shared/types.ts`、SSE 事件格式、错误码。

1. **只增不删**：新增响应字段必须可选或带默认值；新增请求字段必须可缺省。
2. **废弃流程**：
   - 在 `shared/types.ts` 用 `/** @deprecated 原因 + 替代字段 */` 标注；
   - `docs/api.md` 对应位置标注「已弃用」；
   - `CHANGELOG` 写进「弃用」小节；
   - **至少跨一个发布版本**后才允许删除；
   - 删除时写进「移除」小节并标 **BREAKING**。
3. **错误码语义不改**：新增错误码可以，改旧错误码含义不行。
4. **前端必须容忍旧数据**：读取处用默认值/`normalize` 兜底，不允许因为字段缺失白屏。
5. `npm run check:docs` 会扫描 `@deprecated` 标记，要求 `CHANGELOG` 有对应记录。

## 6. 数据结构变更流程（五步，顺序不可乱）

1. 改 `shared/types.ts`（类型 + 注释）。
2. `shared/constants.ts` 的 `SCHEMA_VERSION` +1。
3. `server/store.ts` 的 `migrations` 增加 `<旧版本号>: (s) => ...` 条目。
4. `server/store.ts` 的 `normalize()` 补默认值与容错。
5. `docs/data-model.md` 写清：新字段、默认值、旧数据迁移结果、是否可回退。

> 缺少任意一步，`check:docs` 会报警告；带警告上线属于违规。

## 7. 提交流程（七步）

1. **判定分类**：对照第 3 节确定 A~H。
2. **改代码**：功能与修复本身。
3. **改契约**：`shared/types.ts`、`shared/constants.ts`。
4. **改文档**：按影响半径表逐项更新，不凭感觉。
5. **改版本**：`package.json` + `APP_VERSION` + `CHANGELOG` 三处同步。
6. **跑校验**：`npm run check`（类型检查 + 文档校验），必要时 `npm run build` 并实际启动验证。
7. **提交**：按第 8 节格式，正文写「影响面」与「验证方式」。

## 8. 提交规范

```
<type>(<scope>): <中文说明>

影响面：<A~H 分类 + 涉及的文档>
验证：<实际执行过的命令/操作>
```

| type | 用途 |
| --- | --- |
| `feat` | 新功能 |
| `fix` | 缺陷修复 |
| `docs` | 只改文档 |
| `refactor` | 不改行为的重构 |
| `style` | 样式 / 格式 |
| `perf` | 性能 |
| `test` | 测试 |
| `chore` | 构建、依赖、工具 |
| `revert` | 回滚 |

- `scope` 取值：`kid` / `parent` / `server` / `ai` / `data` / `deploy` / `docs` / `deps`。
- 破坏性变更在 type 后加 `!`，例如 `feat(api)!: 移除旧字段`。
- **一个功能一个提交**，不要把「功能 + 顺手重构 + 调格式」混在一起。
- 提交前确认没有把 `.env`、`app-state.json`、AI Key 带进仓库。

## 9. 自动化校验

### 9.1 命令

| 命令 | 作用 |
| --- | --- |
| `npm run check:docs` | 规范一致性检查（见下） |
| `npm run check` | `typecheck` + `check:docs` |
| `npm run build` | 自动先跑 `check:docs`，再构建 |

### 9.2 `check:docs` 检查项

1. `package.json` 的 `version` 与 `APP_VERSION` 一致；
2. `CHANGELOG` 存在 `Unreleased` 段，且存在当前版本段、日期格式合法、条目非空；
3. 最新发布版本号等于 `APP_VERSION`；
4. `SCHEMA_VERSION` 的每一级都有对应迁移函数；
5. `docs/api.md` 覆盖所有已注册路由（含挂载前缀与方法）；
6. `docs/training-specs.md` 覆盖 `MODULES` 中全部模块名；
7. `docs/data-model.md` 覆盖顶层状态字段与 `schemaVersion`；
8. `@deprecated` 字段在 `CHANGELOG` 中有记录；
9. `AGENTS.md`、本文件存在。

### 9.3 失败处理

- 默认**只警告不阻断**（退出码 0），避免改文档时被卡死。
- `tsx scripts/check-docs.ts --strict` 时警告即失败，预留给未来 CI / 发版前检查。
- 警告不是噪音：要么修，要么在提交说明里写明「已知不合规原因」。

## 10. AI 与新成员执行约束

**必读顺序**：`AGENTS.md` → 本文件 → `docs/architecture.md` → 与你改动相关的专题文档。

必须：

- 动手前先说清「这次改动属于哪一类、会动哪些文档」。
- 改完自检第 11 节清单，并如实报告哪些验证真的跑过。
- 不确定归类或兼容策略时**先问**，不要猜。

禁止：

- 只改代码、不改文档；
- 私自 +1 `SCHEMA_VERSION` 却不写迁移；
- 直接删除 / 重命名已发布字段而不走弃用；
- 改完不跑 `npm run check`、不写 `CHANGELOG`；
- 把 AI Key、家长密码、真实家庭数据写进代码、文档、提交；
- 为了让检查通过而删检查项。

## 11. 提交前自查清单

复制到提交说明或 PR 描述里逐项勾选：

- [ ] 已判定改动分类（A~H）
- [ ] 按影响半径表更新了对应文档
- [ ] `APP_VERSION` 已升，`package.json` / 常量 / `CHANGELOG` 三处一致
- [ ] 结构变更：`SCHEMA_VERSION` + 迁移函数 + `data-model.md` 齐全
- [ ] 接口变更：`api.md` 已更新，废弃字段走了弃用流程
- [ ] `CHANGELOG` 有新条目（固定词表小节）
- [ ] `npm run check` 通过，警告已处理或已说明
- [ ] 实际运行验证过（不只是编译通过）
- [ ] 提交信息符合第 8 节格式

## 12. 违规处理

- 未按规范的改动**视为未完成**，即使功能可用也不合并、不部署。
- 已经部署的：立刻补一次「规范补齐」提交（文档 + 版本 + CHANGELOG），不追改历史版本号。
- 反复违规：在 `AGENTS.md` 增加更严格的针对性约束，并考虑把对应检查项升级为 `--strict`。

## 附录：关键文件地图

| 位置 | 职责 | 改动时必须想到 |
| --- | --- | --- |
| `shared/types.ts` | 前后端共享契约 | `docs/data-model.md`、`docs/api.md` |
| `shared/constants.ts` | 版本号、模块、维度、徽章、默认限制 | `CHANGELOG`、`docs/training-specs.md` |
| `server/store.ts` | 持久化、迁移、normalize | `SCHEMA_VERSION`、`docs/data-model.md` |
| `server/routes/**` | HTTP 接口 | `docs/api.md` |
| `server/ai/**` | AI 提示词与流式输出 | `docs/architecture.md`、`docs/api.md` |
| `src/training/**` | 训练引擎、计分、统计 | `docs/training-specs.md` |
| `src/views/kid/**` | 孩子端页面与游戏 | `docs/training-specs.md`（若涉及规则） |
| `src/views/parent/**` | 家长端页面 | `docs/api.md`（若新增数据依赖） |
| `Dockerfile` / `docker-compose.yml` | 部署 | `README.md`、`docs/architecture.md` |
