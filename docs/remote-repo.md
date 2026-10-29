# 远程仓库与部署说明

## 仓库信息

- 地址：`https://github.com/mluoye/focus-kids`（私有 `focus-kids`）
- 默认分支：`main`；本机 `origin` 已配置，`git push` / `git pull` 直接使用
- 用途：代码与文档的版本管理、跨设备同步、作为 NAS 部署的代码来源

## 私有权限

- 仓库为 **Private**，只有仓库所有者能查看和推送，公开搜索不到。
- 仓库里**只存代码、文档、Docker 配置和脚本**，不存任何运行数据。

| 内容 | 是否进仓库 | 说明 |
| --- | --- | --- |
| 代码 / 文档 / Dockerfile / compose / 脚本 | ✅ | 正常提交 |
| 运行数据 `app-state.json` | ❌ | 数据在 Docker 命名卷或本地 `.data/`，不进 git（`.gitignore` 已排除 `.data`） |
| 密钥 `.env` / `AI_API_KEY` | ❌ | 用环境变量注入，不提交；`.gitignore` 已排除 `.env` |
| `node_modules` / `dist` | ❌ | 构建产物，由 `npm ci` / `npm run build` 生成 |
| 演示数据 / 日志 | ❌ | `*.log`、测试临时文件均不提交 |

> 重要：即使仓库私有，**也绝不要把 `app-state.json`、`.env`、真实 AI Key、家长密码写进提交**。家庭数据只存在服务器本地。

## 拉取到 NAS 部署

前置条件：NAS 上装好 Docker 与 Git，并能让该 NAS 访问 GitHub（私有仓库需要凭据）。

### 首次部署

```bash
# 1. 克隆（私有仓库需要 HTTPS PAT 或 SSH key）
git clone https://github.com/mluoye/focus-kids.git focus-kids
cd focus-kids

# 2. 配置环境（可选：AI Key 等，推荐用 docker compose 的 environment 注入，见 docker-compose.yml）

# 3. 构建并启动
docker compose up -d --build
```

访问 `http://<NAS-IP>:3000`。

### 升级更新

```bash
# 1. 备份数据卷（升级前必做，见 docs/persistence.md）
docker run --rm -v focus-kids-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/focus-kids-backup.tar.gz -C /data .

# 2. 拉新代码
git pull

# 3. 重建并重启
docker compose up -d --build
```

- 数据在命名卷 `focus-kids-data`，`git pull` / 重建容器**不会丢数据**；只有 `docker compose down -v` 才会清空。
- 启动后访问 `/api/health`，确认 `version` / `schemaVersion` / `storage.ok` 符合预期（迁移会自动执行，升级前务必先备份）。
- 若启动失败或数据异常：停服务、用备份覆盖 `/data/app-state.json`、回滚到上一个 `git` 版本。

### 数据与代码分离

- 代码：跟随 git 仓库，`git pull` 升级。
- 数据：`/data/app-state.json`（卷内），**不在仓库里**；备份用上面的 tar 命令，或 `npm run reset:password` 生成的 `.bak-*`。
- 恢复：把 `app-state.json` 放回卷内，服务端启动时按 `schemaVersion` 自动迁移。
