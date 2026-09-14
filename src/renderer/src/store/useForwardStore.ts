import { create } from 'zustand'
import type { ForwardPayload } from '@shared/content'

/**
 * 批量转发弹窗的层级栈。
 *
 * 栈顶即当前浏览的一层转发内容；在弹窗内点击子转发会继续入栈，
 * 「返回上一级」出栈，关闭时清空。使用全局栈而非组件局部状态，
 * 是为了让任意深度的嵌套转发都能复用同一套导航逻辑。
 */
interface ForwardState {
  stack: ForwardPayload[]
  /** 打开一层转发（入栈） */
  pushForward: (payload: ForwardPayload) => void
  /** 返回上一级（出栈） */
  goBack: () => void
  /** 关闭弹窗并清空层级 */
  close: () => void
}

export const useForwardStore = create<ForwardState>((set) => ({
  stack: [],
  pushForward: (payload) => set((state) => ({ stack: [...state.stack, payload] })),
  goBack: () => set((state) => ({ stack: state.stack.slice(0, -1) })),
  close: () => set({ stack: [] })
}))
