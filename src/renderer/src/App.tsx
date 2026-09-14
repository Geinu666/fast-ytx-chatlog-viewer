import { useEffect } from 'react'
import { ChatList } from './components/chat/ChatList'
import { Toast } from './components/common/Toast'
import { FilterPanel } from './components/filter/FilterPanel'
import { StatusBar } from './components/layout/StatusBar'
import { TitleBar } from './components/layout/TitleBar'
import { MessageTimeline } from './components/message/MessageTimeline'
import { GlobalSearch } from './components/search/GlobalSearch'
import { DataSourcePanel } from './components/settings/DataSourcePanel'
import { useDebouncedValue } from './hooks/useDebounce'
import { cn } from './lib/cn'
import { useChatStore } from './store/useChatStore'
import { useIndexStore } from './store/useIndexStore'
import { useSearchStore } from './store/useSearchStore'
import { useUiStore } from './store/useUiStore'

export default function App() {
  const init = useIndexStore((state) => state.init)
  const status = useIndexStore((state) => state.status)
  const loadChats = useChatStore((state) => state.loadChats)
  const chatKeyword = useChatStore((state) => state.chatKeyword)
  const chatScope = useChatStore((state) => state.chatScope)
  const showFilters = useUiStore((state) => state.showFilters)
  const showDataSource = useUiStore((state) => state.showDataSource)
  const searchOpen = useSearchStore((state) => state.open)

  const debouncedKeyword = useDebouncedValue(chatKeyword, 260)
  const ready = status?.phase === 'ready'
  const building = status?.phase === 'building'

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    if (!ready) return
    void loadChats()
  }, [ready, debouncedKeyword, chatScope, loadChats])

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

      <StatusBar />

      <Toast />

      {searchOpen && <GlobalSearch />}
      {showDataSource && <DataSourcePanel />}
    </div>
  )
}
