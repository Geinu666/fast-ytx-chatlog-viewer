import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type {
  AppConfig,
  ChatLogApi,
  ChatQuery,
  DbSource,
  IndexStatus,
  LocalFileQuery,
  LocalFileResult,
  MessageQuery,
  SaveFileResult,
  SaveImageInput,
  SourceSelection
} from '../shared/types'

/**
 * 通过 contextBridge 暴露白名单 API，渲染层无法直接访问 Node / Electron 能力。
 */
const api: ChatLogApi = {
  listSources: (force?: boolean): Promise<DbSource[]> =>
    ipcRenderer.invoke(IPC.dbListSources, force === true),
  sourceStats: (force?: boolean): Promise<DbSource[]> =>
    ipcRenderer.invoke(IPC.dbSourceStats, force === true),
  selectSource: (selection: SourceSelection): Promise<IndexStatus> =>
    ipcRenderer.invoke(IPC.dbSelectSource, selection),
  indexStatus: (): Promise<IndexStatus> => ipcRenderer.invoke(IPC.indexStatus),
  ensureIndex: (): Promise<IndexStatus> => ipcRenderer.invoke(IPC.indexEnsure),
  rebuildIndex: (): Promise<IndexStatus> => ipcRenderer.invoke(IPC.indexRebuild),
  refreshIndex: (): Promise<IndexStatus> => ipcRenderer.invoke(IPC.indexRefresh),
  onIndexProgress: (cb: (status: IndexStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: IndexStatus): void => cb(status)
    ipcRenderer.on(IPC.indexProgress, listener)
    return () => ipcRenderer.removeListener(IPC.indexProgress, listener)
  },

  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke(IPC.configGet),
  saveConfig: (config: AppConfig): Promise<AppConfig> =>
    ipcRenderer.invoke(IPC.configSave, config),
  defaultDataDirs: (): Promise<string[]> => ipcRenderer.invoke(IPC.configDefaults),
  pickDataDir: (): Promise<string | null> => ipcRenderer.invoke(IPC.configPickDir),
  pickDataFile: (): Promise<string | null> => ipcRenderer.invoke(IPC.configPickFile),

  listChats: (query: ChatQuery) => ipcRenderer.invoke(IPC.chatList, query),
  chatMeta: (chatId: string) => ipcRenderer.invoke(IPC.chatMeta, chatId),
  messagePage: (query: MessageQuery) => ipcRenderer.invoke(IPC.messagePage, query),
  messageContext: (chatId: string, messageId: string, radius?: number) =>
    ipcRenderer.invoke(IPC.messageContext, chatId, messageId, radius),
  searchGlobal: (query: MessageQuery) => ipcRenderer.invoke(IPC.searchGlobal, query),
  filterFacets: (chatId: string) => ipcRenderer.invoke(IPC.filterFacets, chatId),
  copyText: (text: string): Promise<boolean> => ipcRenderer.invoke(IPC.clipWrite, text),
  openLocalFile: (path: string): Promise<LocalFileResult> =>
    ipcRenderer.invoke(IPC.fileOpen, path),
  revealLocalFile: (path: string): Promise<LocalFileResult> =>
    ipcRenderer.invoke(IPC.fileReveal, path),
  saveImageAs: (input: SaveImageInput): Promise<SaveFileResult> =>
    ipcRenderer.invoke(IPC.fileSaveAs, input),
  resolveLocalFile: (input: LocalFileQuery): Promise<string | null> =>
    ipcRenderer.invoke(IPC.fileResolveLocal, input),

  window: {
    minimize: (): void => ipcRenderer.send(IPC.winMinimize),
    toggleMaximize: (): void => ipcRenderer.send(IPC.winToggleMaximize),
    close: (): void => ipcRenderer.send(IPC.winClose),
    // 真正退出应用（不受「关闭时最小化到托盘」拦截）
    quit: (): void => ipcRenderer.send(IPC.winQuit),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.winIsMaximized),
    onMaximizeChange: (cb: (maximized: boolean) => void): (() => void) => {
      const listener = (_event: unknown, maximized: boolean): void => cb(maximized)
      ipcRenderer.on(IPC.winMaximizeChange, listener)
      return () => ipcRenderer.removeListener(IPC.winMaximizeChange, listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
