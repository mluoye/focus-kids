import Database from 'better-sqlite3'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'

const DB_FILE = process.env.DB_FILE ?? resolve('.data/app-state.db')

function openDb(): Database.Database {
  try {
    const db = new Database(DB_FILE)
    return db
  } catch (err) {
    console.error(`无法打开数据库 ${DB_FILE}:`, err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIdx = 0
  while (size >= 1024 && unitIdx < units.length - 1) {
    size /= 1024
    unitIdx++
  }
  return `${size.toFixed(2)} ${units[unitIdx]}`
}

function vacuum(): void {
  console.log(`整理数据库：${DB_FILE}`)
  const beforeSize = statSync(DB_FILE).size
  const db = openDb()
  try {
    const start = Date.now()
    db.exec('VACUUM')
    const elapsed = Date.now() - start
    const afterSize = statSync(DB_FILE).size
    const saved = beforeSize - afterSize
    console.log(`✓ 整理完成（${elapsed}ms）`)
    console.log(`  整理前：${formatBytes(beforeSize)}`)
    console.log(`  整理后：${formatBytes(afterSize)}`)
    if (saved > 0) {
      console.log(`  释放空间：${formatBytes(saved)}`)
    } else {
      console.log('  数据库已是最优状态')
    }
  } finally {
    db.close()
  }
}

function analyze(): void {
  console.log(`更新查询优化器统计信息：${DB_FILE}`)
  const db = openDb()
  try {
    const start = Date.now()
    db.exec('ANALYZE')
    const elapsed = Date.now() - start
    console.log(`✓ 统计信息已更新（${elapsed}ms）`)
  } finally {
    db.close()
  }
}

function integrity(): void {
  console.log(`检查数据库完整性：${DB_FILE}`)
  const db = openDb()
  try {
    const start = Date.now()
    const result = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
    const elapsed = Date.now() - start
    if (result.integrity_check === 'ok') {
      console.log(`✓ 数据库完整（${elapsed}ms）`)
    } else {
      console.error(`✗ 数据库损坏：${result.integrity_check}`)
      process.exit(1)
    }
  } finally {
    db.close()
  }
}

function stats(): void {
  console.log(`数据库统计：${DB_FILE}`)
  try {
    const size = statSync(DB_FILE).size
    console.log(`  文件大小：${formatBytes(size)}`)
  } catch {
    console.error(`  文件不存在`)
    process.exit(1)
  }

  const db = openDb()
  try {
    const tables = [
      'families',
      'profiles',
      'training_records',
      'homework_sessions',
      'homework_plans',
      'settings',
      'sessions',
    ] as const

    console.log('\n表行数：')
    for (const table of tables) {
      try {
        const row = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number }
        console.log(`  ${table.padEnd(20)} ${row.count}`)
      } catch {
        console.log(`  ${table.padEnd(20)} (不存在)`)
      }
    }

    try {
      const walSize = statSync(`${DB_FILE}-wal`).size
      console.log(`\nWAL 文件：${formatBytes(walSize)}`)
    } catch {
      console.log('\nWAL 文件：无（数据库未启用 WAL 或尚无写入）')
    }

    try {
      const schemaVersion = db
        .prepare('SELECT value FROM meta WHERE key = ?')
        .get('schemaVersion') as { value: string } | undefined
      if (schemaVersion) {
        console.log(`\nSchema 版本：${schemaVersion.value}`)
      }
    } catch {
      // meta 表不存在时跳过
    }
  } finally {
    db.close()
  }
}

function main(): void {
  const command = process.argv[2]

  switch (command) {
    case 'vacuum':
      vacuum()
      break
    case 'analyze':
      analyze()
      break
    case 'integrity':
      integrity()
      break
    case 'stats':
      stats()
      break
    default:
      console.error(`未知命令：${command}`)
      console.error('\n用法：npm run db:<command>')
      console.error('\n可用命令：')
      console.error('  db:vacuum     整理数据库（回收空闲页，压缩文件）')
      console.error('  db:analyze    更新查询优化器统计信息')
      console.error('  db:integrity  检查数据库完整性')
      console.error('  db:stats      查看数据库统计信息')
      process.exit(1)
  }
}

main()
