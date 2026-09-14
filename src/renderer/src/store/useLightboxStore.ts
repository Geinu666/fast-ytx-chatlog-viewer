import { create } from 'zustand'

/** 图片查看弹窗中的一张图片 */
export interface LightboxImage {
  /** 消息（或转发子消息）的唯一标识，用于定位当前项 */
  id: string
  /** 展示用地址：本地缓存优先，无本地缓存时为远端链接 */
  src: string
  /** 本地缓存绝对路径（用于「用系统程序打开」与「另存为」） */
  localPath?: string
  /** 远端链接（本地加载失败时回退、以及「复制链接」用） */
  url?: string
  title: string
}

/**
 * 图片查看弹窗状态。
 *
 * 维护两份「相册」：时间线（当前会话已加载消息中的图片）与转发弹窗
 * （当前层转发记录中的图片）。双击某张图片时按上下文挑一份作为浏览集合，
 * 打开后固定使用该快照，因此翻页不会因为消息列表刷新而错位。
 */
interface LightboxState {
  /** 时间线相册 */
  timelineImages: LightboxImage[]
  /** 转发弹窗相册；未打开弹窗时为 null */
  dialogImages: LightboxImage[] | null
  /** 当前正在浏览的相册快照 */
  images: LightboxImage[]
  /** 当前索引，-1 表示未打开 */
  index: number

  setTimelineImages: (images: LightboxImage[]) => void
  setDialogImages: (images: LightboxImage[] | null) => void
  /** 按上下文打开指定图片 */
  openById: (targetId: string) => void
  close: () => void
  /** 向前 / 向后切换（越界自动忽略） */
  step: (delta: number) => void
}

export const useLightboxStore = create<LightboxState>((set, get) => ({
  timelineImages: [],
  dialogImages: null,
  images: [],
  index: -1,

  setTimelineImages: (images) => set({ timelineImages: images }),
  setDialogImages: (images) => set({ dialogImages: images }),

  openById: (targetId) => {
    const { dialogImages, timelineImages } = get()
    const gallery = dialogImages && dialogImages.length > 0 ? dialogImages : timelineImages
    const index = gallery.findIndex((image) => image.id === targetId)
    if (index < 0) return
    set({ images: gallery, index })
  },

  close: () => set({ images: [], index: -1 }),

  step: (delta) => {
    const { images, index } = get()
    const next = index + delta
    if (next < 0 || next >= images.length) return
    set({ index: next })
  }
}))
