import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { formatBytes, formatCount } from '@renderer/lib/format'
import { useChatStore } from '@renderer/store/useChatStore'
import { useIndexStore } from '@renderer/store/useIndexStore'

/** 底部状态栏：数据规模、索引状态与查询耗时 */
export function StatusBar() {
  const status = useIndexStore((state) => state.status)
  const chats = useChatStore((state) => state.chats)
  const chatMeta = useChatStore((state) => state.chatMeta)
  const lastQueryMs = useChatStore((state) => state.lastQueryMs)
  const loadingMessages = useChatStore((state) => state.loadingMessages)

  const phase = status?.phase ?? 'idle'

  return (
    <footer className="z-30 flex h-8 shrink-0 items-center gap-4 border-t border-line/10 bg-surface-900/85 px-3 text-micro text-ink-600 backdrop-blur-xl">
      <span>
        会话 <b className="text-ink-400">{formatCount(chats.length)}</b>
      </span>
      <span>
        当前会话消息 <b className="text-ink-400">{formatCount(chatMeta?.messageCount ?? 0)}</b>
      </span>
      <span className="hidden xl:inline">
        索引缓存 <b className="text-ink-400">{formatBytes(status?.cacheSizeBytes ?? 0)}</b>
      </span>
      <span className="hidden lg:inline">
        查询耗时 <b className="text-ink-400">{lastQueryMs ? `${lastQueryMs} ms` : '—'}</b>
      </span>

      <span className="ml-auto flex items-center gap-1.5">
        {phase === 'building' && (
          <>
            <Loader2 size={12} className="animate-spin text-brand-cyan" />
            <span className="text-brand-cyan">{status?.message ?? '正在构建索引'}</span>
          </>
        )}
        {phase === 'ready' && !loadingMessages && (
          <>
            <CheckCircle2 size={12} className="text-state-ok" />
            <span>{status?.message ?? '就绪'}</span>
          </>
        )}
        {phase === 'ready' && loadingMessages && (
          <>
            <Loader2 size={12} className="animate-spin text-ink-400" />
            <span>正在查询…</span>
          </>
        )}
        {(phase === 'error' || phase === 'idle') && (
          <>
            <AlertTriangle size={12} className="text-state-warn" />
            <span>{status?.error ?? '等待数据源'}</span>
          </>
        )}
      </span>
    </footer>
  )
}
