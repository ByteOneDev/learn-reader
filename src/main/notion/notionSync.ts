import type { Highlight, Item, LearnEvent } from '@shared/types'
import type { LearnCore } from '../core'
import type { SyncBase } from '../db'
import type { FetchFn } from '../feeds/fetcher'
import { threeWayMerge, type RemoteHighlight } from '../sync/merge'
import { NotionClient, NotionError } from './client'
import { blocksToNote, colorFromNotion, highlightToBlock, mdToRichText, NOTION_COLOR, noteToBlocks, notionId, richTextToMd, type NotionBlock, type RichText } from './convert'

// Synchronisation avec Notion : une base « Learn » (une page par document), une citation par surlignage,
// la note en paragraphes sous la citation. Les modifications faites dans Notion (notes, couleurs,
// citations supprimées, tags) reviennent dans Learn par la même fusion à trois voies qu'Obsidian.

const POLL_MS = 5 * 60_000
const PUSH_DELAY = 4000
const INTRO = 'Surlignages et notes de Learn. Tu peux modifier les notes (sous chaque citation), les couleurs et les tags ici : ils reviendront dans Learn.'

export const DATABASE_SCHEMA = {
  Name: { title: {} },
  Auteur: { rich_text: {} },
  Type: { select: { options: ['article', 'book', 'pdf', 'post', 'discussion', 'video'].map((name) => ({ name })) } },
  Source: { rich_text: {} },
  URL: { url: {} },
  Tags: { multi_select: {} },
  'Learn ID': { rich_text: {} }
}

export interface SecretBox {
  encrypt(plain: string): string
  decrypt(sealed: string): string
}

export interface NotionReport {
  itemId: string
  updated: number
  removed: number
  conflicts: number
  tagsChanged: boolean
}

function sortHighlights(list: Highlight[]): Highlight[] {
  const rank = (l: string): number => (l === 'feed' ? -2 : l === 'full' ? -1 : Number(l.split(':')[1]) || 0)
  return [...list].sort((a, b) => rank(a.layer) - rank(b.layer) || a.start - b.start)
}

export class NotionSync {
  private timer: ReturnType<typeof setInterval> | null = null
  private pushTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private pulling: Promise<NotionReport[]> | null = null

  constructor(
    private core: LearnCore,
    private fetchFn: FetchFn,
    private box: SecretBox,
    private emit: (e: LearnEvent) => void = () => {},
    private baseUrl?: string
  ) {}

  // ── Connexion ─────────────────────────────────────────────────────────────

  private token(): string | null {
    const sealed = this.core.store.getSecret('notion')
    if (!sealed) return null
    try {
      return this.box.decrypt(sealed)
    } catch {
      return null
    }
  }

  private client(): NotionClient {
    const token = this.token()
    if (!token) throw new Error('Connecte d’abord Learn à Notion dans les Réglages')
    return new NotionClient(token, this.fetchFn, this.baseUrl)
  }

  status(): { connected: boolean; workspace?: string; databaseUrl?: string; lastPull?: number } {
    const s = this.core.store.getSettings()
    return { connected: !!this.token(), workspace: s.notionWorkspace, databaseUrl: s.notionDatabaseId ? s.notionDatabaseUrl ?? `https://www.notion.so/${s.notionDatabaseId.replace(/-/g, '')}` : undefined, lastPull: s.notionLastPull }
  }

  async connect(token: string): Promise<string> {
    const clean = token.trim()
    if (!clean) throw new Error('Jeton vide')
    const me = await new NotionClient(clean, this.fetchFn, this.baseUrl).me()
    this.core.store.setSecret('notion', this.box.encrypt(clean))
    const name = me.name ?? 'Notion'
    this.core.store.updateSettings({ notionWorkspace: name })
    return name
  }

  disconnect(): void {
    this.stop()
    this.core.store.setSecret('notion', undefined)
    this.core.store.updateSettings({ notionWorkspace: undefined, notionSync: false })
  }

  /** Crée la base « Learn » dans une page partagée avec l'intégration. */
  async createDatabase(parent: string): Promise<string> {
    const pageId = notionId(parent)
    if (!pageId) throw new Error('Colle le lien d’une page Notion (partagée avec l’intégration Learn)')
    const db = await this.client().createDatabase(pageId, 'Learn', DATABASE_SCHEMA)
    this.core.store.updateSettings({ notionDatabaseId: db.id, notionDatabaseUrl: db.url })
    return db.url ?? db.id
  }

  // ── Learn → Notion ────────────────────────────────────────────────────────

