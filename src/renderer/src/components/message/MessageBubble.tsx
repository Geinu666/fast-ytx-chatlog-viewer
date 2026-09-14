import { formatClock } from '@renderer/lib/format'
import { cn } from '@renderer/lib/cn'
import type { MessageItem } from '@shared/types'
import { Avatar } from '@renderer/components/common/Avatar'
import { MessageContent } from './MessageContent'

interface MessageBubbleProps {
  item: MessageItem
  keyword?: string
  highlight: boolean
  showName: boolean
}

/** 单条消息气泡 */
export function MessageBubble({ item, keyword, highlight, showName }: MessageBubbleProps) {
  if (item.kind === 'system' || item.kind === 'withdrawn') {
    return (
      <div className="flex justify-center px-4 py-1">
        <span className="max-w-[70%] rounded-full border border-line/10 bg-surface-800/60 px-3 py-1 text-center">
          <MessageContent item={item} keyword={keyword} />
        </span>
      </div>
    )
  }

  const mine = item.isMine

  return (
    <div
      data-message-id={item.id}
      className={cn(
        'flex w-full gap-2.5 px-4 py-1.5 transition-colors duration-200',
        mine ? 'flex-row-reverse' : 'flex-row',
        highlight
          ? 'bg-brand-cyan/10 shadow-[inset_3px_0_0_0_rgba(34,211,238,0.85)]'
          : 'hover:bg-surface-700/25'
      )}
    >
      <Avatar name={item.name || item.fromId} src={item.avatar} size={34} className="mt-0.5" />

      <div
        className={cn(
          'flex min-w-0 max-w-[min(700px,74%)] flex-col gap-1',
          mine ? 'items-end' : 'items-start'
        )}
      >
        {!mine && showName && (
          <span className="pl-1 text-micro text-ink-600">{item.name || item.fromId}</span>
        )}

        <div
          className={cn(
            'rounded-2xl border px-3.5 py-2 shadow-card backdrop-blur-sm transition-all duration-200',
            mine
              ? 'border-brand-indigo/25 bg-brand-indigo/12'
              : 'border-line/10 bg-surface-800/75'
          )}
        >
          <MessageContent item={item} keyword={keyword} />
        </div>

        <span className="px-1 text-micro text-ink-600">{formatClock(item.timestamp)}</span>
      </div>
    </div>
  )
}
