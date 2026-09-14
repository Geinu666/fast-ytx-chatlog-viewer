import { BrowserWindow } from 'electron'
import Database from 'better-sqlite3'
import { basename } from 'node:path'
import { IPC } from '../../shared/ipc-channels'
import type { DbSource, IndexStatus, SourceSelection } from '../../shared/types'
import { rememberSelection } from '../config/store'
import {
  discoverSources,
  invalidateDiscovery,
  pickDefaultSelection,
  sourceForFile,
  sourcesInDirectory
} from '../db/discovery'
import { ensureStats } from '../db/stats'
import { buildIndex, isCacheCurrent, removeCache, type BuildResult } from './builder'
import { cachePathForScope, fileSize, fingerprintFor } from './cache-key'
import { ChatRepository } from './repository'

/**
 * 索引服务：负责数据源范围选择、缓存构建（含进度回传）与仓储生命周期。
 *
 * 选择范围可以是**单个文件**，也可以是**一个目录**——后者会递归收集该目录下
 * 全部可用数据库并按消息 ID 合并去重。构建是**增量**的：只有新增、指纹变化或
 * 上次未能完整收录的源库才会被重新解码，其余直接复用缓存中的行。
 *
 * 所有源库均以只读方式打开，写操作仅发生在 userData 下的缓存库。
 */
const EMPTY_STATUS: IndexStatus = {
  phase: 'idle',
  selectionKind: null,
  selectionPath: null,
  includedFiles: [],
  duplicateMessages: 0,
  sourceName: null,
  cachePath: null,
  cacheSizeBytes: 0,
  progress: 0,
  processed: 0,
  total: 0,
  message: '尚未加载数据源'
}

class IndexService {
  private status: IndexStatus = { ...EMPTY_STATUS, includedFiles: [] }
  private cacheDb: Database.Database | null = null
  private repo: ChatRepository | null = null
  private pending: Promise<IndexStatus> | null = null
  private selection: SourceSelection | null = null
  private statsRunning = false

  getStatus(): IndexStatus {
    return { ...this.status, includedFiles: [...this.status.includedFiles] }
  }

  getRepository(): ChatRepository | null {
    return this.repo
  }

  listSources(force = false): DbSource[] {
    return discoverSources(force)
  }

  /** 把选择范围解析为具体的数据库文件列表（按合并优先级排序） */
  resolveSelection(selection: SourceSelection): DbSource[] {
    if (selection.kind === 'file') {
      const source = sourceForFile(selection.path)
      return source ? [source] : []
    }
    return sourcesInDirectory(selection.path)
  }

  /** 首次调用时自动挑选默认范围并准备索引 */
  async ensureReady(): Promise<IndexStatus> {
    if (this.repo) return this.getStatus()

    const selection = pickDefaultSelection(this.listSources())
    if (!selection) {
      this.status = {
        ...EMPTY_STATUS,
        includedFiles: [],
        phase: 'error',
        error: '未发现可用的聊天记录数据库',
        message: '未发现数据源'
      }
      this.emit()
      return this.getStatus()
    }
    return this.load(selection)
  }

  selectSource(selection: SourceSelection): Promise<IndexStatus> {
    if (!selection || !selection.path) return this.ensureReady()
    return this.load(selection)
  }

  async rebuild(): Promise<IndexStatus> {
    const selection = this.selection ?? pickDefaultSelection(this.listSources())
    if (!selection) return this.ensureReady()

    // 强制重建：直接删掉缓存文件
    this.closeCache()
    removeCache(cachePathForScope(selection))
    return this.load(selection)
  }

  /**
   * 汇总各源库的统计（消息条数 / 最新数据时间）。
   * 只在显式请求时计算，结果会持久化缓存，逐个文件让出事件循环。
   */
  async sourceStats(force = false): Promise<DbSource[]> {
    if (!force) return this.listSources()

    const sources = this.listSources(true)
    const targets = sources.filter((item) => item.valid).map((item) => item.path)
    if (targets.length === 0) return sources

    this.statsRunning = true
    try {
      await ensureStats(targets, (done, total) => {
        this.status = { ...this.status, message: `正在统计源库信息 ${done} / ${total}…` }
        this.emit()
      })
    } finally {
      this.statsRunning = false
    }

    invalidateDiscovery()
    const refreshed = this.listSources(true)
    // 统计会改变合并优先级（数据新旧），若当前范围未就绪则重新评估
    return refreshed
  }

  private async load(selection: SourceSelection): Promise<IndexStatus> {
    if (this.pending) return this.pending
    this.pending = this.doLoad(selection).finally(() => {
      this.pending = null
    })
    return this.pending
  }

