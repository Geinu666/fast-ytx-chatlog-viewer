import { app } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { LocalFileQuery } from '../../shared/types'
import { indexService } from '../index-cache/service'
import { parseSnapshotName } from './discovery'
import { buildLocalFileIndex, lookupLocalFile, type LocalFileEntry } from './local-file-index'

/**
 * 本地文件定位服务。
 *
 * 文件消息在数据库里记录的路径多半是**发送方机器**的路径（如
 * `D:\coreDevelop\...`、`/home/BOC/...`），本机通常不存在，直接校验会误判成
 * 「未下载」；`fileDownLoad` 字段也经实测不能作为是否已下载的判据
 * （存在大量「本机确有文件但字段为 0」的反例）。
 *
 * 因此以「本机缓存目录中是否存在同名文件」为准：猿通讯把文件平铺在
 * `%APPDATA%\boctx\<用户ID>\File\`，扫描一次建立「文件名 → 路径」索引即可。
 */

/** 索引有效期：与数据源发现的短时缓存保持一致 */
const INDEX_TTL_MS = 30_000

let cache: { at: number; index: Map<string, LocalFileEntry> } | null = null

/** 路径是否指向一个真实存在的文件 */
export function isExistingFile(path: string): boolean {
  if (!path) return false
  try {
    return existsSync(path) && statSync(path).isFile()
  } catch {
    return false
  }
}

/** 本地缓存根目录：猿通讯默认目录 + 环境变量指定的额外目录（便于用合成目录验证） */
function cacheRoots(): string[] {
  const roots = new Set<string>()
  try {
    roots.add(join(app.getPath('appData'), 'boctx'))
  } catch {
    // app 尚未就绪时忽略
  }

  const extra = process.env.CHATLOG_DATA_DIR
  if (extra) {
    for (const item of extra.split(';')) {
      const trimmed = item.trim()
      if (trimmed) roots.add(trimmed)
    }
  }
  return [...roots]
}

/** 从当前数据源文件名推导本机用户 ID（message3763.db → 3763），用于同名择优 */
function preferredUserId(): string {
  try {
    for (const file of indexService.getStatus().includedFiles) {
      const { base } = parseSnapshotName(basename(file))
      const matched = /^message[-_]?(\w+)$/i.exec(base)
      if (matched && matched[1]) return matched[1]
    }
  } catch {
    // 索引未就绪时忽略
  }
  return ''
}

function buildIndex(): Map<string, LocalFileEntry> {
  const index = buildLocalFileIndex(cacheRoots(), preferredUserId())
  cache = { at: Date.now(), index }
  return index
}

function currentIndex(): Map<string, LocalFileEntry> {
  return cache ? cache.index : buildIndex()
}

/** 清空索引（数据源变化或需要立即反映新下载文件时调用） */
export function invalidateLocalFiles(): void {
  cache = null
}

/**
 * 解析文件消息对应的本机真实路径：
 * 1. 数据库记录的路径真实存在（少数记录本就是本机路径）→ 直接使用；
 * 2. 否则按文件名在本地缓存索引中查找；
 * 3. 索引已过期且未命中 → 重建一次再查，覆盖「查看器运行期间刚下载」的情况。
 */
export function resolveLocalFile(input: LocalFileQuery): string | null {
  const dbPath = typeof input?.path === 'string' ? input.path.trim() : ''
  if (dbPath && isExistingFile(dbPath)) return dbPath

  const rawName = typeof input?.name === 'string' ? input.name.trim() : ''
  if (!rawName) return null
  // 允许直接传路径，统一取文件名后再归一化
  const name = basename(rawName.replace(/\\/g, '/'))

  const hit = lookupLocalFile(currentIndex(), name)
  if (hit) return hit.path

  if (cache && Date.now() - cache.at < INDEX_TTL_MS) return null

  cache = null
  return lookupLocalFile(buildIndex(), name)?.path ?? null
}
