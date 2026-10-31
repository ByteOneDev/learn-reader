import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, safeStorage, session, shell } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { API_METHODS, type ApiMethod, type BoardExportFormat, type LearnEvent } from '@shared/types'
import { LearnCore } from './core'
import { openDatabase } from './db'
import { buildMenu } from './menu'
import { parseLearnLink } from '@shared/links'
import { boardToFreeMind, boardToOpml, boardToSvg } from '@shared/boardExport'
import { execFile } from 'node:child_process'
import { ObsidianSync } from './sync/obsidianSync'
import { NotionSync, type SecretBox } from './notion/notionSync'

let win: BrowserWindow | null = null
let core: LearnCore
let sync: ObsidianSync
let notion: NotionSync

/** Le jeton Notion est chiffré par le trousseau du système (Keychain, DPAPI, libsecret) quand il est disponible. */
const secretBox: SecretBox = {
  encrypt: (plain) => (safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(plain).toString('base64') : 'b64:' + Buffer.from(plain).toString('base64')),
  decrypt: (sealed) =>
    sealed.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(sealed.slice(4), 'base64')) : Buffer.from(sealed.slice(4), 'base64').toString('utf8')
}
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
  // Balayage à trois doigts (macOS) : replier ou rouvrir les volets, comme dans Reeder.
  win.on('swipe', (_e, direction) => {
    if (direction === 'left' || direction === 'right') send({ type: 'swipe', direction })
  })
  win.webContents.on('did-finish-load', () => {
    if (!pendingLink) return
    const link = pendingLink
    pendingLink = null
    // Laisse le temps à l'interface de charger la bibliothèque avant d'ouvrir le document.
    setTimeout(() => handleLink(link), 600)
  })

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

