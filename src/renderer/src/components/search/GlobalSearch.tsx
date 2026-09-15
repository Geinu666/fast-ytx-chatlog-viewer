import { useEffect, useRef } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import type { MessageItem } from '@shared/types'
import { chatKindLabel, formatCount, formatMessageTime } from '@renderer/lib/format'
import { Highlight } from '@renderer/lib/highlight'
import { useDebouncedValue } from '@renderer/hooks/useDebounce'
import { useChatStore } from '@renderer/store/useChatStore'
import { useSearchStore } from '@renderer/store/useSearchStore'

/** 全局搜索结果浮层：跨全部会话检索并支持跳转定位 */
export function GlobalSearch() {
  const closePanel = useSearchStore((state) => state.closePanel)
  const keyword = useSearchStore((state) => state.keyword)
  const setKeyword = useSearchStore((state) => state.setKeyword)
  const run = useSearchStore((state) => state.run)
  const loadMore = useSearchStore((state) => state.loadMore)
  const result = useSearchStore((state) => state.result)
  const loading = useSearchStore((state) => state.loading)
  const jumpToMessage = useChatStore((state) => state.jumpToMessage)

  const debounced = useDebouncedValue(keyword, 320)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    void run(debounced)
  }, [debounced, run])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closePanel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closePanel])

  const openResult = (item: MessageItem): void => {
    void jumpToMessage(item.chatId, item.id)
    closePanel()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 px-6 pt-[72px] backdrop-blur-sm">
      <button
        type="button"
        aria-label="关闭搜索"
        className="absolute inset-0 cursor-default"
        onClick={closePanel}
      />

      <div className="glass-card relative flex max-h-[78vh] w-full max-w-[860px] animate-fade-up flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line/10 px-4 py-3">
          <Search size={15} className="shrink-0 text-brand-cyan" />
          <input
            ref={inputRef}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="跨全部会话搜索聊天内容，支持中文任意子串"
            className="flex-1 border-none bg-transparent text-subheading text-ink-100 outline-none placeholder:text-ink-600"
          />
          {loading && <Loader2 size={14} className="animate-spin text-ink-400" />}
          <button type="button" className="btn" onClick={closePanel}>
            <X size={12} />
            Esc
          </button>
        </div>

        {result && (
          <div className="flex items-center gap-4 border-b border-line/10 px-4 py-2 text-micro text-ink-600">
            <span>
              命中 <b className="text-brand-cyan">{formatCount(result.total)}</b> 条
            </span>
            <span>
              涉及 <b className="text-ink-400">{result.groups.length}</b> 个会话
            </span>
            <span>
              耗时 <b className="text-ink-400">{result.tookMs} ms</b>
            </span>
            {result.hasMore && <span className="text-state-warn">结果已截断，可继续加载</span>}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {!result && !loading && (
            <p className="py-10 text-center text-micro text-ink-600">
              输入关键字开始检索，例如「上线」「接口」「部署」
            </p>
          )}

          {result && result.total === 0 && !loading && (
            <p className="py-10 text-center text-micro text-ink-600">
              没有找到包含「{keyword}」的消息
            </p>
          )}

          {result?.groups.map((group) => (
            <section key={group.chatId} className="mb-4">
              <header className="mb-1.5 flex items-center gap-2 px-2">
                <span className="truncate text-subheading text-ink-100">{group.chatName}</span>
                <span className="rounded-full border border-line/15 px-1.5 text-micro text-ink-600">
                  {chatKindLabel(group.chatKind)}
                </span>
                <span className="ml-auto shrink-0 text-micro text-ink-600">
                  {group.count} 条命中
                </span>
              </header>

              <div className="flex flex-col gap-1">
                {group.items.map((item) => (
                  <button
                    key={`${item.chatId}-${item.id}`}
                    type="button"
                    onClick={() => openResult(item)}
                    className="flex flex-col gap-1 rounded-xl border border-line/10 bg-surface-900/45 px-3 py-2 text-left transition-all duration-200 hover:border-brand-indigo/40 hover:bg-surface-700/50"
                  >
                    <span className="flex items-center gap-2 text-micro text-ink-600">
                      <span className="text-ink-400">{item.name || item.fromId}</span>
                      <span>{formatMessageTime(item.timestamp)}</span>
                    </span>
                    <span className="line-clamp-2 whitespace-pre-wrap break-words text-body text-ink-100">
                      <Highlight text={item.text || '[空消息]'} keyword={keyword} />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}

          {result?.hasMore && (
            <div className="flex justify-center py-2">
              <button
                type="button"
                className="btn"
                onClick={() => void loadMore()}
                disabled={loading}
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : null}
                加载更多结果
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
