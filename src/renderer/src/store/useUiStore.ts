import { create } from 'zustand'

export type ThemeMode = 'dark' | 'light'

interface UiState {
  theme: ThemeMode
  showFilters: boolean
  showDataSource: boolean
  toast: string | null
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
  toggleFilters: () => void
  toggleDataSource: () => void
  showToast: (message: string) => void
}

function applyTheme(theme: ThemeMode): void {
  const root = document.documentElement
  root.classList.toggle('light', theme === 'light')
  root.classList.toggle('dark', theme === 'dark')
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useUiStore = create<UiState>((set, get) => ({
  theme: 'dark',
  showFilters: true,
  showDataSource: false,
  toast: null,

  setTheme(theme: ThemeMode) {
    applyTheme(theme)
    set({ theme })
  },

  toggleTheme() {
    get().setTheme(get().theme === 'dark' ? 'light' : 'dark')
  },

  toggleFilters() {
    set({ showFilters: !get().showFilters })
  },

  toggleDataSource() {
    set({ showDataSource: !get().showDataSource })
  },

  showToast(message: string) {
    if (toastTimer) clearTimeout(toastTimer)
    set({ toast: message })
    toastTimer = setTimeout(() => set({ toast: null }), 1800)
  }
}))
