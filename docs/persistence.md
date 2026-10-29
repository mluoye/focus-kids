# 数据持久化

本文档描述「数据存在哪、怎么写、坏了怎么办」。数据模型字段本身见 [data-model.md](data-model.md)，这里只讲存储行为与故障处置。

## 1. 存储介质一览

| 位置 | 内容 | 生命周期 |
| --- | --- | --- |
| `app-state.json`（服务端） | 家庭账号、孩子档案、训练记录、作业会话、设置、会话 token | 永久，直到手动删除 |
| Docker 命名卷 `focus-kids-data` | 挂载到容器 `/data`，实际存 `app-state.json` | 跟随卷，重建容器不丢 |
| `localStorage`（浏览器） | 登录 token、快照缓存、离线队列、作业草稿 | 跟浏览器，清缓存即丢 |
| `sessionStorage`（浏览器） | 连续训练计时起点 `fk.continuousStart` | 关闭标签页即清 |

服务端是**唯一权威**。浏览器里的所有内容都是缓存或待同步队列，丢了可以从服务端恢复（作业草稿除外，见第 7 节）。

## 2. 服务端写入路径

```
请求 → 改内存 state → saveState()
  → 序列化 JSON（缩进 2）
  → 进入串行写队列（writeChain）
  → 写 app-state.json.<pid>.tmp
  → rename 覆盖 app-state.json
```

- **原子写**：先写临时文件再 `rename`，断电/容器被杀不会留下半个 JSON。
- **串行队列**：所有写入排队执行，并发请求不会互相覆盖。
- **失败重试**：最多 3 次，退避 200ms / 400ms。
- **失败暴露**：重试仍失败时记 `lastWriteError`，并同时体现在
  - 日志：`[store] 写入数据文件失败（已重试 3 次）`
  - `GET /api/health` 的 `storage.ok = false` 与 `storage.lastWriteError`
  - 所有响应头 `x-storage-health: degraded`

> 写盘失败时接口仍然返回 200（内存状态已生效），但客户端与监控可以通过上面的信号发现异常。这是有意的取舍：磁盘满时不该让孩子正在做的训练直接报错。

## 3. 读取与损坏恢复

启动时 `loadState()`：

| 情况 | 处理 |
| --- | --- |
| 文件不存在（`ENOENT`） | 使用空状态，首次写入时创建 |
| JSON 解析失败 | **把原文件改名为 `app-state.json.corrupt-<时间戳>`**，再以空状态启动 |
| 迁移函数抛错 | 同上，保留原文件 |
| 正常 | 按 `schemaVersion` 逐级迁移，再 `normalize()` 兜底 |

损坏时日志会打印备份路径，并记录到 `storage.corruptBackup`（开发环境可见）。**不会**用空状态直接覆盖原文件，这是 0.2.1 修复的静默丢数据问题。

人工恢复步骤：

```bash
# 1. 看健康检查确认是否发生过损坏
curl -s http://<host>:3000/api/health | jq .storage

# 2. 停服务，检查 corrupt 文件
docker compose stop
docker run --rm -v focus-kids-data:/data alpine ls -l /data

# 3. 修复 JSON（缺右括号、截断等）后改回 app-state.json
docker run --rm -v focus-kids-data:/data alpine \
  sh -c "cp /data/app-state.json.corrupt-<ts> /data/app-state.json"
```

## 4. 迁移

- `SCHEMA_VERSION` 只在持久化结构变化时 +1。
- `server/store.ts` 的 `migrations` 必须为每个旧版本提供 `旧版本号 → 新结构` 函数。
- 迁移在内存中完成，随后由下一次 `saveState()` 落盘；因此**升级前必须备份**。
- 迁移函数必须幂等、不得依赖网络，旧字段缺失时要给默认值。

## 5. 单次同步上限

| 限制 | 值 | 行为 |
| --- | --- | --- |
| `POST /api/state` 记录数 | 500 | 超出返回 `400 TOO_MANY_ITEMS`，不静默截断 |
| `POST /api/state` 作业会话数 | 200 | 同上 |
| 请求体大小 | 8MB | 超出返回 `413` |
| 客户端分批 | 100 条记录 / 50 个作业会话 | 每批成功后才从离线队列移除 |

> 0.2.1 之前超出上限会被 `slice()` 静默丢弃，而客户端照样清空队列，属于数据丢失。现在改为显式报错 + 客户端分批。

## 6. 请求体校验

所有写接口都用 `server/json.ts` 的 `readJson()`：

| 输入 | 结果 |
| --- | --- |
| 空 body | 视为 `{}`（兼容无参数 POST） |
| 合法 JSON 对象 | 正常处理 |
| 畸形 JSON / 数组 / 标量 | `400 INVALID_JSON` |

以前畸形 JSON 会被 `.catch(() => ({}))` 当成空对象返回 200，客户端据此认为同步成功并清空离线队列——同样是静默丢数据。

## 7. 浏览器端存储

### 7.1 键清单

