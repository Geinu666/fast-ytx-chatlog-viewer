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
  /** 本次走「只追加新消息」行级增量的源库数 */
  appendedFiles: number
  /** 行级增量实际新增的消息条数 */
  appendedMessages: number
  /** 是否有源库的消息数比上次减少（库内发生删除） */
  decreased: boolean
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
  complete INTEGER NOT NULL DEFAULT 1,
  wm_count INTEGER NOT NULL DEFAULT 0,
  wm_rowid INTEGER NOT NULL DEFAULT 0,
  wm_sum_rowid INTEGER NOT NULL DEFAULT 0,
  wm_withdrawn INTEGER NOT NULL DEFAULT 0,
  wm_top_id TEXT NOT NULL DEFAULT ''
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
  local_path TEXT NOT NULL DEFAULT '',
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
  /** 源库记录的本地缓存路径（图片 / 文件），可能为空或脏值 */
  filePath: string | null
}

interface StoredSource {
  id: number
  path: string
  fingerprint: string
  rank: number
  inserted_rows: number
  stored_rows: number
  complete: number
  /** 上次成功解析时源库的行数（行级增量水位） */
  wm_count: number
  /** 上次成功解析时源库的 MAX(rowid) */
  wm_rowid: number
  /** 上次成功解析时源库的 SUM(rowid)，用于察觉「删掉最大 rowid 后被复用」这类隐蔽变化 */
  wm_sum_rowid: number
  /** 上次成功解析时源库中已撤回消息的条数，用于察觉旧消息被改动 */
  wm_withdrawn: number
  /** 上次成功解析时 `rowid = wm_rowid` 那一行的 id，作为水位锚点 */
  wm_top_id: string
}

/** 源库水位探测结果 */
interface SourceProbe {
  /** 库内消息总行数 */
  count: number
  /** SUM(rowid) */
  sumRowid: number
  /** MAX(rowid) */
  maxRowid: number
  /** 已撤回消息条数 */
  withdrawn: number
  /** rowid 是否可用（WITHOUT ROWID 表不可用，此时只能整库重解析） */
  rowidOk: boolean
  /** rowid > 水位 的行数（仅对已有水位的源有意义） */
  appendedCount: number
  /** rowid > 水位 的行 id 之和 */
  appendedSum: number
  /** 当前 `rowid = 水位` 那一行的 id；锚点被替换或消失时返回空串 */
  anchorId: string
  /** 当前 `rowid = MAX(rowid)` 那一行的 id，成功解析后写回 wm_top_id */
  topId: string
}

const MESSAGE_COLUMNS = `SELECT id, name, chatId, fromId, avatar, type, at, content, timestamp,
                               mine, withDraw, strDate, messageType, filePath
                        FROM message_list`

const PROBE_SQL = `
SELECT COUNT(*) AS count,
       IFNULL(SUM(rowid), 0) AS sumRowid,
       IFNULL(MAX(rowid), 0) AS maxRowid,
       IFNULL(SUM(CASE WHEN lower(IFNULL(CAST(withDraw AS TEXT), '')) = 'true' THEN 1 ELSE 0 END), 0) AS withdrawn
FROM message_list`

const PROBE_APPENDED_SQL = `
SELECT COUNT(*) AS count, IFNULL(SUM(rowid), 0) AS sumRowid
FROM message_list WHERE rowid > ?`

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
      `SELECT id, path, fingerprint, rank, inserted_rows, stored_rows, complete,
              wm_count, wm_rowid, wm_sum_rowid, wm_withdrawn, wm_top_id
       FROM source`
    )
    .all() as StoredSource[]
  return new Map(rows.map((row) => [row.path, row]))
}

/** 读取指定 rowid 上那一行的 id（走 rowid 主键，O(log n)） */
function idAtRowid(db: Database.Database, rowid: number): string {
  try {
    const row = db.prepare('SELECT id FROM message_list WHERE rowid = ?').get(rowid) as
      | { id: string }
      | undefined
    return row ? cleanText(row.id) : ''
  } catch {
    return ''
  }
}

