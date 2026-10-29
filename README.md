# 专注力小卫士 🛡️

为 **6~10 岁小学生** 设计的「认知专注力 + 作业自律习惯」训练系统。
游戏为训练服务，训练向学习迁移，数据可视化成长，家长可控防沉迷，并接入大模型实现个性化智能辅导。

## 功能一览

| 模块 | 训练维度 | 说明 |
| --- | --- | --- |
| 🍅 作业番茄钟 | 持续注意力 · 冲动抑制 | 大脑热身 → 任务拆解（可 AI 辅助，开始后锁定清单）→ 专注计时 → 到点判定正/负 → 自检闭环 |
| 🌈 色词大挑战（Stroop） | 选择性注意力 · 冲动抑制 | 字义与颜色冲突，按颜色作答 |
| 🔍 抗干扰捕捉 | 选择性注意力 · 持续注意力 | 只抓目标图形，误点干扰项扣分 |
| 🧩 N-Back 双任务 | 工作记忆 · 分配注意力 | 位置 + 颜色双轨 2-Back |
| 🔀 分类切换 | 转换注意力 · 冲动抑制 | 每 4 题切换规则，测量切换代价 |
| 🎯 多线索追踪 | 分配注意力 · 持续注意力 | 多目标追踪 + 听觉数字回忆 |

其他能力：

- **成长可视化**：六维注意力雷达、7 天趋势、模块均分、徽章墙（ECharts 按需引入）
- **家长中心**：总览报表、作业清单（提前录入 + 查看当天完成情况）、训练记录（可导出 CSV）、防沉迷设置、孩子档案、AI 配置
- **家长预录作业**：按孩子和日期提前录好清单（今天起 7 天），孩子进作业页自动带出；孩子可追加自己的任务，家长留的项不能删，开始后清单照旧锁定
- **多孩切换**：孩子端顶部「切换小朋友」一键换人（需输对方 4 位 PIN），选人页记住上次登录的孩子；有作业进行中会先确认，避免数据交叉
- **低年级可读性**：作业清单按科目配图标、逐项点读（系统语音）、大字号；训练规则可点读，孩子认字不全也能自己看懂
- **AI 四项能力**：训练鼓励、分心归因、作业启发式陪练（文本 + 拍照）、家长周报
- **防沉迷**：每日训练上限、连续训练强制休息、每日徽章上限、禁用时段（番茄钟不受限）
- **离线可用**：localStorage 缓存 + 待同步队列，联网后自动合并
- **单家庭自托管**：账号、密码、训练数据全部保存在自己的服务器

## 技术栈

Vue 3 + Vite + Pinia + ECharts + 原生 CSS3 ｜ Node + Hono ｜ Docker Compose ｜ 单文件 JSON 持久化

## 快速开始（开发）

```bash
npm install
# 终端 1：后端（默认 3000）
npm run dev:server
# 终端 2：前端（默认 5173，/api 已代理到 3000）
npm run dev
```

打开 http://localhost:5173 ，首次进入创建家长账号 → 创建孩子档案（4 位 PIN）→ 孩子登录开始训练。

环境变量（可选）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务端口 |
| `HOST` | `0.0.0.0` | 监听地址，反向代理场景可改为 `127.0.0.1` |
| `DATA_FILE` | `./.data/app-state.json` | 数据文件路径 |
| `AI_BASE_URL` | 空 | OpenAI 兼容地址（优先级高于页面配置） |
| `AI_MODEL` | 空 | 模型名 |
| `AI_API_KEY` | 空 | API Key |
| `AI_ENABLED` | `true` | 设为 `false` 可整体关闭 AI |
| `TZ` | 系统时区 | 容器内建议 `Asia/Shanghai` |

## 忘记家长密码

两条路，优先第一条：

1. **恢复码**：创建账号时会显示一次恢复码（`XXXX-XXXX-XXXX-XXXX`），请抄在纸上。忘记密码时打开登录页 →「忘记密码？用恢复码重置」，输入恢复码和新密码即可，不需要账号名。所有家长设备会被要求重新登录，孩子端不受影响。
2. **NAS 本地重置（恢复码也丢了）**：必须先停服务，脚本直接改 `app-state.json`：

```bash
# 本机 / NAS 上直接跑
npm run reset:password

# Docker Compose
docker compose stop
docker compose run --rm focus-kids npm run reset:password
docker compose up -d
```