  private properties(item: Item): Record<string, unknown> {
    const source = this.core.store.getSource(item.sourceId)
    const type = item.format ? (item.format === 'pdf' ? 'pdf' : 'book') : source?.kind === 'reddit' || source?.kind === 'forum' ? 'discussion' : ['mastodon', 'bluesky', 'x'].includes(source?.kind ?? '') ? 'post' : 'article'
    return {
      Name: { title: mdToRichText(item.title.slice(0, 2000)) },
      Auteur: { rich_text: item.author ? mdToRichText(item.author) : [] },
      Type: { select: { name: type } },
      Source: { rich_text: source && source.kind !== 'book' ? mdToRichText(source.title) : [] },
      URL: { url: item.url ?? null },
      Tags: { multi_select: item.tags.map((t) => ({ name: t.replace(/,/g, ' ') })) },
      'Learn ID': { rich_text: [{ type: 'text', text: { content: item.id, link: null } }] }
    }
  }

  private label(item: Item, h: Highlight): string | undefined {
    return item.format ? this.core.layerLabel(item, h.layer) : undefined
  }

  /** Crée ou met à jour la page Notion d'un document, en n'envoyant que ce qui a changé. */
  async pushItem(itemId: string): Promise<{ pageId: string; created: boolean }> {
    const { store } = this.core
    const databaseId = store.getSettings().notionDatabaseId
    if (!databaseId) throw new Error('Crée d’abord la base Learn dans Notion (Réglages)')
    const item = store.getItem(itemId)
    if (!item) throw new Error('Document introuvable')
    const c = this.client()
    const highlights = sortHighlights(store.listHighlights(itemId))
    const state = store.getNotionState(itemId)

    if (!state) {
      const intro: NotionBlock = { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: INTRO, link: null }, annotations: { italic: true, color: 'gray' } }] } }
      const blocks = highlights.map((h) => highlightToBlock(h, this.label(item, h)))
      const page = await c.createPage(databaseId, this.properties(item), [intro, ...blocks.slice(0, 99)])
      if (blocks.length > 99) await c.append(page.id, blocks.slice(99))
      const kids = await c.children(page.id)
      const map: Record<string, string> = { _intro: kids[0]?.id ?? '' }
      highlights.forEach((h, i) => (map[h.id] = kids[i + 1]?.id ?? ''))
      store.setNotionState({ itemId, pageId: page.id, blocks: map, base: this.core.syncSnapshot(itemId), syncedAt: Date.now() })
      return { pageId: page.id, created: true }
    }

    try {
      await c.updatePage(state.pageId, this.properties(item))
    } catch (e) {
      // Page supprimée dans Notion : on la recrée plutôt que de perdre l'export.
      if (e instanceof NotionError && (e.status === 404 || /archived/i.test(e.message))) {
        store.deleteNotionState(itemId)
        return this.pushItem(itemId)
      }
      throw e
    }

    const blocks = { ...state.blocks }
    const live = new Set(highlights.map((h) => h.id))
    for (const [hid, bid] of Object.entries(blocks)) {
      if (hid === '_intro' || live.has(hid)) continue
      await c.deleteBlock(bid).catch(() => undefined)
      delete blocks[hid]
    }
    let prev: string | undefined = blocks._intro || undefined
    for (const h of highlights) {
      const bid = blocks[h.id]
      const before = state.base.highlights[h.id]
      const block = highlightToBlock(h, this.label(item, h))
      if (!bid) {
        const created = await c.append(state.pageId, [block], prev).catch(() => c.append(state.pageId, [block]))
        blocks[h.id] = created[0].id!
        prev = blocks[h.id]
        continue
      }
      if (!before || before.color !== h.color) {
        const quote = block.quote as { rich_text: RichText[] }
        await c.updateBlock(bid, { quote: { rich_text: quote.rich_text, color: NOTION_COLOR[h.color] } })
      }
      if (!before || before.note !== h.note.trim()) {
        for (const k of await c.children(bid)) await c.deleteBlock(k.id!)
        const note = noteToBlocks(h.note)
        if (note.length) await c.append(bid, note)
      }
      prev = bid
    }
    store.setNotionState({ itemId, pageId: state.pageId, blocks, base: this.core.syncSnapshot(itemId), syncedAt: Date.now() })
    return { pageId: state.pageId, created: false }
  }

  async pushAll(): Promise<number> {
    const ids = new Set([...this.core.store.itemsWithHighlights(), ...this.core.store.notionItems()])
    for (const id of ids) await this.pushItem(id)
    return ids.size
  }

  // ── Notion → Learn ────────────────────────────────────────────────────────

  pull(): Promise<NotionReport[]> {
    if (!this.pulling) this.pulling = this.doPull().finally(() => (this.pulling = null))
    return this.pulling
  }

  private async doPull(): Promise<NotionReport[]> {
    const { store } = this.core
    const s = store.getSettings()
    if (!s.notionDatabaseId) return []
    const c = this.client()
    const started = Date.now()
    // Marge de deux minutes : l'horloge de Notion et la nôtre ne sont pas forcément d'accord.
    const since = s.notionLastPull ? new Date(s.notionLastPull - 120_000).toISOString() : undefined
    const pages = await c.queryDatabase(s.notionDatabaseId, since)
    const reports: NotionReport[] = []
    for (const page of pages) {
      const itemId = richTextToMd(page.properties['Learn ID']?.rich_text).trim()
      const state = itemId ? store.getNotionState(itemId) : undefined
      const item = itemId ? store.getItem(itemId) : null
      if (!state || !item || state.pageId !== page.id) continue

      const byBlock = new Map(Object.entries(state.blocks).map(([hid, bid]) => [bid, hid]))
      const remote = new Map<string, RemoteHighlight>()
      for (const k of await c.children(page.id)) {
        const hid = byBlock.get(k.id!)
        if (!hid || hid === '_intro' || k.type !== 'quote') continue
        const quote = k.quote as { color?: string }
        remote.set(hid, { color: colorFromNotion(quote.color), note: k.has_children ? blocksToNote(await c.children(k.id!)) : '' })
      }
      const remoteTags = ((page.properties.Tags?.multi_select ?? []) as { name: string }[]).map((t) => t.name)
      const merge = threeWayMerge(store.listHighlights(itemId), remote, state.base, { learn: item.tags, remote: remoteTags, known: store.allTags() }, 'Version modifiée dans Notion :')
      for (const id of merge.removals) store.removeHighlight(id)
      for (const { id, ...patch } of merge.patches) store.updateHighlight(id, patch)
      if (merge.tags) store.updateItem(itemId, { tags: merge.tags })

      // La nouvelle base est ce que contient Notion ; si Learn a davantage, on le renvoie.
      // Les citations supprimées dans Notion perdent leur bloc : si Learn les garde, elles seront recréées.
      const blocks = Object.fromEntries(Object.entries(state.blocks).filter(([hid]) => hid === '_intro' || remote.has(hid)))
      const base: SyncBase = { tags: remoteTags, highlights: Object.fromEntries(remote) }
      store.setNotionState({ ...state, blocks, base, syncedAt: Date.now() })
      if (merge.needsPush) await this.pushItem(itemId)
      else store.setNotionState({ ...state, blocks, base: this.core.syncSnapshot(itemId), syncedAt: Date.now() })

      const report = { itemId, updated: merge.patches.length, removed: merge.removals.length, conflicts: merge.conflicts, tagsChanged: !!merge.tags }
      if (report.updated || report.removed || report.tagsChanged) {
        reports.push(report)
        const parts = [report.updated && `${report.updated} modifié${report.updated > 1 ? 's' : ''}`, report.removed && `${report.removed} supprimé${report.removed > 1 ? 's' : ''}`, report.tagsChanged && 'tags']
        this.emit({ type: 'highlights-changed', itemId, message: `Notion → Learn : ${parts.filter(Boolean).join(', ')}${report.conflicts ? ` · ${report.conflicts} conflit(s) conservé(s)` : ''}` })
      }
    }
    store.updateSettings({ notionLastPull: started })
    if (reports.length) this.emit({ type: 'items-changed' })
    return reports
  }

  // ── Automatisation ────────────────────────────────────────────────────────

  get running(): boolean {
    return this.timer !== null
  }

  restart(): void {
    this.stop()
    const s = this.core.store.getSettings()
    if (!s.notionSync || !s.notionDatabaseId || !this.token()) return
    const tick = (): void => void this.pull().catch(() => undefined)
    this.timer = setInterval(tick, POLL_MS)
    tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const t of this.pushTimers.values()) clearTimeout(t)
    this.pushTimers.clear()
  }

  /** À appeler après toute modification d'un document : envoi groupé quelques secondes plus tard. */
  touch(itemId: string): void {
    if (!this.running) return
    clearTimeout(this.pushTimers.get(itemId))
    this.pushTimers.set(
      itemId,
      setTimeout(() => {
        this.pushTimers.delete(itemId)
        void this.pushItem(itemId).catch(() => undefined)
      }, PUSH_DELAY)
    )
  }
}

export { notionId }
