import { app } from 'electron'
import Database from 'better-sqlite3'
import { existsSync, readdirSync, statSync, type Dirent } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import type { DbSource, SourceSelection } from '../../shared/types'
import { loadConfig } from '../config/store'
import { peekStats } from './stats'

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
 *
 * 性能约定：本模块只做**廉价**探测（读取 sqlite_master 判断表结构），
 * 不做 COUNT(*) / MAX(timestamp) 这类全表扫描；统计信息由 stats.ts 惰性补齐。
 */

/** 约定文件名：message.db / message3763.db 等 */
const CONVENTION_NAME = /^message\w*\.db$/i

const REQUIRED_TABLES = ['message_list', 'chat_list']

/** 递归深度上限，避免遍历整个 AppData */
const MAX_SCAN_DEPTH = 3

/** 单次扫描的 .db 文件数量上限，防止异常目录拖慢启动 */
const MAX_FILES = 200

/** 发现结果缓存时长（毫秒），避免一次启动被重复扫描多遍 */
const DISCOVERY_TTL = 30_000

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

let discoveryCache: { at: number; key: string; sources: DbSource[] } | null = null

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

/** 配置变化后清空发现缓存 */
export function invalidateDiscovery(): void {
  discoveryCache = null
}

function configKey(): string {
  const config = loadConfig()
  return `${config.dataDirs.join('|')}::${config.dataFiles.join('|')}`
}

/** 廉价的可用性探测：只读取 sqlite_master */
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
    inBoctx,
    messageCount: 0,
    newestTimestamp: 0
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
      // 命中统计缓存时顺带填上（免费），否则保持未知，由 stats.ts 惰性补齐
      const stats = peekStats(filePath)
      if (stats) {
        source.messageCount = stats.messageCount
        source.newestTimestamp = stats.newestTimestamp
      }
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

/**
 * 排序即合并优先级：越靠前越优先（同 ID 消息保留靠前源库的版本）。
 *
 * 依次比较：用户配置来源 → 库内数据最新（有统计时）→ 约定文件名 →
 * 猿通讯目录 → 修改时间 → 文件大小。
 * 全部为廉价信号，不会触发全表扫描。
 */
export function compareSources(a: DbSource, b: DbSource): number {
  if (a.origin !== b.origin) return a.origin === 'configured' ? -1 : 1

  if (a.newestTimestamp !== b.newestTimestamp) return b.newestTimestamp - a.newestTimestamp

  const convA = CONVENTION_NAME.test(a.fileName) ? 1 : 0
  const convB = CONVENTION_NAME.test(b.fileName) ? 1 : 0
  if (convA !== convB) return convB - convA

  if (a.inBoctx !== b.inBoctx) return a.inBoctx ? -1 : 1

  if (a.modifiedAt !== b.modifiedAt) return b.modifiedAt - a.modifiedAt

  // 快照链中更新的一份通常更大，作为最后的兜底判定
  if (a.sizeBytes !== b.sizeBytes) return b.sizeBytes - a.sizeBytes

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

/** 直接检查单个文件（不依赖其是否位于扫描目录内） */
export function sourceForFile(filePath: string): DbSource | null {
  if (!existsSync(filePath)) return null
  try {
    const source = inspect(
      filePath,
      'configured',
      filePath.toLowerCase().startsWith(boctxDir().toLowerCase())
    )
    return source.valid ? source : null
  } catch {
    return null
  }
}

/** 收集指定目录下的全部可用数据库（递归），按合并优先级排序 */
export function sourcesInDirectory(dir: string): DbSource[] {
  const files: string[] = []
  if (existsSync(dir)) {
    collectDbFiles(dir, 0, { count: 0 }, (file) => files.push(file))
  }

  const boctx = boctxDir().toLowerCase()
  const sources: DbSource[] = []
  for (const file of files) {
    try {
      const source = inspect(file, 'configured', file.toLowerCase().startsWith(boctx))
      if (source.valid) sources.push(source)
    } catch {
      // 无法读取的文件直接跳过
    }
  }
  return sources.sort(compareSources)
}

/** 扫描全部来源并返回去重后的数据源列表（带短时缓存） */
export function discoverSources(force = false): DbSource[] {
  const key = `${candidateDirs().join('|')}::${configKey()}`
  if (!force && discoveryCache && discoveryCache.key === key) {
    if (Date.now() - discoveryCache.at < DISCOVERY_TTL) return discoveryCache.sources
  }

  const config = loadConfig()
  const boctx = boctxDir().toLowerCase()
  const found = new Map<string, { path: string; origin: DbSource['origin'] }>()

  const add = (filePath: string, origin: DbSource['origin']): void => {
    const dedupeKey = filePath.toLowerCase()
    const existing = found.get(dedupeKey)
    // 已由用户配置收录的，不被默认扫描结果覆盖
    if (existing && existing.origin === 'configured') return
    found.set(dedupeKey, { path: filePath, origin })
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

  sources.sort(compareSources)
  discoveryCache = { at: Date.now(), key, sources }
  return sources
}

/**
 * 默认选择范围：优先恢复上次使用的范围；否则取「文件最新的那个库所在目录」，
 * 对同目录下的全部数据库做合并查看。
 */
export function pickDefaultSelection(sources: DbSource[]): SourceSelection | null {
  const valid = sources.filter((item) => item.valid)
  if (valid.length === 0) return null

  const last = loadConfig().lastSelection
  if (last) {
    if (last.kind === 'file') {
      const matched = valid.find((item) => item.path.toLowerCase() === last.path.toLowerCase())
      if (matched) return { kind: 'file', path: matched.path }
    } else if (existsSync(last.path)) {
      if (sourcesInDirectory(last.path).length > 0) return { kind: 'dir', path: last.path }
    }
  }

  return { kind: 'dir', path: dirname(valid[0].path) }
}