  private async doLoad(selection: SourceSelection): Promise<IndexStatus> {
    this.closeCache()

    const files = this.resolveSelection(selection)
    if (files.length === 0) {
      this.status = {
        ...EMPTY_STATUS,
        includedFiles: [],
        phase: 'error',
        selectionKind: selection.kind,
        selectionPath: selection.path,
        error:
          selection.kind === 'dir'
            ? '该目录下未发现可用的聊天记录库（需含 message_list / chat_list 表）'
            : '该文件不是可用的聊天记录库（需含 message_list / chat_list 表）',
        message: '未发现数据源'
      }
      this.emit()
      return this.getStatus()
    }

    const paths = files.map((item) => item.path)
    const fingerprints = fingerprintFor(paths)
    const cachePath = cachePathForScope(selection)
    const current = isCacheCurrent(cachePath, fingerprints)
    const sourceName =
      selection.kind === 'dir'
        ? `${basename(selection.path) || selection.path} · 合并 ${files.length} 个库`
        : files[0].fileName

    this.status = {
      ...EMPTY_STATUS,
      phase: current ? 'ready' : 'building',
      selectionKind: selection.kind,
      selectionPath: selection.path,
      includedFiles: paths,
      sourceName,
      cachePath,
      cacheSizeBytes: fileSize(cachePath),
      progress: current ? 1 : 0,
      message: current
        ? `已复用索引缓存（${files.length} 个库）`
        : `正在准备 ${files.length} 个数据库…`
    }
    this.selection = selection
    rememberSelection(selection)
    this.emit()

    let result: BuildResult | null = null
    if (!current) {
      result = await buildIndex(fingerprints, cachePath, (progress) => {
        const label = progress.label ? ` ${progress.label}` : ''
        let message = `正在解析${label}`
        if (progress.phase === 'dedupe') message = '正在按消息 ID 去重…'
        else if (progress.phase === 'indexing') message = '正在创建查询索引…'
        this.status = {
          ...this.status,
          phase: 'building',
          processed: progress.processed,
          total: progress.total || progress.processed,
          progress: progress.total
            ? Math.min(0.99, progress.processed / progress.total)
            : progress.phase === 'messages'
              ? 0
              : 0.99,
          message
        }
        this.emit()
      })

      const dedupeText =
        result.duplicateMessages > 0 ? `，去重 ${result.duplicateMessages} 条` : ''
      const prefix = result.incremental
        ? `增量更新完成（重新解析 ${result.decodedFiles} 个库、复用 ${result.reusedFiles} 个）`
        : `合并完成`
      this.status = {
        ...this.status,
        duplicateMessages: result.duplicateMessages,
        buildMs: result.buildMs,
        message: `${prefix}，共 ${result.messageCount} 条消息${dedupeText}`
      }
    }

    const db = new Database(cachePath, { readonly: true, fileMustExist: true })
    db.pragma('cache_size = -32000')
    this.cacheDb = db
    this.repo = new ChatRepository(db)

    if (current) {
      const duplicates = Number(readMetaValue(db, 'duplicate_messages')) || 0
      const total = Number(readMetaValue(db, 'message_count')) || 0
      this.status = {
        ...this.status,
        duplicateMessages: duplicates,
        message:
          `已复用索引缓存（${files.length} 个库），共 ${total} 条消息` +
          (duplicates > 0 ? `（去重 ${duplicates} 条）` : '')
      }
    }

    this.status = {
      ...this.status,
      phase: 'ready',
      progress: 1,
      cacheSizeBytes: fileSize(cachePath)
    }
    this.emit()

    // 后台补齐当前范围内源库的统计信息（用于后续的优先级与界面展示），不阻塞界面
    void this.refreshScopeStats(paths)

    return this.getStatus()
  }

  /** 后台统计当前范围的源库（惰性、持久化、逐个文件让出事件循环） */
  private async refreshScopeStats(paths: string[]): Promise<void> {
    if (paths.length <= 1) return
    try {
      await ensureStats(paths)
      invalidateDiscovery()
    } catch {
      // 统计失败不影响主流程
    }
  }

  private closeCache(): void {
    this.repo = null
    if (this.cacheDb) {
      try {
        this.cacheDb.close()
      } catch {
        // 忽略关闭异常
      }
      this.cacheDb = null
    }
  }

  private emit(): void {
    const payload = this.getStatus()
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.indexProgress, payload)
    }
  }
}

function readMetaValue(db: Database.Database, key: string): string | null {
  try {
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row ? row.value : null
  } catch {
    return null
  }
}

export const indexService = new IndexService()
