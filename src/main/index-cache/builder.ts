import Database from 'better-sqlite3'
import { existsSync, rmSync } from 'node:fs'
import { cleanText, decodeContent, parseDecoded } from '../../shared/content'
import type { ChatKind, MessageKind } from '../../shared/types'
import { CACHE_SCHEMA_VERSION, type SourceFingerprint } from './cache-key'

/** 每批写入条数 */
const BATCH_SIZE = 2000

export interface BuildProgress {
  processed: number
  total: number
  phase: string
}

export interface BuildResult {
  messageCount: number
  chatCount: number
  buildMs: number
}

const SCHEMA = `
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE chat(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'unknown',
  chat_type TEXT NOT NULL DEFAULT '',
  is_top INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  last_timestamp INTEGER NOT NULL DEFAULT 0,
  last_preview TEXT NOT NULL DEFAULT ''
);
CREATE TABLE message(
  row_id INTEGER PRIMARY KEY,
  id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  chat_type TEXT NOT NULL DEFAULT '',
  from_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'text',
  message_type TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL DEFAULT '',
  is_mine INTEGER NOT NULL DEFAULT 0,
  is_withdrawn INTEGER NOT NULL DEFAULT 0,
  timestamp INTEGER NOT NULL DEFAULT 0,
  str_date TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  raw TEXT NOT NULL DEFAULT ''
);
`

const INDEXES = `
CREATE INDEX idx_msg_chat_ts ON message(chat_id, timestamp, row_id);
CREATE INDEX idx_msg_ts ON message(timestamp, row_id);
CREATE INDEX idx_msg_chat_from ON message(chat_id, from_id);
CREATE INDEX idx_msg_chat_kind ON message(chat_id, kind);
CREATE INDEX idx_msg_chat_date ON message(chat_id, str_date);
CREATE INDEX idx_chat_last ON chat(is_top, last_timestamp);
`

function kindOfChat(chatType: string): ChatKind {
  if (chatType === '0') return 'single'
  if (chatType === '1') return 'group'
  return 'unknown'
}

function isTruthyFlag(value: unknown): boolean {
  return cleanText(value).toLowerCase() === 'true'
}

interface ChatListRow {
  id: string
  name: string
  avatar: string
  type: string | null
  lastMessage: string | null
  seq: number | null
}

interface ChatStatRow {
  cid: string
  c: number
  mt: number | null
}

interface MessageRow {
  id: string
  name: string | null
  chatId: string | null
  fromId: string | null
  avatar: string | null
  type: string | null
  at: string | null
  content: string | null
  timestamp: number | null
  mine: unknown
  withDraw: unknown
  strDate: string | null
  messageType: unknown
}

const nextTick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/**
 * 流式构建索引缓存：读取只读源库，解码并规范化后写入缓存库。
 * 分批让出事件循环，以便主进程能持续回传进度。
 */
