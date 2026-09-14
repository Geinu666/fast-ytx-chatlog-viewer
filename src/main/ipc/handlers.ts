import { BrowserWindow, clipboard, dialog, ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import type { ChatQuery, MessageKind, MessageQuery } from '../../shared/types'
import { loadConfig, saveConfig } from '../config/store'
import { defaultDataDirs } from '../db/discovery'
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
  ipcMain.handle(IPC.dbListSources, () => indexService.listSources())

  ipcMain.handle(IPC.dbSelectSource, (_event, rawPath: unknown) => {
    const target = asString(rawPath, 1024)
    if (!target) throw new Error('无效的数据源路径')
    return indexService.selectSource(target)
  })

  ipcMain.handle(IPC.indexStatus, () => indexService.getStatus())

  ipcMain.handle(IPC.indexRebuild, () => indexService.rebuild())

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

  // ---- 数据源配置 ----

  ipcMain.handle(IPC.configGet, () => loadConfig())

  ipcMain.handle(IPC.configSave, (_event, raw: unknown) => saveConfig(raw))

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
