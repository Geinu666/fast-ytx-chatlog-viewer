import { BrowserWindow } from 'electron'
import Database from 'better-sqlite3'
import { basename } from 'node:path'
import { existsSync, rmSync } from 'node:fs'
import { IPC } from '../../shared/ipc-channels'
import type { DbSource, IndexStatus } from '../../shared/types'
import { discoverSources, pickDefaultSource } from '../db/discovery'
import { buildIndex, isCacheValid } from './builder'
import { cachePathFor, fileSize, fingerprint } from './cache-key'
import { ChatRepository } from './repository'

/**
 * 索引服务：负责数据源选择、缓存构建（含进度回传）与仓储生命周期。
 * 所有源库均以只读方式打开，写操作仅发生在 userData 下的缓存库。
 */
class IndexService {
  private status: IndexStatus = {
    phase: 'idle',
    sourcePath: null,
    sourceName: null,
    cachePath: null,
    cacheSizeBytes: 0,
    progress: 0,
    processed: 0,
    total: 0,
    message: '尚未加载数据源'
  }

  private cacheDb: Database.Database | null = null
  private repo: ChatRepository | null = null
  private pending: Promise<IndexStatus> | null = null

  getStatus(): IndexStatus {
    return { ...this.status }
  }

  getRepository(): ChatRepository | null {
    return this.repo
  }

  listSources(): DbSource[] {
    return discoverSources()
  }

  /** 首次调用时自动挑选默认数据源并准备索引 */
  async ensureReady(): Promise<IndexStatus> {
    if (this.repo) return this.getStatus()

    const source = pickDefaultSource(this.listSources())
    if (!source) {
      this.status = {
        ...this.status,
        phase: 'error',
        error: '未在程序目录发现可用的聊天记录数据库',
        message: '未发现数据源'
      }
      this.emit()
      return this.getStatus()
    }
    return this.load(source.path)
  }

  selectSource(sourcePath: string): Promise<IndexStatus> {
    return this.load(sourcePath)
  }

  async rebuild(): Promise<IndexStatus> {
    const sourcePath =
      this.status.sourcePath ?? pickDefaultSource(this.listSources())?.path ?? null
    if (!sourcePath) return this.ensureReady()

    this.closeCache()
    const cachePath = cachePathFor(fingerprint(sourcePath))
    if (existsSync(cachePath)) {
      try {
        rmSync(cachePath, { force: true })
      } catch {
        // 忽略删除失败，后续以只读方式覆盖
      }
    }
    return this.load(sourcePath)
  }

  private async load(sourcePath: string): Promise<IndexStatus> {
    if (this.pending) return this.pending
    this.pending = this.doLoad(sourcePath).finally(() => {
      this.pending = null
    })
    return this.pending
  }

  private async doLoad(sourcePath: string): Promise<IndexStatus> {
    this.closeCache()

    const fp = fingerprint(sourcePath)
    const cachePath = cachePathFor(fp)
    const reusable = isCacheValid(cachePath, fp)

    this.status = {
      phase: reusable ? 'ready' : 'building',
      sourcePath,
      sourceName: basename(sourcePath),
      cachePath,
      cacheSizeBytes: fileSize(cachePath),
      progress: reusable ? 1 : 0,
      processed: 0,
      total: 0,
      message: reusable ? '已从索引缓存加载' : '正在构建索引缓存…'
    }
    this.emit()

    if (!reusable) {
      const result = await buildIndex(sourcePath, cachePath, fp, (progress) => {
        this.status = {
          ...this.status,
          phase: 'building',
          processed: progress.processed,
          total: progress.total || progress.processed,
          progress: progress.total
            ? Math.min(0.99, progress.processed / progress.total)
            : progress.phase === 'indexing'
              ? 0.99
              : 0,
          message:
            progress.phase === 'indexing'
              ? '正在创建查询索引…'
              : `正在解析消息 ${progress.processed} / ${progress.total}`
        }
        this.emit()
      })
      this.status = {
        ...this.status,
        message: `索引就绪，共 ${result.messageCount} 条消息`,
        buildMs: result.buildMs
      }
    }

    const db = new Database(cachePath, { readonly: true, fileMustExist: true })
    db.pragma('cache_size = -32000')
    this.cacheDb = db
    this.repo = new ChatRepository(db)

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
