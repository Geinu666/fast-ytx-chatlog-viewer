import { Check } from 'lucide-react'
import { useUiStore } from '@renderer/store/useUiStore'

/** 轻量操作反馈提示 */
export function Toast() {
  const toast = useUiStore((state) => state.toast)
  if (!toast) return null

  return (
    <div className="pointer-events-none fixed bottom-14 left-1/2 z-[90] -translate-x-1/2 animate-fade-up">
      <span className="flex items-center gap-1.5 rounded-full border border-brand-cyan/35 bg-surface-800/95 px-3.5 py-1.5 text-micro text-ink-100 shadow-glow backdrop-blur-xl">
        <Check size={12} className="text-brand-cyan" />
        {toast}
      </span>
    </div>
  )
}
