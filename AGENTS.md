# AGENTS.md

给所有 AI 助手与新加入的开发者：**动手之前先读完这一页，再去读 `docs/development-standards.md`。**

## 项目一句话

「专注力小卫士」：面向 6~10 岁孩子的专注力训练 + 作业自律系统。Vue 3 / Vite / Pinia / ECharts 前端，Node + Hono 后端，单家庭 NAS 部署，数据存 `app-state.json`。

## 铁律（违反即视为未完成）

1. **代码、契约、文档、版本号、CHANGELOG 必须同一次改到位。** 只改代码不改说明的改动不予交付。
2. **版本三处一致**：`package.json` 的 `version`、`shared/constants.ts` 的 `APP_VERSION`、`CHANGELOG.md` 的版本标题。
3. **结构变更三件套**：`SCHEMA_VERSION` +1、`server/store.ts` 迁移函数、`docs/data-model.md` 迁移说明。
4. **接口只增不删**：字段废弃先加 `@deprecated`，至少保留一个发布版本。
5. **交付前跑 `npm run check`**，警告要修或在提交说明里写明原因。

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
| `npm run build` | 先校验再构建到 `dist/` |
| `npm start` | 生产服务，同时托管 `dist/` 与 API |

## 关键约束

- **不要**把 AI Key、家长密码、真实家庭数据写进代码、文档或提交。
- **不要**为了通过校验而删除校验项。
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
| `docs/training-specs.md` | 训练规则、计分、维度、徽章 |
| `CHANGELOG.md` | 每一次改动 |
| `README.md` | 用户可见的用法、部署、脚本变化 |
