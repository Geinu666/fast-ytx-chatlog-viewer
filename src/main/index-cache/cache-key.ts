import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 缓存结构版本号，结构变更时递增即可自动失效旧缓存 */
export const CACHE_SCHEMA_VERSION = 1

/** 源库指纹：路径 + 大小 + 修改时间 */
export interface SourceFingerprint {
  path: string
  size: number
  mtimeMs: number
}

export function fingerprint(sourcePath: string): SourceFingerprint {
  const stat = statSync(sourcePath)
  return { path: sourcePath, size: stat.size, mtimeMs: Math.round(stat.mtimeMs) }
}

export function fingerprintKey(fp: SourceFingerprint): string {
  return `${fp.path}|${fp.size}|${fp.mtimeMs}|v${CACHE_SCHEMA_VERSION}`
}

/** 依据指纹生成稳定的缓存文件路径（位于 userData/index-cache） */
export function cachePathFor(fp: SourceFingerprint): string {
  const hash = createHash('md5').update(fingerprintKey(fp)).digest('hex').slice(0, 16)
  const dir = join(app.getPath('userData'), 'index-cache')
  mkdirSync(dir, { recursive: true })
  return join(dir, `idx-${hash}.db`)
}

export function cacheDir(): string {
  const dir = join(app.getPath('userData'), 'index-cache')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function fileSize(path: string | null): number {
  if (!path || !existsSync(path)) return 0
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}
