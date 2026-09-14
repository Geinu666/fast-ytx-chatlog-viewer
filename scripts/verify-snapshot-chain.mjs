/**
 * 校验「快照链」猜想 + 探测行级增量可行性。
 *
 * 猜想：带时间戳的 `message3763-YYYY-MM-DD-HH-mm-ss.db` 是每次应用退出时保存的、
 * 不会再变的历史快照；无时间戳的 `message3763.db` 是最新的全量库。若成立，则只需
 * 解析无时间戳那一个文件。
 *
 * 本脚本会输出：
 *   1. 每条链上各文件的行数 / 最新消息时间 / 大小；
 *   2. 无时间戳全量库是否为各快照的**超集**（按消息 id 逐条比对）；
 *   3. 只解析全量库相对全量合并能省下多少解码量；
 *   4. `message_list` 的列结构与 rowid 可用性（行级增量的前提）。
 *
 * 运行（better-sqlite3 按 Electron 的 ABI 编译，需借用 Electron 自带的 Node）：
 *   PowerShell:
 *     $env:ELECTRON_RUN_AS_NODE=1; npx electron scripts/verify-snapshot-chain.mjs "D:\Projects\fast-ytx-chatlog-viewer"
 *   Bash:
 *     ELECTRON_RUN_AS_NODE=1 npx electron scripts/verify-snapshot-chain.mjs "/path/to/dir"
 *
 * 若本机的 better-sqlite3 是给系统 Node 编译的，直接 `node scripts/verify-snapshot-chain.mjs <dir>` 亦可。
 */
import Database from 'better-sqlite3'
import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dir = resolve(process.argv[2] ?? '.')
const SNAPSHOT_STEM = /^(.*?)-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/i
const MAX = Number.MAX_SAFE_INTEGER

/** 拆解文件名 → { base, snapshotAt }；snapshotAt = 0 表示无时间戳的全量库 */
function parseName(name) {
  const stem = name.replace(/\.db$/i, '')
  const m = SNAPSHOT_STEM.exec(stem)
  if (!m) return { base: stem, snapshotAt: 0 }
  const at = new Date(
    Number(m[2]),
    Number(m[3]) - 1,
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
    Number(m[7])
  ).getTime()
  return { base: m[1], snapshotAt: at }
}

function collect(target) {
  return readdirSync(target)
    .filter((name) => /\.db$/i.test(name))
    .map((name) => {
      const path = join(target, name)
      const stat = statSync(path)
      return { name, path, size: stat.size, mtimeMs: Math.round(stat.mtimeMs), ...parseName(name) }
    })
}

function readSource(file) {
  const db = new Database(file.path, { readonly: true, fileMustExist: true, timeout: 3000 })
  try {
    const row = db
      .prepare('SELECT COUNT(*) AS total, IFNULL(MAX(timestamp), 0) AS newest FROM message_list')
      .get()
    const ids = new Set(db.prepare('SELECT id FROM message_list').pluck().all().map(String))

    let rowidOk = true
    let probe = null
    try {
      probe = db
        .prepare(
          `SELECT COUNT(*) AS c,
                  IFNULL(SUM(rowid), 0) AS s,
                  IFNULL(MAX(rowid), 0) AS mx,
                  SUM(CASE WHEN lower(IFNULL(CAST(withDraw AS TEXT), '')) = 'true' THEN 1 ELSE 0 END) AS w
           FROM message_list`
        )
        .get()
    } catch {
      rowidOk = false
    }

    return {
      total: row.total,
      newest: row.newest,
      ids,
      rowidOk,
      probe,
      tableInfo: db.pragma('table_info(message_list)')
    }
  } finally {
    db.close()
  }
}

const fmt = (ms) => (ms ? new Date(ms).toLocaleString('zh-CN') : '-')
const ratio = (a, b) => (b > 0 ? (a / b).toFixed(2) : '-')

const files = collect(dir)
if (files.length === 0) {
  console.error(`目录下没有 .db 文件：${dir}`)
  process.exit(1)
}

const groups = new Map()
for (const file of files) {
  const key = file.base.toLowerCase()
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(file)
}

for (const [base, list] of groups) {
  // 无时间戳的全量库排在最后，符合时间线直觉
  list.sort((a, b) => (a.snapshotAt || MAX) - (b.snapshotAt || MAX))
  const data = list.map((file) => ({ file, data: readSource(file) }))

  console.log(`\n===== 链 ${base}（${list.length} 个文件）=====`)
  for (const { file, data: d } of data) {
    console.log(
      `  ${file.name}\n` +
        `      行数=${d.total}  最新消息=${fmt(d.newest)}  大小=${file.size}` +
        `  文件时间=${fmt(file.mtimeMs)}  [${file.snapshotAt ? '历史快照' : '全量库'}]  rowid可用=${d.rowidOk}`
    )
  }

  const live = data.at(-1).file.snapshotAt === 0 ? data.at(-1) : null
  const snapshots = data.filter((item) => item.file.snapshotAt > 0)

  const union = new Set()
  for (const { data: d } of data) for (const id of d.ids) union.add(id)

  if (live) {
    console.log('  -- 全量库是否为各快照的超集 --')
    let allOk = true
    for (const snapshot of snapshots) {
      const only = [...snapshot.data.ids].filter((id) => !live.data.ids.has(id))
      if (only.length > 0) allOk = false
      console.log(
        `     ${only.length === 0 ? 'OK   ⊇' : `FAIL 差 ${only.length} 条`}  ${snapshot.file.name}`
      )
      if (only.length > 0) {
        console.log(`        仅快照独有（前 5 条 id）：${only.slice(0, 5).join(', ')}`)
      }
    }
    console.log(`     结论：${allOk ? '猜想成立 → 只解析无时间戳全量库即可' : '猜想不成立 → 需保留「合并快照」模式'}`)
  } else {
    console.log('  ⚠ 该链没有无时间戳的全量库，只能退化为取最新的一份快照')
  }

  const target = live ?? data.at(-1)
  const totalRows = data.reduce((sum, item) => sum + item.data.total, 0)
  const onlyInSnapshots = [...union].filter((id) => !target.data.ids.has(id))

  console.log('  -- 汇总 --')
  console.log(`     全部文件行数合计   = ${totalRows}`)
  console.log(`     按 ID 去重后       = ${union.size}`)
  console.log(`     只解析全量库       = ${target.data.total}（${target.file.name}）`)
  console.log(`     仅存在于快照的消息 = ${onlyInSnapshots.length}`)
  console.log(`     预期解码量下降     = ${ratio(totalRows, target.data.total)} 倍`)

  if (live?.data.tableInfo?.length) {
    console.log(
      `     message_list 列    = ${live.data.tableInfo
        .map((col) => `${col.name}${col.pk ? '(pk)' : ''}`)
        .join(', ')}`
    )
    if (live.data.probe) {
      console.log(
        `     水位参考值         = count=${live.data.probe.c} sumRowid=${live.data.probe.s} ` +
          `maxRowid=${live.data.probe.mx} withdrawn=${live.data.probe.w}`
      )
    }
  }
}
