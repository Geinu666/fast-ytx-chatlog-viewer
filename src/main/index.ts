import { app, BrowserWindow, Menu, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '../shared/ipc-channels'
import { registerDataHandlers } from './ipc/handlers'
import { indexService } from './index-cache/service'

let windowHandlersRegistered = false

function getMainWindow(): BrowserWindow | null {
  const [win] = BrowserWindow.getAllWindows()
  return win && !win.isDestroyed() ? win : null
}

/** 应用图标：打包后位于 resources，开发态取 build 目录 */
function resolveIconPath(): string | undefined {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'icon.ico')]
    : [join(process.cwd(), 'build', 'icon.ico')]
  return candidates.find((candidate) => existsSync(candidate))
}

function createWindow(): BrowserWindow {
  const icon = resolveIconPath()
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1040,
    minHeight: 660,
    show: false,
    frame: false,
    backgroundColor: '#0B0F1A',
    title: '猿通讯聊天记录查看器',
    ...(icon ? { icon } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true
    }
  })

  win.on('ready-to-show', () => win.show())

  const notifyMaximize = (): void => {
    if (!win.isDestroyed()) win.webContents.send(IPC.winMaximizeChange, win.isMaximized())
  }
  win.on('maximize', notifyMaximize)
  win.on('unmaximize', notifyMaximize)

  // 禁止渲染层打开新窗口，外链一律交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function registerWindowHandlers(): void {
  if (windowHandlersRegistered) return
  windowHandlersRegistered = true

  ipcMain.on(IPC.winMinimize, () => getMainWindow()?.minimize())
  ipcMain.on(IPC.winToggleMaximize, () => {
    const win = getMainWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on(IPC.winClose, () => getMainWindow()?.close())
  ipcMain.handle(IPC.winIsMaximized, () => getMainWindow()?.isMaximized() ?? false)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)

    const win = createWindow()
    registerWindowHandlers()
    registerDataHandlers()

    // 关键顺序：先让窗口显示出来，再开始扫描 / 建索引。
    // 扫描与建索引涉及大量磁盘读取，若在窗口显示前执行会占用主进程事件循环，
    // 导致 ready-to-show 迟迟无法触发，表现为「长时间无窗口」。
    const startIndex = (): void => {
      setTimeout(() => {
        void indexService.ensureReady()
      }, 30)
    }
    if (win.isVisible()) startIndex()
    else win.once('ready-to-show', startIndex)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
