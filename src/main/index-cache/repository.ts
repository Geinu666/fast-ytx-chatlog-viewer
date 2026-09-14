import type Database from 'better-sqlite3'
import { cleanText } from '../../shared/content'
import type {
  ChatItem,
  ChatKind,
  ChatMeta,
  ChatQuery,
  FacetResponse,
  KindFacet,
  MessageItem,
  MessageKind,
  MessageQuery,
  Page,
  SenderFacet,
  SearchGroup,
  SearchResponse
} from '../../shared/types'

interface MessageRow {
  row_id: number
  id: string
  chat_id: string
  chat_type: string
  from_id: string
  name: string
  avatar: string
  kind: string
  message_type: string
  at: string
  is_mine: number
  is_withdrawn: number
  timestamp: number
  str_date: string
  text: string
  raw: string
  local_path: string
}

interface ChatRow {
  id: string
  name: string
  avatar: string
  kind: string
  chat_type: string
  is_top: number
  seq: number
  message_count: number
  last_timestamp: number
  last_preview: string
}

const MESSAGE_COLUMNS =
  'row_id, id, chat_id, chat_type, from_id, name, avatar, kind, message_type, at, ' +
  'is_mine, is_withdrawn, timestamp, str_date, text, raw, local_path'

const DEFAULT_LIMIT = 60
const MAX_LIMIT = 500

function clampLimit(limit: unknown, fallback = DEFAULT_LIMIT): number {
  const value = Number(limit)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.min(Math.floor(value), MAX_LIMIT)
}

/** 转义 LIKE 通配符，配合 ESCAPE '\' 使用 */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

function likePattern(keyword: string): string {
  return `%${escapeLike(keyword)}%`
}

export function encodeCursor(timestamp: number, rowId: number): string {
  return `${timestamp}:${rowId}`
}

export function decodeCursor(cursor?: string | null): { ts: number; rowId: number } | null {
  if (!cursor) return null
  const parts = cursor.split(':')
  if (parts.length !== 2) return null
  const ts = Number(parts[0])
  const rowId = Number(parts[1])
  if (!Number.isFinite(ts) || !Number.isFinite(rowId)) return null
  return { ts, rowId }
}

function toMessage(row: MessageRow): MessageItem {
  return {
    id: row.id,
    rowId: row.row_id,
    chatId: row.chat_id,
    chatType: row.chat_type,
    fromId: row.from_id,
    name: row.name,
    avatar: row.avatar,
    kind: row.kind as MessageKind,
    messageType: row.message_type,
    isMine: row.is_mine === 1,
    isWithdrawn: row.is_withdrawn === 1,
    at: row.at,
    timestamp: row.timestamp,
    strDate: row.str_date,
    text: row.text,
    raw: row.raw,
    localPath: row.local_path ?? ''
  }
}

function buildFilterClauses(query: MessageQuery): { clauses: string[]; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []

  if (query.chatId) {
    clauses.push('chat_id = ?')
    params.push(query.chatId)
  }
  if (query.fromIds && query.fromIds.length) {
    clauses.push(`from_id IN (${query.fromIds.map(() => '?').join(',')})`)
    params.push(...query.fromIds)
  }
  if (query.kinds && query.kinds.length) {
    clauses.push(`kind IN (${query.kinds.map(() => '?').join(',')})`)
    params.push(...query.kinds)
  }
  if (query.dateFrom) {
    clauses.push('str_date >= ?')
    params.push(query.dateFrom)
  }
  if (query.dateTo) {
    clauses.push('str_date <= ?')
    params.push(query.dateTo)
  }

  const keyword = cleanText(query.keyword)
  if (keyword) {
    clauses.push("text LIKE ? ESCAPE '\\'")
    params.push(likePattern(keyword))
  }

  return { clauses, params }
}

/** 索引缓存查询仓储：时间线分页、全局检索、分面筛选 */
export class ChatRepository {
  constructor(private readonly db: Database.Database) {}

