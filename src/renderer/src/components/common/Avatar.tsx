import { useMemo, useState } from 'react'
import { cn } from '@renderer/lib/cn'

interface AvatarProps {
  name: string
  src?: string
  size?: number
  className?: string
}

const GRADIENTS = [
  'linear-gradient(135deg,#6366F1,#22D3EE)',
  'linear-gradient(135deg,#8B5CF6,#6366F1)',
  'linear-gradient(135deg,#22D3EE,#22C55E)',
  'linear-gradient(135deg,#F59E0B,#EF4444)',
  'linear-gradient(135deg,#38BDF8,#8B5CF6)',
  'linear-gradient(135deg,#EF4444,#8B5CF6)'
]

function hashOf(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) % 1000000007
  }
  return hash
}

/** 头像组件：无可用图片或加载失败时回退为首字渐变块 */
export function Avatar({ name, src, size = 36, className }: AvatarProps) {
  const [broken, setBroken] = useState(false)

  const usableSrc = useMemo(() => {
    if (!src) return ''
    const trimmed = src.trim()
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed
    if (trimmed.startsWith('/img/') || trimmed.startsWith('/static/')) return ''
    return ''
  }, [src])

  const gradient = useMemo(() => GRADIENTS[hashOf(name || '?') % GRADIENTS.length], [name])
  const initial = (name || '?').trim().slice(0, 1) || '?'

  if (usableSrc && !broken) {
    return (
      <img
        src={usableSrc}
        alt={name}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setBroken(true)}
        className={cn('shrink-0 rounded-lg object-cover', className)}
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <div
      className={cn(
        'flex shrink-0 select-none items-center justify-center rounded-lg font-semibold text-white',
        className
      )}
      style={{ width: size, height: size, background: gradient, fontSize: size * 0.44 }}
      title={name}
    >
      {initial}
    </div>
  )
}
