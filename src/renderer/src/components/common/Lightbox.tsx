import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent
} from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  X
} from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { suggestImageName } from '@renderer/lib/localMedia'
import { useLightboxStore } from '@renderer/store/useLightboxStore'
import { useUiStore } from '@renderer/store/useUiStore'

const MIN_SCALE = 1
const MAX_SCALE = 6
/** 每次缩放倍率（滚轮与按钮共用） */
const ZOOM_STEP = 1.25
/** 判定「拖拽过」的位移阈值（像素） */
const DRAG_THRESHOLD = 4

interface DragState {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
  moved: boolean
}

/** 应用内图片查看弹窗：左右切换、缩放拖拽、键盘与滚轮操作 */
export function Lightbox() {
  const images = useLightboxStore((state) => state.images)
  const index = useLightboxStore((state) => state.index)
  const close = useLightboxStore((state) => state.close)
  const step = useLightboxStore((state) => state.step)
  const showToast = useUiStore((state) => state.showToast)

  const [scale, setScale] = useState(MIN_SCALE)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [failedIds, setFailedIds] = useState<string[]>([])

  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  /** 供非被动的 wheel 监听读取最新缩放值，避免反复重挂监听 */
  const scaleRef = useRef(scale)
  scaleRef.current = scale

  const current = index >= 0 ? images[index] : undefined
  const open = Boolean(current)

  /** 图片实际展示地址：本地缓存失败时回退远端链接 */
  const src = (() => {
    if (!current) return ''
    if (failedIds.includes(current.id) && current.url) return current.url
    return current.src
  })()

  const reset = useCallback((): void => {
    setScale(MIN_SCALE)
    setOffset({ x: 0, y: 0 })
  }, [])

  // 切换图片时复位缩放与位移
  useEffect(() => {
    reset()
    dragRef.current = null
    setDragging(false)
  }, [current?.id, reset])

  const zoomTo = useCallback(
    (next: number): void => {
      const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next))
      setScale(clamped)
      if (clamped === MIN_SCALE) setOffset({ x: 0, y: 0 })
    },
    []
  )

  // 键盘操作：Esc 关闭、← → 切换、+/-/0 缩放
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      switch (event.key) {
        case 'Escape':
          event.stopImmediatePropagation()
          close()
          break
        case 'ArrowLeft':
          event.stopImmediatePropagation()
          step(-1)
          break
        case 'ArrowRight':
          event.stopImmediatePropagation()
          step(1)
          break
        case '+':
        case '=':
          zoomTo(scale * ZOOM_STEP)
          break
        case '-':
          zoomTo(scale / ZOOM_STEP)
          break
        case '0':
          reset()
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, close, step, scale, zoomTo, reset])

  // 滚轮缩放：React 的 onWheel 是被动监听，无法 preventDefault，这里手动挂非被动监听
  useEffect(() => {
    const stage = stageRef.current
    if (!open || !stage) return
    const onWheel = (event: globalThis.WheelEvent): void => {
      event.preventDefault()
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
      zoomTo(scaleRef.current * factor)
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [open, zoomTo])

  if (!open || !current) return null

  const total = images.length
  const canPrev = index > 0
  const canNext = index < total - 1

  const clampOffset = (x: number, y: number, nextScale: number): { x: number; y: number } => {
    const stage = stageRef.current
    if (!stage || nextScale <= MIN_SCALE) return { x: 0, y: 0 }
    const rect = stage.getBoundingClientRect()
    const maxX = Math.max(0, ((rect.width - 120) * (nextScale - 1)) / 2)
    const maxY = Math.max(0, ((rect.height - 120) * (nextScale - 1)) / 2)
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y))
    }
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (scale <= MIN_SCALE) return
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
      moved: false
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) drag.moved = true
    setOffset(clampOffset(drag.originX + dx, drag.originY + dy, scale))
  }

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    if (event.currentTarget.hasPointerCapture(drag.pointerId)) {
      event.currentTarget.releasePointerCapture(drag.pointerId)
    }
    dragRef.current = null
    setDragging(false)
  }

  /** 点击空白处关闭（拖拽过或已放大时不关，避免误触） */
  const handleStageClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target !== stageRef.current) return
    if (dragRef.current?.moved || scale > MIN_SCALE) return
    close()
  }

  const openWithSystem = async (): Promise<void> => {
    if (current.localPath) {
      const result = await window.api.openLocalFile(current.localPath)
      if (!result.ok) showToast(result.error || '打开失败')
      return
    }
    if (current.url) window.open(current.url, '_blank')
  }

  const saveAs = async (): Promise<void> => {
    const result = await window.api.saveImageAs({
      localPath: current.localPath,
      url: current.url,
      suggestedName: suggestImageName(current.localPath, current.url)
    })
    if (result.canceled) return
    showToast(result.ok ? '图片已保存' : result.error || '保存失败')
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col bg-black/85 backdrop-blur-sm">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line/10 px-4 text-micro text-ink-400">
        <Maximize2 size={14} className="shrink-0 text-brand-cyan" />
        <span className="min-w-0 truncate text-ink-100">{current.title}</span>
        <span className="shrink-0 text-ink-600">
          {index + 1} / {total}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            className="btn"
            onClick={() => zoomTo(scale / ZOOM_STEP)}
            disabled={scale <= MIN_SCALE}
            title="缩小（-）"
          >
            <Minus size={12} />
          </button>
          <button
            type="button"
            className="btn w-14 justify-center"
            onClick={reset}
            title="恢复原始大小（0）"
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => zoomTo(scale * ZOOM_STEP)}
            disabled={scale >= MAX_SCALE}
            title="放大（+）"
          >
            <Plus size={12} />
          </button>
          <button
            type="button"
            className="btn"
            onClick={reset}
            disabled={scale === MIN_SCALE && offset.x === 0 && offset.y === 0}
            title="复位"
          >
            <RotateCcw size={12} />
          </button>
          <button type="button" className="btn" onClick={() => void openWithSystem()} title="用系统程序打开">
            <ExternalLink size={12} />
            打开
          </button>
          <button type="button" className="btn" onClick={() => void saveAs()} title="另存为">
            <Download size={12} />
            另存为
          </button>
          <button type="button" className="btn" onClick={close} title="关闭（Esc）">
            <X size={12} />
            关闭
          </button>
        </div>
      </header>

      <div
        ref={stageRef}
        onClick={handleStageClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={cn(
          'relative flex min-h-0 flex-1 select-none items-center justify-center overflow-hidden',
          scale > MIN_SCALE ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'
        )}
      >
        <img
          src={src}
          alt={current.title}
          draggable={false}
          onError={() =>
            setFailedIds((prev) => (prev.includes(current.id) ? prev : [...prev, current.id]))
          }
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
            transition: dragging ? 'none' : 'transform 160ms ease-out'
          }}
          className="pointer-events-none max-h-full max-w-full object-contain will-change-transform"
        />

        {canPrev && (
          <button
            type="button"
            onClick={() => step(-1)}
            title="上一张（←）"
            className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-line/15 bg-surface-800/80 text-ink-100 backdrop-blur transition-colors duration-200 hover:border-brand-cyan/40 hover:bg-surface-700/85"
          >
            <ChevronLeft size={18} />
          </button>
        )}
        {canNext && (
          <button
            type="button"
            onClick={() => step(1)}
            title="下一张（→）"
            className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-line/15 bg-surface-800/80 text-ink-100 backdrop-blur transition-colors duration-200 hover:border-brand-cyan/40 hover:bg-surface-700/85"
          >
            <ChevronRight size={18} />
          </button>
        )}
      </div>

      <footer className="flex h-9 shrink-0 items-center gap-3 border-t border-line/10 px-4 text-micro text-ink-600">
        <span>滚轮缩放 · 拖拽平移 · ← → 切换 · Esc 关闭</span>
        {current.localPath && (
          <span className="ml-auto max-w-[60%] truncate" title={current.localPath}>
            {current.localPath}
          </span>
        )}
      </footer>
    </div>,
    document.body
  )
}
