import { app } from 'electron'
import Database from 'better-sqlite3'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import type { DbSource } from '../../shared/types'

/**
 * 数据源发现：扫描「程序所在目录」等候选目录，寻找可用的聊天记录库。
 *
 * - 开发态：项目根目录（process.cwd()）
 * - 打包态：exe 所在目录（绿色版可写）、resources 目录
 * - 兜底：userData 目录
 */

/** 约定文件名：message.db / message3763.db 等 */
const CONVENTION_NAME = /^message\w*\.db$/i

const REQUIRED_TABLES = ['message_list', 'chat_list']

/** 需要扫描的候选目录（去重、存在的） */
export function candidateDirs(): string[] {
  const dirs = new Set<string>()

  if (app.isPackaged) {
    const exeDir = dirname(app.getPath('exe'))
    dirs.add(exeDir)
    dirs.add(process.resourcesPath)
    dirs.add(dirname(process.resourcesPath))
  } else {
    dirs.add(process.cwd())
  }

  dirs.add(app.getPath('userData'))

  return [...dirs].filter((dir) => Boolean(dir) && existsSync(dir))
}

function inspect(filePath: string): DbSource {
  const stat = statSync(filePath)
  const source: DbSource = {
    path: filePath,
    fileName: basename(filePath),
    sizeBytes: stat.size,
    modifiedAt: Math.round(stat.mtimeMs),
    valid: false,
    tableCount: 0
  }

  let db: Database.Database | null = null
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true, timeout: 2000 })
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>
    const tables = rows.map((row) => row.name)
    source.tableCount = tables.length
    const missing = REQUIRED_TABLES.filter((name) => !tables.includes(name))
    if (missing.length === 0) {
      source.valid = true
    } else {
      source.error = `缺少数据表：${missing.join('、')}`
    }
  } catch (err) {
    source.error = err instanceof Error ? err.message : String(err)
  } finally {
    if (db) db.close()
  }

  return source
}

/** 约定名优先，其次按修改时间取最新 */
export function compareSources(a: DbSource, b: DbSource): number {
  const convA = CONVENTION_NAME.test(a.fileName) ? 1 : 0
  const convB = CONVENTION_NAME.test(b.fileName) ? 1 : 0
  if (convA !== convB) return convB - convA
  if (a.modifiedAt !== b.modifiedAt) return b.modifiedAt - a.modifiedAt
  return a.fileName.localeCompare(b.fileName)
}

/** 扫描全部候选目录并返回去重后的数据源列表（valid 优先靠前） */
export function discoverSources(): DbSource[] {
  const seen = new Set<string>()
  const rawFiles: string[] = []

  for (const dir of candidateDirs()) {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (extname(entry).toLowerCase() !== '.db') continue
      const full = join(dir, entry)
      const key = full.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      rawFiles.push(full)
    }
  }

  const sources: DbSource[] = []
  for (const file of rawFiles) {
    try {
      sources.push(inspect(file))
    } catch {
      // 无法读取的文件直接跳过
    }
  }

  return sources.sort(compareSources)
}

/** 挑选默认加载的数据源 */
export function pickDefaultSource(sources: DbSource[]): DbSource | null {
  const valid = sources.filter((item) => item.valid)
  if (valid.length === 0) return null
  return valid[0]
}
