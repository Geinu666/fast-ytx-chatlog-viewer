import { app, BrowserWindow, Menu, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/ipc-channels'
import { registerDataHandlers } from './ipc/handlers'
import { indexService } from './index-cache/service'

let windowHandlersRegistered = false

function getMainWindow(): BrowserWindow | null {
  const [win] = BrowserWindow.getAllWindows()
  return win && !win.isDestroyed() ? win : null
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1040,
    minHeight: 660,
    show: false,
    frame: false,
    backgroundColor: '#0B0F1A',
    title: '猿通讯聊天记录查看器',
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

    createWindow()
    registerWindowHandlers()
    registerDataHandlers()

    // 后台准备索引，进度通过 IPC 事件回传
    void indexService.ensureReady()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