脚本会先把数据备份成 `app-state.json.bak-<时间戳>`，然后打印一个**临时密码**，并清空旧恢复码、踢掉所有家长会话。用临时密码登录后，到「家长中心 → 账号」改成自己的密码，并重新生成恢复码。

> 忘记账号名也可以：恢复码不依赖账号名；脚本输出里也会打印当前账号名。
>
> 孩子忘记 PIN：家长登录后在「孩子档案」里直接改。若家长也进不去，先用上面任一方式恢复家长账号。

## 部署到 NAS（Docker Compose）

```bash
docker compose up -d --build
```

访问 `http://<NAS-IP>:3000`。数据结构：

- 镜像内运行 `node`（tsx 直接执行 TypeScript 服务端）
- 数据保存在命名卷 `focus-kids-data` 的 `/data/app-state.json`
- `docker compose down`、重建容器、升级镜像都**不会丢数据**；只有 `docker compose down -v` 或手动删除卷才会清空

备份：

```bash
docker run --rm -v focus-kids-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/focus-kids-backup.tar.gz -C /data .
```

恢复时把 `app-state.json` 放回卷内即可，服务端会在启动时按 `schemaVersion` 自动迁移。

## AI 配置

进入「家长中心 → AI 设置」：

1. 填写 **Base URL**（例如 `https://api.deepseek.com/v1`）、**模型名**、**API Key**
2. 点击「测试连接」确认可用
3. 打开「启用 AI 能力」

也支持本地 Ollama（`http://127.0.0.1:11434/v1`，需容器能访问宿主机，可改为 NAS 内网地址）。
拍照识题会以图片直传支持视觉的模型；不支持视觉的模型请用文字输入。OCR 接口已预留，见 [docs/api.md](docs/api.md)。

## 项目结构

```
server/             Hono 服务：认证、状态同步、AI 代理、文件存储
shared/             前后端共享类型与常量（模块、维度、徽章、默认限制）
src/
  api/              fetch 封装 + SSE 流解析
  stores/           session / data / guard / ui
  training/         训练引擎工具、统计与 AI 摘要
  views/kid/        孩子端：首页、训练、番茄钟、成长、AI 陪练
  views/kid/games/  五个训练游戏组件
  views/parent/     家长端：总览、作业清单、记录、防沉迷、档案、AI 设置
docs/               架构、接口、数据模型、训练规则、开发规范
```

## 文档与版本约定

完整规范见 [docs/development-standards.md](docs/development-standards.md)，动手前请先读它（AI 与新人先读 [AGENTS.md](AGENTS.md)）。

**铁律：代码、契约、文档、版本号、`CHANGELOG` 必须同一次改到位，只改代码不改说明视为未完成。**

| 改动类型 | 必须同步 |
| --- | --- |
| 接口 / 字段 / 错误码 | `docs/api.md` + `shared/types.ts` + `CHANGELOG`（只增不删，废弃先标 `@deprecated`） |
| 持久化结构 | `SCHEMA_VERSION` +1 + `server/store.ts` 迁移函数 + `docs/data-model.md` |
| 训练规则 / 计分 / 徽章 | `docs/training-specs.md` |
| 目录 / 依赖 / 部署 | `docs/architecture.md` + 本文件 |
| 任何改动 | `APP_VERSION` 升位 + `CHANGELOG.md` 条目 |

- 发版节奏：**每次改动即发版**，`package.json`、`shared/constants.ts`、`CHANGELOG.md` 三处版本号保持一致
- 交付前跑 `npm run check`（类型检查 + 规范校验），警告需处理或在提交说明中写明理由
- 存储行为、损坏恢复、备份与离线队列见 [docs/persistence.md](docs/persistence.md)

## 安全说明

- 家长密码、孩子 PIN 使用 Node `scrypt` 加盐散列存储，不存明文
- 会话使用随机 token，服务端持久化，默认 30 天有效
- AI Key 仅保存在服务端，前端只显示掩码
- 暂无 HTTPS：NAS 内网使用 http；如需外网访问，请在前面加一层反向代理并启用 HTTPS

## 脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动前端开发服务器 |
| `npm run dev:server` | 启动后端（热重载） |
| `npm run build` | 构建前端到 `dist/`（构建前自动跑规范校验） |
| `npm start` | 启动生产服务（同时托管 `dist/`） |
| `npm run typecheck` | 类型检查 |
| `npm run check:docs` | 规范校验：版本 / CHANGELOG / 迁移链 / 文档覆盖（默认警告不阻断） |
| `npm run check` | `typecheck` + `check:docs`，提交前必跑 |

## License

私有项目，仅供家庭内部使用。
