import { useEffect, useState } from 'react'

/** 延迟返回最新值，用于输入框防抖 */
export function useDebouncedValue<T>(value: T, delay = 260): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
