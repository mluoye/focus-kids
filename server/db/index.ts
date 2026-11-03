import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createTables } from './schema'
import { migrateFromJson } from './migrate'

let db: InstanceType<typeof Database> | null = null

export function initDb(dbPath?: string): InstanceType<typeof Database> {
  if (db) return db
  const path = dbPath || process.env.DB_FILE || './.data/app-state.db'
  const dir = dirname(resolve(path))
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  createTables(db)
  migrateFromJson(db, path)
  return db
}

export function getDb(): InstanceType<typeof Database> {
  if (!db) throw new Error('[db] 数据库未初始化，请先调用 initDb()')
  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

export { migrateFromJson }