/** PDF d'un SVG : rendu dans une fenêtre invisible puis imprimé à la taille exacte du dessin. */
async function svgToPdf(svg: string, width: number, height: number): Promise<Buffer> {
  const page = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } })
  try {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:0}html,body{margin:0}</style></head><body>${svg}</body></html>`
    await page.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return await page.webContents.printToPDF({
      printBackground: true,
      pageSize: { width: Math.max(width / 96, 3), height: Math.max(height / 96, 3) },
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    })
  } finally {
    page.destroy()
  }
}

async function exportBoardFile(id: string, format: BoardExportFormat): Promise<string | null> {
  const board = core.store.getBoard(id)
  if (!board) throw new Error('Board introuvable')
  const base = board.title.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'Board'
  if (format === 'mindnode') {
    // MindNode importe l'OPML : on l'écrit dans un dossier temporaire et on demande à macOS de l'ouvrir avec MindNode.
    const path = join(app.getPath('temp'), `${base}.opml`)
    writeFileSync(path, boardToOpml(board), 'utf8')
    if (process.platform !== 'darwin') throw new Error('MindNode n’existe que sur Mac : exporte en OPML.')
    await new Promise<void>((resolve, reject) =>
      execFile('open', ['-a', 'MindNode', path], (err) => (err ? reject(new Error('MindNode n’est pas installé : exporte en OPML et ouvre le fichier avec ton outil.')) : resolve()))
    )
    return path
  }
  const ext = format === 'mm' ? 'mm' : format
  const names: Record<string, string> = { opml: 'OPML (MindNode, OmniOutliner)', mm: 'FreeMind (MindNode, XMind, Freeplane)', pdf: 'PDF', svg: 'SVG' }
  const r = await dialog.showSaveDialog(win!, { defaultPath: `${base}.${ext}`, filters: [{ name: names[format], extensions: [ext] }] })
  if (r.canceled || !r.filePath) return null
  if (format === 'opml') writeFileSync(r.filePath, boardToOpml(board), 'utf8')
  else if (format === 'mm') writeFileSync(r.filePath, boardToFreeMind(board), 'utf8')
  else {
    const { svg, width, height } = boardToSvg(board)
    if (format === 'svg') writeFileSync(r.filePath, svg, 'utf8')
    else writeFileSync(r.filePath, await svgToPdf(svg, width, height))
  }
  return r.filePath
}

/** Toute modification d'un document est propagée aux synchronisations actives. */
function touch(itemId: string): void {
  sync.touch(itemId)
  notion.touch(itemId)
}

function registerIpc(): void {
  const handlers: Record<ApiMethod, (...args: never[]) => unknown> = {
    getSettings: () => core.store.getSettings(),
    updateSettings: (patch: Parameters<typeof core.store.updateSettings>[0]) => {
      const s = core.store.updateSettings(patch)
      if ('refreshMinutes' in patch) scheduleRefresh()
      if ('theme' in patch) nativeTheme.themeSource = s.theme
      if ('obsidianSync' in patch || 'obsidianVault' in patch || 'obsidianFolder' in patch) sync.restart()
      if ('notionSync' in patch) notion.restart()
      // Nouvelle clé YouTube : on remonte tout de suite l'année des chaînes suivies.
      if (patch.youtubeApiKey) {
        for (const src of core.store.listSources().filter((x) => x.kind === 'youtube')) core.store.updateSource(src.id, { backfilledYear: undefined })
        void core.refresh()
      }
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
    updateItem: (id: string, patch: Parameters<typeof core.store.updateItem>[1]) => {
      const item = core.store.updateItem(id, patch)
      if (patch.tags) touch(id)
      return item
    },
    markAllRead: (view: Parameters<typeof core.store.markAllRead>[0]) => core.store.markAllRead(view),
    extractFullText: (id: string) => core.extractFullText(id),
    saveLink: (url: string) => core.saveLink(url),
    counts: () => core.store.counts(),
    allTags: () => core.store.allTags(),
    listHighlights: (itemId?: string) => core.store.listHighlights(itemId),
    addHighlight: (h: Parameters<LearnCore['addHighlight']>[0]) => {
      const created = core.addHighlight(h)
      touch(h.itemId)
      return created
    },
    updateHighlight: (id: string, patch: Parameters<typeof core.store.updateHighlight>[1]) => {
      const updated = core.store.updateHighlight(id, patch)
      touch(updated.itemId)
      return updated
    },
    removeHighlight: (id: string) => {
      const h = core.store.listHighlights().find((x) => x.id === id)
      core.store.removeHighlight(id)
      if (h) touch(h.itemId)
    },
    refresh: (sourceId?: string) => core.refresh(sourceId),
    importBooks: async (paths?: string[]) => {
      let files = paths
      if (!files) {
        const r = await dialog.showOpenDialog(win!, {
          title: 'Importer des livres',
          properties: ['openFile', 'multiSelections'],
          filters: [{ name: 'Livres (EPUB, PDF)', extensions: ['epub', 'pdf'] }]
        })
        if (r.canceled) return { added: [], failed: [] }
        files = r.filePaths
      }
      return core.importBooks(files)
    },
    bookToc: (itemId: string) => core.bookToc(itemId),
    bookChapter: (itemId: string, index: number) => core.bookChapter(itemId, index),
    readBookFile: (itemId: string) => core.readBookFile(itemId),
    savePosition: (itemId: string, position: string, progress: number) => core.store.savePosition(itemId, position, progress),
    updateBook: (itemId: string, patch: { title?: string; author?: string; imageUrl?: string }) => core.store.updateItem(itemId, patch),
    readingBalance: (days: number) => core.store.readingBalance(days),
    transcript: (itemId: string) => core.transcript(itemId),
    searchPodcasts: (term: string) => core.searchPodcasts(term),
    listBoards: () => core.store.listBoards(),
    createBoard: (title: string, mode: Parameters<LearnCore['createBoard']>[1]) => core.createBoard(title, mode),
    getBoard: (id: string) => core.store.getBoard(id),
    saveBoard: (id: string, patch: Parameters<typeof core.store.updateBoard>[1]) => core.store.updateBoard(id, patch),
    deleteBoard: (id: string) => core.store.deleteBoard(id),
    addToBoard: (boardId: string, node: Parameters<LearnCore['addToBoard']>[1]) => core.addToBoard(boardId, node),
    allHighlights: () => core.store.allHighlights(),
    boardsForItem: (itemId: string) => core.boardsForItem(itemId),
    saveFile: async (defaultName: string, data: string | Uint8Array) => {
      const ext = defaultName.split('.').pop() ?? ''
      const r = await dialog.showSaveDialog(win!, { defaultPath: defaultName, filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [] })
      if (r.canceled || !r.filePath) return null
      writeFileSync(r.filePath, typeof data === 'string' ? data : Buffer.from(data))
      return r.filePath
    },
    exportBoardToObsidian: (id: string) => core.exportBoardToObsidian(id),
    boardMarkdown: (id: string) => core.boardMarkdown(id),
    exportBoardFile: (id: string, format: BoardExportFormat) => exportBoardFile(id, format),
    notionStatus: () => notion.status(),
    notionConnect: async (token: string) => {
      await notion.connect(token)
      return notion.status()
    },
    notionDisconnect: () => notion.disconnect(),
    notionCreateDatabase: async (parent: string) => {
      await notion.createDatabase(parent)
      notion.restart()
      return notion.status()
    },
    notionPush: async (itemId: string) => {
      const { pageId } = await notion.pushItem(itemId)
      return { url: `https://www.notion.so/${pageId.replace(/-/g, '')}` }
    },
    notionPushAll: () => notion.pushAll(),
    notionSyncNow: async () => {
      const reports = await notion.pull()
      const pushed = await notion.pushAll()
      return { pushed, updated: reports.reduce((a, r) => a + r.updated + r.removed, 0) }
    },
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

