import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { logger } from 'hono/logger'
import { getState, loadState, DATA_FILE } from './store'
import { authRoutes } from './routes/auth'
import { profileRoutes } from './routes/profiles'
import { stateRoutes } from './routes/state'
import { aiRoutes } from './routes/ai'
import { APP_VERSION, SCHEMA_VERSION } from '../shared/constants'
import { authRateLimit, type AppEnv } from './middleware'

const app = new Hono<AppEnv>()

app.use('*', logger())
app.use('*', async (c, next) => {
  await next()
  c.header('x-content-type-options', 'nosniff')
  c.header('referrer-policy', 'same-origin')
})

app.use('/api/*', bodyLimit({ maxSize: 8 * 1024 * 1024, onError: (c) => c.json({ error: '请求体过大（图片请小于 8MB）' }, 413) }))

app.get('/api/health', (c) => {
  const state = getState()
  return c.json({
    ok: true,
    version: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    hasFamily: !!state.family,
    profiles: state.profiles.length,
    records: state.records.length,
    aiEnabled: !!state.settings.ai.enabled,
    dataFile: process.env.NODE_ENV === 'production' ? undefined : DATA_FILE,
    uptimeSec: Math.round(process.uptime()),
  })
})

app.use('/api/auth/login', authRateLimit)
app.use('/api/auth/register', authRateLimit)
app.use('/api/auth/child/login', authRateLimit)
app.use('/api/auth/parent/verify', authRateLimit)
app.use('/api/auth/parent/check', authRateLimit)

app.route('/api/auth', authRoutes)
app.route('/api/profiles', profileRoutes)
app.route('/api/state', stateRoutes)
app.route('/api/ai', aiRoutes)

app.all('/api/*', (c) => c.json({ error: '接口不存在', code: 'NOT_FOUND' }, 404))

// 静态产物 + SPA 回退
app.use('/*', serveStatic({ root: './dist' }))
app.get('*', serveStatic({ path: './dist/index.html' }))

const port = Number(process.env.PORT || 3000)

loadState().then(() => {
  serve({ fetch: app.fetch, port, hostname: process.env.HOST || '0.0.0.0' }, (info) => {
    console.log(`🧠 专注力小卫士 v${APP_VERSION} 已启动：http://localhost:${info.port}`)
    console.log(`   数据文件：${DATA_FILE}`)
  })
})

export default app
