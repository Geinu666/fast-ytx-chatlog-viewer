import type { ChatLogApi } from '@shared/types'

declare global {
  interface Window {
    api: ChatLogApi
  }
}

export {}
