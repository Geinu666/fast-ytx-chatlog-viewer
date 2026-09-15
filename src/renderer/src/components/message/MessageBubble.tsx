import { useCallback, useState, type MouseEvent } from 'react'
import { parseMessageContent } from '@shared/content'
import type { MessageItem, SaveImageInput } from '@shared/types'
import { cn } from '@renderer/lib/cn'
import { formatDateTime, formatMessageTime } from '@renderer/lib/format'
import { suggestImageName } from '@renderer/lib/localMedia'
import { Avatar } from '@renderer/components/common/Avatar'
import { ContextMenu, type ContextMenuItem } from '@renderer/components/common/ContextMenu'
import { useUiStore } from '@renderer/store/useUiStore'
import { MessageContent } from './MessageContent'

interface MessageBubbleProps {
  item: MessageItem
  keyword?: string
  highlight: boolean
  showName: boolean
}

interface MenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

/** 单条消息气泡，支持右键复制 */
export function MessageBubble({ item, keyword, highlight, showName }: MessageBubbleProps) {
  const showToast = useUiStore((state) => state.showToast)
  const [menu, setMenu] = useState<MenuState | null>(null)

  const closeMenu = useCallback(() => setMenu(null), [])

  const copy = useCallback(
    async (value: string, label: string): Promise<void> => {
      if (!value) {
        showToast('没有可复制的内容')
        return
      }
      const ok = await window.api.copyText(value)
      showToast(ok ? `已复制${label}` : '复制失败')
    },
    [showToast]
  )

  const saveImage = useCallback(
    async (input: SaveImageInput): Promise<void> => {
      const result = await window.api.saveImageAs(input)
      if (result.canceled) return
      showToast(result.ok ? '图片已保存' : result.error || '保存失败')
    },
    [showToast]
  )

  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>): void => {
      event.preventDefault()

      const parsed = parseMessageContent(item.raw, item.messageType, item.isWithdrawn)
      const text = (item.text || parsed.text || '').trim()
      const displayName = item.name || item.fromId || '未知'
      const selection = window.getSelection()?.toString().trim() ?? ''

      const items: ContextMenuItem[] = []

      if (selection) {
        items.push({
          id: 'selection',
          label: '复制选中内容',
          onSelect: () => void copy(selection, '选中内容')
        })
      }

      items.push({
        id: 'content',
        label: '复制消息内容',
        dividerBefore: Boolean(selection),
        onSelect: () => void copy(text, '消息内容')
      })
      items.push({
        id: 'withSender',
        label: '复制「发送人：内容」',
        onSelect: () => void copy(`${displayName}：${text}`, '发送人与内容')
      })
      items.push({
        id: 'sender',
        label: '复制发送人',
        onSelect: () => void copy(displayName, '发送人')
      })
      items.push({
        id: 'time',
        label: '复制时间',
        onSelect: () => void copy(formatDateTime(item.timestamp), '时间')
      })

      let divided = false
      // 优先使用数据库中记录的本地缓存路径（content 的 path 属性或 filePath 列）
      const localFilePath = item.localPath || parsed.filePath
      if (localFilePath) {
        items.push({
          id: 'filePath',
          label: '复制文件路径',
          dividerBefore: true,
          onSelect: () => void copy(localFilePath, '文件路径')
        })
        divided = true
      }
      if (parsed.fileUrl) {
        items.push({
          id: 'fileUrl',
          label: '复制下载链接',
          dividerBefore: !divided,
          onSelect: () => void copy(parsed.fileUrl ?? '', '下载链接')
        })
        divided = true
      }
      if (parsed.imageUrl) {
        items.push({
          id: 'imageUrl',
          label: '复制图片链接',
          dividerBefore: !divided,
          onSelect: () => void copy(parsed.imageUrl ?? '', '图片链接')
        })
        divided = true
      }

      // 图片另存为：本地缓存优先，仅有远端链接时由主进程下载
      const imageLocalPath = item.localPath || parsed.localPath
      if (parsed.kind === 'image' && (imageLocalPath || parsed.imageUrl)) {
        items.push({
          id: 'saveImage',
          label: '图片另存为…',
          dividerBefore: true,
          onSelect: () =>
            void saveImage({
              localPath: imageLocalPath || undefined,
              url: parsed.imageUrl,
              suggestedName: suggestImageName(imageLocalPath, parsed.imageUrl, item.id)
            })
        })
      }

      const rawIsDistinct = Boolean(item.raw) && item.raw !== text
      if (rawIsDistinct) {
        items.push({
          id: 'raw',
          label: '复制原始内容',
          dividerBefore: true,
          onSelect: () => void copy(item.raw, '原始内容')
        })
      }
      items.push({
        id: 'id',
        label: '复制消息 ID',
        dividerBefore: !rawIsDistinct,
        onSelect: () => void copy(item.id, '消息 ID')
      })

      setMenu({ x: event.clientX, y: event.clientY, items })
    },
    [copy, item, saveImage]
  )

  if (item.kind === 'system' || item.kind === 'withdrawn') {
    return (
      <>
        <div
          onContextMenu={handleContextMenu}
          title="右键可复制消息内容"
          className="flex justify-center px-4 py-1"
        >
          <span className="max-w-[70%] rounded-full border border-line/10 bg-surface-800/60 px-3 py-1 text-center">
            <MessageContent item={item} keyword={keyword} />
          </span>
        </div>
        {menu && (
          <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />
        )}
      </>
    )
  }

  const mine = item.isMine

  return (
    <>
      <div
        data-message-id={item.id}
        onContextMenu={handleContextMenu}
        title="右键可复制消息内容"
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
              mine ? 'border-brand-indigo/25 bg-brand-indigo/12' : 'border-line/10 bg-surface-800/75'
            )}
          >
            <MessageContent item={item} keyword={keyword} />
          </div>

          <span className="px-1 text-micro text-ink-600">
            {formatMessageTime(item.timestamp, { seconds: true })}
          </span>
        </div>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
    </>
  )
}