/**
 * 探测源库水位。
 *
 * 主查询要读整张表（含 withDraw 列），在十万级消息上约几十毫秒；
 * 只会在「文件指纹发生变化」时执行，不影响缓存命中的启动路径。
 * 若源库是 WITHOUT ROWID 表或 rowid 不可用，则退化为「只统计行数」，
 * 该源将始终走整库重解析。
 */
function probeSource(filePath: string, watermark: number): SourceProbe {
  const result: SourceProbe = {
    count: 0,
    sumRowid: 0,
    maxRowid: 0,
    withdrawn: 0,
    rowidOk: false,
    appendedCount: 0,
    appendedSum: 0,
    anchorId: '',
    topId: ''
  }

  let db: Database.Database | null = null
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true, timeout: 2000 })

    // rowid 被同名列遮蔽时不能作为水位，退化为「只统计行数」
    const columns = db.pragma('table_info(message_list)') as Array<{ name: string }>
    if (
      columns.some((column) => ['rowid', 'oid', '_rowid_'].includes(column.name.toLowerCase()))
    ) {
      const row = db.prepare('SELECT COUNT(*) AS count FROM message_list').get() as {
        count: number
      }
      return { ...result, count: row.count }
    }

    try {
      const row = db.prepare(PROBE_SQL).get() as {
        count: number
        sumRowid: number
        maxRowid: number
        withdrawn: number
      }
      let appended = { count: 0, sumRowid: 0 }
      if (watermark > 0) {
        appended = db.prepare(PROBE_APPENDED_SQL).get(watermark) as {
          count: number
          sumRowid: number
        }
      }
      return {
        count: row.count,
        sumRowid: row.sumRowid,
        maxRowid: row.maxRowid,
        withdrawn: row.withdrawn,
        rowidOk: true,
        appendedCount: appended.count,
        appendedSum: appended.sumRowid,
        // 水位那一行还在不在、还是不是原来那条消息
        anchorId: watermark > 0 ? idAtRowid(db, watermark) : '',
        topId: row.maxRowid > 0 ? idAtRowid(db, row.maxRowid) : ''
      }
    } catch {
      const row = db.prepare('SELECT COUNT(*) AS count FROM message_list').get() as {
        count: number
      }
      return { ...result, count: row.count }
    }
  } catch {
    return result
  } finally {
    if (db) db.close()
  }
}

/**
 * 纯追加判定：源库当前内容是否恰好等于「上次解析的集合 ∪ rowid > 水位的新行」。
 *
 * 各条件拦截的变化类型：
 * - `count`     对不上 → 中间有行被删除（SQLite 只在删除「最大 rowid」时才可能补洞，
 *                        删中间行会留下永久空洞，行数必然对不上）
 * - `sumRowid`  对不上 → 水位上的行被替换成了别的 rowid
 * - `maxRowid`  对不上 → rowid 不再从水位连续增长，或文件被 VACUUM 重写
 * - `withdrawn` 变化   → 旧消息被撤回（行数不变，但内容已被改写）
 * - `anchorId`  变化   → **删掉最大 rowid 那一行后，新行复用了同一个 rowid**。
 *                        此时行数与 rowid 之和都恰好还原，只有比对「水位那一行的
 *                        消息 id」才能发现那一行已经不是原来那条消息了。
 *
 * 判定失败即回退为整库重解析，因此只是「损失一点速度」，不会丢数据。
 */
function isPureAppend(previous: StoredSource, probe: SourceProbe): boolean {
  if (!probe.rowidOk || previous.wm_rowid <= 0 || previous.wm_top_id === '') return false
  return (
    probe.count === previous.wm_count + probe.appendedCount &&
    probe.sumRowid === previous.wm_sum_rowid + probe.appendedSum &&
    probe.maxRowid === previous.wm_rowid + probe.appendedCount &&
    probe.withdrawn === previous.wm_withdrawn &&
    probe.anchorId === previous.wm_top_id
  )
}

