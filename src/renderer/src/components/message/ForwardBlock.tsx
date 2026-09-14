import { useMemo } from 'react'
import { ChevronRight, Forward } from 'lucide-react'
import type { ForwardNode, ForwardPayload } from '@shared/content'
import { Highlight } from '@renderer/lib/highlight'
import { useForwardStore } from '@renderer/store/useForwardStore'

interface ForwardBlockProps {
  payload: ForwardPayload
  keyword?: string
}

/** 子消息的日期区间（YYYY-MM-DD ~ YYYY-MM-DD） */
function dateRangeOf(items: ForwardNode[]): string {
  const dates = items
    .map((node) => node.strDate)
    .filter((value): value is string => Boolean(value))
    .sort()
  if (dates.length === 0) return ''
  const first = dates[0]
  const last = dates[dates.length - 1]
  return first === last ? first : `${first} ~ ${last}`
}

/** 批量转发卡片：点击在弹窗中浏览转发内容 */
export function ForwardBlock({ payload, keyword }: ForwardBlockProps) {
  const pushForward = useForwardStore((state) => state.pushForward)
  const range = useMemo(() => dateRangeOf(payload.items), [payload.items])

  return (
    <button
      type="button"
      onClick={() => pushForward(payload)}
      title="点击查看转发的聊天记录"
      className="flex w-[280px] cursor-pointer flex-col gap-2 rounded-xl border border-line/10 bg-surface-900/50 p-3 text-left transition-all duration-200 hover:border-brand-cyan/35 hover:bg-surface-900/75"
    >
      <span className="flex items-start gap-2">
        <Forward size={16} className="mt-0.5 shrink-0 text-brand-violet" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body text-ink-100">
            <Highlight text={payload.title} keyword={keyword} />
          </span>
          <span className="mt-0.5 block text-micro text-ink-600">
            共 {payload.count} 条{range ? ` · ${range}` : ''}
          </span>
        </span>
        <ChevronRight size={13} className="mt-0.5 shrink-0 text-ink-600" />
      </span>
    </button>
  )
}
