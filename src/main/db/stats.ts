import { app } from 'electron'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * 源库统计信息缓存。
 *
 * COUNT(*) 与 MAX(timestamp) 在源库上都需要扫描整表（timestamp 无索引），
 * 对 GB 级数据库开销极大，因此：
 * - 启动路径上**完全不做**这类查询（见 discovery.ts 的 inspect）
 * - 统计改到这里惰性计算，结果按「路径 + 大小 + 修改时间」持久化到
 *   userData/source-stats.json，后续启动直接命中缓存
 */

export interface SourceStats {
  size: number
  mtimeMs: number
  messageCount: number
  newestTimestamp: number
  computedAt: number
}

interface StatsFile {
  version: number
  entries: Record<string, SourceStats>
}

const VERSION = 1

let cache: StatsFile | null = null
let dirty = false

function statsPath(): string {
  return join(app.getPath('userData'), 'source-stats.json')
}

function load(): StatsFile {
  if (cache) return cache
  try {
    const file = statsPath()
    const parsed = existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf8')) as StatsFile)
      : null
    cache =
      parsed && parsed.version === VERSION && parsed.entries && typeof parsed.entries === 'object'
        ? { version: VERSION, entries: parsed.entries }
        : { version: VERSION, entries: {} }
  } catch {
    cache = { version: VERSION, entries: {} }
  }
  return cache
}

/** 读取已缓存的统计（文件已变化则视为无效），不做任何计算 */
export function peekStats(path: string): SourceStats | null {
  const entry = load().entries[path]
  if (!entry) return null
  try {
    const stat = statSync(path)
    if (stat.size !== entry.size) return null
    if (Math.round(stat.mtimeMs) !== entry.mtimeMs) return null
  } catch {
    return null
  }
  return entry
}

function persist(): void {
  if (!dirty || !cache) return
  try {
    const file = statsPath()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(cache), 'utf8')
    dirty = false
  } catch {
    // 写失败不影响功能
  }
}

/**
 * 惰性补齐缺失的统计。逐个文件计算并在文件之间让出事件循环，
 * 因此可以放在索引就绪之后再执行，不会卡住界面。
 */
export async function ensureStats(
  paths: string[],
  onProgress?: (done: number, total: number, label: string) => void
): Promise<void> {
  const pending = paths.filter((path) => !peekStats(path))
  if (pending.length === 0) return

  const store = load()
  for (let index = 0; index < pending.length; index++) {
    const path = pending[index]
    try {
      const stat = statSync(path)
      const db = new Database(path, { readonly: true, fileMustExist: true, timeout: 2000 })
      try {
        const row = db
          .prepare(
            'SELECT COUNT(*) AS total, IFNULL(MAX(timestamp), 0) AS newest FROM message_list'
          )
          .get() as { total: number; newest: number }
        store.entries[path] = {
          size: stat.size,
          mtimeMs: Math.round(stat.mtimeMs),
          messageCount: row.total,
          newestTimestamp: row.newest,
          computedAt: Date.now()
        }
        dirty = true
      } finally {
        db.close()
      }
    } catch {
      // 不可读的文件跳过
    }
    onProgress?.(index + 1, pending.length, path)
    await new Promise((resolve) => setImmediate(resolve))
  }
  persist()
}
