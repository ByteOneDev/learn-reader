import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, session, shell } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { API_METHODS, type ApiMethod, type LearnEvent } from '@shared/types'
import { LearnCore } from './core'
import { openDatabase } from './db'
import { buildMenu } from './menu'

let win: BrowserWindow | null = null
let core: LearnCore
let refreshTimer: ReturnType<typeof setInterval> | null = null

const isMac = process.platform === 'darwin'

function send(e: LearnEvent): void {
  win?.webContents.send('learn:event', e)
}

function isSafeExternal(url: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}

function createWindow(): void {
  const dark = nativeTheme.shouldUseDarkColors
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: 'Learn',
    backgroundColor: dark ? '#1c1c1e' : '#f5f5f4',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 18, y: 18 },
    ...(isMac ? {} : { titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#e5e5e5' : '#333333', height: 44 } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win?.show())

  // Les liens s'ouvrent dans le navigateur, jamais dans l'app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)) return
    e.preventDefault()
    if (isSafeExternal(url)) void shell.openExternal(url)
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function scheduleRefresh(): void {
  if (refreshTimer) clearInterval(refreshTimer)
  const minutes = Math.max(5, core.store.getSettings().refreshMinutes || 30)
  refreshTimer = setInterval(() => void core.refresh(), minutes * 60_000)
}

function registerIpc(): void {
  const handlers: Record<ApiMethod, (...args: never[]) => unknown> = {
    getSettings: () => core.store.getSettings(),
    updateSettings: (patch: Parameters<typeof core.store.updateSettings>[0]) => {
      const s = core.store.updateSettings(patch)
      if ('refreshMinutes' in patch) scheduleRefresh()
      if ('theme' in patch) nativeTheme.themeSource = s.theme
      return s
    },
    listSources: () => core.store.listSources(),
    resolveInput: (input: string) => core.resolve(input),
    addSource: (n: Parameters<LearnCore['addSource']>[0]) => core.addSource(n),
    addSources: (list: Parameters<LearnCore['addSources']>[0]) => core.addSources(list),
    updateSource: (id: string, patch: { title?: string; category?: string }) => core.store.updateSource(id, patch),
    removeSource: (id: string) => core.removeSource(id),
    listItems: (q: Parameters<typeof core.store.listItems>[0]) => core.store.listItems(q),
    getItem: (id: string) => core.store.getItem(id),
    updateItem: (id: string, patch: Parameters<typeof core.store.updateItem>[1]) => core.store.updateItem(id, patch),
    markAllRead: (view: Parameters<typeof core.store.markAllRead>[0]) => core.store.markAllRead(view),
    extractFullText: (id: string) => core.extractFullText(id),
    saveLink: (url: string) => core.saveLink(url),
    counts: () => core.store.counts(),
    allTags: () => core.store.allTags(),
    listHighlights: (itemId?: string) => core.store.listHighlights(itemId),
    addHighlight: (h: Parameters<LearnCore['addHighlight']>[0]) => core.addHighlight(h),
    updateHighlight: (id: string, patch: Parameters<typeof core.store.updateHighlight>[1]) => core.store.updateHighlight(id, patch),
    removeHighlight: (id: string) => core.store.removeHighlight(id),
    refresh: (sourceId?: string) => core.refresh(sourceId),
    chooseFolder: async () => {
      const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'], title: 'Choisir le coffre Obsidian' })
      return r.canceled ? null : r.filePaths[0]
    },
    exportToObsidian: (itemId: string) => core.exportToObsidian(itemId),
    exportAllToObsidian: () => core.exportAllToObsidian(),
    markdownFor: (itemId: string) => core.markdownFor(itemId),
    importOpml: async () => {
      const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: 'OPML', extensions: ['opml', 'xml'] }] })
      if (r.canceled || !r.filePaths[0]) return null
      const out = await core.importOpml(readFileSync(r.filePaths[0], 'utf8'))
      return { added: out.added.length, failed: out.failed.length }
    },
    exportOpml: async () => {
      const r = await dialog.showSaveDialog(win!, { defaultPath: 'learn.opml', filters: [{ name: 'OPML', extensions: ['opml'] }] })
      if (r.canceled || !r.filePath) return null
      writeFileSync(r.filePath, core.exportOpml(), 'utf8')
      return r.filePath
    },
    openExternal: async (url: string) => {
      if (isSafeExternal(url)) await shell.openExternal(url)
    }
  }

  for (const method of API_METHODS) {
    ipcMain.handle(`learn:${method}`, async (event, ...args: unknown[]) => {
      // Seule la fenêtre de l'app peut appeler l'API.
      if (event.sender !== win?.webContents) throw new Error('Appel refusé')
      return (handlers[method] as (...a: unknown[]) => unknown)(...args)
    })
  }
}

app.whenReady().then(async () => {
  // Pas de permissions (caméra, micro, notifications…) pour le contenu affiché.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))

  const wasm = readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))
  const store = await openDatabase(join(app.getPath('userData'), 'learn.sqlite'), wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer)
  core = new LearnCore(store, (url, init) => net.fetch(url, init), send)
  nativeTheme.themeSource = store.getSettings().theme

  registerIpc()
  Menu.setApplicationMenu(buildMenu(send))
  createWindow()
  scheduleRefresh()
  if (store.getSettings().onboarded) setTimeout(() => void core.refresh(), 1500)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault())
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})

app.on('before-quit', () => {
  core?.store.flush()
})
