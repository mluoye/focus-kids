# 数据持久化

本文档描述「数据存在哪、怎么写、坏了怎么办」。数据模型字段本身见 [data-model.md](data-model.md)，这里只讲存储行为与故障处置。

## 1. 存储介质一览

| 位置 | 内容 | 生命周期 |
| --- | --- | --- |
| `app-state.db`（服务端，SQLite） | 家庭账号、孩子档案、训练记录、作业会话、作业计划、设置、会话 token | 永久，直到手动删除 |
| `app-state.db-wal` / `app-state.db-shm` | SQLite WAL 预写日志与共享内存（`journal_mode = WAL` 自动管理） | 跟随主库，checkpoint 后合并 |
| Docker 命名卷 `focus-kids-data` | 挂载到容器 `/data`，实际存 `app-state.db` | 跟随卷，重建容器不丢 |
| `localStorage`（浏览器） | 登录 token、快照缓存、离线队列、作业草稿 | 跟浏览器，清缓存即丢 |
| `sessionStorage`（浏览器） | 连续训练计时起点 `fk.continuousStart` | 关闭标签页即清 |

服务端是**唯一权威**。浏览器里的所有内容都是缓存或待同步队列，丢了可以从服务端恢复（作业草稿除外，见第 7 节）。

## 2. 服务端写入路径

```
请求 → 取该家庭 FamilyCache（懒加载，首次从 SQLite 读入内存）
  → 改内存 cache
  → persistFamily(familyId)
  → better-sqlite3 同步事务：按 id UPSERT profiles / training_records /
    homework_sessions / homework_plans / settings
  → 事务提交即落盘（WAL 先写日志，checkpoint 异步合并）
```

- **事务原子性**：`persistFamily` 用单个 SQLite 事务写全部子表，断电/容器被杀不会留下半写状态。
- **WAL 模式**：读不阻塞写、写不阻塞读，适合 NAS 单进程多请求；`busy_timeout = 5000` 应对偶发锁竞争。
- **外键级联**：`foreign_keys = ON`，删除孩子档案时由 `ON DELETE CASCADE` 清理子表。
- **内存缓存**：每个家庭一个 `FamilyCache`，懒加载、跨请求复用；写操作同步刷入 SQLite，缓存与库始终保持一致。

> 写库失败时接口仍然返回 200（内存状态已生效），但客户端与监控可以通过健康检查信号发现异常。这是有意的取舍：磁盘满时不该让孩子正在做的训练直接报错。

### 关键操作的一致性

家长设置保存、孩子档案增删等关键操作同样经 `persistFamily` 同步落盘：

- 写入失败会抛出并由路由返回 500，客户端能感知到「设置没存上」
- 不经过任何 debounce 队列，事务提交即返回
- 适用场景：家长明确点击保存、删除等不可逆操作；训练记录上报同样同步落盘（SQLite 同步写足够快，不中断训练）

## 3. 读取与损坏恢复

启动时 `initDb()`：

| 情况 | 处理 |
| --- | --- |
| 库文件不存在 | 新建空库并建表，首次写入时填充 |
| 检测到旧版 `app-state.json` | 自动导入到 SQLite，旧文件改名为 `app-state.json.migrated`（见第 4 节） |
| 库文件损坏 | SQLite 在打开/WAL 恢复时抛错，启动失败并打印错误（`[boot] 数据库初始化失败`），进程退出；用备份覆盖 `app-state.db` 后重启 |
| `schemaVersion` 落后 | 见第 4 节迁移链 |

> SQLite 自带页面级校验与 WAL 崩溃恢复，绝大多数写中断都能自动回滚到一致状态，不需要应用层再做「改名 .corrupt」的兜底。

人工检查步骤：

```bash
# 1. 看健康检查确认服务与库状态
curl -s http://<host>:3000/api/health | jq .storage

# 2. 停服务，检查数据卷文件
docker compose stop
docker run --rm -v focus-kids-data:/data alpine ls -l /data

# 3. 校验库完整性
docker run --rm -v focus-kids-data:/data alpine \
  sh -c "npx --yes better-sqlite3 2>/dev/null; ls -l /data/app-state.db*"
```

## 4. 迁移

