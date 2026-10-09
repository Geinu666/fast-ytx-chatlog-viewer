import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Pin, Search, Users } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { chatKindLabel, formatCount, formatListTime } from '@renderer/lib/format'
import { useChatStore, type ChatScope } from '@renderer/store/useChatStore'
import { Avatar } from '@renderer/components/common/Avatar'

const SCOPES: Array<{ key: ChatScope; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'single', label: '单聊' },
  { key: 'group', label: '群聊' },
  { key: 'top', label: '置顶' }
]

/** 左栏会话列表（虚拟滚动） */
export function ChatList() {
  const chats = useChatStore((state) => state.chats)
  const chatKeyword = useChatStore((state) => state.chatKeyword)
  const setChatKeyword = useChatStore((state) => state.setChatKeyword)
  const chatScope = useChatStore((state) => state.chatScope)
  const setChatScope = useChatStore((state) => state.setChatScope)
  const activeChatId = useChatStore((state) => state.activeChatId)
  const selectChat = useChatStore((state) => state.selectChat)
  const loadingChats = useChatStore((state) => state.loadingChats)

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: chats.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 74,
    overscan: 10
  })

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-r border-line/10 bg-surface-800/45">
      <div className="flex flex-col gap-2.5 border-b border-line/10 px-3 py-3">
        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-600"
          />
          <input
            value={chatKeyword}
            onChange={(event) => setChatKeyword(event.target.value)}
            placeholder="搜索会话名称、摘要或消息内容"
            className="field pl-7"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-line/10 bg-surface-900/50 p-0.5">
          {SCOPES.map((scope) => (
            <button
              key={scope.key}
              type="button"
              onClick={() => setChatScope(scope.key)}
              className={cn(
                'flex-1 rounded-md py-1 text-micro transition-all duration-200',
                chatScope === scope.key
                  ? 'bg-brand-indigo/25 text-ink-100 shadow-glow'
                  : 'text-ink-600 hover:text-ink-400'
              )}
            >
              {scope.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {chats.length === 0 && !loadingChats && (
          <p className="px-2 py-8 text-center text-micro text-ink-600">
            没有匹配的会话，试试更换关键词或筛选范围
          </p>
        )}

        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const chat = chats[virtualRow.index]
            const active = chat.id === activeChatId
            return (
              <div
                key={virtualRow.key}
                className="absolute left-0 top-0 w-full pb-1"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <button
                  type="button"
                  onClick={() => void selectChat(chat.id)}
                  className={cn(
                    'group flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-all duration-200',
                    active
                      ? 'bg-brand-indigo/18 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.35)]'
                      : 'hover:bg-surface-700/45'
                  )}
                >
                  <Avatar name={chat.name} src={chat.avatar} size={38} />

                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-center gap-1.5">
                      {chat.isTop && <Pin size={11} className="shrink-0 text-state-warn" />}
                      <span
                        className={cn(
                          'truncate text-body font-medium',
                          active ? 'text-ink-100' : 'text-ink-400 group-hover:text-ink-100'
                        )}
                      >
                        {chat.name || chat.id}
                      </span>
                      <span className="ml-auto shrink-0 text-micro text-ink-600">
                        {formatListTime(chat.lastTimestamp)}
                      </span>
                    </span>

                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-micro text-ink-600">
                        {chat.lastPreview || '暂无消息'}
                      </span>
                    </span>

                    <span className="flex items-center gap-2 text-micro text-ink-600">
                      <span className="flex items-center gap-0.5">
                        {chat.kind === 'group' && <Users size={10} />}
                        {chatKindLabel(chat.kind)}
                      </span>
                      <span>·</span>
                      <span>{formatCount(chat.messageCount)} 条</span>
                    </span>
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </aside>
  )
}
