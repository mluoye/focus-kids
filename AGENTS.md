# AGENTS.md

给所有 AI 助手与新加入的开发者：**动手之前先读完这一页，再去读 `docs/development-standards.md`。**

## 项目一句话

「专注力小卫士」：面向 6~10 岁孩子的专注力训练 + 作业自律系统。Vue 3 / Vite / Pinia / ECharts 前端，Node + Hono 后端，单家庭 NAS 部署，数据存 `app-state.json`。

## 铁律（违反即视为未完成）

1. **代码、契约、文档、版本号、CHANGELOG 必须同一次改到位。** 只改代码不改说明的改动不予交付。
2. **版本五处一致**：`package.json` 的 `version`、`package-lock.json` 的 `version`、`shared/constants.ts` 的 `APP_VERSION`、`CHANGELOG.md` 的版本标题、`docker-compose.yml` 的 `image:` 镜像标签。版本不齐时 `npm run check` 会直接报错（硬错误）。
3. **结构变更三件套**：`SCHEMA_VERSION` +1、`server/store.ts` 迁移函数、`docs/data-model.md` 迁移说明。
4. **接口只增不删**：字段废弃先加 `@deprecated`，至少保留一个发布版本。
5. **交付前跑 `npm run check`**，警告要修或在提交说明里写明原因；**发版（release）提交前必须额外跑 `npm run check:release`**，版本或 CHANGELOG 不齐会被打回。

## 改动前必须先回答

- 这次改动属于 `docs/development-standards.md` 第 3 节的哪一类（A~H）？
- 会命中哪些文档？逐个列出来再动手。
- 是否需要 bump `SCHEMA_VERSION`？如果需要，迁移函数怎么写、旧数据变成什么？

## 提交格式

```
<type>(<scope>): <中文说明>

影响面：<A~H 分类 + 更新的文档>
验证：<实际跑过的命令/操作>
```

`type`：feat / fix / docs / refactor / style / perf / test / chore / revert
`scope`：kid / parent / server / ai / data / deploy / docs / deps

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev:server` | 后端 3000（tsx 直跑源码，改后端需重启） |
| `npm run dev` | 前端 5173，`/api` 代理到 3000 |
| `npm run check` | 类型检查 + 文档一致性校验 |
| `npm run check:docs` | 只跑规范校验（默认警告不阻断） |
| `npm run check:release` | 发版前强制校验（任何警告即失败） |
| `npm run build` | 先校验再构建到 `dist/` |
| `npm start` | 生产服务，同时托管 `dist/` 与 API |
| `docker build -t focus-kids:<version> .` | 部署前验证镜像构建（含 `npm ci` / `build`） |

## 关键约束

- **不要**把 AI Key、家长密码、真实家庭数据写进代码、文档或提交。
- **不要**为了通过校验而删除校验项。
- **前端所有 `/api/*` 请求必须走 `src/api/client.ts` 的 `request()`**：统一注入鉴权、处理 401、错误归一；确需原始请求（SSE / 二进制 / 音频流）时须显式带 token 并注明理由，禁止手写裸 `fetch('/api/...')`。**新增需鉴权路由时，前端所有调用点必须同步带 `Authorization`**（Audio/二进制等确需原始请求的 `fetch` 也必须显式注入，参考 `src/utils/speech.ts`）。
- **依赖浏览器系统能力（语音 / 相机 / 媒体等）的功能**：入口不得因能力缺失整体消失，必须提供降级路径；能力检测要覆盖「API 存在 + 异步就绪 + 环境差异」；降级失败要给可操作的提示，不吞具体原因。**涉及系统能力的改动必须在目标移动环境（微信 WebView、无 GMS 安卓）冒烟验证**——PC 正常不等于移动端正常；无法真机验证时，提交说明必须写明「仅 PC 验证，移动端未实测」。
- **服务端运行时依赖**：`server/` 运行时 `import` 的包必须放 `package.json` 的 `dependencies`（容器 `npm ci --omit=dev` 只装 dependencies）；新增运行时依赖后须用 `npm ci --omit=dev` 验证可解析。
- **模型/能力开关**：接入模型能力开关（如 `visionModel`）时，必须校验模型能力并定义明确 4xx 错误码（如 `VISION_NOT_SUPPORTED`），前端处理该错误码并给出可操作提示。
- **接入第三方 / 免费端点**：在 `docs/architecture.md` 该条目注明可用环境（浏览器 / 服务端）、Node 版本、外网依赖、地域 / 时区限制。
- **不要**用空 `catch` 或默认值把失败吞掉：存储、网络、迁移失败必须留下日志，能暴露的要暴露到健康检查或界面。
- **不要**在没有迁移函数的情况下改 `SCHEMA_VERSION`。
- 演示数据文件（如 `*.json` 测试数据）不要提交。
- 当前无 CI，`check:docs` 默认不阻断；**警告视为待办，不是通过**。

## 文档地图

| 文档 | 什么时候必须改 |
| --- | --- |
| `docs/development-standards.md` | 规范本身变化 |
| `docs/architecture.md` | 目录、依赖、部署、环境变量、模块边界 |
| `docs/api.md` | 路由、字段、错误码、SSE、鉴权 |
| `docs/data-model.md` | 持久化结构、默认值、迁移 |
| `docs/persistence.md` | 存储行为、写盘失败、损坏恢复、localStorage 键、离线队列、备份 |
| `docs/training-specs.md` | 训练规则、计分、维度、徽章 |
| `CHANGELOG.md` | 每一次改动 |
| `README.md` | 用户可见的用法、部署、脚本变化 |
