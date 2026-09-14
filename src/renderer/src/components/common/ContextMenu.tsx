import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@renderer/lib/cn'

export interface ContextMenuItem {
  id: string
  label: string
  shortcut?: string
  /** 在该项之前渲染一条分隔线 */
  dividerBefore?: boolean
  disabled?: boolean
  onSelect: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

/**
 * 通用右键菜单。
 * 通过 Portal 挂载到 body，避免被虚拟列表行的 transform 影响定位。
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x, y, ready: false })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const nextX = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))
    const nextY = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))
    setPosition({ x: nextX, y: nextY, ready: true })
  }, [x, y])

  useEffect(() => {
    const close = (): void => onClose()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }

    // 延迟绑定，避免捕获到触发本次菜单的右键事件
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', close)
      window.addEventListener('wheel', close, { passive: true })
      window.addEventListener('resize', close)
      window.addEventListener('blur', close)
    }, 0)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('mousedown', close)
      window.removeEventListener('wheel', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{
        left: position.x,
        top: position.y,
        visibility: position.ready ? 'visible' : 'hidden'
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      className="fixed z-[80] min-w-[218px] animate-fade-in overflow-hidden rounded-xl border border-line/15 bg-surface-800/95 py-1 shadow-glass backdrop-blur-xl"
    >
      {items.map((item) => (
        <div key={item.id}>
          {item.dividerBefore && <div className="my-1 h-px bg-line/12" />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-left text-micro transition-colors duration-150',
              item.disabled
                ? 'cursor-not-allowed text-ink-600'
                : 'cursor-pointer text-ink-400 hover:bg-brand-indigo/20 hover:text-ink-100'
            )}
          >
            <span className="flex-1 truncate">{item.label}</span>
            {item.shortcut && <span className="shrink-0 text-ink-600">{item.shortcut}</span>}
          </button>
        </div>
      ))}
    </div>,
    document.body
  )
}
