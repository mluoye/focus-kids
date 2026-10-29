/**
 * 家长密码离线重置（恢复码也丢失时的最后手段）。
 *
 * 用法：
 *   1. 先停止服务（脚本直接改数据文件，运行中的服务会用内存状态覆盖它）
 *   2. npm run reset:password
 *   3. 用打印出的临时密码登录，再在「账号」页改成自己的密码
 *
 * 会做的事：
 *   - 备份 app-state.json 为 app-state.json.bak-<时间戳>
 *   - 把家长密码换成随机临时密码，清空恢复码（旧码立即失效）
 *   - 踢掉所有家长会话（孩子端会话保留，不影响正在训练的孩子）
 */
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { formatRecoveryCode, hashSecret, newRecoveryCode } from '../server/security'

const DATA_FILE = resolve(process.env.DATA_FILE || './.data/app-state.json')

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

async function main() {
  let text: string
  try {
    text = await readFile(DATA_FILE, 'utf8')
  } catch (err: any) {
    if (err?.code === 'ENOENT') fail(`没有找到数据文件：${DATA_FILE}\n  请确认 DATA_FILE 或先启动一次服务。`)
    fail(`读取数据文件失败：${err?.message ?? err}`)
  }

  let state: any
  try {
    state = JSON.parse(text)
  } catch (err: any) {
    fail(`数据文件不是合法 JSON，已停止以免覆盖：${err?.message ?? err}\n  可参考 docs/persistence.md 的损坏恢复步骤。`)
  }

  if (!state?.family) {
    fail('这个数据文件里还没有家长账号。请直接打开网页注册，不需要重置。')
  }

  const username = String(state.family.username ?? '')
  const tempPassword = formatRecoveryCode(newRecoveryCode())
  const backup = `${DATA_FILE}.bak-${Date.now()}`

  await copyFile(DATA_FILE, backup)

  state.family.passwordHash = hashSecret(tempPassword)
  // 旧恢复码一并作废：能拿到数据文件的人本来就能重置，没必要再留一把钥匙
  delete state.family.recoveryHash
  delete state.family.recoveryUpdatedAt
  state.sessions = (Array.isArray(state.sessions) ? state.sessions : []).filter(
    (s: any) => s?.role !== 'parent',
  )
  state.meta = { ...(state.meta ?? {}), updatedAt: Date.now() }

  await writeFile(DATA_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8')

  console.log('\n✔ 家长密码已重置')
  console.log(`   数据文件：${DATA_FILE}`)
  console.log(`   备份文件：${backup}`)
  console.log(`   家长账号：${username}`)
  console.log(`   临时密码：${tempPassword}`)
  console.log('\n下一步：')
  console.log('   1. 启动服务（npm start / docker start ...）')
  console.log('   2. 用上面的临时密码登录家长中心')
  console.log('   3. 在「账号」页改成自己的密码，并重新生成恢复码')
  console.log('\n注意：所有家长设备已退出登录；孩子端会话保留。\n')
}

main().catch((err) => fail(`重置失败：${err?.message ?? err}`))