| 键 | 介质 | 内容 | 何时清除 |
| --- | --- | --- | --- |
| `fk.token` | localStorage | 会话 token | 退出登录、401 |
| `fk.role` | localStorage | `parent` / `child` | 退出登录 |
| `fk.profileId` | localStorage | 当前孩子 id | 退出登录、切回家长 |
| `fk.lastKidId` | localStorage | 上次登录的孩子 id（选人页默认高亮） | 切换后更新；无则不生效 |
| `fk.childSession` | localStorage | 家长临时解锁前的孩子会话，用于「返回孩子模式」 | 返回孩子模式、离开家长中心 |
| `fk.snapshot` | localStorage | 最近一次快照缓存，离线时用 | 登出、`resetLocal()` |
| `fk.pending` | localStorage | 待同步的记录与作业会话 | 同步成功后按批移除 |
| `fk.homeworkDraft.<profileId>` | localStorage | 作业进行中草稿，按孩子隔离 | 完成、作废、超过 2 小时、清空重来 |
| `fk.continuousStart` | **sessionStorage** | 连续训练计时起点，用于强制休息 | 休息、跨天、关闭标签页 |

### 7.2 容错

- `fk.snapshot` / `fk.pending` 解析失败：打 `console.warn` 并**删除该键**，回退到默认值，避免每次启动重复失败。
- 写 `localStorage` 失败（配额满、隐私模式）：只警告，不打断业务流程；离线队列退化为仅内存保存，刷新会丢，日志里有明确提示。
- `fk.homeworkDraft.*` 解析失败：删除该键并返回 `null`。
- 离线队列同步失败：整批保留，下次 `fetchState()` 成功后自动重试；只有真正提交成功的那一批才会被移除。

### 7.3 离线队列边界

- 入队：`saveRecord` / `saveHomework` 遇到 `status === 0` 或 `code === 'OFFLINE'`。
- 出队：`POST /api/state` 成功返回后，按 id 精确移除已提交项。
- 不清空的情况：网络错误、401、400（含 `INVALID_JSON`、`TOO_MANY_ITEMS`）——队列原样保留，等下次重试或人工处理。
- 队列没有硬上限；如果长期离线导致体积过大，浏览器配额可能先耗尽，届时会出现 7.2 的写入失败警告。

## 8. 健康检查与监控

`GET /api/health` 的 `storage` 字段：

```json
{
  "ok": true,
  "lastWriteAt": 1761712345678,
  "lastWriteError": null,
  "lastLoadError": null,
  "corruptBackup": null
}
```

- `ok: false` 表示最近一次写盘失败，需要检查磁盘空间与挂载权限。
- `lastLoadError` / `corruptBackup` 只在本次进程启动时发生过损坏才有值。
- 响应头 `x-storage-health: degraded` 与 `ok: false` 同步出现。

## 9. 增长与保留

- `records`、`homework` 只增不减，没有自动清理；单家庭规模下数万条以内无压力。
- 服务端启动时清理过期会话；`/api/auth/logout` 删除当前 token。
- 长期使用建议每年导出一份存档（家长端记录页 CSV），再考虑归档旧记录——目前**没有**自动清理功能，不要假设它会自己变小。

## 10. 已知边界

- **单实例**：同一 `DATA_FILE` 只能由一个进程写。临时文件名带 pid，但没有跨进程文件锁；同时起两个实例会互相覆盖。
- **无加密**：文件是明文 JSON，口令是 scrypt 散列。备份文件同样包含隐私数据，注意存放位置。
- **无异地副本**：只有本地卷 + 手动备份，没有自动上云。
- **删除不可恢复**：`DELETE /api/profiles/:id` 会连带删除该孩子的记录与作业会话。

## 11. 家长密码重置（离线脚本）

`npm run reset:password` 直接修改 `app-state.json`，用于「密码和恢复码都忘了」的兜底：

```bash
# 必须先停服务，否则运行中的进程会用内存状态覆盖脚本的修改
docker compose stop
docker compose run --rm focus-kids npm run reset:password
docker compose up -d
```

脚本行为：

1. 先把原文件复制为 `app-state.json.bak-<时间戳>`（失败则中止，不会继续写）。
2. 把 `family.passwordHash` 换成随机临时密码的 scrypt 哈希，并在终端打印明文。
3. 删除 `family.recoveryHash` / `recoveryUpdatedAt`（旧恢复码立即失效）。
4. 从 `sessions` 中移除所有 `role: 'parent'` 的会话；孩子端会话保留。
5. JSON 不合法或没有家长账号时直接报错退出，不会写入。

## 12. 备份、恢复与升级

```bash
# 备份（建议升级前执行）
docker run --rm -v focus-kids-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/focus-kids-backup.tar.gz -C /data .

# 恢复
docker compose stop
docker run --rm -v focus-kids-data:/data -v "$PWD":/backup alpine \
  sh -c "rm -f /data/app-state.json && tar xzf /backup/focus-kids-backup.tar.gz -C /data"
docker compose start
```

升级流程：

1. 备份数据卷。
2. 拉新镜像/新代码，确认 `CHANGELOG` 里的「迁移」小节。
3. 启动，访问 `/api/health` 确认 `version`、`schemaVersion`、`storage.ok`。
4. 若启动失败或数据异常，停服务、用备份覆盖 `app-state.json`、回滚镜像。
