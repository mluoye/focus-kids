import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { logger } from 'hono/logger'
import { getState, getStorageHealth, loadState, DATA_FILE } from './store'
import { authRoutes } from './routes/auth'
import { profileRoutes } from './routes/profiles'
import { stateRoutes } from './routes/state'
import { aiRoutes } from './routes/ai'
import { ttsRoutes } from './routes/tts'
import { APP_VERSION, SCHEMA_VERSION } from '../shared/constants'
import { authRateLimit, type AppEnv } from './middleware'

const app = new Hono<AppEnv>()

app.use('*', logger())
app.use('*', async (c, next) => {
  await next()
  c.header('x-content-type-options', 'nosniff')
  c.header('referrer-policy', 'same-origin')
  // 写盘失败时让客户端也能感知，而不是只在服务端日志里
  if (!getStorageHealth().ok) {
    try {
      c.header('x-storage-health', 'degraded')
    } catch {
      /* SSE 等已开始写响应时忽略 */
    }
  }
})

app.use('/api/*', bodyLimit({ maxSize: 8 * 1024 * 1024, onError: (c) => c.json({ error: '请求体过大（图片请小于 8MB）' }, 413) }))

app.get('/api/health', (c) => {
  const state = getState()
  const storage = getStorageHealth()
  return c.json({
    ok: true,
    version: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    hasFamily: !!state.family,
    profiles: state.profiles.length,
    records: state.records.length,
    aiEnabled: !!state.settings.ai.enabled,
    dataFile: process.env.NODE_ENV === 'production' ? undefined : DATA_FILE,
    storage: {
      ok: storage.ok,
      lastWriteAt: storage.lastWriteAt,
      lastWriteError: storage.lastWriteError,
      lastLoadError: storage.lastLoadError,
      corruptBackup: process.env.NODE_ENV === 'production' ? undefined : storage.corruptBackup,
    },
    uptimeSec: Math.round(process.uptime()),
  })
})

app.use('/api/auth/login', authRateLimit)
app.use('/api/auth/register', authRateLimit)
app.use('/api/auth/recover', authRateLimit)
app.use('/api/auth/child/login', authRateLimit)
app.use('/api/auth/parent/verify', authRateLimit)
app.use('/api/auth/parent/check', authRateLimit)
app.use('/api/auth/parent/password', authRateLimit)
app.use('/api/auth/parent/username', authRateLimit)
app.use('/api/auth/parent/recovery', authRateLimit)

app.route('/api/auth', authRoutes)
app.route('/api/profiles', profileRoutes)
app.route('/api/state', stateRoutes)
app.route('/api/ai', aiRoutes)
app.route('/api/tts', ttsRoutes)

app.all('/api/*', (c) => c.json({ error: '接口不存在', code: 'NOT_FOUND' }, 404))

// 静态产物 + SPA 回退：仅生产模式托管，避免开发时 3000 端口提供陈旧的 dist/
if (process.env.NODE_ENV === 'production') {
  app.use('/*', serveStatic({ root: './dist' }))
  app.get('*', serveStatic({ path: './dist/index.html' }))
} else {
  app.get('/', (c) =>
    c.html(
      `<!doctype html><meta charset="utf-8"><title>专注力小卫士 · 开发模式</title>
<body style="font-family:system-ui,sans-serif;padding:3rem;line-height:1.6">
  <h1 style="margin-top:0">开发模式不托管前端产物</h1>
  <p>请访问 <a href="http://localhost:5173">http://localhost:5173</a>（Vite 开发服务器）。</p>
  <p>本端口（${process.env.PORT || 3000}）仅提供 <code>/api/*</code> 接口。</p>
  <p>若要通过本端口访问完整页面，请先 <code>npm run build</code>，再以 <code>npm start</code> 或生产环境启动。</p>
</body>`,
      200,
    ),
  )
}

const port = Number(process.env.PORT || 3000)

loadState()
  .then(() => {
    serve({ fetch: app.fetch, port, hostname: process.env.HOST || '0.0.0.0' }, (info) => {
      console.log(`🧠 专注力小卫士 v${APP_VERSION} 已启动：http://localhost:${info.port}`)
      console.log(`   数据文件：${DATA_FILE}`)
    })
  })
  .catch((err) => {
    console.error('[boot] 数据加载失败，服务未启动：', err)
    process.exit(1)
  })

export default app
