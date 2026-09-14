import Database from 'better-sqlite3'
import { existsSync, rmSync } from 'node:fs'
import { basename } from 'node:path'
import { cleanText, decodeContent, parseDecoded } from '../../shared/content'
import type { ChatKind, MessageKind } from '../../shared/types'
import {
  CACHE_SCHEMA_VERSION,
  fingerprintKey,
  type SourceFingerprint,
  type SourceFingerprintFile
} from './cache-key'

/** 每批写入条数 */
const BATCH_SIZE = 2000

export interface BuildProgress {
  processed: number
  total: number
  phase: 'messages' | 'dedupe' | 'indexing' | 'done'
  label?: string
}

export interface BuildResult {
  messageCount: number
  chatCount: number
  /** 合并时因消息 ID 重复被跳过的条数 */
  duplicateMessages: number
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

/** 先建 id 索引以便高效去重，再建查询索引 */
const ID_INDEX = `
CREATE INDEX idx_msg_id ON message(id);
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

function openSource(file: string): Database.Database {
  return new Database(file, { readonly: true, fileMustExist: true })
}

function sourceMessageCount(db: Database.Database): number {
  try {
    return (db.prepare('SELECT COUNT(*) AS c FROM message_list').get() as { c: number }).c
  } catch {
    return 0
  }
}

/**
 * 流式构建索引缓存：按优先级顺序读取多个只读源库，合并写入缓存库。
 *
 * - 源库顺序即优先级：越靠前越新，同一消息 ID 保留最先写入（最新）的版本
 * - 会话的 message_count / last_timestamp 在合并去重后重新统计，因此结果是
 *   「全部源库按消息 ID 去重后的总量」
 */
export async function buildIndex(
  sources: SourceFingerprintFile[],
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

  const cache = new Database(cachePath)
  try {
    cache.pragma('journal_mode = OFF')
    cache.pragma('synchronous = OFF')
    cache.pragma('temp_store = MEMORY')
    cache.exec(SCHEMA)

    const insertChat = cache.prepare(
      `INSERT OR IGNORE INTO chat
       (id, name, avatar, kind, chat_type, is_top, seq, message_count, last_timestamp, last_preview)
       VALUES (@id, @name, @avatar, @kind, @chat_type, 0, @seq, 0, 0, @last_preview)`
    )
    const insertMessage = cache.prepare(
      `INSERT INTO message
       (id, chat_id, chat_type, from_id, name, avatar, kind, message_type, at,
        is_mine, is_withdrawn, timestamp, str_date, text, raw)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    // 预先统计总量，用于进度百分比
    const totals = new Map<string, number>()
    let grandTotal = 0
    for (const source of sources) {
      const db = openSource(source.path)
      const count = sourceMessageCount(db)
      db.close()
      totals.set(source.path, count)
      grandTotal += count
    }

    const topIds = new Set<string>()
    let processed = 0

    for (const source of sources) {
      const db = openSource(source.path)
      try {
        const label = basename(source.path)

        // 1. 会话（OR IGNORE：优先级更高的源库先写入，即新快照优先）
        const chats = db
          .prepare('SELECT id, name, avatar, type, lastMessage, seq FROM chat_list')
          .all() as ChatListRow[]
        cache.exec('BEGIN')
        for (const chat of chats) {
          const chatId = cleanText(chat.id)
          if (!chatId) continue
          const chatType = cleanText(chat.type)
          insertChat.run({
            id: chatId,
            name: cleanText(chat.name),
            avatar: cleanText(chat.avatar),
            kind: kindOfChat(chatType),
            chat_type: chatType,
            seq: Number(chat.seq) || 0,
            last_preview: cleanText(chat.lastMessage).slice(0, 200)
          })
        }
        for (const row of db.prepare('SELECT id FROM chat_top').all() as Array<{ id: string }>) {
          const chatId = cleanText(row.id)
          if (chatId) topIds.add(chatId)
        }
        cache.exec('COMMIT')

        // 2. 消息（流式写入）
        const iterator = db
          .prepare(
            `SELECT id, name, chatId, fromId, avatar, type, at, content, timestamp,
                    mine, withDraw, strDate, messageType
             FROM message_list ORDER BY timestamp ASC, id ASC`
          )
          .iterate() as IterableIterator<MessageRow>

        cache.exec('BEGIN')
        for (const row of iterator) {
          const decoded = decodeContent(row.content)
          const withdrawn = isTruthyFlag(row.withDraw)
          const parsed = parseDecoded(decoded, row.messageType, withdrawn)

          insertMessage.run(
            cleanText(row.id),
            cleanText(row.chatId),
            cleanText(row.type),
            cleanText(row.fromId),
            cleanText(row.name),
            cleanText(row.avatar),
            parsed.kind as MessageKind,
            cleanText(row.messageType),
            cleanText(row.at),
            isTruthyFlag(row.mine) ? 1 : 0,
            withdrawn ? 1 : 0,
            Number(row.timestamp) || 0,
            cleanText(row.strDate),
            parsed.text,
            decoded
          )

          processed += 1
          if (processed % BATCH_SIZE === 0) {
            onProgress({ processed, total: grandTotal, phase: 'messages', label })
            await nextTick()
          }
        }
        cache.exec('COMMIT')

        onProgress({ processed, total: grandTotal, phase: 'messages', label })
        await nextTick()
      } finally {
        db.close()
      }
    }

