import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppConfig, SourceSelection } from '../../shared/types'

/**
 * 应用配置持久化：存放于 userData/config.json。
 * 记录用户额外添加的扫描目录与数据库文件，以及上次使用的数据源。
 */

/** 默认不合并历史快照：只解析无时间戳的最新全量库 */
const EMPTY: AppConfig = {
  dataDirs: [],
  dataFiles: [],
  lastSelection: null,
  mergeSnapshots: false
}

let cache: AppConfig | null = null

export function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

function sanitizePathList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed || trimmed.length > 1024) continue
    if (!result.includes(trimmed)) result.push(trimmed)
    if (result.length >= limit) break
  }
  return result
}

export function sanitizeConfig(value: unknown): AppConfig {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

  let lastSelection: SourceSelection | null = null
  const raw = input.lastSelection
  if (raw && typeof raw === 'object') {
    const candidate = raw as Record<string, unknown>
    const kind = candidate.kind
    const path = candidate.path
    if (
      (kind === 'file' || kind === 'dir') &&
      typeof path === 'string' &&
      path.trim().length > 0
    ) {
      lastSelection = { kind, path: path.trim().slice(0, 1024) }
    }
  }

  return {
    dataDirs: sanitizePathList(input.dataDirs, 50),
    dataFiles: sanitizePathList(input.dataFiles, 200),
    lastSelection,
    // 未显式设置时默认关闭（折叠历史快照）
    mergeSnapshots: input.mergeSnapshots === true
  }
}

export function loadConfig(): AppConfig {
  if (cache) return cache
  try {
    const file = configPath()
    cache = existsSync(file) ? sanitizeConfig(JSON.parse(readFileSync(file, 'utf8'))) : { ...EMPTY }
  } catch {
    cache = { ...EMPTY }
  }
  return cache
}

export function saveConfig(value: unknown): AppConfig {
  const next = sanitizeConfig(value)
  try {
    const file = configPath()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(next, null, 2), 'utf8')
    cache = next
  } catch {
    // 写入失败时仍返回内存结果，避免阻断界面
    cache = next
  }
  return next
}

/** 记录上次使用的数据源范围 */
export function rememberSelection(selection: SourceSelection): void {
  const config = loadConfig()
  const last = config.lastSelection
  if (last && last.kind === selection.kind && last.path === selection.path) return
  saveConfig({ ...config, lastSelection: selection })
}