  listChats(query: ChatQuery = {}): ChatItem[] {
    const clauses: string[] = []
    const params: unknown[] = []

    const keyword = cleanText(query.keyword)
    if (keyword) {
      clauses.push("(name LIKE ? ESCAPE '\\' OR last_preview LIKE ? ESCAPE '\\')")
      const pattern = likePattern(keyword)
      params.push(pattern, pattern)
    }

    switch (query.scope) {
      case 'single':
        clauses.push("kind = 'single'")
        break
      case 'group':
        clauses.push("kind = 'group'")
        break
      case 'top':
        clauses.push('is_top = 1')
        break
      default:
        break
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = this.db
      .prepare(
        `SELECT id, name, avatar, kind, chat_type, is_top, seq, message_count,
                last_timestamp, last_preview
         FROM chat ${where}
         ORDER BY is_top DESC, last_timestamp DESC, name ASC`
      )
      .all(...params) as ChatRow[]

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      avatar: row.avatar,
      kind: row.kind as ChatKind,
      chatType: row.chat_type,
      isTop: row.is_top === 1,
      messageCount: row.message_count,
      lastTimestamp: row.last_timestamp,
      lastPreview: row.last_preview,
      seq: row.seq
    }))
  }

  chatMeta(chatId: string): ChatMeta | null {
    const chat = this.db
      .prepare('SELECT id, name, kind FROM chat WHERE id = ?')
      .get(chatId) as { id: string; name: string; kind: string } | undefined
    if (!chat) return null

    const agg = this.db
      .prepare(
        `SELECT COUNT(*) AS total, COUNT(DISTINCT from_id) AS members,
                MIN(str_date) AS first, MAX(str_date) AS last
         FROM message WHERE chat_id = ?`
      )
      .get(chatId) as { total: number; members: number; first: string | null; last: string | null }

    return {
      chatId,
      name: chat.name,
      kind: chat.kind as ChatKind,
      messageCount: agg.total,
      memberCount: agg.members,
      firstDate: agg.first ?? '',
      lastDate: agg.last ?? ''
    }
  }

  facets(chatId: string): FacetResponse {
    const senders = this.db
      .prepare(
        `SELECT from_id AS fromId, MAX(name) AS name, COUNT(*) AS count
         FROM message WHERE chat_id = ?
         GROUP BY from_id ORDER BY count DESC, name ASC`
      )
      .all(chatId) as SenderFacet[]

    const kinds = this.db
      .prepare(
        `SELECT kind, COUNT(*) AS count FROM message
         WHERE chat_id = ? GROUP BY kind ORDER BY count DESC`
      )
      .all(chatId) as KindFacet[]

    const range = this.db
      .prepare(
        `SELECT MIN(str_date) AS first, MAX(str_date) AS last
         FROM message WHERE chat_id = ? AND str_date <> ''`
      )
      .get(chatId) as { first: string | null; last: string | null }

    return {
      senders,
      kinds,
      dateRange: { from: range?.first ?? '', to: range?.last ?? '' }
    }
  }

  page(query: MessageQuery): Page<MessageItem> {
    const limit = clampLimit(query.limit)
    const { clauses, params } = buildFilterClauses(query)
    const cursor = decodeCursor(query.cursor)
    const direction: 'older' | 'newer' = query.direction === 'newer' ? 'newer' : 'older'
    const values: unknown[] = [...params]

    let orderSql = 'ORDER BY timestamp DESC, row_id DESC'
    if (cursor && direction === 'older') {
      clauses.push('(timestamp < ? OR (timestamp = ? AND row_id < ?))')
      values.push(cursor.ts, cursor.ts, cursor.rowId)
    } else if (cursor && direction === 'newer') {
      clauses.push('(timestamp > ? OR (timestamp = ? AND row_id > ?))')
      values.push(cursor.ts, cursor.ts, cursor.rowId)
      orderSql = 'ORDER BY timestamp ASC, row_id ASC'
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = this.db
      .prepare(`SELECT ${MESSAGE_COLUMNS} FROM message ${whereSql} ${orderSql} LIMIT ?`)
      .all(...values, limit) as MessageRow[]

    const fetched = rows.map(toMessage)
    const items = direction === 'newer' ? fetched : fetched.reverse()
    const hasMore = rows.length === limit

    let nextCursor: string | null = null
    if (hasMore && items.length > 0) {
      const edge = direction === 'newer' ? items[items.length - 1] : items[0]
      nextCursor = encodeCursor(edge.timestamp, edge.rowId)
    }

    return { items, nextCursor, hasMore }
  }

  /** 返回目标消息及其前后若干条上下文，用于搜索跳转定位 */
  context(chatId: string, messageId: string, radius = 30): MessageItem[] {
    const size = clampLimit(radius, 30)
    const target = this.db
      .prepare(`SELECT ${MESSAGE_COLUMNS} FROM message WHERE chat_id = ? AND id = ? LIMIT 1`)
      .get(chatId, messageId) as MessageRow | undefined
    if (!target) return []

    const before = this.db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM message
         WHERE chat_id = ? AND (timestamp < ? OR (timestamp = ? AND row_id < ?))
         ORDER BY timestamp DESC, row_id DESC LIMIT ?`
      )
      .all(chatId, target.timestamp, target.timestamp, target.row_id, size) as MessageRow[]

    const after = this.db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM message
         WHERE chat_id = ? AND (timestamp > ? OR (timestamp = ? AND row_id > ?))
         ORDER BY timestamp ASC, row_id ASC LIMIT ?`
      )
      .all(chatId, target.timestamp, target.timestamp, target.row_id, size) as MessageRow[]

    return [
      ...before.reverse().map(toMessage),
      toMessage(target),
      ...after.map(toMessage)
    ]
  }

  /** 全局检索：按会话聚合，附带命中总数与耗时 */
  search(query: MessageQuery): SearchResponse {
    const startedAt = Date.now()
    const limit = clampLimit(query.limit, 300)

    const countFilter = buildFilterClauses(query)
    const countWhere = countFilter.clauses.length
      ? `WHERE ${countFilter.clauses.join(' AND ')}`
      : ''
    const total = (
      this.db
        .prepare(`SELECT COUNT(*) AS total FROM message ${countWhere}`)
        .get(...countFilter.params) as { total: number }
    ).total

    const { clauses, params } = buildFilterClauses(query)
    const values: unknown[] = [...params]
    const cursor = decodeCursor(query.cursor)
    if (cursor) {
      clauses.push('(timestamp < ? OR (timestamp = ? AND row_id < ?))')
      values.push(cursor.ts, cursor.ts, cursor.rowId)
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = this.db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM message ${whereSql}
         ORDER BY timestamp DESC, row_id DESC LIMIT ?`
      )
      .all(...values, limit) as MessageRow[]

    const items = rows.map(toMessage)
    const groupMap = new Map<string, SearchGroup>()
    for (const item of items) {
      let group = groupMap.get(item.chatId)
      if (!group) {
        group = {
          chatId: item.chatId,
          chatName: item.chatId,
          chatKind: 'unknown',
          count: 0,
          items: []
        }
        groupMap.set(item.chatId, group)
      }
      group.items.push(item)
      group.count += 1
    }

    if (groupMap.size > 0) {
      const ids = [...groupMap.keys()]
      const chatRows = this.db
        .prepare(
          `SELECT id, name, kind FROM chat WHERE id IN (${ids.map(() => '?').join(',')})`
        )
        .all(...ids) as Array<{ id: string; name: string; kind: string }>
      for (const row of chatRows) {
        const group = groupMap.get(row.id)
        if (group) {
          group.chatName = row.name
          group.chatKind = row.kind as ChatKind
        }
      }
    }

    const groups = [...groupMap.values()].sort((a, b) => b.count - a.count)
    const hasMore = rows.length === limit
    const last = items[items.length - 1]

    return {
      total,
      tookMs: Date.now() - startedAt,
      groups,
      nextCursor: hasMore && last ? encodeCursor(last.timestamp, last.rowId) : null,
      hasMore
    }
  }
}