// ── Liens learn:// (extension Obsidian, export Markdown) ──────────────────────
// learn://open?item=<id>[&highlight=<id>] ouvre le document, ou le passage, dans Learn.

let pendingLink: string | null = null

function handleLink(url: string): void {
  const link = parseLearnLink(url)
  if (!link) return
  if (!win || win.webContents.isLoading()) {
    pendingLink = url
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  send({ type: 'open-link', ...link })
}

const linkFromArgv = (argv: string[]): string | undefined => argv.find((a) => a.startsWith('learn://'))

if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient('learn', process.execPath, [process.argv[1]])
else app.setAsDefaultProtocolClient('learn')

// Une seule fenêtre Learn : un lien ouvert alors que l'app tourne est transmis à l'instance existante.
if (!app.requestSingleInstanceLock()) app.exit(0)
app.on('second-instance', (_e, argv) => {
  const link = linkFromArgv(argv)
  if (link) handleLink(link)
  else if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})
// macOS transmet les liens par cet événement, parfois avant que l'app soit prête.
app.on('open-url', (e, url) => {
  e.preventDefault()
  if (app.isReady()) handleLink(url)
  else pendingLink = url
})
pendingLink = linkFromArgv(process.argv) ?? null

app.whenReady().then(async () => {
  // Pas de permissions (caméra, micro, notifications…) pour le contenu affiché ; seul le plein écran vidéo est permis.
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'fullscreen'))
  // Le lecteur YouTube refuse de s'afficher sans Referer (erreur 153), ce qui est le cas d'une page file://.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/*'] }, (details, cb) => {
    details.requestHeaders.Referer = 'https://github.com/ByteOneDev/learn-reader'
    cb({ requestHeaders: details.requestHeaders })
  })

  const wasm = readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))
  const store = await openDatabase(join(app.getPath('userData'), 'learn.sqlite'), wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer)
  core = new LearnCore(store, (url, init) => net.fetch(url, init), send, join(app.getPath('userData'), 'library'))
  nativeTheme.themeSource = store.getSettings().theme

  sync = new ObsidianSync(core, send)
  notion = new NotionSync(core, (url, init) => net.fetch(url, init), secretBox, send)
  registerIpc()
  Menu.setApplicationMenu(buildMenu(send))
  createWindow()
  scheduleRefresh()
  try {
    sync.restart()
  } catch {
    /* coffre indisponible au démarrage */
  }
  notion.restart()
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
  sync?.stop()
  notion?.stop()
  core?.store.flush()
})
