import { useEffect } from 'react'
import { AlertTriangle, FilePlus2, FolderOpen, Loader2 } from 'lucide-react'
import { formatCount } from './lib/format'
import { ChatList } from './components/chat/ChatList'
import { Toast } from './components/common/Toast'
import { FilterPanel } from './components/filter/FilterPanel'
import { StatusBar } from './components/layout/StatusBar'
import { TitleBar } from './components/layout/TitleBar'
import { MessageTimeline } from './components/message/MessageTimeline'
import { GlobalSearch } from './components/search/GlobalSearch'
import { ForwardDialog } from './components/message/ForwardDialog'
import { Lightbox } from './components/common/Lightbox'
import { DataSourcePanel } from './components/settings/DataSourcePanel'
import { useDebouncedValue } from './hooks/useDebounce'
import { cn } from './lib/cn'
import { useChatStore } from './store/useChatStore'
import { useIndexStore } from './store/useIndexStore'
import { useSearchStore } from './store/useSearchStore'
import { useUiStore } from './store/useUiStore'

export default function App() {
  const init = useIndexStore((state) => state.init)
  const addDataDir = useIndexStore((state) => state.addDataDir)
  const addDataFile = useIndexStore((state) => state.addDataFile)
  const status = useIndexStore((state) => state.status)
  // 索引每次真正构建后 revision 自增，据此重新拉取会话列表（新消息 / 预览）
  const revision = useIndexStore((state) => state.status?.revision ?? 0)
  const loadChats = useChatStore((state) => state.loadChats)
  const chatKeyword = useChatStore((state) => state.chatKeyword)
  const chatScope = useChatStore((state) => state.chatScope)
  const showFilters = useUiStore((state) => state.showFilters)
  const showDataSource = useUiStore((state) => state.showDataSource)
  const searchOpen = useSearchStore((state) => state.open)

  const debouncedKeyword = useDebouncedValue(chatKeyword, 260)
  const ready = status?.phase === 'ready'
  const building = status?.phase === 'building'
  const failed = status?.phase === 'error'
  const percent = Math.max(4, Math.round((status?.progress ?? 0) * 100))

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    if (!ready) return
    void loadChats()
  }, [ready, debouncedKeyword, chatScope, loadChats, revision])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        useSearchStore.getState().openPanel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <TitleBar />

      {building && (
        <div
          className="absolute left-0 top-12 z-40 h-[2px] bg-brand-gradient transition-all duration-300"
          style={{ width: `${Math.max(3, Math.round((status?.progress ?? 0) * 100))}%` }}
        />
      )}

      <main className="flex min-h-0 flex-1">
        <ChatList />
        <MessageTimeline />
        <div className={cn(showFilters ? 'flex' : 'hidden')}>
          <FilterPanel />
        </div>
      </main>

      {/* 启动阶段：明确告知正在准备数据，避免出现「白屏 / 无响应」的错觉 */}
      {!ready && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-surface-900/80 backdrop-blur-sm">
          <div className="glass-card w-[420px] animate-fade-up p-6 text-center">
            {failed ? (
              <AlertTriangle size={22} className="mx-auto mb-3 text-state-warn" />
            ) : (
              <Loader2 size={22} className="mx-auto mb-3 animate-spin text-brand-cyan" />
            )}

            <p className="text-subheading text-ink-100">
              {failed ? '未找到可用的聊天记录' : '正在准备聊天记录索引'}
            </p>
            <p className="mt-1.5 break-all text-micro text-ink-400">
              {status?.message ?? '正在扫描数据源…'}
            </p>

            {!failed && (
              <>
                <div className="mt-3.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-600/60">
                  <div
                    className="h-full rounded-full bg-brand-gradient transition-all duration-300"
                    style={{ width: `${percent}%` }}
                  />
                </div>
                {status && status.total > 0 && (
                  <p className="mt-2 text-micro text-ink-600">
                    {formatCount(status.processed)} / {formatCount(status.total)}
                  </p>
                )}
                <p className="mt-3.5 text-micro leading-5 text-ink-600">
                  首次使用需完整解析一次；之后仅在源库文件发生变化时增量更新。
                </p>
              </>
            )}

            {failed && (
              <>
                {/* 路径失效或目录内没有可用库时，必须给出可操作的出口，否则界面等同锁死 */}
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void addDataDir()}
                  >
                    <FolderOpen size={13} />
                    选择目录
                  </button>
                  <button type="button" className="btn" onClick={() => void addDataFile()}>
                    <FilePlus2 size={13} />
                    选择文件
                  </button>
                </div>

                <button
                  type="button"
                  className="btn mt-2 w-full"
                  onClick={() => window.api.window.quit()}
                >
                  退出程序
                </button>

                <p className="mt-3.5 text-micro leading-5 text-ink-600">
                  猿通讯聊天记录默认存放于 %APPDATA%\boctx，也可在右上角「数据源」中调整。
                </p>
              </>
            )}
          </div>
        </div>
      )}

      <StatusBar />

      <Toast />

      {/* 批量转发浏览弹窗（未打开时不渲染） */}
      <ForwardDialog />

      {/* 图片查看弹窗（未打开时不渲染） */}
      <Lightbox />

      {searchOpen && <GlobalSearch />}
      {showDataSource && <DataSourcePanel />}
    </div>
  )
}