/** 该源上次解析时的行数基线（用于判断库内是否发生删除） */
function baselineRows(previous: StoredSource | null): number {
  if (!previous) return 0
  return previous.wm_count > 0 ? previous.wm_count : previous.inserted_rows
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
 * 三级复用，越靠前越省：
 * 1. **整源复用**：指纹（路径 + 大小 + 修改时间）未变且上次收录完整 → 直接用缓存里的行；
 * 2. **行级增量**：指纹变了但通过「纯追加判定」（行数、SUM/MAX(rowid)、撤回数全部对得上）
 *    → 只解码 `rowid > 水位` 的新行，十万级消息库通常几十毫秒；
 * 3. **整库重解析**：判定不通过（发生删除、撤回、VACUUM 等）→ 清空该源的缓存行后重读。
 *
 * 去重以 (src_rank, row_id) 取优，优先级高的源库胜出。
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
      previous: StoredSource | null
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
        previous: previous ?? null
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

    // 3. 探测待解码源的水位（行数 / SUM(rowid) / MAX(rowid) / 撤回数）
    //
    // 既用于进度显示，也用于判定该源能否走「只追加新消息」的行级增量。
    // 主查询是整表扫描，因此逐文件让出事件循环保持界面响应。
    const probes = new Map<string, SourceProbe>()
    const probeOf = (file: SourceFingerprintFile, watermark: number): SourceProbe => {
      const probe = probeSource(file.path, watermark)
      probes.set(file.path, probe)
      return probe
    }

    /** 该条目本次能否只追加新行（要求上次收录完整，且库内变化通过纯追加判定） */
    const canAppend = (entry: {
      file: SourceFingerprintFile
      previous: StoredSource | null
    }): boolean => {
      const previous = entry.previous
      if (!previous || previous.complete !== 1) return false
      const probe = probes.get(entry.file.path)
      return probe !== undefined && isPureAppend(previous, probe)
    }

    let grandTotal = 0
    const accounted = new Set<string>()
    const accountFor = (entry: {
      file: SourceFingerprintFile
      previous: StoredSource | null
    }): void => {
      if (accounted.has(entry.file.path)) return
      accounted.add(entry.file.path)
      const probe = probes.get(entry.file.path)
      if (!probe) return
      grandTotal += canAppend(entry) ? probe.appendedCount : probe.count
    }

    for (const item of toDecode) {
      probeOf(item.file, item.previous?.wm_rowid ?? 0)
      accountFor(item)
      await nextTick()
    }

    // 若某个已存在源的消息数减少（库内发生了删除），此前被它完全覆盖的旧备份可能重新变得需要，
    // 于是把「暂缓」的源补充进来重新解码，保证并集语义不丢数据
    const decreased = toDecode.some((item) => {
      const baseline = baselineRows(item.previous)
      return baseline > 0 && (probes.get(item.file.path)?.count ?? 0) < baseline
    })
    if (decreased) {
      for (const item of deferred) {
        toDecode.push(item)
        probeOf(item.file, item.previous?.wm_rowid ?? 0)
        accountFor(item)
      }
    } else {
      // 未发生删除：暂缓的源直接沿用缓存中的行
      reusedFiles += deferred.length
    }

    const insertMessage = cache.prepare(
      `INSERT INTO message
       (id, chat_id, chat_type, from_id, name, avatar, kind, message_type, at,
        is_mine, is_withdrawn, timestamp, str_date, text, raw, local_path, src_id, src_rank)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    // 4. 逐源解码写入；能走行级增量时只解码 rowid 大于水位的部分
    let processed = 0
    let appendedFiles = 0
    let appendedMessages = 0

    for (const item of toDecode) {
      const label = basename(item.file.path)
      const probe = probes.get(item.file.path)
      const incremental = canAppend(item)
      const watermark = incremental && item.previous ? item.previous.wm_rowid : 0

      // 行级增量保留缓存里已有的行；整库重解析先清空该源的历史行
      if (!incremental) {
        cache.prepare('DELETE FROM message WHERE src_id = ?').run(item.id)
      }
      cache
        .prepare(
          `UPDATE source SET fingerprint = ?, rank = ?, inserted_rows = 0,
             stored_rows = 0, complete = 0 WHERE id = ?`
        )
        .run(item.fingerprint, item.rank, item.id)

      let db: Database.Database | null = null
      let inserted = 0
      try {
        db = new Database(item.file.path, { readonly: true, fileMustExist: true, timeout: 5000 })
        // 增量：只用 rowid 主键做范围扫描，几乎不耗时
        // 整库：沿用「按时间升序」读取，与历史版本行为保持一致
        const iterator = (
          watermark > 0
            ? db.prepare(`${MESSAGE_COLUMNS} WHERE rowid > ? ORDER BY rowid ASC`).iterate(watermark)
            : db.prepare(`${MESSAGE_COLUMNS} ORDER BY timestamp ASC, id ASC`).iterate()
        ) as IterableIterator<MessageRow>

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
            parsed.localPath ?? cleanText(row.filePath),
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

      // 增量时缓存里应当有「上次行数 + 本次新增」，整库时就是本次读到的行数
      const storedTotal = (incremental ? (item.previous?.wm_count ?? 0) : 0) + inserted
      cache.prepare('UPDATE source SET inserted_rows = ? WHERE id = ?').run(storedTotal, item.id)

      if (probe && storedTotal === probe.count) {
        // 解析结果与探测一致：推进水位，下次可继续只追加
        cache
          .prepare(
            `UPDATE source SET wm_count = ?, wm_rowid = ?, wm_sum_rowid = ?,
               wm_withdrawn = ?, wm_top_id = ? WHERE id = ?`
          )
          .run(
            probe.count,
            probe.maxRowid,
            probe.sumRowid,
            probe.withdrawn,
            probe.topId,
            item.id
          )
      } else {
        // 读取不完整，或读取期间源库又发生了变化：清空水位，下次整库重试
        cache
          .prepare(
            `UPDATE source SET complete = 0,
               wm_count = 0, wm_rowid = 0, wm_sum_rowid = 0, wm_withdrawn = 0, wm_top_id = ''
             WHERE id = ?`
          )
          .run(item.id)
      }

      if (incremental) {
        appendedFiles += 1
        appendedMessages += inserted
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
        db = new Database(item.file.path, { readonly: true, fileMustExist: true, timeout: 5000 })
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
    //
    // 「单源 + 本次只是往该源追加了新行」时可以直接跳过：上一轮的去重结果已经落在缓存里，
    // 追加行的 row_id 只会更大，不可能反过来淘汰已存在的行，因此这一步必然是空操作。
    onProgress({ processed: grandTotal, total: grandTotal, phase: 'dedupe' })
    await nextTick()

    const skipDedupe =
      files.length === 1 && toDecode.length > 0 && appendedFiles === toDecode.length

    let duplicateMessages = 0
    if (!skipDedupe) {
      const before = (cache.prepare('SELECT COUNT(*) AS c FROM message').get() as { c: number }).c
      cache.exec(
        `DELETE FROM message WHERE EXISTS (
           SELECT 1 FROM message m2
           WHERE m2.id = message.id
             AND (m2.src_rank < message.src_rank
                  OR (m2.src_rank = message.src_rank AND m2.row_id < message.row_id))
         )`
      )
      const afterDedupe = (cache.prepare('SELECT COUNT(*) AS c FROM message').get() as { c: number })
        .c
      duplicateMessages = before - afterDedupe
    }
    const after = (cache.prepare('SELECT COUNT(*) AS c FROM message').get() as { c: number }).c

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
      appendedFiles,
      appendedMessages,
      decreased,
      incremental: !fresh && (reusedFiles > 0 || appendedFiles > 0),
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
