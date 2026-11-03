/**
 * 家长密码离线重置（恢复码也丢失时的最后手段）。
 *
 * 用法：
 *   1. 先停止服务（脚本直接改 SQLite 数据库，运行中的服务会持有独立连接与缓存）
 *   2. npm run reset:password
 *   3. 用打印出的临时密码登录，再在「账号」页改成自己的密码
 *
 * 会做的事：
 *   - 备份 app-state.db 为 app-state.db.bak-<时间戳>
 *   - 把家长密码换成随机临时密码，清空恢复码（旧码立即失效）
 *   - 踢掉所有家长会话（孩子端会话保留，不影响正在训练的孩子）
 */
import { copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { initDb, closeDb } from '../server/db/index'
import { revokeParentSessions, updateFamilyRecord } from '../server/db/store'
import { formatRecoveryCode, hashSecret, newRecoveryCode } from '../server/security'

const DB_FILE = resolve(process.env.DB_FILE || './.data/app-state.db')

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

async function main() {
  const db = initDb(DB_FILE)
  const family = db.prepare('SELECT id, username FROM families ORDER BY created_at LIMIT 1').get() as
    | { id: string; username: string }
    | undefined

  if (!family) {
    closeDb()
    fail('数据库里还没有家长账号。请直接打开网页注册，不需要重置。')
  }

  const tempPassword = formatRecoveryCode(newRecoveryCode())
  const backup = `${DB_FILE}.bak-${Date.now()}`

  await copyFile(DB_FILE, backup)

  const newHash = hashSecret(tempPassword)
  // 旧恢复码一并作废：能拿到数据文件的人本来就能重置，没必要再留一把钥匙
  updateFamilyRecord(family.id, { passwordHash: newHash, recoveryHash: null, recoveryUpdatedAt: null })
  revokeParentSessions(family.id)

  closeDb()

  console.log('\n✔ 家长密码已重置')
  console.log(`   数据库：${DB_FILE}`)
  console.log(`   备份文件：${backup}`)
  console.log(`   家长账号：${family.username}`)
  console.log(`   临时密码：${tempPassword}`)
  console.log('\n下一步：')
  console.log('   1. 启动服务（npm start / docker start ...）')
  console.log('   2. 用上面的临时密码登录家长中心')
  console.log('   3. 在「账号」页改成自己的密码，并重新生成恢复码')
  console.log('\n注意：所有家长设备已退出登录；孩子端会话保留。\n')
}

main().catch((err) => fail(`重置失败：${err?.message ?? err}`))
