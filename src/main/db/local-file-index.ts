import { readdirSync, statSync, type Dirent } from 'node:fs'
import { join } from 'node:path'

/**
 * 本地文件缓存索引（纯逻辑，不依赖 Electron，便于用合成目录直接验证）。
 *
 * 猿通讯把接收/发送过的文件平铺存放在 `%APPDATA%\boctx\<用户ID>\File\` 下，
 * 文件名与数据库 `content` 里 `<span class="file-name">` 的文本基本一致
 * （重复下载会出现 `(1)`/`(2)` 后缀）。数据库里记录的路径多半是发送方机器的
 * 路径，不能直接使用，因此以「文件名」为键在本机缓存目录里反查真实路径。
 */

/** 目录遍历的文件数上限，防止异常目录拖慢主进程 */
const MAX_FILES = 5000

/** 明显与聊天文件无关的子目录 */
const SKIP_DIRS = new Set([
  'node_modules',
  'Cache',
  'cache',
  'logs',
  'Logs',
  'Temp',
  'temp',
  'GPUCache',
  'Crashpad',
  'index-cache'
])

export interface LocalFileEntry {
  /** 本机绝对路径 */
  path: string
  /** 最后修改时间，用于同名择优 */
  mtimeMs: number
  /** 所属用户目录名（如 3763）；直接位于 `File` 下时为空串 */
  userId: string
}

/** 归一化文件名：去除全部空白并转小写（数据库名与磁盘名可能只差空格或大小写） */
export function normalizeFileName(name: string): string {
  return name.replace(/\s+/g, '').toLowerCase()
}

function isDirectory(target: string): boolean {
  try {
    return statSync(target).isDirectory()
  } catch {
    return false
  }
}

/** 收集一个根目录下所有 `File` 缓存目录（根下直接一个 `File`，以及「用户 ID 目录/File」） */
function collectFileDirs(root: string): Array<{ dir: string; userId: string }> {
  const dirs: Array<{ dir: string; userId: string }> = []

  const direct = join(root, 'File')
  if (isDirectory(direct)) dirs.push({ dir: direct, userId: '' })

  let entries: Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return dirs
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
    const dir = join(root, entry.name, 'File')
    if (isDirectory(dir)) dirs.push({ dir, userId: entry.name })
  }

  return dirs
}

/** 同名冲突时择优：优先指定用户目录，其次取修改时间较新的一份 */
function isBetter(
  candidate: LocalFileEntry,
  current: LocalFileEntry,
  preferredUserId: string
): boolean {
  if (preferredUserId) {
    const candidatePreferred = candidate.userId === preferredUserId
    const currentPreferred = current.userId === preferredUserId
    if (candidatePreferred !== currentPreferred) return candidatePreferred
  }
  return candidate.mtimeMs > current.mtimeMs
}

/**
 * 扫描给定根目录，构建「归一化文件名 → 本地文件」索引。
 * 目录不存在、无权限、文件被删除等情况一律跳过，不抛异常。
 */
export function buildLocalFileIndex(
  roots: string[],
  preferredUserId = ''
): Map<string, LocalFileEntry> {
  const index = new Map<string, LocalFileEntry>()
  let scanned = 0

  for (const root of roots) {
    if (!root) continue
    for (const { dir, userId } of collectFileDirs(root)) {
      let entries: Dirent[]
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        if (scanned >= MAX_FILES) return index
        if (!entry.isFile() || entry.name.startsWith('.')) continue

        const full = join(dir, entry.name)
        let mtimeMs = 0
        try {
          const stat = statSync(full)
          if (!stat.isFile()) continue
          mtimeMs = stat.mtimeMs
        } catch {
          continue
        }

        scanned += 1
        const key = normalizeFileName(entry.name)
        if (!key) continue

        const candidate: LocalFileEntry = { path: full, mtimeMs, userId }
        const current = index.get(key)
        if (!current || isBetter(candidate, current, preferredUserId)) {
          index.set(key, candidate)
        }
      }
    }
  }

  return index
}

/** 从索引中按文件名查真实路径（名字会先归一化） */
export function lookupLocalFile(
  index: Map<string, LocalFileEntry>,
  name: string
): LocalFileEntry | null {
  const key = normalizeFileName(name)
  if (!key) return null
  return index.get(key) ?? null
}
