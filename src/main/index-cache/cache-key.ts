import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 缓存结构版本号：结构变更时递增即可自动失效旧缓存（v2 起支持多库合并去重） */
export const CACHE_SCHEMA_VERSION = 2

export interface SourceFingerprintFile {
  path: string
  size: number
  mtimeMs: number
}

/** 一次构建可能包含多个源库，指纹即全部文件的集合 */
export interface SourceFingerprint {
  files: SourceFingerprintFile[]
}

export function fingerprintFor(paths: string[]): SourceFingerprint {
  const files: SourceFingerprintFile[] = []
  for (const path of paths) {
    try {
      const stat = statSync(path)
      files.push({ path, size: stat.size, mtimeMs: Math.round(stat.mtimeMs) })
    } catch {
      // 文件已不存在则忽略
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  return { files }
}

export function fingerprintKey(fp: SourceFingerprint): string {
  const body = fp.files.map((f) => `${f.path}|${f.size}|${f.mtimeMs}`).join('\n')
  return `${body}|v${CACHE_SCHEMA_VERSION}`
}

export function fingerprintHash(fp: SourceFingerprint): string {
  return createHash('md5').update(fingerprintKey(fp)).digest('hex')
}

/** 依据指纹生成稳定的缓存文件路径（位于 userData/index-cache） */
export function cachePathFor(fp: SourceFingerprint): string {
  const hash = fingerprintHash(fp).slice(0, 16)
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