**JSON → SQLite（一次性，0.18.0）**：服务端启动时若发现旧版 `app-state.json` 且库里还没有家庭，会把账号、档案、记录、作业、设置全部导入 SQLite，再把旧文件改名为 `app-state.json.migrated`（不删除，便于人工核对）。迁移失败时保留原文件并打印错误，不会丢数据。

**应用层 schema 迁移**：

- `SCHEMA_VERSION` 只在持久化结构变化时 +1。
- `server/store/migrations.ts` 的迁移链必须为每个旧版本提供 `旧版本号 → 新结构` 函数，链路 0→20 已完整。
- JSON 时代的数据在导入 SQLite 前先按迁移链升到当前版本；迁移在内存中完成，随后写入 SQLite，因此**升级前必须备份**。
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
- **软上限**：records 最多 500 条、homework 最多 200 条。超出时丢弃最旧条目并打 `console.warn`，防止 localStorage 配额耗尽后所有写入静默失败。

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

- `records`、`homework` 只增不减；单家庭规模下数万条以内无压力（见 architecture.md「已知边界」）。
- **数据管理（0.9.0 起）**：
  - **导出**：家长端「数据管理」页 → `POST /api/state/export`，按孩子/时间范围导出训练记录与作业会话为 JSON 备份，下载到本地留档或迁移。
  - **清理**：`POST /api/state/prune` 删除指定时间之前的记录与会话；**删除前服务端先把被删数据写入 `DB_FILE` 同目录 `backup/prune-*.json`**，再执行删除；只允许清理 24 小时之前的数据（`RANGE_TOO_RECENT` 防误删今天）；进行中的 `running` 会话不删，删除作业会话时连带删除其派生的番茄钟记录。
  - 训练记录页的手动 CSV 导出（仅记录）仍保留。
- 服务端启动时清理过期会话；`/api/auth/logout` 删除当前 token。
- 长期使用建议：升级前先用「数据管理」导出 JSON 备份；定期清理旧数据控制文件增长。数据会持续累积，不要假设它会自己变小。

## 10. 已知边界

- **单实例**：同一 `DB_FILE` 只能由一个进程写。SQLite 使用 WAL 模式并设置了 `busy_timeout`，但没有跨进程写协调；同时起两个实例会互相覆盖。
- **无加密**：数据是明文 SQLite，口令是 scrypt 散列。备份文件同样包含隐私数据，注意存放位置。
- **无异地副本**：只有本地卷 + 手动备份，没有自动上云；`backup/prune-*.json` 是清理前的服务端自动备份，仍在本数据卷内，需要长期留档请用家长端「数据管理」导出到本地。
- **删除不可恢复**：`DELETE /api/profiles/:id` 会连带删除该孩子的记录与作业会话。

## 11. 家长密码重置（离线脚本）

`npm run reset:password` 直接修改 `app-state.db`，用于「密码和恢复码都忘了」的兜底：

```bash
# 必须先停服务，否则运行中的进程会用内存状态覆盖脚本的修改
docker compose stop
docker compose run --rm focus-kids npm run reset:password
docker compose up -d
```

脚本行为：

1. 先把原数据库复制为 `app-state.db.bak-<时间戳>`（失败则中止，不会继续写）。
2. 把 `families.password_hash` 换成随机临时密码的 scrypt 哈希，并在终端打印明文。
3. 清空 `families.recovery_hash` / `recovery_updated_at`（旧恢复码立即失效）。
4. 从 `sessions` 中移除所有 `role: 'parent'` 的会话；孩子端会话保留。
5. 数据库里没有家长账号时直接报错退出，不会写入。

## 12. 备份、恢复与升级

```bash
# 备份（建议升级前执行）
docker run --rm -v focus-kids-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/focus-kids-backup.tar.gz -C /data .

# 恢复
docker compose stop
docker run --rm -v focus-kids-data:/data -v "$PWD":/backup alpine \
  sh -c "rm -f /data/app-state.db* && tar xzf /backup/focus-kids-backup.tar.gz -C /data"
docker compose start
```

升级流程：

1. 备份数据卷。
2. 拉新镜像/新代码，确认 `CHANGELOG` 里的「迁移」小节。
3. 启动，访问 `/api/health` 确认 `version`、`schemaVersion`、`storage.ok`。
4. 若启动失败或数据异常，停服务、用备份覆盖 `app-state.db`、回滚镜像。
