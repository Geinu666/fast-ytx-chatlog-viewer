import { useEffect, useState } from 'react'
import { Database, Layers, Minus, Moon, Search, Square, Sun, X } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useIndexStore } from '@renderer/store/useIndexStore'
import { useSearchStore } from '@renderer/store/useSearchStore'
import { useUiStore } from '@renderer/store/useUiStore'

/** 自定义无边框标题栏 */
export function TitleBar() {
  const status = useIndexStore((state) => state.status)
  const openSearch = useSearchStore((state) => state.openPanel)
  const theme = useUiStore((state) => state.theme)
  const toggleTheme = useUiStore((state) => state.toggleTheme)
  const toggleDataSource = useUiStore((state) => state.toggleDataSource)
  const toggleFilters = useUiStore((state) => state.toggleFilters)
  const showFilters = useUiStore((state) => state.showFilters)

  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.api.window.isMaximized().then(setMaximized)
    return window.api.window.onMaximizeChange(setMaximized)
  }, [])

  return (
    <header className="app-drag relative z-30 flex h-12 shrink-0 items-center gap-3 border-b border-line/10 bg-surface-900/80 px-3 backdrop-blur-xl">
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-gradient shadow-glow">
          <Layers size={15} className="text-white" />
        </span>
        <span className="text-subheading whitespace-nowrap">聊天记录查看器</span>
      </div>

      <span className="flex min-w-0 items-center gap-1.5 rounded-full border border-line/10 bg-surface-800/70 px-2.5 py-1 text-micro text-ink-400">
        <Database size={12} className="shrink-0 text-brand-cyan" />
        <span className="truncate">{status?.sourceName ?? '未加载数据源'}</span>
      </span>

      <div className="app-no-drag ml-auto flex items-center gap-1.5">
        <button type="button" className="btn" onClick={openSearch} title="全局搜索">
          <Search size={13} />
          搜索
        </button>
        <button
          type="button"
          className={cn('btn', showFilters && 'chip-active')}
          onClick={toggleFilters}
          title="显示/隐藏筛选面板"
        >
          <Layers size={13} />
          筛选
        </button>
        <button type="button" className="btn" onClick={toggleDataSource} title="数据源与索引">
          <Database size={13} />
          数据源
        </button>
        <button type="button" className="btn" onClick={toggleTheme} title="切换主题">
          {theme === 'dark' ? <Moon size={13} /> : <Sun size={13} />}
        </button>
      </div>

      <div className="app-no-drag ml-1 flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => window.api.window.minimize()}
          className="flex h-8 w-9 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-surface-700/70 hover:text-ink-100"
          title="最小化"
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          onClick={() => window.api.window.toggleMaximize()}
          className="flex h-8 w-9 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-surface-700/70 hover:text-ink-100"
          title={maximized ? '还原' : '最大化'}
        >
          <Square size={12} />
        </button>
        <button
          type="button"
          onClick={() => window.api.window.close()}
          className="flex h-8 w-9 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-state-danger/80 hover:text-white"
          title="关闭"
        >
          <X size={14} />
        </button>
      </div>
    </header>
  )
}
