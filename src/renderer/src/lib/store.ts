import { create } from 'zustand'
import type { BoardSummary, Counts, Highlight, Item, LearnAPI, Settings, Source, View } from '@shared/types'
import { dictionaries } from './strings'

export const PAGE = 80

type Dialog = null | 'add' | 'settings' | 'catalog' | 'balance'

interface Toast {
  id: number
  text: string
  tone?: 'ok' | 'error'
}

interface AppState {
  api: LearnAPI
  ready: boolean
  settings: Settings | null
  sources: Source[]
  counts: Counts | null
  boards: BoardSummary[]
  /** Surlignage à montrer dès que son document est ouvert (depuis un board). */
  jumpTo: { itemId: string; highlightId: string; layer: string } | null

  view: View
  search: string
  items: Item[]
  hasMore: boolean
  loading: boolean

  selectedId: string | null
  item: Item | null
  highlights: Highlight[]
  mode: 'feed' | 'full'
  extracting: boolean

  sidebarOpen: boolean
  /** Mode lecture : barre latérale et liste masquées (pratique pour les livres). */
  focusMode: boolean
  panelOpen: boolean
  dialog: Dialog
  refreshing: boolean
  toasts: Toast[]

  init(api: LearnAPI): Promise<void>
  reloadMeta(): Promise<void>
  updateSettings(patch: Partial<Settings>): Promise<void>
  setView(view: View): void
  setSearch(q: string): void
  loadItems(reset?: boolean): Promise<void>
  select(id: string | null): Promise<void>
  move(delta: 1 | -1): void
  patchItem(id: string, patch: Partial<Pick<Item, 'read' | 'later' | 'bookmarked' | 'favorite' | 'tags'>>): Promise<void>
  setMode(mode: 'feed' | 'full'): Promise<void>
  addHighlight(h: Omit<Highlight, 'id' | 'createdAt' | 'updatedAt'>): Promise<Highlight>
  updateHighlight(id: string, patch: Partial<Pick<Highlight, 'color' | 'note'>>): Promise<void>
  removeHighlight(id: string): Promise<void>
  refresh(): Promise<void>
  setDialog(d: Dialog): void
  toggleSidebar(): void
  toggleFocus(on?: boolean): void
  reloadBoards(): Promise<void>
  createBoard(): Promise<void>
  openHighlight(itemId: string, highlightId: string, layer: string): Promise<void>
  importBooks(paths?: string[]): Promise<void>
  togglePanel(open?: boolean): void
  toast(text: string, tone?: Toast['tone']): void
}

let toastSeq = 0
let loadSeq = 0

