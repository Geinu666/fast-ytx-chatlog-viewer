import { useMemo } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileText,
  FolderTree,
  Gauge,
  Layers,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X
} from 'lucide-react'
import type { DbSource } from '@shared/types'
import { cn } from '@renderer/lib/cn'
import { formatBytes, formatCount, formatDateTime } from '@renderer/lib/format'
import { useIndexStore } from '@renderer/store/useIndexStore'
import { useUiStore } from '@renderer/store/useUiStore'
import { ScanSourcesSection } from './ScanSourcesSection'

const dirnameOf = (path: string): string => path.replace(/[\\/][^\\/]*$/, '')

interface DirGroup {
  dir: string
  files: DbSource[]
  /** 其中被快照链折叠、本次未参与解析的历史快照数 */
  folded: number
  newest: number
  total: number
}

/** 数据源与索引管理浮层 */
export function DataSourcePanel() {
  const sources = useIndexStore((state) => state.sources)
  const status = useIndexStore((state) => state.status)
  const config = useIndexStore((state) => state.config)
  const defaultDirs = useIndexStore((state) => state.defaultDirs)
  const selectSource = useIndexStore((state) => state.selectSource)
  const rebuild = useIndexStore((state) => state.rebuild)
  const refreshSources = useIndexStore((state) => state.refreshSources)
  const loadStats = useIndexStore((state) => state.loadStats)
  const setMergeSnapshots = useIndexStore((state) => state.setMergeSnapshots)
  const initializing = useIndexStore((state) => state.initializing)
  const loadingSources = useIndexStore((state) => state.loadingSources)
  const statsLoading = useIndexStore((state) => state.statsLoading)
  const close = useUiStore((state) => state.toggleDataSource)

  const building = status?.phase === 'building'
  const busy = initializing || building
  const activeDir = status?.selectionKind === 'dir' ? status.selectionPath : null
  const activeFile = status?.selectionKind === 'file' ? status.selectionPath : null
  // 主进程可能因检测到消息减少而自动打开合并（此时配置会同步落盘，但本帧内先用 status 兜底）
  const mergeSnapshots = config?.mergeSnapshots === true || status?.autoMerged === true
  const foldedCount = status?.foldedFiles?.length ?? 0

  // 主进程给出的「被折叠的历史快照」清单，用于分组计数与逐条标注
  const foldedSet = useMemo(() => new Set(status?.foldedFiles ?? []), [status?.foldedFiles])

  const dirGroups = useMemo<DirGroup[]>(() => {
    const dirs = new Set<string>(defaultDirs)
    for (const dir of config?.dataDirs ?? []) dirs.add(dir)
    for (const source of sources) dirs.add(dirnameOf(source.path))

    const byDir = new Map<string, DbSource[]>()
    for (const source of sources) {
      if (!source.valid) continue
      const dir = dirnameOf(source.path)
      byDir.set(dir, [...(byDir.get(dir) ?? []), source])
    }

    return [...dirs]
      .map((dir) => {
        const files = byDir.get(dir) ?? []
        return {
          dir,
          files,
          folded: files.filter((file) => foldedSet.has(file.path)).length,
          newest: files.reduce((max, file) => Math.max(max, file.newestTimestamp), 0),
          total: files.reduce((sum, file) => sum + file.messageCount, 0)
        }
      })
      .sort(
        (a, b) =>
          b.newest - a.newest || b.files.length - a.files.length || a.dir.localeCompare(b.dir)
      )
  }, [sources, defaultDirs, config, foldedSet])

  const handleSelectDir = async (group: DirGroup): Promise<void> => {
    if (busy || group.files.length === 0) return
    if (activeDir?.toLowerCase() === group.dir.toLowerCase()) return
    await selectSource({ kind: 'dir', path: group.dir })
  }

  const handleSelectFile = async (source: DbSource): Promise<void> => {
    if (busy || !source.valid) return
    if (activeFile?.toLowerCase() === source.path.toLowerCase()) return
    await selectSource({ kind: 'file', path: source.path })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-6 backdrop-blur-sm">
      <button
        type="button"
        aria-label="关闭数据源面板"
        className="absolute inset-0 cursor-default"
        onClick={close}
      />

      <div className="glass-card relative flex max-h-[86vh] w-full max-w-[820px] animate-fade-up flex-col overflow-hidden">
        <header className="flex items-center gap-2 border-b border-line/10 px-4 py-3">
          <Database size={15} className="text-brand-cyan" />
          <span className="text-subheading">数据源与索引</span>
          <button type="button" className="btn ml-auto" onClick={close}>
            <X size={12} />
            关闭
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {/* 索引状态 */}
          <section className="mb-4">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-micro text-ink-600">索引状态</h3>
              <button
                type="button"
                className="btn ml-auto"
                onClick={() => void rebuild()}
                disabled={busy}
              >
                <RefreshCw size={11} className={cn(initializing && 'animate-spin')} />
                重建索引
              </button>
            </div>

            <div className="rounded-xl border border-line/10 bg-surface-900/50 p-3">
              <div className="flex items-center gap-2 text-micro">
                {building ? (
                  <Loader2 size={12} className="animate-spin text-brand-cyan" />
                ) : status?.phase === 'ready' ? (
                  <CheckCircle2 size={12} className="text-state-ok" />
                ) : (
                  <AlertTriangle size={12} className="text-state-warn" />
                )}
                <span className="text-ink-400">{status?.message ?? '尚未加载数据源'}</span>
                <span className="ml-auto text-ink-600">
                  缓存 {formatBytes(status?.cacheSizeBytes ?? 0)}
                </span>
              </div>

              {building && (
                <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-600/60">
                  <div
                    className="h-full rounded-full bg-brand-gradient transition-all duration-300"
                    style={{ width: `${Math.max(4, Math.round((status?.progress ?? 0) * 100))}%` }}
                  />
                </div>
              )}

              <dl className="mt-2.5 flex flex-col gap-1 text-micro">
                <div className="flex items-center justify-between gap-3">
                  <dt className="shrink-0 text-ink-600">当前范围</dt>
                  <dd className="min-w-0 truncate text-ink-400" title={status?.selectionPath ?? ''}>
                    {status?.selectionPath
                      ? `${status.selectionKind === 'dir' ? '目录（合并）' : '单个文件'} · ${status.selectionPath}`
                      : '—'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="shrink-0 text-ink-600">参与解析</dt>
                  <dd className="text-ink-400">{status?.includedFiles.length ?? 0} 个数据库</dd>
                </div>
                {foldedCount > 0 && (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="shrink-0 text-ink-600">已折叠快照</dt>
                    <dd className="text-ink-400" title={status?.foldedFiles.join('\n') ?? ''}>
                      {foldedCount} 个（内容已被全量库包含）
                    </dd>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3">
                  <dt className="shrink-0 text-ink-600">重复去重</dt>
                  <dd className="text-ink-400">
                    {status?.duplicateMessages ? `${formatCount(status.duplicateMessages)} 条` : '无'}
                  </dd>
                </div>
                {status?.buildMs != null && (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="shrink-0 text-ink-600">构建耗时</dt>
                    <dd className="text-ink-400">{(status.buildMs / 1000).toFixed(2)} 秒</dd>
                  </div>
                )}
              </dl>
            </div>
          </section>

          <ScanSourcesSection />

          {/* 数据源 */}
          <section className="mb-4">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-micro text-ink-600">数据源</h3>
              <button
                type="button"
                className="btn ml-auto"
                onClick={() => void loadStats(true)}
                disabled={statsLoading || loadingSources || busy}
                title="统计各源库的消息条数与最新数据时间（逐个文件计算，结果会被缓存）"
              >
                <Gauge size={11} className={cn(statsLoading && 'animate-pulse')} />
                {statsLoading ? '统计中…' : '统计全部来源'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void refreshSources(true)}
                disabled={loadingSources || busy}
              >
                <RefreshCw size={11} className={cn(loadingSources && 'animate-spin')} />
                重新扫描
              </button>
            </div>

            <div className="mb-2 flex items-start gap-2.5 rounded-xl border border-line/10 bg-surface-900/45 px-3 py-2">
              <button
                type="button"
                role="switch"
                aria-checked={mergeSnapshots}
                disabled={busy}
                onClick={() => void setMergeSnapshots(!mergeSnapshots)}
                title="关闭后只解析无时间戳的最新全量库，历史快照整体折叠跳过"
                className={cn(
                  'relative mt-0.5 h-4 w-8 shrink-0 rounded-full border transition-colors duration-200',
                  mergeSnapshots
                    ? 'border-brand-indigo/50 bg-brand-indigo/60'
                    : 'border-line/20 bg-surface-600/60',
                  busy && 'cursor-not-allowed opacity-55'
                )}
              >
                <span
                  className={cn(
                    'absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-white transition-all duration-200',
                    mergeSnapshots ? 'left-[17px]' : 'left-0.5'
                  )}
                />
              </button>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-micro text-ink-100">合并历史快照</span>
                <span className="text-micro leading-5 text-ink-600">
                  默认关闭：只解析无时间戳的最新全量库。带时间戳的
                  <code> message3763-2026-….db </code>
                  是上次退出时保存的整库副本，内容被全量库包含，默认整体折叠跳过。
                </span>
              </span>
              {status?.autoMerged && (
                <span className="ml-auto shrink-0 rounded-full bg-state-warn/20 px-1.5 text-micro text-state-warn">
                  已自动开启
                </span>
              )}
            </div>

            <p className="mb-2 flex items-start gap-1.5 rounded-lg border border-brand-indigo/25 bg-brand-indigo/8 px-3 py-2 text-micro leading-5 text-ink-400">
              <Layers size={12} className="mt-0.5 shrink-0 text-brand-indigo" />
              <span>
                选择「目录」即可查看该目录下的聊天记录；选择单个文件则只看该库。多条来源合并时按消息
                ID 去重，保留数据较新那份的版本。
              </span>
            </p>

            <h4 className="mb-1.5 mt-3 flex items-center gap-1.5 text-micro text-ink-600">
              <FolderTree size={11} /> 按目录查看
            </h4>
            <div className="flex flex-col gap-1.5">
              {dirGroups.map((group) => {
                const active = activeDir?.toLowerCase() === group.dir.toLowerCase()
                const disabled = group.files.length === 0 || busy
                return (
                  <button
                    key={group.dir}
                    type="button"
                    disabled={disabled}
                    onClick={() => void handleSelectDir(group)}
                    className={cn(
                      'flex flex-col gap-1 rounded-xl border px-3 py-2 text-left transition-all duration-200',
                      active
                        ? 'border-brand-indigo/50 bg-brand-indigo/15'
                        : 'border-line/10 bg-surface-900/45',
                      !disabled && !active && 'hover:border-brand-cyan/35',
                      disabled && 'cursor-not-allowed opacity-55'
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <FolderTree size={12} className="shrink-0 text-brand-cyan" />
                      <span className="truncate text-body text-ink-100">{group.dir}</span>
                      {active && (
                        <span className="shrink-0 rounded-full bg-brand-indigo/30 px-1.5 text-micro text-ink-100">
                          使用中
                        </span>
                      )}
                      <span className="ml-auto shrink-0 text-micro text-ink-600">
                        {group.files.length === 0
                          ? '无可用库'
                          : group.folded > 0
                            ? `${group.files.length} 个库 · 折叠 ${group.folded} 个快照`
                            : `${group.files.length} 个库`}
                      </span>
                    </span>
                    {group.files.length > 0 && (
                      <span className="text-micro text-ink-600">
                        {group.total > 0
                          ? `合计 ${formatCount(group.total)} 条消息 · 最新数据 ${formatDateTime(group.newest)}`
                          : `${group.files.length} 个库（总量点「统计全部来源」后可见）`}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            <h4 className="mb-1.5 mt-3 flex items-center gap-1.5 text-micro text-ink-600">
              <FileText size={11} /> 单个文件
            </h4>
            <div className="flex flex-col gap-1.5">
              {sources.length === 0 && (
                <p className="rounded-xl border border-line/10 bg-surface-900/50 p-3 text-micro leading-5 text-ink-600">
                  未发现可用的聊天记录库。请确认猿通讯已登录过（默认存放于 %APPDATA%\boctx），
                  或用上方「添加文件 / 添加目录」手动指定后重新扫描。
                </p>
              )}
              {sources.map((source) => {
                const active = activeFile?.toLowerCase() === source.path.toLowerCase()
                return (
                  <button
                    key={source.path}
                    type="button"
                    disabled={!source.valid || busy}
                    onClick={() => void handleSelectFile(source)}
                    className={cn(
                      'flex flex-col gap-1 rounded-xl border px-3 py-2 text-left transition-all duration-200',
                      active
                        ? 'border-brand-indigo/50 bg-brand-indigo/15'
                        : 'border-line/10 bg-surface-900/45',
                      source.valid && !busy && !active && 'hover:border-brand-cyan/35',
                      (!source.valid || busy) && 'cursor-not-allowed opacity-60'
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate text-body text-ink-100">{source.fileName}</span>
                      {active && (
                        <span className="shrink-0 rounded-full bg-brand-indigo/30 px-1.5 text-micro text-ink-100">
                          使用中
                        </span>
                      )}
                      {source.origin === 'configured' && (
                        <span className="shrink-0 rounded-full bg-brand-cyan/20 px-1.5 text-micro text-brand-cyan">
                          已添加
                        </span>
                      )}
                      {source.inBoctx && (
                        <span className="shrink-0 rounded-full bg-state-ok/18 px-1.5 text-micro text-state-ok">
                          猿通讯默认路径
                        </span>
                      )}
                      {foldedSet.has(source.path) && (
                        <span className="shrink-0 rounded-full bg-surface-600/70 px-1.5 text-micro text-ink-400">
                          已折叠
                        </span>
                      )}
                      {!source.valid && (
                        <span className="shrink-0 rounded-full bg-state-danger/25 px-1.5 text-micro text-state-danger">
                          不可用
                        </span>
                      )}
                      <span className="ml-auto shrink-0 text-micro text-ink-600">
                        {formatBytes(source.sizeBytes)}
                      </span>
                    </span>
                    <span className="text-micro text-ink-600">
                      {!source.valid
                        ? source.error
                        : source.messageCount > 0
                          ? `${formatCount(source.messageCount)} 条消息 · 最新 ${formatDateTime(source.newestTimestamp)}`
                          : '消息量未统计（可点右上角「统计全部来源」）'}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="rounded-xl border border-state-ok/25 bg-state-ok/5 p-3">
            <h3 className="mb-1.5 flex items-center gap-1.5 text-micro text-state-ok">
              <ShieldCheck size={12} /> 只读安全声明
            </h3>
            <p className="text-micro leading-5 text-ink-400">
              应用以只读方式打开原始聊天记录数据库，不会写入、修改或删除任何源文件。
              合并与去重结果仅写入用户数据目录下的索引缓存，用于加速检索；参与合并的
              任一文件大小或修改时间变化时会自动重建缓存。扫描来源与上次使用范围记录在
              用户数据目录的 <code>config.json</code> 中。
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
