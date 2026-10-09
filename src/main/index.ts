import { app, BrowserWindow, Menu, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '../shared/ipc-channels'
import { registerDataHandlers } from './ipc/handlers'
import { indexService } from './index-cache/service'
import { registerMediaProtocol, registerMediaScheme } from './media/protocol'
import { createAppTray, hideToTray, isQuitting, markQuitting, quitApp, trayReady } from './tray'

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

  // 关闭按钮最小化到托盘：托盘可用时只隐藏窗口，真正退出走托盘菜单 / win:quit
  win.on('close', (event) => {
    if (isQuitting() || !trayReady()) return
    event.preventDefault()
    hideToTray(win)
  })

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
  ipcMain.on(IPC.winQuit, () => quitApp())
  ipcMain.handle(IPC.winIsMaximized, () => getMainWindow()?.isMaximized() ?? false)
}

// 必须在 app ready 之前注册私有媒体 scheme，否则本地图片会被当作不安全资源拦截
registerMediaScheme()

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      // 可能正处于「已隐藏到托盘」状态，需显式唤回
      if (!win.isVisible()) win.show()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)

    registerMediaProtocol()

    const win = createWindow()
    createAppTray(win, resolveIconPath())
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
      const current = getMainWindow()
      if (!current) {
        createWindow()
        return
      }
      // 隐藏到托盘时不重建窗口，直接唤回
      if (current.isMinimized()) current.restore()
      current.show()
      current.focus()
    })
  })

  // 系统级退出（任务栏「关闭窗口」、系统关机等）也需放行 close 拦截
  app.on('before-quit', () => markQuitting())

  app.on('window-all-closed', () => {
    // 托盘可用时关闭只是隐藏，进程由托盘常驻；仅在托盘创建失败时沿用默认退出行为
    if (process.platform !== 'darwin' && !trayReady()) app.quit()
  })
}
