import Database from 'better-sqlite3'
import { existsSync, rmSync } from 'node:fs'
import { basename } from 'node:path'
import { cleanText, decodeContent, parseDecoded } from '../../shared/content'
import type { ChatKind, MessageKind } from '../../shared/types'
import {
  CACHE_SCHEMA_VERSION,
  fileKey,
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
  /** 本次实际重新解码的源库数 */
  decodedFiles: number
  /** 直接复用缓存、未重新解码的源库数 */
  reusedFiles: number
  incremental: boolean
  buildMs: number
}

const SCHEMA = `
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE source(
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  fingerprint TEXT NOT NULL,
  rank INTEGER NOT NULL DEFAULT 0,
  inserted_rows INTEGER NOT NULL DEFAULT 0,
  stored_rows INTEGER NOT NULL DEFAULT 0,
  complete INTEGER NOT NULL DEFAULT 1
);
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
  raw TEXT NOT NULL DEFAULT '',
  src_id INTEGER NOT NULL DEFAULT 0,
  src_rank INTEGER NOT NULL DEFAULT 0
);
`

/** 先建 id / src 索引以便高效去重与统计，再建查询索引 */
const WORK_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_msg_id ON message(id);
CREATE INDEX IF NOT EXISTS idx_msg_src ON message(src_id);
`

const QUERY_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_msg_chat_ts ON message(chat_id, timestamp, row_id);
CREATE INDEX IF NOT EXISTS idx_msg_ts ON message(timestamp, row_id);
CREATE INDEX IF NOT EXISTS idx_msg_chat_from ON message(chat_id, from_id);
CREATE INDEX IF NOT EXISTS idx_msg_chat_kind ON message(chat_id, kind);
CREATE INDEX IF NOT EXISTS idx_msg_chat_date ON message(chat_id, str_date);
CREATE INDEX IF NOT EXISTS idx_chat_last ON chat(is_top, last_timestamp);
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

interface StoredSource {
  id: number
  path: string
  fingerprint: string
  rank: number
  inserted_rows: number
  stored_rows: number
  complete: number
}

const nextTick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function readMeta(db: Database.Database, key: string): string | null {
  try {
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row ? row.value : null
  } catch {
    return null
  }
}

function hasSchema(db: Database.Database): boolean {
  try {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'source'")
      .get()
    return Boolean(row) && readMeta(db, 'schema_version') === String(CACHE_SCHEMA_VERSION)
  } catch {
    return false
  }
}

function readSources(db: Database.Database): Map<string, StoredSource> {
  const rows = db
    .prepare(
      'SELECT id, path, fingerprint, rank, inserted_rows, stored_rows, complete FROM source'
    )
    .all() as StoredSource[]
  return new Map(rows.map((row) => [row.path, row]))
}

/** 缓存是否与当前文件集合完全一致（可直接使用，无需任何构建） */
export function isCacheCurrent(cachePath: string, files: SourceFingerprintFile[]): boolean {
  if (!existsSync(cachePath)) return false

  let db: Database.Database | null = null
  try {
    db = new Database(cachePath, { readonly: true, fileMustExist: true, timeout: 2000 })
    if (!hasSchema(db)) return false

    const rows = db
      .prepare('SELECT path, fingerprint FROM source ORDER BY rank')
      .all() as Array<{ path: string; fingerprint: string }>
    if (rows.length !== files.length) return false
    return files.every(
      (file, index) =>
        rows[index].path === file.path && rows[index].fingerprint === fileKey(file)
    )
  } catch {
    return false
  } finally {
    if (db) db.close()
  }
}

/**
 * 构建 / 增量更新索引缓存。
 *
 * - 只重新解码「新增、指纹变化、或上次去重导致数据不完整」的源库，其余直接复用缓存行
 * - 以 (src_rank, row_id) 取优去重，优先级高的源库胜出
 */
export async function buildIndex(
  files: SourceFingerprintFile[],
  cachePath: string,
  onProgress: (progress: BuildProgress) => void
): Promise<BuildResult> {
  const startedAt = Date.now()
  const cache = new Database(cachePath)

  try {
    cache.pragma('journal_mode = OFF')
    cache.pragma('synchronous = OFF')
    cache.pragma('temp_store = MEMORY')

    const fresh = !hasSchema(cache)
    if (fresh) {
      cache.exec(
        'DROP TABLE IF EXISTS message; DROP TABLE IF EXISTS chat; DROP TABLE IF EXISTS source; DROP TABLE IF EXISTS meta;'
      )
      cache.exec(SCHEMA)
    }
    cache.exec(WORK_INDEXES)

    const stored = readSources(cache)
    const desired = files.map((file, rank) => ({ file, rank, fingerprint: fileKey(file) }))
    const desiredPaths = new Set(desired.map((item) => item.file.path))

    const insertSource = cache.prepare(
      'INSERT INTO source(path, fingerprint, rank) VALUES (?, ?, ?)'
    )
    const sourceIdOf = (path: string): number => {
      const row = cache.prepare('SELECT id FROM source WHERE path = ?').get(path) as
        | { id: number }
        | undefined
      if (row) return row.id
      return Number(insertSource.run(path, '', 0).lastInsertRowid)
    }

    // 1. 分类：需要重新解码的源，以及「暂缓」的源
    //
    // 暂缓的是「上次被去重删掉过行、数据不完整」的源（例如快照链里被更新的快照完全覆盖的旧备份）。
    // 只有当优先级高于它的源发生**增删或次序变化**时才需要重解码；若仅是新快照追加了消息，
    // 这些旧备份的行依然必然是重复的，重解码纯属浪费。
    // （若更高优先级的源消息数**减少**了，说明有消息被删除，此时再把这些源补进来，
    //   保证「所有库的并集」语义不丢数据 —— 见下面的 decrease 判断。）
    const toDecode: Array<{
      file: SourceFingerprintFile
      rank: number
      id: number
      fingerprint: string
      previousInserted: number
    }> = []
    const deferred: typeof toDecode = []
    let reusedFiles = 0

    const changeRanks: number[] = []
    for (const item of desired) {
      const previous = stored.get(item.file.path)
      if (!previous) changeRanks.push(item.rank)
      else if (previous.fingerprint === item.fingerprint && previous.rank !== item.rank) {
        changeRanks.push(item.rank)
      }
    }
    for (const previous of stored.values()) {
      if (!desiredPaths.has(previous.path)) changeRanks.push(previous.rank)
    }

    for (const item of desired) {
      const previous = stored.get(item.file.path)
      const entry = {
        file: item.file,
        rank: item.rank,
        id: previous?.id ?? 0,
        fingerprint: item.fingerprint,
        previousInserted: previous?.inserted_rows ?? 0
      }

      if (!previous || previous.fingerprint !== item.fingerprint) {
        entry.id = sourceIdOf(item.file.path)
        toDecode.push(entry)
        continue
      }

      if (previous.complete !== 1) {
        if (changeRanks.some((rank) => rank < item.rank)) toDecode.push(entry)
        else deferred.push(entry)
        continue
      }

      reusedFiles += 1
      if (previous.rank !== item.rank) {
        // 优先级变化：同步 rank（消息表冗余了一份，需一起更新）
        cache.prepare('UPDATE source SET rank = ? WHERE id = ?').run(item.rank, previous.id)
        cache.prepare('UPDATE message SET src_rank = ? WHERE src_id = ?').run(
          item.rank,
          previous.id
        )
      }
    }

    // 2. 清理已不在范围内的源
    for (const previous of stored.values()) {
      if (desiredPaths.has(previous.path)) continue
      cache.prepare('DELETE FROM message WHERE src_id = ?').run(previous.id)
      cache.prepare('DELETE FROM source WHERE id = ?').run(previous.id)
    }

    // 3. 统计待解码源的消息量（用于进度），并据此判断是否有源「消息数减少」
    const counts = new Map<string, number>()
    const measure = (file: SourceFingerprintFile): number => {
      let count = 0
      let db: Database.Database | null = null
      try {
        db = new Database(file.path, { readonly: true, fileMustExist: true })
        count = (db.prepare('SELECT COUNT(*) AS c FROM message_list').get() as { c: number }).c
      } catch {
        count = 0
      } finally {
        if (db) db.close()
      }
      counts.set(file.path, count)
      return count
    }

    let grandTotal = 0
    for (const item of toDecode) {
      grandTotal += measure(item.file)
      // 大数据量时该查询也是整表扫描，逐文件让出事件循环保持界面响应
      await nextTick()
    }

    // 若某个已存在源的消息数减少（库内发生了删除），此前被它完全覆盖的旧备份可能重新变得需要，
    // 于是把「暂缓」的源补充进来重新解码，保证并集语义不丢数据
    const decreased = toDecode.some(
      (item) =>
        item.previousInserted > 0 &&
        (counts.get(item.file.path) ?? 0) < item.previousInserted
    )
    if (decreased) {
      for (const item of deferred) {
        toDecode.push(item)
        grandTotal += measure(item.file)
      }
    } else {
      // 未发生删除：暂缓的源直接沿用缓存中的行
      reusedFiles += deferred.length
    }

    const insertMessage = cache.prepare(
      `INSERT INTO message
       (id, chat_id, chat_type, from_id, name, avatar, kind, message_type, at,
        is_mine, is_withdrawn, timestamp, str_date, text, raw, src_id, src_rank)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    // 4. 逐源解码写入
    let processed = 0
    for (const item of toDecode) {
      const label = basename(item.file.path)

      cache.prepare('DELETE FROM message WHERE src_id = ?').run(item.id)
      cache
        .prepare(
          `UPDATE source SET fingerprint = ?, rank = ?, inserted_rows = 0,
             stored_rows = 0, complete = 0 WHERE id = ?`
        )
        .run(item.fingerprint, item.rank, item.id)

      let db: Database.Database | null = null
      let inserted = 0
      try {
        db = new Database(item.file.path, { readonly: true, fileMustExist: true })
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
            decoded,
            item.id,
            item.rank
          )

          inserted += 1
          processed += 1
          if (processed % BATCH_SIZE === 0) {
            onProgress({ processed, total: grandTotal, phase: 'messages', label })
            await nextTick()
          }
        }
        cache.exec('COMMIT')
      } catch {
        // 源库读取失败：回滚本次写入，保留旧数据（若为新增则相当于跳过）
        try {
          cache.exec('ROLLBACK')
        } catch {
          // 忽略
        }
      } finally {
        if (db) db.close()
      }

      cache.prepare('UPDATE source SET inserted_rows = ? WHERE id = ?').run(inserted, item.id)
      if (inserted !== (counts.get(item.file.path) ?? 0)) {
        // 读取不完整，标记为不完整以便下次重试
        cache.prepare('UPDATE source SET complete = 0 WHERE id = ?').run(item.id)
      }
      onProgress({ processed, total: grandTotal, phase: 'messages', label })
      await nextTick()
    }

    // 5. 重建会话表（会话量很小，直接全量重建更简单可靠）
    onProgress({ processed: grandTotal, total: grandTotal, phase: 'indexing' })
    await nextTick()

    cache.exec('DELETE FROM chat')
    const insertChat = cache.prepare(
      `INSERT OR IGNORE INTO chat
       (id, name, avatar, kind, chat_type, is_top, seq, message_count, last_timestamp, last_preview)
       VALUES (@id, @name, @avatar, @kind, @chat_type, 0, @seq, 0, 0, @last_preview)`
    )

    const topIds = new Set<string>()
    for (const item of desired) {
      let db: Database.Database | null = null
      try {
        db = new Database(item.file.path, { readonly: true, fileMustExist: true })
        const chats = db
          .prepare('SELECT id, name, avatar, type, lastMessage, seq FROM chat_list')
          .all() as ChatListRow[]
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
      } catch {
        // 源库不可用则跳过其会话信息
      } finally {
        if (db) db.close()
      }
    }

    // 6. 按消息 ID 去重：优先级更高（src_rank 更小）的源胜出，其次保留写入更早的行
    onProgress({ processed: grandTotal, total: grandTotal, phase: 'dedupe' })
    await nextTick()

    const before = (cache.prepare('SELECT COUNT(*) AS c FROM message').get() as { c: number }).c
    cache.exec(
      `DELETE FROM message WHERE EXISTS (
         SELECT 1 FROM message m2
         WHERE m2.id = message.id
           AND (m2.src_rank < message.src_rank
                OR (m2.src_rank = message.src_rank AND m2.row_id < message.row_id))
       )`
    )
    const after = (cache.prepare('SELECT COUNT(*) AS c FROM message').get() as { c: number }).c
    const duplicateMessages = before - after

    // 7. 回写各源的去重后行数，并标记数据是否完整
    cache.exec(
      'UPDATE source SET stored_rows = IFNULL((SELECT COUNT(*) FROM message WHERE message.src_id = source.id), 0)'
    )
    cache.exec('UPDATE source SET complete = CASE WHEN stored_rows = inserted_rows THEN 1 ELSE 0 END')

    // 8. 补齐仅存在于消息中的会话（猿通讯会从会话列表移除会话但保留其消息）
    cache.exec(
      `INSERT OR IGNORE INTO chat (id, name, kind, chat_type, is_top, seq)
       SELECT chat_id, '',
              CASE chat_type WHEN '0' THEN 'single' WHEN '1' THEN 'group' ELSE 'unknown' END,
              chat_type, 0, 0
       FROM message GROUP BY chat_id`
    )
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

    // 9. 置顶并集与统计
    cache.prepare('UPDATE chat SET is_top = 0').run()
    const markTop = cache.prepare('UPDATE chat SET is_top = 1 WHERE id = ?')
    for (const chatId of topIds) markTop.run(chatId)

    cache.exec(QUERY_INDEXES)
    cache.exec(
      `UPDATE chat SET
         message_count = IFNULL((SELECT COUNT(*) FROM message WHERE message.chat_id = chat.id), 0),
         last_timestamp = IFNULL((SELECT MAX(timestamp) FROM message WHERE message.chat_id = chat.id), 0)`
    )
    cache.exec(
      `UPDATE chat SET last_preview = IFNULL((
         SELECT IFNULL(m.name, '') || ': ' || substr(IFNULL(m.text, ''), 1, 80)
         FROM message m WHERE m.chat_id = chat.id
         ORDER BY m.timestamp DESC, m.row_id DESC LIMIT 1
       ), '') WHERE IFNULL(last_preview, '') = ''`
    )

    // 10. 元数据
    const chatCount = (cache.prepare('SELECT COUNT(*) AS c FROM chat').get() as { c: number }).c
    const meta = cache.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)')
    cache.exec('BEGIN')
    meta.run('schema_version', String(CACHE_SCHEMA_VERSION))
    meta.run('source_count', String(files.length))
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
      decodedFiles: toDecode.length,
      reusedFiles,
      incremental: !fresh && reusedFiles > 0,
      buildMs: Date.now() - startedAt
    }
  } finally {
    cache.close()
  }
}

/** 删除缓存文件（含 WAL 附属文件） */
export function removeCache(cachePath: string): void {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    const file = `${cachePath}${suffix}`
    if (existsSync(file)) {
      try {
        rmSync(file, { force: true })
      } catch {
        // 忽略
      }
    }
  }
}
