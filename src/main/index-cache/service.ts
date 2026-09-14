import { BrowserWindow } from 'electron'
import Database from 'better-sqlite3'
import { existsSync, rmSync } from 'node:fs'
import { basename } from 'node:path'
import { IPC } from '../../shared/ipc-channels'
import type { DbSource, IndexStatus, SourceSelection } from '../../shared/types'
import { rememberSelection } from '../config/store'
import {
  discoverSources,
  pickDefaultSelection,
  sourceForFile,
  sourcesInDirectory
} from '../db/discovery'
import { buildIndex, isCacheValid } from './builder'
import { cachePathFor, fileSize, fingerprintFor } from './cache-key'
import { ChatRepository } from './repository'

/**
 * 索引服务：负责数据源范围选择、缓存构建（含进度回传）与仓储生命周期。
 *
 * 选择范围可以是**单个文件**，也可以是**一个目录**——后者会递归收集该目录下
 * 全部可用数据库并按消息 ID 合并去重，界面看到的是这些库的「总聊天记录」。
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

  getStatus(): IndexStatus {
    return { ...this.status, includedFiles: [...this.status.includedFiles] }
  }

  getRepository(): ChatRepository | null {
    return this.repo
  }

  listSources(): DbSource[] {
    return discoverSources()
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

    const files = this.resolveSelection(selection).map((item) => item.path)
    if (files.length > 0) {
      const cachePath = cachePathFor(fingerprintFor(files))
      this.closeCache()
      if (existsSync(cachePath)) {
        try {
          rmSync(cachePath, { force: true })
        } catch {
          // 忽略删除失败，后续会以新文件重建
        }
      }
    }
    return this.load(selection)
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
    const fp = fingerprintFor(paths)
    const cachePath = cachePathFor(fp)
    const reusable = isCacheValid(cachePath, fp)
    const sourceName =
      selection.kind === 'dir'
        ? `${basename(selection.path) || selection.path} · 合并 ${files.length} 个库`
        : files[0].fileName

    this.status = {
      ...EMPTY_STATUS,
      phase: reusable ? 'ready' : 'building',
      selectionKind: selection.kind,
      selectionPath: selection.path,
      includedFiles: paths,
      sourceName,
      cachePath,
      cacheSizeBytes: fileSize(cachePath),
      progress: reusable ? 1 : 0,
      message: reusable ? '已从索引缓存加载' : `正在合并 ${files.length} 个数据库…`
    }
    this.selection = selection
    rememberSelection(selection)
    this.emit()

    if (!reusable) {
      const result = await buildIndex(fp.files, cachePath, fp, (progress) => {
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

      this.status = {
        ...this.status,
        duplicateMessages: result.duplicateMessages,
        buildMs: result.buildMs,
        message:
          `合并完成，共 ${result.messageCount} 条消息` +
          (result.duplicateMessages > 0 ? `（去重 ${result.duplicateMessages} 条）` : '')
      }
    }

    const db = new Database(cachePath, { readonly: true, fileMustExist: true })
    db.pragma('cache_size = -32000')
    this.cacheDb = db
    this.repo = new ChatRepository(db)

    if (reusable) {
      const row = db.prepare("SELECT value FROM meta WHERE key = 'duplicate_messages'").get() as
        | { value: string }
        | undefined
      const duplicates = row ? Number(row.value) || 0 : 0
      const countRow = db.prepare("SELECT value FROM meta WHERE key = 'message_count'").get() as
        | { value: string }
        | undefined
      const total = countRow ? Number(countRow.value) || 0 : 0
      this.status = {
        ...this.status,
        duplicateMessages: duplicates,
        message:
          `已合并 ${files.length} 个库，共 ${total} 条消息` +
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
    return this.getStatus()
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

export const indexService = new IndexService()
