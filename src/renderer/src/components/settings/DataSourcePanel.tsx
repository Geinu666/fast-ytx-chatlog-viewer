import { AlertTriangle, CheckCircle2, Database, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { formatBytes, formatDateTime } from '@renderer/lib/format'
import { useIndexStore } from '@renderer/store/useIndexStore'
import { useUiStore } from '@renderer/store/useUiStore'
import { ScanSourcesSection } from './ScanSourcesSection'

/** 数据源与索引管理浮层 */
export function DataSourcePanel() {
  const sources = useIndexStore((state) => state.sources)
  const status = useIndexStore((state) => state.status)
  const selectSource = useIndexStore((state) => state.selectSource)
  const rebuild = useIndexStore((state) => state.rebuild)
  const refreshSources = useIndexStore((state) => state.refreshSources)
  const initializing = useIndexStore((state) => state.initializing)
  const loadingSources = useIndexStore((state) => state.loadingSources)
  const close = useUiStore((state) => state.toggleDataSource)

  const building = status?.phase === 'building'
  const busy = initializing || building

  const handleSelect = async (path: string): Promise<void> => {
    if (path === status?.sourcePath || busy) return
    await selectSource(path)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-6 backdrop-blur-sm">
      <button
        type="button"
        aria-label="关闭数据源面板"
        className="absolute inset-0 cursor-default"
        onClick={close}
      />

      <div className="glass-card relative flex max-h-[84vh] w-full max-w-[760px] animate-fade-up flex-col overflow-hidden">
        <header className="flex items-center gap-2 border-b border-line/10 px-4 py-3">
          <Database size={15} className="text-brand-cyan" />
          <span className="text-subheading">数据源与索引</span>
          <button type="button" className="btn ml-auto" onClick={close}>
            <X size={12} />
            关闭
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
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

              {status?.buildMs != null && (
                <p className="mt-2 text-micro text-ink-600">
                  上次构建耗时 {(status.buildMs / 1000).toFixed(2)} 秒
                </p>
              )}
            </div>
          </section>

          <ScanSourcesSection />

          <section className="mb-4">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-micro text-ink-600">发现的数据源</h3>
              <button
                type="button"
                className="btn ml-auto"
                onClick={() => void refreshSources()}
                disabled={loadingSources || busy}
              >
                <RefreshCw size={11} className={cn(loadingSources && 'animate-spin')} />
                重新扫描
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {sources.length === 0 && (
                <p className="rounded-xl border border-line/10 bg-surface-900/50 p-3 text-micro leading-5 text-ink-600">
                  未发现可用的聊天记录库。请确认猿通讯已登录过（默认存放于
                  %APPDATA%\boctx），或用上方「添加文件 / 添加目录」手动指定后重新扫描。
                </p>
              )}

              {sources.map((source) => {
                const active = source.path === status?.sourcePath
                return (
                  <button
                    key={source.path}
                    type="button"
                    disabled={!source.valid || busy}
                    onClick={() => void handleSelect(source.path)}
                    className={cn(
                      'flex flex-col gap-1.5 rounded-xl border px-3 py-2.5 text-left transition-all duration-200',
                      active
                        ? 'border-brand-indigo/50 bg-brand-indigo/15'
                        : 'border-line/10 bg-surface-900/45 hover:border-brand-cyan/35',
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
                      {!source.valid && (
                        <span className="shrink-0 rounded-full bg-state-danger/25 px-1.5 text-micro text-state-danger">
                          不可用
                        </span>
                      )}
                      <span className="ml-auto shrink-0 text-micro text-ink-600">
                        {formatBytes(source.sizeBytes)}
                      </span>
                    </span>
                    <span className="truncate text-micro text-ink-600" title={source.path}>
                      {source.path}
                    </span>
                    <span className="text-micro text-ink-600">
                      修改时间 {formatDateTime(source.modifiedAt)}
                      {source.error ? ` · ${source.error}` : ''}
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
              解码与规范化后的数据仅写入用户数据目录下的索引缓存，用于加速检索；
              源库文件大小或修改时间变化时会自动重建缓存。
              扫描来源与上次使用的数据源记录在用户数据目录的 <code>config.json</code> 中。
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
