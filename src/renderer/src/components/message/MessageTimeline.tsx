import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ArrowDown,
  ChevronDown,
  ChevronUp,
  Loader2,
  Search,
  Users,
  X
} from 'lucide-react'
import type { MessageItem } from '@shared/types'
import { chatKindLabel, formatCount, formatDateLabel, formatDateTime } from '@renderer/lib/format'
import { cn } from '@renderer/lib/cn'
import { useChatStore } from '@renderer/store/useChatStore'
import { MessageBubble } from './MessageBubble'

type Row =
  | { key: string; type: 'date'; date: string }
  | { key: string; type: 'msg'; item: MessageItem }

function buildRows(messages: MessageItem[]): Row[] {
  const rows: Row[] = []
  let lastDate = ''
  for (const item of messages) {
    if (item.strDate !== lastDate) {
      lastDate = item.strDate
      rows.push({ key: `date-${item.strDate}-${item.rowId}`, type: 'date', date: item.strDate })
    }
    rows.push({ key: `msg-${item.rowId}`, type: 'msg', item })
  }
  return rows
}

/** 中栏消息时间线：虚拟滚动 + 日期分隔 + 会话内搜索定位 */
export function MessageTimeline() {
  const activeChatId = useChatStore((state) => state.activeChatId)
  const messages = useChatStore((state) => state.messages)
  const chatMeta = useChatStore((state) => state.chatMeta)
  const highlightId = useChatStore((state) => state.highlightId)
  const inChatKeyword = useChatStore((state) => state.inChatKeyword)
  const matchIds = useChatStore((state) => state.matchIds)
  const matchIndex = useChatStore((state) => state.matchIndex)
  const runInChatSearch = useChatStore((state) => state.runInChatSearch)
  const stepMatch = useChatStore((state) => state.stepMatch)
  const loadOlder = useChatStore((state) => state.loadOlder)
  const hasMoreOlder = useChatStore((state) => state.hasMoreOlder)
  const loadingMessages = useChatStore((state) => state.loadingMessages)
  const consumeAnchor = useChatStore((state) => state.consumeAnchor)
  const reloadMessages = useChatStore((state) => state.reloadMessages)

  const [searchOpen, setSearchOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [atBottom, setAtBottom] = useState(true)

  const scrollRef = useRef<HTMLDivElement>(null)
  const anchorHeightRef = useRef(0)
  const needBottomRef = useRef(false)

  const rows = useMemo(() => buildRows(messages), [messages])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index].type === 'date' ? 46 : 88),
    overscan: 12,
    getItemKey: (index) => rows[index].key
  })

  const handleScroll = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    setAtBottom(distance < 90)
    if (element.scrollTop < 260 && hasMoreOlder && !loadingMessages) {
      anchorHeightRef.current = element.scrollHeight
      void loadOlder()
    }
  }, [hasMoreOlder, loadingMessages, loadOlder])

  // 切换会话后，等首批消息到达再滚动到底部
  useEffect(() => {
    needBottomRef.current = true
  }, [activeChatId])

  useEffect(() => {
    if (!needBottomRef.current || messages.length === 0) return
    needBottomRef.current = false
    const raf = requestAnimationFrame(() => {
      const element = scrollRef.current
      if (element) element.scrollTop = element.scrollHeight
      setAtBottom(true)
    })
    return () => cancelAnimationFrame(raf)
  }, [messages])

  // 向上加载历史时恢复滚动位置，避免视图跳动
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    if (consumeAnchor()) {
      const delta = element.scrollHeight - anchorHeightRef.current
      if (delta > 0) element.scrollTop += delta
    }
  }, [messages.length, consumeAnchor])

  // 搜索命中定位
  useEffect(() => {
    if (!highlightId) return
    const index = rows.findIndex((row) => row.type === 'msg' && row.item.id === highlightId)
    if (index < 0) return
    const raf = requestAnimationFrame(() => virtualizer.scrollToIndex(index, { align: 'center' }))
    return () => cancelAnimationFrame(raf)
  }, [highlightId, rows, virtualizer])

  const showName = chatMeta?.kind === 'group'
  const setHighlight = useChatStore((state) => state.setHighlight)

  const highlightTime = useMemo(() => {
    if (!highlightId) return 0
    const found = rows.find((row) => row.type === 'msg' && row.item.id === highlightId)
    return found && found.type === 'msg' ? found.item.timestamp : 0
  }, [highlightId, rows])

  const clearHighlight = useCallback(() => setHighlight(null), [setHighlight])

  const submitSearch = (): void => {
    void runInChatSearch(draft)
  }

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-surface-900/40">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line/10 px-4">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-subheading text-ink-100">
            {chatMeta?.name ?? '请选择会话'}
          </span>
          <span className="flex items-center gap-2 text-micro text-ink-600">
            {chatMeta && (
              <>
                <span>{chatKindLabel(chatMeta.kind)}</span>
                <span>·</span>
                <span className="flex items-center gap-0.5">
                  <Users size={10} />
                  {formatCount(chatMeta.memberCount)} 人
                </span>
                <span>·</span>
                <span>{formatCount(chatMeta.messageCount)} 条消息</span>
                {chatMeta.firstDate && (
                  <>
                    <span>·</span>
                    <span>
                      {chatMeta.firstDate} ~ {chatMeta.lastDate}
                    </span>
                  </>
                )}
              </>
            )}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className={cn('btn', searchOpen && 'chip-active')}
            onClick={() => setSearchOpen((prev) => !prev)}
          >
            <Search size={12} />
            会话内搜索
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void reloadMessages()}
            title="重新加载最新消息"
          >
            最新
          </button>
        </div>
      </header>

      {searchOpen && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line/10 bg-surface-800/45 px-4 py-2">
          <div className="relative flex-1">
            <Search
              size={12}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-600"
            />
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitSearch()
              }}
              placeholder="在当前会话中查找，回车确认"
              className="field pl-7"
            />
          </div>
          <button type="button" className="btn btn-primary" onClick={submitSearch}>
            查找
          </button>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn"
              onClick={() => void stepMatch(-1)}
              disabled={matchIds.length === 0}
              title="上一个命中"
            >
              <ChevronUp size={12} />
            </button>
            <span className="w-16 text-center text-micro text-ink-600">
              {matchIds.length ? `${matchIndex + 1} / ${matchIds.length}` : '无命中'}
            </span>
            <button
              type="button"
              className="btn"
              onClick={() => void stepMatch(1)}
              disabled={matchIds.length === 0}
              title="下一个命中"
            >
              <ChevronDown size={12} />
            </button>
          </div>
          {inChatKeyword && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setDraft('')
                void runInChatSearch('')
              }}
            >
              <X size={12} />
              清除
            </button>
          )}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={handleScroll} className="h-full overflow-y-auto">
          {hasMoreOlder && (
            <div className="flex items-center justify-center gap-2 py-3 text-micro text-ink-600">
              {loadingMessages ? <Loader2 size={12} className="animate-spin" /> : null}
              向上滚动加载更早的消息
            </div>
          )}

          {!activeChatId && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-600">
              <span className="text-subheading">请从左侧选择一个会话</span>
              <span className="text-micro">支持按名称搜索、按单聊 / 群聊 / 置顶筛选</span>
            </div>
          )}

          {activeChatId && messages.length === 0 && !loadingMessages && (
            <div className="flex h-full items-center justify-center text-micro text-ink-600">
              当前筛选条件下没有消息
            </div>
          )}

          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index]
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {row.type === 'date' ? (
                    <div className="flex items-center justify-center py-3">
                      <span className="rounded-full border border-line/10 bg-surface-800/70 px-3 py-0.5 text-micro text-ink-600">
                        {formatDateLabel(row.date)}
                      </span>
                    </div>
                  ) : (
                    <MessageBubble
                      item={row.item}
                      keyword={inChatKeyword}
                      highlight={row.item.id === highlightId}
                      showName={showName}
                    />
                  )}
                </div>
              )
            })}
          </div>

          <div className="h-4" />
        </div>

        {!atBottom && (
          <button
            type="button"
            onClick={() => {
              const element = scrollRef.current
              if (element) element.scrollTop = element.scrollHeight
            }}
            className="absolute bottom-4 right-5 flex items-center gap-1.5 rounded-full border border-brand-indigo/40 bg-surface-800/90 px-3 py-1.5 text-micro text-ink-100 shadow-glow backdrop-blur transition-all duration-200 hover:bg-surface-700/90"
          >
            <ArrowDown size={12} />
            回到最新
          </button>
        )}
      </div>

      {highlightId && (
        <div className="flex shrink-0 items-center gap-2 border-t border-line/10 bg-brand-cyan/5 px-4 py-1.5 text-micro text-ink-400">
          已定位到搜索命中消息
          {highlightTime > 0 && <span className="text-ink-600">{formatDateTime(highlightTime)}</span>}
          <button type="button" className="btn ml-auto" onClick={clearHighlight}>
            <X size={11} />
            取消定位
          </button>
        </div>
      )}
    </section>
  )
}
