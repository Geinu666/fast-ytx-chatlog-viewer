import { BrowserWindow, clipboard, dialog, ipcMain, net, shell } from 'electron'
import { copyFile, writeFile } from 'node:fs/promises'
import { IPC } from '../../shared/ipc-channels'
import type {
  ChatQuery,
  LocalFileResult,
  MessageKind,
  MessageQuery,
  SaveFileResult,
  SaveImageInput
} from '../../shared/types'
import { loadConfig, saveConfig } from '../config/store'
import { defaultDataDirs } from '../db/discovery'
import { isExistingFile, resolveLocalFile } from '../db/local-files'
import { ChatRepository } from '../index-cache/repository'
import { indexService } from '../index-cache/service'

const VALID_KINDS: MessageKind[] = [
  'text',
  'image',
  'file',
  'at',
  'quote',
  'emoji',
  'system',
  'withdrawn',
  'unknown'
]

const MAX_KEYWORD_LENGTH = 200
const MAX_CLIP_LENGTH = 200000

function requireRepo(): ChatRepository {
  const repo = indexService.getRepository()
  if (!repo) throw new Error('索引尚未就绪，请稍候重试')
  return repo
}

const MISSING_FILE_ERROR = '本地缓存不存在'

/** 校验入参是一个真实存在的文件，返回绝对路径或失败原因 */
function resolveExistingFile(raw: unknown): { path?: string; error?: string } {
  const path = asString(raw, 1024)
  if (!path) return { error: '无效的文件路径' }
  return isExistingFile(path) ? { path } : { error: MISSING_FILE_ERROR }
}

/** 用系统默认程序打开本地文件（仅限本地，缺失时不回落远端） */
async function openLocalFile(raw: unknown): Promise<LocalFileResult> {
  const { path, error } = resolveExistingFile(raw)
  if (!path) return { ok: false, error }
  const failure = await shell.openPath(path)
  return failure ? { ok: false, error: `打开失败：${failure}` } : { ok: true }
}

/** 打开文件所在目录并选中该文件 */
function revealLocalFile(raw: unknown): LocalFileResult {
  const { path, error } = resolveExistingFile(raw)
  if (!path) return { ok: false, error }
  shell.showItemInFolder(path)
  return { ok: true }
}

const SAVE_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg']

/** 文件名净化：去掉路径分隔符与 Windows 非法字符 */
function sanitizeFileName(name: unknown, fallback: string): string {
  const raw = asString(name, 260) ?? ''
  const cleaned = raw.replace(/[\\/:*?"<>|]/g, '_').trim()
  return cleaned || fallback
}

/**
 * 图片另存为。
 * - 有本地缓存且文件存在 → 直接复制；
 * - 仅有远端链接 → 主进程下载后写入（仅接受 http/https）。
 */
async function saveImageAs(raw: unknown): Promise<SaveFileResult> {
  const input = asRecord(raw) as Partial<SaveImageInput>
  const localPath = asString(input.localPath, 1024)
  const url = asString(input.url, 2048)
  const hasRemote = Boolean(url && /^https?:\/\//i.test(url))

  if (localPath) {
    if (!isExistingFile(localPath)) return { ok: false, error: MISSING_FILE_ERROR }
  } else if (!hasRemote) {
    return { ok: false, error: '没有可保存的图片' }
  }

  const suggested = sanitizeFileName(input.suggestedName, 'image.png')
  const options: Electron.SaveDialogOptions = {
    title: '图片另存为',
    defaultPath: suggested,
    filters: [
      { name: '图片', extensions: SAVE_IMAGE_EXTENSIONS },
      { name: '全部文件', extensions: ['*'] }
    ]
  }
  const win = BrowserWindow.getFocusedWindow()
  const result = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { ok: false, canceled: true }

  try {
    if (localPath) {
      await copyFile(localPath, result.filePath)
    } else if (url) {
      const response = await net.fetch(url)
      if (!response.ok) return { ok: false, error: `下载失败：HTTP ${response.status}` }
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length === 0) return { ok: false, error: '远端图片内容为空' }
      await writeFile(result.filePath, buffer)
    }
    return { ok: true, savedPath: result.filePath }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '保存失败' }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown, maxLength = 512): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, maxLength)
}

function asStringArray(value: unknown, maxItems = 500): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const result = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, maxItems)
  return result.length ? result : undefined
}

function asDateString(value: unknown): string | undefined {
  const str = asString(value, 32)
  if (!str) return undefined
  return /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : undefined
}

function asKinds(value: unknown): MessageKind[] | undefined {
  const list = asStringArray(value, VALID_KINDS.length)
  if (!list) return undefined
  const result = list.filter((item): item is MessageKind =>
    (VALID_KINDS as string[]).includes(item)
  )
  return result.length ? result : undefined
}

function asLimit(value: unknown, fallback: number): number {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return fallback
  return Math.min(Math.floor(num), 500)
}

function sanitizeMessageQuery(raw: unknown): MessageQuery {
  const input = asRecord(raw)
  return {
    chatId: asString(input.chatId),
    keyword: asString(input.keyword, MAX_KEYWORD_LENGTH),
    fromIds: asStringArray(input.fromIds),
    kinds: asKinds(input.kinds),
    dateFrom: asDateString(input.dateFrom),
    dateTo: asDateString(input.dateTo),
    cursor: asString(input.cursor, 64) ?? null,
    direction: input.direction === 'newer' ? 'newer' : 'older',
    limit: asLimit(input.limit, 60)
  }
}