export async function buildIndex(
  sourcePath: string,
  cachePath: string,
  fp: SourceFingerprint,
  onProgress: (progress: BuildProgress) => void
): Promise<BuildResult> {
  const startedAt = Date.now()

  if (existsSync(cachePath)) rmSync(cachePath, { force: true })
  for (const suffix of ['-journal', '-wal', '-shm']) {
    const extra = `${cachePath}${suffix}`
    if (existsSync(extra)) rmSync(extra, { force: true })
  }

  const source = new Database(sourcePath, { readonly: true, fileMustExist: true })
  const cache = new Database(cachePath)
  try {
    cache.pragma('journal_mode = OFF')
    cache.pragma('synchronous = OFF')
    cache.pragma('temp_store = MEMORY')
    cache.exec(SCHEMA)

    // 1. 会话表 + 统计
    const chats = source
      .prepare('SELECT id, name, avatar, type, lastMessage, seq FROM chat_list')
      .all() as ChatListRow[]
    const stats = source
      .prepare(
        'SELECT chatId AS cid, COUNT(*) AS c, MAX(timestamp) AS mt FROM message_list GROUP BY chatId'
      )
      .all() as ChatStatRow[]
    const statMap = new Map<string, ChatStatRow>()
    for (const row of stats) statMap.set(row.cid, row)

    const topIds = new Set<string>(
      (source.prepare('SELECT id FROM chat_top').all() as Array<{ id: string }>).map((r) => r.id)
    )

    const insertChat = cache.prepare(
      `INSERT OR REPLACE INTO chat
       (id, name, avatar, kind, chat_type, is_top, seq, message_count, last_timestamp, last_preview)
       VALUES (@id, @name, @avatar, @kind, @chat_type, @is_top, @seq, @message_count, @last_timestamp, @last_preview)`
    )

    cache.exec('BEGIN')
    for (const chat of chats) {
      const chatId = cleanText(chat.id)
      if (!chatId) continue
      const chatType = cleanText(chat.type)
      const stat = statMap.get(chatId)
      insertChat.run({
        id: chatId,
        name: cleanText(chat.name),
        avatar: cleanText(chat.avatar),
        kind: kindOfChat(chatType),
        chat_type: chatType,
        is_top: topIds.has(chatId) ? 1 : 0,
        seq: Number(chat.seq) || 0,
        message_count: stat ? stat.c : 0,
        last_timestamp: stat?.mt ? Number(stat.mt) : 0,
        last_preview: cleanText(chat.lastMessage).slice(0, 200)
      })
    }
    cache.exec('COMMIT')

    // 2. 消息表（流式写入）
    const total = (
      source.prepare('SELECT COUNT(*) AS c FROM message_list').get() as { c: number }
    ).c

    const insertMessage = cache.prepare(
      `INSERT INTO message
       (id, chat_id, chat_type, from_id, name, avatar, kind, message_type, at,
        is_mine, is_withdrawn, timestamp, str_date, text, raw)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    const iterator = source
      .prepare(
        `SELECT id, name, chatId, fromId, avatar, type, at, content, timestamp,
                mine, withDraw, strDate, messageType
         FROM message_list ORDER BY timestamp ASC, id ASC`
      )
      .iterate() as IterableIterator<MessageRow>

    let processed = 0
    let inTransaction = false

    cache.exec('BEGIN')
    inTransaction = true

    for (const row of iterator) {
      const decoded = decodeContent(row.content)
      const withdrawn = isTruthyFlag(row.withDraw)
      const parsed = parseDecoded(decoded, row.messageType, withdrawn)
      const typeKey = cleanText(row.messageType)

      insertMessage.run(
        cleanText(row.id),
        cleanText(row.chatId),
        cleanText(row.type),
        cleanText(row.fromId),
        cleanText(row.name),
        cleanText(row.avatar),
        parsed.kind as MessageKind,
        typeKey,
        cleanText(row.at),
        isTruthyFlag(row.mine) ? 1 : 0,
        withdrawn ? 1 : 0,
        Number(row.timestamp) || 0,
        cleanText(row.strDate),
        parsed.text,
        decoded
      )

      processed++

      if (processed % BATCH_SIZE === 0) {
        cache.exec('COMMIT')
        inTransaction = false
        onProgress({ processed, total, phase: 'messages' })
        await nextTick()
        cache.exec('BEGIN')
        inTransaction = true
      }
    }

    if (inTransaction) {
      cache.exec('COMMIT')
      inTransaction = false
    }

    onProgress({ processed, total, phase: 'indexing' })
    await nextTick()

    // 3. 建索引 + 元数据
    cache.exec(INDEXES)
    const meta = cache.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)')
    cache.exec('BEGIN')
    meta.run('schema_version', String(CACHE_SCHEMA_VERSION))
    meta.run('source_path', fp.path)
    meta.run('source_size', String(fp.size))
    meta.run('source_mtime', String(fp.mtimeMs))
    meta.run('built_at', String(Date.now()))
    meta.run('message_count', String(processed))
    meta.run('chat_count', String(chats.length))
    cache.exec('COMMIT')

    cache.exec('ANALYZE')

    onProgress({ processed, total, phase: 'done' })

    return { messageCount: processed, chatCount: chats.length, buildMs: Date.now() - startedAt }
  } finally {
    cache.close()
    source.close()
  }
}

/** 校验缓存是否与当前源库指纹匹配 */
export function isCacheValid(cachePath: string, fp: SourceFingerprint): boolean {
  if (!existsSync(cachePath)) return false
  let db: Database.Database | null = null
  try {
    db = new Database(cachePath, { readonly: true, fileMustExist: true, timeout: 2000 })
    const rows = db.prepare('SELECT key, value FROM meta').all() as Array<{
      key: string
      value: string
    }>
    const map = new Map(rows.map((r) => [r.key, r.value]))
    return (
      map.get('schema_version') === String(CACHE_SCHEMA_VERSION) &&
      map.get('source_path') === fp.path &&
      map.get('source_size') === String(fp.size) &&
      map.get('source_mtime') === String(fp.mtimeMs)
    )
  } catch {
    return false
  } finally {
    if (db) db.close()
  }
}