    // 3. 按消息 ID 去重：保留最先写入（即优先级最高 / 最新）的那一条
    onProgress({ processed, total: grandTotal, phase: 'dedupe' })
    await nextTick()

    const before = (cache.prepare('SELECT COUNT(*) AS c FROM message').get() as { c: number }).c
    cache.exec(ID_INDEX)
    cache.exec(
      `DELETE FROM message
       WHERE row_id > (SELECT MIN(m2.row_id) FROM message m2 WHERE m2.id = message.id)`
    )
    const after = (cache.prepare('SELECT COUNT(*) AS c FROM message').get() as { c: number }).c
    const duplicateMessages = before - after

    // 4. 补齐仅存在于消息中的会话（猿通讯会从会话列表移除会话但保留其消息），
    //    避免这些消息在界面上不可见
    cache.exec(
      `INSERT OR IGNORE INTO chat (id, name, kind, chat_type, is_top, seq)
       SELECT chat_id, '',
              CASE chat_type WHEN '0' THEN 'single' WHEN '1' THEN 'group' ELSE 'unknown' END,
              chat_type, 0, 0
       FROM message GROUP BY chat_id`
    )
    // 无名称的会话补一个可读名称：单聊取对方昵称，群聊用 ID 尾号标记
    cache.exec(
      `UPDATE chat SET name =
         CASE
           WHEN chat_type = '0' THEN IFNULL((
             SELECT m.name FROM message m
             WHERE m.chat_id = chat.id AND m.is_mine = 0 AND IFNULL(m.name, '') <> ''
             GROUP BY m.name ORDER BY COUNT(*) DESC LIMIT 1
           ), '单聊 ' || substr(id, -6))
           ELSE '群聊 ' || substr(id, -6)
         END
       WHERE IFNULL(name, '') = ''`
    )

    // 5. 置顶标记（取各源库置顶并集）
    cache.prepare('UPDATE chat SET is_top = 0').run()
    const markTop = cache.prepare('UPDATE chat SET is_top = 1 WHERE id = ?')
    for (const chatId of topIds) markTop.run(chatId)

    // 6. 合并去重后重新统计每个会话的量与预览
    onProgress({ processed: grandTotal, total: grandTotal, phase: 'indexing' })
    await nextTick()

    cache.exec(INDEXES)
    cache.exec(
      `UPDATE chat SET
         message_count = IFNULL((SELECT COUNT(*) FROM message WHERE message.chat_id = chat.id), 0),
         last_timestamp = IFNULL((SELECT MAX(timestamp) FROM message WHERE message.chat_id = chat.id), 0)`
    )
    // 仅对本来没有预览的会话补一个（无消息的会话保持空串，避免违反 NOT NULL）
    cache.exec(
      `UPDATE chat SET last_preview = IFNULL((
         SELECT IFNULL(m.name, '') || ': ' || substr(IFNULL(m.text, ''), 1, 80)
         FROM message m WHERE m.chat_id = chat.id
         ORDER BY m.timestamp DESC, m.row_id DESC LIMIT 1
       ), '') WHERE IFNULL(last_preview, '') = ''`
    )

    // 7. 元数据
    const chatCount = (cache.prepare('SELECT COUNT(*) AS c FROM chat').get() as { c: number }).c
    const meta = cache.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)')
    cache.exec('BEGIN')
    meta.run('schema_version', String(CACHE_SCHEMA_VERSION))
    meta.run('source_hash', fingerprintKey(fp))
    meta.run('source_count', String(sources.length))
    meta.run('source_paths', JSON.stringify(sources.map((s) => s.path)))
    meta.run('built_at', String(Date.now()))
    meta.run('message_count', String(after))
    meta.run('chat_count', String(chatCount))
    meta.run('duplicate_messages', String(duplicateMessages))
    cache.exec('COMMIT')

    cache.exec('ANALYZE')
    onProgress({ processed: grandTotal, total: grandTotal, phase: 'done' })

    return {
      messageCount: after,
      chatCount,
      duplicateMessages,
      buildMs: Date.now() - startedAt
    }
  } finally {
    cache.close()
  }
}

/** 校验缓存是否与当前源库集合（指纹）匹配 */
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
      map.get('source_hash') === fingerprintKey(fp)
    )
  } catch {
    return false
  } finally {
    if (db) db.close()
  }
}
