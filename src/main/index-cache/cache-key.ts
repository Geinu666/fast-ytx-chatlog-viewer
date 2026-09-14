import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { SourceSelection } from '../../shared/types'

/**
 * 缓存结构版本：结构变更时递增即可自动失效旧缓存。
 * - v3 起支持「按源增量」构建
 * - v4 起支持「按行增量」构建（source 表新增行级水位字段）
 */
export const CACHE_SCHEMA_VERSION = 4

/** 单个源库的指纹 */
export interface SourceFingerprintFile {
  path: string
  size: number
  mtimeMs: number
}

export function fileKey(file: SourceFingerprintFile): string {
  return `${file.path}|${file.size}|${file.mtimeMs}`
}

/** 采集给定文件的指纹（读取失败的文件会被忽略） */
export function fingerprintFor(paths: string[]): SourceFingerprintFile[] {
  const files: SourceFingerprintFile[] = []
  for (const path of paths) {
    try {
      const stat = statSync(path)
      files.push({ path, size: stat.size, mtimeMs: Math.round(stat.mtimeMs) })
    } catch {
      // 文件已不存在则忽略
    }
  }
  return files
}

export function cacheDir(): string {
  const dir = join(app.getPath('userData'), 'index-cache')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 缓存文件名前缀（含结构版本），便于识别并清理历史版本的残留 */
function cacheFilePrefix(): string {
  return `idx-v${CACHE_SCHEMA_VERSION}-`
}

let pruned = false

/** 清理历史结构版本遗留的缓存文件（每次进程只执行一次） */
function pruneStaleCaches(dir: string): void {
  if (pruned) return
  pruned = true
  const prefix = cacheFilePrefix()
  try {
    for (const name of readdirSync(dir)) {
      if (!name.startsWith('idx-') || name.startsWith(prefix)) continue
      try {
        rmSync(join(dir, name), { force: true })
      } catch {
        // 文件被占用时忽略，下次启动再清
      }
    }
  } catch {
    // 目录不可读时忽略
  }
}

/**
 * 缓存文件按「选择范围」命名，而不是按文件集合命名。
 * 这样范围内的文件发生增删/变化时仍复用同一个缓存文件，从而走增量更新，
 * 也避免产生一堆只差一个文件的缓存副本。
 */
export function cachePathForScope(selection: SourceSelection): string {
  const hash = createHash('md5')
    .update(`${selection.kind}|${selection.path}|v${CACHE_SCHEMA_VERSION}`)
    .digest('hex')
    .slice(0, 16)
  const dir = cacheDir()
  pruneStaleCaches(dir)
  return join(dir, `${cacheFilePrefix()}${hash}.db`)
}

export function fileSize(path: string | null): number {
  if (!path || !existsSync(path)) return 0
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}