export const useApp = create<AppState>((set, get) => ({
  api: null as unknown as LearnAPI,
  ready: false,
  settings: null,
  sources: [],
  counts: null,
  boards: [],
  jumpTo: null,
  view: { type: 'home' },
  search: '',
  items: [],
  hasMore: false,
  loading: false,
  selectedId: null,
  item: null,
  highlights: [],
  mode: 'feed',
  extracting: false,
  sidebarOpen: true,
  focusMode: false,
  panelOpen: false,
  dialog: null,
  refreshing: false,
  toasts: [],

  async init(api) {
    set({ api })
    const settings = await api.getSettings()
    set({ settings, ready: true })
    await get().reloadMeta()
    await get().loadItems(true)
    api.onEvent((e) => {
      if (e.type === 'refresh-started') set({ refreshing: true })
      if (e.type === 'refresh-finished') set({ refreshing: false })
      if (e.type === 'highlights-changed') {
        const { item } = get()
        if (item?.id === e.itemId) {
          void api.listHighlights(e.itemId).then((highlights) => set({ highlights }))
          void api.getItem(e.itemId).then((it) => it && set((s) => ({ item: s.item?.id === it.id ? { ...it, fullHtml: s.item.fullHtml ?? it.fullHtml } : s.item })))
        }
        if (e.message) get().toast(e.message)
      }
      if (e.type === 'boards-changed') void get().reloadBoards()
      if (e.type === 'items-changed') {
        void get().reloadMeta()
        void get().loadItems(true)
      }
      if (e.type === 'menu') {
        if (e.action === 'refresh') void get().refresh()
        else set({ dialog: e.action === 'add-source' ? 'add' : 'settings' })
      }
    })
  },

  async reloadMeta() {
    const { api } = get()
    const [sources, counts, boards] = await Promise.all([api.listSources(), api.counts(), api.listBoards()])
    set({ sources, counts, boards })
  },

  async updateSettings(patch) {
    const settings = await get().api.updateSettings(patch)
    set({ settings })
  },

  setView(view) {
    set({ view, selectedId: null, item: null, highlights: [], search: '' })
    if (view.type !== 'board') void get().loadItems(true)
  },

  setSearch(search) {
    set({ search })
    void get().loadItems(true)
  },

  async loadItems(reset = false) {
    const { api, view, search, items } = get()
    const seq = ++loadSeq
    set({ loading: true })
    const offset = reset ? 0 : items.length
    if (view.type === 'board') return set({ loading: false })
    const page = await api.listItems({ view, search, limit: PAGE, offset, unreadOnly: false })
    if (seq !== loadSeq) return
    set({ items: reset ? page : [...items, ...page], hasMore: page.length === PAGE, loading: false })
  },

  async select(id) {
    if (!id) {
      set({ selectedId: null, item: null, highlights: [] })
      return
    }
    const { api } = get()
    set({ selectedId: id })
    const [item, highlights] = await Promise.all([api.getItem(id), api.listHighlights(id)])
    if (get().selectedId !== id || !item) return
    const hasFull = !!item.fullHtml
    const thin = (item.contentHtml?.replace(/<[^>]+>/g, '').length ?? 0) < 500
    set({ item, highlights, mode: hasFull || (thin && highlights.every((h) => h.layer !== 'feed')) ? 'full' : 'feed' })
    if (!item.read) void get().patchItem(id, { read: true })
    if (!hasFull && thin && item.url && highlights.every((h) => h.layer !== 'feed')) void get().setMode('full')
  },

  move(delta) {
    const { items, selectedId } = get()
    if (!items.length) return
    const idx = items.findIndex((i) => i.id === selectedId)
    const next = items[Math.min(items.length - 1, Math.max(0, idx === -1 ? 0 : idx + delta))]
    if (next && next.id !== selectedId) void get().select(next.id)
    if (idx >= items.length - 5 && get().hasMore) void get().loadItems()
  },

  async patchItem(id, patch) {
    // Mise à jour optimiste : l'interface réagit tout de suite.
    set((s) => ({
      items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
      item: s.item?.id === id ? { ...s.item, ...patch } : s.item
    }))
    const updated = await get().api.updateItem(id, patch)
    set((s) => ({ item: s.item?.id === id ? { ...updated, fullHtml: s.item.fullHtml ?? updated.fullHtml } : s.item }))
    void get().reloadMeta()
  },

  async setMode(mode) {
    const { item, api } = get()
    set({ mode })
    if (mode !== 'full' || !item || item.fullHtml) return
    set({ extracting: true })
    try {
      const updated = await api.extractFullText(item.id)
      if (get().item?.id === item.id) set({ item: updated })
    } catch (e) {
      if (get().item?.id === item.id) set({ mode: 'feed' })
      get().toast((e as Error).message, 'error')
    } finally {
      set({ extracting: false })
    }
  },

  async addHighlight(h) {
    const created = await get().api.addHighlight(h)
    set((s) => ({
      highlights: [...s.highlights, created],
      items: s.items.map((i) => (i.id === h.itemId ? { ...i, highlightCount: (i.highlightCount ?? 0) + 1 } : i))
    }))
    void get().reloadMeta()
    return created
  },

  async updateHighlight(id, patch) {
    const updated = await get().api.updateHighlight(id, patch)
    set((s) => ({ highlights: s.highlights.map((h) => (h.id === id ? updated : h)) }))
  },

  async removeHighlight(id) {
    const h = get().highlights.find((x) => x.id === id)
    await get().api.removeHighlight(id)
    set((s) => ({
      highlights: s.highlights.filter((x) => x.id !== id),
      items: s.items.map((i) => (h && i.id === h.itemId ? { ...i, highlightCount: Math.max(0, (i.highlightCount ?? 1) - 1) } : i))
    }))
    void get().reloadMeta()
  },

  async refresh() {
    if (get().refreshing) return
    set({ refreshing: true })
    try {
      const r = await get().api.refresh()
      const lang = get().settings?.language ?? 'fr'
      const t = dictionaries[lang]
      get().toast(t.newItems(r.newItems) + (r.errors.length ? ` · ${t.errorsCount(r.errors.length)}` : ''), r.errors.length ? 'error' : 'ok')
    } finally {
      set({ refreshing: false })
      void get().reloadMeta()
      void get().loadItems(true)
    }
  },

  setDialog(dialog) {
    set({ dialog })
  },
  toggleSidebar() {
    set((s) => ({ sidebarOpen: !s.sidebarOpen }))
  },
  toggleFocus(on) {
    set((s) => ({ focusMode: on ?? !s.focusMode }))
  },
  async reloadBoards() {
    set({ boards: await get().api.listBoards() })
  },
  async createBoard() {
    const { api, settings } = get()
    const board = await api.createBoard(dictionaries[settings?.language ?? 'fr'].boardUntitled, 'mindmap')
    await get().reloadBoards()
    get().setView({ type: 'board', boardId: board.id })
  },
  async openHighlight(itemId, highlightId, layer) {
    set({ jumpTo: { itemId, highlightId, layer } })
    get().setView({ type: 'highlights' })
    await get().select(itemId)
  },
  async importBooks(paths) {
    const { api, settings } = get()
    const t = dictionaries[settings?.language ?? 'fr']
    try {
      const r = await api.importBooks(paths)
      if (r.added.length) {
        get().toast(t.imported(r.added.length))
        set({ view: { type: 'library' }, search: '' })
        await get().reloadMeta()
        await get().loadItems(true)
        void get().select(r.added[0].id)
      }
      for (const f of r.failed) get().toast(`${f.file} : ${f.error}`, 'error')
    } catch (e) {
      get().toast((e as Error).message, 'error')
    }
  },
  togglePanel(open) {
    set((s) => ({ panelOpen: open ?? !s.panelOpen }))
  },
  toast(text, tone = 'ok') {
    const id = ++toastSeq
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200)
  }
}))