function sanitizeChatQuery(raw: unknown): ChatQuery {
  const input = asRecord(raw)
  const scope = input.scope
  return {
    keyword: asString(input.keyword, MAX_KEYWORD_LENGTH),
    scope:
      scope === 'single' || scope === 'group' || scope === 'top' || scope === 'all'
        ? scope
        : 'all'
  }
}

/** 注册数据相关 IPC 处理器（全部入参做类型与范围校验） */
export function registerDataHandlers(): void {
  ipcMain.handle(IPC.dbListSources, (_event, rawForce: unknown) =>
    indexService.listSources(rawForce === true)
  )

  ipcMain.handle(IPC.dbSourceStats, (_event, rawForce: unknown) =>
    indexService.sourceStats(rawForce === true)
  )

  ipcMain.handle(IPC.dbSelectSource, (_event, raw: unknown) => {
    const input = asRecord(raw)
    const kind = input.kind
    const path = asString(input.path, 1024)
    if ((kind !== 'file' && kind !== 'dir') || !path) {
      throw new Error('无效的数据源范围')
    }
    return indexService.selectSource({ kind, path })
  })

  ipcMain.handle(IPC.indexStatus, () => indexService.getStatus())

  ipcMain.handle(IPC.indexEnsure, () => indexService.ensureReady())

  ipcMain.handle(IPC.indexRebuild, () => indexService.rebuild())

  // 手动触发一次增量刷新（无变化时快速返回）
  ipcMain.handle(IPC.indexRefresh, () => indexService.refresh())

  ipcMain.handle(IPC.chatList, (_event, raw: unknown) =>
    requireRepo().listChats(sanitizeChatQuery(raw))
  )

  ipcMain.handle(IPC.chatMeta, (_event, rawChatId: unknown) => {
    const chatId = asString(rawChatId, 128)
    if (!chatId) return null
    return requireRepo().chatMeta(chatId)
  })

  ipcMain.handle(IPC.messagePage, (_event, raw: unknown) =>
    requireRepo().page(sanitizeMessageQuery(raw))
  )

  ipcMain.handle(
    IPC.messageContext,
    (_event, rawChatId: unknown, rawMessageId: unknown, rawRadius: unknown) => {
      const chatId = asString(rawChatId, 128)
      const messageId = asString(rawMessageId, 128)
      if (!chatId || !messageId) return []
      const radius = asLimit(rawRadius, 30)
      return requireRepo().context(chatId, messageId, radius)
    }
  )

  ipcMain.handle(IPC.searchGlobal, (_event, raw: unknown) => {
    const query = sanitizeMessageQuery(raw)
    if (!query.keyword) {
      return { total: 0, tookMs: 0, groups: [], nextCursor: null, hasMore: false }
    }
    return requireRepo().search(query)
  })

  ipcMain.handle(IPC.filterFacets, (_event, rawChatId: unknown) => {
    const chatId = asString(rawChatId, 128)
    if (!chatId) {
      return { senders: [], kinds: [], dateRange: { from: '', to: '' } }
    }
    return requireRepo().facets(chatId)
  })

  // 消息右键复制：由主进程写入系统剪贴板
  ipcMain.handle(IPC.clipWrite, (_event, rawText: unknown) => {
    if (typeof rawText !== 'string') return false
    const text = rawText.slice(0, MAX_CLIP_LENGTH)
    if (!text) return false
    clipboard.writeText(text)
    return true
  })

  // 本地文件：打开 / 打开所在路径（仅接受存在的文件）
  ipcMain.handle(IPC.fileOpen, (_event, raw: unknown) => openLocalFile(raw))
  ipcMain.handle(IPC.fileReveal, (_event, raw: unknown) => revealLocalFile(raw))

  // 图片另存为 / 本地文件定位（按文件名在本机缓存目录中查真实路径）
  ipcMain.handle(IPC.fileSaveAs, (_event, raw: unknown) => saveImageAs(raw))
  ipcMain.handle(IPC.fileResolveLocal, (_event, raw: unknown) => {
    const input = asRecord(raw)
    return resolveLocalFile({
      path: asString(input.path, 1024),
      name: asString(input.name, 260)
    })
  })

  // ---- 数据源配置 ----

  ipcMain.handle(IPC.configGet, () => loadConfig())

  ipcMain.handle(IPC.configSave, (_event, raw: unknown) => {
    const next = saveConfig(raw)
    // 自动刷新开关 / 间隔变更后立即重新装载定时器
    indexService.applyAutoRefresh()
    return next
  })

  ipcMain.handle(IPC.configDefaults, () => defaultDataDirs())

  ipcMain.handle(IPC.configPickDir, async () => {
    const options: Electron.OpenDialogOptions = {
      title: '选择聊天记录目录',
      properties: ['openDirectory']
    }
    const win = BrowserWindow.getFocusedWindow()
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.configPickFile, async () => {
    const options: Electron.OpenDialogOptions = {
      title: '选择聊天记录数据库',
      properties: ['openFile'],
      filters: [
        { name: '聊天记录数据库', extensions: ['db'] },
        { name: '全部文件', extensions: ['*'] }
      ]
    }
    const win = BrowserWindow.getFocusedWindow()
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
