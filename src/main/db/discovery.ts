import { app } from 'electron'
import Database from 'better-sqlite3'
import { existsSync, readdirSync, statSync, type Dirent } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import type { DbSource } from '../../shared/types'
import { loadConfig } from '../config/store'

/**
 * 数据源发现。
 *
 * 扫描来源（按优先级）：
 * 1. 用户配置的单个数据库文件
 * 2. 用户配置的目录（递归）
 * 3. 内置默认目录：
 *    - 猿通讯默认目录 `%APPDATA%\boctx`（聊天记录一般存放于此）
 *    - 开发态：项目根目录；打包态：exe 同目录、resources 及其上级
 *    - userData 目录
 *    - 环境变量 CHATLOG_DATA_DIR（分号分隔，便于便携使用）
 */

/** 约定文件名：message.db / message3763.db 等 */
const CONVENTION_NAME = /^message\w*\.db$/i

const REQUIRED_TABLES = ['message_list', 'chat_list']

/** 递归深度上限，避免遍历整个 AppData */
const MAX_SCAN_DEPTH = 3

/** 单次扫描的 .db 文件数量上限，防止异常目录拖慢启动 */
const MAX_FILES = 200

/** 明显不含聊天库的子目录，直接跳过（含应用自身的索引缓存目录） */
const SKIP_DIRS = new Set([
  'node_modules',
  'File',
  'Cache',
  'cache',
  'logs',
  'Logs',
  'Temp',
  'temp',
  'Crashpad',
  'GPUCache',
  'index-cache'
])

/** 猿通讯默认数据目录：%APPDATA%\boctx */
export function boctxDir(): string {
  return join(app.getPath('appData'), 'boctx')
}

/** 内置默认扫描目录（不含用户配置） */
export function defaultDataDirs(): string[] {
  const dirs = new Set<string>()

  if (app.isPackaged) {
    dirs.add(dirname(app.getPath('exe')))
    dirs.add(process.resourcesPath)
    dirs.add(dirname(process.resourcesPath))
  } else {
    dirs.add(process.cwd())
  }

  dirs.add(boctxDir())
  dirs.add(app.getPath('userData'))

  const extra = process.env.CHATLOG_DATA_DIR
  if (extra) {
    for (const item of extra.split(';')) {
      const trimmed = item.trim()
      if (trimmed) dirs.add(trimmed)
    }
  }

  return [...dirs].filter(Boolean)
}

/** 用户配置目录优先，其次内置默认目录 */
export function candidateDirs(): string[] {
  const configured = loadConfig().dataDirs
  return [...new Set([...configured, ...defaultDataDirs()])].filter(
    (dir) => Boolean(dir) && existsSync(dir)
  )
}

function inspect(filePath: string, origin: DbSource['origin'], inBoctx: boolean): DbSource {
  const stat = statSync(filePath)
  const source: DbSource = {
    path: filePath,
    fileName: basename(filePath),
    sizeBytes: stat.size,
    modifiedAt: Math.round(stat.mtimeMs),
    valid: false,
    tableCount: 0,
    origin,
    inBoctx
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

/** 用户配置的来源优先；其次约定文件名、猿通讯目录、修改时间 */
export function compareSources(a: DbSource, b: DbSource): number {
  if (a.origin !== b.origin) return a.origin === 'configured' ? -1 : 1

  const convA = CONVENTION_NAME.test(a.fileName) ? 1 : 0
  const convB = CONVENTION_NAME.test(b.fileName) ? 1 : 0
  if (convA !== convB) return convB - convA

  if (a.inBoctx !== b.inBoctx) return a.inBoctx ? -1 : 1

  if (a.modifiedAt !== b.modifiedAt) return b.modifiedAt - a.modifiedAt
  return a.fileName.localeCompare(b.fileName)
}

interface ScanState {
  count: number
}

/** 递归收集目录下的 .db 文件（限深 + 跳过无关子目录） */
function collectDbFiles(
  root: string,
  depth: number,
  state: ScanState,
  onFile: (file: string) => void
): void {
  if (depth > MAX_SCAN_DEPTH || state.count >= MAX_FILES) return

  let entries: Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (state.count >= MAX_FILES) return
    // 跳过隐藏目录（如 .git）与已知无关目录
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue

    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      collectDbFiles(full, depth + 1, state, onFile)
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.db') {
      state.count += 1
      onFile(full)
    }
  }
}

/** 扫描全部来源并返回去重后的数据源列表 */
export function discoverSources(): DbSource[] {
  const config = loadConfig()
  const boctx = boctxDir().toLowerCase()

  const found = new Map<string, { path: string; origin: DbSource['origin'] }>()

  const add = (filePath: string, origin: DbSource['origin']): void => {
    const key = filePath.toLowerCase()
    const existing = found.get(key)
    // 已由用户配置收录的，不被默认扫描结果覆盖
    if (existing && existing.origin === 'configured') return
    found.set(key, { path: filePath, origin })
  }

  // 1. 用户显式添加的单个文件
  for (const file of config.dataFiles) {
    if (existsSync(file) && extname(file).toLowerCase() === '.db') {
      add(file, 'configured')
    }
  }

  // 2. 用户配置的目录（递归）
  for (const dir of config.dataDirs) {
    if (!existsSync(dir)) continue
    collectDbFiles(dir, 0, { count: 0 }, (file) => add(file, 'configured'))
  }

  // 3. 内置默认目录（递归）
  for (const dir of defaultDataDirs()) {
    if (!existsSync(dir)) continue
    collectDbFiles(dir, 0, { count: 0 }, (file) => add(file, 'default'))
  }

  const sources: DbSource[] = []
  for (const entry of found.values()) {
    try {
      sources.push(inspect(entry.path, entry.origin, entry.path.toLowerCase().startsWith(boctx)))
    } catch {
      // 无法读取的文件直接跳过
    }
  }

  return sources.sort(compareSources)
}

/** 挑选默认加载的数据源：优先恢复上次使用的，其次排序第一项 */
export function pickDefaultSource(sources: DbSource[]): DbSource | null {
  const valid = sources.filter((item) => item.valid)
  if (valid.length === 0) return null

  const last = loadConfig().lastSource
  if (last) {
    const matched = valid.find((item) => item.path.toLowerCase() === last.toLowerCase())
    if (matched) return matched
  }

  return valid[0]
}
