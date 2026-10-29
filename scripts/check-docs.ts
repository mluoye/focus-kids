/**
 * 开发规范一致性检查（对应 docs/development-standards.md 第 9 节）。
 *
 * 用法：
 *   tsx scripts/check-docs.ts           默认：警告只提示，退出码 0
 *   tsx scripts/check-docs.ts --strict  警告即失败，退出码 1（预留给 CI / 发版前）
 *   版本/契约一致性错误（fail）任何模式下都退出码 1
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_VERSION, MODULES, SCHEMA_VERSION } from '../shared/constants'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STRICT = process.argv.includes('--strict')

const passed: string[] = []
const warnings: string[] = []
const errors: string[] = []
const ok = (msg: string) => passed.push(msg)
const warn = (msg: string) => warnings.push(msg)
const fail = (msg: string) => errors.push(msg)

const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')
const exists = (rel: string) => existsSync(resolve(ROOT, rel))

// ---------------------------------------------------------------- 1. 版本号一致（硬错误：任何模式都阻断）
const pkg = JSON.parse(read('package.json')) as { version?: string }
if (pkg.version === APP_VERSION) ok(`package.json 与 APP_VERSION 一致（${APP_VERSION}）`)
else fail(`package.json 版本 ${pkg.version ?? '(缺失)'} ≠ APP_VERSION ${APP_VERSION}，请同步`)

const lock = JSON.parse(read('package-lock.json')) as { version?: string }
if (lock.version === APP_VERSION) ok(`package-lock.json 与 APP_VERSION 一致（${APP_VERSION}）`)
else fail(`package-lock.json 版本 ${lock.version ?? '(缺失)'} ≠ APP_VERSION ${APP_VERSION}，请同步`)

const composeSrc = exists('docker-compose.yml') ? read('docker-compose.yml') : ''
const composeTag = composeSrc.match(/image:\s*focus-kids:([\d.]+)/)?.[1]
if (composeTag === APP_VERSION) ok(`docker-compose.yml 镜像标签 = APP_VERSION（${APP_VERSION}）`)
else fail(`docker-compose.yml 镜像标签 ${composeTag ?? '(缺失)'} ≠ APP_VERSION ${APP_VERSION}，请同步`)

// ---------------------------------------------------------------- 2. CHANGELOG
const changelog = read('CHANGELOG.md')

if (/^## \[Unreleased\]/m.test(changelog)) ok('CHANGELOG 保留 Unreleased 段')
else warn('CHANGELOG 缺少 "## [Unreleased]" 段')

const released = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]\s*-\s*(\d{4}-\d{2}-\d{2})\s*$/gm)].map((m) => ({
  version: m[1],
  date: m[2],
  index: m.index ?? 0,
}))

if (released.length === 0) {
  warn('CHANGELOG 没有任何 "## [x.y.z] - YYYY-MM-DD" 发布记录')
} else {
  const newest = released[0]
  if (newest.version === APP_VERSION) ok(`CHANGELOG 最新发布版本 = APP_VERSION（${APP_VERSION}）`)
  else fail(`CHANGELOG 最新发布版本 ${newest.version} ≠ APP_VERSION ${APP_VERSION}`)

  const iso = /^\d{4}-\d{2}-\d{2}$/
  const badDate = released.filter((r) => !iso.test(r.date) || Number.isNaN(Date.parse(r.date)))
  if (badDate.length === 0) ok('CHANGELOG 日期格式合法')
  else warn(`CHANGELOG 日期格式不合法：${badDate.map((r) => r.version).join(', ')}`)

  // 当前版本段落必须至少有 2 条以 "- " 开头的记录
  const start = newest.index
  const nextHeading = changelog.slice(start + 1).search(/^## \[/m)
  const body = nextHeading === -1 ? changelog.slice(start) : changelog.slice(start, start + 1 + nextHeading)
  const bullets = body.split('\n').filter((line) => line.startsWith('- ')).length
  if (bullets >= 2) ok(`CHANGELOG ${newest.version} 段落有 ${bullets} 条记录`)
  else warn(`CHANGELOG ${newest.version} 段落只有 ${bullets} 条记录，疑似漏写变更`)

  const orderBroken = released.some((r, i) => i > 0 && Date.parse(released[i - 1].date) < Date.parse(r.date))
  if (!orderBroken) ok('CHANGELOG 发布记录按时间倒序')
  else warn('CHANGELOG 发布记录未按时间倒序排列')
}

// ---------------------------------------------------------------- 3. SCHEMA 迁移
const storeSrc = read('server/store.ts')
const migrationBlock = storeSrc.match(/const migrations: Record<number,[\s\S]*?\n\}/)?.[0] ?? ''
const migrationKeys = new Set(
  [...migrationBlock.matchAll(/^\s{2}(\d+):/gm)].map((m) => Number(m[1])),
)
const missingMigrations: number[] = []
for (let v = 0; v < SCHEMA_VERSION; v += 1) if (!migrationKeys.has(v)) missingMigrations.push(v)
if (missingMigrations.length === 0) ok(`SCHEMA_VERSION ${SCHEMA_VERSION} 的迁移链完整（0→${SCHEMA_VERSION}）`)
else warn(`SCHEMA_VERSION 为 ${SCHEMA_VERSION}，但缺少迁移函数：${missingMigrations.join(', ')}`)

// ---------------------------------------------------------------- 4. 接口文档覆盖
type Route = { method: string; prefix: string; sub: string }
const indexSrc = read('server/index.ts')
const mounts = new Map<string, string>()
for (const m of indexSrc.matchAll(/app\.route\('([^']+)',\s*(\w+)\)/g)) mounts.set(m[2], m[1])

const routes: Route[] = []
for (const m of indexSrc.matchAll(/app\.(get|post|put|patch|delete)\('(\/api\/(?!\*)[^']*)'/g)) {
  routes.push({ method: m[1].toUpperCase(), prefix: '/api', sub: m[2] })
}

if (exists('server/routes')) {
  for (const file of readdirSync(resolve(ROOT, 'server/routes'))) {
    if (!file.endsWith('.ts')) continue
    const src = read(`server/routes/${file}`)

    for (const m of src.matchAll(/(\w+)\.(get|post|put|patch|delete)\('([^'*$]*)'/g)) {
      const prefix = mounts.get(m[1])
      if (!prefix) continue
      routes.push({ method: m[2].toUpperCase(), prefix, sub: m[3] })
    }

    // 形如 for (const feature of ['a', 'b'] as const) { x.post(`/${feature}`) }
    for (const m of src.matchAll(/for \(const (\w+) of \[([^\]]+)\] as const\)[^{]*\{[\s\S]{0,400}?(\w+)\.(get|post|put|patch|delete)\(`\/\$\{\1\}`/g)) {
      const prefix = mounts.get(m[3])
      if (!prefix) continue
      const names = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1])
      for (const name of names) routes.push({ method: m[4].toUpperCase(), prefix, sub: `/${name}` })
    }
  }
}

const apiDoc = read('docs/api.md')
const covered = (r: Route) => {
  if (!apiDoc.includes(r.prefix)) return false
  if (apiDoc.includes(`${r.method} ${r.sub}`)) return true
  // 文档里也可能用表格写：| POST | `/logout` | ... |
  const esc = r.sub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\|\\s*${r.method}\\s*\\|\\s*\`${esc}\`\\s*\\|`).test(apiDoc)
}
const uncovered = routes
  .filter((r) => !covered(r))
  .map((r) => `${r.method} ${r.prefix}${r.sub === '/' ? '' : r.sub}`)

if (routes.length === 0) warn('未能从 server/ 解析出任何路由，接口覆盖检查已跳过')
else if (uncovered.length === 0) ok(`docs/api.md 覆盖全部 ${routes.length} 个路由`)
else warn(`docs/api.md 缺少 ${uncovered.length} 个路由：${uncovered.join(' | ')}`)

// ---------------------------------------------------------------- 5. 专题文档
const trainingDoc = read('docs/training-specs.md')
const missingModules = MODULES.filter((m) => !trainingDoc.includes(m.name)).map((m) => m.name)
if (missingModules.length === 0) ok(`docs/training-specs.md 覆盖全部 ${MODULES.length} 个模块`)
else warn(`docs/training-specs.md 缺少模块说明：${missingModules.join(', ')}`)

const dataDoc = read('docs/data-model.md')
const stateFields = ['schemaVersion', 'meta', 'family', 'profiles', 'records', 'homework', 'settings', 'sessions']
const missingFields = stateFields.filter((f) => !dataDoc.includes(f))
if (missingFields.length === 0) ok('docs/data-model.md 覆盖顶层状态字段')
else warn(`docs/data-model.md 缺少字段说明：${missingFields.join(', ')}`)

const archDoc = read('docs/architecture.md')
const archAnchors = ['server/', 'src/', 'shared/', 'docs/']
const missingAnchors = archAnchors.filter((a) => !archDoc.includes(a))
if (missingAnchors.length === 0) ok('docs/architecture.md 覆盖主要目录')
else warn(`docs/architecture.md 缺少目录说明：${missingAnchors.join(', ')}`)

// ---------------------------------------------------------------- 6. 弃用字段登记
const typesSrc = read('shared/types.ts')
const deprecatedFields = [
  ...typesSrc.matchAll(/@deprecated[^*]*\*\/\s*(\w+)\s*\??:/g),
].map((m) => m[1])
if (deprecatedFields.length === 0) {
  ok('shared/types.ts 无 @deprecated 字段，无需登记')
} else {
  // 弃用登记是「一次登记、长期有效」，所以查所有历史版本的「弃用」小节，而不是只看当前版本
  const deprecatedSections = [...changelog.matchAll(/### 弃用\s*\n([\s\S]*?)(?=\n### |\n## |$)/g)]
    .map((m) => m[1])
    .join('\n')
  const missing = deprecatedFields.filter((field) => !deprecatedSections.includes(field))
  if (missing.length === 0) ok(`@deprecated 字段已在 CHANGELOG「弃用」小节登记（${deprecatedFields.length} 个）`)
  else warn(`${missing.length} 个 @deprecated 字段未在 CHANGELOG「弃用」小节登记：${missing.join(', ')}`)
}

// ---------------------------------------------------------------- 6.5 前端裸 fetch 鉴权检测
const scanSrc = (rel: string, acc: string[] = []): string[] => {
  const abs = resolve(ROOT, rel)
  if (!existsSync(abs)) return acc
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const p = `${rel}/${entry.name}`
    if (entry.isDirectory()) scanSrc(p, acc)
    else if (/\.(ts|vue|js)$/.test(entry.name)) acc.push(p)
  }
  return acc
}

const FETCH_EXCLUDE = new Set(['src/api/client.ts'])
const bareFetch: string[] = []
for (const file of scanSrc('src')) {
  if (FETCH_EXCLUDE.has(file)) continue
  const lines = read(file).split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    if (!/\bfetch\(\s*['"`]\/api\//.test(lines[i])) continue
    const segment = lines.slice(i, i + 8).join('\n').slice(0, 600)
    if (!/Authorization|Bearer|getToken|['"`]token['"`]/i.test(segment)) bareFetch.push(`${file}:${i + 1}`)
  }
}
if (bareFetch.length === 0) ok('前端 /api/* 请求均走 request() 或显式带 token')
else warn(`前端疑似裸 fetch('/api/...') 未注入鉴权：${bareFetch.join(' | ')}`)

// ---------------------------------------------------------------- 6.6 服务端运行时依赖归属
const pkgJson = JSON.parse(read('package.json')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
const runtimeDeps = new Set(Object.keys(pkgJson.dependencies ?? {}))
const devOnlyDeps = new Set(Object.keys(pkgJson.devDependencies ?? {}))
const misplacedDeps: string[] = []
for (const file of scanSrc('server').filter((f) => f.endsWith('.ts'))) {
  const src = read(file)
  for (const m of src.matchAll(/(?:from\s+|import\s*\(?\s*|require\s*\()['"]([^'"]+)['"]/g)) {
    const spec = m[1]
    if (spec.startsWith('.') || spec.startsWith('node:')) continue
    const pkgName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
    if (devOnlyDeps.has(pkgName) && !runtimeDeps.has(pkgName)) misplacedDeps.push(`${pkgName}（${file}）`)
  }
}
if (misplacedDeps.length === 0) ok('server/ 运行时依赖均在 dependencies（容器 npm ci --omit=dev 可用）')
else warn(`server/ 引用但仅在 devDependencies 的包：${[...new Set(misplacedDeps)].join(' | ')}`)

// ---------------------------------------------------------------- 7. 规范文件
const requiredFiles = ['AGENTS.md', 'docs/development-standards.md', 'docs/persistence.md', 'CHANGELOG.md']
const missingFiles = requiredFiles.filter((f) => !exists(f))
if (missingFiles.length === 0) ok('规范文件齐全（AGENTS.md / development-standards.md / persistence.md / CHANGELOG.md）')
else warn(`缺少规范文件：${missingFiles.join(', ')}`)

if (exists('docs/persistence.md')) {
  const persistenceDoc = read('docs/persistence.md')
  const anchors = ['app-state.json', 'localStorage', 'x-storage-health', 'corrupt']
  const missingAnchors = anchors.filter((a) => !persistenceDoc.includes(a))
  if (missingAnchors.length === 0) ok('docs/persistence.md 覆盖存储路径、本地缓存、写盘降级与损坏恢复')
  else warn(`docs/persistence.md 缺少关键内容：${missingAnchors.join(', ')}`)
}

// ---------------------------------------------------------------- 输出
const line = '─'.repeat(52)
console.log(`\ncheck:docs  v${APP_VERSION}  ·  schema ${SCHEMA_VERSION}`)
console.log(line)
for (const item of passed) console.log(`  ok    ${item}`)
for (const item of warnings) console.log(`  warn  ${item}`)
for (const item of errors) console.log(`  fail  ${item}`)
console.log(line)
console.log(`  通过 ${passed.length} 项，警告 ${warnings.length} 项，失败 ${errors.length} 项`)
if (errors.length > 0) console.log('  版本/契约一致性错误：必须修复后才能提交或发版\n')
if (warnings.length > 0 && !STRICT) console.log('  提醒：警告视为待办，请在提交说明中处理或说明理由\n')
if (warnings.length > 0 && STRICT) console.log('  --strict 模式下存在警告，检查失败\n')

process.exit((STRICT && warnings.length > 0) || errors.length > 0 ? 1 : 0)
